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
 * Защита от дублей — поле last_due_key: каждый момент отправки имеет свой
 * ключ — календарную дату этого момента по Минску (день наступления, а не
 * день обработки тиком: догон через неделю всё равно помнит, что
 * отправлял). Перезапуск процесса не меняет картину: если сервер был
 * выключен ровно в 15:00, при включении тик увидит «момент наступил, а
 * ключ ещё не зафиксирован» и догонит отправку.
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

/** Ключ одного момента отправки: календарная дата по Минску. */
export function getReminderDueKey(reminder, now = new Date()) {
  const parts = getTimeZoneDateParts(now, BUSINESS_TIME_ZONE);
  return `day:${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

/** Дней в месяце (календарь, зона не важна). */
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Числа месяца из monthly_days (JSON-массив или одиночное значение). */
export function parseMonthlyDays(value) {
  let raw = value;
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) {
    raw = [Number(raw.trim())];
  } else if (typeof raw === 'number') {
    raw = [raw];
  } else if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return [...new Set(
    raw.map((item) => Number(item)).filter((day) => Number.isInteger(day) && day >= 1 && day <= 31),
  )].sort((a, b) => a - b);
}

/** created_at ('YYYY-MM-DD HH:MM:SS' UTC) как Date; null, если не читается. */
function parseCreatedAt(reminder) {
  const parsed = new Date(String(reminder.created_at || '').replace(' ', 'T') + 'Z');
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

/**
 * UTC-момент очередной отправки напоминания, не позже now.
 *
 * interval: двигаемся от даты создания по календарю Минска с шагом
 * interval_days и берём последний момент времени отправки <= now.
 * monthly: каждый месяц в выбранные числа (monthly_days) в заданное
 * время; числа, которых в месяце нет (31-е в феврале), пропускаются.
 * Берём последний прошедший момент по всем числам.
 */
export function computeLastDueAt(reminder, now = new Date()) {
  const nowParts = getTimeZoneDateParts(now, BUSINESS_TIME_ZONE);

  if (reminder.schedule_type === 'monthly') {
    const monthlyDays = parseMonthlyDays(reminder.monthly_days);
    if (!monthlyDays.length) return null;
    // Идём назад по календарю от текущего месяца: в каждом месяце берём
    // самое позднее из выбранных чисел, чей момент уже наступил. Максимум
    // 3 шага (30-е/31-е числа могут отсутствовать в коротких месяцах).
    // Вхождение до created_at не считается: напоминание ещё не существовало
    // (как и у интервальных, где отсчёт шагов идёт от даты создания).
    const createdAt = parseCreatedAt(reminder);
    let year = nowParts.year;
    let month = nowParts.month;
    for (let step = 0; step < 3; step += 1) {
      const daysHere = monthlyDays.filter((day) => day <= daysInMonth(year, month));
      for (let i = daysHere.length - 1; i >= 0; i -= 1) {
        const at = getUtcDateForTimeZoneLocalTime(
          year,
          month,
          daysHere[i],
          reminder.schedule_hour,
          reminder.schedule_minute,
        );
        if (at <= now) {
          if (createdAt && at < createdAt) return null;
          return at;
        }
      }
      month -= 1;
      if (month < 1) {
        month = 12;
        year -= 1;
      }
    }
    return null;
  }

  const intervalDays = Number(reminder.interval_days);
  if (!Number.isInteger(intervalDays) || intervalDays < 1) return null;

  const created = parseCreatedAt(reminder);
  const createdParts = created
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

/** Прогноз следующих отправок для карточки в CRM (ISO-даты). */
export function listUpcomingRuns(reminder, { now = new Date(), count = 2 } = {}) {
  const runs = [];
  const nowParts = getTimeZoneDateParts(now, BUSINESS_TIME_ZONE);

  if (reminder.schedule_type === 'monthly') {
    const monthlyDays = parseMonthlyDays(reminder.monthly_days);
    if (!monthlyDays.length) return runs;
    // Идём вперёд от текущего месяца (включая его): в каждом месяце —
    // выбранные числа по возрастанию; момент ещё не наступил — в прогноз.
    let year = nowParts.year;
    let month = nowParts.month;
    for (let guard = 0; guard < 24 && runs.length < count; guard += 1) {
      const daysHere = monthlyDays.filter((day) => day <= daysInMonth(year, month));
      for (const day of daysHere) {
        const at = getUtcDateForTimeZoneLocalTime(
          year, month, day,
          reminder.schedule_hour, reminder.schedule_minute,
        );
        if (at > now) runs.push(at);
        if (runs.length >= count) break;
      }
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
    return runs;
  }

  const last = computeLastDueAt(reminder, now);
  let anchorMs = (last || now).getTime();
  for (let i = 0; i < count; i += 1) {
    const next = new Date(
      anchorMs + Number(reminder.interval_days) * 86_400_000,
    );
    runs.push(next);
    anchorMs = next.getTime();
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
      // Ключ — календарный день САМОГО МОМЕНТА отправки (не дня тика):
      // иначе ежемесячное напоминание после срабатывания повторялось бы
      // каждый день до конца месяца, а догон в тот же день гасил бы
      // собственную отправку этого дня.
      const dueKey = getReminderDueKey(reminder, dueAt);
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
