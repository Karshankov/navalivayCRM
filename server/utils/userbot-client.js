/**
 * Bridge от api-процесса к userbot-процессу через локальный HTTP.
 *
 * Зачем отдельный процесс: GramJS держит постоянное MTProto-соединение,
 * перезапуск api при каждом деплое его рвал бы. Userbot живёт в своём
 * PM2-процессе `navalivay-userbot`, рестартится отдельно.
 *
 * Контракт:
 *   - sendViaUserbot({ chatId, text, orderId? }) →
 *       { ok: true, telegram_message_id }
 *       { ok: false, outcome: 'rejected'|'unreachable'|'ambiguous', error }
 *   - isUserbotAvailable() → быстрая (1.5s timeout) проверка /health с кэшем
 *     30с success / 10с failure. Учитывает session_dead из ответа userbot.
 *
 * Идемпотентность:
 *   userbot НЕ имеет idempotency-key — повторная отправка = дубль в чате.
 *   Поэтому caller обязан смотреть outcome:
 *     - 'rejected' / 'unreachable' → fallback на business mode безопасен
 *     - 'ambiguous'                → НЕ fallback'ить (риск дубля у клиента)
 *
 * Caller (auto-notify.js) и /bot/send-custom применяют этот протокол —
 * см. комментарий у функции sendViaUserbot ниже.
 */

import { normalizeTelegramParseMode } from './telegram-message-format.js';

const USERBOT_BASE = `http://127.0.0.1:${process.env.USERBOT_HTTP_PORT || 8083}`;
const SHARED_SECRET = (process.env.USERBOT_SECRET || '').trim();
const HEALTH_TIMEOUT_MS = 1500;
const SEND_TIMEOUT_MS = 20_000;

/**
 * Кэш health-status на 30 секунд: при шторме исходящих не дёргать /health
 * перед каждой отправкой. Если userbot фоллнул — кэш «не доступен» на 30с
 * и api-процесс пойдёт сразу на Business mode fallback, не теряя
 * время на тщетные запросы.
 */
let healthCache = null; // { value: boolean, expiresAt: number }
const HEALTH_CACHE_OK_MS = 30_000;
const HEALTH_CACHE_FAIL_MS = 10_000;

/**
 * Test-only helper: сбросить кэш health-проверки. Используется в unit-тестах
 * для изоляции между кейсами (модульный стейт иначе утекает между тестами,
 * порядок выполнения становится значимым). Underscore-префикс — соглашение,
 * что это приватный хук, прод-код этим не пользуется.
 */
export function _resetHealthCacheForTests() {
  healthCache = null;
}

/**
 * Классифицирует ошибку fetch на 'unreachable' (точно не отправил, fallback
 * безопасен) vs 'ambiguous' (мог отправить, fallback приведёт к дублю).
 *
 * Node18+ undici оборачивает сетевые ошибки в `TypeError: fetch failed`
 * с реальной ошибкой в `err.cause` — поэтому проверяем оба уровня.
 *
 * Безопасные для fallback (точно не доехало):
 *   - ECONNREFUSED  — процесс не слушает порт
 *   - ENOTFOUND     — DNS не разрешился (нерелевантно для 127.0.0.1, но всё же)
 *   - EAI_AGAIN     — DNS-таймаут
 *   - getaddrinfo ENOTFOUND
 *   - только ошибки, которые однозначно произошли до соединения
 *
 * Опасные для fallback (могло долететь):
 *   - timeout / AbortError — userbot мог получить запрос, ответ не успел
 *   - ECONNRESET — по коду ошибки нельзя доказать, на какой фазе оборвалось
 *     соединение; запрос уже мог быть принят и отправлен в Telegram
 *   - всё остальное — по умолчанию считаем ambiguous (fail-safe)
 */
function classifyFetchError(err) {
  const cause = err?.cause;
  const causeCode = cause?.code || '';
  const causeMessage = cause?.message || '';
  const errorText = err instanceof Error ? err.message : String(err);
  const combined = `${errorText}|${causeCode}|${causeMessage}`;

  // Timeout/abort — мог дойти, ответ потерян → ambiguous.
  if (
    err?.name === 'TimeoutError' ||
    err?.name === 'AbortError' ||
    /timeout|aborted/i.test(errorText)
  ) {
    return { ok: false, outcome: 'ambiguous', error: errorText };
  }

  // Точно не отправил — безопасно fallback'ить.
  const unreachableCodes = ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH'];
  if (unreachableCodes.some((code) => combined.includes(code))) {
    return { ok: false, outcome: 'unreachable', error: errorText };
  }
  // По умолчанию — fail-safe ambiguous: лучше упустить сообщение, чем
  // отправить дубль клиенту в чат (это гораздо более позорный UX).
  return { ok: false, outcome: 'ambiguous', error: errorText };
}

export async function isUserbotAvailable() {
  if (healthCache && Date.now() < healthCache.expiresAt) {
    return healthCache.value;
  }
  let ok = false;
  try {
    const r = await fetch(`${USERBOT_BASE}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (r.ok) {
      const data = await r.json().catch(() => ({}));
      // session_dead = userbot держит TCP-соединение, но Telegram отозвал
      // сессию (AUTH_KEY_UNREGISTERED) — все sendMessage будут падать.
      // Не считаем такой userbot доступным, чтобы api сразу шёл в business
      // mode без бессмысленной попытки.
      ok = Boolean(data?.ok && data?.connected && !data?.session_dead);
    }
  } catch {
    ok = false;
  }
  healthCache = {
    value: ok,
    expiresAt: Date.now() + (ok ? HEALTH_CACHE_OK_MS : HEALTH_CACHE_FAIL_MS),
  };
  return ok;
}

/**
 * Отправить сообщение через userbot.
 *
 * Возвращает:
 *   { ok: true, telegram_message_id }                 — точно отправлено
 *   { ok: false, outcome: 'rejected', error }         — userbot ответил отказом
 *   { ok: false, outcome: 'unreachable', error }      — userbot недоступен
 *   { ok: false, outcome: 'ambiguous', error }        — неизвестно, мог отправить
 *
 * `outcome` критичен для caller'а:
 *  - rejected   → fallback на business mode безопасен (userbot гарантированно
 *                 не отправил — клиент не получит дубль).
 *  - unreachable→ fallback тоже безопасен (соединение даже не установилось).
 *  - ambiguous  → fallback ОПАСЕН: userbot мог отправить, но ответ потерялся
 *                 (timeout, разрыв TCP, kill процесса в момент write). Дубль
 *                 в Telegram-чате клиента — позорный UX. Caller должен в этом
 *                 случае не делать fallback и вернуть «неизвестно».
 */
export async function sendViaUserbot({
  chatId,
  text,
  parseMode = null,
  orderId = null,
  auto = false,
  username = null,
  verified = false,
} = {}) {
  if (!chatId || !text) {
    return { ok: false, outcome: 'rejected', error: 'invalid_payload' };
  }
  let normalizedParseMode;
  try {
    normalizedParseMode = normalizeTelegramParseMode(parseMode);
  } catch {
    return { ok: false, outcome: 'rejected', error: 'invalid_parse_mode' };
  }
  let response;
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (SHARED_SECRET) headers['X-Userbot-Secret'] = SHARED_SECRET;
    response = await fetch(`${USERBOT_BASE}/send-message`, {
      method: 'POST',
      headers,
      // `auto` — признак авто-уведомления для фильтра в crm-operations.js
      // (плашка failed на карточке). Получатель всегда задаётся chat_id;
      // username не используется userbot'ом для скрытого resolve при отправке.
      body: JSON.stringify({
        chat_id: String(chatId),
        text: String(text),
        ...(normalizedParseMode ? { parse_mode: normalizedParseMode } : {}),
        order_id: orderId,
        auto: auto === true,
        username: username ? String(username).replace(/^@/, '') : null,
        verified: verified === true,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (err) {
    // Сбрасываем health-кэш — соединение проблемное, в следующий раз
    // перепроверим (может уже мёртвый).
    healthCache = null;
    return classifyFetchError(err);
  }
  // Полученный HTTP-ответ ещё не доказывает, что сообщение не отправилось:
  // userbot мог успеть отправить его и потерять/повредить ответ. Поэтому
  // битый, неполный или противоречивый ответ всегда ambiguous.
  let data;
  try {
    data = await response.json();
  } catch {
    healthCache = null;
    return { ok: false, outcome: 'ambiguous', error: `http_${response.status}_bad_json` };
  }
  if (
    !data
    || typeof data !== 'object'
    || Array.isArray(data)
    || typeof data.ok !== 'boolean'
    || typeof response?.ok !== 'boolean'
    || !Number.isInteger(Number(response?.status))
    || response.ok !== (
      Number(response.status) >= 200 && Number(response.status) < 300
    )
    || (response.ok === false && data.ok === true)
  ) {
    healthCache = null;
    return {
      ok: false,
      outcome: 'ambiguous',
      error: `http_${response?.status ?? 'unknown'}_invalid_response`,
    };
  }
  if (!response.ok) {
    healthCache = null;
    const status = response.status;
    const errorCode = String(data.error || '');
    // Эти ответы формируются userbot до sendMessage либо при заведомо
    // нерабочей сессии. Telegram точно не принял новое сообщение.
    if (
      (status === 429 && errorCode === 'flood_wait')
      || (
        status === 503
        && ['disconnected', 'session_dead'].includes(errorCode)
      )
    ) {
      return {
        ok: false,
        outcome: 'unreachable',
        error: errorCode || `http_${status}`,
        retry_after_seconds: data?.retry_after_seconds,
      };
    }
    // 5xx после начала обработки может означать, что Telegram принял
    // сообщение, а userbot потерял результат. Автоповтор создаст дубль.
    if (status >= 500) {
      return {
        ok: false,
        outcome: 'ambiguous',
        error: errorCode || `http_${status}`,
      };
    }
    return {
      ok: false,
      outcome: 'rejected',
      error: errorCode || `http_${status}`,
    };
  }
  if (data.ok === false) {
    healthCache = null;
    return {
      ok: false,
      outcome: 'rejected',
      error: data.error || `http_${response.status}`,
    };
  }
  return { ok: true, telegram_message_id: data.telegram_message_id ?? null };
}

export async function listUserbotQuickReplies() {
  try {
    const headers = {};
    if (SHARED_SECRET) headers['X-Userbot-Secret'] = SHARED_SECRET;
    const response = await fetch(`${USERBOT_BASE}/quick-replies`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) {
      return { ok: false, error: data?.error || `http_${response.status}` };
    }
    return { ok: true, quick_replies: data.quick_replies || [] };
  } catch (err) {
    return classifyFetchError(err);
  }
}

export async function sendQuickReplyViaUserbot({
  chatId,
  shortcut,
  idempotencyKey,
} = {}) {
  if (!chatId || !shortcut || !idempotencyKey) {
    return { ok: false, outcome: 'rejected', error: 'invalid_payload' };
  }
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (SHARED_SECRET) headers['X-Userbot-Secret'] = SHARED_SECRET;
    const response = await fetch(`${USERBOT_BASE}/send-quick-reply`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        chat_id: String(chatId),
        shortcut: String(shortcut),
        idempotency_key: String(idempotencyKey),
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data?.ok) {
      return {
        ok: true,
        shortcut: data.shortcut,
        telegram_message_ids: data.telegram_message_ids || [],
      };
    }
    if (response.status === 429 || response.status === 503) {
      return {
        ok: false,
        outcome: 'unreachable',
        error: data?.error || `http_${response.status}`,
        retry_after_seconds: data?.retry_after_seconds,
      };
    }
    return {
      ok: false,
      outcome: 'rejected',
      error: data?.error || `http_${response.status}`,
    };
  } catch (err) {
    return classifyFetchError(err);
  }
}

/**
 * Явная подготовка Telegram entity перед первым auto-notify. В критической
 * цепочке caller обязан дождаться результата; второстепенные места могут
 * запускать её заранее без ожидания.
 *
 * Контракт:
 *   - resolveUsernameViaUserbot({ username, expectedTelegramId? }) → Promise<{ ok, error? }>
 *   - Без таймаута на уровне caller'а — 5s AbortSignal внутри.
 *   - Не бросает исключений (все ошибки возвращаются в { ok: false }).
 *   - Не влияет на основной поток создания заказа.
 *
 * @param {object} args
 * @param {string} args.username — telegram username без @
 * @param {string|null} [args.expectedTelegramId] — подписанный Telegram ID клиента
 * @returns {Promise<{ ok: boolean, error?: string, telegram_id?: string }>}
 */
export async function resolveUsernameViaUserbot({ username, expectedTelegramId = null } = {}) {
  if (!username) {
    return { ok: false, error: 'username_required' };
  }
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (SHARED_SECRET) headers['X-Userbot-Secret'] = SHARED_SECRET;
    const response = await fetch(`${USERBOT_BASE}/resolve-username`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        username: String(username).replace(/^@/, ''),
        expected_telegram_id: expectedTelegramId ? String(expectedTelegramId) : null,
      }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await response.json();
    if (response.ok && data?.ok) {
      if (
        expectedTelegramId &&
        data.telegram_id &&
        String(data.telegram_id) !== String(expectedTelegramId)
      ) {
        return {
          ok: false,
          error: 'telegram_id_mismatch',
          telegram_id: String(data.telegram_id),
        };
      }
      return { ok: true, telegram_id: data.telegram_id };
    }
    return { ok: false, error: data?.error || `http_${response.status}` };
  } catch (err) {
    // Fire-and-forget — caller не должен падать. Не обновляем healthCache
    // (это не send-message, resolve может быть временно недоступен).
    const cause = err?.cause?.code || err?.code || '';
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `${msg}${cause ? ` (${cause})` : ''}` };
  }
}
