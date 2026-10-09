import { db } from '../db.js';

export function migrateCustomerFeedbacks() {
  try {
    const exists = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='customer_feedbacks'
    `).get();
    if (exists) {
      return;
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS customer_feedbacks (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        telegram_username TEXT,
        customer_name TEXT,
        reason TEXT NOT NULL,
        processed_by TEXT,
        processed_at TEXT NOT NULL DEFAULT (DATETIME('now')),
        created_at TEXT NOT NULL DEFAULT (DATETIME('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_customer_feedbacks_customer ON customer_feedbacks(customer_id);
      CREATE INDEX IF NOT EXISTS idx_customer_feedbacks_processed_at ON customer_feedbacks(processed_at);
    `);
  } catch (error) {
    console.error('[migration] Customer feedbacks migration failed:', error);
    throw error;
  }
}
