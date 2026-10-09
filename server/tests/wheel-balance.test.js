import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "navalivay-wheel-balance-"));
const tempDbPath = path.join(tempDir, "test.db");

process.env.DATABASE_FILE = tempDbPath;
process.env.BOT_TOKEN = "test-bot-token";
process.env.NODE_ENV = "test";

const { initDb, db } = await import("../db.js");
const { accrueWheelSpinsForOrder, updateRarityRule, updateWheelSettings } = await import(
  "../wheel/wheel-service.js"
);

initDb();

function ensureCustomer(id) {
  db.prepare(
    `INSERT OR IGNORE INTO customers (id, telegram_id, telegram_username, first_name, last_name, last_visit_at)
     VALUES (?, ?, ?, 'Test', 'User', DATETIME('now'))`,
  ).run(id, id, `bal_${id}`);
}

function clearWheelData() {
  db.exec(`
    DELETE FROM wheel_spins;
    DELETE FROM wheel_epic_pools;
    DELETE FROM wheel_rarity_pools;
    DELETE FROM wheel_customer_balances;
    DELETE FROM orders;
  `);
}

function makeDelivered(orderId, customerId, finalAmount, isWholesale = false) {
  db.prepare(
    `INSERT INTO orders (
      id, order_number, customer_id, status, delivery_type,
      total_amount, final_amount, profit, completed_at, created_at,
      promo_code_text, is_wholesale
    ) VALUES (?, ?, ?, 'delivered', 'pickup', ?, ?, ?, DATETIME('now'), DATETIME('now'), NULL, ?)`,
  ).run(
    orderId,
    orderId,
    customerId,
    finalAmount,
    finalAmount,
    Math.round(finalAmount * 0.3),
    isWholesale ? 1 : 0,
  );
}

function makeOrderWithStatus(orderId, customerId, finalAmount, status) {
  db.prepare(
    `INSERT INTO orders (
      id, order_number, customer_id, status, delivery_type,
      total_amount, final_amount, profit, completed_at, created_at,
      promo_code_text, is_wholesale
    ) VALUES (?, ?, ?, ?, 'pickup', ?, ?, ?, DATETIME('now'), DATETIME('now'), NULL, 0)`,
  ).run(
    orderId,
    orderId,
    customerId,
    status,
    finalAmount,
    finalAmount,
    Math.round(finalAmount * 0.3),
  );
}

function getBalance(customerId) {
  return db
    .prepare("SELECT * FROM wheel_customer_balances WHERE customer_id = ?")
    .get(customerId);
}

async function testRetailEightyByn() {
  clearWheelData();
  const cid = "cust_retail_80";
  ensureCustomer(cid);
  makeDelivered("ord_80", cid, 80);
  const result = accrueWheelSpinsForOrder("ord_80");
  assert.equal(result.accrued, true);
  assert.equal(result.spins_added, 2);
  const balance = getBalance(cid);
  assert.equal(balance.spins_available, 2);
  assert.equal(Number(balance.accumulated_retail_byn), 0);
}

async function testRetailFiftyByn() {
  clearWheelData();
  const cid = "cust_retail_50";
  ensureCustomer(cid);
  makeDelivered("ord_50", cid, 50);
  const result = accrueWheelSpinsForOrder("ord_50");
  assert.equal(result.accrued, true);
  assert.equal(result.spins_added, 1);
  const balance = getBalance(cid);
  assert.equal(balance.spins_available, 1);
  assert.equal(Number(balance.accumulated_retail_byn), 10);
}

async function testRetailUnderThreshold() {
  clearWheelData();
  const cid = "cust_retail_39";
  ensureCustomer(cid);
  makeDelivered("ord_39", cid, 39);
  const result = accrueWheelSpinsForOrder("ord_39");
  assert.equal(result.accrued, true);
  assert.equal(result.spins_added, 0);
  const balance = getBalance(cid);
  assert.equal(balance.spins_available, 0);
  assert.equal(Number(balance.accumulated_retail_byn), 39);
}

async function testWholesaleAccrual() {
  clearWheelData();
  const cid = "cust_wholesale_250";
  ensureCustomer(cid);
  makeDelivered("ord_250", cid, 250, true);
  const result = accrueWheelSpinsForOrder("ord_250");
  assert.equal(result.accrued, true);
  assert.equal(result.spins_added, 1);
  const balance = getBalance(cid);
  assert.equal(balance.spins_available, 1);
  assert.equal(Number(balance.accumulated_wholesale_byn), 50);
  assert.equal(Number(balance.accumulated_retail_byn), 0);
}

async function testIdempotentAccrual() {
  clearWheelData();
  const cid = "cust_idempotent";
  ensureCustomer(cid);
  makeDelivered("ord_dup", cid, 60);
  accrueWheelSpinsForOrder("ord_dup");
  const second = accrueWheelSpinsForOrder("ord_dup");
  assert.equal(second.accrued, false);
  assert.equal(second.reason, "already_synced");
  const balance = getBalance(cid);
  assert.equal(balance.spins_available, 1);
  assert.equal(Number(balance.accumulated_retail_byn), 20);
}

async function testBeforeReleaseDoesNotAccrue() {
  clearWheelData();
  // Force start_collecting_at into the future.
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  updateWheelSettings({ start_collecting_at: future });

  const cid = "cust_before_release";
  ensureCustomer(cid);
  makeDelivered("ord_history", cid, 200);
  const result = accrueWheelSpinsForOrder("ord_history");
  assert.equal(result.accrued, false);
  assert.equal(result.reason, "before_release");

  // Reset for any later test.
  updateWheelSettings({ start_collecting_at: new Date(0).toISOString() });
}

// B2 regression: prod scenario.
//
// The migration historically wrote start_collecting_at via
// `new Date().toISOString()` (e.g. "2026-05-17T13:21:00.000Z"), while
// `orders.completed_at` / `created_at` are written via SQLite's
// `DATETIME('now')` and look like "2026-05-17 13:21:00". Lexicographically
// any real "2026-..." order timestamp is *less than* the ISO-shaped
// start marker (because " " < "T"), so accrual silently skipped every
// real order on prod. This test reproduces that exact mix and verifies
// the unified normalization works.
async function testIsoSettingMatchesSqliteOrderTimestamp() {
  clearWheelData();
  // Simulate the migration writing an ISO marker.
  db.prepare(
    `INSERT OR REPLACE INTO wheel_settings (key, value, updated_at)
     VALUES ('start_collecting_at', ?, DATETIME('now'))`,
  ).run(new Date(Date.now() - 60 * 60 * 1000).toISOString());

  const cid = "cust_prod_iso";
  ensureCustomer(cid);
  // Order created via DATETIME('now') — same shape that real orders use.
  makeDelivered("ord_prod_iso", cid, 80);

  const result = accrueWheelSpinsForOrder("ord_prod_iso");
  assert.equal(
    result.accrued,
    true,
    `Expected accrual when start_collecting_at is ISO and order is SQLite-format, got ${JSON.stringify(result)}`,
  );
  assert.equal(result.spins_added, 2);

  updateWheelSettings({ start_collecting_at: new Date(0).toISOString() });
}

// B3 regression: balance ledger guarantees no double-credit even when
// the same order is re-processed (recompute-customer, retried PATCH,
// out-of-order delivery hooks).
async function testLedgerIdempotencyAcrossRecompute() {
  clearWheelData();
  const cid = "cust_ledger";
  ensureCustomer(cid);

  makeDelivered("ord_l1", cid, 80);
  makeDelivered("ord_l2", cid, 50);
  makeDelivered("ord_l3", cid, 60);

  // First pass — three orders accrued in sequence.
  accrueWheelSpinsForOrder("ord_l1");
  accrueWheelSpinsForOrder("ord_l2");
  accrueWheelSpinsForOrder("ord_l3");

  const balanceFirstPass = getBalance(cid);

  // Second pass — recompute-customer style. Every order is replayed.
  // After the ledger fix this MUST be a no-op.
  for (const orderId of ["ord_l1", "ord_l2", "ord_l3"]) {
    const second = accrueWheelSpinsForOrder(orderId);
    assert.equal(second.accrued, false, `replay of ${orderId} should be a no-op`);
    assert.equal(second.reason, "already_synced");
  }

  // Third pass to be paranoid.
  for (const orderId of ["ord_l1", "ord_l2", "ord_l3"]) {
    accrueWheelSpinsForOrder(orderId);
  }

  const balanceFinal = getBalance(cid);
  assert.equal(balanceFinal.spins_available, balanceFirstPass.spins_available);
  assert.equal(
    Number(balanceFinal.accumulated_retail_byn),
    Number(balanceFirstPass.accumulated_retail_byn),
  );

  const ledgerCount = db
    .prepare("SELECT COUNT(*) AS c FROM wheel_balance_ledger WHERE customer_id = ?")
    .get(cid).c;
  assert.equal(ledgerCount, 3, "ledger keeps exactly one row per order");
}

async function testNonDeliveredOrderDoesNotAccrueOrEnterValuableQueue() {
  clearWheelData();
  updateRarityRule("valuable", { valuable_pool_size: 2, valuable_threshold_byn: 100 });
  const cid = "cust_pending_order";
  ensureCustomer(cid);
  makeOrderWithStatus("ord_pending", cid, 500, "completed");

  const result = accrueWheelSpinsForOrder("ord_pending");
  assert.equal(result.accrued, false);
  assert.equal(result.reason, "status_not_final");

  const balance = getBalance(cid);
  assert.equal(balance, undefined, "non-delivered order must not create wheel balance");
  const pool = db
    .prepare("SELECT * FROM wheel_rarity_pools WHERE rarity_code = 'valuable' AND is_active = 1")
    .get();
  assert.equal(pool, undefined, "non-delivered order must not enter valuable queue");
}

async function testDeliveredOrderBelowValuableThresholdAccruesSpinButNotQueue() {
  clearWheelData();
  updateWheelSettings({ spin_byn_retail: 40, start_collecting_at: new Date(0).toISOString() });
  updateRarityRule("valuable", { valuable_pool_size: 2, valuable_threshold_byn: 300 });
  const cid = "cust_low_valuable_profit";
  ensureCustomer(cid);
  makeDelivered("ord_low_valuable_profit", cid, 80);

  const result = accrueWheelSpinsForOrder("ord_low_valuable_profit");
  assert.equal(result.accrued, true);
  assert.equal(result.spins_added, 2);

  const pool = db
    .prepare("SELECT * FROM wheel_rarity_pools WHERE rarity_code = 'valuable' AND is_active = 1")
    .get();
  assert.ok(pool, "valuable pool can exist after accrual check");
  assert.deepEqual(
    JSON.parse(pool.qualified_customers_json),
    [],
    "customer below valuable threshold must not be queued",
  );
}

async function testValuableQueueDoesNotDuplicateCustomerAcrossOrderReplays() {
  clearWheelData();
  updateWheelSettings({ spin_byn_retail: 40, start_collecting_at: new Date(0).toISOString() });
  updateRarityRule("valuable", { valuable_pool_size: 3, valuable_threshold_byn: 100 });
  const cid = "cust_queue_dedupe";
  ensureCustomer(cid);
  makeDelivered("ord_queue_dedupe", cid, 400);

  accrueWheelSpinsForOrder("ord_queue_dedupe");
  accrueWheelSpinsForOrder("ord_queue_dedupe");
  accrueWheelSpinsForOrder("ord_queue_dedupe");

  const pool = db
    .prepare("SELECT * FROM wheel_rarity_pools WHERE rarity_code = 'valuable' AND is_active = 1")
    .get();
  assert.ok(pool);
  assert.deepEqual(
    JSON.parse(pool.qualified_customers_json),
    [cid],
    "same customer/order replay must appear in valuable queue once",
  );
}

async function main() {
  updateWheelSettings({
    spin_byn_retail: 40,
    spin_byn_wholesale: 200,
    pity_threshold: 3,
    default_promo_validity_days: 90,
    feed_size: 30,
    elite_rarities: ["epic", "mythic", "gold", "legendary"],
    start_collecting_at: new Date(0).toISOString(),
  });
  await testRetailEightyByn();
  await testRetailFiftyByn();
  await testRetailUnderThreshold();
  await testWholesaleAccrual();
  await testIdempotentAccrual();
  await testBeforeReleaseDoesNotAccrue();
  await testIsoSettingMatchesSqliteOrderTimestamp();
  await testLedgerIdempotencyAcrossRecompute();
  await testNonDeliveredOrderDoesNotAccrueOrEnterValuableQueue();
  await testDeliveredOrderBelowValuableThresholdAccruesSpinButNotQueue();
  await testValuableQueueDoesNotDuplicateCustomerAcrossOrderReplays();
  console.log("[wheel-balance] OK");
}

try {
  await main();
} finally {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
