import { db } from '../db.js';

function hasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
}

/**
 * Разделяет текущий розничный остаток и запас в подсобном складе.
 * Старые значения stock не меняются: после миграции весь текущий товар остаётся в рознице.
 */
export function migrateInventoryLocations() {
  if (!hasColumn('products', 'warehouse_stock')) {
    db.exec('ALTER TABLE products ADD COLUMN warehouse_stock INTEGER NOT NULL DEFAULT 0');
    console.log('[migration] Added products.warehouse_stock');
  }

  if (!hasColumn('product_variants', 'warehouse_stock')) {
    db.exec('ALTER TABLE product_variants ADD COLUMN warehouse_stock INTEGER NOT NULL DEFAULT 0');
    console.log('[migration] Added product_variants.warehouse_stock');
  }

  if (!hasColumn('procurement_items', 'warehouse_quantity')) {
    db.exec('ALTER TABLE procurement_items ADD COLUMN warehouse_quantity INTEGER NOT NULL DEFAULT 0');
    console.log('[migration] Added procurement_items.warehouse_quantity');
  }

  if (!hasColumn('procurement_items', 'variant_id')) {
    db.exec('ALTER TABLE procurement_items ADD COLUMN variant_id TEXT REFERENCES product_variants(id) ON DELETE SET NULL');
    console.log('[migration] Added procurement_items.variant_id');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_transfers (
      id TEXT PRIMARY KEY,
      transfer_number INTEGER NOT NULL UNIQUE,
      source_location TEXT NOT NULL CHECK (source_location IN ('retail', 'warehouse')),
      destination_location TEXT NOT NULL CHECK (destination_location IN ('retail', 'warehouse')),
      comment TEXT,
      created_at TEXT NOT NULL DEFAULT (DATETIME('now'))
    );

    CREATE TABLE IF NOT EXISTS stock_transfer_items (
      id TEXT PRIMARY KEY,
      transfer_id TEXT NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL,
      variant_id TEXT,
      product_title TEXT NOT NULL,
      variant_name TEXT,
      quantity INTEGER NOT NULL CHECK (quantity > 0)
    );

    CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_transfer
      ON stock_transfer_items(transfer_id);
    CREATE INDEX IF NOT EXISTS idx_stock_transfers_created
      ON stock_transfers(created_at);
    CREATE INDEX IF NOT EXISTS idx_products_warehouse_stock
      ON products(warehouse_stock);
    CREATE INDEX IF NOT EXISTS idx_product_variants_warehouse_stock
      ON product_variants(warehouse_stock);
  `);

  const transferColumns = [
    ['status', "TEXT NOT NULL DEFAULT 'draft'"],
    ['created_by', 'TEXT'],
    ['completed_by', 'TEXT'],
    ['completed_at', 'TEXT'],
    ['cancelled_by', 'TEXT'],
    ['cancelled_at', 'TEXT'],
    // Черновик можно править до оприходования, поэтому храним, кто и когда это
    // сделал: иначе в карточке видно только автора первой версии.
    ['updated_by', 'TEXT'],
    ['updated_at', 'TEXT'],
  ];
  for (const [column, definition] of transferColumns) {
    if (!hasColumn('stock_transfers', column)) {
      db.exec(`ALTER TABLE stock_transfers ADD COLUMN ${column} ${definition}`);
      console.log(`[migration] Added stock_transfers.${column}`);
    }
  }

  // До появления заявок все перемещения проводились сразу. У таких записей
  // нет created_by. Условие намеренно идемпотентно на случай прерванного ALTER.
  db.exec(`
    UPDATE stock_transfers
    SET status = 'completed', completed_at = COALESCE(completed_at, created_at)
    WHERE status = 'draft' AND created_by IS NULL
  `);

  const transferItemDisplayColumns = [
    ['category_name', 'TEXT'],
    ['group_name', 'TEXT'],
    ['image_url', 'TEXT'],
  ];
  for (const [column, definition] of transferItemDisplayColumns) {
    if (!hasColumn('stock_transfer_items', column)) {
      db.exec(`ALTER TABLE stock_transfer_items ADD COLUMN ${column} ${definition}`);
      console.log(`[migration] Added stock_transfer_items.${column}`);
    }
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_stock_transfers_status_created
      ON stock_transfers(status, created_at DESC);
  `);
}
