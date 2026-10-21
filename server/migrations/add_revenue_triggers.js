import { db } from '../db.js';

/**
 * Триггеры выручки (раздел «Финансы»).
 *
 * Триггер задаёт порог суммы на счёте «Выручка» (счёт ищется по имени
 * cash_accounts). Как только баланс достигает порога или превышает его,
 * юзербот отправляет уведомления выбранным получателям (юзернеймы из
 * команды) через штатный internal_notification_outbox. Триггер
 * одноразовый: после срабатывания деактивируется.
 *
 * Проверка выполняется планировщиком (revenue-trigger-scheduler.js)
 * раз в минуту — покрывает любые источники изменения баланса
 * (транзакции, выдача заказов, POS, касса дня), не патча 20+ мест
 * прямых UPDATE cash_accounts.
 *
 * recipient_usernames — JSON-массив, схема как у custom_reminders:
 * Telegram ID не хранится, разрешается при отправке из карточки клиента.
 */

export function migrateRevenueTriggers(database = db) {
  const target = database || db;
  target.exec(`
    CREATE TABLE IF NOT EXISTS revenue_triggers (
      id TEXT PRIMARY KEY,
      threshold_amount REAL NOT NULL CHECK (threshold_amount > 0),
      recipient_usernames TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      triggered_at TEXT,
      triggered_balance REAL,
      last_checked_at TEXT,
      created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
      updated_at TEXT NOT NULL DEFAULT (DATETIME('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_revenue_triggers_enabled
      ON revenue_triggers(enabled);
  `);

  console.log('[migration] revenue_triggers table ready');
}
