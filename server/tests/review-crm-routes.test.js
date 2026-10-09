/**
 * Review CRM — HTTP adversarial + regression route tests.
 * Run: node server/tests/review-crm-routes.test.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navalivay-review-crm-routes-'));
process.env.DATABASE_FILE = path.join(tempDir, 'test.db');
process.env.BOT_TOKEN = '';
process.env.NODE_ENV = 'test';

const { initDb, db } = await import('../db.js');
const { issueToken } = await import('../auth.js');
const { crmRouter } = await import('../routes/crm.js');
const { publicRouter } = await import('../routes/public.js');

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

function authHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${authToken}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

function customerHeaders(id = '111', username = 'buyer1') {
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

function seedPendingReview() {
  db.exec('DELETE FROM review_monthly_draw_winners;');
  db.exec('DELETE FROM review_monthly_draws;');
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
    `INSERT INTO categories (id, slug, name, [order], hide_empty)
     VALUES ('cat1', 'cat1', 'Cat', 1, 0)`,
  ).run();
  db.prepare(
    `INSERT INTO category_groups (id, categoryId, slug, name, [order], hide_empty, createdAt, updatedAt)
     VALUES ('grp1', 'cat1', 'grp1', 'Подонки', 1, 0, DATETIME('now'), DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO products (id, categoryId, groupId, title, priceRub, description, stock, createdAt)
     VALUES ('prod1', 'cat1', 'grp1', 'Item', 10, '', 5, DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO orders (id, order_number, customer_id, status, total_amount, final_amount, created_at, updated_at)
     VALUES ('ord1', 1001, 'cust1', 'delivered', 10, 10, DATETIME('now'), DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO product_reviews (
      id, customer_id, order_id, group_id, rating, body_text, quick_tag_ids, status, created_at, updated_at
    ) VALUES ('rev1', 'cust1', 'ord1', 'grp1', 5, 'Отзыв на модерации для CRM тестов', '[]', 'pending', DATETIME('now'), DATETIME('now'))`,
  ).run();
}

console.log('\n=== review CRM routes ===\n');

console.log('--- A-API1: list reviews without auth → 401 ---');
{
  const { response } = await requestJson('/api/admin/crm/product-reviews');
  ok(response.status === 401, '401 without auth');
}

console.log('\n--- A-API2: approve unknown review → 404 ---');
{
  seedPendingReview();
  const { response } = await requestJson('/api/admin/crm/product-reviews/missing/approve', {
    method: 'POST',
    headers: authHeaders(),
  });
  ok(response.status === 404, 'approve missing 404');
}

console.log('\n--- A-API3: reject without reply text on reply endpoint → 400 ---');
{
  const { response } = await requestJson('/api/admin/crm/product-reviews/rev1/reply', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ reply: '   ' }),
  });
  ok(response.status === 400, 'empty reply 400');
}

console.log('\n--- A-API4: invalid cooldown days → 400 ---');
{
  const { response } = await requestJson('/api/admin/crm/review-settings', {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ cooldown_days: 0 }),
  });
  ok(response.status === 400, 'invalid cooldown 400');
}

console.log('\n--- A-API5: create quick tag invalid star → 400 ---');
{
  const { response } = await requestJson('/api/admin/crm/review-quick-tags', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      category_key: 'liquids',
      star_rating: 9,
      label: 'Bad',
      insert_text: 'Bad tag text here',
    }),
  });
  ok(response.status === 400, 'invalid star rating 400');
}

console.log('\n--- R-API1: pending count matches list ---');
{
  seedPendingReview();
  const list = await requestJson('/api/admin/crm/product-reviews?status=pending', {
    headers: authHeaders(),
  });
  const count = await requestJson('/api/admin/crm/product-reviews/pending-count', {
    headers: authHeaders(),
  });
  ok(list.data.items.length === 1, 'one pending in list');
  ok(count.data.count === 1, 'pending count 1');
}

console.log('\n--- R-API2: approve → removed from pending ---');
{
  const approve = await requestJson('/api/admin/crm/product-reviews/rev1/approve', {
    method: 'POST',
    headers: authHeaders(),
  });
  ok(approve.response.status === 200, 'approve 200');
  ok(approve.data.review?.status === 'approved', 'status approved');

  const count = await requestJson('/api/admin/crm/product-reviews/pending-count', {
    headers: authHeaders(),
  });
  ok(count.data.count === 0, 'no pending after approve');
}

console.log('\n--- R-API3: manager reply persisted ---');
{
  const reply = await requestJson('/api/admin/crm/product-reviews/rev1/reply', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ reply: 'Спасибо за отзыв!' }),
  });
  ok(reply.response.status === 200, 'reply 200');
  ok(reply.data.review?.manager_reply === 'Спасибо за отзыв!', 'reply text saved');
  ok(reply.data.manager_display_name, 'manager display name returned');
}

console.log('\n--- R-API4: settings round-trip ---');
{
  const patch = await requestJson('/api/admin/crm/review-settings', {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({
      cooldown_days: 40,
      dev_test_mode: true,
      lottery_hint_text: 'Тест подарков',
    }),
  });
  ok(patch.response.status === 200, 'settings patch 200');
  ok(patch.data.cooldown_days === 40, 'cooldown persisted');
  ok(patch.data.dev_test_mode === true, 'dev mode persisted');

  const get = await requestJson('/api/admin/crm/review-settings', { headers: authHeaders() });
  ok(get.data.cooldown_days === 40, 'settings get matches');
  ok(typeof get.data.manager_avatar_url === 'string', 'manager avatar url in settings');
}

console.log('\n--- A-API6: reject pending review ---');
{
  seedPendingReview();
  const reject = await requestJson('/api/admin/crm/product-reviews/rev1/reject', {
    method: 'POST',
    headers: authHeaders(),
  });
  ok(reject.response.status === 200, 'reject 200');
  ok(reject.data.review?.status === 'rejected', 'status rejected');

  const count = await requestJson('/api/admin/crm/product-reviews/pending-count', {
    headers: authHeaders(),
  });
  ok(count.data.count === 0, 'no pending after reject');
}

console.log('\n--- A-API7: cannot approve already rejected review ---');
{
  const again = await requestJson('/api/admin/crm/product-reviews/rev1/approve', {
    method: 'POST',
    headers: authHeaders(),
  });
  ok(again.response.status === 404, 'approve rejected review 404');
}

console.log('\n--- A-API8: invalid token → 401 ---');
{
  const { response } = await requestJson('/api/admin/crm/product-reviews', {
    headers: { Authorization: 'Bearer invalid.token.here' },
  });
  ok(response.status === 401, 'invalid token 401');
}

console.log('\n--- R-API5: monthly draw run + duplicate blocked ---');
{
  seedPendingReview();
  db.prepare(`UPDATE product_reviews SET status = 'approved', approved_at = DATETIME('now') WHERE id = 'rev1'`).run();

  const draw = await requestJson('/api/admin/crm/review-monthly-draws/run', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({}),
  });
  ok(draw.response.status === 200, 'draw run 200');
  ok(draw.data.draw?.winners?.length >= 1, 'at least one winner');

  const dup = await requestJson('/api/admin/crm/review-monthly-draws/run', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({}),
  });
  ok(dup.response.status === 409, 'duplicate draw 409');
}

console.log('\n--- R-API6: quick tags CRUD + public visibility ---');
{
  db.exec('DELETE FROM review_quick_tags;');
  const create = await requestJson('/api/admin/crm/review-quick-tags', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      category_key: 'liquids',
      star_rating: 5,
      label: 'Сочный вкус',
      insert_text: 'Очень сочный вкус.',
      sort_order: 2,
    }),
  });
  ok(create.response.status === 200, 'create quick tag 200');
  const tagId = create.data?.id;
  ok(tagId, 'tag id returned');

  const list = await requestJson('/api/admin/crm/review-quick-tags', { headers: authHeaders() });
  ok(list.data?.items?.some((item) => item.id === tagId), 'tag in admin list');

  const publicTags = await requestJson(
    '/api/reviews/quick-tags?category_key=liquids&star_rating=5',
    { headers: customerHeaders() },
  );
  ok(publicTags.data?.items?.some((item) => item.id === tagId), 'active tag visible to customer');

  const patch = await requestJson(`/api/admin/crm/review-quick-tags/${tagId}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ label: 'Обновлённый вкус', is_active: 0 }),
  });
  ok(patch.response.status === 200, 'patch quick tag 200');
  ok(patch.data?.label === 'Обновлённый вкус', 'label updated');

  const hidden = await requestJson(
    '/api/reviews/quick-tags?category_key=liquids&star_rating=5',
    { headers: customerHeaders() },
  );
  ok(!hidden.data?.items?.some((item) => item.id === tagId), 'inactive tag hidden from customer');

  const del = await requestJson(`/api/admin/crm/review-quick-tags/${tagId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  ok(del.response.status === 200 && del.data?.ok === true, 'delete quick tag 200');
}

console.log('\n--- R-API7: approve makes review public ---');
{
  seedPendingReview();
  db.prepare(
    `UPDATE categories SET storefront_filters_profile = 'liquids' WHERE id = 'cat1'`,
  ).run();
  const approve = await requestJson('/api/admin/crm/product-reviews/rev1/approve', {
    method: 'POST',
    headers: authHeaders(),
  });
  ok(approve.response.status === 200, 'approve for public 200');

  const publicReviews = await requestJson('/api/groups/grp1/reviews');
  ok(publicReviews.data?.review_count === 1, 'approved review on public endpoint');
}

console.log('\n--- A-API9: reject approved review → 404 ---');
{
  seedPendingReview();
  db.prepare(`UPDATE product_reviews SET status = 'approved', approved_at = DATETIME('now') WHERE id = 'rev1'`).run();
  const reject = await requestJson('/api/admin/crm/product-reviews/rev1/reject', {
    method: 'POST',
    headers: authHeaders(),
  });
  ok(reject.response.status === 404, 'cannot reject approved review');
}

console.log('\n--- A-API10: reply to missing review → 404 ---');
{
  const reply = await requestJson('/api/admin/crm/product-reviews/missing/reply', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ reply: 'Спасибо!' }),
  });
  ok(reply.response.status === 404, 'reply missing review 404');
}

function seedExtraApprovedDrawCustomers() {
  for (let i = 2; i <= 6; i += 1) {
    db.prepare(
      `INSERT INTO customers (id, telegram_id, telegram_username, first_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, DATETIME('now'), DATETIME('now'))`,
    ).run(`cust${i}`, `${i}${i}${i}`, `buyer${i}`, `Buyer${i}`);
    db.prepare(
      `INSERT INTO orders (id, order_number, customer_id, status, total_amount, final_amount, created_at, updated_at)
       VALUES (?, ?, ?, 'delivered', 10, 10, DATETIME('now'), DATETIME('now'))`,
    ).run(`ord${i}`, 1000 + i, `cust${i}`);
    db.prepare(
      `INSERT INTO product_reviews (
        id, customer_id, order_id, group_id, rating, body_text, quick_tag_ids,
        status, created_at, updated_at, approved_at
      ) VALUES (?, ?, ?, 'grp1', 5, ?, '[]', 'approved', DATETIME('now'), DATETIME('now'), DATETIME('now'))`,
    ).run(`rev${i}`, `cust${i}`, `ord${i}`, `Отзыв ${i} для розыгрыша CRM тестов`);
  }
}

console.log('\n--- R-API8: monthly draws list + reroll HTTP ---');
{
  seedPendingReview();
  db.prepare(`UPDATE product_reviews SET status = 'approved', approved_at = DATETIME('now') WHERE id = 'rev1'`).run();
  seedExtraApprovedDrawCustomers();

  const draw = await requestJson('/api/admin/crm/review-monthly-draws/run', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({}),
  });
  const drawId = draw.data?.draw?.id;
  ok(drawId, 'draw id for reroll');

  const list = await requestJson('/api/admin/crm/review-monthly-draws', { headers: authHeaders() });
  ok(Array.isArray(list.data?.items) && list.data.items.length >= 1, 'draw list non-empty');

  const reroll = await requestJson(`/api/admin/crm/review-monthly-draws/${drawId}/reroll`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ seat_number: 1 }),
  });
  ok(reroll.response.status === 200, 'reroll seat 200');

  const badSeat = await requestJson(`/api/admin/crm/review-monthly-draws/${drawId}/reroll`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ seat_number: 9 }),
  });
  ok(badSeat.response.status === 400 && badSeat.data?.error === 'invalid_seat_number', 'invalid seat 400');
}

console.log('\n--- R-API5: QA settings + disable ---');
{
  const patch = await requestJson('/api/admin/crm/review-settings', {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({
      qa_active: true,
      qa_usernames: ['rk0ff', '@review_demo'],
      dev_test_mode: false,
    }),
  });
  ok(patch.response.status === 200, 'qa settings patch 200');
  ok(patch.data.qa_active === true, 'qa_active persisted');
  ok(Array.isArray(patch.data.qa_usernames) && patch.data.qa_usernames.includes('rk0ff'), 'qa usernames persisted');

  const disable = await requestJson('/api/admin/crm/review-qa/disable', {
    method: 'POST',
    headers: authHeaders(),
  });
  ok(disable.response.status === 200, 'qa disable 200');
  ok(disable.data.qa_active === false, 'qa_active off after disable');
  ok(disable.data.dev_test_mode === false, 'dev_test_mode off after disable');
}

console.log('\n--- R-API6: QA user bypass on public route ---');
{
  seedPendingReview();
  const { setReviewSetting } = await import('../utils/product-reviews.js');
  setReviewSetting('dev_test_mode', '0');
  setReviewSetting('qa_active', '1');
  setReviewSetting('qa_usernames', JSON.stringify(['buyer1']));

  const prompt = await requestJson('/api/reviews/prompt', { headers: customerHeaders('111', 'buyer1') });
  ok(prompt.response.status === 200, 'qa user prompt 200');

  setReviewSetting('qa_active', '0');
  setReviewSetting('qa_usernames', '[]');
}

server.close();
console.log(`\nDone: ${results.passed} passed, ${results.failed} failed\n`);
process.exit(results.failed > 0 ? 1 : 0);