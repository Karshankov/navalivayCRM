import { db } from '../db.js';

export function migratePromoCodes() {
  try {
    // Create promo_codes table
    db.exec(`
      CREATE TABLE IF NOT EXISTS promo_codes (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE COLLATE NOCASE,
        description TEXT,
        discount_type TEXT NOT NULL DEFAULT 'fixed',
        discount_value REAL NOT NULL,
        min_order_amount REAL DEFAULT 0,
        max_uses INTEGER DEFAULT 1,
        current_uses INTEGER DEFAULT 0,
        valid_from TEXT,
        valid_until TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT (DATETIME('now'))
      )
    `);

    // Create promo_usage table
    db.exec(`
      CREATE TABLE IF NOT EXISTS promo_usage (
        id TEXT PRIMARY KEY,
        promo_code_id TEXT NOT NULL REFERENCES promo_codes(id),
        order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        customer_id TEXT REFERENCES customers(id),
        discount_applied REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'reserved',
        used_at TEXT DEFAULT (DATETIME('now'))
      )
    `);

    // Add promo fields to orders
    const columns = db.prepare(`PRAGMA table_info(orders)`).all();
    const columnNames = columns.map((col) => col.name);

    if (!columnNames.includes('promo_code_id')) {
      console.log('[migration] Adding promo_code_id column to orders table');
      db.exec(`ALTER TABLE orders ADD COLUMN promo_code_id TEXT`);
    }

    if (!columnNames.includes('promo_code_text')) {
      console.log('[migration] Adding promo_code_text column to orders table');
      db.exec(`ALTER TABLE orders ADD COLUMN promo_code_text TEXT`);
    }

    // Add gift and simplified validity fields to promo_codes
    const promoColumns = db.prepare(`PRAGMA table_info(promo_codes)`).all();
    const promoColumnNames = promoColumns.map((col) => col.name);

    if (!promoColumnNames.includes('customer_description')) {
      console.log('[migration] Adding customer_description column to promo_codes table');
      db.exec(`ALTER TABLE promo_codes ADD COLUMN customer_description TEXT`);
    }

    if (!promoColumnNames.includes('manager_description')) {
      console.log('[migration] Adding manager_description column to promo_codes table');
      db.exec(`ALTER TABLE promo_codes ADD COLUMN manager_description TEXT`);
    }

    if (!promoColumnNames.includes('has_gift')) {
      console.log('[migration] Adding has_gift column to promo_codes table');
      db.exec(`ALTER TABLE promo_codes ADD COLUMN has_gift INTEGER NOT NULL DEFAULT 0`);
    }

    if (!promoColumnNames.includes('valid_from_date')) {
      console.log('[migration] Adding valid_from_date column to promo_codes table');
      db.exec(`ALTER TABLE promo_codes ADD COLUMN valid_from_date TEXT`);
    }

    if (!promoColumnNames.includes('duration_days')) {
      console.log('[migration] Adding duration_days column to promo_codes table');
      db.exec(`ALTER TABLE promo_codes ADD COLUMN duration_days INTEGER`);
    }

    const usageColumns = db.prepare(`PRAGMA table_info(promo_usage)`).all();
    const usageColumnNames = usageColumns.map((col) => col.name);

    let statusColumnAdded = false;
    if (!usageColumnNames.includes('status')) {
      console.log('[migration] Adding status column to promo_usage table');
      db.exec(`ALTER TABLE promo_usage ADD COLUMN status TEXT NOT NULL DEFAULT 'reserved'`);
      statusColumnAdded = true;
    }
    const hasStatusColumn = usageColumnNames.includes('status') || statusColumnAdded;

    // Indexes
    db.exec(`CREATE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes(code)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_promo_usage_order ON promo_usage(order_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_promo_usage_promo ON promo_usage(promo_code_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_promo_usage_status ON promo_usage(status)`);

    if (hasStatusColumn) {
      db.exec(`
        UPDATE promo_usage
        SET status = CASE
          WHEN EXISTS (
            SELECT 1
            FROM orders o
            WHERE o.id = promo_usage.order_id
              AND o.status IN ('completed', 'delivered')
          ) THEN 'consumed'
          ELSE 'reserved'
        END
        ${statusColumnAdded ? '' : `
        WHERE status IS NULL
           OR status NOT IN ('reserved', 'consumed')
        `}
      `);
    } else {
      db.exec(`
        UPDATE promo_usage
        SET status = COALESCE(NULLIF(status, ''), 'reserved')
        ${statusColumnAdded ? '' : `
        WHERE status IS NULL
           OR status NOT IN ('reserved', 'consumed')
        `}
      `);
    }

    db.exec(`
      UPDATE promo_usage
      SET used_at = NULL
      WHERE status = 'reserved'
    `);

    if (columnNames.includes('completed_at')) {
      db.exec(`
        UPDATE promo_usage
        SET used_at = COALESCE(
          (
            SELECT o.completed_at
            FROM orders o
            WHERE o.id = promo_usage.order_id
          ),
          used_at,
          DATETIME('now')
        )
        WHERE status = 'consumed'
      `);
    } else {
      db.exec(`
        UPDATE promo_usage
        SET used_at = COALESCE(used_at, DATETIME('now'))
        WHERE status = 'consumed'
      `);
    }

    db.exec(`
      UPDATE promo_codes
      SET current_uses = COALESCE((
        SELECT COUNT(*)
        FROM promo_usage pu
        WHERE pu.promo_code_id = promo_codes.id
          AND pu.status IN ('reserved', 'consumed')
      ), 0)
    `);

    // Backfill new descriptions from legacy description
    db.exec(`
      UPDATE promo_codes
      SET customer_description = COALESCE(NULLIF(customer_description, ''), description)
      WHERE (customer_description IS NULL OR TRIM(customer_description) = '')
        AND description IS NOT NULL
        AND TRIM(description) <> ''
    `);

    console.log('[migration] Promo codes migration completed successfully');
  } catch (error) {
    console.error('[migration] Promo codes migration failed:', error);
    if (!String(error.message).includes('duplicate column name') && !String(error.message).includes('already exists')) {
      throw error;
    }
  }
}
