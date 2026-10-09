import { db } from '../db.js';

/**
 * Миграция: добавляет колонку stock_deducted в таблицу orders
 * 
 * Эта колонка отслеживает, был ли сток уже списан для заказа.
 * - 0 = сток не списан (заказ в статусе 'new')
 * - 1 = сток списан (заказ перешел в статус 'in_progress' или дальше)
 * 
 * Это нужно для новой логики резервирования:
 * - При создании заказа сток НЕ списывается
 * - Сток списывается только при переходе в статус "Собран" (in_progress)
 * - Это защита от абуза - конкуренты могут создавать фейковые заказы
 */
export function migrateStockDeductedToOrders() {
  try {
    // Проверяем существует ли колонка
    const tableInfo = db.prepare("PRAGMA table_info(orders)").all();
    const hasStockDeducted = tableInfo.some(col => col.name === 'stock_deducted');

    if (!hasStockDeducted) {
      console.log('[migration] Adding stock_deducted column to orders table...');
      db.prepare('ALTER TABLE orders ADD COLUMN stock_deducted INTEGER NOT NULL DEFAULT 0').run();
      
      // Для существующих заказов в статусах in_progress, completed, delivered 
      // устанавливаем stock_deducted = 1, т.к. их сток уже был списан по старой логике
      const updated = db.prepare(`
        UPDATE orders 
        SET stock_deducted = 1 
        WHERE status IN ('in_progress', 'completed', 'delivered')
      `).run();
      
      console.log(`[migration] Successfully added stock_deducted column. Updated ${updated.changes} existing orders.`);
    }
  } catch (error) {
    console.error('[migration] Error adding stock_deducted column to orders:', error);
  }
}
