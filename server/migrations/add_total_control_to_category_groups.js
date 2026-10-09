import { db } from '../db.js';

/**
 * Линейки, отмеченные менеджером, выводятся отдельной сводкой в «Закупках».
 * Миграция идемпотентна, чтобы безопасно запускаться при каждом старте API.
 */
export function migrateCategoryGroupTotalControl() {
  const columns = db.prepare('PRAGMA table_info(category_groups)').all();
  if (!columns.some((column) => column.name === 'total_control')) {
    db.exec(`
      ALTER TABLE category_groups
      ADD COLUMN total_control INTEGER NOT NULL DEFAULT 0;
    `);
    console.log('[migration] Added category_groups.total_control');
  }
}
