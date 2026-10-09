import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import bcrypt from 'bcryptjs';
import express from 'express';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navalivay-staff-'));
const databaseFile = path.join(tempDir, 'staff.db');
const adminConfigFile = path.join(tempDir, 'admin.json');
const adminPassword = 'main-admin-password';

process.env.DATABASE_FILE = databaseFile;
process.env.ADMIN_CONFIG = adminConfigFile;
process.env.SESSION_SECRET = 'staff-test-session-secret-with-more-than-thirty-two-characters';
process.env.STAFF_PIN_PEPPER = 'staff-test-pin-pepper-with-more-than-thirty-two-characters';
process.env.STAFF_PIN_BCRYPT_ROUNDS = '4';
process.env.BOT_TOKEN = '';
process.env.NODE_ENV = 'test';

fs.writeFileSync(
  adminConfigFile,
  JSON.stringify({
    username: 'admin',
    passwordHash: bcrypt.hashSync(adminPassword, 4),
  }),
);

const { db, initDb } = await import('../db.js');
const { issueToken } = await import('../auth.js');
const { migrateStaffManagement } = await import('../migrations/add_staff_management.js');
const { migrateInternalNotifications } = await import('../migrations/add_internal_notifications.js');
const { createStaffService } = await import('../utils/staff-service.js');

initDb();
migrateStaffManagement(db);
migrateStaffManagement(db);
migrateInternalNotifications(db);

const { staffRouter } = await import('../routes/staff.js');

const app = express();
app.use(express.json());
app.use(staffRouter);

const server = await new Promise((resolve) => {
  const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const adminToken = issueToken('staff-test-admin');

async function requestJson(url, {
  method = 'GET',
  body,
  staffToken,
  shiftToken,
  idempotencyKey,
  headers = {},
} = {}) {
  const response = await fetch(`${baseUrl}${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
      ...(staffToken ? { 'X-Staff-Token': staffToken } : {}),
      ...(shiftToken ? { 'X-Shift-Token': shiftToken } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  return { response, data };
}

function assertStatus(result, expected, label) {
  assert.equal(
    result.response.status,
    expected,
    `${label}: ${result.response.status} ${JSON.stringify(result.data)}`,
  );
}

try {
  assert.equal(
    db.prepare("SELECT value FROM settings WHERE key = 'staff_tracking_enabled'").get().value,
    'false',
    'tracking must be disabled by default',
  );

  const integrationColumns = new Set(
    db.prepare("PRAGMA table_info('orders')").all().map((row) => row.name),
  );
  assert.ok(integrationColumns.has('assembled_by_employee_id'));
  assert.ok(integrationColumns.has('assembled_at'));
  assert.ok(integrationColumns.has('issued_by_employee_id'));
  assert.ok(integrationColumns.has('issued_at'));
  const transferColumns = new Set(
    db.prepare("PRAGMA table_info('stock_transfers')").all().map((row) => row.name),
  );
  assert.ok(transferColumns.has('created_by_employee_id'));
  assert.ok(transferColumns.has('completed_by_employee_id'));
  assert.ok(transferColumns.has('cancelled_by_employee_id'));

  const badBootstrap = await requestJson('/api/admin/crm/staff/bootstrap-manager', {
    method: 'POST',
    body: {
      admin_password: 'wrong',
      first_name: 'Мария',
      new_pin: '1200',
    },
  });
  assertStatus(badBootstrap, 401, 'bootstrap requires main password');

  const bootstrapAttempts = await Promise.all([
    requestJson('/api/admin/crm/staff/bootstrap-manager', {
      method: 'POST',
      body: {
        admin_password: adminPassword,
        first_name: 'Мария',
        last_name: '',
        position: 'Руководитель',
        color: '#2244AA',
        responsibilities: ['Управление командой'],
        new_pin: '1200',
      },
    }),
    requestJson('/api/admin/crm/staff/bootstrap-manager', {
      method: 'POST',
      body: {
        admin_password: adminPassword,
        first_name: 'Дубль',
        last_name: 'Руководителя',
        position: 'Руководитель',
        new_pin: '1299',
      },
    }),
  ]);
  assert.deepEqual(
    bootstrapAttempts.map((result) => result.response.status).sort(),
    [201, 409],
    'only one concurrent manager bootstrap may succeed',
  );
  const bootstrap = bootstrapAttempts.find(
    (result) => result.response.status === 201,
  );
  const rejectedBootstrap = bootstrapAttempts.find(
    (result) => result.response.status === 409,
  );
  assert.ok(bootstrap, 'successful manager bootstrap response is present');
  assert.equal(
    rejectedBootstrap?.data?.error,
    'manager_already_bootstrapped',
    'losing bootstrap must fail because a manager already exists',
  );
  assert.equal(
    db.prepare(`
      SELECT COUNT(*) AS count
      FROM employees
      WHERE role = 'manager' AND active = 1 AND deactivated_at IS NULL
    `).get().count,
    1,
    'concurrent bootstrap creates exactly one manager',
  );
  assert.equal(
    db.prepare(`
      SELECT COUNT(*) AS count
      FROM employees
      WHERE first_name IN ('Мария', 'Дубль')
    `).get().count,
    1,
    'losing bootstrap must not create a second employee',
  );
  const managerId = bootstrap.data.employee.id;
  const managerPin = bootstrap.data.employee.first_name === 'Мария'
    ? '1200'
    : '1299';
  assert.equal(bootstrap.data.employee.role, 'manager');
  assert.equal(bootstrap.data.tracking_enabled, false);

  const recoveryCandidatesWrongPassword = await requestJson(
    '/api/admin/crm/staff/recovery-manager/candidates',
    {
      method: 'POST',
      body: { admin_password: 'wrong' },
    },
  );
  assertStatus(
    recoveryCandidatesWrongPassword,
    401,
    'manager recovery candidates require main password',
  );
  const recoveryCandidates = await requestJson(
    '/api/admin/crm/staff/recovery-manager/candidates',
    {
      method: 'POST',
      body: { admin_password: adminPassword },
    },
  );
  assertStatus(recoveryCandidates, 200, 'list manager recovery candidates');
  assert.deepEqual(
    recoveryCandidates.data.employees.map((employee) => employee.id),
    [managerId],
  );
  assert.equal('pin_hash' in recoveryCandidates.data.employees[0], false);
  assert.equal('pin_fingerprint' in recoveryCandidates.data.employees[0], false);

  const managerAccessWhileDisabled = await requestJson('/api/admin/crm/staff/access', {
    method: 'POST',
    body: { pin: managerPin },
  });
  assertStatus(managerAccessWhileDisabled, 200, 'manager can access setup while disabled');
  let managerToken = managerAccessWhileDisabled.data.staff_token;
  assert.equal(managerAccessWhileDisabled.data.identity.id, managerId);
  assert.ok(managerToken.length >= 32);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM staff_sessions WHERE token_hash = ?')
      .get(managerToken).count,
    0,
    'raw staff token must not be stored',
  );

  const enableTracking = await requestJson('/api/admin/crm/staff/settings/tracking', {
    method: 'PUT',
    staffToken: managerToken,
    body: { enabled: true },
  });
  assertStatus(enableTracking, 200, 'enable tracking');
  assert.equal(enableTracking.data.enabled, true);
  assert.equal(
    enableTracking.response.headers.get('cache-control'),
    'no-store, max-age=0',
  );

  // Отдельной ручки ограничения больше нет: смена обязательна, пока учёт включён.
  const removedRestrictionRoute = await requestJson(
    '/api/admin/crm/staff/settings/order-shift-restriction',
    { staffToken: managerToken },
  );
  assertStatus(removedRestrictionRoute, 404, 'order restriction route is gone');

  db.prepare(`
    INSERT INTO employees (
      id, username, password_hash, first_name, last_name, position, active
    ) VALUES (?, ?, ?, ?, ?, ?, 1)
  `).run(
    'legacy_without_pin',
    'legacy-without-pin',
    'legacy-password-hash',
    'Старый',
    'Сотрудник',
    'Продавец',
  );
  // Учёт делает смену обязательной, поэтому включать его без ПИН у всех нельзя:
  // иначе магазин остался бы в режиме чтения.
  await requestJson('/api/admin/crm/staff/settings/tracking', {
    method: 'PUT',
    staffToken: managerToken,
    body: { enabled: false },
  });
  const blockedTracking = await requestJson(
    '/api/admin/crm/staff/settings/tracking',
    {
      method: 'PUT',
      staffToken: managerToken,
      body: { enabled: true },
    },
  );
  assertStatus(
    blockedTracking,
    409,
    'tracking waits until every active employee has a pin',
  );
  assert.equal(blockedTracking.data.error, 'staff_pins_required');
  db.prepare(`
    UPDATE employees
    SET active = 0, deactivated_at = DATETIME('now')
    WHERE id = 'legacy_without_pin'
  `).run();

  const enableTrackingAgain = await requestJson(
    '/api/admin/crm/staff/settings/tracking',
    {
      method: 'PUT',
      staffToken: managerToken,
      body: { enabled: true },
    },
  );
  assertStatus(enableTrackingAgain, 200, 'tracking turns on once pins are ready');
  assert.equal(enableTrackingAgain.data.enabled, true);

  const blockedLegacyRestore = await requestJson(
    '/api/admin/crm/staff/employees/legacy_without_pin/restore',
    {
      method: 'POST',
      staffToken: managerToken,
      body: {},
    },
  );
  assertStatus(
    blockedLegacyRestore,
    409,
    'restore without a pin is blocked while tracking is on',
  );
  assert.equal(blockedLegacyRestore.data.error, 'staff_pins_required');

  const restoredLegacyEmployee = await requestJson(
    '/api/admin/crm/staff/employees/legacy_without_pin/restore',
    {
      method: 'POST',
      staffToken: managerToken,
      body: { new_pin: '7812' },
    },
  );
  assertStatus(
    restoredLegacyEmployee,
    200,
    'restore accepts a new pin in the same request',
  );
  assert.equal(restoredLegacyEmployee.data.employee.active, true);
  assert.equal(restoredLegacyEmployee.data.employee.pin_configured, true);
  db.prepare(`
    UPDATE employees
    SET active = 0, deactivated_at = DATETIME('now')
    WHERE id = 'legacy_without_pin'
  `).run();

  const malformedAccess = await requestJson('/api/admin/crm/staff/access', {
    method: 'POST',
    body: { pin: '12' },
  });
  const wrongAccess = await requestJson('/api/admin/crm/staff/access', {
    method: 'POST',
    body: { pin: '9999' },
  });
  assertStatus(malformedAccess, 401, 'malformed pin is generic');
  assertStatus(wrongAccess, 401, 'wrong pin is generic');
  assert.deepEqual(malformedAccess.data, wrongAccess.data);

  const employeeCreate = await requestJson('/api/admin/crm/staff/employees', {
    method: 'POST',
    staffToken: managerToken,
    body: {
      first_name: 'Алексей',
      last_name: 'Иванов',
      position: 'Продавец',
      color: '#22AA66',
      responsibilities: ['Сборка заказов', 'Выдача заказов'],
      pin: '3412',
    },
  });
  assertStatus(employeeCreate, 201, 'create employee without legacy password');
  const employeeId = employeeCreate.data.employee.id;
  const rawEmployee = db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);
  assert.ok(rawEmployee.username.startsWith('staff_'));
  assert.notEqual(rawEmployee.pin_hash, '3412');
  assert.notEqual(rawEmployee.pin_fingerprint, '3412');
  assert.ok(rawEmployee.password_hash.startsWith('$2'));

  const validAvatar = await requestJson(
    `/api/admin/crm/staff/employees/${employeeId}`,
    {
      method: 'PATCH',
      staffToken: managerToken,
      body: { avatar_url: '/uploads/staff/test-avatar.png' },
    },
  );
  assertStatus(validAvatar, 200, 'local staff avatar is accepted');
  const externalAvatar = await requestJson(
    `/api/admin/crm/staff/employees/${employeeId}`,
    {
      method: 'PATCH',
      staffToken: managerToken,
      body: { avatar_url: 'https://attacker.example/avatar.png' },
    },
  );
  assertStatus(externalAvatar, 400, 'external staff avatar is rejected');
  assert.equal(
    db.prepare('SELECT avatar_url FROM employees WHERE id = ?').get(employeeId)
      .avatar_url,
    '/uploads/staff/test-avatar.png',
  );

  const duplicatePin = await requestJson('/api/admin/crm/staff/employees', {
    method: 'POST',
    staffToken: managerToken,
    body: {
      first_name: 'Костя',
      pin: '3412',
    },
  });
  assertStatus(duplicatePin, 409, 'pin must be unique');

  const employeeAccess = await requestJson('/api/admin/crm/staff/access', {
    method: 'POST',
    body: { pin: '3412' },
  });
  assertStatus(employeeAccess, 200, 'employee access');
  const employeeToken = employeeAccess.data.staff_token;
  assert.equal(employeeAccess.data.role, 'employee');

  const employeeCannotList = await requestJson('/api/admin/crm/staff/employees', {
    staffToken: employeeToken,
  });
  assertStatus(employeeCannotList, 403, 'employee cannot manage team');

  const securityEmployeeCreate = await requestJson(
    '/api/admin/crm/staff/employees',
    {
      method: 'POST',
      staffToken: managerToken,
      body: {
        first_name: 'Проверка',
        last_name: 'Ролей',
        pin: '3512',
      },
    },
  );
  assertStatus(securityEmployeeCreate, 201, 'create role security employee');
  const securityEmployeeId = securityEmployeeCreate.data.employee.id;
  const securityEmployeeAccess = await requestJson(
    '/api/admin/crm/staff/access',
    {
      method: 'POST',
      body: { pin: '3512' },
    },
  );
  assertStatus(securityEmployeeAccess, 200, 'issue employee-scoped token');
  const promoteSecurityEmployee = await requestJson(
    `/api/admin/crm/staff/employees/${securityEmployeeId}`,
    {
      method: 'PATCH',
      staffToken: managerToken,
      body: { role: 'manager' },
    },
  );
  assertStatus(promoteSecurityEmployee, 200, 'promote employee');
  const promotedEmployeeTokenCannotManage = await requestJson(
    '/api/admin/crm/staff/employees',
    { staffToken: securityEmployeeAccess.data.staff_token },
  );
  assertStatus(
    promotedEmployeeTokenCannotManage,
    403,
    'employee-scoped token cannot become manager token after promotion',
  );
  const promotedManagerAccess = await requestJson(
    '/api/admin/crm/staff/access',
    {
      method: 'POST',
      body: { pin: '3512' },
    },
  );
  assertStatus(promotedManagerAccess, 200, 'issue manager-scoped token');
  assert.equal(promotedManagerAccess.data.role, 'manager');
  const demoteSecurityEmployee = await requestJson(
    `/api/admin/crm/staff/employees/${securityEmployeeId}`,
    {
      method: 'PATCH',
      staffToken: managerToken,
      body: { role: 'employee' },
    },
  );
  assertStatus(demoteSecurityEmployee, 200, 'demote second manager');
  const repromoteSecurityEmployee = await requestJson(
    `/api/admin/crm/staff/employees/${securityEmployeeId}`,
    {
      method: 'PATCH',
      staffToken: managerToken,
      body: { role: 'manager' },
    },
  );
  assertStatus(repromoteSecurityEmployee, 200, 'promote employee again');
  const staleManagerTokenCannotRevive = await requestJson(
    '/api/admin/crm/staff/employees',
    { staffToken: promotedManagerAccess.data.staff_token },
  );
  assertStatus(
    staleManagerTokenCannotRevive,
    403,
    'old manager token stays revoked after demote and promote',
  );
  const currentSecurityManagerAccess = await requestJson(
    '/api/admin/crm/staff/access',
    {
      method: 'POST',
      body: { pin: '3512' },
    },
  );
  assertStatus(
    currentSecurityManagerAccess,
    200,
    'issue current second manager token',
  );
  const concurrentLastManagerDemotions = await Promise.all([
    requestJson(`/api/admin/crm/staff/employees/${securityEmployeeId}`, {
      method: 'PATCH',
      staffToken: managerToken,
      body: { role: 'employee' },
    }),
    requestJson(`/api/admin/crm/staff/employees/${managerId}`, {
      method: 'PATCH',
      staffToken: currentSecurityManagerAccess.data.staff_token,
      body: { role: 'employee' },
    }),
  ]);
  assert.equal(
    concurrentLastManagerDemotions.filter(
      (result) => result.response.status === 200,
    ).length,
    1,
    'only one of two last-manager demotions can commit',
  );
  assert.equal(
    db.prepare(`
      SELECT COUNT(*) AS count
      FROM employees
      WHERE role = 'manager' AND active = 1 AND deactivated_at IS NULL
    `).get().count,
    1,
  );
  let normalizingManagerToken =
    db.prepare('SELECT role FROM employees WHERE id = ?').get(managerId).role
      === 'manager'
      ? managerToken
      : currentSecurityManagerAccess.data.staff_token;
  if (
    db.prepare('SELECT role FROM employees WHERE id = ?').get(managerId).role
      !== 'manager'
  ) {
    const restoreOriginalManager = await requestJson(
      `/api/admin/crm/staff/employees/${managerId}`,
      {
        method: 'PATCH',
        staffToken: normalizingManagerToken,
        body: { role: 'manager' },
      },
    );
    assertStatus(restoreOriginalManager, 200, 'restore original manager role');
  }
  if (
    db.prepare('SELECT role FROM employees WHERE id = ?')
      .get(securityEmployeeId).role === 'manager'
  ) {
    const returnSecurityEmployeeRole = await requestJson(
      `/api/admin/crm/staff/employees/${securityEmployeeId}`,
      {
        method: 'PATCH',
        staffToken: normalizingManagerToken,
        body: { role: 'employee' },
      },
    );
    assertStatus(returnSecurityEmployeeRole, 200, 'restore employee role');
  }
  const refreshedOriginalManagerAccess = await requestJson(
    '/api/admin/crm/staff/access',
    {
      method: 'POST',
      body: { pin: managerPin },
    },
  );
  assertStatus(
    refreshedOriginalManagerAccess,
    200,
    'refresh normalized manager session',
  );
  managerToken = refreshedOriginalManagerAccess.data.staff_token;
  const deactivationShiftId = 'staff_shift_employee_deactivation';
  const deactivationShiftCreatedAt = nowIsoForTest();
  db.prepare(`
    INSERT INTO staff_shifts (
      id, employee_id, employee_name_snapshot, business_date,
      planned_start_at, planned_end_at, started_at, status,
      created_by_employee_id, created_at, updated_at
    ) VALUES (?, ?, 'Проверяемый сотрудник', '2099-01-01',
              '2099-01-01T07:00:00.000Z', '2099-01-01T18:15:00.000Z',
              ?, 'active', ?, ?, ?)
  `).run(
    deactivationShiftId,
    securityEmployeeId,
    deactivationShiftCreatedAt,
    securityEmployeeId,
    deactivationShiftCreatedAt,
    deactivationShiftCreatedAt,
  );
  const deactivateSecurityEmployee = await requestJson(
    `/api/admin/crm/staff/employees/${securityEmployeeId}/deactivate`,
    {
      method: 'POST',
      staffToken: managerToken,
      body: { reason: 'Проверка исторической аналитики' },
    },
  );
  assertStatus(deactivateSecurityEmployee, 200, 'deactivate role test employee');
  const deactivationShift = db.prepare(
    'SELECT status, close_reason FROM staff_shifts WHERE id = ?',
  ).get(deactivationShiftId);
  assert.equal(deactivationShift.status, 'closed');
  assert.equal(deactivationShift.close_reason, 'Проверка исторической аналитики');
  assert.equal(
    db.prepare(`
      SELECT COUNT(*) AS count
      FROM staff_shift_audit
      WHERE shift_id = ? AND action = 'force_close'
    `).get(deactivationShiftId).count,
    1,
    'deactivation atomically closes and audits the active shift',
  );
  const teamWithDeactivated = await requestJson(
    '/api/admin/crm/staff/analytics/team?period=month',
    { staffToken: managerToken },
  );
  assertStatus(teamWithDeactivated, 200, 'team analytics includes history');
  assert.equal(
    teamWithDeactivated.data.employees.some(
      (entry) => (
        entry.employee.id === securityEmployeeId
        && entry.employee.active === false
      ),
    ),
    true,
    'deactivated employee remains in manager analytics',
  );

  const managerResetOwnPin = await requestJson(
    `/api/admin/crm/staff/employees/${managerId}/reset-pin`,
    {
      method: 'POST',
      staffToken: managerToken,
      body: { new_pin: '1201' },
    },
  );
  assertStatus(managerResetOwnPin, 403, 'manager pin needs main password recovery');

  const lastManagerDeactivate = await requestJson(
    `/api/admin/crm/staff/employees/${managerId}/deactivate`,
    {
      method: 'POST',
      staffToken: managerToken,
      body: { reason: 'Проверка защиты' },
    },
  );
  assertStatus(lastManagerDeactivate, 409, 'last active manager is protected');

  const lastManagerDemote = await requestJson(
    `/api/admin/crm/staff/employees/${managerId}`,
    {
      method: 'PATCH',
      staffToken: managerToken,
      body: { role: 'employee' },
    },
  );
  assertStatus(lastManagerDemote, 409, 'last active manager cannot be demoted');

  const markCreate = await requestJson('/api/admin/crm/staff/marks', {
    method: 'POST',
    staffToken: managerToken,
    idempotencyKey: 'staff-mark-create-1',
    body: {
      employee_id: employeeId,
      mark_type: 'positive',
      title: 'Аккуратно собрал крупный заказ',
      description: 'Без ошибок',
    },
  });
  assertStatus(markCreate, 201, 'create mark');
  const markId = markCreate.data.mark.id;
  assert.equal(markCreate.data.mark.points, 0);
  const markCreateReplay = await requestJson('/api/admin/crm/staff/marks', {
    method: 'POST',
    staffToken: managerToken,
    idempotencyKey: 'staff-mark-create-1',
    body: {
      employee_id: employeeId,
      mark_type: 'positive',
      title: 'Аккуратно собрал крупный заказ',
      description: 'Без ошибок',
    },
  });
  assertStatus(markCreateReplay, 200, 'manual mark create is replay-safe');
  assert.equal(markCreateReplay.data.replayed, true);
  assert.equal(markCreateReplay.data.mark.id, markId);
  assert.equal(
    db.prepare(`
      SELECT COUNT(*) AS count
      FROM staff_manual_marks
      WHERE id = ?
    `).get(markId).count,
    1,
  );
  const markWithoutTimezone = await requestJson(
    '/api/admin/crm/staff/marks',
    {
      method: 'POST',
      staffToken: managerToken,
      body: {
        employee_id: employeeId,
        mark_type: 'negative',
        title: 'Неоднозначное время',
        happened_at: '2026-07-20T10:00',
      },
    },
  );
  assertStatus(markWithoutTimezone, 400, 'mark date requires timezone');
  assert.equal(markWithoutTimezone.data.error, 'invalid_mark_date');

  const markEdit = await requestJson(`/api/admin/crm/staff/marks/${markId}`, {
    method: 'PATCH',
    staffToken: managerToken,
    idempotencyKey: 'staff-mark-edit-1',
    body: {
      expected_version: 1,
      mark_type: 'negative',
      title: 'Уточнённая отметка',
    },
  });
  assertStatus(markEdit, 200, 'edit mark');
  assert.equal(markEdit.data.mark.current_version, 2);
  const staleMarkEdit = await requestJson(
    `/api/admin/crm/staff/marks/${markId}`,
    {
      method: 'PATCH',
      staffToken: managerToken,
      idempotencyKey: 'staff-mark-edit-stale',
      body: {
        expected_version: 1,
        title: 'Устаревшая форма',
      },
    },
  );
  assertStatus(staleMarkEdit, 409, 'stale mark edit is rejected');
  assert.equal(staleMarkEdit.data.error, 'mark_conflict');

  const markVoid = await requestJson(`/api/admin/crm/staff/marks/${markId}`, {
    method: 'PATCH',
    staffToken: managerToken,
    idempotencyKey: 'staff-mark-void-1',
    body: {
      expected_version: 2,
      voided: true,
      void_reason: 'Создано по ошибке',
    },
  });
  assertStatus(markVoid, 200, 'void mark');
  assert.equal(markVoid.data.mark.voided, true);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM staff_manual_mark_versions WHERE mark_id = ?')
      .get(markId).count,
    3,
  );
  assert.throws(
    () => db.prepare(`
      UPDATE staff_manual_mark_versions SET title = 'tampered' WHERE mark_id = ?
    `).run(markId),
    /immutable_staff_manual_mark_versions/,
  );

  const currentParts = getTimeZoneDatePartsForTest(new Date());
  const currentMonth = `${String(currentParts.year).padStart(4, '0')}-${String(currentParts.month).padStart(2, '0')}`;
  const salaryFirst = await requestJson('/api/admin/crm/staff/salaries', {
    method: 'PUT',
    staffToken: managerToken,
    body: {
      employee_id: employeeId,
      month: currentMonth,
      amount: 1245.5,
      calculation: { basis: 'preliminary' },
    },
  });
  assertStatus(salaryFirst, 200, 'publish expected salary');
  assert.equal(salaryFirst.data.salary.status, 'published');
  assert.equal(salaryFirst.data.salary.visible_to_employee, 1);
  assert.equal(salaryFirst.data.salary.amount_minor, 124550);
  assert.equal('calculation' in salaryFirst.data.salary, false);
  assert.equal('calculation_json' in salaryFirst.data.salary, false);

  const foreignCurrencySalary = await requestJson('/api/admin/crm/staff/salaries', {
    method: 'PUT',
    staffToken: managerToken,
    body: {
      employee_id: employeeId,
      month: currentMonth,
      amount: 100,
      currency: 'USD',
    },
  });
  assertStatus(foreignCurrencySalary, 400, 'salary is BYN only');

  const overPreciseSalary = await requestJson('/api/admin/crm/staff/salaries', {
    method: 'PUT',
    staffToken: managerToken,
    body: {
      employee_id: employeeId,
      month: currentMonth,
      amount: 100.001,
    },
  });
  assertStatus(overPreciseSalary, 400, 'salary has at most two decimal places');

  const unsafeSalary = await requestJson('/api/admin/crm/staff/salaries', {
    method: 'PUT',
    staffToken: managerToken,
    body: {
      employee_id: employeeId,
      month: currentMonth,
      amount: Number.MAX_SAFE_INTEGER,
    },
  });
  assertStatus(unsafeSalary, 400, 'salary minor amount must be a safe integer');

  const salarySecond = await requestJson('/api/admin/crm/staff/salaries', {
    method: 'PUT',
    staffToken: managerToken,
    body: {
      employee_id: employeeId,
      month: currentMonth,
      amount_minor: 130000,
      reason: 'Уточнение часов',
    },
  });
  assertStatus(salarySecond, 200, 'revise expected salary');
  assert.equal(salarySecond.data.salary.current_version, 2);

  const employeeSalary = await requestJson(
    `/api/admin/crm/staff/salaries?month=${currentMonth}`,
    { staffToken: employeeToken },
  );
  assertStatus(employeeSalary, 200, 'salary visible immediately');
  assert.equal(employeeSalary.data.salary.amount_minor, 130000);

  const managerSalary = await requestJson('/api/admin/crm/staff/salaries', {
    method: 'PUT',
    staffToken: managerToken,
    body: {
      employee_id: managerId,
      month: currentMonth,
      amount: 1,
    },
  });
  assertStatus(managerSalary, 200, 'manager salary fixture');
  const foreignSalaryRead = await requestJson(
    `/api/admin/crm/staff/salaries?month=${currentMonth}&employee_id=${managerId}`,
    { staffToken: employeeToken },
  );
  assertStatus(foreignSalaryRead, 403, 'employee cannot read another salary');
  const foreignSalaryHistory = await requestJson(
    `/api/admin/crm/staff/salaries/${managerSalary.data.salary.id}/history`,
    { staffToken: employeeToken },
  );
  assertStatus(
    foreignSalaryHistory,
    403,
    'employee cannot read another salary history',
  );

  db.prepare(`
    INSERT INTO customers (
      id, telegram_id, telegram_username, first_name, last_name,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, DATETIME('now'), DATETIME('now'))
  `).run('customer_staff_notify', '778899', 'known_user', 'Иван', 'Петров');

  const resolveRecipient = await requestJson(
    '/api/admin/crm/staff/notifications/resolve-recipient',
    {
      method: 'POST',
      staffToken: managerToken,
      body: { username: '@known_user' },
    },
  );
  assertStatus(resolveRecipient, 200, 'resolve only local exact recipient');
  assert.equal(resolveRecipient.data.telegram_id, '778899');

  const unknownRecipient = await requestJson(
    '/api/admin/crm/staff/notifications/resolve-recipient',
    {
      method: 'POST',
      staffToken: managerToken,
      body: { username: 'other_user' },
    },
  );
  assertStatus(unknownRecipient, 404, 'never remote-resolve unknown username');

  db.prepare(`
    INSERT INTO customers (
      id, telegram_id, telegram_username, first_name, last_name,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, DATETIME('now'), DATETIME('now'))
  `).run(
    'customer_invalid_notify',
    'invalid-id',
    'invalid_id_user',
    'Некорректный',
    'Получатель',
  );
  const invalidStoredRecipient = await requestJson(
    '/api/admin/crm/staff/notifications/resolve-recipient',
    {
      method: 'POST',
      staffToken: managerToken,
      body: { username: 'invalid_id_user' },
    },
  );
  assertStatus(
    invalidStoredRecipient,
    409,
    'invalid stored telegram id cannot be configured',
  );

  const enableTaskNotifications = await requestJson(
    '/api/admin/crm/staff/notifications/settings',
    {
      method: 'PUT',
      staffToken: managerToken,
      body: { event_group: 'tasks', enabled: true },
    },
  );
  assertStatus(enableTaskNotifications, 200, 'enable task notifications');

  const addRecipient = await requestJson(
    '/api/admin/crm/staff/notifications/recipients',
    {
      method: 'POST',
      staffToken: managerToken,
      body: {
        event_group: 'tasks',
        telegram_username: 'known_user',
        telegram_id: '778899',
      },
    },
  );
  assertStatus(addRecipient, 201, 'confirm exact recipient');
  const recipientId = addRecipient.data.recipient.id;

  const badRecipientConfirmation = await requestJson(
    '/api/admin/crm/staff/notifications/recipients',
    {
      method: 'POST',
      staffToken: managerToken,
      body: {
        event_group: 'salary',
        telegram_username: 'known_user',
        telegram_id: '778898',
      },
    },
  );
  assertStatus(badRecipientConfirmation, 409, 'telegram id must be rechecked');

  const malformedRecipientId = await requestJson(
    '/api/admin/crm/staff/notifications/recipients',
    {
      method: 'POST',
      staffToken: managerToken,
      body: {
        event_group: 'salary',
        telegram_username: 'known_user',
        telegram_id: 'wrong-id',
      },
    },
  );
  assertStatus(malformedRecipientId, 400, 'telegram id must be numeric');

  const disableTrackingForTaskGuard = await requestJson(
    '/api/admin/crm/staff/settings/tracking',
    {
      method: 'PUT',
      staffToken: managerToken,
      body: { enabled: false },
    },
  );
  assertStatus(disableTrackingForTaskGuard, 200, 'disable tracking for task guard');
  assert.equal(disableTrackingForTaskGuard.data.enabled, false);
  const tasksWhileDisabled = await requestJson('/api/admin/crm/staff/tasks', {
    staffToken: managerToken,
  });
  assertStatus(tasksWhileDisabled, 503, 'task list is unavailable while tracking is disabled');
  const markWhileDisabled = await requestJson(
    '/api/admin/crm/staff/marks',
    {
      method: 'POST',
      staffToken: managerToken,
      body: {
        employee_id: employeeId,
        mark_type: 'positive',
        title: 'Не должна сохраниться',
      },
    },
  );
  assertStatus(markWhileDisabled, 503, 'marks cannot be created while tracking is disabled');
  const markEditWhileDisabled = await requestJson(
    `/api/admin/crm/staff/marks/${markId}`,
    {
      method: 'PATCH',
      staffToken: managerToken,
      body: { title: 'Не должно измениться' },
    },
  );
  assertStatus(markEditWhileDisabled, 503, 'marks cannot be edited while tracking is disabled');
  const taskCreateWhileDisabled = await requestJson('/api/admin/crm/staff/tasks', {
    method: 'POST',
    staffToken: managerToken,
    idempotencyKey: 'task-create-disabled',
    body: { title: 'Не должна создаться' },
  });
  assertStatus(
    taskCreateWhileDisabled,
    503,
    'task creation is unavailable while tracking is disabled',
  );
  const reenableTrackingAfterTaskGuard = await requestJson(
    '/api/admin/crm/staff/settings/tracking',
    {
      method: 'PUT',
      staffToken: managerToken,
      body: { enabled: true },
    },
  );
  assertStatus(reenableTrackingAfterTaskGuard, 200, 'reenable tracking after task guard');

  const taskDueAt = new Date(Date.now() + 86_400_000).toISOString();
  const taskWithoutDescription = await requestJson(
    '/api/admin/crm/staff/tasks',
    {
      method: 'POST',
      staffToken: managerToken,
      idempotencyKey: 'task-create-no-description',
      body: {
        title: 'Неполная задача',
        due_at: taskDueAt,
      },
    },
  );
  assertStatus(taskWithoutDescription, 400, 'task description is required');
  assert.equal(taskWithoutDescription.data.error, 'task_description_required');
  const taskWithoutDueAt = await requestJson('/api/admin/crm/staff/tasks', {
    method: 'POST',
    staffToken: managerToken,
    idempotencyKey: 'task-create-no-due-at',
    body: {
      title: 'Неполная задача',
      description: 'Есть описание, но нет срока',
    },
  });
  assertStatus(taskWithoutDueAt, 400, 'task deadline is required');
  assert.equal(taskWithoutDueAt.data.error, 'task_due_at_required');
  const taskWithPastDueAt = await requestJson('/api/admin/crm/staff/tasks', {
    method: 'POST',
    staffToken: managerToken,
    idempotencyKey: 'task-create-past-due-at',
    body: {
      title: 'Просроченная задача',
      description: 'Нельзя создать уже просроченной',
      due_at: new Date(Date.now() - 60_000).toISOString(),
    },
  });
  assertStatus(taskWithPastDueAt, 400, 'task deadline must be in the future');
  assert.equal(taskWithPastDueAt.data.error, 'invalid_task_due_at');
  const taskWithoutDueTimezone = await requestJson(
    '/api/admin/crm/staff/tasks',
    {
      method: 'POST',
      staffToken: managerToken,
      idempotencyKey: 'task-create-no-timezone',
      body: {
        title: 'Неоднозначный срок',
        description: 'Срок без зоны зависит от окружения сервера',
        due_at: '2099-01-01T10:00',
      },
    },
  );
  assertStatus(taskWithoutDueTimezone, 400, 'task deadline requires timezone');
  assert.equal(taskWithoutDueTimezone.data.error, 'invalid_task_due_at');
  // Задачу можно поручить конкретному сотруднику, тогда она закрепляется за ним.
  const targetedTask = await requestJson('/api/admin/crm/staff/tasks', {
    method: 'POST',
    staffToken: managerToken,
    idempotencyKey: 'task-create-targeted',
    body: {
      employee_id: employeeId,
      title: 'Адресная задача',
      description: 'Поручена конкретному сотруднику',
      due_at: taskDueAt,
    },
  });
  assertStatus(targetedTask, 201, 'task can be assigned to an employee');
  assert.equal(targetedTask.data.task.target_employee_id, employeeId);
  assert.ok(targetedTask.data.task.target_employee_name_snapshot);

  // Уволенному поручить нельзя.
  const targetedInactive = await requestJson('/api/admin/crm/staff/tasks', {
    method: 'POST',
    staffToken: managerToken,
    idempotencyKey: 'task-create-targeted-inactive',
    body: {
      employee_id: 'legacy_without_pin',
      title: 'Задача уволенному',
      description: 'Так быть не должно',
      due_at: taskDueAt,
    },
  });
  assertStatus(targetedInactive, 409, 'inactive employee cannot be assigned');
  assert.equal(targetedInactive.data.error, 'employee_inactive');

  // Без исполнителя задача остаётся свободной.
  const freeTask = await requestJson('/api/admin/crm/staff/tasks', {
    method: 'POST',
    staffToken: managerToken,
    idempotencyKey: 'task-create-free',
    body: {
      title: 'Свободная задача',
      description: 'Возьмёт любой на смене',
      due_at: taskDueAt,
    },
  });
  assertStatus(freeTask, 201, 'task without an employee stays free');
  assert.equal(freeTask.data.task.target_employee_id, null);

  const taskCreate = await requestJson('/api/admin/crm/staff/tasks', {
    method: 'POST',
    staffToken: managerToken,
    idempotencyKey: 'task-create-1',
    body: {
      title: 'Проверить поставку',
      description: 'Сверить количество',
      due_at: taskDueAt,
    },
  });
  assertStatus(taskCreate, 201, 'create task');
  const taskId = taskCreate.data.task.id;
  assert.equal(taskCreate.data.replayed, false);

  const taskCreateReplay = await requestJson('/api/admin/crm/staff/tasks', {
    method: 'POST',
    staffToken: managerToken,
    idempotencyKey: 'task-create-1',
    body: {
      title: 'Проверить поставку',
      description: 'Сверить количество',
      due_at: taskDueAt,
    },
  });
  assertStatus(taskCreateReplay, 200, 'task create replay');
  assert.equal(taskCreateReplay.data.replayed, true);
  assert.equal(taskCreateReplay.data.task.id, taskId);

  const taskCreateConflict = await requestJson('/api/admin/crm/staff/tasks', {
    method: 'POST',
    staffToken: managerToken,
    idempotencyKey: 'task-create-1',
    body: {
      title: 'Другой текст с тем же ключом',
      description: 'Сверить количество',
      due_at: taskDueAt,
    },
  });
  assertStatus(taskCreateConflict, 409, 'task key is bound to request content');

  await requestJson('/api/admin/crm/staff/settings/tracking', {
    method: 'PUT',
    staffToken: managerToken,
    body: { enabled: false },
  });
  const claimWhileTrackingDisabled = await requestJson(
    `/api/admin/crm/staff/tasks/${taskId}/claim`,
    {
      method: 'POST',
      staffToken: employeeToken,
      idempotencyKey: 'task-claim-tracking-disabled',
      body: {},
    },
  );
  assertStatus(
    claimWhileTrackingDisabled,
    503,
    'disabled tracking cannot bypass task shift enforcement',
  );
  await requestJson('/api/admin/crm/staff/settings/tracking', {
    method: 'PUT',
    staffToken: managerToken,
    body: { enabled: true },
  });

  const claimWithoutShift = await requestJson(
    `/api/admin/crm/staff/tasks/${taskId}/claim`,
    {
      method: 'POST',
      staffToken: employeeToken,
      idempotencyKey: 'task-claim-without-shift',
      body: {},
    },
  );
  assertStatus(claimWithoutShift, 409, 'claim requires active employee shift');

  // Личную задачу сотрудник ведёт независимо от того, чья смена открыта и есть ли она вообще.
  const personalTaskId = targetedTask.data.task.id;
  const claimPersonalByOther = await requestJson(
    `/api/admin/crm/staff/tasks/${personalTaskId}/claim`,
    {
      method: 'POST',
      staffToken: managerToken,
      idempotencyKey: 'task-claim-personal-by-other',
      body: {},
    },
  );
  assertStatus(claimPersonalByOther, 403, 'personal task is not claimable by others');
  assert.equal(claimPersonalByOther.data.error, 'task_assigned_to_another_employee');

  const claimPersonalWithoutShift = await requestJson(
    `/api/admin/crm/staff/tasks/${personalTaskId}/claim`,
    {
      method: 'POST',
      staffToken: employeeToken,
      idempotencyKey: 'task-claim-personal-no-shift',
      body: {},
    },
  );
  assertStatus(claimPersonalWithoutShift, 200, 'personal task is claimable without a shift');
  assert.equal(claimPersonalWithoutShift.data.task.assignee_employee_id, employeeId);

  const submitPersonalWithoutShift = await requestJson(
    `/api/admin/crm/staff/tasks/${personalTaskId}/submit`,
    {
      method: 'POST',
      staffToken: employeeToken,
      idempotencyKey: 'task-submit-personal-no-shift',
      body: { result_note: 'Сделано' },
    },
  );
  assertStatus(submitPersonalWithoutShift, 200, 'personal task is submittable without a shift');

  const routeShiftId = 'staff_shift_route_task';
  const routeShiftStart = new Date(Date.now() - 60 * 60_000);
  const routeShiftEnd = new Date(Date.now() + 2 * 60 * 60_000);
  db.prepare(`
    INSERT INTO staff_shifts (
      id, employee_id, employee_name_snapshot, business_date,
      planned_start_at, planned_end_at, started_at, status,
      created_by_employee_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `).run(
    routeShiftId,
    employeeId,
    'Алексей Иванов',
    getBusinessDateForTest(new Date()),
    routeShiftStart.toISOString(),
    routeShiftEnd.toISOString(),
    routeShiftStart.toISOString(),
    employeeId,
    routeShiftStart.toISOString(),
    routeShiftStart.toISOString(),
  );

  const mismatchedManagerCorrection = await requestJson(
    '/api/admin/crm/staff/shift/close',
    {
      method: 'POST',
      staffToken: managerToken,
      body: {
        manager_correction: true,
        shift_id: 'another_closed_shift',
        reason: 'Проверка атомарности исправления',
      },
    },
  );
  assertStatus(
    mismatchedManagerCorrection,
    409,
    'manager correction cannot close one shift and edit another',
  );
  assert.equal(
    db.prepare('SELECT status FROM staff_shifts WHERE id = ?').get(routeShiftId).status,
    'active',
    'mismatched manager correction rolls back shift close',
  );

  const claim = await requestJson(`/api/admin/crm/staff/tasks/${taskId}/claim`, {
    method: 'POST',
    staffToken: employeeToken,
    idempotencyKey: 'task-claim-1',
    body: {},
  });
  assertStatus(claim, 200, 'claim task');
  assert.equal(claim.data.task.status, 'claimed');

  const submit = await requestJson(`/api/admin/crm/staff/tasks/${taskId}/submit`, {
    method: 'POST',
    staffToken: employeeToken,
    idempotencyKey: 'task-submit-1',
    body: { result_note: 'Количество совпало' },
  });
  assertStatus(submit, 200, 'submit task');
  assert.equal(submit.data.task.status, 'submitted');

  const resubmit = await requestJson(`/api/admin/crm/staff/tasks/${taskId}/submit`, {
    method: 'POST',
    staffToken: employeeToken,
    idempotencyKey: 'task-submit-2',
    body: { result_note: 'Повторно отправлено после уточнения' },
  });
  assertStatus(resubmit, 200, 'submitted task can be submitted again');
  assert.equal(resubmit.data.task.status, 'submitted');
  assert.ok(resubmit.data.task.version > submit.data.task.version);

  const approve = await requestJson(`/api/admin/crm/staff/tasks/${taskId}/approve`, {
    method: 'POST',
    staffToken: managerToken,
    idempotencyKey: 'task-approve-1',
    body: {},
  });
  assertStatus(approve, 200, 'approve task');
  assert.equal(approve.data.task.status, 'approved');

  const approveReplay = await requestJson(`/api/admin/crm/staff/tasks/${taskId}/approve`, {
    method: 'POST',
    staffToken: managerToken,
    idempotencyKey: 'task-approve-1',
    body: {},
  });
  assertStatus(approveReplay, 200, 'approve replay');
  assert.equal(approveReplay.data.replayed, true);
  assert.equal(
    db.prepare(`
      SELECT COUNT(*) AS count FROM staff_events
      WHERE idempotency_key = ?
    `).get(`staff-task-approved:${taskId}`).count,
    1,
    'approved task creates exactly one positive event',
  );
  assert.equal(
    db.prepare(`
      SELECT COUNT(*) AS count FROM internal_notification_outbox
      WHERE unique_key LIKE ?
    `).get(`staff-task:${taskId}:%`).count,
    3,
    'create and each distinct submit are queued once',
  );
  assert.throws(
    () => db.prepare(`
      UPDATE staff_task_history SET action = 'tampered' WHERE task_id = ?
    `).run(taskId),
    /immutable_staff_task_history/,
  );

  const releaseTaskCreate = await requestJson('/api/admin/crm/staff/tasks', {
    method: 'POST',
    staffToken: managerToken,
    idempotencyKey: 'task-create-release-1',
    body: {
      title: 'Задача для освобождения',
      description: 'Проверить возможность безопасного переназначения',
      due_at: taskDueAt,
    },
  });
  assertStatus(releaseTaskCreate, 201, 'create release scenario task');
  const releaseTaskId = releaseTaskCreate.data.task.id;
  const crossTaskKeyReuse = await requestJson(
    `/api/admin/crm/staff/tasks/${releaseTaskId}/claim`,
    {
      method: 'POST',
      staffToken: employeeToken,
      idempotencyKey: 'task-claim-1',
      body: {},
    },
  );
  assertStatus(
    crossTaskKeyReuse,
    409,
    'task command key cannot replay another task response',
  );
  const releaseTaskClaim = await requestJson(
    `/api/admin/crm/staff/tasks/${releaseTaskId}/claim`,
    {
      method: 'POST',
      staffToken: employeeToken,
      idempotencyKey: 'task-claim-release-1',
      body: {},
    },
  );
  assertStatus(releaseTaskClaim, 200, 'claim release scenario task');
  const employeeRelease = await requestJson(
    `/api/admin/crm/staff/tasks/${releaseTaskId}/release`,
    {
      method: 'POST',
      staffToken: employeeToken,
      idempotencyKey: 'task-release-by-employee',
      body: {},
    },
  );
  assertStatus(employeeRelease, 403, 'only manager can release task');
  const managerRelease = await requestJson(
    `/api/admin/crm/staff/tasks/${releaseTaskId}/release`,
    {
      method: 'POST',
      staffToken: managerToken,
      idempotencyKey: 'task-release-by-manager',
      body: { reason: 'Переназначение' },
    },
  );
  assertStatus(managerRelease, 200, 'manager releases task');
  assert.equal(managerRelease.data.task.status, 'open');

  const analytics = await requestJson(
    `/api/admin/crm/staff/analytics?month=${currentMonth}`,
    { staffToken: employeeToken },
  );
  assertStatus(analytics, 200, 'self analytics');
  assert.equal(analytics.data.employee.id, employeeId);
  assert.equal(analytics.data.expected_salary.amount_minor, 130000);
  assert.equal(analytics.data.events_total, 1);
  assert.deepEqual(analytics.data.period, {
    type: 'month',
    start: `${currentMonth}-01`,
    end: `${currentMonth}-${new Date(
      Date.UTC(currentParts.year, currentParts.month, 0),
    ).getUTCDate()}`,
  });
  assert.equal(analytics.data.month, currentMonth);

  db.transaction(() => {
    const insertOrder = db.prepare(`
      INSERT INTO orders (
        id, order_number, status, total_amount, final_amount, profit,
        issued_by_employee_id, issued_at
      ) VALUES (?, ?, 'delivered', ?, ?, ?, ?, ?)
    `);
    insertOrder.run(
      'staff_analytics_order_2025',
      990001,
      11,
      11,
      1,
      employeeId,
      '2025-12-31 20:59:59',
    );
    insertOrder.run(
      'staff_analytics_order_2026_start',
      990002,
      22,
      22,
      2,
      employeeId,
      '2025-12-31 21:00:00',
    );
    insertOrder.run(
      'staff_analytics_order_january_end',
      990003,
      33,
      33,
      3,
      employeeId,
      '2026-01-31 20:59:59',
    );
    insertOrder.run(
      'staff_analytics_order_february_start',
      990004,
      44,
      44,
      4,
      employeeId,
      '2026-01-31 21:00:00',
    );

    const insertEvent = db.prepare(`
      INSERT INTO staff_events (
        id, employee_id, employee_name_snapshot, event_type, polarity,
        source, happened_at, business_date, idempotency_key, payload_json,
        created_at
      ) VALUES (?, ?, 'Алексей Иванов', ?, 'positive', 'system', ?, ?, ?, '{}', ?)
    `);
    insertEvent.run(
      'staff_analytics_event_2025',
      employeeId,
      'procurement_created',
      '2025-12-31 20:59:59',
      '2025-12-31',
      'staff-analytics-event-2025',
      '2025-12-31 20:59:59',
    );
    insertEvent.run(
      'staff_analytics_event_2026',
      employeeId,
      'transfer_created',
      '2025-12-31 21:00:00',
      '2026-01-01',
      'staff-analytics-event-2026',
      '2025-12-31 21:00:00',
    );
    insertEvent.run(
      'staff_analytics_task_approved_event',
      employeeId,
      'task_approved',
      '2025-12-31 21:00:30',
      '2026-01-01',
      'staff-analytics-task-approved-event',
      '2025-12-31 21:00:30',
    );

    db.prepare(`
      INSERT INTO staff_manual_marks (
        id, employee_id, employee_name_snapshot, mark_type, title,
        happened_at, business_date, current_version,
        created_by_employee_id, created_by_name_snapshot, created_at, updated_at
      ) VALUES (
        'staff_analytics_mark_2026', ?, 'Алексей Иванов', 'negative',
        'Граничная отметка', '2025-12-31 21:00:00', '2026-01-01', 1,
        ?, 'Мария', '2025-12-31 21:00:00', '2025-12-31 21:00:00'
      )
    `).run(employeeId, managerId);

    db.prepare(`
      INSERT INTO staff_shifts (
        id, employee_id, employee_name_snapshot, business_date,
        planned_start_at, planned_end_at, started_at, ended_at, status,
        close_reason, created_by_employee_id, created_at, updated_at
      ) VALUES (
        'staff_analytics_shift_new_year', ?, 'Алексей Иванов', '2025-12-31',
        '2025-12-31 20:30:00', '2025-12-31 21:30:00',
        '2025-12-31 20:30:00', '2025-12-31 21:30:00', 'closed',
        'test', ?, '2025-12-31 20:30:00', '2025-12-31 21:30:00'
      )
    `).run(employeeId, employeeId);

    db.prepare(`
      INSERT INTO staff_tasks (
        id, title, status, target_employee_id, target_employee_name_snapshot,
        assignee_employee_id, assignee_employee_name_snapshot, version,
        approved_at, created_by_employee_id, created_by_name_snapshot,
        created_at, updated_at
      ) VALUES (
        'staff_analytics_task_new_year', 'Граничная задача', 'approved',
        ?, 'Алексей Иванов', ?, 'Алексей Иванов', 1,
        '2025-12-31 21:00:30', ?,
        'Мария', '2025-12-31 20:59:30', '2025-12-31 21:00:30'
      )
    `).run(employeeId, employeeId, managerId);
    const insertTaskHistory = db.prepare(`
      INSERT INTO staff_task_history (
        id, task_id, action, previous_status, new_status,
        actor_employee_id, actor_name_snapshot, idempotency_key, created_at
      ) VALUES (
        ?, 'staff_analytics_task_new_year', ?, ?, ?, ?, ?, ?, ?
      )
    `);
    insertTaskHistory.run(
      'staff_analytics_task_submitted_history',
      'submit',
      'claimed',
      'submitted',
      employeeId,
      'Алексей Иванов',
      'staff-analytics-task-submitted-history',
      '2025-12-31 20:59:30',
    );
    insertTaskHistory.run(
      'staff_analytics_task_approved_history',
      'approve',
      'submitted',
      'approved',
      managerId,
      'Мария',
      'staff-analytics-task-approved-history',
      '2025-12-31 21:00:30',
    );
  })();

  const januaryAnalytics = await requestJson(
    '/api/admin/crm/staff/analytics?period=month&month=2026-01',
    { staffToken: employeeToken },
  );
  assertStatus(januaryAnalytics, 200, 'January analytics');
  assert.deepEqual(januaryAnalytics.data.period, {
    type: 'month',
    start: '2026-01-01',
    end: '2026-01-31',
  });
  assert.equal(januaryAnalytics.data.month, '2026-01');
  assert.equal(januaryAnalytics.data.issued_orders, 2);
  assert.equal(januaryAnalytics.data.issued_revenue, 55);
  assert.equal(januaryAnalytics.data.expected_salary, null);
  assert.equal(januaryAnalytics.data.events_total, 2);
  assert.equal(januaryAnalytics.data.mark_counts.manual_negative, 1);
  assert.equal(januaryAnalytics.data.shifts_count, 1);
  assert.equal(januaryAnalytics.data.worked_minutes, 30);
  assert.equal(januaryAnalytics.data.tasks.approved, 1);
  assert.equal(Number(januaryAnalytics.data.tasks.submitted || 0), 0);
  assert.equal(januaryAnalytics.data.metrics.tasks_completed, 1);

  // Плюсы это ручные отметки плюс подтверждённые документы и задачи.
  const januaryMarks = januaryAnalytics.data.mark_counts;
  // Страховка от вырождения: если бы всё было нулями, проверки ниже ничего не значили.
  assert.ok(januaryMarks.system_positive > 0, 'в периоде есть автоматические плюсы');
  assert.ok(januaryMarks.manual_negative > 0, 'в периоде есть ручной минус');
  assert.equal(
    januaryMarks.positive,
    januaryMarks.manual_positive + januaryMarks.system_positive,
    'плюсы складываются из ручных и автоматических',
  );
  assert.equal(januaryMarks.negative, januaryMarks.manual_negative);
  assert.equal(
    januaryMarks.system_positive,
    Number(januaryAnalytics.data.metrics.procurement_created || 0)
      + Number(januaryAnalytics.data.metrics.procurement_accepted || 0)
      + Number(januaryAnalytics.data.metrics.transfer_created || 0)
      + Number(januaryAnalytics.data.metrics.transfer_accepted || 0)
      + Number(januaryAnalytics.data.metrics.task_approved || 0),
    'автоматические плюсы считаются по документам и принятым задачам',
  );

  // Главная проверка: сумма столбиков графика обязана совпадать с плиткой.
  // Итог и дневные бакеты считаются разными запросами, и на стыке суток по
  // Минску они легко разъезжаются.
  const sumDaily = (field) => (januaryAnalytics.data.daily_activity || [])
    .reduce((sum, day) => sum + Number(day.marks?.[field] || 0), 0);
  assert.equal(sumDaily('positive'), januaryMarks.positive, 'плюсы по дням сходятся с итогом');
  assert.equal(sumDaily('negative'), januaryMarks.negative, 'минусы по дням сходятся с итогом');
  assert.equal(sumDaily('manual_positive'), januaryMarks.manual_positive);
  assert.equal(sumDaily('system_positive'), januaryMarks.system_positive);

  const newYearDayAnalytics = await requestJson(
    '/api/admin/crm/staff/analytics?period=day&date=2026-01-01',
    { staffToken: employeeToken },
  );
  assertStatus(newYearDayAnalytics, 200, 'New Year day analytics');
  assert.deepEqual(newYearDayAnalytics.data.period, {
    type: 'day',
    start: '2026-01-01',
    end: '2026-01-01',
  });
  assert.equal('month' in newYearDayAnalytics.data, false);
  assert.equal(newYearDayAnalytics.data.expected_salary, null);
  assert.equal(newYearDayAnalytics.data.issued_orders, 1);
  assert.equal(newYearDayAnalytics.data.issued_revenue, 22);
  assert.equal(newYearDayAnalytics.data.events_total, 2);
  assert.equal(newYearDayAnalytics.data.worked_minutes, 30);
  assert.equal(newYearDayAnalytics.data.tasks.approved, 1);
  assert.equal(newYearDayAnalytics.data.metrics.tasks_completed, 1);

  const year2025Analytics = await requestJson(
    '/api/admin/crm/staff/analytics?period=year&year=2025',
    { staffToken: employeeToken },
  );
  assertStatus(year2025Analytics, 200, '2025 analytics');
  assert.deepEqual(year2025Analytics.data.period, {
    type: 'year',
    start: '2025-01-01',
    end: '2025-12-31',
  });
  assert.equal(year2025Analytics.data.issued_orders, 1);
  assert.equal(year2025Analytics.data.issued_revenue, 11);
  assert.equal(year2025Analytics.data.events_total, 1);
  assert.equal(year2025Analytics.data.worked_minutes, 30);
  assert.equal(year2025Analytics.data.expected_salary, null);
  assert.equal(year2025Analytics.data.tasks.submitted, 1);
  assert.equal(Number(year2025Analytics.data.tasks.approved || 0), 0);
  assert.equal(year2025Analytics.data.metrics.tasks_completed, 0);

  const customNewYearAnalytics = await requestJson(
    '/api/admin/crm/staff/analytics?period=custom&from=2025-12-31&to=2026-01-01',
    { staffToken: employeeToken },
  );
  assertStatus(customNewYearAnalytics, 200, 'inclusive custom New Year range');
  assert.deepEqual(customNewYearAnalytics.data.period, {
    type: 'custom',
    start: '2025-12-31',
    end: '2026-01-01',
  });
  assert.equal(customNewYearAnalytics.data.issued_orders, 2);
  assert.equal(customNewYearAnalytics.data.issued_revenue, 33);
  assert.equal(customNewYearAnalytics.data.events_total, 3);
  assert.equal(customNewYearAnalytics.data.expected_salary, null);
  assert.equal(customNewYearAnalytics.data.tasks.submitted, 1);
  assert.equal(customNewYearAnalytics.data.tasks.approved, 1);
  assert.equal(customNewYearAnalytics.data.metrics.tasks_completed, 1);

  const teamJanuaryAnalytics = await requestJson(
    '/api/admin/crm/staff/analytics/team?period=month&month=2026-01',
    { staffToken: managerToken },
  );
  assertStatus(teamJanuaryAnalytics, 200, 'team period analytics');
  assert.deepEqual(teamJanuaryAnalytics.data.period, {
    type: 'month',
    start: '2026-01-01',
    end: '2026-01-31',
  });
  assert.equal(teamJanuaryAnalytics.data.month, '2026-01');
  assert.equal(
    teamJanuaryAnalytics.data.employees.find(
      (employee) => employee.employee.id === employeeId,
    ).issued_orders,
    2,
  );

  const invalidAnalyticsDate = await requestJson(
    '/api/admin/crm/staff/analytics?period=day&date=2026-02-29',
    { staffToken: employeeToken },
  );
  assertStatus(invalidAnalyticsDate, 400, 'reject impossible analytics date');
  const invertedAnalyticsRange = await requestJson(
    '/api/admin/crm/staff/analytics?period=custom&from=2026-01-02&to=2026-01-01',
    { staffToken: employeeToken },
  );
  assertStatus(invertedAnalyticsRange, 400, 'reject inverted analytics range');
  const oversizedAnalyticsRange = await requestJson(
    '/api/admin/crm/staff/analytics?period=custom&from=2025-01-01&to=2026-01-02',
    { staffToken: employeeToken },
  );
  assertStatus(oversizedAnalyticsRange, 400, 'reject analytics range over 366 days');

  db.prepare(`
    UPDATE customers
    SET telegram_username = 'renamed_user', updated_at = DATETIME('now')
    WHERE telegram_id = '778899'
  `).run();
  const deleteStaleRecipient = await requestJson(
    `/api/admin/crm/staff/notifications/recipients/${recipientId}`,
    {
      method: 'DELETE',
      staffToken: managerToken,
    },
  );
  assertStatus(
    deleteStaleRecipient,
    200,
    'manager can delete recipient after customer username changed',
  );
  assert.equal(
    db.prepare(`
      SELECT COUNT(*) AS count
      FROM internal_notification_recipients
      WHERE id = ?
    `).get(recipientId).count,
    0,
  );

  db.prepare(`
    INSERT INTO internal_notification_outbox (
      unique_key, event_type, recipient_telegram_id, recipient_username,
      payload_json, status, next_attempt_at
    ) VALUES ('unknown-test', 'task_created', '778899', 'known_user',
              '{}', 'unknown', DATETIME('now'))
  `).run();
  const unknownOutboxId = db.prepare(`
    SELECT id FROM internal_notification_outbox WHERE unique_key = 'unknown-test'
  `).get().id;
  const resumeUnknown = await requestJson(
    `/api/admin/crm/staff/notifications/outbox/${unknownOutboxId}/resume`,
    {
      method: 'POST',
      staffToken: managerToken,
      body: { reason: 'Проверено вручную: сообщение не пришло' },
    },
  );
  assertStatus(resumeUnknown, 200, 'manual resume unknown notification');
  assert.equal(resumeUnknown.data.notification.status, 'retry');

  db.prepare(`
    UPDATE staff_shifts
    SET status = 'closed', ended_at = ?, close_reason = 'test_complete', updated_at = ?
    WHERE id = ? AND status = 'active'
  `).run(nowIsoForTest(), nowIsoForTest(), routeShiftId);

  const fakeNow = new Date('2030-06-03T08:00:00.000Z'); // 11:00 Минск
  let serviceNow = fakeNow;
  const isolatedClockService = createStaffService(db, {
    nowProvider: () => serviceNow,
    bcryptRounds: 4,
  });
  const opened = await isolatedClockService.openShift({
    employeeId,
    pin: '3412',
    rateKey: 'shift-test-employee',
  });
  assert.equal(opened.shift.status, 'active');
  assert.ok(opened.shift_token);

  await assert.rejects(
    isolatedClockService.openShift({
      employeeId: managerId,
      pin: managerPin,
      rateKey: 'shift-test-manager',
    }),
    (error) => error.code === 'shift_conflict',
    'only one global active shift is allowed',
  );

  serviceNow = new Date('2030-06-03T18:16:00.000Z'); // 21:16 Минск
  const expired = isolatedClockService.expireShifts();
  assert.deepEqual(expired, [opened.shift.id]);
  assert.equal(isolatedClockService.getActiveShift(), null);
  assert.throws(
    () => db.prepare(`
      UPDATE staff_shift_audit SET reason = 'tampered' WHERE shift_id = ?
    `).run(opened.shift.id),
    /immutable_staff_shift_audit/,
  );

  const candidates = await requestJson('/api/admin/crm/staff/shift/candidates');
  assertStatus(candidates, 200, 'safe candidates before staff access');
  assert.ok(
    candidates.data.candidates.every(
      (candidate) => !('role' in candidate) && !('pin_hash' in candidate),
    ),
  );

  const cannotPromoteThroughRecovery = await requestJson(
    '/api/admin/crm/staff/recovery-manager',
    {
      method: 'POST',
      body: {
        admin_password: adminPassword,
        employee_id: employeeId,
        new_pin: '7777',
      },
    },
  );
  assertStatus(
    cannotPromoteThroughRecovery,
    403,
    'manager recovery cannot promote an employee',
  );
  assert.equal(
    db.prepare('SELECT role FROM employees WHERE id = ?').get(employeeId).role,
    'employee',
  );

  const recoverManager = await requestJson(
    '/api/admin/crm/staff/recovery-manager',
    {
      method: 'POST',
      body: {
        admin_password: adminPassword,
        employee_id: managerId,
        new_pin: '1201',
      },
    },
  );
  assertStatus(recoverManager, 200, 'recover manager pin with main password');
  assert.equal(recoverManager.data.employee.role, 'manager');

  const revokedManagerSession = await requestJson(
    '/api/admin/crm/staff/employees',
    { staffToken: managerToken },
  );
  assertStatus(revokedManagerSession, 403, 'manager recovery revokes old sessions');
  const oldManagerPin = await requestJson('/api/admin/crm/staff/access', {
    method: 'POST',
    body: { pin: managerPin },
  });
  assertStatus(oldManagerPin, 401, 'old manager pin no longer works');
  const recoveredManagerAccess = await requestJson('/api/admin/crm/staff/access', {
    method: 'POST',
    body: { pin: '1201' },
  });
  assertStatus(recoveredManagerAccess, 200, 'new manager pin works');
  assert.equal(recoveredManagerAccess.data.role, 'manager');

  console.log('staff-management tests: ok');
} finally {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}

function getTimeZoneDatePartsForTest(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Minsk',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day) };
}

function getBusinessDateForTest(date) {
  const parts = getTimeZoneDatePartsForTest(date);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function nowIsoForTest() {
  return new Date().toISOString();
}
