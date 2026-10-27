import { db } from '../db.js';

/**
 * Касса продаёт два вида товаров:
 *
 *   1. Товары каталога, которые менеджер явно опубликовал на кассу
 *      («Опубликовать на кассе» в категории или линейке). Здесь касса только
 *      читает остатки и цены; сами карточки товаров остаются в основной CRM и
 *      создаются обычным путём.
 *   2. «Свои» товары, заведённые прямо с заблокированного экрана через плюсик.
 *      Они намеренно не попадают в каталог CRM: у них своя таблица и свой
 *      счётчик количества. Иначе касса засоряла бы витрину и поиск закупок.
 *
 * Многострочный чек хранится отдельно от pos_sales, потому что pos_sales —
 * финансовый документ (сумма, себестоимость, прибыль, транзакция), а позиции
 * нужны только для расшифровки и возврата остатков. Старые однотоварные чеки
 * остаются валидными: у них pos_sale_items просто пустой.
 *
 * Миграция идемпотентна.
 */

function tableExists(name) {
  return Boolean(
    db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name),
  );
}

function columnsOf(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
}

function addColumn(table, name, definition) {
  const columns = columnsOf(table);
  if (columns.includes(name)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  return true;
}

export function migratePosChecks() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS pos_products (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        cost_price REAL NOT NULL DEFAULT 0,
        retail_price REAL NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 0,
        image_url TEXT,
        created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
        updated_at TEXT NOT NULL DEFAULT (DATETIME('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_pos_products_title
        ON pos_products(title COLLATE NOCASE);

      -- Публикация категории или линейки на кассу вместе с наценкой.
      -- fixed_price приоритетнее наценки (см. utils/pos-pricing.js).
      CREATE TABLE IF NOT EXISTS pos_publications (
        scope TEXT NOT NULL CHECK (scope IN ('category', 'group')),
        target_id TEXT NOT NULL,
        fixed_price REAL,
        markup_amount REAL,
        markup_percent REAL,
        created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
        PRIMARY KEY (scope, target_id)
      );

      CREATE INDEX IF NOT EXISTS idx_pos_publications_target
        ON pos_publications(target_id);

      CREATE TABLE IF NOT EXISTS pos_sale_items (
        id TEXT PRIMARY KEY,
        sale_id TEXT NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
        source TEXT NOT NULL CHECK (source IN ('catalog', 'custom')),
        product_id TEXT,
        variant_id TEXT,
        pos_product_id TEXT,
        title TEXT NOT NULL,
        variant_name TEXT,
        unit_price REAL NOT NULL,
        catalog_price REAL,
        cost_price REAL NOT NULL DEFAULT 0,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        discount_amount REAL NOT NULL DEFAULT 0,
        line_total REAL NOT NULL,
        line_cost REAL NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_pos_sale_items_sale
        ON pos_sale_items(sale_id);

      CREATE INDEX IF NOT EXISTS idx_pos_sale_items_product
        ON pos_sale_items(product_id) WHERE product_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_pos_sale_items_pos_product
        ON pos_sale_items(pos_product_id) WHERE pos_product_id IS NOT NULL;
    `);

    // Шапка чека: скидки, способ оплаты, признак что остатки уже списаны,
    // и ключ идемпотентности — защита от двойного нажатия «Провести».
    addColumn('pos_sales', 'subtotal', 'subtotal REAL NOT NULL DEFAULT 0');
    addColumn('pos_sales', 'discount_percent', 'discount_percent REAL NOT NULL DEFAULT 0');
    addColumn('pos_sales', 'payment_method', "payment_method TEXT NOT NULL DEFAULT 'cash'");
    addColumn('pos_sales', 'stock_deducted', 'stock_deducted INTEGER NOT NULL DEFAULT 0');
    addColumn('pos_sales', 'idempotency_key', 'idempotency_key TEXT');
    addColumn('pos_sales', 'pos_key_id', 'pos_key_id TEXT');

    // Существующие чеки проводились без списания: их удаление не должно
    // пытаться вернуть остатки, которых никто не трогал.
    db.exec(`
      UPDATE pos_sales
      SET stock_deducted = 0
      WHERE idempotency_key IS NULL AND stock_deducted = 1;
    `);

    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_sales_idempotency
        ON pos_sales(idempotency_key) WHERE idempotency_key IS NOT NULL;
    `);

    // Кассовая карта живёт в том же журнале лимитов, что и заказы (правило
    // docs/card-payment-limits-rules.md). order_id у таких операций NULL,
    // поэтому ссылку на чек держим отдельным полем.
    if (tableExists('card_payment_operations')) {
      addColumn('card_payment_operations', 'pos_sale_id', 'pos_sale_id TEXT');
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_card_payment_operations_pos_sale
          ON card_payment_operations(pos_sale_id) WHERE pos_sale_id IS NOT NULL;
      `);
    }

    console.log('[migration] pos checks migration complete');
  } catch (error) {
    console.error('[migration] Failed pos checks migration:', error);
    throw error;
  }
}