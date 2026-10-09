import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "navalivay-promo-migration-"));
const tempDbPath = path.join(tempDir, "test.db");

process.env.DATABASE_FILE = tempDbPath;
process.env.BOT_TOKEN = "";

const { db } = await import("../db.js");
const { migratePromoCodes } = await import("../migrations/add_promo_codes.js");

function tableColumns(tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all();
}

function indexNames(tableName) {
  return db
    .prepare(
      `
      SELECT name
      FROM sqlite_master
      WHERE type = 'index' AND tbl_name = ?
      ORDER BY name ASC
    `,
    )
    .all(tableName)
    .map((row) => row.name);
}

function getPromoUsageRows() {
  return db
    .prepare(
      `
      SELECT id, order_id, status, used_at
      FROM promo_usage
      ORDER BY id ASC
    `,
    )
    .all();
}

function seedLegacySchema() {
  db.exec(`
    CREATE TABLE orders (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'new',
      completed_at TEXT
    );

    CREATE TABLE customers (
      id TEXT PRIMARY KEY
    );

    CREATE TABLE promo_codes (
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
    );

    CREATE TABLE promo_usage (
      id TEXT PRIMARY KEY,
      promo_code_id TEXT NOT NULL REFERENCES promo_codes(id),
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      customer_id TEXT REFERENCES customers(id),
      discount_applied REAL NOT NULL,
      used_at TEXT DEFAULT (DATETIME('now'))
    );
  `);

  db.exec(`
    INSERT INTO customers (id) VALUES ('customer-1');

    INSERT INTO orders (id, status, completed_at)
    VALUES
      ('order-new', 'new', NULL),
      ('order-done', 'delivered', '2026-03-25 12:00:00');

    INSERT INTO promo_codes (
      id, code, description, discount_type, discount_value, min_order_amount, max_uses, current_uses, active
    ) VALUES (
      'promo-1', 'SAVE10', 'test promo', 'fixed', 10, 0, 5, 0, 1
    );

    INSERT INTO promo_usage (id, promo_code_id, order_id, customer_id, discount_applied, used_at)
    VALUES
      ('usage-1', 'promo-1', 'order-new', 'customer-1', 10, '2026-03-24 10:00:00'),
      ('usage-2', 'promo-1', 'order-done', 'customer-1', 10, NULL);
  `);
}

function main() {
  seedLegacySchema();
  migratePromoCodes();

  const promoUsageColumnNames = tableColumns("promo_usage").map((column) => column.name);
  assert.equal(promoUsageColumnNames.includes("status"), true);

  const promoUsageIndexes = indexNames("promo_usage");
  assert.equal(promoUsageIndexes.includes("idx_promo_usage_status"), true);

  const usageRows = getPromoUsageRows();
  assert.deepEqual(
    usageRows.map((row) => ({
      id: row.id,
      order_id: row.order_id,
      status: row.status,
      used_at: row.used_at,
    })),
    [
      {
        id: "usage-1",
        order_id: "order-new",
        status: "reserved",
        used_at: null,
      },
      {
        id: "usage-2",
        order_id: "order-done",
        status: "consumed",
        used_at: "2026-03-25 12:00:00",
      },
    ],
  );

  const promo = db.prepare(`SELECT current_uses FROM promo_codes WHERE id = 'promo-1'`).get();
  assert.equal(Number(promo.current_uses || 0), 2);

  console.log("[promo-migration-smoke] OK");
}

try {
  main();
} finally {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
