/**
 * Миграция: soft delete для customers.
 *
 * Костя попросил «удалить бы возможность иметь» в блокноте кассы. Hard delete
 * рискован — у клиента могут быть orders/pos_sales, которые тогда останутся
 * с висячим customer_id или потеряют связь. Делаем soft delete: добавляем
 * customers.deleted_at TIMESTAMP. Если поле заполнено, запись скрывается
 * из блокнота кассы (см. POS_ONLY_CONDITION в utils/pos-customers.js)
 * и из остальных списков, но история чеков сохраняется.
 *
 * Идемпотентно: PRAGMA table_info защищает от повторного запуска.
 */
import { db } from '../db.js';

export function migrateCustomerDeletedAt() {
  const cols = db.prepare(`PRAGMA table_info(customers)`).all();
  const has = cols.some((col) => col.name === 'deleted_at');
  if (!has) {
    db.exec(`ALTER TABLE customers ADD COLUMN deleted_at TEXT`);
    console.log('[migration] Added customers.deleted_at column');
  }
}
