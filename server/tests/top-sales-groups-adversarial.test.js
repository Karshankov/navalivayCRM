/**
 * Top sales groups — adversarial + regression unit tests.
 * Запуск: node server/tests/top-sales-groups-adversarial.test.js
 */
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_DB = path.resolve(__dirname, `./.tmp-top-sales-adv-${Date.now()}.db`);
process.env.DATABASE_FILE = TMP_DB;

const { db, initDb } = await import('../db.js');
initDb();

const { queryTopSalesGroups, isGroupAvailableOnStorefront } = await import('../utils/top-sales-groups.js');
const { getBusinessPeriodRange } = await import('../utils/business-time.js');

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

function assertEq(actual, expected, msg) {
  ok(actual === expected, `${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
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

function seedCategory(id, profile = 'liquids') {
  db.prepare(
    `INSERT INTO categories (id, slug, name, [order], storefront_filters_profile)
     VALUES (?, ?, 'Cat', 1, ?)`,
  ).run(id, id, profile);
}

function seedGroup(id, categoryId, name) {
  db.prepare(
    `INSERT INTO category_groups (id, categoryId, slug, name, [order], hide_empty, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, 1, 1, DATETIME('now'), DATETIME('now'))`,
  ).run(id, categoryId, id, name);
}

function seedProduct(id, categoryId, groupId, title = 'Flavor', stock = 5) {
  db.prepare(
    `INSERT INTO products (id, categoryId, groupId, title, priceRub, description, stock, createdAt)
     VALUES (?, ?, ?, ?, 10, '', ?, DATETIME('now'))`,
  ).run(id, categoryId, groupId ?? null, title, stock);
}

function seedPaidOrder({ orderId, customerId, paidAt, status = 'completed' }) {
  db.prepare(
    `INSERT INTO orders (id, order_number, customer_id, status, total_amount, final_amount, paid_at, created_at)
     VALUES (?, ?, ?, ?, 10, 10, ?, DATETIME('now'))`,
  ).run(orderId, orderId, customerId, status, paidAt);
}

function seedUnpaidOrder({ orderId, customerId, status = 'completed' }) {
  db.prepare(
    `INSERT INTO orders (id, order_number, customer_id, status, total_amount, final_amount, paid_at, created_at)
     VALUES (?, ?, ?, ?, 10, 10, NULL, DATETIME('now'))`,
  ).run(orderId, orderId, customerId, status);
}

function seedOrderItem({ id, orderId, productId, quantity, totalPrice, totalCost = 4 }) {
  const unitPrice = totalPrice / quantity;
  db.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_title, quantity, price_per_unit, total_price, total_cost)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, orderId, productId, `Product ${productId}`, quantity, unitPrice, totalPrice, totalCost);
}

const { start, end } = getBusinessPeriodRange('month', 0);
const paidAt = start.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
const beforePeriod = new Date(start.getTime() - 60_000)
  .toISOString()
  .replace('T', ' ')
  .replace(/\.\d{3}Z$/, '');

console.log('\n=== top-sales-groups adversarial ===\n');

console.log('--- A1: limit clamping ---');
{
  resetTables();
  seedCategory('c_lim');
  seedGroup('g_lim', 'c_lim', 'Lim');
  seedProduct('p_lim', 'c_lim', 'g_lim');
  seedCustomer('cust_lim');
  seedPaidOrder({ orderId: 'o_lim', customerId: 'cust_lim', paidAt });
  seedOrderItem({ id: 'oi_lim', orderId: 'o_lim', productId: 'p_lim', quantity: 1, totalPrice: 10 });

  const zeroLimit = queryTopSalesGroups({ start, end, limit: 0 });
  ok(zeroLimit.items.length === 1, 'limit 0 clamps to 1');

  const negLimit = queryTopSalesGroups({ start, end, limit: -3 });
  ok(negLimit.items.length === 1, 'negative limit clamps to 1');

  const hugeLimit = queryTopSalesGroups({ start, end, limit: 9999 });
  ok(hugeLimit.items.length === 1, 'huge limit clamped to 1000 still returns 1 row');

  const nanLimit = queryTopSalesGroups({ start, end, limit: 'abc' });
  ok(nanLimit.items.length === 1, 'non-numeric limit defaults to 5');
}

console.log('\n--- A2: search LIKE escape (% and _) ---');
{
  resetTables();
  seedCategory('c_srch');
  seedGroup('g_pct', 'c_srch', '100% sale');
  seedGroup('g_plain', 'c_srch', 'Alpha line');
  seedGroup('g_und', 'c_srch', 'under_score');
  seedProduct('p_pct', 'c_srch', 'g_pct');
  seedProduct('p_plain', 'c_srch', 'g_plain');
  seedProduct('p_und', 'c_srch', 'g_und');
  seedCustomer('cust_srch');
  seedPaidOrder({ orderId: 'o_srch', customerId: 'cust_srch', paidAt });
  seedOrderItem({ id: 'oi_pct', orderId: 'o_srch', productId: 'p_pct', quantity: 1, totalPrice: 10 });
  seedOrderItem({ id: 'oi_plain', orderId: 'o_srch', productId: 'p_plain', quantity: 1, totalPrice: 10 });
  seedOrderItem({ id: 'oi_und', orderId: 'o_srch', productId: 'p_und', quantity: 1, totalPrice: 10 });

  const percentSearch = queryTopSalesGroups({ start, end, categoryId: 'c_srch', search: '100%' });
  ok(
    percentSearch.items.length === 1 && percentSearch.items[0].groupId === 'g_pct',
    'literal % in search does not wildcard-match all groups',
  );

  const wildcardOnly = queryTopSalesGroups({ start, end, categoryId: 'c_srch', search: '%' });
  ok(wildcardOnly.items.length === 1, 'bare % matches only groups with literal %');

  const underscoreSearch = queryTopSalesGroups({ start, end, categoryId: 'c_srch', search: '_' });
  ok(
    underscoreSearch.items.length === 1 && underscoreSearch.items[0].groupId === 'g_und',
    'literal _ in search does not act as single-char wildcard',
  );
}

console.log('\n--- A3: order status and paid_at filters ---');
{
  resetTables();
  seedCategory('c_stat');
  seedGroup('g_ok', 'c_stat', 'OK');
  seedGroup('g_bad', 'c_stat', 'Bad');
  seedProduct('p_ok', 'c_stat', 'g_ok');
  seedProduct('p_bad', 'c_stat', 'g_bad');
  seedCustomer('cust_stat');

  seedPaidOrder({ orderId: 'o_ok', customerId: 'cust_stat', paidAt, status: 'delivered' });
  seedOrderItem({ id: 'oi_ok', orderId: 'o_ok', productId: 'p_ok', quantity: 5, totalPrice: 50 });

  seedPaidOrder({ orderId: 'o_pending', customerId: 'cust_stat', paidAt, status: 'pending' });
  seedOrderItem({ id: 'oi_pending', orderId: 'o_pending', productId: 'p_bad', quantity: 99, totalPrice: 990 });

  seedUnpaidOrder({ orderId: 'o_unpaid', customerId: 'cust_stat', status: 'completed' });
  seedOrderItem({ id: 'oi_unpaid', orderId: 'o_unpaid', productId: 'p_bad', quantity: 99, totalPrice: 990 });

  const stats = queryTopSalesGroups({ start, end, categoryId: 'c_stat' });
  ok(stats.items.length === 1, 'only completed/delivered with paid_at counted');
  ok(stats.items[0].groupId === 'g_ok', 'pending and unpaid orders excluded');
}

console.log('\n--- A4: period boundary ---');
{
  resetTables();
  seedCategory('c_per');
  seedGroup('g_in', 'c_per', 'In period');
  seedGroup('g_out', 'c_per', 'Out period');
  seedProduct('p_in', 'c_per', 'g_in');
  seedProduct('p_out', 'c_per', 'g_out');
  seedCustomer('cust_per');

  seedPaidOrder({ orderId: 'o_in', customerId: 'cust_per', paidAt });
  seedOrderItem({ id: 'oi_in', orderId: 'o_in', productId: 'p_in', quantity: 2, totalPrice: 20 });

  seedPaidOrder({ orderId: 'o_out', customerId: 'cust_per', paidAt: beforePeriod });
  seedOrderItem({ id: 'oi_out', orderId: 'o_out', productId: 'p_out', quantity: 50, totalPrice: 500 });

  const period = queryTopSalesGroups({ start, end, categoryId: 'c_per' });
  ok(period.items.length === 1, 'orders outside business month excluded');
  ok(period.items[0].groupId === 'g_in', 'in-period group kept');
}

console.log('\n--- A5: products without group (no_group) ---');
{
  resetTables();
  seedCategory('c_nogrp');
  seedGroup('g_with', 'c_nogrp', 'With group');
  seedProduct('p_with', 'c_nogrp', 'g_with');
  seedProduct('p_orphan', 'c_nogrp', null);
  seedCustomer('cust_nogrp');
  seedPaidOrder({ orderId: 'o_nogrp', customerId: 'cust_nogrp', paidAt });
  seedOrderItem({ id: 'oi_with', orderId: 'o_nogrp', productId: 'p_with', quantity: 1, totalPrice: 10 });
  seedOrderItem({ id: 'oi_orphan', orderId: 'o_nogrp', productId: 'p_orphan', quantity: 100, totalPrice: 1000 });

  const noGroup = queryTopSalesGroups({ start, end, categoryId: 'c_nogrp' });
  ok(noGroup.items.length === 1, 'orphan products excluded from ranking');
  ok(noGroup.items[0].groupId === 'g_with', 'only grouped products appear');
}

console.log('\n--- R1: profit sort ---');
{
  resetTables();
  seedCategory('c_prof');
  seedGroup('g_qty', 'c_prof', 'High qty');
  seedGroup('g_prf', 'c_prof', 'High profit');
  seedProduct('p_qty', 'c_prof', 'g_qty');
  seedProduct('p_prf', 'c_prof', 'g_prf');
  seedCustomer('cust_prof');
  seedPaidOrder({ orderId: 'o_prof', customerId: 'cust_prof', paidAt });
  seedOrderItem({
    id: 'oi_qty',
    orderId: 'o_prof',
    productId: 'p_qty',
    quantity: 20,
    totalPrice: 200,
    totalCost: 180,
  });
  seedOrderItem({
    id: 'oi_prf',
    orderId: 'o_prof',
    productId: 'p_prf',
    quantity: 2,
    totalPrice: 200,
    totalCost: 20,
  });

  const byProfit = queryTopSalesGroups({
    start,
    end,
    categoryId: 'c_prof',
    sortBy: 'profit',
    limit: 5,
  });
  ok(byProfit.items[0].groupId === 'g_prf', 'profit sort prefers higher margin group');
  ok(byProfit.items[0].totalProfit > byProfit.items[1].totalProfit, 'profit values ordered desc');
}

console.log('\n--- R2: hasMore flag ---');
{
  resetTables();
  seedCategory('c_more');
  seedCustomer('cust_more');
  seedPaidOrder({ orderId: 'o_more', customerId: 'cust_more', paidAt });
  for (let i = 1; i <= 6; i += 1) {
    const gid = `g_more_${i}`;
    seedGroup(gid, 'c_more', `Line ${i}`);
    seedProduct(`p_more_${i}`, 'c_more', gid);
    seedOrderItem({
      id: `oi_more_${i}`,
      orderId: 'o_more',
      productId: `p_more_${i}`,
      quantity: i,
      totalPrice: i * 10,
    });
  }

  const limited = queryTopSalesGroups({ start, end, categoryId: 'c_more', limit: 5 });
  ok(limited.items.length === 5, 'limit 5 returns five items');
  ok(limited.hasMore === true, 'hasMore true when extra groups exist');
}

console.log('\n--- R3: CRM field mapping parity ---');
{
  resetTables();
  seedCategory('c_crm');
  seedGroup('g_crm', 'c_crm', 'CRM line');
  seedProduct('p_crm', 'c_crm', 'g_crm');
  seedCustomer('cust_crm');
  seedPaidOrder({ orderId: 'o_crm', customerId: 'cust_crm', paidAt });
  seedOrderItem({ id: 'oi_crm', orderId: 'o_crm', productId: 'p_crm', quantity: 4, totalPrice: 40, totalCost: 10 });

  const { items } = queryTopSalesGroups({ start, end, categoryId: 'c_crm', sortBy: 'quantity', limit: 10 });
  const crmRow = {
    group_id: items[0].groupId,
    group_name: items[0].groupName,
    total_quantity: items[0].totalQuantity,
    total_revenue: items[0].totalRevenue,
    total_profit: items[0].totalProfit,
  };
  assertEq(crmRow.group_id, 'g_crm', 'CRM group_id maps from groupId');
  assertEq(crmRow.total_quantity, 4, 'CRM total_quantity maps from totalQuantity');
  ok(Number.isFinite(crmRow.total_revenue), 'CRM total_revenue is numeric');
  ok(Number.isFinite(crmRow.total_profit), 'CRM total_profit is numeric');
}

console.log('\n--- A6: storefront filter skips OOS and re-ranks ---');
{
  resetTables();
  seedCategory('c_oos');
  seedGroup('g_1', 'c_oos', 'PODGON');
  seedGroup('g_2', 'c_oos', 'CRITICAL');
  seedGroup('g_3', 'c_oos', 'CATSWILL');
  seedGroup('g_4', 'c_oos', 'DUALL');
  seedGroup('g_5', 'c_oos', 'FIFTH');
  seedProduct('p_1', 'c_oos', 'g_1', 'P1', 5);
  seedProduct('p_2', 'c_oos', 'g_2', 'P2', 0);
  seedProduct('p_3', 'c_oos', 'g_3', 'P3', 0);
  seedProduct('p_4', 'c_oos', 'g_4', 'P4', 3);
  seedProduct('p_5', 'c_oos', 'g_5', 'P5', 2);
  seedCustomer('cust_oos');
  seedPaidOrder({ orderId: 'o_oos', customerId: 'cust_oos', paidAt });
  seedOrderItem({ id: 'oi_1', orderId: 'o_oos', productId: 'p_1', quantity: 100, totalPrice: 1000 });
  seedOrderItem({ id: 'oi_2', orderId: 'o_oos', productId: 'p_2', quantity: 80, totalPrice: 800 });
  seedOrderItem({ id: 'oi_3', orderId: 'o_oos', productId: 'p_3', quantity: 60, totalPrice: 600 });
  seedOrderItem({ id: 'oi_4', orderId: 'o_oos', productId: 'p_4', quantity: 40, totalPrice: 400 });
  seedOrderItem({ id: 'oi_5', orderId: 'o_oos', productId: 'p_5', quantity: 20, totalPrice: 200 });

  ok(!isGroupAvailableOnStorefront('g_2'), 'critical line is OOS on storefront');
  ok(isGroupAvailableOnStorefront('g_4'), 'duall line stays available');

  const storefrontTop = queryTopSalesGroups({
    start,
    end,
    categoryId: 'c_oos',
    limit: 5,
    onlyStorefrontAvailable: true,
  });
  ok(storefrontTop.items.length === 3, 'only in-stock groups returned');
  ok(storefrontTop.items[0].groupId === 'g_1' && storefrontTop.items[0].rank === 1, 'leader keeps rank 1');
  ok(storefrontTop.items[1].groupId === 'g_4' && storefrontTop.items[1].rank === 2, 'duall promoted to rank 2');
  ok(storefrontTop.items[2].groupId === 'g_5' && storefrontTop.items[2].rank === 3, 'fifth becomes rank 3');

  const crmTop = queryTopSalesGroups({
    start,
    end,
    categoryId: 'c_oos',
    limit: 5,
    onlyStorefrontAvailable: false,
  });
  ok(crmTop.items.length === 5, 'CRM view still shows all sales leaders');
  ok(crmTop.items[1].groupId === 'g_2', 'CRM keeps OOS group in raw rank 2');
}

console.log('\n--- A7: storefront filter backfills when many leaders are OOS ---');
{
  resetTables();
  seedCategory('c_fill');
  for (let i = 1; i <= 6; i += 1) {
    const gid = `g_fill_${i}`;
    seedGroup(gid, 'c_fill', `Line ${i}`);
    const stock = i <= 4 ? 0 : 4;
    seedProduct(`p_fill_${i}`, 'c_fill', gid, `P${i}`, stock);
  }
  seedCustomer('cust_fill');
  seedPaidOrder({ orderId: 'o_fill', customerId: 'cust_fill', paidAt });
  for (let i = 1; i <= 6; i += 1) {
    seedOrderItem({
      id: `oi_fill_${i}`,
      orderId: 'o_fill',
      productId: `p_fill_${i}`,
      quantity: 100 - i,
      totalPrice: (100 - i) * 10,
    });
  }

  const top = queryTopSalesGroups({
    start,
    end,
    categoryId: 'c_fill',
    limit: 2,
    onlyStorefrontAvailable: true,
  });
  ok(top.items.length === 2, 'backfills top-2 from deeper sales pool');
  ok(top.items[0].groupId === 'g_fill_5' && top.items[0].rank === 1, 'first available sales leader is rank 1');
  ok(top.items[1].groupId === 'g_fill_6' && top.items[1].rank === 2, 'next available leader is rank 2');
  ok(top.hasMore === false, 'only two in-stock groups total');
}

console.log('\n--- A8: parent line stays available when child subgroup has stock ---');
{
  resetTables();
  seedCategory('c_parent');
  seedGroup('g_parent', 'c_parent', 'PODONKI');
  seedGroup('g_child', 'c_parent', 'PODONKI CRITICAL', null);
  db.prepare('UPDATE category_groups SET parent_group_id = ? WHERE id = ?').run('g_parent', 'g_child');
  seedProduct('p_parent', 'c_parent', 'g_parent', 'Parent flavor', 0);
  seedProduct('p_child', 'c_parent', 'g_child', 'Child flavor', 6);
  seedCustomer('cust_parent');
  seedPaidOrder({ orderId: 'o_parent', customerId: 'cust_parent', paidAt });
  seedOrderItem({ id: 'oi_parent', orderId: 'o_parent', productId: 'p_parent', quantity: 50, totalPrice: 500 });

  ok(isGroupAvailableOnStorefront('g_parent'), 'parent counts child stock');
  const top = queryTopSalesGroups({
    start,
    end,
    categoryId: 'c_parent',
    limit: 5,
    onlyStorefrontAvailable: true,
  });
  ok(top.items.length === 1 && top.items[0].groupId === 'g_parent', 'parent sales row kept when subtree has stock');
}

console.log('\n--- R4: case-insensitive search ---');
{
  resetTables();
  seedCategory('c_case');
  seedGroup('g_case', 'c_case', 'DuDu Line');
  seedProduct('p_case', 'c_case', 'g_case');
  seedCustomer('cust_case');
  seedPaidOrder({ orderId: 'o_case', customerId: 'cust_case', paidAt });
  seedOrderItem({ id: 'oi_case', orderId: 'o_case', productId: 'p_case', quantity: 1, totalPrice: 10 });

  const found = queryTopSalesGroups({ start, end, categoryId: 'c_case', search: 'dudu' });
  ok(found.items.length === 1, 'search is case-insensitive');
}

console.log(`\nDone: ${results.passed} passed, ${results.failed} failed\n`);
try {
  fs.unlinkSync(TMP_DB);
} catch {
  // ignore
}
process.exit(results.failed > 0 ? 1 : 0);