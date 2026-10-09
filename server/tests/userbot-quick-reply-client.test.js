import assert from 'node:assert/strict';

let handler = null;
let lastRequest = null;
globalThis.fetch = async (url, init = {}) => {
  lastRequest = { url: String(url), init };
  return handler(url, init);
};

const {
  listUserbotQuickReplies,
  sendQuickReplyViaUserbot,
} = await import('../utils/userbot-client.js');

handler = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ ok: true, quick_replies: [{ id: 1, name: 'Прайс', count: 2 }] }),
});
assert.deepEqual((await listUserbotQuickReplies()).quick_replies, [{ id: 1, name: 'Прайс', count: 2 }]);
assert.match(lastRequest.url, /\/quick-replies$/);

handler = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ ok: true, shortcut: 'Прайс', telegram_message_ids: [1, 2] }),
});
const sent = await sendQuickReplyViaUserbot({
  chatId: '123', shortcut: '/Прайс', idempotencyKey: 'welcome:c1',
});
assert.equal(sent.ok, true);
assert.deepEqual(sent.telegram_message_ids, [1, 2]);
assert.deepEqual(JSON.parse(lastRequest.init.body), {
  chat_id: '123', shortcut: '/Прайс', idempotency_key: 'welcome:c1',
});

handler = async () => ({
  ok: false,
  status: 429,
  json: async () => ({ ok: false, error: 'flood_wait', retry_after_seconds: 9 }),
});
const limited = await sendQuickReplyViaUserbot({
  chatId: '123', shortcut: 'Прайс', idempotencyKey: 'welcome:c1',
});
assert.equal(limited.outcome, 'unreachable');
assert.equal(limited.retry_after_seconds, 9);

handler = async () => {
  const error = new Error('request timed out');
  error.name = 'TimeoutError';
  throw error;
};
const ambiguous = await sendQuickReplyViaUserbot({
  chatId: '123', shortcut: 'Прайс', idempotencyKey: 'welcome:c1',
});
assert.equal(ambiguous.outcome, 'ambiguous');

assert.equal((await sendQuickReplyViaUserbot({})).error, 'invalid_payload');
console.log('userbot-quick-reply-client.test.js: ok');
