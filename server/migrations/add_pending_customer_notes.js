import { db } from '../db.js';

/**
 * Превентивные заметки по @username для клиентов, которых ещё нет в БД.
 * При первом upsertPublicCustomer переносятся в customers.notes (если пусто).
 */
export function migratePendingCustomerNotes() {
  const tableExists = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'pending_customer_notes' LIMIT 1",
    )
    .get();
  if (tableExists) {
    return;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_customer_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_username TEXT NOT NULL,
      notes TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (DATETIME('now'))
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_pending_notes_username
      ON pending_customer_notes(telegram_username COLLATE NOCASE);
  `);
  console.log('[migration] Created pending_customer_notes table');
}