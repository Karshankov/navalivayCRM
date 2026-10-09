/**
 * Product reviews — security / BOLA / auth adversarial tests.
 * Run: node server/tests/product-reviews-security.test.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { buildTelegramInitData, telegramHeaders } from './helpers/telegram-auth.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navalivay-product-reviews-security-'));
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

function testAuthHeaders(id = '111', username = 'buyer1') {
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

function seedTwoCustomerWorld() {
  db.exec('DELETE FROM product_reviews;');
  db.exec('DELETE FROM order_items;');
  db.exec('DELETE FROM orders;');
  db.exec('DELETE FROM products;');
  db.exec('DELETE FROM category_groups;');
  db.exec('DELETE FROM categories;');
  db.exec('DELETE FROM customers;');

  db.prepare(
    `INSERT INTO customers (id, telegram_id, telegram_username, first_name, created_at, updated_at)
     VALUES ('cust1', '111', 'buyer1', 'Buyer1', DATETIME('now'), DATETIME('now')),
            ('cust2', '222', 'buyer2', 'Buyer2', DATETIME('now'), DATETIME('now'))`,
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
     VALUES ('ord1', 1001, 'cust1', 'delivered', 10, 10, DATETIME('now'), DATETIME('now'), DATETIME('now')),
            ('ord2', 1002, 'cust2', 'delivered', 20, 20, DATETIME('now'), DATETIME('now'), DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_title, variant_name, quantity, price_per_unit, total_price, total_cost)
     VALUES ('oi1', 'ord1', 'prod1', 'Ананас', 'Ананасовая', 1, 10, 10, 4),
            ('oi2', 'ord2', 'prod1', 'Ананас', 'Манговая', 1, 20, 20, 8)`,
  ).run();
}

function seedDeliveredOrder() {
  seedTwoCustomerWorld();
}

console.log('\n=== product-reviews security ===\n');

console.log('--- S1: BOLA POST review with foreign order_id ---');
{
  seedTwoCustomerWorld();
  const before = db.prepare('SELECT COUNT(*) AS count FROM product_reviews').get().count;
  const { response, data } = await requestJson('/api/reviews', {
    method: 'POST',
    headers: testAuthHeaders('111', 'buyer1'),
    body: JSON.stringify({
      order_id: 'ord2',
      group_id: 'grp1',
      order_item_id: 'oi2',
      rating: 5,
      body_text: 'Пытаюсь оставить отзыв на чужой заказ',
      quick_tag_ids: [],
    }),
  });
  const after = db.prepare('SELECT COUNT(*) AS count FROM product_reviews').get().count;
  ok(response.status === 404 && data?.error === 'order_not_found', 'foreign order 404');
  ok(before === after, 'no review row inserted');
}

console.log('\n--- S2: invalid telegram init data signature ---');
{
  seedDeliveredOrder();
  const identity = { telegram_id: '111', telegram_username: 'buyer1' };
  const { response, data } = await requestJson('/api/reviews', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Init-Data': buildTelegramInitData(identity, 'wrong-bot-token'),
    },
    body: JSON.stringify({
      order_id: 'ord1',
      group_id: 'grp1',
      order_item_id: 'oi1',
      rating: 5,
      body_text: 'Отзыв с неверной подписью Telegram',
      quick_tag_ids: [],
    }),
  });
  ok(response.status === 401 && data?.error === 'telegram_auth_invalid', 'bad signature 401');
}

console.log('\n--- S3: valid init data creates review ---');
{
  seedDeliveredOrder();
  const identity = { telegram_id: '111', telegram_username: 'buyer1' };
  const { response, data } = await requestJson('/api/reviews', {
    method: 'POST',
    headers: telegramHeaders(identity),
    body: JSON.stringify({
      order_id: 'ord1',
      group_id: 'grp1',
      order_item_id: 'oi1',
      rating: 5,
      body_text: 'Отзыв через валидный Telegram initData',
      quick_tag_ids: [],
    }),
  });
  ok(response.status === 201 && data?.review?.status === 'pending', 'signed initData 201');
}

console.log('\n--- S4: order_not_reviewable returns 400 not 500 ---');
{
  seedDeliveredOrder();
  db.prepare(`UPDATE orders SET status = 'in_progress' WHERE id = 'ord1'`).run();
  const { response, data } = await requestJson('/api/reviews', {
    method: 'POST',
    headers: testAuthHeaders(),
    body: JSON.stringify({
      order_id: 'ord1',
      group_id: 'grp1',
      order_item_id: 'oi1',
      rating: 5,
      body_text: 'Отзыв на незавершённый заказ через HTTP',
      quick_tag_ids: [],
    }),
  });
  ok(response.status === 400 && data?.error === 'order_not_reviewable', 'active order 400');
}

console.log('\n--- S5: prompt without customer row ---');
{
  db.exec('DELETE FROM customers;');
  const { response, data } = await requestJson('/api/reviews/prompt', {
    headers: testAuthHeaders('999', 'ghost'),
  });
  ok(response.status === 200 && data?.reason === 'no_customer', 'prompt no_customer');
}

console.log('\n--- S6: prompt exposes preferences ---');
{
  seedDeliveredOrder();
  db.prepare(`UPDATE customers SET reviews_prefer_anonymous = 1 WHERE id = 'cust1'`).run();
  const { data } = await requestJson('/api/reviews/prompt', { headers: testAuthHeaders() });
  ok(data.preferences?.reviews_prefer_anonymous === true, 'preferences in prompt');
}

console.log('\n--- S7: group reviews unknown group 404 ---');
{
  const { response, data } = await requestJson('/api/groups/missing-group/reviews');
  ok(response.status === 404 && data?.error === 'group_not_found', 'unknown group 404');
}

console.log('\n--- S8: parallel duplicate POST leaves one pending row ---');
{
  seedDeliveredOrder();
  const body = {
    order_id: 'ord1',
    group_id: 'grp1',
    order_item_id: 'oi1',
    rating: 5,
    body_text: 'Параллельная попытка спама отзывами',
    quick_tag_ids: [],
  };
  const [first, second] = await Promise.all([
    requestJson('/api/reviews', {
      method: 'POST',
      headers: testAuthHeaders(),
      body: JSON.stringify(body),
    }),
    requestJson('/api/reviews', {
      method: 'POST',
      headers: testAuthHeaders(),
      body: JSON.stringify({ ...body, body_text: 'Вторая параллельная попытка спама' }),
    }),
  ]);
  const statuses = [first.response.status, second.response.status].sort();
  const pendingCount = db
    .prepare(`SELECT COUNT(*) AS count FROM product_reviews WHERE status = 'pending'`)
    .get().count;
  ok(
    (statuses[0] === 201 && statuses[1] === 400) || (statuses[0] === 400 && statuses[1] === 400),
    'parallel duplicate: one success or both blocked',
  );
  ok(pendingCount <= 1, 'at most one pending review row');
}

server.close();
console.log(`\nDone: ${results.passed} passed, ${results.failed} failed\n`);
process.exit(results.failed > 0 ? 1 : 0);