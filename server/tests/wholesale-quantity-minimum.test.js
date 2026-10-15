/**
 * Опт от количества позиций — минимум в штуках, исключённые товары,
 * прямые товары по рознице и персональный минимум клиента.
 * Запуск: node server/tests/wholesale-quantity-minimum.test.js
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";

import { telegramHeaders } from "./helpers/telegram-auth.js";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "navalivay-wholesale-qty-"));
const tempDbPath = path.join(tempDir, "test.db");

process.env.DATABASE_FILE = tempDbPath;
process.env.BOT_TOKEN = "test-bot-token";
process.env.NODE_ENV = "test";

const { initDb, db } = await import("../db.js");
const { publicRouter } = await import("../routes/public.js");

initDb();

const app = express();
app.use(express.json());
app.use(publicRouter);

const server = await new Promise((resolve) => {
  const instance = app.listen(0, () => resolve(instance));
});

const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;

async function requestJson(url, options = {}) {
  const response = await fetch(`${baseUrl}${url}`, options);
  const data = await response.json().catch(() => null);
  return { response, data };
}

function getTierByCode(code) {
  return db
    .prepare("SELECT id, code, secret_key, min_order_quantity FROM wholesale_tiers WHERE code = ? LIMIT 1")
    .get(code);
}

function seedCatalog() {
  db.prepare(
    `INSERT OR IGNORE INTO categories (id, slug, name, [order], hide_empty, display_mode)
     VALUES ('cat-qty', 'cat-qty', 'Quantity test', 0, 0, 'default')`,
  ).run();

  db.prepare(
    `INSERT OR IGNORE INTO category_groups (id, categoryId, slug, name, [order], hide_empty, createdAt, updatedAt)
     VALUES ('group-qty', 'cat-qty', 'group-qty', 'Quantity group', 0, 0, DATETIME('now'), DATETIME('now'))`,
  ).run();

  // Обычный товар линейки — считается в минимуме.
  db.prepare(
    `INSERT OR REPLACE INTO products (
      id, categoryId, groupId, title, priceRub, description, use_category_image,
      createdAt, cost_price, stock, min_stock, has_variants
    ) VALUES ('wq-liquid', 'cat-qty', 'group-qty', 'Qty liquid', 15, '', 0, DATETIME('now'), 5, 1000, 0, 0)`,
  ).run();

  // Прямой товар без линейки (аналог Никобустера): виден в опте по рознице,
  // никогда не считается в минимуме.
  db.prepare(
    `INSERT OR REPLACE INTO products (
      id, categoryId, groupId, title, priceRub, description, use_category_image,
      createdAt, cost_price, stock, min_stock, has_variants
    ) VALUES ('wq-direct', 'cat-qty', NULL, 'Qty booster', 20, '', 0, DATETIME('now'), 8, 1000, 0, 0)`,
  ).run();

  // Товар линейки с флагом «не считать в минимуме».
  db.prepare(
    `INSERT OR REPLACE INTO products (
      id, categoryId, groupId, title, priceRub, description, use_category_image,
      createdAt, cost_price, stock, min_stock, has_variants, excluded_from_wholesale_min
    ) VALUES ('wq-excluded', 'cat-qty', 'group-qty', 'Qty excluded', 15, '', 0, DATETIME('now'), 5, 1000, 0, 0, 1)`,
  ).run();
}

function setWholesalePrice(tierId, price) {
  db.prepare(
    `INSERT OR REPLACE INTO category_group_wholesale_prices (group_id, tier_id, price_byn, created_at, updated_at)
     VALUES ('group-qty', ?, ?, DATETIME('now'), DATETIME('now'))`,
  ).run(tierId, price);
}

function wholesaleHeaders(code, secret, identity) {
  return {
    ...telegramHeaders(identity),
    "x-wholesale-code": code,
    "x-wholesale-secret": secret,
  };
}

function buildItem(productId, quantity, pricePerUnit, title) {
  return {
    product_id: productId,
    variant_id: null,
    quantity,
    price_per_unit: pricePerUnit,
    product_title: title,
    variant_name: null,
  };
}

async function createOrder(identity, tier, items) {
  return requestJson("/api/orders", {
    method: "POST",
    headers: wholesaleHeaders(tier.code, tier.secret_key, identity),
    body: JSON.stringify({
      ...identity,
      delivery_type: "pickup",
      items,
    }),
  });
}

function getOrderByNumber(orderId) {
  return db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
}

function getOrderItems(orderId) {
  return db.prepare("SELECT * FROM order_items WHERE order_id = ? ORDER BY rowid ASC").all(orderId);
}

function setOverride(username, value) {
  db.prepare("UPDATE customers SET wholesale_min_override = ? WHERE telegram_username = ?").run(
    value,
    username,
  );
}

function seedCustomer({ id, telegramId, username, override = null }) {
  db.prepare(
    `INSERT OR REPLACE INTO customers (
      id, telegram_id, telegram_username, first_name, last_name,
      first_visit_at, last_visit_at, total_orders, total_spent, wholesale_min_override
    ) VALUES (?, ?, ?, 'Qty', 'Test', DATETIME('now'), DATETIME('now'), 0, 0, ?)`,
  ).run(id, String(telegramId), username, override);
}

async function testContextReturnsQuantityFields(tier) {
  const context = await requestJson(
    `/api/wholesale/context?wholesale_code=${tier.code}&wholesale_secret=${tier.secret_key}`,
  );
  assert.equal(context.response.status, 200);
  assert.equal(context.data.wholesale_min_quantity, 25);
  assert.equal(context.data.wholesale_effective_min_quantity, 25);
  assert.equal(context.data.wholesale_min_override, null);
}

async function testCatalogExposesFlagsAndRetailPrice(tier) {
  const headers = {
    "x-wholesale-code": tier.code,
    "x-wholesale-secret": tier.secret_key,
  };

  const products = await requestJson("/api/products?category=cat-qty", { headers });
  assert.equal(products.response.status, 200);
  assert.equal(products.data.wholesale_min_quantity, 25);

  const byId = new Map(products.data.products.map((p) => [p.id, p]));
  const liquid = byId.get("wq-liquid");
  assert.ok(liquid, "group product must be visible in wholesale");
  assert.equal(liquid.priceRub, 9.5);
  assert.equal(liquid.excludedFromWholesaleMin, false);

  const direct = byId.get("wq-direct");
  assert.ok(direct, "direct product (no group) must be visible in wholesale");
  assert.equal(direct.priceRub, 20, "direct product keeps retail price in wholesale");
  assert.equal(direct.excludedFromWholesaleMin, true);

  const excluded = byId.get("wq-excluded");
  assert.ok(excluded, "flagged group product must be visible in wholesale");
  assert.equal(excluded.priceRub, 9.5);
  assert.equal(excluded.excludedFromWholesaleMin, true);

  const directDetails = await requestJson("/api/product/wq-direct", { headers });
  assert.equal(directDetails.response.status, 200);
  assert.equal(directDetails.data.priceRub, 20);
  assert.equal(directDetails.data.excludedFromWholesaleMin, true);
}

async function testQuantityMinimumEnforced(tier) {
  const identity = { telegram_id: "6011", telegram_username: "qty_customer" };

  const below = await createOrder(identity, tier, [buildItem("wq-liquid", 10, 9.5, "Qty liquid")]);
  assert.equal(below.response.status, 400);
  assert.equal(below.data.error, "wholesale_min_not_met");
  assert.equal(below.data.min_quantity, 25);
  assert.equal(below.data.current_quantity, 10);
  assert.equal(below.data.remaining_quantity, 15);
}

async function testExcludedAndDirectItemsDoNotCount(tier) {
  const identity = { telegram_id: "6012", telegram_username: "qty_customer_excluded" };

  // 20 считаемых + 10 прямых + 5 исключённых = 20 < 25.
  const mixed = await createOrder(identity, tier, [
    buildItem("wq-liquid", 20, 9.5, "Qty liquid"),
    buildItem("wq-direct", 10, 20, "Qty booster"),
    buildItem("wq-excluded", 5, 9.5, "Qty excluded"),
  ]);
  assert.equal(mixed.response.status, 400);
  assert.equal(mixed.data.error, "wholesale_min_not_met");
  assert.equal(mixed.data.current_quantity, 20);
}

async function testOrderMeetsMinimumAndSnapshotsIt(tier) {
  const identity = { telegram_id: "6013", telegram_username: "qty_customer_ok" };

  // 25 считаемых + 2 прямых: минимум выполнен, прямой товар идёт по рознице.
  const created = await createOrder(identity, tier, [
    buildItem("wq-liquid", 25, 9.5, "Qty liquid"),
    buildItem("wq-direct", 2, 20, "Qty booster"),
  ]);
  assert.equal(created.response.status, 200);
  assert.equal(created.data.success, true);

  const order = getOrderByNumber(created.data.order_id);
  assert.equal(order.is_wholesale, 1);
  assert.equal(order.wholesale_min_quantity, 25);

  const items = getOrderItems(created.data.order_id);
  assert.equal(items.length, 2);
  const directItem = items.find((item) => item.product_id === "wq-direct");
  assert.ok(directItem, "direct product must be purchasable in wholesale order");
  assert.equal(directItem.price_per_unit, 20);
}

async function testOverrideLowersMinimumAndSnapshots(tier) {
  const identity = { telegram_id: "6014", telegram_username: "qty_customer_override" };
  seedCustomer({
    id: "cust-qty-override",
    telegramId: identity.telegram_id,
    username: identity.telegram_username,
    override: 15,
  });

  // Персональный минимум виден в контексте с телеграм-авторизацией.
  const context = await requestJson(
    `/api/wholesale/context?wholesale_code=${tier.code}&wholesale_secret=${tier.secret_key}`,
    { headers: telegramHeaders(identity) },
  );
  assert.equal(context.response.status, 200);
  assert.equal(context.data.wholesale_min_quantity, 25);
  assert.equal(context.data.wholesale_effective_min_quantity, 15);
  assert.equal(context.data.wholesale_min_override, 15);

  // 14 позиции не проходят по персональному минимуму.
  const below = await createOrder(identity, tier, [buildItem("wq-liquid", 14, 9.5, "Qty liquid")]);
  assert.equal(below.response.status, 400);
  assert.equal(below.data.error, "wholesale_min_not_met");
  assert.equal(below.data.min_quantity, 15);

  // 15 позиции проходят, снапшот минимума пишется в заказ.
  const created = await createOrder(identity, tier, [buildItem("wq-liquid", 15, 9.5, "Qty liquid")]);
  assert.equal(created.response.status, 200);
  assert.equal(created.data.success, true);

  const order = getOrderByNumber(created.data.order_id);
  assert.equal(order.wholesale_min_quantity, 15, "order snapshots effective minimum");
}

async function testClearedOverrideRestoresDefault(tier) {
  const identity = { telegram_id: "6015", telegram_username: "qty_customer_reset" };
  seedCustomer({
    id: "cust-qty-reset",
    telegramId: identity.telegram_id,
    username: identity.telegram_username,
    override: 10,
  });

  setOverride(identity.telegram_username, null);

  const context = await requestJson(
    `/api/wholesale/context?wholesale_code=${tier.code}&wholesale_secret=${tier.secret_key}`,
    { headers: telegramHeaders(identity) },
  );
  assert.equal(context.data.wholesale_effective_min_quantity, 25);
  assert.equal(context.data.wholesale_min_override, null);

  const below = await createOrder(identity, tier, [buildItem("wq-liquid", 20, 9.5, "Qty liquid")]);
  assert.equal(below.response.status, 400);
  assert.equal(below.data.min_quantity, 25);
}

async function testModifyRevalidatesInUnits(tier) {
  const identity = { telegram_id: "6016", telegram_username: "qty_customer_edit" };

  const created = await createOrder(identity, tier, [buildItem("wq-liquid", 30, 9.5, "Qty liquid")]);
  assert.equal(created.response.status, 200);
  const orderId = created.data.order_id;

  const below = await requestJson(`/api/orders/${orderId}/modify-by-customer`, {
    method: "PUT",
    headers: telegramHeaders(identity),
    body: JSON.stringify({
      ...identity,
      delivery_type: "pickup",
      items: [buildItem("wq-liquid", 10, 9.5, "Qty liquid")],
    }),
  });
  assert.equal(below.response.status, 400);
  assert.equal(below.data.error, "wholesale_min_not_met");
  assert.equal(below.data.current_quantity, 10);

  const updated = await requestJson(`/api/orders/${orderId}/modify-by-customer`, {
    method: "PUT",
    headers: telegramHeaders(identity),
    body: JSON.stringify({
      ...identity,
      delivery_type: "pickup",
      items: [
        buildItem("wq-liquid", 25, 9.5, "Qty liquid"),
        buildItem("wq-direct", 6, 20, "Qty booster"),
      ],
    }),
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.data.success, true);

  const order = getOrderByNumber(orderId);
  assert.equal(order.wholesale_min_quantity, 25);
}

async function testLegacyAmountOrderEditsByAmount(tier) {
  const identity = { telegram_id: "6017", telegram_username: "qty_customer_legacy" };
  seedCustomer({
    id: "cust-qty-legacy",
    telegramId: identity.telegram_id,
    username: identity.telegram_username,
  });

  // Старый (суммовой) заказ уровня wt_100 «от 100 BYN»: снапшота количества
  // нет, снапшот суммы есть. Редактирование должно проверять сумму, а не
  // новый минимум уровня в позициях (25).
  db.prepare(
    `INSERT OR REPLACE INTO orders (
      id, order_number, customer_id, status, delivery_type, total_amount,
      discount_amount, discount_percent, final_amount, is_wholesale,
      wholesale_tier_id, wholesale_tier_label, wholesale_min_amount,
      wholesale_min_quantity, created_at, updated_at
    ) VALUES (
      'order-qty-legacy', 8100, 'cust-qty-legacy', 'new', 'pickup', 104.5,
      0, 0, 104.5, 1,
      'wt_100', 'Опт от 100 BYN', 100,
      NULL, DATETIME('now'), DATETIME('now')
    )`,
  ).run();

  // Ни суммы, но 11 позиций < 25 — отклоняется по сумме.
  const belowAmount = await requestJson("/api/orders/order-qty-legacy/modify-by-customer", {
    method: "PUT",
    headers: telegramHeaders(identity),
    body: JSON.stringify({
      ...identity,
      delivery_type: "pickup",
      items: [buildItem("wq-liquid", 10, 9.5, "Qty liquid")],
    }),
  });
  assert.equal(belowAmount.response.status, 400);
  assert.equal(belowAmount.data.error, "wholesale_min_not_met");
  assert.equal(belowAmount.data.min_amount, 100);

  // Сумма выполнена (11 × 9.5 = 104.5), хотя позиций меньше 25 — проходит.
  const updated = await requestJson("/api/orders/order-qty-legacy/modify-by-customer", {
    method: "PUT",
    headers: telegramHeaders(identity),
    body: JSON.stringify({
      ...identity,
      delivery_type: "pickup",
      items: [buildItem("wq-liquid", 11, 9.5, "Qty liquid")],
    }),
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.data.success, true);

  const order = getOrderByNumber("order-qty-legacy");
  assert.equal(order.wholesale_min_quantity, null, "legacy order keeps no quantity snapshot");
}

async function main() {
  try {
    seedCatalog();
    const tier = getTierByCode("25");
    assert.ok(tier, "tier with code 25 (wt_100) must exist after migration");
    assert.equal(tier.min_order_quantity, 25);
    setWholesalePrice(tier.id, 9.5);

    await testContextReturnsQuantityFields(tier);
    await testCatalogExposesFlagsAndRetailPrice(tier);
    await testQuantityMinimumEnforced(tier);
    await testExcludedAndDirectItemsDoNotCount(tier);
    await testOrderMeetsMinimumAndSnapshotsIt(tier);
    await testOverrideLowersMinimumAndSnapshots(tier);
    await testClearedOverrideRestoresDefault(tier);
    await testModifyRevalidatesInUnits(tier);
    await testLegacyAmountOrderEditsByAmount(tier);
    console.log("[wholesale-quantity-minimum] OK");
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

await main();
