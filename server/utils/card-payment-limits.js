import {
  BUSINESS_TIME_ZONE,
  getTimeZoneDateParts,
} from "./business-time.js";

function integerMinor(value, name = "invalid_amount") {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(name);
  }
  return parsed;
}

export function cardBusinessDateKey(referenceDate = new Date(), timeZone = BUSINESS_TIME_ZONE) {
  const parts = getTimeZoneDateParts(referenceDate, timeZone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function cardBusinessMonthKey(referenceDate = new Date(), timeZone = BUSINESS_TIME_ZONE) {
  return cardBusinessDateKey(referenceDate, timeZone).slice(0, 7);
}

export function getCalendarDaysInMonth(monthKey) {
  const match = String(monthKey || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) throw new Error("invalid_month_key");
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new Error("invalid_month_key");
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function computeDailyCardLimitMinor({
  monthlyLimitMinor,
  spentBeforeTodayMinor,
  businessDate,
  includeToday = true,
}) {
  const limit = integerMinor(monthlyLimitMinor);
  const spentBefore = integerMinor(spentBeforeTodayMinor);
  const match = String(businessDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error("invalid_date_key");
  const day = Number(match[3]);
  const daysInMonth = getCalendarDaysInMonth(`${match[1]}-${match[2]}`);
  if (day < 1 || day > daysInMonth) throw new Error("invalid_date_key");
  const daysIncludingToday = daysInMonth - day + (includeToday ? 1 : 0);
  const remaining = Math.max(0, limit - spentBefore);
  if (daysIncludingToday <= 0) return 0;
  // Never recommend a daily amount whose repeated use would exceed the
  // remaining monthly plan.
  return Math.floor(remaining / daysIncludingToday);
}

export function computeCardAvailability({
  dailyLimitMinor,
  spentTodayMinor,
  reservedMinor,
}) {
  const limit = integerMinor(dailyLimitMinor);
  const spent = integerMinor(spentTodayMinor);
  const reserved = integerMinor(reservedMinor);
  const committed = spent + reserved;
  return {
    dailyLimitMinor: limit,
    spentTodayMinor: spent,
    reservedMinor: reserved,
    committedMinor: committed,
    remainingMinor: Math.max(0, limit - committed),
    canStartOrder: committed < limit,
  };
}

export function resolveCardOrderAmount({
  orderAmountMinor,
  personalLimitMinor,
  personalMonthlyRemainingMinor = Number.MAX_SAFE_INTEGER,
  dailyLimitMinor,
  spentTodayMinor,
  reservedMinor,
  allowSplit = false,
}) {
  const orderAmount = integerMinor(orderAmountMinor, "invalid_order_amount");
  const personalLimit = integerMinor(personalLimitMinor, "invalid_personal_limit");
  const monthlyRemaining = integerMinor(personalMonthlyRemainingMinor, "invalid_personal_monthly_limit");
  const availability = computeCardAvailability({
    dailyLimitMinor,
    spentTodayMinor,
    reservedMinor,
  });
  if (orderAmount <= 0) throw new Error("invalid_order_amount");

  if ((orderAmount > personalLimit || orderAmount > monthlyRemaining) && !allowSplit) {
    return {
      ok: false,
      reason: orderAmount > personalLimit ? "personal_limit_exceeded" : "personal_monthly_limit_exceeded",
      orderAmountMinor: orderAmount,
      personalLimitMinor: personalLimit,
      personalMonthlyRemainingMinor: monthlyRemaining,
      ...availability,
    };
  }
  if (!availability.canStartOrder) {
    return {
      ok: false,
      reason: "daily_limit_exhausted",
      orderAmountMinor: orderAmount,
      personalLimitMinor: personalLimit,
      ...availability,
    };
  }

  // A daily limit is a gate to begin the last order, not a per-order cap:
  // the order that crosses the shared limit is allowed in full.
  const cardAmountMinor = allowSplit
    ? Math.min(orderAmount, personalLimit, monthlyRemaining)
    : orderAmount;
  return {
    ok: cardAmountMinor > 0,
    reason: cardAmountMinor > 0 ? null : "daily_limit_exhausted",
    orderAmountMinor: orderAmount,
    personalLimitMinor: personalLimit,
    cardAmountMinor,
    cashDueMinor: orderAmount - cardAmountMinor,
    ...availability,
  };
}

export function computeCooldownUntil(issuedAt, cooldownDays = 10) {
  const issued = new Date(issuedAt);
  const days = Number(cooldownDays);
  if (!Number.isFinite(issued.getTime()) || !Number.isInteger(days) || days < 1) {
    throw new Error("invalid_cooldown");
  }
  issued.setUTCDate(issued.getUTCDate() + days);
  return issued.toISOString();
}
