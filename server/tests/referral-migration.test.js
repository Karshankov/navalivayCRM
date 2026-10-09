import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(__dirname, `.tmp-referral-migration-${Date.now()}.db`);
const legacy = new Database(file);
legacy.exec(`
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE customers (
    id TEXT PRIMARY KEY, telegram_id TEXT, telegram_username TEXT,
    updated_at TEXT, deleted_at TEXT, bot_verified_at TEXT
  );
  CREATE TABLE orders (id TEXT PRIMARY KEY, customer_id TEXT, status TEXT);
  CREATE TABLE products (
    id TEXT PRIMARY KEY,
    stock INTEGER NOT NULL DEFAULT 0,
    warehouse_stock INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE product_variants (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    warehouse_stock INTEGER NOT NULL DEFAULT 0
  );
  INSERT INTO customers (id, telegram_id, telegram_username, updated_at)
  VALUES
    ('legacy-zero', '1', 'legacy_zero', DATETIME('now')),
    ('legacy-with-order', '2', 'legacy_ordered', DATETIME('now')),
    ('legacy-verified', '9', 'legacy_verified', DATETIME('now')),
    ('legacy-verified-deleted', '10', 'legacy_verified_deleted', DATETIME('now'));
  UPDATE customers SET bot_verified_at = '2026-01-01 00:00:00'
  WHERE id IN ('legacy-verified', 'legacy-verified-deleted');
  UPDATE customers SET deleted_at = '2026-01-02 00:00:00'
  WHERE id = 'legacy-verified-deleted';
  INSERT INTO orders (id, customer_id, status)
  VALUES ('old-order', 'legacy-with-order', 'completed');
  INSERT INTO products (id, stock, warehouse_stock)
  VALUES ('stock-guard-product', 37, 19);
  INSERT INTO product_variants (id, product_id, stock, warehouse_stock)
  VALUES ('stock-guard-variant', 'stock-guard-product', 23, 11);
`);
legacy.close();
process.env.DATABASE_FILE = file;

const { db } = await import('../db.js');
const { migrateReferralAuthorization } = await import('../migrations/add_referral_authorization.js');
try {
  migrateReferralAuthorization();
  const zero = db.prepare("SELECT * FROM customers WHERE id = 'legacy-zero'").get();
  assert.equal(zero.access_authorized_at, null);
  assert.equal(zero.access_authorization_source, null);
  const ordered = db.prepare("SELECT * FROM customers WHERE id = 'legacy-with-order'").get();
  assert.ok(ordered.access_authorized_at);
  assert.equal(ordered.access_authorization_source, 'legacy');
  const verified = db.prepare("SELECT * FROM customers WHERE id = 'legacy-verified'").get();
  assert.ok(verified.access_authorized_at);
  assert.equal(verified.access_authorization_source, 'legacy');
  const verifiedDeleted = db.prepare("SELECT * FROM customers WHERE id = 'legacy-verified-deleted'").get();
  assert.equal(verifiedDeleted.access_authorized_at, null);
  assert.equal(verifiedDeleted.access_authorization_source, null);
  assert.ok(db.prepare(`
    SELECT 1 FROM sqlite_master
    WHERE type = 'table' AND name = 'referral_disallowed_inviter_usernames'
  `).get());
  assert.deepEqual(
    db.prepare("SELECT stock, warehouse_stock FROM products WHERE id = 'stock-guard-product'").get(),
    { stock: 37, warehouse_stock: 19 },
  );
  assert.deepEqual(
    db.prepare("SELECT stock, warehouse_stock FROM product_variants WHERE id = 'stock-guard-variant'").get(),
    { stock: 23, warehouse_stock: 11 },
  );

  db.prepare(`
    INSERT INTO customers (id, telegram_id, telegram_username, updated_at)
    VALUES ('after-install', '3', 'after_install', DATETIME('now'))
  `).run();
  migrateReferralAuthorization();
  const after = db.prepare("SELECT * FROM customers WHERE id = 'after-install'").get();
  assert.equal(after.access_authorized_at, null);
  assert.equal(after.access_authorization_source, null);

  // Имитация ранней версии: она ошибочно проставила legacy всем подряд.
  // v2 должна снять доступ с нулевого клиента, оставить клиента с заказом и
  // не потерять уже успешно пройденную новую авторизацию.
  db.prepare("DELETE FROM settings WHERE key = 'referral_authorization_order_backfill_v2_done'").run();
  db.prepare(`
    INSERT INTO customers (
      id, telegram_id, telegram_username, updated_at,
      access_authorized_at, access_authorization_source
    ) VALUES
      ('bad-legacy-zero', '4', 'bad_legacy_zero', DATETIME('now'), DATETIME('now'), 'legacy'),
      ('bad-legacy-ordered', '5', 'bad_legacy_ordered', DATETIME('now'), DATETIME('now'), 'legacy'),
      ('bad-legacy-referred', '6', 'bad_legacy_referred', DATETIME('now'), DATETIME('now'), 'legacy'),
      ('bad-legacy-staff', '7', 'bad_legacy_staff', DATETIME('now'), DATETIME('now'), 'legacy'),
      ('bad-legacy-cancelled', '8', 'bad_legacy_cancelled', DATETIME('now'), DATETIME('now'), 'legacy')
  `).run();
  db.prepare("INSERT INTO orders (id, customer_id, status) VALUES ('partial-order', 'bad-legacy-ordered', 'delivered')").run();
  db.prepare("INSERT INTO orders (id, customer_id, status) VALUES ('cancelled-order', 'bad-legacy-cancelled', 'cancelled')").run();
  db.prepare(`
    INSERT INTO referral_auth_states (telegram_id, customer_id, status)
    VALUES ('6', 'bad-legacy-referred', 'authorized')
  `).run();
  const referral = await import('../utils/referral-authorization.js');
  referral.authorizeCustomerWithoutReferral('bad-legacy-staff', 'staff');
  migrateReferralAuthorization();
  const correctedZero = db.prepare("SELECT * FROM customers WHERE id = 'bad-legacy-zero'").get();
  assert.equal(correctedZero.access_authorized_at, null);
  assert.equal(correctedZero.access_authorization_source, null);
  const correctedOrdered = db.prepare("SELECT * FROM customers WHERE id = 'bad-legacy-ordered'").get();
  assert.ok(correctedOrdered.access_authorized_at);
  assert.equal(correctedOrdered.access_authorization_source, 'legacy');
  const correctedReferred = db.prepare("SELECT * FROM customers WHERE id = 'bad-legacy-referred'").get();
  assert.ok(correctedReferred.access_authorized_at);
  assert.equal(correctedReferred.access_authorization_source, 'referral');
  const correctedStaff = db.prepare("SELECT * FROM customers WHERE id = 'bad-legacy-staff'").get();
  assert.ok(correctedStaff.access_authorized_at);
  assert.equal(correctedStaff.access_authorization_source, 'staff');
  const correctedCancelled = db.prepare("SELECT * FROM customers WHERE id = 'bad-legacy-cancelled'").get();
  assert.equal(correctedCancelled.access_authorized_at, null);
  assert.equal(correctedCancelled.access_authorization_source, null);

  migrateReferralAuthorization();
  assert.equal(
    db.prepare("SELECT access_authorized_at FROM customers WHERE id = 'bad-legacy-zero'").get().access_authorized_at,
    null,
  );
  assert.deepEqual(
    db.prepare("SELECT stock, warehouse_stock FROM products WHERE id = 'stock-guard-product'").get(),
    { stock: 37, warehouse_stock: 19 },
  );
  assert.deepEqual(
    db.prepare("SELECT stock, warehouse_stock FROM product_variants WHERE id = 'stock-guard-variant'").get(),
    { stock: 23, warehouse_stock: 11 },
  );
  console.log('referral-migration.test.js: ok');
} finally {
  db.close();
  fs.rmSync(file, { force: true });
}
