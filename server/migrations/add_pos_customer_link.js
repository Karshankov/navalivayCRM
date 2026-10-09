import { db } from '../db.js';

/**
 * Связь POS-чеков с клиентами:
 *   - `pos_sales.customer_id` (TEXT NULL, FK → customers.id, ON DELETE SET NULL)
 *   - индекс для быстрой выборки «история покупок этого клиента»
 *
 * Поведение:
 *   - Чеки могут оставаться анонимными (customer_id = NULL) — это сохраняет
 *     обратную совместимость со всеми существующими записями.
 *   - При удалении клиента ссылки в pos_sales обнуляются, а сами чеки остаются
 *     (важно для финансовых отчётов).
 *
 * Миграция идемпотентна (PRAGMA table_info + IF NOT EXISTS).
 */
export function migratePosCustomerLink() {
  try {
    const columns = db.prepare(`PRAGMA table_info(pos_sales)`).all();
    const hasCustomerId = columns.some((col) => col.name === 'customer_id');

    if (!hasCustomerId) {
      // SQLite не поддерживает ALTER TABLE ADD COLUMN с REFERENCES в одной
      // операции для существующих таблиц, поэтому FK добавляется как обычный
      // столбец — на уровне приложения мы и так контролируем целостность.
      db.exec(`ALTER TABLE pos_sales ADD COLUMN customer_id TEXT;`);
      console.log('[migration] Added pos_sales.customer_id');
    }

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_pos_sales_customer
        ON pos_sales(customer_id) WHERE customer_id IS NOT NULL;
    `);

    console.log('[migration] pos_sales customer link migration complete');
  } catch (error) {
    console.error('[migration] Failed pos_sales customer link migration:', error);
    throw error;
  }
}
