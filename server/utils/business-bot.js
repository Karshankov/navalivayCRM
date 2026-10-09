/**
 * Бот в Telegram Business-режиме — серверный движок.
 *
 * Сервис ничего не знает о Telegraf — здесь только бизнес-логика и доступ к БД.
 * Адаптер с Telegram сидит в `server/bot.js`, который вызывает функции отсюда.
 *
 * Контракт:
 *  - Лайвсайкл подключения: registerBusinessConnection / removeBusinessConnection
 *  - Quick replies: list/get/create/update/delete + matchQuickReply (нормализация)
 *  - Status templates: list/upsert + getStatusTemplate(event) + renderStatusTemplate
 *  - Логирование: logBotMessage, listBotLog, getRecentLogCount
 *  - Верификация клиента: generateVerificationCode, attachVerificationCode,
 *    confirmVerificationOnAccess, isCustomerVerified
 *  - Master switch: isAutoReplyEnabled / setAutoReplyEnabled
 *  - Variables: buildOrderVariables(order) для шаблонов статусов
 *  - Высокоуровневые: handleIncomingBusinessMessage, prepareStatusNotification
 *
 * Быстрые ответы не уходят «новым» клиентам (нет выданного/завершённого заказа) —
 * тот же принцип, что и order_accepted в auto-notify.js.
 */
import crypto from 'crypto';
import {
  getActivePickupCellAssignment,
  getLatestPickupCellAssignment,
} from './pickup-cells.js';
import { db } from '../db.js';
import { isCustomerAccessAuthorized } from './referral-authorization.js';
import { getActiveBlockForCustomerId } from './customer-blocks.js';
import {
  convertLegacyTelegramMarkup,
  escapeTelegramHtml,
  TELEGRAM_HTML_PARSE_MODE,
} from './telegram-message-format.js';

// =============================================================================
// Константы
// =============================================================================

/** Допустимые ключи событий для bot_status_templates.event. Расширять здесь. */
export const BOT_STATUS_EVENTS = Object.freeze([
  'order_accepted',
  'order_assembled',
  'order_issued',
  'order_cancelled',
  'price_list',
  'welcome',
]);

/** TTL верификационного кода — 30 дней. После истечения клиент должен снова
 * получить прайс с кодом. Заведомо длинный срок: код одноразовый по факту,
 * клиент пользуется им один раз при первом входе в Mini App. */
export const VERIFICATION_CODE_TTL_DAYS = 30;

/** Лимит на длину user-ввода — защита от спама в БД. */
const MAX_TITLE_LENGTH = 200;
const MAX_KEYWORDS_TOTAL_LENGTH = 1000;
const MAX_RESPONSE_LENGTH = 4000;
const MAX_TEMPLATE_BODY_LENGTH = 4000;

// =============================================================================
// Connection lifecycle
// =============================================================================

function rowToConnection(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    user_id: row.user_id ? String(row.user_id) : null,
    user_chat_id: row.user_chat_id ? String(row.user_chat_id) : null,
    username: row.username ?? null,
    first_name: row.first_name ?? null,
    last_name: row.last_name ?? null,
    is_enabled: Number(row.is_enabled) ? 1 : 0,
    can_reply: Number(row.can_reply) ? 1 : 0,
    connected_at: row.connected_at ?? null,
    disconnected_at: row.disconnected_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}

/**
 * Сохранить/обновить запись о business connection. Telegram присылает апдейты
 * `business_connection` при подключении/изменении/отключении. Мы переиспользуем
 * один и тот же id (Telegram гарантирует стабильность для одного коннекта).
 */
export function registerBusinessConnection({
  id,
  userId,
  userChatId,
  username,
  firstName,
  lastName,
  isEnabled,
  canReply,
} = {}) {
  if (!id) {
    const err = new Error('connection_id_required');
    err.code = 'connection_id_required';
    throw err;
  }
  if (!userId) {
    const err = new Error('user_id_required');
    err.code = 'user_id_required';
    throw err;
  }
  const stmt = db.prepare(`
    INSERT INTO business_connections
      (id, user_id, user_chat_id, username, first_name, last_name, is_enabled, can_reply, connected_at, disconnected_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, DATETIME('now'), NULL, DATETIME('now'))
    ON CONFLICT(id) DO UPDATE SET
      user_id = excluded.user_id,
      user_chat_id = excluded.user_chat_id,
      username = excluded.username,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      is_enabled = excluded.is_enabled,
      can_reply = excluded.can_reply,
      -- Reconnect (после disconnected) сбрасывает обе timestamp'ы, чтобы
      -- ORDER BY connected_at DESC корректно показывал самое свежее
      -- активное подключение в getActiveBusinessConnection.
      connected_at = CASE
        WHEN business_connections.disconnected_at IS NOT NULL
          THEN DATETIME('now')
        ELSE business_connections.connected_at
      END,
      disconnected_at = NULL,
      updated_at = DATETIME('now')
  `);
  stmt.run(
    String(id),
    String(userId),
    userChatId ? String(userChatId) : null,
    username ?? null,
    firstName ?? null,
    lastName ?? null,
    isEnabled ? 1 : 0,
    canReply ? 1 : 0,
  );
  return getBusinessConnection(id);
}

/** Помечает соединение как отключённое (но не удаляет — для аудита). */
export function removeBusinessConnection(id) {
  if (!id) return 0;
  const result = db
    .prepare(
      `UPDATE business_connections
          SET is_enabled = 0,
              can_reply = 0,
              disconnected_at = DATETIME('now'),
              updated_at = DATETIME('now')
        WHERE id = ?`,
    )
    .run(String(id));
  return result.changes;
}

export function getBusinessConnection(id) {
  if (!id) return null;
  const row = db
    .prepare(`SELECT * FROM business_connections WHERE id = ?`)
    .get(String(id));
  return rowToConnection(row);
}

/** Все коннекты (включая отключённые) — для админки. */
export function listBusinessConnections() {
  return db
    .prepare(
      `SELECT * FROM business_connections
         ORDER BY (disconnected_at IS NULL) DESC, connected_at DESC`,
    )
    .all()
    .map(rowToConnection);
}

/** Активный коннект (для отправки сообщений). Возвращает первый
 * is_enabled=1 AND can_reply=1 AND disconnected_at IS NULL.
 *
 * Пустая таблица business_connections полностью глушит отправку бизнес-сообщений:
 * маршруты возвращают no_active_connection, не обращаясь к сети. Этим удобно
 * пользоваться на тестовых стендах — гарантия, что стенд физически не напишет
 * живому человеку. Проверено прогоном: POST /api/admin/crm/bot/send-custom с
 * валидным клиентом отвечает 400 no_active_connection. */
export function getActiveBusinessConnection() {
  const row = db
    .prepare(
      `SELECT * FROM business_connections
         WHERE is_enabled = 1
           AND can_reply = 1
           AND disconnected_at IS NULL
         ORDER BY connected_at DESC
         LIMIT 1`,
    )
    .get();
  return rowToConnection(row);
}

// =============================================================================
// Quick replies
// =============================================================================

function rowToQuickReply(row) {
  if (!row) return null;
  let keywords = [];
  try {
    const parsed = JSON.parse(row.keywords ?? '[]');
    keywords = Array.isArray(parsed) ? parsed.map((k) => String(k)) : [];
  } catch {
    keywords = [];
  }
  return {
    id: Number(row.id),
    title: String(row.title ?? ''),
    keywords,
    response_text: String(row.response_text ?? ''),
    is_active: Number(row.is_active) ? 1 : 0,
    sort_order: Number(row.sort_order ?? 0),
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}

/**
 * Нормализация для матчера: lower-case, убираем диакритику, ё→е и любые
 * не-буквенно-цифровые символы заменяем на пробел (потом split по \s+).
 * Это даёт стабильный токенайзер, при котором «часы!» матчится точно так
 * же как «часы» — пунктуация не ломает «exact word match».
 */
export function normalizeForMatch(text) {
  if (text === undefined || text === null) return '';
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    // диакритика
    .replace(/\p{Diacritic}/gu, '')
    // ё → е (Telegram-копипаста часто разнится)
    .replace(/ё/g, 'е')
    // пунктуация / эмодзи / прочее не-буквенно-не-цифровое → пробел
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    // схлопываем подряд идущие пробелы
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeKeywordsList(rawList) {
  if (!Array.isArray(rawList)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of rawList) {
    const value = String(raw ?? '').trim();
    if (!value) continue;
    const norm = normalizeForMatch(value);
    if (!norm) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(value);
  }
  return out;
}

function validateQuickReplyPayload(payload) {
  const title = String(payload?.title ?? '').trim();
  if (!title) {
    const err = new Error('title_required');
    err.code = 'title_required';
    throw err;
  }
  if (title.length > MAX_TITLE_LENGTH) {
    const err = new Error('title_too_long');
    err.code = 'title_too_long';
    throw err;
  }
  const responseText = String(payload?.response_text ?? '').trim();
  if (!responseText) {
    const err = new Error('response_required');
    err.code = 'response_required';
    throw err;
  }
  if (responseText.length > MAX_RESPONSE_LENGTH) {
    const err = new Error('response_too_long');
    err.code = 'response_too_long';
    throw err;
  }
  const keywords = normalizeKeywordsList(payload?.keywords);
  const keywordsTotal = keywords.join(' ').length;
  if (keywordsTotal > MAX_KEYWORDS_TOTAL_LENGTH) {
    const err = new Error('keywords_too_long');
    err.code = 'keywords_too_long';
    throw err;
  }
  return { title, responseText, keywords };
}

export function listQuickReplies({ activeOnly = false } = {}) {
  const rows = activeOnly
    ? db
        .prepare(
          `SELECT * FROM bot_quick_replies
            WHERE is_active = 1
            ORDER BY sort_order ASC, id ASC`,
        )
        .all()
    : db
        .prepare(
          `SELECT * FROM bot_quick_replies
            ORDER BY sort_order ASC, id ASC`,
        )
        .all();
  return rows.map(rowToQuickReply);
}

export function getQuickReply(id) {
  const numericId = Number(id);
  if (!Number.isFinite(numericId) || numericId <= 0) return null;
  const row = db
    .prepare(`SELECT * FROM bot_quick_replies WHERE id = ?`)
    .get(numericId);
  return rowToQuickReply(row);
}

export function createQuickReply(payload = {}) {
  const { title, responseText, keywords } = validateQuickReplyPayload(payload);
  const isActive = payload.is_active === undefined ? 1 : payload.is_active ? 1 : 0;
  const sortOrderRaw = Number(payload.sort_order);
  const sortOrder = Number.isFinite(sortOrderRaw) && sortOrderRaw >= 0 ? Math.trunc(sortOrderRaw) : 0;
  const result = db
    .prepare(
      `INSERT INTO bot_quick_replies (title, keywords, response_text, is_active, sort_order)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(title, JSON.stringify(keywords), responseText, isActive, sortOrder);
  return getQuickReply(result.lastInsertRowid);
}

export function updateQuickReply(id, payload = {}) {
  const existing = getQuickReply(id);
  if (!existing) {
    const err = new Error('quick_reply_not_found');
    err.code = 'quick_reply_not_found';
    throw err;
  }
  const merged = {
    title: payload.title !== undefined ? payload.title : existing.title,
    response_text:
      payload.response_text !== undefined ? payload.response_text : existing.response_text,
    keywords: payload.keywords !== undefined ? payload.keywords : existing.keywords,
  };
  const { title, responseText, keywords } = validateQuickReplyPayload(merged);
  const nextActive =
    payload.is_active === undefined ? existing.is_active : payload.is_active ? 1 : 0;
  const nextSortRaw = payload.sort_order === undefined ? existing.sort_order : Number(payload.sort_order);
  const nextSort = Number.isFinite(nextSortRaw) && nextSortRaw >= 0 ? Math.trunc(nextSortRaw) : 0;
  db.prepare(
    `UPDATE bot_quick_replies
        SET title = ?, keywords = ?, response_text = ?, is_active = ?, sort_order = ?, updated_at = DATETIME('now')
      WHERE id = ?`,
  ).run(title, JSON.stringify(keywords), responseText, nextActive, nextSort, Number(id));
  return getQuickReply(id);
}

export function deleteQuickReply(id) {
  const numericId = Number(id);
  if (!Number.isFinite(numericId) || numericId <= 0) return 0;
  return db.prepare(`DELETE FROM bot_quick_replies WHERE id = ?`).run(numericId).changes;
}

/**
 * Найти подходящий quick-reply для входящего сообщения.
 *
 * Алгоритм: нормализуем текст и keywords, ищем первое совпадение по
 * substring. Возвращаем самый высокоприоритетный (sort_order ASC, id ASC).
 * Случай нескольких совпадений: выигрывает тот, у кого хотя бы одно ключевое
 * слово полностью совпадает с словом в тексте — иначе fallback на substring.
 */
export function matchQuickReply(text) {
  const normText = normalizeForMatch(text);
  if (!normText) return null;
  const replies = listQuickReplies({ activeOnly: true });
  if (replies.length === 0) return null;

  const tokenSet = new Set(normText.split(/\s+/).filter(Boolean));

  let substringHit = null;
  for (const reply of replies) {
    const normKeywords = reply.keywords.map(normalizeForMatch).filter(Boolean);
    if (normKeywords.length === 0) continue;
    let hasSubstring = false;
    for (const kw of normKeywords) {
      // Точное совпадение по слову — приоритет
      if (tokenSet.has(kw)) {
        return reply;
      }
      if (!hasSubstring && normText.includes(kw)) {
        hasSubstring = true;
      }
    }
    if (hasSubstring && !substringHit) {
      substringHit = reply;
    }
  }
  return substringHit;
}

// =============================================================================
// Status templates
// =============================================================================

function rowToStatusTemplate(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    event: String(row.event ?? ''),
    title: String(row.title ?? ''),
    body: String(row.body ?? ''),
    is_active: Number(row.is_active) ? 1 : 0,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}

export function listStatusTemplates() {
  return db
    .prepare(`SELECT * FROM bot_status_templates ORDER BY id ASC`)
    .all()
    .map(rowToStatusTemplate);
}

export function getStatusTemplate(event) {
  const row = db
    .prepare(`SELECT * FROM bot_status_templates WHERE event = ?`)
    .get(String(event ?? ''));
  return rowToStatusTemplate(row);
}

export function upsertStatusTemplate(event, payload = {}) {
  if (!BOT_STATUS_EVENTS.includes(event)) {
    const err = new Error('invalid_event');
    err.code = 'invalid_event';
    throw err;
  }
  const title = String(payload?.title ?? '').trim();
  if (title.length > MAX_TITLE_LENGTH) {
    const err = new Error('title_too_long');
    err.code = 'title_too_long';
    throw err;
  }
  const body = String(payload?.body ?? '').trim();
  if (body.length > MAX_TEMPLATE_BODY_LENGTH) {
    const err = new Error('body_too_long');
    err.code = 'body_too_long';
    throw err;
  }
  const isActive = payload.is_active === undefined ? 1 : payload.is_active ? 1 : 0;
  db.prepare(
    `INSERT INTO bot_status_templates (event, title, body, is_active)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(event) DO UPDATE SET
       title = excluded.title,
       body = excluded.body,
       is_active = excluded.is_active,
       updated_at = DATETIME('now')`,
  ).run(event, title, body, isActive);
  return getStatusTemplate(event);
}

/**
 * Подстановка переменных в шаблон.
 *
 * Поддерживаемые ключи: order_number (короткий клиентский номер), final_amount, total_amount,
 * customer_name, customer_username, pickup_cell_number, verification_code, store_name.
 * Неизвестные {placeholder} оставляются как есть (защита от опечатки —
 * Костя должен увидеть, что переменная не подставилась).
 */
export function renderTemplate(
  body,
  variables = {},
  { escapeValues = false } = {},
) {
  const safe = String(body ?? '');
  return safe.replace(/\{(\w+)\}/g, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(variables, key)) {
      return match;
    }
    const value = variables[key];
    if (value === null || value === undefined) return '';
    return escapeValues ? escapeTelegramHtml(value) : String(value);
  });
}

export function normalizeCustomerOrderTerminology(value) {
  const customerTermByEnding = {
    '': 'заказ', а: 'заказ', и: 'заказа', у: 'заказ', е: 'заказе',
    ой: 'заказом', ою: 'заказом', ам: 'заказам', ами: 'заказами', ах: 'заказах',
  };
  const keepCase = (replacement, source) => {
    if (source === source.toUpperCase()) return replacement.toUpperCase();
    if (source[0] === source[0]?.toUpperCase()) {
      return replacement[0].toUpperCase() + replacement.slice(1);
    }
    return replacement;
  };
  const determinerGroups = {
    ваша: 'ваш', вашей: 'ваш', вашу: 'ваш',
    эта: 'эт', этой: 'эт', эту: 'эт',
    наша: 'наш', нашей: 'наш', нашу: 'наш',
    данная: 'данн', данной: 'данн', данную: 'данн',
  };
  const determinerByGroupAndNounEnding = {
    ваш: { а: 'ваш', и: 'вашего', у: 'ваш', е: 'вашем', ой: 'вашим', ою: 'вашим' },
    эт: { а: 'этот', и: 'этого', у: 'этот', е: 'этом', ой: 'этим', ою: 'этим' },
    наш: { а: 'наш', и: 'нашего', у: 'наш', е: 'нашем', ой: 'нашим', ою: 'нашим' },
    данн: { а: 'данный', и: 'данного', у: 'данный', е: 'данном', ой: 'данным', ою: 'данным' },
  };
  const adjectiveEndingByNounEnding = {
    а: { ая: 'ый', яя: 'ий' },
    и: { ой: 'ого', ей: 'его' },
    у: { ую: 'ый', юю: 'ий' },
    е: { ой: 'ом', ей: 'ем' },
    ой: { ой: 'ым', ей: 'им' },
    ою: { ой: 'ым', ей: 'им' },
  };
  const phraseBoundary = '(?=\\s|[.,!?;:)\\]}\u00bb"\'\u2014-]|$)';
  let normalized = String(value ?? '').replace(
    new RegExp(
      `(^|[\\s([{\u00ab"'\u2014-])(ваша|вашей|вашу|эта|этой|эту|наша|нашей|нашу|данная|данной|данную)\\s+ячейк(а|и|у|е|ой|ою)${phraseBoundary}`,
      'gi',
    ),
    (match, prefix, determiner, nounEnding) => {
      const group = determinerGroups[determiner.toLowerCase()];
      const replacement = determinerByGroupAndNounEnding[group]?.[nounEnding.toLowerCase()];
      return `${prefix}${keepCase(replacement, determiner)} ${customerTermByEnding[nounEnding.toLowerCase()]}`;
    },
  ).replace(
    new RegExp(
      `(^|[\\s([{\u00ab"'\u2014-])([\\p{L}-]+?)(ая|яя|ой|ей|ую|юю)\\s+ячейк(а|и|у|е|ой|ою)${phraseBoundary}`,
      'giu',
    ),
    (match, prefix, stem, adjectiveEnding, nounEnding) => {
      const replacementEnding = adjectiveEndingByNounEnding[nounEnding.toLowerCase()]?.[
        adjectiveEnding.toLowerCase()
      ];
      if (!replacementEnding) return match;
      const inflectedEnding = adjectiveEnding === adjectiveEnding.toUpperCase()
        ? replacementEnding.toUpperCase()
        : replacementEnding;
      return `${prefix}${stem}${inflectedEnding} ${customerTermByEnding[nounEnding.toLowerCase()]}`;
    },
  );
  return normalized.replace(
    /ячейк(а|и|у|е|ой|ою|ам|ами|ах)?/gi,
    (match, ending = '') => keepCase(
      customerTermByEnding[String(ending).toLowerCase()] || 'заказ',
      match,
    ),
  ).replace(
    /(номер\s+(?:(?:вашего|этого|нашего|данного)\s+)?заказа)(?:\s*[:#№]\s*|\s+)(\d+)/gi,
    '$1 №$2',
  ).replace(
    /(заказ)(?:\s+номер\s+|\s*[:#№]\s*|\s+)(\d+)/gi,
    '$1 №$2',
  )
    .replace(
      /(заказ(?:\s+№\s*\d+)?\s+)(готова|собрана|свободна|занята|назначена)(?=\s|[.,!?;:]|$)/gi,
      (match, prefix, femininePredicate) => {
        const masculinePredicate = {
          готова: 'готов',
          собрана: 'собран',
          свободна: 'свободен',
          занята: 'занят',
          назначена: 'назначен',
        }[femininePredicate.toLowerCase()];
        return `${prefix}${keepCase(masculinePredicate, femininePredicate)}`;
      },
    );
}

function normalizeCustomerOrderTerminologyInHtml(value) {
  const source = String(value ?? '');
  let result = '';
  let textStart = 0;
  let tagStart = -1;
  let quote = null;

  for (let i = 0; i < source.length; i += 1) {
    const character = source[i];
    if (tagStart < 0) {
      if (character === '<') {
        result += normalizeCustomerOrderTerminology(source.slice(textStart, i));
        tagStart = i;
      }
      continue;
    }

    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '>') {
      result += source.slice(tagStart, i + 1);
      tagStart = -1;
      textStart = i + 1;
    }
  }

  if (tagStart >= 0) {
    result += normalizeCustomerOrderTerminology(source.slice(tagStart));
  } else {
    result += normalizeCustomerOrderTerminology(source.slice(textStart));
  }
  return result;
}

// =============================================================================
// Order → variables
// =============================================================================

/**
 * Подгружает переменные шаблона из заказа. Если order передан как объект —
 * используем его, иначе тянем по orderId.
 *
 * Возвращает: { order_number, final_amount, total_amount, customer_name,
 * customer_username, customer_telegram_id, payment_method, store_name }.
 */
export function buildOrderVariables(orderOrId, { storeName, pickupCell = null } = {}) {
  let order = orderOrId;
  if (typeof orderOrId === 'string' || typeof orderOrId === 'number') {
    order = db
      .prepare(`SELECT * FROM orders WHERE id = ?`)
      .get(String(orderOrId));
  }
  if (!order) return null;
  let customer = null;
  if (order.customer_id) {
    customer = db
      .prepare(`SELECT * FROM customers WHERE id = ?`)
      .get(order.customer_id);
  }
  // Имя клиента: сначала «Имя Фамилия» (если есть), затем @username, затем
  // generic «клиент». Скобки обязательны — без них `||` связывается тиже,
  // чем тернар, и при заполненных first/last_name текст становится «@undefined».
  const fullName = [customer?.first_name, customer?.last_name].filter(Boolean).join(' ').trim();
  const customerName =
    fullName ||
    (customer?.telegram_username ? `@${customer.telegram_username}` : 'клиент');
  const finalAmount = Number(order.final_amount ?? order.total_amount ?? 0);
  const totalAmount = Number(order.total_amount ?? 0);
  const paymentMethod =
    order.payment_type === 'card' && Number(order.card_amount_minor || 0) > 0
      ? 'По карте'
      : 'Наличными';
  const resolvedPickupCell =
    pickupCell ||
    getActivePickupCellAssignment(order.id) ||
    getLatestPickupCellAssignment(order.id);
  return {
    // В сообщениях клиенту «номер заказа» — короткий номер места выдачи.
    // Постоянный orders.order_number намеренно не отдаём в шаблонизатор.
    order_number: resolvedPickupCell?.cell_number ?? '',
    final_amount: Number.isFinite(finalAmount) ? finalAmount.toFixed(2).replace(/\.00$/, '') : '0',
    total_amount: Number.isFinite(totalAmount) ? totalAmount.toFixed(2).replace(/\.00$/, '') : '0',
    customer_name: customerName || 'клиент',
    customer_username: customer?.telegram_username || '',
    customer_telegram_id: customer?.telegram_id || '',
    payment_method: paymentMethod,
    pickup_cell_number: resolvedPickupCell?.cell_number ?? '',
    store_name: storeName || 'НАВАЛИВАЙ',
  };
}

// =============================================================================
// Verification (кодовая фраза для допуска в Mini App)
// =============================================================================

/**
 * Генерирует короткий читаемый код в формате `NV-XXXXXX` (6 base32-символов).
 * Использует исключённый алфавит (без `0/O`, `1/I`, `L/U`) для устойчивости
 * к перепечатыванию.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
export function generateVerificationCode() {
  const bytes = crypto.randomBytes(6);
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return `NV-${code}`;
}

/**
 * Привязать код к клиенту (после отправки прайса). Если клиент уже verified —
 * перезаписываем код (это «свежий пароль доступа», старый перестаёт работать).
 */
export function attachVerificationCode({ telegramId, code }) {
  if (!telegramId || !code) {
    const err = new Error('telegram_id_and_code_required');
    err.code = 'telegram_id_and_code_required';
    throw err;
  }
  const result = db
    .prepare(
      `UPDATE customers
          SET bot_verification_code = ?,
              updated_at = DATETIME('now')
        WHERE telegram_id = ?`,
    )
    .run(String(code), String(telegramId));
  return result.changes;
}

/**
 * Проставить отметку «клиент верифицирован» по telegram_id.
 *
 * Семантика: верификация — явный акт «менеджер выдал клиенту код через бот,
 * клиент его предъявил». Без кода функция отказывает (вернёт false). Старые
 * клиенты (`total_orders > 0`) считаются верифицированными автоматически
 * через `isCustomerVerified` без вызова этой функции.
 *
 * Возвращает true, только если код совпал с `customers.bot_verification_code`
 * по этому telegram_id и UPDATE действительно затронул строку. Это
 * закрывает дыру «POST /bot-verify с пустым body → клиент verified».
 */
export function confirmVerificationOnAccess({ telegramId, code = null }) {
  if (!telegramId) return false;
  const trimmedCode = String(code ?? '').trim();
  if (!trimmedCode) return false;
  const matched = db
    .prepare(
      `SELECT id FROM customers
        WHERE telegram_id = ?
          AND bot_verification_code = ?`,
    )
    .get(String(telegramId), trimmedCode);
  if (!matched) return false;
  const result = db
    .prepare(
      `UPDATE customers
          SET bot_verified_at = DATETIME('now'),
              updated_at = DATETIME('now')
        WHERE telegram_id = ?`,
    )
    .run(String(telegramId));
  return result.changes > 0;
}

/**
 * Проверка «верифицирован ли клиент». Возвращает true, если:
 *   - есть bot_verified_at, либо
 *   - total_orders > 0 (старый клиент, купивший до запуска фичи).
 */
export function isCustomerVerified(telegramId) {
  if (!telegramId) return false;
  const row = db
    .prepare(
      `SELECT bot_verified_at, total_orders
         FROM customers WHERE telegram_id = ?`,
    )
    .get(String(telegramId));
  if (!row) return false;
  if (row.bot_verified_at) return true;
  if (Number(row.total_orders) > 0) return true;
  return false;
}

// =============================================================================
// Settings: master switch для авто-ответов
// =============================================================================

export function isAutoReplyEnabled() {
  const row = db
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .get('bot_auto_replies_enabled');
  return Number(row?.value ?? 0) === 1;
}

export function setAutoReplyEnabled(enabled) {
  const value = enabled ? '1' : '0';
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run('bot_auto_replies_enabled', value);
  return Number(value) === 1;
}

// =============================================================================
// Логирование
// =============================================================================

export function logBotMessage({
  businessConnectionId = null,
  chatId,
  customerId = null,
  customerTelegramId = null,
  direction,
  messageType,
  templateKind = null,
  templateId = null,
  templateEvent = null,
  text = null,
  meta = null,
} = {}) {
  if (!chatId) return null;
  if (direction !== 'in' && direction !== 'out') {
    return null;
  }
  const result = db
    .prepare(
      `INSERT INTO bot_message_log
         (business_connection_id, chat_id, customer_id, customer_telegram_id,
          direction, message_type, template_kind, template_id, template_event, text, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      businessConnectionId ? String(businessConnectionId) : null,
      String(chatId),
      customerId ? String(customerId) : null,
      customerTelegramId ? String(customerTelegramId) : null,
      direction,
      messageType,
      templateKind,
      templateId !== null && templateId !== undefined ? Number(templateId) : null,
      templateEvent,
      text === null || text === undefined ? null : String(text),
      meta ? JSON.stringify(meta) : null,
    );
  return Number(result.lastInsertRowid);
}

export function listBotLog({ limit = 50, offset = 0, chatId = null } = {}) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 50));
  const safeOffset = Math.max(0, Number(offset) || 0);
  if (chatId) {
    return db
      .prepare(
        `SELECT * FROM bot_message_log
           WHERE chat_id = ?
           ORDER BY id DESC
           LIMIT ? OFFSET ?`,
      )
      .all(String(chatId), safeLimit, safeOffset)
      .map(parseLogRow);
  }
  return db
    .prepare(
      `SELECT * FROM bot_message_log
         ORDER BY id DESC
         LIMIT ? OFFSET ?`,
    )
    .all(safeLimit, safeOffset)
    .map(parseLogRow);
}

function parseLogRow(row) {
  let meta = null;
  if (row.meta) {
    try {
      meta = JSON.parse(row.meta);
    } catch {
      meta = null;
    }
  }
  return {
    id: Number(row.id),
    business_connection_id: row.business_connection_id ?? null,
    chat_id: String(row.chat_id),
    customer_id: row.customer_id ?? null,
    customer_telegram_id: row.customer_telegram_id ?? null,
    direction: row.direction,
    message_type: row.message_type,
    template_kind: row.template_kind ?? null,
    template_id: row.template_id ?? null,
    template_event: row.template_event ?? null,
    text: row.text ?? null,
    meta,
    created_at: row.created_at ?? null,
  };
}

export function getRecentLogCount({ sinceHours = 24 } = {}) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM bot_message_log
         WHERE created_at > DATETIME('now', ?)`,
    )
    .get(`-${Math.max(1, Number(sinceHours) || 24)} hours`);
  return Number(row?.n ?? 0);
}

// =============================================================================
// Высокоуровневые операции
// =============================================================================

/**
 * Готовит payload системного уведомления о статусе заказа.
 *
 * Возвращает { ok, reason?, text?, parseMode?, chatId?, templateId?, templateEvent?,
 * customerId?, customerTelegramId? }. Если ok=false — поле reason
 * объясняет почему отправка невозможна (нет подключения, нет шаблона,
 * у клиента нет telegram_id и т.п.). bot.js принимает решение, отправлять
 * или нет.
 */
export function prepareStatusNotification({ orderId, event, storeName, pickupCell = null } = {}) {
  if (!BOT_STATUS_EVENTS.includes(event)) {
    return { ok: false, reason: 'invalid_event' };
  }
  const order = db
    .prepare(`SELECT * FROM orders WHERE id = ?`)
    .get(String(orderId ?? ''));
  if (!order) {
    return { ok: false, reason: 'order_not_found' };
  }
  if (!order.customer_id) {
    return { ok: false, reason: 'order_has_no_customer' };
  }
  const customer = db
    .prepare(`SELECT * FROM customers WHERE id = ?`)
    .get(order.customer_id);
  if (!customer) {
    return { ok: false, reason: 'customer_not_found' };
  }
  if (!customer.telegram_id) {
    return { ok: false, reason: 'customer_has_no_telegram_id' };
  }
  if (event === 'order_accepted' || event === 'order_assembled') {
    const activePickupCell = getActivePickupCellAssignment(order.id);
    if (!activePickupCell || (pickupCell && pickupCell.id !== activePickupCell.id)) {
      return { ok: false, reason: 'pickup_cell_inactive' };
    }
    pickupCell = activePickupCell;
  }
  const template = getStatusTemplate(event);
  if (!template || !template.is_active) {
    return { ok: false, reason: 'template_inactive_or_missing' };
  }
  const variables = buildOrderVariables(order, { storeName, pickupCell });
  if (!variables) {
    return { ok: false, reason: 'variables_unavailable' };
  }
  // Теги задаёт доверенный менеджер в шаблоне, а данные клиента экранируем:
  // имя вида "<b>Иван</b>" не должно превращаться в чужую разметку.
  const templateBody = convertLegacyTelegramMarkup(template.body);
  let text = renderTemplate(templateBody, variables, { escapeValues: true });
  // Пустой редактируемый шаблон остаётся ошибкой.
  if (!text.trim()) {
    return { ok: false, reason: 'template_empty' };
  }
  if (event === 'order_assembled' && variables.payment_method === 'По карте') {
    // Preserve editable templates, but make the payment method explicit for
    // card orders even when an older template never had a payment placeholder.
    text = text.replace(/наличными/gi, 'По карте');
    if (
      !/\{payment_method\}/i.test(String(template.body || '')) &&
      !/по карте/i.test(text)
    ) {
      text = `${text.trim()}\n\nСпособ оплаты: По карте.`;
    }
  }
  if (
    event === 'order_assembled' &&
    !/\{(?:order_number|pickup_cell_number)\}/i.test(String(template.body || ''))
  ) {
    const cellNumber = Number(variables.pickup_cell_number || 0);
    if (!cellNumber) {
      return { ok: false, reason: 'pickup_cell_inactive' };
    }
    text = `${text.trim()}\n\nВаш номер для получения: заказ №${cellNumber}.`;
  }
  // Старые редактируемые шаблоны могли содержать прежний внутренний термин.
  // Клиенту он не показывается: во внешнем общении это всегда «заказ».
  text = normalizeCustomerOrderTerminologyInHtml(text);
  return {
    ok: true,
    parseMode: TELEGRAM_HTML_PARSE_MODE,
    chatId: String(customer.telegram_id),
    customerId: String(customer.id),
    customerTelegramId: String(customer.telegram_id),
    // @username клиента (без @): нужен userbot'у как fallback, если
    // sendMessage по userId упал с «Could not find input entity»
    // (клиент архивирован у менеджера или вне prefetch-кэша диалогов).
    // Через @username GramJS делает contacts.resolveUsername и достаёт
    // свежий access_hash без необходимости иметь диалог.
    customerUsername: customer.telegram_username || null,
    text,
    templateKind: 'status',
    templateId: template.id,
    templateEvent: template.event,
    variables,
  };
}

/**
 * Доступ к quick reply: авторизованный клиент либо клиент с ранее выданным
 * заказом. Неизвестный telegram_id разрешён для старого входного FAQ-потока.
 */
export function isReturningCustomerForQuickReply(telegramId) {
  const customer = db
    .prepare(`
      SELECT id, access_authorized_at, access_authorization_source
      FROM customers
      WHERE telegram_id = ?
    `)
    .get(String(telegramId));
  if (!customer) return true;
  if (getActiveBlockForCustomerId(customer.id)) return false;
  if (isCustomerAccessAuthorized(customer)) return true;
  const prior = db
    .prepare(
      `SELECT 1 FROM orders
        WHERE customer_id = ?
          AND status IN ('completed', 'delivered')
        LIMIT 1`,
    )
    .get(customer.id);
  return Boolean(prior);
}

/**
 * Бизнес-логика обработки входящего business_message: возвращает payload для
 * автоответа (или null, если отвечать не нужно). bot.js берёт payload и
 * отправляет в Telegram.
 *
 * Решает:
 *   - master switch выключен → null
 *   - сообщение от самого менеджера (не от клиента) → null
 *   - неавторизованный клиент без выданных заказов → null
 *   - матч quick reply → payload с текстом
 *   - нет матча → null (но input уже залогирован вызывающей стороной)
 */
export function handleIncomingBusinessMessage({
  businessConnectionId,
  fromUserId,
  ownerUserId,
  text,
}) {
  if (!isAutoReplyEnabled()) return null;
  if (!fromUserId || !ownerUserId) return null;
  // Если сообщение от самого владельца аккаунта (менеджера) — это исходящее
  // от него, не от клиента. Бот не должен отвечать на свои же сообщения.
  if (String(fromUserId) === String(ownerUserId)) return null;
  if (!isReturningCustomerForQuickReply(fromUserId)) return null;

  const reply = matchQuickReply(text);
  if (!reply) return null;
  return {
    text: reply.response_text,
    templateKind: 'quick_reply',
    templateId: reply.id,
    quickReplyTitle: reply.title,
  };
}
