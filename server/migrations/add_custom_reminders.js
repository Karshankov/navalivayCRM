import { db } from '../db.js';
import {
  BUSINESS_TIME_ZONE,
  getUtcDateForTimeZoneLocalTime,
  getTimeZoneDateParts,
} from '../utils/business-time.js';

/**
 * Пользовательские напоминания (раздел «Напоминания» в CRM).
 *
 * Каждое напоминание — произвольный текст, список получателей (юзернеймы из
 * команды: @ppofic, @rk0ff, @QuaiLLLL — можно несколько) и расписание двух
 * видов:
 *   - interval: каждые N дней в заданное время (часы:минуты по Минску);
 *   - monthly: каждый месяц в выбранный день и время (день берётся из
 *     monthly_date; в месяцах, где такого дня нет — например 31-го в
 *     феврале — отправка в этом месяце пропускается).
 *
 * Отправку выполняет userbot через штатный internal_notification_outbox:
 * планировщик (custom-reminder-scheduler.js) по due_key (календарная дата
 * момента отправки) ставит сообщение в очередь ровно один раз на каждый
 * момент и каждого получателя, а воркер доставляет и повторяет при сбоях.
 * Так пропуск окна (сервер был выключен) догоняется включением без дублей.
 *
 * Telegram ID получателей не хранится: они разрешаются из карточек клиентов
 * с теми же юзернеймами при каждой отправке (схема как у сотрудников CRM).
 * Если юзернейм пропал из базы — доставка этому получателю не ставится.
 */

const FINAL_SCHEMA = `
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  schedule_type TEXT NOT NULL DEFAULT 'interval'
    CHECK (schedule_type IN ('interval', 'monthly')),
  schedule_hour INTEGER NOT NULL DEFAULT 12
    CHECK (schedule_hour >= 0 AND schedule_hour <= 23),
  schedule_minute INTEGER NOT NULL DEFAULT 0
    CHECK (schedule_minute >= 0 AND schedule_minute <= 59),
  interval_days INTEGER
    CHECK (interval_days IS NULL OR (interval_days >= 1 AND interval_days <= 365)),
  monthly_date TEXT
    CHECK (monthly_date IS NULL OR monthly_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  recipient_usernames TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  last_due_key TEXT,
  last_enqueued_at TEXT,
  created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
  updated_at TEXT NOT NULL DEFAULT (DATETIME('now'))
`;

function pad2(value) {
  return String(value).padStart(2, '0');
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Ключ последнего прошедшего вхождения дня месяца (для конвертации
 * разовых → ежемесячные): 'day:YYYY-MM-DD' дня этого вхождения или null,
 * если таких вхождений ещё не было. Календарь и время — по Минску,
 * как в планировщике.
 */
function convertedMonthlyCatchUpKey(monthlyDate, hour, minute, now) {
  const dayOfMonth = Number(String(monthlyDate).split('-')[2]);
  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) return null;

  const nowParts = getTimeZoneDateParts(now, BUSINESS_TIME_ZONE);
  let year = nowParts.year;
  let month = nowParts.month;
  for (let step = 0; step < 3; step += 1) {
    if (dayOfMonth <= daysInMonth(year, month)) {
      const at = getUtcDateForTimeZoneLocalTime(
        year, month, dayOfMonth,
        hour ?? 12, minute ?? 0,
      );
      if (at <= now) return `day:${year}-${pad2(month)}-${pad2(dayOfMonth)}`;
    }
    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
  }
  return null;
}

export function migrateCustomReminders(database = db, { now = new Date() } = {}) {
  const target = database || db;
  target.exec(`
    CREATE TABLE IF NOT EXISTS custom_reminders (${FINAL_SCHEMA});

    CREATE INDEX IF NOT EXISTS idx_custom_reminders_enabled
      ON custom_reminders(enabled);
  `);

  // Развёртка старых схем: v1 (получатель-сотрудник) → v2 (один юзернейм,
  // расписание once) → v3 (список юзернеймов) → v4 (monthly вместо once).
  // Таблица могла быть создана на любом шаге — конвертируем данные и
  // пересоздаём в финальной схеме.
  const columns = target.prepare(`
    SELECT name FROM pragma_table_info('custom_reminders')
  `).all().map((row) => row.name);
  const legacy = ['recipient_employee_id', 'recipient_username', 'once_date']
    .some((column) => columns.includes(column));

  if (legacy) {
    const rows = target.prepare('SELECT * FROM custom_reminders').all();
    const converted = [];
    for (const row of rows) {
      // Получатели: массив (v3) → одиночный юзернейм (v2) → сотрудник (v1).
      let usernames = [];
      try {
        const parsed = JSON.parse(String(row.recipient_usernames ?? '[]'));
        if (Array.isArray(parsed)) usernames = parsed;
      } catch { /* пустой или битый JSON — пробуем старые поля */ }
      if (!usernames.length && row.recipient_username) {
        usernames = [String(row.recipient_username)];
      }
      if (!usernames.length && row.recipient_employee_id) {
        const employee = target.prepare(`
          SELECT telegram_username FROM employees WHERE id = ?
        `).get(row.recipient_employee_id);
        if (employee?.telegram_username) usernames = [employee.telegram_username];
      }
      if (!usernames.length) continue;

      // Расписание: 'once' → 'monthly' (тот же день теперь ежемесячный).
      // Догонные ключи формата day: остаются валидными, прочие сбрасываем.
      // Но «разовое» с датой, которая уже прошла, при конвертации в
      // ежемесячное не должно немедленно догоняться: помечаем последнее
      // прошедшее вхождение как обработанное — первая отправка будет
      // в следующем месяце.
      const scheduleType = row.schedule_type === 'once' ? 'monthly' : row.schedule_type;
      const monthlyDate = row.monthly_date || row.once_date || null;
      let lastDueKey = String(row.last_due_key || '').startsWith('day:')
        ? row.last_due_key
        : null;
      if (scheduleType === 'monthly' && monthlyDate && !lastDueKey) {
        lastDueKey = convertedMonthlyCatchUpKey(monthlyDate, row.schedule_hour, row.schedule_minute, now);
      }
      converted.push({
        ...row,
        schedule_type: scheduleType,
        monthly_date: monthlyDate,
        recipient_usernames: JSON.stringify(
          usernames.map((item) => String(item).trim().replace(/^@+/, '')).filter(Boolean),
        ),
        last_due_key: lastDueKey,
      });
    }

    target.exec('DROP INDEX IF EXISTS idx_custom_reminders_recipient;');
    const rebuild = target.transaction(() => {
      target.exec(`
        DROP TABLE custom_reminders;
        CREATE TABLE custom_reminders (${FINAL_SCHEMA});
      `);
      const insert = target.prepare(`
        INSERT INTO custom_reminders (
          id, title, message, schedule_type, schedule_hour, schedule_minute,
          interval_days, monthly_date, recipient_usernames, enabled,
          last_due_key, last_enqueued_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const row of converted) {
        insert.run(
          row.id, row.title, row.message, row.schedule_type,
          row.schedule_hour, row.schedule_minute, row.interval_days,
          row.monthly_date, row.recipient_usernames, row.enabled,
          row.last_due_key, row.last_enqueued_at, row.created_at, row.updated_at,
        );
      }
    });
    rebuild();
    target.exec(`
      CREATE INDEX IF NOT EXISTS idx_custom_reminders_enabled
        ON custom_reminders(enabled);
    `);
  }

  console.log('[migration] custom_reminders table ready');
}
