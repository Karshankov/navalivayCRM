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
      a.max_order_minor, a.cooldown_started_at, a.tariff_id,
      tariff.title AS tariff_title,
      tariff.monthly_limit_minor AS tariff_monthly_limit_minor,
      tariff.per_order_limit_minor AS tariff_per_order_limit_minor,
      tariff.transition_cost_text AS tariff_transition_cost_text,
      (SELECT MAX(o.issued_at)
       FROM card_payment_operations o
       WHERE o.customer_telegram_id = a.telegram_id
         AND o.operation_type = 'order' AND o.operation_status = 'spent') AS last_issued_at
    FROM card_payment_accounts a
    LEFT JOIN card_payment_tariffs tariff ON tariff.id = a.tariff_id
    ORDER BY lower(COALESCE(a.telegram_username, a.telegram_id))
  `).all();
  const pendingAccounts = db.prepare(`
    SELECT telegram_username, enabled, monthly_limit_minor, max_order_minor
    FROM card_payment_pending_accounts
    ORDER BY telegram_username
  `).all();
  const tariffs = db.prepare(`
    SELECT id, title, limit_minor, monthly_limit_minor, per_order_limit_minor,
      transition_cost_text, position, active
    FROM card_payment_tariffs ORDER BY position, id
  `).all();
  const requests = db.prepare(`
    SELECT r.id, r.telegram_id, r.telegram_username, r.tariff_id, r.tariff_title,
      r.current_limit_minor, r.requested_limit_minor, r.status, r.created_at,
      r.resolved_by, r.resolution_note,
      tariff.transition_cost_text AS tariff_transition_cost_text,
      tariff.monthly_limit_minor AS tariff_monthly_limit_minor,
      tariff.per_order_limit_minor AS tariff_per_order_limit_minor
    FROM card_payment_limit_requests r
    LEFT JOIN card_payment_tariffs tariff ON tariff.id = r.tariff_id
    ORDER BY CASE r.status WHEN 'new' THEN 0 ELSE 1 END, r.created_at DESC
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

/**
 * Применить тариф к аккаунту: обновляет оба лимита и запоминает тариф.
 * null tariffId = сброс на стандартные лимиты (250/45 BYN).
 */
export function applyCardTariffToAccount(telegramId, tariffId, referenceDate = new Date()) {
  const id = String(telegramId || "").trim();
  if (!id) throw new Error("invalid_telegram_id");
  const account = db
    .prepare("SELECT * FROM card_payment_accounts WHERE telegram_id = ?")
    .get(id);
  if (!account) throw new Error("card_account_not_found");

  let monthlyLimitMinor = 25000;
  let maxOrderMinor = 4500;
  if (tariffId) {
    const tariff = db
      .prepare("SELECT * FROM card_payment_tariffs WHERE id = ?")
      .get(String(tariffId));
    if (!tariff) throw new Error("card_tariff_not_found");
    if (!Number(tariff.active)) throw new Error("card_tariff_inactive");
    monthlyLimitMinor = Number(tariff.monthly_limit_minor ?? tariff.limit_minor ?? 25000);
    maxOrderMinor = Number(tariff.per_order_limit_minor ?? 4500);
    if (monthlyLimitMinor < 0 || maxOrderMinor <= 0) {
      throw new Error("invalid_tariff_limits");
    }
  }

  db.prepare(`
    UPDATE card_payment_accounts
    SET monthly_limit_minor = ?, max_order_minor = ?, tariff_id = ?, updated_at = ?
    WHERE telegram_id = ?
  `).run(monthlyLimitMinor, maxOrderMinor, tariffId ? String(tariffId) : null, referenceDate.toISOString(), id);
  return db
    .prepare("SELECT * FROM card_payment_accounts WHERE telegram_id = ?")
    .get(id);
}

/**
 * Одобрить заявку на увеличение лимита: применяет лимиты тарифа заявки
 * к аккаунту клиента и переводит заявку в processed. Транзакционно.
 * Аккаунт включается автоматически, если был выключен — одобренная заявка
 * сама по себе означает согласие магазина.
 */
export function approveCardLimitRequest(requestId, actorUsername = "admin", referenceDate = new Date()) {
  const request = db
    .prepare("SELECT * FROM card_payment_limit_requests WHERE id = ?")
    .get(String(requestId || ""));
  if (!request) throw new Error("card_request_not_found");
  if (request.status !== "new") throw new Error("card_request_already_resolved");

  const telegramId = String(request.telegram_id || "").trim();
  if (!telegramId) throw new Error("card_request_missing_telegram_id");

  const apply = db.transaction(() => {
    const account = db
      .prepare("SELECT * FROM card_payment_accounts WHERE telegram_id = ?")
      .get(telegramId);
    if (!account) {
      // Аккаунт мог быть удалён/не создан — создаём по данным заявки.
      db.prepare(`
        INSERT INTO card_payment_accounts
          (telegram_id, telegram_username, enabled, monthly_limit_minor, max_order_minor, cooldown_days)
        VALUES (?, ?, 1, 25000, 4500, 10)
      `).run(telegramId, request.telegram_username || null);
    }

    let monthlyLimitMinor = Number(request.requested_limit_minor || 25000);
    let maxOrderMinor = 4500;
    let tariffId = null;
    if (request.tariff_id) {
      const tariff = db
        .prepare("SELECT * FROM card_payment_tariffs WHERE id = ?")
        .get(String(request.tariff_id));
      if (tariff) {
        monthlyLimitMinor = Number(tariff.monthly_limit_minor ?? tariff.limit_minor ?? monthlyLimitMinor);
        maxOrderMinor = Number(tariff.per_order_limit_minor ?? 4500);
        tariffId = tariff.id;
      }
    }

    db.prepare(`
      UPDATE card_payment_accounts
      SET monthly_limit_minor = ?, max_order_minor = ?, tariff_id = ?, enabled = 1, updated_at = ?
      WHERE telegram_id = ?
    `).run(monthlyLimitMinor, maxOrderMinor, tariffId, referenceDate.toISOString(), telegramId);

    db.prepare(`
      UPDATE card_payment_limit_requests
      SET status = 'processed', resolved_at = ?, resolved_by = ?, resolution_note = ?
      WHERE id = ?
    `).run(referenceDate.toISOString(), actorUsername, "Одобрено: лимиты тарифа применены автоматически", String(requestId));
  });
  apply();
  return db
    .prepare("SELECT * FROM card_payment_limit_requests WHERE id = ?")
    .get(String(requestId));
}

/**
 * Принудительная оплата картой при выдаче (клиент без карты/резерва).
 * Создаёт операцию spent на бизнес-дату выдачи, ставит паузу аккаунту
 * (если аккаунт существует) и списывает с дневного/месячного лимита магазина.
 * Не проверяет разрешения и личные лимиты — это осознанное решение менеджера.
 */
export function forceIssueCardPayment({
  orderId,
  telegramId,
  amountMinor,
  note = null,
  actorUsername = null,
  referenceDate = new Date(),
}) {
  const id = String(orderId || "").trim();
  const customerTelegramId = String(telegramId || "").trim();
  if (!id) throw new Error("invalid_order_id");
  if (!customerTelegramId) throw new Error("customer_telegram_id_required");
  const amount = Number(amountMinor);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("invalid_amount");

  const businessDate = cardBusinessDateKey(referenceDate);
  const operationId = `card_forced_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  db.transaction(() => {
    db.prepare(`
      INSERT INTO card_payment_operations (
        id, operation_type, operation_status, order_id, customer_telegram_id,
        amount_minor, business_date, note, actor_username, issued_at
      ) VALUES (?, 'order', 'spent', ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(order_id) DO NOTHING
    `).run(
      operationId,
      id,
      customerTelegramId,
      amount,
      businessDate,
      note || `Принудительная оплата картой при выдаче${actorUsername ? ` (${actorUsername})` : ""}`,
      actorUsername,
      referenceDate.toISOString(),
    );
    db.prepare(`
      UPDATE card_payment_accounts
      SET cooldown_started_at = ?, updated_at = ?
      WHERE telegram_id = ?
    `).run(referenceDate.toISOString(), referenceDate.toISOString(), customerTelegramId);
  })();
  return operationId;
}
