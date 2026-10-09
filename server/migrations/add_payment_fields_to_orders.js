import { db } from '../db.js'

function columnExists(tableName, columnName) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all()
  return columns.some((col) => col.name === columnName)
}

export function migrateOrderPaymentFields() {
  try {
    if (!columnExists('orders', 'payment_type')) {
      db.prepare(`ALTER TABLE orders ADD COLUMN payment_type TEXT`).run()
    }

    if (!columnExists('orders', 'payment_account_id')) {
      db.prepare(`ALTER TABLE orders ADD COLUMN payment_account_id TEXT REFERENCES cash_accounts(id)`).run()
    }

    if (!columnExists('orders', 'paid_amount')) {
      db.prepare(`ALTER TABLE orders ADD COLUMN paid_amount REAL DEFAULT 0`).run()
    }

    if (!columnExists('orders', 'paid_at')) {
      db.prepare(`ALTER TABLE orders ADD COLUMN paid_at TEXT`).run()
    }

    if (!columnExists('orders', 'payment_notes')) {
      db.prepare(`ALTER TABLE orders ADD COLUMN payment_notes TEXT`).run()
    }
  } catch (error) {
    console.error('[migration] Failed to add order payment fields:', error)
    // Игнорируем ошибку с дублированием колонок
    if (!error?.message?.includes('duplicate column name')) {
      throw error
    }
  }
}
