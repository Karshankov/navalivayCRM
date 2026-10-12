import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { migrateInternalNotifications } from '../migrations/add_internal_notifications.js';
import { captureFinancialCloseShift, closeFinancialShiftAfterDelivery, reconcileDeliveredFinancialShifts } from '../utils/financial-close-shift.js';
import { deliverInternalNotification, processInternalNotifications } from '../utils/internal-notification-worker.js';

const now = () => new Date('2026-10-12T17:00:00.000Z');
function fixture() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE staff_shifts (id TEXT PRIMARY KEY, employee_id TEXT, business_date TEXT,
      started_at TEXT, planned_end_at TEXT, status TEXT, ended_at TEXT, close_reason TEXT,
      version INTEGER, updated_at TEXT);
    CREATE TABLE staff_sessions (id TEXT PRIMARY KEY, employee_id TEXT, scope TEXT, revoked_at TEXT);
    CREATE TABLE staff_shift_audit (id TEXT PRIMARY KEY, shift_id TEXT, action TEXT, actor_kind TEXT,
      before_json TEXT, after_json TEXT, reason TEXT, created_at TEXT);
    CREATE TABLE financial_day_closures (id TEXT PRIMARY KEY, business_date TEXT, snapshot_json TEXT);
    CREATE TABLE cash_accounts (id TEXT PRIMARY KEY, balance REAL);
    CREATE TABLE cash_transactions (id TEXT PRIMARY KEY, amount REAL);
    INSERT INTO cash_accounts VALUES ('cash', 230), ('revenue', 420);
    INSERT INTO cash_transactions VALUES ('settlement', 690);
    INSERT INTO staff_shifts VALUES ('shift-1', 'employee-1', '2026-10-12',
      '2026-10-12T07:00:00.000Z', '2026-10-12T18:15:00.000Z', 'active', NULL, NULL, 1,
      '2026-10-12T07:00:00.000Z');
    INSERT INTO staff_sessions VALUES ('shift-token', 'employee-1', 'shift', NULL),
      ('personal-token', 'employee-1', 'staff', NULL), ('other-token', 'employee-2', 'shift', NULL);
  `);
  migrateInternalNotifications(db);
  const target = captureFinancialCloseShift(db, { employeeId: 'employee-1', role: 'employee' }, '2026-10-12');
  db.prepare('INSERT INTO financial_day_closures VALUES (?, ?, ?)')
    .run('close_%_1', '2026-10-12', JSON.stringify({ staff_shift_to_close: target }));
  function queue(status = 'pending', suffix = '1') {
    return db.prepare(`INSERT INTO internal_notification_outbox
      (unique_key, event_type, recipient_telegram_id, payload_json, status, next_attempt_at, sent_at)
      VALUES (?, 'shift_closed', '123456789', ?, ?, '2026-10-12 16:50:00', ?)`)
      .run(`financial-close:close_%_1:recipient:${suffix}`,
        JSON.stringify({ closing_id: 'close_%_1', text: 'Saved report' }), status,
        status === 'sent' ? '2026-10-12 17:00:00' : null).lastInsertRowid;
  }
  const shift = () => db.prepare("SELECT * FROM staff_shifts WHERE id = 'shift-1'").get();
  const ledger = () => ({ accounts: db.prepare('SELECT * FROM cash_accounts ORDER BY id').all(),
    transactions: db.prepare('SELECT * FROM cash_transactions ORDER BY id').all() });
  return { db, target, queue, shift, ledger };
}
function scenario(name, run) {
  test(name, async () => { const f = fixture(); try { await run(f); } finally { f.db.close(); } });
}

scenario('capture selects only an authorized same-day shift; manager can capture the active employee shift', f => {
  assert.equal(f.target.id, 'shift-1');
  assert.equal(captureFinancialCloseShift(f.db, { employeeId: 'employee-2', role: 'employee' }, '2026-10-12'), null);
  assert.equal(captureFinancialCloseShift(f.db, { employeeId: 'employee-1', role: 'employee' }, '2026-10-13'), null);
  assert.equal(captureFinancialCloseShift(f.db, { employeeId: null, role: 'admin' }, '2026-10-12'), null);
  assert.equal(captureFinancialCloseShift(f.db, { employeeId: 'manager', role: 'manager' }, '2026-10-12').employee_id, 'employee-1');
});

scenario('confirmed delivery closes the captured shift once and never repeats ledger or Telegram operations', async f => {
  const baseline = f.ledger(); const id = f.queue(); let sends = 0;
  const sender = async request => { sends++; assert.equal(request.text, 'Saved report'); return { ok: true, telegram_message_id: 42 }; };
  const row = f.db.prepare('SELECT * FROM internal_notification_outbox WHERE id = ?').get(id);
  const result = await deliverInternalNotification(f.db, row, { now: now(), sender });
  assert.equal(result.outcome, 'sent'); assert.equal(f.shift().status, 'closed');
  assert.equal(f.shift().ended_at, now().toISOString());
  assert.match(f.shift().close_reason, /^financial_day_closed_report_sent:/);
  assert.equal(f.db.prepare("SELECT revoked_at FROM staff_sessions WHERE id = 'shift-token'").get().revoked_at, now().toISOString());
  assert.equal(f.db.prepare("SELECT revoked_at FROM staff_sessions WHERE id = 'personal-token'").get().revoked_at, null);
  assert.equal(f.db.prepare("SELECT revoked_at FROM staff_sessions WHERE id = 'other-token'").get().revoked_at, null);
  await processInternalNotifications(f.db, { now: now(), sender });
  assert.equal(sends, 1); assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM staff_shift_audit').get().n, 1);
  assert.deepEqual(f.ledger(), baseline);
});

scenario('all captured recipients must confirm delivery; retry, unknown and absent recipients do not close shifts', f => {
  assert.equal(closeFinancialShiftAfterDelivery(f.db, 'close_%_1', { now: now() }), false);
  f.queue('sent', '1'); const second = f.queue('retry', '2');
  for (const status of ['pending', 'sending', 'retry', 'unknown', 'failed', 'cancelled']) {
    f.db.prepare('UPDATE internal_notification_outbox SET status = ? WHERE id = ?').run(status, second);
    assert.equal(closeFinancialShiftAfterDelivery(f.db, 'close_%_1', { now: now() }), false, status);
    assert.equal(f.shift().status, 'active');
  }
  f.db.prepare("UPDATE internal_notification_outbox SET status = 'sent', sent_at = '2026-10-12 17:00:00' WHERE id = ?").run(second);
  assert.equal(closeFinancialShiftAfterDelivery(f.db, 'close_%_1', { now: now() }), true);
});

scenario('ambiguous send leaves the shift open and does not automatically resend', async f => {
  const id = f.queue(); let sends = 0;
  const sender = async () => { sends++; throw new Error('delivery result unknown'); };
  const row = f.db.prepare('SELECT * FROM internal_notification_outbox WHERE id = ?').get(id);
  assert.equal((await deliverInternalNotification(f.db, row, { now: now(), sender })).outcome, 'unknown');
  await processInternalNotifications(f.db, { now: new Date('2026-10-12T17:10:00Z'), sender });
  assert.equal(sends, 1); assert.equal(f.shift().status, 'active');
});

scenario('delayed delivery cannot close a new shift or a changed captured shift', f => {
  f.queue('sent');
  f.db.exec("UPDATE staff_shifts SET version = 2 WHERE id = 'shift-1'");
  assert.equal(closeFinancialShiftAfterDelivery(f.db, 'close_%_1', { now: now() }), false);
  f.db.exec("UPDATE staff_shifts SET status = 'closed' WHERE id = 'shift-1'; INSERT INTO staff_shifts VALUES ('shift-2', 'employee-1', '2026-10-12', '2026-10-12T16:00:00.000Z', '2026-10-12T18:15:00.000Z', 'active', NULL, NULL, 1, '2026-10-12T16:00:00.000Z');");
  assert.equal(reconcileDeliveredFinancialShifts(f.db, { now: now() }), 0);
  assert.equal(f.db.prepare("SELECT status FROM staff_shifts WHERE id = 'shift-2'").get().status, 'active');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM staff_shift_audit').get().n, 0);
});

scenario('legacy snapshot and wildcard lookalike notification keys are inert', f => {
  f.db.prepare('UPDATE financial_day_closures SET snapshot_json = ?').run('{}');
  f.queue('sent');
  assert.equal(closeFinancialShiftAfterDelivery(f.db, 'close_%_1', { now: now() }), false);
  f.db.prepare('UPDATE financial_day_closures SET snapshot_json = ?').run(JSON.stringify({ staff_shift_to_close: f.target }));
  f.db.exec("UPDATE internal_notification_outbox SET unique_key = 'financial-close:close_X_1:recipient:1'");
  assert.equal(closeFinancialShiftAfterDelivery(f.db, 'close_%_1', { now: now() }), false);
});

scenario('failed audit rolls back shift and token updates; a later worker cycle recovers without resending', async f => {
  const id = f.queue(); let sends = 0; const baseline = f.ledger();
  f.db.exec("CREATE TRIGGER reject_shift_audit BEFORE INSERT ON staff_shift_audit BEGIN SELECT RAISE(ABORT, 'test_audit_failure'); END;");
  const sender = async () => { sends++; return { ok: true, telegram_message_id: 43 }; };
  const row = f.db.prepare('SELECT * FROM internal_notification_outbox WHERE id = ?').get(id);
  const result = await deliverInternalNotification(f.db, row, { now: now(), sender });
  assert.equal(result.outcome, 'sent'); assert.equal(f.shift().status, 'active');
  assert.equal(f.db.prepare("SELECT revoked_at FROM staff_sessions WHERE id = 'shift-token'").get().revoked_at, null);
  assert.equal(f.db.prepare('SELECT status FROM internal_notification_outbox WHERE id = ?').get(id).status, 'sent');
  f.db.exec('DROP TRIGGER reject_shift_audit');
  await processInternalNotifications(f.db, { now: new Date('2026-10-12T17:01:00Z'), sender });
  assert.equal(sends, 1); assert.equal(f.shift().status, 'closed');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM staff_shift_audit').get().n, 1);
  assert.deepEqual(f.ledger(), baseline);
});

scenario('late confirmed delivery never extends shift time past the scheduled end', f => {
  const id = f.queue('sent');
  f.db.prepare('UPDATE internal_notification_outbox SET sent_at = ? WHERE id = ?').run('2026-10-12 19:00:00', id);
  assert.equal(closeFinancialShiftAfterDelivery(f.db, 'close_%_1', { now: new Date('2026-10-12T19:01:00Z') }), true);
  assert.equal(f.shift().ended_at, '2026-10-12T18:15:00.000Z');
});
