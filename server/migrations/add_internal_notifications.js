const DEFAULT_GROUPS = [
  ['documents', 'Документы', 'Закупки и перемещения'],
  ['tasks', 'Задачи', 'Новые задачи и задачи на проверке'],
  ['salary', 'Зарплата', 'Ежемесячное напоминание руководителю'],
];

/**
 * Миграция принимает соединение явно, чтобы её можно было безопасно проверять
 * на отдельной базе и подключить в db.js как migrateInternalNotifications(db).
 */
export function migrateInternalNotifications(database) {
  if (!database?.exec || !database?.prepare) {
    throw new TypeError('database_required');
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS internal_notification_settings (
      event_group TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
      updated_at TEXT NOT NULL DEFAULT (DATETIME('now'))
    );

    CREATE TABLE IF NOT EXISTS internal_notification_recipients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_group TEXT NOT NULL
        REFERENCES internal_notification_settings(event_group) ON DELETE CASCADE,
      telegram_id TEXT NOT NULL,
      telegram_username TEXT NOT NULL COLLATE NOCASE,
      display_name TEXT,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      confirmed_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
      updated_at TEXT NOT NULL DEFAULT (DATETIME('now')),
      UNIQUE(event_group, telegram_id),
      UNIQUE(event_group, telegram_username)
    );

    CREATE TABLE IF NOT EXISTS internal_notification_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      unique_key TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      recipient_telegram_id TEXT NOT NULL,
      recipient_username TEXT,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN (
          'pending', 'sending', 'retry', 'sent', 'unknown', 'failed', 'cancelled'
        )),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      next_attempt_at TEXT NOT NULL DEFAULT (DATETIME('now')),
      locked_at TEXT,
      sent_at TEXT,
      telegram_message_id TEXT,
      last_error TEXT,
      result_json TEXT,
      created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
      updated_at TEXT NOT NULL DEFAULT (DATETIME('now'))
    );

    CREATE TABLE IF NOT EXISTS salary_reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      period_key TEXT NOT NULL,
      recipient_telegram_id TEXT NOT NULL,
      notification_unique_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
      UNIQUE(period_key, recipient_telegram_id)
    );

    CREATE INDEX IF NOT EXISTS idx_internal_notification_recipients_group
      ON internal_notification_recipients(event_group, active);

    CREATE INDEX IF NOT EXISTS idx_internal_notification_outbox_due
      ON internal_notification_outbox(status, next_attempt_at, id);

    CREATE INDEX IF NOT EXISTS idx_internal_notification_outbox_created
      ON internal_notification_outbox(created_at, id);

    CREATE INDEX IF NOT EXISTS idx_salary_reminders_period
      ON salary_reminders(period_key);
  `);

  const seedSetting = database.prepare(`
    INSERT INTO internal_notification_settings (
      event_group, title, description, enabled
    )
    VALUES (?, ?, ?, 0)
    ON CONFLICT(event_group) DO NOTHING
  `);
  const seed = database.transaction(() => {
    for (const row of DEFAULT_GROUPS) seedSetting.run(...row);
  });
  seed();
}

