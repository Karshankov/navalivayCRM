import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import { migrateStaffManagement } from '../migrations/add_staff_management.js';
import {
  StaffServiceError,
  createStaffService,
} from '../utils/staff-service.js';

const database = new Database(':memory:');
database.pragma('foreign_keys = ON');
database.exec(`
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE employees (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    position TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE orders (
    id TEXT PRIMARY KEY,
    created_at TEXT
  );

  CREATE TABLE procurements (
    id TEXT PRIMARY KEY,
    created_at TEXT,
    completed_at TEXT
  );

  CREATE TABLE stock_transfers (
    id TEXT PRIMARY KEY,
    created_at TEXT,
    completed_at TEXT
  );
`);
migrateStaffManagement(database);
migrateStaffManagement(database);

let now = new Date('2026-07-20T07:00:00.000Z'); // 10:00 Minsk
const service = createStaffService(database, {
  nowProvider: () => new Date(now),
  bcryptRounds: 4,
});

async function addEmployee({
  id,
  pin,
  role = 'employee',
  firstName = id,
} = {}) {
  const credentials = await service.createPinCredentials(pin);
  database.prepare(`
    INSERT INTO employees (
      id, username, password_hash, first_name, last_name, active,
      role, responsibilities, pin_hash, pin_fingerprint, pin_updated_at,
      created_at, updated_at
    ) VALUES (?, ?, 'disabled', ?, 'Тестовый', 1, ?, '[]', ?, ?, ?, ?, ?)
  `).run(
    id,
    `${id}_login`,
    firstName,
    role,
    credentials.hash,
    credentials.fingerprint,
    now.toISOString(),
    now.toISOString(),
    now.toISOString(),
  );
  return database.prepare('SELECT * FROM employees WHERE id = ?').get(id);
}

const manager = await addEmployee({
  id: 'manager',
  pin: '1000',
  role: 'manager',
  firstName: 'Марина',
});
const employeeA = await addEmployee({
  id: 'employee_a',
  pin: '2000',
  firstName: 'Анна',
});
const employeeB = await addEmployee({
  id: 'employee_b',
  pin: '3000',
  firstName: 'Борис',
});

try {
  console.log('staff service: feature flag defaults off');
  assert.equal(service.isTrackingEnabled(), false);
  service.setTrackingEnabled(true);
  assert.equal(service.isTrackingEnabled(), true);
  service.setTrackingEnabled(false);
  assert.equal(service.isTrackingEnabled(), false);
  service.setTrackingEnabled(true);
  // Отдельного выключателя обязательной смены больше нет: его роль играет учёт.
  assert.equal(service.isOrderShiftRestrictionEnabled, undefined);
  assert.equal(service.setOrderShiftRestrictionEnabled, undefined);

  console.log('staff service: four-digit and unique PIN');
  await assert.rejects(
    () => service.createPinCredentials('12a4'),
    (error) => error instanceof StaffServiceError
      && error.code === 'invalid_pin_format',
  );
  const duplicatePin = await service.createPinCredentials('2000');
  assert.throws(
    () => database.prepare(`
      UPDATE employees
      SET pin_hash = ?, pin_fingerprint = ?
      WHERE id = 'employee_b'
    `).run(duplicatePin.hash, duplicatePin.fingerprint),
    /UNIQUE constraint failed/,
  );

  console.log('staff service: PIN never appears in public output');
  const access = await service.accessByPin({
    pin: '2000',
    rateKey: 'terminal-a',
    userAgent: 'staff-test',
  });
  assert.equal(access.employee.id, employeeA.id);
  assert.equal(access.employee.pin_hash, undefined);
  assert.equal(JSON.stringify(access).includes('2000'), false);

  console.log('staff service: forged and expired token rejected');
  assert.throws(
    () => service.authenticateToken('forged'),
    (error) => error.code === 'invalid_staff_token',
  );
  now = new Date('2026-07-20T08:00:01.000Z');
  assert.throws(
    () => service.authenticateToken(access.staff_token),
    (error) => error.code === 'invalid_staff_token',
  );
  now = new Date('2026-07-20T07:00:00.000Z');

  console.log('staff service: manager scope cannot be spoofed');
  const employeeAccess = await service.accessByPin({
    pin: '2000',
    rateKey: 'terminal-b',
  });
  database.prepare(
    "UPDATE employees SET role = 'manager' WHERE id = ?",
  ).run(employeeA.id);
  assert.throws(
    () => service.authenticateToken(employeeAccess.staff_token, {
      manager: true,
    }),
    (error) => error.code === 'manager_access_required',
  );
  database.prepare(
    "UPDATE employees SET role = 'employee' WHERE id = ?",
  ).run(employeeA.id);
  const managerAccess = await service.accessByPin({
    pin: '1000',
    rateKey: 'manager-terminal',
  });
  assert.equal(
    service.authenticateToken(managerAccess.staff_token, { manager: true })
      .employee.id,
    manager.id,
  );

  console.log('staff service: different guesses hit IP-only lockout');
  for (const pin of ['4000', '4001', '4002', '4003', '4004']) {
    await assert.rejects(
      () => service.accessByPin({ pin, rateKey: 'bruteforce-ip' }),
      (error) => error.code === 'invalid_staff_credentials',
    );
  }
  await assert.rejects(
    () => service.accessByPin({ pin: '2000', rateKey: 'bruteforce-ip' }),
    (error) => error.code === 'staff_auth_locked' && error.status === 429,
  );
  assert.equal(
    (
      await service.accessByPin({
        pin: '2000',
        rateKey: 'different-terminal',
      })
    ).employee.id,
    employeeA.id,
  );

  console.log('staff service: concurrent guesses cannot outrun lockout');
  const parallelAttempts = await Promise.allSettled(
    Array.from({ length: 10 }, (_, index) => service.accessByPin({
      pin: String(4100 + index),
      rateKey: 'parallel-bruteforce-ip',
    })),
  );
  assert.equal(
    parallelAttempts.filter(
      (item) => item.status === 'rejected'
        && item.reason?.code === 'invalid_staff_credentials',
    ).length,
    5,
  );
  assert.equal(
    parallelAttempts.filter(
      (item) => item.status === 'rejected'
        && item.reason?.code === 'staff_auth_locked',
    ).length,
    5,
  );

  console.log('staff service: malformed PIN attempts are rate limited too');
  for (const pin of ['x', 'xx', 'xxx', 'xxxx', 'xxxxx']) {
    await assert.rejects(
      () => service.accessByPin({ pin, rateKey: 'malformed-bruteforce-ip' }),
      (error) => error.code === 'invalid_staff_credentials',
    );
  }
  await assert.rejects(
    () => service.accessByPin({
      pin: '2000',
      rateKey: 'malformed-bruteforce-ip',
    }),
    (error) => error.code === 'staff_auth_locked',
  );

  console.log('staff service: shift cannot open after tracking was disabled');
  now = new Date('2026-07-21T07:00:00.000Z');
  const openingWhileDisabling = service.openShift({
    employeeId: employeeA.id,
    pin: '2000',
    rateKey: 'shift-disable-race',
  });
  service.setTrackingEnabled(false);
  await assert.rejects(
    () => openingWhileDisabling,
    (error) => error.code === 'staff_tracking_disabled',
  );
  assert.equal(service.getActiveShift(), null);
  service.setTrackingEnabled(true);

  console.log('staff service: Minsk opening boundary');
  now = new Date('2026-07-21T06:59:59.000Z');
  await assert.rejects(
    () => service.openShift({
      employeeId: employeeA.id,
      pin: '2000',
      rateKey: 'shift-a',
    }),
    (error) => error.code === 'shift_open_outside_hours',
  );
  now = new Date('2026-07-21T07:00:00.000Z');
  const shiftA = await service.openShift({
    employeeId: employeeA.id,
    pin: '2000',
    rateKey: 'shift-a',
  });
  assert.equal(shiftA.shift.employee_id, employeeA.id);
  assert.equal(shiftA.shift.business_date, '2026-07-21');

  console.log('staff service: globally one active shift');
  await assert.rejects(
    () => service.openShift({
      employeeId: employeeB.id,
      pin: '3000',
      rateKey: 'shift-b',
    }),
    (error) => error.code === 'shift_conflict',
  );
  assert.equal(
    database.prepare(`
      SELECT COUNT(*) AS count FROM staff_shifts WHERE status = 'active'
    `).get().count,
    1,
  );

  console.log('staff service: active shift proof is rechecked');
  const activeProof = service.prepareShiftProof();
  assert.equal(service.recheckShiftProof(activeProof).employeeId, employeeA.id);

  console.log('staff service: employee closes and another opens same day');
  now = new Date('2026-07-21T12:00:00.000Z');
  service.closeShift({ shiftToken: shiftA.shift_token });
  let shiftB = await service.openShift({
    employeeId: employeeB.id,
    pin: '3000',
    rateKey: 'shift-b-next',
  });
  assert.equal(shiftB.shift.employee_id, employeeB.id);
  assert.equal(
    database.prepare(`
      SELECT COUNT(*) AS count
      FROM staff_shifts
      WHERE business_date = '2026-07-21'
    `).get().count,
    2,
  );

  console.log('staff service: disabling tracking closes current shift');
  service.setTrackingEnabled(false);
  assert.equal(service.getActiveShift(), null);
  assert.deepEqual(
    database.prepare(`
      SELECT status, close_reason
      FROM staff_shifts
      WHERE id = ?
    `).get(shiftB.shift.id),
    {
      status: 'auto_closed',
      close_reason: 'tracking_disabled',
    },
  );
  assert.equal(
    database.prepare(`
      SELECT COUNT(*) AS count
      FROM staff_shift_audit
      WHERE shift_id = ? AND reason = 'tracking_disabled'
    `).get(shiftB.shift.id).count,
    1,
  );
  assert.throws(
    () => service.authenticateToken(shiftB.shift_token, { allowShift: true }),
    (error) => error.code === 'invalid_staff_token',
  );
  service.setTrackingEnabled(true);
  now = new Date('2026-07-21T12:01:00.000Z');
  shiftB = await service.openShift({
    employeeId: employeeB.id,
    pin: '3000',
    rateKey: 'shift-b-after-reenable',
  });

  console.log('staff service: exact 21:15 auto closes and night shift opens');
  now = new Date('2026-07-21T18:14:59.000Z');
  const lastSecondProof = service.prepareShiftProof();
  assert.equal(
    service.recheckShiftProof(lastSecondProof).employeeId,
    employeeB.id,
  );
  now = new Date('2026-07-21T18:15:00.000Z');
  assert.deepEqual(service.expireShifts(), [shiftB.shift.id]);
  assert.throws(
    () => service.recheckShiftProof(lastSecondProof),
    (error) => error.code === 'shift_required',
  );
  assert.equal(
    database.prepare('SELECT status FROM staff_shifts WHERE id = ?')
      .get(shiftB.shift.id).status,
    'auto_closed',
  );
  // После 21:15 смена открывается как ночная: 12 часов с момента открытия,
  // плановое окончание в будущем, автозакрытием в 21:15 не снимается.
  const nightShift = await service.openShift({
    employeeId: employeeA.id,
    pin: '2000',
    rateKey: 'after-hours',
  });
  assert.equal(nightShift.shift.employee_id, employeeA.id);
  assert.equal(nightShift.shift.business_date, '2026-07-21');
  assert.equal(nightShift.shift.planned_start_at, '2026-07-21T18:15:00.000Z');
  assert.equal(nightShift.shift.planned_end_at, '2026-07-22T06:15:00.000Z');
  assert.equal(
    database.prepare(`
      SELECT COUNT(*) AS count FROM staff_shifts WHERE status = 'active'
    `).get().count,
    1,
  );
  assert.equal(service.getActiveShift().id, nightShift.shift.id);

  console.log('staff service: manager correction is reasoned and non-overlapping');
  const correctionManager = await service.accessByPin({
    pin: '1000',
    rateKey: 'manager-correction',
  });
  const correctionVersion = Number(
    database.prepare('SELECT version FROM staff_shifts WHERE id = ?')
      .get(shiftB.shift.id).version,
  );
  assert.throws(
    () => service.correctShift({
      shiftId: shiftB.shift.id,
      staffToken: correctionManager.staff_token,
      startedAt: '2026-07-21T12:30:00.000Z',
      endedAt: '2026-07-21T18:00:00.000Z',
      reason: '',
      expectedVersion: correctionVersion,
    }),
    (error) => error.code === 'reason_required',
  );
  assert.throws(
    () => service.correctShift({
      shiftId: shiftB.shift.id,
      staffToken: correctionManager.staff_token,
      startedAt: '2026-07-21T12:30',
      endedAt: '2026-07-21T18:00',
      reason: 'Строка без временной зоны',
      expectedVersion: correctionVersion,
    }),
    (error) => error.code === 'invalid_shift_period',
  );
  assert.throws(
    () => service.correctShift({
      shiftId: shiftB.shift.id,
      staffToken: correctionManager.staff_token,
      startedAt: '2026-07-21T11:59:00.000Z',
      endedAt: '2026-07-21T12:30:00.000Z',
      reason: 'Ошибочно указано время',
      expectedVersion: correctionVersion,
    }),
    (error) => error.code === 'shift_period_conflict',
  );
  const correctedShift = service.correctShift({
    shiftId: shiftB.shift.id,
    staffToken: correctionManager.staff_token,
    startedAt: '2026-07-21T12:30:00.000Z',
    endedAt: '2026-07-21T18:00:00.000Z',
    reason: 'Исправление по журналу',
    expectedVersion: correctionVersion,
  });
  assert.equal(correctedShift.started_at, '2026-07-21T12:30:00.000Z');
  assert.equal(correctedShift.ended_at, '2026-07-21T18:00:00.000Z');
  assert.equal(correctedShift.version, correctionVersion + 1);
  assert.throws(
    () => service.correctShift({
      shiftId: shiftB.shift.id,
      staffToken: correctionManager.staff_token,
      startedAt: '2026-07-21T13:00:00.000Z',
      endedAt: '2026-07-21T18:00:00.000Z',
      reason: 'Устаревшая параллельная правка',
      expectedVersion: correctionVersion,
    }),
    (error) => error.code === 'shift_conflict',
  );
  assert.throws(
    () => database.prepare(`
      DELETE FROM staff_shift_audit
      WHERE shift_id = ? AND action = 'correct'
    `).run(shiftB.shift.id),
    /immutable_staff_shift_audit/,
  );

  console.log('staff service: night shift correction uses 12h window');
  now = new Date('2026-07-22T07:00:00.000Z');
  service.expireShifts();
  const nightManager = await service.accessByPin({
    pin: '1000',
    rateKey: 'manager-night-correction',
  });
  const nightVersion = Number(
    database.prepare('SELECT version FROM staff_shifts WHERE id = ?')
      .get(nightShift.shift.id).version,
  );
  assert.throws(
    () => service.correctShift({
      shiftId: nightShift.shift.id,
      staffToken: nightManager.staff_token,
      startedAt: '2026-07-21T18:30:00.000Z',
      endedAt: '2026-07-22T07:00:00.000Z',
      reason: 'Слишком длинная смена',
      expectedVersion: nightVersion,
    }),
    (error) => error.code === 'invalid_shift_period',
  );
  const correctedNight = service.correctShift({
    shiftId: nightShift.shift.id,
    staffToken: nightManager.staff_token,
    startedAt: '2026-07-21T18:30:00.000Z',
    endedAt: '2026-07-21T23:40:00.000Z',
    reason: 'Ночная смена по журналу',
    expectedVersion: nightVersion,
  });
  assert.equal(correctedNight.business_date, '2026-07-21');
  assert.equal(correctedNight.planned_start_at, '2026-07-21T18:30:00.000Z');
  assert.equal(correctedNight.planned_end_at, '2026-07-22T06:30:00.000Z');

  console.log('staff service: actor proof fails after deactivation');
  now = new Date('2026-07-22T09:00:00.000Z');
  const actorProof = await service.prepareActorVerification({
    employeeId: employeeA.id,
    pin: '2000',
    rateKey: 'actor-a',
  });
  database.prepare(`
    UPDATE employees
    SET active = 0, deactivated_at = ?
    WHERE id = ?
  `).run(now.toISOString(), employeeA.id);
  assert.throws(
    () => service.recheckActorProof(actorProof),
    (error) => error.code === 'staff_actor_changed',
  );
  database.prepare(`
    UPDATE employees
    SET active = 1, deactivated_at = NULL
    WHERE id = ?
  `).run(employeeA.id);

  console.log('staff service: actor proof fails after PIN reset');
  const resetProof = await service.prepareActorVerification({
    employeeId: employeeA.id,
    pin: '2000',
    rateKey: 'actor-reset',
  });
  const newCredentials = await service.createPinCredentials('2001');
  database.prepare(`
    UPDATE employees
    SET pin_hash = ?, pin_fingerprint = ?, pin_updated_at = ?
    WHERE id = ?
  `).run(
    newCredentials.hash,
    newCredentials.fingerprint,
    now.toISOString(),
    employeeA.id,
  );
  assert.throws(
    () => service.recheckActorProof(resetProof),
    (error) => error.code === 'staff_actor_changed',
  );

  console.log('staff service: immutable, idempotent system event snapshot');
  const firstEvent = service.recordSystemEvent({
    employeeId: employeeA.id,
    eventType: 'procurement.created',
    entityType: 'procurement',
    entityId: 'proc-1',
    sourceNumber: 854,
    sourceType: 'procurement',
    sourceName: 'Поставка',
    idempotencyKey: 'procurement:proc-1:created',
    payload: { supplier: 'Тест' },
    happenedAt: now,
  });
  const repeatedEvent = service.recordSystemEvent({
    employeeId: employeeA.id,
    eventType: 'procurement.created',
    entityType: 'procurement',
    entityId: 'proc-1',
    sourceNumber: 854,
    sourceType: 'procurement',
    sourceName: 'Поставка',
    idempotencyKey: 'procurement:proc-1:created',
    payload: { supplier: 'Тест' },
    happenedAt: now,
  });
  assert.equal(firstEvent.created, true);
  assert.equal(repeatedEvent.created, false);
  assert.equal(
    database.prepare(`
      SELECT COUNT(*) AS count
      FROM staff_events
      WHERE idempotency_key = 'procurement:proc-1:created'
    `).get().count,
    1,
  );
  assert.throws(
    () => database.prepare(`
      UPDATE staff_events SET source_name_snapshot = 'Подмена' WHERE id = ?
    `).run(firstEvent.event.id),
    /immutable_staff_events/,
  );

  console.log('staff service: idempotent operation replays exact result');
  let executions = 0;
  const operation = () => {
    executions += 1;
    return { id: 'proc-2', ok: true };
  };
  assert.deepEqual(
    service.runIdempotentOperation({
      key: 'request-proc-2',
      operation: 'procurement.create',
      entityType: 'procurement',
      execute: operation,
    }),
    { replayed: false, result: { id: 'proc-2', ok: true } },
  );
  assert.deepEqual(
    service.runIdempotentOperation({
      key: 'request-proc-2',
      operation: 'procurement.create',
      entityType: 'procurement',
      execute: operation,
    }),
    { replayed: true, result: { id: 'proc-2', ok: true } },
  );
  assert.equal(executions, 1);

  console.log('staff service: selected employee PIN survives pepper rotation');
  const originalPepper = process.env.STAFF_PIN_PEPPER;
  try {
    process.env.STAFF_PIN_PEPPER =
      'staff-test-old-pepper-value-with-more-than-32-characters';
    const legacyCredentials = await service.createPinCredentials('2000');
    database.prepare(`
      UPDATE employees
      SET pin_hash = ?, pin_fingerprint = ?
      WHERE id = ?
    `).run(legacyCredentials.hash, legacyCredentials.fingerprint, employeeA.id);

    process.env.STAFF_PIN_PEPPER =
      'staff-test-new-pepper-value-with-more-than-32-characters';
    const verified = await service.verifyPin({
      pin: '2000',
      employeeId: employeeA.id,
      rateKey: 'pepper-rotation-regression',
    });
    assert.equal(verified.employee.id, employeeA.id);
    assert.equal(verified.fingerprint, legacyCredentials.fingerprint);
  } finally {
    if (originalPepper === undefined) delete process.env.STAFF_PIN_PEPPER;
    else process.env.STAFF_PIN_PEPPER = originalPepper;
  }

  console.log('staff-service.test.js: ok');
} finally {
  database.close();
}
