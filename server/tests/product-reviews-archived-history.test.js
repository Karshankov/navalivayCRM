/**
 * Regression: archived CRM orders must remain visible in customer order history.
 *
 * Background: nightly archiveOldDeliveredOrders() sets archived=1 on delivered orders.
 * That flag is CRM-kanban-only; customer /api/orders/my-history must still return them.
 *
 * Run: node server/tests/product-reviews-archived-history.test.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navalivay-archived-history-'));
process.env.DATABASE_FILE = path.join(tempDir, 'test.db');
process.env.BOT_TOKEN = 'test-bot-token';
process.env.NODE_ENV = 'test';

const { initDb, db } = await import('../db.js');
const { publicRouter } = await import('../routes/public.js');
const {
  findOwnedOrders,
  getReviewPromptForCustomer,
  normalizeTelegramUsername,
  normalizeTelegramUsernameSqlExpr,
  REVIEW_STATUSES,
} = await import('../utils/product-reviews.js');

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

function authHeaders(id, username) {
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

/** Simulate the pre-fix query that hid orders from customers. */
function findOwnedOrdersLegacyHidden({ telegramId, telegramUsername, statuses, limit = 50 } = {}) {
  const normalizedUsername = String(telegramUsername || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();

  let sql = `
    SELECT o.*, c.telegram_id AS customer_telegram_id,
           COALESCE(o.telegram_username, c.telegram_username) AS resolved_telegram_username
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE COALESCE(o.archived, 0) = 0
  `;
  const params = [];
  if (Array.isArray(statuses) && statuses.length) {
    sql += ` AND o.status IN (${statuses.map(() => '?').join(', ')})`;
    params.push(...statuses);
  }
  sql += ' ORDER BY COALESCE(o.completed_at, o.updated_at, o.created_at) DESC LIMIT ?';
  params.push(limit);

  const candidates = db.prepare(sql).all(...params);
  return candidates.filter((order) => {
    if (telegramId && order.customer_telegram_id && String(order.customer_telegram_id) === String(telegramId)) {
      return true;
    }
    const candidateUsername = String(order.resolved_telegram_username || '')
      .trim()
      .replace(/^@+/, '')
      .toLowerCase();
    return Boolean(candidateUsername) && candidateUsername === normalizedUsername;
  });
}

function seedCatalog() {
  db.exec('DELETE FROM product_reviews;');
  db.exec('DELETE FROM order_items;');
  db.exec('DELETE FROM orders;');
  db.exec('DELETE FROM products;');
  db.exec('DELETE FROM category_groups;');
  db.exec('DELETE FROM categories;');
  db.exec('DELETE FROM customers;');

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
}

function insertCustomer({ id, telegramId, username }) {
  db.prepare(
    `INSERT INTO customers (id, telegram_id, telegram_username, first_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, DATETIME('now'), DATETIME('now'))`,
  ).run(id, telegramId, username, username);
}

function insertDeliveredOrder({
  id,
  orderNumber,
  customerId,
  username,
  archived = 1,
  completedAt = '2026-06-22T10:00:00.000Z',
  createdAt = '2026-06-22T07:00:00.000Z',
}) {
  db.prepare(
    `INSERT INTO orders (
      id, order_number, customer_id, telegram_username, status, archived,
      total_amount, final_amount, completed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'delivered', ?, 10, 10, ?, ?, ?)`,
  ).run(id, orderNumber, customerId, username, archived, completedAt, createdAt, createdAt);
  db.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_title, variant_name, quantity, price_per_unit, total_price, total_cost)
     VALUES (?, ?, 'prod1', 'Ананас', 'Вкус', 1, 10, 10, 4)`,
  ).run(`oi_${id}`, id);
}

function insertCancelledOrder({
  id,
  orderNumber,
  customerId,
  username,
  archived = 0,
  completedAt = null,
  createdAt = '2026-06-22T16:23:07',
}) {
  db.prepare(
    `INSERT INTO orders (
      id, order_number, customer_id, telegram_username, status, archived,
      total_amount, final_amount, completed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'cancelled', ?, 10, 10, ?, ?, ?)`,
  ).run(id, orderNumber, customerId, username, archived, completedAt, createdAt, createdAt);
}

function sqlNormalizeUsername(raw) {
  const row = db
    .prepare(`SELECT ${normalizeTelegramUsernameSqlExpr('?')} AS normalized`)
    .get(raw);
  return row?.normalized ?? '';
}

console.log('\n=== product-reviews archived customer history ===\n');

console.log('--- H1: legacy query hides archived; fixed query exposes them ---');
{
  seedCatalog();
  insertCustomer({ id: 'cust_maff', telegramId: '1088000252', username: 'Maffsim' });
  insertDeliveredOrder({
    id: 'ord_9086',
    orderNumber: 9086,
    customerId: 'cust_maff',
    username: 'Maffsim',
    archived: 1,
  });

  const legacy = findOwnedOrdersLegacyHidden({
    telegramId: '1088000252',
    telegramUsername: 'Maffsim',
    statuses: ['delivered', 'completed', 'cancelled'],
  });
  const fixed = findOwnedOrders({
    telegramId: '1088000252',
    telegramUsername: 'Maffsim',
    statuses: ['delivered', 'completed', 'cancelled'],
  });

  ok(legacy.length === 0, 'legacy behavior hid archived order (reproduces prod bug)');
  ok(fixed.length === 1 && fixed[0].order_number === 9086, 'fixed query returns archived order');
}

console.log('\n--- H2: all post-cabinet customers recover every archived delivered order ---');
{
  seedCatalog();
  const buyers = [
    { id: 'cust_a', telegramId: '1001', username: 'buyer_a', orders: [9100, 9101] },
    { id: 'cust_b', telegramId: '1002', username: 'buyer_b', orders: [9102] },
    { id: 'cust_c', telegramId: '1003', username: 'QuaiLLLL', orders: [9137, 9138] },
  ];

  for (const buyer of buyers) {
    insertCustomer({ id: buyer.id, telegramId: buyer.telegramId, username: buyer.username });
    for (const [idx, orderNumber] of buyer.orders.entries()) {
      insertDeliveredOrder({
        id: `ord_${buyer.id}_${idx}`,
        orderNumber,
        customerId: buyer.id,
        username: buyer.username,
        archived: 1,
        completedAt: `2026-06-22T1${idx}:00:00.000Z`,
      });
    }
  }

  for (const buyer of buyers) {
    const owned = findOwnedOrders({
      telegramId: buyer.telegramId,
      telegramUsername: buyer.username,
      statuses: ['delivered', 'completed', 'cancelled'],
      limit: 50,
    });
    ok(owned.length === buyer.orders.length, `${buyer.username} sees all ${buyer.orders.length} archived orders`);
  }
}

console.log('\n--- H3: HTTP my-history returns every archived order for each buyer ---');
{
  seedCatalog();
  insertCustomer({ id: 'cust_maff', telegramId: '1088000252', username: 'Maffsim' });
  insertCustomer({ id: 'cust_quai', telegramId: '2002', username: 'QuaiLLLL' });
  insertDeliveredOrder({
    id: 'ord_9086',
    orderNumber: 9086,
    customerId: 'cust_maff',
    username: 'Maffsim',
  });
  insertDeliveredOrder({
    id: 'ord_9137',
    orderNumber: 9137,
    customerId: 'cust_quai',
    username: 'QuaiLLLL',
  });

  const maffHistory = await requestJson('/api/orders/my-history', {
    headers: authHeaders('1088000252', 'Maffsim'),
  });
  const quaiHistory = await requestJson('/api/orders/my-history', {
    headers: authHeaders('2002', 'QuaiLLLL'),
  });

  ok(maffHistory.data?.items?.some((row) => row.order_number === 9086), 'Maffsim HTTP history has #9086');
  ok(quaiHistory.data?.items?.some((row) => row.order_number === 9137), 'QuaiLLLL HTTP history has #9137');
}

console.log('\n--- H4: pagination across archived orders keeps full history ---');
{
  seedCatalog();
  insertCustomer({ id: 'cust_page', telegramId: '3003', username: 'page_user' });

  for (let i = 0; i < 5; i += 1) {
    insertDeliveredOrder({
      id: `ord_page_${i}`,
      orderNumber: 9200 + i,
      customerId: 'cust_page',
      username: 'page_user',
      archived: 1,
      completedAt: `2026-06-22T1${i}:00:00.000Z`,
      createdAt: `2026-06-22T0${i}:00:00.000Z`,
    });
  }

  const page1 = await requestJson('/api/orders/my-history?limit=2', {
    headers: authHeaders('3003', 'page_user'),
  });
  const page2 = await requestJson(
    `/api/orders/my-history?limit=2&cursor=${encodeURIComponent(page1.data.next_cursor)}`,
    { headers: authHeaders('3003', 'page_user') },
  );
  const page3 = await requestJson(
    `/api/orders/my-history?limit=2&cursor=${encodeURIComponent(page2.data.next_cursor)}`,
    { headers: authHeaders('3003', 'page_user') },
  );

  const allIds = [
    ...(page1.data?.items || []),
    ...(page2.data?.items || []),
    ...(page3.data?.items || []),
  ].map((row) => row.order_number);

  ok(allIds.length === 5, 'paginated archived history returns all 5 orders');
  ok(new Set(allIds).size === 5, 'paginated archived history has no duplicates');
}

console.log('\n--- H5: mixed archived + fresh delivered orders sort correctly ---');
{
  seedCatalog();
  insertCustomer({ id: 'cust_mix', telegramId: '4004', username: 'mix_user' });
  insertDeliveredOrder({
    id: 'ord_old_arch',
    orderNumber: 9300,
    customerId: 'cust_mix',
    username: 'mix_user',
    archived: 1,
    completedAt: '2026-06-20T10:00:00.000Z',
  });
  insertDeliveredOrder({
    id: 'ord_new_arch',
    orderNumber: 9301,
    customerId: 'cust_mix',
    username: 'mix_user',
    archived: 1,
    completedAt: '2026-06-22T14:00:00.000Z',
  });
  insertDeliveredOrder({
    id: 'ord_new_live',
    orderNumber: 9302,
    customerId: 'cust_mix',
    username: 'mix_user',
    archived: 0,
    completedAt: '2026-06-22T18:00:00.000Z',
  });

  const owned = findOwnedOrders({
    telegramId: '4004',
    telegramUsername: 'mix_user',
    statuses: ['delivered', 'completed', 'cancelled'],
  });

  ok(owned.length === 2, 'post-launch archived and live orders are owned');
  ok(owned[0].order_number === 9302, 'newer live order sorts first');
  ok(owned[1].order_number === 9301, 'post-launch archived order still present');
  ok(!owned.some((order) => order.order_number === 9300), 'pre-launch archived order stays hidden');
}

console.log('\n--- H6: rejected reviews on archived orders unlock prompt + resubmit ---');
{
  seedCatalog();
  insertCustomer({ id: 'cust_maff', telegramId: '1088000252', username: 'Maffsim' });
  insertDeliveredOrder({
    id: 'ord_9086',
    orderNumber: 9086,
    customerId: 'cust_maff',
    username: 'Maffsim',
  });

  db.prepare(
    `INSERT INTO product_reviews (
      id, customer_id, order_id, order_item_id, group_id, category_id,
      rating, body_text, status, is_anonymous, created_at, updated_at
    ) VALUES ('rev_rej', 'cust_maff', 'ord_9086', 'oi_ord_9086', 'grp1', 'cat_liq',
      5, 'Все чётко быстро. Спасибо', ?, 0, DATETIME('now'), DATETIME('now'))`,
  ).run(REVIEW_STATUSES.REJECTED);

  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get('cust_maff');
  const prompt = getReviewPromptForCustomer(customer);
  ok(prompt.show === true && prompt.order_id === 'ord_9086', 'review prompt targets archived rejected order');

  const resubmit = await requestJson('/api/reviews', {
    method: 'POST',
    headers: authHeaders('1088000252', 'Maffsim'),
    body: JSON.stringify({
      order_id: 'ord_9086',
      group_id: 'grp1',
      order_item_id: 'oi_ord_9086',
      rating: 4,
      body_text: 'Нормальная жидкость, вкус держится долго и приятный',
      quick_tag_ids: [],
    }),
  });
  ok(resubmit.response.status === 201, 'resubmit review on archived order succeeds');
}

console.log('\n--- H7: pre-launch archived orders stay hidden ---');
{
  seedCatalog();
  insertCustomer({ id: 'cust_old', telegramId: '5005', username: 'old_user' });
  insertDeliveredOrder({
    id: 'ord_pre_launch',
    orderNumber: 8001,
    customerId: 'cust_old',
    username: 'old_user',
    archived: 1,
    completedAt: '2026-06-20T12:00:00.000Z',
    createdAt: '2026-06-20T10:00:00.000Z',
  });
  insertDeliveredOrder({
    id: 'ord_post_launch',
    orderNumber: 8002,
    customerId: 'cust_old',
    username: 'old_user',
    archived: 1,
    completedAt: '2026-06-22T12:00:00.000Z',
    createdAt: '2026-06-22T10:00:00.000Z',
  });

  const owned = findOwnedOrders({
    telegramId: '5005',
    telegramUsername: 'old_user',
    statuses: ['delivered', 'completed', 'cancelled'],
  });

  ok(owned.length === 1, 'only post-launch archived order is visible');
  ok(owned[0].order_number === 8002, 'pre-launch archived order remains hidden');

  const history = await requestJson('/api/orders/my-history', {
    headers: authHeaders('5005', 'old_user'),
  });
  ok(!history.data?.items?.some((row) => row.order_number === 8001), 'HTTP history hides pre-launch archived');
  ok(history.data?.items?.some((row) => row.order_number === 8002), 'HTTP history shows post-launch archived');
}

console.log('\n--- H8: prod-like ISO completed_at on archived post-launch orders ---');
{
  seedCatalog();
  insertCustomer({ id: 'cust_quai', telegramId: '835143827', username: 'QuaiLLLL' });
  db.prepare(
    `INSERT INTO orders (
      id, order_number, customer_id, telegram_username, status, archived,
      total_amount, final_amount, completed_at, created_at, updated_at
    ) VALUES ('ord_9137', 9137, 'cust_quai', 'QuaiLLLL', 'delivered', 1, 10, 10,
      '2026-06-22T17:09:44.459Z', '2026-06-22 17:08:55', '2026-06-22 17:08:55')`,
  ).run();
  db.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_title, variant_name, quantity, price_per_unit, total_price, total_cost)
     VALUES ('oi_9137', 'ord_9137', 'prod1', 'Ананас', 'Вкус', 1, 10, 10, 4)`,
  ).run();
  insertCustomer({ id: 'cust_maff', telegramId: '1088000252', username: 'Maffsim' });
  db.prepare(
    `INSERT INTO orders (
      id, order_number, customer_id, telegram_username, status, archived,
      total_amount, final_amount, completed_at, created_at, updated_at
    ) VALUES ('ord_9086', 9086, 'cust_maff', 'Maffsim', 'delivered', 1, 10, 10,
      '2026-06-22T10:20:37.132Z', '2026-06-22 07:26:38', '2026-06-22 07:26:38')`,
  ).run();
  db.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_title, variant_name, quantity, price_per_unit, total_price, total_cost)
     VALUES ('oi_9086', 'ord_9086', 'prod1', 'Ананас', 'Вкус', 1, 10, 10, 4)`,
  ).run();

  const quaiOwned = findOwnedOrders({
    telegramId: '835143827',
    telegramUsername: 'QuaiLLLL',
    statuses: ['delivered', 'completed', 'cancelled'],
  });
  const maffOwned = findOwnedOrders({
    telegramId: '1088000252',
    telegramUsername: 'Maffsim',
    statuses: ['delivered', 'completed', 'cancelled'],
  });

  ok(quaiOwned.some((order) => order.order_number === 9137), 'QuaiLLLL ISO archived #9137 is visible');
  ok(maffOwned.some((order) => order.order_number === 9086), 'Maffsim ISO archived #9086 is visible');
}

console.log('\n--- H9: username-only ownership still resolves archived orders ---');
{
  seedCatalog();
  db.prepare(
    `INSERT INTO orders (
      id, order_number, customer_id, telegram_username, status, archived,
      total_amount, final_amount, completed_at, created_at, updated_at
    ) VALUES ('ord_orphan', 9400, NULL, 'orphan_user', 'delivered', 1, 10, 10,
      '2026-06-22T11:00:00.000Z', '2026-06-22T09:00:00.000Z', '2026-06-22T11:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_title, variant_name, quantity, price_per_unit, total_price, total_cost)
     VALUES ('oi_orphan', 'ord_orphan', 'prod1', 'Ананас', 'Вкус', 1, 10, 10, 4)`,
  ).run();

  const owned = findOwnedOrders({
    telegramId: '',
    telegramUsername: 'orphan_user',
    statuses: ['delivered', 'completed', 'cancelled'],
  });
  ok(owned.length === 1 && owned[0].order_number === 9400, 'username-only archived order is visible');
}

console.log('\n--- H10: global LIMIT noise from other customers does not hide owned orders ---');
{
  seedCatalog();
  insertCustomer({ id: 'cust_quai', telegramId: '835143827', username: 'QuaiLLLL' });

  for (let i = 0; i < 60; i += 1) {
    const otherId = `cust_noise_${i}`;
    insertCustomer({ id: otherId, telegramId: `9${String(i).padStart(9, '0')}`, username: `noise_${i}` });
    insertDeliveredOrder({
      id: `ord_noise_${i}`,
      orderNumber: 5000 + i,
      customerId: otherId,
      username: `noise_${i}`,
      archived: 0,
      completedAt: '2026-06-10T10:00:00.000Z',
      createdAt: '2026-06-10T09:00:00.000Z',
    });
  }

  for (const [idx, orderNumber] of [9132, 9137, 9194].entries()) {
    insertDeliveredOrder({
      id: `ord_quai_${idx}`,
      orderNumber,
      customerId: 'cust_quai',
      username: 'QuaiLLLL',
      archived: idx < 2 ? 1 : 0,
      completedAt: `2026-06-2${idx < 2 ? 2 : 3}T1${idx}:00:00.000Z`,
      createdAt: `2026-06-2${idx < 2 ? 2 : 3}T0${idx}:00:00.000Z`,
    });
  }

  const owned = findOwnedOrders({
    telegramId: '835143827',
    telegramUsername: 'QuaiLLLL',
    statuses: ['delivered', 'completed', 'cancelled'],
    limit: 50,
  });

  const numbers = owned.map((order) => order.order_number).sort((a, b) => a - b);
  ok(numbers.length === 3, 'QuaiLLLL sees all 3 post-launch orders despite global noise');
  ok(numbers.join(',') === '9132,9137,9194', 'owned order numbers match prod-like set');
}

console.log('\n--- H11: pre-launch non-archived orders stay hidden ---');
{
  seedCatalog();
  insertCustomer({ id: 'cust_old', telegramId: '6006', username: 'old_live_user' });
  insertDeliveredOrder({
    id: 'ord_pre_live',
    orderNumber: 8101,
    customerId: 'cust_old',
    username: 'old_live_user',
    archived: 0,
    completedAt: '2026-06-20T12:00:00.000Z',
    createdAt: '2026-06-20T10:00:00.000Z',
  });
  insertDeliveredOrder({
    id: 'ord_post_live',
    orderNumber: 8102,
    customerId: 'cust_old',
    username: 'old_live_user',
    archived: 0,
    completedAt: '2026-06-22T12:00:00.000Z',
    createdAt: '2026-06-22T10:00:00.000Z',
  });

  const owned = findOwnedOrders({
    telegramId: '6006',
    telegramUsername: 'old_live_user',
    statuses: ['delivered', 'completed', 'cancelled'],
  });

  ok(owned.length === 1 && owned[0].order_number === 8102, 'only post-launch live order is visible');
}

console.log('\n--- H12: post-launch cancelled orders without completed_at stay visible ---');
{
  seedCatalog();
  insertCustomer({ id: 'cust_rk0ff', telegramId: '2035055116', username: 'rk0ff' });
  insertDeliveredOrder({
    id: 'ord_delivered',
    orderNumber: 9114,
    customerId: 'cust_rk0ff',
    username: 'rk0ff',
    archived: 1,
    completedAt: '2026-06-22T13:10:41.638Z',
  });
  insertCancelledOrder({
    id: 'ord_cancelled',
    orderNumber: 9130,
    customerId: 'cust_rk0ff',
    username: 'rk0ff',
    createdAt: '2026-06-22 16:23:07',
  });

  const owned = findOwnedOrders({
    telegramId: '2035055116',
    telegramUsername: 'rk0ff',
    statuses: ['delivered', 'completed', 'cancelled'],
  });

  ok(
    owned.some((order) => order.order_number === 9114),
    'delivered post-launch order stays visible',
  );
  ok(
    owned.some((order) => order.order_number === 9130 && order.status === 'cancelled'),
    'cancelled post-launch order visible via created_at fallback',
  );

  const history = await requestJson('/api/orders/my-history', {
    headers: authHeaders('2035055116', 'rk0ff'),
  });
  ok(
    history.data?.items?.some((row) => row.order_number === 9130),
    'HTTP history includes cancelled post-launch order',
  );
}

console.log('\n--- H13: pre-launch cancelled orders without completed_at stay hidden ---');
{
  seedCatalog();
  insertCustomer({ id: 'cust_old_cancel', telegramId: '7007', username: 'old_cancel_user' });
  insertCancelledOrder({
    id: 'ord_pre_cancel',
    orderNumber: 8201,
    customerId: 'cust_old_cancel',
    username: 'old_cancel_user',
    createdAt: '2026-06-20 18:00:00',
  });
  insertCancelledOrder({
    id: 'ord_post_cancel',
    orderNumber: 8202,
    customerId: 'cust_old_cancel',
    username: 'old_cancel_user',
    createdAt: '2026-06-22 18:00:00',
  });

  const owned = findOwnedOrders({
    telegramId: '7007',
    telegramUsername: 'old_cancel_user',
    statuses: ['delivered', 'completed', 'cancelled'],
  });

  ok(owned.length === 1 && owned[0].order_number === 8202, 'only post-launch cancelled order is visible');
  ok(!owned.some((order) => order.order_number === 8201), 'pre-launch cancelled order stays hidden');
}

console.log('\n--- H14: telegram_id-only ownership resolves customer-linked orders ---');
{
  seedCatalog();
  insertCustomer({ id: 'cust_id_only', telegramId: '8080808', username: 'id_only_user' });
  insertDeliveredOrder({
    id: 'ord_id_only',
    orderNumber: 9500,
    customerId: 'cust_id_only',
    username: 'id_only_user',
    archived: 1,
  });

  const owned = findOwnedOrders({
    telegramId: '8080808',
    telegramUsername: '',
    statuses: ['delivered', 'completed', 'cancelled'],
  });

  ok(owned.length === 1 && owned[0].order_number === 9500, 'telegram_id-only query returns owned order');
}

console.log('\n--- H15: stored @@username matches normalized lookup ---');
{
  seedCatalog();
  insertCustomer({ id: 'cust_at', telegramId: '9090909', username: 'AtUser' });
  db.prepare(
    `INSERT INTO orders (
      id, order_number, customer_id, telegram_username, status, archived,
      total_amount, final_amount, completed_at, created_at, updated_at
    ) VALUES ('ord_at_user', 9600, 'cust_at', '@@AtUser', 'delivered', 1, 10, 10,
      '2026-06-22T12:00:00.000Z', '2026-06-22T10:00:00.000Z', '2026-06-22T12:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_title, variant_name, quantity, price_per_unit, total_price, total_cost)
     VALUES ('oi_at_user', 'ord_at_user', 'prod1', 'Ананас', 'Вкус', 1, 10, 10, 4)`,
  ).run();

  const owned = findOwnedOrders({
    telegramId: '9090909',
    telegramUsername: '@AtUser',
    statuses: ['delivered', 'completed', 'cancelled'],
  });
  ok(owned.length === 1 && owned[0].order_number === 9600, '@@ stored username resolves via normalized lookup');
}

console.log('\n--- H16: SQL username normalization stays in sync with JS ---');
{
  const samples = [
    ['@@QuaiLLLL', 'quaillll'],
    ['  @user  ', 'user'],
    ['@Maffsim', 'maffsim'],
    ['plain_name', 'plain_name'],
    ['', ''],
  ];

  for (const [raw, expected] of samples) {
    const js = normalizeTelegramUsername(raw).toLowerCase();
    const sql = sqlNormalizeUsername(raw);
    ok(js === sql, `JS/SQL parity for ${JSON.stringify(raw)}`);
    ok(sql === expected, `SQL normalization for ${JSON.stringify(raw)} is ${expected}`);
  }
}

server.close();
console.log(`\nDone: ${results.passed} passed, ${results.failed} failed\n`);
process.exit(results.failed > 0 ? 1 : 0);