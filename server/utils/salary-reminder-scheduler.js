import { getTimeZoneDateParts } from './business-time.js';
import { enqueueInternalNotification } from './internal-notifications.js';

export const SALARY_REMINDER_DAY = 20;
export const SALARY_REMINDER_HOUR = 10;
export const SALARY_REMINDER_INTERVAL_MS = 60_000;

const MONTH_NAMES = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
];

function requireDatabase(database) {
  if (!database?.prepare || !database?.transaction) {
    throw new TypeError('database_required');
  }
  return database;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

export function getSalaryReminderPeriod(now = new Date()) {
  const parts = getTimeZoneDateParts(now, 'Europe/Minsk');
  return {
    ...parts,
    periodKey: `${parts.year}-${pad2(parts.month)}`,
    periodLabel: `${MONTH_NAMES[parts.month - 1]} ${parts.year}`,
  };
}

/**
 * Если процесс не работал ровно в 10:00, напоминание догоняется позже в том же
 * месяце. Таблица salary_reminders не даёт повторить его после перезапуска.
 */
export function isSalaryReminderDue(now = new Date()) {
  const parts = getSalaryReminderPeriod(now);
  return (
    parts.day > SALARY_REMINDER_DAY
    || (
      parts.day === SALARY_REMINDER_DAY
      && parts.hour >= SALARY_REMINDER_HOUR
    )
  );
}

export function listSalaryReminderRecipients(database) {
  return requireDatabase(database).prepare(`
    SELECT
      recipient.telegram_id,
      recipient.telegram_username,
      recipient.display_name
    FROM internal_notification_recipients AS recipient
    INNER JOIN internal_notification_settings AS setting
      ON setting.event_group = recipient.event_group
    WHERE recipient.event_group = 'salary'
      AND recipient.active = 1
      AND recipient.confirmed_at IS NOT NULL
      AND setting.enabled = 1
    ORDER BY recipient.id ASC
  `).all();
}

export function enqueueDueSalaryReminders(database, {
  now = new Date(),
  recipients = null,
} = {}) {
  const db = requireDatabase(database);
  const period = getSalaryReminderPeriod(now);
  if (!isSalaryReminderDue(now)) {
    return {
      due: false,
      period_key: period.periodKey,
      enqueued: 0,
      duplicates: 0,
    };
  }

  const confirmedRecipients = recipients ?? listSalaryReminderRecipients(db);
  if (!confirmedRecipients.length) {
    return {
      due: true,
      period_key: period.periodKey,
      enqueued: 0,
      duplicates: 0,
      reason: 'confirmed_recipient_missing',
    };
  }

  const run = db.transaction(() => {
    let enqueued = 0;
    let duplicates = 0;
    const nowSql = now.toISOString().replace('T', ' ').slice(0, 19);

    for (const recipient of confirmedRecipients) {
      const telegramId = String(recipient.telegram_id || '').trim();
      const uniqueKey = `salary-reminder:${period.periodKey}:${telegramId}`;
      const marker = db.prepare(`
        INSERT INTO salary_reminders (
          period_key, recipient_telegram_id, notification_unique_key, created_at
        )
        VALUES (?, ?, ?, ?)
        ON CONFLICT(period_key, recipient_telegram_id) DO NOTHING
      `).run(period.periodKey, telegramId, uniqueKey, nowSql);

      if (marker.changes === 0) {
        duplicates += 1;
        continue;
      }

      const queued = enqueueInternalNotification(db, {
        uniqueKey,
        eventType: 'salary.reminder',
        recipientTelegramId: telegramId,
        recipientUsername: recipient.telegram_username,
        payload: {
          period: period.periodKey,
          period_label: period.periodLabel,
        },
        now,
      });
      if (queued.enqueued) enqueued += 1;
      else duplicates += 1;
    }

    return { enqueued, duplicates };
  });

  return {
    due: true,
    period_key: period.periodKey,
    ...run(),
  };
}

let schedulerTimer = null;
let schedulerRunning = false;

export function startSalaryReminderScheduler(database, {
  intervalMs = SALARY_REMINDER_INTERVAL_MS,
  nowProvider = () => new Date(),
} = {}) {
  requireDatabase(database);
  if (schedulerTimer) return schedulerTimer;

  const run = () => {
    if (schedulerRunning) return;
    schedulerRunning = true;
    try {
      const result = enqueueDueSalaryReminders(database, { now: nowProvider() });
      if (result.enqueued) {
        console.log(
          `[salary-reminder] Queued ${result.enqueued} reminder(s) for ${result.period_key}`,
        );
      }
    } catch (error) {
      console.error('[salary-reminder] scheduler error:', error);
    } finally {
      schedulerRunning = false;
    }
  };

  schedulerTimer = setInterval(run, Math.max(1_000, Number(intervalMs) || 0));
  schedulerTimer.unref?.();
  setImmediate(run);
  return schedulerTimer;
}

export function _stopSalaryReminderSchedulerForTests() {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
  schedulerRunning = false;
}

