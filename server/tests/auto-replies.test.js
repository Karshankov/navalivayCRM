/**
 * Автоответы клиентам — пауза, блокировщики, данные получателя.
 *
 * Покрывает то, что добавлено к готовому матчеру (сам матчер покрыт в
 * business-bot.test.js и здесь не дублируется):
 *  - getAutoReplyCooldownMinutes / setAutoReplyCooldownMinutes (значение, границы, мусор)
 *  - autoReplyCooldownRemainingMinutes: последним писал клиент / менеджер
 *  - hasRecentAutoReply: журнал переживает перезапуск, окно соблюдается
 *  - handleIncomingBusinessMessage: пауза гасит повтор, поля получателя на месте
 *  - getAutoReplyBlockers: все причины, по которым автоответ не уйдёт
 *
 * Запуск: node server/tests/auto-replies.test.js
 */
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TMP_DB = path.resolve(__dirname, `./.tmp-autoreply-${Date.now()}.db`);
process.env.DATABASE_FILE = TMP_DB;

const { db, initDb } = await import('../db.js');
initDb();
const {
  registerBusinessConnection,
  createQuickReply,
  updateQuickReply,
  isAutoReplyEnabled,
  setAutoReplyEnabled,
  logBotMessage,
  handleIncomingBusinessMessage,
  getAutoReplyCooldownMinutes,
  setAutoReplyCooldownMinutes,
  autoReplyCooldownRemainingMinutes,
  hasRecentAutoReply,
  getAutoReplyBlockers,
  matchQuickReply,
  AUTO_REPLY_COOLDOWN_DEFAULT_MINUTES,
  AUTO_REPLY_COOLDOWN_MAX_MINUTES,
  AUTO_REPLY_MESSAGE_TYPE,
  tryStartAutoReply,
  finishAutoReply,
  listBotLog,
  countAutoReplyHits,
} = await import('../utils/business-bot.js');

const results = { passed: 0, failed: 0 };
function assertEq(actual, expected, msg) {
  if (actual === expected) {
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

const OWNER = '900000001';
const CLIENT = '910000001';

/** Клиент с выданным заказом — проходит гейт isReturningCustomerForQuickReply. */
function seedCustomer(telegramId, { withOrder = true } = {}) {
  db.prepare(
    `INSERT INTO customers (id, telegram_id, telegram_username, total_orders, total_spent, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, DATETIME('now'), DATETIME('now'))`,
  ).run(`cust_${telegramId}`, String(telegramId), `u${telegramId}`, withOrder ? 1 : 0);
  if (withOrder) {
    db.prepare(
      `INSERT INTO orders (customer_id, order_number, status, total_amount, created_at, updated_at)
       VALUES (?, ?, 'delivered', 100, DATETIME('now'), DATETIME('now'))`,
    ).run(`cust_${telegramId}`, Math.floor(Math.random() * 1000000) + 1);
  }
}

function setup() {
  db.exec(`DELETE FROM bot_message_log;`);
  db.exec(`DELETE FROM bot_quick_replies;`);
  db.exec(`DELETE FROM business_connections;`);
  db.exec(`DELETE FROM customer_blocks;`);
  db.exec(`DELETE FROM order_items;`);
  db.exec(`DELETE FROM orders;`);
  db.exec(`DELETE FROM customers;`);
  db.exec(`DELETE FROM settings WHERE key IN ('bot_auto_replies_enabled', 'bot_auto_reply_cooldown_minutes');`);
  setAutoReplyEnabled(false);
}

async function runTests() {
  console.log('=== Setup ===');
  setup();

  // -------------------------------------------------------------------------
  console.log('\n=== Test 1: пауза — значение по умолчанию и границы ===');
  assertEq(
    getAutoReplyCooldownMinutes(),
    AUTO_REPLY_COOLDOWN_DEFAULT_MINUTES,
    `по умолчанию ${AUTO_REPLY_COOLDOWN_DEFAULT_MINUTES} минут`,
  );
  assertEq(setAutoReplyCooldownMinutes(10), 10, 'установили 10 минут');
  assertEq(getAutoReplyCooldownMinutes(), 10, 'прочитали 10 минут');
  assertEq(setAutoReplyCooldownMinutes(0), 0, '0 = пауза выключена');
  assertEq(getAutoReplyCooldownMinutes(), 0, 'прочитали 0');
  assertEq(
    setAutoReplyCooldownMinutes(AUTO_REPLY_COOLDOWN_MAX_MINUTES + 5000),
    AUTO_REPLY_COOLDOWN_MAX_MINUTES,
    'значение выше максимума подрезается',
  );
  assertEq(setAutoReplyCooldownMinutes(7.9), 7, 'дробное округляется вниз');

  let threw = false;
  try {
    setAutoReplyCooldownMinutes('мусор');
  } catch (e) {
    threw = e.code === 'invalid_cooldown';
  }
  assert(threw, 'мусор отклонён с кодом invalid_cooldown');

  threw = false;
  try {
    setAutoReplyCooldownMinutes(-5);
  } catch (e) {
    threw = e.code === 'invalid_cooldown';
  }
  assert(threw, 'отрицательное отклонено');

  setAutoReplyCooldownMinutes(30);

  // -------------------------------------------------------------------------
  console.log('\n=== Test 2: пауза считается от последнего сообщения ===');
  seedCustomer(CLIENT);
  logBotMessage({
    chatId: CLIENT,
    customerId: `cust_${CLIENT}`,
    customerTelegramId: CLIENT,
    direction: 'in',
    messageType: 'incoming',
    text: 'до скольки работаете?',
  });
  const fresh = autoReplyCooldownRemainingMinutes(CLIENT);
  assert(fresh > 29 && fresh <= 30, `свежее входящее → пауза ~30 мин (получено ${fresh})`);

  // Менеджер ответил сам — автоответ не нужен, пауза снимается.
  // `manual` — именно тот тип, которым пишется ответ человека (crm.js).
  logBotMessage({
    chatId: CLIENT,
    customerId: `cust_${CLIENT}`,
    customerTelegramId: CLIENT,
    direction: 'out',
    messageType: 'manual',
    text: 'работаем до 20:00',
  });
  assertEq(
    autoReplyCooldownRemainingMinutes(CLIENT),
    0,
    'менеджер ответил сам → пауза снята, автоответ снова возможен',
  );

  // -------------------------------------------------------------------------
  console.log('\n=== Test 2b: автоматический статус заказа НЕ снимает паузу ===');
  // Регрессия: раньше любое исходящее считалось ответом менеджера, и
  // автоматическое уведомление о заказе (`status`) снимало паузу — клиент
  // получал повторный автоответ на следующее же сообщение.
  setup();
  seedCustomer(CLIENT);
  logBotMessage({
    chatId: CLIENT,
    customerTelegramId: CLIENT,
    direction: 'in',
    messageType: 'incoming',
    text: 'до скольки работаете?',
  });
  logBotMessage({
    chatId: CLIENT,
    customerTelegramId: CLIENT,
    direction: 'out',
    messageType: 'status',
    text: 'Заказ принят',
  });
  const afterStatus = autoReplyCooldownRemainingMinutes(CLIENT);
  assert(afterStatus > 29 && afterStatus <= 30, `статус заказа не снимает паузу (получено ${afterStatus})`);

  // А вот автоответ бота паузу держать не должен своими же отправками —
  // иначе он «съедает» сам себя и на статус заказа реагирует как на ответ.
  logBotMessage({
    chatId: CLIENT,
    customerTelegramId: CLIENT,
    direction: 'out',
    messageType: 'quick_reply',
    text: 'до 20:00',
  });
  const afterOwnReply = autoReplyCooldownRemainingMinutes(CLIENT);
  assert(afterOwnReply > 29 && afterOwnReply <= 30, 'свой автоответ тоже не снимает паузу');

  // -------------------------------------------------------------------------
  console.log('\n=== Test 2c: пауза считается от вопроса клиента, а не от наших отправок ===');
  setup();
  seedCustomer(CLIENT);
  // Клиент спросил 20 минут назад, статус заказа ушёл минуту назад.
  db.prepare(
    `INSERT INTO bot_message_log (chat_id, customer_telegram_id, direction, message_type, text, created_at)
     VALUES (?, ?, 'in', 'incoming', 'график?', DATETIME('now', '-20 minutes'))`,
  ).run(CLIENT, CLIENT);
  db.prepare(
    `INSERT INTO bot_message_log (chat_id, customer_telegram_id, direction, message_type, text, created_at)
     VALUES (?, ?, 'out', 'status', 'Заказ принят', DATETIME('now', '-1 minutes'))`,
  ).run(CLIENT, CLIENT);
  const fromClientMsg = autoReplyCooldownRemainingMinutes(CLIENT);
  assert(
    fromClientMsg > 9 && fromClientMsg <= 10,
    `отсчёт идёт от вопроса клиента (20 мин назад) → осталось ~10, получено ${fromClientMsg}`,
  );

  // Менеджер ответил ДО вопроса клиента — на текущую паузу не влияет.
  setup();
  seedCustomer(CLIENT);
  db.prepare(
    `INSERT INTO bot_message_log (chat_id, customer_telegram_id, direction, message_type, text, created_at)
     VALUES (?, ?, 'out', 'manual', 'здравствуйте', DATETIME('now', '-10 minutes'))`,
  ).run(CLIENT, CLIENT);
  db.prepare(
    `INSERT INTO bot_message_log (chat_id, customer_telegram_id, direction, message_type, text, created_at)
     VALUES (?, ?, 'in', 'incoming', 'график?', DATETIME('now', '-3 minutes'))`,
  ).run(CLIENT, CLIENT);
  const olderReply = autoReplyCooldownRemainingMinutes(CLIENT);
  assert(
    olderReply > 26 && olderReply <= 27,
    `ответ до вопроса не снимает паузу (получено ${olderReply})`,
  );

  // -------------------------------------------------------------------------
  console.log('\n=== Test 2d: клиент не писал — пауза не мешает ===');
  setup();
  seedCustomer(CLIENT);
  assertEq(autoReplyCooldownRemainingMinutes(CLIENT), 0, 'нет входящих → паузы нет');

  // -------------------------------------------------------------------------
  setup();
  setAutoReplyCooldownMinutes(30);
  seedCustomer(CLIENT);
  logBotMessage({
    chatId: CLIENT,
    customerId: `cust_${CLIENT}`,
    customerTelegramId: CLIENT,
    direction: 'in',
    messageType: 'incoming',
    text: 'до скольки работаете?',
  });

  // -------------------------------------------------------------------------
  console.log('\n=== Test 3: пауза 0 отключает ограничение ===');
  setAutoReplyCooldownMinutes(0);
  logBotMessage({
    chatId: CLIENT,
    customerId: `cust_${CLIENT}`,
    customerTelegramId: CLIENT,
    direction: 'in',
    messageType: 'incoming',
    text: 'график?',
  });
  assertEq(autoReplyCooldownRemainingMinutes(CLIENT), 0, 'при паузе 0 остаток всегда 0');
  assertEq(hasRecentAutoReply(CLIENT, 30), false, 'и журнал не блокирует');
  setAutoReplyCooldownMinutes(30);

  // -------------------------------------------------------------------------
  console.log('\n=== Test 4: hasRecentAutoReply — по журналу отправок ===');
  logBotMessage({
    chatId: CLIENT,
    customerId: `cust_${CLIENT}`,
    customerTelegramId: CLIENT,
    direction: 'out',
    messageType: AUTO_REPLY_MESSAGE_TYPE,
    text: 'Работаем ежедневно до 20:00',
    meta: { outcome: 'sent' },
  });
  assertEq(hasRecentAutoReply(CLIENT, 30), true, 'автоответ только что был → блокирует');
  assertEq(hasRecentAutoReply(CLIENT, 0), false, 'окно 0 → не блокирует');
  assertEq(hasRecentAutoReply('999999999', 30), false, 'другой клиент не задет');

  // Старый автоответ вне окна
  db.prepare(
    `UPDATE bot_message_log SET created_at = DATETIME('now', '-90 minutes')
      WHERE message_type = ?`,
  ).run(AUTO_REPLY_MESSAGE_TYPE);
  assertEq(hasRecentAutoReply(CLIENT, 30), false, 'автоответ 90 минут назад вне окна 30 → не блокирует');
  assertEq(hasRecentAutoReply(CLIENT, 120), true, 'тот же автоответ внутри окна 120 → блокирует');

  // -------------------------------------------------------------------------
  console.log('\n=== Test 5: handleIncomingBusinessMessage — пауза гасит повтор ===');
  setup();
  seedCustomer(CLIENT);
  setAutoReplyEnabled(true);
  createQuickReply({
    title: 'График работы',
    keywords: ['график', 'до скольки'],
    response_text: 'Работаем ежедневно с 10:00 до 20:00',
  });
  registerBusinessConnection({
    id: 'bc_auto_1',
    userId: OWNER,
    userChatId: OWNER,
    username: 'manager',
    isEnabled: true,
    canReply: true,
  });

  const first = handleIncomingBusinessMessage({
    businessConnectionId: 'bc_auto_1',
    fromUserId: CLIENT,
    ownerUserId: OWNER,
    text: 'До скольки работаете?',
  });
  assert(first !== null, 'первый автоответ сработал');
  assertEq(first.text, 'Работаем ежедневно с 10:00 до 20:00', 'текст ответа верный');
  assertEq(first.customerTelegramId, CLIENT, 'получатель передан для userbot-канала');
  assertEq(first.customerId, `cust_${CLIENT}`, 'customerId передан');
  assertEq(first.quickReplyTitle, 'График работы', 'название правила передано');

  // Фиксируем факт отправки — ровно так это делает bot.js: свой тип
  // AUTO_REPLY_MESSAGE_TYPE и outcome='sent'.
  logBotMessage({
    chatId: CLIENT,
    customerId: `cust_${CLIENT}`,
    customerTelegramId: CLIENT,
    direction: 'out',
    messageType: AUTO_REPLY_MESSAGE_TYPE,
    text: first.text,
    meta: { outcome: 'sent' },
  });

  const second = handleIncomingBusinessMessage({
    businessConnectionId: 'bc_auto_1',
    fromUserId: CLIENT,
    ownerUserId: OWNER,
    text: 'график?',
  });
  assertEq(second, null, 'второе сообщение подряд в пределах паузы → молчим');

  // -------------------------------------------------------------------------
  console.log('\n=== Test 6: пауза истекла — отвечаем снова ===');
  db.prepare(
    `UPDATE bot_message_log SET created_at = DATETIME('now', '-90 minutes')
      WHERE message_type = ?`,
  ).run(AUTO_REPLY_MESSAGE_TYPE);
  db.prepare(
    `UPDATE bot_message_log SET created_at = DATETIME('now', '-90 minutes')
      WHERE direction = 'in'`,
  ).run();
  const third = handleIncomingBusinessMessage({
    businessConnectionId: 'bc_auto_1',
    fromUserId: CLIENT,
    ownerUserId: OWNER,
    text: 'до скольки вы?',
  });
  assert(third !== null, 'после паузы отвечаем снова');

  // -------------------------------------------------------------------------
  console.log('\n=== Test 7: пауза 0 — отвечаем на каждое сообщение ===');
  setup();
  seedCustomer(CLIENT);
  setAutoReplyEnabled(true);
  setAutoReplyCooldownMinutes(0);
  createQuickReply({
    title: 'График',
    keywords: ['график'],
    response_text: 'до 20:00',
  });
  registerBusinessConnection({
    id: 'bc_auto_2',
    userId: OWNER,
    userChatId: OWNER,
    username: 'manager',
    isEnabled: true,
    canReply: true,
  });
  for (let i = 0; i < 3; i++) {
    logBotMessage({
      chatId: CLIENT,
      customerTelegramId: CLIENT,
      direction: 'out',
      messageType: AUTO_REPLY_MESSAGE_TYPE,
      text: 'до 20:00',
      meta: { outcome: 'sent' },
    });
  }
  const noCooldown = handleIncomingBusinessMessage({
    businessConnectionId: 'bc_auto_2',
    fromUserId: CLIENT,
    ownerUserId: OWNER,
    text: 'график?',
  });
  assert(noCooldown !== null, 'при паузе 0 повторные ответы не блокируются');
  setAutoReplyCooldownMinutes(30);

  // -------------------------------------------------------------------------
  console.log('\n=== Test 8: блокировщики — все причины ===');
  setup();
  let blockers = getAutoReplyBlockers();
  const codes = () => blockers.map((b) => b.code);
  assert(codes().includes('disabled'), 'выключенный тумблер — причина');
  assert(codes().includes('no_rules'), 'нет правил — причина');
  assertEq(blockers.every((b) => b.message && b.hint), true, 'у каждой причины есть текст и подсказка');

  setAutoReplyEnabled(true);
  blockers = getAutoReplyBlockers();
  assert(!codes().includes('disabled'), 'после включения причина «выключено» ушла');
  assert(codes().includes('no_rules'), '«нет правил» осталась');

  createQuickReply({ title: 'График', keywords: ['график'], response_text: 'до 20:00' });
  blockers = getAutoReplyBlockers();
  assert(!codes().includes('no_rules'), 'после добавления правила причина ушла');
  assert(!codes().includes('no_triggers'), 'у правила есть триггеры');

  // -------------------------------------------------------------------------
  console.log('\n=== Test 9: правило без триггеров — отдельная причина ===');
  setup();
  setAutoReplyEnabled(true);
  createQuickReply({ title: 'Пустое', keywords: [], response_text: 'текст' });
  blockers = getAutoReplyBlockers();
  assert(codes().includes('no_triggers'), 'единственное правило без слов → «не заданы триггеры»');

  createQuickReply({ title: 'График', keywords: ['график'], response_text: 'до 20:00' });
  blockers = getAutoReplyBlockers();
  assert(codes().includes('partial_no_triggers'), 'одно из двух без слов → частичная причина');
  assert(!codes().includes('no_triggers'), 'когда есть рабочее правило — «нет триггеров» не показываем');

  // -------------------------------------------------------------------------
  console.log('\n=== Test 10: скрытые правила не считаются рабочими ===');
  setup();
  setAutoReplyEnabled(true);
  const r = createQuickReply({ title: 'График', keywords: ['график'], response_text: 'до 20:00' });
  updateQuickReply(r.id, { title: 'График', keywords: ['график'], response_text: 'до 20:00', is_active: 0 });
  blockers = getAutoReplyBlockers();
  assert(codes().includes('no_rules'), 'все правила скрыты → «нет правил»');
  assert(
    blockers.find((b) => b.code === 'no_rules').message.includes('скрыты'),
    'текст объясняет, что правила есть, но скрыты',
  );

  // -------------------------------------------------------------------------
  console.log('\n=== Test 11: всё настроено — причин нет ===');
  setup();
  setAutoReplyEnabled(true);
  createQuickReply({ title: 'График', keywords: ['график', 'до скольки'], response_text: 'до 20:00' });
  registerBusinessConnection({
    id: 'bc_auto_3',
    userId: OWNER,
    userChatId: OWNER,
    username: 'manager',
    isEnabled: true,
    canReply: true,
  });
  blockers = getAutoReplyBlockers();
  assertEq(blockers.length, 0, 'правила есть, тумблер включён, подключение активно → готово к работе');

  // -------------------------------------------------------------------------
  console.log('\n=== Test 12: заблокированный клиент не получает автоответ ===');
  setup();
  seedCustomer(CLIENT);
  setAutoReplyEnabled(true);
  createQuickReply({ title: 'График', keywords: ['график'], response_text: 'до 20:00' });
  registerBusinessConnection({
    id: 'bc_auto_4',
    userId: OWNER,
    userChatId: OWNER,
    username: 'manager',
    isEnabled: true,
    canReply: true,
  });
  db.prepare(
    `INSERT INTO customer_blocks (id, customer_id, block_type, reason, active, blocked_at)
     VALUES ('block_auto_1', ?, 'delivery', 'тест', 1, DATETIME('now'))`,
  ).run(`cust_${CLIENT}`);
  const blocked = handleIncomingBusinessMessage({
    businessConnectionId: 'bc_auto_4',
    fromUserId: CLIENT,
    ownerUserId: OWNER,
    text: 'график?',
  });
  assertEq(blocked, null, 'заблокированный клиент автоответа не получает');

  // -------------------------------------------------------------------------
  console.log('\n=== Test 13: тумблер выключен — молчим даже с правилами ===');
  setup();
  seedCustomer(CLIENT);
  createQuickReply({ title: 'График', keywords: ['график'], response_text: 'до 20:00' });
  registerBusinessConnection({
    id: 'bc_auto_5',
    userId: OWNER,
    userChatId: OWNER,
    username: 'manager',
    isEnabled: true,
    canReply: true,
  });
  setAutoReplyEnabled(false);
  const off = handleIncomingBusinessMessage({
    businessConnectionId: 'bc_auto_5',
    fromUserId: CLIENT,
    ownerUserId: OWNER,
    text: 'график?',
  });
  assertEq(off, null, 'тумблер выключен → ответа нет');

  setAutoReplyEnabled(true);
  const on = handleIncomingBusinessMessage({
    businessConnectionId: 'bc_auto_5',
    fromUserId: CLIENT,
    ownerUserId: OWNER,
    text: 'график?',
  });
  assert(on !== null, 'тумблер включён → ответ есть (без перезапуска)');

  // -------------------------------------------------------------------------
  console.log('\n=== Test 14: своё сообщение менеджера автоответа не вызывает ===');
  const echo = handleIncomingBusinessMessage({
    businessConnectionId: 'bc_auto_5',
    fromUserId: OWNER,
    ownerUserId: OWNER,
    text: 'график?',
  });
  assertEq(echo, null, 'сообщение владельца аккаунта игнорируется');

  // -------------------------------------------------------------------------
  console.log('\n=== Test 15: клиент без username — автоответ всё равно возможен ===');
  setup();
  setAutoReplyEnabled(true);
  db.prepare(
    `INSERT INTO customers (id, telegram_id, telegram_username, total_orders, total_spent, created_at, updated_at)
     VALUES ('cust_nouser', '920000001', NULL, 1, 0, DATETIME('now'), DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO orders (customer_id, order_number, status, total_amount, created_at, updated_at)
     VALUES ('cust_nouser', 999001, 'delivered', 100, DATETIME('now'), DATETIME('now'))`,
  ).run();
  createQuickReply({ title: 'График', keywords: ['график'], response_text: 'до 20:00' });
  registerBusinessConnection({
    id: 'bc_auto_6',
    userId: OWNER,
    userChatId: OWNER,
    username: 'manager',
    isEnabled: true,
    canReply: true,
  });
  const noUsername = handleIncomingBusinessMessage({
    businessConnectionId: 'bc_auto_6',
    fromUserId: '920000001',
    ownerUserId: OWNER,
    text: 'график?',
  });
  assert(noUsername !== null, 'ответ сформирован');
  assertEq(noUsername.customerUsername, null, 'username отсутствует, но ответ не блокируется');
  assertEq(noUsername.customerTelegramId, '920000001', 'получатель по telegram_id на месте');

  // -------------------------------------------------------------------------
  console.log('\n=== Test 16: /прайс от userbot НЕ включает паузу (регрессия) ===');
  // Найдено на ревью: userbot пишет ручные быстрые ответы (/прайс) под тем же
  // message_type='quick_reply'. Пока автоответы писались тем же типом, клиент,
  // получивший приветствие «/прайс», 30 минут не получал автоответ.
  setup();
  seedCustomer(CLIENT);
  db.prepare(
    `INSERT INTO bot_message_log (chat_id, customer_telegram_id, direction, message_type, text, meta, created_at)
     VALUES (?, ?, 'out', 'quick_reply', '/прайс', ?, DATETIME('now', '-1 minutes'))`,
  ).run(CLIENT, CLIENT, JSON.stringify({ source: 'userbot', outcome: 'sent', auto: true, shortcut: 'прайс' }));
  assertEq(
    hasRecentAutoReply(CLIENT, 30),
    false,
    'приветствие /прайс (чужой тип) не считается автоответом и не включает паузу',
  );

  // А настоящий автоответ — считается.
  db.prepare(
    `INSERT INTO bot_message_log (chat_id, customer_telegram_id, direction, message_type, text, meta, created_at)
     VALUES (?, ?, 'out', ?, 'до 20:00', ?, DATETIME('now', '-1 minutes'))`,
  ).run(CLIENT, CLIENT, AUTO_REPLY_MESSAGE_TYPE, JSON.stringify({ outcome: 'sent' }));
  assertEq(hasRecentAutoReply(CLIENT, 30), true, 'настоящий автоответ паузу включает');

  // -------------------------------------------------------------------------
  console.log('\n=== Test 17: провалившаяся отправка НЕ включает паузу (регрессия) ===');
  // Клиент ответа не получил — бот не должен молчать ещё полчаса.
  setup();
  seedCustomer(CLIENT);
  for (const outcome of ['failed', 'ambiguous']) {
    db.exec('DELETE FROM bot_message_log');
    db.prepare(
      `INSERT INTO bot_message_log (chat_id, customer_telegram_id, direction, message_type, text, meta, created_at)
       VALUES (?, ?, 'out', ?, 'до 20:00', ?, DATETIME('now', '-1 minutes'))`,
    ).run(CLIENT, CLIENT, AUTO_REPLY_MESSAGE_TYPE, JSON.stringify({ outcome }));
    assertEq(
      hasRecentAutoReply(CLIENT, 30),
      false,
      `исход '${outcome}' не включает паузу — можно пробовать снова`,
    );
  }

  // -------------------------------------------------------------------------
  console.log('\n=== Test 18: блокировка от двух сообщений подряд (регрессия) ===');
  // Проверка паузы читает журнал, а запись идёт после отправки (до 20 секунд).
  // Без блокировки два сообщения подряд дали бы два одинаковых автоответа.
  const clientKey = '930000001';
  assertEq(tryStartAutoReply(clientKey), true, 'первый автоответ занимает клиента');
  assertEq(tryStartAutoReply(clientKey), false, 'второе сообщение подряд отклонено — дубля не будет');
  finishAutoReply(clientKey);
  assertEq(tryStartAutoReply(clientKey), true, 'после освобождения клиент снова доступен');
  finishAutoReply(clientKey);

  // Разные клиенты не мешают друг другу.
  assertEq(tryStartAutoReply('930000002'), true, 'второй клиент занимается независимо');
  assertEq(tryStartAutoReply('930000003'), true, 'третий клиент тоже');
  finishAutoReply('930000002');
  finishAutoReply('930000003');

  // Освобождение несуществующего клиента не падает.
  finishAutoReply('930000099');
  assertEq(tryStartAutoReply(''), false, 'пустой id не занимается');
  assertEq(tryStartAutoReply(null), false, 'null не занимается');

  // -------------------------------------------------------------------------
  console.log('\n=== Test 19: фильтр журнала по типу ===');
  setup();
  seedCustomer(CLIENT);
  db.prepare(
    `INSERT INTO bot_message_log (chat_id, customer_telegram_id, direction, message_type, text, created_at)
     VALUES (?, ?, 'out', 'quick_reply', '/прайс', DATETIME('now'))`,
  ).run(CLIENT, CLIENT);
  db.prepare(
    `INSERT INTO bot_message_log (chat_id, customer_telegram_id, direction, message_type, text, created_at)
     VALUES (?, ?, 'out', ?, 'до 20:00', DATETIME('now'))`,
  ).run(CLIENT, CLIENT, AUTO_REPLY_MESSAGE_TYPE);

  const all = listBotLog({ limit: 50 });
  const onlyAuto = listBotLog({ limit: 50, messageType: AUTO_REPLY_MESSAGE_TYPE });
  assertEq(all.length, 2, 'без фильтра видны обе записи');
  assertEq(onlyAuto.length, 1, 'с фильтром — только автоответ');
  assertEq(onlyAuto[0].text, 'до 20:00', 'в выдаче именно автоответ, а не /прайс');

  // Фильтр сочетается с chat_id.
  const byChat = listBotLog({ limit: 50, chatId: CLIENT, messageType: AUTO_REPLY_MESSAGE_TYPE });
  assertEq(byChat.length, 1, 'фильтр по типу работает вместе с фильтром по чату');
  const unknownChat = listBotLog({ limit: 50, chatId: 'нет-такого', messageType: AUTO_REPLY_MESSAGE_TYPE });
  assertEq(unknownChat.length, 0, 'чужой чат ничего не возвращает');

  // -------------------------------------------------------------------------
  console.log('\n=== Test 20: счётчик срабатываний считает по всему журналу ===');
  setup();
  seedCustomer(CLIENT);
  const addHit = (tid, outcome, dir = 'out') =>
    db
      .prepare(
        `INSERT INTO bot_message_log (chat_id, customer_telegram_id, direction, message_type, template_id, text, meta, created_at)
         VALUES (?, ?, ?, ?, ?, 'x', ?, DATETIME('now'))`,
      )
      .run(CLIENT, CLIENT, dir, AUTO_REPLY_MESSAGE_TYPE, tid, JSON.stringify({ outcome }));

  addHit(5, 'sent');
  addHit(5, 'sent');
  addHit(5, 'sent');
  addHit(5, 'failed');
  addHit(5, 'ambiguous');
  addHit(7, 'sent');
  addHit(5, 'sent', 'in'); // входящее — не срабатывание

  const hits = countAutoReplyHits();
  assertEq(hits[5], 3, 'правило 5: три успешные отправки, провалы не считаются');
  assertEq(hits[7], 1, 'правило 7: одна отправка');
  assertEq(hits[0], undefined, 'записи без template_id (ручной /прайс) в счётчик не попадают');

  // Ручной быстрый ответ под чужим типом не должен влиять на счётчик.
  db.prepare(
    `INSERT INTO bot_message_log (chat_id, customer_telegram_id, direction, message_type, template_id, text, created_at)
     VALUES (?, ?, 'out', 'quick_reply', 5, '/прайс', DATETIME('now'))`,
  ).run(CLIENT, CLIENT);
  assertEq(countAutoReplyHits()[5], 3, 'запись типа quick_reply не увеличивает счётчик автоответа');

  // Счётчик не зависит от объёма выборки: 60 записей — больше, чем брала история.
  for (let i = 0; i < 60; i++) addHit(9, 'sent');
  assertEq(countAutoReplyHits()[9], 60, 'счётчик видит все записи, а не последние 50');

  // -------------------------------------------------------------------------
  console.log('\n=== Test 21: граница слова в триггерах (регрессия) ===');
  // Подстрочный поиск ловил «телеграфик» на триггер «график» и «предоставка»
  // на «доставк» — бот отвечал не на тот вопрос.
  setup();
  seedCustomer(CLIENT);
  const kwRule = createQuickReply({
    title: 'График',
    keywords: ['график'],
    response_text: 'до 20:00',
  });
  const deliveryRule = createQuickReply({
    title: 'Доставка',
    keywords: ['доставка'],
    response_text: 'возим',
  });

  // Должно срабатывать: слово целиком, в любой позиции, в любом регистре.
  assertEq(matchQuickReply('график')?.id, kwRule.id, 'слово целиком срабатывает');
  assertEq(matchQuickReply('ГРАФИК')?.id, kwRule.id, 'регистр не важен');
  assertEq(matchQuickReply('график?')?.id, kwRule.id, 'пунктуация не мешает');
  assertEq(matchQuickReply('до скольки график')?.id, kwRule.id, 'слово в середине фразы');
  assertEq(matchQuickReply('график работы')?.id, kwRule.id, 'слово в начале фразы');
  assertEq(matchQuickReply('доставка')?.id, deliveryRule.id, 'второе правило тоже работает');

  // НЕ должно срабатывать: слово лишь часть другого слова.
  assertEq(matchQuickReply('телеграфик'), null, '«телеграфик» не считается за «график»');
  assertEq(matchQuickReply('подграфик'), null, '«подграфик» не считается');
  assertEq(matchQuickReply('предоставка'), null, '«предоставка» не считается за «доставка»');
  assertEq(matchQuickReply('а сколько стоит?'), null, 'посторонний вопрос — молчим');

  // -------------------------------------------------------------------------
  console.log('\n=== Test 22: выключенное правило не отвечает (регрессия) ===');
  // Заявленный баг «выключенное правило всё равно отвечает» не подтвердился,
  // но проверка должна жить в тестах, а не в чужом отчёте.
  setup();
  seedCustomer(CLIENT);
  const offRule = createQuickReply({
    title: 'Доставка',
    keywords: ['доставка'],
    response_text: 'возим',
  });
  assertEq(matchQuickReply('доставка')?.id, offRule.id, 'включённое правило срабатывает');

  db.prepare('UPDATE bot_quick_replies SET is_active = 0 WHERE id = ?').run(offRule.id);
  assertEq(matchQuickReply('доставка'), null, 'выключенное правило не срабатывает');
  assertEq(
    matchQuickReply('предоплата за доставку'),
    null,
    'выключенное правило не срабатывает и на фразу с этим словом',
  );

  // Полный путь через обработчик — то, что реально вызывается из bot.js.
  const handled = handleIncomingBusinessMessage({
    businessConnectionId: 'bc_test',
    fromUserId: CLIENT,
    ownerUserId: '999999',
    text: 'доставка',
  });
  assertEq(handled, null, 'обработчик молчит при выключенном правиле');

  // Включаем обратно — снова отвечает.
  db.prepare('UPDATE bot_quick_replies SET is_active = 1 WHERE id = ?').run(offRule.id);
  assertEq(matchQuickReply('доставка')?.id, offRule.id, 'после включения правило снова работает');

  console.log(`\n=== Total: ${results.passed} passed, ${results.failed} failed ===`);
  try {
    db.close();
    const fs = await import('fs');
    fs.rmSync(TMP_DB, { force: true });
  } catch {}
  if (results.failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
