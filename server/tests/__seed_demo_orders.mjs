/**
 * Демо-покупки для тестового клиента: картридж XROS и PODONKI PODGON.
 * Нужны, чтобы увидеть несколько позиций на оценку и переход между ними.
 * Запуск: node tests/__seed_demo_orders.mjs [--rollback]
 */
import { db } from '../db.js';

const CUSTOMER_ID = 'cust_1794784123371_lhl8ov';

const ORDERS = [
  {
    orderId: 'order_demo_xros_review',
    itemId: 'oi_demo_xros_review',
    productId: 'p_x7hgv3',       // Xros 0.6 Ω, группа «Картриджи для XROS»
  },
  {
    orderId: 'order_demo_podgon_review',
    itemId: 'oi_demo_podgon_review',
    productId: 'p_zt5gf9',       // Персиковый йогурт, группа «PODONKI PODGON»
  },
  {
    orderId: 'order_demo_podgon2_review',
    itemId: 'oi_demo_podgon2_review',
    productId: 'p_zwnmpn',       // Мультифрукт, та же группа
    // Отдельный заказ, но группа та же: сервер считает отзыв по группе,
    // поэтому вторая позиция из неё в список на оценку не попадёт.
  },
];

const rollback = process.argv.includes('--rollback');

if (rollback) {
  for (const o of ORDERS) {
    db.prepare('DELETE FROM product_reviews WHERE order_id = ?').run(o.orderId);
    db.prepare('DELETE FROM order_items WHERE order_id = ?').run(o.orderId);
    db.prepare('DELETE FROM orders WHERE id = ?').run(o.orderId);
  }
  console.log('Демо-заказы удалены:', ORDERS.length);
  process.exit(0);
}

const customer = db.prepare('SELECT id, first_name FROM customers WHERE id = ?').get(CUSTOMER_ID);
if (!customer) { console.error('Клиент не найден'); process.exit(1); }

let nextNumber = (db.prepare('SELECT MAX(order_number) AS n FROM orders').get()?.n || 0) + 1;
const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

for (const entry of ORDERS) {
  const product = db.prepare(`
    SELECT p.id, p.title, p.groupId, p.priceRub, cg.name AS group_name
    FROM products p LEFT JOIN category_groups cg ON cg.id = p.groupId
    WHERE p.id = ?
  `).get(entry.productId);
  if (!product) { console.error('Товар не найден:', entry.productId); continue; }

  const existing = db.prepare('SELECT id FROM orders WHERE id = ?').get(entry.orderId);
  if (existing) {
    console.log('уже есть:', product.title, '·', product.group_name);
    continue;
  }

  const price = Number(product.priceRub) || 12;
  db.prepare(`
    INSERT INTO orders (
      id, order_number, customer_id, status, delivery_type,
      total_amount, discount_amount, discount_percent, final_amount, profit,
      created_at, updated_at, completed_at,
      archived, stock_deducted, is_wholesale,
      card_amount_minor, cash_due_minor, additional_cost, audit_revision
    ) VALUES (?, ?, ?, 'delivered', 'pickup', ?, 0, 0, ?, 0, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0)
  `).run(entry.orderId, nextNumber++, customer.id, price, price, now, now, now);

  db.prepare(`
    INSERT INTO order_items (
      id, order_id, product_id, product_title,
      quantity, price_per_unit, cost_per_unit, discount_amount, total_price, total_cost,
      variant_id, variant_name, group_name,
      base_product_id, base_product_title,
      manual_discount_amount, loyalty_discount_amount, loyalty_units_applied
    ) VALUES (?, ?, ?, ?, 1, ?, 0, 0, ?, 0, NULL, ?, ?, NULL, NULL, 0, 0, 0)
  `).run(
    entry.itemId, entry.orderId, product.id, product.title,
    price, price, product.title, product.group_name,
  );

  console.log('создан:', product.title, '·', product.group_name);
}

console.log();
console.log('клиент:', customer.first_name);
console.log('покупок на оценку:', ORDERS.length);
