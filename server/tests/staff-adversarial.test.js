import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const childMode = process.argv.includes('--staff-race-child');

if (childMode) {
  const Database = (await import('better-sqlite3')).default;
  const { db: sharedDb } = await import('../db.js');
  const { createStaffService } = await import('../utils/staff-service.js');
  const database = new Database(process.env.DATABASE_FILE);
  database.pragma('foreign_keys = ON');
  database.pragma('journal_mode = WAL');
  database.pragma('busy_timeout = 5000');

  process.send?.({ type: 'ready' });
  process.once('message', async (message) => {
    if (message?.type !== 'run') return;
    const payload = message.payload || {};
    const service = createStaffService(database, {
      nowProvider: () => new Date(payload.now),
      bcryptRounds: 4,
    });
    try {
      if (payload.operation === 'open') {
        const opened = await service.openShift({
          employeeId: payload.employeeId,
          pin: payload.pin,
          rateKey: payload.rateKey,
          userAgent: 'staff-adversarial-child',
        });
        process.send?.({
          type: 'result',
          result: { ok: true, shiftId: opened.shift.id },
        });
      } else if (payload.operation === 'correct') {
        const corrected = service.correctShift({
          shiftId: payload.shiftId,
          staffToken: payload.staffToken,
          startedAt: payload.startedAt,
          endedAt: payload.endedAt,
          reason: payload.reason,
          expectedVersion: payload.expectedVersion,
        });
        process.send?.({
          type: 'result',
          result: {
            ok: true,
            shiftId: corrected.id,
            version: corrected.version,
          },
        });
      } else {
        throw new Error('unknown_child_operation');
      }
    } catch (error) {
      process.send?.({
        type: 'result',
        result: {
          ok: false,
          code: error?.code || 'unknown_error',
          status: Number(error?.status) || null,
        },
      });
    } finally {
      database.close();
      sharedDb.close();
      process.disconnect?.();
    }
  });
} else {
  const bcrypt = (await import('bcryptjs')).default;
  const express = (await import('express')).default;

  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'navalivay-staff-adversarial-'),
  );
  const databaseFile = path.join(tempDir, 'staff-adversarial.db');
  const adminConfigFile = path.join(tempDir, 'admin.json');
  const adminPassword = 'staff-adversarial-admin-password';

  process.env.DATABASE_FILE = databaseFile;
  process.env.ADMIN_CONFIG = adminConfigFile;
  process.env.SESSION_SECRET =
    'staff-adversarial-session-secret-more-than-thirty-two-characters';
  process.env.STAFF_PIN_PEPPER =
    'staff-adversarial-pin-pepper-more-than-thirty-two-characters';
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
  const { createStaffService } = await import('../utils/staff-service.js');

  initDb();

  const managerPin = '7314';
  const firstEmployeePin = '2608';
  const secondEmployeePin = '5942';
  const setupService = createStaffService(db, { bcryptRounds: 4 });

  async function insertEmployee({
    id,
    pin,
    role = 'employee',
    firstName,
  }) {
    const credentials = await setupService.createPinCredentials(pin);
    const createdAt = new Date().toISOString();
    db.prepare(`
      INSERT INTO employees (
        id, username, password_hash, first_name, last_name, position, active,
        role, responsibilities, pin_hash, pin_fingerprint, pin_updated_at,
        created_at, updated_at
      ) VALUES (?, ?, 'disabled', ?, 'Тестовый', 'Сотрудник', 1, ?, '[]',
        ?, ?, ?, ?, ?)
    `).run(
      id,
      `${id}_login`,
      firstName,
      role,
      credentials.hash,
      credentials.fingerprint,
      createdAt,
      createdAt,
      createdAt,
    );
  }

  await insertEmployee({
    id: 'manager',
    pin: managerPin,
    role: 'manager',
    firstName: 'Марина',
  });
  await insertEmployee({
    id: 'employee_a',
    pin: firstEmployeePin,
    firstName: 'Анна',
  });
  await insertEmployee({
    id: 'employee_b',
    pin: secondEmployeePin,
    firstName: 'Борис',
  });
  setupService.setTrackingEnabled(true);

  const managerAccess = await setupService.accessByPin({
    pin: managerPin,
    rateKey: 'legacy-manager',
  });
  const employeeAccess = await setupService.accessByPin({
    pin: firstEmployeePin,
    rateKey: 'legacy-employee',
  });
  const adminToken = issueToken('staff-adversarial-admin');

  const { crmRouter } = await import('../routes/crm.js');
  const app = express();
  app.use(express.json());
  app.use(crmRouter);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function requestJson(url, {
    method = 'GET',
    staffToken = null,
    body,
  } = {}) {
    const response = await fetch(`${baseUrl}${url}`, {
      method,
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
        ...(staffToken ? { 'X-Staff-Token': staffToken } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return {
      status: response.status,
      data: text ? JSON.parse(text) : null,
    };
  }

  function launchRaceChild() {
    const child = fork(fileURLToPath(import.meta.url), ['--staff-race-child'], {
      env: { ...process.env },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    const ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`staff race child did not start: ${stderr}`)),
        10_000,
      );
      const onMessage = (message) => {
        if (message?.type !== 'ready') return;
        clearTimeout(timeout);
        child.off('exit', onExit);
        child.off('message', onMessage);
        resolve();
      };
      const onExit = (code) => {
        clearTimeout(timeout);
        reject(new Error(
          `staff race child exited before ready (${code}): ${stderr}`,
        ));
      };
      child.on('message', onMessage);
      child.once('exit', onExit);
    });
    const result = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error(`staff race child timed out: ${stderr}`));
      }, 15_000);
      child.on('message', (message) => {
        if (message?.type !== 'result') return;
        clearTimeout(timeout);
        resolve(message.result);
      });
      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once('exit', (code) => {
        if (code === 0) return;
        clearTimeout(timeout);
        reject(new Error(`staff race child failed (${code}): ${stderr}`));
      });
    });
    return { child, ready, result };
  }

  async function runRace(payloads) {
    const runners = payloads.map(() => launchRaceChild());
    await Promise.all(runners.map((runner) => runner.ready));
    runners.forEach((runner, index) => {
      runner.child.send({ type: 'run', payload: payloads[index] });
    });
    return Promise.all(runners.map((runner) => runner.result));
  }

  function assertNoSecretFields(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(assertNoSecretFields);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      assert.equal(
        ['pin', 'pin_hash', 'pin_fingerprint', 'staff_token', 'shift_token']
          .includes(key),
        false,
        `secret response field leaked: ${key}`,
      );
      assertNoSecretFields(child);
    }
  }

  try {
    console.log('staff adversarial: legacy employee endpoints require manager');
    const missingManager = await requestJson('/api/admin/crm/employees');
    assert.equal(missingManager.status, 401);
    assert.equal(missingManager.data.error, 'invalid_staff_token');

    const employeeCannotRead = await requestJson('/api/admin/crm/employees', {
      staffToken: employeeAccess.staff_token,
    });
    assert.equal(employeeCannotRead.status, 403);
    assert.equal(employeeCannotRead.data.error, 'manager_access_required');

    const managerCanRead = await requestJson('/api/admin/crm/employees', {
      staffToken: managerAccess.staff_token,
    });
    assert.equal(managerCanRead.status, 200);
    assert.equal(managerCanRead.data.length, 3);
    assertNoSecretFields(managerCanRead.data);

    console.log('staff adversarial: legacy mutations are permanently gone');
    for (const [method, url] of [
      ['POST', '/api/admin/crm/employees'],
      ['PATCH', '/api/admin/crm/employees/employee_a'],
      ['DELETE', '/api/admin/crm/employees/employee_a'],
    ]) {
      const moved = await requestJson(url, {
        method,
        staffToken: managerAccess.staff_token,
        body: method === 'DELETE' ? undefined : { first_name: 'Подмена' },
      });
      assert.equal(moved.status, 410, `${method} ${url}`);
      assert.equal(moved.data.error, 'staff_endpoint_moved');
      assertNoSecretFields(moved.data);
    }

    console.log('staff adversarial: two SQLite connections open one shift');
    const opened = await runRace([
      {
        operation: 'open',
        now: '2026-07-24T07:00:00.000Z',
        employeeId: 'employee_a',
        pin: firstEmployeePin,
        rateKey: 'race-open-a',
      },
      {
        operation: 'open',
        now: '2026-07-24T07:00:00.000Z',
        employeeId: 'employee_b',
        pin: secondEmployeePin,
        rateKey: 'race-open-b',
      },
    ]);
    assert.equal(opened.filter((result) => result.ok).length, 1, JSON.stringify(opened));
    assert.equal(opened.filter((result) => !result.ok).length, 1, JSON.stringify(opened));
    assert.equal(
      opened.find((result) => !result.ok).code,
      'shift_conflict',
      JSON.stringify(opened),
    );
    assert.equal(
      db.prepare(`
        SELECT COUNT(*) AS count
        FROM staff_shifts
        WHERE status = 'active'
      `).get().count,
      1,
    );

    const correctionClock = new Date('2026-07-24T12:00:00.000Z');
    const correctionService = createStaffService(db, {
      nowProvider: () => new Date(correctionClock),
      bcryptRounds: 4,
    });
    const correctionManager = await correctionService.accessByPin({
      pin: managerPin,
      rateKey: 'correction-manager',
    });
    const closed = correctionService.closeShift({
      staffToken: correctionManager.staff_token,
      force: true,
      reason: 'Подготовка конкурентной проверки',
    });

    console.log('staff adversarial: stale concurrent correction loses');
    const correctionPayload = {
      operation: 'correct',
      now: '2026-07-24T12:10:00.000Z',
      shiftId: closed.id,
      staffToken: correctionManager.staff_token,
      startedAt: '2026-07-24T07:15:00.000Z',
      endedAt: '2026-07-24T11:55:00.000Z',
      reason: 'Проверка конкурентного исправления',
      expectedVersion: closed.version,
    };
    const corrected = await runRace([
      correctionPayload,
      {
        ...correctionPayload,
        startedAt: '2026-07-24T07:20:00.000Z',
      },
    ]);
    assert.equal(
      corrected.filter((result) => result.ok).length,
      1,
      JSON.stringify(corrected),
    );
    assert.equal(
      corrected.filter((result) => result.code === 'shift_conflict').length,
      1,
      JSON.stringify(corrected),
    );
    assert.equal(
      db.prepare(`
        SELECT COUNT(*) AS count
        FROM staff_shift_audit
        WHERE shift_id = ? AND action = 'correct'
      `).get(closed.id).count,
      1,
    );

    console.log('staff adversarial: raw PINs and tokens are not persisted');
    const employeeSecrets = db.prepare(`
      SELECT pin_hash, pin_fingerprint
      FROM employees
    `).all();
    for (const row of employeeSecrets) {
      for (const pin of [managerPin, firstEmployeePin, secondEmployeePin]) {
        assert.notEqual(row.pin_hash, pin);
        assert.notEqual(row.pin_fingerprint, pin);
      }
    }
    const rawTokens = [
      managerAccess.staff_token,
      employeeAccess.staff_token,
      correctionManager.staff_token,
    ];
    const storedSessions = db.prepare(`
      SELECT token_hash, ip_hash, user_agent_hash
      FROM staff_sessions
    `).all();
    for (const row of storedSessions) {
      for (const token of rawTokens) {
        assert.notEqual(row.token_hash, token);
        assert.notEqual(row.ip_hash, token);
        assert.notEqual(row.user_agent_hash, token);
      }
    }
    const auditPayloads = db.prepare(`
      SELECT before_json, after_json, reason
      FROM staff_shift_audit
    `).all();
    const serializedAudit = JSON.stringify(auditPayloads);
    for (const secret of [
      managerPin,
      firstEmployeePin,
      secondEmployeePin,
      ...rawTokens,
    ]) {
      assert.equal(serializedAudit.includes(secret), false);
    }

    console.log('staff adversarial tests passed');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
