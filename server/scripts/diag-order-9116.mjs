#!/usr/bin/env node
import { initDb, db } from '../db.js';

initDb();

const orderNumber = Number(process.argv[2] || 9116);
const order = db.prepare(`
  SELECT id, order_number, customer_id, final_amount, total_amount, notes, status
  FROM orders WHERE order_number = ?
`).get(orderNumber);

console.log('=== order ===');
console.log(JSON.stringify(order, null, 2));

if (!order) process.exit(1);

const items = db.prepare(`
  SELECT product_id, product_title, variant_name, price_per_unit, total_price, quantity
  FROM order_items WHERE order_id = ?
`).all(order.id);
console.log('\n=== order_items ===');
console.log(JSON.stringify(items, null, 2));

for (const item of items) {
  const product = db.prepare(`
    SELECT id, title, priceRub AS price_rub, groupId AS group_id FROM products WHERE id = ?
  `).get(item.product_id);
  const variants = db.prepare(`
    SELECT id, name, price_rub FROM product_variants WHERE product_id = ?
  `).all(item.product_id);
  console.log(`\n=== product ${item.product_id} ===`);
  console.log(JSON.stringify({ product, variants }, null, 2));
}