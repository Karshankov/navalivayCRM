/**
 * Auto-notify retry queue + worker.
 * Запуск: node server/tests/auto-notify-retry.test.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TMP_DB = path.resolve(__dirname, `./.tmp-auto-notify-retry-${Date.now()}.db`);
process.env.DATABASE_FILE = TMP_DB;
process.env.BOT_TOKEN = 'test-token-1234567890';

const { db, initDb } = await import('../db.js');
initDb();

const {
  computeRetryDelayMs,
  scheduleAutoNotifyRetry,
  processPendingAutoNotifyRetries,
  hasAutoNotifyBeenSent,
  RETRY_MAX_ATTEMPTS,
  RETRY_TTL_MS,
} = await import('../utils/auto-notify-retry.js');

const { executeAutoNotify } = await import('../utils/auto-notify.js');
const { _resetHealthCacheForTests } = await import('../utils/userbot-client.js');
const {
  registerBusinessConnection,
  upsertStatusTemplate,
} = await import('../utils/business-bot.js');

const results = { passed: 0, failed: 0 };
function assertEq(actual, expected, msg) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    results.passed++;
    console.log(`  OK: ${msg}`);
  } else {
    results.failed++;
    console.log(`  FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function assert(cond, msg) {
  assertEq(Boolean(cond), true, msg);
}

function resetDb() {
  db.exec(`DELETE FROM pending_notifications;`);
  db.exec(`DELETE FROM bot_message_log;`);
  db.exec(`DELETE FROM business_connections;`);
  db.exec(`DELETE FROM customers;`);
  db.exec(`DELETE FROM order_items;`);
  db.exec(`DELETE FROM orders;`);
  upsertStatusTemplate('order_assembled', {
    title: 'Заказ собран',
    body: 'Заказ {order_number} собран.',
    is_active: 1,
  });
}

function makeOrder({ telegramId = '111', orderId = 'o_test' } = {}) {
  const customerId = 'c_test';
  db.prepare(
    `INSERT INTO customers (id, telegram_id, telegram_username, first_name, total_orders, bot_verified_at)
     VALUES (?, ?, ?, ?, 1, DATETIME('now'))`,
  ).run(customerId, telegramId, 'tester', 'Тест');
  db.prepare(
    `INSERT INTO orders (id, order_number, customer_id, status, total_amount)
     VALUES (?, ?, ?, 'delivered', 50)`,
  ).run('o_hist', 9000, customerId);
  db.prepare(
    `INSERT INTO orders (id, order_number, customer_id, status, total_amount)
     VALUES (?, ?, ?, 'in_progress', 100)`,
  ).run(orderId, 1001, customerId);
  db.prepare(
    `INSERT INTO order_pickup_cell_assignments (id, order_id, cell_number)
     VALUES (?, ?, 1)`,
  ).run(`cell_${orderId}`, orderId);
  registerBusinessConnection({
    id: 'conn1',
    userId: '999',
    userChatId: '999',
    username: 'manager',
    isEnabled: 1,
    canReply: 1,
  });
  return { orderId, customerId };
}

function mockFetchUserbot({ healthOk = true, sendOk = true } = {}) {
  return async (url, init) => {
    const u = String(url);
    if (u.includes('/health')) {
      if (!healthOk) {
        return { ok: false, status: 503, async json() { return {}; } };
      }
      return { ok: true, async json() { return { ok: true, connected: true }; } };
    }
    if (u.includes('/send-message')) {
      if (!sendOk) {
        return {
          ok: true,
          status: 503,
          async json() { return { ok: false, error: 'disconnected' }; },
        };
      }
      return { ok: true, status: 200, async json() { return { ok: true, telegram_message_id: 42 }; } };
    }
    throw new Error(`unexpected fetch ${u}`);
  };
}

console.log('\n=== R1: computeRetryDelayMs jitter ===');
{
  const delay = computeRetryDelayMs(0, { rng: () => 0 });
  assertEq(delay, 24_000, 'attempt 0 with rng=0 → 30s * 0.8');
  const delay2 = computeRetryDelayMs(1, { rng: () => 1 });
  assertEq(delay2, 72_000, 'attempt 1 with rng=1 → 60s * 1.2');
}

console.log('\n=== R2: scheduleAutoNotifyRetry inserts pending row ===');
resetDb();
{
  const schedule = scheduleAutoNotifyRetry({
    orderId: 'o1',
    event: 'order_assembled',
    reason: 'userbot_unavailable',
    rng: () => 0.5,
  });
  assertEq(schedule.scheduled, true, 'scheduled=true');
  const row = db
    .prepare(`SELECT * FROM pending_notifications WHERE order_id = 'o1'`)
    .get();
  assertEq(row.status, 'pending', 'status=pending');
  assertEq(row.attempt, 0, 'attempt=0');
}

console.log('\n=== R3: executeAutoNotify schedules retry when userbot down ===');
resetDb();
makeOrder();
_resetHealthCacheForTests();
const origFetch = globalThis.fetch;
globalThis.fetch = mockFetchUserbot({ healthOk: false });
try {
  const result = await executeAutoNotify({ orderId: 'o_test', event: 'order_assembled' });
  assertEq(result.pending, true, 'pending=true');
  assertEq(result.reason, 'retry_scheduled', 'reason=retry_scheduled');
  const pending = db.prepare(`SELECT COUNT(*) AS n FROM pending_notifications`).get().n;
  assertEq(pending, 1, 'one pending row');
  const log = JSON.parse(
    db.prepare(`SELECT meta FROM bot_message_log ORDER BY id DESC LIMIT 1`).get().meta,
  );
  assertEq(log.outcome, 'retry_scheduled', 'log outcome=retry_scheduled');
} finally {
  globalThis.fetch = origFetch;
  _resetHealthCacheForTests();
}

console.log('\n=== R4: worker sends when userbot recovers ===');
resetDb();
makeOrder({ telegramId: '222' });
_resetHealthCacheForTests();
const fixedNow = new Date('2026-06-22T10:00:00Z');
db.prepare(
  `INSERT INTO pending_notifications
    (order_id, template_event, reason, attempt, max_attempts, next_retry_at, status,
     created_at, updated_at, pickup_cell_assignment_id, pickup_cell_number)
   VALUES (?, ?, 'userbot_unavailable', 0, ?, ?, 'pending', ?, ?, 'cell_o_test', 1)`,
).run(
  'o_test',
  'order_assembled',
  RETRY_MAX_ATTEMPTS,
  '2026-06-22 09:59:00',
  '2026-06-22 09:58:00',
  '2026-06-22 09:58:00',
);
globalThis.fetch = mockFetchUserbot({ healthOk: true, sendOk: true });
try {
  const summary = await processPendingAutoNotifyRetries({
    now: fixedNow,
    executeAutoNotify,
  });
  assertEq(summary.sent, 1, 'worker sent=1');
  const row = db
    .prepare(`SELECT status FROM pending_notifications WHERE order_id = 'o_test'`)
    .get();
  assertEq(row.status, 'sent', 'pending marked sent');
} finally {
  globalThis.fetch = origFetch;
  _resetHealthCacheForTests();
}

console.log('\n=== R5: idempotency — skip if already sent ===');
resetDb();
makeOrder({ telegramId: '333', orderId: 'o_sent' });
db.prepare(
  `INSERT INTO bot_message_log (chat_id, direction, message_type, template_kind, template_event, meta)
   VALUES ('333', 'out', 'status', 'status', 'order_assembled', ?)`,
).run(JSON.stringify({
  order_id: 'o_sent',
  outcome: 'sent',
  auto: 1,
  pickup_cell_assignment_id: 'cell_o_sent',
}));
assert(hasAutoNotifyBeenSent('o_sent', 'order_assembled'), 'hasAutoNotifyBeenSent');
const summary = await processPendingAutoNotifyRetries({ executeAutoNotify });
assertEq(summary.processed, 0, 'no due rows');

console.log('\n=== R6: enrich pending_retry from pending_notifications ===');
resetDb();
const enrichOrder = makeOrder({ telegramId: '444', orderId: 'o_retry' });
db.prepare(
  `INSERT INTO pending_notifications
    (order_id, template_event, reason, attempt, max_attempts, next_retry_at, status)
   VALUES (?, 'order_assembled', 'userbot_unavailable', 1, ?, '2026-06-22 11:00:00', 'pending')`,
).run(enrichOrder.orderId, RETRY_MAX_ATTEMPTS);
const { enrichOrdersWithRelations } = await import('../utils/crm-order-enrichment.js');
const orderRow = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(enrichOrder.orderId);
const enriched = enrichOrdersWithRelations(db, [orderRow]);
assertEq(enriched[0]?.auto_notification?.status, 'pending_retry', 'status=pending_retry');
assert(
  enriched[0]?.auto_notification?.error?.includes('очереди'),
  'friendly pending message',
);

console.log('\n=== R7: expired after TTL ===');
resetDb();
{
  const createdAt = new Date(Date.now() - RETRY_TTL_MS - 60_000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);
  const schedule = scheduleAutoNotifyRetry({
    orderId: 'o_old',
    event: 'order_assembled',
    reason: 'userbot_unavailable',
    rng: () => 0.5,
  });
  assertEq(schedule.scheduled, true, 'initial schedule ok');
  db.prepare(`UPDATE pending_notifications SET created_at = ? WHERE order_id = 'o_old'`).run(
    createdAt,
  );
  const again = scheduleAutoNotifyRetry({
    orderId: 'o_old',
    event: 'order_assembled',
    reason: 'userbot_unavailable',
  });
  assertEq(again.expired, true, 'expired after TTL');
  const row = db.prepare(`SELECT status FROM pending_notifications WHERE order_id = 'o_old'`).get();
  assertEq(row.status, 'expired', 'status=expired');
}

console.log(`\n=== Total: ${results.passed} passed, ${results.failed} failed ===`);

try { db.close(); } catch {}
for (const p of [TMP_DB, `${TMP_DB}-shm`, `${TMP_DB}-wal`]) {
  try { fs.unlinkSync(p); } catch {}
}

if (results.failed > 0) {
  process.exitCode = 1;
}
