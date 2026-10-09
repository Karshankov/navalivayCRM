import { db } from '../db.js';

export function migratePosSaleTransactionLink() {
  try {
    const posSalesColumns = db.prepare(`PRAGMA table_info(pos_sales)`).all();
    const hasTransactionId = posSalesColumns.some((col) => col.name === 'transaction_id');

    if (!hasTransactionId) {
      console.log('[migration] Adding transaction_id column to pos_sales table');
      db.exec(`ALTER TABLE pos_sales ADD COLUMN transaction_id TEXT`);
    }

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_pos_sales_transaction_id
      ON pos_sales(transaction_id);
    `);

    console.log('[migration] POS sale transaction link migration completed successfully');
  } catch (error) {
    console.error('[migration] POS sale transaction link migration failed:', error);
    if (!String(error.message).includes('duplicate column name')) {
      throw error;
    }
  }
}
