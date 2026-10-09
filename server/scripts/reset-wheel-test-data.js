/**
 * Full wheel test-data reset: prizes, spins, balances, wheel promos.
 * Keeps wheel_rarities / wheel_settings (except start_collecting_at → now).
 * Promos referenced by orders are deactivated, not deleted.
 *
 * Usage:
 *   node server/scripts/reset-wheel-test-data.js
 *   node server/scripts/reset-wheel-test-data.js --keep-balances
 */
import { db } from "../db.js";

const keepBalances = process.argv.includes("--keep-balances");

function count(table) {
  return db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
}

const before = {
  prizes: count("wheel_prizes"),
  spins: count("wheel_spins"),
  audit: count("wheel_spin_audit"),
  balances: count("wheel_customer_balances"),
  ledger: count("wheel_balance_ledger"),
  wheelPromos: db
    .prepare(
      `SELECT COUNT(*) AS c FROM promo_codes
       WHERE is_wheel_template = 1 OR wheel_owner_customer_id IS NOT NULL`,
    )
    .get().c,
};

const tx = db.transaction(() => {
  db.exec("DELETE FROM wheel_spin_audit");
  db.exec("DELETE FROM wheel_spins");
  db.exec("DELETE FROM wheel_epic_pools");
  db.exec("DELETE FROM wheel_rarity_pools");
  db.exec("DELETE FROM wheel_prizes");
  if (!keepBalances) {
    db.exec("DELETE FROM wheel_balance_ledger");
    db.exec("DELETE FROM wheel_customer_balances");
  }

  db.prepare(
    `UPDATE promo_codes
     SET active = 0, is_wheel_template = 0, wheel_owner_customer_id = NULL
     WHERE (is_wheel_template = 1 OR wheel_owner_customer_id IS NOT NULL)
       AND id IN (SELECT promo_code_id FROM orders WHERE promo_code_id IS NOT NULL)`,
  ).run();

  db.prepare(
    `DELETE FROM promo_codes
     WHERE (is_wheel_template = 1 OR wheel_owner_customer_id IS NOT NULL)
       AND id NOT IN (SELECT promo_code_id FROM orders WHERE promo_code_id IS NOT NULL)`,
  ).run();

  db.prepare(
    `UPDATE customers
     SET wheel_feed_consent = 0, wheel_feed_consent_at = NULL
     WHERE wheel_feed_consent != 0 OR wheel_feed_consent_at IS NOT NULL`,
  ).run();

  db.prepare(
    `INSERT INTO wheel_settings (key, value, updated_at)
     VALUES ('start_collecting_at', DATETIME('now'), DATETIME('now'))
     ON CONFLICT(key) DO UPDATE SET value = DATETIME('now'), updated_at = DATETIME('now')`,
  ).run();
});

tx();

const after = {
  prizes: count("wheel_prizes"),
  spins: count("wheel_spins"),
  audit: count("wheel_spin_audit"),
  balances: count("wheel_customer_balances"),
  ledger: count("wheel_balance_ledger"),
  wheelPromos: db
    .prepare(
      `SELECT COUNT(*) AS c FROM promo_codes
       WHERE is_wheel_template = 1 OR wheel_owner_customer_id IS NOT NULL`,
    )
    .get().c,
  deactivatedWheelPromosInOrders: db
    .prepare(
      `SELECT COUNT(*) AS c FROM promo_codes
       WHERE active = 0
         AND id IN (SELECT promo_code_id FROM orders WHERE promo_code_id IS NOT NULL)`,
    )
    .get().c,
  startCollectingAt: db
    .prepare("SELECT value FROM wheel_settings WHERE key = 'start_collecting_at'")
    .get()?.value,
};

console.log(JSON.stringify({ before, after }, null, 2));
