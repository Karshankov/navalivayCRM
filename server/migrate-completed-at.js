import { db } from './db.js';

/**
 * Конвертирует формат completed_at из SQLite DATETIME в ISO 8601
 */
function migrateCompletedAt() {
  try {
    console.log('[migration] Starting completed_at format migration...');
    
    // Сначала проверим все delivered заказы
    const allDelivered = db.prepare(`
      SELECT id, order_number, status, completed_at, created_at
      FROM orders 
      WHERE status = 'delivered'
    `).all();
    
    console.log(`[migration] Found ${allDelivered.length} delivered orders total:`);
    for (const order of allDelivered) {
      console.log(`  - Order #${order.order_number}: completed_at=${order.completed_at}, created_at=${order.created_at}`);
    }
    
    // Находим все заказы с completed_at в старом формате (без 'T' и 'Z')
    const ordersToUpdate = db.prepare(`
      SELECT id, order_number, completed_at 
      FROM orders 
      WHERE status = 'delivered' 
        AND completed_at IS NOT NULL 
        AND completed_at NOT LIKE '%T%'
    `).all();
    
    if (ordersToUpdate.length === 0) {
      console.log('[migration] No orders to migrate (format is OK or no completed_at)');
      return { updated: 0 };
    }
    
    console.log(`[migration] Found ${ordersToUpdate.length} orders to migrate`);
    
    const tx = db.transaction(() => {
      for (const order of ordersToUpdate) {
        // Конвертируем '2025-11-14 20:03:09' -> '2025-11-14T20:03:09.000Z'
        const dateStr = order.completed_at;
        const isoDate = new Date(dateStr + ' UTC').toISOString();
        
        console.log(`[migration] Converting order ${order.id}: ${dateStr} -> ${isoDate}`);
        
        db.prepare('UPDATE orders SET completed_at = ? WHERE id = ?')
          .run(isoDate, order.id);
      }
    });
    
    tx();
    
    console.log(`[migration] Successfully migrated ${ordersToUpdate.length} orders`);
    return { updated: ordersToUpdate.length };
  } catch (error) {
    console.error('[migration] Error during migration:', error);
    return { updated: 0, error: error.message };
  }
}

// Запуск миграции
migrateCompletedAt();
