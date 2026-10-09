import { db } from "../db.js";

function columnExists(table, column) {
  return Boolean(
    db
      .prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`)
      .get(column),
  );
}

export function migrateOrderItemDisplayFields() {
  try {
    if (!columnExists("order_items", "group_name")) {
      console.log("[migration] Adding group_name column to order_items");
      db.prepare("ALTER TABLE order_items ADD COLUMN group_name TEXT").run();
    }

    if (!columnExists("order_items", "variant_name")) {
      console.log("[migration] Adding variant_name column to order_items");
      db.prepare("ALTER TABLE order_items ADD COLUMN variant_name TEXT").run();
    }
  } catch (error) {
    console.error("[migration] Failed to add order item display fields:", error);
    throw error;
  }
}
