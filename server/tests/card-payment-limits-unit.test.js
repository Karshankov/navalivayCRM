import assert from "node:assert/strict";
import test from "node:test";
import {
  computeCardAvailability,
  computeCooldownUntil,
  computeDailyCardLimitMinor,
  resolveCardOrderAmount,
} from "../utils/card-payment-limits.js";

test("monthly remainder is evenly split across today and remaining calendar days without overshooting", () => {
  assert.equal(computeDailyCardLimitMinor({
    monthlyLimitMinor: 100000,
    spentBeforeTodayMinor: 0,
    businessDate: "2026-10-01",
  }), 3225);
  assert.equal(computeDailyCardLimitMinor({
    monthlyLimitMinor: 100000,
    spentBeforeTodayMinor: 30000,
    businessDate: "2026-10-08",
  }), 2916);
});

test("manual overage decreases future monthly remainder; its day is excluded from recalculation", () => {
  assert.equal(computeDailyCardLimitMinor({
    monthlyLimitMinor: 100000,
    spentBeforeTodayMinor: 0,
    businessDate: "2026-10-08",
    includeToday: false,
  }), 4347);
  assert.equal(computeDailyCardLimitMinor({
    monthlyLimitMinor: 100000,
    spentBeforeTodayMinor: 10000,
    businessDate: "2026-10-09",
  }), 3913);
});

test("a card order above the shared daily remainder is rejected with exceeded_by", () => {
  // Общий дневной лимит — жёсткий потолок: заказ 45 BYN при остатке 30 BYN
  // не проходит картой, клиенту сразу понятна сумма превышения.
  const decision = resolveCardOrderAmount({
    orderAmountMinor: 4500,
    personalLimitMinor: 4500,
    dailyLimitMinor: 25000,
    spentTodayMinor: 22000,
    reservedMinor: 0,
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "daily_limit_exceeded_by_order");
  assert.equal(decision.exceededByMinor, 1500);
  assert.equal(decision.remainingMinor, 3000);
});

test("an order equal to the daily remainder passes in full", () => {
  const decision = resolveCardOrderAmount({
    orderAmountMinor: 3000,
    personalLimitMinor: 4500,
    dailyLimitMinor: 25000,
    spentTodayMinor: 22000,
    reservedMinor: 0,
  });
  assert.equal(decision.ok, true);
  assert.equal(decision.cardAmountMinor, 3000);
});

test("normal orders must fit personal amount; edited orders split the excess to cash", () => {
  const normal = resolveCardOrderAmount({
    orderAmountMinor: 5500,
    personalLimitMinor: 4500,
    dailyLimitMinor: 25000,
    spentTodayMinor: 0,
    reservedMinor: 0,
  });
  assert.equal(normal.ok, false);
  assert.equal(normal.reason, "personal_limit_exceeded");

  const edited = resolveCardOrderAmount({
    orderAmountMinor: 6000,
    personalLimitMinor: 4500,
    dailyLimitMinor: 25000,
    spentTodayMinor: 0,
    reservedMinor: 0,
    allowSplit: true,
  });
  assert.equal(edited.cardAmountMinor, 4500);
  assert.equal(edited.cashDueMinor, 1500);
});

test("shared capacity check closes race when another reservation fills the limit", () => {
  const decision = resolveCardOrderAmount({
    orderAmountMinor: 3000,
    personalLimitMinor: 4500,
    dailyLimitMinor: 25000,
    spentTodayMinor: 20500,
    reservedMinor: 4500,
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "daily_limit_exhausted");
});

test("ten-day personal cooldown starts from issue time", () => {
  assert.equal(
    computeCooldownUntil("2026-10-07T12:00:00.000Z", 10),
    "2026-10-17T12:00:00.000Z",
  );
});
