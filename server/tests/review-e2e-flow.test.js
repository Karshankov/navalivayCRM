/**
 * Review system end-to-end flow: admin quick tag → customer submit → moderate → public.
 * Run: node server/tests/review-e2e-flow.test.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navalivay-review-e2e-flow-'));
process.env.DATABASE_FILE = path.join(tempDir, 'test.db');
process.env.BOT_TOKEN = 'test-bot-token';
process.env.NODE_ENV = 'test';

const { initDb, db } = await import('../db.js');
const { issueToken } = await import('../auth.js');
const { publicRouter } = await import('../routes/public.js');
const { crmRouter } = await import('../routes/crm.js');

initDb();

const app = express();
app.use(express.json());
app.use(publicRouter);
app.use(crmRouter);

const server = await new Promise((resolve) => {
  const instance = app.listen(0, () => resolve(instance));
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const authToken = issueToken('crm-admin');

function customerHeaders(id = '111', username = 'buyer1') {
  return {
    'Content-Type': 'application/json',
    'x-test-telegram-auth': JSON.stringify({ id, username, first_name: 'Buyer' }),
  };
}

function adminHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${authToken}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function requestJson(url, options = {}) {
  const response = await fetch(`${baseUrl}${url}`, options);
  const data = await response.json().catch(() => null);
  return { response, data };
}

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

function seedCustomerOrder() {
  db.exec('DELETE FROM product_reviews;');
  db.exec('DELETE FROM review_quick_tags;');
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

console.log('\n=== review e2e flow ===\n');

{
  seedCustomerOrder();

  const createTag = await requestJson('/api/admin/crm/review-quick-tags', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({
      category_key: 'liquids',
      star_rating: 5,
      label: 'Вкусно',
      insert_text: 'Очень вкусная линейка.',
      sort_order: 1,
    }),
  });
  ok(createTag.response.status === 200, 'admin creates quick tag');
  const tagId = createTag.data?.id;
  ok(tagId, 'quick tag id returned');

  const quickTags = await requestJson(
    '/api/reviews/quick-tags?category_key=liquids&star_rating=5',
    { headers: customerHeaders() },
  );
  ok(quickTags.response.status === 200, 'customer quick-tags 200');
  ok(
    quickTags.data?.items?.some((tag) => tag.id === tagId && tag.label === 'Вкусно'),
    'customer sees admin tag',
  );

  const submit = await requestJson('/api/reviews', {
    method: 'POST',
    headers: customerHeaders(),
    body: JSON.stringify({
      order_id: 'ord1',
      group_id: 'grp1',
      order_item_id: 'oi1',
      rating: 5,
      body_text: 'Отличная линейка, вкус насыщенный и приятный',
      quick_tag_ids: [tagId],
    }),
  });
  ok(submit.response.status === 201 && submit.data?.review?.status === 'pending', 'review pending');
  const reviewId = submit.data?.review?.id;
  ok(reviewId, 'review id returned');

  const duplicate = await requestJson('/api/reviews', {
    method: 'POST',
    headers: customerHeaders(),
    body: JSON.stringify({
      order_id: 'ord1',
      group_id: 'grp1',
      order_item_id: 'oi1',
      rating: 4,
      body_text: 'Повторная отправка должна быть заблокирована',
      quick_tag_ids: [],
    }),
  });
  ok(duplicate.response.status === 400 && duplicate.data?.error === 'pending_moderation', 'duplicate blocked');

  const publicBefore = await requestJson('/api/groups/grp1/reviews');
  ok(publicBefore.data?.review_count === 0, 'pending hidden from public');

  const approve = await requestJson(`/api/admin/crm/product-reviews/${reviewId}/approve`, {
    method: 'POST',
    headers: adminHeaders(),
  });
  ok(approve.response.status === 200 && approve.data?.review?.status === 'approved', 'admin approved');

  const reply = await requestJson(`/api/admin/crm/product-reviews/${reviewId}/reply`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ reply: 'Спасибо за отзыв!' }),
  });
  ok(reply.response.status === 200, 'manager reply saved');

  const publicAfter = await requestJson('/api/groups/grp1/reviews');
  ok(publicAfter.data?.review_count === 1, 'approved review public');
  ok(publicAfter.data?.items?.[0]?.quick_tag_labels?.includes('Вкусно'), 'quick tag label visible');
  ok(publicAfter.data?.items?.[0]?.manager_reply === 'Спасибо за отзыв!', 'manager reply visible');
  ok(publicAfter.data?.manager?.display_name, 'manager display name on public payload');
  ok(publicAfter.data?.manager?.avatar_url, 'manager avatar on public payload');

  const prompt = await requestJson('/api/reviews/prompt', { headers: customerHeaders() });
  ok(prompt.data?.show === false, 'prompt hidden after review submitted');
}

server.close();
console.log(`\nDone: ${results.passed} passed, ${results.failed} failed\n`);
process.exit(results.failed > 0 ? 1 : 0);