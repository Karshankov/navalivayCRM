import { db } from "../db.js";

function columnExists(table, column) {
  return Boolean(
    db
      .prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`)
      .get(column),
  );
}

/**
 * Снимок каталожной цены в позиции заказа.
 *
 * `price_per_unit` хранит то, за сколько реально продали, и по нему уже не
 * видно, была скидка магазина или менеджер сам сбросил цену. Две колонки эти
 * случаи разводят: `base_price_per_unit` это цена по каталогу на момент
 * оформления, `catalog_discount_per_unit` то, сколько с неё срезала акция.
 * Уценка менеджера тогда считается как base - catalog_discount - price.
 *
 * Обе nullable, и это осмысленно: NULL значит «заказ старше этой миграции, не
 * знаем», ноль значит «скидки не было».
 */
export function migrateOrderItemCatalogPrice() {
  try {
    if (!columnExists("order_items", "base_price_per_unit")) {
      console.log("[migration] Adding base_price_per_unit column to order_items");
      db.prepare("ALTER TABLE order_items ADD COLUMN base_price_per_unit REAL").run();
    }

    if (!columnExists("order_items", "catalog_discount_per_unit")) {
      console.log("[migration] Adding catalog_discount_per_unit column to order_items");
      db.prepare("ALTER TABLE order_items ADD COLUMN catalog_discount_per_unit REAL").run();
    }
  } catch (error) {
    console.error("[migration] Failed to add order item catalog price columns:", error);
    throw error;
  }
}
