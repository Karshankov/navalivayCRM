import { db } from '../db.js';
import { getTimeZoneDateParts } from './business-time.js';

/**
 * Скидки каталога: линейка, товар, отдельный вкус.
 *
 * Цена со скидкой живёт в своей таблице и НЕ подменяет `products.priceRub` и
 * `product_variants.price_rub`. На разнице между проданной и каталожной ценой
 * держится блокировка бонусов в loyalty.js: позиция, проданная дешевле
 * каталога, не даёт штамп. Стоит записать скидку в саму цену, и бонусы за
 * скидочный товар снова начнут копиться.
 *
 * Срок задаётся последним днём действия по календарю магазина: менеджер пишет
 * дату, а не время, и ждёт, что весь этот день скидка ещё работает.
 */

/** Сегодняшняя дата магазина в виде YYYY-MM-DD. */
export function getBusinessDateString(now = new Date()) {
  const parts = getTimeZoneDateParts(now);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function normalizeDiscountDate(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

/**
 * Все скидки, где скидка линейки уже разложена по вложенным линейкам: менеджер
 * ставит её на PODONKI и ждёт, что подешевеет всё внутри, включая товары в
 * PODONKI INFERNO. Раскручиваем один раз при загрузке, чтобы поиск скидки по
 * позиции остался простым сравнением трёх кандидатов.
 *
 * UNION, а не UNION ALL: если линейка окажется вложенной сама в себя, повтор
 * строки оборвёт рекурсию, а не подвесит запрос.
 */
const DISCOUNTS_WITH_INHERITANCE_SQL = `
  WITH RECURSIVE inherited(group_id, price_byn, until_date) AS (
    SELECT target_id, price_byn, until_date
    FROM catalog_discounts
    WHERE scope = 'group'

    UNION

    SELECT child.id, inherited.price_byn, inherited.until_date
    FROM category_groups child
    JOIN inherited ON child.parent_group_id = inherited.group_id
  )
  SELECT 'group' AS scope, group_id AS target_id, price_byn, until_date FROM inherited
  UNION ALL
  SELECT scope, target_id, price_byn, until_date FROM catalog_discounts WHERE scope <> 'group'
`;

/**
 * Цена со скидкой для одной позиции: берём самую выгодную из тех, что нашлись
 * на вкусе, товаре и линейке. Так менеджеру не нужно помнить, какой уровень
 * главнее, а покупателя не обидит менее выгодная скидка.
 *
 * Возвращает `null`, если активных скидок нет: тогда работает обычная цена.
 */
export function resolveDiscountPrice(target, today = getBusinessDateString()) {
  return pickDiscountFromMaps(loadActiveDiscounts(today), target);
}

/**
 * Итоговая цена позиции: скидка, если она есть и она выгоднее базовой цены.
 * Скидка дороже базовой цены игнорируется, иначе опечатка в админке подняла бы
 * цену покупателю.
 */
export function applyDiscountToPrice(basePrice, discountPrice) {
  const base = Number(basePrice);
  if (!Number.isFinite(base)) return base;
  if (discountPrice === null || discountPrice === undefined) return base;
  const discounted = Number(discountPrice);
  if (!Number.isFinite(discounted) || discounted < 0) return base;
  return discounted < base ? discounted : base;
}

/** Скидки пачкой: для списков витрины, чтобы не ходить в базу на каждый товар. */
export function loadActiveDiscounts(today = getBusinessDateString()) {
  const byScope = { group: new Map(), product: new Map(), variant: new Map() };

  for (const row of db.prepare(DISCOUNTS_WITH_INHERITANCE_SQL).all()) {
    if (row.until_date && row.until_date < today) continue;
    const map = byScope[row.scope];
    if (!map) continue;

    // На одной линейке может сойтись своя скидка и родительская: выигрывает
    // та, что выгоднее покупателю.
    const id = String(row.target_id);
    const price = Number(row.price_byn);
    const current = map.get(id);
    if (current === undefined || price < current) map.set(id, price);
  }

  return byScope;
}

/** Самая выгодная скидка для позиции из заранее загруженной пачки. */
export function pickDiscountFromMaps(discounts, { productId, variantId, groupId }) {
  const candidates = [
    variantId ? discounts.variant.get(String(variantId)) : undefined,
    productId ? discounts.product.get(String(productId)) : undefined,
    groupId ? discounts.group.get(String(groupId)) : undefined,
  ].filter((value) => Number.isFinite(value));

  return candidates.length ? Math.min(...candidates) : null;
}

/**
 * Все скидки со сроками пачкой: список товаров в админке показывает их прямо в
 * строке, ходить в базу на каждую позицию незачем.
 */
export function loadDiscountRecords() {
  const today = getBusinessDateString();
  const byScope = { group: new Map(), product: new Map(), variant: new Map() };

  for (const row of db.prepare(DISCOUNTS_WITH_INHERITANCE_SQL).all()) {
    const map = byScope[row.scope];
    if (!map) continue;

    const record = {
      price: Number(row.price_byn),
      untilDate: row.until_date || null,
      active: !row.until_date || row.until_date >= today,
    };

    // Действующая скидка важнее истёкшей, среди равных выигрывает выгодная.
    const current = map.get(String(row.target_id));
    const better = !current
      || (record.active && !current.active)
      || (record.active === current.active && record.price < current.price);
    if (better) map.set(String(row.target_id), record);
  }

  return byScope;
}

/** Скидка одной цели, вместе со сроком: нужна админке и карточке товара. */
export function getDiscountRecord(scope, targetId) {
  if (!scope || !targetId) return null;
  const row = db
    .prepare('SELECT scope, target_id, price_byn, until_date FROM catalog_discounts WHERE scope = ? AND target_id = ?')
    .get(String(scope), String(targetId));
  if (!row) return null;
  const today = getBusinessDateString();
  return {
    scope: row.scope,
    targetId: row.target_id,
    price: Number(row.price_byn),
    untilDate: row.until_date || null,
    active: !row.until_date || row.until_date >= today,
  };
}

/**
 * Проверяет данные скидки до записи. Нужна отдельно от `saveDiscount`, чтобы
 * отказ по кривой цене или дате случился до открытия транзакции.
 */
export function normalizeDiscountInput({ price, untilDate }) {
  if (price === null || price === undefined || price === '') {
    return { price: null, untilDate: null };
  }

  const numericPrice = Number(price);
  if (!Number.isFinite(numericPrice) || numericPrice < 0) {
    const error = new Error('invalid_discount_price');
    error.code = 'invalid_discount_price';
    throw error;
  }

  const normalizedDate = untilDate === null || untilDate === undefined || untilDate === ''
    ? null
    : normalizeDiscountDate(untilDate);
  if (untilDate && !normalizedDate) {
    const error = new Error('invalid_discount_date');
    error.code = 'invalid_discount_date';
    throw error;
  }

  return { price: numericPrice, untilDate: normalizedDate };
}

/**
 * Сохраняет или снимает скидку. `price === null` означает «снять».
 * Бросает ошибку с кодом, если данные не годятся: цена отрицательная или дата
 * в неверном формате.
 */
export function saveDiscount(scope, targetId, { price, untilDate }) {
  if (!['group', 'product', 'variant'].includes(scope)) {
    const error = new Error('invalid_discount_scope');
    error.code = 'invalid_discount_scope';
    throw error;
  }

  if (price === null || price === undefined || price === '') {
    db.prepare('DELETE FROM catalog_discounts WHERE scope = ? AND target_id = ?').run(scope, String(targetId));
    return null;
  }

  const numericPrice = Number(price);
  if (!Number.isFinite(numericPrice) || numericPrice < 0) {
    const error = new Error('invalid_discount_price');
    error.code = 'invalid_discount_price';
    throw error;
  }

  const normalizedDate = untilDate === null || untilDate === undefined || untilDate === ''
    ? null
    : normalizeDiscountDate(untilDate);
  if (untilDate && !normalizedDate) {
    const error = new Error('invalid_discount_date');
    error.code = 'invalid_discount_date';
    throw error;
  }

  db.prepare(`
    INSERT INTO catalog_discounts (scope, target_id, price_byn, until_date, created_at, updated_at)
    VALUES (?, ?, ?, ?, DATETIME('now'), DATETIME('now'))
    ON CONFLICT(scope, target_id) DO UPDATE SET
      price_byn = excluded.price_byn,
      until_date = excluded.until_date,
      updated_at = DATETIME('now')
  `).run(scope, String(targetId), numericPrice, normalizedDate);

  return { scope, targetId: String(targetId), price: numericPrice, untilDate: normalizedDate };
}
