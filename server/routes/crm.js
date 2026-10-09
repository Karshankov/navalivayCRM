import express from 'express';
import { db } from '../db.js';
import { authMiddleware } from '../auth.js';
import {
  isDashboardLockActive,
  isDashboardTokenValid,
} from '../utils/dashboard-access.js';
import {
  getBusinessCalendarDayRange,
  getBusinessCalendarMonthRange,
  getBusinessDayLabel,
  getBusinessPeriodRange,
  shiftBusinessCalendarDate,
  toSqliteUtcString,
} from '../utils/business-time.js';
import { queryTopSalesGroups } from '../utils/top-sales-groups.js';
import { getLatestPickupCellAssignment } from '../utils/pickup-cells.js';
import {
  REVIEW_STATUSES,
  disableReviewQaModes,
  getReviewSetting,
  getReviewSettingsResponse,
  setQaUsernames,
  setReviewSetting,
} from '../utils/product-reviews.js';
import { runReviewQaSeed } from '../utils/review-qa-seed.js';
import {
  getDrawById,
  getReviewPeriodKey,
  rerollDrawSeat,
  runMonthlyReviewDraw,
} from '../utils/review-monthly-draw.js';
import {
  PENDING_ACTIVE_PREDICATE,
  computeBlockUntil,
  createBlock,
  deletePendingBan,
  getActiveBlockForCustomerId,
  getActiveBlockForTelegramId,
  getCustomerBlockById,
  serializeBlock,
  unblockCustomerBlock,
} from '../utils/customer-blocks.js';
import {
  clearCustomerNote,
  listPendingCustomerNotes,
  sanitizeCustomerNote,
  serializePendingNote,
  touchKanbanOrdersForCustomer,
  upsertCustomerNote,
} from '../utils/customer-notes.js';
import { formatBlockNotifyMessage } from '../utils/block-notify-message.js';
import {
  createOrMergePosCustomer,
  getCustomerPurchaseHistory,
  searchCustomers,
  softDeleteCustomer,
} from '../utils/pos-customers.js';
import {
  PAUSE_REASONS,
  computeLowStockGroups,
  getGroupStockItems,
  getLowStockSummary,
  pauseGroup,
  resumeGroup,
} from '../utils/low-stock-groups.js';
import {
  listAllAgreements,
  createAgreement,
  updateAgreement,
  deleteAgreement,
} from '../utils/agreements.js';
import { createStaffAccessMiddleware } from '../utils/staff-service.js';
import {
  addCardDailyIncrease,
  addManualCardOperation,
  adjustCardDailyLimit,
  applyCardTariffToAccount,
  approveCardLimitRequest,
  clearCardAccountCooldown,
  findCardAccountProfileByUsername,
  fromMinorUnits,
  getCardAdminSnapshot,
  getCardCustomerSnapshot,
  normalizeTelegramUsername,
  setCardAccount,
  setCardAccountCooldownDays,
  setCardMonthlyLimit,
  toMinorUnits,
} from '../utils/card-payment-service.js';
import {
  BOT_STATUS_EVENTS,
  listBusinessConnections,
  getActiveBusinessConnection,
  listQuickReplies,
  createQuickReply,
  updateQuickReply,
  deleteQuickReply,
  listStatusTemplates,
  upsertStatusTemplate,
  generateVerificationCode,
  attachVerificationCode,
  getStatusTemplate,
  renderTemplate,
  normalizeCustomerOrderTerminology,
  isAutoReplyEnabled,
  setAutoReplyEnabled,
  getRecentLogCount,
  listBotLog,
  logBotMessage,
} from '../utils/business-bot.js';
import {
  sendBusinessMessage,
  checkBotTokenLive,
} from '../utils/telegram-business-api.js';
import {
  convertLegacyTelegramMarkup,
  TELEGRAM_HTML_PARSE_MODE,
} from '../utils/telegram-message-format.js';
import {
  sendViaUserbot,
  isUserbotAvailable,
} from '../utils/userbot-client.js';
import { gateSendCustomTelegramForCrmBlock } from '../utils/crm-telegram-outbound.js';
import {
  addDisallowedInviterUsernames,
  createInviteBan,
  createInviteBanByUsername,
  grantStaffAccess,
  isReferralAuthorizationEnabled,
  listDisallowedInviterUsernames,
  listInviteBans,
  listReferralAuthorizations,
  listStaffAccessGrants,
  removeDisallowedInviterUsername,
  removeInviteBan,
  removePendingInviteBan,
  removePendingStaffAccess,
  revokeStaffAccess,
  setReferralAuthorizationEnabled,
} from '../utils/referral-authorization.js';

export const crmRouter = express.Router();
const staffManagerAccess = createStaffAccessMiddleware({ manager: true });

// Card payments are intentionally available to every authenticated CRM user
// who is on the orders page. These routes do not use shift middleware and do
// not write staff activity events.
crmRouter.get('/api/admin/crm/card-payments', authMiddleware, (req, res) => {
  try {
    return res.json(getCardAdminSnapshot());
  } catch (error) {
    console.error('[crm] Card payments snapshot error:', error);
    return res.status(500).json({ error: 'card_payment_snapshot_failed' });
  }
});

crmRouter.put('/api/admin/crm/card-payments/monthly-limit', authMiddleware, (req, res) => {
  try {
    const monthKey = String(req.body?.month_key || '').trim();
    const amountMinor = toMinorUnits(req.body?.amount);
    if (!/^\d{4}-\d{2}$/.test(monthKey)) {
      return res.status(400).json({ error: 'invalid_month_key' });
    }
    setCardMonthlyLimit(monthKey, amountMinor);
    return res.json(getCardAdminSnapshot());
  } catch (error) {
    return res.status(400).json({ error: error.message || 'invalid_monthly_limit' });
  }
});

// Корректировка дневного лимита дельтой: положительная = увеличить,
// отрицательная = уменьшить. Месячный лимит не меняется напрямую, но план
// будущих дней пересчитывается из остатка месяца автоматически.
crmRouter.post('/api/admin/crm/card-payments/daily-adjust', authMiddleware, (req, res) => {
  try {
    // Дельта может быть отрицательной (уменьшение) — валидируем знак сами,
    // toMinorUnits rejects < 0.
    const raw = Number(req.body?.delta);
    if (!Number.isFinite(raw) || raw === 0) {
      return res.status(400).json({ error: 'invalid_amount' });
    }
    const deltaMinor = Math.round((Math.abs(raw) + Number.EPSILON) * 100) * Math.sign(raw);
    adjustCardDailyLimit(deltaMinor, req.user?.u || 'admin');
    return res.json(getCardAdminSnapshot());
  } catch (error) {
    return res.status(400).json({ error: error.message || 'daily_adjust_failed' });
  }
});

// Поиск карточного профиля клиента по @username (для быстрой карточки в CRM).
crmRouter.get('/api/admin/crm/card-payments/profile/:username', authMiddleware, (req, res) => {
  try {
    const profile = findCardAccountProfileByUsername(req.params.username);
    if (!profile) return res.status(404).json({ error: 'card_profile_not_found' });
    return res.json(profile);
  } catch (error) {
    return res.status(400).json({ error: error.message || 'card_profile_search_failed' });
  }
});

crmRouter.post('/api/admin/crm/card-payments/manual', authMiddleware, (req, res) => {
  try {
    const amountMinor = toMinorUnits(req.body?.amount);
    if (amountMinor <= 0) return res.status(400).json({ error: 'invalid_amount' });
    addManualCardOperation({
      amountMinor,
      note: String(req.body?.note || '').trim() || null,
      actorUsername: req.user?.u || 'admin',
    });
    return res.status(201).json(getCardAdminSnapshot());
  } catch (error) {
    return res.status(400).json({ error: error.message || 'manual_card_operation_failed' });
  }
});

crmRouter.post('/api/admin/crm/card-payments/accounts', authMiddleware, (req, res) => {
  try {
    const username = normalizeTelegramUsername(req.body?.telegram_username);
    const telegramId = String(req.body?.telegram_id || '').trim() || null;
    const enabled = req.body?.enabled !== false;
    const maxOrderMinor = toMinorUnits(req.body?.max_order ?? 45);
    if (!username && !telegramId) return res.status(400).json({ error: 'telegram_identity_required' });
    setCardAccount({
      telegramId,
      telegramUsername: username,
      enabled,
      monthlyLimitMinor: toMinorUnits(req.body?.monthly_limit ?? 250),
      maxOrderMinor,
    });
    return res.status(201).json(getCardAdminSnapshot());
  } catch (error) {
    return res.status(400).json({ error: error.message || 'card_account_save_failed' });
  }
});

crmRouter.patch('/api/admin/crm/card-payments/accounts/:telegramId', authMiddleware, (req, res) => {
  try {
    const accountId = String(req.params.telegramId || '').trim();
    const current = db.prepare('SELECT * FROM card_payment_accounts WHERE telegram_id = ?').get(accountId);
    if (!current) return res.status(404).json({ error: 'card_account_not_found' });
    setCardAccount({
      telegramId: accountId,
      telegramUsername: req.body?.telegram_username ?? current.telegram_username,
      enabled: req.body?.enabled === undefined ? Boolean(current.enabled) : req.body.enabled !== false,
      monthlyLimitMinor: req.body?.monthly_limit === undefined
        ? Number(current.monthly_limit_minor)
        : toMinorUnits(req.body.monthly_limit),
      maxOrderMinor: req.body?.max_order === undefined
        ? Number(current.max_order_minor)
        : toMinorUnits(req.body.max_order),
    });
    return res.json(getCardAdminSnapshot());
  } catch (error) {
    return res.status(400).json({ error: error.message || 'card_account_update_failed' });
  }
});

crmRouter.put('/api/admin/crm/card-payments/accounts/by-telegram-id/:telegramId', authMiddleware, (req, res) => {
  try {
    const telegramId = String(req.params.telegramId || '').trim();
    if (!telegramId) return res.status(400).json({ error: 'telegram_identity_required' });
    const customer = db.prepare(`
      SELECT telegram_username FROM customers WHERE telegram_id = ?
    `).get(telegramId);
    const current = db.prepare('SELECT * FROM card_payment_accounts WHERE telegram_id = ?').get(telegramId);
    const enabled = req.body?.enabled === true;
    setCardAccount({
      telegramId,
      telegramUsername: current?.telegram_username || customer?.telegram_username || req.body?.telegram_username,
      enabled,
      monthlyLimitMinor: Number(current?.monthly_limit_minor ?? 25000),
      maxOrderMinor: Number(current?.max_order_minor ?? 4500),
    });
    return res.json(getCardAdminSnapshot());
  } catch (error) {
    return res.status(400).json({ error: error.message || 'card_account_update_failed' });
  }
});

// Смена тарифа аккаунта: лимиты применяются автоматически.
// tariff_id: null | '' — сброс на стандарт 250/45, иначе id активного тарифа.
crmRouter.put('/api/admin/crm/card-payments/accounts/:telegramId/tariff', authMiddleware, (req, res) => {
  try {
    const telegramId = String(req.params.telegramId || '').trim();
    const tariffId = req.body?.tariff_id == null ? '' : String(req.body.tariff_id).trim();
    if (!telegramId) return res.status(400).json({ error: 'invalid_telegram_id' });
    applyCardTariffToAccount(telegramId, tariffId || null);
    return res.json(getCardAdminSnapshot());
  } catch (error) {
    return res.status(400).json({ error: error.message || 'card_tariff_apply_failed' });
  }
});

// Длительность паузы после выдачи для аккаунта (0 = паузы нет).
crmRouter.put('/api/admin/crm/card-payments/accounts/:telegramId/cooldown-days', authMiddleware, (req, res) => {
  try {
    const telegramId = String(req.params.telegramId || '').trim();
    if (!telegramId) return res.status(400).json({ error: 'invalid_telegram_id' });
    setCardAccountCooldownDays(telegramId, req.body?.days);
    const account = db.prepare('SELECT telegram_username FROM card_payment_accounts WHERE telegram_id = ?').get(telegramId);
    const profile = findCardAccountProfileByUsername(account?.telegram_username || telegramId);
    return res.json({ ok: true, profile });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'card_cooldown_days_failed' });
  }
});

// Принудительно снять активную паузу (как будто срок прошёл).
crmRouter.post('/api/admin/crm/card-payments/accounts/:telegramId/clear-cooldown', authMiddleware, (req, res) => {
  try {
    const telegramId = String(req.params.telegramId || '').trim();
    if (!telegramId) return res.status(400).json({ error: 'invalid_telegram_id' });
    clearCardAccountCooldown(telegramId, req.user?.u || 'admin');
    const account = db.prepare('SELECT telegram_username FROM card_payment_accounts WHERE telegram_id = ?').get(telegramId);
    const profile = findCardAccountProfileByUsername(account?.telegram_username || telegramId);
    return res.json({ cleared: true, profile });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'card_cooldown_clear_failed' });
  }
});

// Одобрить заявку: лимиты тарифа заявки применяются к аккаунту автоматически.
crmRouter.post('/api/admin/crm/card-payments/requests/:id/approve', authMiddleware, (req, res) => {
  try {
    approveCardLimitRequest(req.params.id, req.user?.u || 'admin');
    return res.json(getCardAdminSnapshot());
  } catch (error) {
    return res.status(400).json({ error: error.message || 'card_request_approve_failed' });
  }
});

crmRouter.patch('/api/admin/crm/card-payments/requests/:id', authMiddleware, (req, res) => {
  try {
    const status = String(req.body?.status || '').trim();
    if (!['new', 'processed', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'invalid_request_status' });
    }
    const changed = db.prepare(`
      UPDATE card_payment_limit_requests
      SET status = ?, resolved_at = CASE WHEN ? = 'new' THEN NULL ELSE DATETIME('now') END,
          resolved_by = CASE WHEN ? = 'new' THEN NULL ELSE ? END,
          resolution_note = ?
      WHERE id = ?
    `).run(
      status,
      status,
      status,
      req.user?.u || 'admin',
      String(req.body?.note || '').trim() || null,
      req.params.id,
    );
    if (!changed.changes) return res.status(404).json({ error: 'request_not_found' });
    return res.json(getCardAdminSnapshot());
  } catch (error) {
    return res.status(400).json({ error: error.message || 'card_request_update_failed' });
  }
});

crmRouter.post('/api/admin/crm/card-payments/tariffs', authMiddleware, (req, res) => {
  try {
    const title = String(req.body?.title || '').trim();
    const limitMinor = toMinorUnits(req.body?.limit);
    // Два поля тарифа: месячный лимит и лимит заказа. Если передан только
    // старый limit — считаем его месячным, лимит заказа = стандарт 45 BYN.
    const monthlyLimitMinor = req.body?.monthly_limit === undefined
      ? limitMinor
      : toMinorUnits(req.body.monthly_limit);
    const perOrderLimitMinor = req.body?.per_order_limit === undefined
      ? 4500
      : toMinorUnits(req.body.per_order_limit);
    const position = Number(req.body?.position ?? 0);
    if (
      !title || limitMinor <= 0 || monthlyLimitMinor < 0 || perOrderLimitMinor <= 0
      || !Number.isInteger(position) || position < 0
    ) {
      return res.status(400).json({ error: 'invalid_tariff' });
    }
    const id = `tariff_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    db.prepare(`
      INSERT INTO card_payment_tariffs
        (id, title, limit_minor, monthly_limit_minor, per_order_limit_minor,
         transition_cost_text, position, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      title,
      limitMinor,
      monthlyLimitMinor,
      perOrderLimitMinor,
      String(req.body?.transition_cost_text || '').trim() || null,
      position,
      req.body?.active === false ? 0 : 1,
    );
    return res.status(201).json(getCardAdminSnapshot());
  } catch (error) {
    return res.status(400).json({ error: error.message || 'card_tariff_create_failed' });
  }
});

crmRouter.patch('/api/admin/crm/card-payments/tariffs/:id', authMiddleware, (req, res) => {
  try {
    const current = db.prepare('SELECT * FROM card_payment_tariffs WHERE id = ?').get(req.params.id);
    if (!current) return res.status(404).json({ error: 'tariff_not_found' });
    const title = String(req.body?.title ?? current.title).trim();
    const limitMinor = req.body?.limit === undefined
      ? Number(current.limit_minor)
      : toMinorUnits(req.body.limit);
    const monthlyLimitMinor = req.body?.monthly_limit === undefined
      ? Number(current.monthly_limit_minor ?? current.limit_minor)
      : toMinorUnits(req.body.monthly_limit);
    const perOrderLimitMinor = req.body?.per_order_limit === undefined
      ? Number(current.per_order_limit_minor ?? 4500)
      : toMinorUnits(req.body.per_order_limit);
    const position = req.body?.position === undefined
      ? Number(current.position)
      : Number(req.body.position);
    if (
      !title || limitMinor <= 0 || monthlyLimitMinor < 0 || perOrderLimitMinor <= 0
      || !Number.isInteger(position) || position < 0
    ) {
      return res.status(400).json({ error: 'invalid_tariff' });
    }
    db.prepare(`
      UPDATE card_payment_tariffs
      SET title = ?, limit_minor = ?, monthly_limit_minor = ?, per_order_limit_minor = ?,
          transition_cost_text = ?, position = ?, active = ?
      WHERE id = ?
    `).run(
      title,
      limitMinor,
      monthlyLimitMinor,
      perOrderLimitMinor,
      String(req.body?.transition_cost_text ?? current.transition_cost_text ?? '').trim() || null,
      position,
      req.body?.active === undefined ? current.active : (req.body.active === false ? 0 : 1),
      req.params.id,
    );
    return res.json(getCardAdminSnapshot());
  } catch (error) {
    return res.status(400).json({ error: error.message || 'card_tariff_update_failed' });
  }
});

crmRouter.delete('/api/admin/crm/card-payments/tariffs/:id', authMiddleware, (req, res) => {
  try {
    const removed = db.prepare('DELETE FROM card_payment_tariffs WHERE id = ?').run(req.params.id);
    if (!removed.changes) return res.status(404).json({ error: 'tariff_not_found' });
    return res.json(getCardAdminSnapshot());
  } catch (error) {
    return res.status(400).json({ error: error.message || 'card_tariff_delete_failed' });
  }
});

// Helper для генерации ID
function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Helper для получения следующего номера
function getNextNumber(table, field) {
  const row = db.prepare(`SELECT MAX(${field}) as maxNum FROM ${table}`).get();
  return (row?.maxNum || 0) + 1;
}

// =========================
/**
 * Внутри окна проверок сводку отдаём только по пропуску из
 * /api/admin/dashboard-access/verify. Без этого замок был бы декоративным:
 * данные всё равно приезжали бы в браузер, и их было бы видно через консоль.
 */
function requireDashboardAccess(req, res, next) {
  if (!isDashboardLockActive()) return next();
  const token = String(req.get('X-Dashboard-Token') || '').trim();
  if (!isDashboardTokenValid(token)) {
    return res.status(403).json({ error: 'dashboard_locked' });
  }
  return next();
}

// DASHBOARD (Главная CRM)
// =========================
crmRouter.get('/api/admin/crm/dashboard', authMiddleware, requireDashboardAccess, (req, res) => {
  try {
    const { period = 'today' } = req.query;
    const offset = Number(req.query.offset || 0) || 0;

    // Произвольный диапазон дат (period=custom): from/to в формате YYYY-MM-DD.
    // Парсим строго как business-tz даты, чтобы границы суток совпадали с
    // остальными ветками (иначе UTC-смещение режет/добавляет ~3 часа).
    let start, end;
    const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
    if (period === 'custom') {
      const m1 = ISO_DATE.exec(String(req.query.from || ''));
      const m2 = ISO_DATE.exec(String(req.query.to || ''));
      if (!m1 || !m2) {
        return res.status(400).json({ error: 'invalid_custom_range', message: 'from/to must be YYYY-MM-DD' });
      }
      const fromRange = getBusinessCalendarDayRange(+m1[1], +m1[2], +m1[3]);
      const toRange = getBusinessCalendarDayRange(+m2[1], +m2[2], +m2[3]);
      if (fromRange.start.getTime() >= toRange.end.getTime()) {
        return res.status(400).json({ error: 'invalid_custom_range', message: 'from must be earlier than to' });
      }
      start = fromRange.start;
      // toRange.end — это уже начало (to+1)-го дня (exclusive), что нам и нужно
      end = toRange.end;
    } else {
      ({ start, end } = getBusinessPeriodRange(period, offset));
    }

    // Параметры топ-линеек
    const topSort = req.query.top_sort === 'quantity' ? 'quantity' : 'profit';
    const topLimitRaw = Number(req.query.top_limit ?? 5);
    const topLimit = Number.isFinite(topLimitRaw) ? Math.min(Math.max(Math.trunc(topLimitRaw), 1), 1000) : 5;
    // Эскейпим LIKE-метасимволы, чтобы поиск по «5_unit» / «100%» не превращался в wildcard
    const rawTopSearch = typeof req.query.top_search === 'string' ? req.query.top_search.trim() : '';
    const topSearch = rawTopSearch.replace(/[\\%_]/g, (ch) => '\\' + ch);

    // Функция для форматирования даты в SQLite-совместимый формат (YYYY-MM-DD HH:MM:SS)
    function toSqliteDate(date) {
      return toSqliteUtcString(date);
    }
    
    // Для статистики заказов используем created_at
    const createdAtFilter = `created_at >= '${toSqliteDate(start)}' AND created_at < '${toSqliteDate(end)}'`;
    // Для финансовой статистики используем paid_at (дата оплаты/выдачи)
    const paidAtFilter = `paid_at >= '${toSqliteDate(start)}' AND paid_at < '${toSqliteDate(end)}'`;

    // Выручка, прибыль, количество продаж - по дате ОПЛАТЫ (paid_at)
    const stats = db.prepare(`
      SELECT 
        COALESCE(COUNT(o.id), 0)                              AS total_sales,
        COALESCE(SUM(COALESCE(o.final_amount, o.total_amount)), 0) AS revenue,
        COALESCE(SUM(COALESCE(o.profit, 0)), 0)               AS profit,
        COALESCE(COUNT(DISTINCT o.customer_id), 0)            AS unique_customers
      FROM orders o
      WHERE o.status IN ('completed', 'delivered')
        AND o.paid_at IS NOT NULL
        AND ${paidAtFilter}
    `).get();

    // POS продажи - добавляем к общей статистике
    const posStats = db.prepare(`
      SELECT 
        COALESCE(COUNT(*), 0) AS pos_sales,
        COALESCE(SUM(price), 0) AS pos_revenue,
        COALESCE(SUM(profit), 0) AS pos_profit
      FROM pos_sales
      WHERE status = 'completed'
        AND datetime(completed_at) >= '${toSqliteDate(start)}' 
        AND datetime(completed_at) < '${toSqliteDate(end)}'
    `).get();

    // Объединяем статистику заказов и POS
    const combinedStats = {
      total_sales: (stats.total_sales || 0) + (posStats.pos_sales || 0),
      revenue: (stats.revenue || 0) + (posStats.pos_revenue || 0),
      profit: (stats.profit || 0) + (posStats.pos_profit || 0),
      unique_customers: stats.unique_customers || 0
    };

    const { items: topItems, hasMore: topProductsHasMore } = queryTopSalesGroups({
      start,
      end,
      sortBy: topSort,
      limit: topLimit,
      search: topSearch,
    });
    const topProducts = topItems.map((item) => ({
      group_id: item.groupId,
      group_name: item.groupName,
      has_cover_image: item.hasCoverImage,
      total_quantity: item.totalQuantity,
      total_revenue: item.totalRevenue,
      total_profit: item.totalProfit,
    }));

    // Статистика по статусам заказов - по дате СОЗДАНИЯ
    const ordersByStatus = db.prepare(`
      SELECT 
        status,
        COUNT(*) as count
      FROM orders
      WHERE ${createdAtFilter}
      GROUP BY status
    `).all();

    // Доставки - по дате ОПЛАТЫ
    const deliveryStats = db.prepare(`
      SELECT 
        COUNT(*) as deliveries,
        COALESCE(SUM(profit), 0) as delivery_profit
      FROM orders
      WHERE delivery_type = 'delivery'
        AND status IN ('completed', 'delivered')
        AND paid_at IS NOT NULL
        AND ${paidAtFilter}
    `).get();

    // Самовывозы - по дате ОПЛАТЫ
    const pickupStats = db.prepare(`
      SELECT 
        COUNT(*) as pickups,
        COALESCE(SUM(profit), 0) as pickup_profit
      FROM orders
      WHERE delivery_type = 'pickup'
        AND status IN ('completed', 'delivered')
        AND paid_at IS NOT NULL
        AND ${paidAtFilter}
    `).get();

    res.json({
      period,
      stats: {
        totalSales: combinedStats.total_sales,
        revenue: combinedStats.revenue,
        profit: combinedStats.profit,
        averageCheck: combinedStats.total_sales > 0 ? combinedStats.revenue / combinedStats.total_sales : 0,
        uniqueCustomers: combinedStats.unique_customers || 0
      },
      topProducts,
      topProductsHasMore,
      ordersByStatus,
      deliveryStats: {
        deliveries: deliveryStats?.deliveries || 0,
        profit: deliveryStats?.delivery_profit || 0
      },
      pickupStats: {
        pickups: pickupStats?.pickups || 0,
        profit: pickupStats?.pickup_profit || 0
      }
    });
  } catch (error) {
    console.error('[crm] Dashboard error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// Dashboard Timeseries - детализированные данные для графиков
crmRouter.get('/api/admin/crm/dashboard-timeseries', authMiddleware, requireDashboardAccess, (req, res) => {
  try {
    const { period = 'month', year } = req.query;
    const offset = Number(req.query.offset || 0) || 0;

    function getPeriodRange(p, off, yr) {
      const now = new Date();
      function startOfUTCDay(d) {
        return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      }
      
      if (p === 'today') {
        // Для дня - возвращаем данные по часам (упрощенно - один столбик)
        const base = startOfUTCDay(now);
        const start = new Date(base.getTime() + off * 24 * 60 * 60 * 1000);
        const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
        return { start, end, granularity: 'day' };
      }
      
      if (p === 'month') {
        const y = now.getUTCFullYear();
        const m = now.getUTCMonth();
        const start = new Date(Date.UTC(y, m + off, 1));
        const end = new Date(Date.UTC(y, m + off + 1, 1));
        return { start, end, granularity: 'day' };
      }
      
      if (p === 'year') {
        const targetYear = yr ? Number(yr) : now.getUTCFullYear() + off;
        const start = new Date(Date.UTC(targetYear, 0, 1));
        const end = new Date(Date.UTC(targetYear + 1, 0, 1));
        return { start, end, granularity: 'month' };
      }
      
      const base = startOfUTCDay(now);
      return { start: base, end: new Date(base.getTime() + 24 * 60 * 60 * 1000), granularity: 'day' };
    }

    const {
      start,
      end,
      granularity,
      calendarStart,
    } = getBusinessPeriodRange(period, offset, year);
    const data = [];
    
    // Функция для форматирования даты в SQLite-совместимый формат (YYYY-MM-DD HH:MM:SS)
    function toSqliteDate(date) {
      return toSqliteUtcString(date);
    }

    if (granularity === 'month') {
      // По месяцам для года
      const monthNames = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
      
      for (let i = 0; i < 12; i++) {
        const { start: monthStart, end: monthEnd } = getBusinessCalendarMonthRange(
          Number(year || calendarStart.year),
          i + 1,
        );
        
        const stats = db.prepare(`
          SELECT 
            COALESCE(COUNT(o.id), 0)                              AS orders,
            COALESCE(SUM(COALESCE(o.final_amount, o.total_amount)), 0) AS revenue,
            COALESCE(SUM(COALESCE(o.profit, 0)), 0)               AS profit
          FROM orders o
          WHERE o.status IN ('completed', 'delivered')
            AND o.paid_at IS NOT NULL
            AND o.paid_at >= ?
            AND o.paid_at < ?
        `).get(toSqliteDate(monthStart), toSqliteDate(monthEnd));

        // POS продажи за этот месяц
        const posStats = db.prepare(`
          SELECT 
            COALESCE(COUNT(*), 0) AS orders,
            COALESCE(SUM(price), 0) AS revenue,
            COALESCE(SUM(profit), 0) AS profit
          FROM pos_sales
          WHERE status = 'completed'
            AND datetime(completed_at) >= ?
            AND datetime(completed_at) < ?
        `).get(toSqliteDate(monthStart), toSqliteDate(monthEnd));
        
        data.push({
          label: monthNames[i],
          orders: (stats?.orders || 0) + (posStats?.orders || 0),
          revenue: (stats?.revenue || 0) + (posStats?.revenue || 0),
          profit: (stats?.profit || 0) + (posStats?.profit || 0)
        });
      }
    } else if (granularity === 'day') {
      // По дням для месяца
      for (let i = 0; ; i++) {
        const dayParts = shiftBusinessCalendarDate(calendarStart, i);
        const { start: dayStart, end: dayEnd } = getBusinessCalendarDayRange(
          dayParts.year,
          dayParts.month,
          dayParts.day,
        );
        if (dayStart >= end) {
          break;
        }
        
        const stats = db.prepare(`
          SELECT 
            COALESCE(COUNT(o.id), 0)                              AS orders,
            COALESCE(SUM(COALESCE(o.final_amount, o.total_amount)), 0) AS revenue,
            COALESCE(SUM(COALESCE(o.profit, 0)), 0)               AS profit
          FROM orders o
          WHERE o.status IN ('completed', 'delivered')
            AND o.paid_at IS NOT NULL
            AND o.paid_at >= ?
            AND o.paid_at < ?
        `).get(toSqliteDate(dayStart), toSqliteDate(dayEnd));

        // POS продажи за этот день
        const posStats = db.prepare(`
          SELECT 
            COALESCE(COUNT(*), 0) AS orders,
            COALESCE(SUM(price), 0) AS revenue,
            COALESCE(SUM(profit), 0) AS profit
          FROM pos_sales
          WHERE status = 'completed'
            AND datetime(completed_at) >= ?
            AND datetime(completed_at) < ?
        `).get(toSqliteDate(dayStart), toSqliteDate(dayEnd));
        
        data.push({
          label: getBusinessDayLabel(dayStart),
          orders: (stats?.orders || 0) + (posStats?.orders || 0),
          revenue: (stats?.revenue || 0) + (posStats?.revenue || 0),
          profit: (stats?.profit || 0) + (posStats?.profit || 0)
        });
      }
    }

    res.json(data);
  } catch (error) {
    console.error('[crm] Dashboard timeseries error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// =========================
// EMPLOYEES (Сотрудники)
// =========================
crmRouter.get(
  '/api/admin/crm/employees',
  authMiddleware,
  staffManagerAccess,
  (req, res) => {
  try {
    const employees = db.prepare(`
      SELECT id, username, first_name, last_name, position, active, created_at, updated_at
      FROM employees
      ORDER BY created_at DESC
    `).all();
    res.json(employees);
  } catch (error) {
    console.error('[crm] Get employees error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
  },
);

function staffEndpointMoved(_req, res) {
  res.status(410).json({
    error: 'staff_endpoint_moved',
    replacement: '/api/admin/crm/staff/employees',
  });
}

crmRouter.post(
  '/api/admin/crm/employees',
  authMiddleware,
  staffManagerAccess,
  staffEndpointMoved,
);
crmRouter.patch(
  '/api/admin/crm/employees/:id',
  authMiddleware,
  staffManagerAccess,
  staffEndpointMoved,
);
crmRouter.delete(
  '/api/admin/crm/employees/:id',
  authMiddleware,
  staffManagerAccess,
  staffEndpointMoved,
);

// =========================
// CUSTOMERS (Клиенты)
// =========================
crmRouter.get('/api/admin/crm/customers', authMiddleware, (req, res) => {
  try {
    const { filter } = req.query;
    const requestedLimit = Number.parseInt(String(req.query.limit || ''), 10);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : null;
    const rawQuery = typeof req.query.q === 'string' ? req.query.q.trim().replace(/^@+/, '') : '';
    const unprocessedOnly = parseTruthyParam(req.query.unprocessed);
    
    const conditions = [];
    const params = {};
    
    if (filter === 'inactive') {
      conditions.push("c.last_order_at IS NOT NULL AND c.last_order_at < DATETIME('now', '-45 days')");
    } else if (filter === 'cold') {
      conditions.push('COALESCE(c.total_orders, 0) = 0');
    }
    if (unprocessedOnly) {
      conditions.push('NOT EXISTS (SELECT 1 FROM customer_feedbacks cf WHERE cf.customer_id = c.id)');
    }
    if (rawQuery) {
      params.query = `%${rawQuery}%`;
      conditions.push(`(
        c.telegram_username LIKE @query COLLATE NOCASE
        OR c.telegram_id LIKE @query
        OR c.first_name LIKE @query COLLATE NOCASE
        OR c.last_name LIKE @query COLLATE NOCASE
        OR c.phone LIKE @query
      )`);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitClause = limit ? 'LIMIT @limit' : '';
    if (limit) params.limit = limit;

    // Pavel 11.05.2026: «блокировка снялась, но повторно заблокать не могу,
    // пишет старая ещё активна». Причина — этот подзапрос считал ВСЕ блоки
    // с active=1, не учитывая block_until. Истёкшие блоки (срок прошёл, но
    // active=1, потому что никто их не снимает автоматически) попадали в
    // blocked_count → фронт показывал «Разблокировать», а backend по
    // ACTIVE_BLOCK_PREDICATE уже их не видел и unblock возвращал no-op.
    // Та же логика должна быть и здесь: блок «активный» = active=1 И не истёк.
    const customers = db.prepare(`
      SELECT
        c.*,
        (SELECT COUNT(*) FROM customer_blocks
          WHERE customer_id = c.id
            AND active = 1
            AND (block_until IS NULL OR block_until > DATETIME('now'))) as blocked_count
      FROM customers c
      ${whereClause}
      ORDER BY c.last_visit_at DESC, c.created_at DESC
      ${limitClause}
    `).all(params);

    // Краткие списки раздела «Клиенты» не используют историю посещений.
    // Без неё исчезает отдельный запрос к БД на каждую строку.
    res.json(customers);
  } catch (error) {
    console.error('[crm] Get customers error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// ВНИМАНИЕ: статические сегменты пути (search, pos-customers) объявляются
// ДО ':id' маршрутов — иначе Express отдаст :id-обработчику и /search, и
// /pos-customers будут резолвиться как customer с id="search".

// =========================
// Заканчивающиеся линейки (плашка в Закупках + индикатор в сайдбаре)
// =========================

// Полный список линеек требующих закупки.
crmRouter.get('/api/admin/crm/low-stock-groups', authMiddleware, (req, res) => {
  try {
    const items = computeLowStockGroups();
    res.json({ items, reasons: PAUSE_REASONS });
  } catch (error) {
    console.error('[crm] List low-stock groups error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// Lightweight-проверка: есть ли вообще заканчивающиеся (для красной точки в сайдбаре).
// Делает ту же работу что и list, но возвращает только { hasAny, count } —
// без сетевых костов передачи всего массива.
crmRouter.get('/api/admin/crm/low-stock-groups/summary', authMiddleware, (req, res) => {
  try {
    res.json(getLowStockSummary());
  } catch (error) {
    console.error('[crm] Low-stock summary error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// Вкусы выбранной линейки: от нулевого остатка к самому большому.
crmRouter.get('/api/admin/crm/low-stock-groups/:groupId/flavors', authMiddleware, (req, res) => {
  try {
    res.json({ items: getGroupStockItems(req.params.groupId) });
  } catch (err) {
    if (err.code === 'group_not_found') {
      return res.status(404).json({ error: 'group_not_found' });
    }
    console.error('[crm] List low-stock group flavors error:', err);
    res.status(500).json({ error: 'failed', message: err.message });
  }
});

// Скрыть линейку из плашки на N дней. reason: 'short' | 'no_supply' | 'not_produced'.
crmRouter.post('/api/admin/crm/low-stock-groups/:groupId/pause', authMiddleware, (req, res) => {
  try {
    const result = pauseGroup({
      groupId: req.params.groupId,
      reason: req.body?.reason,
      byUser: req.user?.u || 'admin',
    });
    res.json({ ok: true, pause: result });
  } catch (err) {
    if (err.code === 'invalid_pause_reason') {
      return res.status(400).json({ error: 'invalid_pause_reason' });
    }
    if (err.code === 'group_not_found') {
      return res.status(404).json({ error: 'group_not_found' });
    }
    console.error('[crm] Pause low-stock group error:', err);
    res.status(500).json({ error: 'failed', message: err.message });
  }
});

// Снять активную паузу (вернуть линейку в плашку до истечения срока).
crmRouter.delete('/api/admin/crm/low-stock-groups/:groupId/pause', authMiddleware, (req, res) => {
  try {
    const removed = resumeGroup(req.params.groupId);
    res.json({ ok: true, removed });
  } catch (error) {
    console.error('[crm] Resume low-stock group error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// =============================================================================
// Agreements (соглашения перед оформлением заказа)
//
// CRUD из CRM «Настройки». Публичный список — отдельный endpoint в public.js.
// Все handler'ы возвращают единый формат { item } / { items }.
// =============================================================================

crmRouter.get('/api/admin/crm/agreements', authMiddleware, (req, res) => {
  try {
    res.json({ items: listAllAgreements() });
  } catch (err) {
    console.error('[crm] List agreements error:', err);
    res.status(500).json({ error: 'failed', message: err.message });
  }
});

crmRouter.post('/api/admin/crm/agreements', authMiddleware, (req, res) => {
  try {
    const item = createAgreement({
      title: req.body?.title,
      body: req.body?.body,
      modal_title: req.body?.modal_title,
      is_active: req.body?.is_active,
      sort_order: req.body?.sort_order,
    });
    res.json({ ok: true, item });
  } catch (err) {
    if (
      err.code === 'title_required' ||
      err.code === 'title_too_long' ||
      err.code === 'body_too_long' ||
      err.code === 'modal_title_too_long'
    ) {
      return res.status(400).json({ error: err.code });
    }
    console.error('[crm] Create agreement error:', err);
    res.status(500).json({ error: 'failed', message: err.message });
  }
});

crmRouter.put('/api/admin/crm/agreements/:id', authMiddleware, (req, res) => {
  try {
    const item = updateAgreement(req.params.id, {
      title: req.body?.title,
      body: req.body?.body,
      modal_title: req.body?.modal_title,
      is_active: req.body?.is_active,
      sort_order: req.body?.sort_order,
    });
    res.json({ ok: true, item });
  } catch (err) {
    if (err.code === 'agreement_not_found') {
      return res.status(404).json({ error: err.code });
    }
    if (
      err.code === 'title_required' ||
      err.code === 'title_too_long' ||
      err.code === 'body_too_long' ||
      err.code === 'modal_title_too_long'
    ) {
      return res.status(400).json({ error: err.code });
    }
    console.error('[crm] Update agreement error:', err);
    res.status(500).json({ error: 'failed', message: err.message });
  }
});

crmRouter.delete('/api/admin/crm/agreements/:id', authMiddleware, (req, res) => {
  try {
    const removed = deleteAgreement(req.params.id);
    if (!removed) {
      // 404 чтобы UI второго админа (который тоже нажал Delete после первого)
      // увидел stale-data и мог сделать рефреш списка.
      return res.status(404).json({ error: 'agreement_not_found' });
    }
    res.json({ ok: true, removed });
  } catch (err) {
    console.error('[crm] Delete agreement error:', err);
    res.status(500).json({ error: 'failed', message: err.message });
  }
});

// =============================================================================
// Bot (Telegram Business mode)
//
// Все endpoints под authMiddleware. Исходящие сообщения отправляются прямым
// вызовом Telegram Bot API через utils/telegram-business-api.js — bot-процесс
// (long-polling Telegraf) и API-процесс (Express) на проде запущены отдельно
// через PM2 и не делят память, поэтому нельзя дёрнуть функцию из bot-процесса
// напрямую. Telegram сам синхронизирует delivery — ничего терять не будем.
// =============================================================================

crmRouter.get('/api/admin/crm/bot/status', authMiddleware, async (req, res) => {
  try {
    const connections = listBusinessConnections();
    const active = getActiveBusinessConnection();
    // bot_token_live = реально дёргаем Telegram getMe (с кэшем 60с) — это
    // надёжнее чем просто проверка наличия env-переменной.
    const tokenCheck = await checkBotTokenLive();
    // userbot_available = MTProto-клиент от лица аккаунта менеджера живой
    // (см. server/userbot/index.js + utils/userbot-client.js). Это сейчас
    // основной канал отправки, без 24-часового окна Telegram Business.
    const userbotConnected = await isUserbotAvailable();
    res.json({
      auto_replies_enabled: isAutoReplyEnabled(),
      bot_token_configured: Boolean((process.env.BOT_TOKEN || '').trim()),
      bot_token_live: tokenCheck.ok,
      bot_token_error: tokenCheck.ok ? null : tokenCheck.reason,
      bot_process_online: tokenCheck.ok && Boolean(active),
      active_connection: active,
      connections,
      // Userbot: основной канал отправки. true = шлёт от лица менеджера
      // через MTProto, без 24-часового окна Business mode.
      userbot_connected: userbotConnected,
      // delivery_ready: хотя бы один канал доставки рабочий (userbot ИЛИ
      // Business mode). UI ориентируется на это для общей доступности
      // отправки клиентам — менеджеру не важен конкретный канал.
      delivery_ready: userbotConnected || (tokenCheck.ok && Boolean(active)),
      quick_reply_count: listQuickReplies().length,
      quick_reply_active_count: listQuickReplies({ activeOnly: true }).length,
      status_templates: listStatusTemplates(),
      recent_log_count: getRecentLogCount({ sinceHours: 24 }),
    });
  } catch (err) {
    console.error('[crm] Bot status error:', err);
    res.status(500).json({ error: 'failed', message: err.message });
  }
});

crmRouter.put('/api/admin/crm/bot/settings', authMiddleware, (req, res) => {
  try {
    const next =
      req.body?.auto_replies_enabled === undefined
        ? null
        : Boolean(req.body.auto_replies_enabled);
    if (next === null) {
      return res.status(400).json({ error: 'auto_replies_enabled_required' });
    }
    const value = setAutoReplyEnabled(next);
    res.json({ ok: true, auto_replies_enabled: value });
  } catch (err) {
    console.error('[crm] Bot settings error:', err);
    res.status(500).json({ error: 'failed', message: err.message });
  }
});

// ----- Block reason templates -----------------------------------------------
crmRouter.get('/api/admin/crm/block-reason-templates', authMiddleware, (req, res) => {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'block_reason_templates'").get();
    const templates = row ? JSON.parse(row.value) : [];
    res.json({ templates });
  } catch (err) {
    console.error('[crm] block-reason-templates GET error:', err);
    res.status(500).json({ error: 'failed' });
  }
});

crmRouter.put('/api/admin/crm/block-reason-templates', authMiddleware, (req, res) => {
  try {
    const { templates } = req.body;
    if (!Array.isArray(templates)) {
      return res.status(400).json({ error: 'templates_must_be_array' });
    }
    const filtered = templates.map(s => String(s).trim()).filter(Boolean);
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('block_reason_templates', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(JSON.stringify(filtered));
    res.json({ templates: filtered });
  } catch (err) {
    console.error('[crm] block-reason-templates PUT error:', err);
    res.status(500).json({ error: 'failed' });
  }
});

// ----- Авторизация через пригласившего -------------------------------------
crmRouter.get('/api/admin/crm/referral-authorizations', authMiddleware, (_req, res) => {
  try {
    res.json({ items: listReferralAuthorizations() });
  } catch (error) {
    console.error('[crm] referral authorizations list error:', error);
    res.status(500).json({ error: 'failed' });
  }
});

crmRouter.get('/api/admin/crm/referral-authorization/staff-access', authMiddleware, (_req, res) => {
  return res.json(listStaffAccessGrants());
});

crmRouter.post('/api/admin/crm/referral-authorization/staff-access', authMiddleware, (req, res) => {
  try {
    const result = grantStaffAccess({
      customerId: req.body?.customer_id ? String(req.body.customer_id) : null,
      telegramUsername: req.body?.telegram_username,
      grantedBy: req.user?.u || 'admin',
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    if (error.code === 'customer_not_found') return res.status(404).json({ error: error.code });
    if (['username_invalid', 'username_ambiguous'].includes(error.code)) {
      return res.status(error.code === 'username_ambiguous' ? 409 : 400).json({ error: error.code });
    }
    console.error('[crm] grant staff access error:', error);
    return res.status(500).json({ error: 'failed' });
  }
});

crmRouter.delete('/api/admin/crm/referral-authorization/staff-access/pending/:id', authMiddleware, (req, res) => {
  if (!removePendingStaffAccess(req.params.id)) return res.status(404).json({ error: 'not_found' });
  return res.json({ ok: true });
});

crmRouter.delete('/api/admin/crm/referral-authorization/staff-access/:customerId', authMiddleware, (req, res) => {
  try {
    revokeStaffAccess(req.params.customerId, req.user?.u || 'admin');
    return res.json({ ok: true });
  } catch (error) {
    if (error.code === 'customer_not_found') return res.status(404).json({ error: error.code });
    if (['not_staff_authorized', 'access_is_permanent'].includes(error.code)) {
      return res.status(409).json({ error: error.code });
    }
    console.error('[crm] revoke staff access error:', error);
    return res.status(500).json({ error: 'failed' });
  }
});

crmRouter.get('/api/admin/crm/referral-authorization/settings', authMiddleware, (_req, res) => {
  res.json({ enabled: isReferralAuthorizationEnabled() });
});

crmRouter.put('/api/admin/crm/referral-authorization/settings', authMiddleware, (req, res) => {
  if (typeof req.body?.enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled_must_be_boolean' });
  }
  const enabled = req.body.enabled;
  setReferralAuthorizationEnabled(enabled);
  return res.json({ enabled });
});

crmRouter.get('/api/admin/crm/referral-authorization/disallowed-usernames', authMiddleware, (_req, res) => {
  return res.json({ items: listDisallowedInviterUsernames() });
});

crmRouter.post('/api/admin/crm/referral-authorization/disallowed-usernames', authMiddleware, (req, res) => {
  try {
    const items = addDisallowedInviterUsernames(req.body?.usernames, req.user?.u || 'admin');
    return res.json({ items });
  } catch (error) {
    if (['usernames_must_be_array', 'usernames_count_invalid', 'username_invalid'].includes(error.code)) {
      return res.status(400).json({ error: error.code });
    }
    if (error.code === 'username_has_invite_ban') {
      return res.status(409).json({ error: error.code, username: error.username });
    }
    console.error('[crm] add disallowed inviter usernames error:', error);
    return res.status(500).json({ error: 'failed' });
  }
});

crmRouter.delete('/api/admin/crm/referral-authorization/disallowed-usernames/:username', authMiddleware, (req, res) => {
  const removed = removeDisallowedInviterUsername(req.params.username);
  if (!removed) return res.status(404).json({ error: 'not_found' });
  return res.json({ ok: true });
});

crmRouter.post('/api/admin/crm/referral-authorization/disallowed-usernames/:username/convert-to-invite-ban', authMiddleware, (req, res) => {
  try {
    const result = db.transaction(() => {
      const removed = removeDisallowedInviterUsername(req.params.username);
      if (!removed) throw Object.assign(new Error('not_found'), { code: 'not_found' });
      return createInviteBanByUsername({
        telegramUsername: req.params.username,
        reason: req.body?.reason,
        bannedBy: req.user?.u || 'admin',
      });
    }).immediate();
    return res.json({ ok: true, ...result });
  } catch (error) {
    if (error.code === 'not_found') return res.status(404).json({ error: error.code });
    if (error.code === 'username_ambiguous') return res.status(409).json({ error: error.code });
    console.error('[crm] convert reserved username error:', error);
    return res.status(500).json({ error: 'failed' });
  }
});

crmRouter.get('/api/admin/crm/invite-ban-reason-templates', authMiddleware, (_req, res) => {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'invite_ban_reason_templates'").get();
    res.json({ templates: row ? JSON.parse(row.value) : [] });
  } catch (error) {
    res.status(500).json({ error: 'failed' });
  }
});

crmRouter.put('/api/admin/crm/invite-ban-reason-templates', authMiddleware, (req, res) => {
  const templates = Array.isArray(req.body?.templates)
    ? [...new Set(req.body.templates.map((item) => String(item).trim()).filter(Boolean))]
    : null;
  if (!templates) return res.status(400).json({ error: 'templates_must_be_array' });
  if (templates.length > 20 || templates.some((item) => item.length > 200)) {
    return res.status(400).json({ error: 'templates_too_large' });
  }
  db.prepare(`
    INSERT INTO settings (key, value) VALUES ('invite_ban_reason_templates', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(JSON.stringify(templates));
  return res.json({ templates });
});

crmRouter.get('/api/admin/crm/invite-bans', authMiddleware, (_req, res) => {
  const result = listInviteBans();
  res.json({ items: result.active, pending: result.pending });
});

crmRouter.post('/api/admin/crm/invite-bans', authMiddleware, (req, res) => {
  try {
    const common = { reason: req.body?.reason, bannedBy: req.user?.u || 'admin' };
    const result = req.body?.customer_id
      ? { kind: 'active', ban: createInviteBan({ customerId: String(req.body.customer_id), ...common }) }
      : createInviteBanByUsername({ telegramUsername: req.body?.telegram_username, ...common });
    return res.json({ ok: true, ...result });
  } catch (error) {
    if (error.code === 'customer_not_found') return res.status(404).json({ error: error.code });
    if (error.code === 'already_invite_banned') return res.status(409).json({ error: error.code });
    if (error.code === 'username_ambiguous') return res.status(409).json({ error: error.code });
    if (['reason_too_long', 'username_invalid'].includes(error.code)) return res.status(400).json({ error: error.code });
    if (error.code === 'username_reserved') return res.status(409).json({ error: error.code });
    console.error('[crm] create invite ban error:', error);
    return res.status(500).json({ error: 'failed' });
  }
});

crmRouter.delete('/api/admin/crm/invite-bans/pending/:id', authMiddleware, (req, res) => {
  if (!removePendingInviteBan(req.params.id)) return res.status(404).json({ error: 'not_found' });
  return res.json({ ok: true });
});

crmRouter.delete('/api/admin/crm/invite-bans/:id', authMiddleware, (req, res) => {
  const removed = removeInviteBan(req.params.id, {
    unbannedBy: req.user?.u || 'admin',
    reason: req.body?.reason,
  });
  if (!removed) return res.status(404).json({ error: 'not_found' });
  return res.json({ ok: true });
});

// ----- Quick replies (FAQ) -------------------------------------------------

crmRouter.get('/api/admin/crm/bot/quick-replies', authMiddleware, (req, res) => {
  try {
    res.json({ items: listQuickReplies() });
  } catch (err) {
    console.error('[crm] Bot quick-replies list error:', err);
    res.status(500).json({ error: 'failed', message: err.message });
  }
});

function quickReplyErrorToHttp(err) {
  if (
    err.code === 'title_required' ||
    err.code === 'title_too_long' ||
    err.code === 'response_required' ||
    err.code === 'response_too_long' ||
    err.code === 'keywords_too_long'
  ) {
    return { status: 400, body: { error: err.code } };
  }
  if (err.code === 'quick_reply_not_found') {
    return { status: 404, body: { error: err.code } };
  }
  return null;
}

crmRouter.post('/api/admin/crm/bot/quick-replies', authMiddleware, (req, res) => {
  try {
    const item = createQuickReply({
      title: req.body?.title,
      keywords: req.body?.keywords,
      response_text: req.body?.response_text,
      is_active: req.body?.is_active,
      sort_order: req.body?.sort_order,
    });
    res.json({ ok: true, item });
  } catch (err) {
    const mapped = quickReplyErrorToHttp(err);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    console.error('[crm] Bot quick-reply create error:', err);
    res.status(500).json({ error: 'failed', message: err.message });
  }
});

crmRouter.put('/api/admin/crm/bot/quick-replies/:id', authMiddleware, (req, res) => {
  try {
    const item = updateQuickReply(req.params.id, {
      title: req.body?.title,
      keywords: req.body?.keywords,
      response_text: req.body?.response_text,
      is_active: req.body?.is_active,
      sort_order: req.body?.sort_order,
    });
    res.json({ ok: true, item });
  } catch (err) {
    const mapped = quickReplyErrorToHttp(err);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    console.error('[crm] Bot quick-reply update error:', err);
    res.status(500).json({ error: 'failed', message: err.message });
  }
});

crmRouter.delete('/api/admin/crm/bot/quick-replies/:id', authMiddleware, (req, res) => {
  try {
    const removed = deleteQuickReply(req.params.id);
    if (!removed) return res.status(404).json({ error: 'quick_reply_not_found' });
    res.json({ ok: true, removed });
  } catch (err) {
    console.error('[crm] Bot quick-reply delete error:', err);
    res.status(500).json({ error: 'failed', message: err.message });
  }
});

// ----- Status templates ----------------------------------------------------

crmRouter.get('/api/admin/crm/bot/status-templates', authMiddleware, (req, res) => {
  try {
    res.json({
      events: BOT_STATUS_EVENTS,
      items: listStatusTemplates(),
    });
  } catch (err) {
    console.error('[crm] Bot status-templates list error:', err);
    res.status(500).json({ error: 'failed', message: err.message });
  }
});

crmRouter.put(
  '/api/admin/crm/bot/status-templates/:event',
  authMiddleware,
  (req, res) => {
    try {
      const item = upsertStatusTemplate(req.params.event, {
        title: req.body?.title,
        body: req.body?.body,
        is_active: req.body?.is_active,
      });
      res.json({ ok: true, item });
    } catch (err) {
      if (
        err.code === 'invalid_event' ||
        err.code === 'title_too_long' ||
        err.code === 'body_too_long'
      ) {
        return res.status(400).json({ error: err.code });
      }
      console.error('[crm] Bot status-template upsert error:', err);
      res.status(500).json({ error: 'failed', message: err.message });
    }
  },
);

// ----- Send notifications --------------------------------------------------

/**
 * Отправляет сообщение через Telegram Business API напрямую (без bot-процесса)
 * и пишет результат в bot_message_log. Контракт совместим со старым
 * helper'ом из bot.js — call-sites notify-status и send-price ниже не
 * меняются.
 */
async function sendNotificationViaBot({
  businessConnectionId,
  chatId,
  text,
  parseMode = null,
  customerId = null,
  customerTelegramId = null,
  templateKind = 'status',
  templateId = null,
  templateEvent = null,
  messageType = 'status',
  meta = null,
} = {}) {
  const result = await sendBusinessMessage({
    businessConnectionId,
    chatId,
    text,
    parseMode,
  });
  // Журнал заполняется и для успеха, и для неудачи — иначе админ не увидит,
  // что отправка падает (а это и был исходный симптом «бот не отвечает»).
  // Поле outcome помогает быстро отфильтровать неуспешные в UI журнала.
  const baseLog = {
    businessConnectionId,
    chatId,
    customerId,
    customerTelegramId,
    direction: 'out',
    messageType,
    templateKind,
    templateId,
    templateEvent,
    text,
  };
  if (result.ok) {
    logBotMessage({
      ...baseLog,
      meta: { ...(meta || {}), outcome: 'sent' },
    });
    return { ok: true, telegramMessageId: result.telegramMessageId };
  }
  logBotMessage({
    ...baseLog,
    meta: { ...(meta || {}), outcome: 'failed', error: result.error },
  });
  return { ok: false, error: result.error };
}

// Старые endpoints /bot/notify-status и /bot/notify-status/preview удалены
// в код-ревью авто-нотификаций (8.05.2026). Раньше менеджер вручную нажимал
// «Отправить клиенту» в OrderBotNotifier, фронт показывал preview и слал
// /notify-status. Теперь триггер — сам PATCH /orders/:id (см.
// utils/auto-notify.js), preview не нужен (текст вычисляется и логируется
// сервером), а ручной канал перенесён в /bot/send-custom (свободный текст).
// Если в будущем понадобится ручная отправка по конкретному event-шаблону
// — восстановить из git history (commit перед этим code review).

/**
 * Выдача прайса с кодом верификации. Менеджер нажимает кнопку «Отправить
 * прайс» в карточке клиента — бэк генерирует код, привязывает к customers,
 * подставляет в шаблон `price_list` и шлёт через бот от имени менеджера.
 */
crmRouter.post('/api/admin/crm/bot/send-price', authMiddleware, async (req, res) => {
  try {
    const customerId = String(req.body?.customer_id ?? '');
    if (!customerId) {
      return res.status(400).json({ error: 'customer_id_required' });
    }
    const customer = db
      .prepare(`SELECT * FROM customers WHERE id = ?`)
      .get(customerId);
    if (!customer) {
      return res.status(404).json({ error: 'customer_not_found' });
    }
    if (!customer.telegram_id) {
      return res.status(400).json({ error: 'customer_has_no_telegram_id' });
    }
    const template = getStatusTemplate('price_list');
    if (!template || !template.is_active) {
      return res.status(400).json({ error: 'price_list_template_inactive' });
    }
    const active = getActiveBusinessConnection();
    if (!active) {
      return res.status(400).json({ error: 'no_active_connection' });
    }
    const code = generateVerificationCode();
    attachVerificationCode({ telegramId: customer.telegram_id, code });
    const variables = {
      verification_code: code,
      customer_name:
        [customer.first_name, customer.last_name].filter(Boolean).join(' ') ||
        (customer.telegram_username ? `@${customer.telegram_username}` : 'клиент'),
      customer_username: customer.telegram_username || '',
      customer_telegram_id: customer.telegram_id,
      store_name: 'НАВАЛИВАЙ',
    };
    const templateBody = convertLegacyTelegramMarkup(template.body);
    const text = renderTemplate(templateBody, variables, { escapeValues: true });
    // Защита от пустого шаблона (админ мог стереть body, но не снять is_active).
    // В этом случае не отправляем — клиент бы получил пустое сообщение.
    if (!text.trim()) {
      return res.status(400).json({ error: 'template_empty' });
    }

    // Блокировка: прайс не отправляем заблокированным клиентам
    // (как и авто-уведомления в auto-notify.js, и ручные в send-custom).
    const priceBlockGate = gateSendCustomTelegramForCrmBlock(customer.id);
    if (!priceBlockGate.ok) {
      return res.status(403).json({
        error: priceBlockGate.error,
        message: 'Клиент заблокирован, отправка прайса отключена.',
      });
    }

    const sendResult = await sendNotificationViaBot({
      businessConnectionId: active.id,
      chatId: String(customer.telegram_id),
      text,
      parseMode: TELEGRAM_HTML_PARSE_MODE,
      customerId: customer.id,
      customerTelegramId: customer.telegram_id,
      templateKind: 'status',
      templateId: template.id,
      templateEvent: 'price_list',
      messageType: 'price',
      meta: { verification_code: code },
    });
    if (!sendResult.ok) {
      // Деталь ошибки уже в журнале (bot_message_log meta.error).
      return res.status(502).json({ error: 'send_failed' });
    }
    res.json({
      ok: true,
      verification_code: code,
      telegram_message_id: sendResult.telegramMessageId,
      text,
    });
  } catch (err) {
    console.error('[crm] Bot send-price error:', err);
    res.status(500).json({ error: 'failed', message: err.message });
  }
});

/**
 * Свободное сообщение клиенту от менеджера (бронь вкуса, ответ на нестандартный
 * вопрос, договорённость о времени и т.п.). Костя 29.04.2026: «возможность
 * написать человеку никуда убрать не надо, может что-то ему сказать».
 *
 * Принимает либо order_id (берём customer_id оттуда), либо явный customer_id.
 * Текст ничем не валидируется кроме длины — это ручное сообщение от человека.
 */
crmRouter.post('/api/admin/crm/bot/send-custom', authMiddleware, async (req, res) => {
  try {
    const text = String(req.body?.text ?? '').trim();
    if (!text) {
      return res.status(400).json({ error: 'text_required' });
    }
    if (text.length > 4000) {
      return res.status(400).json({ error: 'text_too_long' });
    }
    const orderId = req.body?.order_id ? String(req.body.order_id) : null;
    let customerId = req.body?.customer_id ? String(req.body.customer_id) : null;
    if (!customerId && orderId) {
      const order = db
        .prepare(`SELECT customer_id FROM orders WHERE id = ?`)
        .get(orderId);
      if (!order) {
        return res.status(404).json({ error: 'order_not_found' });
      }
      customerId = order.customer_id ? String(order.customer_id) : null;
    }
    if (!customerId) {
      return res.status(400).json({ error: 'customer_id_or_order_id_required' });
    }
    const customer = db
      .prepare(`SELECT * FROM customers WHERE id = ?`)
      .get(customerId);
    if (!customer) {
      return res.status(404).json({ error: 'customer_not_found' });
    }
    if (!customer.telegram_id) {
      return res.status(400).json({ error: 'customer_has_no_telegram_id' });
    }

    const blockGate = gateSendCustomTelegramForCrmBlock(customer.id);
    if (!blockGate.ok) {
      return res.status(403).json({
        error: blockGate.error,
        message:
          'Клиент в активном блоке CRM. Ручные сообщения отключены, как и авто-уведомления.',
      });
    }

    // Сначала пробуем userbot (MTProto от лица аккаунта менеджера) —
    // нет 24-часового ограничения и сообщение приходит клиенту в его
    // обычный чат с менеджером, неотличимо от ручной отправки.
    if (await isUserbotAvailable()) {
      const ubResult = await sendViaUserbot({
        chatId: String(customer.telegram_id),
        text,
        orderId,
        // Получатель закреплён по Telegram ID. Username передаём только как
        // справочные данные; send-message не делает скрытый resolveUsername.
        username: customer.telegram_username || null,
        // verified: клиент в CRM есть → это не холодная рассылка.
        verified: true,
        // auto:false — ручная отправка, не авто-уведомление (для
        // корректной фильтрации в crm-operations.js).
        auto: false,
      });
      if (ubResult.ok) {
        return res.json({
          ok: true,
          telegram_message_id: ubResult.telegram_message_id,
          via: 'userbot',
        });
      }
      // ambiguous = userbot мог отправить (timeout, потерянный ответ).
      // Не делаем fallback — иначе клиент получит дубль в чате. Возвращаем
      // 502 с outcome, фронт показывает «не уверены, проверьте чат».
      if (ubResult.outcome === 'ambiguous') {
        console.warn(
          '[crm] userbot send-custom ambiguous (мог отправить, ответ потерян):',
          ubResult.error,
        );
        return res.status(502).json({
          error: 'userbot_ambiguous',
          message: 'Сообщение, возможно, отправлено через userbot, но ответ потерян. Проверьте чат с клиентом перед повторной отправкой.',
          via: 'userbot',
        });
      }
      console.warn(
        `[crm] userbot send-custom ${ubResult.outcome}, fallback to business mode:`,
        ubResult.error,
      );
    }

    // Fallback на Business mode (Bot API).
    const active = getActiveBusinessConnection();
    if (!active) {
      return res.status(400).json({ error: 'no_active_connection' });
    }
    const sendResult = await sendNotificationViaBot({
      businessConnectionId: active.id,
      chatId: String(customer.telegram_id),
      text,
      customerId: customer.id,
      customerTelegramId: customer.telegram_id,
      templateKind: null,
      templateId: null,
      templateEvent: null,
      messageType: 'manual',
      meta: orderId ? { order_id: orderId } : null,
    });
    if (!sendResult.ok) {
      return res.status(502).json({ error: 'send_failed' });
    }
    res.json({
      ok: true,
      telegram_message_id: sendResult.telegramMessageId,
      via: 'business_mode',
    });
  } catch (err) {
    console.error('[crm] Bot send-custom error:', err);
    res.status(500).json({ error: 'failed', message: err.message });
  }
});

// ----- Log -----------------------------------------------------------------

crmRouter.get('/api/admin/crm/bot/log', authMiddleware, (req, res) => {
  try {
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;
    const chatId = req.query.chat_id ? String(req.query.chat_id) : null;
    res.json({ items: listBotLog({ limit, offset, chatId }) });
  } catch (err) {
    console.error('[crm] Bot log error:', err);
    res.status(500).json({ error: 'failed', message: err.message });
  }
});

// Поиск клиентов для админских autocomplete (новый POS-флоу + любые модалки).
// `recent=1` — при пустом q вернуть последних N клиентов (для «блокнота» кассы).
// `pos_only=1` — фильтрует выдачу до клиентов с признаком «проходняк»
// (telegram_id IS NULL ИЛИ имеет хотя бы один pos_sale). Используется блокнотом
// кассы чтобы не подмешивать туда онлайн-покупателей Mini App.
function parseTruthyParam(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').toLowerCase());
}
crmRouter.get('/api/admin/crm/customers/search', authMiddleware, (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 20;
    const includeRecent = parseTruthyParam(req.query.recent);
    const posOnly = parseTruthyParam(req.query.pos_only);
    const items = searchCustomers({ q, limit, includeRecent, posOnly });
    res.json({ items });
  } catch (error) {
    console.error('[crm] Search customers error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// Создание / переиспользование клиента из кассы.
// Тело: { name: "Иван Петров", phone: "+375 33 123-45-67" }
// Возвращает: { customer, merged: boolean } — merged=true если найден
// существующий клиент с таким же телефоном (например, Telegram-клиент).
crmRouter.post('/api/admin/crm/pos-customers', authMiddleware, (req, res) => {
  try {
    const result = createOrMergePosCustomer({
      name: req.body?.name,
      phone: req.body?.phone,
      createdBy: req.user?.u || 'admin',
    });
    res.json({ ok: true, customer: result.customer, merged: result.merged });
  } catch (err) {
    if (err.code === 'name_required' || err.code === 'phone_invalid') {
      return res.status(400).json({ error: err.code });
    }
    console.error('[crm] Create POS customer error:', err);
    res.status(500).json({ error: 'failed', message: err.message });
  }
});

// Soft-delete клиента из блокнота кассы (помечает deleted_at = NOW).
// История чеков (pos_sales) и заказов (orders) не трогается. Возвращает
// 404 если клиента нет или он уже soft-deleted.
crmRouter.delete('/api/admin/crm/pos-customers/:id', authMiddleware, (req, res) => {
  try {
    const removed = softDeleteCustomer(req.params.id);
    if (!removed) return res.status(404).json({ error: 'customer_not_found' });
    res.json({ ok: true, removed });
  } catch (err) {
    console.error('[crm] Soft-delete customer error:', err);
    res.status(500).json({ error: 'failed', message: err.message });
  }
});

// История покупок клиента (онлайн-заказы + POS-чеки в одном списке).
crmRouter.get('/api/admin/crm/customers/:id/purchases', authMiddleware, (req, res) => {
  try {
    const exists = db.prepare('SELECT id FROM customers WHERE id = ?').get(req.params.id);
    if (!exists) return res.status(404).json({ error: 'not_found' });
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 50;
    const items = getCustomerPurchaseHistory(req.params.id, { limit });
    res.json({ items });
  } catch (error) {
    console.error('[crm] Customer purchases error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

crmRouter.get('/api/admin/crm/customers/:id', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;

    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!customer) {
      return res.status(404).json({ error: 'not_found' });
    }

    const orders = db.prepare(`
      SELECT * FROM orders
      WHERE customer_id = ?
      ORDER BY created_at DESC
    `).all(id);

    const blocks = db.prepare(`
      SELECT * FROM customer_blocks
      WHERE customer_id = ? AND active = 1
    `).all(id);

    const visitLogs = db.prepare(`
      SELECT * FROM visit_logs
      WHERE customer_id = ?
      ORDER BY visited_at DESC
      LIMIT 50
    `).all(id);

    // POS-чеки клиента (новое: после привязки кассы к клиентам).
    // Кладём отдельным массивом, чтобы UI карточки клиента мог отрисовать
    // объединённую историю онлайн + офлайн.
    const posSales = db.prepare(`
      SELECT * FROM pos_sales
      WHERE customer_id = ?
      ORDER BY created_at DESC
    `).all(id);

    const cardPayment = customer.telegram_id
      ? getCardCustomerSnapshot(customer.telegram_id, customer.telegram_username || '')
      : null;

    res.json({
      ...customer,
      card_payment: cardPayment,
      orders,
      posSales,
      blocks,
      visitLogs,
    });
  } catch (error) {
    console.error('[crm] Get customer error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

crmRouter.patch('/api/admin/crm/customers/:id', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const { notes, phone } = req.body;

    const current = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!current) {
      return res.status(404).json({ error: 'not_found' });
    }

    let nextNotes = current.notes;
    if (notes !== undefined) {
      try {
        nextNotes = sanitizeCustomerNote(notes);
      } catch (err) {
        if (err.code === 'note_too_long') {
          return res.status(400).json({ error: 'note_too_long' });
        }
        throw err;
      }
    }

    db.prepare(`
      UPDATE customers 
      SET notes = ?, phone = ?, updated_at = DATETIME('now')
      WHERE id = ?
    `).run(nextNotes, phone !== undefined ? phone : current.phone, id);

    if (notes !== undefined) {
      touchKanbanOrdersForCustomer(id);
    }

    const updated = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    res.json(updated);
  } catch (error) {
    console.error('[crm] Update customer error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// =========================
// ЗАМЕТКИ О КЛИЕНТАХ
// =========================
crmRouter.put('/api/admin/crm/customer-notes', authMiddleware, (req, res) => {
  try {
    const { customer_id, telegram_username, notes } = req.body || {};
    if (!customer_id && !telegram_username) {
      return res.status(400).json({ error: 'customer_id_or_telegram_username_required' });
    }
    try {
      const result = upsertCustomerNote({
        customer_id,
        telegram_username,
        notes,
        created_by: req.user?.u || 'admin',
      });
      if (result.kind === 'pending') {
        return res.json({
          ok: true,
          kind: 'pending',
          pending: serializePendingNote(result.pending),
        });
      }
      if (result.kind === 'pending_cleared') {
        return res.json({ ok: true, kind: 'pending_cleared', removed: result.removed });
      }
      return res.json({
        ok: true,
        kind: 'active',
        notes: result.notes,
        customer: {
          id: result.customer.id,
          notes: result.customer.notes,
          telegram_username: result.customer.telegram_username,
        },
      });
    } catch (err) {
      if (err.code === 'customer_not_found') {
        return res.status(404).json({ error: 'customer_not_found' });
      }
      if (err.code === 'note_too_long') {
        return res.status(400).json({ error: 'note_too_long' });
      }
      if (err.code === 'invalid_telegram_username') {
        return res.status(400).json({ error: 'invalid_telegram_username' });
      }
      throw err;
    }
  } catch (error) {
    console.error('[crm] Upsert customer note error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

crmRouter.delete('/api/admin/crm/customer-notes', authMiddleware, (req, res) => {
  try {
    const { customer_id, telegram_username, pending_id } = req.body || {};
    if (!customer_id && !telegram_username && pending_id === undefined) {
      return res.status(400).json({ error: 'customer_id_or_telegram_username_or_pending_id_required' });
    }
    const result = clearCustomerNote({ customer_id, telegram_username, pending_id });
    if (result.kind === 'pending_removed' && !result.removed) {
      return res.status(404).json({ error: 'not_found' });
    }
    res.json({ ok: true, ...result });
  } catch (error) {
    if (error.code === 'invalid_telegram_username') {
      return res.status(400).json({ error: 'invalid_telegram_username' });
    }
    if (error.code === 'customer_not_found') {
      return res.status(404).json({ error: 'customer_not_found' });
    }
    console.error('[crm] Clear customer note error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

crmRouter.get('/api/admin/crm/customer-notes/pending', authMiddleware, (req, res) => {
  try {
    const limit = Number(req.query?.limit) || 100;
    const rows = listPendingCustomerNotes({ limit });
    res.json({ pending: rows.map(serializePendingNote) });
  } catch (error) {
    console.error('[crm] List pending customer notes error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// =========================
// БЛОКИРОВКИ КЛИЕНТОВ
// =========================
// Универсальный create. Принимает либо customer_id (известный клиент),
// либо telegram_username (для превентивных банов).
// duration: { unit: 'minutes'|'hours'|'days'|'forever', value?: number }
crmRouter.post('/api/admin/crm/blocks', authMiddleware, (req, res) => {
  try {
    const { customer_id, telegram_username, reason, duration } = req.body || {};
    if (!customer_id && !telegram_username) {
      return res.status(400).json({ error: 'customer_id_or_telegram_username_required' });
    }
    let block_until = null;
    try {
      block_until = computeBlockUntil(duration || { unit: 'forever' });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    try {
      const result = createBlock({
        customer_id,
        telegram_username,
        block_until,
        reason: typeof reason === 'string' ? reason.trim() || null : null,
        blocked_by: req.user?.u || 'admin',
      });
      return res.json({ ok: true, kind: result.kind, block: serializeBlock(result.block, result.kind) });
    } catch (err) {
      if (err.code === 'already_blocked') {
        return res.status(409).json({
          error: 'already_blocked',
          existing: serializeBlock(err.existing, 'active'),
        });
      }
      if (err.code === 'customer_not_found') {
        return res.status(404).json({ error: 'customer_not_found' });
      }
      throw err;
    }
  } catch (error) {
    console.error('[crm] Create block error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// Снятие блокировки (active customer_blocks).
crmRouter.delete('/api/admin/crm/blocks/:id', authMiddleware, (req, res) => {
  try {
    const updated = unblockCustomerBlock(req.params.id, {
      unblocked_by: req.user?.u || 'admin',
      unblock_reason: typeof req.body?.unblock_reason === 'string' ? req.body.unblock_reason.trim() || null : null,
    });
    if (!updated) {
      // Может быть pending — попробуем удалить
      const removedPending = deletePendingBan(req.params.id);
      if (removedPending) {
        return res.json({ ok: true, kind: 'pending_removed' });
      }
      return res.status(404).json({ error: 'not_found' });
    }
    res.json({ ok: true, kind: 'unblocked', block: serializeBlock(updated, 'active') });
  } catch (error) {
    console.error('[crm] Unblock error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// Список всех активных блокировок (для раздела «Заблокированные»).
// Включает и реальные блоки и pending — с указанием kind.
crmRouter.get('/api/admin/crm/blocks', authMiddleware, (req, res) => {
  try {
    // Тот же предикат «активный блок», что и в utils/customer-blocks.js,
    // но с явным префиксом cb.* — без хрупких строковых replace.
    const activeBlocks = db.prepare(`
      SELECT cb.*, c.telegram_id, c.telegram_username, c.first_name, c.last_name, c.phone
      FROM customer_blocks cb
      JOIN customers c ON c.id = cb.customer_id
      WHERE cb.active = 1
        AND (cb.block_until IS NULL OR cb.block_until > DATETIME('now'))
      ORDER BY cb.blocked_at DESC
    `).all();

    const pendingBans = db.prepare(`
      SELECT * FROM pending_customer_bans
      WHERE ${PENDING_ACTIVE_PREDICATE}
      ORDER BY created_at DESC
    `).all();

    res.json({
      active: activeBlocks.map((row) => ({
        ...serializeBlock(row, 'active'),
        customer: {
          telegram_id: row.telegram_id,
          telegram_username: row.telegram_username,
          first_name: row.first_name,
          last_name: row.last_name,
          phone: row.phone,
        },
      })),
      pending: pendingBans.map((row) => serializeBlock(row, 'pending')),
    });
  } catch (error) {
    console.error('[crm] List blocks error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// Уведомление о блокировке через userbot
crmRouter.post('/api/admin/crm/blocks/:blockId/notify', authMiddleware, async (req, res) => {
  try {
    const block = getCustomerBlockById(req.params.blockId);
    if (!block) return res.status(404).json({ error: 'block_not_found' });

    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(block.customer_id);
    if (!customer || !customer.telegram_id) {
      return res.json({ ok: false, error: 'no_telegram_id' });
    }

    const text = formatBlockNotifyMessage(block.reason);

    const result = await sendViaUserbot({
      chatId: customer.telegram_id,
      text,
      auto: false,
    });

    res.json({ ok: result.ok, error: result.error || null });
  } catch (err) {
    console.error('[crm] block notify error:', err);
    res.status(500).json({ error: 'notify_failed' });
  }
});

// Legacy endpoint — оставлен для обратной совместимости с кодом, который ходил
// по /customers/:id/block (например старый CrmCustomerDetail). Внутри использует
// тот же createBlock.
crmRouter.post('/api/admin/crm/customers/:id/block', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const customer = db.prepare('SELECT id FROM customers WHERE id = ?').get(id);
    if (!customer) return res.status(404).json({ error: 'not_found' });
    let block_until = null;
    try {
      block_until = computeBlockUntil(req.body?.duration || { unit: 'forever' });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    try {
      const result = createBlock({
        customer_id: id,
        block_until,
        reason: req.body?.reason || null,
        blocked_by: req.user?.u || 'admin',
      });
      res.json({ ok: true, blockId: result.block.id });
    } catch (err) {
      if (err.code === 'already_blocked') {
        // Backward-compat: legacy caller (CrmCustomers all-tab, CrmCustomerDetail)
        // ожидает идемпотентного поведения — повторный вызов «заблокировать»
        // когда клиент уже заблокирован не должен бросать. Возвращаем 200
        // с id существующего блока, чтобы UI остался консистентным.
        return res.json({ ok: true, blockId: err.existing?.id ?? null, already_blocked: true });
      }
      throw err;
    }
  } catch (error) {
    console.error('[crm] Legacy block customer error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

crmRouter.post('/api/admin/crm/customers/:id/unblock', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const block = getActiveBlockForCustomerId(id);
    if (!block) return res.json({ ok: true });
    unblockCustomerBlock(block.id, {
      unblocked_by: req.user?.u || 'admin',
      unblock_reason: req.body?.unblock_reason || null,
    });
    res.json({ ok: true });
  } catch (error) {
    console.error('[crm] Legacy unblock customer error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// Проверка блокировки (публичный API — миниапка).
// Возвращает полный объект блока для рендера экрана с таймером/датой.
crmRouter.get('/api/customers/:telegramId/check-blocks', (req, res) => {
  try {
    const block = getActiveBlockForTelegramId(req.params.telegramId);
    if (!block) return res.json({ blocked: false });
    res.json({
      blocked: true,
      reason: block.reason || null,
      block_until: block.block_until || null,
      blocked_at: block.blocked_at,
    });
  } catch (error) {
    console.error('[crm] Check blocks error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// =========================
// MESSAGE TEMPLATES (Шаблоны сообщений)
// =========================

// Получить все шаблоны
crmRouter.get('/api/admin/crm/message-templates', authMiddleware, (req, res) => {
  try {
    const templates = db.prepare(`
      SELECT * FROM message_templates
      WHERE active = 1
      ORDER BY created_at DESC
    `).all();
    res.json(templates);
  } catch (error) {
    console.error('[crm] Get message templates error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// Получить шаблон по ID
crmRouter.get('/api/admin/crm/message-templates/:id', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const template = db.prepare('SELECT * FROM message_templates WHERE id = ?').get(id);
    
    if (!template) {
      return res.status(404).json({ error: 'not_found' });
    }
    
    res.json(template);
  } catch (error) {
    console.error('[crm] Get message template error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// Создать шаблон
crmRouter.post('/api/admin/crm/message-templates', authMiddleware, (req, res) => {
  try {
    const { name, content, type = 'order_contact' } = req.body;
    
    if (!name || !content) {
      return res.status(400).json({ error: 'missing_fields' });
    }
    
    const id = generateId('tpl');
    db.prepare(`
      INSERT INTO message_templates (id, name, content, type, active)
      VALUES (?, ?, ?, ?, 1)
    `).run(id, name, content, type);
    
    const template = db.prepare('SELECT * FROM message_templates WHERE id = ?').get(id);
    res.json(template);
  } catch (error) {
    console.error('[crm] Create message template error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// Обновить шаблон
crmRouter.patch('/api/admin/crm/message-templates/:id', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const { name, content, type, active } = req.body;
    
    const current = db.prepare('SELECT * FROM message_templates WHERE id = ?').get(id);
    if (!current) {
      return res.status(404).json({ error: 'not_found' });
    }
    
    db.prepare(`
      UPDATE message_templates
      SET name = ?, content = ?, type = ?, active = ?, updated_at = DATETIME('now')
      WHERE id = ?
    `).run(
      name !== undefined ? name : current.name,
      content !== undefined ? content : current.content,
      type !== undefined ? type : current.type,
      active !== undefined ? (active ? 1 : 0) : current.active,
      id
    );
    
    const updated = db.prepare('SELECT * FROM message_templates WHERE id = ?').get(id);
    res.json(updated);
  } catch (error) {
    console.error('[crm] Update message template error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// Удалить шаблон
crmRouter.delete('/api/admin/crm/message-templates/:id', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM message_templates WHERE id = ?').run(id);
    res.json({ ok: true });
  } catch (error) {
    console.error('[crm] Delete message template error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// =========================
// CUSTOMER FEEDBACKS (Обратная связь по клиентам)
// =========================

// Получить все feedbacks
crmRouter.get('/api/admin/crm/customer-feedbacks', authMiddleware, (req, res) => {
  try {
    const feedbacks = db.prepare(`
      SELECT * FROM customer_feedbacks
      ORDER BY processed_at DESC
    `).all();
    res.json(feedbacks);
  } catch (error) {
    console.error('[crm] Get customer feedbacks error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// Создать feedback
crmRouter.post('/api/admin/crm/customer-feedbacks', authMiddleware, (req, res) => {
  try {
    const { customer_id, reason } = req.body;
    
    if (!customer_id || !reason) {
      return res.status(400).json({ error: 'missing_fields' });
    }
    
    // Получаем информацию о клиенте
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customer_id);
    if (!customer) {
      return res.status(404).json({ error: 'customer_not_found' });
    }
    
    const id = generateId('feedback');
    const customerName = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || null;
    
    db.prepare(`
      INSERT INTO customer_feedbacks (id, customer_id, telegram_username, customer_name, reason)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, customer_id, customer.telegram_username, customerName, reason);
    
    const feedback = db.prepare('SELECT * FROM customer_feedbacks WHERE id = ?').get(id);
    res.json(feedback);
  } catch (error) {
    console.error('[crm] Create customer feedback error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// Удалить feedback
crmRouter.delete('/api/admin/crm/customer-feedbacks/:id', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM customer_feedbacks WHERE id = ?').run(id);
    res.json({ ok: true });
  } catch (error) {
    console.error('[crm] Delete customer feedback error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// Удалить клиента
crmRouter.delete('/api/admin/crm/customers/:id', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;

    const activeBlock = getActiveBlockForCustomerId(id);
    const blockedAuthorization = db.prepare(`
      SELECT 1
      FROM referral_auth_states ras
      JOIN customers c ON c.telegram_id = ras.telegram_id
      WHERE c.id = ? AND ras.status = 'blocked'
      LIMIT 1
    `).get(id);
    if (activeBlock || blockedAuthorization) {
      return res.status(400).json({
        error: 'must_unblock_first',
        message: 'Сначала снимите блокировку клиента',
      });
    }
    
    // Проверяем, есть ли у клиента заказы
    const orders = db.prepare('SELECT COUNT(*) as count FROM orders WHERE customer_id = ?').get(id);
    if (orders && orders.count > 0) {
      return res.status(400).json({ 
        error: 'has_orders', 
        message: 'Нельзя удалить клиента с заказами' 
      });
    }
    
    // Удаляем клиента (feedbacks и visit_logs удалятся автоматически через CASCADE)
    db.prepare('DELETE FROM customers WHERE id = ?').run(id);
    res.json({ ok: true });
  } catch (error) {
    console.error('[crm] Delete customer error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// Сгенерировать сообщение по шаблону для заказа
crmRouter.post('/api/admin/crm/orders/:orderId/generate-message', authMiddleware, (req, res) => {
  try {
    const { orderId } = req.params;
    const { templateId } = req.body;
    
    const order = db.prepare(`
      SELECT 
        o.*,
        COALESCE(o.telegram_username, c.telegram_username) as telegram_username,
        c.telegram_id as telegram_id,
        COALESCE(o.phone, c.phone) as phone,
        c.first_name,
        c.last_name
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id
      WHERE o.id = ?
    `).get(orderId);
    
    if (!order) {
      return res.status(404).json({ error: 'order_not_found' });
    }
    
    const template = templateId
      ? db.prepare('SELECT * FROM message_templates WHERE id = ? AND active = 1').get(templateId)
      : db.prepare('SELECT * FROM message_templates WHERE type = ? AND active = 1 ORDER BY created_at DESC LIMIT 1').get('order_contact');
    
    if (!template) {
      return res.status(404).json({ error: 'template_not_found' });
    }
    
    // Получить позиции заказа
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
    const itemsText = items.map(item => `• ${item.product_title} × ${item.quantity} — ${item.total_price} BYN`).join('\n');
    
    // Заменить переменные в шаблоне
    let message = template.content;
    const pickupCell = getLatestPickupCellAssignment(orderId);
    message = message.replace(/\[order_number\]/g, pickupCell?.cell_number || '');
    message = message.replace(/\[items\]/g, itemsText || 'Нет позиций');
    message = message.replace(/\[total\]/g, order.final_amount || order.total_amount || 0);
    message = message.replace(/\[phone\]/g, order.phone || 'не указан');
    message = message.replace(/\[address\]/g, order.delivery_address || 'не указан');
    message = normalizeCustomerOrderTerminology(message);
    
    res.json({
      message,
      telegramUsername: order.telegram_username,
      telegramId: order.telegram_id ? String(order.telegram_id) : null,
      templateUsed: template.name
    });
  } catch (error) {
    console.error('[crm] Generate message error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// =========================
// PRODUCT REVIEWS
// =========================

crmRouter.get('/api/admin/crm/product-reviews', authMiddleware, (req, res) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    let sql = `
      SELECT
        pr.*,
        c.telegram_id,
        c.telegram_username,
        c.first_name,
        c.last_name,
        g.name AS group_name,
        o.order_number
      FROM product_reviews pr
      LEFT JOIN customers c ON c.id = pr.customer_id
      LEFT JOIN category_groups g ON g.id = pr.group_id
      LEFT JOIN orders o ON o.id = pr.order_id
    `;
    const params = [];
    if (status) {
      sql += ' WHERE pr.status = ?';
      params.push(status);
    }
    sql += ' ORDER BY pr.created_at DESC LIMIT 200';
    const items = db.prepare(sql).all(...params);
    res.json({ items });
  } catch (error) {
    console.error('[crm] List product reviews error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

crmRouter.get('/api/admin/crm/product-reviews/pending-count', authMiddleware, (_req, res) => {
  try {
    const row = db.prepare(`
      SELECT COUNT(*) AS count
      FROM product_reviews
      WHERE status = ?
    `).get(REVIEW_STATUSES.PENDING);
    res.json({ count: Number(row?.count || 0) });
  } catch (error) {
    console.error('[crm] Pending reviews count error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

crmRouter.post('/api/admin/crm/product-reviews/:id/approve', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const now = new Date().toISOString();
    const result = db.prepare(`
      UPDATE product_reviews
      SET status = ?, approved_at = ?, updated_at = ?
      WHERE id = ? AND status = ?
    `).run(REVIEW_STATUSES.APPROVED, now, now, id, REVIEW_STATUSES.PENDING);

    if (!result.changes) {
      return res.status(404).json({ error: 'not_found' });
    }

    const review = db.prepare('SELECT * FROM product_reviews WHERE id = ?').get(id);
    res.json({ ok: true, review });
  } catch (error) {
    console.error('[crm] Approve review error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

crmRouter.post('/api/admin/crm/product-reviews/:id/reject', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const now = new Date().toISOString();
    const result = db.prepare(`
      UPDATE product_reviews
      SET status = ?, updated_at = ?
      WHERE id = ? AND status = ?
    `).run(REVIEW_STATUSES.REJECTED, now, id, REVIEW_STATUSES.PENDING);

    if (!result.changes) {
      return res.status(404).json({ error: 'not_found' });
    }

    const review = db.prepare('SELECT * FROM product_reviews WHERE id = ?').get(id);
    res.json({ ok: true, review });
  } catch (error) {
    console.error('[crm] Reject review error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

crmRouter.post('/api/admin/crm/product-reviews/:id/reply', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const reply = String(req.body?.reply || '').trim();
    if (!reply) {
      return res.status(400).json({ error: 'reply_required' });
    }

    const now = new Date().toISOString();
    const result = db.prepare(`
      UPDATE product_reviews
      SET manager_reply = ?, manager_replied_at = ?, updated_at = ?
      WHERE id = ?
    `).run(reply, now, now, id);

    if (!result.changes) {
      return res.status(404).json({ error: 'not_found' });
    }

    const review = db.prepare('SELECT * FROM product_reviews WHERE id = ?').get(id);
    res.json({
      ok: true,
      review,
      manager_display_name: getReviewSetting('manager_display_name', 'Manager Rezonsky'),
    });
  } catch (error) {
    console.error('[crm] Reply to review error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

crmRouter.get('/api/admin/crm/review-quick-tags', authMiddleware, (_req, res) => {
  try {
    const items = db.prepare(`
      SELECT * FROM review_quick_tags
      ORDER BY category_key ASC, star_rating ASC, sort_order ASC, label ASC
    `).all();
    res.json({ items });
  } catch (error) {
    console.error('[crm] List review quick tags error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

crmRouter.post('/api/admin/crm/review-quick-tags', authMiddleware, (req, res) => {
  try {
    const {
      category_key: categoryKey,
      star_rating: starRating,
      label,
      insert_text: insertText,
      sort_order: sortOrder,
      is_active: isActive,
    } = req.body || {};

    const normalizedLabel = String(label || '').trim();
    const normalizedInsertText = String(insertText || normalizedLabel).trim();

    if (!categoryKey || !normalizedLabel) {
      return res.status(400).json({ error: 'missing_fields' });
    }

    const rating = Number(starRating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'invalid_star_rating' });
    }

    const id = generateId('rqt');
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO review_quick_tags (
        id, category_key, star_rating, label, insert_text, sort_order, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      String(categoryKey).trim(),
      rating,
      normalizedLabel,
      normalizedInsertText,
      Number(sortOrder || 0),
      isActive === false ? 0 : 1,
      now,
      now,
    );

    const item = db.prepare('SELECT * FROM review_quick_tags WHERE id = ?').get(id);
    res.json(item);
  } catch (error) {
    console.error('[crm] Create review quick tag error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

crmRouter.patch('/api/admin/crm/review-quick-tags/:id', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const current = db.prepare('SELECT * FROM review_quick_tags WHERE id = ?').get(id);
    if (!current) {
      return res.status(404).json({ error: 'not_found' });
    }

    const {
      category_key: categoryKey,
      star_rating: starRating,
      label,
      insert_text: insertText,
      sort_order: sortOrder,
      is_active: isActive,
    } = req.body || {};

    const rating = starRating !== undefined ? Number(starRating) : current.star_rating;
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'invalid_star_rating' });
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE review_quick_tags
      SET category_key = ?, star_rating = ?, label = ?, insert_text = ?,
          sort_order = ?, is_active = ?, updated_at = ?
      WHERE id = ?
    `).run(
      categoryKey !== undefined ? String(categoryKey).trim() : current.category_key,
      rating,
      label !== undefined ? String(label).trim() : current.label,
      insertText !== undefined ? String(insertText).trim() : current.insert_text,
      sortOrder !== undefined ? Number(sortOrder) : current.sort_order,
      isActive !== undefined ? (isActive ? 1 : 0) : current.is_active,
      now,
      id,
    );

    const item = db.prepare('SELECT * FROM review_quick_tags WHERE id = ?').get(id);
    res.json(item);
  } catch (error) {
    console.error('[crm] Update review quick tag error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

crmRouter.delete('/api/admin/crm/review-quick-tags/:id', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM review_quick_tags WHERE id = ?').run(id);
    res.json({ ok: true });
  } catch (error) {
    console.error('[crm] Delete review quick tag error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

crmRouter.get('/api/admin/crm/review-settings', authMiddleware, (_req, res) => {
  try {
    res.json(getReviewSettingsResponse());
  } catch (error) {
    console.error('[crm] Get review settings error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

crmRouter.patch('/api/admin/crm/review-settings', authMiddleware, (req, res) => {
  try {
    const {
      cooldown_days: cooldownDays,
      lottery_hint_text: lotteryHintText,
      dev_test_mode: devTestMode,
      qa_active: qaActive,
      qa_usernames: qaUsernames,
      manager_display_name: managerDisplayName,
      manager_avatar_url: managerAvatarUrl,
    } = req.body || {};

    if (cooldownDays !== undefined) {
      const parsed = Number(cooldownDays);
      if (!Number.isFinite(parsed) || parsed < 1) {
        return res.status(400).json({ error: 'invalid_cooldown_days' });
      }
      setReviewSetting('cooldown_days', String(Math.floor(parsed)));
    }
    if (lotteryHintText !== undefined) {
      setReviewSetting('lottery_hint_text', String(lotteryHintText));
    }
    if (devTestMode !== undefined) {
      setReviewSetting('dev_test_mode', devTestMode ? '1' : '0');
    }
    if (qaActive !== undefined) {
      setReviewSetting('qa_active', qaActive ? '1' : '0');
    }
    if (qaUsernames !== undefined) {
      setQaUsernames(qaUsernames);
    }
    if (managerDisplayName !== undefined) {
      setReviewSetting('manager_display_name', String(managerDisplayName).trim());
    }
    if (managerAvatarUrl !== undefined) {
      setReviewSetting('manager_avatar_url', String(managerAvatarUrl).trim());
    }

    res.json(getReviewSettingsResponse());
  } catch (error) {
    console.error('[crm] Update review settings error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

crmRouter.post('/api/admin/crm/review-qa/seed', authMiddleware, (req, res) => {
  try {
    const reset = req.body?.reset !== false;
    const result = runReviewQaSeed({ reset });
    res.json({
      ok: true,
      period_key: result.periodKey,
      rating_group_name: result.ratingGroup.group_name,
      fresh_order_number: result.freshOrder.orderNumber,
      suggested_whitelist_usernames: result.suggestedWhitelistUsernames,
    });
  } catch (error) {
    console.error('[crm] Review QA seed error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

crmRouter.post('/api/admin/crm/review-qa/disable', authMiddleware, (_req, res) => {
  try {
    disableReviewQaModes();
    res.json(getReviewSettingsResponse());
  } catch (error) {
    console.error('[crm] Review QA disable error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

crmRouter.get('/api/admin/crm/review-monthly-draws', authMiddleware, (_req, res) => {
  try {
    const draws = db.prepare(`
      SELECT * FROM review_monthly_draws
      ORDER BY drawn_at DESC
      LIMIT 24
    `).all();

    const items = draws.map((draw) => getDrawById(draw.id));
    res.json({ items });
  } catch (error) {
    console.error('[crm] List review draws error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

crmRouter.post('/api/admin/crm/review-monthly-draws/run', authMiddleware, (req, res) => {
  try {
    const periodKey = req.body?.period_key || getReviewPeriodKey(0);
    const draw = runMonthlyReviewDraw({ periodKey });
    res.json({ ok: true, draw });
  } catch (error) {
    if (error?.code === 'draw_already_exists') {
      return res.status(409).json({ error: error.code, draw_id: error.drawId });
    }
    console.error('[crm] Run review draw error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

crmRouter.post('/api/admin/crm/review-monthly-draws/:drawId/reroll', authMiddleware, (req, res) => {
  try {
    const seatNumber = Number(req.body?.seat_number || 0);
    if (!Number.isInteger(seatNumber) || seatNumber < 1 || seatNumber > 5) {
      return res.status(400).json({ error: 'invalid_seat_number' });
    }

    const draw = rerollDrawSeat(req.params.drawId, seatNumber);
    res.json({ ok: true, draw });
  } catch (error) {
    const code = error?.code || 'failed';
    const status =
      code === 'draw_not_found' || code === 'seat_not_found' ? 404 :
      code === 'no_eligible_tickets' ? 409 : 500;
    if (status === 500) {
      console.error('[crm] Reroll review draw error:', error);
    }
    res.status(status).json({ error: code, message: error.message });
  }
});
