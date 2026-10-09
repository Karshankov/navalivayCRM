import { db } from '../db.js';

function columnExists(table, column) {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`
      )
      .get(column)
  );
}

/**
 * Добавляет информацию о базовом продукте в order_items
 * - Добавляет base_product_id для хранения ID базового продукта
 * - Добавляет base_product_title для хранения названия базового продукта
 */
export function migrateAddBaseProductToOrderItems() {
  console.log('[migration] Starting add base product to order_items migration...');

  try {
    // Добавляем base_product_id в таблицу order_items
    if (!columnExists('order_items', 'base_product_id')) {
      console.log('[migration] Adding base_product_id column to order_items table...');
      db.prepare(`
        ALTER TABLE order_items
        ADD COLUMN base_product_id TEXT
      `).run();
      console.log('[migration] base_product_id column added successfully');
    }

    // Добавляем base_product_title в таблицу order_items
    if (!columnExists('order_items', 'base_product_title')) {
      console.log('[migration] Adding base_product_title column to order_items table...');
      db.prepare(`
        ALTER TABLE order_items
        ADD COLUMN base_product_title TEXT
      `).run();
      console.log('[migration] base_product_title column added successfully');
    }

    console.log('[migration] Add base product to order_items migration completed successfully');
  } catch (error) {
    console.error('[migration] Failed to migrate add base product to order_items:', error);
    throw error;
  }
}
