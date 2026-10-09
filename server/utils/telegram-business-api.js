/**
 * Прямые вызовы Telegram Bot API для Business mode.
 *
 * На проде API работает через systemd, а `navalivay-bot` через PM2.
 * У них отдельная память,
 * поэтому API-процесс НЕ может позвать функцию из bot-процесса через
 * globalThis или import. Раньше я регистрировал sender как globalThis —
 * локально работало (один процесс), а в проде API всегда видел undefined.
 *
 * Решение: для исходящих сообщений (notify-status, send-price) API
 * стучится в Telegram Bot API напрямую через fetch с тем же BOT_TOKEN.
 * bot-процесс остаётся только для входящих событий (long-polling
 * `business_connection`, `business_message`).
 *
 * BOT_TOKEN читается один раз при импорте — он не меняется в рантайме
 * (env у обоих процессов — один и тот же systemd/PM2 envFile).
 *
 * Прокси: если задан TELEGRAM_HTTP_PROXY (формат http://user:pass@host:port),
 * все запросы идут через него. Это нужно потому что хостер режет прямой
 * канал к api.telegram.org (замер 9.05.2026: 67% timeout). Прокси —
 * undici.ProxyAgent, который умеет в HTTP CONNECT-туннель для HTTPS.
 */

import { ProxyAgent } from 'undici';
import { normalizeTelegramParseMode } from './telegram-message-format.js';

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Singleton ProxyAgent для всех запросов к Telegram. Создаётся один раз при
 * импорте и переиспользуется — undici умеет в keep-alive внутри агента.
 *
 * Если TELEGRAM_HTTP_PROXY не задан или невалидный — proxyDispatcher = null,
 * fetch идёт напрямую (как до фикса).
 */
const proxyDispatcher = (() => {
  const url = (process.env.TELEGRAM_HTTP_PROXY || '').trim();
  if (!url) {
    console.log('[telegram-business-api] TELEGRAM_HTTP_PROXY не задан, идём напрямую');
    return null;
  }
  try {
    const agent = new ProxyAgent({ uri: url });
    // Маскируем пароль для лога — в URL формат http://user:pass@host:port
    const masked = url.replace(/(:\/\/[^:]+:)([^@]+)(@)/, '$1***$3');
    console.log('[telegram-business-api] прокси активирован:', masked);
    return agent;
  } catch (err) {
    console.error(
      '[telegram-business-api] не удалось инициализировать ProxyAgent:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
})();

/**
 * Скрывает credentials прокси, если URL прокси попал в текст ошибки. Без
 * этого пароль из TELEGRAM_HTTP_PROXY мог бы утечь в stdout/PM2 logs/HTTP
 * response через `error` поле — undici иногда включает upstream URL в
 * сообщения сетевых ошибок.
 */
function redactProxy(text) {
  if (!text) return text;
  return String(text).replace(/(http[s]?:\/\/[^:]+:)[^@]+(@)/g, '$1***$2');
}

/**
 * Сетевые ошибки, по которым имеет смысл повторить запрос. Видим их по
 * факту в проде (выгрузка bot_message_log на 9.05.2026: timeout / fetch
 * failed = 27 из 40 попыток за 48 часов). Это сигнал нестабильного канала
 * между сервером и api.telegram.org, не отказ Telegram.
 *
 * НЕ ретраим: PEER_ID_INVALID, BUSINESS_PEER_USAGE_MISSING, BAD_REQUEST,
 * UNAUTHORIZED — это permanent-причины, повтор только нагрузит канал.
 */
const RETRIABLE_PATTERNS = [
  /timeout/i,
  /aborted/i,
  /fetch failed/i,
  /econnreset/i,
  /econnrefused/i,
  /ehostunreach/i,
  /enetunreach/i,
  /etimedout/i,
];

const SEND_RETRY_DELAYS_MS = [1_000, 3_000, 8_000];

function isRetriableError(text) {
  if (!text) return false;
  return RETRIABLE_PATTERNS.some((rx) => rx.test(text));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBotToken() {
  return (process.env.BOT_TOKEN || '').trim();
}

/**
 * Скрывает BOT_TOKEN и credentials прокси, если они попали в текст ошибки
 * (Node может включать request URL в err.message/err.cause). Без этого
 * секреты могли бы утечь в stdout / PM2 logs / HTTP response.
 */
function redactToken(text) {
  if (!text) return text;
  const token = getBotToken();
  let result = String(text);
  if (token) result = result.split(token).join('[BOT_TOKEN]');
  return redactProxy(result);
}

/**
 * Один сетевой запрос к sendMessage без retry-логики. Возвращает
 * { ok, telegramMessageId? } при успехе и { ok: false, error, retriable }
 * при отказе. retriable=true означает «можно попробовать ещё раз»
 * (timeout / connect / fetch failed). Для permanent-ошибок Telegram
 * (BAD_REQUEST, UNAUTHORIZED, PEER_ID_INVALID и т.п.) — false.
 */
async function sendMessageOnce({ businessConnectionId, chatId, text, token, parseMode = null }) {
  try {
    const fetchOptions = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: String(chatId),
        text: String(text),
        business_connection_id: String(businessConnectionId),
        ...(parseMode ? { parse_mode: 'HTML' } : {}),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };
    if (proxyDispatcher) fetchOptions.dispatcher = proxyDispatcher;
    const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, fetchOptions);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) {
      const description = redactToken(data?.description || `http_${response.status}`);
      // 5xx со стороны Telegram — редко, но имеет смысл повторить.
      // 4xx (Bad Request, Unauthorized, PEER_ID_INVALID) — permanent.
      const retriable = response.status >= 500 && response.status <= 599;
      return { ok: false, error: description, retriable };
    }
    const telegramMessageId = data.result?.message_id ?? null;
    if (telegramMessageId === null) {
      console.warn('[telegram-business-api] sendMessage ok=true without message_id');
    }
    return { ok: true, telegramMessageId };
  } catch (err) {
    const rawText = err instanceof Error ? err.message : String(err);
    const errorText = redactToken(rawText);
    return { ok: false, error: errorText, retriable: isRetriableError(errorText) };
  }
}

/**
 * Отправляет сообщение от имени владельца Business-аккаунта с retry на
 * сетевых ошибках.
 *
 * Контекст: на проде канал между сервером и api.telegram.org нестабилен
 * (хостер режет / RU-блокировка). Замер 9.05.2026 показал 27/40 = 67%
 * timeout-ов. Чтобы один сетевой блип не превращался в потерянное
 * сообщение клиенту, делаем три попытки с паузами 1с/3с/8с. Permanent-
 * ошибки (BAD_REQUEST: PEER_ID_INVALID и т.п.) не ретраим — это бесполезно.
 *
 * @param {object} args
 * @param {string} args.businessConnectionId — id из business_connection update
 * @param {string|number} args.chatId — id чата с клиентом
 * @param {string} args.text — текст сообщения
 * @param {string|null} [args.parseMode] — разрешён только HTML для доверенных шаблонов
 * @returns {Promise<{ok: boolean, telegramMessageId?: number|null, error?: string, attempts?: number}>}
 */
export async function sendBusinessMessage({
  businessConnectionId,
  chatId,
  text,
  parseMode = null,
} = {}) {
  if (!businessConnectionId || !chatId || !text) {
    return { ok: false, error: 'invalid_payload' };
  }
  const token = getBotToken();
  if (!token) {
    return { ok: false, error: 'bot_token_missing' };
  }
  let normalizedParseMode;
  try {
    normalizedParseMode = normalizeTelegramParseMode(parseMode);
  } catch {
    return { ok: false, error: 'invalid_parse_mode' };
  }

  let lastError = null;
  // 1 первая попытка + до 3 retry → максимум 4 попытки.
  const maxAttempts = SEND_RETRY_DELAYS_MS.length + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await sendMessageOnce({
      businessConnectionId,
      chatId,
      text,
      token,
      parseMode: normalizedParseMode,
    });
    if (result.ok) {
      return { ok: true, telegramMessageId: result.telegramMessageId, attempts: attempt };
    }
    lastError = result.error;
    if (!result.retriable || attempt === maxAttempts) {
      console.error(
        `[telegram-business-api] sendMessage failed (attempt ${attempt}/${maxAttempts}, retriable=${result.retriable}):`,
        result.error,
      );
      return { ok: false, error: result.error, attempts: attempt };
    }
    // Пауза перед следующей попыткой. Индекс delays — это «после какой
    // попытки ждать», поэтому attempt - 1.
    const delay = SEND_RETRY_DELAYS_MS[attempt - 1];
    console.warn(
      `[telegram-business-api] retriable error (attempt ${attempt}/${maxAttempts}), wait ${delay}ms:`,
      result.error,
    );
    await sleep(delay);
  }
  return { ok: false, error: lastError || 'send_failed' };
}

/**
 * Проверка валидности BOT_TOKEN через getMe. Используется в /bot/status,
 * чтобы UI отличал «токен не задан» от «токен задан, но сломан / Telegram
 * вернул 401».
 *
 * Кэшируется в памяти. Раздельные TTL:
 *   - success: 60с — health-check на каждый рендер админки был бы перебором.
 *   - failure: 10с — если Telegram временно отвечает 5xx или сеть моргнула,
 *     не залипаем на минуту с ложным «токен битый», но и не штормим API
 *     (без кэша network-flap превратится в десятки запросов в секунду).
 */
let getMeCache = null; // { value, expiresAt }
const GET_ME_TTL_OK_MS = 60_000;
const GET_ME_TTL_FAIL_MS = 10_000;

export async function checkBotTokenLive() {
  const token = getBotToken();
  if (!token) return { ok: false, reason: 'token_missing' };
  if (getMeCache && Date.now() < getMeCache.expiresAt) {
    return getMeCache.value;
  }
  let result;
  try {
    const fetchOptions = {
      method: 'GET',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };
    if (proxyDispatcher) fetchOptions.dispatcher = proxyDispatcher;
    const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/getMe`, fetchOptions);
    const data = await response.json().catch(() => ({}));
    result =
      response.ok && data?.ok
        ? {
            ok: true,
            username: data.result?.username,
            can_connect_to_business: data.result?.can_connect_to_business ?? false,
          }
        : {
            ok: false,
            reason: redactToken(data?.description || `http_${response.status}`),
          };
  } catch (err) {
    const rawText = err instanceof Error ? err.message : String(err);
    result = { ok: false, reason: redactToken(rawText) };
  }
  // Кэшируем оба исхода, но с разным TTL — иначе network-storm на падающем
  // канале ляжет на Telegram API.
  const ttl = result.ok ? GET_ME_TTL_OK_MS : GET_ME_TTL_FAIL_MS;
  getMeCache = { value: result, expiresAt: Date.now() + ttl };
  return result;
}
