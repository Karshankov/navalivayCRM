import { db } from '../db.js';

export function migrateArchivedToOrders() {
  try {
    // Проверяем существует ли колонка
    const tableInfo = db.prepare("PRAGMA table_info(orders)").all();
    const hasArchived = tableInfo.some(col => col.name === 'archived');

    if (!hasArchived) {
      console.log('[migration] Adding archived column to orders table...');
      db.prepare('ALTER TABLE orders ADD COLUMN archived INTEGER NOT NULL DEFAULT 0').run();
      console.log('[migration] Successfully added archived column to orders');
    }
  } catch (error) {
    console.error('[migration] Error adding archived column to orders:', error);
  }
}
