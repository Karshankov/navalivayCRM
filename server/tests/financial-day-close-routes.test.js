import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

// Set the database location before importing any module with the shared db.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navalivay-financial-close-routes-'));
const databaseFile = path.join(tempDir, 'test.db');
process.env.DATABASE_FILE = databaseFile;
process.env.FINANCIAL_DAY_CLOSE_ENABLED = '0';
process.env.BUSINESS_TIMEZONE = 'Europe/Minsk';
process.env.OVERVIEW_PASSWORD_ENABLED = '1';
process.env.BOT_TOKEN = '';
process.env.STAFF_PIN_BCRYPT_ROUNDS = '4';
process.env.SESSION_SECRET = 'financial-close-route-tests-secret-at-least-32-characters';

const RealDate = globalThis.Date;
let clock = RealDate.parse('2026-10-11T09:00:00.000Z');
class TestDate extends RealDate {
  constructor(...args) { super(...(args.length ? args : [clock])); }
  static now() { return clock; }
}
globalThis.Date = TestDate;

const { db, initDb } = await import('../db.js');
assert.equal(path.resolve(process.env.DATABASE_FILE), path.resolve(databaseFile));
initDb();
const { migrateStaffManagement } = await import('../migrations/add_staff_management.js');
const { migrateInternalNotifications } = await import('../migrations/add_internal_notifications.js');
const { migrateFinancialDayClosures } = await import('../migrations/add_financial_day_closures.js');
migrateStaffManagement(db);
migrateInternalNotifications(db);
const { staffService, createStaffPinCredentials, setStaffTrackingEnabled } = await import('../utils/staff-service.js');
const { issueToken } = await import('../auth.js');
const { issueDashboardToken, revokeAllDashboardTokens } = await import('../utils/dashboard-access.js');
const { financialDayCloseRouter } = await import('../routes/financial-day-close.js');
const { crmFinanceRouter } = await import('../routes/crm-finance.js');

for (const [id, role, pin] of [['closing_employee', 'employee', '1111'], ['closing_other', 'employee', '2222'], ['closing_manager', 'manager', '3333']]) {
  const credentials = await createStaffPinCredentials(pin);
  db.prepare(`INSERT INTO employees
    (id, username, password_hash, first_name, last_name, position, active, role, pin_hash, pin_fingerprint, pin_updated_at)
    VALUES (?, ?, ?, ?, 'Тестович', 'Сотрудник', 1, ?, ?, ?, DATETIME('now'))`)
    .run(id, id, credentials.hash, id, role, credentials.hash, credentials.fingerprint);
}
db.prepare('INSERT INTO cash_accounts (id, name, balance) VALUES (?, ?, ?)').run('closing_cash', 'Тестовая касса', 255);
db.prepare('INSERT INTO cash_accounts (id, name, balance) VALUES (?, ?, ?)').run('closing_revenue', 'Тестовая выручка', 600);

function staffToken(employeeId, scope = null) {
  return staffService.issueSession(db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId),
    { scope, expiresAt: new TestDate('2099-01-01T00:00:00.000Z') }).staff_token;
}
const employeeToken = staffToken('closing_employee');
const otherToken = staffToken('closing_other');
const managerToken = staffToken('closing_manager');
const shiftToken = staffToken('closing_employee', 'shift');
const adminToken = issueToken('financial-close-test-admin');
const app = express();
app.use(express.json());
app.use(financialDayCloseRouter);
app.use(crmFinanceRouter);
const server = await new Promise((resolve) => {
  const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const BASE = '/api/admin/crm/financial-close';
let dashboardToken = issueDashboardToken().token;
const input = {
  business_date: '2026-10-11', cash_account_id: 'closing_cash', revenue_account_id: 'closing_revenue',
  terminal_cash: '0', terminal_card: '0', retained_cash: '35', coins: '35',
  counts: { 200: 1, 100: 0, 50: 0, 20: 0, 10: 0, 5: 0 },
};
const balances = () => db.prepare("SELECT id, balance FROM cash_accounts WHERE id IN ('closing_cash', 'closing_revenue') ORDER BY id").all();
const recordCounts = () => ({
  closures: db.prepare('SELECT COUNT(*) AS n FROM financial_day_closures').get().n,
  transactions: db.prepare('SELECT COUNT(*) AS n FROM cash_transactions WHERE financial_close_id IS NOT NULL').get().n,
  notifications: db.prepare('SELECT COUNT(*) AS n FROM internal_notification_outbox').get().n,
});
function activeShift(employeeId = 'closing_employee') {
  db.prepare("UPDATE staff_shifts SET status = 'closed', ended_at = ? WHERE status = 'active'").run(new TestDate().toISOString());
  db.prepare(`INSERT INTO staff_shifts
    (id, employee_id, employee_name_snapshot, business_date, planned_start_at, planned_end_at, started_at, status, created_by_employee_id, created_at, updated_at)
    VALUES (?, ?, ?, '2026-10-11', '2026-10-11T07:00:00.000Z', '2099-01-01T00:00:00.000Z', '2026-10-11T07:00:00.000Z', 'active', ?, '2026-10-11T07:00:00.000Z', '2026-10-11T07:00:00.000Z')`)
    .run(`shift_${employeeId}`, employeeId, employeeId, employeeId);
}
async function request(endpoint, { method = 'GET', body, staff = employeeToken, dashboard = dashboardToken, admin = adminToken, key, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(admin ? { Authorization: `Bearer ${admin}` } : {}),
      ...(staff ? { 'X-Staff-Token': staff } : {}),
      ...(dashboard ? { 'X-Dashboard-Token': dashboard } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}
const contextEndpoint = `${BASE}/context?cash_account_id=closing_cash&revenue_account_id=closing_revenue`;
let payload;
let savedClosure;

test('financial closing HTTP permissions, idempotency and immutable ledger', async (t) => {
  t.after(async () => {
    server.closeIdleConnections?.();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    db.close();
    globalThis.Date = RealDate;
    const resolved = path.resolve(tempDir);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('navalivay-financial-close-routes-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });

  await t.test('disabled installation authenticates first and does not query an unmigrated schema', async () => {
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'financial_day_closures'").get(), undefined);
    assert.equal((await request(contextEndpoint, { admin: null })).status, 401);
    const result = await request(contextEndpoint);
    assert.equal(result.status, 503);
    assert.equal(result.data.error, 'financial_close_disabled');
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'financial_day_closures'").get(), undefined);
  });
  migrateFinancialDayClosures(db);
  process.env.FINANCIAL_DAY_CLOSE_ENABLED = '1';
  setStaffTrackingEnabled(true);

  await t.test('all sensitive routes reject missing admin authentication', async () => {
    for (const [endpoint, method] of [[contextEndpoint, 'GET'], [`${BASE}/history`, 'GET'], [`${BASE}/history/missing`, 'GET'], [`${BASE}/preview`, 'POST'], [`${BASE}/complete`, 'POST'], [`${BASE}/history/missing/report`, 'POST']]) {
      assert.equal((await request(endpoint, { method, body: method === 'POST' ? input : undefined, admin: null })).status, 401);
    }
  });
  await t.test('tracking-enabled operations require a valid staff token', async () => {
    for (const endpoint of [contextEndpoint, `${BASE}/history`, `${BASE}/history/missing`]) {
      const result = await request(endpoint, { staff: null });
      assert.equal(result.status, 401);
      assert.equal(result.data.error, 'invalid_staff_token');
    }
    assert.equal((await request(contextEndpoint, { staff: 'invalid-staff-token' })).status, 401);
  });
  await t.test('dashboard lock protects context, history, preview, completion and report queue', async () => {
    for (const [endpoint, method, staff] of [[contextEndpoint, 'GET', employeeToken], [`${BASE}/history`, 'GET', employeeToken], [`${BASE}/history/missing`, 'GET', employeeToken], [`${BASE}/preview`, 'POST', employeeToken], [`${BASE}/complete`, 'POST', employeeToken], [`${BASE}/history/missing/report`, 'POST', managerToken]]) {
      const result = await request(endpoint, { method, staff, dashboard: null, body: method === 'POST' ? input : undefined });
      assert.equal(result.status, 403);
      assert.equal(result.data.error, 'dashboard_locked');
    }
    revokeAllDashboardTokens();
    assert.equal((await request(contextEndpoint)).data.error, 'dashboard_locked');
    dashboardToken = issueDashboardToken().token;
    assert.equal((await request(contextEndpoint)).status, 200);
  });
  await t.test('preview is read-only; employee completion requires their own active shift', async () => {
    const before = balances();
    const preview = await request(`${BASE}/preview`, { method: 'POST', body: input });
    assert.equal(preview.status, 200);
    payload = { ...input, expected_revision: preview.data.context.revision };
    const absent = await request(`${BASE}/complete`, { method: 'POST', body: payload, key: 'route_closing_key_0001' });
    assert.equal(absent.status, 409);
    assert.equal(absent.data.error, 'shift_required');
    activeShift('closing_other');
    const wrong = await request(`${BASE}/complete`, { method: 'POST', body: payload, key: 'route_closing_key_0001' });
    assert.equal(wrong.data.error, 'shift_required');
    assert.deepEqual(balances(), before);
    assert.deepEqual(recordCounts(), { closures: 0, transactions: 0, notifications: 0 });
    activeShift();
  });
  await t.test('malformed or missing idempotency keys cannot post movements', async () => {
    for (const key of [undefined, 'short']) {
      const result = await request(`${BASE}/complete`, { method: 'POST', body: payload, key });
      assert.equal(result.status, 400);
      assert.equal(result.data.error, 'closing_idempotency_key_required');
    }
    assert.equal(recordCounts().closures, 0);
  });
  await t.test('shift-token header works and successful financial closure preserves time-tracking shift and token', async () => {
    const beforeShift = db.prepare("SELECT * FROM staff_shifts WHERE id = 'shift_closing_employee'").get();
    const result = await request(`${BASE}/complete`, { method: 'POST', body: payload, staff: null, headers: { 'X-Shift-Token': shiftToken }, key: 'route_closing_key_0001' });
    assert.equal(result.status, 201);
    assert.equal(result.data.replay, false);
    savedClosure = result.data.closure;
    assert.equal(savedClosure.employee_id, 'closing_employee');
    assert.equal(savedClosure.notification_status, 'awaiting_recipient');
    assert.deepEqual(balances(), [{ id: 'closing_cash', balance: 35 }, { id: 'closing_revenue', balance: 800 }]);
    assert.deepEqual(recordCounts(), { closures: 1, transactions: 3, notifications: 0 });
    assert.deepEqual(db.prepare("SELECT * FROM staff_shifts WHERE id = 'shift_closing_employee'").get(), beforeShift);
    assert.ok(staffService.authenticateToken(shiftToken, { allowShift: true }));
  });
  await t.test('HTTP retries replay saved response; changed input, actor and duplicate date cannot write again', async () => {
    const before = balances();
    const retry = await request(`${BASE}/complete`, { method: 'POST', body: payload, key: 'route_closing_key_0001' });
    assert.equal(retry.status, 200);
    assert.equal(retry.data.replay, true);
    assert.equal(retry.data.closure.id, savedClosure.id);
    const conflict = await request(`${BASE}/complete`, { method: 'POST', body: { ...payload, retained_cash: '36' }, key: 'route_closing_key_0001' });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.data.error, 'closing_idempotency_conflict');
    const changedActor = await request(`${BASE}/complete`, { method: 'POST', body: payload, staff: managerToken, key: 'route_closing_key_0001' });
    assert.equal(changedActor.data.error, 'closing_idempotency_conflict');
    const duplicate = await request(`${BASE}/complete`, { method: 'POST', body: payload, key: 'route_closing_key_0002' });
    assert.equal(duplicate.data.error, 'financial_day_already_closed');
    assert.deepEqual(balances(), before);
    assert.deepEqual(recordCounts(), { closures: 1, transactions: 3, notifications: 0 });
  });
  await t.test('history exposes the saved report and missing reports are 404', async () => {
    const history = await request(`${BASE}/history`);
    assert.equal(history.status, 200);
    assert.equal(history.data.items[0].id, savedClosure.id);
    const detail = await request(`${BASE}/history/${savedClosure.id}`);
    assert.equal(detail.data.closure.report_text, savedClosure.report_text);
    assert.equal((await request(`${BASE}/history/missing`)).status, 404);
  });
  await t.test('every closure movement rejects manual PATCH and DELETE without changing balances or history', async () => {
    const before = balances();
    const rows = db.prepare('SELECT * FROM cash_transactions WHERE financial_close_id = ? ORDER BY id').all(savedClosure.id);
    for (const row of rows) {
      for (const method of ['PATCH', 'DELETE']) {
        const result = await request(`/api/admin/crm/cash-transactions/${row.id}`, { method, body: method === 'PATCH' ? { amount: 1, description: 'tamper' } : undefined });
        assert.equal(result.status, 409);
        assert.equal(result.data.error, 'linked_financial_close');
      }
    }
    assert.deepEqual(db.prepare('SELECT * FROM cash_transactions WHERE financial_close_id = ? ORDER BY id').all(savedClosure.id), rows);
    assert.deepEqual(balances(), before);
    assert.equal((await request(`${BASE}/history/${savedClosure.id}`)).data.closure.report_text, savedClosure.report_text);
  });
  await t.test('manual report queue is manager-only and queues a saved report once when configured', async () => {
    const endpoint = `${BASE}/history/${savedClosure.id}/report`;
    const denied = await request(endpoint, { method: 'POST' });
    assert.equal(denied.status, 403);
    assert.equal(denied.data.error, 'manager_access_required');
    assert.equal((await request(endpoint, { method: 'POST', staff: managerToken })).data.closure.notification_status, 'awaiting_recipient');
    db.prepare("UPDATE internal_notification_settings SET enabled = 1 WHERE event_group = 'financial_close'").run();
    db.prepare(`INSERT INTO internal_notification_recipients (event_group, telegram_id, telegram_username, display_name, confirmed_at)
      VALUES ('financial_close', '123456789', 'owner_test', 'Test owner', ?)`)
      .run(new TestDate().toISOString());
    assert.equal((await request(endpoint, { method: 'POST', staff: managerToken })).data.closure.notification_status, 'pending');
    await request(endpoint, { method: 'POST', staff: managerToken });
    assert.equal(recordCounts().notifications, 1);
    const queued = db.prepare('SELECT * FROM internal_notification_outbox').get();
    assert.equal(JSON.parse(queued.payload_json).text, savedClosure.report_text);
    assert.equal((await request(`${BASE}/history/missing/report`, { method: 'POST', staff: managerToken })).status, 404);
  });
  await t.test('deactivated employees, revoked sessions and downgraded managers lose access', async () => {
    db.prepare("UPDATE employees SET active = 0 WHERE id = 'closing_other'").run();
    assert.equal((await request(contextEndpoint, { staff: otherToken })).status, 401);
    db.prepare("UPDATE employees SET active = 1 WHERE id = 'closing_other'").run();
    staffService.revokeSessions('closing_other');
    assert.equal((await request(contextEndpoint, { staff: otherToken })).status, 401);
    db.prepare("UPDATE employees SET role = 'employee' WHERE id = 'closing_manager'").run();
    assert.equal((await request(`${BASE}/history/${savedClosure.id}/report`, { method: 'POST', staff: managerToken })).status, 403);
    db.prepare("UPDATE employees SET role = 'manager' WHERE id = 'closing_manager'").run();
    db.prepare("UPDATE staff_sessions SET expires_at = '2020-01-01T00:00:00.000Z' WHERE employee_id = 'closing_other'").run();
    assert.equal((await request(contextEndpoint, { staff: otherToken })).status, 401);
  });
  await t.test('manager may close the next day without a staff shift; carryover is not profit', async () => {
    db.prepare("UPDATE staff_shifts SET status = 'closed', ended_at = ? WHERE status = 'active'").run(new TestDate().toISOString());
    clock = RealDate.parse('2026-10-12T09:00:00.000Z');
    dashboardToken = issueDashboardToken().token;
    const next = { ...input, business_date: '2026-10-12', coins: '0', counts: { 200: 0, 100: 0, 50: 0, 20: 1, 10: 1, 5: 1 } };
    const preview = await request(`${BASE}/preview`, { method: 'POST', body: next, staff: managerToken });
    assert.equal(preview.status, 200);
    assert.equal(preview.data.context.profit_minor, 0);
    const result = await request(`${BASE}/complete`, { method: 'POST', body: { ...next, expected_revision: preview.data.context.revision }, staff: managerToken, key: 'route_manager_key_0003' });
    assert.equal(result.status, 201);
    assert.equal(result.data.closure.employee_id, 'closing_manager');
    assert.equal(recordCounts().closures, 2);
    assert.equal(recordCounts().transactions, 3);
  });
  await t.test('tracking-disabled admin still needs dashboard access and can close an empty subsequent day', async () => {
    setStaffTrackingEnabled(false);
    assert.equal((await request(contextEndpoint, { staff: null, dashboard: null })).data.error, 'dashboard_locked');
    assert.equal((await request(contextEndpoint, { staff: null })).status, 200);
    clock = RealDate.parse('2026-10-13T18:00:00.000Z');
    const next = { ...input, business_date: '2026-10-13', coins: '0', counts: { 200: 0, 100: 0, 50: 0, 20: 1, 10: 1, 5: 1 } };
    const preview = await request(`${BASE}/preview`, { method: 'POST', body: next, staff: null, dashboard: null });
    assert.equal(preview.status, 200);
    const result = await request(`${BASE}/complete`, { method: 'POST', body: { ...next, expected_revision: preview.data.context.revision }, staff: null, dashboard: null, key: 'route_admin_key_0004' });
    assert.equal(result.status, 201);
    assert.equal(result.data.closure.employee_id, null);
    assert.equal(result.data.closure.actor_username, 'financial-close-test-admin');
    assert.equal(recordCounts().closures, 3);
    assert.equal(recordCounts().transactions, 3);
  });
});
