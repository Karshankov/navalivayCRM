import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";

import { telegramHeaders } from "./helpers/telegram-auth.js";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "navalivay-wheel-routes-"));
const tempDbPath = path.join(tempDir, "test.db");

process.env.DATABASE_FILE = tempDbPath;
process.env.BOT_TOKEN = "test-bot-token";
process.env.NODE_ENV = "test";
process.env.ALLOW_INSECURE_TELEGRAM_AUTH = "0";

const { initDb, db } = await import("../db.js");
const { seedDefaultWheelData } = await import("../migrations/add_wheel_prizes.js");
const { wheelRouter, isWheelIdempotencyConflict } = await import("../routes/wheel.js");
const { createPrize, updatePrize, updateWheelSettings, getWheelSettings, listAdminPrizes } = await import("../wheel/wheel-service.js");
const { issueToken } = await import("../auth.js");
const { validatePromoCode } = await import("../promo-code-service.js");

const DEFAULT_TEST_ALLOWLIST = [
  "wheel_state_1",
  "wheel_wh_b4",
  "wheel_wh_real",
  "wheel_my_prizes",
  "wheel_no_consent",
  "wheel_yes_consent",
  "wheel_first_visit",
  "wheel_idem",
  "wheel_bad_idem",
  "wheel_parallel_idem",
  "wheel_no_prizes",
  "wheel_promo_text",
  "wheel_idem_real",
  "wheel_audit_route",
  "wheel_feed_title",
];

initDb();
updateWheelSettings({ wheel_access_usernames: DEFAULT_TEST_ALLOWLIST });

const app = express();
app.use(express.json());
app.use(wheelRouter);

const server = await new Promise((resolve) => {
  const instance = app.listen(0, () => resolve(instance));
});
const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;
const adminHeaders = {
  Authorization: `Bearer ${issueToken("test-admin")}`,
};

async function requestJson(url, options = {}) {
  const response = await fetch(`${baseUrl}${url}`, options);
  const data = await response.json().catch(() => null);
  return { response, data };
}

function ensureCustomer(id, telegramId, username, { consent = 1 } = {}) {
  db.prepare(
    `INSERT OR IGNORE INTO customers (
      id, telegram_id, telegram_username, first_name, last_name,
      last_visit_at, photo_url, wheel_feed_consent, wheel_feed_consent_at
    ) VALUES (?, ?, ?, 'Test', 'User', DATETIME('now'), 'https://t.me/i/userpic/test.png', ?, DATETIME('now'))`,
  ).run(id, String(telegramId), username, consent ? 1 : 0);
}

function insertPrize(prizeId, rarityCode, isForRetail, isForWholesale) {
  const templateId = rarityCode === "nothing" ? null : `promo_${prizeId}`;
  if (templateId) {
    db.prepare(
      `INSERT OR IGNORE INTO promo_codes (
        id, code, description, discount_type, discount_value, min_order_amount,
        max_uses, current_uses, active, has_gift, is_wheel_template, created_at
      ) VALUES (?, ?, ?, 'fixed', 10, 0, 0, 0, 1, 0, 1, DATETIME('now'))`,
    ).run(templateId, `CODE_${prizeId.toUpperCase()}`, templateId);
  }
  db.prepare(
    `INSERT OR IGNORE INTO wheel_prizes (
      id, rarity_code, title, description, weight, max_total, issued_count,
      is_for_retail, is_for_wholesale, promo_template_id, promo_validity_days, epic_pool_size,
      epic_pool_threshold_byn, is_active, sort_order, created_at
    ) VALUES (?, ?, ?, NULL, 1, 0, 0, ?, ?, ?, 90, 5, 300, 1, 0, DATETIME('now'))`,
  ).run(prizeId, rarityCode, `Prize ${rarityCode}`, isForRetail, isForWholesale, templateId);
  if (!["nothing", "valuable"].includes(rarityCode)) {
    db.prepare(
      `UPDATE wheel_rarities
       SET chance_percent = CASE WHEN chance_percent <= 0 THEN 100 ELSE chance_percent END
       WHERE code = ?`,
    ).run(rarityCode);
  }
}

function insertSpin(spinId, customerId, prizeId, rarityCode) {
  db.prepare(
    `INSERT INTO wheel_spins (
      id, customer_id, prize_id, rarity_code, is_wholesale,
      seed_for_animation, spun_at
    ) VALUES (?, ?, ?, ?, 0, 1, DATETIME('now'))`,
  ).run(spinId, customerId, prizeId, rarityCode);
}

// B1 regression: /api/wheel/state was 500'ing whenever the live feed
// query had to materialize even a single row, because the SQL referenced
// a non-existent c.customer_photo column. The first time this is hit on
// a customer-facing screen is the first time anyone wins anything.
async function testWheelStateWorksWithRealLiveFeed() {
  ensureCustomer("cust_state_1", "777111", "wheel_state_1");
  insertPrize("p_common_state", "common", 1, 0);
  insertSpin("spin_state_1", "cust_state_1", "p_common_state", "common");

  const { response, data } = await requestJson("/api/wheel/state", {
    method: "GET",
    headers: telegramHeaders({ telegram_id: "777111", telegram_username: "wheel_state_1" }),
  });
  assert.equal(response.status, 200, `expected 200 from /api/wheel/state, got ${response.status}: ${JSON.stringify(data)}`);
  assert.ok(Array.isArray(data?.feed), "feed should be present");
  assert.ok(data.feed.length >= 1, "feed should contain the seeded spin");
  const seeded = data.feed.find((row) => row.id === "spin_state_1");
  assert.ok(seeded, "seeded spin should appear in feed");
  // photo_url passes through as `photo` in the response.
  assert.equal(
    seeded.photo,
    "https://t.me/i/userpic/test.png",
    "feed.photo must come from customers.photo_url, not the (nonexistent) customer_photo column",
  );
}

async function testFeedUsesShortPrizeTitleNotCustomerDescription() {
  ensureCustomer("cust_feed_title", "777333", "wheel_feed_title");
  const prizeId = "p_feed_title";
  const templateId = "promo_feed_title";
  db.prepare(
    `INSERT OR IGNORE INTO promo_codes (
      id, code, description, customer_description, discount_type, discount_value,
      min_order_amount, max_uses, current_uses, active, has_gift, is_wheel_template, created_at
    ) VALUES (?, 'FEEDTITLE', ?, ?, 'percent', 5, 0, 0, 0, 1, 0, 1, DATETIME('now'))`,
  ).run(
    templateId,
    "5% скидка на покупку",
    "Заказ от 30 рублей, если в чеке есть пластины и ещё много условий",
  );
  db.prepare(
    `INSERT OR IGNORE INTO wheel_prizes (
      id, rarity_code, title, description, weight, max_total, issued_count,
      is_for_retail, is_for_wholesale, promo_template_id, promo_validity_days, epic_pool_size,
      epic_pool_threshold_byn, is_active, sort_order, created_at
    ) VALUES (?, 'common', ?, NULL, 1, 0, 0, 1, 0, ?, 90, 5, 300, 1, 0, DATETIME('now'))`,
  ).run(prizeId, "5% СКИДКА НА ПОКУПКУ", templateId);
  insertSpin("spin_feed_title", "cust_feed_title", prizeId, "common");

  const { response, data } = await requestJson("/api/wheel/state", {
    method: "GET",
    headers: telegramHeaders({ telegram_id: "777333", telegram_username: "wheel_feed_title" }),
  });
  assert.equal(response.status, 200);
  const seeded = (data?.feed || []).find((row) => row.id === "spin_feed_title");
  assert.ok(seeded, "seeded spin should appear in feed");
  assert.equal(
    seeded.prize_title,
    "5% скидка на покупку",
    "feed must show the short promo title, not customer_description",
  );
}

// B4 regression: any retail client could send arbitrary
// X-Wholesale-Code / X-Wholesale-Secret and tip the wheel into the
// wholesale prize pool. After the fix, the request is treated as
// retail unless the headers match a real wholesale_tiers row.
async function testForgedWholesaleHeadersDoNotUnlockWholesalePool() {
  ensureCustomer("cust_wh_b4", "777222", "wheel_wh_b4");
  insertPrize("p_retail_only", "common", 1, 0);
  insertPrize("p_wholesale_only", "rare", 0, 1);

  const { response, data } = await requestJson("/api/wheel/state", {
    method: "GET",
    headers: telegramHeaders(
      { telegram_id: "777222", telegram_username: "wheel_wh_b4" },
      {
        "x-wholesale-code": "fake-code",
        "x-wholesale-secret": "fake-secret",
      },
    ),
  });
  assert.equal(response.status, 200);
  assert.equal(
    data.is_wholesale,
    false,
    "forged wholesale headers must NOT flip the request into wholesale mode",
  );
  const ids = (data.prizes || []).map((p) => p.id);
  assert.ok(ids.includes("p_retail_only"), "retail prize must be visible");
  assert.ok(
    !ids.includes("p_wholesale_only"),
    "wholesale prize must NOT be visible to a retail client with forged headers",
  );
}

// B4 happy-path: a real wholesale client (creds match wholesale_tiers)
// must still see wholesale prizes.
async function testValidatedWholesaleHeadersUnlockWholesalePool() {
  const tier = db
    .prepare(
      "SELECT code, secret_key FROM wholesale_tiers WHERE is_active = 1 ORDER BY sort_order LIMIT 1",
    )
    .get();
  if (!tier) {
    console.warn("[wheel-routes] no active wholesale tier seeded — skipping happy path");
    return;
  }

  ensureCustomer("cust_wh_real", "777333", "wheel_wh_real");
  insertPrize("p_wholesale_real", "rare", 0, 1);

  const { response, data } = await requestJson("/api/wheel/state", {
    method: "GET",
    headers: telegramHeaders(
      { telegram_id: "777333", telegram_username: "wheel_wh_real" },
      {
        "x-wholesale-code": tier.code,
        "x-wholesale-secret": tier.secret_key,
      },
    ),
  });
  assert.equal(response.status, 200);
  assert.equal(
    data.is_wholesale,
    true,
    "validated wholesale credentials must flip the request into wholesale mode",
  );
  const ids = (data.prizes || []).map((p) => p.id);
  assert.ok(
    ids.includes("p_wholesale_real"),
    "wholesale prize must be visible to a validated wholesale request",
  );
}

async function testWheelAccessAllowlistLocksStateForOutsiders() {
  ensureCustomer("cust_locked_out", "777350", "wheel_locked_out");
  updateWheelSettings({ wheel_access_usernames: ["wheel_tester_only"] });

  const { response, data } = await requestJson("/api/wheel/state", {
    method: "GET",
    headers: telegramHeaders({ telegram_id: "777350", telegram_username: "wheel_locked_out" }),
  });
  assert.equal(response.status, 200);
  assert.equal(data?.access?.is_allowed, false, "outsider must be denied");
  assert.equal(data?.access?.is_limited, true, "limited rollout flag must be exposed");
  assert.deepEqual(data?.prizes || [], [], "outsider must not receive prize pool");
  assert.deepEqual(data?.feed || [], [], "outsider must not receive feed");
  updateWheelSettings({ wheel_access_usernames: [] });
}

async function testWheelAccessAllowlistLetsTesterInAndBlocksSpinForOutsider() {
  ensureCustomer("cust_locked_in", "777351", "wheel_tester_only");
  ensureCustomer("cust_locked_spin", "777352", "wheel_spin_blocked");
  updateWheelSettings({ wheel_access_usernames: ["wheel_tester_only"] });

  const allowedState = await requestJson("/api/wheel/state", {
    method: "GET",
    headers: telegramHeaders({ telegram_id: "777351", telegram_username: "wheel_tester_only" }),
  });
  assert.equal(allowedState.response.status, 200);
  assert.equal(allowedState.data?.access?.is_allowed, true, "whitelisted tester should be allowed");

  const blockedSpin = await requestJson("/api/wheel/spin", {
    method: "POST",
    headers: {
      ...telegramHeaders({ telegram_id: "777352", telegram_username: "wheel_spin_blocked" }),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  assert.equal(blockedSpin.response.status, 403);
  assert.equal(blockedSpin.data?.error, "wheel_locked");
  updateWheelSettings({ wheel_access_usernames: [] });
}

async function testWheelAccessAllowlistBlocksConsentAndMyPrizesForOutsider() {
  ensureCustomer("cust_locked_actions", "777353", "wheel_locked_actions", { consent: 0 });
  insertPrize("p_locked_actions", "common", 1, 0);
  insertSpin("spin_locked_actions", "cust_locked_actions", "p_locked_actions", "common");
  updateWheelSettings({ wheel_access_usernames: ["wheel_tester_only"] });

  const blockedConsent = await requestJson("/api/wheel/feed-consent", {
    method: "POST",
    headers: telegramHeaders(
      { telegram_id: "777353", telegram_username: "wheel_locked_actions" },
      { "Content-Type": "application/json" },
    ),
    body: JSON.stringify({ consent: true }),
  });
  assert.equal(blockedConsent.response.status, 403);
  assert.equal(blockedConsent.data?.error, "wheel_locked");

  const customer = db
    .prepare("SELECT wheel_feed_consent FROM customers WHERE id = ?")
    .get("cust_locked_actions");
  assert.equal(customer.wheel_feed_consent, 0, "blocked consent update must not mutate customer");

  const blockedPrizes = await requestJson("/api/wheel/my-prizes", {
    method: "GET",
    headers: telegramHeaders({ telegram_id: "777353", telegram_username: "wheel_locked_actions" }),
  });
  assert.equal(blockedPrizes.response.status, 403);
  assert.equal(blockedPrizes.data?.error, "wheel_locked");
  updateWheelSettings({ wheel_access_usernames: [] });
}

function testWheelSeedDoesNotRestoreHardcodedAllowlistAfterRestart() {
  updateWheelSettings({ wheel_access_usernames: [] });
  seedDefaultWheelData();
  const row = db
    .prepare("SELECT value FROM wheel_settings WHERE key = 'wheel_access_usernames_json'")
    .get();
  const usernames = JSON.parse(String(row?.value || "[]"));
  assert.deepEqual(
    usernames,
    [],
    "seed on restart must not inject hardcoded wheel allowlist usernames",
  );
  updateWheelSettings({ wheel_access_usernames: DEFAULT_TEST_ALLOWLIST });
}

function testWheelSettingsEmptyAllowlistMeansOpenAccess() {
  updateWheelSettings({ wheel_access_usernames: [] });
  const settings = getWheelSettings();
  assert.deepEqual(
    settings.wheel_access_usernames,
    [],
    "empty allowlist must stay empty — open access for everyone",
  );
  updateWheelSettings({ wheel_access_usernames: DEFAULT_TEST_ALLOWLIST });
}

async function testMyPrizesStatusFiltersExcludeNothingAndSplitLifecycle() {
  ensureCustomer("cust_my_prizes", "777354", "wheel_my_prizes", { consent: 1 });
  insertPrize("p_my_common", "common", 1, 0);
  insertPrize("p_my_nothing", "nothing", 1, 0);
  insertSpin("spin_my_active", "cust_my_prizes", "p_my_common", "common");
  insertSpin("spin_my_used", "cust_my_prizes", "p_my_common", "common");
  insertSpin("spin_my_expired", "cust_my_prizes", "p_my_common", "common");
  insertSpin("spin_my_nothing", "cust_my_prizes", "p_my_nothing", "nothing");
  db.prepare(
    `UPDATE wheel_spins
     SET generated_promo_code = 'ACTIVE-CODE',
         promo_valid_until = DATE('now', '+1 day')
     WHERE id = 'spin_my_active'`,
  ).run();
  db.prepare(
    `UPDATE wheel_spins
     SET generated_promo_code = 'USED-CODE',
         promo_valid_until = DATE('now', '+1 day'),
         prize_used_at = DATETIME('now')
     WHERE id = 'spin_my_used'`,
  ).run();
  db.prepare(
    `UPDATE wheel_spins
     SET generated_promo_code = 'EXPIRED-CODE',
         promo_valid_until = DATE('now', '-1 day')
     WHERE id = 'spin_my_expired'`,
  ).run();

  const headers = telegramHeaders({ telegram_id: "777354", telegram_username: "wheel_my_prizes" });
  const all = await requestJson("/api/wheel/my-prizes?status=all", { method: "GET", headers });
  assert.equal(all.response.status, 200);
  assert.deepEqual(
    (all.data.prizes || []).map((row) => row.spin_id).sort(),
    ["spin_my_active", "spin_my_expired", "spin_my_used"].sort(),
    "my-prizes must exclude nothing results from all status",
  );

  const active = await requestJson("/api/wheel/my-prizes?status=active", { method: "GET", headers });
  assert.deepEqual((active.data.prizes || []).map((row) => row.spin_id), ["spin_my_active"]);

  const used = await requestJson("/api/wheel/my-prizes?status=used", { method: "GET", headers });
  assert.deepEqual((used.data.prizes || []).map((row) => row.spin_id), ["spin_my_used"]);

  const expired = await requestJson("/api/wheel/my-prizes?status=expired", { method: "GET", headers });
  assert.deepEqual((expired.data.prizes || []).map((row) => row.spin_id), ["spin_my_expired"]);
}

// C1-CR regression: when CRM creates a prize that points at a normal
// promo template, the template row gets is_wheel_template=1 — and once
// it does, validatePromoCode must refuse to apply it at checkout. Before
// the fix, the flag was never set, so the public template code was a
// working discount.
async function testWheelTemplateRejectedAtCheckout() {
  const promoId = "promo_template_rej";
  db.prepare(
    `INSERT OR IGNORE INTO promo_codes (
      id, code, description, discount_type, discount_value, min_order_amount,
      max_uses, current_uses, valid_from, valid_until, active, has_gift,
      is_wheel_template, created_at
    ) VALUES (?, ?, NULL, 'fixed', 5, 0, 0, 0, NULL, NULL, 1, 0, 0, DATETIME('now'))`,
  ).run(promoId, "WHEELTPL-REJ");

  // Sanity: before being linked to a prize, the code is a regular
  // discount and validatePromoCode accepts it.
  const before = validatePromoCode("WHEELTPL-REJ", 100);
  assert.equal(before.valid, true, "untagged promo should be valid before becoming a wheel template");

  const prize = createPrize({
    rarity_code: "common",
    title: "5 BYN скидка",
    weight: 1,
    is_for_retail: true,
    is_for_wholesale: false,
    promo_template_id: promoId,
  });
  assert.ok(prize?.id, "prize creation should succeed");

  const flagRow = db
    .prepare("SELECT is_wheel_template FROM promo_codes WHERE id = ?")
    .get(promoId);
  assert.equal(
    Number(flagRow?.is_wheel_template),
    1,
    "createPrize must set is_wheel_template=1 on the linked promo_codes row",
  );

  const after = validatePromoCode("WHEELTPL-REJ", 100);
  assert.equal(after.valid, false, "wheel template code must NOT be valid at checkout");
  assert.equal(
    after.error,
    "wheel_template_not_applicable",
    "validatePromoCode should report wheel_template_not_applicable",
  );
}

// C1-CR regression: when CRM repoints a prize at a different template,
// the previous template row should drop is_wheel_template back to 0 IF
// no other prize still references it; the new template row must be
// flagged. The transition happens atomically inside one transaction.
async function testWheelTemplateFlagClearedWhenPrizeChangesTemplate() {
  const oldId = "promo_template_old";
  const newId = "promo_template_new";
  db.prepare(
    `INSERT OR IGNORE INTO promo_codes (
      id, code, description, discount_type, discount_value, min_order_amount,
      max_uses, current_uses, valid_from, valid_until, active, has_gift,
      is_wheel_template, created_at
    ) VALUES (?, ?, NULL, 'fixed', 5, 0, 0, 0, NULL, NULL, 1, 0, 0, DATETIME('now'))`,
  ).run(oldId, "WHEELTPL-OLD");
  db.prepare(
    `INSERT OR IGNORE INTO promo_codes (
      id, code, description, discount_type, discount_value, min_order_amount,
      max_uses, current_uses, valid_from, valid_until, active, has_gift,
      is_wheel_template, created_at
    ) VALUES (?, ?, NULL, 'fixed', 7, 0, 0, 0, NULL, NULL, 1, 0, 0, DATETIME('now'))`,
  ).run(newId, "WHEELTPL-NEW");

  const prize = createPrize({
    rarity_code: "common",
    title: "Migration prize",
    weight: 1,
    is_for_retail: true,
    promo_template_id: oldId,
  });
  assert.equal(
    Number(
      db.prepare("SELECT is_wheel_template FROM promo_codes WHERE id = ?").get(oldId)
        ?.is_wheel_template,
    ),
    1,
  );

  updatePrize(prize.id, { promo_template_id: newId });

  assert.equal(
    Number(
      db.prepare("SELECT is_wheel_template FROM promo_codes WHERE id = ?").get(oldId)
        ?.is_wheel_template,
    ),
    0,
    "old template should be unflagged after the prize switched",
  );
  assert.equal(
    Number(
      db.prepare("SELECT is_wheel_template FROM promo_codes WHERE id = ?").get(newId)
        ?.is_wheel_template,
    ),
    1,
    "new template should be flagged",
  );
}

// C3-CR regression: a partial PATCH that disables `is_for_retail` on a
// prize whose existing pool is also disabled-for-wholesale must surface
// `at_least_one_pool_required`, not silently leave the row unreachable.
async function testPartialUpdateRejectsBothPoolsDisabled() {
  const prize = createPrize({
    rarity_code: "common",
    title: "Pool prize",
    weight: 1,
    is_for_retail: true,
    is_for_wholesale: false,
  });
  const { response, data } = await requestJson(
    `/api/admin/crm/wheel/prizes/${prize.id}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer admin-token-not-needed-here",
      },
      body: JSON.stringify({ is_for_retail: false }),
    },
  );
  // We don't have an admin auth helper in this test harness — endpoints
  // that require auth return 401. Instead exercise the validator
  // directly so the assertion stays focused on validation logic.
  if (response.status === 401) {
    const { validatePrizePayload } = await import("../wheel/wheel-service.js");
    const existing = db
      .prepare("SELECT * FROM wheel_prizes WHERE id = ?")
      .get(prize.id);
    const result = validatePrizePayload(
      { is_for_retail: false },
      { isUpdate: true, existing },
    );
    assert.ok(
      result.errors.includes("at_least_one_pool_required"),
      "partial update that empties both pools must fail validation",
    );
  } else {
    assert.equal(response.status, 400, `expected 400 got ${response.status}: ${JSON.stringify(data)}`);
    assert.ok(
      Array.isArray(data?.details) && data.details.includes("at_least_one_pool_required"),
      "partial update that empties both pools must fail validation",
    );
  }
}

async function testUnusedPrizeCanBeDeletedFromAdmin() {
  db.prepare(
    `INSERT OR IGNORE INTO promo_codes (
      id, code, description, discount_type, discount_value, min_order_amount,
      max_uses, current_uses, active, has_gift, is_wheel_template, created_at
    ) VALUES (?, ?, ?, 'fixed', 10, 0, 0, 0, 1, 0, 0, DATETIME('now'))`,
  ).run("promo_delete_me", "PROMO-DELETE-ME", "promo_delete_me");
  const prize = createPrize({
    rarity_code: "common",
    title: "Delete me",
    weight: 1,
    is_for_retail: true,
    promo_template_id: "promo_delete_me",
  });

  const beforeDelete = listAdminPrizes().find((item) => item.id === prize.id);
  assert.equal(beforeDelete?.can_delete, true, "unused prize should be deletable in admin list");

  const { response, data } = await requestJson(`/api/admin/crm/wheel/prizes/${prize.id}`, {
    method: "DELETE",
    headers: adminHeaders,
  });
  assert.equal(response.status, 200, `expected 200 got ${response.status}: ${JSON.stringify(data)}`);
  assert.equal(
    db.prepare("SELECT id FROM wheel_prizes WHERE id = ?").get(prize.id),
    undefined,
    "unused prize should be removed from wheel_prizes",
  );
}

async function testUsedPrizeDeleteFallsBackToDisableOnly() {
  ensureCustomer("cust_delete_guard", "777391", "wheel_delete_guard");
  insertPrize("p_delete_guard", "common", 1, 0);
  insertSpin("spin_delete_guard", "cust_delete_guard", "p_delete_guard", "common");

  const listed = listAdminPrizes().find((item) => item.id === "p_delete_guard");
  assert.equal(listed?.can_delete, false, "issued prize should not be deletable in admin list");

  const { response, data } = await requestJson("/api/admin/crm/wheel/prizes/p_delete_guard", {
    method: "DELETE",
    headers: adminHeaders,
  });
  assert.equal(response.status, 409, `expected 409 got ${response.status}: ${JSON.stringify(data)}`);
  assert.equal(data?.error, "prize_has_history");
  assert.ok(
    String(data?.message || "").includes("только выключить"),
    "conflict message should explain that only disable is allowed",
  );
  assert.ok(
    db.prepare("SELECT id FROM wheel_prizes WHERE id = ?").get("p_delete_guard"),
    "issued prize must stay in wheel_prizes after rejected delete",
  );
}

async function testPrizeRequiresPromoTemplateUnlessNothing() {
  const { validatePrizePayload } = await import("../wheel/wheel-service.js");

  const createResult = validatePrizePayload({
    rarity_code: "common",
    title: "No promo template",
    is_for_retail: true,
    is_for_wholesale: false,
  });
  assert.ok(
    createResult.errors.includes("promo_template_required_for_prize"),
    "non-nothing prize without promo template must fail validation",
  );

  const nothingResult = validatePrizePayload({
    rarity_code: "nothing",
    title: "Nothing prize",
    is_for_retail: true,
    is_for_wholesale: false,
  });
  assert.ok(
    !nothingResult.errors.includes("promo_template_required_for_prize"),
    "nothing prize may omit promo template",
  );

  db.prepare(
    `INSERT INTO promo_codes (
      id, code, description, customer_description, manager_description,
      discount_type, discount_value, min_order_amount, max_uses, current_uses,
      active, has_gift, is_wheel_template, created_at
    ) VALUES (
      'promo_text_source', 'TEXTSRC', 'Legacy promo description',
      'Подарок из промокода', 'Положить подарок',
      'fixed', 0, 0, 0, 0, 1, 1, 0, DATETIME('now')
    )`,
  ).run();

  const noTitleResult = validatePrizePayload({
    rarity_code: "common",
    is_for_retail: true,
    is_for_wholesale: false,
    promo_template_id: "promo_text_source",
  });
  assert.ok(
    !noTitleResult.errors.includes("title_required"),
    "wheel prize title is no longer required when promo template owns customer text",
  );

  const textSourcePrize = createPrize({
    rarity_code: "common",
    weight: 1,
    is_for_retail: true,
    is_for_wholesale: false,
    promo_template_id: "promo_text_source",
  });
  const listedPrize = listAdminPrizes().find((prize) => prize.id === textSourcePrize.id);
  assert.equal(listedPrize.title, "Legacy promo description");
  assert.equal(listedPrize.description, "Подарок из промокода");

  const existing = createPrize({
    rarity_code: "common",
    title: "Has promo template",
    weight: 1,
    is_for_retail: true,
    is_for_wholesale: false,
    promo_template_id: "promo_template_old",
  });
  const updateResult = validatePrizePayload(
    { promo_template_id: null },
    { isUpdate: true, existing },
  );
  assert.ok(
    updateResult.errors.includes("promo_template_required_for_prize"),
    "removing promo template from non-nothing prize must fail validation",
  );
}

// Q6 regression: a customer with wheel_feed_consent = 0 must be excluded
// from the public live feed even if they have winning spins on file.
// PII protection: do not show first_name + photo without explicit
// opt-in.
async function testFeedExcludesCustomersWithoutConsent() {
  // Use fresh customers + prize for an isolated assertion.
  ensureCustomer("cust_no_consent", "777444", "wheel_no_consent", { consent: 0 });
  ensureCustomer("cust_yes_consent", "777445", "wheel_yes_consent", { consent: 1 });
  insertPrize("p_consent_test", "rare", 1, 0);
  insertSpin("spin_no_consent", "cust_no_consent", "p_consent_test", "rare");
  insertSpin("spin_yes_consent", "cust_yes_consent", "p_consent_test", "rare");

  const { response, data } = await requestJson("/api/wheel/state", {
    method: "GET",
    headers: telegramHeaders({
      telegram_id: "777445",
      telegram_username: "wheel_yes_consent",
    }),
  });
  assert.equal(response.status, 200);
  const feedIds = (data?.feed || []).map((row) => row.id);
  assert.ok(
    !feedIds.includes("spin_no_consent"),
    "non-consenting customer must NOT appear in feed",
  );
  assert.ok(
    feedIds.includes("spin_yes_consent"),
    "consenting customer must appear in feed",
  );
}

// Q6 regression: state response carries feed_consent_required = true
// for customers who have not yet answered, and false once the consent
// is recorded (either accept or decline).
async function testFeedConsentRequiredFlagFlips() {
  ensureCustomer("cust_first_visit", "777446", "wheel_first_visit", { consent: 0 });
  // Flip consent_at to NULL so the state endpoint sees an unanswered
  // customer (helper sets it to DATETIME('now') by default).
  db.prepare(
    "UPDATE customers SET wheel_feed_consent = 0, wheel_feed_consent_at = NULL WHERE id = ?",
  ).run("cust_first_visit");

  const before = await requestJson("/api/wheel/state", {
    method: "GET",
    headers: telegramHeaders({
      telegram_id: "777446",
      telegram_username: "wheel_first_visit",
    }),
  });
  assert.equal(before.response.status, 200);
  assert.equal(before.data.feed_consent_required, true);
  assert.equal(before.data.feed_consent, false);

  // Decline: feed_consent stays false but consent_required flips off.
  const post = await requestJson("/api/wheel/feed-consent", {
    method: "POST",
    headers: telegramHeaders({
      telegram_id: "777446",
      telegram_username: "wheel_first_visit",
    }),
    body: JSON.stringify({ consent: false }),
  });
  assert.equal(post.response.status, 200);
  assert.equal(post.data.success, true);
  assert.equal(post.data.consent, false);

  const after = await requestJson("/api/wheel/state", {
    method: "GET",
    headers: telegramHeaders({
      telegram_id: "777446",
      telegram_username: "wheel_first_visit",
    }),
  });
  assert.equal(after.response.status, 200);
  assert.equal(after.data.feed_consent_required, false);
  assert.equal(after.data.feed_consent, false);
}

async function testSpinResponseUsesPromoTextAsPrizeText() {
  db.prepare("UPDATE wheel_prizes SET is_active = 0").run();
  db.prepare("UPDATE wheel_rarities SET chance_percent = 0 WHERE code NOT IN ('nothing', 'valuable')").run();
  ensureCustomer("cust_promo_text", "777453", "wheel_promo_text", { consent: 1 });
  insertPrize("p_promo_text", "common", 1, 0);
  db.prepare("UPDATE wheel_rarities SET chance_percent = 100 WHERE code = 'common'").run();
  db.prepare(
    `UPDATE promo_codes
     SET customer_description = 'Клиентский подарок из промокода',
         description = 'Legacy promo text'
     WHERE id = 'promo_p_promo_text'`,
  ).run();
  db.prepare(
    `INSERT OR REPLACE INTO wheel_customer_balances (
      customer_id, spins_available, accumulated_retail_byn,
      accumulated_wholesale_byn, consecutive_nothing, last_updated_at
    ) VALUES (?, 1, 0, 0, 0, DATETIME('now'))`,
  ).run("cust_promo_text");

  const { response, data } = await requestJson("/api/wheel/spin", {
    method: "POST",
    headers: telegramHeaders({
      telegram_id: "777453",
      telegram_username: "wheel_promo_text",
    }),
    body: JSON.stringify({}),
  });

  assert.equal(response.status, 200, JSON.stringify(data));
  assert.equal(data.prize.title, "Legacy promo text");
  assert.equal(data.prize.description, "Клиентский подарок из промокода");

  db.prepare(
    `UPDATE promo_codes
     SET customer_description = 'Только старый заголовок',
         description = NULL
     WHERE id = 'promo_p_promo_text'`,
  ).run();
  db.prepare(
    `INSERT OR REPLACE INTO wheel_customer_balances (
      customer_id, spins_available, accumulated_retail_byn,
      accumulated_wholesale_byn, consecutive_nothing, last_updated_at
    ) VALUES (?, 1, 0, 0, 0, DATETIME('now'))`,
  ).run("cust_promo_text");

  const legacy = await requestJson("/api/wheel/spin", {
    method: "POST",
    headers: telegramHeaders({
      telegram_id: "777453",
      telegram_username: "wheel_promo_text",
    }),
    body: JSON.stringify({}),
  });
  assert.equal(legacy.response.status, 200, JSON.stringify(legacy.data));
  assert.equal(legacy.data.prize.title, "Только старый заголовок");
  assert.equal(legacy.data.prize.description, null);
}

// P1 regression: a second POST /api/wheel/spin with the same
// Idempotency-Key must return the same spin_id and must NOT decrement
// the spin balance again. Race-safe variant is exercised by the
// route's catch-block fallback when the UNIQUE constraint fires.
async function testSpinIsIdempotentByKey() {
  ensureCustomer("cust_idem", "777447", "wheel_idem", { consent: 1 });
  // Seed a prize the spin can land on.
  insertPrize("p_idem_nothing", "nothing", 1, 0);
  insertPrize("p_idem_common", "common", 1, 0);
  // Give the customer 2 spins so we'd notice a double-spend.
  db.prepare(
    `INSERT OR REPLACE INTO wheel_customer_balances (
      customer_id, spins_available, accumulated_retail_byn,
      accumulated_wholesale_byn, consecutive_nothing, last_updated_at
    ) VALUES (?, 2, 0, 0, 0, DATETIME('now'))`,
  ).run("cust_idem");

  const key = "test-idempotency-key-00000001";
  const headers = telegramHeaders(
    { telegram_id: "777447", telegram_username: "wheel_idem" },
    { "Idempotency-Key": key },
  );

  const first = await requestJson("/api/wheel/spin", {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });
  assert.equal(first.response.status, 200, JSON.stringify(first.data));
  const firstSpinId = first.data.spin_id;
  const balanceAfterFirst = db
    .prepare("SELECT spins_available FROM wheel_customer_balances WHERE customer_id = ?")
    .get("cust_idem");
  assert.equal(balanceAfterFirst.spins_available, 1, "first spin must decrement balance");

  const second = await requestJson("/api/wheel/spin", {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });
  assert.equal(second.response.status, 200);
  assert.equal(
    second.data.spin_id,
    firstSpinId,
    "second POST with same key must replay the original spin id",
  );
  assert.equal(
    second.data.idempotent_replay,
    true,
    "second response should be flagged as idempotent_replay",
  );

  const balanceAfterReplay = db
    .prepare("SELECT spins_available FROM wheel_customer_balances WHERE customer_id = ?")
    .get("cust_idem");
  assert.equal(
    balanceAfterReplay.spins_available,
    1,
    "idempotent replay must NOT decrement balance again",
  );

  // Sanity: a different key on the same customer does consume a spin.
  const anotherKey = "test-idempotency-key-00000002";
  const fresh = await requestJson("/api/wheel/spin", {
    method: "POST",
    headers: telegramHeaders(
      { telegram_id: "777447", telegram_username: "wheel_idem" },
      { "Idempotency-Key": anotherKey },
    ),
    body: JSON.stringify({}),
  });
  assert.equal(fresh.response.status, 200);
  assert.notEqual(fresh.data.spin_id, firstSpinId);
  const balanceFinal = db
    .prepare("SELECT spins_available FROM wheel_customer_balances WHERE customer_id = ?")
    .get("cust_idem");
  assert.equal(balanceFinal.spins_available, 0, "fresh key consumes a spin");
}

async function testSpinRejectsInvalidIdempotencyKeyWithoutSpending() {
  ensureCustomer("cust_bad_idem", "777449", "wheel_bad_idem", { consent: 1 });
  insertPrize("p_bad_idem_nothing", "nothing", 1, 0);
  db.prepare(
    `INSERT OR REPLACE INTO wheel_customer_balances (
      customer_id, spins_available, accumulated_retail_byn,
      accumulated_wholesale_byn, consecutive_nothing, last_updated_at
    ) VALUES (?, 1, 0, 0, 0, DATETIME('now'))`,
  ).run("cust_bad_idem");

  const { response, data } = await requestJson("/api/wheel/spin", {
    method: "POST",
    headers: telegramHeaders(
      { telegram_id: "777449", telegram_username: "wheel_bad_idem" },
      { "Idempotency-Key": "short" },
    ),
    body: JSON.stringify({}),
  });

  assert.equal(response.status, 400);
  assert.equal(data?.error, "invalid_idempotency_key");
  const balance = db
    .prepare("SELECT spins_available FROM wheel_customer_balances WHERE customer_id = ?")
    .get("cust_bad_idem");
  assert.equal(balance.spins_available, 1, "invalid key must not spend a spin");
  const spins = db
    .prepare("SELECT COUNT(*) AS count FROM wheel_spins WHERE customer_id = ?")
    .get("cust_bad_idem");
  assert.equal(spins.count, 0, "invalid key must not create a spin");
}

async function testParallelDifferentIdempotencyKeysDoNotOverspendOneSpin() {
  ensureCustomer("cust_parallel_idem", "777450", "wheel_parallel_idem", { consent: 1 });
  insertPrize("p_parallel_nothing", "nothing", 1, 0);
  insertPrize("p_parallel_common", "common", 1, 0);
  db.prepare(
    `INSERT OR REPLACE INTO wheel_customer_balances (
      customer_id, spins_available, accumulated_retail_byn,
      accumulated_wholesale_byn, consecutive_nothing, last_updated_at
    ) VALUES (?, 1, 0, 0, 0, DATETIME('now'))`,
  ).run("cust_parallel_idem");

  const baseAuth = { telegram_id: "777450", telegram_username: "wheel_parallel_idem" };
  const [first, second] = await Promise.all([
    requestJson("/api/wheel/spin", {
      method: "POST",
      headers: telegramHeaders(baseAuth, { "Idempotency-Key": "test-parallel-key-00000001" }),
      body: JSON.stringify({}),
    }),
    requestJson("/api/wheel/spin", {
      method: "POST",
      headers: telegramHeaders(baseAuth, { "Idempotency-Key": "test-parallel-key-00000002" }),
      body: JSON.stringify({}),
    }),
  ]);

  const statuses = [first.response.status, second.response.status].sort();
  assert.deepEqual(statuses, [200, 400], "one spin should succeed and one should fail");
  const errors = [first.data?.error, second.data?.error].filter(Boolean);
  assert.ok(errors.includes("not_enough_spins"), "second request must fail with not_enough_spins");

  const balance = db
    .prepare("SELECT spins_available FROM wheel_customer_balances WHERE customer_id = ?")
    .get("cust_parallel_idem");
  assert.equal(balance.spins_available, 0, "parallel requests must not overspend below zero");
  const spins = db
    .prepare("SELECT COUNT(*) AS count FROM wheel_spins WHERE customer_id = ?")
    .get("cust_parallel_idem");
  assert.equal(spins.count, 1, "only one spin row may be created");
}

async function testSpinNoPrizesConfiguredDoesNotSpendSpin() {
  ensureCustomer("cust_no_prizes", "777451", "wheel_no_prizes", { consent: 1 });
  db.prepare(
    `INSERT OR REPLACE INTO wheel_customer_balances (
      customer_id, spins_available, accumulated_retail_byn,
      accumulated_wholesale_byn, consecutive_nothing, last_updated_at
    ) VALUES (?, 1, 0, 0, 0, DATETIME('now'))`,
  ).run("cust_no_prizes");
  db.prepare("UPDATE wheel_prizes SET is_active = 0").run();

  const { response, data } = await requestJson("/api/wheel/spin", {
    method: "POST",
    headers: telegramHeaders(
      { telegram_id: "777451", telegram_username: "wheel_no_prizes" },
      { "Idempotency-Key": "test-no-prizes-key-00000001" },
    ),
    body: JSON.stringify({}),
  });

  assert.equal(response.status, 400);
  assert.equal(data?.error, "no_prizes_configured");
  const balance = db
    .prepare("SELECT spins_available FROM wheel_customer_balances WHERE customer_id = ?")
    .get("cust_no_prizes");
  assert.equal(balance.spins_available, 1, "failed spin must not spend balance");
  const spins = db
    .prepare("SELECT COUNT(*) AS count FROM wheel_spins WHERE customer_id = ?")
    .get("cust_no_prizes");
  assert.equal(spins.count, 0, "failed spin must not create a row");
}

// Round 4: the catch-branch predicate `isWheelIdempotencyConflict`
// must fire on every shape of UNIQUE-constraint error better-sqlite3
// might surface for our partial index. Previously the route relied on
// `error.message.includes("idx_wheel_spins_idempotency")`, which is
// brittle: SQLite sometimes reports the column form ("UNIQUE
// constraint failed: wheel_spins.customer_id,
// wheel_spins.idempotency_key") with no index name. The replacement
// keys on `error.code`. This test pins that contract.
async function testIdempotencyConflictPredicateMatchesAllShapes() {
  assert.equal(
    isWheelIdempotencyConflict(
      Object.assign(new Error("UNIQUE constraint failed: x"), {
        code: "SQLITE_CONSTRAINT_UNIQUE",
      }),
      "",
    ),
    false,
    "no idempotency key → never an idempotency conflict",
  );

  assert.equal(
    isWheelIdempotencyConflict(
      Object.assign(
        new Error(
          "UNIQUE constraint failed: wheel_spins.customer_id, wheel_spins.idempotency_key",
        ),
        { code: "SQLITE_CONSTRAINT_UNIQUE" },
      ),
      "idem-test-key-1234567890abcdef",
    ),
    true,
    "column-form UNIQUE message must be recognized via error.code",
  );

  assert.equal(
    isWheelIdempotencyConflict(
      Object.assign(
        new Error("UNIQUE constraint failed: index 'idx_wheel_spins_idempotency'"),
        { code: "SQLITE_CONSTRAINT_UNIQUE" },
      ),
      "idem-test-key-1234567890abcdef",
    ),
    true,
    "index-form UNIQUE message must be recognized via error.code",
  );

  // Generic SQLITE_CONSTRAINT* prefix is also accepted — we follow up
  // with a (customer_id, key) lookup in the route to confirm the
  // conflict is actually ours, so over-matching here is safe.
  assert.equal(
    isWheelIdempotencyConflict(
      Object.assign(new Error("constraint failed"), {
        code: "SQLITE_CONSTRAINT_PRIMARYKEY",
      }),
      "idem-test-key-1234567890abcdef",
    ),
    true,
    "any SQLITE_CONSTRAINT* with a key triggers the lookup path",
  );

  assert.equal(
    isWheelIdempotencyConflict(
      new TypeError("something else broke"),
      "idem-test-key-1234567890abcdef",
    ),
    false,
    "non-SQLite errors must not be treated as idempotency conflicts",
  );

  assert.equal(
    isWheelIdempotencyConflict(
      new Error("UNIQUE constraint failed: foo"),
      "idem-test-key-1234567890abcdef",
    ),
    false,
    "Error with no `code` property must not match — we only trust SQLite's machine-readable code",
  );
}

// Round 4: a real UNIQUE-violation against the partial index on
// (customer_id, idempotency_key) must produce an error.code that the
// predicate accepts. Without this assertion, a future SQLite upgrade
// could change the error shape and the route would silently 500 on
// every retry.
async function testRealUniqueViolationOnIdempotencyKeyMatchesPredicate() {
  ensureCustomer("cust_idem_real", "777448", "wheel_idem_real");
  insertPrize("p_idem_real", "common", 1, 0);
  const sharedKey = "test-shared-key-000000000001";
  insertSpin("spin_idem_real_a", "cust_idem_real", "p_idem_real", "common");
  db.prepare(
    "UPDATE wheel_spins SET idempotency_key = ? WHERE id = ?",
  ).run(sharedKey, "spin_idem_real_a");

  let captured = null;
  try {
    db.prepare(
      `INSERT INTO wheel_spins (
        id, customer_id, prize_id, rarity_code, is_wholesale,
        seed_for_animation, spun_at, idempotency_key
      ) VALUES (?, ?, ?, ?, 0, 1, DATETIME('now'), ?)`,
    ).run(
      "spin_idem_real_b",
      "cust_idem_real",
      "p_idem_real",
      "common",
      sharedKey,
    );
  } catch (error) {
    captured = error;
  }
  assert.ok(captured, "second INSERT with same idempotency_key must throw");
  assert.ok(
    String(captured.code || "").startsWith("SQLITE_CONSTRAINT"),
    `expected SQLITE_CONSTRAINT* code, got ${JSON.stringify(captured.code)} — message: ${captured.message}`,
  );
  assert.equal(
    isWheelIdempotencyConflict(captured, sharedKey),
    true,
    "real partial-index UNIQUE violation must be classified as an idempotency conflict",
  );
}

async function testRarityChanceSumOver100Rejected() {
  const { validateRarityRulePayload, updateRarityRule } = await import("../wheel/wheel-service.js");
  db.prepare(
    "UPDATE wheel_rarities SET chance_percent = 0 WHERE code NOT IN ('valuable', 'nothing')",
  ).run();

  const invalidNegative = validateRarityRulePayload("common", { chance_percent: -1 });
  assert.ok(
    invalidNegative.errors.includes("chance_percent_invalid"),
    "negative rarity chance must be rejected",
  );

  const invalidOver100Single = validateRarityRulePayload("common", { chance_percent: 101 });
  assert.ok(
    invalidOver100Single.errors.includes("chance_percent_invalid"),
    "single rarity chance above 100 must be rejected",
  );

  const invalidValuableChance = validateRarityRulePayload("valuable", { chance_percent: 1 });
  assert.ok(
    invalidValuableChance.errors.includes("valuable_chance_must_be_zero"),
    "valuable rarity chance is controlled by queue rules and must stay zero",
  );

  const invalidNothingChance = validateRarityRulePayload("nothing", { chance_percent: 1 });
  assert.ok(
    invalidNothingChance.errors.includes("nothing_chance_is_derived"),
    "nothing chance must be derived rather than manually saved",
  );

  updateRarityRule("common", { chance_percent: 80 });
  updateRarityRule("rare", { chance_percent: 20 });

  const result = validateRarityRulePayload("rare", { chance_percent: 30 });
  assert.ok(
    result.errors.includes("chance_sum_exceeds_100"),
    "normal rarity chances above 100% must be rejected",
  );

  const allowed = validateRarityRulePayload("rare", { chance_percent: 20 });
  assert.ok(
    !allowed.errors.includes("chance_sum_exceeds_100"),
    "chance sum exactly 100% must be allowed",
  );

  const exactZero = validateRarityRulePayload("common", { chance_percent: 0 });
  assert.deepEqual(exactZero.errors, [], "explicit zero chance must stay valid");

  const selfReplacement = validateRarityRulePayload("common", { chance_percent: 80 });
  assert.deepEqual(
    selfReplacement.errors,
    [],
    "validator must exclude the current rarity from the sibling total",
  );
}

async function testRarityValidatorRejectsAdversarialPoolPayloads() {
  const { validateRarityRulePayload } = await import("../wheel/wheel-service.js");

  for (const invalid of [0, -1, 1.5, "abc", null]) {
    const result = validateRarityRulePayload("valuable", { valuable_pool_size: invalid });
    assert.ok(
      result.errors.includes("valuable_pool_size_invalid"),
      `valuable_pool_size=${String(invalid)} must be rejected`,
    );
  }

  for (const invalid of [0, -1, "abc", Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = validateRarityRulePayload("valuable", { valuable_threshold_byn: invalid });
    assert.ok(
      result.errors.includes("valuable_threshold_byn_invalid"),
      `valuable_threshold_byn=${String(invalid)} must be rejected`,
    );
  }

  const fractionalThreshold = validateRarityRulePayload("valuable", { valuable_threshold_byn: 1.25 });
  assert.deepEqual(
    fractionalThreshold.errors,
    [],
    "fractional BYN threshold must remain allowed",
  );
}

async function testRarityRouteRejectsInvalidPayloadWithoutMutatingDb() {
  db.prepare("UPDATE wheel_rarities SET chance_percent = 25 WHERE code = 'common'").run();

  const before = db
    .prepare("SELECT chance_percent FROM wheel_rarities WHERE code = 'common'")
    .get();
  const { response, data } = await requestJson("/api/admin/crm/wheel/rarities/common", {
    method: "PUT",
    headers: {
      ...adminHeaders,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ chance_percent: 101 }),
  });
  assert.equal(response.status, 400);
  assert.equal(data?.error, "validation_failed");
  assert.ok(
    Array.isArray(data?.details) && data.details.includes("chance_percent_invalid"),
    "validation details must include chance_percent_invalid",
  );

  const after = db
    .prepare("SELECT chance_percent FROM wheel_rarities WHERE code = 'common'")
    .get();
  assert.equal(after.chance_percent, before.chance_percent, "invalid request must not mutate rarity");
}

async function testRarityRouteSavesExplicitZeroChance() {
  db.prepare("UPDATE wheel_rarities SET chance_percent = 25 WHERE code = 'common'").run();
  db.prepare("UPDATE wheel_rarities SET chance_percent = 0 WHERE code = 'rare'").run();
  db.prepare("UPDATE wheel_rarities SET chance_percent = 0 WHERE code = 'epic'").run();
  db.prepare("UPDATE wheel_rarities SET chance_percent = 0 WHERE code = 'legendary'").run();

  const { response, data } = await requestJson("/api/admin/crm/wheel/rarities/common", {
    method: "PUT",
    headers: {
      ...adminHeaders,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ chance_percent: 0 }),
  });
  assert.equal(response.status, 200);
  assert.equal(data?.chancePercent, 0, "route must persist an explicit zero chance");

  const row = db
    .prepare("SELECT chance_percent FROM wheel_rarities WHERE code = 'common'")
    .get();
  assert.equal(row.chance_percent, 0, "database must store zero chance");
}

async function testRarityRouteRejectsFractionalValuablePoolSize() {
  const before = db
    .prepare("SELECT valuable_pool_size FROM wheel_rarities WHERE code = 'valuable'")
    .get();
  const { response, data } = await requestJson("/api/admin/crm/wheel/rarities/valuable", {
    method: "PUT",
    headers: {
      ...adminHeaders,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ chance_percent: 0, valuable_pool_size: 1.5, valuable_threshold_byn: 300 }),
  });
  assert.equal(response.status, 400);
  assert.equal(data?.error, "validation_failed");
  assert.ok(
    Array.isArray(data?.details) && data.details.includes("valuable_pool_size_invalid"),
    "fractional queue size must surface the correct validation detail",
  );

  const after = db
    .prepare("SELECT valuable_pool_size FROM wheel_rarities WHERE code = 'valuable'")
    .get();
  assert.equal(
    after.valuable_pool_size,
    before.valuable_pool_size,
    "invalid valuable queue size must not mutate DB",
  );
}

async function testAdminAuditEndpointReturnsDecisionTrailWithoutPromoCode() {
  ensureCustomer("cust_audit_route", "777452", "wheel_audit_route", { consent: 1 });
  insertPrize("p_audit_route_nothing", "nothing", 1, 0);
  insertPrize("p_audit_route_common", "common", 1, 0);
  db.prepare(
    `INSERT OR REPLACE INTO wheel_customer_balances (
      customer_id, spins_available, accumulated_retail_byn,
      accumulated_wholesale_byn, consecutive_nothing, last_updated_at
    ) VALUES ('cust_audit_route', 1, 0, 0, 0, DATETIME('now'))`,
  ).run();

  const spin = await requestJson("/api/wheel/spin", {
    method: "POST",
    headers: telegramHeaders(
      { telegram_id: "777452", telegram_username: "wheel_audit_route" },
      { "Idempotency-Key": "test-audit-route-key-0001" },
    ),
    body: JSON.stringify({}),
  });
  assert.equal(spin.response.status, 200, JSON.stringify(spin.data));

  const audit = await requestJson("/api/admin/crm/wheel/audit?limit=5", {
    method: "GET",
    headers: adminHeaders,
  });
  assert.equal(audit.response.status, 200, JSON.stringify(audit.data));
  const row = audit.data.rows.find((item) => item.spin_id === spin.data.spin_id);
  assert.ok(row, "audit row should be available for the spin");
  assert.ok(Array.isArray(row.effective_chances), "audit row should expose effective chances");
  assert.ok(row.rng?.animation_seed !== undefined, "audit row should expose rng metadata");
  assert.equal(row.promo_code, undefined, "audit export must not expose generated promo code");
}

async function main() {
  await testWheelStateWorksWithRealLiveFeed();
  await testFeedUsesShortPrizeTitleNotCustomerDescription();
  await testForgedWholesaleHeadersDoNotUnlockWholesalePool();
  await testValidatedWholesaleHeadersUnlockWholesalePool();
  await testWheelAccessAllowlistLocksStateForOutsiders();
  await testWheelAccessAllowlistLetsTesterInAndBlocksSpinForOutsider();
  await testWheelAccessAllowlistBlocksConsentAndMyPrizesForOutsider();
  testWheelSeedDoesNotRestoreHardcodedAllowlistAfterRestart();
  testWheelSettingsEmptyAllowlistMeansOpenAccess();
  await testMyPrizesStatusFiltersExcludeNothingAndSplitLifecycle();
  await testWheelTemplateRejectedAtCheckout();
  await testWheelTemplateFlagClearedWhenPrizeChangesTemplate();
  await testPartialUpdateRejectsBothPoolsDisabled();
  await testUnusedPrizeCanBeDeletedFromAdmin();
  await testUsedPrizeDeleteFallsBackToDisableOnly();
  await testPrizeRequiresPromoTemplateUnlessNothing();
  await testFeedExcludesCustomersWithoutConsent();
  await testFeedConsentRequiredFlagFlips();
  await testSpinResponseUsesPromoTextAsPrizeText();
  await testSpinIsIdempotentByKey();
  await testSpinRejectsInvalidIdempotencyKeyWithoutSpending();
  await testParallelDifferentIdempotencyKeysDoNotOverspendOneSpin();
  await testSpinNoPrizesConfiguredDoesNotSpendSpin();
  await testIdempotencyConflictPredicateMatchesAllShapes();
  await testRealUniqueViolationOnIdempotencyKeyMatchesPredicate();
  await testRarityChanceSumOver100Rejected();
  await testRarityValidatorRejectsAdversarialPoolPayloads();
  await testRarityRouteRejectsInvalidPayloadWithoutMutatingDb();
  await testRarityRouteSavesExplicitZeroChance();
  await testRarityRouteRejectsFractionalValuablePoolSize();
  await testAdminAuditEndpointReturnsDecisionTrailWithoutPromoCode();
  console.log("[wheel-routes] OK");
}

try {
  await main();
} finally {
  updateWheelSettings({ wheel_access_usernames: DEFAULT_TEST_ALLOWLIST });
  await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
