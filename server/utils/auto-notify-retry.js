/**
 * Очередь и worker повторных авто-уведомлений при временной недоступности userbot.
 *
 * Backoff: base 30s, ×2, ±20% jitter, до 15 попыток или TTL 45 минут.
 */

import { db } from '../db.js';
import {
  getActivePickupCellAssignment,
  getLatestPickupCellAssignment,
} from './pickup-cells.js';

export const RETRY_BASE_MS = 30_000;
export const RETRY_MULTIPLIER = 2;
export const RETRY_JITTER = 0.2;
export const RETRY_MAX_ATTEMPTS = 15;
export const RETRY_TTL_MS = 45 * 60 * 1000;
export const RETRY_WORKER_INTERVAL_MS = 15_000;

export const RETRYABLE_REASONS = new Set(['userbot_unavailable', 'userbot_unreachable']);

const PERMANENT_SKIP_REASONS = new Set([
  'customer_blocked',
  'customer_not_verified',
  'new_customer_no_dialog',
  'template_inactive_or_missing',
  'template_empty',
  'order_not_found',
  'customer_has_no_telegram_id',
  'reactivation_skipped',
  'status_unchanged',
  'no_event_for_status',
  'already_sent',
  'pickup_cell_inactive',
]);

function toSqliteDatetime(date) {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

export function computeRetryDelayMs(attempt, { rng = Math.random } = {}) {
  const exponent = Math.max(0, Number(attempt) || 0);
  const base = RETRY_BASE_MS * RETRY_MULTIPLIER ** exponent;
  const jitter = 1 + (rng() * 2 - 1) * RETRY_JITTER;
  return Math.max(1_000, Math.round(base * jitter));
}

export function hasAutoNotifyBeenSent(orderId, templateEvent) {
  const pickupCell = ['order_accepted', 'order_assembled'].includes(templateEvent)
    ? getActivePickupCellAssignment(orderId)
    : getLatestPickupCellAssignment(orderId);
  if (['order_accepted', 'order_assembled'].includes(templateEvent) && !pickupCell) return false;
  const row = db
    .prepare(
      `SELECT 1 FROM bot_message_log
        WHERE direction = 'out'
          AND template_event = ?
          AND json_extract(meta, '$.order_id') = ?
          AND json_extract(meta, '$.outcome') = 'sent'
          ${pickupCell
            ? `AND json_extract(meta, '$.pickup_cell_assignment_id') = ?`
            : ''}
        LIMIT 1`,
    )
    .get(
      String(templateEvent),
      String(orderId),
      ...(pickupCell ? [String(pickupCell.id)] : []),
    );
  return !!row;
}

function getPendingRow(orderId, templateEvent) {
  return db
    .prepare(
      `SELECT * FROM pending_notifications
        WHERE order_id = ? AND template_event = ?`,
    )
    .get(String(orderId), String(templateEvent));
}

function isRetryExpired(createdAt, nowMs = Date.now()) {
  if (!createdAt) return true;
  const createdMs = Date.parse(String(createdAt).replace(' ', 'T') + 'Z');
  if (!Number.isFinite(createdMs)) return true;
  return nowMs - createdMs >= RETRY_TTL_MS;
}

export function markAutoNotifyRetryStatus(orderId, templateEvent, status) {
  db.prepare(
    `UPDATE pending_notifications
        SET status = ?, updated_at = DATETIME('now')
      WHERE order_id = ? AND template_event = ?`,
  ).run(status, String(orderId), String(templateEvent));
}

/**
 * @returns {{ scheduled: boolean, expired?: boolean, attempt?: number, next_retry_at?: string }}
 */
export function scheduleAutoNotifyRetry({
  orderId,
  event,
  reason = 'userbot_unavailable',
  attempt = null,
  now = new Date(),
  rng = Math.random,
} = {}) {
  if (!orderId || !event) {
    return { scheduled: false };
  }
  if (!RETRYABLE_REASONS.has(reason)) {
    return { scheduled: false };
  }
  if (hasAutoNotifyBeenSent(orderId, event)) {
    markAutoNotifyRetryStatus(orderId, event, 'sent');
    return { scheduled: false };
  }

  const pickupCell = ['order_accepted', 'order_assembled'].includes(event)
    ? getActivePickupCellAssignment(orderId)
    : getLatestPickupCellAssignment(orderId);
  let existing = getPendingRow(orderId, event);
  if (
    existing &&
    String(existing.pickup_cell_assignment_id || '') !== String(pickupCell?.id || '')
  ) {
    db.prepare(`DELETE FROM pending_notifications WHERE id = ?`).run(existing.id);
    existing = null;
  }
  const nowMs = now.getTime();

  if (existing?.status === 'pending') {
    if (isRetryExpired(existing.created_at, nowMs)) {
      markAutoNotifyRetryStatus(orderId, event, 'expired');
      return { scheduled: false, expired: true };
    }
    const nextAttempt =
      attempt === null || attempt === undefined ? existing.attempt + 1 : Number(attempt);
    if (nextAttempt >= RETRY_MAX_ATTEMPTS) {
      markAutoNotifyRetryStatus(orderId, event, 'expired');
      return { scheduled: false, expired: true };
    }
    const delayMs = computeRetryDelayMs(nextAttempt, { rng });
    const nextRetryAt = toSqliteDatetime(new Date(nowMs + delayMs));
    db.prepare(
      `UPDATE pending_notifications
          SET attempt = ?, next_retry_at = ?, reason = ?, updated_at = DATETIME('now')
        WHERE id = ? AND status = 'pending'`,
    ).run(nextAttempt, nextRetryAt, reason, existing.id);
    return { scheduled: true, attempt: nextAttempt, next_retry_at: nextRetryAt };
  }

  if (existing) {
    return { scheduled: false };
  }

  const firstAttempt = 0;
  const delayMs = computeRetryDelayMs(firstAttempt, { rng });
  const nextRetryAt = toSqliteDatetime(new Date(nowMs + delayMs));
  db.prepare(
    `INSERT INTO pending_notifications
      (order_id, template_event, reason, attempt, max_attempts, next_retry_at,
       status, pickup_cell_assignment_id, pickup_cell_number)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
  ).run(
    String(orderId),
    String(event),
    reason,
    firstAttempt,
    RETRY_MAX_ATTEMPTS,
    nextRetryAt,
    pickupCell?.id || null,
    pickupCell?.cell_number || null,
  );
  return { scheduled: true, attempt: firstAttempt, next_retry_at: nextRetryAt };
}

export function listDuePendingAutoNotifyRetries({ limit = 20, now = new Date() } = {}) {
  const nowSql = toSqliteDatetime(now);
  return db
    .prepare(
      `SELECT * FROM pending_notifications
        WHERE status = 'pending'
          AND next_retry_at <= ?
        ORDER BY next_retry_at ASC
        LIMIT ?`,
    )
    .all(nowSql, limit);
}

export function listPendingAutoNotifyForOrders(orderIds = []) {
  if (!orderIds.length) return [];
  const placeholders = orderIds.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT order_id, template_event, reason, attempt, next_retry_at, status
         FROM pending_notifications
        WHERE status = 'pending'
          AND order_id IN (${placeholders})`,
    )
    .all(...orderIds.map(String));
}

function resolveRetryResult(row, result, { rng = Math.random, now = new Date() } = {}) {
  if (result?.sent) {
    markAutoNotifyRetryStatus(row.order_id, row.template_event, 'sent');
    return { outcome: 'sent' };
  }

  const reason = String(result?.reason || '');
  if (PERMANENT_SKIP_REASONS.has(reason)) {
    markAutoNotifyRetryStatus(row.order_id, row.template_event, 'cancelled');
    return { outcome: 'cancelled', reason };
  }

  if (result?.pending || RETRYABLE_REASONS.has(reason) || reason === 'retry_scheduled') {
    const schedule = scheduleAutoNotifyRetry({
      orderId: row.order_id,
      event: row.template_event,
      reason: RETRYABLE_REASONS.has(reason) ? reason : 'userbot_unavailable',
      now,
      rng,
    });
    if (schedule.expired) {
      return { outcome: 'expired' };
    }
    return { outcome: 'rescheduled', attempt: schedule.attempt };
  }

  markAutoNotifyRetryStatus(row.order_id, row.template_event, 'cancelled');
  return { outcome: 'failed', reason };
}

export async function processPendingAutoNotifyRetries({
  limit = 10,
  now = new Date(),
  rng = Math.random,
  executeAutoNotify,
} = {}) {
  if (typeof executeAutoNotify !== 'function') {
    const mod = await import('./auto-notify.js');
    executeAutoNotify = mod.executeAutoNotify;
  }

  const due = listDuePendingAutoNotifyRetries({ limit, now });
  const summary = { processed: 0, sent: 0, rescheduled: 0, expired: 0, cancelled: 0, failed: 0 };

  for (const row of due) {
    summary.processed += 1;

    if (hasAutoNotifyBeenSent(row.order_id, row.template_event)) {
      markAutoNotifyRetryStatus(row.order_id, row.template_event, 'sent');
      summary.sent += 1;
      continue;
    }

    const currentPickupCell = ['order_accepted', 'order_assembled'].includes(row.template_event)
      ? getActivePickupCellAssignment(row.order_id)
      : getLatestPickupCellAssignment(row.order_id);
    if (
      String(row.pickup_cell_assignment_id || '') !== String(currentPickupCell?.id || '')
    ) {
      markAutoNotifyRetryStatus(row.order_id, row.template_event, 'cancelled');
      summary.cancelled += 1;
      continue;
    }

    if (isRetryExpired(row.created_at, now.getTime()) || row.attempt >= RETRY_MAX_ATTEMPTS) {
      markAutoNotifyRetryStatus(row.order_id, row.template_event, 'expired');
      summary.expired += 1;
      continue;
    }

    const result = await executeAutoNotify({
      orderId: row.order_id,
      event: row.template_event,
      fromRetry: true,
    });
    const resolved = resolveRetryResult(row, result, { rng, now });
    summary[resolved.outcome] = (summary[resolved.outcome] || 0) + 1;
  }

  return summary;
}

let workerTimer = null;
let workerRunning = false;

export function startAutoNotifyRetryWorker({
  intervalMs = RETRY_WORKER_INTERVAL_MS,
  executeAutoNotify,
} = {}) {
  if (workerTimer) return workerTimer;
  workerTimer = setInterval(() => {
    if (workerRunning) return;
    workerRunning = true;
    void processPendingAutoNotifyRetries({ executeAutoNotify })
      .catch((err) => {
        console.error('[auto-notify-retry] worker error:', err);
      })
      .finally(() => {
        workerRunning = false;
      });
  }, intervalMs);
  console.log(`[auto-notify-retry] Worker started (every ${intervalMs / 1000}s)`);
  return workerTimer;
}

export function _stopAutoNotifyRetryWorkerForTests() {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
  workerRunning = false;
}
