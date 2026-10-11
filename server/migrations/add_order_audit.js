export function migrateOrderAudit(database) {
  database.transaction(() => {
    const columns = database.prepare('PRAGMA table_info(orders)').all();
    if (!columns.some((column) => column.name === 'audit_revision')) {
      database.exec('ALTER TABLE orders ADD COLUMN audit_revision INTEGER NOT NULL DEFAULT 0');
    }
    database.exec(`
      CREATE TABLE IF NOT EXISTS order_audit_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        operation_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        actor_type TEXT NOT NULL CHECK(actor_type IN ('employee', 'admin', 'customer', 'system')),
        actor_id TEXT NOT NULL,
        actor_name TEXT NOT NULL,
        source TEXT NOT NULL,
        field TEXT,
        product_id TEXT,
        variant_id TEXT,
        product_title TEXT,
        before_json TEXT NOT NULL,
        after_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_order_audit_order_sequence
        ON order_audit_events(order_id, sequence);
      CREATE INDEX IF NOT EXISTS idx_order_audit_operation
        ON order_audit_events(operation_id);
    `);
    // Existing status history remains untouched. No historical authors or
    // detailed changes can be reconstructed reliably from the current order.
  }).immediate();
}
