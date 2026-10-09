import { db } from '../db.js';

export function migrateSettingsTable() {
  try {
    // Проверяем, есть ли уже таблица settings
    const tableExists = db.prepare(`
      SELECT COUNT(*) as count
      FROM sqlite_master
      WHERE type='table' AND name='settings';
    `).get();

    if (tableExists.count === 0) {
      console.log('[migration] Creating settings table...');
      
      // Создаем таблицу settings
      db.exec(`
        CREATE TABLE settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);

      // Добавляем дефолтные настройки для менеджера
      const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
      
      insertSetting.run('manager_name', 'Дмитрий');
      insertSetting.run('manager_telegram', 'dmitriy_mityuk');
      
      console.log('[migration] Settings table created with default manager settings');
    } else {
      console.log('[migration] Settings table already exists, skipping...');
    }
  } catch (error) {
    console.error('[migration] Error creating settings table:', error);
    throw error;
  }
}