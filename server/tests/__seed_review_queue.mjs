/**
 * Демо-покупки для тестового клиента: три разные позиции, выданные сразу.
 * Нужны, чтобы увидеть очередь оценок и переход между ними.
 * Запуск: node tests/__seed_review_queue.mjs [--rollback]
 */
import { db } from '../db.js';

const CUSTOMER_ID = 'cust_1794784123371_lhl8ov';
const PREFIX = 'order_queue_';
const ITEM_PREFIX = 'oi_queue_';

// Разные группы и категории: испарители, снюс, жидкость.
const ITEMS = [
  { key: 'ursa',     productId: 'p_w77d93', note: 'Испарители для URSA MINI' },
  { key: 'faff75',   productId: 'p_siba9b', note: 'СНЮС FAFF 75MG' },
  { key: 'annima',   productId: 'p_kmx3ec', note: 'ANNIMA LOVE' },
];

const rollback = process.argv.includes('--rollback');
const orderId = (k) => PREFIX + k;
const itemId = (k) => ITEM_PREFIX + k;

if (rollback) {
  // Убираем и старые демо-заказы, и эту очередь
  const legacy = [
    ['order_demo_xros_review', 'oi_demo_xros_review'],
    ['order_demo_podgon_review', 'oi_demo_podgon_review'],
    ['order_demo_podgon2_review', 'oi_demo_podgon2_review'],
  ];
  let removed = 0;
  for (const [oid, iid] of [...legacy, ...ITEMS.map((i) => [orderId(i.key), itemId(i.key)])]) {
    db.prepare('DELETE FROM product_reviews WHERE order_id = ?').run(oid);
    db.prepare('DELETE FROM order_items WHERE id = ?').run(iid);
    db.prepare('DELETE FROM order_items WHERE order_id = ?').run(oid);
    removed += db.prepare('DELETE FROM orders WHERE id = ?').run(oid).changes;
  }
  console.log('Удалено заказов:', removed);
  process.exit(0);
}

const customer = db.prepare('SELECT id, first_name FROM customers WHERE id = ?').get(CUSTOMER_ID);
if (!customer) { console.error('Клиент не найден'); process.exit(1); }

// Старые демо-заказы убираем: их позиции уже оценены и только мешают.
for (const [oid, iid] of [
  ['order_demo_xros_review', 'oi_demo_xros_review'],
  ['order_demo_podgon_review', 'oi_demo_podgon_review'],
  ['order_demo_podgon2_review', 'oi_demo_podgon2_review'],
]) {
  db.prepare('DELETE FROM product_reviews WHERE order_id = ?').run(oid);
  db.prepare('DELETE FROM order_items WHERE id = ?').run(iid);
  db.prepare('DELETE FROM order_items WHERE order_id = ?').run(oid);
  db.prepare('DELETE FROM orders WHERE id = ?').run(oid);
}
console.log('Старые демо-заказы убраны');

let nextNumber = (db.prepare('SELECT MAX(order_number) AS n FROM orders').get()?.n || 0) + 1;
const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

for (const entry of ITEMS) {
  const product = db.prepare(`
    SELECT p.id, p.title, p.groupId, p.priceRub, cg.name AS group_name
    FROM products p LEFT JOIN category_groups cg ON cg.id = p.groupId
    WHERE p.id = ?
  `).get(entry.productId);
  if (!product) { console.error('Товар не найден:', entry.productId); continue; }

  const price = Number(product.priceRub) || 15;

  db.prepare(`
    INSERT INTO orders (
      id, order_number, customer_id, status, delivery_type,
      total_amount, discount_amount, discount_percent, final_amount, profit,
      created_at, updated_at, completed_at,
      archived, stock_deducted, is_wholesale,
      card_amount_minor, cash_due_minor, additional_cost, audit_revision
    ) VALUES (?, ?, ?, 'delivered', 'pickup', ?, 0, 0, ?, 0, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0)
  `).run(orderId(entry.key), nextNumber++, customer.id, price, price, now, now, now);

  db.prepare(`
    INSERT INTO order_items (
      id, order_id, product_id, product_title,
      quantity, price_per_unit, cost_per_unit, discount_amount, total_price, total_cost,
      variant_id, variant_name, group_name,
      base_product_id, base_product_title,
      manual_discount_amount, loyalty_discount_amount, loyalty_units_applied
    ) VALUES (?, ?, ?, ?, 1, ?, 0, 0, ?, 0, NULL, ?, ?, NULL, NULL, 0, 0, 0)
  `).run(
    itemId(entry.key), orderId(entry.key), product.id, product.title,
    price, price, product.title, product.group_name,
  );

  console.log('  +', product.title, '·', product.group_name);
}

console.log();
console.log('Покупки на оценку готовы. Обнови главную.');
