import { db } from '../db.js';

/**
 * Контроль заканчивающихся линеек для CRM «Закупки».
 *
 * Триггер попадания в плашку:
 *   - Если у линейки задан `min_stock_threshold` (>0) и суммарный сток
 *     < threshold → плашка.
 *   - Если порог НЕ задан (NULL/0) — плашка показывается только при полном
 *     обнулении (totalStock === 0) И в линейке есть хотя бы один продукт
 *     (просто пустая линейка — не «заканчивающаяся»).
 *
 * Скрытие из плашки (suppl pauses):
 *   - 'short'         → 3 дня (просто отложить)
 *   - 'no_supply'     → 5 дней («нет у поставщика»)
 *   - 'not_produced'  → 20 дней («не производится»)
 *   После истечения paused_until линейка возвращается в плашку
 *   (если по-прежнему ниже порога).
 */

export const PAUSE_REASONS = Object.freeze({
  short: { label: 'Скрыть на 3 дня', days: 3 },
  no_supply: { label: 'Скрыть на 5 дней', days: 5 },
  not_produced: { label: 'Скрыть на 20 дней', days: 20 },
});

function toSqliteUtcString(date) {
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

/**
 * Возвращает активную паузу для линейки (paused_until > now), или null.
 */
export function getActivePauseForGroup(groupId) {
  if (!groupId) return null;
  return (
    db
      .prepare(
        `SELECT * FROM category_group_supply_pauses
          WHERE group_id = ?
            AND paused_until > DATETIME('now')
          ORDER BY paused_until DESC
          LIMIT 1`,
      )
      .get(String(groupId)) ?? null
  );
}

/**
 * Поставить паузу для линейки.
 *
 * Семантика: одна линейка = одна активная пауза. Перед INSERT удаляем все
 * предыдущие активные паузы по этой группе — это защита от двойного клика
 * (двойной запрос → две записи) и от накопления мусора при «передумали»
 * (нажали short, потом сразу not_produced — должна остаться только последняя).
 *
 * Истёкшие паузы тоже периодически чистим — делаем это лениво, прямо тут,
 * чтобы не плодить cron'ы. Накладные расходы минимальные.
 *
 * Возвращает созданную запись.
 */
export function pauseGroup({ groupId, reason, byUser } = {}) {
  if (!groupId) {
    const err = new Error('group_id_required');
    err.code = 'group_id_required';
    throw err;
  }
  const config = PAUSE_REASONS[reason];
  if (!config) {
    const err = new Error('invalid_pause_reason');
    err.code = 'invalid_pause_reason';
    throw err;
  }
  const exists = db.prepare('SELECT id FROM category_groups WHERE id = ?').get(String(groupId));
  if (!exists) {
    const err = new Error('group_not_found');
    err.code = 'group_not_found';
    throw err;
  }
  const pausedUntil = toSqliteUtcString(
    new Date(Date.now() + config.days * 24 * 60 * 60 * 1000),
  );
  // Атомарно: чистим старые (active + expired) и вставляем новую — иначе
  // между DELETE и INSERT может вклиниться параллельный запрос.
  const tx = db.transaction(() => {
    db.prepare(
      `DELETE FROM category_group_supply_pauses
        WHERE group_id = ?`,
    ).run(String(groupId));
    return db
      .prepare(
        `INSERT INTO category_group_supply_pauses
           (group_id, paused_until, pause_reason, paused_by)
         VALUES (?, ?, ?, ?)`,
      )
      .run(String(groupId), pausedUntil, reason, byUser ?? null);
  });
  const result = tx();
  return db
    .prepare('SELECT * FROM category_group_supply_pauses WHERE id = ?')
    .get(result.lastInsertRowid);
}

/**
 * Снять активную паузу (например, если менеджер передумал).
 * Удаляет все будущие паузы по этой группе. Возвращает количество удалённых.
 */
export function resumeGroup(groupId) {
  if (!groupId) return 0;
  const result = db
    .prepare(
      `DELETE FROM category_group_supply_pauses
        WHERE group_id = ?
          AND paused_until > DATETIME('now')`,
    )
    .run(String(groupId));
  return result.changes;
}

/**
 * Один SQL для агрегации stock + product_count по всем группам.
 * Вынесено как CTE-источник для обоих публичных API.
 *
 * Возвращает массив:
 *   { group_id, threshold, total_stock, product_count, name, slug,
 *     has_cover_image, categoryId, category_name }
 *
 * Cover-image отдельно НЕ тащим (может быть base64 на сотни KB) — на фронте
 * лениво подгружается через `/api/admin/category-groups/:id/image`.
 */
function selectGroupStockAggregates() {
  return db
    .prepare(
      `WITH per_group AS (
         SELECT
           g.id AS group_id,
           g.min_stock_threshold AS threshold,
           g.name,
           g.slug,
           (g.cover_image IS NOT NULL AND g.cover_image != '') AS has_cover_image,
           g.categoryId,
           c.name AS category_name,
           COUNT(p.id) AS product_count,
           COALESCE(SUM(
             CASE WHEN p.has_variants = 1
                  THEN (SELECT COALESCE(SUM(pv.stock), 0)
                          FROM product_variants pv
                         WHERE pv.product_id = p.id)
                  ELSE COALESCE(p.stock, 0)
             END
           ), 0) AS total_stock
         FROM category_groups g
         LEFT JOIN categories c ON c.id = g.categoryId
         LEFT JOIN products p ON p.groupId = g.id
         GROUP BY g.id, g.min_stock_threshold, g.name, g.slug,
                  g.cover_image, g.categoryId, c.name
       )
       SELECT * FROM per_group`,
    )
    .all();
}

/**
 * Применяет бизнес-правило «попадает в плашку?»:
 *   - threshold > 0 → total_stock < threshold
 *   - threshold IS NULL/0 → total_stock === 0 AND product_count > 0
 *   - И не должно быть активной supply_pause
 *
 * Активные паузы получает ОДНИМ запросом и держит как Set, чтобы не делать
 * N отдельных проверок per-row.
 */
function filterLowStock(rows) {
  const activePausedIds = new Set(
    db
      .prepare(
        `SELECT DISTINCT group_id
           FROM category_group_supply_pauses
          WHERE paused_until > DATETIME('now')`,
      )
      .all()
      .map((row) => row.group_id),
  );
  const result = [];
  for (const row of rows) {
    const threshold = Number(row.threshold) || 0;
    const totalStock = Number(row.total_stock) || 0;
    const productCount = Number(row.product_count) || 0;
    let lowStock = false;
    if (threshold > 0) {
      lowStock = totalStock < threshold;
    } else if (totalStock === 0 && productCount > 0) {
      lowStock = true;
    }
    if (!lowStock) continue;
    if (activePausedIds.has(row.group_id)) continue;
    result.push({
      id: row.group_id,
      name: row.name,
      slug: row.slug,
      hasCoverImage: Boolean(row.has_cover_image),
      threshold: threshold || null,
      totalStock,
      categoryId: row.categoryId,
      categoryName: row.category_name,
    });
  }
  return result;
}

/**
 * Считает заканчивающиеся линейки.
 *
 * Один SQL-запрос с CTE-агрегацией (вместо N запросов через
 * computeGroupOwnStock + COUNT(*) per group в старой реализации). Это важно:
 * фронт зовёт endpoint при каждом открытии страницы и индикатор сайдбара
 * polling'ом каждые 15 сек.
 *
 * Сортировка (по фидбэку Кости 08.05.2026): СНАЧАЛА «заканчивается»
 * (totalStock > 0, но ниже порога — успеваем дозаказать пока есть продажи),
 * потом «закончилось» (totalStock === 0 — продажи остановились, спешка
 * меньше). Внутри «заканчивается» — по ratio: чем ближе к нулю, тем выше.
 *
 * Костя: «сделать попроще, чтобы то что заканчивается было выше чем то
 * что закончилось».
 */
export function computeLowStockGroups() {
  const result = filterLowStock(selectGroupStockAggregates());
  result.sort((a, b) => {
    // 1) «Заканчивается» (>0) идёт раньше «Закончилось» (=0)
    if (a.totalStock > 0 && b.totalStock === 0) return -1;
    if (a.totalStock === 0 && b.totalStock > 0) return 1;
    // 2) Внутри «заканчивается» — меньшее соотношение = критичнее = выше
    const aRatio = a.threshold ? a.totalStock / a.threshold : 0;
    const bRatio = b.threshold ? b.totalStock / b.threshold : 0;
    return aRatio - bRatio;
  });
  return result;
}

/**
 * Возвращает позиции линейки от меньшего розничного остатка к большему.
 * Обычный товар идёт одной строкой, а товар с вариантами — отдельной строкой
 * на каждый вкус/цвет. Так менеджер видит, какой именно вариант заканчивается,
 * а не только общий остаток модели.
 */
export function getGroupStockItems(groupId) {
  if (!groupId) {
    const err = new Error('group_id_required');
    err.code = 'group_id_required';
    throw err;
  }

  const group = db.prepare('SELECT id FROM category_groups WHERE id = ?').get(String(groupId));
  if (!group) {
    const err = new Error('group_not_found');
    err.code = 'group_not_found';
    throw err;
  }

  return db
    .prepare(
      `SELECT
         CASE
           WHEN COALESCE(p.has_variants, 0) = 1 AND pv.id IS NOT NULL THEN pv.id
           ELSE p.id
         END AS id,
         CASE
           WHEN COALESCE(p.has_variants, 0) = 1 AND pv.id IS NOT NULL
             THEN COALESCE(NULLIF(TRIM(pv.name), ''), p.title)
           ELSE p.title
         END AS name,
         CASE
           WHEN COALESCE(p.has_variants, 0) = 1 THEN COALESCE(pv.stock, 0)
           ELSE COALESCE(p.stock, 0)
         END AS stock,
         CASE
           WHEN COALESCE(p.has_variants, 0) = 1 THEN COALESCE(pv.warehouse_stock, 0)
           ELSE COALESCE(p.warehouse_stock, 0)
         END AS warehouse_stock
       FROM products p
       LEFT JOIN product_variants pv
         ON pv.product_id = p.id
        AND COALESCE(p.has_variants, 0) = 1
       WHERE p.groupId = ?
       ORDER BY stock ASC, name COLLATE NOCASE ASC, id ASC`,
    )
    .all(String(groupId))
    .map((item) => ({
      id: item.id,
      name: item.name,
      stock: Number(item.stock) || 0,
      warehouse_stock: Number(item.warehouse_stock) || 0,
    }));
}

/**
 * Lightweight-проверка для индикатора в сайдбаре.
 *
 * Считает только КОЛИЧЕСТВО заканчивающихся линеек одним SQL-запросом без
 * материализации full payload. Используется polling'ом каждые 15 сек —
 * критично для производительности.
 *
 * Возвращает { hasAny: boolean, count: number }.
 */
export function getLowStockSummary() {
  const row = db
    .prepare(
      `WITH per_group AS (
         SELECT
           g.id AS group_id,
           g.min_stock_threshold AS threshold,
           COUNT(p.id) AS product_count,
           COALESCE(SUM(
             CASE WHEN p.has_variants = 1
                  THEN (SELECT COALESCE(SUM(pv.stock), 0)
                          FROM product_variants pv
                         WHERE pv.product_id = p.id)
                  ELSE COALESCE(p.stock, 0)
             END
           ), 0) AS total_stock
         FROM category_groups g
         LEFT JOIN products p ON p.groupId = g.id
         GROUP BY g.id, g.min_stock_threshold
       )
       SELECT COUNT(*) AS n FROM per_group pg
       WHERE (
         (pg.threshold > 0 AND pg.total_stock < pg.threshold)
         OR (
           (pg.threshold IS NULL OR pg.threshold = 0)
           AND pg.total_stock = 0
           AND pg.product_count > 0
         )
       )
       AND NOT EXISTS (
         SELECT 1 FROM category_group_supply_pauses sp
         WHERE sp.group_id = pg.group_id
           AND sp.paused_until > DATETIME('now')
       )`,
    )
    .get();
  const count = Number(row?.n ?? 0);
  return { hasAny: count > 0, count };
}
