/**
 * Демо-заказ для тестового клиента: картридж XROS 0.6 Ω, выдан.
 * Нужен, чтобы увидеть плитку «Как вам …?» на главной.
 * Запуск: node tests/__seed_demo_order.mjs [--rollback]
 */
import { db } from '../db.js';

const CUSTOMER_ID = 'cust_1794784123371_lhl8ov';
const PRODUCT_ID = 'p_x7hgv3';
const ORDER_ID = 'order_demo_xros_review';
const ITEM_ID = 'oi_demo_xros_review';

const rollback = process.argv.includes('--rollback');

if (rollback) {
  db.prepare('DELETE FROM product_reviews WHERE order_id = ?').run(ORDER_ID);
  db.prepare('DELETE FROM order_items WHERE order_id = ?').run(ORDER_ID);
  const res = db.prepare('DELETE FROM orders WHERE id = ?').run(ORDER_ID);
  console.log('Удалено. Заказов удалено:', res.changes);
  process.exit(0);
}

const customer = db.prepare('SELECT id, first_name FROM customers WHERE id = ?').get(CUSTOMER_ID);
if (!customer) { console.error('Клиент не найден'); process.exit(1); }

const product = db.prepare(`
  SELECT p.id, p.title, p.groupId, p.categoryId, p.priceRub, cg.name AS group_name
  FROM products p LEFT JOIN category_groups cg ON cg.id = p.groupId
  WHERE p.id = ?
`).get(PRODUCT_ID);
if (!product) { console.error('Товар не найден'); process.exit(1); }

// Уже есть заказ — не дублируем
const existing = db.prepare('SELECT id FROM orders WHERE id = ?').get(ORDER_ID);
if (existing) {
  console.log('Демо-заказ уже существует:', ORDER_ID);
} else {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const nextNumber = (db.prepare('SELECT MAX(order_number) AS n FROM orders').get()?.n || 0) + 1;
  const price = Number(product.priceRub) || 12;

  db.prepare(`
    INSERT INTO orders (
      id, order_number, customer_id, status, delivery_type,
      total_amount, discount_amount, discount_percent, final_amount, profit,
      created_at, updated_at, completed_at,
      archived, stock_deducted, is_wholesale,
      card_amount_minor, cash_due_minor, additional_cost, audit_revision
    ) VALUES (?, ?, ?, 'delivered', 'pickup', ?, 0, 0, ?, 0, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0)
  `).run(ORDER_ID, nextNumber, customer.id, price, price, now, now, now);

  db.prepare(`
    INSERT INTO order_items (
      id, order_id, product_id, product_title,
      quantity, price_per_unit, cost_per_unit, discount_amount, total_price, total_cost,
      variant_id, variant_name, group_name,
      base_product_id, base_product_title,
      manual_discount_amount, loyalty_discount_amount, loyalty_units_applied
    ) VALUES (?, ?, ?, ?, 1, ?, 0, 0, ?, 0, NULL, ?, ?, NULL, NULL, 0, 0, 0)
  `).run(
    ITEM_ID, ORDER_ID, product.id, product.title,
    price, price,
    product.title, product.group_name,
  );

  console.log('Создан демо-заказ');
}

console.log('  клиент:', customer.first_name, '(' + customer.id + ')');
console.log('  заказ: ', ORDER_ID);
console.log('  товар: ', product.title, '·', product.group_name);
