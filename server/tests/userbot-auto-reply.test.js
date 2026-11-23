/**
 * Автоответы через userbot — транспорт и запись в журнал.
 *
 * Проверяем то, что добавлено к готовому решению (само решение — тумблер,
 * опознание клиента, пауза — покрыто в auto-replies.test.js и здесь не
 * дублируется): что ответ уходит в правильный чат, что журнал пишется с
 * outcome='sent' только при успехе, и что клиент всегда освобождается.
 *
 * Запуск: node server/tests/userbot-auto-reply.test.js
 */
import assert from 'node:assert/strict';
import { processIncomingAutoReply } from '../userbot/auto-reply.js';

const CLIENT = '910000001';
const OWNER = '900000001';

const REPLY = {
  text: 'Работаем до 21:00',
  templateKind: 'quick_reply',
  templateId: 4,
  quickReplyTitle: 'График работы',
  customerId: 'cust_x',
  customerTelegramId: CLIENT,
  customerUsername: 'client',
};

/** Собирает подмены для одного прогона и записывает, что было вызвано. */
function harness({ decision = REPLY, sendResult = { ok: true }, startAllowed = true } = {}) {
  const calls = { sent: [], logged: [], started: [], finished: [] };
  return {
    calls,
    deps: {
      decide: () => decision,
      send: async (payload) => {
        calls.sent.push(payload);
        return sendResult;
      },
      log: (entry) => calls.logged.push(entry),
      start: (id) => {
        calls.started.push(id);
        return startAllowed;
      },
      finish: (id) => calls.finished.push(id),
    },
  };
}

async function testSendsToCorrectChat() {
  console.log('\n=== уходит в правильный чат ===');
  const h = harness();
  const result = await processIncomingAutoReply(
    { chatId: CLIENT, fromUserId: CLIENT, ownerUserId: OWNER, text: 'До скольки?' },
    h.deps,
  );

  assert.equal(h.calls.sent.length, 1, 'ровно одна отправка');
  assert.equal(h.calls.sent[0].chatId, CLIENT, 'в чат клиента, не в свой');
  assert.equal(h.calls.sent[0].text, REPLY.text, 'текст правила');
  assert.equal(h.calls.sent[0].auto, true, 'помечена как автоответ');
  assert.equal(result.outcome, 'sent', 'итог — sent');
}

async function testLogsSentOnSuccess() {
  console.log('\n=== успех пишется как sent ===');
  const h = harness();
  await processIncomingAutoReply(
    { chatId: CLIENT, fromUserId: CLIENT, ownerUserId: OWNER, text: 'привет' },
    h.deps,
  );

  assert.equal(h.calls.logged.length, 1, 'одна запись в журнал');
  const entry = h.calls.logged[0];
  assert.equal(entry.direction, 'out', 'направление out');
  assert.equal(entry.messageType, 'auto_reply', 'тип auto_reply — по нему считает пауза');
  assert.equal(entry.meta.outcome, 'sent', 'outcome=sent считает пауза');
  assert.equal(entry.customerTelegramId, CLIENT, 'привязано к клиенту');
  assert.equal(entry.templateId, REPLY.templateId, 'ссылка на правило');
}

async function testFailureDoesNotArmCooldown() {
  console.log('\n=== провал не включает паузу ===');
  const h = harness({ sendResult: { ok: false, outcome: 'unreachable', error: 'timeout' } });
  const result = await processIncomingAutoReply(
    { chatId: CLIENT, fromUserId: CLIENT, ownerUserId: OWNER, text: 'привет' },
    h.deps,
  );

  assert.equal(result.outcome, 'failed', 'итог — failed');
  assert.equal(h.calls.logged[0].meta.outcome, 'failed', 'в журнале failed');
  assert.equal(h.calls.logged[0].meta.error, 'timeout', 'причина сохранена');
}

async function testAmbiguousIsNotRetried() {
  console.log('\n=== ambiguous: ответ мог уйти, повторять нельзя ===');
  const h = harness({ sendResult: { ok: false, outcome: 'ambiguous', error: 'connection reset' } });
  const result = await processIncomingAutoReply(
    { chatId: CLIENT, fromUserId: CLIENT, ownerUserId: OWNER, text: 'привет' },
    h.deps,
  );

  assert.equal(h.calls.sent.length, 1, 'ровно одна отправка — повтора нет');
  assert.equal(result.outcome, 'ambiguous', 'итог — ambiguous');
  assert.equal(h.calls.logged[0].meta.outcome, 'ambiguous', 'в журнале ambiguous');
  assert.notEqual(h.calls.logged[0].meta.outcome, 'sent', 'ambiguity не считается успехом');
}

async function testNoDecisionMeansNoWork() {
  console.log('\n=== решение null: ничего не отправляем ===');
  const h = harness({ decision: null });
  const result = await processIncomingAutoReply(
    { chatId: CLIENT, fromUserId: CLIENT, ownerUserId: OWNER, text: 'случайный текст' },
    h.deps,
  );

  assert.equal(result, null, 'вернули null');
  assert.equal(h.calls.sent.length, 0, 'отправки нет');
  assert.equal(h.calls.logged.length, 0, 'журнал не тронут');
  assert.equal(h.calls.started.length, 0, 'блокировку не занимали');
}

async function testBusyClientIsSkipped() {
  console.log('\n=== клиент занят: второе сообщение не отвечаем ===');
  const h = harness({ startAllowed: false });
  const result = await processIncomingAutoReply(
    { chatId: CLIENT, fromUserId: CLIENT, ownerUserId: OWNER, text: 'привет' },
    h.deps,
  );

  assert.equal(result, null, 'вернули null');
  assert.equal(h.calls.sent.length, 0, 'отправки нет');
  assert.equal(h.calls.finished.length, 0, 'чужую блокировку не освобождаем');
}

async function testAlwaysReleasesClient() {
  console.log('\n=== клиент освобождается всегда ===');
  const ok = harness();
  await processIncomingAutoReply(
    { chatId: CLIENT, fromUserId: CLIENT, ownerUserId: OWNER, text: 'привет' },
    ok.deps,
  );
  assert.deepEqual(ok.calls.finished, [CLIENT], 'после успеха освобождён');

  const bad = harness({
    send: undefined,
    sendResult: { ok: false, outcome: 'rejected', error: 'invalid_payload' },
  });
  await processIncomingAutoReply(
    { chatId: CLIENT, fromUserId: CLIENT, ownerUserId: OWNER, text: 'привет' },
    bad.deps,
  );
  assert.deepEqual(bad.calls.finished, [CLIENT], 'после провала тоже освобождён');
}

async function testSendThrowStillReleases() {
  console.log('\n=== исключение при отправке не оставляет клиента занятым ===');
  const calls = { finished: [] };
  const deps = {
    decide: () => REPLY,
    send: async () => {
      throw new Error('userbot лежит');
    },
    log: () => {},
    start: () => true,
    finish: (id) => calls.finished.push(id),
  };

  await assert.rejects(
    () => processIncomingAutoReply(
      { chatId: CLIENT, fromUserId: CLIENT, ownerUserId: OWNER, text: 'привет' },
      deps,
    ),
    /userbot лежит/,
    'ошибка пробрасывается наверх',
  );
  assert.deepEqual(calls.finished, [CLIENT], 'всё равно освобождён — иначе клиент залипнет');
}

async function testOwnerEchoIsNotAnswered() {
  console.log('\n=== на свои сообщения не отвечаем ===');
  // Решение принимает handleIncomingBusinessMessage и вернёт null, если
  // автор — владелец аккаунта. Проверяем, что владелец действительно
  // передаётся в решение.
  let seen = null;
  const deps = {
    decide: (payload) => {
      seen = payload;
      return null;
    },
    send: async () => ({ ok: true }),
    log: () => {},
    start: () => true,
    finish: () => {},
  };
  await processIncomingAutoReply(
    { chatId: OWNER, fromUserId: OWNER, ownerUserId: OWNER, text: 'я сам написал' },
    deps,
  );

  assert.equal(seen.ownerUserId, OWNER, 'владелец передан в решение');
  assert.equal(seen.businessConnectionId, null, 'канал — userbot, не Business');
  assert.equal(seen.fromUserId, OWNER, 'автор передан как есть — решение само отсечёт');
}

await testSendsToCorrectChat();
await testLogsSentOnSuccess();
await testFailureDoesNotArmCooldown();
await testAmbiguousIsNotRetried();
await testNoDecisionMeansNoWork();
await testBusyClientIsSkipped();
await testAlwaysReleasesClient();
await testSendThrowStillReleases();
await testOwnerEchoIsNotAnswered();

console.log('\nвсе проверки автоответа через userbot пройдены');
