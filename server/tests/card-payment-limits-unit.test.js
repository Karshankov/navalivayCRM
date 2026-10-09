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

test("the last card order may cross the shared daily limit, but later orders are rejected", () => {
  const lastOrder = resolveCardOrderAmount({
    orderAmountMinor: 4500,
    personalLimitMinor: 4500,
    dailyLimitMinor: 25000,
    spentTodayMinor: 23000,
    reservedMinor: 0,
  });
  assert.equal(lastOrder.ok, true);
  assert.equal(lastOrder.cardAmountMinor, 4500);
  assert.equal(computeCardAvailability({
    dailyLimitMinor: 25000,
    spentTodayMinor: 27500,
    reservedMinor: 0,
  }).canStartOrder, false);
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
