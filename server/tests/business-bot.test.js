/**
 * Business-bot util — smoke tests.
 *
 * Покрывает:
 *  - Connection lifecycle (register/active/remove)
 *  - Quick replies CRUD + matchQuickReply (точное / substring / case-insensitive / диакритика / ё→е)
 *  - Status templates upsert (фиксированный set events) + renderTemplate с подстановкой
 *  - Verification: generateVerificationCode формат, attach + confirm, isCustomerVerified
 *  - Master switch isAutoReplyEnabled / setAutoReplyEnabled
 *  - Лог: log + list с фильтром chat_id
 *  - prepareStatusNotification: ok/various reasons
 *  - handleIncomingBusinessMessage: master off → null, owner echo → null, match → reply
 *  - handleIncomingBusinessMessage: новый клиент → null, постоянный → reply
 *
 * Запуск: node server/tests/business-bot.test.js
 */
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { HTMLParser } from 'telegram/extensions/html.js';
import { convertLegacyTelegramMarkup } from '../utils/telegram-message-format.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TMP_DB = path.resolve(__dirname, `./.tmp-bot-${Date.now()}.db`);
process.env.DATABASE_FILE = TMP_DB;

const { db, initDb } = await import('../db.js');
initDb();
const {
  BOT_STATUS_EVENTS,
  registerBusinessConnection,
  removeBusinessConnection,
  getActiveBusinessConnection,
  listBusinessConnections,
  listQuickReplies,
  createQuickReply,
  updateQuickReply,
  deleteQuickReply,
  matchQuickReply,
  listStatusTemplates,
  getStatusTemplate,
  upsertStatusTemplate,
  renderTemplate,
  normalizeCustomerOrderTerminology,
  buildOrderVariables,
  generateVerificationCode,
  attachVerificationCode,
  confirmVerificationOnAccess,
  isCustomerVerified,
  isAutoReplyEnabled,
  setAutoReplyEnabled,
  logBotMessage,
  listBotLog,
  getRecentLogCount,
  prepareStatusNotification,
  handleIncomingBusinessMessage,
  isReturningCustomerForQuickReply,
  normalizeForMatch,
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

function setup() {
  db.exec(`DELETE FROM bot_message_log;`);
  db.exec(`DELETE FROM bot_quick_replies;`);
  db.exec(`DELETE FROM business_connections;`);
  db.exec(`UPDATE bot_status_templates SET body = '' WHERE 0;`); // dummy — не трём дефолты
  db.exec(`DELETE FROM customers;`);
  db.exec(`DELETE FROM order_items;`);
  db.exec(`DELETE FROM orders;`);
  setAutoReplyEnabled(false);
}

async function runTests() {
  console.log('=== Setup ===');
  setup();

  console.log('\n=== Test 1: BOT_STATUS_EVENTS — известный набор ===');
  assertEq(BOT_STATUS_EVENTS.includes('order_accepted'), true, 'order_accepted присутствует');
  assertEq(BOT_STATUS_EVENTS.includes('order_assembled'), true, 'order_assembled присутствует');
  assertEq(BOT_STATUS_EVENTS.includes('order_issued'), true, 'order_issued присутствует');
  assertEq(BOT_STATUS_EVENTS.includes('price_list'), true, 'price_list присутствует');

  console.log('\n=== Test 2: business connection register/active/remove ===');
  const conn1 = registerBusinessConnection({
    id: 'bc_test_1',
    userId: '123456789',
    userChatId: '123456789',
    username: 'manager',
    isEnabled: true,
    canReply: true,
  });
  assertEq(conn1.id, 'bc_test_1', 'id сохранён');
  assertEq(conn1.is_enabled, 1, 'is_enabled=1');
  assertEq(conn1.can_reply, 1, 'can_reply=1');
  const active = getActiveBusinessConnection();
  assertEq(active?.id, 'bc_test_1', 'getActiveBusinessConnection возвращает активный');
  removeBusinessConnection('bc_test_1');
  const noActive = getActiveBusinessConnection();
  assertEq(noActive, null, 'после remove активного нет');
  const all = listBusinessConnections();
  assertEq(all.length, 1, 'но запись осталась в истории');
  assertEq(all[0].is_enabled, 0, 'is_enabled=0 после remove');

  console.log('\n=== Test 3: повторная регистрация поднимает disconnected_at в null ===');
  const conn2 = registerBusinessConnection({
    id: 'bc_test_1',
    userId: '123456789',
    isEnabled: true,
    canReply: true,
  });
  assertEq(conn2.disconnected_at, null, 'disconnected_at сброшен');
  assertEq(conn2.is_enabled, 1, 'is_enabled=1');

  console.log('\n=== Test 4: registerBusinessConnection без id → throw ===');
  let threw = false;
  try {
    registerBusinessConnection({ userId: '1' });
  } catch (err) {
    threw = err.code === 'connection_id_required';
  }
  assertEq(threw, true, 'throw connection_id_required');

  console.log('\n=== Test 5: Quick replies CRUD + сортировка ===');
  const qr1 = createQuickReply({
    title: 'Часы работы',
    keywords: ['работаете', 'часы', 'до скольки'],
    response_text: 'Работаем с 12:00 до 23:00',
    sort_order: 10,
  });
  const qr2 = createQuickReply({
    title: 'Как заказать',
    keywords: ['как заказать', 'оформить'],
    response_text: 'Откройте каталог в кнопке меню',
    sort_order: 20,
  });
  const qr3 = createQuickReply({
    title: 'Доставка',
    keywords: ['доставк', 'привезёт'],
    response_text: 'Доставка по городу 5 BYN',
    sort_order: 5,
    is_active: 0,
  });
  const list = listQuickReplies();
  assertEq(list.length, 3, '3 записи');
  assertEq(list[0].id, qr3.id, 'sort_order=5 первый');
  const activeOnly = listQuickReplies({ activeOnly: true });
  assertEq(activeOnly.length, 2, 'активных 2');
  assertEq(activeOnly.find((r) => r.id === qr3.id), undefined, 'неактивный отфильтрован');

  console.log('\n=== Test 6: матчинг — точное слово ===');
  const matchExact = matchQuickReply('А вы работаете в выходные?');
  assertEq(matchExact?.id, qr1.id, 'нашёл по слову "работаете"');

  console.log('\n=== Test 7: матчинг — substring ===');
  const matchSubstring = matchQuickReply('как заказать товар?');
  assertEq(matchSubstring?.id, qr2.id, 'нашёл по фразе "как заказать"');

  console.log('\n=== Test 8: матчинг — case-insensitive ===');
  const matchCase = matchQuickReply('ЧАСЫ работы какие?');
  assertEq(matchCase?.id, qr1.id, 'регистр не важен');

  console.log('\n=== Test 9: матчинг — ё → е ===');
  const matchYo = matchQuickReply('кто привезёт мой заказ?');
  assertEq(matchYo, null, 'неактивный qr3 не матчится даже по ключевому');
  // активируем qr3
  updateQuickReply(qr3.id, { is_active: 1 });
  const matchYo2 = matchQuickReply('кто привезёт мой заказ?');
  assertEq(matchYo2?.id, qr3.id, 'после активации qr3 матчится');

  console.log('\n=== Test 10: матчинг — нет совпадения ===');
  const matchNone = matchQuickReply('абракадабра ничего общего');
  assertEq(matchNone, null, 'пустой текст или несовпадение → null');

  console.log('\n=== Test 11: createQuickReply без title → throw ===');
  threw = false;
  try {
    createQuickReply({ title: '   ', response_text: 'x', keywords: [] });
  } catch (err) {
    threw = err.code === 'title_required';
  }
  assertEq(threw, true, 'title_required');

  console.log('\n=== Test 12: createQuickReply без response → throw ===');
  threw = false;
  try {
    createQuickReply({ title: 'OK', response_text: '', keywords: [] });
  } catch (err) {
    threw = err.code === 'response_required';
  }
  assertEq(threw, true, 'response_required');

  console.log('\n=== Test 13: deleteQuickReply ===');
  const removed = deleteQuickReply(qr3.id);
  assertEq(removed, 1, 'удалил 1');
  assertEq(deleteQuickReply(99999), 0, 'несуществующий → 0');

  console.log('\n=== Test 14: status templates — дефолты есть ===');
  const allTemplates = listStatusTemplates();
  assertEq(allTemplates.length >= 5, true, 'дефолтных шаблонов как минимум 5');
  const orderAssembled = getStatusTemplate('order_assembled');
  assert(orderAssembled, 'order_assembled существует');
  assertEq(orderAssembled.is_active, 1, 'order_assembled активен');

  console.log('\n=== Test 15: upsertStatusTemplate ===');
  const updated = upsertStatusTemplate('order_assembled', {
    title: 'Test Title',
    body: 'Hello {customer_name}, заказ {order_number}',
    is_active: 1,
  });
  assertEq(updated.title, 'Test Title', 'title обновлён');
  assertEq(updated.body.includes('{customer_name}'), true, 'body сохранён');

  console.log('\n=== Test 16: upsertStatusTemplate с невалидным event → throw ===');
  threw = false;
  try {
    upsertStatusTemplate('bogus_event', { body: 'x' });
  } catch (err) {
    threw = err.code === 'invalid_event';
  }
  assertEq(threw, true, 'invalid_event');

  console.log('\n=== Test 17: renderTemplate — подстановка переменных ===');
  const rendered = renderTemplate('Hi {name}, sum={sum} unknown={x}', {
    name: 'Иван',
    sum: 100,
  });
  assertEq(
    rendered,
    'Hi Иван, sum=100 unknown={x}',
    'подставил name+sum, оставил неизвестное как есть',
  );
  const renderedNull = renderTemplate('{a}-{b}', { a: 'x', b: null });
  assertEq(renderedNull, 'x-', 'null трактуется как пустая строка');
  const renderedHtml = renderTemplate(
    '<b>{name}</b>',
    { name: `Иван <VIP> & "Ко" '` },
    { escapeValues: true },
  );
  assertEq(
    renderedHtml,
    '<b>Иван &lt;VIP&gt; &amp; &quot;Ко&quot; &#39;</b>',
    'HTML-теги шаблона сохранены, а значение переменной экранировано',
  );
  assertEq(
    convertLegacyTelegramMarkup('**Заказ {order_number}\nсобран**\nОбычный текст'),
    '<b>Заказ {order_number}\nсобран</b>\nОбычный текст',
    'многострочный жирный текст из старого шаблона переведён в HTML',
  );
  assertEq(
    normalizeCustomerOrderTerminology('Ячейка 7 готова'),
    'Заказ №7 готов',
    'название и род согласованы',
  );
  assertEq(
    normalizeCustomerOrderTerminology('Заказ #7 / Заказ №8'),
    'Заказ №7 / Заказ №8',
    'решётка приводится к единому виду со знаком номера',
  );
  assertEq(
    normalizeCustomerOrderTerminology('ЯЧЕЙКА 9 ЗАНЯТА'),
    'ЗАКАЗ №9 ЗАНЯТ',
    'верхний регистр сохранён',
  );
  assertEq(
    normalizeCustomerOrderTerminology('Ваша ячейка №7 готова'),
    'Ваш заказ №7 готов',
    '«Ваша ячейка» превращается в «Ваш заказ»',
  );
  assertEq(
    normalizeCustomerOrderTerminology('Номер вашей ячейки: 7'),
    'Номер вашего заказа №7',
    'родительный падеж согласован',
  );
  assertEq(
    normalizeCustomerOrderTerminology('Эта ячейка свободна. Положите в нашу ячейку.'),
    'Этот заказ свободен. Положите в наш заказ.',
    'указательное и притяжательное слова согласованы',
  );
  assertEq(
    normalizeCustomerOrderTerminology('Новая ячейка назначена. Номер последней ячейки.'),
    'Новый заказ назначен. Номер последнего заказа.',
    'типовые прилагательные рядом с названием согласованы',
  );
  assertEq(
    normalizeCustomerOrderTerminology('Номер ячейки: 2. Ячейка: 3.'),
    'Номер заказа №2. Заказ №3.',
    'старые фразы с двоеточием получают знак номера',
  );

  console.log('\n=== Test 18: generateVerificationCode формат ===');
  const code = generateVerificationCode();
  assert(/^NV-[A-Z2-9]{6}$/.test(code), 'код вида NV-XXXXXX без 0/O/1/I/L/U');
  const code2 = generateVerificationCode();
  assert(code !== code2, 'два кода разные (с высокой вероятностью)');

  console.log('\n=== Test 19: verification flow ===');
  // Сначала создадим клиента
  db.prepare(`
    INSERT INTO customers (id, telegram_id, telegram_username, total_orders, total_spent, created_at, updated_at)
    VALUES ('cust_v1', '777', 'verifyme', 0, 0, DATETIME('now'), DATETIME('now'))
  `).run();
  assertEq(isCustomerVerified('777'), false, 'новый клиент без заказов — не verified');
  const codeForCust = 'NV-TESTAB';
  attachVerificationCode({ telegramId: '777', code: codeForCust });
  // Без кода confirm с любым telegram_id просто маркирует как verified
  // (старая логика для приглашений-ссылок) — но мы вызываем с code
  const ok = confirmVerificationOnAccess({ telegramId: '777', code: codeForCust });
  assertEq(ok, true, 'confirm с правильным кодом → true');
  assertEq(isCustomerVerified('777'), true, 'после confirm — verified');

  console.log('\n=== Test 20: verification — неверный код ===');
  db.prepare(`
    INSERT INTO customers (id, telegram_id, total_orders, total_spent, created_at, updated_at)
    VALUES ('cust_v2', '888', 0, 0, DATETIME('now'), DATETIME('now'))
  `).run();
  attachVerificationCode({ telegramId: '888', code: 'NV-RIGHT1' });
  const failConfirm = confirmVerificationOnAccess({ telegramId: '888', code: 'NV-WRONG1' });
  assertEq(failConfirm, false, 'неверный код → false');
  assertEq(isCustomerVerified('888'), false, 'клиент остался не verified');

  console.log('\n=== Test 21: verification — старый клиент авто-verified ===');
  db.prepare(`
    INSERT INTO customers (id, telegram_id, total_orders, total_spent, created_at, updated_at)
    VALUES ('cust_old', '999', 5, 100, DATETIME('now'), DATETIME('now'))
  `).run();
  assertEq(isCustomerVerified('999'), true, 'клиент с total_orders=5 — verified без отметки');

  console.log('\n=== Test 22: master switch ===');
  assertEq(isAutoReplyEnabled(), false, 'выключен по умолчанию (после setup)');
  setAutoReplyEnabled(true);
  assertEq(isAutoReplyEnabled(), true, 'включился');
  setAutoReplyEnabled(false);
  assertEq(isAutoReplyEnabled(), false, 'выключился');

  console.log('\n=== Test 23: handleIncomingBusinessMessage — master off ===');
  const offResult = handleIncomingBusinessMessage({
    businessConnectionId: 'bc_test_1',
    fromUserId: '888',
    ownerUserId: '123456789',
    text: 'часы работы какие?',
  });
  assertEq(offResult, null, 'master выключен → null');

  console.log('\n=== Test 24: handleIncomingBusinessMessage — owner echo ===');
  setAutoReplyEnabled(true);
  const ownerEcho = handleIncomingBusinessMessage({
    businessConnectionId: 'bc_test_1',
    fromUserId: '123456789',
    ownerUserId: '123456789',
    text: 'часы работы',
  });
  assertEq(ownerEcho, null, 'на свои сообщения не отвечает');

  console.log('\n=== Test 25: handleIncomingBusinessMessage — match (постоянный клиент) ===');
  db.prepare(`
    INSERT INTO orders (id, order_number, customer_id, status, delivery_type, total_amount, final_amount, created_at, updated_at)
    VALUES ('o_return_888', 5001, 'cust_v2', 'delivered', 'pickup', 50, 50, DATETIME('now'), DATETIME('now'))
  `).run();
  const replyResult = handleIncomingBusinessMessage({
    businessConnectionId: 'bc_test_1',
    fromUserId: '888',
    ownerUserId: '123456789',
    text: 'часы работы',
  });
  assert(replyResult, 'есть ответ');
  assertEq(replyResult.text, 'Работаем с 12:00 до 23:00', 'текст из qr1');

  console.log('\n=== Test 25b: новый клиент (только new) → quick reply не шлём ===');
  db.prepare(`
    INSERT INTO customers (id, telegram_id, telegram_username, first_name, total_orders, total_spent, created_at, updated_at)
    VALUES ('cust_new_qr', '91001', 'newbie_qr', 'Новый', 1, 100, DATETIME('now'), DATETIME('now'))
  `).run();
  db.prepare(`
    INSERT INTO orders (id, order_number, customer_id, status, delivery_type, total_amount, final_amount, created_at, updated_at)
    VALUES ('o_newbie_qr', 9101, 'cust_new_qr', 'new', 'pickup', 100, 100, DATETIME('now'), DATETIME('now'))
  `).run();
  assertEq(isReturningCustomerForQuickReply('91001'), false, 'новый клиент не returning');
  const newCustomerReply = handleIncomingBusinessMessage({
    businessConnectionId: 'bc_test_1',
    fromUserId: '91001',
    ownerUserId: '123456789',
    text: 'часы работы',
  });
  assertEq(newCustomerReply, null, 'новому клиенту quick reply не уходит');

  db.prepare(`
    UPDATE customers
    SET access_authorized_at = DATETIME('now'), access_authorization_source = 'feature_disabled'
    WHERE id = 'cust_new_qr'
  `).run();
  assertEq(
    isReturningCustomerForQuickReply('91001'),
    false,
    'заказ при выключенной функции сохраняет старый порог сообщений',
  );

  db.prepare(`
    UPDATE customers
    SET access_authorized_at = DATETIME('now'), access_authorization_source = 'referral'
    WHERE id = 'cust_new_qr'
  `).run();
  assertEq(isReturningCustomerForQuickReply('91001'), true, 'авторизованный новичок допущен');
  const authorizedNewReply = handleIncomingBusinessMessage({
    businessConnectionId: 'bc_test_1',
    fromUserId: '91001',
    ownerUserId: '123456789',
    text: 'часы работы',
  });
  assert(authorizedNewReply, 'авторизованному новичку quick reply уходит');

  db.prepare(`
    INSERT INTO customer_blocks (id, customer_id, block_type, reason, active)
    VALUES ('block_authorized_qr', 'cust_new_qr', 'delivery', 'обычный бан', 1)
  `).run();
  assertEq(isReturningCustomerForQuickReply('91001'), false, 'общий бан запрещает quick reply');
  assertEq(handleIncomingBusinessMessage({
    businessConnectionId: 'bc_test_1',
    fromUserId: '91001',
    ownerUserId: '123456789',
    text: 'часы работы',
  }), null, 'заблокированному клиенту quick reply не уходит');
  db.prepare("UPDATE customer_blocks SET active = 0 WHERE id = 'block_authorized_qr'").run();
  db.prepare(`
    INSERT INTO customer_invite_bans (id, customer_id, reason, active)
    VALUES ('invite_only_qr', 'cust_new_qr', 'только приглашения', 1)
  `).run();
  assertEq(isReturningCustomerForQuickReply('91001'), true, 'запрет приглашать не мешает сообщениям');
  db.prepare("UPDATE customer_invite_bans SET active = 0 WHERE id = 'invite_only_qr'").run();

  console.log('\n=== Test 25c: in_progress без выданных — тоже null ===');
  db.prepare(`
    INSERT INTO customers (id, telegram_id, telegram_username, first_name, total_orders, total_spent, created_at, updated_at)
    VALUES ('cust_prog_qr', '91002', 'progress_qr', 'Собирают', 1, 50, DATETIME('now'), DATETIME('now'))
  `).run();
  db.prepare(`
    INSERT INTO orders (id, order_number, customer_id, status, delivery_type, total_amount, final_amount, created_at, updated_at)
    VALUES ('o_prog_qr', 9102, 'cust_prog_qr', 'in_progress', 'pickup', 50, 50, DATETIME('now'), DATETIME('now'))
  `).run();
  const inProgressReply = handleIncomingBusinessMessage({
    businessConnectionId: 'bc_test_1',
    fromUserId: '91002',
    ownerUserId: '123456789',
    text: 'часы работы',
  });
  assertEq(inProgressReply, null, 'клиент с заказом in_progress без истории — null');

  console.log('\n=== Test 25d: неизвестный telegram_id → FAQ quick reply разрешён ===');
  const strangerReply = handleIncomingBusinessMessage({
    businessConnectionId: 'bc_test_1',
    fromUserId: '91999',
    ownerUserId: '123456789',
    text: 'часы работы',
  });
  assert(strangerReply, 'до первого заказа FAQ отвечает');
  assertEq(strangerReply.text, 'Работаем с 12:00 до 23:00', 'текст из qr1');

  console.log('\n=== Test 26: handleIncomingBusinessMessage — нет матча ===');
  const noMatch = handleIncomingBusinessMessage({
    businessConnectionId: 'bc_test_1',
    fromUserId: '888',
    ownerUserId: '123456789',
    text: 'это совсем другое сообщение',
  });
  assertEq(noMatch, null, 'без триггера → null');

  console.log('\n=== Test 27: log + listBotLog ===');
  logBotMessage({
    businessConnectionId: 'bc_test_1',
    chatId: '888',
    direction: 'in',
    messageType: 'incoming',
    text: 'часы работы',
  });
  logBotMessage({
    businessConnectionId: 'bc_test_1',
    chatId: '888',
    direction: 'out',
    messageType: 'quick_reply',
    text: 'Работаем с 12:00 до 23:00',
  });
  logBotMessage({
    businessConnectionId: 'bc_test_1',
    chatId: '999',
    direction: 'in',
    messageType: 'incoming',
    text: 'другой клиент',
  });
  const logAll = listBotLog({ limit: 50 });
  assertEq(logAll.length, 3, 'всего 3 записи');
  const logChat888 = listBotLog({ limit: 50, chatId: '888' });
  assertEq(logChat888.length, 2, 'фильтр по chat_id=888 даёт 2');
  assertEq(logChat888[0].direction, 'out', 'самая свежая — out');

  console.log('\n=== Test 28: getRecentLogCount ===');
  const recent = getRecentLogCount({ sinceHours: 24 });
  assertEq(recent, 3, '3 записи за последние 24 часа');

  console.log('\n=== Test 29: log с невалидным direction → null id ===');
  const badId = logBotMessage({
    businessConnectionId: 'bc_test_1',
    chatId: '888',
    direction: 'sideways',
    messageType: 'unknown',
  });
  assertEq(badId, null, 'неверный direction → null');

  console.log('\n=== Test 30: prepareStatusNotification — нет заказа ===');
  const noOrder = prepareStatusNotification({ orderId: 'order_nope', event: 'order_assembled' });
  assertEq(noOrder.ok, false, 'ok=false');
  assertEq(noOrder.reason, 'order_not_found', 'reason=order_not_found');

  console.log('\n=== Test 31: prepareStatusNotification — invalid event ===');
  const badEvent = prepareStatusNotification({ orderId: 'x', event: 'bogus' });
  assertEq(badEvent.ok, false, 'ok=false');
  assertEq(badEvent.reason, 'invalid_event', 'reason=invalid_event');

  console.log('\n=== Test 32: prepareStatusNotification — full happy path ===');
  // Создадим заказ с клиентом-носителем telegram_id
  db.prepare(`
    INSERT INTO orders (id, order_number, customer_id, status, delivery_type, total_amount, final_amount, created_at, updated_at)
    VALUES ('order_t1', 1001, 'cust_v1', 'in_progress', 'pickup', 50, 50, DATETIME('now'), DATETIME('now'))
  `).run();
  db.prepare(`
    INSERT INTO order_pickup_cell_assignments (id, order_id, cell_number)
    VALUES ('cell_order_t1', 'order_t1', 1)
  `).run();
  const happy = prepareStatusNotification({ orderId: 'order_t1', event: 'order_assembled' });
  assertEq(happy.ok, true, 'ok=true');
  assertEq(happy.chatId, '777', 'chatId = telegram_id клиента');
  assert(
    /заказ №1/i.test(happy.text) && !happy.text.includes('1001') && !/ячейк/i.test(happy.text),
    'текст содержит только короткий клиентский номер',
  );
  db.prepare(`
    UPDATE orders
    SET payment_type = 'card', card_amount_minor = 5000
    WHERE id = 'order_t1'
  `).run();
  const cardReady = prepareStatusNotification({
    orderId: 'order_t1',
    event: 'order_assembled',
  });
  assertEq(cardReady.ok, true, 'уведомление карточного заказа подготовлено');
  assert(/способ оплаты: по карте/i.test(cardReady.text), 'для карточного заказа указан способ оплаты');
  db.prepare(`
    UPDATE orders
    SET payment_type = NULL, card_amount_minor = 0
    WHERE id = 'order_t1'
  `).run();

  console.log('\n=== Test 32b: prepareStatusNotification — HTML и безопасные переменные ===');
  const unsafeCustomerName = `Иван <VIP> & "Ко" '`;
  db.prepare(`UPDATE customers SET first_name = ? WHERE id = 'cust_v1'`).run(unsafeCustomerName);
  upsertStatusTemplate('order_issued', {
    title: 'Заказ выдан',
    body: '<b>{customer_name}</b>\n<a href="https://partners.example/ячейка-7">Ячейка 7</a>',
    is_active: 1,
  });
  const htmlPrepared = prepareStatusNotification({ orderId: 'order_t1', event: 'order_issued' });
  assertEq(htmlPrepared.ok, true, 'HTML-шаблон подготовлен');
  assertEq(htmlPrepared.parseMode, 'html', 'для статусного шаблона выбран HTML');
  assertEq(
    htmlPrepared.text,
    '<b>Иван &lt;VIP&gt; &amp; &quot;Ко&quot; &#39;</b>\n<a href="https://partners.example/ячейка-7">Заказ №7</a>',
    'пользовательские данные экранированы, адрес ссылки не изменён',
  );
  const [parsedHtmlText, parsedHtmlEntities] = HTMLParser.parse(htmlPrepared.text);
  assertEq(
    parsedHtmlText,
    unsafeCustomerName + '\nЗаказ №7',
    'GramJS показывает экранированное имя как обычный текст',
  );
  assert(
    parsedHtmlEntities.some(
      (entity) =>
        entity.className === 'MessageEntityTextUrl'
        && entity.url === 'https://partners.example/ячейка-7',
    ),
    'GramJS создаёт скрытую ссылку с нужным адресом',
  );
  upsertStatusTemplate('order_issued', {
    title: 'Старый шаблон',
    body: '**Заказ {order_number} выдан**',
    is_active: 1,
  });
  const legacyPrepared = prepareStatusNotification({ orderId: 'order_t1', event: 'order_issued' });
  assertEq(
    legacyPrepared.text,
    '<b>Заказ №1 выдан</b>',
    'старый жирный текст сохраняется после перехода шаблонов на HTML',
  );
  db.prepare(`UPDATE customers SET first_name = NULL WHERE id = 'cust_v1'`).run();
  upsertStatusTemplate('order_issued', {
    title: 'Заказ выдан',
    body: 'Заказ {order_number} выдан. Спасибо за покупку!',
    is_active: 1,
  });

  console.log('\n=== Test 33: prepareStatusNotification — заказ без клиента ===');
  db.prepare(`
    INSERT INTO orders (id, order_number, status, delivery_type, total_amount, final_amount, created_at, updated_at)
    VALUES ('order_anon', 1002, 'new', 'pickup', 50, 50, DATETIME('now'), DATETIME('now'))
  `).run();
  const anon = prepareStatusNotification({ orderId: 'order_anon', event: 'order_issued' });
  assertEq(anon.ok, false, 'ok=false');
  assertEq(anon.reason, 'order_has_no_customer', 'reason=order_has_no_customer');

  console.log('\n=== Test 34: normalizeForMatch ===');
  assertEq(normalizeForMatch('Привет!'), 'привет', 'lowercase + пунктуация → пробел');
  assertEq(normalizeForMatch('Ёлочка'), 'елочка', 'ё → е');
  assertEq(normalizeForMatch('Café'), 'cafe', 'диакритика убрана');
  assertEq(normalizeForMatch('  пробелы  '), 'пробелы', 'trim');
  assertEq(normalizeForMatch('часы!?,'), 'часы', 'хвостовая пунктуация убрана');
  assertEq(normalizeForMatch('A    B'), 'a b', 'подряд идущие пробелы схлопнуты');

  console.log('\n=== Test 35: matchQuickReply работает с пунктуацией ===');
  const matchPunct = matchQuickReply('часы!?');
  assertEq(matchPunct?.id, qr1.id, 'qr1 «часы» матчится на «часы!?» (ранее ломалось)');

  console.log('\n=== Test 36: confirmVerificationOnAccess без кода → false ===');
  db.prepare(`
    INSERT INTO customers (id, telegram_id, total_orders, total_spent, created_at, updated_at)
    VALUES ('cust_no_code', '6001', 0, 0, DATETIME('now'), DATETIME('now'))
  `).run();
  attachVerificationCode({ telegramId: '6001', code: 'NV-AAA111' });
  const noCode = confirmVerificationOnAccess({ telegramId: '6001' });
  assertEq(noCode, false, 'без code → false (закрыт security bypass)');
  assertEq(isCustomerVerified('6001'), false, 'клиент остался не verified');

  console.log('\n=== Test 37: confirmVerificationOnAccess с пустой строкой → false ===');
  const emptyCode = confirmVerificationOnAccess({ telegramId: '6001', code: '   ' });
  assertEq(emptyCode, false, 'пустая строка/whitespace → false');

  console.log('\n=== Test 38: confirmVerificationOnAccess для несуществующего клиента → false ===');
  const noCustomer = confirmVerificationOnAccess({ telegramId: '99999', code: 'NV-AAA111' });
  assertEq(noCustomer, false, 'неизвестный telegram_id → false');

  console.log('\n=== Test 39: prepareStatusNotification — пустой body шаблона ===');
  upsertStatusTemplate('order_assembled', { title: 'X', body: '   ', is_active: 1 });
  const empty = prepareStatusNotification({ orderId: 'order_t1', event: 'order_assembled' });
  assertEq(empty.ok, false, 'пустой body → ok=false');
  assertEq(empty.reason, 'template_empty', 'reason=template_empty');
  // Восстановим
  upsertStatusTemplate('order_assembled', {
    title: 'Заказ собран',
    body: 'Заказ {order_number} собран',
    is_active: 1,
  });

  console.log('\n=== Test 40: customer_name correct precedence (HIGH-1 fix) ===');
  // Клиент с first/last но без username — имя должно быть «Иван Петров»,
  // а не «@undefined» (баг operator precedence в старом коде).
  db.prepare(`
    INSERT INTO customers (id, telegram_id, first_name, last_name, total_orders, total_spent, created_at, updated_at)
    VALUES ('cust_named', '7001', 'Иван', 'Петров', 0, 0, DATETIME('now'), DATETIME('now'))
  `).run();
  db.prepare(`
    INSERT INTO orders (id, order_number, customer_id, status, delivery_type, total_amount, final_amount, created_at, updated_at)
    VALUES ('order_named', 2001, 'cust_named', 'in_progress', 'pickup', 100, 100, DATETIME('now'), DATETIME('now'))
  `).run();
  const vars = buildOrderVariables('order_named');
  assertEq(vars.customer_name, 'Иван Петров', 'имя+фамилия выигрывает над username');

  console.log('\n=== Test 41: customer_name fallback chain ===');
  // Клиент только с username
  db.prepare(`
    INSERT INTO customers (id, telegram_id, telegram_username, total_orders, total_spent, created_at, updated_at)
    VALUES ('cust_only_user', '7002', 'someuser', 0, 0, DATETIME('now'), DATETIME('now'))
  `).run();
  db.prepare(`
    INSERT INTO orders (id, order_number, customer_id, status, delivery_type, total_amount, final_amount, created_at, updated_at)
    VALUES ('order_only_user', 2002, 'cust_only_user', 'in_progress', 'pickup', 50, 50, DATETIME('now'), DATETIME('now'))
  `).run();
  const v2 = buildOrderVariables('order_only_user');
  assertEq(v2.customer_name, '@someuser', 'без имени — fallback на @username');

  // Клиент без ничего
  db.prepare(`
    INSERT INTO customers (id, telegram_id, total_orders, total_spent, created_at, updated_at)
    VALUES ('cust_anon', '7003', 0, 0, DATETIME('now'), DATETIME('now'))
  `).run();
  db.prepare(`
    INSERT INTO orders (id, order_number, customer_id, status, delivery_type, total_amount, final_amount, created_at, updated_at)
    VALUES ('order_anon_named', 2003, 'cust_anon', 'in_progress', 'pickup', 50, 50, DATETIME('now'), DATETIME('now'))
  `).run();
  const v3 = buildOrderVariables('order_anon_named');
  assertEq(v3.customer_name, 'клиент', 'ни имени ни username — generic «клиент»');

  console.log('\n=== Test 42: prepareStatusNotification — order_accepted event ===');
  upsertStatusTemplate('order_accepted', {
    title: 'Заказ принят',
    body: 'Заказ №{order_number} принят, сумма {final_amount} BYN.',
    is_active: 1,
  });
  db.prepare(`
    INSERT INTO orders (id, order_number, customer_id, status, delivery_type, total_amount, final_amount, created_at, updated_at)
    VALUES ('order_accepted_t', 3001, 'cust_v1', 'new', 'pickup', 120, 120, DATETIME('now'), DATETIME('now'))
  `).run();
  db.prepare(`
    INSERT INTO order_pickup_cell_assignments (id, order_id, cell_number)
    VALUES ('cell_order_accepted_t', 'order_accepted_t', 3)
  `).run();
  const acceptedPrep = prepareStatusNotification({
    orderId: 'order_accepted_t',
    event: 'order_accepted',
  });
  assertEq(acceptedPrep.ok, true, 'order_accepted ok=true');
  assertEq(acceptedPrep.templateEvent, 'order_accepted', 'templateEvent=order_accepted');
  assert(
    acceptedPrep.text.includes('Заказ №3') &&
      !acceptedPrep.text.includes('3001') &&
      !acceptedPrep.text.includes('Заказ #3'),
    'старый шаблон нормализован до короткого «Заказ №3»',
  );
  assert(acceptedPrep.text.includes('120'), 'текст содержит final_amount');

  console.log('\n=== Test 43: registerBusinessConnection reconnect bumps connected_at ===');
  registerBusinessConnection({
    id: 'bc_reconnect',
    userId: '500',
    isEnabled: true,
    canReply: true,
  });
  const beforeDisc = db
    .prepare(`SELECT connected_at FROM business_connections WHERE id = 'bc_reconnect'`)
    .get();
  removeBusinessConnection('bc_reconnect');
  // Sleep ~1s через busy loop (SQLite DATETIME имеет секундную гранулярность)
  const t0 = Date.now();
  while (Date.now() - t0 < 1100) { /* busy wait */ }
  registerBusinessConnection({
    id: 'bc_reconnect',
    userId: '500',
    isEnabled: true,
    canReply: true,
  });
  const afterReconnect = db
    .prepare(`SELECT connected_at, disconnected_at FROM business_connections WHERE id = 'bc_reconnect'`)
    .get();
  assertEq(afterReconnect.disconnected_at, null, 'disconnected_at сброшен');
  assert(afterReconnect.connected_at > beforeDisc.connected_at, 'connected_at обновился (>= позднее)');

  console.log('\n=== Test 44: Business Bot API — HTML только по явному запросу ===');
  const originalFetch = globalThis.fetch;
  const originalBotToken = process.env.BOT_TOKEN;
  const sentBodies = [];
  try {
    process.env.BOT_TOKEN = 'test-token';
    globalThis.fetch = async (_url, options = {}) => {
      sentBodies.push(JSON.parse(String(options.body || '{}')));
      return {
        ok: true,
        json: async () => ({ ok: true, result: { message_id: 77 } }),
      };
    };
    const { sendBusinessMessage } = await import('../utils/telegram-business-api.js');
    const htmlSend = await sendBusinessMessage({
      businessConnectionId: 'bc-html',
      chatId: '7001',
      text: '<b>Прайс</b>',
      parseMode: 'html',
    });
    assertEq(htmlSend.ok, true, 'HTML-прайс отправлен');
    assertEq(sentBodies[0]?.parse_mode, 'HTML', 'Bot API получил parse_mode=HTML');

    const plainSend = await sendBusinessMessage({
      businessConnectionId: 'bc-plain',
      chatId: '7001',
      text: 'Обычный текст',
    });
    assertEq(plainSend.ok, true, 'обычное сообщение отправлено');
    assertEq('parse_mode' in sentBodies[1], false, 'ручной текст не переключён на HTML');

    const beforeRejected = sentBodies.length;
    const rejected = await sendBusinessMessage({
      businessConnectionId: 'bc-invalid',
      chatId: '7001',
      text: 'Текст',
      parseMode: 'markdown',
    });
    assertEq(rejected.error, 'invalid_parse_mode', 'неизвестный режим отклонён');
    assertEq(sentBodies.length, beforeRejected, 'отклонённый запрос не ушёл в Telegram');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBotToken === undefined) delete process.env.BOT_TOKEN;
    else process.env.BOT_TOKEN = originalBotToken;
  }
}

try {
  await runTests();
  console.log(`\n=== Total: ${results.passed} passed, ${results.failed} failed ===`);
  if (results.failed === 0) {
    console.log('business-bot.test.js passed');
  }
} finally {
  try { db.close(); } catch {}
  for (const p of [TMP_DB, `${TMP_DB}-shm`, `${TMP_DB}-wal`]) {
    try { fs.unlinkSync(p); } catch {}
  }
  if (results.failed > 0) {
    process.exit(1);
  }
}
