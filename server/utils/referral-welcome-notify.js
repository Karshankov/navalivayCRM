import { db } from '../db.js';
import { getActiveBlockForCustomerId } from './customer-blocks.js';
import { sendQuickReplyViaUserbot } from './userbot-client.js';

export const REFERRAL_WELCOME_SHORTCUT =
  String(process.env.REFERRAL_WELCOME_QUICK_REPLY || 'Прайс').trim() || 'Прайс';
export const REFERRAL_WELCOME_WORKER_INTERVAL_MS = 10_000;

function toSqliteDate(date) {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

export function computeReferralWelcomeRetryMs(attempt) {
  const power = Math.max(0, Math.min(10, Number(attempt) || 0));
  return Math.min(30 * 60_000, 15_000 * (2 ** power));
}

export function listDueReferralWelcomeNotifications({ now = new Date(), limit = 10 } = {}) {
  return db.prepare(`
    SELECT * FROM referral_welcome_notifications
    WHERE (
      status IN ('pending', 'retry') AND next_attempt_at <= ?
    ) OR (
      status = 'sending' AND updated_at <= DATETIME(?, '-2 minutes')
    )
    ORDER BY next_attempt_at ASC
    LIMIT ?
  `).all(toSqliteDate(now), toSqliteDate(now), Math.max(1, Math.min(50, Number(limit) || 10)));
}

function claimNotification(customerId, now) {
  const nowSql = toSqliteDate(now);
  const result = db.prepare(`
    UPDATE referral_welcome_notifications
    SET status = 'sending', attempts = attempts + 1, updated_at = ?
    WHERE customer_id = ?
      AND (
        (status IN ('pending', 'retry') AND next_attempt_at <= ?)
        OR (status = 'sending' AND updated_at <= DATETIME(?, '-2 minutes'))
      )
  `).run(nowSql, String(customerId), nowSql, nowSql);
  if (!result.changes) return null;
  return db.prepare(`
    SELECT * FROM referral_welcome_notifications WHERE customer_id = ?
  `).get(String(customerId));
}

function finishNotification(customerId, { status, error = null, messageIds = null, now = new Date() }) {
  db.prepare(`
    UPDATE referral_welcome_notifications
    SET status = ?, last_error = ?, telegram_message_ids = ?,
        sent_at = CASE WHEN ? = 'sent' THEN ? ELSE sent_at END,
        updated_at = ?
    WHERE customer_id = ?
  `).run(
    status,
    error,
    messageIds ? JSON.stringify(messageIds) : null,
    status,
    toSqliteDate(now),
    toSqliteDate(now),
    String(customerId),
  );
}

function retryNotification(row, error, now, { retryAfterSeconds = 0 } = {}) {
  // Очередь маленькая (одно приветствие на нового клиента), поэтому временные
  // сбои повторяем до восстановления. Стабильный random_id защищает от дубля,
  // если Telegram принял сообщение, но ответ потерялся.
  const telegramDelay = Math.max(0, Number(retryAfterSeconds) || 0) * 1000;
  const delay = Math.max(computeReferralWelcomeRetryMs(row.attempts), telegramDelay);
  const next = new Date(now.getTime() + delay);
  db.prepare(`
    UPDATE referral_welcome_notifications
    SET status = 'retry', last_error = ?, next_attempt_at = ?, updated_at = ?
    WHERE customer_id = ?
  `).run(error, toSqliteDate(next), toSqliteDate(now), String(row.customer_id));
}

export async function deliverReferralWelcomeNotification(row, {
  now = new Date(),
  sender = sendQuickReplyViaUserbot,
} = {}) {
  const claimed = claimNotification(row.customer_id, now);
  if (!claimed) return { sent: false, skipped: true, reason: 'not_claimed' };

  const customer = db.prepare(`
    SELECT id, telegram_id, access_authorization_source, deleted_at
    FROM customers WHERE id = ?
  `).get(String(claimed.customer_id));
  if (
    !customer
    || customer.deleted_at
    || customer.access_authorization_source !== 'referral'
    || String(customer.telegram_id || '') !== String(claimed.telegram_id)
  ) {
    finishNotification(claimed.customer_id, {
      status: 'skipped',
      error: 'customer_not_eligible',
      now,
    });
    return { sent: false, skipped: true, reason: 'customer_not_eligible' };
  }
  if (getActiveBlockForCustomerId(customer.id)) {
    finishNotification(customer.id, { status: 'skipped', error: 'customer_blocked', now });
    return { sent: false, skipped: true, reason: 'customer_blocked' };
  }

  let result;
  try {
    result = await sender({
      chatId: customer.telegram_id,
      shortcut: REFERRAL_WELCOME_SHORTCUT,
      idempotencyKey: `referral-welcome:${customer.id}`,
    });
  } catch (error) {
    result = { ok: false, outcome: 'ambiguous', error: error?.message || String(error) };
  }
  if (result?.ok) {
    finishNotification(customer.id, {
      status: 'sent',
      messageIds: result.telegram_message_ids || [],
      now,
    });
    return { sent: true, telegram_message_ids: result.telegram_message_ids || [] };
  }

  const error = String(result?.error || 'send_failed').slice(0, 300);
  retryNotification(claimed, error, now, {
    retryAfterSeconds: result?.retry_after_seconds,
  });
  return { sent: false, pending: true, reason: error };
}

export async function processReferralWelcomeNotifications({
  now = new Date(),
  limit = 10,
  sender = sendQuickReplyViaUserbot,
} = {}) {
  const rows = listDueReferralWelcomeNotifications({ now, limit });
  const summary = { processed: 0, sent: 0, pending: 0, skipped: 0 };
  for (const row of rows) {
    const result = await deliverReferralWelcomeNotification(row, { now, sender });
    summary.processed += 1;
    if (result.sent) summary.sent += 1;
    else if (result.pending) summary.pending += 1;
    else summary.skipped += 1;
  }
  return summary;
}

let workerTimer = null;
let workerRunning = false;

export function startReferralWelcomeNotificationWorker({
  intervalMs = REFERRAL_WELCOME_WORKER_INTERVAL_MS,
} = {}) {
  if (workerTimer) return workerTimer;
  const run = () => {
    if (workerRunning) return;
    workerRunning = true;
    void processReferralWelcomeNotifications()
      .then((summary) => {
        if (summary.processed) console.log('[referral-welcome]', summary);
      })
      .catch((error) => console.error('[referral-welcome] worker error:', error))
      .finally(() => { workerRunning = false; });
  };
  workerTimer = setInterval(run, intervalMs);
  workerTimer.unref?.();
  setImmediate(run);
  return workerTimer;
}

export function _stopReferralWelcomeNotificationWorkerForTests() {
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = null;
  workerRunning = false;
}
