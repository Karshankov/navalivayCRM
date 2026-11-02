import crypto from 'node:crypto';

/**
 * Ревизия витрины для клиентского кэша каталога (mini app).
 *
 * Клиент кэширует каталог в localStorage и при повторном открытии спрашивает
 * `GET /api/catalog/version`: если ревизия совпала — сетевых загрузок каталога
 * нет вовсе. Ревизия — SHA-256 от конкатенации дешёвых агрегатов по всем
 * таблицам витрины, поэтому она меняется при любом изменении цен, остатков,
 * состава каталога, баннеров и оптовых цен. Дополнительный скачок задаётся
 * `bumpCatalogRevision()` на административных мутациях (правка title/
 * description и прочего, что агрегаты не видят) — тем же паттерном, что
 * `refreshProductSearchIndex`.
 */

const SETTING_KEY = 'catalog_content_revision';

function hashFingerprint(parts) {
  const hash = crypto.createHash('sha256');
  for (const part of parts) {
    hash.update(String(part ?? ''));
    hash.update('|');
  }
  return hash.digest('hex');
}

/** Все агрегаты витрины. Read-only запросы: блокировок SQLite не создают. */
function collectCatalogFingerprintParts(db) {
  const parts = [];

  // settings-ревизия из административных мутаций (см. bumpCatalogRevision).
  parts.push(db.prepare('SELECT value FROM settings WHERE key = ?').get(SETTING_KEY)?.value || '');

  // Товары: количество, сумма цен, остатки розницы и склада, новизна.
  const products = db.prepare(`
    SELECT
      COUNT(*) AS n,
      SUM(priceRub) AS price_sum,
      SUM(COALESCE(stock, 0)) AS stock_sum,
      SUM(COALESCE(warehouse_stock, 0)) AS warehouse_stock_sum,
      MAX(createdAt) AS latest_created_at
    FROM products
  `).get();
  parts.push(
    products.n,
    products.price_sum,
    products.stock_sum,
    products.warehouse_stock_sum,
    products.latest_created_at,
  );

  // Варианты: количество и суммарный остаток (влияет на доступность товаров
  // с has_variants = 1).
  const variants = db.prepare(`
    SELECT
      COUNT(*) AS n,
      SUM(COALESCE(stock, 0)) AS stock_sum
    FROM product_variants
  `).get();
  parts.push(variants.n, variants.stock_sum);

  // Линейки: количество и updatedAt (метки, бейджи, parent-иерархия).
  const groups = db.prepare(`
    SELECT
      COUNT(*) AS n,
      MAX(COALESCE(updatedAt, createdAt)) AS latest_at
    FROM category_groups
  `).get();
  parts.push(groups.n, groups.latest_at);

  // Категории: количество и суммарная длина имён (переименование/порядок
  // ловится косвенно; для порядка служит bump).
  const categories = db.prepare(`
    SELECT
      COUNT(*) AS n,
      SUM(LENGTH(name)) AS name_len_sum
    FROM categories
  `).get();
  parts.push(categories.n, categories.name_len_sum);

  // Баннеры: количество, активность, порядок, объём текста/ссылок.
  const banners = db.prepare(`
    SELECT
      COUNT(*) AS n,
      SUM(active) AS active_sum,
      SUM([order]) AS order_sum,
      SUM(LENGTH(COALESCE(title, ''))) AS title_len_sum,
      SUM(LENGTH(COALESCE(href, ''))) AS href_len_sum
    FROM banners
  `).get();
  parts.push(
    banners.n,
    banners.active_sum,
    banners.order_sum,
    banners.title_len_sum,
    banners.href_len_sum,
  );

  // Оптовые цены линеек: смена тарифа должна инвалидировать кэш оптового
  // каталога.
  const wholesalePrices = db.prepare(`
    SELECT
      COUNT(*) AS n,
      SUM(price_byn) AS price_sum
    FROM category_group_wholesale_prices
  `).get();
  parts.push(wholesalePrices.n, wholesalePrices.price_sum);

  return parts;
}

/**
 * Текущая ревизия витрины. Стабильна, пока каталог не менялся; меняется при
 * любом изменении агрегатов или административном bump.
 */
export function getCatalogRevision(db) {
  return hashFingerprint(collectCatalogFingerprintParts(db));
}

/**
 * Принудительный скачок ревизии для административных мутаций, которые не
 * меняют агрегаты (title, description, порядок). Записывает в `settings`
 * монотонное значение. Безопасно вызывать вне транзакции мутации: пропущенный
 * вызов не ломает корректность (агрегаты — страховка), меняется только
 * свежесть витрины.
 */
let lastBumpValue = 0;

export function bumpCatalogRevision(db, context) {
  try {
    // Монотонность: два bump'а в одну миллисекунду не должны давать одно
    // значение (иначе клиент не увидит второе изменение).
    let value = Date.now();
    if (value <= lastBumpValue) {
      value = lastBumpValue + 1;
    }
    lastBumpValue = value;
    db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(SETTING_KEY, String(value));
  } catch (error) {
    console.error(`[catalog-revision] bump failed after ${context}:`, error?.message || error);
  }
}
