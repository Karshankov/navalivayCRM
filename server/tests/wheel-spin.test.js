import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "navalivay-wheel-spin-"));
const tempDbPath = path.join(tempDir, "test.db");

process.env.DATABASE_FILE = tempDbPath;
process.env.BOT_TOKEN = "test-bot-token";
process.env.NODE_ENV = "test";

const { initDb, db } = await import("../db.js");
const {
  spinWheelForCustomer,
  getAdminDashboard,
  listAdminSpinAudit,
  listAdminSpins,
  getWheelSettings,
  updateRarityRule,
  updateWheelSettings,
} = await import("../wheel/wheel-service.js");

initDb();

function makeRng(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function makeSequenceRng(values) {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    return value;
  };
}

function ensureCustomer(id, telegramId = id) {
  db.prepare(
    `INSERT OR IGNORE INTO customers (id, telegram_id, telegram_username, first_name, last_name, last_visit_at)
     VALUES (?, ?, ?, 'Test', 'User', DATETIME('now'))`,
  ).run(id, telegramId, `wheel_${id}`);
}

function setBalance(customerId, spins, consecutiveNothing = 0) {
  db.prepare(
    `INSERT INTO wheel_customer_balances (
      customer_id, spins_available, accumulated_retail_byn,
      accumulated_wholesale_byn, consecutive_nothing, last_updated_at
    ) VALUES (?, ?, 0, 0, ?, DATETIME('now'))
    ON CONFLICT(customer_id) DO UPDATE SET
      spins_available = excluded.spins_available,
      consecutive_nothing = excluded.consecutive_nothing`,
  ).run(customerId, spins, consecutiveNothing);
}

function clearWheelData() {
  db.exec(`
    DELETE FROM wheel_spins;
    DELETE FROM wheel_epic_pools;
    DELETE FROM wheel_rarity_pools;
    DELETE FROM wheel_prizes;
    DELETE FROM wheel_customer_balances;
    DELETE FROM promo_codes;
  `);
}

function insertPromoTemplate(id, code, { durationDays = null, maxUses = 0 } = {}) {
  db.prepare(
    `INSERT INTO promo_codes (
      id, code, description, discount_type, discount_value, min_order_amount,
      max_uses, current_uses, active, has_gift, duration_days, is_wheel_template, created_at
    ) VALUES (?, ?, ?, 'fixed', 10, 0, ?, 0, 1, 0, ?, 1, DATETIME('now'))`,
  ).run(id, code, code, maxUses, durationDays);
}

function insertPrize(prize) {
  const templateId =
    prize.rarity_code === "nothing"
      ? null
      : (prize.promo_template_id || `promo_${prize.id}`);
  if (templateId) {
    insertPromoTemplate(templateId, `CODE_${String(prize.id).toUpperCase()}`, {
      durationDays: prize.template_duration_days ?? null,
      maxUses: prize.template_max_uses ?? 0,
    });
  }
  db.prepare(
    `INSERT INTO wheel_prizes (
      id, rarity_code, title, description, weight, max_total, issued_count,
      is_for_retail, is_for_wholesale, promo_template_id, promo_validity_days, epic_pool_size,
      epic_pool_threshold_byn, is_active, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 5, 300, 1, ?)`,
  ).run(
    prize.id,
    prize.rarity_code,
    prize.title,
    prize.description || null,
    prize.weight,
    prize.max_total ?? 0,
    prize.is_for_retail ?? 1,
    prize.is_for_wholesale ?? 0,
    templateId,
    prize.promo_validity_days ?? 90,
    prize.sort_order ?? 0,
  );
}

function seedBasicPool() {
  clearWheelData();
  insertPrize({ id: "p_nothing", rarity_code: "nothing", title: "Ничего", weight: 60, sort_order: 0 });
  insertPrize({ id: "p_common", rarity_code: "common", title: "Обычный", weight: 25, sort_order: 1 });
  insertPrize({ id: "p_rare", rarity_code: "rare", title: "Редкий", weight: 10, sort_order: 2 });
  insertPrize({ id: "p_epic", rarity_code: "epic", title: "Эпический", weight: 4, sort_order: 3 });
  insertPrize({ id: "p_legendary", rarity_code: "legendary", title: "Легендарный", weight: 1, sort_order: 4 });
  updateRarityRule("common", { chance_percent: 25 });
  updateRarityRule("rare", { chance_percent: 10 });
  updateRarityRule("epic", { chance_percent: 4 });
  updateRarityRule("legendary", { chance_percent: 1 });
  updateRarityRule("valuable", { valuable_pool_size: 5, valuable_threshold_byn: 300 });
}

async function testWeightedDistribution() {
  seedBasicPool();
  // Disable pity for pure distribution measurement.
  updateWheelSettings({ pity_threshold: 999999 });
  const customerId = "cust-spin-stat";
  ensureCustomer(customerId);
  setBalance(customerId, 10000);

  const rng = makeRng(42);
  const counts = {};
  for (let i = 0; i < 10000; i += 1) {
    const result = spinWheelForCustomer({ customerId, rng, auditEnabled: false });
    counts[result.prize.rarity_code] = (counts[result.prize.rarity_code] || 0) + 1;
  }

  // Restore default pity for subsequent tests.
  updateWheelSettings({ pity_threshold: 3 });

  // Total weight = 100. Allow up to 5% absolute variance.
  const expectedShares = {
    nothing: 0.6,
    common: 0.25,
    rare: 0.1,
    epic: 0.04,
    legendary: 0.01,
  };
  for (const [code, expected] of Object.entries(expectedShares)) {
    const actual = (counts[code] || 0) / 10000;
    assert.ok(
      Math.abs(actual - expected) < 0.05,
      `rarity ${code} share ${actual.toFixed(3)} too far from expected ${expected}`,
    );
  }
}

async function testBestPracticeSingleAvailableCommonDistribution() {
  clearWheelData();
  insertPrize({ id: "p_nothing_best_practice", rarity_code: "nothing", title: "Ничего", weight: 1, sort_order: 0 });
  insertPrize({ id: "p_common_best_practice", rarity_code: "common", title: "Обычный", weight: 1, sort_order: 1 });
  updateRarityRule("common", { chance_percent: 25 });
  updateRarityRule("rare", { chance_percent: 0 });
  updateRarityRule("mythic", { chance_percent: 0 });
  updateRarityRule("legendary", { chance_percent: 0 });
  updateRarityRule("epic", { chance_percent: 0 });
  updateRarityRule("valuable", { valuable_pool_size: 5, valuable_threshold_byn: 300 });
  updateWheelSettings({ pity_threshold: 999999 });

  const customerId = "cust-spin-best-practice";
  ensureCustomer(customerId);
  setBalance(customerId, 10000);

  const rng = makeRng(77);
  const counts = {};
  for (let i = 0; i < 10000; i += 1) {
    const result = spinWheelForCustomer({ customerId, rng, auditEnabled: false });
    counts[result.prize.rarity_code] = (counts[result.prize.rarity_code] || 0) + 1;
  }
  updateWheelSettings({ pity_threshold: 3 });

  const commonShare = (counts.common || 0) / 10000;
  const nothingShare = (counts.nothing || 0) / 10000;
  assert.ok(
    Math.abs(commonShare - 0.25) < 0.05,
    `single available common should stay near 25%, got ${commonShare.toFixed(3)}`,
  );
  assert.ok(
    Math.abs(nothingShare - 0.75) < 0.05,
    `derived nothing should stay near 75%, got ${nothingShare.toFixed(3)}`,
  );
}

async function testProductionBaselineDistribution() {
  clearWheelData();
  insertPrize({ id: "p_nothing_prod", rarity_code: "nothing", title: "Ничего", weight: 1, sort_order: 0 });
  insertPrize({ id: "p_common_prod", rarity_code: "common", title: "Обычный", weight: 1, sort_order: 1 });
  insertPrize({ id: "p_rare_prod", rarity_code: "rare", title: "Редкий", weight: 1, sort_order: 2 });
  insertPrize({ id: "p_mythic_prod", rarity_code: "mythic", title: "Мифический", weight: 1, sort_order: 3 });
  insertPrize({ id: "p_legendary_prod", rarity_code: "legendary", title: "Легендарный", weight: 1, sort_order: 4 });
  insertPrize({ id: "p_epic_prod", rarity_code: "epic", title: "Эпический", weight: 1, sort_order: 5 });
  updateRarityRule("common", { chance_percent: 30 });
  updateRarityRule("rare", { chance_percent: 12 });
  updateRarityRule("mythic", { chance_percent: 8 });
  updateRarityRule("legendary", { chance_percent: 6 });
  updateRarityRule("epic", { chance_percent: 4 });
  updateRarityRule("valuable", { valuable_pool_size: 5, valuable_threshold_byn: 300 });
  updateWheelSettings({ pity_threshold: 999999 });

  const customerId = "cust-spin-prod-baseline";
  ensureCustomer(customerId);
  setBalance(customerId, 10000);

  const rng = makeRng(123);
  const counts = {};
  for (let i = 0; i < 10000; i += 1) {
    const result = spinWheelForCustomer({ customerId, rng, auditEnabled: false });
    counts[result.prize.rarity_code] = (counts[result.prize.rarity_code] || 0) + 1;
  }
  updateWheelSettings({ pity_threshold: 3 });

  const expectedShares = {
    nothing: 0.4,
    common: 0.3,
    rare: 0.12,
    mythic: 0.08,
    legendary: 0.06,
    epic: 0.04,
  };
  for (const [code, expected] of Object.entries(expectedShares)) {
    const actual = (counts[code] || 0) / 10000;
    assert.ok(
      Math.abs(actual - expected) < 0.05,
      `production baseline rarity ${code} share ${actual.toFixed(3)} too far from expected ${expected}`,
    );
  }
}

async function testPityTriggersAfterThresholdNothings() {
  seedBasicPool();
  updateRarityRule("common", { chance_percent: 0 });
  updateRarityRule("rare", { chance_percent: 0 });
  updateRarityRule("epic", { chance_percent: 0 });
  updateRarityRule("legendary", { chance_percent: 0 });
  // Pump nothing to dominate
  db.prepare("UPDATE wheel_prizes SET weight = 0 WHERE id != 'p_nothing'").run();

  const customerId = "cust-spin-pity";
  ensureCustomer(customerId);
  setBalance(customerId, 5);

  const rng = makeRng(1);
  const settings = getWheelSettings();
  // Spin pity_threshold times: all nothing.
  for (let i = 0; i < settings.pity_threshold; i += 1) {
    const result = spinWheelForCustomer({ customerId, rng, auditEnabled: false });
    assert.equal(result.prize.rarity_code, "nothing");
  }

  // Re-enable common so pity has something to pick.
  db.prepare("UPDATE wheel_prizes SET weight = 1 WHERE id = 'p_common'").run();

  const result = spinWheelForCustomer({ customerId, rng, auditEnabled: false });
  assert.equal(result.isPityRelease, true);
  assert.notEqual(result.prize.rarity_code, "nothing");
}

async function testPityReassignsNothingChanceToCommon() {
  clearWheelData();
  insertPrize({ id: "p_nothing_pity_weighted", rarity_code: "nothing", title: "Ничего", weight: 1, sort_order: 0 });
  insertPrize({ id: "p_common_pity_weighted", rarity_code: "common", title: "Обычный", weight: 1, sort_order: 1 });
  insertPrize({ id: "p_rare_pity_weighted", rarity_code: "rare", title: "Редкий", weight: 1, sort_order: 2 });
  insertPrize({ id: "p_mythic_pity_weighted", rarity_code: "mythic", title: "Мифический", weight: 1, sort_order: 3 });
  insertPrize({ id: "p_legendary_pity_weighted", rarity_code: "legendary", title: "Легендарный", weight: 1, sort_order: 4 });
  insertPrize({ id: "p_epic_pity_weighted", rarity_code: "epic", title: "Эпический", weight: 1, sort_order: 5 });
  updateRarityRule("common", { chance_percent: 30 });
  updateRarityRule("rare", { chance_percent: 12 });
  updateRarityRule("mythic", { chance_percent: 8 });
  updateRarityRule("legendary", { chance_percent: 6 });
  updateRarityRule("epic", { chance_percent: 4 });

  const customerId = "cust-pity-weighted";
  ensureCustomer(customerId);
  const rng = makeRng(123);
  const counts = {};
  const settings = getWheelSettings();
  for (let i = 0; i < 10000; i += 1) {
    setBalance(customerId, 1, settings.pity_threshold);
    const result = spinWheelForCustomer({ customerId, rng, auditEnabled: false });
    counts[result.prize.rarity_code] = (counts[result.prize.rarity_code] || 0) + 1;
  }

  const expectedShares = {
    common: 0.7,
    rare: 0.12,
    mythic: 0.08,
    legendary: 0.06,
    epic: 0.04,
  };
  for (const [code, expected] of Object.entries(expectedShares)) {
    const actual = (counts[code] || 0) / 10000;
    assert.ok(
      Math.abs(actual - expected) < 0.05,
      `pity rarity ${code} share ${actual.toFixed(3)} too far from expected ${expected}`,
    );
  }
  assert.equal(counts.nothing || 0, 0, "pity must never drop nothing");
}

async function testPityReassignsNothingChanceToFirstAvailableWhenCommonUnavailable() {
  clearWheelData();
  insertPrize({ id: "p_nothing_pity_fallback", rarity_code: "nothing", title: "Ничего", weight: 1, sort_order: 0 });
  insertPrize({ id: "p_common_pity_unavailable", rarity_code: "common", title: "Обычный недоступен", weight: 1, sort_order: 1 });
  insertPrize({ id: "p_rare_pity_fallback", rarity_code: "rare", title: "Редкий fallback", weight: 1, sort_order: 2 });
  db.prepare("UPDATE promo_codes SET active = 0 WHERE id = 'promo_p_common_pity_unavailable'").run();
  updateRarityRule("common", { chance_percent: 30 });
  updateRarityRule("rare", { chance_percent: 0 });
  updateRarityRule("mythic", { chance_percent: 0 });
  updateRarityRule("legendary", { chance_percent: 0 });
  updateRarityRule("epic", { chance_percent: 0 });

  const customerId = "cust-pity-common-unavailable";
  ensureCustomer(customerId);
  setBalance(customerId, 1, getWheelSettings().pity_threshold);
  const result = spinWheelForCustomer({
    customerId,
    rng: makeSequenceRng([0.99, 0, 0]),
  });

  assert.equal(result.isPityRelease, true);
  assert.equal(result.prize.id, "p_rare_pity_fallback");

  const audit = listAdminSpinAudit({ limit: 1 });
  assert.equal(audit.rows[0].decision_type, "pity_release");
  assert.ok(
    audit.rows[0].effective_chances.some(
      (entry) =>
        entry.rarity_code === "rare" &&
        entry.chance_percent === 100 &&
        entry.reason === "nothing_chance_reassigned_to_first_available",
    ),
    "pity audit must show reassigned nothing chance to first available normal rarity",
  );
}

async function testPityDoesNotUseValuableWhenNormalPrizeExists() {
  clearWheelData();
  insertPrize({ id: "p_nothing_pity_no_valuable", rarity_code: "nothing", title: "Ничего", weight: 1, sort_order: 0 });
  insertPrize({ id: "p_common_pity_no_valuable", rarity_code: "common", title: "Обычный", weight: 1, sort_order: 1 });
  insertPrize({ id: "p_valuable_pity_no_valuable", rarity_code: "valuable", title: "Ценный", weight: 1, sort_order: 2 });
  updateRarityRule("common", { chance_percent: 0 });
  updateRarityRule("rare", { chance_percent: 0 });
  updateRarityRule("mythic", { chance_percent: 0 });
  updateRarityRule("legendary", { chance_percent: 0 });
  updateRarityRule("epic", { chance_percent: 0 });

  const customerId = "cust-pity-no-valuable";
  ensureCustomer(customerId);
  setBalance(customerId, 1, getWheelSettings().pity_threshold);
  const result = spinWheelForCustomer({
    customerId,
    rng: makeSequenceRng([0.99, 0, 0]),
  });

  assert.equal(result.isPityRelease, true);
  assert.equal(result.prize.id, "p_common_pity_no_valuable");
  assert.notEqual(result.prize.rarity_code, "valuable");
}

async function testPromoTemplateLimitStopsPrize() {
  seedBasicPool();
  // The total winner cap now lives on the promo template. The legacy
  // wheel_prizes.max_total column must not be the manager-facing source.
  db.prepare("UPDATE promo_codes SET max_uses = 1 WHERE id = 'promo_p_legendary'").run();
  db.prepare("UPDATE wheel_prizes SET max_total = 0, weight = 100 WHERE id = 'p_legendary'").run();
  db.prepare("UPDATE wheel_prizes SET weight = 0 WHERE id != 'p_legendary'").run();
  updateRarityRule("common", { chance_percent: 0 });
  updateRarityRule("rare", { chance_percent: 0 });
  updateRarityRule("epic", { chance_percent: 0 });
  updateRarityRule("legendary", { chance_percent: 100 });

  const customerId = "cust-spin-cap";
  ensureCustomer(customerId);
  setBalance(customerId, 3);

  const rng = makeRng(7);
  const first = spinWheelForCustomer({ customerId, rng, auditEnabled: false });
  assert.equal(first.prize.rarity_code, "legendary");

  const issued = db.prepare("SELECT issued_count FROM wheel_prizes WHERE id = 'p_legendary'").get();
  assert.equal(issued.issued_count, 1);
  const active = db.prepare("SELECT is_active FROM wheel_prizes WHERE id = 'p_legendary'").get();
  assert.equal(active.is_active, 0, "promo template max_uses should deactivate exhausted prize");

  // Re-enable common as fallback so engine has any non-zero option.
  db.prepare("UPDATE wheel_prizes SET weight = 1 WHERE id = 'p_common'").run();
  updateRarityRule("common", { chance_percent: 100 });
  updateRarityRule("legendary", { chance_percent: 0 });

  const second = spinWheelForCustomer({ customerId, rng, auditEnabled: false });
  assert.notEqual(second.prize.rarity_code, "legendary");
}

async function testLegacyPrizeLimitDoesNotExhaustWhenTemplateIsUnlimited() {
  clearWheelData();
  insertPrize({ id: "p_legacy_limit_ignored", rarity_code: "common", title: "Legacy ignored", weight: 1, max_total: 1, template_max_uses: 0 });
  updateRarityRule("common", { chance_percent: 100 });
  updateRarityRule("rare", { chance_percent: 0 });
  updateRarityRule("mythic", { chance_percent: 0 });
  updateRarityRule("legendary", { chance_percent: 0 });
  updateRarityRule("epic", { chance_percent: 0 });

  const customerId = "cust-legacy-limit-ignored";
  ensureCustomer(customerId);
  setBalance(customerId, 2);

  const rng = makeSequenceRng([0, 0, 0]);
  const first = spinWheelForCustomer({ customerId, rng, auditEnabled: false });
  const second = spinWheelForCustomer({ customerId, rng, auditEnabled: false });

  assert.equal(first.prize.id, "p_legacy_limit_ignored");
  assert.equal(second.prize.id, "p_legacy_limit_ignored");
  const prize = db.prepare("SELECT issued_count, is_active FROM wheel_prizes WHERE id = 'p_legacy_limit_ignored'").get();
  assert.equal(prize.issued_count, 2);
  assert.equal(prize.is_active, 1, "legacy max_total must not exhaust an unlimited promo template");
}

async function testPrizeSelectionWithinRarityIgnoresPrizeWeights() {
  clearWheelData();
  insertPrize({ id: "p_common_heavy", rarity_code: "common", title: "Heavy", weight: 999 });
  insertPrize({ id: "p_common_light", rarity_code: "common", title: "Light", weight: 1 });
  updateRarityRule("common", { chance_percent: 100 });
  updateRarityRule("rare", { chance_percent: 0 });
  updateRarityRule("epic", { chance_percent: 0 });
  updateRarityRule("legendary", { chance_percent: 0 });

  const customerId = "cust-spin-equal";
  ensureCustomer(customerId);
  setBalance(customerId, 1000);
  updateWheelSettings({ pity_threshold: 999999 });

  const rng = makeRng(11);
  const counts = {};
  for (let i = 0; i < 1000; i += 1) {
    const result = spinWheelForCustomer({ customerId, rng, auditEnabled: false });
    counts[result.prize.id] = (counts[result.prize.id] || 0) + 1;
  }
  updateWheelSettings({ pity_threshold: 3 });

  const heavyShare = (counts.p_common_heavy || 0) / 1000;
  assert.ok(
    heavyShare > 0.4 && heavyShare < 0.6,
    `prizes inside one rarity must be near-uniform, got heavy share ${heavyShare}`,
  );
}

async function testRaritySelectionUsesConfiguredChancePercentNotPrizeWeights() {
  clearWheelData();
  insertPrize({ id: "p_common_heavy_chance", rarity_code: "common", title: "Heavy common", weight: 999 });
  insertPrize({ id: "p_rare_light_chance", rarity_code: "rare", title: "Light rare", weight: 1 });
  updateRarityRule("common", { chance_percent: 70 });
  updateRarityRule("rare", { chance_percent: 30 });
  updateRarityRule("epic", { chance_percent: 0 });
  updateRarityRule("legendary", { chance_percent: 0 });
  updateWheelSettings({ pity_threshold: 999999 });

  const customerId = "cust-spin-rarity-chance";
  ensureCustomer(customerId);
  setBalance(customerId, 1);

  const result = spinWheelForCustomer({
    customerId,
    rng: makeSequenceRng([0.8, 0, 0]),
  });
  updateWheelSettings({ pity_threshold: 3 });

  assert.equal(
    result.prize.id,
    "p_rare_light_chance",
    "rarity chance must drive the drop even when another rarity has much heavier prizes",
  );
}

async function testRarityChanceBoundariesDoNotSkipFirstOrLastRarity() {
  clearWheelData();
  insertPrize({ id: "p_common_boundary", rarity_code: "common", title: "Common boundary", weight: 1 });
  insertPrize({ id: "p_rare_boundary", rarity_code: "rare", title: "Rare boundary", weight: 1 });
  updateRarityRule("common", { chance_percent: 50 });
  updateRarityRule("rare", { chance_percent: 50 });
  updateRarityRule("epic", { chance_percent: 0 });
  updateRarityRule("legendary", { chance_percent: 0 });
  updateWheelSettings({ pity_threshold: 999999 });

  ensureCustomer("cust-spin-boundary-first");
  setBalance("cust-spin-boundary-first", 1);
  const first = spinWheelForCustomer({
    customerId: "cust-spin-boundary-first",
    rng: makeSequenceRng([0, 0, 0]),
  });
  assert.equal(first.prize.id, "p_common_boundary");

  ensureCustomer("cust-spin-boundary-last");
  setBalance("cust-spin-boundary-last", 1);
  const last = spinWheelForCustomer({
    customerId: "cust-spin-boundary-last",
    rng: makeSequenceRng([0.999999, 0, 0]),
  });
  updateWheelSettings({ pity_threshold: 3 });
  assert.equal(last.prize.id, "p_rare_boundary");
}

async function testUnavailableRarityFallsBackToNothingWithoutError() {
  clearWheelData();
  insertPrize({ id: "p_nothing_fallback", rarity_code: "nothing", title: "Ничего", weight: 1 });
  insertPrize({ id: "p_common_inactive_promo", rarity_code: "common", title: "Inactive promo", weight: 1 });
  db.prepare("UPDATE promo_codes SET active = 0 WHERE id = 'promo_p_common_inactive_promo'").run();
  updateRarityRule("common", { chance_percent: 100 });
  updateRarityRule("rare", { chance_percent: 0 });
  updateRarityRule("epic", { chance_percent: 0 });
  updateRarityRule("legendary", { chance_percent: 0 });

  const customerId = "cust-spin-unavailable-rarity";
  ensureCustomer(customerId);
  setBalance(customerId, 1);

  const result = spinWheelForCustomer({ customerId, rng: makeRng(17) });
  assert.equal(result.prize.rarity_code, "nothing");
}

async function testUnavailableNormalRaritiesBecomeNothingChance() {
  clearWheelData();
  insertPrize({ id: "p_nothing_all_unavailable", rarity_code: "nothing", title: "Ничего", weight: 1 });
  insertPrize({ id: "p_common_owned_template", rarity_code: "common", title: "Owned template", weight: 1 });
  insertPrize({ id: "p_rare_exhausted", rarity_code: "rare", title: "Exhausted rare", weight: 1, template_max_uses: 1 });
  db.prepare("UPDATE promo_codes SET wheel_owner_customer_id = 'someone_else' WHERE id = 'promo_p_common_owned_template'").run();
  db.prepare("UPDATE wheel_prizes SET issued_count = 1 WHERE id = 'p_rare_exhausted'").run();
  updateRarityRule("common", { chance_percent: 60 });
  updateRarityRule("rare", { chance_percent: 40 });
  updateRarityRule("epic", { chance_percent: 0 });
  updateRarityRule("legendary", { chance_percent: 0 });

  const customerId = "cust-spin-unavailable-to-nothing";
  ensureCustomer(customerId);
  setBalance(customerId, 1);

  const result = spinWheelForCustomer({
    customerId,
    rng: makeSequenceRng([0.2, 0, 0]),
  });
  assert.equal(result.prize.rarity_code, "nothing");
  assert.equal(result.prize.id, null);
  assert.equal(result.prize.title, "Без выигрыша");
}

async function testUnavailablePrizeInAvailableRarityNeverDrops() {
  clearWheelData();
  insertPrize({ id: "p_common_available", rarity_code: "common", title: "Available", weight: 1 });
  insertPrize({ id: "p_common_exhausted", rarity_code: "common", title: "Exhausted", weight: 1, template_max_uses: 1 });
  db.prepare("UPDATE wheel_prizes SET issued_count = 1 WHERE id = 'p_common_exhausted'").run();
  updateRarityRule("common", { chance_percent: 100 });
  updateRarityRule("rare", { chance_percent: 0 });
  updateRarityRule("epic", { chance_percent: 0 });
  updateRarityRule("legendary", { chance_percent: 0 });

  const customerId = "cust-spin-unavailable-prize";
  ensureCustomer(customerId);
  setBalance(customerId, 100);

  const rng = makeRng(23);
  for (let i = 0; i < 100; i += 1) {
    const result = spinWheelForCustomer({ customerId, rng, auditEnabled: false });
    assert.equal(result.prize.id, "p_common_available");
  }
}

async function testNoDropAvailableFallsBackToNothing() {
  clearWheelData();
  insertPrize({ id: "p_common_zero_chance", rarity_code: "common", title: "Zero chance", weight: 1 });
  updateRarityRule("common", { chance_percent: 0 });
  updateRarityRule("rare", { chance_percent: 0 });
  updateRarityRule("epic", { chance_percent: 0 });
  updateRarityRule("legendary", { chance_percent: 0 });

  const customerId = "cust-spin-no-drop-no-spend";
  ensureCustomer(customerId);
  setBalance(customerId, 1);

  const result = spinWheelForCustomer({ customerId, rng: makeSequenceRng([0, 0, 0]) });
  assert.equal(result.prize.rarity_code, "nothing");
  assert.equal(result.prize.id, null);
  assert.equal(result.prize.title, "Без выигрыша");
  const balance = db
    .prepare("SELECT spins_available FROM wheel_customer_balances WHERE customer_id = ?")
    .get(customerId);
  const spinCount = db
    .prepare("SELECT COUNT(*) AS count FROM wheel_spins WHERE customer_id = ?")
    .get(customerId);
  assert.equal(balance.spins_available, 0, "nothing spin spends one balance");
  assert.equal(spinCount.count, 1, "nothing spin must write wheel_spins row");
}

async function testDashboardTotalsMatchRecordedSpins() {
  clearWheelData();
  insertPrize({ id: "p_nothing_dashboard", rarity_code: "nothing", title: "Ничего", weight: 1 });
  insertPrize({ id: "p_common_dashboard", rarity_code: "common", title: "Обычный", weight: 1 });
  updateRarityRule("common", { chance_percent: 100 });
  updateRarityRule("rare", { chance_percent: 0 });
  updateRarityRule("epic", { chance_percent: 0 });
  updateRarityRule("legendary", { chance_percent: 0 });

  ensureCustomer("cust-dashboard-common");
  setBalance("cust-dashboard-common", 1);
  spinWheelForCustomer({ customerId: "cust-dashboard-common", rng: makeRng(31) });

  db.prepare(
    `INSERT INTO wheel_spins (
      id, customer_id, prize_id, rarity_code, is_wholesale,
      is_epic_release, is_pity_release, seed_for_animation, spun_at
    ) VALUES ('spin_dashboard_nothing', 'cust-dashboard-common', 'p_nothing_dashboard', 'nothing', 0, 0, 1, 1, DATETIME('now'))`,
  ).run();

  const dashboard = getAdminDashboard();
  assert.equal(dashboard.totals.total_spins, 2);
  assert.equal(dashboard.totals.nothing_spins, 1);
  assert.equal(dashboard.totals.pity_releases, 1);
  assert.equal(
    dashboard.rarity_breakdown.reduce((sum, row) => sum + Number(row.count || 0), 0),
    dashboard.totals.total_spins,
  );
}

async function testAdminSpinHistoryHidesNothingPseudoPrize() {
  clearWheelData();
  insertPrize({ id: "p_nothing_history", rarity_code: "nothing", title: "Вейпшоп", weight: 1 });
  const customerId = "cust-history-nothing";
  ensureCustomer(customerId, "777777");
  db.prepare("UPDATE customers SET first_name = 'Дмитрий', telegram_username = 'dmitriy_mityuk' WHERE id = ?")
    .run(customerId);
  db.prepare(
    `INSERT INTO wheel_spins (
      id, customer_id, prize_id, rarity_code, is_wholesale,
      generated_promo_code, is_epic_release, is_pity_release,
      seed_for_animation, spun_at
    ) VALUES ('spin_history_nothing', ?, 'p_nothing_history', 'nothing', 0, 'WHEEL-BAD', 0, 0, 1, DATETIME('now'))`,
  ).run(customerId);

  const history = listAdminSpins({ limit: 10 });
  const row = history.rows.find((item) => item.id === "spin_history_nothing");
  assert.ok(row);
  assert.equal(row.prize_title, "Без выигрыша");
  assert.equal(row.generated_promo_code, null);
}

async function testNotEnoughSpins() {
  seedBasicPool();
  const customerId = "cust-spin-zero";
  ensureCustomer(customerId);
  setBalance(customerId, 0);
  assert.throws(() => spinWheelForCustomer({ customerId }), {
    code: "not_enough_spins",
  });
}

async function testSpinAuditCapturesEffectiveChanceAndRng() {
  clearWheelData();
  insertPrize({ id: "p_audit_nothing", rarity_code: "nothing", title: "Ничего", weight: 1 });
  insertPrize({ id: "p_audit_common", rarity_code: "common", title: "Обычный", weight: 1 });
  insertPrize({ id: "p_audit_mythic", rarity_code: "mythic", title: "Мифический", weight: 1 });
  updateRarityRule("common", { chance_percent: 20 });
  updateRarityRule("rare", { chance_percent: 0 });
  updateRarityRule("mythic", { chance_percent: 8 });
  updateRarityRule("legendary", { chance_percent: 0 });
  updateRarityRule("epic", { chance_percent: 0 });
  updateWheelSettings({ pity_threshold: 999999 });

  const customerId = "cust-spin-audit";
  ensureCustomer(customerId);
  setBalance(customerId, 1);

  const result = spinWheelForCustomer({
    customerId,
    rng: makeSequenceRng([0.25, 0.1, 0.5]),
  });
  assert.equal(result.prize.rarity_code, "mythic");

  const audit = listAdminSpinAudit({ limit: 1 });
  assert.equal(audit.total, 1);
  const row = audit.rows[0];
  assert.equal(row.spin_id, result.spinId);
  assert.equal(row.decision_type, "rarity_roll");
  assert.equal(row.selected_rarity_code, "mythic");
  assert.equal(row.rng.rarity_roll.roll, 0.25);
  assert.equal(row.rng.rarity_roll.selected_bucket.rarity_code, "mythic");
  assert.ok(
    row.effective_chances.some((entry) => entry.rarity_code === "nothing" && entry.chance_percent === 72),
    "audit should record derived nothing chance after active rarity filters",
  );
  assert.ok(
    row.availability.some((entry) => entry.rarity_code === "mythic" && entry.is_available),
    "audit should record mythic availability at spin time",
  );
  updateWheelSettings({ pity_threshold: 3 });
}

async function testGeneratedPromoUsesTemplateDurationInsteadOfPrizeLegacyDuration() {
  clearWheelData();
  insertPrize({ id: "p_template_duration", rarity_code: "common", title: "Template duration", weight: 1, template_duration_days: 14, promo_validity_days: 90 });
  updateRarityRule("common", { chance_percent: 100 });
  updateRarityRule("rare", { chance_percent: 0 });
  updateRarityRule("mythic", { chance_percent: 0 });
  updateRarityRule("legendary", { chance_percent: 0 });
  updateRarityRule("epic", { chance_percent: 0 });

  const customerId = "cust-template-duration";
  ensureCustomer(customerId);
  setBalance(customerId, 1);

  const result = spinWheelForCustomer({
    customerId,
    rng: makeSequenceRng([0, 0, 0]),
    auditEnabled: false,
  });
  const promo = db
    .prepare("SELECT duration_days, valid_from_date, valid_until, max_uses FROM promo_codes WHERE id = ?")
    .get(result.promo.promoId);

  assert.equal(promo.duration_days, 14, "generated wheel promo must inherit template duration");
  assert.equal(promo.max_uses, 1, "winner promo stays one-time even if prize/template limits differ");
  const expectedUntilDate = new Date(`${promo.valid_from_date}T00:00:00Z`);
  expectedUntilDate.setUTCDate(expectedUntilDate.getUTCDate() + 13);
  assert.ok(
    String(promo.valid_until).startsWith(expectedUntilDate.toISOString().slice(0, 10)),
    "valid_until must be computed from template duration, not deprecated prize duration",
  );
}

async function testGeneratedWheelPromosAreUniqueAndOwnerBound() {
  clearWheelData();
  insertPrize({
    id: "p_unique_owner_bound",
    rarity_code: "common",
    title: "Unique owner bound",
    weight: 1,
    template_max_uses: 0,
  });
  updateRarityRule("common", { chance_percent: 100 });
  updateRarityRule("rare", { chance_percent: 0 });
  updateRarityRule("mythic", { chance_percent: 0 });
  updateRarityRule("legendary", { chance_percent: 0 });
  updateRarityRule("epic", { chance_percent: 0 });

  const firstCustomerId = "cust-unique-promo-first";
  const secondCustomerId = "cust-unique-promo-second";
  ensureCustomer(firstCustomerId);
  ensureCustomer(secondCustomerId);
  setBalance(firstCustomerId, 1);
  setBalance(secondCustomerId, 1);

  const firstResult = spinWheelForCustomer({
    customerId: firstCustomerId,
    rng: makeSequenceRng([0, 0, 0]),
    auditEnabled: false,
  });
  const secondResult = spinWheelForCustomer({
    customerId: secondCustomerId,
    rng: makeSequenceRng([0, 0, 0]),
    auditEnabled: false,
  });

  assert.ok(firstResult.promo?.promoId);
  assert.ok(secondResult.promo?.promoId);
  assert.notEqual(firstResult.promo.code, secondResult.promo.code);

  const generatedPromos = db
    .prepare(
      `SELECT id, code, max_uses, is_wheel_template, wheel_owner_customer_id
       FROM promo_codes
       WHERE id IN (?, ?)
       ORDER BY id`,
    )
    .all(firstResult.promo.promoId, secondResult.promo.promoId);

  assert.equal(generatedPromos.length, 2);
  for (const promo of generatedPromos) {
    assert.equal(promo.max_uses, 1, "generated wheel promo must be single-use");
    assert.equal(promo.is_wheel_template, 0, "generated wheel promo must not be treated as template");
  }
  assert.ok(generatedPromos.some((promo) => promo.wheel_owner_customer_id === firstCustomerId));
  assert.ok(generatedPromos.some((promo) => promo.wheel_owner_customer_id === secondCustomerId));
}

async function testGeneratedPromoFallsBackWhenTemplateDurationIsMissing() {
  clearWheelData();
  updateWheelSettings({ default_promo_validity_days: 21 });
  insertPrize({ id: "p_missing_template_duration", rarity_code: "common", title: "Missing template duration", weight: 1, promo_validity_days: 0 });
  updateRarityRule("common", { chance_percent: 100 });
  updateRarityRule("rare", { chance_percent: 0 });
  updateRarityRule("mythic", { chance_percent: 0 });
  updateRarityRule("legendary", { chance_percent: 0 });
  updateRarityRule("epic", { chance_percent: 0 });

  const customerId = "cust-template-duration-fallback";
  ensureCustomer(customerId);
  setBalance(customerId, 1);

  const result = spinWheelForCustomer({
    customerId,
    rng: makeSequenceRng([0, 0, 0]),
    auditEnabled: false,
  });
  const promo = db
    .prepare("SELECT duration_days, valid_from_date, valid_until FROM promo_codes WHERE id = ?")
    .get(result.promo.promoId);

  assert.equal(promo.duration_days, 21, "missing template and legacy prize duration should use wheel default");
  const expectedUntilDate = new Date(`${promo.valid_from_date}T00:00:00Z`);
  expectedUntilDate.setUTCDate(expectedUntilDate.getUTCDate() + 20);
  assert.ok(
    String(promo.valid_until).startsWith(expectedUntilDate.toISOString().slice(0, 10)),
    "fallback valid_until must stay aligned with saved duration_days",
  );
  updateWheelSettings({ default_promo_validity_days: 90 });
}

async function main() {
  // Make sure default settings reflect base test assumptions.
  updateWheelSettings({
    spin_byn_retail: 40,
    spin_byn_wholesale: 200,
    pity_threshold: 3,
    default_promo_validity_days: 90,
    feed_size: 30,
    elite_rarities: ["valuable"],
  });

  await testWeightedDistribution();
  await testBestPracticeSingleAvailableCommonDistribution();
  await testProductionBaselineDistribution();
  await testPityTriggersAfterThresholdNothings();
  await testPityReassignsNothingChanceToCommon();
  await testPityReassignsNothingChanceToFirstAvailableWhenCommonUnavailable();
  await testPityDoesNotUseValuableWhenNormalPrizeExists();
  await testPromoTemplateLimitStopsPrize();
  await testLegacyPrizeLimitDoesNotExhaustWhenTemplateIsUnlimited();
  await testPrizeSelectionWithinRarityIgnoresPrizeWeights();
  await testRaritySelectionUsesConfiguredChancePercentNotPrizeWeights();
  await testRarityChanceBoundariesDoNotSkipFirstOrLastRarity();
  await testUnavailableRarityFallsBackToNothingWithoutError();
  await testUnavailableNormalRaritiesBecomeNothingChance();
  await testUnavailablePrizeInAvailableRarityNeverDrops();
  await testNoDropAvailableFallsBackToNothing();
  await testDashboardTotalsMatchRecordedSpins();
  await testAdminSpinHistoryHidesNothingPseudoPrize();
  await testNotEnoughSpins();
  await testSpinAuditCapturesEffectiveChanceAndRng();
  await testGeneratedPromoUsesTemplateDurationInsteadOfPrizeLegacyDuration();
  await testGeneratedWheelPromosAreUniqueAndOwnerBound();
  await testGeneratedPromoFallsBackWhenTemplateDurationIsMissing();

  console.log("[wheel-spin] OK");
}

try {
  await main();
} finally {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
