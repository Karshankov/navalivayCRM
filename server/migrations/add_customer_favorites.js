import { db } from '../db.js';

function tableExists(name) {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`
      )
      .get(name)
  );
}

/**
 * Избранное клиентов мини-аппа.
 *
 * - Одна запись = один товар или один конкретный вкус/вариант товара
 *   (variant_id NULL у товаров без вариантов).
 * - Уникальность (customer_id, product_id, variant_id) держит код:
 *   в SQLite NULL != NULL, поэтому UNIQUE-индекс сам по себе не
 *   защищает от дублей записей без варианта.
 * - product_id без FK осознанно: записи переживают удаление товара
 *   админом (клиент видит «Больше не продаётся» и убирает сам).
 */
export function migrateCustomerFavorites() {
  console.log('[migration] Starting customer favorites migration...');

  try {
    db.transaction(() => {
      if (!tableExists('customer_favorites')) {
        db.prepare(`
          CREATE TABLE IF NOT EXISTS customer_favorites (
            id TEXT PRIMARY KEY,
            customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
            product_id TEXT NOT NULL,
            variant_id TEXT,
            created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
            added_group_id TEXT
          )
        `).run();
        console.log('[migration] customer_favorites table created successfully');
      } else {
        console.log('[migration] customer_favorites table already exists');
      }

      // Группа, через которую запись попала в избранное (для сердец
      // линеек): товары могут лежать в дочерних подгруппах, а сердце
      // нажато на родительской — храним именно её.
      const columns = db.prepare('PRAGMA table_info(customer_favorites)').all();
      if (!columns.some((col) => col.name === 'added_group_id')) {
        db.prepare(
          'ALTER TABLE customer_favorites ADD COLUMN added_group_id TEXT',
        ).run();
        console.log('[migration] Added added_group_id to customer_favorites');
      }

      // Ручной порядок линеек в избранном (drag-n-drop на странице).
      // NULL = порядок по времени добавления; числа задают сортировку.
      if (!columns.some((col) => col.name === 'group_position')) {
        db.prepare(
          'ALTER TABLE customer_favorites ADD COLUMN group_position INTEGER',
        ).run();
        console.log('[migration] Added group_position to customer_favorites');
      }

      // Индекс создаём всегда: IF NOT EXISTS безопасен и для баз, где
      // таблица уже есть, а прошлый запуск упал до индекса.
      db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_customer_favorites_customer
          ON customer_favorites(customer_id)
      `).run();
      console.log('[migration] customer_favorites customer index ensured');
    }).immediate();

    console.log('[migration] Customer favorites migration completed');
  } catch (error) {
    console.error('[migration] Customer favorites migration failed:', error);
    throw error;
  }
}
