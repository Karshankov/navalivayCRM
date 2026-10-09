import { db } from '../db.js';

export function addTelegramUsernameToOrders() {
  try {
    // Проверяем, существует ли уже поле telegram_username
    const tableInfo = db.prepare(`PRAGMA table_info(orders)`).all();
    const hasColumn = tableInfo.some(col => col.name === 'telegram_username');
    
    if (hasColumn) {
      console.log('[migration] telegram_username column already exists in orders table, skipping');
      return;
    }

    console.log('[migration] Adding telegram_username column to orders table...');

    // Добавляем поле telegram_username
    db.exec(`
      ALTER TABLE orders ADD COLUMN telegram_username TEXT;
    `);

    // Создаём индекс для быстрого поиска по telegram_username
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_orders_telegram_username ON orders(telegram_username);
    `);

    console.log('[migration] Successfully added telegram_username to orders table');
  } catch (error) {
    console.error('[migration] Failed to add telegram_username to orders:', error);
    throw error;
  }
}
