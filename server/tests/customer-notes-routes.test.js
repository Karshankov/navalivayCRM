/**
 * Customer notes — HTTP API adversarial + regression tests.
 * Запуск: node server/tests/customer-notes-routes.test.js
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navalivay-customer-notes-routes-'));
const tempDbPath = path.join(tempDir, 'test.db');

process.env.DATABASE_FILE = tempDbPath;
process.env.BOT_TOKEN = '';
process.env.BUSINESS_TIMEZONE = 'Europe/Minsk';

const { initDb, db } = await import('../db.js');
const { issueToken } = await import('../auth.js');
const { crmRouter } = await import('../routes/crm.js');
const { MAX_CUSTOMER_NOTE_LENGTH } = await import('../utils/customer-notes.js');
const { enrichOrdersWithRelations, fetchOrderRowsByIds } = await import('../utils/crm-order-enrichment.js');

initDb();

const app = express();
app.use(express.json());
app.use(crmRouter);

const server = await new Promise((resolve) => {
  const instance = app.listen(0, () => resolve(instance));
});

const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;
const authToken = issueToken('crm-admin');

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

function resetDb() {
  db.exec('DELETE FROM pending_customer_notes;');
  db.exec('DELETE FROM orders;');
  db.exec('DELETE FROM order_items;');
  db.exec('DELETE FROM customers;');
}

function insertCustomer({ id, telegram_id, telegram_username, notes = null }) {
  db.prepare(
    `INSERT INTO customers (id, telegram_id, telegram_username, notes, first_visit_at, total_orders, total_spent)
     VALUES (?, ?, ?, ?, DATETIME('now'), 0, 0)`,
  ).run(id, telegram_id, telegram_username || null, notes);
}

let orderSeq = 5000;
function insertOrder({ id, customer_id, status = 'new' }) {
  orderSeq += 1;
  db.prepare(
    `INSERT INTO orders (id, order_number, customer_id, status, archived, needs_manager_action, total_amount, final_amount, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, 0, 10, 10, '2026-06-10 10:00:00', '2026-06-10 10:00:00')`,
  ).run(id, orderSeq, customer_id, status);
}

const results = { passed: 0, failed: 0 };
function ok(cond, msg) {
  if (cond) {
    results.passed += 1;
    console.log(`  OK: ${msg}`);
  } else {
    results.failed += 1;
    console.log(`  FAIL: ${msg}`);
  }
}

resetDb();

console.log('\n=== A-API1: PUT without auth → 401 ===');
{
  const { response } = await requestJson('/api/admin/crm/customer-notes', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ telegram_username: 'x', notes: 'y' }),
  });
  ok(response.status === 401, 'status 401');
}

console.log('\n=== A-API2: GET pending without auth → 401 ===');
{
  const { response } = await requestJson('/api/admin/crm/customer-notes/pending');
  ok(response.status === 401, 'status 401');
}

console.log('\n=== A-API3: DELETE without auth → 401 ===');
{
  const { response } = await requestJson('/api/admin/crm/customer-notes', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pending_id: 1 }),
  });
  ok(response.status === 401, 'status 401');
}

console.log('\n=== A-API4: PUT missing identifiers → 400 ===');
{
  const { response, data } = await requestJson('/api/admin/crm/customer-notes', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ notes: 'x' }),
  });
  ok(response.status === 400, 'status 400');
  ok(data?.error === 'customer_id_or_telegram_username_required', 'error code');
}

console.log('\n=== A-API5: DELETE missing identifiers → 400 ===');
{
  const { response, data } = await requestJson('/api/admin/crm/customer-notes', {
    method: 'DELETE',
    headers: authHeaders(),
    body: JSON.stringify({}),
  });
  ok(response.status === 400, 'status 400');
  ok(
    data?.error === 'customer_id_or_telegram_username_or_pending_id_required',
    'error code',
  );
}

console.log('\n=== A-API6: PUT note too long → 400 ===');
{
  const { response, data } = await requestJson('/api/admin/crm/customer-notes', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({
      telegram_username: 'long_note_user',
      notes: 'z'.repeat(MAX_CUSTOMER_NOTE_LENGTH + 1),
    }),
  });
  ok(response.status === 400, 'status 400');
  ok(data?.error === 'note_too_long', 'error code');
}

console.log('\n=== A-API7: PUT invalid username → 400 ===');
{
  const { response, data } = await requestJson('/api/admin/crm/customer-notes', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ telegram_username: 'bad name!', notes: 'x' }),
  });
  ok(response.status === 400, 'status 400');
  ok(data?.error === 'invalid_telegram_username', 'error code');
}

console.log('\n=== A-API8: PUT unknown customer_id → 404 ===');
{
  const { response, data } = await requestJson('/api/admin/crm/customer-notes', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ customer_id: 'missing_customer', notes: 'x' }),
  });
  ok(response.status === 404, 'status 404');
  ok(data?.error === 'customer_not_found', 'error code');
}

console.log('\n=== A-API9: DELETE unknown pending_id → 404 ===');
{
  const { response, data } = await requestJson('/api/admin/crm/customer-notes', {
    method: 'DELETE',
    headers: authHeaders(),
    body: JSON.stringify({ pending_id: 999999 }),
  });
  ok(response.status === 404, 'status 404');
  ok(data?.error === 'not_found', 'error code');
}

console.log('\n=== A-API10: SQL injection username rejected ===');
{
  const { response, data } = await requestJson('/api/admin/crm/customer-notes', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({
      telegram_username: "' OR 1=1 --",
      notes: 'inject',
    }),
  });
  ok(response.status === 400, 'status 400');
  ok(data?.error === 'invalid_telegram_username', 'rejected');
  const count = db.prepare('SELECT COUNT(*) AS n FROM pending_customer_notes').get().n;
  ok(count === 0, 'no row inserted');
}

console.log('\n=== A-API11: numeric notes coerced ===');
resetDb();
insertCustomer({ id: 'c_num', telegram_id: '1', telegram_username: 'num_user' });
{
  const { response, data } = await requestJson('/api/admin/crm/customer-notes', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ customer_id: 'c_num', notes: 12345 }),
  });
  ok(response.status === 200, 'status 200');
  ok(data?.notes === '12345', 'coerced to string');
}

console.log('\n=== A-API12: whitespace notes clear active customer ===');
resetDb();
insertCustomer({ id: 'c_ws', telegram_id: '2', telegram_username: 'ws_user', notes: 'Было' });
{
  const { response, data } = await requestJson('/api/admin/crm/customer-notes', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ customer_id: 'c_ws', notes: '   ' }),
  });
  ok(response.status === 200, 'status 200');
  ok(data?.notes === null, 'cleared');
}

console.log('\n=== R-API1: PUT pending by username ===');
resetDb();
{
  const { response, data } = await requestJson('/api/admin/crm/customer-notes', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ telegram_username: 'pending_api', notes: 'Ждём' }),
  });
  ok(response.status === 200, 'status 200');
  ok(data?.ok === true, 'ok flag');
  ok(data?.kind === 'pending', 'kind pending');
  ok(data?.pending?.telegram_username === 'pending_api', 'username');
  ok(data?.pending?.notes === 'Ждём', 'notes');
  ok(typeof data?.pending?.id === 'number', 'pending id number');
}

console.log('\n=== R-API2: PUT active by customer_id ===');
insertCustomer({ id: 'c_api', telegram_id: '3', telegram_username: 'api_user' });
{
  const { response, data } = await requestJson('/api/admin/crm/customer-notes', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ customer_id: 'c_api', notes: 'Активная' }),
  });
  ok(response.status === 200, 'status 200');
  ok(data?.kind === 'active', 'kind active');
  ok(data?.customer?.notes === 'Активная', 'customer notes');
}

console.log('\n=== R-API3: GET pending list ===');
{
  const { response, data } = await requestJson('/api/admin/crm/customer-notes/pending?limit=10', {
    headers: authHeaders(),
  });
  ok(response.status === 200, 'status 200');
  ok(Array.isArray(data?.pending), 'pending array');
  ok(
    data.pending.some((row) => String(row.telegram_username).toLowerCase() === 'pending_api'),
    'includes pending',
  );
}

console.log('\n=== R-API4: DELETE clears active note ===');
resetDb();
insertCustomer({ id: 'c_del', telegram_id: '4', telegram_username: 'del_user', notes: 'Удалить' });
{
  const { response, data } = await requestJson('/api/admin/crm/customer-notes', {
    method: 'DELETE',
    headers: authHeaders(),
    body: JSON.stringify({ customer_id: 'c_del' }),
  });
  ok(response.status === 200, 'status 200');
  ok(data?.kind === 'active', 'kind active');
  ok(data?.notes === null, 'notes cleared');
}

console.log('\n=== R-API5: DELETE pending by pending_id ===');
resetDb();
{
  const created = await requestJson('/api/admin/crm/customer-notes', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ telegram_username: 'to_delete', notes: 'x' }),
  });
  const pendingId = created.data?.pending?.id;
  const { response, data } = await requestJson('/api/admin/crm/customer-notes', {
    method: 'DELETE',
    headers: authHeaders(),
    body: JSON.stringify({ pending_id: pendingId }),
  });
  ok(response.status === 200, 'status 200');
  ok(data?.kind === 'pending_removed', 'removed');
  ok(data?.removed === true, 'removed flag');
}

console.log('\n=== R-API6: kanban enrichment reflects API update ===');
resetDb();
insertCustomer({ id: 'c_enr', telegram_id: '5', telegram_username: 'enr_user' });
insertOrder({ id: 'o_enr', customer_id: 'c_enr', status: 'new' });
{
  await requestJson('/api/admin/crm/customer-notes', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ customer_id: 'c_enr', notes: 'Через API' }),
  });
  const rows = fetchOrderRowsByIds(db, ['o_enr']);
  const enriched = enrichOrdersWithRelations(db, rows);
  ok(enriched[0]?.customer_notes === 'Через API', 'customer_notes on order');
}

console.log('\n=== R-API7: pending_cleared for unknown username ===');
resetDb();
{
  const { response, data } = await requestJson('/api/admin/crm/customer-notes', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ telegram_username: 'ghost_user', notes: '   ' }),
  });
  ok(response.status === 200, 'status 200');
  ok(data?.kind === 'pending_cleared', 'pending_cleared');
}

console.log('\n=== R-API8: @username normalized via API ===');
resetDb();
insertCustomer({ id: 'c_norm', telegram_id: '6', telegram_username: 'norm_user' });
{
  const { response, data } = await requestJson('/api/admin/crm/customer-notes', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ telegram_username: '@NORM_USER', notes: 'Норм' }),
  });
  ok(response.status === 200, 'status 200');
  ok(data?.kind === 'active', 'resolved to active');
  ok(data?.customer?.id === 'c_norm', 'matched customer');
}

server.close();
try {
  db.close();
} catch {}
for (const file of [tempDbPath, `${tempDbPath}-shm`, `${tempDbPath}-wal`]) {
  try {
    fs.unlinkSync(file);
  } catch {}
}
try {
  fs.rmdirSync(tempDir);
} catch {}

console.log(`\n=== customer-notes-routes: ${results.passed} passed, ${results.failed} failed ===`);
if (results.failed > 0) process.exit(1);