import { db } from '../db.js';

export function migrateCrmPerformanceIndexes() {
  console.log('[migration] Ensuring CRM performance indexes...');

  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_orders_status_archived_created
        ON orders(status, archived, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_orders_archived_manager_action_updated
        ON orders(archived, needs_manager_action, updated_at DESC, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_orders_status_paid_at
        ON orders(status, paid_at);

      CREATE INDEX IF NOT EXISTS idx_orders_created_at_status
        ON orders(created_at, status);

      CREATE INDEX IF NOT EXISTS idx_bot_message_log_direction_order_lookup
        ON bot_message_log(direction, json_extract(meta, '$.order_id'), id DESC);
    `);

    console.log('[migration] CRM performance indexes ensured');
  } catch (error) {
    console.error('[migration] Failed to ensure CRM performance indexes:', error);
    throw error;
  }
}
