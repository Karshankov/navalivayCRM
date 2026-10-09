import crypto from 'crypto';
import { Api } from 'telegram';

export function normalizeQuickReplyName(value) {
  return String(value || '').trim().replace(/^\/+/, '').toLocaleLowerCase('ru-RU');
}

export function findQuickReply(shortcuts, requestedName) {
  const wanted = normalizeQuickReplyName(requestedName);
  if (!wanted) return null;
  return (shortcuts || []).find(
    (item) => normalizeQuickReplyName(item?.name ?? item?.shortcut) === wanted,
  ) || null;
}

export function buildStableRandomIds(idempotencyKey, count) {
  const safeCount = Math.max(0, Math.min(100, Number(count) || 0));
  return Array.from({ length: safeCount }, (_, index) => {
    const digest = crypto
      .createHash('sha256')
      .update(`${String(idempotencyKey)}:${index}`)
      .digest();
    return digest.readBigInt64LE(0);
  });
}

export async function listQuickReplies(client) {
  const result = await client.invoke(new Api.messages.GetQuickReplies({ hash: 0n }));
  const shortcuts = Array.isArray(result?.quickReplies) ? result.quickReplies : [];
  return shortcuts.map((item) => ({
    id: Number(item.shortcutId),
    name: String(item.shortcut || ''),
    count: Math.max(0, Number(item.count) || 0),
  }));
}

export async function sendQuickReply({
  client,
  peer,
  shortcut,
  idempotencyKey,
} = {}) {
  if (!client || !peer || !shortcut?.id || !idempotencyKey) {
    throw Object.assign(new Error('invalid_quick_reply_payload'), {
      code: 'invalid_quick_reply_payload',
    });
  }
  const randomIds = buildStableRandomIds(idempotencyKey, shortcut.count);
  const result = await client.invoke(new Api.messages.SendQuickReplyMessages({
    peer,
    shortcutId: Number(shortcut.id),
    id: [],
    randomId: randomIds,
  }));
  const messageIds = (result?.updates || [])
    .map((update) => Number(update?.message?.id || 0))
    .filter((id) => id > 0);
  return { messageIds };
}
