import { Router } from 'express';
import { db } from '../db.js';
import { authMiddleware } from '../auth.js';
import { isDashboardLockActive, isDashboardTokenValid } from '../utils/dashboard-access.js';
import {
  authenticateStaffAccessToken,
  createStaffAccessMiddleware,
  isStaffTrackingEnabled,
  prepareActiveShiftProof,
  recheckActiveShiftProof,
  sendStaffServiceError,
  StaffServiceError,
} from '../utils/staff-service.js';
import { FinancialCloseError } from '../utils/financial-close-calculations.js';
import { createFinancialDayCloseService } from '../utils/financial-day-close-service.js';
import { isFinancialCloseEnabled, isFinancialCloseTestResetEnabled } from '../utils/financial-close-activation.js';

export const financialDayCloseRouter = Router();
const service = createFinancialDayCloseService(db);
const BASE = '/api/admin/crm/financial-close';

// Disabled installations must not query tables from the opt-in migration.
financialDayCloseRouter.use(BASE, authMiddleware, (req, res, next) => {
  if (!isFinancialCloseEnabled()) {
    return res.status(503).json({
      error: 'financial_close_disabled',
      message: 'Закрытие финансового дня пока не включено. Перед включением необходима проверенная резервная копия и исправная база.',
    });
  }
  next();
});

function dashboardAccess(req, res, next) {
  if (!isDashboardLockActive()) return next();
  if (!isDashboardTokenValid(String(req.get('X-Dashboard-Token') || '').trim())) {
    return res.status(403).json({ error: 'dashboard_locked' });
  }
  next();
}

function operator(req) {
  const username = String(req.user?.u || '').trim();
  if (!username) throw new FinancialCloseError('closing_actor_required', 403);
  if (!isStaffTrackingEnabled()) return { employeeId: null, name: username, username, role: 'admin' };
  const token = req.get('X-Staff-Token') || req.get('X-Shift-Token');
  const auth = authenticateStaffAccessToken(token, { allowShift: true });
  const employee = auth.employee;
  return {
    employeeId: employee.id,
    name: `${employee.first_name || ''} ${employee.last_name || ''}`.trim() || 'Сотрудник',
    username, role: employee.role, token,
  };
}

function access(req, res, next) {
  try { req.financialCloseActor = operator(req); next(); }
  catch (error) { handleError(res, error); }
}

function handleError(res, error) {
  if (error instanceof StaffServiceError) return sendStaffServiceError(res, error);
  if (error instanceof FinancialCloseError) {
    return res.status(error.status).json({ error: error.code, details: error.details });
  }
  console.error('[financial-close] Request failed:', error?.code || error?.name || 'unknown');
  return res.status(500).json({ error: 'financial_close_failed' });
}

function route(fn) {
  return (req, res) => { try { fn(req, res); } catch (error) { handleError(res, error); } };
}

function localTestResetAvailable(req) {
  return isFinancialCloseTestResetEnabled()
    && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
    && ['manager', 'admin'].includes(req.financialCloseActor?.role);
}

financialDayCloseRouter.get(`${BASE}/context`, authMiddleware, access, dashboardAccess, route((req, res) => {
  res.json({
    ...service.context({ cash_account_id: req.query.cash_account_id, revenue_account_id: req.query.revenue_account_id }),
    test_reset_enabled: localTestResetAvailable(req),
  });
}));

financialDayCloseRouter.post(`${BASE}/history/:id/test-reset`, authMiddleware, access, dashboardAccess, route((req, res) => {
  if (!localTestResetAvailable(req)) throw new FinancialCloseError('financial_close_test_reset_disabled', 403);
  const actor = req.financialCloseActor;
  res.json(service.resetForTesting(req.params.id, {
    actor, confirmationId: req.body?.confirm_closure_id,
    verifyActor: () => {
      const fresh = operator(req);
      if (fresh.employeeId !== actor.employeeId || fresh.role !== actor.role) {
        throw new FinancialCloseError('closing_actor_changed', 409);
      }
      if (!['manager', 'admin'].includes(fresh.role)) {
        throw new FinancialCloseError('closing_test_reset_manager_required', 403);
      }
    },
  }));
}));

financialDayCloseRouter.get(`${BASE}/history`, authMiddleware, access, dashboardAccess, route((req, res) => {
  res.json({ items: service.list({ limit: Number(req.query.limit || 50), offset: Number(req.query.offset || 0) }) });
}));

financialDayCloseRouter.get(`${BASE}/history/:id`, authMiddleware, access, dashboardAccess, route((req, res) => {
  const closure = service.get(req.params.id);
  if (!closure) throw new FinancialCloseError('closing_not_found', 404);
  res.json({ closure });
}));

financialDayCloseRouter.post(`${BASE}/preview`, authMiddleware, access, dashboardAccess, route((req, res) => {
  const result = service.preview(req.body);
  result.context.test_reset_enabled = localTestResetAvailable(req);
  res.json(result);
}));

financialDayCloseRouter.post(`${BASE}/complete`, authMiddleware, access, dashboardAccess, route((req, res) => {
  const actor = req.financialCloseActor;
  // Commit finances now; the worker closes only the captured shift after confirmed report delivery.
  const proof = isStaffTrackingEnabled() && actor.role !== 'manager'
    ? prepareActiveShiftProof() : null;
  if (proof && proof.employeeId !== actor.employeeId) throw new StaffServiceError('shift_required', 409);
  const result = service.close(req.body, {
    requestKey: req.get('Idempotency-Key'), actor,
    verifyActor: () => {
      const fresh = operator(req);
      if (fresh.employeeId !== actor.employeeId || fresh.role !== actor.role) {
        throw new FinancialCloseError('closing_actor_changed', 409);
      }
      if (proof) recheckActiveShiftProof(proof);
    },
  });
  res.status(result.replay ? 200 : 201).json(result);
}));

financialDayCloseRouter.post(`${BASE}/history/:id/report`, authMiddleware,
  createStaffAccessMiddleware({ manager: true }), dashboardAccess, route((req, res) => {
    res.json({ closure: service.enqueueReport(req.params.id) });
  }));
