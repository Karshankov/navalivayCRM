import { db } from '../db.js';

function columnExists(table, column) {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`
      )
      .get(column)
  );
}

// Опт переводится с минимума по сумме (min_order_amount) на минимум
// по количеству позиций (штук) в корзине. Id уровней не меняются,
// меняются только code/label — сетка цен category_group_wholesale_prices
// остаётся привязанной к тем же tier_id.
//
// ВАЖНО: сид в add_wholesale_pricing.js перебит на поиск по id —
// иначе следующий запуск сервера найдёт по старому code чужую строку
// и молча откатит её к сумме.
export function migrateWholesaleQuantityTiers() {
  try {
    if (!columnExists('wholesale_tiers', 'min_order_quantity')) {
      db.prepare(
        `ALTER TABLE wholesale_tiers ADD COLUMN min_order_quantity INTEGER`
      ).run();
      console.log('[migration] Added min_order_quantity to wholesale_tiers table');
    }

    // Перенос уровней по порядку: 100→25, 250→50, 500→100, 1000→150.
    db.prepare(`
      UPDATE wholesale_tiers
      SET code = '25', label = 'Опт от 25 позиций', min_order_quantity = 25, sort_order = 25,
          updated_at = DATETIME('now')
      WHERE id = 'wt_100'
    `).run();
    db.prepare(`
      UPDATE wholesale_tiers
      SET code = '50', label = 'Опт от 50 позиций', min_order_quantity = 50, sort_order = 50,
          updated_at = DATETIME('now')
      WHERE id = 'wt_250'
    `).run();
    db.prepare(`
      UPDATE wholesale_tiers
      SET code = '100', label = 'Опт от 100 позиций', min_order_quantity = 100, sort_order = 100,
          updated_at = DATETIME('now')
      WHERE id = 'wt_500'
    `).run();
    db.prepare(`
      UPDATE wholesale_tiers
      SET code = '150', label = 'Опт от 150 позиций', min_order_quantity = 150, sort_order = 150,
          updated_at = DATETIME('now')
      WHERE id = 'wt_1000'
    `).run();

    // Страховка для кастомных уровней вне стандартных четырёх.
    db.prepare(`
      UPDATE wholesale_tiers
      SET min_order_quantity = CAST(min_order_amount AS INTEGER)
      WHERE min_order_quantity IS NULL AND min_order_amount IS NOT NULL
    `).run();

    // Флаг «товар не считается в минимальном количестве опта».
    // Прямые товары (без линейки) продаются в опте по розничной цене
    // и никогда не приближают корзину к минимуму.
    if (!columnExists('products', 'excluded_from_wholesale_min')) {
      db.prepare(
        `ALTER TABLE products ADD COLUMN excluded_from_wholesale_min INTEGER NOT NULL DEFAULT 0`
      ).run();
      console.log('[migration] Added excluded_from_wholesale_min to products table');
    }
    db.prepare(
      `UPDATE products SET excluded_from_wholesale_min = 1 WHERE groupId IS NULL AND excluded_from_wholesale_min = 0`
    ).run();

    // Персональный минимум для клиента (NULL = минимум уровня ссылки).
    if (!columnExists('customers', 'wholesale_min_override')) {
      db.prepare(
        `ALTER TABLE customers ADD COLUMN wholesale_min_override INTEGER`
      ).run();
      console.log('[migration] Added wholesale_min_override to customers table');
    }

    // Снапшот применённого минимума на момент заказа (в штуках).
    if (!columnExists('orders', 'wholesale_min_quantity')) {
      db.prepare(
        `ALTER TABLE orders ADD COLUMN wholesale_min_quantity INTEGER`
      ).run();
      console.log('[migration] Added wholesale_min_quantity to orders table');
    }
  } catch (error) {
    console.error('[migration] Failed to add wholesale quantity tiers:', error);
    throw error;
  }
}
