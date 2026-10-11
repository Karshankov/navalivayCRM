import { db } from '../db.js';

// Отдельная надбавка после скидок; себестоимость товаров не меняется.
export function migrateOrderAdditionalCost() {
  const columns = db.prepare('PRAGMA table_info(orders)').all();
  if (!columns.some((column) => column.name === 'additional_cost')) {
    db.exec(`ALTER TABLE orders ADD COLUMN additional_cost REAL NOT NULL DEFAULT 0 CHECK (additional_cost >= 0)`);
  }
}
