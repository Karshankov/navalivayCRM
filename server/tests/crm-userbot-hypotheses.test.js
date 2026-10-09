/**
 * Гипотезы из переписки (с привязкой к коду) и юнит-тесты чистой логики.
 *
 * H1. Счётчик «сообщений с клиентом» маленький или 0, потому что это COUNT
 *     по `bot_message_log`, а не полная история Telegram. Плюс туда попадают
 *     только события после включения логирования (userbot/index.js NewMessage,
 *     исходящие userbot / business-bot). См. crm-operations.js (агрегация) и
 *     server/utils/client-messages-count.js.
 *
 * H2. После «Написать клиенту» пропадают авто-уведомления: возможна гонка
 *     с rate-limit userbot (MAX_SENDS_PER_SECOND=1), кэш isUserbotAvailable,
 *     или entity-кэш GramJS после ручной отправки (см. комментарии в
 *     userbot/index.js про prefetch и «второй auto-notify заработал»).
 *     Здесь нет отдельного интеграционного теста без живого MTProto.
 *
 * H3. CRM-блок не резал ручной канал: `/bot/send-custom` не вызывал
 *     getActiveBlockForCustomerId, в отличие от auto-notify.js (шаг 2a).
 *     Фикс: gateSendCustomTelegramForCrmBlock в crm-telegram-outbound.js +
 *     проверка в routes/crm.js до sendViaUserbot.
 *
 * H4. «Отмена после блокировки не приходит» совпадает с намеренным skip
 *     customer_blocked в auto-notify.js (строки ~143-151): отмена идёт тем
 *     же путём, что и «собрано», блок рубит оба. Это не баг рассылки, а
 *     продуктовое правило (тест auto-notify.test.js Test 17).
 *
 * H5. Непоследовательность «отмена всем / собрано только при чате»:
 *     prepareStatusNotification не проверяет диалог; отказ «нет entity»
 *     случается уже в userbot при sendMessage (userbot/index.js цепочка
 *     entity-miss). Разница шаблонов/статусов в одном auto-notify.
 *
 * H6. resolveUsername как 4-й fallback в userbot (добавлен 13.05.2026):
 *     если entity не найден ни в кэше GramJS, ни в userbot_entities,
 *     ни через prefetch — и caller передал username + verified=true —
 *     userbot дёргает contacts.resolveUsername. Это закрывает ситуацию
 *     «диалог есть у менеджера в Telegram, но вне топа 1500 диалогов»
 *     (Диана, Valeria, старые клиенты). Без verified=true резолв не
 *     делается — защита от холодных рассылок случайным username.
 *
 * Запуск: node server/tests/crm-userbot-hypotheses.test.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TMP_DB = path.resolve(__dirname, `./.tmp-crm-userbot-hyp-${Date.now()}.db`);
process.env.DATABASE_FILE = TMP_DB;
process.env.BOT_TOKEN = 'test-token-1234567890';

const { db, initDb } = await import('../db.js');
initDb();

const {
  buildChatMessageCountMap,
  buildTopMessageCountMap,
  pickClientMessagesCount,
} = await import('../utils/client-messages-count.js');
const { gateSendCustomTelegramForCrmBlock } = await import('../utils/crm-telegram-outbound.js');

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

console.log('\n=== Счётчик: buildChatMessageCountMap нормализует chat_id в строки ===');
{
  const m = buildChatMessageCountMap([
    { chat_id: 12345, n: 7 },
    { chat_id: '999', n: 2 },
  ]);
  assertEq(m.get('12345'), 7, 'числовой id → строковый ключ');
  assertEq(m.get('999'), 2, 'строковый id');
}

console.log('\n=== Счётчик: pickClientMessagesCount как в списке заказов ===');
{
  const m = buildChatMessageCountMap([{ chat_id: '555', n: 4 }]);
  assertEq(pickClientMessagesCount('555', m), 4, 'есть логи');
  assertEq(pickClientMessagesCount('404', m), 0, 'нет логов → 0 (не вся история TG)');
  assertEq(pickClientMessagesCount(null, m), 0, 'null telegram');
  assertEq(pickClientMessagesCount('', m), 0, 'пустой telegram');
  assertEq(pickClientMessagesCount(555, m), 4, 'telegram как number из SQL');
}

console.log('\n=== CRM-блок: ручная отправка запрещена (gate) ===');
{
  db.exec(`DELETE FROM customer_blocks;`);
  db.exec(`DELETE FROM customers;`);
  db.prepare(
    `INSERT INTO customers (id, telegram_id, telegram_username, first_name, total_orders, bot_verified_at)
     VALUES ('c_blk', '90001', 'blocked_u', 'Блок', 1, DATETIME('now'))`,
  ).run();
  assertEq(gateSendCustomTelegramForCrmBlock('c_blk').ok, true, 'без блока → ok');

  db.prepare(
    `INSERT INTO customer_blocks (id, customer_id, block_until, reason, active)
     VALUES ('blk_hyp', 'c_blk', NULL, 'spam', 1)`,
  ).run();
  const g = gateSendCustomTelegramForCrmBlock('c_blk');
  assertEq(g.ok, false, 'активный блок → не ok');
  assertEq(g.error, 'customer_blocked', 'код ошибки');
}

console.log('\n=== CRM-блок: пустой customerId не блокирует (guard no-op) ===');
{
  assertEq(gateSendCustomTelegramForCrmBlock(null).ok, true, 'null id');
  assertEq(gateSendCustomTelegramForCrmBlock('').ok, true, 'пустая строка');
}

console.log('\n=== H6: клиент с username, но без диалога → resolveUsername доступен ===');
{
  // Проверяем что sendViaUserbot прокидывает username и verified в HTTP-тело
  // (userbot/index.js прочитает их и запустит 4-й fallback resolveUsername).
  // Юнит-тест ниже: мокаем fetch на уровне userbot-client.js и смотрим тело.
  // Это гарантирует, что контракт auto-notify.js → userbot сохраняется.
  const { _resetHealthCacheForTests: resetH, sendViaUserbot: svu } = await import('../utils/userbot-client.js');
  resetH();

  const originalFetch = globalThis.fetch;
  let capturedBody = null;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('/health')) {
      return { ok: true, status: 200, async json() { return { ok: true, connected: true }; } };
    }
    if (u.includes('/send-message')) {
      capturedBody = JSON.parse(init.body);
      return { ok: true, status: 200, async json() { return { ok: true, telegram_message_id: 1 }; } };
    }
    throw new Error(`unexpected fetch ${u}`);
  };
  try {
    const r = await svu({
      chatId: '12345',
      text: 'тест',
      username: 'valeria_client',
      verified: true,
      auto: true,
    });
    assertEq(r.ok, true, 'отправка ok');
    assertEq(capturedBody?.username, 'valeria_client', 'username в теле (без @)');
    assertEq(capturedBody?.verified, true, 'verified=true в теле');
    assertEq(capturedBody?.auto, true, 'auto=true в теле');

    // Без verified — username всё равно прокидывается (caller решение),
    // но userbot НЕ сделает resolveUsername.
    capturedBody = null;
    await svu({ chatId: '67890', text: 'x', username: 'rando', verified: false });
    assertEq(capturedBody?.username, 'rando', 'username прокинут даже без verified');
    assertEq(capturedBody?.verified, false, 'verified=false');
  } finally {
    globalThis.fetch = originalFetch;
    resetH();
  }
}

console.log('\n=== H7: buildTopMessageCountMap и GREATEST с userbot_entities ===');
{
  db.exec(`DELETE FROM userbot_entities;`);
  db.prepare(
    `INSERT INTO userbot_entities (telegram_id, access_hash, source, initial_message_count, exact_message_count)
     VALUES ('u1', 'hash1', 'test', 10, 44)`,
  ).run();
  db.prepare(
    `INSERT INTO userbot_entities (telegram_id, access_hash, source, initial_message_count, exact_message_count)
     VALUES ('u2', 'hash2', 'test', 5, NULL)`,
  ).run();
  db.prepare(
    `INSERT INTO userbot_entities (telegram_id, access_hash, source, initial_message_count, exact_message_count)
     VALUES ('u3', 'hash3', 'test', NULL, NULL)`,
  ).run();

  const m = buildTopMessageCountMap(db, ['u1', 'u2', 'u3', 'u404']);
  assertEq(m.get('u1'), 44, 'есть exact → берём exact (44)');
  assertEq(m.has('u2'), false, 'нет exact → initial игнорируется (это ID, не счётчик)');
  assertEq(m.has('u3'), false, 'оба NULL → нет записи в map');
  assertEq(m.has('u404'), false, 'нет в entities → нет записи');
}

console.log('\n=== H7: pickClientMessagesCount с GREATEST ===');
{
  const bml = buildChatMessageCountMap([
    { chat_id: 'c1', n: 3 },
    { chat_id: 'c2', n: 8 },
    { chat_id: 'c3', n: 2 },
  ]);
  const top = new Map([
    ['c1', 10],
    ['c2', 5],
  ]);
  assertEq(pickClientMessagesCount('c1', bml, top), 10, 'top(10) > log(3) → 10');
  assertEq(pickClientMessagesCount('c2', bml, top), 8, 'log(8) > top(5) → 8');
  assertEq(pickClientMessagesCount('c3', bml, top), 2, 'нет top → только log(2)');
  assertEq(pickClientMessagesCount('c4', bml, top), 0, 'нет данных → 0');
  assertEq(pickClientMessagesCount(null, bml, top), 0, 'null telegram → 0');
}

console.log('\n=== H8: is_returning_customer — проверка на постоянного клиента ===');
{
  // Очищаем таблицы
  db.exec(`DELETE FROM orders;`);
  db.exec(`DELETE FROM customers;`);

  // Создаём клиента
  db.prepare(`INSERT INTO customers (id, telegram_id, first_name) VALUES ('c_ret', '111', 'Постоянный')`).run();

  // Создаём 2 завершённых старых заказа + 1 текущий
  db.prepare(`INSERT INTO orders (id, order_number, customer_id, status, created_at) VALUES ('old1', 1, 'c_ret', 'delivered', '2025-01-01')`).run();
  db.prepare(`INSERT INTO orders (id, order_number, customer_id, status, created_at) VALUES ('old2', 2, 'c_ret', 'delivered', '2025-02-01')`).run();
  db.prepare(`INSERT INTO orders (id, order_number, customer_id, status, created_at) VALUES ('cur', 3, 'c_ret', 'new', '2025-03-01')`).run();

  // Проверяем запрос
  const returningRows = db.prepare(`
    SELECT customer_id, COUNT(*) as prior
    FROM orders
    WHERE customer_id IN ('c_ret')
      AND status = 'delivered'
      AND id NOT IN ('cur')
    GROUP BY customer_id
  `).all();

  assertEq(returningRows.length, 1, 'два delivered старых заказа найдены');
  assertEq(returningRows[0].prior, 2, 'prior = 2');
  assertEq(returningRows[0].prior > 0, true, 'клиент постоянный');

  // Без старых заказов
  const emptyRows = db.prepare(`
    SELECT customer_id, COUNT(*) as prior
    FROM orders
    WHERE customer_id IN ('c_ret')
      AND status = 'delivered'
      AND id NOT IN ('old1', 'old2', 'cur')
    GROUP BY customer_id
  `).all();

  assertEq(emptyRows.length, 0, 'без старых заказов — 0 строк');
}

console.log('\n=== H9: is_blocked — проверка активного блока клиента ===');
{
  db.exec(`DELETE FROM customer_blocks;`);

  // Активный перманентный блок
  db.prepare(`INSERT INTO customer_blocks (id, customer_id, block_until, reason, active) VALUES ('blk1', 'c_ret', NULL, 'spam', 1)`).run();

  const blockedRows = db.prepare(`
    SELECT customer_id, 1 as blocked
    FROM customer_blocks
    WHERE customer_id IN ('c_ret')
      AND active = 1
      AND (block_until IS NULL OR block_until > DATETIME('now'))
    GROUP BY customer_id
  `).all();

  assertEq(blockedRows.length, 1, 'активный перманентный блок найден');
  assertEq(blockedRows[0].blocked, 1, 'клиент заблокирован');

  // Неактивный блок — не должен находиться
  db.prepare(`UPDATE customer_blocks SET active = 0 WHERE id = 'blk1'`).run();
  const emptyAfter = db.prepare(`SELECT customer_id FROM customer_blocks WHERE customer_id IN ('c_ret') AND active = 1 AND (block_until IS NULL OR block_until > DATETIME('now'))`).all();
  assertEq(emptyAfter.length, 0, 'неактивный блок не найден');
}

console.log('\n=== H11: block notify message format ===');
{
  const { formatBlockNotifyMessage } = await import('../utils/block-notify-message.js');
  assertEq(
    formatBlockNotifyMessage('не забрал заказ'),
    'не забрал заказ',
    'reason sent as-is without system wrapper',
  );
  assertEq(formatBlockNotifyMessage(''), 'Ваш аккаунт заблокирован.', 'empty reason fallback');
  assertEq(formatBlockNotifyMessage(null), 'Ваш аккаунт заблокирован.', 'null reason fallback');
}

console.log('\n=== H10: block_reason_templates CRUD ===');
{
  // GET empty
  const row = db.prepare("SELECT value FROM settings WHERE key = 'block_reason_templates'").get();
  assertEq(row, undefined, 'нет записей до первого PUT');

  // PUT
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('block_reason_templates', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(JSON.stringify(['флуд', 'спам']));

  const saved = JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'block_reason_templates'").get().value);
  assertEq(saved.length, 2, '2 шаблона сохранены');
  assertEq(saved[0], 'флуд', 'первый шаблон флуд');
  assertEq(saved[1], 'спам', 'второй шаблон спам');
}

console.log(`\n=== Total: ${results.passed} passed, ${results.failed} failed ===`);

try {
  db.close();
} catch {}
for (const p of [TMP_DB, `${TMP_DB}-shm`, `${TMP_DB}-wal`]) {
  try {
    fs.unlinkSync(p);
  } catch {}
}

if (results.failed > 0) {
  process.exitCode = 1;
}
