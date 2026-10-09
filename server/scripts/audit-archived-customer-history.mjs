/**
 * Read-only audit: how many delivered/completed orders are hidden from customer
 * history because archived=1 (CRM kanban flag).
 *
 * Usage:
 *   node server/scripts/audit-archived-customer-history.mjs
 *   node server/scripts/audit-archived-customer-history.mjs --since=2026-06-17
 */
import { initDb, db } from '../db.js';
import {
  findOwnedOrders,
  getCustomerOrderHistoryLaunchIso,
  CUSTOMER_ORDER_HISTORY_LAUNCH,
} from '../utils/product-reviews.js';

const sinceArg = process.argv.find((arg) => arg.startsWith('--since='));
const sinceDate = sinceArg
  ? sinceArg.split('=')[1]
  : `${CUSTOMER_ORDER_HISTORY_LAUNCH.year}-${String(CUSTOMER_ORDER_HISTORY_LAUNCH.month).padStart(2, '0')}-${String(CUSTOMER_ORDER_HISTORY_LAUNCH.day).padStart(2, '0')}`;
const launchIso = getCustomerOrderHistoryLaunchIso();

initDb();

const hiddenRows = db
  .prepare(
    `SELECT
      o.id,
      o.order_number,
      o.status,
      o.archived,
      o.customer_id,
      o.telegram_username,
      o.completed_at,
      o.created_at,
      c.telegram_id,
      c.telegram_username AS customer_username
     FROM orders o
     LEFT JOIN customers c ON c.id = o.customer_id
     WHERE COALESCE(o.archived, 0) = 1
       AND o.status IN ('delivered', 'completed')
       AND REPLACE(REPLACE(COALESCE(o.completed_at, o.updated_at, o.created_at), 'T', ' '), 'Z', '') >= ?
     ORDER BY datetime(COALESCE(o.completed_at, o.created_at)) DESC`,
  )
  .all(launchIso.replace('T', ' ').replace('Z', ''));

const customerImpact = new Map();

for (const row of hiddenRows) {
  const key = row.customer_id || `tg:${row.telegram_username || 'unknown'}`;
  if (!customerImpact.has(key)) {
    customerImpact.set(key, {
      customer_id: row.customer_id,
      telegram_id: row.telegram_id,
      telegram_username: row.customer_username || row.telegram_username,
      hidden_orders: [],
      visible_after_fix: 0,
    });
  }
  customerImpact.get(key).hidden_orders.push(row.order_number);
}

let wouldRecover = 0;
let blockedNoIdentity = 0;

for (const entry of customerImpact.values()) {
  const telegramId = String(entry.telegram_id || '').trim();
  const telegramUsername = entry.telegram_username || '';
  if (!telegramId && !telegramUsername) {
    blockedNoIdentity += entry.hidden_orders.length;
    continue;
  }

  const owned = findOwnedOrders({
    telegramId,
    telegramUsername,
    statuses: ['delivered', 'completed', 'cancelled'],
    limit: 200,
  });
  const ownedNumbers = new Set(owned.map((order) => order.order_number));
  const recovered = entry.hidden_orders.filter((num) => ownedNumbers.has(num));
  entry.visible_after_fix = recovered.length;
  wouldRecover += recovered.length;
}

const samples = [...customerImpact.values()]
  .sort((a, b) => b.hidden_orders.length - a.hidden_orders.length)
  .slice(0, 15)
  .map((entry) => ({
    username: entry.telegram_username,
    telegram_id: entry.telegram_id,
    hidden_count: entry.hidden_orders.length,
    visible_after_fix: entry.visible_after_fix,
    sample_orders: entry.hidden_orders.slice(0, 5),
  }));

console.log(
  JSON.stringify(
    {
      since: sinceDate,
      launch_iso: launchIso,
      hidden_delivered_completed: hiddenRows.length,
      affected_customers: customerImpact.size,
      would_recover_with_fix: wouldRecover,
      blocked_no_telegram_identity: blockedNoIdentity,
      samples,
      checks: {
        maffsim: samples.find((row) => String(row.username).toLowerCase() === 'maffsim') || null,
        quaillll: samples.find((row) => String(row.username).toLowerCase() === 'quaillll') || null,
      },
    },
    null,
    2,
  ),
);

if (wouldRecover !== hiddenRows.length - blockedNoIdentity) {
  console.error(
    `[audit] WARNING: fix would recover ${wouldRecover}/${hiddenRows.length - blockedNoIdentity} identifiable orders`,
  );
  process.exit(1);
}

console.error(`[audit] OK: all ${wouldRecover} identifiable archived orders would appear after fix`);
process.exit(0);