import { db } from '../db.js';

/**
 * Добавляет поле use_category_image в таблицу products.
 * По умолчанию true (1) - товар использует изображение категории если у него нет своих изображений.
 */
export function migrateUseCategoryImage() {
  try {
    // Проверяем, существует ли колонка
    const tableInfo = db.prepare("PRAGMA table_info(products)").all();
    const hasColumn = tableInfo.some(col => col.name === 'use_category_image');

    if (!hasColumn) {
      console.log('[migration] Adding use_category_image column to products table...');
      
      // Добавляем колонку с дефолтным значением 1 (true)
      db.prepare(`
        ALTER TABLE products
        ADD COLUMN use_category_image INTEGER NOT NULL DEFAULT 1
      `).run();
      
      console.log('[migration] use_category_image column added successfully');
    }
  } catch (error) {
    console.error('[migration] Failed to add use_category_image column:', error);
    throw error;
  }
}
