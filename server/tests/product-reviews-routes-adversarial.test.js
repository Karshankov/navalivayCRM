/**
 * Product reviews — public HTTP adversarial + regression route tests.
 * Run: node server/tests/product-reviews-routes-adversarial.test.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navalivay-product-reviews-routes-adv-'));
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

async function requestJson(url, options = {}) {
  const response = await fetch(`${baseUrl}${url}`, options);
  const data = await response.json().catch(() => null);
  return { response, data };
}

function seedDeliveredOrder(customerId = 'cust1', telegramId = '111') {
  db.exec('DELETE FROM product_reviews;');
  db.exec('DELETE FROM order_items;');
  db.exec('DELETE FROM orders;');
  db.exec('DELETE FROM products;');
  db.exec('DELETE FROM category_groups;');
  db.exec('DELETE FROM categories;');
  db.exec('DELETE FROM customers;');

  db.prepare(
    `INSERT INTO customers (id, telegram_id, telegram_username, first_name, created_at, updated_at)
     VALUES (?, ?, 'buyer1', 'Buyer', DATETIME('now'), DATETIME('now'))`,
  ).run(customerId, telegramId);
  db.prepare(
    `INSERT INTO categories (id, slug, name, [order], hide_empty, storefront_filters_profile)
     VALUES ('cat1', 'salt-liquids', 'Жидкости', 1, 0, 'liquids')`,
  ).run();
  db.prepare(
    `INSERT INTO category_groups (id, categoryId, slug, name, [order], hide_empty, createdAt, updatedAt)
     VALUES ('grp1', 'cat1', 'grp1', 'Подонки', 1, 0, DATETIME('now'), DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO products (id, categoryId, groupId, title, priceRub, description, stock, createdAt)
     VALUES ('prod1', 'cat1', 'grp1', 'Ананас', 10, '', 5, DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO orders (id, order_number, customer_id, status, total_amount, final_amount, completed_at, created_at, updated_at)
     VALUES ('ord1', 1001, ?, 'delivered', 10, 10, DATETIME('now'), DATETIME('now'), DATETIME('now')),
            ('ord2', 1002, ?, 'delivered', 20, 20, DATETIME('now', '-2 day'), DATETIME('now', '-2 day'), DATETIME('now', '-2 day'))`,
  ).run(customerId, customerId);
  db.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_title, variant_name, quantity, price_per_unit, total_price, total_cost)
     VALUES ('oi1', 'ord1', 'prod1', 'Ананас', 'Ананасовая шипучка', 1, 10, 10, 4),
            ('oi2', 'ord2', 'prod1', 'Ананас', 'Манго', 1, 20, 20, 8)`,
  ).run();
}

console.log('\n=== product-reviews routes adversarial ===\n');

console.log('--- A-API1: no auth → 401 on protected routes ---');
{
  seedDeliveredOrder();
  for (const url of [
    '/api/reviews/prompt',
    '/api/orders/my-history',
    '/api/orders/ord1/detail',
  ]) {
    const { response } = await requestJson(url);
    ok(response.status === 401, `${url} requires auth`);
  }
}

console.log('\n--- A-API2: POST review without auth → 401 ---');
{
  const { response } = await requestJson('/api/reviews', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order_id: 'ord1', group_id: 'grp1', rating: 5, body_text: 'x'.repeat(25) }),
  });
  ok(response.status === 401, 'create review 401');
}

console.log('\n--- A-API3: IDOR order detail ---');
{
  seedDeliveredOrder();
  const { response } = await requestJson('/api/orders/ord1/detail', {
    headers: authHeaders('999', 'intruder'),
  });
  ok(response.status === 404, 'foreign order detail 404');
}

console.log('\n--- A-API4: short body rejected ---');
{
  const { response, data } = await requestJson('/api/reviews', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      order_id: 'ord1',
      group_id: 'grp1',
      order_item_id: 'oi1',
      rating: 5,
      body_text: 'коротко',
      quick_tag_ids: [],
    }),
  });
  ok(response.status === 400 && data?.error === 'review_body_too_short', 'short body 400');
}

console.log('\n--- A-API5: SQL injection in group path ---');
{
  const { response } = await requestJson("/api/groups/grp1' OR 1=1--/reviews");
  ok(response.status === 404, 'injection group 404');
}

console.log('\n--- A-API6: invalid quick-tags params ---');
{
  const { response } = await requestJson('/api/reviews/quick-tags?category_key=&star_rating=0', {
    headers: authHeaders(),
  });
  ok(response.status === 400, 'invalid quick-tags params');
}

console.log('\n--- A-API7: duplicate review spam ---');
{
  seedDeliveredOrder();
  const body = {
    order_id: 'ord1',
    group_id: 'grp1',
    order_item_id: 'oi1',
    rating: 5,
    body_text: 'Первый нормальный отзыв на линейку подонки',
    quick_tag_ids: [],
  };
  const first = await requestJson('/api/reviews', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  ok(first.response.status === 201, 'first review created');

  const second = await requestJson('/api/reviews', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      ...body,
      body_text: 'Второй спам отзыв сразу после первого',
      rating: 1,
    }),
  });
  ok(second.response.status === 400 && second.data?.error === 'pending_moderation', 'duplicate blocked');
}

console.log('\n--- A-API8: history limit clamped ---');
{
  const { response, data } = await requestJson('/api/orders/my-history?limit=9999', {
    headers: authHeaders(),
  });
  ok(response.status === 200, 'history 200');
  ok(Array.isArray(data.items) && data.items.length <= 50, 'limit clamped to 50');
}

console.log('\n--- A-API9: preferences patch without customer → 404 ---');
{
  db.exec('DELETE FROM customers;');
  const { response } = await requestJson('/api/profile/review-preferences', {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ reviews_opt_out: true }),
  });
  ok(response.status === 404, 'preferences 404 without customer');
}

console.log('\n--- R-API1: history pagination cursor ---');
{
  seedDeliveredOrder();
  const page1 = await requestJson('/api/orders/my-history?limit=1', { headers: authHeaders() });
  ok(page1.data.items.length === 1, 'page1 one item');
  ok(page1.data.next_cursor, 'page1 has cursor');

  const page2 = await requestJson(
    `/api/orders/my-history?limit=1&cursor=${encodeURIComponent(page1.data.next_cursor)}`,
    { headers: authHeaders() },
  );
  ok(page2.data.items.length === 1, 'page2 one item');
  ok(page2.data.items[0].id !== page1.data.items[0].id, 'cursor advances');
}

console.log('\n--- R-API2: prompt returns latest reviewable order ---');
{
  seedDeliveredOrder();
  const { data } = await requestJson('/api/reviews/prompt', { headers: authHeaders() });
  ok(data.show === true, 'prompt visible');
  ok(data.order_id === 'ord1', 'latest delivered order first');
}

console.log('\n--- R-API3: opt-out via preferences hides prompt ---');
{
  seedDeliveredOrder();
  await requestJson('/api/profile/review-preferences', {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ reviews_opt_out: true }),
  });
  const { data } = await requestJson('/api/reviews/prompt', { headers: authHeaders() });
  ok(data.show === false && data.reason === 'opt_out', 'prompt hidden after opt-out');
}

console.log('\n--- R-API4: public group reviews shape ---');
{
  seedDeliveredOrder();
  const { data } = await requestJson('/api/groups/grp1/reviews');
  ok(data.group_id === 'grp1', 'group_id present');
  ok(typeof data.review_count === 'number', 'review_count number');
  ok(Array.isArray(data.items), 'items array');
}

console.log('\n--- R-API5: my-active regression still independent ---');
{
  db.prepare(`UPDATE orders SET status = 'in_progress' WHERE id = 'ord1'`).run();
  const active = await requestJson('/api/orders/my-active', { headers: authHeaders() });
  ok(active.data?.found === true || active.data?.status === 'in_progress', 'active order endpoint works');
  const history = await requestJson('/api/orders/my-history', { headers: authHeaders() });
  ok(history.data.items.some((item) => item.id === 'ord2'), 'history still lists delivered');
}

server.close();
console.log(`\nDone: ${results.passed} passed, ${results.failed} failed\n`);
process.exit(results.failed > 0 ? 1 : 0);