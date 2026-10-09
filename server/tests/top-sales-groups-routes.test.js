/**
 * Top sales groups + storefront fields — public HTTP route tests.
 * Запуск: node server/tests/top-sales-groups-routes.test.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navalivay-top-sales-routes-'));
const tempDbPath = path.join(tempDir, 'test.db');

process.env.DATABASE_FILE = tempDbPath;
process.env.BOT_TOKEN = 'test-bot-token';
process.env.NODE_ENV = 'test';

const { initDb, db } = await import('../db.js');
const { publicRouter } = await import('../routes/public.js');
const { getBusinessPeriodRange } = await import('../utils/business-time.js');

initDb();

const app = express();
app.use(express.json());
app.use(publicRouter);

const server = await new Promise((resolve) => {
  const instance = app.listen(0, () => resolve(instance));
});

const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;

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

async function requestJson(url, options = {}) {
  const response = await fetch(`${baseUrl}${url}`, options);
  const data = await response.json().catch(() => null);
  return { response, data };
}

function resetSalesData() {
  db.exec('DELETE FROM order_items;');
  db.exec('DELETE FROM orders;');
  db.exec('DELETE FROM products;');
  db.exec('DELETE FROM category_groups;');
  db.exec('DELETE FROM categories;');
  db.exec('DELETE FROM customers;');
}

function seedCustomer(id) {
  db.prepare(
    `INSERT INTO customers (id, telegram_id, telegram_username, first_name, total_orders, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, DATETIME('now'), DATETIME('now'))`,
  ).run(id, id, id, id);
}

function seedCategory({ id, profile, name = 'Category' }) {
  db.prepare(
    `INSERT INTO categories (id, slug, name, [order], hide_empty, storefront_filters_profile)
     VALUES (?, ?, ?, 1, 0, ?)`,
  ).run(id, id, name, profile);
}

function seedGroup(id, categoryId, name, strengthTier = null) {
  db.prepare(
    `INSERT INTO category_groups
      (id, categoryId, slug, name, [order], hide_empty, strength_tier, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, 1, 0, ?, DATETIME('now'), DATETIME('now'))`,
  ).run(id, categoryId, id, name, strengthTier);
}

function seedProduct(id, categoryId, groupId, stock = 5) {
  db.prepare(
    `INSERT INTO products (id, categoryId, groupId, title, priceRub, description, stock, createdAt)
     VALUES (?, ?, ?, 'Item', 10, '', ?, DATETIME('now'))`,
  ).run(id, categoryId, groupId, stock);
}

function seedMonthSale(categoryId, groupId, productId, quantity) {
  const { start } = getBusinessPeriodRange('month', 0);
  const paidAt = start.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  const orderId = `o_${productId}`;
  const customerId = `cust_${productId}`;
  seedCustomer(customerId);
  db.prepare(
    `INSERT INTO orders (id, order_number, customer_id, status, total_amount, final_amount, paid_at, created_at)
     VALUES (?, ?, ?, 'completed', 10, 10, ?, DATETIME('now'))`,
  ).run(orderId, orderId, customerId, paidAt);
  db.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_title, quantity, price_per_unit, total_price, total_cost)
     VALUES (?, ?, ?, 'Item', ?, 10, ?, 4)`,
  ).run(`oi_${productId}`, orderId, productId, quantity, quantity * 10);
}

console.log('\n=== top-sales-groups routes ===\n');

console.log('--- A-ROUTE1: unknown category → 404 ---');
{
  resetSalesData();
  const { response, data } = await requestJson('/api/top-sales-groups?category=missing_cat');
  ok(response.status === 404, 'status 404');
  ok(data?.error === 'category_not_found', 'category_not_found error');
}

console.log('\n--- A-ROUTE2: none profile → empty payload ---');
{
  resetSalesData();
  seedCategory({ id: 'c_none', profile: 'none' });
  seedGroup('g_none', 'c_none', 'No filters');
  seedProduct('p_none', 'c_none', 'g_none');
  seedMonthSale('c_none', 'g_none', 'p_none', 10);

  const { response, data } = await requestJson('/api/top-sales-groups?category=c_none');
  ok(response.status === 200, 'status 200');
  ok(Array.isArray(data?.items) && data.items.length === 0, 'empty items for none profile');
  ok(data?.hasMore === false, 'hasMore false');
}

console.log('\n--- A-ROUTE3: limit clamp on HTTP layer ---');
{
  resetSalesData();
  seedCategory({ id: 'c_lim_http', profile: 'liquids' });
  const over = await requestJson('/api/top-sales-groups?category=c_lim_http&limit=999');
  ok(over.response.status === 200, 'over-limit request succeeds');
  const zero = await requestJson('/api/top-sales-groups?category=c_lim_http&limit=0');
  ok(zero.response.status === 200, 'zero limit request succeeds');
}

console.log('\n--- R-ROUTE1: liquids returns ranked top sales ---');
{
  resetSalesData();
  seedCategory({ id: 'c_liq', profile: 'liquids', name: 'Жидкости' });
  seedGroup('g_top_a', 'c_liq', 'Leader', 'strong');
  seedGroup('g_top_b', 'c_liq', 'Second', 'light');
  seedProduct('p_top_a', 'c_liq', 'g_top_a');
  seedProduct('p_top_b', 'c_liq', 'g_top_b');
  seedMonthSale('c_liq', 'g_top_a', 'p_top_a', 3);
  seedMonthSale('c_liq', 'g_top_b', 'p_top_b', 8);

  const { response, data } = await requestJson('/api/top-sales-groups?category=c_liq&limit=5');
  ok(response.status === 200, 'status 200');
  ok(data?.period === 'month', 'period month');
  ok(data?.categoryId === 'c_liq', 'categoryId echoed');
  ok(data?.items?.length === 2, 'two ranked groups');
  ok(data?.items?.[0]?.groupId === 'g_top_b' && data?.items?.[0]?.rank === 1, 'leader rank 1');
  ok(data?.items?.[1]?.groupId === 'g_top_a' && data?.items?.[1]?.rank === 2, 'second rank 2');
}

console.log('\n--- R-ROUTE2: snus_plates profile supported ---');
{
  resetSalesData();
  seedCategory({ id: 'c_snus', profile: 'snus_plates', name: 'Снюс' });
  seedGroup('g_snus', 'c_snus', 'Snus line');
  seedProduct('p_snus', 'c_snus', 'g_snus');
  seedMonthSale('c_snus', 'g_snus', 'p_snus', 6);

  const { response, data } = await requestJson('/api/top-sales-groups?categoryId=c_snus');
  ok(response.status === 200, 'categoryId alias works');
  ok(data?.items?.length === 1, 'snus_plates returns sales');
}

console.log('\n--- R-ROUTE3: OOS leaders are skipped and ranks shift on public API ---');
{
  resetSalesData();
  seedCategory({ id: 'c_shift', profile: 'liquids', name: 'Жидкости' });
  seedGroup('g_shift_1', 'c_shift', 'Leader');
  seedGroup('g_shift_2', 'c_shift', 'Sold out');
  seedGroup('g_shift_3', 'c_shift', 'Next up');
  seedProduct('p_shift_1', 'c_shift', 'g_shift_1', 4);
  seedProduct('p_shift_2', 'c_shift', 'g_shift_2', 0);
  seedProduct('p_shift_3', 'c_shift', 'g_shift_3', 2);
  seedCustomer('cust_shift');
  const { start } = getBusinessPeriodRange('month', 0);
  const paidAt = start.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  db.prepare(
    `INSERT INTO orders (id, order_number, customer_id, status, total_amount, final_amount, paid_at, created_at)
     VALUES ('o_shift', 'o_shift', 'cust_shift', 'completed', 10, 10, ?, DATETIME('now'))`,
  ).run(paidAt);
  db.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_title, quantity, price_per_unit, total_price, total_cost)
     VALUES ('oi_s1', 'o_shift', 'p_shift_1', 'Item', 30, 10, 300, 40)`,
  ).run();
  db.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_title, quantity, price_per_unit, total_price, total_cost)
     VALUES ('oi_s2', 'o_shift', 'p_shift_2', 'Item', 20, 10, 200, 40)`,
  ).run();
  db.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_title, quantity, price_per_unit, total_price, total_cost)
     VALUES ('oi_s3', 'o_shift', 'p_shift_3', 'Item', 10, 10, 100, 40)`,
  ).run();

  const { response, data } = await requestJson('/api/top-sales-groups?category=c_shift&limit=5');
  ok(response.status === 200, 'status 200');
  ok(data?.items?.length === 2, 'OOS group excluded from public top');
  ok(data?.items?.[0]?.groupId === 'g_shift_1' && data?.items?.[0]?.rank === 1, 'leader rank 1');
  ok(data?.items?.[1]?.groupId === 'g_shift_3' && data?.items?.[1]?.rank === 2, 'next in-stock group promoted to rank 2');
}

console.log('\n--- R-ROUTE4: /api/categories exposes storefront + strength ---');
{
  resetSalesData();
  seedCategory({ id: 'c_pub', profile: 'liquids', name: 'Public cat' });
  seedGroup('g_pub', 'c_pub', 'Public line', 'very_strong');
  seedProduct('p_pub', 'c_pub', 'g_pub');

  const { response, data } = await requestJson('/api/categories');
  ok(response.status === 200, 'categories 200');
  const cat = Array.isArray(data) ? data.find((row) => row.id === 'c_pub') : null;
  ok(cat?.storefrontFiltersProfile === 'liquids', 'storefrontFiltersProfile in payload');
  ok(cat?.groups?.[0]?.strengthTier === 'very_strong', 'strengthTier on group in payload');
}

console.log(`\n=== Results: ${results.passed} passed, ${results.failed} failed ===`);

server.close();
try {
  fs.rmSync(tempDir, { recursive: true, force: true });
} catch {
  // ignore
}

process.exit(results.failed > 0 ? 1 : 0);