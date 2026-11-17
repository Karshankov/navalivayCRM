import { db } from '../db.js';
import { roundMoney } from './money.js';

/**
 * Цена всей линейки: одно значение на все товары группы.
 *
 * Зачем: вкусы — это отдельные товары (поле `title`), а не варианты. Линейка
 * на 40+ вкусов обрастает разными ценами (у CATSWILL встречались 9, 15 и 17),
 * и правка поштучно отнимает вечер. Здесь цена задаётся один раз на линейку.
 *
 * Что НЕ затрагивается:
 * - оптовые цены: они лежат в `category_group_wholesale_prices` и живут отдельно
 *   от розничного `products.priceRub`;
 * - история заказов: `order_items` хранит собственную копию цены
 *   (`price_per_unit`), поэтому старые заказы не пересчитываются;
 * - цены вариантов (`product_variants.priceRub`): у линейки с вкусами-товарами
 *   варианты обычно не используются, но если используются — их цена остаётся
 *   прежней, потому что у варианта своя цена и она приоритетнее в рознице.
 *
 * Про скидки: скидка хранит абсолютную цену, а не процент. Если после
 * повышения цены скидка окажется выше базовой, она просто перестанет
 * применяться (`applyDiscountToPrice` берёт минимум из двух) — покупатель
 * не увидит завышенную цену. Но продавец об этом не узнает, поэтому такие
 * товары считаем заранее и показываем предупреждение.
 */

/** Защита от опечатки: цена выше этой почти наверняка ошибка ввода. */
export const MAX_LINE_PRICE = 100000;

/** Ключ настройки, где лежит последнее применённое значение для линейки. */
function settingKey(groupId) {
  return `group_line_price:${groupId}`;
}

/**
 * Разбирает цену из запроса. Возвращает `null`, если поле пустое — это значит
 * «цену не менять», а не «поставить ноль».
 *
 * @throws {Error} с кодом `invalid_line_price` при мусоре в поле.
 */
export function normalizeLinePrice(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    const error = new Error('Цена должна быть числом');
    error.code = 'invalid_line_price';
    throw error;
  }

  if (amount <= 0) {
    const error = new Error('Цена должна быть больше нуля');
    error.code = 'invalid_line_price';
    throw error;
  }

  if (amount > MAX_LINE_PRICE) {
    const error = new Error(`Цена не может быть больше ${MAX_LINE_PRICE}`);
    error.code = 'invalid_line_price';
    throw error;
  }

  return roundMoney(amount);
}

/** Последнее сохранённое значение цены линейки (или `null`, если не задавали). */
export function getGroupLinePrice(groupId) {
  const normalized = typeof groupId === 'string' ? groupId.trim() : '';
  if (!normalized) {
    return null;
  }

  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(settingKey(normalized));

  if (!row || row.value === null || row.value === undefined) {
    return null;
  }

  const amount = Number(row.value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/** То же пачкой — для списка линеек, чтобы не ходить в базу на каждую. */
export function getBulkGroupLinePrices(groupIds) {
  const ids = (Array.isArray(groupIds) ? groupIds : [])
    .map((id) => (typeof id === 'string' ? id.trim() : ''))
    .filter(Boolean);

  const result = new Map();
  if (ids.length === 0) {
    return result;
  }

  const keys = ids.map(settingKey);
  const placeholders = keys.map(() => '?').join(', ');
  const rows = db
    .prepare(`SELECT key, value FROM settings WHERE key IN (${placeholders})`)
    .all(...keys);

  for (const row of rows) {
    const groupId = String(row.key).slice('group_line_price:'.length);
    const amount = Number(row.value);
    result.set(groupId, Number.isFinite(amount) && amount > 0 ? amount : null);
  }

  return result;
}

/**
 * Сколько разных цен у товаров линейки.
 *
 * Нужно для подсказки в форме: «сейчас у 44 товаров 3 разные цены: 9, 15, 17».
 * Разнобой — это и есть причина, по которой линейку хотят выровнять.
 */
export function getGroupPriceSpread(groupId) {
  const normalized = typeof groupId === 'string' ? groupId.trim() : '';
  if (!normalized) {
    return { productCount: 0, distinctPrices: [], minPrice: null, maxPrice: null };
  }

  const rows = db
    .prepare(
      `SELECT DISTINCT CAST(priceRub AS REAL) AS price
       FROM products
       WHERE groupId = ? AND priceRub IS NOT NULL
       ORDER BY price ASC`,
    )
    .all(normalized);

  const prices = rows
    .map((row) => Number(row.price))
    .filter((price) => Number.isFinite(price));

  const count = db
    .prepare('SELECT COUNT(*) AS total FROM products WHERE groupId = ?')
    .get(normalized);

  return {
    productCount: Number(count?.total ?? 0),
    distinctPrices: prices,
    minPrice: prices.length ? prices[0] : null,
    maxPrice: prices.length ? prices[prices.length - 1] : null,
  };
}

/**
 * Товары линейки, у которых скидка станет бесполезной при новой цене.
 *
 * Скидка хранит абсолютную цену: если товар стоил 15 со скидкой 14, а линейку
 * подняли до 20, то скидка 14 всё ещё выгодна — она применяется. Проблема
 * обратная: когда цена падает ниже скидки, скидка перестаёт применяться
 * совсем, и она остаётся в админке мёртвым грузом.
 *
 * Поэтому считаем товары, у которых скидка окажется НЕ ниже новой цены.
 */
export function countDiscountsAtRisk(groupId, nextPrice) {
  const normalized = typeof groupId === 'string' ? groupId.trim() : '';
  const price = Number(nextPrice);

  if (!normalized || !Number.isFinite(price)) {
    return 0;
  }

  // Скидка на саму линейку наследуется всеми её товарами, поэтому её тоже
  // учитываем: она действует и после смены цены, и её судьба важна продавцу.
  const groupDiscount = db
    .prepare(
      `SELECT price_byn FROM catalog_discounts
       WHERE scope = 'group' AND target_id = ?
       LIMIT 1`,
    )
    .get(normalized);

  const groupDiscountPrice = groupDiscount ? Number(groupDiscount.price_byn) : null;

  const row = db
    .prepare(
      `SELECT COUNT(*) AS total
       FROM products p
       WHERE p.groupId = ?
         AND EXISTS (
           SELECT 1 FROM catalog_discounts d
           WHERE d.scope = 'product' AND d.target_id = p.id
             AND CAST(d.price_byn AS REAL) >= ?
         )`,
    )
    .get(normalized, price);

  let total = Number(row?.total ?? 0);

  // Скидка линейки касается всех товаров, у которых нет своей, более выгодной.
  if (groupDiscountPrice !== null && Number.isFinite(groupDiscountPrice) && groupDiscountPrice >= price) {
    const withoutOwnDiscount = db
      .prepare(
        `SELECT COUNT(*) AS total
         FROM products p
         WHERE p.groupId = ?
           AND NOT EXISTS (
             SELECT 1 FROM catalog_discounts d
             WHERE d.scope = 'product' AND d.target_id = p.id
               AND CAST(d.price_byn AS REAL) < ?
           )`,
      )
      .get(normalized, groupDiscountPrice);

    total += Number(withoutOwnDiscount?.total ?? 0);
  }

  return total;
}

/**
 * Применяет цену ко всем товарам линейки.
 *
 * Вызывается ВНУТРИ транзакции вызывающего кода: если что-то упадёт, цены
 * не должны остаться изменёнными наполовину.
 *
 * @returns {number} сколько товаров обновлено.
 */
export function applyLinePrice(groupId, price) {
  const normalized = typeof groupId === 'string' ? groupId.trim() : '';
  const amount = normalizeLinePrice(price);

  if (!normalized || amount === null) {
    return 0;
  }

  const result = db
    .prepare('UPDATE products SET priceRub = ? WHERE groupId = ?')
    .run(amount, normalized);

  db.prepare(`
    INSERT INTO settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(settingKey(normalized), String(amount));

  return Number(result.changes ?? 0);
}

/**
 * Сколько товаров линейки имеют скидку ниже указанной цены.
 *
 * Форма спрашивает это на каждое изменение поля, поэтому функция дешёвая:
 * один запрос без обращения к самим товарам.
 */
export function countGroupProductsWithDiscountBelow(groupId, price) {
  const normalized = typeof groupId === 'string' ? groupId.trim() : '';
  const limit = Number(price);

  if (!normalized || !Number.isFinite(limit) || limit <= 0) {
    return 0;
  }

  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT p.id) AS total
       FROM products p
       WHERE p.groupId = ?
         AND EXISTS (
           SELECT 1 FROM catalog_discounts d
           WHERE d.scope = 'product' AND d.target_id = p.id
             AND CAST(d.price_byn AS REAL) < ?
         )`,
    )
    .get(normalized, limit);

  return Number(row?.total ?? 0);
}

/**
 * Цены скидок у товаров линейки.
 *
 * Отдаём сами числа, а не готовый счётчик: неизвестно, какую цену введёт
 * продавец, а предупреждение должно появиться сразу, пока он набирает число.
 * Список короткий — скидки есть у единиц товаров.
 */
export function getGroupProductDiscountPrices(groupId) {
  const normalized = typeof groupId === 'string' ? groupId.trim() : '';
  if (!normalized) {
    return [];
  }

  const rows = db
    .prepare(
      `SELECT CAST(d.price_byn AS REAL) AS price
       FROM catalog_discounts d
       JOIN products p ON p.id = d.target_id
       WHERE d.scope = 'product' AND p.groupId = ?
       ORDER BY price ASC`,
    )
    .all(normalized);

  return rows
    .map((row) => Number(row.price))
    .filter((price) => Number.isFinite(price));
}
