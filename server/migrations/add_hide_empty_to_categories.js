import { db } from '../db.js';

/**
 * Добавляет поле hide_empty в таблицу categories для существующих баз данных
 */
export function migrateHideEmpty() {
  try {
    // Проверяем, есть ли уже поле hide_empty
    const columns = db.prepare("PRAGMA table_info(categories)").all();
    const hasHideEmpty = columns.some(col => col.name === 'hide_empty');
    
    if (!hasHideEmpty) {
      console.log('[migration] Adding hide_empty column to categories table...');
      db.prepare("ALTER TABLE categories ADD COLUMN hide_empty INTEGER NOT NULL DEFAULT 0").run();
      console.log('[migration] Successfully added hide_empty column');
    } else {
      console.log('[migration] hide_empty column already exists');
    }
  } catch (error) {
    console.error('[migration] Failed to add hide_empty column:', error);
    throw error;
  }
}