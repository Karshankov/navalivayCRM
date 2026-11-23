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
    // id сообщения-шаблона в «Избранном». Текст заготовки Telegram в списке
    // не отдаёт (в схеме есть только shortcut_id/shortcut/top_message/count) —
    // его достаём отдельно через readQuickReplyText.
    topMessage: Number(item.topMessage) || 0,
  }));
}

/**
 * Текст заготовки.
 *
 * Быстрая заготовка Telegram — это НЕ сообщение в «Избранном», хотя
 * top_message выглядит как обычный id. Проверено на живом аккаунте: те же
 * id через GetMessages возвращают MessageEmpty, а история «Избранного»
 * начинается с других номеров. Тексты заготовок лежат в отдельном хранилище,
 * и достаются только через GetQuickReplyMessages.
 *
 * Обязательно передавать id: [top_message] — с пустым массивом метод
 * отвечает messages.Messages с нулём сообщений, то есть выглядит как
 * «заготовка без текста», хотя текст есть.
 *
 * Возвращает '' когда прочитать не удалось: пустая строка здесь безопаснее
 * исключения — список заготовок нужен форме, даже если текст одной из них
 * недоступен.
 */
export async function readQuickReplyText(client, topMessageId, shortcutId = null) {
  const messageId = Number(topMessageId) || 0;
  if (!messageId) return '';
  const shortcut = Number(shortcutId ?? topMessageId) || messageId;
  try {
    const response = await client.invoke(
      new Api.messages.GetQuickReplyMessages({
        shortcutId: shortcut,
        id: [messageId],
        hash: 0n,
      }),
    );
    const messages = Array.isArray(response?.messages) ? response.messages : [];
    const text = messages.find((m) => typeof m?.message === 'string')?.message;
    return typeof text === 'string' ? text : '';
  } catch {
    return '';
  }
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
