import { db } from '../db.js';
import {
  BUSINESS_TIME_ZONE,
  getTimeZoneDateParts,
  getUtcDateForTimeZoneLocalTime,
} from './business-time.js';

/**
 * Кандидаты на пополнение полки: позиции, которых в рознице почти не осталось,
 * но на складе запас есть.
 *
 * Зачем отдельно от `low-stock-groups.js`: там контроль по линейкам для закупок
 * (порог линейки, паузы поставок), а здесь — конкретные вкусы и товары, которые
 * можно закрыть перемещением склад → розница, не закупая ничего нового.
 *
 * Правило попадания в список:
 *   розничный остаток <= RESTOCK_RETAIL_MAX_STOCK И складской остаток > 0.
 *   Порог 0 — «в рознице пусто», согласован с заказчиком. Отрицательный остаток
 *   тоже считается пустым: он значит, что продали больше, чем было.
 *
 * Товар с вариантами показывается по строкам вкусов/цветов: остаток родителя
 * у таких товаров не используется (он не участвует и в продаже).
 */
export const RESTOCK_RETAIL_MAX_STOCK = 0;

/**
 * Порог срабатывания значка — сколько позиций минимум должно «закончиться»
 * в рознице при наличии запаса на складе.
 *
 * Считаются все позиции списка: и товары без вариантов, и отдельные вкусы.
 * В текущем каталоге вкусы линейки часто заведены как обычные товары (название
 * вкуса = название товара), поэтому счёт «только по вариантам» давал бы вечный
 * ноль и значок не загорался бы никогда.
 *
 * Значение живёт в `settings`, поэтому меняется без перезапуска сервера.
 */
export const RESTOCK_MIN_VARIANTS_KEY = 'restock_min_variants';
export const RESTOCK_MIN_VARIANTS_DEFAULT = 0;
export const RESTOCK_MIN_VARIANTS_MAX = 999;

const UNGROUPED_KEY = '__ungrouped';
const UNGROUPED_NAME = 'Без линейки';

/**
 * Час суточного пересчёта значка по бизнес-времени. Между пересчётами отдаём
 * закэшированный результат: список нужен для контроля, а не для денег, поэтому
 * суточной свежести достаточно и база не нагружается частыми запросами.
 * Любое действие с перемещениями сбрасывает кэш досрочно.
 */
const RESTOCK_REFRESH_HOUR = 9;

export function getRestockMinVariants() {
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(RESTOCK_MIN_VARIANTS_KEY);
  if (row?.value == null || String(row.value).trim() === '') {
    return RESTOCK_MIN_VARIANTS_DEFAULT;
  }
  const value = Number(row.value);
  if (!Number.isInteger(value) || value < 0 || value > RESTOCK_MIN_VARIANTS_MAX) {
    return RESTOCK_MIN_VARIANTS_DEFAULT;
  }
  return value;
}

export function setRestockMinVariants(rawValue) {
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 0 || value > RESTOCK_MIN_VARIANTS_MAX) {
    const error = new Error('invalid_restock_min_variants');
    error.code = 'invalid_restock_min_variants';
    throw error;
  }
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(RESTOCK_MIN_VARIANTS_KEY, String(value));
  invalidateRestockCache();
  return value;
}

/**
 * Одна позиция = либо товар без вариантов, либо отдельный вариант.
 * Параметр подставляется один раз — тот же запрос используют и полный список,
 * и лёгкий summary, чтобы правила не разъехались.
 *
 * Категория берётся у линейки: `category_groups.categoryId` обязателен, поэтому
 * у линейки ровно одна категория. У товара категория может быть своей и
 * отличаться от категории линейки — тогда заголовок группы показывал бы
 * случайную категорию из первой попавшейся позиции.
 */
const CANDIDATE_ITEMS_SQL = `
  SELECT
    p.id AS product_id,
    NULL AS variant_id,
    p.title AS product_title,
    NULL AS variant_name,
    NULLIF(TRIM(COALESCE(p.groupId, '')), '') AS group_id,
    g.name AS group_name,
    COALESCE(gc.name, c.name) AS category_name,
    COALESCE(p.stock, 0) AS retail_stock,
    COALESCE(p.warehouse_stock, 0) AS warehouse_stock
  FROM products p
  LEFT JOIN category_groups g ON g.id = p.groupId
  LEFT JOIN categories gc ON gc.id = g.categoryId
  LEFT JOIN categories c ON c.id = p.categoryId
  WHERE COALESCE(p.has_variants, 0) = 0

  UNION ALL

  SELECT
    p.id,
    pv.id,
    p.title,
    NULLIF(TRIM(COALESCE(pv.name, '')), ''),
    NULLIF(TRIM(COALESCE(p.groupId, '')), ''),
    g.name,
    COALESCE(gc.name, c.name),
    COALESCE(pv.stock, 0),
    COALESCE(pv.warehouse_stock, 0)
  FROM products p
  JOIN product_variants pv ON pv.product_id = p.id
  LEFT JOIN category_groups g ON g.id = p.groupId
  LEFT JOIN categories gc ON gc.id = g.categoryId
  LEFT JOIN categories c ON c.id = p.categoryId
  WHERE COALESCE(p.has_variants, 0) = 1
`;

const ACTIVE_DRAFTS_SQL = `
  SELECT DISTINCT sti.product_id, sti.variant_id
    FROM stock_transfer_items sti
    JOIN stock_transfers st ON st.id = sti.transfer_id
   WHERE st.status = 'draft'
     AND st.source_location = 'warehouse'
     AND st.destination_location = 'retail'
`;

/** Ключ позиции: у товаров без вариантов variant_id пустой. */
function itemKey(productId, variantId) {
  return `${productId}:${variantId || ''}`;
}

function groupKey(groupId) {
  return groupId ? String(groupId) : UNGROUPED_KEY;
}

/**
 * Черновики перемещений склад → розница, в которых позиция уже лежит.
 *
 * Нужны, чтобы менеджер не заводил вторую заявку на тот же вкус: строка
 * помечается номером заявки, а количество в ней не редактируется. Берём заявку
 * с бо́льшим номером — она свежее.
 */
function selectDraftAssignments() {
  const rows = db
    .prepare(
      `SELECT sti.product_id, sti.variant_id, st.id AS transfer_id, st.transfer_number
         FROM stock_transfer_items sti
         JOIN stock_transfers st ON st.id = sti.transfer_id
        WHERE st.status = 'draft'
          AND st.source_location = 'warehouse'
          AND st.destination_location = 'retail'
        ORDER BY st.transfer_number DESC`,
    )
    .all();

  const assignments = new Map();
  for (const row of rows) {
    const key = itemKey(row.product_id, row.variant_id);
    if (assignments.has(key)) continue;
    assignments.set(key, {
      draftTransferId: row.transfer_id,
      // Номер заявки начинается с 1, но не превращаем 0 в null: иначе в чипе
      // оказалось бы «в заявке №null».
      draftTransferNumber: row.transfer_number == null ? null : Number(row.transfer_number),
    });
  }
  return assignments;
}

/**
 * «Закончилось» (0) идёт выше «заканчивается» (1–2): сначала то, что уже
 * остановило продажи. Дальше — где на складе больше запаса, чтобы проще было
 * выбрать, что именно перемещать.
 */
function compareItems(a, b) {
  if (a.retailStock !== b.retailStock) return a.retailStock - b.retailStock;
  if (a.warehouseStock !== b.warehouseStock) return b.warehouseStock - a.warehouseStock;
  return a.displayName.localeCompare(b.displayName, 'ru', { sensitivity: 'base' });
}

function compareGroups(a, b) {
  // Позиции без линейки всегда в конце: это скорее аномалия каталога.
  if (!a.id !== !b.id) return a.id ? -1 : 1;
  if (a.itemCount !== b.itemCount) return b.itemCount - a.itemCount;
  return a.name.localeCompare(b.name, 'ru', { sensitivity: 'base' });
}

/**
 * Полный список кандидатов, сгруппированный по линейкам.
 *
 * @returns {{
 *   threshold: number,
 *   groups: Array<{
 *     id: string | null,
 *     name: string,
 *     categoryName: string | null,
 *     itemCount: number,
 *     items: Array<object>,
 *   }>,
 *   totals: { itemCount: number, groupCount: number, draftItemCount: number },
 * }}
 */
export function computeRestockCandidates() {
  const rows = db
    .prepare(
      `SELECT * FROM (${CANDIDATE_ITEMS_SQL}) AS candidates
        WHERE candidates.retail_stock <= ?
          AND candidates.warehouse_stock > 0`,
    )
    .all(RESTOCK_RETAIL_MAX_STOCK);

  const drafts = selectDraftAssignments();
  const groupsByKey = new Map();

  for (const row of rows) {
    const variantId = row.variant_id ? String(row.variant_id) : null;
    const productId = String(row.product_id);
    const key = itemKey(productId, variantId);
    const groupId = row.group_id ? String(row.group_id) : null;
    const groupName = row.group_name || UNGROUPED_NAME;
    const draft = drafts.get(key) ?? null;

    const item = {
      key,
      productId,
      variantId,
      productTitle: row.product_title || productId,
      variantName: row.variant_name || null,
      displayName: row.variant_name || row.product_title || productId,
      groupId,
      groupName,
      categoryName: row.category_name || null,
      retailStock: Number(row.retail_stock) || 0,
      warehouseStock: Number(row.warehouse_stock) || 0,
      draftTransferId: draft?.draftTransferId ?? null,
      draftTransferNumber: draft?.draftTransferNumber ?? null,
    };

    const groupKeyValue = groupKey(groupId);
    let group = groupsByKey.get(groupKeyValue);
    if (!group) {
      group = {
        id: groupId,
        name: groupName,
        categoryName: item.categoryName,
        itemCount: 0,
        items: [],
      };
      groupsByKey.set(groupKeyValue, group);
    }
    if (!group.categoryName && item.categoryName) {
      group.categoryName = item.categoryName;
    }
    group.items.push(item);
    group.itemCount += 1;
  }

  const groups = [...groupsByKey.values()];
  for (const group of groups) {
    group.items.sort(compareItems);
  }
  groups.sort(compareGroups);

  const allItems = groups.flatMap((group) => group.items);
  const variantCount = allItems.filter((item) => item.variantId).length;
  const minVariants = getRestockMinVariants();

  return {
    threshold: RESTOCK_RETAIL_MAX_STOCK,
    minVariants,
    // Условие «пора действовать»: позиций в списке достаточно для порога.
    triggered: allItems.length > 0 && allItems.length >= minVariants,
    groups,
    totals: {
      itemCount: allItems.length,
      variantCount,
      groupCount: groups.length,
      draftItemCount: allItems.filter((item) => item.draftTransferId).length,
    },
  };
}

/**
 * Lightweight-версия для значка на экране заказов: только числа, без payload.
 *
 * Результат кэшируется до ближайших 9:00 по бизнес-часу (см. `refreshRestockCache`)
 * и сбрасывается при любом действии с перемещениями. Так база не нагружается
 * частыми запросами, но после создания/оприходования заявки цифра сразу верная.
 *
 * @returns {{
 *   hasAny: boolean,
 *   triggered: boolean,
 *   itemCount: number,
 *   variantCount: number,
 *   groupCount: number,
 *   draftItemCount: number,
 *   minVariants: number,
 * }}
 */
export function getRestockCandidatesSummary() {
  const now = Date.now();
  if (restockCache && restockCache.expiresAt > now) {
    return restockCache.value;
  }
  const value = computeRestockSummary();
  restockCache = { value, expiresAt: getNextRestockRefreshAt(now) };
  return value;
}

/** Сброс кэша: после смены порога и после действий с перемещениями. */
export function invalidateRestockCache() {
  restockCache = null;
}

function computeRestockSummary() {
  const row = db
    .prepare(
      `WITH candidates AS (${CANDIDATE_ITEMS_SQL}),
            items AS (
              SELECT * FROM candidates
               WHERE candidates.retail_stock <= ?
                 AND candidates.warehouse_stock > 0
            ),
            drafts AS (${ACTIVE_DRAFTS_SQL})
       SELECT
         COUNT(*) AS item_count,
         COALESCE(SUM(CASE WHEN items.variant_id IS NULL THEN 0 ELSE 1 END), 0) AS variant_count,
         COUNT(DISTINCT COALESCE(items.group_id, ?)) AS group_count,
         COALESCE(SUM(CASE WHEN d.product_id IS NULL THEN 0 ELSE 1 END), 0) AS draft_item_count
       FROM items
       LEFT JOIN drafts d
         ON d.product_id = items.product_id
        AND d.variant_id IS items.variant_id`,
    )
    .get(RESTOCK_RETAIL_MAX_STOCK, UNGROUPED_KEY);

  const itemCount = Number(row?.item_count) || 0;
  const variantCount = Number(row?.variant_count) || 0;
  const minVariants = getRestockMinVariants();

  return {
    // Список непустой: значок есть, даже если порог ещё не достигнут.
    hasAny: itemCount > 0,
    // Порог «сколько вкусов минимум». При нуле достаточно одного вкуса: значок
    // не должен гореть на пустом списке.
    // Порог 0 — «показывать при любой непустой рознице»: значок не горит на
    // пустом списке, но любая позиция его зажигает.
    triggered: itemCount > 0 && itemCount >= minVariants,
    itemCount,
    variantCount,
    groupCount: Number(row?.group_count) || 0,
    draftItemCount: Number(row?.draft_item_count) || 0,
    minVariants,
  };
}

/**
 * Ближайшие 9:00 по бизнес-часовому поясу в виде epoch-ms.
 *
 * Считаем через смещение пояса на конкретный момент: этого достаточно, чтобы
 * попасть в нужный час и не зависеть от пояса сервера.
 */
function getNextRestockRefreshAt(nowMs) {
  const now = new Date(nowMs);
  const parts = getTimeZoneDateParts(now, BUSINESS_TIME_ZONE);
  const today = getUtcDateForTimeZoneLocalTime(
    parts.year,
    parts.month,
    parts.day,
    RESTOCK_REFRESH_HOUR,
    0,
    0,
    BUSINESS_TIME_ZONE,
  );
  if (today.getTime() > nowMs) return today.getTime();

  // Уже после 9:00 — ждём 9:00 следующего дня. Нормализуем дату через UTC-полдень,
  // чтобы переход на летнее время не сдвинул календарный день.
  const nextDay = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1, 12, 0, 0));
  return getUtcDateForTimeZoneLocalTime(
    nextDay.getUTCFullYear(),
    nextDay.getUTCMonth() + 1,
    nextDay.getUTCDate(),
    RESTOCK_REFRESH_HOUR,
    0,
    0,
    BUSINESS_TIME_ZONE,
  ).getTime();
}

let restockCache = null;