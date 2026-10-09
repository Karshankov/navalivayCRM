/**
 * Top sales groups — unit tests.
 * Запуск: node server/tests/top-sales-groups.test.js
 */
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TMP_DB = path.resolve(__dirname, `./.tmp-top-sales-${Date.now()}.db`);
process.env.DATABASE_FILE = TMP_DB;

const { db, initDb } = await import('../db.js');
initDb();

const { queryTopSalesGroups } = await import('../utils/top-sales-groups.js');
const { getBusinessPeriodRange } = await import('../utils/business-time.js');

const results = { passed: 0, failed: 0 };

function assertEq(actual, expected, msg) {
  if (actual === expected) {
    results.passed++;
    console.log(`  OK: ${msg}`);
  } else {
    results.failed++;
    console.log(`  FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function resetTables() {
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
  ).run(id, String(id).replace(/\D/g, '') || '1', id, id);
}

function seedCategory(id, name = 'Liquids', profile = 'liquids') {
  db.prepare(
    `INSERT INTO categories (id, slug, name, [order], storefront_filters_profile)
     VALUES (?, ?, ?, 1, ?)`,
  ).run(id, id, name, profile);
}

function seedGroup(id, categoryId, name) {
  db.prepare(
    `INSERT INTO category_groups (id, categoryId, slug, name, [order], hide_empty, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, 1, 1, DATETIME('now'), DATETIME('now'))`,
  ).run(id, categoryId, id, name);
}

function seedProduct(id, categoryId, groupId, title = 'Flavor') {
  db.prepare(
    `INSERT INTO products (id, categoryId, groupId, title, priceRub, description, stock, createdAt)
     VALUES (?, ?, ?, ?, 10, '', 5, DATETIME('now'))`,
  ).run(id, categoryId, groupId, title);
}

function seedPaidOrder({ orderId, customerId, paidAt, status = 'completed', orderNumber }) {
  db.prepare(
    `INSERT INTO orders (id, order_number, customer_id, status, total_amount, final_amount, paid_at, created_at)
     VALUES (?, ?, ?, ?, 10, 10, ?, DATETIME('now'))`,
  ).run(orderId, orderNumber ?? orderId, customerId, status, paidAt);
}

function seedOrderItem({ id, orderId, productId, quantity, totalPrice, totalCost = 4 }) {
  const unitPrice = totalPrice / quantity;
  db.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_title, quantity, price_per_unit, total_price, total_cost)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, orderId, productId, `Product ${productId}`, quantity, unitPrice, totalPrice, totalCost);
}

console.log('\n=== top-sales-groups ===\n');

resetTables();
seedCategory('c_liq', 'Жидкости', 'liquids');
seedGroup('g_alpha', 'c_liq', 'Alpha');
seedGroup('g_beta', 'c_liq', 'Beta');
seedProduct('p_alpha', 'c_liq', 'g_alpha', 'Alpha 1');
seedProduct('p_beta', 'c_liq', 'g_beta', 'Beta 1');

const { start, end } = getBusinessPeriodRange('month', 0);
const paidAt = start.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

seedCustomer('cust1');
seedCustomer('cust2');
seedPaidOrder({ orderId: 'o1', customerId: 'cust1', paidAt });
seedPaidOrder({ orderId: 'o2', customerId: 'cust2', paidAt });
seedOrderItem({ id: 'oi1', orderId: 'o1', productId: 'p_alpha', quantity: 3, totalPrice: 30 });
seedOrderItem({ id: 'oi2', orderId: 'o2', productId: 'p_beta', quantity: 7, totalPrice: 70 });

const monthTop = queryTopSalesGroups({
  start,
  end,
  categoryId: 'c_liq',
  sortBy: 'quantity',
  limit: 5,
});

assertEq(monthTop.items.length, 2, 'returns two groups for category');
assertEq(monthTop.items[0].groupId, 'g_beta', 'sorts by quantity desc');
assertEq(monthTop.items[0].rank, 1, 'assigns rank 1 to leader');
assertEq(monthTop.items[1].groupId, 'g_alpha', 'second group is alpha');
assertEq(monthTop.items[1].totalQuantity, 3, 'alpha quantity is 3');

// Признак «у линейки есть обложка» считается в запросе через CASE, а не через
// MAX по самой картинке: обложки лежат в базе строкой base64, и протаскивать их
// через каждую позицию заказа стоит в сто раз дороже. Проверяем оба исхода,
// чтобы флаг не перестал быть флагом при следующей правке запроса.
db.prepare('UPDATE category_groups SET cover_image = ? WHERE id = ?').run(
  'data:image/webp;base64,AAAA',
  'g_beta',
);
db.prepare('UPDATE category_groups SET cover_image = NULL WHERE id = ?').run('g_alpha');

const withCover = queryTopSalesGroups({
  start,
  end,
  categoryId: 'c_liq',
  sortBy: 'quantity',
  limit: 5,
});
assertEq(withCover.items[0].hasCoverImage, true, 'group with cover reports hasCoverImage');
assertEq(withCover.items[1].hasCoverImage, false, 'group without cover reports no cover');

db.prepare("UPDATE category_groups SET cover_image = '' WHERE id = ?").run('g_beta');
const emptyCover = queryTopSalesGroups({
  start,
  end,
  categoryId: 'c_liq',
  sortBy: 'quantity',
  limit: 5,
});
assertEq(emptyCover.items[0].hasCoverImage, false, 'empty cover string is not a cover');

resetTables();
seedCategory('c_other', 'Pods', 'none');
seedGroup('g_pod', 'c_other', 'Pod line');
seedProduct('p_pod', 'c_other', 'g_pod');
seedCustomer('cust3');
seedPaidOrder({ orderId: 'o3', customerId: 'cust3', paidAt });
seedOrderItem({ id: 'oi3', orderId: 'o3', productId: 'p_pod', quantity: 2, totalPrice: 20 });

const filtered = queryTopSalesGroups({
  start,
  end,
  categoryId: 'c_liq',
  limit: 5,
});
assertEq(filtered.items.length, 0, 'category filter excludes other categories');

try {
  queryTopSalesGroups({ limit: 5 });
  results.failed++;
  console.log('  FAIL: missing period should throw');
} catch (error) {
  if (error.code === 'period_required') {
    results.passed++;
    console.log('  OK: missing period throws period_required');
  } else {
    results.failed++;
    console.log(`  FAIL: unexpected error ${error.message}`);
  }
}

console.log(`\nDone: ${results.passed} passed, ${results.failed} failed\n`);
try {
  fs.unlinkSync(TMP_DB);
} catch {
  // ignore
}
process.exit(results.failed > 0 ? 1 : 0);