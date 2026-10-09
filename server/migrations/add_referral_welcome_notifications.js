import { db } from '../db.js';

export function migrateReferralWelcomeNotifications() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS referral_welcome_notifications (
      customer_id TEXT PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
      telegram_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT NOT NULL DEFAULT (DATETIME('now')),
      last_error TEXT,
      telegram_message_ids TEXT,
      created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
      updated_at TEXT NOT NULL DEFAULT (DATETIME('now')),
      sent_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_referral_welcome_due
      ON referral_welcome_notifications(status, next_attempt_at);
  `);
}
