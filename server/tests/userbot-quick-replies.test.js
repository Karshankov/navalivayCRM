import assert from 'node:assert/strict';
import {
  readQuickReplyText,
  buildStableRandomIds,
  findQuickReply,
  listQuickReplies,
  normalizeQuickReplyName,
  sendQuickReply,
} from '../userbot/quick-replies.js';

assert.equal(normalizeQuickReplyName('/ПРАЙС'), 'прайс');
assert.equal(normalizeQuickReplyName('  ///Прайс  '), 'прайс');
assert.equal(findQuickReply([{ id: 7, name: 'Прайс' }], '/прайс')?.id, 7);
assert.equal(findQuickReply([{ id: 7, name: 'Другое' }], 'Прайс'), null);

const first = buildStableRandomIds('welcome:c1', 3);
const retry = buildStableRandomIds('welcome:c1', 3);
const other = buildStableRandomIds('welcome:c2', 3);
assert.deepEqual(first, retry);
assert.notDeepEqual(first, other);
assert.equal(buildStableRandomIds('x', 1000).length, 100);

let call = 0;
let sentRequest = null;
const client = {
  async invoke(request) {
    call += 1;
    if (call === 1) {
      return {
        quickReplies: [
          { shortcutId: 11, shortcut: 'Прайс', count: 2, topMessage: 501 },
          { shortcutId: 12, shortcut: 'Адрес', count: 1, topMessage: 502 },
        ],
      };
    }
    sentRequest = request;
    return { updates: [{ message: { id: 100 } }, {}, { message: { id: 101 } }] };
  },
};

const shortcuts = await listQuickReplies(client);
assert.deepEqual(shortcuts, [
  { id: 11, name: 'Прайс', count: 2, topMessage: 501 },
  { id: 12, name: 'Адрес', count: 1, topMessage: 502 },
]);
const result = await sendQuickReply({
  client,
  peer: { peer: true },
  shortcut: shortcuts[0],
  idempotencyKey: 'welcome:c1',
});
assert.deepEqual(result.messageIds, [100, 101]);
assert.equal(sentRequest.shortcutId, 11);
assert.deepEqual(sentRequest.id, []);
assert.deepEqual(sentRequest.randomId, buildStableRandomIds('welcome:c1', 2));

// --- Текст заготовки ---------------------------------------------------------
// Telegram хранит текст заготовки отдельным сообщением в «Избранном»; QuickReply
// отдаёт лишь top_message. Читаем его через messages.GetMessages.
assert.equal(
  await readQuickReplyText(
    { invoke: async () => ({ messages: [{ message: 'Работаем до 20:00' }] }) },
    501,
  ),
  'Работаем до 20:00',
  'текст заготовки читается по topMessage',
);

// Без topMessage запрос не нужен: не дёргаем сеть впустую.
let calledWithoutId = false;
await readQuickReplyText(
  {
    invoke: async () => {
      calledWithoutId = true;
      return {};
    },
  },
  0,
);
assert.equal(calledWithoutId, false, 'без topMessage запрос к Telegram не уходит');
assert.equal(await readQuickReplyText({ invoke: async () => ({}) }, 0), '', 'без topMessage — пустая строка');

// Медиа-заготовка без текста и сбой Telegram не должны ломать список: форма
// получит пустую строку и покажет заготовку недоступной.
assert.equal(
  await readQuickReplyText({ invoke: async () => ({ messages: [{ media: {} }] }) }, 7),
  '',
  'сообщение без текста даёт пустую строку',
);
assert.equal(
  await readQuickReplyText(
    {
      invoke: async () => {
        throw new Error('FLOOD_WAIT_30');
      },
    },
    7,
  ),
  '',
  'ошибка Telegram не выбрасывается наружу',
);

console.log('userbot-quick-replies.test.js: ok');
