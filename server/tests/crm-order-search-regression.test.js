import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TMP_DB = path.resolve(__dirname, `./.tmp-crm-order-search-${Date.now()}.db`);
process.env.DATABASE_FILE = TMP_DB;
process.env.BOT_TOKEN = '*********************';

const { db, initDb } = await import('../db.js');
const { buildCrmOrdersSearch } = await import('../utils/crm-order-search.js');
const { enrichOrdersWithRelations } = await import('../utils/crm-order-enrichment.js');
const express = (await import('express')).default;
const { issueToken } = await import('../auth.js');
const { crmOperationsRouter } = await import('../routes/crm-operations.js');
initDb();

const app = express();
app.use(crmOperationsRouter);
const server = await new Promise((resolve) => {
  const instance = app.listen(0, () => resolve(instance));
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const authToken = issueToken('search-regression-admin');

const results = { passed: 0, failed: 0 };
function assertEq(actual, expected, msg) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    results.passed++;
    console.log(`  OK: ${msg}`);
  } else {
    results.failed++;
    console.log(`  FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function assert(condition, msg, details = '') {
  if (condition) {
    results.passed++;
    console.log(`  OK: ${msg}`);
  } else {
    results.failed++;
    console.log(`  FAIL: ${msg}${details ? ` — ${details}` : ''}`);
  }
}

console.log('\n=== Numeric CRM search uses indexed prefix mode ===');
{
  const spec = buildCrmOrdersSearch({ searchTerm: '1001' });
  assertEq(spec.mode, 'order_number_prefix', 'numeric term switches to prefix search mode');
  assertEq(spec.params, ['1001%'], 'numeric search uses indexed prefix pattern');
  assertEq(spec.orderByParams, ['1001'], 'exact numeric match is ranked first');
}

console.log('\n=== # explicitly means permanent order number ===');
{
  const spec = buildCrmOrdersSearch({ searchTerm: '#1001', pickupCellCapacity: 50 });
  assertEq(spec.mode, 'order_number_prefix', '#order bypasses cell-number mode');
  assertEq(spec.params, ['1001%'], '# is removed before indexed order search');
  assertEq(spec.orderByParams, ['1001'], 'normalized exact order number is ranked first');

  const shortSpec = buildCrmOrdersSearch({ searchTerm: '# 7', pickupCellCapacity: 50 });
  assertEq(shortSpec.mode, 'order_number_prefix', '# with optional space still means order');
  assertEq(shortSpec.params, ['7%'], 'short #order is not mistaken for cell 7');
}

console.log('\n=== Legacy text CRM search is preserved ===');
{
  const spec = buildCrmOrdersSearch({ searchTerm: 'tester' });
  assertEq(spec.mode, 'legacy', 'text search keeps legacy behavior');
  assertEq(spec.params.length, 5, 'legacy search still searches across five fields');
}

db.exec(`DELETE FROM orders; DELETE FROM customers;`);
db.prepare(`INSERT INTO customers (id, telegram_id, telegram_username, first_name, last_name, notes) VALUES ('c1', '101', 'alpha_user', 'Alpha', 'One', 'Заметка клиента')`).run();
db.prepare(`INSERT INTO customers (id, telegram_id, telegram_username, first_name, last_name) VALUES ('c2', '202', 'beta_user', 'Beta', 'Two')`).run();
db.prepare(`INSERT INTO orders (id, order_number, customer_id, status, archived, total_amount, created_at, updated_at) VALUES ('o_exact', 1001, 'c1', 'new', 0, 10, '2026-06-01 10:00:00', '2026-06-01 10:00:00')`).run();
db.prepare(`INSERT INTO orders (id, order_number, customer_id, status, archived, total_amount, created_at, updated_at) VALUES ('o_prefix', 10012, 'c2', 'new', 0, 20, '2026-06-01 11:00:00', '2026-06-01 11:00:00')`).run();
db.prepare(`INSERT INTO orders (id, order_number, customer_id, status, archived, total_amount, created_at, updated_at) VALUES ('o_other', 9001, 'c2', 'new', 0, 30, '2026-06-01 12:00:00', '2026-06-01 12:00:00')`).run();
db.prepare(`INSERT INTO order_pickup_cell_assignments (id, order_id, cell_number) VALUES ('cell_9', 'o_exact', 9)`).run();

console.log('\n=== Search and regular list SQL payload include customer notes ===');
{
  const spec = buildCrmOrdersSearch({ searchTerm: '1001' });
  const whereClauses = ['o.archived = 0', spec.whereClause];
  const params = [...spec.params];
  const rows = db.prepare(`
    SELECT o.*, c.notes AS customer_notes
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY ${spec.orderBy}
  `).all(...params, ...spec.orderByParams);
  const enriched = enrichOrdersWithRelations(db, rows);
  assertEq(enriched.find((row) => row.id === 'o_exact')?.customer_notes, 'Заметка клиента', 'search result carries linked customer note');
}

console.log('\n=== Search and regular list API include customer notes and cell 9 ===');
{
  const headers = { Authorization: `Bearer ${authToken}` };
  const searchResponse = await fetch(`${baseUrl}/api/admin/crm/orders?search=1001`, { headers });
  const searchPayload = await searchResponse.json();
  assertEq(searchResponse.status, 200, 'search endpoint succeeds');
  assertEq(searchPayload.orders.find((row) => row.id === 'o_exact')?.customer_notes, 'Заметка клиента', 'search result carries linked customer note');
  assertEq(searchPayload.orders.find((row) => row.id === 'o_exact')?.pickup_cell_number, 9, 'search result includes active cell number');

  const cellResponse = await fetch(`${baseUrl}/api/admin/crm/orders?search=9`, { headers });
  const cellPayload = await cellResponse.json();
  assertEq(cellResponse.status, 200, 'cell search endpoint succeeds');
  assertEq(cellPayload.orders.find((row) => row.id === 'o_exact')?.pickup_cell_number, 9, 'cell search result includes cell 9');
  assertEq(cellPayload.orders.find((row) => row.id === 'o_exact')?.customer_notes, 'Заметка клиента', 'cell search result keeps blue customer note');

  const regularResponse = await fetch(`${baseUrl}/api/admin/crm/orders`, { headers });
  const regularPayload = await regularResponse.json();
  assertEq(regularResponse.status, 200, 'regular endpoint succeeds');
  assertEq(regularPayload.orders.find((row) => row.id === 'o_exact')?.customer_notes, 'Заметка клиента', 'regular result carries linked customer note');
}


console.log('\n=== Adversarial: numeric search query plan uses dedicated index ===');
{
  const planRows = db.prepare(`
    EXPLAIN QUERY PLAN
    SELECT o.id
    FROM orders o
    WHERE o.archived = 0
      AND o.order_number_search LIKE '1001%'
    ORDER BY CASE WHEN o.order_number_search = '1001' THEN 0 ELSE 1 END, o.created_at DESC
    LIMIT 200 OFFSET 0
  `).all();
  const planText = planRows.map((row) => Object.values(row).join('|')).join('\n');
  assert(planText.includes('idx_orders_archived_order_number_search'), 'numeric search uses order_number_search index', planText);
}

console.log('\n=== Adversarial: exact numeric match is ranked before longer prefix matches ===');
{
  const spec = buildCrmOrdersSearch({ searchTerm: '1001' });
  const rows = db.prepare(`
    SELECT o.id
    FROM orders o
    WHERE o.archived = 0
      AND ${spec.whereClause}
    ORDER BY ${spec.orderBy}
    LIMIT 200 OFFSET 0
  `).all(...spec.params, ...spec.orderByParams);
  assertEq(rows.map((row) => row.id), ['o_exact', 'o_prefix'], 'exact order number comes before prefix-only matches');
}

console.log('\n=== Legacy text search still finds username matches ===');
{
  const spec = buildCrmOrdersSearch({ searchTerm: 'beta_' });
  const rows = db.prepare(`
    SELECT o.id
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.archived = 0
      AND ${spec.whereClause}
    ORDER BY ${spec.orderBy}
    LIMIT 200 OFFSET 0
  `).all(...spec.params, ...spec.orderByParams);
  assertEq(rows.map((row) => row.id), ['o_other', 'o_prefix'], 'legacy search behavior is preserved for non-numeric text');
}

try {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
} finally {
  try {
    db.close();
  } catch {
    /* noop */
  }
}
for (const file of [TMP_DB, `${TMP_DB}-shm`, `${TMP_DB}-wal`]) {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    /* noop */
  }
}

if (results.failed > 0) {
  console.log(`\nFAILED: ${results.failed} failed, ${results.passed} passed`);
  process.exit(1);
}
console.log(`\nPASSED: ${results.passed} assertions`);
