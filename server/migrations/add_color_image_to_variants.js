import { db } from '../db.js';

/**
 * Проверяет существование колонки в таблице
 */
function columnExists(table, column) {
  const info = db.prepare(`PRAGMA table_info(${table})`).all();
  return info.some(col => col.name === column);
}

/**
 * Добавляет колонку color_image в таблицу product_variants
 * для хранения URL картинки цвета (вместо или в дополнение к color_code)
 */
export function migrateColorImageToVariants() {
  console.log('[migration] Starting color_image migration for product_variants...');

  try {
    if (!columnExists('product_variants', 'color_image')) {
      console.log('[migration] Adding color_image column to product_variants table...');
      db.prepare(`
        ALTER TABLE product_variants
        ADD COLUMN color_image TEXT DEFAULT NULL
      `).run();
      console.log('[migration] color_image column added successfully');
    } else {
      console.log('[migration] color_image column already exists in product_variants');
    }

    console.log('[migration] color_image migration completed successfully');
  } catch (error) {
    console.error('[migration] Failed to add color_image column:', error);
    throw error;
  }
}

