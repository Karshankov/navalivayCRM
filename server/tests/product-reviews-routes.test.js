/**
 * Product reviews public route tests.
 * Run: node server/tests/product-reviews-routes.test.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navalivay-product-reviews-routes-'));
process.env.DATABASE_FILE = path.join(tempDir, 'test.db');
process.env.BOT_TOKEN = 'test-bot-token';
process.env.NODE_ENV = 'test';

const { initDb, db } = await import('../db.js');
const { publicRouter } = await import('../routes/public.js');

initDb();

const app = express();
app.use(express.json());
app.use(publicRouter);

const server = await new Promise((resolve) => {
  const instance = app.listen(0, () => resolve(instance));
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;

const results = { passed: 0, failed: 0 };

function ok(cond, msg) {
  if (cond) {
    results.passed++;
    console.log(`  OK: ${msg}`);
  } else {
    results.failed++;
    console.log(`  FAIL: ${msg}`);
  }
}

function authHeaders(id = '111', username = 'buyer1') {
  return {
    'Content-Type': 'application/json',
    'x-test-telegram-auth': JSON.stringify({ id, username, first_name: 'Buyer' }),
  };
}

function seedCompletedOrder() {
  db.exec('DELETE FROM product_reviews;');
  db.exec('DELETE FROM order_items;');
  db.exec('DELETE FROM orders;');
  db.exec('DELETE FROM products;');
  db.exec('DELETE FROM category_groups;');
  db.exec('DELETE FROM categories;');
  db.exec('DELETE FROM customers;');

  db.prepare(
    `INSERT INTO customers (id, telegram_id, telegram_username, first_name, created_at, updated_at)
     VALUES ('cust1', '111', 'buyer1', 'Buyer', DATETIME('now'), DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO categories (id, slug, name, [order], hide_empty, storefront_filters_profile)
     VALUES ('cat_liq', 'salt-liquids', 'Жидкости', 1, 0, 'liquids')`,
  ).run();
  db.prepare(
    `INSERT INTO category_groups (id, categoryId, slug, name, [order], hide_empty, createdAt, updatedAt)
     VALUES ('grp1', 'cat_liq', 'grp1', 'Подонки', 1, 0, DATETIME('now'), DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO products (id, categoryId, groupId, title, priceRub, description, stock, createdAt)
     VALUES ('prod1', 'cat_liq', 'grp1', 'Ананас', 10, '', 5, DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO orders (id, order_number, customer_id, status, total_amount, final_amount, completed_at, created_at, updated_at)
     VALUES ('ord1', 1001, 'cust1', 'delivered', 10, 10, DATETIME('now'), DATETIME('now'), DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_title, variant_name, quantity, price_per_unit, total_price, total_cost)
     VALUES ('oi1', 'ord1', 'prod1', 'Ананас', 'Ананасовая шипучка', 1, 10, 10, 4)`,
  ).run();
}

console.log('\n=== product-reviews routes ===\n');

console.log('--- R1: order history ---');
{
  seedCompletedOrder();
  const response = await fetch(`${baseUrl}/api/orders/my-history`, { headers: authHeaders() });
  const data = await response.json();
  ok(response.status === 200, 'history 200');
  ok(Array.isArray(data.items) && data.items.length === 1, 'one history card');
  ok(data.items[0].order_number === 1001, 'order number present');
}

console.log('\n--- R2: order detail ---');
{
  const response = await fetch(`${baseUrl}/api/orders/ord1/detail`, { headers: authHeaders() });
  const data = await response.json();
  ok(response.status === 200, 'detail 200');
  ok(Array.isArray(data.reviewable_lines) && data.reviewable_lines.length === 1, 'one reviewable line');
}

console.log('\n--- R3: review prompt ---');
{
  const response = await fetch(`${baseUrl}/api/reviews/prompt`, { headers: authHeaders() });
  const data = await response.json();
  ok(response.status === 200, 'prompt 200');
  ok(data.show === true, 'prompt visible');
  ok(data.order_id === 'ord1', 'prompt order id');
}

console.log('\n--- R4: create review ---');
{
  const response = await fetch(`${baseUrl}/api/reviews`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      order_id: 'ord1',
      group_id: 'grp1',
      order_item_id: 'oi1',
      rating: 5,
      body_text: 'Очень вкусная линейка, рекомендую всем друзьям',
      quick_tag_ids: [],
      is_anonymous: true,
    }),
  });
  const data = await response.json();
  ok(response.status === 201, 'create 201');
  ok(data.review?.status === 'pending', 'pending review');
}

console.log('\n--- R5: foreign order detail forbidden ---');
{
  const response = await fetch(`${baseUrl}/api/orders/ord1/detail`, {
    headers: authHeaders('999', 'other'),
  });
  ok(response.status === 404, 'foreign order 404');
}

console.log('\n--- R6: public group reviews empty until approved ---');
{
  const response = await fetch(`${baseUrl}/api/groups/grp1/reviews`);
  const data = await response.json();
  ok(response.status === 200, 'public reviews 200');
  ok(data.review_count === 0, 'no approved reviews yet');
}

server.close();
console.log(`\nDone: ${results.passed} passed, ${results.failed} failed\n`);
process.exit(results.failed > 0 ? 1 : 0);