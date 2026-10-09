/**
 * Category group completeness — HTTP API tests.
 * Запуск: node server/tests/category-group-completeness-routes.test.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navalivay-completeness-routes-'));
const tempDbPath = path.join(tempDir, 'test.db');

process.env.DATABASE_FILE = tempDbPath;
process.env.BOT_TOKEN = '';

const { initDb, db } = await import('../db.js');
const { issueToken } = await import('../auth.js');
const { adminRouter } = await import('../routes/admin.js');
const { getActiveWholesaleTiers } = await import('../wholesale-service.js');

initDb();

const app = express();
app.use(express.json());
app.use(adminRouter);

const server = await new Promise((resolve) => {
  const instance = app.listen(0, () => resolve(instance));
});

const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;
const authToken = issueToken('admin-test');

function authHeaders(extra = {}) {
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

function resetDb() {
  db.exec('DELETE FROM category_group_wholesale_prices;');
  db.exec('DELETE FROM products;');
  db.exec('DELETE FROM category_groups;');
  db.exec('DELETE FROM categories;');
}

function seedCategory(profile = 'none') {
  db.prepare(
    `INSERT INTO categories (id, slug, name, [order], storefront_filters_profile)
     VALUES ('c1', 'cat', 'Liquids', 1, ?)`,
  ).run(profile);
}

function seedIncompleteGroup() {
  db.prepare(
    `INSERT INTO category_groups
      (id, categoryId, slug, name, [order], hide_empty, createdAt, updatedAt)
     VALUES ('g1', 'c1', 'g1', 'PODGON', 1, 1, DATETIME('now'), DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO products (id, categoryId, groupId, title, priceRub, stock, min_stock, createdAt)
     VALUES ('p1', 'c1', 'g1', 'T1', 10, 5, 0, DATETIME('now'))`,
  ).run();
}

function fullWholesale(groupId) {
  const tiers = getActiveWholesaleTiers();
  const stmt = db.prepare(
    `INSERT INTO category_group_wholesale_prices (group_id, tier_id, price_byn, created_at, updated_at)
     VALUES (?, ?, 12, DATETIME('now'), DATETIME('now'))`,
  );
  tiers.forEach((tier) => stmt.run(groupId, tier.id));
}

resetDb();
seedCategory();
seedIncompleteGroup();

console.log('\n=== A-API1: GET incomplete without auth → 401 ===');
{
  const { response } = await requestJson('/api/admin/category-groups/incomplete');
  ok(response.status === 401, 'status 401');
}

console.log('\n=== A-API2: GET incomplete with auth → shape ===');
{
  const { response, data } = await requestJson('/api/admin/category-groups/incomplete', {
    headers: authHeaders(),
  });
  ok(response.status === 200, 'status 200');
  ok(Array.isArray(data?.items), 'items array');
  ok(data?.items.length === 1, 'one incomplete group');
  ok(data?.items[0]?.id === 'g1', 'group id');
  ok(Array.isArray(data?.items[0]?.missingFields), 'missingFields array');
  ok(data?.fieldLabels?.description === 'Описание', 'field labels');
}

console.log('\n=== A-API3: GET summary matches list count ===');
{
  const list = await requestJson('/api/admin/category-groups/incomplete', { headers: authHeaders() });
  const summary = await requestJson('/api/admin/category-groups/incomplete/summary', {
    headers: authHeaders(),
  });
  ok(summary.response.status === 200, 'summary 200');
  ok(summary.data?.count === list.data?.items?.length, 'count matches');
  ok(summary.data?.hasAny === true, 'hasAny true');
}

console.log('\n=== A-API4: PATCH waivers → removes from list ===');
{
  const { response, data } = await requestJson('/api/admin/category-groups/g1/completeness-waivers', {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({
      waive_description: true,
      waive_min_stock: true,
      waive_wholesale: true,
    }),
  });
  ok(response.status === 200, 'patch 200');
  ok(data?.ok === true, 'ok true');
  const after = await requestJson('/api/admin/category-groups/incomplete', { headers: authHeaders() });
  ok(after.data?.items?.length === 0, 'list empty after waivers');
}

console.log('\n=== A-API5: PATCH invalid waiver → 400 ===');
{
  const { response, data } = await requestJson('/api/admin/category-groups/g1/completeness-waivers', {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ waive_description: 'maybe' }),
  });
  ok(response.status === 400, 'status 400');
  ok(data?.error === 'invalid_waiver_value', 'error code');
}

console.log('\n=== A-API6: PATCH unknown group → 404 ===');
{
  const { response, data } = await requestJson('/api/admin/category-groups/g_404/completeness-waivers', {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ waive_description: true }),
  });
  ok(response.status === 404, 'status 404');
  ok(data?.error === 'group_not_found', 'not found');
}

console.log('\n=== R-API1: PUT group fills data → disappears from incomplete ===');
{
  resetDb();
  seedCategory();
  seedIncompleteGroup();
  const { response } = await requestJson('/api/admin/category-groups/g1', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({
      metaValue: '60 mg',
      minStockThreshold: 20,
      wholesalePrices: Object.fromEntries(
        getActiveWholesaleTiers().map((tier) => [tier.code, 15]),
      ),
    }),
  });
  ok(response.status === 200, 'put 200');
  const after = await requestJson('/api/admin/category-groups/incomplete', { headers: authHeaders() });
  ok(after.data?.items?.length === 0, 'complete after put');
}

console.log('\n=== R-API2: PUT with waive fields persists ===');
{
  resetDb();
  seedCategory();
  seedIncompleteGroup();
  await requestJson('/api/admin/category-groups/g1', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({
      waiveDescription: true,
      waiveMinStock: false,
      waiveWholesale: true,
    }),
  });
  const row = db.prepare('SELECT waive_description, waive_wholesale FROM category_groups WHERE id = ?').get('g1');
  ok(Number(row.waive_description) === 1, 'waive_description saved');
  ok(Number(row.waive_wholesale) === 1, 'waive_wholesale saved');
}

console.log('\n=== TC-API1: POST/PUT total control persists ===');
{
  resetDb();
  seedCategory();
  const created = await requestJson('/api/admin/category-groups', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ categoryId: 'c1', name: 'XROS', totalControl: true }),
  });
  ok(created.response.status === 200, 'create group 200');
  ok(Number(created.data?.total_control) === 1, 'create response has total_control=1');
  ok(Number(db.prepare('SELECT total_control FROM category_groups WHERE id = ?').get(created.data.id)?.total_control) === 1, 'total_control saved');

  const renamed = await requestJson(`/api/admin/category-groups/${created.data.id}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ name: 'XROS обновлённый' }),
  });
  ok(renamed.response.status === 200, 'partial update group 200');
  ok(Number(renamed.data?.total_control) === 1, 'partial update keeps total_control=1');

  const updated = await requestJson(`/api/admin/category-groups/${created.data.id}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ totalControl: false }),
  });
  ok(updated.response.status === 200, 'update group 200');
  ok(Number(updated.data?.total_control) === 0, 'update response has total_control=0');
}

console.log('\n=== A-API7: liquids profile flags missing strength_tier ===');
{
  resetDb();
  seedCategory('liquids');
  seedIncompleteGroup();
  fullWholesale('g1');
  await requestJson('/api/admin/category-groups/g1', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({
      metaValue: '60 mg',
      minStockThreshold: 20,
      waiveDescription: true,
      waiveMinStock: true,
      waiveWholesale: true,
    }),
  });
  const { response, data } = await requestJson('/api/admin/category-groups/incomplete', {
    headers: authHeaders(),
  });
  ok(response.status === 200, 'status 200');
  ok(data?.items?.[0]?.missingFields?.includes('strength_tier'), 'strength_tier in missingFields');
  ok(data?.fieldLabels?.strength_tier === 'Крепость (фильтр)', 'strength_tier label');
}

console.log('\n=== A-API8: PATCH waive_strength_tier clears liquids requirement ===');
{
  const { response, data } = await requestJson('/api/admin/category-groups/g1/completeness-waivers', {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ waive_strength_tier: true }),
  });
  ok(response.status === 200, 'patch 200');
  ok(data?.waivers?.waive_strength_tier === 1, 'waive_strength_tier persisted');
  const after = await requestJson('/api/admin/category-groups/incomplete', { headers: authHeaders() });
  ok(after.data?.items?.length === 0, 'list empty after strength waiver');
}

console.log('\n=== A-API9: PUT invalid strengthTier → 400 ===');
{
  resetDb();
  seedCategory('liquids');
  seedIncompleteGroup();
  const { response, data } = await requestJson('/api/admin/category-groups/g1', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ strengthTier: 'ultra_mega' }),
  });
  ok(response.status === 400, 'status 400');
  ok(data?.error === 'invalid_strength_tier', 'invalid_strength_tier error');
}

console.log('\n=== R-API3: PUT valid strengthTier completes liquids group ===');
{
  resetDb();
  seedCategory('liquids');
  seedIncompleteGroup();
  fullWholesale('g1');
  await requestJson('/api/admin/category-groups/g1', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({
      metaValue: '60 mg',
      minStockThreshold: 20,
      strengthTier: 'strong',
      waiveDescription: true,
      waiveMinStock: true,
      waiveWholesale: true,
    }),
  });
  const after = await requestJson('/api/admin/category-groups/incomplete', { headers: authHeaders() });
  ok(after.data?.items?.length === 0, 'complete after strengthTier set');
  const row = db.prepare('SELECT strength_tier FROM category_groups WHERE id = ?').get('g1');
  ok(row?.strength_tier === 'strong', 'strength_tier saved');
}

console.log('\n=== R-API4: PUT category storefrontFiltersProfile persists ===');
{
  resetDb();
  seedCategory('none');
  const { response } = await requestJson('/api/admin/categories/c1', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ storefrontFiltersProfile: 'snus_plates' }),
  });
  ok(response.status === 200, 'put category 200');
  const row = db.prepare('SELECT storefront_filters_profile FROM categories WHERE id = ?').get('c1');
  ok(row?.storefront_filters_profile === 'snus_plates', 'profile saved');
}

console.log('\n=== A-API10: PUT invalid storefrontFiltersProfile → 400 ===');
{
  const { response, data } = await requestJson('/api/admin/categories/c1', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ storefrontFiltersProfile: 'pods' }),
  });
  ok(response.status === 400, 'status 400');
  ok(data?.error === 'invalid_storefront_filters_profile', 'invalid profile error');
}

console.log(`\n=== Results: ${results.passed} passed, ${results.failed} failed ===`);

server.close();
try {
  fs.rmSync(tempDir, { recursive: true, force: true });
} catch {
  // ignore
}

if (results.failed > 0) {
  process.exit(1);
}
