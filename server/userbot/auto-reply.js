/**
 * Автоответы на входящие сообщения клиентов через userbot.
 *
 * Почему это отдельно от bot.js
 * -----------------------------
 * В bot.js автоответы привязаны к апдейту `business_message`, который Telegram
 * присылает только при активном подключении Telegram Business. У аккаунта
 * менеджера (@Rez0nsky) переписка идёт через userbot, и у таких сообщений
 * business_connection_id пустой — обработчик в bot.js выходит на первой же
 * проверке и до логики ответа не доходит.
 *
 * Поэтому решение об ответе принимается здесь: входящие сообщения, которые
 * видит userbot, уже содержат всё нужное.
 *
 * Само решение НЕ дублируется: тумблер, опознание клиента, поиск правила и
 * пауза целиком отданы handleIncomingBusinessMessage — той же функции, что
 * использует Business-путь. Здесь только транспорт: входящее сообщение и
 * отправка ответа.
 *
 * Модуль вынесен из index.js намеренно: index.js при импорте сразу поднимает
 * HTTP-сервер, поэтому протестировать логику оттуда нельзя.
 */
import fs from 'fs';
import {
  handleIncomingBusinessMessage,
  tryStartAutoReply,
  finishAutoReply,
  logBotMessage,
  AUTO_REPLY_MESSAGE_TYPE,
} from '../utils/business-bot.js';
import { sendViaUserbot } from '../utils/userbot-client.js';

/**
 * Отправка ответа в свой же процесс.
 *
 * Обычный sendViaUserbot ходит на 127.0.0.1:PORT, но userbot работает под
 * proxychains4 (см. start.sh), а тот перехватывает весь TCP вместе с
 * локальным — запрос уходит в прокси и падает с ECONNREFUSED. Проверено на
 * проде: уведомления о заказах тем же путём /send-message уходят только
 * потому, что их шлёт api-процесс, который под proxychains не работает.
 *
 * Поэтому, если рядом поднят unix-сокет, идём через него: сокеты proxychains
 * не трогает. Нет сокета — обычный путь по HTTP (локальная разработка).
 */
const SELF_SOCKET_PATH = (process.env.USERBOT_SELF_SOCKET || '/tmp/navalivay-userbot.sock').trim();
const SHARED_SECRET = (process.env.USERBOT_SECRET || '').trim();
const SELF_SEND_TIMEOUT_MS = 20_000;

let socketCheckedAt = 0;
let socketAvailable = false;

/** Поднят ли сокет этого процесса. Кэшируем: stat на каждый ответ ни к чему. */
function hasSelfSocket() {
  const now = Date.now();
  if (now - socketCheckedAt < 30_000) return socketAvailable;
  socketCheckedAt = now;
  try {
    socketAvailable = fs.statSync(SELF_SOCKET_PATH).isSocket();
  } catch {
    socketAvailable = false;
  }
  return socketAvailable;
}

async function sendThroughSelfSocket({ chatId, text, username, auto }) {
  const { Agent } = await import('undici');
  const dispatcher = new Agent({ connect: { socketPath: SELF_SOCKET_PATH } });
  const headers = { 'Content-Type': 'application/json' };
  if (SHARED_SECRET) headers['X-Userbot-Secret'] = SHARED_SECRET;
  try {
    const response = await fetch('http://localhost/send-message', {
      method: 'POST',
      headers,
      // Контракт тот же, что у sendViaUserbot: эндпоинт один и тот же.
      body: JSON.stringify({ chat_id: chatId, text, username, auto }),
      signal: AbortSignal.timeout(SELF_SEND_TIMEOUT_MS),
      dispatcher,
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data?.ok) return { ok: true };
    // 'ambiguous' — ответ мог уйти, а подтверждение потерялось. Повторять
    // нельзя: клиент получит два одинаковых сообщения.
    const outcome = data?.error === 'ambiguous' ? 'ambiguous' : 'failed';
    return { ok: false, outcome, error: data?.error || `http_${response.status}` };
  } finally {
    await dispatcher.close().catch(() => {});
  }
}

/** Отправка ответа: через сокет, когда он есть, иначе обычным путём. */
async function sendReply(payload) {
  if (hasSelfSocket()) {
    try {
      return await sendThroughSelfSocket(payload);
    } catch (err) {
      // Сокет мог отвалиться между проверкой и вызовом — падать из-за этого
      // незачем, пробуем обычный путь.
      console.warn(
        '[userbot] автоответ: self-socket не сработал, иду через HTTP:',
        err?.message || err,
      );
    }
  }
  return sendViaUserbot(payload);
}

/**
 * Текст быстрой заготовки Telegram по её shortcut_id.
 *
 * Идёт через сокет по той же причине, что и отправка: обычный HTTP внутри
 * этого процесса перехватывает proxychains.
 *
 * Возвращает null, если прочитать не удалось. Вызывающий решает, что делать:
 * молча подставить текст правила было бы хуже, чем показать причину.
 */
async function readShortcutText({ shortcutId, topMessage, fetchImpl = fetch, baseUrl = null }) {
  const id = Number(shortcutId) || 0;
  if (!id) return null;
  const message = Number(topMessage) || id;
  const path = `/quick-reply-text?shortcut_id=${id}&top_message=${message}`;
  const headers = {};
  if (SHARED_SECRET) headers['X-Userbot-Secret'] = SHARED_SECRET;

  if (!baseUrl && hasSelfSocket()) {
    const { Agent } = await import('undici');
    const dispatcher = new Agent({ connect: { socketPath: SELF_SOCKET_PATH } });
    try {
      const response = await fetchImpl(`http://localhost${path}`, {
        headers,
        signal: AbortSignal.timeout(SELF_SEND_TIMEOUT_MS),
        dispatcher,
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data?.ok) return String(data.text ?? '') || null;
      return null;
    } catch {
      return null;
    } finally {
      await dispatcher.close().catch(() => {});
    }
  }

  const { USERBOT_BASE } = await import('../utils/userbot-client.js');
  try {
    const response = await fetchImpl(`${baseUrl || USERBOT_BASE}${path}`, {
      headers,
      signal: AbortSignal.timeout(SELF_SEND_TIMEOUT_MS),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data?.ok) return String(data.text ?? '') || null;
    return null;
  } catch {
    return null;
  }
}

/**
 * Принять решение об автоответе и отправить его.
 *
 * @param {object} params
 * @param {string} params.chatId — id переписки в Telegram (совпадает с telegram_id клиента)
 * @param {string} params.fromUserId — автор сообщения
 * @param {string|null} params.ownerUserId — владелец аккаунта (myUserId в userbot):
 *   на его собственные сообщения бот не отвечает
 * @param {string} params.text — текст входящего
 * @param {object} [deps] — подмена зависимостей для тестов
 * @returns {Promise<{outcome: string, text?: string, title?: string}|null>}
 *   null — отвечать не нужно (выключено, не наш случай, нет правила, пауза)
 */
export async function processIncomingAutoReply(
  { chatId, fromUserId, ownerUserId, text },
  deps = {},
) {
  const {
    decide = handleIncomingBusinessMessage,
    send = sendReply,
    log = logBotMessage,
    start = tryStartAutoReply,
    finish = finishAutoReply,
    readShortcut = readShortcutText,
  } = deps;

  const reply = decide({
    businessConnectionId: null,
    fromUserId,
    ownerUserId,
    text,
  });
  if (!reply) return null;

  // Правило может ссылаться на быструю заготовку Telegram. Тогда её текст
  // читается здесь и сейчас — правки в Telegram подхватываются без правок в
  // CRM. Свой текст правила остаётся запасным: если заготовку не прочитать,
  // клиент всё равно получит ответ, а не тишину.
  let answerText = reply.text;
  if (reply.telegramShortcutId) {
    const fromShortcut = await readShortcut({ shortcutId: reply.telegramShortcutId });
    if (fromShortcut) {
      answerText = fromShortcut;
    } else {
      console.warn(
        `[userbot] автоответ: текст заготовки #${reply.telegramShortcutId} не прочитан, ` +
          'отправляю текст правила',
      );
    }
  }

  // Блокировка на время отправки: пауза читается из журнала, а запись туда
  // идёт только после отправки. Без неё два сообщения подряд дали бы два
  // одинаковых ответа.
  if (!start(fromUserId)) return null;

  try {
    // Отправка идёт через HTTP-эндпоинт userbot: там уже собраны три попытки
    // доставки (кэш entity → сохранённый access_hash → prefetch), общий
    // лимитер и защита от FloodWait. Вызывать client.sendMessage отсюда
    // напрямую значило бы продублировать всё это и разойтись с ним.
    const result = await send({
      chatId,
      text: answerText,
      username: reply.customerUsername || null,
      auto: true,
    });

    // 'ambiguous' — ответ мог уйти, а подтверждение потерялось. Повторять
    // нельзя: клиент получит два одинаковых сообщения. Пауза его не считает.
    const outcome = result.ok ? 'sent' : result.outcome === 'ambiguous' ? 'ambiguous' : 'failed';

    log({
      businessConnectionId: null,
      chatId,
      customerId: reply.customerId ?? null,
      customerTelegramId: fromUserId,
      direction: 'out',
      messageType: AUTO_REPLY_MESSAGE_TYPE,
      templateKind: reply.templateKind,
      templateId: reply.templateId,
      text: answerText,
      meta: {
        quick_reply_title: reply.quickReplyTitle,
        via: 'userbot-listener',
        // Именно outcome='sent' считает пауза. Провал не должен глушить
        // следующие ответы на полчаса — клиент ответа не получил.
        outcome,
        error: result.ok ? null : String(result.error || ''),
      },
    });

    return {
      outcome,
      text: answerText,
      title: reply.quickReplyTitle,
      error: result.ok ? null : String(result.error || ''),
    };
  } finally {
    // Всегда освобождаем: иначе после первой же ошибки клиент останется
    // «занятым» до перезапуска и автоответов больше не получит.
    finish(fromUserId);
  }
}
