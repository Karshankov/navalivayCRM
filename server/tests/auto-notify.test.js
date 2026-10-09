/**
 * Auto-notify util — авто-отправка статусных уведомлений при смене статуса
 * заказа. Покрывает все skip-причины (reactivate, no telegram_id, не верифицирован,
 * шаблон выключен, шаблон с пустым телом, нет коннекта) и happy path
 * (через mock global.fetch).
 *
 * Запуск: node server/tests/auto-notify.test.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TMP_DB = path.resolve(__dirname, `./.tmp-auto-notify-${Date.now()}.db`);
process.env.DATABASE_FILE = TMP_DB;
process.env.BOT_TOKEN = 'test-token-1234567890';

const { db, initDb } = await import('../db.js');
initDb();

const {
  registerBusinessConnection,
  upsertStatusTemplate,
} = await import('../utils/business-bot.js');

const { autoNotifyForStatusChange, STATUS_TO_EVENT } = await import('../utils/auto-notify.js');
const { _resetHealthCacheForTests } = await import('../utils/userbot-client.js');

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
  // Шаблоны статусов восстанавливаем дефолтные (миграция при initDb их кладёт).
  upsertStatusTemplate('order_assembled', {
    title: 'Заказ собран',
    body: 'Заказ {order_number} собран. {customer_name}, можно забирать.',
    is_active: 1,
  });
  upsertStatusTemplate('order_issued', {
    title: 'Заказ выдан',
    body: 'Заказ {order_number} выдан. Спасибо за покупку!',
    is_active: 1,
  });
  upsertStatusTemplate('order_cancelled', {
    title: 'Заказ отменён',
    body: 'Заказ {order_number} отменён.',
    is_active: 1,
  });
  upsertStatusTemplate('order_accepted', {
    title: 'Заказ принят',
    body: 'Заказ {order_number} принят.',
    is_active: 1,
  });
}

function makeOrderAndCustomer({ telegramId = '111', verified = true, totalOrders = 1 } = {}) {
  const customerId = 'c_test';
  db.prepare(
    `INSERT INTO customers (id, telegram_id, telegram_username, first_name, total_orders)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(customerId, telegramId, 'tester', 'Тест', totalOrders);
  if (verified) {
    db.prepare(`UPDATE customers SET bot_verified_at = DATETIME('now') WHERE id = ?`).run(customerId);
  }
  for (let i = 0; i < totalOrders; i += 1) {
    db.prepare(
      `INSERT INTO orders (id, order_number, customer_id, status, total_amount)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(`o_hist_${i}`, 9000 + i, customerId, 'delivered', 50);
  }
  const orderId = 'o_test';
  db.prepare(
    `INSERT INTO orders (id, order_number, customer_id, status, total_amount)
       VALUES (?, ?, ?, ?, ?)`,
  ).run(orderId, 1001, customerId, 'in_progress', 100);
  db.prepare(
    `INSERT INTO order_pickup_cell_assignments (id, order_id, cell_number)
     VALUES ('cell_o_test', ?, 1)`,
  ).run(orderId);
  return { orderId, customerId };
}

function registerConnection() {
  registerBusinessConnection({
    id: 'conn1',
    userId: '999',
    userChatId: '999',
    username: 'manager',
    isEnabled: 1,
    canReply: 1,
  });
}

// --- TEST 1: STATUS_TO_EVENT mapping ----------------------------------------
console.log('\n=== Test 1: STATUS_TO_EVENT mapping ===');
assertEq(STATUS_TO_EVENT.in_progress, 'order_assembled', 'in_progress → order_assembled');
assertEq(STATUS_TO_EVENT.completed, 'order_issued', 'completed → order_issued');
assertEq(STATUS_TO_EVENT.delivered, 'order_issued', 'delivered → order_issued');
assertEq(STATUS_TO_EVENT.cancelled, 'order_cancelled', 'cancelled → order_cancelled');
assertEq(STATUS_TO_EVENT.new, undefined, 'new → no event (молчим при создании)');

// --- TEST 2: reactivate → skipped -------------------------------------------
console.log('\n=== Test 2: reactivate=true → пропускаем ===');
resetDb();
makeOrderAndCustomer();
registerConnection();
{
  const result = await autoNotifyForStatusChange({
    orderId: 'o_test',
    newStatus: 'in_progress',
    previousStatus: 'cancelled',
    reactivate: true,
  });
  assertEq(result.sent, false, 'sent=false при реактивации');
  assertEq(result.skipped, true, 'skipped=true');
  assertEq(result.reason, 'reactivation_skipped', 'reason=reactivation_skipped');
}

// --- TEST 3: status_unchanged → skipped -------------------------------------
console.log('\n=== Test 3: previousStatus === newStatus → skip ===');
{
  const result = await autoNotifyForStatusChange({
    orderId: 'o_test',
    newStatus: 'in_progress',
    previousStatus: 'in_progress',
  });
  assertEq(result.skipped, true, 'skipped=true');
  assertEq(result.reason, 'status_unchanged', 'reason=status_unchanged');
}

// --- TEST 4: новый статус без event (например new) --------------------------
console.log('\n=== Test 4: статус без mapping (new) → skip ===');
{
  const result = await autoNotifyForStatusChange({
    orderId: 'o_test',
    newStatus: 'new',
    previousStatus: 'in_progress',
  });
  assertEq(result.reason, 'no_event_for_status', 'reason=no_event_for_status');
}

// --- TEST 5: customer без telegram_id ---------------------------------------
console.log('\n=== Test 5: клиент без telegram_id → skip ===');
resetDb();
{
  db.prepare(
    `INSERT INTO customers (id, first_name, total_orders, bot_verified_at)
     VALUES (?, ?, ?, DATETIME('now'))`,
  ).run('c_no_tg', 'Без TG', 1);
  db.prepare(
    `INSERT INTO orders (id, order_number, customer_id, status)
     VALUES (?, ?, ?, ?)`,
  ).run('o_no_tg', 2002, 'c_no_tg', 'in_progress');
  db.prepare(
    `INSERT INTO order_pickup_cell_assignments (id, order_id, cell_number)
     VALUES ('cell_o_no_tg', 'o_no_tg', 1)`,
  ).run();
  registerConnection();

  const result = await autoNotifyForStatusChange({
    orderId: 'o_no_tg',
    newStatus: 'in_progress',
    previousStatus: 'new',
  });
  assertEq(result.sent, false, 'sent=false');
  assertEq(result.reason, 'customer_has_no_telegram_id', 'reason=customer_has_no_telegram_id');
}

// --- TEST 6: customer не верифицирован --------------------------------------
console.log('\n=== Test 6: клиент не верифицирован → skip + лог skipped ===');
resetDb();
makeOrderAndCustomer({ telegramId: '222', verified: false, totalOrders: 0 });
registerConnection();
{
  const result = await autoNotifyForStatusChange({
    orderId: 'o_test',
    newStatus: 'in_progress',
    previousStatus: 'new',
  });
  assertEq(result.sent, false, 'sent=false');
  assertEq(result.reason, 'customer_not_verified', 'reason=customer_not_verified');
  // Дима 10.05.2026: «при любых ошибках должна быть рамка». Запись в журнал
  // нужна, чтобы плашка переживала рефреш админки (GET /orders подтягивает
  // последний auto-notify по meta.auto=1).
  const logRows = db.prepare(`SELECT meta FROM bot_message_log ORDER BY id DESC LIMIT 1`).all();
  assertEq(logRows.length, 1, 'запись skipped попала в bot_message_log');
  const meta = JSON.parse(logRows[0].meta || '{}');
  assertEq(meta.outcome, 'skipped', 'meta.outcome=skipped');
  assertEq(meta.reason, 'customer_not_verified', 'meta.reason=customer_not_verified');
  assertEq(meta.auto, true, 'meta.auto=true (auto-notify, не manual)');
}

// --- TEST 7: шаблон выключен ------------------------------------------------
console.log('\n=== Test 7: шаблон события is_active=0 → skip ===');
resetDb();
makeOrderAndCustomer({ telegramId: '333', verified: true });
registerConnection();
upsertStatusTemplate('order_assembled', {
  title: 'Заказ собран',
  body: 'Заказ {order_number} собран.',
  is_active: 0,
});
{
  const result = await autoNotifyForStatusChange({
    orderId: 'o_test',
    newStatus: 'in_progress',
    previousStatus: 'new',
  });
  assertEq(result.reason, 'template_inactive_or_missing', 'reason=template_inactive_or_missing');
}

// --- TEST 8: userbot недоступен → retry_scheduled + pending row ------------
console.log('\n=== Test 8: userbot недоступен → retry_scheduled ===');
resetDb();
makeOrderAndCustomer({ telegramId: '444', verified: true });
_resetHealthCacheForTests();
const originalFetch8 = globalThis.fetch;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('127.0.0.1') && u.includes('/health')) {
    return { ok: false, status: 503, async json() { return {}; } };
  }
  throw new Error(`unexpected fetch ${u}`);
};
try {
  const result = await autoNotifyForStatusChange({
    orderId: 'o_test',
    newStatus: 'in_progress',
    previousStatus: 'new',
  });
  assertEq(result.sent, false, 'sent=false');
  assertEq(result.pending, true, 'pending=true');
  assertEq(result.reason, 'retry_scheduled', 'reason=retry_scheduled');
  const pendingCount = db.prepare(`SELECT COUNT(*) AS n FROM pending_notifications`).get().n;
  assertEq(pendingCount, 1, 'pending_notifications row created');
  const logRows = db.prepare(`SELECT meta FROM bot_message_log ORDER BY id DESC LIMIT 1`).all();
  assertEq(logRows.length, 1, 'запись retry попала в bot_message_log');
  const meta = JSON.parse(logRows[0].meta || '{}');
  assertEq(meta.outcome, 'retry_scheduled', 'meta.outcome=retry_scheduled');
  assertEq(meta.reason, 'userbot_unavailable', 'meta.reason=userbot_unavailable');
  assertEq(meta.auto, true, 'meta.auto=true');
} finally {
  globalThis.fetch = originalFetch8;
  _resetHealthCacheForTests();
}

// --- TEST 9: happy path через userbot --------------------------------------
console.log('\n=== Test 9: userbot ответил ok=true → sent=true, via=userbot ===');
resetDb();
makeOrderAndCustomer({ telegramId: '555', verified: true });
_resetHealthCacheForTests();

const originalFetch = globalThis.fetch;
let userbotSendBody9 = null;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('127.0.0.1') && u.includes('/health')) {
    return { ok: true, async json() { return { ok: true, connected: true }; } };
  }
  if (u.includes('127.0.0.1') && u.includes('/send-message')) {
    userbotSendBody9 = JSON.parse(init.body);
    return { ok: true, status: 200, async json() { return { ok: true, telegram_message_id: 4242 }; } };
  }
  throw new Error(`unexpected fetch ${u}`);
};
try {
  const result = await autoNotifyForStatusChange({
    orderId: 'o_test',
    newStatus: 'in_progress',
    previousStatus: 'new',
  });
  assertEq(result.sent, true, 'sent=true');
  assertEq(result.via, 'userbot', 'via=userbot');
  assertEq(result.event, 'order_assembled', 'event=order_assembled');
  assertEq(result.telegram_message_id, 4242, 'telegram_message_id из ответа userbot');
  assertEq(userbotSendBody9.chat_id, '555', 'chat_id = telegram_id клиента');
  assertEq(userbotSendBody9.auto, true, 'auto=true в payload userbot');
  assertEq(userbotSendBody9.parse_mode, 'html', 'статус отправляется в HTML-режиме');
  assertEq(userbotSendBody9.username, 'tester', 'username прокинут (для resolveUsername fallback)');
  assert(
    userbotSendBody9.text.toLowerCase().includes('заказ №1') &&
      !userbotSendBody9.text.includes('1001') &&
      !/ячейк/i.test(userbotSendBody9.text),
    'текст содержит только короткий клиентский номер',
  );
} finally {
  globalThis.fetch = originalFetch;
  _resetHealthCacheForTests();
}

// --- TEST 10: userbot rejected (Telegram отверг) → sent=false --------------
console.log('\n=== Test 10: userbot rejected → sent=false с reason ===');
resetDb();
makeOrderAndCustomer({ telegramId: '666', verified: true });
db.prepare(`UPDATE orders SET status = 'cancelled' WHERE id = 'o_test'`).run();
db.prepare(`UPDATE order_pickup_cell_assignments SET released_at = DATETIME('now') WHERE order_id = 'o_test'`).run();
_resetHealthCacheForTests();

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('127.0.0.1') && u.includes('/health')) {
    return { ok: true, async json() { return { ok: true, connected: true }; } };
  }
  if (u.includes('127.0.0.1') && u.includes('/send-message')) {
    // userbot жив, но Telegram отверг (PEER_ID_INVALID и т.п.) — userbot-client
    // классифицирует как rejected. Без fallback'а на business mode auto-notify
    // возвращает sent=false с reason=описание ошибки.
    return {
      ok: true,
      status: 200,
      async json() {
        return { ok: false, error: 'PEER_ID_INVALID' };
      },
    };
  }
  throw new Error(`unexpected fetch ${u}`);
};
try {
  const result = await autoNotifyForStatusChange({
    orderId: 'o_test',
    newStatus: 'cancelled',
    previousStatus: 'in_progress',
  });
  assertEq(result.sent, false, 'sent=false');
  assertEq(result.event, 'order_cancelled', 'event=order_cancelled');
  assertEq(result.via, 'userbot', 'via=userbot');
  assert(
    result.reason && /PEER_ID_INVALID/.test(result.reason),
    'reason содержит описание ошибки от userbot',
  );
  const failedLog = db.prepare(
    `SELECT meta FROM bot_message_log
      WHERE template_event = 'order_cancelled'
      ORDER BY id DESC LIMIT 1`,
  ).get();
  const failedMeta = JSON.parse(failedLog?.meta || '{}');
  assertEq(failedMeta.outcome, 'failed', 'окончательный отказ записан как failed');
} finally {
  globalThis.fetch = originalFetch;
  _resetHealthCacheForTests();
}

// --- TEST 11: completed → order_issued -------------------------------------
console.log('\n=== Test 11: completed → шаблон order_issued ===');
resetDb();
makeOrderAndCustomer({ telegramId: '777', verified: true });
db.prepare(`UPDATE orders SET status = 'completed' WHERE id = 'o_test'`).run();
db.prepare(`UPDATE order_pickup_cell_assignments SET released_at = DATETIME('now') WHERE order_id = 'o_test'`).run();
_resetHealthCacheForTests();

let userbotSendBody11 = null;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('127.0.0.1') && u.includes('/health')) {
    return { ok: true, async json() { return { ok: true, connected: true }; } };
  }
  if (u.includes('127.0.0.1') && u.includes('/send-message')) {
    userbotSendBody11 = JSON.parse(init.body);
    return { ok: true, status: 200, async json() { return { ok: true, telegram_message_id: 99 }; } };
  }
  throw new Error(`unexpected fetch ${u}`);
};
try {
  const result = await autoNotifyForStatusChange({
    orderId: 'o_test',
    newStatus: 'completed',
    previousStatus: 'in_progress',
  });
  assertEq(result.sent, true, 'sent=true');
  assertEq(result.event, 'order_issued', 'event=order_issued (а не completed)');
  assert(
    userbotSendBody11.text.toLowerCase().includes('выдан') ||
      userbotSendBody11.text.toLowerCase().includes('спасибо'),
    'текст соответствует шаблону order_issued',
  );
} finally {
  globalThis.fetch = originalFetch;
  _resetHealthCacheForTests();
}

// --- TEST 12: шаблон с пустым body → template_empty ------------------------
console.log('\n=== Test 12: шаблон активен, но body пустой → skip ===');
resetDb();
makeOrderAndCustomer({ telegramId: '888', verified: true });
upsertStatusTemplate('order_assembled', {
  title: 'Заказ собран',
  body: '   ',
  is_active: 1,
});
_resetHealthCacheForTests();
{
  const result = await autoNotifyForStatusChange({
    orderId: 'o_test',
    newStatus: 'in_progress',
    previousStatus: 'new',
  });
  assertEq(result.sent, false, 'sent=false');
  assertEq(result.reason, 'template_empty', 'reason=template_empty');
  // Лог не должен записываться, если до отправки не дошло —
  // prepareStatusNotification возвращает не-ok ДО объявления safeLog.
  const logCount = db.prepare(`SELECT COUNT(*) AS n FROM bot_message_log`).get().n;
  assertEq(logCount, 0, 'bot_message_log пустой при skip до отправки');
}

// --- TEST 13: userbot ambiguous → НЕТ повтора (защита от дубля) ------------
console.log('\n=== Test 13: userbot timeout → ambiguous, лог ambiguous ===');
resetDb();
makeOrderAndCustomer({ telegramId: '13131', verified: true });
_resetHealthCacheForTests();

let userbotHits13 = 0;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('127.0.0.1') && u.includes('/health')) {
    return { ok: true, async json() { return { ok: true, connected: true }; } };
  }
  if (u.includes('127.0.0.1') && u.includes('/send-message')) {
    userbotHits13++;
    const err = new Error('The operation was aborted due to timeout');
    err.name = 'TimeoutError';
    throw err;
  }
  throw new Error(`unexpected fetch ${u}`);
};
try {
  const result = await autoNotifyForStatusChange({
    orderId: 'o_test',
    newStatus: 'in_progress',
    previousStatus: 'new',
  });
  assertEq(result.sent, false, 'sent=false');
  assertEq(result.reason, 'userbot_ambiguous', 'reason=userbot_ambiguous');
  assertEq(userbotHits13, 1, 'userbot попытка одна (нет повтора, чтобы не было дубля)');
  // safeLog должен записать ambiguous в журнал для аудита.
  const logRows = db.prepare(`SELECT * FROM bot_message_log ORDER BY id DESC LIMIT 1`).all();
  const meta = JSON.parse(logRows[0]?.meta || '{}');
  assertEq(meta.outcome, 'ambiguous', 'meta.outcome=ambiguous');
  assertEq(meta.via, 'userbot', 'meta.via=userbot');
} finally {
  globalThis.fetch = originalFetch;
  _resetHealthCacheForTests();
}

// --- TEST 14: userbot unreachable (ECONNREFUSED) → skip --------------------
console.log('\n=== Test 14: userbot ECONNREFUSED → skip без отправки ===');
resetDb();
makeOrderAndCustomer({ telegramId: '14141', verified: true });
_resetHealthCacheForTests();

let userbotHits14 = 0;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('127.0.0.1') && u.includes('/health')) {
    const err = new TypeError('fetch failed');
    err.cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8083'), {
      code: 'ECONNREFUSED',
    });
    throw err;
  }
  if (u.includes('127.0.0.1') && u.includes('/send-message')) {
    userbotHits14++;
    throw new Error('should not reach send when health is fail');
  }
  throw new Error(`unexpected fetch ${u}`);
};
try {
  const result = await autoNotifyForStatusChange({
    orderId: 'o_test',
    newStatus: 'in_progress',
    previousStatus: 'new',
  });
  assertEq(result.sent, false, 'sent=false');
  assertEq(result.pending, true, 'pending=true');
  assertEq(result.reason, 'retry_scheduled', 'reason=retry_scheduled');
  assertEq(userbotHits14, 0, '/send-message НЕ дёрнулся (health=fail отсёк)');
} finally {
  globalThis.fetch = originalFetch;
  _resetHealthCacheForTests();
}

// --- TEST 15: API фиксирует цикл ячейки для защиты от повторов ---------------
console.log('\n=== Test 15: success log contains assignment cycle ===');
resetDb();
makeOrderAndCustomer({ telegramId: '15151', verified: true });
_resetHealthCacheForTests();

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('127.0.0.1') && u.includes('/health')) {
    return { ok: true, async json() { return { ok: true, connected: true }; } };
  }
  if (u.includes('127.0.0.1') && u.includes('/send-message')) {
    return { ok: true, status: 200, async json() { return { ok: true, telegram_message_id: 15150 }; } };
  }
  throw new Error(`unexpected fetch ${u}`);
};
try {
  const before = db.prepare(`SELECT COUNT(*) AS n FROM bot_message_log`).get().n;
  const result = await autoNotifyForStatusChange({
    orderId: 'o_test',
    newStatus: 'in_progress',
    previousStatus: 'new',
  });
  assertEq(result.sent, true, 'sent=true');
  assertEq(result.via, 'userbot', 'via=userbot');
  const after = db.prepare(`SELECT COUNT(*) AS n FROM bot_message_log`).get().n;
  assertEq(after, before + 1, 'API записал статусный лог с циклом ячейки');
  const log = db.prepare(`SELECT template_event, meta FROM bot_message_log ORDER BY id DESC LIMIT 1`).get();
  const logMeta = JSON.parse(log.meta || '{}');
  assertEq(log.template_event, 'order_assembled', 'лог привязан к шаблону сборки');
  assertEq(logMeta.pickup_cell_assignment_id, 'cell_o_test', 'лог содержит цикл ячейки');
} finally {
  globalThis.fetch = originalFetch;
  _resetHealthCacheForTests();
}

// --- TEST 16: username прокидывается в userbot для resolveUsername ---------
// Костя 10.05.2026: клиенты архивированы у менеджера → не в кэше userbot.
// auto-notify должен прокидывать customer.telegram_username в /send-message,
// чтобы userbot мог ресолвить через @username (contacts.resolveUsername).
console.log('\n=== Test 16: username прокидывается в userbot ===');
resetDb();
makeOrderAndCustomer({ telegramId: '16161', verified: true });
_resetHealthCacheForTests();

let userbotSendBody16 = null;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('127.0.0.1') && u.includes('/health')) {
    return { ok: true, async json() { return { ok: true, connected: true }; } };
  }
  if (u.includes('127.0.0.1') && u.includes('/send-message')) {
    userbotSendBody16 = JSON.parse(init.body);
    return { ok: true, status: 200, async json() { return { ok: true, telegram_message_id: 1 }; } };
  }
  throw new Error(`unexpected fetch ${u}`);
};
try {
  await autoNotifyForStatusChange({
    orderId: 'o_test',
    newStatus: 'in_progress',
    previousStatus: 'new',
  });
  assert(userbotSendBody16, 'userbot был дёрнут');
  // makeOrderAndCustomer ставит telegram_username='tester' — проверим что
  // он прокинут в payload userbot БЕЗ префикса @ (userbot сам его ставит).
  assertEq(userbotSendBody16.username, 'tester', 'username=tester (без @)');
} finally {
  globalThis.fetch = originalFetch;
  _resetHealthCacheForTests();
}

// --- TEST 17: клиент в блоке → skip без отправки ---------------------------
// Pavel 11.05.2026: «бот отписал заблокированному, что заказ отменён».
// Это насмешка — auto-notify должен пропускать клиентов с активным блоком.
console.log('\n=== Test 17: customer заблокирован → skip + лог skipped ===');
resetDb();
makeOrderAndCustomer({ telegramId: '17171', verified: true });
db.prepare(`UPDATE orders SET status = 'cancelled' WHERE id = 'o_test'`).run();
db.prepare(`UPDATE order_pickup_cell_assignments SET released_at = DATETIME('now') WHERE order_id = 'o_test'`).run();
_resetHealthCacheForTests();
// Вставляем активный блок (бессрочный — block_until=NULL).
db.prepare(
  `INSERT INTO customer_blocks (id, customer_id, block_until, reason, active)
   VALUES (?, ?, NULL, ?, 1)`,
).run('blk_test_17', 'c_test', 'test block');

let userbotHits17 = 0;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('127.0.0.1') && u.includes('/health')) {
    return { ok: true, async json() { return { ok: true, connected: true }; } };
  }
  if (u.includes('127.0.0.1') && u.includes('/send-message')) {
    userbotHits17++;
    throw new Error('userbot НЕ должен дёрнуться для заблокированного');
  }
  throw new Error(`unexpected fetch ${u}`);
};
try {
  const result = await autoNotifyForStatusChange({
    orderId: 'o_test',
    newStatus: 'cancelled',
    previousStatus: 'in_progress',
  });
  assertEq(result.sent, false, 'sent=false');
  assertEq(result.skipped, true, 'skipped=true');
  assertEq(result.reason, 'customer_blocked', 'reason=customer_blocked');
  assertEq(userbotHits17, 0, 'userbot НЕ дёрнулся (рано отвалились по блоку)');
  const logRows = db.prepare(`SELECT meta FROM bot_message_log ORDER BY id DESC LIMIT 1`).all();
  const meta = JSON.parse(logRows[0]?.meta || '{}');
  assertEq(meta.outcome, 'skipped', 'meta.outcome=skipped');
  assertEq(meta.reason, 'customer_blocked', 'meta.reason=customer_blocked');
  assertEq(meta.auto, true, 'meta.auto=true');
} finally {
  globalThis.fetch = originalFetch;
  _resetHealthCacheForTests();
}

// --- TEST 18: освобождённую во время подготовки ячейку не отправляем -------
console.log('\n=== Test 18: stale assembled message is cancelled before send ===');
resetDb();
makeOrderAndCustomer({ telegramId: '18181', verified: true });
registerConnection();
_resetHealthCacheForTests();
let userbotHits18 = 0;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/resolve-username')) {
    return { ok: true, async json() { return { ok: true, telegram_id: '18181' }; } };
  }
  if (u.includes('/health')) {
    db.prepare(
      `UPDATE order_pickup_cell_assignments
          SET released_at = DATETIME('now'), release_reason = 'test_race'
        WHERE id = 'cell_o_test'`,
    ).run();
    return { ok: true, async json() { return { ok: true, connected: true }; } };
  }
  if (u.includes('/send-message')) {
    userbotHits18 += 1;
    return { ok: true, status: 200, async json() { return { ok: true }; } };
  }
  throw new Error(`unexpected fetch ${u}`);
};
try {
  const result = await autoNotifyForStatusChange({
    orderId: 'o_test',
    newStatus: 'in_progress',
    previousStatus: 'new',
  });
  assertEq(result.reason, 'pickup_cell_inactive', 'stale assignment is rejected');
  assertEq(userbotHits18, 0, 'stale cell number is not sent');
} finally {
  globalThis.fetch = originalFetch;
  _resetHealthCacheForTests();
}

// --- Final ------------------------------------------------------------------
console.log(`\n=== Total: ${results.passed} passed, ${results.failed} failed ===`);

// Чистим временный sqlite-файл (и -shm/-wal от WAL-режима), чтобы тест
// не оставлял мусор в server/tests/. Каждый unlink в try/catch: если файл
// не успел создаться (тест упал на initDb до записи WAL/SHM), не хотим,
// чтобы ENOENT затёр реальную ошибку из ассертов выше.
try { db.close(); } catch {}
for (const p of [TMP_DB, `${TMP_DB}-shm`, `${TMP_DB}-wal`]) {
  try { fs.unlinkSync(p); } catch {}
}

if (results.failed > 0) {
  process.exitCode = 1;
}
