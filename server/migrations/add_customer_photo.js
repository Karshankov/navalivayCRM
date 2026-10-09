import { db } from '../db.js';

export function migrateCustomerPhoto() {
  try {
    const columns = db.pragma('table_info(customers)').map(c => c.name);

    if (!columns.includes('photo_url')) {
      db.exec(`ALTER TABLE customers ADD COLUMN photo_url TEXT`);
      console.log('[migration] Added photo_url to customers');
    }

    if (!columns.includes('photo_updated_at')) {
      db.exec(`ALTER TABLE customers ADD COLUMN photo_updated_at TEXT`);
      console.log('[migration] Added photo_updated_at to customers');
    }
  } catch (error) {
    if (!error.message.includes('duplicate column name')) {
      console.error('[migration] Customer photo migration failed:', error);
    }
  }
}
