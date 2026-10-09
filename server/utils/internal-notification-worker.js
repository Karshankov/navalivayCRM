import { sendViaUserbot } from './userbot-client.js';
import {
  buildInternalNotificationText,
  stableJson,
  toSqliteUtc,
} from './internal-notifications.js';

export const INTERNAL_NOTIFICATION_WORKER_INTERVAL_MS = 15_000;
export const INTERNAL_NOTIFICATION_STALE_LOCK_MS = 2 * 60_000;
export const INTERNAL_NOTIFICATION_RETRY_BASE_MS = 30_000;
export const INTERNAL_NOTIFICATION_RETRY_MAX_MS = 30 * 60_000;
export const INTERNAL_NOTIFICATION_MAX_ATTEMPTS = 12;
export const INTERNAL_NOTIFICATION_RETRY_JITTER = 0.2;

function requireDatabase(database) {
  if (!database?.prepare) throw new TypeError('database_required');
  return database;
}

function parsePayload(payloadJson) {
  try {
    const payload = JSON.parse(String(payloadJson || '{}'));
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  } catch {
    return {};
  }
}

function safeResultJson(result) {
  try {
    return stableJson(result && typeof result === 'object' ? result : {});
  } catch {
    return '{}';
  }
}

function safeError(value) {
  return String(value || 'send_failed').replace(/[\u0000-\u001F\u007F]/g, ' ').slice(0, 300);
}

export function computeInternalNotificationRetryMs(attempt, {
  rng = Math.random,
} = {}) {
  const exponent = Math.max(0, Math.min(10, Number(attempt) - 1 || 0));
  const base = Math.min(
    INTERNAL_NOTIFICATION_RETRY_MAX_MS,
    INTERNAL_NOTIFICATION_RETRY_BASE_MS * (2 ** exponent),
  );
  const random = Math.max(0, Math.min(1, Number(rng()) || 0));
  const jitter = 1 + ((random * 2) - 1) * INTERNAL_NOTIFICATION_RETRY_JITTER;
  return Math.max(1_000, Math.round(base * jitter));
}

export function listDueInternalNotifications(database, {
  now = new Date(),
  limit = 20,
} = {}) {
  return requireDatabase(database).prepare(`
    SELECT *
    FROM internal_notification_outbox
    WHERE status IN ('pending', 'retry')
      AND next_attempt_at <= ?
    ORDER BY next_attempt_at ASC, id ASC
    LIMIT ?
  `).all(
    toSqliteUtc(now),
    Math.max(1, Math.min(100, Number(limit) || 20)),
  );
}

/**
 * После падения процесса невозможно узнать, успел ли Telegram принять запрос.
 * Поэтому зависшие `sending` ставятся на ручную проверку, а не отправляются
 * повторно автоматически.
 */
export function pauseStaleInternalNotifications(database, {
  now = new Date(),
  staleAfterMs = INTERNAL_NOTIFICATION_STALE_LOCK_MS,
} = {}) {
  const threshold = new Date(now.getTime() - Math.max(1_000, Number(staleAfterMs) || 0));
  const nowSql = toSqliteUtc(now);
  const result = requireDatabase(database).prepare(`
    UPDATE internal_notification_outbox
    SET status = 'unknown',
        locked_at = NULL,
        last_error = 'worker_interrupted_send_result_unknown',
        updated_at = ?
    WHERE status = 'sending'
      AND locked_at IS NOT NULL
      AND locked_at <= ?
  `).run(nowSql, toSqliteUtc(threshold));
  return result.changes;
}

function claimInternalNotification(database, id, now) {
  const nowSql = toSqliteUtc(now);
  const result = requireDatabase(database).prepare(`
    UPDATE internal_notification_outbox
    SET status = 'sending',
        attempts = attempts + 1,
        locked_at = ?,
        updated_at = ?
    WHERE id = ?
      AND status IN ('pending', 'retry')
      AND next_attempt_at <= ?
  `).run(nowSql, nowSql, id, nowSql);
  if (result.changes !== 1) return null;
  return database.prepare(`
    SELECT *
    FROM internal_notification_outbox
    WHERE id = ?
  `).get(id);
}

function finishSent(database, row, result, now) {
  const nowSql = toSqliteUtc(now);
  const updated = requireDatabase(database).prepare(`
    UPDATE internal_notification_outbox
    SET status = 'sent',
        locked_at = NULL,
        sent_at = ?,
        telegram_message_id = ?,
        last_error = NULL,
        result_json = ?,
        updated_at = ?
    WHERE id = ? AND status = 'sending' AND locked_at = ?
  `).run(
    nowSql,
    result.telegram_message_id === null || result.telegram_message_id === undefined
      ? null
      : String(result.telegram_message_id),
    safeResultJson(result),
    nowSql,
    row.id,
    row.locked_at,
  );
  return updated.changes === 1;
}

function finishUnknown(database, row, result, now) {
  const nowSql = toSqliteUtc(now);
  const updated = requireDatabase(database).prepare(`
    UPDATE internal_notification_outbox
    SET status = 'unknown',
        locked_at = NULL,
        last_error = ?,
        result_json = ?,
        updated_at = ?
    WHERE id = ? AND status = 'sending' AND locked_at = ?
  `).run(
    safeError(result?.error || 'send_result_unknown'),
    safeResultJson(result),
    nowSql,
    row.id,
    row.locked_at,
  );
  return updated.changes === 1;
}

function finishRetryable(database, row, result, {
  now,
  rng,
  maxAttempts,
} = {}) {
  const nowSql = toSqliteUtc(now);
  const exhausted = Number(row.attempts) >= maxAttempts;
  const telegramDelayMs = Math.max(0, Number(result?.retry_after_seconds) || 0) * 1000;
  const retryMs = Math.max(
    computeInternalNotificationRetryMs(row.attempts, { rng }),
    telegramDelayMs,
  );
  const nextAttemptAt = toSqliteUtc(new Date(now.getTime() + retryMs));
  const status = exhausted ? 'failed' : 'retry';
  const updated = requireDatabase(database).prepare(`
    UPDATE internal_notification_outbox
    SET status = ?,
        locked_at = NULL,
        next_attempt_at = ?,
        last_error = ?,
        result_json = ?,
        updated_at = ?
    WHERE id = ? AND status = 'sending' AND locked_at = ?
  `).run(
    status,
    nextAttemptAt,
    safeError(result?.error),
    safeResultJson(result),
    nowSql,
    row.id,
    row.locked_at,
  );
  return {
    updated: updated.changes === 1,
    status,
    next_attempt_at: exhausted ? null : nextAttemptAt,
  };
}

export async function deliverInternalNotification(database, row, {
  now = new Date(),
  sender = sendViaUserbot,
  rng = Math.random,
  maxAttempts = INTERNAL_NOTIFICATION_MAX_ATTEMPTS,
} = {}) {
  const claimed = claimInternalNotification(database, row?.id, now);
  if (!claimed) {
    return { outcome: 'skipped', reason: 'not_claimed' };
  }

  const payload = parsePayload(claimed.payload_json);
  let text;
  try {
    text = buildInternalNotificationText(claimed.event_type, payload);
  } catch (error) {
    const result = {
      ok: false,
      outcome: 'rejected',
      error: error?.message || 'invalid_notification_payload',
    };
    const finished = finishRetryable(database, claimed, result, {
      now,
      rng,
      maxAttempts: 1,
    });
    return { outcome: finished.status, reason: result.error };
  }

  let result;
  try {
    result = await sender({
      chatId: String(claimed.recipient_telegram_id),
      text,
      orderId: payload.order_id ?? payload.orderId ?? null,
      auto: true,
      username: claimed.recipient_username || null,
      verified: true,
    });
  } catch (error) {
    result = {
      ok: false,
      outcome: 'ambiguous',
      error: error?.message || String(error),
    };
  }

  if (result?.ok === true) {
    return finishSent(database, claimed, result, now)
      ? { outcome: 'sent', telegram_message_id: result.telegram_message_id ?? null }
      : { outcome: 'skipped', reason: 'claim_lost' };
  }

  if (result?.outcome === 'ambiguous' || !['rejected', 'unreachable'].includes(result?.outcome)) {
    return finishUnknown(database, claimed, result, now)
      ? { outcome: 'unknown', reason: safeError(result?.error || 'send_result_unknown') }
      : { outcome: 'skipped', reason: 'claim_lost' };
  }

  const retry = finishRetryable(database, claimed, result, {
    now,
    rng,
    maxAttempts: Math.max(1, Number(maxAttempts) || INTERNAL_NOTIFICATION_MAX_ATTEMPTS),
  });
  if (!retry.updated) return { outcome: 'skipped', reason: 'claim_lost' };
  return {
    outcome: retry.status,
    reason: safeError(result?.error),
    next_attempt_at: retry.next_attempt_at,
  };
}

export async function processInternalNotifications(database, {
  now = new Date(),
  limit = 20,
  sender = sendViaUserbot,
  rng = Math.random,
  maxAttempts = INTERNAL_NOTIFICATION_MAX_ATTEMPTS,
  staleAfterMs = INTERNAL_NOTIFICATION_STALE_LOCK_MS,
} = {}) {
  const paused = pauseStaleInternalNotifications(database, { now, staleAfterMs });
  const due = listDueInternalNotifications(database, { now, limit });
  const summary = {
    processed: 0,
    sent: 0,
    retry: 0,
    failed: 0,
    unknown: 0,
    skipped: 0,
    stale_paused: paused,
  };

  for (const row of due) {
    const result = await deliverInternalNotification(database, row, {
      now,
      sender,
      rng,
      maxAttempts,
    });
    summary.processed += 1;
    const key = Object.hasOwn(summary, result.outcome) ? result.outcome : 'skipped';
    summary[key] += 1;
  }
  return summary;
}

let workerTimer = null;
let workerRunning = false;

export function startInternalNotificationWorker(database, {
  intervalMs = INTERNAL_NOTIFICATION_WORKER_INTERVAL_MS,
  sender = sendViaUserbot,
} = {}) {
  requireDatabase(database);
  if (workerTimer) return workerTimer;

  const run = () => {
    if (workerRunning) return;
    workerRunning = true;
    void processInternalNotifications(database, { sender })
      .then((summary) => {
        if (summary.processed || summary.stale_paused) {
          console.log('[internal-notifications]', summary);
        }
      })
      .catch((error) => {
        console.error('[internal-notifications] worker error:', error);
      })
      .finally(() => {
        workerRunning = false;
      });
  };

  workerTimer = setInterval(run, Math.max(1_000, Number(intervalMs) || 0));
  workerTimer.unref?.();
  setImmediate(run);
  return workerTimer;
}

export function _stopInternalNotificationWorkerForTests() {
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = null;
  workerRunning = false;
}

