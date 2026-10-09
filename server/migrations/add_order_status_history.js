import { db } from '../db.js';

export function migrateOrderStatusHistory() {
  try {
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='order_status_history'
    `).get();

    if (!tableExists) {
      console.log('[migration] Creating order_status_history table');
      db.exec(`
        CREATE TABLE IF NOT EXISTS order_status_history (
          id TEXT PRIMARY KEY,
          order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          previous_status TEXT,
          new_status TEXT NOT NULL,
          changed_at TEXT NOT NULL DEFAULT (DATETIME('now')),
          note TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_order_status_history_order
          ON order_status_history(order_id);
        CREATE INDEX IF NOT EXISTS idx_order_status_history_changed
          ON order_status_history(changed_at);
      `);
    }

    // Add previous_status column if missing
    const columns = db.prepare(`PRAGMA table_info(orders)`).all();
    const hasPreviousStatus = columns.some((col) => col.name === 'previous_status');
    if (!hasPreviousStatus) {
      console.log('[migration] Adding previous_status column to orders table');
      db.exec(`ALTER TABLE orders ADD COLUMN previous_status TEXT`);
    }

    // Ensure cancelled_at column for potential future use (optional)
    const hasCancelledAt = columns.some((col) => col.name === 'cancelled_at');
    if (!hasCancelledAt) {
      try {
        db.exec(`ALTER TABLE orders ADD COLUMN cancelled_at TEXT`);
      } catch (error) {
        if (!String(error.message).includes('duplicate column name')) {
          throw error;
        }
      }
    }

    const procurementColumns = db.prepare(`PRAGMA table_info(procurements)`).all();
    const hasExpenseTransaction = procurementColumns.some((col) => col.name === 'expense_transaction_id');
    if (!hasExpenseTransaction) {
      console.log('[migration] Adding expense_transaction_id column to procurements table');
      db.exec(`ALTER TABLE procurements ADD COLUMN expense_transaction_id TEXT`);
    }

    console.log('[migration] Order status history migration completed successfully');
  } catch (error) {
    console.error('[migration] Order status history migration failed:', error);
    if (!String(error.message).includes('duplicate column name')) {
      throw error;
    }
  }
}
