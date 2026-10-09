import crypto from 'crypto';
import { db } from '../db.js';

const DEFAULT_WHOLESALE_TIERS = [
  { id: 'wt_100', code: '100', label: 'Опт от 100 BYN', minOrderAmount: 100, sortOrder: 100 },
  { id: 'wt_250', code: '250', label: 'Опт от 250 BYN', minOrderAmount: 250, sortOrder: 250 },
  { id: 'wt_500', code: '500', label: 'Опт от 500 BYN', minOrderAmount: 500, sortOrder: 500 },
  { id: 'wt_1000', code: '1000', label: 'Опт от 1000 BYN', minOrderAmount: 1000, sortOrder: 1000 },
];

function generateSecret() {
  return crypto.randomBytes(18).toString('base64url');
}

export function migrateWholesalePricing() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS wholesale_tiers (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        min_order_amount REAL NOT NULL,
        secret_key TEXT NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
        updated_at TEXT NOT NULL DEFAULT (DATETIME('now'))
      );

      CREATE TABLE IF NOT EXISTS category_group_wholesale_prices (
        group_id TEXT NOT NULL REFERENCES category_groups(id) ON DELETE CASCADE,
        tier_id TEXT NOT NULL REFERENCES wholesale_tiers(id) ON DELETE CASCADE,
        price_byn REAL NOT NULL,
        created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
        updated_at TEXT NOT NULL DEFAULT (DATETIME('now')),
        PRIMARY KEY (group_id, tier_id)
      );

      CREATE INDEX IF NOT EXISTS idx_wholesale_tiers_active
      ON wholesale_tiers(is_active, sort_order);

      CREATE INDEX IF NOT EXISTS idx_group_wholesale_prices_tier
      ON category_group_wholesale_prices(tier_id);

      CREATE INDEX IF NOT EXISTS idx_group_wholesale_prices_group
      ON category_group_wholesale_prices(group_id);
    `);

    const orderColumns = db.prepare(`PRAGMA table_info(orders)`).all();
    const orderColumnNames = new Set(orderColumns.map((column) => column.name));

    if (!orderColumnNames.has('is_wholesale')) {
      db.exec(`ALTER TABLE orders ADD COLUMN is_wholesale INTEGER NOT NULL DEFAULT 0`);
      console.log('[migration] Added is_wholesale to orders table');
    }

    if (!orderColumnNames.has('wholesale_tier_id')) {
      db.exec(`ALTER TABLE orders ADD COLUMN wholesale_tier_id TEXT`);
      console.log('[migration] Added wholesale_tier_id to orders table');
    }

    if (!orderColumnNames.has('wholesale_tier_label')) {
      db.exec(`ALTER TABLE orders ADD COLUMN wholesale_tier_label TEXT`);
      console.log('[migration] Added wholesale_tier_label to orders table');
    }

    if (!orderColumnNames.has('wholesale_min_amount')) {
      db.exec(`ALTER TABLE orders ADD COLUMN wholesale_min_amount REAL`);
      console.log('[migration] Added wholesale_min_amount to orders table');
    }

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_orders_wholesale_tier
      ON orders(wholesale_tier_id);
    `);

    const selectTier = db.prepare(`
      SELECT id, code, secret_key
      FROM wholesale_tiers
      WHERE code = ?
      LIMIT 1
    `);
    const insertTier = db.prepare(`
      INSERT INTO wholesale_tiers (
        id, code, label, min_order_amount, secret_key, sort_order, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, 1)
    `);
    const updateTier = db.prepare(`
      UPDATE wholesale_tiers
      SET label = ?,
          min_order_amount = ?,
          sort_order = ?,
          is_active = 1,
          secret_key = COALESCE(NULLIF(secret_key, ''), ?),
          updated_at = DATETIME('now')
      WHERE code = ?
    `);

    for (const tier of DEFAULT_WHOLESALE_TIERS) {
      const existing = selectTier.get(tier.code);
      if (!existing) {
        insertTier.run(
          tier.id,
          tier.code,
          tier.label,
          tier.minOrderAmount,
          generateSecret(),
          tier.sortOrder,
        );
        console.log(`[migration] Seeded wholesale tier ${tier.code}`);
        continue;
      }

      updateTier.run(
        tier.label,
        tier.minOrderAmount,
        tier.sortOrder,
        generateSecret(),
        tier.code,
      );
    }
  } catch (error) {
    console.error('[migration] Failed to add wholesale pricing:', error);
    throw error;
  }
}
