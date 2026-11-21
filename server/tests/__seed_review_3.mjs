/**
 * Демо-отзыв с оценкой 3 — чтобы увидеть, как выглядит средняя оценка
 * в очереди модерации. Запуск: node tests/__seed_review_3.mjs [--rollback]
 */
import { db } from '../db.js';

const CUSTOMER_ID = 'cust_1794784123371_lhl8ov';
const REVIEW_ID = 'review_demo_rating3';
const ORDER_ID = 'order_demo_rating3';
const ITEM_ID = 'oi_demo_rating3';
const PRODUCT_ID = 'p_kmx3ec'; // ANNIMA LOVE · Смородиновый лимонад

if (process.argv.includes('--rollback')) {
  db.prepare('DELETE FROM product_reviews WHERE id = ?').run(REVIEW_ID);
  db.prepare('DELETE FROM order_items WHERE id = ?').run(ITEM_ID);
  db.prepare('DELETE FROM order_items WHERE order_id = ?').run(ORDER_ID);
  db.prepare('DELETE FROM orders WHERE id = ?').run(ORDER_ID);
  console.log('Демо-отзыв и заказ удалены');
  process.exit(0);
}

const customer = db.prepare('SELECT id, first_name FROM customers WHERE id = ?').get(CUSTOMER_ID);
const product = db.prepare(`
  SELECT p.id, p.title, p.groupId, p.priceRub, cg.name AS group_name
  FROM products p LEFT JOIN category_groups cg ON cg.id = p.groupId
  WHERE p.id = ?
`).get(PRODUCT_ID);
if (!customer || !product) { console.error('Нет клиента или товара'); process.exit(1); }

const existing = db.prepare('SELECT id FROM product_reviews WHERE id = ?').get(REVIEW_ID);
if (existing) {
  console.log('Демо-отзыв уже есть:', REVIEW_ID);
  process.exit(0);
}

const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
const price = Number(product.priceRub) || 15;

// Заказ нужен, потому что отзыв привязан к покупке.
const nextNumber = (db.prepare('SELECT MAX(order_number) AS n FROM orders').get()?.n || 0) + 1;
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
`).run(ITEM_ID, ORDER_ID, product.id, product.title, price, price, product.title, product.group_name);

// Отзыв на модерации со средней оценкой.
db.prepare(`
  INSERT INTO product_reviews
    (id, customer_id, order_id, order_item_id, group_id, category_id,
     rating, body_text, status, is_anonymous, created_at, approved_at)
  VALUES (?, ?, ?, ?, ?, NULL, 3, ?, 'pending', 0, ?, NULL)
`).run(
  REVIEW_ID, customer.id, ORDER_ID, ITEM_ID, product.groupId,
  'Нормально, но ожидал большего. Вкус слабоват, держится недолго.',
  now,
);

console.log('Создан отзыв с оценкой 3');
console.log('  клиент:', customer.first_name);
console.log('  товар: ', product.title, '·', product.group_name);
console.log('  статус: на модерации');
