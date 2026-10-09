import { db } from '../db.js';

function columnExists(table, column) {
  return Boolean(
    db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(column),
  );
}

export function migrateOrderNumberSearch() {
  console.log('[migration] Ensuring order number search column...');

  try {
    if (!columnExists('orders', 'order_number_search')) {
      db.exec(`ALTER TABLE orders ADD COLUMN order_number_search TEXT`);
      console.log('[migration] Added orders.order_number_search column');
    }

    db.exec(`
      UPDATE orders
      SET order_number_search = CAST(order_number AS TEXT)
      WHERE order_number_search IS NULL
         OR order_number_search = ''
         OR order_number_search != CAST(order_number AS TEXT);

      CREATE INDEX IF NOT EXISTS idx_orders_archived_order_number_search
        ON orders(archived, order_number_search);

      CREATE TRIGGER IF NOT EXISTS trg_orders_order_number_search_insert
      AFTER INSERT ON orders
      BEGIN
        UPDATE orders
        SET order_number_search = CAST(NEW.order_number AS TEXT)
        WHERE id = NEW.id;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_orders_order_number_search_update
      AFTER UPDATE OF order_number ON orders
      BEGIN
        UPDATE orders
        SET order_number_search = CAST(NEW.order_number AS TEXT)
        WHERE id = NEW.id;
      END;
    `);

    console.log('[migration] Order number search ensured');
  } catch (error) {
    console.error('[migration] Failed to ensure order number search:', error);
    throw error;
  }
}
