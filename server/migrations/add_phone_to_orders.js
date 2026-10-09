import { db } from '../db.js';

export function addPhoneToOrders() {
  try {
    // Проверяем, есть ли уже поле phone в orders
    const columns = db.prepare(`PRAGMA table_info(orders)`).all();
    const hasPhone = columns.some(col => col.name === 'phone');
    
    if (hasPhone) {
      console.log('[migration] phone field already exists in orders table, skipping');
      return;
    }

    console.log('[migration] Adding phone field to orders table...');
    
    db.exec(`
      ALTER TABLE orders ADD COLUMN phone TEXT;
    `);
    
    console.log('[migration] Successfully added phone field to orders table');
  } catch (error) {
    console.error('[migration] Error adding phone to orders:', error);
    throw error;
  }
}
