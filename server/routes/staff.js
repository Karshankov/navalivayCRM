import crypto from 'node:crypto';

import bcrypt from 'bcryptjs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';

import { authMiddleware, verifyPassword } from '../auth.js';
import { db } from '../db.js';
import {
  accessStaffByPin,
  authenticateStaffAccessToken,
  closeStaffShift,
  correctStaffShift,
  createStaffAccessMiddleware,
  createShiftRequiredMiddleware,
  createStaffPinCredentials,
  expireStaffShifts,
  getActiveShiftForEmployee,
  isStaffTrackingEnabled,
  listStaffShiftCandidates,
  openStaffShift,
  recordSystemStaffEvent,
  prepareActiveShiftProof,
  recheckActiveShiftProof,
  revokeStaffSessions,
  runStaffIdempotentOperation,
  sendStaffServiceError,
  setStaffTrackingEnabled,
  StaffServiceError,
} from '../utils/staff-service.js';
import {
  getBusinessCalendarDayRange,
  getBusinessCalendarMonthRange,
  getTimeZoneDateParts,
} from '../utils/business-time.js';
import {
  enqueueInternalNotification,
  enqueueInternalNotificationForGroup,
  listInternalNotificationTemplates,
  normalizeTelegramId,
  renderNotificationTemplate,
  resumeUnknownInternalNotification,
  saveInternalNotificationTemplate,
} from '../utils/internal-notifications.js';

const BASE = '/api/admin/crm/staff';
const ROLE_VALUES = new Set(['employee', 'manager']);
const MARK_VALUES = new Set(['positive', 'negative']);
const TASK_OPEN_STATES = new Set(['open', 'claimed', 'submitted']);
const NOTIFICATION_GROUPS = new Set(['documents', 'tasks', 'salary']);
const USERNAME_RE = /^[a-zA-Z0-9_]{5,32}$/;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const STAFF_AVATAR_RE =
  /^\/uploads\/staff\/[a-zA-Z0-9_-]+\.(?:jpe?g|png|webp|gif)$/i;
const MONTH_RE = /^(\d{4})-(\d{2})$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const YEAR_RE = /^\d{4}$/;
const ISO_WITH_TIME_ZONE_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i;
const ANALYTICS_MIN_YEAR = 2000;
const ANALYTICS_MAX_YEAR = 2200;
const MAX_LIST_LIMIT = 200;

export const staffRouter = Router();

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
}

function nowIso() {
  return new Date().toISOString();
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(String(value ?? ''));
  } catch {
    return fallback;
  }
}

function stringifyJson(value, fallback = {}) {
  try {
    return JSON.stringify(value ?? fallback);
  } catch {
    return JSON.stringify(fallback);
  }
}

function cleanText(value, {
  required = false,
  max = 500,
  code = 'invalid_value',
} = {}) {
  const normalized = String(value ?? '').trim();
  if (required && !normalized) throw new StaffServiceError(code, 400);
  if (normalized.length > max) throw new StaffServiceError(code, 400);
  return normalized;
}

function employeeName(employee) {
  return `${employee?.first_name || ''} ${employee?.last_name || ''}`.trim()
    || 'Сотрудник';
}

function normalizeResponsibilities(value) {
  if (value === undefined) return undefined;
  const rows = Array.isArray(value)
    ? value
    : String(value || '')
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean);
  if (rows.length > 30) {
    throw new StaffServiceError('too_many_responsibilities', 400);
  }
  return rows.map((item) => cleanText(item, {
    required: true,
    max: 240,
    code: 'invalid_responsibility',
  }));
}

function normalizeStaffAvatarUrl(value) {
  const avatarUrl = cleanText(value, { max: 500 }) || null;
  if (avatarUrl && !STAFF_AVATAR_RE.test(avatarUrl)) {
    throw new StaffServiceError('invalid_employee_avatar', 400);
  }
  return avatarUrl;
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
    telegram_id: row.telegram_id || null,
    telegram_username: row.telegram_username || null,
    active: Number(row.active || 0) === 1,
    deactivated_at: row.deactivated_at || null,
    pin_configured: Boolean(row.pin_hash && row.pin_fingerprint),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function getEmployee(employeeId) {
  return db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);
}

function requireEmployee(employeeId) {
  const employee = getEmployee(employeeId);
  if (!employee) throw new StaffServiceError('employee_not_found', 404);
  return employee;
}

function requireActiveEmployee(employeeId) {
  const employee = requireEmployee(employeeId);
  if (Number(employee.active || 0) !== 1 || employee.deactivated_at) {
    throw new StaffServiceError('employee_inactive', 409);
  }
  return employee;
}

/**
 * Личную задачу сотрудник ведёт независимо от того, чья смена сейчас открыта:
 * она поручена именно ему. Свободную задачу по-прежнему берут только на своей
 * смене, иначе часы работы перестанут сходиться с действиями.
 */
function requireOwnShiftUnlessPersonal(task, actor, proof) {
  if (task.target_employee_id === actor.id) return;
  const checkedShift = recheckActiveShiftProof(proof || prepareActiveShiftProof());
  if (checkedShift.employeeId !== actor.id) {
    throw new StaffServiceError('shift_owned_by_another_employee', 403);
  }
}

function activeManagerCount() {
  return Number(db.prepare(`
    SELECT COUNT(*) AS count
    FROM employees
    WHERE role = 'manager'
      AND active = 1
      AND deactivated_at IS NULL
      AND pin_hash IS NOT NULL
      AND pin_fingerprint IS NOT NULL
  `).get()?.count || 0);
}

function ensureManagerBootstrapAvailable() {
  if (activeManagerCount() > 0) {
    throw new StaffServiceError('manager_already_bootstrapped', 409);
  }
}

function activeEmployeePinReadiness() {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS active_count,
      SUM(
        CASE
          WHEN pin_hash IS NOT NULL AND pin_fingerprint IS NOT NULL THEN 1
          ELSE 0
        END
      ) AS ready_count
    FROM employees
    WHERE active = 1 AND deactivated_at IS NULL
  `).get();
  return {
    activeCount: Number(row?.active_count || 0),
    readyCount: Number(row?.ready_count || 0),
  };
}

function protectLastManager(employee) {
  if (
    employee?.role === 'manager'
    && Number(employee.active || 0) === 1
    && !employee.deactivated_at
    && activeManagerCount() <= 1
  ) {
    throw new StaffServiceError('last_active_manager_required', 409);
  }
}

function staffToken(req) {
  return String(req.get('X-Staff-Token') || '').trim();
}

function requestRateKey(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function requireFeatureEnabled() {
  if (!isStaffTrackingEnabled()) {
    throw new StaffServiceError('staff_tracking_disabled', 503);
  }
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve().then(() => handler(req, res, next)).catch((error) => {
      if (res.headersSent) return;
      if (error instanceof StaffServiceError || error?.code?.startsWith?.('staff_')) {
        sendStaffServiceError(res, error);
        return;
      }
      if (
        error?.code === 'SQLITE_CONSTRAINT_UNIQUE'
        || String(error?.message || '').includes('UNIQUE constraint failed')
      ) {
        res.status(409).json({ error: 'conflict' });
        return;
      }
      console.error('[staff] route failed:', error);
      res.status(500).json({ error: 'staff_operation_failed' });
    });
  };
}

function genericAuthFailure(res) {
  return res.status(401).json({ error: 'invalid_staff_credentials' });
}

function preventSensitiveResponseCaching(_req, res, next) {
  res.set({
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache',
  });
  next();
}

const pinIpLimiter = rateLimit({
  windowMs: 10 * 60_000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => genericAuthFailure(res),
});

const adminReauthLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: 'too_many_attempts' }),
});

const staffAccess = createStaffAccessMiddleware();
const managerAccess = createStaffAccessMiddleware({ manager: true });
const shiftRequired = createShiftRequiredMiddleware();

function normalizeUsername(value) {
  const normalized = String(value || '').trim().replace(/^@+/, '');
  if (!USERNAME_RE.test(normalized)) {
    throw new StaffServiceError('invalid_username', 400);
  }
  return normalized;
}

function internalUsername(employeeId) {
  const suffix = String(employeeId).replace(/[^a-zA-Z0-9]/g, '').slice(-24);
  let candidate = `staff_${suffix || crypto.randomBytes(8).toString('hex')}`;
  let sequence = 0;
  while (db.prepare('SELECT 1 FROM employees WHERE username = ?').get(candidate)) {
    sequence += 1;
    candidate = `staff_${suffix}_${sequence}`;
  }
  return candidate;
}

function parseMonth(value) {
  const requested = String(value || '').trim();
  if (!requested) {
    const parts = getTimeZoneDateParts(new Date(), 'Europe/Minsk');
    return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}`;
  }
  const match = MONTH_RE.exec(requested);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) {
    throw new StaffServiceError('invalid_month', 400);
  }
  return requested;
}

function monthRange(month) {
  const [year, monthNumber] = parseMonth(month).split('-').map(Number);
  return getBusinessCalendarMonthRange(year, monthNumber);
}

function parseCalendarDate(value, code = 'invalid_date') {
  const requested = String(value || '').trim();
  const match = DATE_RE.exec(requested);
  if (!match) throw new StaffServiceError(code, 400);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < ANALYTICS_MIN_YEAR || year > ANALYTICS_MAX_YEAR) {
    throw new StaffServiceError(code, 400);
  }
  const normalized = new Date(Date.UTC(year, month - 1, day, 12));
  if (
    normalized.getUTCFullYear() !== year
    || normalized.getUTCMonth() + 1 !== month
    || normalized.getUTCDate() !== day
  ) {
    throw new StaffServiceError(code, 400);
  }
  return {
    label: requested,
    year,
    month,
    day,
    epochDay: Date.UTC(year, month - 1, day) / 86_400_000,
  };
}

function calendarLabel(year, month, day) {
  return [
    String(year).padStart(4, '0'),
    String(month).padStart(2, '0'),
    String(day).padStart(2, '0'),
  ].join('-');
}

function analyticsPeriod(query = {}) {
  const requestedType = String(query.period || '').trim().toLowerCase();
  const type = requestedType || 'month';
  if (!['day', 'month', 'year', 'custom'].includes(type)) {
    throw new StaffServiceError('invalid_analytics_period', 400);
  }

  if (type === 'month') {
    const month = parseMonth(query.month);
    const [year, monthNumber] = month.split('-').map(Number);
    if (year < ANALYTICS_MIN_YEAR || year > ANALYTICS_MAX_YEAR) {
      throw new StaffServiceError('invalid_month', 400);
    }
    const range = getBusinessCalendarMonthRange(
      year,
      monthNumber,
      'Europe/Minsk',
    );
    const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    return {
      type,
      start: calendarLabel(year, monthNumber, 1),
      end: calendarLabel(year, monthNumber, lastDay),
      rangeStart: range.start,
      rangeEnd: range.end,
      month,
    };
  }

  if (type === 'day') {
    const date = parseCalendarDate(query.date, 'invalid_analytics_date');
    const range = getBusinessCalendarDayRange(
      date.year,
      date.month,
      date.day,
      'Europe/Minsk',
    );
    return {
      type,
      start: date.label,
      end: date.label,
      rangeStart: range.start,
      rangeEnd: range.end,
      month: null,
    };
  }

  if (type === 'year') {
    const requestedYear = String(query.year || '').trim();
    if (!YEAR_RE.test(requestedYear)) {
      throw new StaffServiceError('invalid_analytics_year', 400);
    }
    const year = Number(requestedYear);
    if (year < ANALYTICS_MIN_YEAR || year > ANALYTICS_MAX_YEAR) {
      throw new StaffServiceError('invalid_analytics_year', 400);
    }
    const startRange = getBusinessCalendarDayRange(year, 1, 1, 'Europe/Minsk');
    const endRange = getBusinessCalendarDayRange(year, 12, 31, 'Europe/Minsk');
    return {
      type,
      start: calendarLabel(year, 1, 1),
      end: calendarLabel(year, 12, 31),
      rangeStart: startRange.start,
      rangeEnd: endRange.end,
      month: null,
    };
  }

  const from = parseCalendarDate(query.from, 'invalid_analytics_from');
  const to = parseCalendarDate(query.to, 'invalid_analytics_to');
  const inclusiveDays = to.epochDay - from.epochDay + 1;
  if (inclusiveDays < 1) {
    throw new StaffServiceError('invalid_analytics_range', 400);
  }
  if (inclusiveDays > 366) {
    throw new StaffServiceError('analytics_range_too_large', 400);
  }
  const startRange = getBusinessCalendarDayRange(
    from.year,
    from.month,
    from.day,
    'Europe/Minsk',
  );
  const endRange = getBusinessCalendarDayRange(
    to.year,
    to.month,
    to.day,
    'Europe/Minsk',
  );
  return {
    type,
    start: from.label,
    end: to.label,
    rangeStart: startRange.start,
    rangeEnd: endRange.end,
    month: null,
  };
}

function idempotencyKey(req) {
  const key = String(req.get('Idempotency-Key') || '').trim();
  if (!key) throw new StaffServiceError('idempotency_key_required', 400);
  return key;
}

function stableTaskOperationValue(value) {
  if (Array.isArray(value)) return value.map(stableTaskOperationValue);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        if (!['pin', 'actor_pin'].includes(key)) {
          result[key] = stableTaskOperationValue(value[key]);
        }
        return result;
      }, {});
  }
  return value;
}

function taskOperationName(base, {
  taskId = null,
  actorId,
  body = {},
} = {}) {
  const fingerprint = crypto
    .createHash('sha256')
    .update(JSON.stringify(stableTaskOperationValue({
      task_id: taskId,
      actor_employee_id: actorId,
      body,
    })))
    .digest('hex');
  return `${base}:${fingerprint}`;
}

function tableExists(table) {
  return Boolean(db.prepare(`
    SELECT 1 FROM sqlite_master
    WHERE type = 'table' AND name = ?
  `).get(table));
}

function requireNotificationTables() {
  if (
    !tableExists('internal_notification_settings')
    || !tableExists('internal_notification_recipients')
    || !tableExists('internal_notification_outbox')
  ) {
    throw new StaffServiceError('internal_notifications_not_initialized', 503);
  }
}

/**
 * Если задача поручена сотруднику с привязанным Telegram, шлём ему лично,
 * а не всей группе: остальным чужая личная задача не нужна.
 */
function personalTaskRecipient(task) {
  const employeeId = task.assignee_employee_id || task.target_employee_id;
  if (!employeeId) return null;
  const employee = db.prepare(`
    SELECT telegram_id, telegram_username FROM employees WHERE id = ?
  `).get(employeeId);
  return employee?.telegram_id ? employee : null;
}

function enqueueTaskNotification({ task, eventType, uniqueSuffix }) {
  requireNotificationTables();
  const payload = {
    document_number: task.id,
    title: task.title,
    deadline: task.due_at || null,
    employee_id: task.assignee_employee_id || task.target_employee_id || null,
    employee_name:
      task.assignee_employee_name_snapshot
      || task.target_employee_name_snapshot
      || null,
  };
  const uniqueKey = `staff-task:${task.id}:${uniqueSuffix}`;
  const personal = personalTaskRecipient(task);
  if (personal) {
    return enqueueInternalNotification(db, {
      uniqueKey: `${uniqueKey}:personal`,
      eventType,
      recipientTelegramId: personal.telegram_id,
      recipientUsername: personal.telegram_username || null,
      payload,
    });
  }
  return enqueueInternalNotificationForGroup(db, {
    eventGroup: 'tasks',
    uniqueKey,
    eventType,
    payload,
  });
}

function exactCustomerByUsername(username) {
  const normalized = normalizeUsername(username).toLowerCase();
  const rows = db.prepare(`
    SELECT id, telegram_id, telegram_username, first_name, last_name
    FROM customers
    WHERE deleted_at IS NULL
      AND lower(ltrim(trim(COALESCE(telegram_username, '')), '@')) = ?
      AND telegram_id IS NOT NULL
    ORDER BY updated_at DESC, id DESC
  `).all(normalized);
  if (!rows.length) throw new StaffServiceError('telegram_recipient_not_found', 404);
  const normalizedRows = rows.map((row) => {
    try {
      return { ...row, telegram_id: normalizeTelegramId(row.telegram_id) };
    } catch {
      throw new StaffServiceError('telegram_recipient_invalid', 409);
    }
  });
  const distinctIds = new Set(normalizedRows.map((row) => row.telegram_id));
  if (distinctIds.size !== 1) {
    throw new StaffServiceError('telegram_recipient_ambiguous', 409);
  }
  return normalizedRows[0];
}

function confirmedRecipient(body) {
  const username = normalizeUsername(body?.telegram_username || body?.username);
  const rawTelegramId = cleanText(body?.telegram_id, {
    required: true,
    max: 40,
    code: 'telegram_id_required',
  });
  let telegramId;
  try {
    telegramId = normalizeTelegramId(rawTelegramId);
  } catch {
    throw new StaffServiceError('invalid_telegram_id', 400);
  }
  const customer = exactCustomerByUsername(username);
  if (customer.telegram_id !== telegramId) {
    throw new StaffServiceError('telegram_recipient_confirmation_mismatch', 409);
  }
  return {
    customer,
    telegram_id: telegramId,
    telegram_username: String(customer.telegram_username || username).replace(/^@+/, ''),
    display_name:
      `${customer.first_name || ''} ${customer.last_name || ''}`.trim()
      || `@${username}`,
  };
}

staffRouter.use(BASE, preventSensitiveResponseCaching, authMiddleware);

staffRouter.post(`${BASE}/access`, pinIpLimiter, asyncRoute(async (req, res) => {
  try {
    const result = await accessStaffByPin({
      pin: req.body?.pin,
      rateKey: requestRateKey(req),
      userAgent: req.get('user-agent') || '',
    });
    res.json({ ...result, identity: result.employee });
  } catch (error) {
    if (error?.code === 'staff_auth_locked') throw error;
    if (
      ['invalid_staff_credentials', 'invalid_pin_format']
        .includes(error?.code)
    ) {
      genericAuthFailure(res);
      return;
    }
    throw error;
  }
}));

staffRouter.get(`${BASE}/shift/candidates`, asyncRoute((_req, res) => {
  res.json({
    enabled: isStaffTrackingEnabled(),
    candidates: listStaffShiftCandidates().map((employee) => ({
      id: employee.id,
      first_name: employee.first_name,
      last_name: employee.last_name,
      avatar_url: employee.avatar_url || null,
      color: employee.color || null,
    })),
  });
}));

staffRouter.get(`${BASE}/shift`, asyncRoute((_req, res) => {
  if (isStaffTrackingEnabled()) expireStaffShifts();
  const shift = isStaffTrackingEnabled()
    ? getActiveShiftForEmployee()
    : null;
  res.json({
    enabled: isStaffTrackingEnabled(),
    active: Boolean(shift),
    closed: !shift,
    shift,
  });
}));

staffRouter.post(`${BASE}/shift/open`, pinIpLimiter, asyncRoute(async (req, res) => {
  requireFeatureEnabled();
  try {
    const result = await openStaffShift({
      employeeId: req.body?.employee_id,
      pin: req.body?.pin,
      rateKey: requestRateKey(req),
      userAgent: req.get('user-agent') || '',
    });
    res.json({
      ...result,
      active: true,
      closed: false,
      identity: result.employee,
    });
  } catch (error) {
    if (error?.code === 'staff_auth_locked') throw error;
    if (
      ['invalid_staff_credentials', 'invalid_pin_format']
        .includes(error?.code)
    ) {
      genericAuthFailure(res);
      return;
    }
    throw error;
  }
}));

staffRouter.post(`${BASE}/shift/close`, asyncRoute((req, res) => {
  requireFeatureEnabled();
  const managerCorrection = Boolean(req.body?.manager_correction);
  const force = Boolean(req.body?.force || managerCorrection);
  if (force) {
    authenticateStaffAccessToken(staffToken(req), { manager: true });
  }
  const close = () => closeStaffShift({
    staffToken: staffToken(req),
    shiftToken: String(req.get('X-Shift-Token') || '').trim() || null,
    reason: req.body?.reason,
    force,
  });
  const shift = managerCorrection
    ? db.transaction(() => {
        const closed = close();
        const requestedShiftId = String(req.body?.shift_id || '').trim();
        if (requestedShiftId && requestedShiftId !== closed.id) {
          throw new StaffServiceError('shift_conflict', 409);
        }
        return correctStaffShift({
          shiftId: closed.id,
          staffToken: staffToken(req),
          startedAt: req.body?.started_at || closed.started_at,
          endedAt: req.body?.ended_at || closed.ended_at,
          reason: req.body?.reason,
          expectedVersion: closed.version,
        });
      })()
    : close();
  res.json({ active: false, closed: true, shift });
}));

staffRouter.post(
  `${BASE}/shifts/:id/correct`,
  managerAccess,
  asyncRoute((req, res) => {
    const shift = correctStaffShift({
      shiftId: req.params.id,
      staffToken: staffToken(req),
      startedAt: req.body?.started_at,
      endedAt: req.body?.ended_at,
      reason: req.body?.reason,
      expectedVersion: req.body?.expected_version,
    });
    res.json({ shift });
  }),
);

staffRouter.get(
  `${BASE}/shifts/audit`,
  managerAccess,
  asyncRoute((req, res) => {
    const limit = Math.min(
      Math.max(Number(req.query.limit) || 100, 1),
      MAX_LIST_LIMIT,
    );
    const shiftId = String(req.query.shift_id || '').trim();
    const rows = shiftId
      ? db.prepare(`
          SELECT * FROM staff_shift_audit
          WHERE shift_id = ?
          ORDER BY created_at DESC
          LIMIT ?
        `).all(shiftId, limit)
      : db.prepare(`
          SELECT * FROM staff_shift_audit
          ORDER BY created_at DESC
          LIMIT ?
        `).all(limit);
    res.json({
      audit: rows.map((row) => ({
        ...row,
        before: parseJson(row.before_json, null),
        after: parseJson(row.after_json, null),
      })),
    });
  }),
);

async function createEmployeeRecord(input, {
  forceRole = null,
  beforeWrite = null,
} = {}) {
  const firstName = cleanText(input?.first_name, {
    required: true,
    max: 80,
    code: 'first_name_required',
  });
  const lastName = cleanText(input?.last_name, {
    required: false,
    max: 80,
  });
  const position = cleanText(input?.position, { max: 160 }) || null;
  const avatarUrl = normalizeStaffAvatarUrl(input?.avatar_url);
  const color = cleanText(input?.color, { max: 7 }) || null;
  if (color && !HEX_COLOR_RE.test(color)) {
    throw new StaffServiceError('invalid_employee_color', 400);
  }
  const responsibilities = normalizeResponsibilities(input?.responsibilities) || [];
  const role = forceRole || String(input?.role || 'employee');
  if (!ROLE_VALUES.has(role)) {
    throw new StaffServiceError('invalid_employee_role', 400);
  }
  const employeeId = makeId('emp');
  const username = input?.username
    ? normalizeUsername(input.username)
    : internalUsername(employeeId);
  const credentials = await createStaffPinCredentials(
    input?.pin ?? input?.new_pin,
  );
  const impossibleLegacyPassword = await bcrypt.hash(
    crypto.randomBytes(32).toString('base64url'),
    12,
  );
  const timestamp = nowIso();
  try {
    db.transaction(() => {
      beforeWrite?.();
      db.prepare(`
        INSERT INTO employees (
          id, username, password_hash, first_name, last_name, position,
          active, avatar_url, color, responsibilities, role,
          pin_hash, pin_fingerprint, pin_updated_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        employeeId,
        username,
        impossibleLegacyPassword,
        firstName,
        lastName,
        position,
        avatarUrl,
        color,
        stringifyJson(responsibilities, []),
        role,
        credentials.hash,
        credentials.fingerprint,
        timestamp,
        timestamp,
        timestamp,
      );
    }).immediate();
  } catch (error) {
    if (String(error?.message || '').includes('pin_fingerprint')) {
      throw new StaffServiceError('pin_already_in_use', 409);
    }
    if (String(error?.message || '').includes('employees.username')) {
      throw new StaffServiceError('username_already_in_use', 409);
    }
    throw error;
  }
  const created = requireEmployee(employeeId);
  return created;
}

async function setEmployeePin(employeeId, pin, {
  beforeWrite = null,
  promoteToManager = false,
} = {}) {
  const employee = requireEmployee(employeeId);
  const credentials = await createStaffPinCredentials(pin);
  const timestamp = nowIso();
  try {
    db.transaction(() => {
      beforeWrite?.();
      db.prepare(`
        UPDATE employees
        SET pin_hash = ?, pin_fingerprint = ?, pin_updated_at = ?,
            updated_at = ?
        WHERE id = ?
      `).run(
        credentials.hash,
        credentials.fingerprint,
        timestamp,
        timestamp,
        employee.id,
      );
      if (promoteToManager) {
        db.prepare(`
          UPDATE employees
          SET role = 'manager', active = 1, deactivated_at = NULL, updated_at = ?
          WHERE id = ?
        `).run(timestamp, employee.id);
      }
      revokeStaffSessions(employee.id, new Date(timestamp));
    }).immediate();
  } catch (error) {
    if (String(error?.message || '').includes('pin_fingerprint')) {
      throw new StaffServiceError('pin_already_in_use', 409);
    }
    throw error;
  }
  return requireEmployee(employee.id);
}

staffRouter.post(`${BASE}/bootstrap-manager`, adminReauthLimiter, asyncRoute(async (req, res) => {
  const adminPassword = String(req.body?.admin_password || '');
  if (!adminPassword || !(await verifyPassword(adminPassword))) {
    throw new StaffServiceError('invalid_admin_password', 401);
  }
  ensureManagerBootstrapAvailable();

  let manager;
  if (req.body?.employee_id) {
    const employee = requireEmployee(req.body.employee_id);
    manager = await setEmployeePin(employee.id, req.body?.new_pin, {
      beforeWrite: ensureManagerBootstrapAvailable,
      promoteToManager: true,
    });
    manager = requireEmployee(employee.id);
  } else {
    manager = await createEmployeeRecord(
      { ...req.body, pin: req.body?.new_pin },
      {
        forceRole: 'manager',
        beforeWrite: ensureManagerBootstrapAvailable,
      },
    );
  }
  if (req.body?.enable_tracking === true) setStaffTrackingEnabled(true);
  res.status(201).json({
    employee: publicEmployee(manager),
    tracking_enabled: isStaffTrackingEnabled(),
  });
}));

staffRouter.post(
  `${BASE}/recovery-manager/candidates`,
  adminReauthLimiter,
  asyncRoute(async (req, res) => {
    const adminPassword = String(req.body?.admin_password || '');
    if (!adminPassword || !(await verifyPassword(adminPassword))) {
      throw new StaffServiceError('invalid_admin_password', 401);
    }
    const managers = db.prepare(`
      SELECT * FROM employees
      WHERE role = 'manager'
        AND active = 1
        AND deactivated_at IS NULL
      ORDER BY active DESC, first_name COLLATE NOCASE, last_name COLLATE NOCASE
    `).all();
    res.json({ employees: managers.map(publicEmployee) });
  }),
);

staffRouter.post(`${BASE}/recovery-manager`, adminReauthLimiter, asyncRoute(async (req, res) => {
  const adminPassword = String(req.body?.admin_password || '');
  if (!adminPassword || !(await verifyPassword(adminPassword))) {
    throw new StaffServiceError('invalid_admin_password', 401);
  }
  const employee = requireEmployee(req.body?.employee_id);
  if (
    employee.role !== 'manager'
    || Number(employee.active || 0) !== 1
    || employee.deactivated_at
  ) {
    throw new StaffServiceError('manager_recovery_target_required', 403);
  }
  const updated = await setEmployeePin(employee.id, req.body?.new_pin);
  res.json({ employee: publicEmployee(requireEmployee(updated.id)) });
}));

staffRouter.get(`${BASE}/settings/tracking`, asyncRoute((_req, res) => {
  res.json({ enabled: isStaffTrackingEnabled() });
}));

/**
 * Включённый учёт сам по себе делает открытую смену обязательной для любых
 * изменений, поэтому проверки готовности стоят здесь: без активного
 * руководителя и ПИН у всех магазин остался бы в режиме чтения.
 */
staffRouter.put(
  `${BASE}/settings/tracking`,
  managerAccess,
  asyncRoute((req, res) => {
    if (typeof req.body?.enabled !== 'boolean') {
      throw new StaffServiceError('enabled_boolean_required', 400);
    }
    if (req.body.enabled) {
      if (activeManagerCount() < 1) {
        throw new StaffServiceError('active_manager_required', 409);
      }
      const readiness = activeEmployeePinReadiness();
      if (
        readiness.activeCount < 1
        || readiness.readyCount !== readiness.activeCount
      ) {
        throw new StaffServiceError('staff_pins_required', 409, readiness);
      }
    }
    res.json({ enabled: setStaffTrackingEnabled(req.body.enabled) });
  }),
);

staffRouter.get(
  `${BASE}/employees`,
  managerAccess,
  asyncRoute((_req, res) => {
    const employees = db.prepare(`
      SELECT *
      FROM employees
      ORDER BY active DESC, first_name COLLATE NOCASE, last_name COLLATE NOCASE
    `).all();
    res.json({ employees: employees.map(publicEmployee) });
  }),
);

staffRouter.post(
  `${BASE}/employees`,
  managerAccess,
  asyncRoute(async (req, res) => {
    const created = await createEmployeeRecord(req.body);
    res.status(201).json({ employee: publicEmployee(created) });
  }),
);

staffRouter.patch(
  `${BASE}/employees/:id`,
  managerAccess,
  asyncRoute((req, res) => {
    const current = requireEmployee(req.params.id);
    let roleChanged = false;
    const updates = [];
    const values = [];
    const set = (column, value) => {
      updates.push(`${column} = ?`);
      values.push(value);
    };
    if (req.body?.first_name !== undefined) {
      set('first_name', cleanText(req.body.first_name, {
        required: true,
        max: 80,
        code: 'first_name_required',
      }));
    }
    if (req.body?.last_name !== undefined) {
      set('last_name', cleanText(req.body.last_name, {
        required: true,
        max: 80,
        code: 'last_name_required',
      }));
    }
    if (req.body?.position !== undefined) {
      set('position', cleanText(req.body.position, { max: 160 }) || null);
    }
    if (req.body?.avatar_url !== undefined) {
      set('avatar_url', normalizeStaffAvatarUrl(req.body.avatar_url));
    }
    if (req.body?.color !== undefined) {
      const color = cleanText(req.body.color, { max: 7 }) || null;
      if (color && !HEX_COLOR_RE.test(color)) {
        throw new StaffServiceError('invalid_employee_color', 400);
      }
      set('color', color);
    }
    if (req.body?.responsibilities !== undefined) {
      set(
        'responsibilities',
        stringifyJson(normalizeResponsibilities(req.body.responsibilities), []),
      );
    }
    if (req.body?.role !== undefined) {
      const role = String(req.body.role);
      if (!ROLE_VALUES.has(role)) {
        throw new StaffServiceError('invalid_employee_role', 400);
      }
      roleChanged = current.role !== role;
      set('role', role);
    }
    if (!updates.length) {
      res.json({ employee: publicEmployee(current) });
      return;
    }
    set('updated_at', nowIso());
    values.push(current.id);
    db.transaction(() => {
      const fresh = requireEmployee(current.id);
      if (
        fresh.role === 'manager'
        && req.body?.role !== undefined
        && String(req.body.role) !== 'manager'
      ) {
        protectLastManager(fresh);
      }
      db.prepare(`
        UPDATE employees
        SET ${updates.join(', ')}
        WHERE id = ?
      `).run(...values);
      if (
        roleChanged
        || (
          req.body?.role !== undefined
          && fresh.role !== String(req.body.role)
        )
      ) {
        revokeStaffSessions(current.id);
      }
    }).immediate();
    res.json({ employee: publicEmployee(requireEmployee(current.id)) });
  }),
);

staffRouter.post(
  `${BASE}/employees/:id/deactivate`,
  managerAccess,
  asyncRoute((req, res) => {
    const employee = requireEmployee(req.params.id);
    const reason = cleanText(req.body?.reason, {
      required: true,
      max: 500,
      code: 'reason_required',
    });
    const timestamp = nowIso();
    db.transaction(() => {
      const freshEmployee = requireEmployee(employee.id);
      protectLastManager(freshEmployee);
      const activeShift = getActiveShiftForEmployee(employee.id);
      if (activeShift) {
        closeStaffShift({
          staffToken: staffToken(req),
          reason,
          force: true,
        });
      }
      db.prepare(`
        UPDATE employees
        SET active = 0, deactivated_at = ?, updated_at = ?
        WHERE id = ?
      `).run(timestamp, timestamp, employee.id);
      revokeStaffSessions(employee.id, new Date(timestamp));
    }).immediate();
    res.json({ employee: publicEmployee(requireEmployee(employee.id)) });
  }),
);

staffRouter.post(
  `${BASE}/employees/:id/restore`,
  managerAccess,
  adminReauthLimiter,
  asyncRoute(async (req, res) => {
    const employee = requireEmployee(req.params.id);
    const pinConfigured = Boolean(
      employee.pin_hash && employee.pin_fingerprint,
    );
    const hasNewPin = Object.prototype.hasOwnProperty.call(
      req.body || {},
      'new_pin',
    );
    const credentials = hasNewPin
      ? await createStaffPinCredentials(req.body?.new_pin)
      : null;
    if (isStaffTrackingEnabled() && !pinConfigured && !credentials) {
      throw new StaffServiceError('staff_pins_required', 409);
    }
    if (credentials && employee.role === 'manager') {
      const adminPassword = String(req.body?.admin_password || '');
      if (!adminPassword || !(await verifyPassword(adminPassword))) {
        throw new StaffServiceError('invalid_admin_password', 401);
      }
    }

    const timestamp = nowIso();
    try {
      db.transaction(() => {
        if (credentials) {
          db.prepare(`
            UPDATE employees
            SET active = 1, deactivated_at = NULL,
                pin_hash = ?, pin_fingerprint = ?, pin_updated_at = ?,
                updated_at = ?
            WHERE id = ?
          `).run(
            credentials.hash,
            credentials.fingerprint,
            timestamp,
            timestamp,
            employee.id,
          );
          revokeStaffSessions(employee.id, new Date(timestamp));
          return;
        }
        db.prepare(`
          UPDATE employees
          SET active = 1, deactivated_at = NULL, updated_at = ?
          WHERE id = ?
        `).run(timestamp, employee.id);
      }).immediate();
    } catch (error) {
      if (String(error?.message || '').includes('pin_fingerprint')) {
        throw new StaffServiceError('pin_already_in_use', 409);
      }
      throw error;
    }
    res.json({ employee: publicEmployee(requireEmployee(employee.id)) });
  }),
);

/**
 * Привязка Telegram к сотруднику. Юзернейм ищем среди клиентов: там уже есть
 * подтверждённый telegram_id, отдельного подтверждения не требуется.
 * Пустой юзернейм снимает привязку.
 */
staffRouter.put(
  `${BASE}/employees/:id/telegram`,
  managerAccess,
  asyncRoute((req, res) => {
    const employee = requireEmployee(req.params.id);
    const raw = String(req.body?.username ?? '').trim();
    const timestamp = nowIso();
    if (!raw) {
      db.prepare(`
        UPDATE employees
        SET telegram_id = NULL, telegram_username = NULL, updated_at = ?
        WHERE id = ?
      `).run(timestamp, employee.id);
      res.json({ employee: publicEmployee(requireEmployee(employee.id)) });
      return;
    }
    const customer = exactCustomerByUsername(raw);
    const username = String(customer.telegram_username || raw).replace(/^@+/, '');
    const taken = db.prepare(`
      SELECT id FROM employees WHERE telegram_id = ? AND id <> ?
    `).get(String(customer.telegram_id), employee.id);
    if (taken) {
      throw new StaffServiceError('telegram_already_linked', 409);
    }
    db.prepare(`
      UPDATE employees
      SET telegram_id = ?, telegram_username = ?, updated_at = ?
      WHERE id = ?
    `).run(String(customer.telegram_id), username, timestamp, employee.id);
    res.json({ employee: publicEmployee(requireEmployee(employee.id)) });
  }),
);

staffRouter.post(
  `${BASE}/employees/:id/reset-pin`,
  managerAccess,
  asyncRoute(async (req, res) => {
    const target = requireEmployee(req.params.id);
    if (
      target.role === 'manager'
      || target.id === req.staffAccess.employee.id
    ) {
      throw new StaffServiceError('admin_reauthentication_required', 403);
    }
    const updated = await setEmployeePin(req.params.id, req.body?.new_pin);
    res.json({ employee: publicEmployee(updated) });
  }),
);

function businessDateFor(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new StaffServiceError('invalid_date', 400);
  }
  const parts = getTimeZoneDateParts(date, 'Europe/Minsk');
  return [
    String(parts.year).padStart(4, '0'),
    String(parts.month).padStart(2, '0'),
    String(parts.day).padStart(2, '0'),
  ].join('-');
}

function analyticsEmployee(req) {
  const actor = req.staffAccess.employee;
  const requested = String(req.query.employee_id || req.body?.employee_id || '').trim();
  if (actor.role !== 'manager' && requested && requested !== actor.id) {
    throw new StaffServiceError('employee_scope_required', 403);
  }
  return requireEmployee(actor.role === 'manager' && requested ? requested : actor.id);
}

function storedUtcMilliseconds(value) {
  const text = String(value || '').trim();
  if (!text) return Number.NaN;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(text)
    ? `${text.replace(' ', 'T')}Z`
    : text;
  return new Date(normalized).getTime();
}

/**
 * Что считается автоматическим плюсом. Полярность в staff_events верить нельзя:
 * там у всех событий жёстко записано 'positive', а строки неизменяемы и
 * переписать их нельзя. Поэтому смысл выводим из типа, а сами числа берём из
 * документов, чтобы отменённое или удалённое не оставалось плюсом навсегда.
 */
const POSITIVE_METRIC_KEYS = [
  'procurement_created',
  'procurement_accepted',
  'transfer_created',
  'transfer_accepted',
  'task_approved',
];

function buildEmployeeAnalytics(employee, selectedPeriod) {
  const { rangeStart: start, rangeEnd: end } = selectedPeriod;
  const startMs = start.getTime();
  const endMs = end.getTime();
  const now = Date.now();
  const nowTimestamp = new Date(now).toISOString();
  const shifts = db.prepare(`
    SELECT *
    FROM staff_shifts
    WHERE employee_id = ?
      AND JULIANDAY(started_at) < JULIANDAY(?)
      AND JULIANDAY(COALESCE(ended_at, ?)) > JULIANDAY(?)
    ORDER BY started_at ASC
  `).all(employee.id, end.toISOString(), nowTimestamp, start.toISOString());
  let workedMilliseconds = 0;
  const dailyWorkedMilliseconds = new Map();
  for (const shift of shifts) {
    const shiftStart = Math.max(storedUtcMilliseconds(shift.started_at), startMs);
    const rawEnd = shift.ended_at
      ? storedUtcMilliseconds(shift.ended_at)
      : Math.min(now, storedUtcMilliseconds(shift.planned_end_at));
    const shiftEnd = Math.min(rawEnd, endMs);
    if (Number.isFinite(shiftStart) && Number.isFinite(shiftEnd) && shiftEnd > shiftStart) {
      const duration = shiftEnd - shiftStart;
      workedMilliseconds += duration;
      const businessDate = String(shift.business_date || '').trim();
      if (businessDate) {
        dailyWorkedMilliseconds.set(
          businessDate,
          Number(dailyWorkedMilliseconds.get(businessDate) || 0) + duration,
        );
      }
    }
  }
  const eventCounts = db.prepare(`
    SELECT event_type, polarity, COUNT(*) AS count
    FROM staff_events
    WHERE employee_id = ?
      AND JULIANDAY(happened_at) >= JULIANDAY(?)
      AND JULIANDAY(happened_at) < JULIANDAY(?)
    GROUP BY event_type, polarity
    ORDER BY count DESC, event_type ASC
  `).all(employee.id, start.toISOString(), end.toISOString());
  const events = db.prepare(`
    SELECT *
    FROM staff_events
    WHERE employee_id = ?
      AND JULIANDAY(happened_at) >= JULIANDAY(?)
      AND JULIANDAY(happened_at) < JULIANDAY(?)
    ORDER BY happened_at DESC, id DESC
    LIMIT 500
  `).all(employee.id, start.toISOString(), end.toISOString()).map((row) => ({
    ...row,
    payload: parseJson(row.payload_json, {}),
  }));
  const dailyEventCounts = db.prepare(`
    SELECT business_date, event_type, COUNT(*) AS count
    FROM staff_events
    WHERE employee_id = ?
      AND JULIANDAY(happened_at) >= JULIANDAY(?)
      AND JULIANDAY(happened_at) < JULIANDAY(?)
    GROUP BY business_date, event_type
    ORDER BY business_date ASC, event_type ASC
  `).all(employee.id, start.toISOString(), end.toISOString());
  const marks = db.prepare(`
    SELECT *
    FROM staff_manual_marks
    WHERE employee_id = ?
      AND deleted_at IS NULL
      AND JULIANDAY(happened_at) >= JULIANDAY(?)
      AND JULIANDAY(happened_at) < JULIANDAY(?)
    ORDER BY happened_at DESC, id DESC
  `).all(employee.id, start.toISOString(), end.toISOString());
  const salary = selectedPeriod.type === 'month'
    ? db.prepare(`
        SELECT *
        FROM staff_monthly_salary_expectations
        WHERE employee_id = ? AND month = ?
        LIMIT 1
      `).get(employee.id, selectedPeriod.month)
    : null;
  const taskActivityCounts = db.prepare(`
    SELECT history.new_status AS status, COUNT(*) AS count
    FROM staff_task_history AS history
    WHERE history.actor_employee_id = ?
      AND history.action IN ('claim', 'submit')
      AND JULIANDAY(history.created_at) >= JULIANDAY(?)
      AND JULIANDAY(history.created_at) < JULIANDAY(?)
    GROUP BY history.new_status
  `).all(employee.id, start.toISOString(), end.toISOString());
  const assembledOrders = db.prepare(`
    SELECT COUNT(*) AS count
    FROM orders
    WHERE assembled_by_employee_id = ?
      AND JULIANDAY(assembled_at) >= JULIANDAY(?)
      AND JULIANDAY(assembled_at) < JULIANDAY(?)
  `).get(employee.id, start.toISOString(), end.toISOString());
  const issuedOrders = db.prepare(`
    SELECT
      COUNT(*) AS count,
      COALESCE(SUM(COALESCE(final_amount, total_amount)), 0) AS revenue,
      COALESCE(SUM(COALESCE(profit, 0)), 0) AS profit
    FROM orders
    WHERE issued_by_employee_id = ?
      AND JULIANDAY(issued_at) >= JULIANDAY(?)
      AND JULIANDAY(issued_at) < JULIANDAY(?)
  `).get(employee.id, start.toISOString(), end.toISOString());
  const metricNames = [
    'order_assembled',
    'order_issued',
    'procurement_created',
    'procurement_accepted',
    'transfer_created',
    'transfer_accepted',
    'task_approved',
  ];
  const metrics = Object.fromEntries(metricNames.map((name) => [name, 0]));
  for (const row of eventCounts) {
    if (Object.hasOwn(metrics, row.event_type)) {
      metrics[row.event_type] += Number(row.count || 0);
    }
  }
  metrics.order_assembled = Number(assembledOrders?.count || 0);
  metrics.order_issued = Number(issuedOrders?.count || 0);
  // Перемещения считаем по самим документам, а не по журналу событий: журнал
  // неизменяемый и про отмену не знает, поэтому отменённая заявка навсегда
  // оставалась в счётчике «создано».
  const transfersCreated = db.prepare(`
    SELECT COUNT(*) AS count
    FROM stock_transfers
    WHERE created_by_employee_id = ?
      AND status <> 'cancelled'
      AND JULIANDAY(created_at) >= JULIANDAY(?)
      AND JULIANDAY(created_at) < JULIANDAY(?)
  `).get(employee.id, start.toISOString(), end.toISOString());
  const transfersCompleted = db.prepare(`
    SELECT COUNT(*) AS count
    FROM stock_transfers
    WHERE completed_by_employee_id = ?
      AND status = 'completed'
      AND JULIANDAY(completed_at) >= JULIANDAY(?)
      AND JULIANDAY(completed_at) < JULIANDAY(?)
  `).get(employee.id, start.toISOString(), end.toISOString());
  metrics.transfer_created = Number(transfersCreated?.count || 0);
  metrics.transfer_accepted = Number(transfersCompleted?.count || 0);
  // Закупки по той же причине: удалённая закупка исчезает из таблицы, а в
  // журнале событие о её создании остаётся навсегда.
  const procurementsCreated = db.prepare(`
    SELECT COUNT(*) AS count
    FROM procurements
    WHERE created_by_employee_id = ?
      AND JULIANDAY(created_at) >= JULIANDAY(?)
      AND JULIANDAY(created_at) < JULIANDAY(?)
  `).get(employee.id, start.toISOString(), end.toISOString());
  const procurementsAccepted = db.prepare(`
    SELECT COUNT(*) AS count
    FROM procurements
    WHERE accepted_by_employee_id = ?
      AND status = 'completed'
      AND JULIANDAY(completed_at) >= JULIANDAY(?)
      AND JULIANDAY(completed_at) < JULIANDAY(?)
  `).get(employee.id, start.toISOString(), end.toISOString());
  metrics.procurement_created = Number(procurementsCreated?.count || 0);
  metrics.procurement_accepted = Number(procurementsAccepted?.count || 0);
  const dailyActivity = new Map();
  for (const [businessDate, duration] of dailyWorkedMilliseconds) {
    dailyActivity.set(businessDate, {
      date: businessDate,
      total: 0,
      worked_minutes: Math.round(Number(duration || 0) / 60_000),
      events: {},
    });
  }
  for (const row of dailyEventCounts) {
    if (!dailyActivity.has(row.business_date)) {
      dailyActivity.set(row.business_date, {
        date: row.business_date,
        total: 0,
        worked_minutes: 0,
        events: {},
      });
    }
    const day = dailyActivity.get(row.business_date);
    const count = Number(row.count || 0);
    day.total += count;
    day.events[row.event_type] = count;
  }

  // Сборка и выдача заказов в журнал событий не пишутся, они живут в самих
  // заказах. Без этого график по выданным всегда оставался пустым, хотя
  // счётчик рядом показывал число.
  const dailyOrders = db.prepare(`
    SELECT business_date, event_type, COUNT(*) AS count FROM (
      SELECT DATE(assembled_at, '+3 hours') AS business_date,
             'order_assembled' AS event_type
        FROM orders
       WHERE assembled_by_employee_id = ?
         AND JULIANDAY(assembled_at) >= JULIANDAY(?)
         AND JULIANDAY(assembled_at) < JULIANDAY(?)
      UNION ALL
      SELECT DATE(issued_at, '+3 hours') AS business_date,
             'order_issued' AS event_type
        FROM orders
       WHERE issued_by_employee_id = ?
         AND JULIANDAY(issued_at) >= JULIANDAY(?)
         AND JULIANDAY(issued_at) < JULIANDAY(?)
    )
    GROUP BY business_date, event_type
  `).all(
    employee.id,
    start.toISOString(),
    end.toISOString(),
    employee.id,
    start.toISOString(),
    end.toISOString(),
  );
  for (const row of dailyOrders) {
    if (!row.business_date) continue;
    if (!dailyActivity.has(row.business_date)) {
      dailyActivity.set(row.business_date, {
        date: row.business_date,
        total: 0,
        worked_minutes: 0,
        events: {},
      });
    }
    const day = dailyActivity.get(row.business_date);
    day.events[row.event_type] = Number(row.count || 0);
  }

  // Плюсы по дням. Условия обязаны совпадать с теми, по которым выше считались
  // итоги, иначе сумма столбиков графика разойдётся с числом в плитке.
  const dailyPositives = db.prepare(`
    SELECT business_date, COUNT(*) AS count FROM (
      SELECT DATE(created_at, '+3 hours') AS business_date
        FROM procurements
       WHERE created_by_employee_id = ?
         AND JULIANDAY(created_at) >= JULIANDAY(?)
         AND JULIANDAY(created_at) < JULIANDAY(?)
      UNION ALL
      SELECT DATE(completed_at, '+3 hours') AS business_date
        FROM procurements
       WHERE accepted_by_employee_id = ?
         AND status = 'completed'
         AND JULIANDAY(completed_at) >= JULIANDAY(?)
         AND JULIANDAY(completed_at) < JULIANDAY(?)
      UNION ALL
      SELECT DATE(created_at, '+3 hours') AS business_date
        FROM stock_transfers
       WHERE created_by_employee_id = ?
         AND status <> 'cancelled'
         AND JULIANDAY(created_at) >= JULIANDAY(?)
         AND JULIANDAY(created_at) < JULIANDAY(?)
      UNION ALL
      SELECT DATE(completed_at, '+3 hours') AS business_date
        FROM stock_transfers
       WHERE completed_by_employee_id = ?
         AND status = 'completed'
         AND JULIANDAY(completed_at) >= JULIANDAY(?)
         AND JULIANDAY(completed_at) < JULIANDAY(?)
      UNION ALL
      SELECT business_date
        FROM staff_events
       WHERE employee_id = ?
         AND event_type = 'task_approved'
         AND JULIANDAY(happened_at) >= JULIANDAY(?)
         AND JULIANDAY(happened_at) < JULIANDAY(?)
    )
    GROUP BY business_date
  `).all(
    ...[
      employee.id, employee.id, employee.id, employee.id, employee.id,
    ].flatMap((id) => [id, start.toISOString(), end.toISOString()]),
  );

  function dayBucket(businessDate) {
    if (!dailyActivity.has(businessDate)) {
      dailyActivity.set(businessDate, {
        date: businessDate,
        total: 0,
        worked_minutes: 0,
        events: {},
      });
    }
    const day = dailyActivity.get(businessDate);
    if (!day.marks) {
      day.marks = {
        manual_positive: 0,
        manual_negative: 0,
        system_positive: 0,
        positive: 0,
        negative: 0,
      };
    }
    return day;
  }

  for (const row of dailyPositives) {
    if (!row.business_date) continue;
    const day = dayBucket(row.business_date);
    day.marks.system_positive += Number(row.count || 0);
  }
  for (const mark of marks) {
    if (!mark.business_date) continue;
    const day = dayBucket(mark.business_date);
    if (mark.mark_type === 'negative') day.marks.manual_negative += 1;
    else day.marks.manual_positive += 1;
  }
  for (const day of dailyActivity.values()) {
    if (!day.marks) continue;
    day.marks.positive = day.marks.manual_positive + day.marks.system_positive;
    day.marks.negative = day.marks.manual_negative;
  }

  const manualPositive = marks.filter((row) => row.mark_type === 'positive').length;
  const manualNegative = marks.filter((row) => row.mark_type === 'negative').length;
  const systemPositive = POSITIVE_METRIC_KEYS.reduce(
    (sum, key) => sum + Number(metrics[key] || 0),
    0,
  );
  const markCounts = {
    positive: manualPositive + systemPositive,
    negative: manualNegative,
    manual_positive: manualPositive,
    manual_negative: manualNegative,
    system_positive: systemPositive,
  };

  return {
    period: {
      type: selectedPeriod.type,
      start: selectedPeriod.start,
      end: selectedPeriod.end,
    },
    ...(selectedPeriod.month ? { month: selectedPeriod.month } : {}),
    employee: publicEmployee(employee),
    worked_minutes: Math.round(workedMilliseconds / 60_000),
    worked_hours: Math.round((workedMilliseconds / 3_600_000) * 100) / 100,
    shifts_count: shifts.length,
    shifts,
    event_counts: eventCounts.map((row) => ({
      event_type: row.event_type,
      polarity: row.polarity,
      count: Number(row.count || 0),
    })),
    events,
    events_total: eventCounts.reduce((sum, row) => sum + Number(row.count || 0), 0),
    metrics: {
      ...metrics,
      orders_issued_amount:
        Math.round(Number(issuedOrders?.revenue || 0) * 100) / 100,
      tasks_completed: metrics.task_approved,
    },
    daily_activity: [...dailyActivity.values()].sort((left, right) => (
      left.date.localeCompare(right.date)
    )),
    marks: marks.map((row) => ({
      ...row,
      voided: Boolean(row.deleted_at),
    })),
    mark_counts: markCounts,
    assembled_orders: Number(assembledOrders?.count || 0),
    issued_orders: Number(issuedOrders?.count || 0),
    issued_revenue: Number(issuedOrders?.revenue || 0),
    issued_profit: Number(issuedOrders?.profit || 0),
    tasks: {
      ...Object.fromEntries(
        taskActivityCounts.map((row) => [row.status, Number(row.count || 0)]),
      ),
      approved: metrics.task_approved,
    },
    expected_salary: salary
      ? {
          ...Object.fromEntries(
            Object.entries(salary).filter(([key]) => key !== 'calculation_json'),
          ),
          amount: Number(salary.amount_minor || 0) / 100,
          visible_to_employee: Boolean(salary.visible_to_employee),
        }
      : null,
  };
}

staffRouter.get(
  `${BASE}/analytics`,
  staffAccess,
  asyncRoute((req, res) => {
    requireFeatureEnabled();
    expireStaffShifts();
    const employee = analyticsEmployee(req);
    res.json(buildEmployeeAnalytics(employee, analyticsPeriod(req.query)));
  }),
);

staffRouter.get(
  `${BASE}/analytics/team`,
  managerAccess,
  asyncRoute((req, res) => {
    const selectedPeriod = analyticsPeriod(req.query);
    const employees = db.prepare(`
      SELECT * FROM employees
      ORDER BY first_name COLLATE NOCASE, last_name COLLATE NOCASE
    `).all();
    res.json({
      period: {
        type: selectedPeriod.type,
        start: selectedPeriod.start,
        end: selectedPeriod.end,
      },
      ...(selectedPeriod.month ? { month: selectedPeriod.month } : {}),
      employees: employees.map((employee) => (
        buildEmployeeAnalytics(employee, selectedPeriod)
      )),
    });
  }),
);

staffRouter.get(
  `${BASE}/shifts`,
  staffAccess,
  asyncRoute((req, res) => {
    const actor = req.staffAccess.employee;
    const requested = String(req.query.employee_id || '').trim();
    if (actor.role !== 'manager' && requested && requested !== actor.id) {
      throw new StaffServiceError('employee_scope_required', 403);
    }
    const employeeId =
      actor.role === 'manager' && requested ? requested : actor.id;
    const month = parseMonth(req.query.month);
    const { start, end } = monthRange(month);
    const shifts = db.prepare(`
      SELECT *
      FROM staff_shifts
      WHERE employee_id = ?
        AND started_at < ?
        AND COALESCE(ended_at, planned_end_at) >= ?
      ORDER BY started_at DESC
    `).all(employeeId, end.toISOString(), start.toISOString());
    res.json({ month, shifts });
  }),
);

function insertManualMarkVersion(mark, {
  action,
  actor,
  reason = null,
}) {
  db.prepare(`
    INSERT INTO staff_manual_mark_versions (
      id, mark_id, version, action, mark_type, points, title, description,
      happened_at, changed_by_employee_id, changed_by_name_snapshot,
      reason, created_at
    ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    makeId('mark_version'),
    mark.id,
    mark.current_version,
    action,
    mark.mark_type,
    mark.title,
    mark.description,
    mark.happened_at,
    actor.id,
    employeeName(actor),
    reason,
    nowIso(),
  );
}

staffRouter.get(
  `${BASE}/marks`,
  staffAccess,
  asyncRoute((req, res) => {
    const employee = analyticsEmployee(req);
    const month = parseMonth(req.query.month);
    const { start, end } = monthRange(month);
    const marks = db.prepare(`
      SELECT *
      FROM staff_manual_marks
      WHERE employee_id = ?
        AND happened_at >= ?
        AND happened_at < ?
      ORDER BY happened_at DESC, id DESC
    `).all(employee.id, start.toISOString(), end.toISOString());
    res.json({
      month,
      marks: marks.map((mark) => ({
        ...mark,
        voided: Boolean(mark.deleted_at),
      })),
    });
  }),
);

staffRouter.get(
  `${BASE}/marks/:id/history`,
  staffAccess,
  asyncRoute((req, res) => {
    const mark = db.prepare('SELECT * FROM staff_manual_marks WHERE id = ?').get(req.params.id);
    if (!mark) throw new StaffServiceError('mark_not_found', 404);
    const actor = req.staffAccess.employee;
    if (actor.role !== 'manager' && mark.employee_id !== actor.id) {
      throw new StaffServiceError('employee_scope_required', 403);
    }
    const versions = db.prepare(`
      SELECT * FROM staff_manual_mark_versions
      WHERE mark_id = ?
      ORDER BY version ASC
    `).all(mark.id);
    res.json({ mark: { ...mark, voided: Boolean(mark.deleted_at) }, versions });
  }),
);

staffRouter.post(
  `${BASE}/marks`,
  managerAccess,
  asyncRoute((req, res) => {
    requireFeatureEnabled();
    const employee = requireEmployee(req.body?.employee_id);
    const markType = String(req.body?.mark_type || '');
    if (!MARK_VALUES.has(markType)) {
      throw new StaffServiceError('invalid_mark_type', 400);
    }
    const title = cleanText(req.body?.title, {
      required: true,
      max: 160,
      code: 'mark_title_required',
    });
    const description = cleanText(req.body?.description, { max: 2000 }) || null;
    const rawHappenedAt = req.body?.happened_at
      ? String(req.body.happened_at).trim()
      : null;
    const happenedAt = rawHappenedAt ? new Date(rawHappenedAt) : new Date();
    if (
      (rawHappenedAt && !ISO_WITH_TIME_ZONE_RE.test(rawHappenedAt))
      || !Number.isFinite(happenedAt.getTime())
    ) {
      throw new StaffServiceError('invalid_mark_date', 400);
    }
    const actor = req.staffAccess.rawEmployee;
    const key = idempotencyKey(req);
    const result = runStaffIdempotentOperation({
      key,
      operation: taskOperationName('staff_mark_create', {
        actorId: actor.id,
        body: req.body || {},
      }),
      entityType: 'staff_manual_mark',
      execute: () => {
        const markId = makeId('mark');
        const timestamp = nowIso();
        db.prepare(`
          INSERT INTO staff_manual_marks (
            id, employee_id, employee_name_snapshot, mark_type, points,
            title, description, happened_at, business_date, current_version,
            created_by_employee_id, created_by_name_snapshot, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, 1, ?, ?, ?, ?)
        `).run(
          markId,
          employee.id,
          employeeName(employee),
          markType,
          title,
          description,
          happenedAt.toISOString(),
          businessDateFor(happenedAt),
          actor.id,
          employeeName(actor),
          timestamp,
          timestamp,
        );
        const created = db
          .prepare('SELECT * FROM staff_manual_marks WHERE id = ?')
          .get(markId);
        insertManualMarkVersion(created, { action: 'create', actor });
        return { ...created, voided: false };
      },
    });
    res.status(result.replayed ? 200 : 201).json({
      replayed: result.replayed,
      mark: result.result,
    });
  }),
);

staffRouter.patch(
  `${BASE}/marks/:id`,
  managerAccess,
  asyncRoute((req, res) => {
    requireFeatureEnabled();
    const actor = req.staffAccess.rawEmployee;
    const expectedVersion = Number(req.body?.expected_version);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new StaffServiceError('mark_version_required', 400);
    }
    const key = idempotencyKey(req);
    const result = runStaffIdempotentOperation({
      key,
      operation: taskOperationName('staff_mark_update', {
        taskId: req.params.id,
        actorId: actor.id,
        body: req.body || {},
      }),
      entityType: 'staff_manual_mark',
      execute: () => {
        const before = db
          .prepare('SELECT * FROM staff_manual_marks WHERE id = ?')
          .get(req.params.id);
        if (!before) throw new StaffServiceError('mark_not_found', 404);
        if (before.deleted_at) {
          throw new StaffServiceError('mark_already_voided', 409);
        }
        if (Number(before.current_version) !== expectedVersion) {
          throw new StaffServiceError('mark_conflict', 409);
        }
        const voided = req.body?.voided === true;
        const reason = cleanText(req.body?.void_reason || req.body?.reason, {
          required: voided,
          max: 500,
          code: 'reason_required',
        }) || null;
        const markType = req.body?.mark_type === undefined
          ? before.mark_type
          : String(req.body.mark_type);
        if (!MARK_VALUES.has(markType)) {
          throw new StaffServiceError('invalid_mark_type', 400);
        }
        const title = req.body?.title === undefined
          ? before.title
          : cleanText(req.body.title, {
              required: true,
              max: 160,
              code: 'mark_title_required',
            });
        const description = req.body?.description === undefined
          ? before.description
          : cleanText(req.body.description, { max: 2000 }) || null;
        const rawHappenedAt = req.body?.happened_at === undefined
          ? null
          : String(req.body.happened_at).trim();
        const happenedAt = rawHappenedAt === null
          ? new Date(before.happened_at)
          : new Date(rawHappenedAt);
        if (
          (
            rawHappenedAt !== null
            && !ISO_WITH_TIME_ZONE_RE.test(rawHappenedAt)
          )
          || !Number.isFinite(happenedAt.getTime())
        ) {
          throw new StaffServiceError('invalid_mark_date', 400);
        }
        const timestamp = nowIso();
        const updated = db.prepare(`
          UPDATE staff_manual_marks
          SET mark_type = ?, points = 0, title = ?, description = ?,
              happened_at = ?, business_date = ?,
              current_version = current_version + 1,
              deleted_at = ?, updated_at = ?
          WHERE id = ? AND deleted_at IS NULL AND current_version = ?
        `).run(
          markType,
          title,
          description,
          happenedAt.toISOString(),
          businessDateFor(happenedAt),
          voided ? timestamp : null,
          timestamp,
          before.id,
          expectedVersion,
        );
        if (updated.changes !== 1) {
          throw new StaffServiceError('mark_conflict', 409);
        }
        const after = db
          .prepare('SELECT * FROM staff_manual_marks WHERE id = ?')
          .get(before.id);
        insertManualMarkVersion(after, {
          action: voided ? 'void' : 'edit',
          actor,
          reason,
        });
        return { ...after, voided: Boolean(after.deleted_at) };
      },
    });
    res.json({
      replayed: result.replayed,
      mark: result.result,
    });
  }),
);

function salaryAmountMinor(body) {
  if (body?.amount_minor !== undefined) {
    const amount = Number(body.amount_minor);
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new StaffServiceError('invalid_salary_amount', 400);
    }
    return amount;
  }
  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new StaffServiceError('invalid_salary_amount', 400);
  }
  const amountMinor = Math.round(amount * 100);
  if (
    !Number.isSafeInteger(amountMinor)
    || Math.abs((amount * 100) - amountMinor) > 1e-8
  ) {
    throw new StaffServiceError('invalid_salary_amount', 400);
  }
  return amountMinor;
}

function publicSalary(row) {
  if (!row) return null;
  const { calculation_json: _hiddenCalculation, ...salary } = row;
  return {
    ...salary,
    amount: Number(row.amount_minor || 0) / 100,
  };
}

function saveSalary(req, employeeId, monthValue) {
  const employee = requireEmployee(employeeId);
  const month = parseMonth(monthValue);
  const amountMinor = salaryAmountMinor(req.body);
  const currency = String(req.body?.currency || 'BYN').trim().toUpperCase();
  if (currency !== 'BYN') {
    throw new StaffServiceError('salary_currency_must_be_byn', 400);
  }
  const note = cleanText(req.body?.note, { max: 2000 }) || null;
  const calculation = {};
  const reason = cleanText(req.body?.reason, { max: 500 }) || null;
  const actor = req.staffAccess.rawEmployee;
  const timestamp = nowIso();
  let salaryId;
  db.transaction(() => {
    const existing = db.prepare(`
      SELECT * FROM staff_monthly_salary_expectations
      WHERE employee_id = ? AND month = ?
    `).get(employee.id, month);
    salaryId = existing?.id || makeId('salary');
    const version = Number(existing?.current_version || 0) + 1;
    if (existing) {
      db.prepare(`
        UPDATE staff_monthly_salary_expectations
        SET employee_name_snapshot = ?, amount_minor = ?, currency = ?,
            status = 'published', calculation_json = ?, note = ?,
            visible_to_employee = 1, visible_from = ?,
            current_version = ?, set_by_employee_id = ?,
            set_by_name_snapshot = ?, updated_at = ?
        WHERE id = ?
      `).run(
        employeeName(employee),
        amountMinor,
        currency,
        stringifyJson(calculation),
        note,
        timestamp,
        version,
        actor.id,
        employeeName(actor),
        timestamp,
        salaryId,
      );
    } else {
      db.prepare(`
        INSERT INTO staff_monthly_salary_expectations (
          id, employee_id, employee_name_snapshot, month, amount_minor,
          currency, status, calculation_json, note, visible_to_employee,
          visible_from, current_version, set_by_employee_id,
          set_by_name_snapshot, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'published', ?, ?, 1, ?, 1, ?, ?, ?, ?)
      `).run(
        salaryId,
        employee.id,
        employeeName(employee),
        month,
        amountMinor,
        currency,
        stringifyJson(calculation),
        note,
        timestamp,
        actor.id,
        employeeName(actor),
        timestamp,
        timestamp,
      );
    }
    db.prepare(`
      INSERT INTO staff_monthly_salary_versions (
        id, salary_expectation_id, version, amount_minor, currency, status,
        calculation_json, note, visible_to_employee, visible_from,
        changed_by_employee_id, changed_by_name_snapshot, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, 'published', ?, ?, 1, ?, ?, ?, ?, ?)
    `).run(
      makeId('salary_version'),
      salaryId,
      version,
      amountMinor,
      currency,
      stringifyJson(calculation),
      note,
      timestamp,
      actor.id,
      employeeName(actor),
      reason,
      timestamp,
    );
  })();
  return db.prepare(`
    SELECT * FROM staff_monthly_salary_expectations WHERE id = ?
  `).get(salaryId);
}

staffRouter.get(
  `${BASE}/salaries`,
  staffAccess,
  asyncRoute((req, res) => {
    const actor = req.staffAccess.employee;
    const requested = String(req.query.employee_id || '').trim();
    if (actor.role !== 'manager' && requested && requested !== actor.id) {
      throw new StaffServiceError('employee_scope_required', 403);
    }
    const employeeId = actor.role === 'manager' && requested ? requested : actor.id;
    const month = parseMonth(req.query.month);
    const salary = db.prepare(`
      SELECT * FROM staff_monthly_salary_expectations
      WHERE employee_id = ? AND month = ?
    `).get(employeeId, month);
    res.json({
      month,
      salary: salary
        ? publicSalary(salary)
        : null,
    });
  }),
);

const putSalary = asyncRoute((req, res) => {
  const employeeId = req.params.employeeId || req.body?.employee_id;
  const month = req.params.month || req.body?.month;
  const salary = saveSalary(req, employeeId, month);
  res.json({ salary: publicSalary(salary) });
});

staffRouter.put(`${BASE}/salaries`, managerAccess, putSalary);
staffRouter.put(`${BASE}/salaries/:employeeId/:month`, managerAccess, putSalary);

staffRouter.get(
  `${BASE}/salaries/:id/history`,
  staffAccess,
  asyncRoute((req, res) => {
    const salary = db.prepare(`
      SELECT * FROM staff_monthly_salary_expectations WHERE id = ?
    `).get(req.params.id);
    if (!salary) throw new StaffServiceError('salary_not_found', 404);
    const actor = req.staffAccess.employee;
    if (actor.role !== 'manager' && salary.employee_id !== actor.id) {
      throw new StaffServiceError('employee_scope_required', 403);
    }
    const versions = db.prepare(`
      SELECT * FROM staff_monthly_salary_versions
      WHERE salary_expectation_id = ?
      ORDER BY version ASC
    `).all(salary.id);
    res.json({
      salary: publicSalary(salary),
      versions: versions.map((version) => {
        const { calculation_json: _hiddenCalculation, ...publicVersion } = version;
        return publicVersion;
      }),
    });
  }),
);

function publicTask(row) {
  if (!row) return null;
  return {
    ...row,
    version: Number(row.version || 0),
  };
}

function requireTask(taskId) {
  const task = db.prepare('SELECT * FROM staff_tasks WHERE id = ?').get(taskId);
  if (!task) throw new StaffServiceError('task_not_found', 404);
  return task;
}

function insertTaskHistory({
  task,
  action,
  previousStatus,
  actor,
  note = null,
  key,
}) {
  db.prepare(`
    INSERT INTO staff_task_history (
      id, task_id, action, previous_status, new_status,
      actor_employee_id, actor_name_snapshot, note,
      idempotency_key, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    makeId('task_history'),
    task.id,
    action,
    previousStatus,
    task.status,
    actor.id,
    employeeName(actor),
    note,
    key,
    nowIso(),
  );
}

function runTaskOperation(req, {
  operation,
  taskId,
  actor,
  execute,
}) {
  const key = idempotencyKey(req);
  const scopedOperation = taskOperationName(operation, {
    taskId,
    actorId: actor.id,
    body: req.body || {},
  });
  return runStaffIdempotentOperation({
    key,
    operation: scopedOperation,
    entityType: 'staff_task',
    execute: () => execute({ key, task: requireTask(taskId), actor }),
  });
}

staffRouter.get(
  `${BASE}/tasks`,
  staffAccess,
  asyncRoute((req, res) => {
    requireFeatureEnabled();
    const actor = req.staffAccess.employee;
    const requestedStatus = cleanText(req.query.status, { max: 30 });
    const limit = Math.min(
      Math.max(Number(req.query.limit) || 100, 1),
      MAX_LIST_LIMIT,
    );
    const conditions = [];
    const params = [];
    if (actor.role !== 'manager') {
      conditions.push(`(
        status = 'open'
        OR assignee_employee_id = ?
      )`);
      params.push(actor.id);
    }
    if (requestedStatus) {
      conditions.push('status = ?');
      params.push(requestedStatus);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit);
    const tasks = db.prepare(`
      SELECT *
      FROM staff_tasks
      ${where}
      ORDER BY
        CASE WHEN status IN ('open', 'claimed', 'submitted') THEN 0 ELSE 1 END,
        CASE WHEN due_at IS NULL THEN 1 ELSE 0 END,
        due_at ASC,
        created_at DESC
      LIMIT ?
    `).all(...params);
    res.json({ tasks: tasks.map(publicTask) });
  }),
);

staffRouter.get(
  `${BASE}/tasks/:id/history`,
  staffAccess,
  asyncRoute((req, res) => {
    requireFeatureEnabled();
    const task = requireTask(req.params.id);
    const actor = req.staffAccess.employee;
    if (
      actor.role !== 'manager'
      && task.target_employee_id !== actor.id
      && task.assignee_employee_id !== actor.id
    ) {
      throw new StaffServiceError('employee_scope_required', 403);
    }
    const history = db.prepare(`
      SELECT * FROM staff_task_history
      WHERE task_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(task.id);
    res.json({ task: publicTask(task), history });
  }),
);

staffRouter.post(
  `${BASE}/tasks`,
  managerAccess,
  asyncRoute((req, res) => {
    requireFeatureEnabled();
    requireNotificationTables();
    const actor = req.staffAccess.rawEmployee;
    // Задачу можно оставить свободной или сразу назначить сотруднику: тогда
    // взять её сможет только он, остальная обвязка это уже умеет.
    const targetEmployee = req.body?.employee_id
      ? requireActiveEmployee(req.body.employee_id)
      : null;
    const title = cleanText(req.body?.title, {
      required: true,
      max: 200,
      code: 'task_title_required',
    });
    const description = cleanText(req.body?.description, {
      required: true,
      max: 4000,
      code: 'task_description_required',
    });
    if (!req.body?.due_at) {
      throw new StaffServiceError('task_due_at_required', 400);
    }
    const rawDueAt = String(req.body.due_at).trim();
    const dueAt = new Date(rawDueAt);
    if (
      !ISO_WITH_TIME_ZONE_RE.test(rawDueAt) ||
      !Number.isFinite(dueAt.getTime())
      || dueAt.getTime() <= Date.now()
    ) {
      throw new StaffServiceError('invalid_task_due_at', 400);
    }
    const key = idempotencyKey(req);
    const operation = taskOperationName('staff_task_create', {
      actorId: actor.id,
      body: req.body || {},
    });
    const result = runStaffIdempotentOperation({
      key,
      operation,
      entityType: 'staff_task',
      execute: () => {
        const timestamp = nowIso();
        const taskId = makeId('task');
        db.prepare(`
          INSERT INTO staff_tasks (
            id, title, description, status, target_employee_id,
            target_employee_name_snapshot, due_at, version,
            created_by_employee_id, created_by_name_snapshot,
            created_at, updated_at
          ) VALUES (?, ?, ?, 'open', ?, ?, ?, 1, ?, ?, ?, ?)
        `).run(
          taskId,
          title,
          description,
          targetEmployee?.id || null,
          targetEmployee ? employeeName(targetEmployee) : null,
          dueAt?.toISOString() || null,
          actor.id,
          employeeName(actor),
          timestamp,
          timestamp,
        );
        const task = requireTask(taskId);
        insertTaskHistory({
          task,
          action: 'create',
          previousStatus: null,
          actor,
          note: description,
          key,
        });
        enqueueTaskNotification({
          task,
          eventType: 'task_created',
          uniqueSuffix: 'created',
        });
        return publicTask(task);
      },
    });
    res.status(result.replayed ? 200 : 201).json({
      replayed: result.replayed,
      task: result.result,
    });
  }),
);

staffRouter.post(
  `${BASE}/tasks/:id/claim`,
  staffAccess,
  // Смену проверяем внутри: личную задачу ведут и без открытой смены.
  asyncRoute((req, res) => {
    requireFeatureEnabled();
    const actor = req.staffAccess.rawEmployee;
    const result = runTaskOperation(req, {
      operation: 'staff_task_claim',
      taskId: req.params.id,
      actor,
      execute: ({ key, task }) => {
        if (task.status !== 'open') {
          throw new StaffServiceError('task_claim_conflict', 409);
        }
        // Сначала про адресность: она понятнее для чужой задачи, чем «нет смены».
        if (task.target_employee_id && task.target_employee_id !== actor.id) {
          throw new StaffServiceError('task_assigned_to_another_employee', 403);
        }
        requireOwnShiftUnlessPersonal(task, actor, req.staffShiftProof);
        const timestamp = nowIso();
        const updated = db.prepare(`
          UPDATE staff_tasks
          SET status = 'claimed', assignee_employee_id = ?,
              assignee_employee_name_snapshot = ?, claimed_at = ?,
              version = version + 1, updated_at = ?
          WHERE id = ? AND status = 'open'
        `).run(
          actor.id,
          employeeName(actor),
          timestamp,
          timestamp,
          task.id,
        );
        if (updated.changes !== 1) {
          throw new StaffServiceError('task_claim_conflict', 409);
        }
        const after = requireTask(task.id);
        insertTaskHistory({
          task: after,
          action: 'claim',
          previousStatus: task.status,
          actor,
          key,
        });
        return publicTask(after);
      },
    });
    res.json({ replayed: result.replayed, task: result.result });
  }),
);

staffRouter.post(
  `${BASE}/tasks/:id/submit`,
  staffAccess,
  // Смену проверяем внутри: личную задачу ведут и без открытой смены.
  asyncRoute((req, res) => {
    requireFeatureEnabled();
    requireNotificationTables();
    const actor = req.staffAccess.rawEmployee;
    const note = cleanText(req.body?.result_note, { max: 4000 }) || null;
    const result = runTaskOperation(req, {
      operation: 'staff_task_submit',
      taskId: req.params.id,
      actor,
      execute: ({ key, task }) => {
        requireOwnShiftUnlessPersonal(task, actor, req.staffShiftProof);
        if (
          !['claimed', 'submitted'].includes(task.status)
          || task.assignee_employee_id !== actor.id
        ) {
          throw new StaffServiceError('task_submit_conflict', 409);
        }
        const timestamp = nowIso();
        const updated = db.prepare(`
          UPDATE staff_tasks
          SET status = 'submitted', result_note = ?, submitted_at = ?,
              version = version + 1, updated_at = ?
          WHERE id = ? AND status IN ('claimed', 'submitted')
            AND assignee_employee_id = ?
        `).run(note, timestamp, timestamp, task.id, actor.id);
        if (updated.changes !== 1) {
          throw new StaffServiceError('task_submit_conflict', 409);
        }
        const after = requireTask(task.id);
        insertTaskHistory({
          task: after,
          action: 'submit',
          previousStatus: task.status,
          actor,
          note,
          key,
        });
        enqueueTaskNotification({
          task: after,
          eventType: 'task_review_requested',
          uniqueSuffix: `submitted:${after.version}`,
        });
        return publicTask(after);
      },
    });
    res.json({ replayed: result.replayed, task: result.result });
  }),
);

staffRouter.post(
  `${BASE}/tasks/:id/approve`,
  managerAccess,
  asyncRoute((req, res) => {
    requireFeatureEnabled();
    const actor = req.staffAccess.rawEmployee;
    const note = cleanText(req.body?.note, { max: 2000 }) || null;
    const result = runTaskOperation(req, {
      operation: 'staff_task_approve',
      taskId: req.params.id,
      actor,
      execute: ({ key, task }) => {
        if (task.status !== 'submitted' || !task.assignee_employee_id) {
          throw new StaffServiceError('task_approve_conflict', 409);
        }
        const timestamp = nowIso();
        const updated = db.prepare(`
          UPDATE staff_tasks
          SET status = 'approved', approved_at = ?,
              version = version + 1, updated_at = ?
          WHERE id = ? AND status = 'submitted'
        `).run(timestamp, timestamp, task.id);
        if (updated.changes !== 1) {
          throw new StaffServiceError('task_approve_conflict', 409);
        }
        const after = requireTask(task.id);
        insertTaskHistory({
          task: after,
          action: 'approve',
          previousStatus: task.status,
          actor,
          note,
          key,
        });
        recordSystemStaffEvent({
          employeeId: after.assignee_employee_id,
          eventType: 'task_approved',
          entityType: 'staff_task',
          entityId: after.id,
          idempotencyKey: `staff-task-approved:${after.id}`,
          sourceType: 'Задача',
          sourceName: after.title,
          payload: {
            task_title: after.title,
            result_note: after.result_note,
          },
          createdByEmployeeId: actor.id,
          createdByName: employeeName(actor),
        });
        return publicTask(after);
      },
    });
    res.json({ replayed: result.replayed, task: result.result });
  }),
);

staffRouter.post(
  `${BASE}/tasks/:id/cancel`,
  managerAccess,
  asyncRoute((req, res) => {
    requireFeatureEnabled();
    const actor = req.staffAccess.rawEmployee;
    const note = cleanText(req.body?.reason, {
      required: true,
      max: 1000,
      code: 'reason_required',
    });
    const result = runTaskOperation(req, {
      operation: 'staff_task_cancel',
      taskId: req.params.id,
      actor,
      execute: ({ key, task }) => {
        if (!TASK_OPEN_STATES.has(task.status)) {
          throw new StaffServiceError('task_cancel_conflict', 409);
        }
        const timestamp = nowIso();
        const updated = db.prepare(`
          UPDATE staff_tasks
          SET status = 'cancelled', cancelled_at = ?,
              version = version + 1, updated_at = ?
          WHERE id = ? AND status IN ('open', 'claimed', 'submitted')
        `).run(timestamp, timestamp, task.id);
        if (updated.changes !== 1) {
          throw new StaffServiceError('task_cancel_conflict', 409);
        }
        const after = requireTask(task.id);
        insertTaskHistory({
          task: after,
          action: 'cancel',
          previousStatus: task.status,
          actor,
          note,
          key,
        });
        return publicTask(after);
      },
    });
    res.json({ replayed: result.replayed, task: result.result });
  }),
);

staffRouter.post(
  `${BASE}/tasks/:id/release`,
  managerAccess,
  asyncRoute((req, res) => {
    requireFeatureEnabled();
    const actor = req.staffAccess.rawEmployee;
    const note = cleanText(req.body?.reason, { max: 1000 }) || null;
    const result = runTaskOperation(req, {
      operation: 'staff_task_release',
      taskId: req.params.id,
      actor,
      execute: ({ key, task }) => {
        const canRelease = task.status === 'claimed' && actor.role === 'manager';
        if (!canRelease) {
          throw new StaffServiceError('task_release_conflict', 409);
        }
        const timestamp = nowIso();
        const updated = db.prepare(`
          UPDATE staff_tasks
          SET status = 'open', assignee_employee_id = NULL,
              assignee_employee_name_snapshot = NULL, claimed_at = NULL,
              target_employee_id = NULL,
              target_employee_name_snapshot = NULL,
              result_note = NULL, version = version + 1, updated_at = ?
          WHERE id = ? AND status = 'claimed'
        `).run(timestamp, task.id);
        if (updated.changes !== 1) {
          throw new StaffServiceError('task_release_conflict', 409);
        }
        const after = requireTask(task.id);
        insertTaskHistory({
          task: after,
          action: 'release',
          previousStatus: task.status,
          actor,
          note,
          key,
        });
        return publicTask(after);
      },
    });
    res.json({ replayed: result.replayed, task: result.result });
  }),
);

staffRouter.get(
  `${BASE}/notifications`,
  managerAccess,
  asyncRoute((req, res) => {
    requireNotificationTables();
    const limit = Math.min(
      Math.max(Number(req.query.limit) || 100, 1),
      MAX_LIST_LIMIT,
    );
    const status = cleanText(req.query.status, { max: 30 });
    const settings = db.prepare(`
      SELECT * FROM internal_notification_settings
      ORDER BY event_group ASC
    `).all();
    const recipients = db.prepare(`
      SELECT * FROM internal_notification_recipients
      ORDER BY event_group ASC, id ASC
    `).all();
    const outbox = status
      ? db.prepare(`
          SELECT * FROM internal_notification_outbox
          WHERE status = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `).all(status, limit)
      : db.prepare(`
          SELECT * FROM internal_notification_outbox
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `).all(limit);
    res.json({
      settings: settings.map((row) => ({ ...row, enabled: Boolean(row.enabled) })),
      recipients: recipients.map((row) => ({ ...row, active: Boolean(row.active) })),
      templates: listInternalNotificationTemplates(db),
      outbox: outbox.map((row) => ({
        ...row,
        payload: parseJson(row.payload_json, {}),
        result: parseJson(row.result_json, null),
      })),
    });
  }),
);

staffRouter.put(
  `${BASE}/notifications/templates/:eventType`,
  managerAccess,
  asyncRoute((req, res) => {
    let saved;
    try {
      saved = saveInternalNotificationTemplate(db, req.params.eventType, req.body?.text);
    } catch (error) {
      const code = error?.message === 'notification_text_required_too_long'
        ? 'notification_text_too_long'
        : 'invalid_notification_template';
      throw new StaffServiceError(code, 400);
    }
    res.json({ template: saved, templates: listInternalNotificationTemplates(db) });
  }),
);

/** Предпросмотр на выдуманных данных: показать, как текст выглядит целиком. */
staffRouter.post(
  `${BASE}/notifications/templates/preview`,
  managerAccess,
  asyncRoute((req, res) => {
    const text = cleanText(req.body?.text, { required: true, max: 4096, code: 'invalid_notification_template' });
    res.json({
      preview: renderNotificationTemplate(text, {
        document_number: 1042,
        employee_name: 'Павел Сергеевич',
        from_location: 'Склад',
        to_location: 'Витрина',
        title: 'Проверить остатки на витрине',
        deadline: new Date(Date.now() + 86_400_000).toISOString(),
        period_label: 'июль 2026',
      }),
    });
  }),
);

staffRouter.post(
  `${BASE}/notifications/resolve-recipient`,
  managerAccess,
  asyncRoute((req, res) => {
    const customer = exactCustomerByUsername(req.body?.username);
    res.json({
      telegram_id: String(customer.telegram_id),
      telegram_username: String(customer.telegram_username || '').replace(/^@+/, ''),
      display_name:
        `${customer.first_name || ''} ${customer.last_name || ''}`.trim()
        || `@${String(customer.telegram_username || '').replace(/^@+/, '')}`,
    });
  }),
);

staffRouter.put(
  `${BASE}/notifications/settings`,
  managerAccess,
  asyncRoute((req, res) => {
    requireNotificationTables();
    const changes = Array.isArray(req.body?.settings)
      ? req.body.settings
      : [req.body];
    const update = db.prepare(`
      UPDATE internal_notification_settings
      SET enabled = ?, updated_at = DATETIME('now')
      WHERE event_group = ?
    `);
    db.transaction(() => {
      for (const change of changes) {
        const group = String(change?.event_group || '');
        if (!NOTIFICATION_GROUPS.has(group) || typeof change?.enabled !== 'boolean') {
          throw new StaffServiceError('invalid_notification_setting', 400);
        }
        if (update.run(change.enabled ? 1 : 0, group).changes !== 1) {
          throw new StaffServiceError('notification_group_not_found', 404);
        }
      }
    })();
    const settings = db.prepare(`
      SELECT * FROM internal_notification_settings ORDER BY event_group
    `).all();
    res.json({
      settings: settings.map((row) => ({ ...row, enabled: Boolean(row.enabled) })),
    });
  }),
);

staffRouter.post(
  `${BASE}/notifications/recipients`,
  managerAccess,
  asyncRoute((req, res) => {
    requireNotificationTables();
    const group = String(req.body?.event_group || '');
    if (!NOTIFICATION_GROUPS.has(group)) {
      throw new StaffServiceError('invalid_notification_group', 400);
    }
    const confirmed = confirmedRecipient(req.body);
    const timestamp = nowIso();
    db.prepare(`
      INSERT INTO internal_notification_recipients (
        event_group, telegram_id, telegram_username, display_name,
        active, confirmed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(event_group, telegram_id) DO UPDATE SET
        telegram_username = excluded.telegram_username,
        display_name = excluded.display_name,
        active = 1,
        confirmed_at = excluded.confirmed_at,
        updated_at = excluded.updated_at
    `).run(
      group,
      confirmed.telegram_id,
      confirmed.telegram_username,
      confirmed.display_name,
      timestamp,
      timestamp,
      timestamp,
    );
    const recipient = db.prepare(`
      SELECT * FROM internal_notification_recipients
      WHERE event_group = ? AND telegram_id = ?
    `).get(group, confirmed.telegram_id);
    res.status(201).json({ recipient });
  }),
);

staffRouter.delete(
  `${BASE}/notifications/recipients/:id`,
  managerAccess,
  asyncRoute((req, res) => {
    requireNotificationTables();
    const recipient = db.prepare(`
      SELECT * FROM internal_notification_recipients WHERE id = ?
    `).get(req.params.id);
    if (!recipient) {
      throw new StaffServiceError('notification_recipient_not_found', 404);
    }
    db.prepare('DELETE FROM internal_notification_recipients WHERE id = ?')
      .run(recipient.id);
    res.json({ ok: true });
  }),
);

staffRouter.post(
  `${BASE}/notifications/outbox/:id/resume`,
  managerAccess,
  asyncRoute((req, res) => {
    requireNotificationTables();
    const reason = cleanText(req.body?.reason, {
      required: true,
      max: 300,
      code: 'reason_required',
    });
    const resumed = resumeUnknownInternalNotification(db, req.params.id, { reason });
    if (!resumed) {
      throw new StaffServiceError('notification_not_unknown', 409);
    }
    const notification = db.prepare(`
      SELECT * FROM internal_notification_outbox WHERE id = ?
    `).get(req.params.id);
    res.json({ notification });
  }),
);

export default staffRouter;
