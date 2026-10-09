import { db } from './db.js';

/**
 * Устанавливает completed_at для delivered заказов, где он NULL
 * Использует дату создания заказа как дату завершения
 */
function fixDeliveredCompletedAt() {
  try {
    console.log('[fix] Checking delivered orders without completed_at...');
    
    const ordersToFix = db.prepare(`
      SELECT id, order_number, created_at, completed_at, paid_at
      FROM orders 
      WHERE status = 'delivered' AND completed_at IS NULL
    `).all();
    
    if (ordersToFix.length === 0) {
      console.log('[fix] No orders to fix');
      return { fixed: 0 };
    }
    
    console.log(`[fix] Found ${ordersToFix.length} delivered orders without completed_at:`);
    
    const tx = db.transaction(() => {
      for (const order of ordersToFix) {
        // Используем paid_at если есть, иначе created_at
        const completedDate = order.paid_at || order.created_at;
        
        // Конвертируем в ISO формат если нужно
        let isoDate;
        if (completedDate && completedDate.includes('T')) {
          // Уже ISO формат
          isoDate = completedDate;
        } else if (completedDate) {
          // SQLite формат - конвертируем
          isoDate = new Date(completedDate + ' UTC').toISOString();
        } else {
          // Если ничего нет - используем текущую дату
          isoDate = new Date().toISOString();
        }
        
        console.log(`[fix] Setting completed_at for order #${order.order_number}: ${isoDate}`);
        
        db.prepare('UPDATE orders SET completed_at = ? WHERE id = ?')
          .run(isoDate, order.id);
      }
    });
    
    tx();
    
    console.log(`[fix] Successfully fixed ${ordersToFix.length} orders`);
    return { fixed: ordersToFix.length };
  } catch (error) {
    console.error('[fix] Error fixing orders:', error);
    return { fixed: 0, error: error.message };
  }
}

// Запуск исправления
const result = fixDeliveredCompletedAt();
console.log('[fix] Result:', result);

// Показываем все delivered заказы после исправления
console.log('\n[fix] All delivered orders after fix:');
const allDelivered = db.prepare(`
  SELECT order_number, status, completed_at, created_at
  FROM orders 
  WHERE status = 'delivered'
  ORDER BY order_number
`).all();

for (const order of allDelivered) {
  console.log(`  Order #${order.order_number}: completed_at=${order.completed_at}`);
}
