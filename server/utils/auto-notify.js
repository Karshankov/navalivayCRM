/**
 * Автоматическая отправка статусных уведомлений клиенту при смене статуса
 * заказа. Раньше менеджер должен был вручную нажать кнопку «Отправить
 * клиенту» в OrderBotNotifier — Костя на это жаловался (8.05.2026):
 * «нужно нажали собрано → ему отослалось». Теперь триггер — сам PATCH
 * статуса заказа.
 *
 * Дополнительно: `order_accepted` — сообщение авторизованному или постоянному
 * клиенту сразу после оформления заказа.
 *
 * Контракт: вернуть { sent, reason?, telegram_message_id?, event?, skipped? }
 * вместо throw — caller не должен падать, если уведомление не ушло.
 */

import {
  prepareStatusNotification,
  isCustomerVerified,
  logBotMessage,
} from './business-bot.js';
import {
  sendViaUserbot,
  isUserbotAvailable,
  resolveUsernameViaUserbot,
} from './userbot-client.js';
import { getActiveBlockForCustomerId } from './customer-blocks.js';
import {
  scheduleAutoNotifyRetry,
  hasAutoNotifyBeenSent,
} from './auto-notify-retry.js';
import { db } from '../db.js';
import { isCustomerAccessAuthorized } from './referral-authorization.js';
import {
  getActivePickupCellAssignment,
  getLatestPickupCellAssignment,
} from './pickup-cells.js';

export const ORDER_ACCEPTED_EVENT = 'order_accepted';

function getNotificationPickupCell(orderId, event) {
  if ([ORDER_ACCEPTED_EVENT, 'order_assembled'].includes(event)) {
    return getActivePickupCellAssignment(orderId);
  }
  return getLatestPickupCellAssignment(orderId);
}

function isNotificationContextCurrent(orderId, event, assignmentId = null) {
  const order = db.prepare(`SELECT status FROM orders WHERE id = ?`).get(String(orderId));
  if (!order) return false;
  const allowedStatuses = {
    [ORDER_ACCEPTED_EVENT]: new Set(['new', 'in_progress']),
    order_assembled: new Set(['in_progress']),
    order_issued: new Set(['completed', 'delivered']),
    order_cancelled: new Set(['cancelled']),
  };
  if (!allowedStatuses[event]?.has(order.status)) return false;
  if (!assignmentId) {
    return ![ORDER_ACCEPTED_EVENT, 'order_assembled'].includes(event);
  }
  const assignment = db.prepare(
    `SELECT released_at FROM order_pickup_cell_assignments
      WHERE id = ? AND order_id = ? LIMIT 1`,
  ).get(String(assignmentId), String(orderId));
  if (!assignment) return false;
  if ([ORDER_ACCEPTED_EVENT, 'order_assembled'].includes(event)) {
    return assignment.released_at === null;
  }
  const latest = getLatestPickupCellAssignment(orderId);
  return latest?.id === String(assignmentId);
}

// Один общий прогрев на Telegram ID. Пока resolve идёт, все быстрые смены
// статуса ждут тот же Promise; после успеха повторный resolve этому клиенту
// до перезапуска API не нужен.
const recipientWarmups = new Map();

function warmupRecipient({ telegramId, username }) {
  const key = String(telegramId || '');
  if (!key || !username) return Promise.resolve({ ok: false, error: 'recipient_username_missing' });
  const existing = recipientWarmups.get(key);
  if (existing) return existing;

  const pending = resolveUsernameViaUserbot({
    username,
    expectedTelegramId: key,
  }).then((result) => {
    if (!result?.ok) recipientWarmups.delete(key);
    return result;
  }).catch((error) => {
    recipientWarmups.delete(key);
    return { ok: false, error: error?.message || String(error) };
  });
  recipientWarmups.set(key, pending);
  return pending;
}

export function _resetRecipientWarmupsForTests() {
  recipientWarmups.clear();
}

/**
 * Маппинг статусов заказа на event-ключи в bot_status_templates.
 *
 * - new          → не шлём при смене статуса (order_accepted — отдельный триггер)
 * - in_progress  → order_assembled («собран»)
 * - completed    → order_issued («выдан»)
 * - delivered    → order_issued (тот же шаблон, разница только бухгалтерская)
 * - cancelled    → order_cancelled
 */
export const STATUS_TO_EVENT = Object.freeze({
  in_progress: 'order_assembled',
  completed: 'order_issued',
  delivered: 'order_issued',
  cancelled: 'order_cancelled',
});

/**
 * Постоянный клиент: есть хотя бы один завершённый заказ, кроме excludeOrderId.
 * Совпадает с бейджем is_returning_customer в CRM enrichment.
 */
export function isReturningCustomer(customerId, { excludeOrderId = null } = {}) {
  if (!customerId) return false;
  if (excludeOrderId) {
    const row = db
      .prepare(
        `SELECT 1 FROM orders
          WHERE customer_id = ?
            AND status IN ('completed', 'delivered')
            AND id != ?
          LIMIT 1`,
      )
      .get(String(customerId), String(excludeOrderId));
    return !!row;
  }
  const row = db
    .prepare(
      `SELECT 1 FROM orders
        WHERE customer_id = ?
          AND status IN ('completed', 'delivered')
        LIMIT 1`,
    )
    .get(String(customerId));
  return !!row;
}

function hasOrderAcceptedNotify(orderId) {
  const row = db
    .prepare(
      `SELECT 1 FROM bot_message_log
        WHERE direction = 'out'
          AND template_event = ?
          AND json_extract(meta, '$.order_id') = ?
          AND json_extract(meta, '$.auto') = 1
          AND json_extract(meta, '$.outcome') = 'sent'
        LIMIT 1`,
    )
    .get(ORDER_ACCEPTED_EVENT, String(orderId));
  return !!row;
}

/** Атомарный claim перед send — защита от двойного вызова (race / setImmediate). */
function tryClaimOrderAcceptedSlot(orderId) {
  const meta = JSON.stringify({
    order_id: String(orderId),
    auto: 1,
    outcome: 'claim',
  });
  const result = db
    .prepare(
      `INSERT INTO bot_message_log (chat_id, direction, message_type, template_kind, template_event, meta)
       SELECT '-', 'out', 'status', 'status', ?, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM bot_message_log
           WHERE direction = 'out'
             AND template_event = ?
             AND json_extract(meta, '$.order_id') = ?
             AND json_extract(meta, '$.auto') = 1
             AND json_extract(meta, '$.outcome') IN ('sent', 'claim')
        )`,
    )
    .run(ORDER_ACCEPTED_EVENT, meta, ORDER_ACCEPTED_EVENT, String(orderId));
  return result.changes > 0;
}

function releaseOrderAcceptedClaim(orderId) {
  db.prepare(
    `DELETE FROM bot_message_log
      WHERE direction = 'out'
        AND template_event = ?
        AND json_extract(meta, '$.order_id') = ?
        AND json_extract(meta, '$.auto') = 1
        AND json_extract(meta, '$.outcome') = 'claim'`,
  ).run(ORDER_ACCEPTED_EVENT, String(orderId));
}

function buildRetryScheduledResult({ event, reason = 'userbot_unavailable' }) {
  return {
    sent: false,
    skipped: false,
    pending: true,
    reason: 'retry_scheduled',
    retry_reason: reason,
    event,
  };
}

/**
 * @param {object} args
 * @param {string} args.orderId
 * @param {string} args.event
 * @param {boolean} [args.fromRetry=false]
 */
export async function executeAutoNotify({ orderId, event, fromRetry = false } = {}) {
  const order = db.prepare(`SELECT id FROM orders WHERE id = ?`).get(String(orderId));
  if (!order) {
    return { sent: false, skipped: true, reason: 'order_not_found', event };
  }
  const pickupCell = getNotificationPickupCell(orderId, event);
  if (hasAutoNotifyBeenSent(orderId, event)) {
    return { sent: true, event, already_sent: true };
  }
  const prepared = prepareStatusNotification({ orderId, event, pickupCell });
  if (!prepared.ok) {
    return { sent: false, skipped: true, reason: prepared.reason, event };
  }
  if (!isNotificationContextCurrent(orderId, event, pickupCell?.id || null)) {
    return { sent: false, skipped: true, reason: 'pickup_cell_inactive', event };
  }

  const baseLog = {
    chatId: prepared.chatId,
    customerId: prepared.customerId,
    customerTelegramId: prepared.customerTelegramId,
    direction: 'out',
    messageType: 'status',
    templateKind: 'status',
    templateId: prepared.templateId,
    templateEvent: event,
    text: prepared.text,
  };

  function safeLog(extra = {}, businessConnectionId = null) {
    try {
      logBotMessage({
        ...baseLog,
        businessConnectionId,
        meta: {
          order_id: orderId,
          auto: true,
          ...(pickupCell ? {
            pickup_cell_assignment_id: pickupCell.id,
            pickup_cell_number: pickupCell.cell_number,
          } : {}),
          ...extra,
        },
      });
    } catch (logErr) {
      console.error('[auto-notify] logBotMessage failed:', logErr);
    }
  }

  const activeBlock = getActiveBlockForCustomerId(prepared.customerId);
  if (activeBlock) {
    safeLog({ outcome: 'skipped', reason: 'customer_blocked' });
    return { sent: false, skipped: true, reason: 'customer_blocked', event };
  }

  const accessAuthorized = isCustomerAccessAuthorized(prepared.customerId);
  if (!isCustomerVerified(prepared.customerTelegramId) && !accessAuthorized) {
    safeLog({ outcome: 'skipped', reason: 'customer_not_verified' });
    return { sent: false, skipped: true, reason: 'customer_not_verified', event };
  }

  const returningCustomer = isReturningCustomer(prepared.customerId, { excludeOrderId: orderId });
  if (!accessAuthorized && !returningCustomer) {
    return { sent: false, skipped: true, reason: 'new_customer_no_dialog', event };
  }

  // Entity может отсутствовать и у нового, и у постоянного клиента после
  // очистки кэша. Все параллельные события ждут один resolve на Telegram ID;
  // Map не даёт повторять его перед каждым статусом.
  if (prepared.customerUsername) {
    await warmupRecipient({
      telegramId: prepared.customerTelegramId,
      username: prepared.customerUsername,
    });
  }

  if (!(await isUserbotAvailable())) {
    if (!isNotificationContextCurrent(orderId, event, pickupCell?.id || null)) {
      return { sent: false, skipped: true, reason: 'pickup_cell_inactive', event };
    }
    const schedule = scheduleAutoNotifyRetry({
      orderId,
      event,
      reason: 'userbot_unavailable',
    });
    safeLog({
      outcome: schedule.scheduled ? 'retry_scheduled' : 'skipped',
      reason: 'userbot_unavailable',
      retry_attempt: schedule.attempt ?? null,
      next_retry_at: schedule.next_retry_at ?? null,
    });
    if (schedule.scheduled) {
      return buildRetryScheduledResult({ event, reason: 'userbot_unavailable' });
    }
    return { sent: false, skipped: true, reason: 'userbot_unavailable', event };
  }

  // Подготовка получателя и проверка userbot могут занять время. Перед самым
  // запросом убеждаемся, что клиенту не уйдёт уже освобождённый номер.
  if (!isNotificationContextCurrent(orderId, event, pickupCell?.id || null)) {
    return { sent: false, skipped: true, reason: 'pickup_cell_inactive', event };
  }

  const ubResult = await sendViaUserbot({
    chatId: prepared.chatId,
    text: prepared.text,
    parseMode: prepared.parseMode,
    orderId,
    username: prepared.customerUsername || null,
    verified: true,
    auto: true,
  });

  if (ubResult.ok) {
    // Журнал API хранит template_event и цикл ячейки; журнал userbot этого
    // контекста не знает и не подходит для защиты от повторной отправки.
    safeLog({
      outcome: 'sent',
      via: 'userbot',
      telegram_message_id: ubResult.telegram_message_id ?? null,
    });
    return {
      sent: true,
      event,
      telegram_message_id: ubResult.telegram_message_id ?? null,
      via: 'userbot',
    };
  }

  if (ubResult.outcome === 'ambiguous') {
    console.warn(
      '[auto-notify] userbot send ambiguous (мог отправить, ответ потерян):',
      ubResult.error,
    );
    safeLog({ outcome: 'ambiguous', via: 'userbot', error: ubResult.error });
    return {
      sent: false,
      reason: 'userbot_ambiguous',
      event,
      via: 'userbot',
    };
  }

  if (ubResult.outcome === 'unreachable') {
    const schedule = scheduleAutoNotifyRetry({
      orderId,
      event,
      reason: 'userbot_unreachable',
    });
    safeLog({
      outcome: schedule.scheduled ? 'retry_scheduled' : 'skipped',
      reason: 'userbot_unreachable',
      error: ubResult.error,
      retry_attempt: schedule.attempt ?? null,
      next_retry_at: schedule.next_retry_at ?? null,
    });
    if (schedule.scheduled) {
      return buildRetryScheduledResult({ event, reason: 'userbot_unreachable' });
    }
    return {
      sent: false,
      skipped: true,
      reason: ubResult.error || 'userbot_unreachable',
      event,
      via: 'userbot',
    };
  }

  console.warn(`[auto-notify] userbot ${ubResult.outcome}:`, ubResult.error);
  safeLog({
    outcome: 'failed',
    via: 'userbot',
    reason: ubResult.error || 'send_failed',
    error: ubResult.error || 'send_failed',
  });
  return {
    sent: false,
    reason: ubResult.error || 'send_failed',
    event,
    via: 'userbot',
  };
}

/**
 * @param {object} args
 * @param {string} args.orderId
 * @param {string} args.newStatus
 * @param {string|null} [args.previousStatus]
 * @param {boolean} [args.reactivate=false]
 */
export async function autoNotifyForStatusChange({
  orderId,
  newStatus,
  previousStatus = null,
  reactivate = false,
} = {}) {
  if (reactivate) {
    return { sent: false, skipped: true, reason: 'reactivation_skipped' };
  }

  if (previousStatus && previousStatus === newStatus) {
    return { sent: false, skipped: true, reason: 'status_unchanged' };
  }

  const event = STATUS_TO_EVENT[newStatus];
  if (!event) {
    return { sent: false, skipped: true, reason: 'no_event_for_status' };
  }

  return executeAutoNotify({ orderId, event });
}

/**
 * Сообщение «заказ принят» после оформления через mini-app или CRM.
 */
export async function autoNotifyOrderAccepted({ orderId } = {}) {
  if (!orderId) {
    return { sent: false, skipped: true, reason: 'order_id_required' };
  }

  if (hasOrderAcceptedNotify(orderId)) {
    return {
      sent: false,
      skipped: true,
      reason: 'already_sent',
      event: ORDER_ACCEPTED_EVENT,
    };
  }

  if (!tryClaimOrderAcceptedSlot(orderId)) {
    return {
      sent: false,
      skipped: true,
      reason: 'already_sent',
      event: ORDER_ACCEPTED_EVENT,
    };
  }

  try {
    const result = await executeAutoNotify({ orderId, event: ORDER_ACCEPTED_EVENT });
    if (!result.sent && !result.pending && result.reason !== 'retry_scheduled') {
      releaseOrderAcceptedClaim(orderId);
    }
    return result;
  } catch (err) {
    releaseOrderAcceptedClaim(orderId);
    throw err;
  }
}

/**
 * Совместимое имя для точек создания заказа. Общий прогрев теперь находится
 * внутри executeAutoNotify, поэтому его также ждут быстрые смены статуса.
 */
export async function autoNotifyOrderAcceptedAfterRecipientWarmup({ orderId } = {}) {
  return autoNotifyOrderAccepted({ orderId });
}
