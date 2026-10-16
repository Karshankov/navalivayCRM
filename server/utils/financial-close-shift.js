import crypto from 'node:crypto';

const tableExists = (database, name) => Boolean(database.prepare(
  "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
).get(name));

/** Capture a server-selected shift inside the financial closing transaction. */
export function captureFinancialCloseShift(database, actor, businessDate) {
  if (!actor?.employeeId || !tableExists(database, 'staff_shifts')) return null;
  const shift = database.prepare(`
    SELECT * FROM staff_shifts WHERE status = 'active' AND business_date = ?
  `).get(businessDate);
  if (!shift || (shift.employee_id !== actor.employeeId && actor.role !== 'manager')) return null;
  // Ночная смена (окончание позже 21:15 своего бизнес-дня) продолжает работать
  // после закрытия финансового дня и не захватывается (Минск = UTC+3, без DST).
  const dayWindowEnd = `${businessDate}T18:15:00.000Z`;
  if (String(shift.planned_end_at) > dayWindowEnd) return null;
  return {
    id: shift.id, employee_id: shift.employee_id, business_date: shift.business_date,
    started_at: shift.started_at, version: shift.version,
  };
}

/** No network or ledger changes. Old reports without a captured shift are inert. */
export function closeFinancialShiftAfterDelivery(database, closingId, { now = new Date() } = {}) {
  if (!tableExists(database, 'financial_day_closures') || !tableExists(database, 'staff_shifts')) return false;
  return database.transaction(() => {
    const closure = database.prepare('SELECT * FROM financial_day_closures WHERE id = ?').get(closingId);
    if (!closure) return false;
    const target = JSON.parse(closure.snapshot_json).staff_shift_to_close;
    if (!target?.id || !target.employee_id || target.business_date !== closure.business_date) return false;
    const prefix = `financial-close:${closure.id}:recipient:`;
    // Compare literal prefixes, not LIKE patterns containing user-controlled wildcards.
    const deliveries = database.prepare(`
      SELECT status, sent_at FROM internal_notification_outbox
      WHERE event_type = 'shift_closed' AND substr(unique_key, 1, ?) = ?
    `).all(prefix.length, prefix);
    if (!deliveries.length || deliveries.some(row => row.status !== 'sent' || !row.sent_at)) return false;
    const shift = database.prepare('SELECT * FROM staff_shifts WHERE id = ?').get(target.id);
    if (!shift || shift.status !== 'active' || shift.employee_id !== target.employee_id
      || shift.business_date !== target.business_date || shift.started_at !== target.started_at
      || shift.version !== target.version) return false;
    const sentTimes = deliveries.map(row => new Date(row.sent_at.includes('T') ? row.sent_at : `${row.sent_at.replace(' ', 'T')}Z`).getTime());
    const plannedEnd = new Date(shift.planned_end_at).getTime();
    const startedAt = new Date(shift.started_at).getTime();
    if (!sentTimes.every(Number.isFinite) || !Number.isFinite(plannedEnd) || !Number.isFinite(startedAt)
      || !Number.isFinite(now.getTime())) throw new TypeError('invalid_financial_shift_time');
    const endedAt = new Date(Math.min(Math.max(...sentTimes), plannedEnd));
    if (endedAt.getTime() < startedAt || endedAt > now) return false;
    const at = now.toISOString();
    const reason = `financial_day_closed_report_sent:${closure.id}`;
    const updated = database.prepare(`
      UPDATE staff_shifts SET status = 'closed', ended_at = ?, close_reason = ?,
        version = version + 1, updated_at = ?
      WHERE id = ? AND employee_id = ? AND status = 'active' AND version = ?
    `).run(endedAt.toISOString(), reason, at, target.id, target.employee_id, target.version);
    if (updated.changes !== 1) return false;
    database.prepare(`
      UPDATE staff_sessions SET revoked_at = COALESCE(revoked_at, ?)
      WHERE employee_id = ? AND scope = 'shift' AND revoked_at IS NULL
    `).run(at, target.employee_id);
    const after = database.prepare('SELECT * FROM staff_shifts WHERE id = ?').get(target.id);
    database.prepare(`
      INSERT INTO staff_shift_audit
        (id, shift_id, action, actor_kind, before_json, after_json, reason, created_at)
      VALUES (?, ?, 'auto_close', 'system', ?, ?, ?, ?)
    `).run(`shift_audit_${crypto.randomUUID()}`, target.id, JSON.stringify(shift), JSON.stringify(after), reason, at);
    return true;
  }).immediate();
}

/** Recover a local follow-up failure without ever resending a delivered report. */
export function reconcileDeliveredFinancialShifts(database, { now = new Date() } = {}) {
  if (!tableExists(database, 'financial_day_closures') || !tableExists(database, 'staff_shifts')) return 0;
  const rows = database.prepare(`
    SELECT closure.id FROM financial_day_closures AS closure
    JOIN staff_shifts AS shift
      ON shift.id = json_extract(CASE WHEN json_valid(closure.snapshot_json)
        THEN closure.snapshot_json ELSE '{}' END, '$.staff_shift_to_close.id')
    WHERE shift.status = 'active'
  `).all();
  let closed = 0;
  for (const row of rows) {
    try {
      if (closeFinancialShiftAfterDelivery(database, row.id, { now })) closed++;
    } catch (error) {
      console.error('[financial-close] Delivered report shift follow-up failed:', row.id, error?.code || error?.name || 'unknown');
    }
  }
  return closed;
}
