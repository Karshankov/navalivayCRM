import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

import { db } from '../db.js';
import {
  getTimeZoneDateParts,
  getUtcDateForTimeZoneLocalTime,
} from './business-time.js';
import {
  resolveStaffPinPepper,
} from './staff-security-config.js';

export { assertStaffSecurityConfig } from './staff-security-config.js';

const PIN_RE = /^\d{4}$/;
const ISO_WITH_TIME_ZONE_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i;
const DEFAULT_SESSION_TTL_MS = 30 * 60_000;
const DEFAULT_MANAGER_SESSION_TTL_MS = 20 * 60_000;
const ACTOR_PROOF_TTL_MS = 2 * 60_000;
const LOGIN_WINDOW_MS = 10 * 60_000;
const LOGIN_LOCK_MS = 15 * 60_000;
const LOGIN_MAX_FAILURES = 5;
const SHIFT_START_MINUTE = 10 * 60;
const SHIFT_END_MINUTE = 21 * 60 + 15;
// Сотрудники с этими должностями могут открывать смену в любое время —
// для тестирования ночных сценариев выдачи заказов (владелец, 2026-10-09).
const SHIFT_ANY_TIME_POSITIONS = new Set(['тестировщик', 'tester']);
const SHIFT_SCHEDULER_INTERVAL_MS = 30_000;
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

let shiftSchedulerTimer = null;

export class StaffServiceError extends Error {
  constructor(code, status = 400, details = null) {
    super(code);
    this.name = 'StaffServiceError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function nowIso(now = new Date()) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new StaffServiceError('invalid_date');
  }
  return now.toISOString();
}

function id(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
}

function safeJson(value, fallback = {}) {
  try {
    return JSON.stringify(value ?? fallback);
  } catch {
    return JSON.stringify(fallback);
  }
}

function parseJson(value, fallback = null) {
  try {
    return JSON.parse(String(value ?? ''));
  } catch {
    return fallback;
  }
}

function normalizePin(pin) {
  const value = String(pin ?? '').trim();
  if (!PIN_RE.test(value)) {
    throw new StaffServiceError('invalid_pin_format', 400);
  }
  return value;
}

function normalizeIdempotencyKey(key, required = false) {
  const normalized = String(key ?? '').trim();
  if (!normalized && !required) return null;
  if (!normalized) throw new StaffServiceError('idempotency_key_required', 400);
  if (normalized.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new StaffServiceError('idempotency_key_too_long', 400);
  }
  return normalized;
}

function getPinPepper() {
  try {
    return resolveStaffPinPepper();
  } catch (error) {
    if (error?.code === 'staff_pin_pepper_not_configured') {
      throw new StaffServiceError(error.code, error.status);
    }
    throw error;
  }
}

function hmac(value, purpose) {
  return crypto
    .createHmac('sha256', getPinPepper())
    .update(`${purpose}\0${String(value)}`)
    .digest('hex');
}

function pinFingerprint(pin) {
  return hmac(normalizePin(pin), 'staff-pin-fingerprint-v1');
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function employeeName(employee) {
  return `${employee?.first_name || ''} ${employee?.last_name || ''}`.trim()
    || 'Сотрудник';
}

function businessDate(parts) {
  return [
    String(parts.year).padStart(4, '0'),
    String(parts.month).padStart(2, '0'),
    String(parts.day).padStart(2, '0'),
  ].join('-');
}

function getShiftWindow(now = new Date()) {
  const parts = getTimeZoneDateParts(now, 'Europe/Minsk');
  const start = getUtcDateForTimeZoneLocalTime(
    parts.year,
    parts.month,
    parts.day,
    10,
    0,
    0,
    'Europe/Minsk',
  );
  const end = getUtcDateForTimeZoneLocalTime(
    parts.year,
    parts.month,
    parts.day,
    21,
    15,
    0,
    'Europe/Minsk',
  );
  return {
    parts,
    businessDate: businessDate(parts),
    minute: parts.hour * 60 + parts.minute,
    start,
    end,
  };
}

function getAnyTimeShiftWindow(now = new Date()) {
  const window = getShiftWindow(now);
  const start = now < window.start ? window.start : new Date(now);
  // 12-часовая смена для тестировочных сценариев: переживает полночь
  // и не закрывается автозакрытием в 21:15.
  const end = new Date(start.getTime() + 12 * 60 * 60 * 1000);
  return { ...window, start, end, minute: 12 * 60 + 60 };
}

function publicEmployee(row) {
  if (!row) return null;
  return {
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    position: row.position || null,
    responsibilities: parseJson(row.responsibilities, []),
    avatar_url: row.avatar_url || null,
    color: row.color || null,
    role: row.role === 'manager' ? 'manager' : 'employee',
    active: Number(row.active || 0),
    deactivated_at: row.deactivated_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

function publicShift(row) {
  if (!row) return null;
  return {
    id: row.id,
    employee_id: row.employee_id,
    employee_name: row.employee_name_snapshot,
    employee: row.employee_first_name
      ? {
          id: row.employee_id,
          first_name: row.employee_first_name,
          last_name: row.employee_last_name || '',
          avatar_url: row.employee_avatar_url || null,
          color: row.employee_color || null,
          position: row.employee_position || null,
        }
      : null,
    business_date: row.business_date,
    planned_start_at: row.planned_start_at,
    planned_end_at: row.planned_end_at,
    started_at: row.started_at,
    ended_at: row.ended_at || null,
    status: row.status,
    close_reason: row.close_reason || null,
    version: Number(row.version || 1),
  };
}

function staffErrorResponse(res, error) {
  const status = Number(error?.status) || 500;
  const code = error?.code || 'staff_operation_failed';
  const body = { error: code };
  if (error?.details && typeof error.details === 'object') {
    Object.assign(body, error.details);
  }
  return res.status(status).json(body);
}

export function createStaffService(database, {
  nowProvider = () => new Date(),
  bcryptRounds = Number(process.env.STAFF_PIN_BCRYPT_ROUNDS) || 12,
} = {}) {
  if (!database?.prepare || !database?.transaction) {
    throw new TypeError('database_required');
  }

  let dummyHashPromise = null;
  const dummyHash = () => {
    if (!dummyHashPromise) {
      dummyHashPromise = bcrypt.hash(
        `invalid-${crypto.randomBytes(16).toString('hex')}`,
        bcryptRounds,
      );
    }
    return dummyHashPromise;
  };

  function currentNow(explicit) {
    return explicit || nowProvider();
  }

  function isTrackingEnabled() {
    const row = database
      .prepare("SELECT value FROM settings WHERE key = 'staff_tracking_enabled'")
      .get();
    return ['1', 'true', 'yes', 'on'].includes(
      String(row?.value || '').trim().toLowerCase(),
    );
  }

  function setTrackingEnabled(enabled) {
    const changedAt = currentNow();
    const changedAtIso = nowIso(changedAt);
    database.transaction(() => {
      database.prepare(`
        INSERT INTO settings (key, value)
        VALUES ('staff_tracking_enabled', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(enabled ? 'true' : 'false');
      if (!enabled) {
        const shift = database.prepare(`
          SELECT *
          FROM staff_shifts
          WHERE status = 'active'
          LIMIT 1
        `).get();
        if (shift) {
          const expiredBySchedule = shift.planned_end_at <= changedAtIso;
          const closeReason = expiredBySchedule
            ? 'automatic_21_15'
            : 'tracking_disabled';
          const endedAt = expiredBySchedule
            ? shift.planned_end_at
            : changedAtIso;
          const updated = database.prepare(`
            UPDATE staff_shifts
            SET status = 'auto_closed',
                ended_at = ?,
                close_reason = ?,
                version = version + 1,
                updated_at = ?
            WHERE id = ? AND status = 'active'
          `).run(endedAt, closeReason, changedAtIso, shift.id);
          if (updated.changes === 1) {
            database.prepare(`
              UPDATE staff_sessions
              SET revoked_at = COALESCE(revoked_at, ?)
              WHERE employee_id = ?
                AND scope = 'shift'
                AND revoked_at IS NULL
            `).run(changedAtIso, shift.employee_id);
            const after = database.prepare(`
              SELECT *
              FROM staff_shifts
              WHERE id = ?
            `).get(shift.id);
            database.prepare(`
              INSERT INTO staff_shift_audit (
                id, shift_id, action, actor_kind, before_json, after_json,
                reason, created_at
              ) VALUES (?, ?, 'auto_close', 'system', ?, ?, ?, ?)
            `).run(
              id('shift_audit'),
              shift.id,
              safeJson(shift),
              safeJson(after),
              closeReason,
              changedAtIso,
            );
          }
        }
      }
    }).immediate();
    return Boolean(enabled);
  }

  async function createPinCredentials(pin) {
    const normalized = normalizePin(pin);
    const fingerprint = pinFingerprint(normalized);
    const hash = await bcrypt.hash(normalized, bcryptRounds);
    return { hash, fingerprint };
  }

  function loginScopeKeys({
    rateKey = 'unknown',
    employeeId = '',
    fingerprint,
  }) {
    return [
      hmac(String(rateKey), 'staff-login-ip-scope-v1'),
      hmac(
        `${String(employeeId)}\0${fingerprint}`,
        'staff-login-pin-scope-v1',
      ),
    ];
  }

  function lockedAttempt(scopeKey, now) {
    const row = database
      .prepare('SELECT * FROM staff_login_attempts WHERE scope_key = ?')
      .get(scopeKey);
    if (!row?.locked_until) return null;
    const until = new Date(row.locked_until);
    return until.getTime() > now.getTime() ? until : null;
  }

  function reserveLoginAttempt(scopeKeys, now) {
    return database.transaction(() => {
      const lock = scopeKeys
        .map((scopeKey) => lockedAttempt(scopeKey, now))
        .filter(Boolean)
        .sort((a, b) => b.getTime() - a.getTime())[0];
      if (lock) {
        throw new StaffServiceError('staff_auth_locked', 429, {
          retry_after_seconds: Math.max(
            1,
            Math.ceil((lock.getTime() - now.getTime()) / 1000),
          ),
        });
      }

      for (const scopeKey of scopeKeys) {
        const current = database
          .prepare('SELECT * FROM staff_login_attempts WHERE scope_key = ?')
          .get(scopeKey);
        const windowStarted = current?.window_started_at
          ? new Date(current.window_started_at)
          : null;
        const inWindow =
          windowStarted
          && now.getTime() - windowStarted.getTime() <= LOGIN_WINDOW_MS;
        const failures = inWindow ? Number(current.failures || 0) + 1 : 1;
        const startedAt = inWindow ? current.window_started_at : nowIso(now);
        const lockedUntil =
          failures >= LOGIN_MAX_FAILURES
            ? nowIso(new Date(now.getTime() + LOGIN_LOCK_MS))
            : null;
        database.prepare(`
          INSERT INTO staff_login_attempts (
            scope_key, failures, window_started_at, last_failed_at, locked_until
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(scope_key) DO UPDATE SET
            failures = excluded.failures,
            window_started_at = excluded.window_started_at,
            last_failed_at = excluded.last_failed_at,
            locked_until = excluded.locked_until
        `).run(scopeKey, failures, startedAt, nowIso(now), lockedUntil);
      }
    }).immediate();
  }

  function releaseSuccessfulLoginAttempt(scopeKeys) {
    database.transaction(() => {
      for (const scopeKey of scopeKeys) {
        const row = database
          .prepare('SELECT failures FROM staff_login_attempts WHERE scope_key = ?')
          .get(scopeKey);
        const remaining = Math.max(0, Number(row?.failures || 0) - 1);
        if (remaining === 0) {
          database
            .prepare('DELETE FROM staff_login_attempts WHERE scope_key = ?')
            .run(scopeKey);
        } else {
          database.prepare(`
            UPDATE staff_login_attempts
            SET failures = ?, locked_until = NULL
            WHERE scope_key = ?
          `).run(remaining, scopeKey);
        }
      }
    }).immediate();
  }

  async function verifyPin({
    pin,
    employeeId = null,
    rateKey = 'unknown',
    now = null,
  } = {}) {
    const checkedAt = currentNow(now);
    let normalized;
    try {
      normalized = normalizePin(pin);
    } catch {
      const invalidScopeKeys = loginScopeKeys({
        rateKey,
        employeeId,
        fingerprint: hmac(String(pin ?? ''), 'invalid-staff-pin-v1'),
      });
      try {
        reserveLoginAttempt(invalidScopeKeys, checkedAt);
      } catch (error) {
        await bcrypt.compare(String(pin ?? ''), await dummyHash());
        throw error;
      }
      await bcrypt.compare(String(pin ?? ''), await dummyHash());
      throw new StaffServiceError('invalid_staff_credentials', 401);
    }
    const fingerprint = pinFingerprint(normalized);
    const scopeKeys = loginScopeKeys({ rateKey, employeeId, fingerprint });
    try {
      reserveLoginAttempt(scopeKeys, checkedAt);
    } catch (error) {
      // Выполняем сравнение и при блокировке, чтобы ответ не был быстрым
      // индикатором существования ПИН.
      await bcrypt.compare(normalized, await dummyHash());
      throw error;
    }

    // The bcrypt hash is the credential authority. The fingerprint is only
    // an index for PIN-only login and may have been generated with an older
    // STAFF_PIN_PEPPER. For shift opening, use the selected employee's hash
    // directly so rotating that key does not invalidate existing PINs.
    let employee = employeeId
      ? database.prepare(`
          SELECT *
          FROM employees
          WHERE id = ?
          LIMIT 1
        `).get(String(employeeId))
      : database.prepare(`
          SELECT *
          FROM employees
          WHERE pin_fingerprint = ?
          LIMIT 1
        `).get(fingerprint);

    let matches = await bcrypt.compare(
      normalized,
      employee?.pin_hash || (await dummyHash()),
    );

    // If the fingerprint lookup misses after a pepper rotation, locate the
    // employee by checking the stored bcrypt hashes. Keep the generic failure
    // response, and reject ambiguous matches rather than choosing an account.
    if (!employee && !employeeId) {
      const candidates = database.prepare(`
        SELECT *
        FROM employees
        WHERE pin_hash IS NOT NULL
        ORDER BY id
      `).all();
      let matchedEmployee = null;
      let ambiguousMatch = false;
      for (const candidate of candidates) {
        const candidateMatches = await bcrypt.compare(
          normalized,
          candidate.pin_hash,
        );
        if (candidateMatches) {
          if (matchedEmployee) ambiguousMatch = true;
          else matchedEmployee = candidate;
        }
      }
      if (!ambiguousMatch && matchedEmployee) {
        employee = matchedEmployee;
        matches = true;
      }
    }

    const accepted =
      matches &&
      employee &&
      Number(employee.active || 0) === 1 &&
      !employee.deactivated_at;
    if (!accepted) {
      throw new StaffServiceError('invalid_staff_credentials', 401);
    }

    releaseSuccessfulLoginAttempt(scopeKeys);
    return {
      employee,
      fingerprint: employee.pin_fingerprint,
      checkedAt,
    };
  }

  function revokeSessions(employeeId, now = currentNow()) {
    return database.prepare(`
      UPDATE staff_sessions
      SET revoked_at = COALESCE(revoked_at, ?)
      WHERE employee_id = ? AND revoked_at IS NULL
    `).run(nowIso(now), employeeId).changes;
  }

  function buildSession(employee, {
    rateKey = '',
    userAgent = '',
    now = currentNow(),
    scope = null,
    expiresAt = null,
  } = {}) {
    const token = crypto.randomBytes(32).toString('base64url');
    const ttl =
      employee.role === 'manager'
        ? DEFAULT_MANAGER_SESSION_TTL_MS
        : DEFAULT_SESSION_TTL_MS;
    const sessionExpiresAt = expiresAt || new Date(now.getTime() + ttl);
    return {
      token,
      row: {
        id: id('staff_session'),
        employeeId: employee.id,
        tokenHash: tokenHash(token),
        scope:
          scope || (employee.role === 'manager' ? 'manager' : 'employee'),
        issuedAt: nowIso(now),
        expiresAt: nowIso(sessionExpiresAt),
        ipHash: rateKey ? hmac(rateKey, 'staff-session-ip-v1') : null,
        userAgentHash: userAgent
          ? hmac(userAgent, 'staff-session-agent-v1')
          : null,
      },
    };
  }

  function insertSession(session) {
    database.prepare(`
      INSERT INTO staff_sessions (
        id, employee_id, token_hash, scope, issued_at, expires_at,
        ip_hash, user_agent_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      session.row.id,
      session.row.employeeId,
      session.row.tokenHash,
      session.row.scope,
      session.row.issuedAt,
      session.row.expiresAt,
      session.row.ipHash,
      session.row.userAgentHash,
    );
    return {
      staff_token: session.token,
      expires_at: session.row.expiresAt,
    };
  }

  function issueSession(employee, options = {}) {
    return insertSession(buildSession(employee, options));
  }

  function authenticateToken(token, {
    manager = false,
    allowShift = false,
    now = currentNow(),
  } = {}) {
    const raw = String(token || '').trim();
    if (!raw) throw new StaffServiceError('invalid_staff_token', 401);
    const row = database.prepare(`
      SELECT
        session.*,
        employee.first_name,
        employee.last_name,
        employee.position,
        employee.responsibilities,
        employee.avatar_url,
        employee.color,
        employee.role,
        employee.active,
        employee.deactivated_at,
        employee.created_at,
        employee.updated_at
      FROM staff_sessions AS session
      INNER JOIN employees AS employee ON employee.id = session.employee_id
      WHERE session.token_hash = ?
        AND session.revoked_at IS NULL
        AND session.expires_at > ?
        AND employee.active = 1
        AND employee.deactivated_at IS NULL
      LIMIT 1
    `).get(tokenHash(raw), nowIso(now));
    const allowedScope =
      row &&
      (
        row.scope === 'employee' ||
        row.scope === 'manager' ||
        (allowShift && row.scope === 'shift')
      );
    if (
      !row
      || !allowedScope
      || (manager && (row.role !== 'manager' || row.scope !== 'manager'))
    ) {
      throw new StaffServiceError(
        manager ? 'manager_access_required' : 'invalid_staff_token',
        manager ? 403 : 401,
      );
    }
    database.prepare(`
      UPDATE staff_sessions
      SET last_seen_at = ?
      WHERE id = ?
    `).run(nowIso(now), row.id);
    return {
      session: row,
      employee: publicEmployee({ ...row, id: row.employee_id }),
      rawEmployee: { ...row, id: row.employee_id },
    };
  }

  async function accessByPin({
    pin,
    rateKey = 'unknown',
    userAgent = '',
    now = null,
  } = {}) {
    const checkedAt = currentNow(now);
    const verified = await verifyPin({ pin, rateKey, now: checkedAt });
    const session = buildSession(verified.employee, {
      rateKey,
      userAgent,
      now: checkedAt,
    });
    const inserted = database.transaction(() => {
      database.prepare(`
        UPDATE employees
        SET last_staff_login_at = ?, updated_at = ?
        WHERE id = ?
      `).run(nowIso(checkedAt), nowIso(checkedAt), verified.employee.id);
      return insertSession(session);
    }).immediate();
    return {
      ...inserted,
      role: verified.employee.role === 'manager' ? 'manager' : 'employee',
      employee: publicEmployee(verified.employee),
    };
  }

  function expireShifts({ now = currentNow() } = {}) {
    const at = nowIso(now);
    const shifts = database.prepare(`
      SELECT shift.*
      FROM staff_shifts AS shift
      LEFT JOIN employees AS employee ON employee.id = shift.employee_id
      WHERE shift.status = 'active'
        AND (
          shift.planned_end_at <= ?
          OR employee.id IS NULL
          OR employee.active <> 1
          OR employee.deactivated_at IS NOT NULL
        )
    `).all(at);
    if (!shifts.length) return [];
    return database.transaction(() => {
      const closed = [];
      for (const shift of shifts) {
        const reason =
          shift.planned_end_at <= at
            ? 'automatic_21_15'
            : 'employee_deactivated';
        const endedAt =
          reason === 'automatic_21_15' ? shift.planned_end_at : at;
        const updated = database.prepare(`
          UPDATE staff_shifts
          SET status = 'auto_closed',
              ended_at = ?,
              close_reason = ?,
              version = version + 1,
              updated_at = ?
          WHERE id = ? AND status = 'active'
        `).run(endedAt, reason, at, shift.id);
        if (updated.changes !== 1) continue;
        database.prepare(`
          UPDATE staff_sessions
          SET revoked_at = COALESCE(revoked_at, ?)
          WHERE employee_id = ?
            AND scope = 'shift'
            AND revoked_at IS NULL
        `).run(at, shift.employee_id);
        database.prepare(`
          INSERT INTO staff_shift_audit (
            id, shift_id, action, actor_kind, before_json, after_json,
            reason, created_at
          ) VALUES (?, ?, 'auto_close', 'system', ?, ?, ?, ?)
        `).run(
          id('shift_audit'),
          shift.id,
          safeJson(shift),
          safeJson({ ...shift, status: 'auto_closed', ended_at: endedAt }),
          reason,
          at,
        );
        closed.push(shift.id);
      }
      return closed;
    }).immediate();
  }

  function activeShift({ now = currentNow(), expire = true } = {}) {
    if (expire) expireShifts({ now });
    return database.prepare(`
      SELECT
        shift.*,
        employee.first_name AS employee_first_name,
        employee.last_name AS employee_last_name,
        employee.position AS employee_position,
        employee.avatar_url AS employee_avatar_url,
        employee.color AS employee_color
      FROM staff_shifts AS shift
      LEFT JOIN employees AS employee ON employee.id = shift.employee_id
      WHERE shift.status = 'active'
      LIMIT 1
    `).get();
  }

  function getActiveShift(employeeId = null, options = {}) {
    const shift = activeShift(options);
    if (!shift) return null;
    if (employeeId && String(shift.employee_id) !== String(employeeId)) {
      return null;
    }
    return publicShift(shift);
  }

  function prepareShiftProof({ now = currentNow() } = {}) {
    expireShifts({ now });
    const shift = activeShift({ now, expire: false });
    if (!shift) throw new StaffServiceError('shift_required', 409);
    return {
      shiftId: shift.id,
      employeeId: shift.employee_id,
      plannedEndAt: shift.planned_end_at,
      checkedAt: now.toISOString(),
    };
  }

  function recheckShiftProof(proof, { now = currentNow() } = {}) {
    if (!proof?.shiftId || !proof?.employeeId) {
      throw new StaffServiceError('shift_required', 409);
    }
    const shift = database.prepare(`
      SELECT
        shift.*,
        employee.first_name AS employee_first_name,
        employee.last_name AS employee_last_name,
        employee.position AS employee_position,
        employee.avatar_url AS employee_avatar_url,
        employee.color AS employee_color
      FROM staff_shifts AS shift
      INNER JOIN employees AS employee ON employee.id = shift.employee_id
      WHERE shift.id = ?
        AND shift.employee_id = ?
        AND shift.status = 'active'
        AND shift.planned_end_at > ?
        AND employee.active = 1
        AND employee.deactivated_at IS NULL
      LIMIT 1
    `).get(proof.shiftId, proof.employeeId, nowIso(now));
    if (!shift) throw new StaffServiceError('shift_required', 409);
    return {
      shift,
      publicShift: publicShift(shift),
      employeeId: shift.employee_id,
    };
  }

  async function openShift({
    employeeId,
    pin,
    rateKey = 'unknown',
    userAgent = '',
    now = null,
  } = {}) {
    const openedAt = currentNow(now);
    const requestedEmployee = database
      .prepare('SELECT position FROM employees WHERE id = ? AND active = 1')
      .get(String(employeeId || ''));
    const position = String(requestedEmployee?.position || '').trim().toLowerCase();
    const anyTimeAllowed = SHIFT_ANY_TIME_POSITIONS.has(position);
    // Для тестировочных должностей окно = любые 12 часов с момента открытия;
    // для остальных — обычное окно 10:00–21:15 по Минску.
    const window = anyTimeAllowed
      ? getAnyTimeShiftWindow(openedAt)
      : getShiftWindow(openedAt);
    if (
      !anyTimeAllowed &&
      (window.minute < SHIFT_START_MINUTE ||
        window.minute >= SHIFT_END_MINUTE)
    ) {
      throw new StaffServiceError('shift_open_outside_hours', 409, {
        opens_at: window.start.toISOString(),
        closes_at: window.end.toISOString(),
      });
    }
    expireShifts({ now: openedAt });
    const verified = await verifyPin({
      pin,
      employeeId,
      rateKey,
      now: openedAt,
    });
    const proof = {
      employeeId: verified.employee.id,
      fingerprint: verified.fingerprint,
      checkedAt: openedAt,
      expiresAt: new Date(openedAt.getTime() + ACTOR_PROOF_TTL_MS),
      shiftId: null,
    };
    const shiftId = id('shift');
    const session = buildSession(verified.employee, {
      rateKey,
      userAgent,
      now: openedAt,
    });
    const shiftSession = buildSession(verified.employee, {
      rateKey,
      userAgent,
      now: openedAt,
      scope: 'shift',
      expiresAt: window.end,
    });

    try {
      const result = database.transaction(() => {
        if (!isTrackingEnabled()) {
          throw new StaffServiceError('staff_tracking_disabled', 409);
        }
        recheckActorProof(proof, {
          requireActiveShift: false,
          now: openedAt,
        });
        const existing = activeShift({ now: openedAt, expire: false });
        if (existing) {
          throw new StaffServiceError('shift_conflict', 409, {
            shift: publicShift(existing),
          });
        }
        const snapshot = employeeName(verified.employee);
        database.prepare(`
          INSERT INTO staff_shifts (
            id, employee_id, employee_name_snapshot, business_date,
            planned_start_at, planned_end_at, started_at, status,
            created_by_employee_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
        `).run(
          shiftId,
          verified.employee.id,
          snapshot,
          window.businessDate,
          window.start.toISOString(),
          window.end.toISOString(),
          openedAt.toISOString(),
          verified.employee.id,
          openedAt.toISOString(),
          openedAt.toISOString(),
        );
        const created = database
          .prepare('SELECT * FROM staff_shifts WHERE id = ?')
          .get(shiftId);
        database.prepare(`
          INSERT INTO staff_shift_audit (
            id, shift_id, action, actor_employee_id, actor_name_snapshot,
            actor_kind, before_json, after_json, created_at
          ) VALUES (?, ?, 'open', ?, ?, 'employee', NULL, ?, ?)
        `).run(
          id('shift_audit'),
          shiftId,
          verified.employee.id,
          snapshot,
          safeJson(created),
          openedAt.toISOString(),
        );
        return {
          session: insertSession(session),
          shiftSession: insertSession(shiftSession),
          shift: created,
        };
      }).immediate();
      return {
        ...result.session,
        shift_token: result.shiftSession.staff_token,
        shift_token_expires_at: result.shiftSession.expires_at,
        role:
          verified.employee.role === 'manager' ? 'manager' : 'employee',
        employee: publicEmployee(verified.employee),
        shift: publicShift({
          ...result.shift,
          employee_first_name: verified.employee.first_name,
          employee_last_name: verified.employee.last_name,
          employee_position: verified.employee.position,
          employee_avatar_url: verified.employee.avatar_url,
          employee_color: verified.employee.color,
        }),
      };
    } catch (error) {
      if (
        error?.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
        String(error?.message || '').includes('idx_staff_shifts_one_active')
      ) {
        throw new StaffServiceError('shift_conflict', 409, {
          shift: getActiveShift(null, { now: openedAt }),
        });
      }
      throw error;
    }
  }

  function closeShift({
    staffToken,
    shiftToken = null,
    reason = '',
    force = false,
    now = null,
  } = {}) {
    const closedAt = currentNow(now);
    const auth = authenticateToken(
      force ? staffToken : (shiftToken || staffToken),
      {
      manager: force,
      allowShift: !force,
      now: closedAt,
      },
    );
    expireShifts({ now: closedAt });
    const shift = activeShift({ now: closedAt, expire: false });
    if (!shift) throw new StaffServiceError('shift_not_active', 409);
    if (!force && shift.employee_id !== auth.employee.id) {
      throw new StaffServiceError('shift_owned_by_another_employee', 403);
    }
    const normalizedReason = String(reason || '').trim();
    if (force && !normalizedReason) {
      throw new StaffServiceError('reason_required', 400);
    }
    const actorName = employeeName(auth.employee);
    return database.transaction(() => {
      const fresh = database
        .prepare('SELECT * FROM staff_shifts WHERE id = ?')
        .get(shift.id);
      if (!fresh || fresh.status !== 'active') {
        throw new StaffServiceError('shift_conflict', 409);
      }
      const updated = database.prepare(`
        UPDATE staff_shifts
        SET status = 'closed',
            ended_at = ?,
            close_reason = ?,
            version = version + 1,
            updated_at = ?
        WHERE id = ? AND status = 'active'
      `).run(
        closedAt.toISOString(),
        normalizedReason || 'employee_closed',
        closedAt.toISOString(),
        shift.id,
      );
      if (updated.changes !== 1) {
        throw new StaffServiceError('shift_conflict', 409);
      }
      database.prepare(`
        UPDATE staff_sessions
        SET revoked_at = COALESCE(revoked_at, ?)
        WHERE employee_id = ?
          AND scope = 'shift'
          AND revoked_at IS NULL
      `).run(closedAt.toISOString(), shift.employee_id);
      const after = database
        .prepare('SELECT * FROM staff_shifts WHERE id = ?')
        .get(shift.id);
      database.prepare(`
        INSERT INTO staff_shift_audit (
          id, shift_id, action, actor_employee_id, actor_name_snapshot,
          actor_kind, before_json, after_json, reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id('shift_audit'),
        shift.id,
        force ? 'force_close' : 'close',
        auth.employee.id,
        actorName,
        force ? 'manager' : 'employee',
        safeJson(fresh),
        safeJson(after),
        normalizedReason || null,
        closedAt.toISOString(),
      );
      return publicShift(after);
    }).immediate();
  }

  function correctShift({
    shiftId,
    staffToken,
    startedAt,
    endedAt,
    reason,
    expectedVersion,
    now = null,
  } = {}) {
    const correctedAt = currentNow(now);
    const auth = authenticateToken(staffToken, {
      manager: true,
      now: correctedAt,
    });
    const normalizedReason = String(reason || '').trim();
    if (!normalizedReason) throw new StaffServiceError('reason_required', 400);
    const normalizedExpectedVersion = Number(expectedVersion);
    if (
      !Number.isSafeInteger(normalizedExpectedVersion)
      || normalizedExpectedVersion < 1
    ) {
      throw new StaffServiceError('shift_version_required', 400);
    }
    const rawStartedAt = String(startedAt || '').trim();
    const rawEndedAt = String(endedAt || '').trim();
    const start = new Date(rawStartedAt);
    const end = new Date(rawEndedAt);
    if (
      !ISO_WITH_TIME_ZONE_RE.test(rawStartedAt) ||
      !ISO_WITH_TIME_ZONE_RE.test(rawEndedAt) ||
      !Number.isFinite(start.getTime()) ||
      !Number.isFinite(end.getTime()) ||
      end <= start ||
      end > correctedAt
    ) {
      throw new StaffServiceError('invalid_shift_period', 400);
    }
    const startWindow = getShiftWindow(start);
    const endWindow = getShiftWindow(end);
    if (
      startWindow.businessDate !== endWindow.businessDate
      || start < startWindow.start
      || end > startWindow.end
    ) {
      throw new StaffServiceError('invalid_shift_period', 400);
    }
    return database.transaction(() => {
      const before = database
        .prepare('SELECT * FROM staff_shifts WHERE id = ?')
        .get(shiftId);
      if (!before) throw new StaffServiceError('shift_not_found', 404);
      if (Number(before.version || 1) !== normalizedExpectedVersion) {
        throw new StaffServiceError('shift_conflict', 409);
      }
      if (before.status === 'active') {
        throw new StaffServiceError('active_shift_must_be_closed_first', 409);
      }
      const overlap = database.prepare(`
        SELECT id
        FROM staff_shifts
        WHERE id <> ?
          AND started_at < ?
          AND COALESCE(ended_at, planned_end_at) > ?
        LIMIT 1
      `).get(shiftId, end.toISOString(), start.toISOString());
      if (overlap) {
        throw new StaffServiceError('shift_period_conflict', 409);
      }
      const updated = database.prepare(`
        UPDATE staff_shifts
        SET business_date = ?,
            planned_start_at = ?,
            planned_end_at = ?,
            started_at = ?,
            ended_at = ?,
            version = version + 1,
            updated_at = ?
        WHERE id = ? AND version = ?
      `).run(
        startWindow.businessDate,
        startWindow.start.toISOString(),
        startWindow.end.toISOString(),
        start.toISOString(),
        end.toISOString(),
        correctedAt.toISOString(),
        shiftId,
        normalizedExpectedVersion,
      );
      if (updated.changes !== 1) {
        throw new StaffServiceError('shift_conflict', 409);
      }
      const after = database
        .prepare('SELECT * FROM staff_shifts WHERE id = ?')
        .get(shiftId);
      database.prepare(`
        INSERT INTO staff_shift_audit (
          id, shift_id, action, actor_employee_id, actor_name_snapshot,
          actor_kind, before_json, after_json, reason, created_at
        ) VALUES (?, ?, 'correct', ?, ?, 'manager', ?, ?, ?, ?)
      `).run(
        id('shift_audit'),
        shiftId,
        auth.employee.id,
        employeeName(auth.employee),
        safeJson(before),
        safeJson(after),
        normalizedReason,
        correctedAt.toISOString(),
      );
      return publicShift(after);
    }).immediate();
  }

  async function prepareActorVerification({
    employeeId,
    pin,
    rateKey = 'unknown',
    requireActiveShift = false,
    now = null,
  } = {}) {
    const checkedAt = currentNow(now);
    expireShifts({ now: checkedAt });
    const verified = await verifyPin({
      employeeId,
      pin,
      rateKey,
      now: checkedAt,
    });
    const shift = requireActiveShift
      ? activeShift({ now: checkedAt, expire: false })
      : null;
    if (
      requireActiveShift &&
      (!shift || shift.employee_id !== verified.employee.id)
    ) {
      throw new StaffServiceError('shift_required', 409);
    }
    return {
      employeeId: verified.employee.id,
      employeeName: employeeName(verified.employee),
      employeeRole:
        verified.employee.role === 'manager' ? 'manager' : 'employee',
      fingerprint: verified.fingerprint,
      shiftId: shift?.id || null,
      checkedAt: checkedAt.toISOString(),
      expiresAt: new Date(
        checkedAt.getTime() + ACTOR_PROOF_TTL_MS,
      ).toISOString(),
    };
  }

  function recheckActorProof(proof, {
    requireActiveShift = false,
    now = null,
  } = {}) {
    const checkedAt = currentNow(now);
    const proofExpiresAt = new Date(proof?.expiresAt);
    if (
      !proof?.employeeId ||
      !proof?.fingerprint ||
      !Number.isFinite(proofExpiresAt.getTime()) ||
      proofExpiresAt.getTime() < checkedAt.getTime()
    ) {
      throw new StaffServiceError('staff_actor_proof_expired', 409);
    }
    const employee = database.prepare(`
      SELECT *
      FROM employees
      WHERE id = ?
        AND active = 1
        AND deactivated_at IS NULL
        AND pin_fingerprint = ?
      LIMIT 1
    `).get(proof.employeeId, proof.fingerprint);
    if (!employee) {
      throw new StaffServiceError('staff_actor_changed', 409);
    }
    if (requireActiveShift) {
      const shift = database.prepare(`
        SELECT *
        FROM staff_shifts
        WHERE id = ?
          AND employee_id = ?
          AND status = 'active'
          AND planned_end_at > ?
        LIMIT 1
      `).get(proof.shiftId, proof.employeeId, nowIso(checkedAt));
      if (!shift) throw new StaffServiceError('shift_required', 409);
    }
    return {
      ...proof,
      employee,
      employeeName: employeeName(employee),
    };
  }

  function recordSystemEvent({
    employeeId,
    eventType,
    entityType = null,
    entityId = null,
    idempotencyKey,
    sourceNumber = null,
    sourceType = null,
    sourceName = null,
    payload = {},
    happenedAt = currentNow(),
    createdByEmployeeId = null,
    createdByName = null,
  } = {}) {
    const key = normalizeIdempotencyKey(idempotencyKey, true);
    const type = String(eventType || '').trim();
    if (!type) throw new StaffServiceError('event_type_required', 400);
    const employee = database
      .prepare('SELECT * FROM employees WHERE id = ?')
      .get(employeeId);
    if (!employee) throw new StaffServiceError('employee_not_found', 404);
    const date = happenedAt instanceof Date
      ? happenedAt
      : new Date(happenedAt);
    if (!Number.isFinite(date.getTime())) {
      throw new StaffServiceError('invalid_event_date', 400);
    }
    const dateParts = getTimeZoneDateParts(date, 'Europe/Minsk');
    const eventId = id('staff_event');
    const payloadJson = safeJson(payload);
    // Полярность ниже историческая и при чтении не используется: у всех событий
    // записано 'positive', включая отмену перемещения. Строки неизменяемы,
    // переписать нельзя, поэтому смысл события выводится из его типа
    // (POSITIVE_METRIC_KEYS в routes/staff.js). Не пишите
    // WHERE polarity = 'positive', это даст неверный ответ.
    const inserted = database.prepare(`
      INSERT INTO staff_events (
        id, employee_id, employee_name_snapshot, event_type, polarity, points,
        entity_type, entity_id, source_number_snapshot, source_type_snapshot,
        source_name_snapshot, source, happened_at, business_date,
        idempotency_key, payload_json, created_by_employee_id,
        created_by_name_snapshot, created_at
      ) VALUES (?, ?, ?, ?, 'positive', 0, ?, ?, ?, ?, ?, 'system', ?, ?, ?, ?,
                ?, ?, ?)
      ON CONFLICT(idempotency_key) DO NOTHING
    `).run(
      eventId,
      employee.id,
      employeeName(employee),
      type,
      entityType,
      entityId,
      sourceNumber === null ? null : String(sourceNumber),
      sourceType,
      sourceName,
      date.toISOString(),
      businessDate(dateParts),
      key,
      payloadJson,
      createdByEmployeeId,
      createdByName,
      currentNow().toISOString(),
    );
    const row = database
      .prepare('SELECT * FROM staff_events WHERE idempotency_key = ?')
      .get(key);
    if (
      !row ||
      row.employee_id !== employee.id ||
      row.event_type !== type ||
      String(row.entity_id || '') !== String(entityId || '')
    ) {
      throw new StaffServiceError('staff_event_idempotency_conflict', 409);
    }
    return { event: row, created: inserted.changes === 1 };
  }

  function getOperationReplay({ key, operation } = {}) {
    const normalized = normalizeIdempotencyKey(key);
    if (!normalized) return null;
    const row = database
      .prepare('SELECT * FROM staff_operation_idempotency WHERE key = ?')
      .get(normalized);
    if (!row) return null;
    if (row.operation !== operation) {
      throw new StaffServiceError('idempotency_key_conflict', 409);
    }
    return {
      ...row,
      response: parseJson(row.response_json, null),
    };
  }

  function storeOperationResult({
    key,
    operation,
    entityType,
    entityId = null,
    response,
    now = currentNow(),
  } = {}) {
    const normalized = normalizeIdempotencyKey(key, true);
    const responseJson = safeJson(response);
    database.prepare(`
      INSERT INTO staff_operation_idempotency (
        key, operation, entity_type, entity_id, response_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO NOTHING
    `).run(
      normalized,
      operation,
      entityType,
      entityId,
      responseJson,
      nowIso(now),
    );
    const replay = getOperationReplay({ key: normalized, operation });
    if (
      replay.entity_type !== entityType ||
      String(replay.entity_id || '') !== String(entityId || '') ||
      replay.response_json !== responseJson
    ) {
      throw new StaffServiceError('idempotency_key_conflict', 409);
    }
    return replay;
  }

  function runIdempotentOperation({
    key,
    operation,
    entityType,
    execute,
    now = currentNow(),
  } = {}) {
    const normalized = normalizeIdempotencyKey(key);
    if (!normalized) return execute();
    const replay = getOperationReplay({ key: normalized, operation });
    if (replay) return { replayed: true, result: replay.response };
    return database.transaction(() => {
      const lockedReplay = getOperationReplay({
        key: normalized,
        operation,
      });
      if (lockedReplay) {
        return { replayed: true, result: lockedReplay.response };
      }
      const result = execute();
      storeOperationResult({
        key: normalized,
        operation,
        entityType,
        entityId: result?.id || result?.entity_id || null,
        response: result,
        now,
      });
      return { replayed: false, result };
    }).immediate();
  }

  function listCandidates() {
    return database.prepare(`
      SELECT id, first_name, last_name, position, avatar_url, color
      FROM employees
      WHERE active = 1 AND deactivated_at IS NULL AND pin_hash IS NOT NULL
      ORDER BY first_name COLLATE NOCASE, last_name COLLATE NOCASE
    `).all();
  }

  return {
    isTrackingEnabled,
    setTrackingEnabled,
    createPinCredentials,
    verifyPin,
    accessByPin,
    issueSession,
    authenticateToken,
    revokeSessions,
    listCandidates,
    getActiveShift,
    prepareShiftProof,
    recheckShiftProof,
    openShift,
    closeShift,
    correctShift,
    expireShifts,
    prepareActorVerification,
    recheckActorProof,
    recordSystemEvent,
    getOperationReplay,
    storeOperationResult,
    runIdempotentOperation,
    publicEmployee,
    publicShift,
  };
}

export const staffService = createStaffService(db);

export function isStaffTrackingEnabled() {
  return staffService.isTrackingEnabled();
}

export function setStaffTrackingEnabled(enabled) {
  return staffService.setTrackingEnabled(enabled);
}

export function createStaffPinCredentials(pin) {
  return staffService.createPinCredentials(pin);
}

export function verifyStaffPin(input) {
  return staffService.verifyPin(input);
}

export function accessStaffByPin(input) {
  return staffService.accessByPin(input);
}

export function authenticateStaffAccessToken(token, options) {
  return staffService.authenticateToken(token, options);
}

export function revokeStaffSessions(employeeId, now) {
  return staffService.revokeSessions(employeeId, now);
}

export function listStaffShiftCandidates() {
  return staffService.listCandidates();
}

export function getActiveShiftForEmployee(employeeId = null, options = {}) {
  return staffService.getActiveShift(employeeId, options);
}

export function prepareActiveShiftProof(options = {}) {
  return staffService.prepareShiftProof(options);
}

export function recheckActiveShiftProof(proof, options = {}) {
  return staffService.recheckShiftProof(proof, options);
}

export function openStaffShift(input) {
  return staffService.openShift(input);
}

export function closeStaffShift(input) {
  return staffService.closeShift(input);
}

export function correctStaffShift(input) {
  return staffService.correctShift(input);
}

export function expireStaffShifts(options = {}) {
  return staffService.expireShifts(options);
}

export function prepareStaffActorVerification(input) {
  return staffService.prepareActorVerification(input);
}

export function recheckStaffActorProof(proof, options) {
  return staffService.recheckActorProof(proof, options);
}

export function recordSystemStaffEvent(input) {
  return staffService.recordSystemEvent(input);
}

export function getStaffOperationReplay(input) {
  return staffService.getOperationReplay(input);
}

export function storeStaffOperationResult(input) {
  return staffService.storeOperationResult(input);
}

export function runStaffIdempotentOperation(input) {
  return staffService.runIdempotentOperation(input);
}

export function createStaffAccessMiddleware({ manager = false } = {}) {
  return (req, res, next) => {
    try {
      const token = req.get('X-Staff-Token');
      const auth = staffService.authenticateToken(token, { manager });
      req.staffAccess = auth;
      next();
    } catch (error) {
      staffErrorResponse(res, error);
    }
  };
}

export function createStaffActorMiddleware({
  requireActiveShift = false,
} = {}) {
  return async (req, res, next) => {
    if (!staffService.isTrackingEnabled()) return next();
    try {
      const employeeId =
        req.body?.actor_employee_id || req.body?.employee_id || null;
      if (!String(employeeId || '').trim()) {
        throw new StaffServiceError('staff_employee_required', 400);
      }
      req.staffActorProof = await staffService.prepareActorVerification({
        employeeId,
        pin: req.body?.actor_pin || req.body?.pin || null,
        rateKey: req.ip || req.socket?.remoteAddress || 'unknown',
        requireActiveShift,
      });
      next();
    } catch (error) {
      staffErrorResponse(res, error);
    }
  };
}

/**
 * Пока учёт сотрудников включён, любое изменение требует открытой смены.
 * Отдельного выключателя нет: без смены остаётся только чтение.
 */
export function createShiftRequiredMiddleware() {
  return (req, res, next) => {
    if (!staffService.isTrackingEnabled()) return next();
    try {
      staffService.expireShifts();
      req.staffShiftProof = staffService.prepareShiftProof();
      req.staffShift = staffService.getActiveShift();
      next();
    } catch (error) {
      staffErrorResponse(res, error);
    }
  };
}

/**
 * Автозакрытие смен. Первый прогон идёт через setImmediate, то есть сразу при
 * старте процесса: смена с уже прошедшим planned_end_at закрывается со статусом
 * auto_closed, не дожидаясь интервала. Проверено прогоном на копии базы.
 *
 * Для тестовых стендов и наполнения данными это значит, что «открытая сейчас»
 * смена обязана иметь плановое окончание в будущем, иначе она закроется на
 * первом же запуске сервера. Одновременно открытой может быть только одна
 * смена: этого не даёт нарушить уникальный индекс idx_staff_shifts_one_active
 * (server/migrations/add_staff_management.js).
 */
export function startStaffShiftScheduler({
  intervalMs = SHIFT_SCHEDULER_INTERVAL_MS,
} = {}) {
  if (shiftSchedulerTimer) return shiftSchedulerTimer;
  const run = () => {
    try {
      staffService.expireShifts();
    } catch (error) {
      console.error('[staff-shifts] auto-close failed:', error);
    }
  };
  shiftSchedulerTimer = setInterval(
    run,
    Math.max(1_000, Number(intervalMs) || SHIFT_SCHEDULER_INTERVAL_MS),
  );
  shiftSchedulerTimer.unref?.();
  setImmediate(run);
  return shiftSchedulerTimer;
}

export function _stopStaffShiftSchedulerForTests() {
  if (shiftSchedulerTimer) clearInterval(shiftSchedulerTimer);
  shiftSchedulerTimer = null;
}

export function sendStaffServiceError(res, error) {
  return staffErrorResponse(res, error);
}
