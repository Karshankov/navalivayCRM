#!/usr/bin/env node
import { initDb, db } from '../db.js';

initDb();

const orderNumber = Number(process.argv[2] || 9116);
const order = db.prepare('SELECT id FROM orders WHERE order_number = ?').get(orderNumber);
if (!order) {
  throw new Error(`Order #${orderNumber} not found`);
}

db.prepare(`
  UPDATE order_items
  SET price_per_unit = 75, total_price = 75
  WHERE order_id = ? AND product_id = 'p_m3jo0z'
`).run(order.id);

const totals = db.prepare(`
  SELECT COALESCE(SUM(total_price), 0) AS total
  FROM order_items
  WHERE order_id = ?
`).get(order.id);

db.prepare(`
  UPDATE orders
  SET total_amount = ?, final_amount = ?, updated_at = DATETIME('now')
  WHERE id = ?
`).run(totals.total, totals.total, order.id);

const items = db.prepare(`
  SELECT product_title, variant_name, price_per_unit, total_price
  FROM order_items WHERE order_id = ?
`).all(order.id);

console.log(JSON.stringify({ order_number: orderNumber, order_id: order.id, total: totals.total, items }, null, 2));