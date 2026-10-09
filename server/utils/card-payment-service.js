import { db } from "../db.js";
import {
  cardBusinessDateKey,
  cardBusinessMonthKey,
  computeDailyCardLimitMinor,
  computeCardAvailability,
  resolveCardOrderAmount,
} from "./card-payment-limits.js";

export function toMinorUnits(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) throw new Error("invalid_amount");
  return Math.round((value + Number.EPSILON) * 100);
}

export function fromMinorUnits(amountMinor) {
  return Number(amountMinor || 0) / 100;
}

export function normalizeTelegramUsername(value) {
  return String(value || "").trim().replace(/^@+/, "").toLowerCase();
}

export function getCardLimitSnapshot(referenceDate = new Date()) {
  const businessDate = cardBusinessDateKey(referenceDate);
  const monthKey = cardBusinessMonthKey(referenceDate);
  const monthly = db
    .prepare("SELECT limit_minor FROM card_payment_months WHERE month_key = ?")
    .get(monthKey);
  const monthlyLimitMinor = Number(monthly?.limit_minor || 0);
  const spentBeforeTodayMinor = Number(
    db.prepare(`
      SELECT COALESCE(SUM(amount_minor), 0) AS amount
      FROM card_payment_operations
      WHERE operation_status = 'spent'
        AND business_date >= ?
        AND business_date < ?
    `).get(`${monthKey}-01`, businessDate).amount || 0,
  );
  const spentTodayMinor = Number(
    db.prepare(`
      SELECT COALESCE(SUM(amount_minor), 0) AS amount
      FROM card_payment_operations
      WHERE operation_status = 'spent' AND business_date = ?
    `).get(businessDate).amount || 0,
  );
  // Active orders reserve the shared daily capacity until issue/cancellation.
  // Their reservation follows the next issue day across Minsk midnight.
  const reservedMinor = Number(
    db.prepare(`
      SELECT COALESCE(SUM(amount_minor), 0) AS amount
      FROM card_payment_operations
      WHERE operation_type = 'order' AND operation_status = 'reserved'
    `).get().amount || 0,
  );
  const baseDailyLimitMinor = computeDailyCardLimitMinor({
    monthlyLimitMinor,
    spentBeforeTodayMinor,
    businessDate,
    includeToday: true,
  });
  const override = db.prepare(`
      SELECT limit_override_minor FROM card_payment_day_adjustments WHERE business_date = ?
    `).get(businessDate);
  const dailyLimitMinor = override?.limit_override_minor == null
    ? baseDailyLimitMinor
    : Number(override.limit_override_minor);
  const adjustedAvailability = computeCardAvailability({
    dailyLimitMinor,
    spentTodayMinor,
    reservedMinor,
  });
  const spentMonthMinor = Number(
    db.prepare(`
      SELECT COALESCE(SUM(amount_minor), 0) AS amount
      FROM card_payment_operations
      WHERE operation_status = 'spent' AND business_date LIKE ?
    `).get(`${monthKey}-%`).amount || 0,
  );

  return {
    business_date: businessDate,
    month_key: monthKey,
    monthly_limit_minor: monthlyLimitMinor,
    spent_month_minor: spentMonthMinor,
    remaining_month_minor: Math.max(0, monthlyLimitMinor - spentMonthMinor),
    base_daily_limit_minor: baseDailyLimitMinor,
    daily_increase_minor: dailyLimitMinor - baseDailyLimitMinor,
    daily_limit_minor: dailyLimitMinor,
    spent_today_minor: spentTodayMinor,
    reserved_minor: reservedMinor,
    committed_today_minor: adjustedAvailability.committedMinor,
    remaining_today_minor: adjustedAvailability.remainingMinor,
    can_start_order: adjustedAvailability.canStartOrder,
  };
}

export function getCardAdminSnapshot(referenceDate = new Date()) {
  const limits = getCardLimitSnapshot(referenceDate);
  const accounts = db.prepare(`
    SELECT a.telegram_id, a.telegram_username, a.enabled, a.monthly_limit_minor,
      a.max_order_minor, a.cooldown_started_at,
      (SELECT MAX(o.issued_at)
       FROM card_payment_operations o
       WHERE o.customer_telegram_id = a.telegram_id
         AND o.operation_type = 'order' AND o.operation_status = 'spent') AS last_issued_at
    FROM card_payment_accounts a
    ORDER BY lower(COALESCE(a.telegram_username, a.telegram_id))
  `).all();
  const pendingAccounts = db.prepare(`
    SELECT telegram_username, enabled, monthly_limit_minor, max_order_minor
    FROM card_payment_pending_accounts
    ORDER BY telegram_username
  `).all();
  const tariffs = db.prepare(`
    SELECT id, title, limit_minor, transition_cost_text, position, active
    FROM card_payment_tariffs ORDER BY position, id
  `).all();
  const requests = db.prepare(`
    SELECT id, telegram_username, tariff_title, current_limit_minor,
      requested_limit_minor, status, created_at, resolved_by, resolution_note
    FROM card_payment_limit_requests
    ORDER BY CASE status WHEN 'new' THEN 0 ELSE 1 END, created_at DESC
    LIMIT 100
  `).all();
  const operations = db.prepare(`
    SELECT o.id, o.operation_type, o.operation_status, o.order_id,
      orders.order_number, o.customer_telegram_id, o.amount_minor,
      o.business_date, o.note, o.actor_username, o.created_at, o.issued_at, o.reversed_at
    FROM card_payment_operations o
    LEFT JOIN orders ON orders.id = o.order_id
    WHERE o.business_date = ?
      AND o.operation_type = 'order'
      AND o.operation_status = 'spent'
    ORDER BY o.issued_at DESC, o.id DESC
  `).all(limits.business_date);
  return { limits, accounts, pending_accounts: pendingAccounts, tariffs, requests, operations };
}

export function setCardMonthlyLimit(monthKey, limitMinor) {
  db.prepare(`
    INSERT INTO card_payment_months (month_key, limit_minor, updated_at)
    VALUES (?, ?, DATETIME('now'))
    ON CONFLICT(month_key) DO UPDATE SET
      limit_minor = excluded.limit_minor, updated_at = DATETIME('now')
  `).run(monthKey, limitMinor);
}

export function addCardDailyIncrease(businessDate, increaseMinor) {
  const current = getCardLimitSnapshot(new Date());
  if (current.business_date !== businessDate) throw new Error("invalid_business_date");
  db.prepare(`
    INSERT INTO card_payment_day_adjustments (business_date, limit_override_minor, updated_at)
    VALUES (?, ?, DATETIME('now'))
    ON CONFLICT(business_date) DO UPDATE SET
      limit_override_minor = excluded.limit_override_minor, updated_at = DATETIME('now')
  `).run(businessDate, current.daily_limit_minor + increaseMinor);
}

export function setCardAccount({
  telegramId = null,
  telegramUsername,
  enabled,
  monthlyLimitMinor = 25000,
  maxOrderMinor,
}) {
  const username = normalizeTelegramUsername(telegramUsername);
  if (telegramId) {
    const id = String(telegramId).trim();
    if (!id) throw new Error("invalid_telegram_id");
    db.prepare(`
      INSERT INTO card_payment_accounts
        (telegram_id, telegram_username, enabled, monthly_limit_minor, max_order_minor, cooldown_days)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        telegram_username = COALESCE(excluded.telegram_username, telegram_username),
        enabled = excluded.enabled,
        monthly_limit_minor = excluded.monthly_limit_minor,
        max_order_minor = excluded.max_order_minor,
        cooldown_days = 10,
        updated_at = DATETIME('now')
    `).run(id, username || null, enabled ? 1 : 0, monthlyLimitMinor, maxOrderMinor, 10);
    return id;
  }
  if (!username) throw new Error("telegram_username_required");
  db.prepare(`
    INSERT INTO card_payment_pending_accounts
      (telegram_username, enabled, monthly_limit_minor, max_order_minor, cooldown_days, updated_at)
    VALUES (?, ?, ?, ?, 10, DATETIME('now'))
    ON CONFLICT(telegram_username) DO UPDATE SET
      enabled = excluded.enabled,
      monthly_limit_minor = excluded.monthly_limit_minor,
      max_order_minor = excluded.max_order_minor,
      updated_at = DATETIME('now')
  `).run(username, enabled ? 1 : 0, monthlyLimitMinor, maxOrderMinor);
  return null;
}

export function resolveCardAccount(telegramId, telegramUsername = "") {
  const normalizedId = String(telegramId || "").trim();
  const username = normalizeTelegramUsername(telegramUsername);
  if (!normalizedId) return null;

  let account = db
    .prepare("SELECT * FROM card_payment_accounts WHERE telegram_id = ?")
    .get(normalizedId);
  if (account) return account;

  if (username) {
    const pending = db
      .prepare("SELECT * FROM card_payment_pending_accounts WHERE telegram_username = ?")
      .get(username);
    if (pending) {
      db.prepare(`
        INSERT INTO card_payment_accounts
          (telegram_id, telegram_username, enabled, monthly_limit_minor, max_order_minor, cooldown_days)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(telegram_id) DO UPDATE SET
          telegram_username = excluded.telegram_username,
          enabled = excluded.enabled,
          monthly_limit_minor = excluded.monthly_limit_minor,
          max_order_minor = excluded.max_order_minor,
          cooldown_days = 10,
          updated_at = DATETIME('now')
      `).run(
        normalizedId,
        username,
        pending.enabled,
        pending.monthly_limit_minor,
        pending.max_order_minor,
        10,
      );
      db.prepare("DELETE FROM card_payment_pending_accounts WHERE telegram_username = ?")
        .run(username);
      account = db
        .prepare("SELECT * FROM card_payment_accounts WHERE telegram_id = ?")
        .get(normalizedId);
    }
  }
  return account || null;
}

export function getCardCustomerSnapshot(telegramId, telegramUsername = "", referenceDate = new Date()) {
  const account = resolveCardAccount(telegramId, telegramUsername);
  const limits = getCardLimitSnapshot(referenceDate);
  const now = referenceDate.getTime();
  const cooldownUntil = account?.cooldown_started_at
    ? new Date(account.cooldown_started_at).getTime() +
      10 * 24 * 60 * 60 * 1000
    : 0;
  const isCoolingDown = cooldownUntil > now;
  const monthKey = cardBusinessMonthKey(referenceDate);
  const monthlyUsedMinor = account ? Number(db.prepare(`
    SELECT COALESCE(SUM(amount_minor), 0) AS amount
    FROM card_payment_operations
    WHERE customer_telegram_id = ?
      AND operation_status IN ('reserved', 'spent')
      AND business_date LIKE ?
  `).get(String(telegramId), `${monthKey}-%`).amount || 0) : 0;
  const monthlyLimitMinor = Number(account?.monthly_limit_minor || 0);
  const personalRemainingMinor = Math.max(0, monthlyLimitMinor - monthlyUsedMinor);
  return {
    enabled: Boolean(account?.enabled),
    monthly_limit_minor: monthlyLimitMinor,
    monthly_used_minor: monthlyUsedMinor,
    monthly_remaining_minor: personalRemainingMinor,
    max_order_minor: Number(account?.max_order_minor || 0),
    cooldown_until: isCoolingDown ? new Date(cooldownUntil).toISOString() : null,
    card_available: Boolean(account?.enabled) && !isCoolingDown,
    limits,
  };
}

export function reserveCardOrder({
  orderId,
  telegramId,
  amountMinor,
  referenceDate = new Date(),
}) {
  db.prepare(`
    INSERT INTO card_payment_operations (
      id, operation_type, operation_status, order_id, customer_telegram_id,
      amount_minor, business_date
    ) VALUES (?, 'order', 'reserved', ?, ?, ?, ?)
  `).run(
    `card_${orderId}`,
    orderId,
    String(telegramId),
    amountMinor,
    cardBusinessDateKey(referenceDate),
  );
}

export function checkCardOrder({
  orderId,
  telegramId,
  telegramUsername = "",
  amountMinor,
  referenceDate = new Date(),
  allowSplit = false,
}) {
  const account = resolveCardAccount(telegramId, telegramUsername);
  if (!account?.enabled) return { ok: false, reason: "card_payment_not_allowed" };
  const cooldownUntil = account.cooldown_started_at
    ? new Date(account.cooldown_started_at).getTime() +
      10 * 24 * 60 * 60 * 1000
    : 0;
  if (cooldownUntil > referenceDate.getTime()) {
    return {
      ok: false,
      reason: "personal_cooldown",
      personalLimitMinor: Number(account.max_order_minor || 0),
      cooldownUntil: new Date(cooldownUntil).toISOString(),
    };
  }
  const limits = getCardLimitSnapshot(referenceDate);
  const monthKey = cardBusinessMonthKey(referenceDate);
  const monthlyUsedMinor = Number(db.prepare(`
    SELECT COALESCE(SUM(amount_minor), 0) AS amount
    FROM card_payment_operations
    WHERE customer_telegram_id = ?
      AND operation_status IN ('reserved', 'spent')
      AND business_date LIKE ?
  `).get(String(telegramId), `${monthKey}-%`).amount || 0);
  const monthlyRemainingMinor = Math.max(0, Number(account.monthly_limit_minor || 0) - monthlyUsedMinor);
  if (amountMinor > monthlyRemainingMinor && !allowSplit) {
    return {
      ok: false,
      reason: "personal_monthly_limit_exceeded",
      personalMonthlyLimitMinor: Number(account.monthly_limit_minor || 0),
      personalMonthlyRemainingMinor: monthlyRemainingMinor,
      ...limits,
    };
  }
  const decision = resolveCardOrderAmount({
    orderAmountMinor: amountMinor,
    personalLimitMinor: Number(account.max_order_minor || 0),
    personalMonthlyLimitMinor: Number(account.monthly_limit_minor || 0),
    personalMonthlyRemainingMinor: monthlyRemainingMinor,
    dailyLimitMinor: limits.daily_limit_minor,
    spentTodayMinor: limits.spent_today_minor,
    reservedMinor: limits.reserved_minor,
    allowSplit,
  });
  if (!decision.ok) {
    return {
      ok: false,
      reason: decision.reason,
      personalLimitMinor: Number(account.max_order_minor || 0),
      ...decision,
    };
  }
  return {
    ok: true,
    orderId,
    telegramId: String(telegramId),
    businessDate: limits.business_date,
    cardAmountMinor: decision.cardAmountMinor,
    cashDueMinor: decision.cashDueMinor,
    personalLimitMinor: Number(account.max_order_minor || 0),
    ...limits,
  };
}

// Call only after inserting the order row, inside the same IMMEDIATE
// transaction as checkCardOrder(). The operation has a foreign key to orders.
export function reserveCheckedCardOrder(decision) {
  if (!decision?.ok || !decision.orderId || !decision.telegramId) {
    throw new Error("invalid_card_reservation");
  }
  db.prepare(`
    INSERT INTO card_payment_operations (
      id, operation_type, operation_status, order_id, customer_telegram_id,
      amount_minor, business_date
    ) VALUES (?, 'order', 'reserved', ?, ?, ?, ?)
  `).run(
    `card_${decision.orderId}`,
    decision.orderId,
    decision.telegramId,
    decision.cardAmountMinor,
    decision.businessDate,
  );
}

export function issueCardOrder(orderId, referenceDate = new Date()) {
  const businessDate = cardBusinessDateKey(referenceDate);
  const operation = db.prepare(`
    SELECT customer_telegram_id, amount_minor
    FROM card_payment_operations
    WHERE order_id = ? AND operation_type = 'order' AND operation_status = 'reserved'
  `).get(orderId);
  if (!operation) return null;

  db.prepare(`
    UPDATE card_payment_operations
    SET operation_status = 'spent', business_date = ?, issued_at = ?
    WHERE order_id = ? AND operation_type = 'order' AND operation_status = 'reserved'
  `).run(businessDate, referenceDate.toISOString(), orderId);
  db.prepare(`
    UPDATE card_payment_accounts
    SET cooldown_started_at = ?, updated_at = DATETIME('now')
    WHERE telegram_id = ?
  `).run(referenceDate.toISOString(), operation.customer_telegram_id);
  return operation;
}

export function reverseCardOrder(orderId, referenceDate = new Date()) {
  const operation = db.prepare(`
    SELECT customer_telegram_id, operation_status
    FROM card_payment_operations
    WHERE order_id = ? AND operation_type = 'order'
      AND operation_status IN ('reserved', 'spent')
  `).get(orderId);
  if (!operation) return false;

  db.prepare(`
    UPDATE card_payment_operations
    SET operation_status = 'reversed', reversed_at = ?
    WHERE order_id = ? AND operation_type = 'order'
      AND operation_status IN ('reserved', 'spent')
  `).run(referenceDate.toISOString(), orderId);

  if (operation.operation_status === "spent") {
    const latestRemaining = db.prepare(`
      SELECT issued_at
      FROM card_payment_operations
      WHERE customer_telegram_id = ? AND operation_type = 'order'
        AND operation_status = 'spent'
      ORDER BY issued_at DESC, id DESC
      LIMIT 1
    `).get(operation.customer_telegram_id);
    db.prepare(`
      UPDATE card_payment_accounts
      SET cooldown_started_at = ?, updated_at = DATETIME('now')
      WHERE telegram_id = ?
    `).run(latestRemaining?.issued_at || null, operation.customer_telegram_id);
  }
  return true;
}

export function addManualCardOperation({ amountMinor, note = null, actorUsername = null, referenceDate = new Date() }) {
  const businessDate = cardBusinessDateKey(referenceDate);
  const id = `card_manual_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  db.prepare(`
    INSERT INTO card_payment_operations (
      id, operation_type, operation_status, amount_minor, business_date, note, actor_username
    ) VALUES (?, 'manual', 'spent', ?, ?, ?, ?)
  `).run(id, amountMinor, businessDate, note, actorUsername);
  return id;
}
