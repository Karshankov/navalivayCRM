import { db } from '../db.js';
import {
  BUSINESS_TIME_ZONE,
  getUtcDateForTimeZoneLocalTime,
  getTimeZoneDateParts,
} from './business-time.js';
import { enqueueInternalNotification } from './internal-notifications.js';

/**
 * Планировщик пользовательских напоминаний (раздел «Напоминания»).
 *
 * Как и salary-reminder-scheduler, работает коротким тиком раз в минуту:
 * находит включённые напоминания, чей момент отправки уже наступил (по
 * часовому поясу Минска), и ставит их в internal_notification_outbox —
 * дальше доставляет штатный воркер userbot-уведомлений.
 *
 * Защита от дублей — таблица custom_reminders + UNIQUE(reminder_id, due_key):
 * каждый момент отправки имеет свой ключ (интервальные — дата календаря,
 * разовые — id напоминания). Перезапуск процесса не меняет картину: если
 * сервер был выключен ровно в 15:00, при включении тик увидит «момент
 * наступил, а строки с таким due_key ещё нет» и догонит отправку.
 */

export const CUSTOM_REMINDER_INTERVAL_MS = 60_000;
export const CUSTOM_REMINDER_EVENT_TYPE = 'custom.reminder';

function requireDatabase(database) {
  if (!database?.prepare || !database?.transaction) {
    throw new TypeError('database_required');
  }
  return database;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

/** Ключ одного момента отправки: календарная дата по Минску (для интервальных). */
export function getReminderDueKey(reminder, now = new Date()) {
  const parts = getTimeZoneDateParts(now, BUSINESS_TIME_ZONE);
  if (reminder.schedule_type === 'once') {
    return `once:${reminder.id}`;
  }
  return `day:${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

/**
 * UTC-момент очередной отправки напоминания, не позже now.
 *
 * interval: двигаемся от даты создания назад/вперёд по календарю Минска
 * с шагом interval_days и берём последний момент времени отправки <= now.
 * once: единственная дата (границы месяца/года корректны, т.к. дата
 * задаётся через getUtcDateForTimeZoneLocalTime).
 */
export function computeLastDueAt(reminder, now = new Date()) {
  if (reminder.schedule_type === 'once') {
    const [year, month, day] = String(reminder.once_date || '').split('-').map(Number);
    if (!year || !month || !day) return null;
    return getUtcDateForTimeZoneLocalTime(
      year,
      month,
      day,
      reminder.schedule_hour,
      reminder.schedule_minute,
    );
  }

  const intervalDays = Number(reminder.interval_days);
  if (!Number.isInteger(intervalDays) || intervalDays < 1) return null;

  const nowParts = getTimeZoneDateParts(now, BUSINESS_TIME_ZONE);
  const created = new Date(String(reminder.created_at || '').replace(' ', 'T') + 'Z');
  const createdParts = Number.isFinite(created.getTime())
    ? getTimeZoneDateParts(created, BUSINESS_TIME_ZONE)
    : { year: nowParts.year, month: nowParts.month, day: nowParts.day };

  // Разница календарных дат Минска; отрицательной быть не может: created_at
  // всегда в прошлом, но на всякий случай ограничиваем нулём.
  const utcDay = (p) => Date.UTC(p.year, p.month - 1, p.day) / 86_400_000;
  const dayDiff = Math.max(0, utcDay(nowParts) - utcDay(createdParts));

  // Последний номер шага n, для которого created_at + n*interval <= today.
  // Номер шага 0 — сам день создания (время отправки в нём тоже считается,
  // если ещё не наступило — ниже сравним с временем).
  const step = Math.floor(dayDiff / intervalDays);
  let scheduledAt = scheduledDateForStep(createdParts, step, reminder);
  if (scheduledAt > now) {
    if (step === 0) return null;
    return scheduledDateForStep(createdParts, step - 1, reminder);
  }
  return scheduledAt;
}

function scheduledDateForStep(createdParts, step, reminder) {
  const target = new Date(
    Date.UTC(createdParts.year, createdParts.month - 1, createdParts.day + step * Number(reminder.interval_days)),
  );
  return getUtcDateForTimeZoneLocalTime(
    target.getUTCFullYear(),
    target.getUTCMonth() + 1,
    target.getUTCDate(),
    reminder.schedule_hour,
    reminder.schedule_minute,
  );
}

/** Прогноз следующих отправок для карточки в CRM (Minsk-метки, ISO-даты). */
export function listUpcomingRuns(reminder, { now = new Date(), count = 2 } = {}) {
  const runs = [];
  if (reminder.schedule_type === 'once') {
    const at = computeLastDueAt(reminder, now);
    if (at && at >= now) runs.push(at);
    return runs;
  }
  const last = computeLastDueAt(reminder, now);
  let anchor = last || now;
  for (let i = 0; i < count; i += 1) {
    const next = new Date(
      anchor.getTime() + Number(reminder.interval_days) * 86_400_000,
    );
    runs.push(next);
    anchor = next;
  }
  return runs;
}

/**
 * Ставит в очередь все напоминания, чей момент уже наступил.
 * Идемпотентно: повторный вызов не дублирует (UNIQUE по
 * reminder+due_key+получатель).
 */
export function parseRecipientUsernames(value) {
  try {
    const parsed = JSON.parse(String(value ?? '[]'));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => String(item ?? '').trim().replace(/^@+/, ''))
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function enqueueDueCustomReminders(database, { now = new Date() } = {}) {
  const target = requireDatabase(database);
  const due = target.prepare(`
    SELECT reminder.*
    FROM custom_reminders AS reminder
    WHERE reminder.enabled = 1
    ORDER BY reminder.created_at ASC
  `).all();

  let enqueued = 0;
  let skipped = 0;
  let failures = 0;

  for (const reminder of due) {
    try {
      const dueAt = computeLastDueAt(reminder, now);
      if (!dueAt || dueAt > now) {
        skipped += 1;
        continue;
      }
      const dueKey = getReminderDueKey(reminder, now);
      if (reminder.last_due_key === dueKey) {
        skipped += 1;
        continue;
      }

      const usernames = parseRecipientUsernames(reminder.recipient_usernames);
      let sentAtLeastOne = false;

      // Telegram ID не храним: каждый раз берём из карточки клиента по
      // юзернейму (схема как у сотрудников CRM). Нет карточки — этот
      // получатель пропускается, остальные всё равно получают сообщение.
      for (const username of usernames) {
        const customer = target.prepare(`
          SELECT telegram_id, telegram_username, first_name, last_name
          FROM customers
          WHERE deleted_at IS NULL
            AND lower(ltrim(trim(COALESCE(telegram_username, '')), '@')) = ?
            AND telegram_id IS NOT NULL
          ORDER BY updated_at DESC, id DESC
        `).get(username.toLowerCase());
        if (!customer) {
          failures += 1;
          console.error('[custom-reminder] recipient not found in customers:', username);
          continue;
        }

        // Ключ включает юзернейм: каждому получателю — своя доставка,
        // идемпотентная независимо от остальных.
        const uniqueKey = `custom-reminder:${reminder.id}:${dueKey}:${username.toLowerCase()}`;
        const result = enqueueInternalNotification(target, {
          uniqueKey,
          eventType: CUSTOM_REMINDER_EVENT_TYPE,
          recipientTelegramId: customer.telegram_id,
          recipientUsername: customer.telegram_username || username,
          payload: {
            text: reminder.message,
            reminder_title: reminder.title,
          },
          now,
        });
        if (result.enqueued) {
          enqueued += 1;
          sentAtLeastOne = true;
        }
      }

      // Догон: фиксируем last_due_key, даже если все доставки оказались
      // дублями после рестарта или получатели не нашлись — иначе каждые
      // 60 секунд тик будет пересматривать одно и то же окно.
      target.prepare(`
        UPDATE custom_reminders
        SET last_due_key = ?, last_enqueued_at = ?, updated_at = DATETIME('now')
        WHERE id = ?
      `).run(dueKey, now.toISOString().replace('T', ' ').slice(0, 19), reminder.id);

      if (!sentAtLeastOne && !usernames.length) skipped += 1;
    } catch (error) {
      failures += 1;
      console.error('[custom-reminder] enqueue failed:', reminder.id, error?.message || error);
    }
  }

  return { enqueued, skipped, failures };
}

let schedulerTimer = null;
let schedulerRunning = false;

export function startCustomReminderScheduler(database = db, {
  intervalMs = CUSTOM_REMINDER_INTERVAL_MS,
  nowProvider = () => new Date(),
} = {}) {
  requireDatabase(database);
  if (schedulerTimer) return schedulerTimer;

  const run = () => {
    if (schedulerRunning) return;
    schedulerRunning = true;
    try {
      const result = enqueueDueCustomReminders(database, { now: nowProvider() });
      if (result.enqueued) {
        console.log(`[custom-reminder] Queued ${result.enqueued} reminder(s)`);
      }
    } catch (error) {
      console.error('[custom-reminder] scheduler error:', error);
    } finally {
      schedulerRunning = false;
    }
  };

  schedulerTimer = setInterval(run, Math.max(1_000, Number(intervalMs) || 0));
  schedulerTimer.unref?.();
  setImmediate(run);
  return schedulerTimer;
}

export function _stopCustomReminderSchedulerForTests() {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
  schedulerRunning = false;
}
