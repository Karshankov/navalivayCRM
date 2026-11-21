import { initDb, db } from '../db.js';

const orderNumber = Number(process.argv[2] || 8148);
initDb();

const order = db
  .prepare('SELECT * FROM orders WHERE order_number = ?')
  .get(orderNumber);

if (!order) {
  console.error('ORDER_NOT_FOUND', orderNumber);
  process.exit(1);
}

console.log('ORDER', {
  id: order.id,
  order_number: order.order_number,
  customer_id: order.customer_id,
  status: order.status,
  total_amount: order.total_amount,
  discount_amount: order.discount_amount,
  final_amount: order.final_amount,
  promo_code_text: order.promo_code_text,
  notes: order.notes,
  created_at: order.created_at,
  completed_at: order.completed_at,
});

const items = db
  .prepare(
    `SELECT id, product_title, quantity, price_per_unit, total_price,
            manual_discount_amount, loyalty_discount_amount, discount_amount,
            loyalty_units_applied
     FROM order_items WHERE order_id = ? ORDER BY rowid`,
  )
  .all(order.id);

console.log('ITEMS', JSON.stringify(items, null, 2));

const ledger = db
  .prepare(
    `SELECT id, loyalty_category_id, reason, delta, balance_after, created_at, note
     FROM customer_loyalty_ledger
     WHERE order_id = ?
     ORDER BY created_at`,
  )
  .all(order.id);

console.log('LEDGER_FOR_ORDER', JSON.stringify(ledger, null, 2));

const customerLedger = db
  .prepare(
    `SELECT l.reason, l.delta, l.balance_after, l.created_at, o.order_number
     FROM customer_loyalty_ledger l
     LEFT JOIN orders o ON o.id = l.order_id
     WHERE l.customer_id = ?
     ORDER BY l.created_at`,
  )
  .all(order.customer_id);

console.log('CUSTOMER_LEDGER', JSON.stringify(customerLedger, null, 2));

const redemptions = db
  .prepare('SELECT * FROM order_loyalty_redemptions WHERE order_id = ?')
  .all(order.id);

console.log('REDEMPTIONS_FOR_ORDER', JSON.stringify(redemptions, null, 2));

const nextOrders = db
  .prepare(
    `SELECT order_number, discount_amount, final_amount, total_amount, created_at, completed_at
     FROM orders
     WHERE customer_id = ?
       AND created_at > ?
       AND status IN ('delivered', 'completed', 'cancelled', 'in_progress', 'new')
     ORDER BY created_at
     LIMIT 10`,
  )
  .all(order.customer_id, order.created_at);

console.log('NEXT_ORDERS', JSON.stringify(nextOrders, null, 2));

for (const next of nextOrders) {
  const nextOrder = db.prepare('SELECT id FROM orders WHERE order_number = ?').get(next.order_number);
  const nextItems = db
    .prepare(
      `SELECT product_title, loyalty_discount_amount, manual_discount_amount, discount_amount
       FROM order_items WHERE order_id = ?`,
    )
    .all(nextOrder.id);
  const nextRedemptions = db
    .prepare('SELECT loyalty_category_id, discount_total, stamps_spent FROM order_loyalty_redemptions WHERE order_id = ?')
    .all(nextOrder.id);
  if (nextRedemptions.length || nextItems.some((i) => Number(i.loyalty_discount_amount) > 0)) {
    console.log('LOYALTY_NEXT_ORDER', next.order_number, {
      items: nextItems,
      redemptions: nextRedemptions,
    });
  }
}