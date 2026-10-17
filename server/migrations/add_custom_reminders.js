import { db } from '../db.js';

/**
 * Пользовательские напоминания (раздел «Напоминания» в CRM).
 *
 * Каждое напоминание — произвольный текст, список получателей (юзернеймы из
 * команды: @ppofic, @rk0ff, @QuaiLLLL — можно несколько) и расписание двух
 * видов:
 *   - interval: каждые N дней в заданное время (часы:минуты по Минску);
 *   - once: одна конкретная дата и время.
 *
 * Отправку выполняет userbot через штатный internal_notification_outbox:
 * планировщик (custom-reminder-scheduler.js) по due_key ставит сообщение
 * в очередь ровно один раз на каждый момент отправки и каждого получателя,
 * а воркер доставляет и повторяет при сбоях. Так пропуск окна (сервер был
 * выключен) догоняется включением без дублей.
 *
 * Telegram ID получателей не хранится: они разрешаются из карточек клиентов
 * с теми же юзернеймами при каждой отправке (схема как у сотрудников CRM).
 * Если юзернейм пропал из базы — доставка этому получателю не ставится.
 */
export function migrateCustomReminders(database = db) {
  const target = database || db;
  target.exec(`
    CREATE TABLE IF NOT EXISTS custom_reminders (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      schedule_type TEXT NOT NULL DEFAULT 'interval'
        CHECK (schedule_type IN ('interval', 'once')),
      schedule_hour INTEGER NOT NULL DEFAULT 12
        CHECK (schedule_hour >= 0 AND schedule_hour <= 23),
      schedule_minute INTEGER NOT NULL DEFAULT 0
        CHECK (schedule_minute >= 0 AND schedule_minute <= 59),
      interval_days INTEGER
        CHECK (interval_days IS NULL OR (interval_days >= 1 AND interval_days <= 365)),
      once_date TEXT
        CHECK (once_date IS NULL OR once_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
      recipient_usernames TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      last_due_key TEXT,
      last_enqueued_at TEXT,
      created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
      updated_at TEXT NOT NULL DEFAULT (DATETIME('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_custom_reminders_enabled
      ON custom_reminders(enabled);
  `);

  // Развёртка старых схем: получатель-сотрудник (v1) → один юзернейм (v2) →
  // список юзернеймов (v3, текущая). Таблица могла быть создана на любом шаге.
  let columns = target.prepare(`
    SELECT name FROM pragma_table_info('custom_reminders')
  `).all().map((row) => row.name);

  if (columns.includes('recipient_employee_id') || columns.includes('recipient_username')) {
    if (!columns.includes('recipient_usernames')) {
      target.exec(`
        ALTER TABLE custom_reminders
        ADD COLUMN recipient_usernames TEXT NOT NULL DEFAULT '[]'
      `);
      columns = target.prepare(`
        SELECT name FROM pragma_table_info('custom_reminders')
      `).all().map((row) => row.name);
    }
    const tx = target.transaction(() => {
      // v1: получатель-сотрудник → юзернейм.
      if (columns.includes('recipient_employee_id') && columns.includes('recipient_username')) {
        const rows = target.prepare(`
          SELECT reminder.id, employee.telegram_username
          FROM custom_reminders AS reminder
          LEFT JOIN employees AS employee ON employee.id = reminder.recipient_employee_id
          WHERE employee.telegram_username IS NOT NULL
        `).all();
        for (const row of rows) {
          target.prepare(`
            UPDATE custom_reminders
            SET recipient_username = ?
            WHERE id = ?
          `).run(row.telegram_username, row.id);
        }
      }
      // v2: единственный юзернейм → массив из одного.
      const carry = target.prepare(`
        SELECT id, recipient_username FROM custom_reminders
        WHERE recipient_usernames = '[]' AND COALESCE(recipient_username, '') <> ''
      `).all();
      for (const row of carry) {
        const usernames = JSON.stringify([String(row.recipient_username).replace(/^@+/, '')]);
        target.prepare(`
          UPDATE custom_reminders SET recipient_usernames = ? WHERE id = ?
        `).run(usernames, row.id);
      }
      // Напоминания без получателей не восстановить — удаляем.
      target.prepare(`
        DELETE FROM custom_reminders WHERE recipient_usernames IN ('[]', '')
      `).run();
    });
    tx();
    // Чистим таблицу от старых столбцов: пересоздаём в актуальной схеме.
    target.exec('DROP INDEX IF EXISTS idx_custom_reminders_recipient;');
    const recreate = target.transaction(() => {
      target.exec(`
        CREATE TABLE custom_reminders_new (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          message TEXT NOT NULL,
          schedule_type TEXT NOT NULL DEFAULT 'interval'
            CHECK (schedule_type IN ('interval', 'once')),
          schedule_hour INTEGER NOT NULL DEFAULT 12
            CHECK (schedule_hour >= 0 AND schedule_hour <= 23),
          schedule_minute INTEGER NOT NULL DEFAULT 0
            CHECK (schedule_minute >= 0 AND schedule_minute <= 59),
          interval_days INTEGER
            CHECK (interval_days IS NULL OR (interval_days >= 1 AND interval_days <= 365)),
          once_date TEXT
            CHECK (once_date IS NULL OR once_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
          recipient_usernames TEXT NOT NULL DEFAULT '[]',
          enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
          last_due_key TEXT,
          last_enqueued_at TEXT,
          created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
          updated_at TEXT NOT NULL DEFAULT (DATETIME('now'))
        );
        INSERT INTO custom_reminders_new (
          id, title, message, schedule_type, schedule_hour, schedule_minute,
          interval_days, once_date, recipient_usernames, enabled,
          last_due_key, last_enqueued_at, created_at, updated_at
        )
        SELECT
          id, title, message, schedule_type, schedule_hour, schedule_minute,
          interval_days, once_date, recipient_usernames, enabled,
          last_due_key, last_enqueued_at, created_at, updated_at
        FROM custom_reminders;
        DROP TABLE custom_reminders;
        ALTER TABLE custom_reminders_new RENAME TO custom_reminders;
      `);
    });
    recreate();
    target.exec(`
      CREATE INDEX IF NOT EXISTS idx_custom_reminders_enabled
        ON custom_reminders(enabled);
    `);
  }

  console.log('[migration] custom_reminders table ready');
}
