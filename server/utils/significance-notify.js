/**
 * Сообщения по пометкам значимости после выдачи заказа.
 *
 * Когда заказ со статусом delivered/completed содержит товар из линейки с
 * пометкой (например «Социально значимый товар»), клиенту через 10 минут
 * уходит сообщение, привязанное к этой пометке. Механика повторяет
 * auto-notify: строка в очереди + периодический воркер, отправка через
 * userbot с журналом и защитой от дублей.
 */

import { db } from '../db.js';
import { sendViaUserbot, isUserbotAvailable } from './userbot-client.js';
import { logBotMessage, isCustomerVerified } from './business-bot.js';
import { getActiveBlockForCustomerId } from './customer-blocks.js';

/** Задержка между выдачей и сообщением. */
export const SIGNIFICANCE_NOTIFY_DELAY_MS = 10 * 60 * 1000;

/** Воркер: как у auto-notify, частый лёгкий sweep. */
export const SIGNIFICANCE_WORKER_INTERVAL_MS = 60 * 1000;

const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function toSqliteDatetime(date) {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

/** Плейсхолдеры текста сообщения: {имя}, {название}, {номер}, {линейка}. */
export function renderSignificanceText(template, context) {
  if (!template) return null;
  return String(template)
    .replaceAll('{имя}', context.customerName || '')
    .replaceAll('{название}', context.markTitle || '')
    .replaceAll('{номер}', String(context.orderNumber ?? ''))
    .replaceAll('{линейка}', context.groupName || '');
}

/**
 * Пометки заказа: группируем позиции по пометкам их линеек. Товар без
 * линейки или с неактивной пометкой не участвует.
 */
export function getSignificanceMarksForOrder(orderId) {
  return db.prepare(`
    SELECT DISTINCT m.id, m.title, m.notify_text, m.code
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    JOIN category_groups g ON g.id = p.groupId
    JOIN significance_marks m ON m.id = g.significance_mark_id AND m.active = 1
    WHERE oi.order_id = ?
  `).all(String(orderId));
}

/**
 * Постановка в очередь при выдаче. Идемпотентно: UNIQUE(order_id, mark_id)
 * — повторная выдача того же заказа не плодит строки.
 */
export function scheduleSignificanceNotifications(orderId, { now = new Date() } = {}) {
  const order = db.prepare('SELECT id, customer_id FROM orders WHERE id = ?')
    .get(String(orderId));
  if (!order) return [];

  const marks = getSignificanceMarksForOrder(orderId);
  if (!marks.length) return [];

  const sendAt = toSqliteDatetime(new Date(now.getTime() + SIGNIFICANCE_NOTIFY_DELAY_MS));
  const scheduled = [];

  // Выдача после отмены (менеджер передумал и выдал заново): строка уже есть
  // со статусом skipped/failed — возвращаем её в работу, иначе повторная
  // выдача молча теряла бы сообщение.
  const revive = db.prepare(`
    UPDATE significance_notify_queue
      SET status = 'pending', reason = NULL, attempt = 0,
          customer_id = ?, send_at = ?, updated_at = DATETIME('now')
    WHERE order_id = ? AND mark_id = ? AND status IN ('skipped', 'failed')
  `);
  const insert = db.prepare(`
    INSERT OR IGNORE INTO significance_notify_queue (
      id, order_id, mark_id, customer_id, send_at
    ) VALUES (?, ?, ?, ?, ?)
  `);
  for (const mark of marks) {
    const revived = revive.run(order.customer_id, sendAt, String(orderId), mark.id);
    if (revived.changes > 0) {
      scheduled.push({ markId: mark.id, sendAt, revived: true });
      continue;
    }
    const id = generateId('sign');
    const result = insert.run(id, String(orderId), mark.id, order.customer_id, sendAt);
    if (result.changes > 0) {
      scheduled.push({ id, markId: mark.id, sendAt });
    }
  }
  return scheduled;
}

/**
 * Отмена отложенных сообщений: статус уехал из выданных до истечения
 * задержки — сообщение клиенту больше неактуально.
 */
export function cancelPendingSignificanceNotifications(orderId, { now = new Date() } = {}) {
  const order = db.prepare('SELECT status FROM orders WHERE id = ?').get(String(orderId));
  // Статус уже не «выдан»: откладываем только действительно pendings.
  if (order && ['completed', 'delivered'].includes(order.status)) return 0;
  const result = db.prepare(
    `UPDATE significance_notify_queue
       SET status = 'skipped', reason = 'order_status_reverted', updated_at = DATETIME('now')
     WHERE order_id = ? AND status = 'pending'`,
  ).run(String(orderId));
  return result.changes;
}

/** Строки к отправке: pending, время пришло. */
export function listDueSignificanceNotifications({ limit = 20, now = new Date() } = {}) {
  const nowSql = toSqliteDatetime(now);
  return db.prepare(`
    SELECT q.*, m.title AS mark_title, m.notify_text, m.code AS mark_code,
           o.order_number, o.status AS order_status,
           c.telegram_id AS customer_telegram_id,
           c.telegram_username AS customer_username,
           COALESCE(c.first_name, c.telegram_username) AS customer_name
    FROM significance_notify_queue q
    JOIN significance_marks m ON m.id = q.mark_id
    JOIN orders o ON o.id = q.order_id
    LEFT JOIN customers c ON c.id = q.customer_id
    WHERE q.status = 'pending' AND q.send_at <= ?
    ORDER BY q.send_at ASC
    LIMIT ?
  `).all(nowSql, Math.max(1, Number(limit) || 20));
}

function markQueueStatus(id, status, reason = null) {
  db.prepare(`
    UPDATE significance_notify_queue
      SET status = ?, reason = ?, updated_at = DATETIME('now')
    WHERE id = ?
  `).run(status, reason, String(id));
}

/** Название первой линейки заказа, носящей эту пометку. */
function getFirstMarkedGroupName(orderId, markId) {
  const row = db.prepare(`
    SELECT g.name AS group_name
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    JOIN category_groups g ON g.id = p.groupId
    WHERE oi.order_id = ? AND g.significance_mark_id = ?
    ORDER BY oi.rowid ASC
    LIMIT 1
  `).get(String(orderId), String(markId));
  return row?.group_name || null;
}

/** Отправка одной строки. Возвращает { sent, reason } — как auto-notify. */
async function executeSignificanceNotification(row) {
  // Заказ к моменту отправки должен оставаться выданным.
  if (!['completed', 'delivered'].includes(row.order_status)) {
    return { sent: false, reason: 'order_status_reverted' };
  }
  const mark = db.prepare('SELECT * FROM significance_marks WHERE id = ?').get(row.mark_id);
  if (!mark || !mark.active) {
    return { sent: false, reason: 'mark_deleted' };
  }
  const text = renderSignificanceText(mark.notify_text, {
    customerName: row.customer_name,
    markTitle: mark.title,
    orderNumber: row.order_number,
    // Имя первой линейки заказа с этой пометкой — для подстановки {линейка}.
    groupName: getFirstMarkedGroupName(row.order_id, row.mark_id),
  });
  if (!text) {
    return { sent: false, reason: 'notify_text_missing' };
  }
  const telegramId = row.customer_telegram_id ? String(row.customer_telegram_id) : null;
  if (!telegramId) {
    return { sent: false, reason: 'customer_has_no_telegram_id' };
  }
  if (getActiveBlockForCustomerId(row.customer_id)) {
    return { sent: false, reason: 'customer_blocked' };
  }
  if (!isCustomerVerified(telegramId)) {
    return { sent: false, reason: 'customer_not_verified' };
  }
  if (!isUserbotAvailable()) {
    return { sent: false, reason: 'userbot_unavailable', retryable: true };
  }

  // Защита от дубля: сбой между отправкой и пометкой «отправлено»
  // (краш процесса, ошибка записи в журнал) не должен приводить ко второй
  // отправке — проверяем журнал по order_id и пометке.
  if (hasSignificanceBeenSent(row.order_id, row.mark_id)) {
    return { sent: true, reason: 'already_sent' };
  }

  const result = await sendViaUserbot({
    chatId: telegramId,
    text,
    orderId: row.order_id,
    auto: true,
    username: row.customer_username || null,
    verified: true,
  });
  if (result.ok) {
    safeLogSignificance(row, telegramId, text, 'sent');
    return { sent: true };
  }
  if (result.outcome === 'ambiguous') {
    // Отправка могла пройти: повторная попытка создала бы дубль. Фиксируем
    // как отправленную — лучше молчание, чем двойное сообщение клиенту.
    safeLogSignificance(row, telegramId, text, 'ambiguous');
    return { sent: true, reason: 'userbot_ambiguous' };
  }
  return { sent: false, reason: result.outcome || 'userbot_failed', retryable: true };
}

/** Отправлено ли уже сообщение по этой пометке этого заказа. */
function hasSignificanceBeenSent(orderId, markId) {
  return Boolean(
    db.prepare(`
      SELECT 1 FROM bot_message_log
      WHERE direction = 'out'
        AND template_event = 'significance_mark'
        AND json_extract(meta, '$.order_id') = ?
        AND json_extract(meta, '$.mark_id') = ?
        AND json_extract(meta, '$.outcome') IN ('sent', 'ambiguous')
      LIMIT 1
    `).get(String(orderId), String(markId)),
  );
}

/** Журналирование отправки: ошибка записи не должна ломать результат. */
function safeLogSignificance(row, telegramId, text, outcome) {
  try {
    logBotMessage({
      chatId: telegramId,
      customerId: row.customer_id,
      customerTelegramId: telegramId,
      direction: 'out',
      messageType: 'text',
      templateEvent: 'significance_mark',
      text,
      meta: {
        order_id: row.order_id,
        mark_id: row.mark_id,
        outcome,
      },
    });
  } catch (logError) {
    console.error('[significance-notify] log write failed:', logError);
  }
}

const PERMANENT_SKIP_REASONS = new Set([
  'order_status_reverted',
  'mark_deleted',
  'notify_text_missing',
  'customer_has_no_telegram_id',
  'customer_blocked',
  'customer_not_verified',
]);

/**
 * Один проход воркера: берёт созревшие строки и отправляет. Ошибки сети
 * пересматриваются с задержкой, перманентные — помечаются skipped.
 */
export async function processDueSignificanceNotifications({
  limit = 20,
  now = new Date(),
  execute = executeSignificanceNotification,
} = {}) {
  const rows = listDueSignificanceNotifications({ limit, now });
  const outcomes = [];
  for (const row of rows) {
    let result;
    try {
      result = await execute(row);
    } catch (error) {
      console.error('[significance-notify] send error:', error);
      result = { sent: false, reason: 'send_error', retryable: true };
    }

    if (result.sent) {
      markQueueStatus(row.id, 'sent', result.reason || null);
      outcomes.push({ id: row.id, outcome: 'sent' });
      continue;
    }
    if (PERMANENT_SKIP_REASONS.has(result.reason)) {
      markQueueStatus(row.id, 'skipped', result.reason);
      outcomes.push({ id: row.id, outcome: 'skipped', reason: result.reason });
      continue;
    }
    // Ретрай с нарастающей задержкой.
    const attempt = Number(row.attempt || 0) + 1;
    if (attempt >= MAX_ATTEMPTS) {
      markQueueStatus(row.id, 'failed', result.reason || 'max_attempts');
      outcomes.push({ id: row.id, outcome: 'failed', reason: result.reason });
      continue;
    }
    const delay = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];
    const nextAt = toSqliteDatetime(new Date(now.getTime() + delay));
    db.prepare(`
      UPDATE significance_notify_queue
        SET attempt = ?, send_at = ?, reason = ?, updated_at = DATETIME('now')
      WHERE id = ?
    `).run(attempt, nextAt, result.reason || 'retry', String(row.id));
    outcomes.push({ id: row.id, outcome: 'rescheduled', attempt, nextAt });
  }
  return outcomes;
}

let significanceWorkerTimer = null;
let significanceWorkerRunning = false;

export function startSignificanceNotifyWorker({ intervalMs = SIGNIFICANCE_WORKER_INTERVAL_MS } = {}) {
  if (significanceWorkerTimer) return significanceWorkerTimer;
  significanceWorkerTimer = setInterval(() => {
    if (significanceWorkerRunning) return;
    significanceWorkerRunning = true;
    void processDueSignificanceNotifications()
      .catch((err) => {
        console.error('[significance-notify] worker error:', err);
      })
      .finally(() => {
        significanceWorkerRunning = false;
      });
  }, intervalMs);
  console.log(`[significance-notify] Worker started (every ${intervalMs / 1000}s)`);
  return significanceWorkerTimer;
}

export function _stopSignificanceNotifyWorkerForTests() {
  if (significanceWorkerTimer) {
    clearInterval(significanceWorkerTimer);
    significanceWorkerTimer = null;
  }
  significanceWorkerRunning = false;
}
