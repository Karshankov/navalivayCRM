import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { buildTelegramInitData, telegramHeaders } from "./helpers/telegram-auth.js";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "navalivay-loyalty-"));
const tempDbPath = path.join(tempDir, "test.db");

process.env.DATABASE_FILE = tempDbPath;
process.env.BOT_TOKEN = "test-bot-token";
process.env.NODE_ENV = "test";

const { initDb, db } = await import("../db.js");
const { publicRouter } = await import("../routes/public.js");
const { loyaltyRouter } = await import("../routes/loyalty.js");
const {
  awardLoyaltyForOrder,
  isPositionSalePriceReduced,
  isPositionLoyaltyStampBlocked,
} = await import("../loyalty.js");
const { seedDefaultLoyaltyData } = await import("../migrations/add_loyalty_tables.js");

initDb();

const app = express();
app.use(express.json());
app.use(publicRouter);
app.use(loyaltyRouter);

const server = await new Promise((resolve) => {
  const instance = app.listen(0, () => resolve(instance));
});

const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;

function jsonHeaders() {
  return {
    "Content-Type": "application/json",
  };
}

async function requestJson(url, options = {}) {
  const response = await fetch(`${baseUrl}${url}`, options);
  const data = await response.json().catch(() => null);
  return { response, data };
}

function seedLoyaltyCatalog() {
  db.prepare(
    `
    INSERT OR IGNORE INTO categories (id, slug, name, [order], hide_empty, display_mode)
    VALUES
      ('c_liquids_salt', 'zhidkosti', 'Жидкости', 0, 0, 'default'),
      ('c_dynamic_disposables', 'odnorazki', 'Одноразки', 1, 0, 'default'),
      ('c_dynamic_devices', 'ustrojstva', 'Устройства', 2, 0, 'default'),
      ('c_dynamic_snus', 'snyus-i-plastiny', 'Снюс и пластины', 3, 0, 'default')
  `,
  ).run();

  db.prepare(
    `
    INSERT OR IGNORE INTO products (
      id, categoryId, groupId, title, priceRub, description, use_category_image,
      createdAt, cost_price, stock, min_stock, has_variants
    ) VALUES
      ('liquid-1', 'c_liquids_salt', NULL, 'Liquid Cherry', 15, '', 0, DATETIME('now'), 5, 50, 0, 0),
      ('disposable-1', 'c_dynamic_disposables', NULL, 'Disposable Mint', 25, '', 0, DATETIME('now'), 10, 50, 0, 0),
      ('device-1', 'c_dynamic_devices', NULL, 'Device X', 55, '', 0, DATETIME('now'), 20, 50, 0, 0),
      ('snus-1', 'c_dynamic_snus', NULL, 'Snus Mint', 8, '', 0, DATETIME('now'), 3, 50, 0, 0)
  `,
  ).run();
}

function resetMappingsToLiquidsOnly() {
  db.prepare("DELETE FROM loyalty_category_mappings").run();
  db.prepare(
    `
    INSERT INTO loyalty_category_mappings (id, loyalty_category_id, category_id, group_id)
    VALUES ('manual_liquids_only', 'loyalty_liquids', 'c_liquids_salt', NULL)
  `,
  ).run();
}

function createCustomer({
  id,
  telegramId,
  telegramUsername,
  firstName = "Test",
  lastName = "User",
}) {
  db.prepare(
    `
    INSERT INTO customers (
      id, telegram_id, telegram_username, first_name, last_name, last_visit_at
    ) VALUES (?, ?, ?, ?, ?, DATETIME('now'))
  `,
  ).run(id, String(telegramId), telegramUsername, firstName, lastName);

  return id;
}

function getCustomerByTelegramId(telegramId) {
  return db
    .prepare("SELECT * FROM customers WHERE telegram_id = ?")
    .get(String(telegramId));
}

function getLoyaltyCategoryId(key) {
  return db.prepare("SELECT id FROM loyalty_categories WHERE key = ?").get(key).id;
}

function setBalance(customerId, categoryId, balance) {
  db.prepare(
    `
    INSERT INTO customer_loyalty_balances (customer_id, loyalty_category_id, balance, updated_at)
    VALUES (?, ?, ?, DATETIME('now'))
    ON CONFLICT(customer_id, loyalty_category_id) DO UPDATE SET
      balance = excluded.balance,
      updated_at = DATETIME('now')
  `,
  ).run(customerId, categoryId, balance);
}

function getBalance(customerId, categoryId) {
  return Number(
    db
      .prepare(
        `
        SELECT balance
        FROM customer_loyalty_balances
        WHERE customer_id = ? AND loyalty_category_id = ?
      `,
      )
      .get(customerId, categoryId)?.balance || 0,
  );
}

function getOrderItem(orderId) {
  return db
    .prepare("SELECT * FROM order_items WHERE order_id = ? ORDER BY rowid ASC")
    .get(orderId);
}

function getOrderItems(orderId) {
  return db
    .prepare("SELECT * FROM order_items WHERE order_id = ? ORDER BY rowid ASC")
    .all(orderId);
}

function markOrderDelivered(orderId) {
  db.prepare(
    "UPDATE orders SET status = 'delivered', completed_at = DATETIME('now') WHERE id = ?",
  ).run(orderId);
}

function seedVariantLiquid() {
  db.prepare("UPDATE products SET has_variants = 1 WHERE id = 'liquid-1'").run();
  db.prepare(
    `
    INSERT OR IGNORE INTO product_variants (id, product_id, name, price_rub, stock, position, created_at)
    VALUES ('liquid-1-vanilla', 'liquid-1', 'Vanilla', 15, 50, 0, DATETIME('now'))
  `,
  ).run();
}

function seedProduct8148Like() {
  db.prepare(
    `
    INSERT OR IGNORE INTO products (
      id, categoryId, groupId, title, priceRub, description, use_category_image,
      createdAt, cost_price, stock, min_stock, has_variants
    ) VALUES (
      'liquid-8148', 'c_liquids_salt', NULL, 'Polatranezh', 16, '', 0,
      DATETIME('now'), 5, 50, 0, 0
    )
  `,
  ).run();
}

function getRedemptions(orderId) {
  return db
    .prepare("SELECT * FROM order_loyalty_redemptions WHERE order_id = ? ORDER BY rowid ASC")
    .all(orderId);
}

function getLedgerReasons(customerId) {
  return db
    .prepare(
      `
      SELECT reason
      FROM customer_loyalty_ledger
      WHERE customer_id = ?
      ORDER BY rowid ASC
    `,
    )
    .all(customerId)
    .map((row) => row.reason);
}

async function createPublicOrder(identity, overrides = {}) {
  const payload = {
    telegram_id: identity.telegram_id,
    telegram_username: identity.telegram_username,
    first_name: identity.first_name || "Test",
    last_name: identity.last_name || "User",
    delivery_type: "pickup",
    items: [
      {
        product_id: "liquid-1",
        variant_id: null,
        quantity: 1,
        price_per_unit: 15,
        product_title: "Liquid Cherry",
        variant_name: null,
      },
    ],
    ...overrides,
  };

  return requestJson("/api/orders", {
    method: "POST",
    headers: telegramHeaders(identity),
    body: JSON.stringify(payload),
  });
}

async function testPreviewReserveAndAward() {
  const customerId = createCustomer({
    id: "cust-loyalty-1",
    telegramId: "2001",
    telegramUsername: "loyalty_user",
  });
  const liquidsCategoryId = getLoyaltyCategoryId("liquids");
  setBalance(customerId, liquidsCategoryId, 10);

  const preview = await requestJson("/api/loyalty/checkout-preview", {
    method: "POST",
    headers: telegramHeaders({
      id: 2001,
      username: "loyalty_user",
    }),
    body: JSON.stringify({
      telegram_id: "2001",
      telegram_username: "loyalty_user",
      items: [
        {
          product_id: "liquid-1",
          quantity: 2,
          price_per_unit: 15,
          product_title: "Liquid Cherry",
          loyalty_units_applied: 1,
        },
      ],
    }),
  });

  assert.equal(preview.response.status, 200);
  assert.equal(preview.data.categories.length, 1);
  assert.equal(preview.data.categories[0].current_balance, 10);
  assert.equal(preview.data.categories[0].current_available_bonus_count, 1);
  assert.equal(preview.data.categories[0].projected_balance, 1);
  assert.equal(preview.data.total_loyalty_discount, 10);

  const created = await createPublicOrder(
    {
      telegram_id: "2001",
      telegram_username: "loyalty_user",
    },
    {
      items: [
        {
          product_id: "liquid-1",
          variant_id: null,
          quantity: 2,
          price_per_unit: 15,
          product_title: "Liquid Cherry",
          loyalty_units_applied: 1,
        },
      ],
    },
  );

  assert.equal(created.response.status, 200);
  const orderId = created.data.order_id;
  const orderItem = getOrderItem(orderId);
  const redemptions = getRedemptions(orderId);

  assert.equal(getBalance(customerId, liquidsCategoryId), 0);
  assert.equal(Number(orderItem.loyalty_units_applied || 0), 1);
  assert.equal(Number(orderItem.loyalty_discount_amount || 0), 10);
  assert.equal(redemptions.length, 1);
  assert.equal(Number(redemptions[0].stamps_spent || 0), 10);

  db.prepare("UPDATE orders SET status = 'delivered', completed_at = DATETIME('now') WHERE id = ?").run(
    orderId,
  );

  const firstAward = awardLoyaltyForOrder(orderId);
  const secondAward = awardLoyaltyForOrder(orderId);

  assert.equal(firstAward.awarded, true);
  assert.equal(secondAward.reason, "already_awarded");
  assert.equal(getBalance(customerId, liquidsCategoryId), 1);
  assert.deepEqual(getLedgerReasons(customerId), [
    "reserved_for_order",
    "earned_from_order",
  ]);
}

async function testSeedRepairsPartialMappings() {
  resetMappingsToLiquidsOnly();
  seedDefaultLoyaltyData();

  const mappings = db
    .prepare(
      `
      SELECT loyalty_category_id, category_id
      FROM loyalty_category_mappings
      WHERE category_id IS NOT NULL
      ORDER BY loyalty_category_id ASC, category_id ASC
    `,
    )
    .all();

  const mappingPairs = new Set(
    mappings.map((mapping) => `${mapping.loyalty_category_id}::${mapping.category_id}`),
  );

  assert.equal(mappingPairs.has("loyalty_liquids::c_liquids_salt"), true);
  assert.equal(mappingPairs.has("loyalty_liquids::c_dynamic_snus"), true);
  assert.equal(mappingPairs.has("loyalty_disposables::c_dynamic_disposables"), true);
  assert.equal(mappingPairs.has("loyalty_devices::c_dynamic_devices"), true);

  const preview = await requestJson("/api/loyalty/checkout-preview", {
    method: "POST",
    headers: telegramHeaders({
      id: 2999,
      username: "preview_user",
    }),
    body: JSON.stringify({
      items: [
        {
          product_id: "liquid-1",
          quantity: 1,
          price_per_unit: 15,
          product_title: "Liquid Cherry",
        },
        {
          product_id: "snus-1",
          quantity: 1,
          price_per_unit: 8,
          product_title: "Snus Mint",
        },
        {
          product_id: "disposable-1",
          quantity: 1,
          price_per_unit: 25,
          product_title: "Disposable Mint",
        },
        {
          product_id: "device-1",
          quantity: 1,
          price_per_unit: 55,
          product_title: "Device X",
        },
      ],
    }),
  });

  assert.equal(preview.response.status, 200);
  assert.deepEqual(
    preview.data.categories.map((category) => category.category_key),
    ["liquids", "disposables", "devices"],
  );
  assert.equal(preview.data.categories[0].items_in_cart, 2);
}

async function testCancelReturnsReservedBalance() {
  const customerId = createCustomer({
    id: "cust-loyalty-2",
    telegramId: "2002",
    telegramUsername: "loyalty_cancel",
  });
  const liquidsCategoryId = getLoyaltyCategoryId("liquids");
  setBalance(customerId, liquidsCategoryId, 20);

  const created = await createPublicOrder(
    {
      telegram_id: "2002",
      telegram_username: "loyalty_cancel",
    },
    {
      items: [
        {
          product_id: "liquid-1",
          variant_id: null,
          quantity: 2,
          price_per_unit: 15,
          product_title: "Liquid Cherry",
          loyalty_units_applied: 1,
        },
      ],
    },
  );

  assert.equal(created.response.status, 200);
  const orderId = created.data.order_id;
  assert.equal(getBalance(customerId, liquidsCategoryId), 10);

  const cancelled = await requestJson(`/api/orders/${orderId}/cancel-by-customer`, {
    method: "POST",
    headers: telegramHeaders({
      id: 2002,
      username: "loyalty_cancel",
    }),
    body: JSON.stringify({
      telegram_id: "2002",
      telegram_username: "loyalty_cancel",
    }),
  });

  assert.equal(cancelled.response.status, 200);
  assert.equal(getBalance(customerId, liquidsCategoryId), 20);
  assert.equal(getRedemptions(orderId).length, 0);

  const orderItem = getOrderItem(orderId);
  assert.equal(Number(orderItem.loyalty_units_applied || 0), 0);
  assert.equal(Number(orderItem.loyalty_discount_amount || 0), 0);
}

async function testAwardSkipsLoweredSalePriceOnPosition() {
  const customerId = createCustomer({
    id: "cust-loyalty-3",
    telegramId: "2003",
    telegramUsername: "loyalty_lowered_price",
  });
  const liquidsCategoryId = getLoyaltyCategoryId("liquids");

  const created = await createPublicOrder(
    {
      telegram_id: "2003",
      telegram_username: "loyalty_lowered_price",
    },
    {
      items: [
        {
          product_id: "liquid-1",
          variant_id: null,
          quantity: 1,
          price_per_unit: 14,
          product_title: "Liquid Cherry",
        },
      ],
    },
  );

  assert.equal(created.response.status, 200);
  const orderId = created.data.order_id;

  db.prepare(
    `
    UPDATE order_items
    SET price_per_unit = 14,
        total_price = 14
    WHERE order_id = ?
  `,
  ).run(orderId);

  const orderItem = getOrderItem(orderId);
  assert.equal(isPositionSalePriceReduced(orderItem), true);

  db.prepare("UPDATE orders SET status = 'delivered', completed_at = DATETIME('now') WHERE id = ?").run(
    orderId,
  );
  const award = awardLoyaltyForOrder(orderId);

  assert.equal(award.reason, "nothing_to_award");
  assert.equal(getBalance(customerId, liquidsCategoryId), 0);
}

async function testAwardAllowsOrderLevelDiscount() {
  const customerId = createCustomer({
    id: "cust-loyalty-order-discount",
    telegramId: "20031",
    telegramUsername: "loyalty_order_discount",
  });
  const liquidsCategoryId = getLoyaltyCategoryId("liquids");

  const created = await createPublicOrder(
    {
      telegram_id: "20031",
      telegram_username: "loyalty_order_discount",
    },
    {
      items: [
        {
          product_id: "liquid-1",
          variant_id: null,
          quantity: 1,
          price_per_unit: 15,
          product_title: "Liquid Cherry",
        },
      ],
    },
  );

  assert.equal(created.response.status, 200);
  const orderId = created.data.order_id;

  db.prepare(
    `
    UPDATE orders
    SET discount_amount = 1,
        final_amount = 14,
        status = 'delivered',
        completed_at = DATETIME('now')
    WHERE id = ?
  `,
  ).run(orderId);

  const award = awardLoyaltyForOrder(orderId);

  assert.equal(award.awarded, true);
  assert.equal(getBalance(customerId, liquidsCategoryId), 1);
}

async function testAwardSkipsManualPositionDiscountWhenPriceUnchanged() {
  const customerId = createCustomer({
    id: "cust-loyalty-manual-position",
    telegramId: "20032",
    telegramUsername: "loyalty_manual_position",
  });
  const liquidsCategoryId = getLoyaltyCategoryId("liquids");

  const created = await createPublicOrder(
    {
      telegram_id: "20032",
      telegram_username: "loyalty_manual_position",
    },
    {
      items: [
        {
          product_id: "liquid-1",
          variant_id: null,
          quantity: 1,
          price_per_unit: 15,
          product_title: "Liquid Cherry",
        },
      ],
    },
  );

  assert.equal(created.response.status, 200);
  const orderId = created.data.order_id;

  db.prepare(
    `
    UPDATE order_items
    SET manual_discount_amount = 2,
        discount_amount = 2,
        total_price = MAX((price_per_unit * quantity) - 2, 0)
    WHERE order_id = ?
  `,
  ).run(orderId);
  db.prepare("UPDATE orders SET status = 'delivered', completed_at = DATETIME('now') WHERE id = ?").run(
    orderId,
  );

  const orderItem = getOrderItem(orderId);
  assert.equal(isPositionLoyaltyStampBlocked(orderItem), true);

  const award = awardLoyaltyForOrder(orderId);

  assert.equal(award.reason, "nothing_to_award");
  assert.equal(getBalance(customerId, liquidsCategoryId), 0);
}

async function testSnapshotIsReadOnly() {
  const customerId = createCustomer({
    id: "cust-loyalty-4",
    telegramId: "2004",
    telegramUsername: "before_reset",
  });
  const liquidsCategoryId = getLoyaltyCategoryId("liquids");
  setBalance(customerId, liquidsCategoryId, 12);

  const snapshot = await requestJson("/api/loyalty/me?telegram_id=2004&telegram_username=after_reset", {
    headers: telegramHeaders({
      id: 2004,
      username: "after_reset",
    }),
  });

  assert.equal(snapshot.response.status, 200);
  const liquids = snapshot.data.categories.find((category) => category.key === "liquids");
  assert.equal(liquids.balance, 12);
  assert.equal(getLedgerReasons(customerId).includes("username_reset"), false);
}

async function testUsernameChangeDoesNotResetBalanceOnOrderCreate() {
  const customerId = createCustomer({
    id: "cust-loyalty-username-keep",
    telegramId: "2010",
    telegramUsername: "before_reset",
  });
  const liquidsCategoryId = getLoyaltyCategoryId("liquids");
  setBalance(customerId, liquidsCategoryId, 14);

  const created = await createPublicOrder(
    {
      telegram_id: "2010",
      telegram_username: "after_reset",
    },
    {
      items: [
        {
          product_id: "liquid-1",
          quantity: 1,
          price_per_unit: 15,
          product_title: "Liquid Cherry",
        },
      ],
    },
  );

  assert.equal(created.response.status, 200);
  assert.equal(getBalance(customerId, liquidsCategoryId), 14);
  assert.equal(getLedgerReasons(customerId).includes("username_reset"), false);
  assert.equal(getCustomerByTelegramId("2010").telegram_username, "after_reset");
}

async function testOnlyOneBonusUnitCanBeAppliedPerCategory() {
  const customerId = createCustomer({
    id: "cust-loyalty-5",
    telegramId: "2005",
    telegramUsername: "loyalty_one_bonus",
  });
  const liquidsCategoryId = getLoyaltyCategoryId("liquids");
  setBalance(customerId, liquidsCategoryId, 20);

  const preview = await requestJson("/api/loyalty/checkout-preview", {
    method: "POST",
    headers: telegramHeaders({
      id: 2005,
      username: "loyalty_one_bonus",
    }),
    body: JSON.stringify({
      telegram_id: "2005",
      telegram_username: "loyalty_one_bonus",
      items: [
        {
          product_id: "liquid-1",
          quantity: 1,
          price_per_unit: 15,
          product_title: "Liquid Cherry",
          loyalty_units_applied: 1,
        },
        {
          product_id: "snus-1",
          quantity: 1,
          price_per_unit: 8,
          product_title: "Snus Mint",
          loyalty_units_applied: 1,
        },
      ],
    }),
  });

  assert.equal(preview.response.status, 400);
  assert.equal(preview.data.error, "loyalty_category_limit_exceeded");

  const created = await createPublicOrder(
    {
      telegram_id: "2005",
      telegram_username: "loyalty_one_bonus",
    },
    {
      items: [
        {
          product_id: "liquid-1",
          quantity: 1,
          price_per_unit: 15,
          product_title: "Liquid Cherry",
          loyalty_units_applied: 1,
        },
        {
          product_id: "snus-1",
          quantity: 1,
          price_per_unit: 8,
          product_title: "Snus Mint",
          loyalty_units_applied: 1,
        },
      ],
    },
  );

  assert.equal(created.response.status, 400);
  assert.equal(created.data.error, "loyalty_category_limit_exceeded");
}

async function testBonusesCanBeAppliedAcrossDifferentCategories() {
  const customerId = createCustomer({
    id: "cust-loyalty-6",
    telegramId: "2006",
    telegramUsername: "loyalty_multi_category",
  });
  const liquidsCategoryId = getLoyaltyCategoryId("liquids");
  const devicesCategoryId = getLoyaltyCategoryId("devices");
  setBalance(customerId, liquidsCategoryId, 10);
  setBalance(customerId, devicesCategoryId, 4);

  const preview = await requestJson("/api/loyalty/checkout-preview", {
    method: "POST",
    headers: telegramHeaders({
      id: 2006,
      username: "loyalty_multi_category",
    }),
    body: JSON.stringify({
      telegram_id: "2006",
      telegram_username: "loyalty_multi_category",
      items: [
        {
          product_id: "liquid-1",
          quantity: 1,
          price_per_unit: 15,
          product_title: "Liquid Cherry",
          loyalty_units_applied: 1,
        },
        {
          product_id: "device-1",
          quantity: 1,
          price_per_unit: 55,
          product_title: "Device X",
          loyalty_units_applied: 1,
        },
      ],
    }),
  });

  assert.equal(preview.response.status, 200);
  assert.equal(preview.data.total_loyalty_discount, 35);

  const created = await createPublicOrder(
    {
      telegram_id: "2006",
      telegram_username: "loyalty_multi_category",
    },
    {
      items: [
        {
          product_id: "liquid-1",
          quantity: 1,
          price_per_unit: 15,
          product_title: "Liquid Cherry",
          loyalty_units_applied: 1,
        },
        {
          product_id: "device-1",
          quantity: 1,
          price_per_unit: 55,
          product_title: "Device X",
          loyalty_units_applied: 1,
        },
      ],
    },
  );

  assert.equal(created.response.status, 200);
  assert.equal(getBalance(customerId, liquidsCategoryId), 0);
  assert.equal(getBalance(customerId, devicesCategoryId), 0);
  assert.equal(getRedemptions(created.data.order_id).length, 2);
}

async function testMissingTelegramAuthRejectedForSnapshot() {
  const snapshot = await requestJson("/api/loyalty/me?telegram_id=2004");
  assert.equal(snapshot.response.status, 401);
  assert.equal(snapshot.data.error, "telegram_auth_required");
}

function testIsPositionLoyaltyStampBlockedBoundary() {
  assert.equal(
    isPositionLoyaltyStampBlocked({
      product_id: "liquid-1",
      variant_id: null,
      price_per_unit: 15,
      manual_discount_amount: 0,
    }),
    false,
    "catalog price with zero manual discount is not blocked",
  );
  assert.equal(
    isPositionLoyaltyStampBlocked({
      product_id: "liquid-1",
      variant_id: null,
      price_per_unit: 15,
      manual_discount_amount: 0.01,
    }),
    true,
    "any positive manual position discount blocks stamp",
  );
  assert.equal(
    isPositionLoyaltyStampBlocked({
      product_id: "liquid-1",
      variant_id: null,
      price_per_unit: 14,
      manual_discount_amount: 0,
    }),
    true,
    "lowered sale price blocks stamp even without manual discount",
  );
}

function testIsPositionSalePriceReducedBoundary() {
  assert.equal(
    isPositionSalePriceReduced({
      product_id: "liquid-1",
      variant_id: null,
      price_per_unit: 15,
    }),
    false,
    "catalog price equals sale price",
  );
  assert.equal(
    isPositionSalePriceReduced({
      product_id: "liquid-1",
      variant_id: null,
      price_per_unit: 14.999,
    }),
    false,
    "within epsilon of catalog price is not reduced",
  );
  assert.equal(
    isPositionSalePriceReduced({
      product_id: "liquid-1",
      variant_id: null,
      price_per_unit: 14.998,
    }),
    true,
    "below epsilon threshold counts as lowered sale price",
  );
  assert.equal(
    isPositionSalePriceReduced({
      product_id: "liquid-1",
      variant_id: null,
      price_per_unit: 14,
    }),
    true,
    "clearly lowered sale price",
  );
}

async function testAwardSkipsPromoOrder() {
  const customerId = createCustomer({
    id: "cust-loyalty-promo",
    telegramId: "2007",
    telegramUsername: "loyalty_promo",
  });
  const liquidsCategoryId = getLoyaltyCategoryId("liquids");

  const created = await createPublicOrder(
    {
      telegram_id: "2007",
      telegram_username: "loyalty_promo",
    },
    {
      items: [
        {
          product_id: "liquid-1",
          variant_id: null,
          quantity: 1,
          price_per_unit: 15,
          product_title: "Liquid Cherry",
        },
      ],
    },
  );

  assert.equal(created.response.status, 200);
  const orderId = created.data.order_id;

  db.prepare(
    `
    UPDATE orders
    SET promo_code_text = 'PROMO10',
        status = 'delivered',
        completed_at = DATETIME('now')
    WHERE id = ?
  `,
  ).run(orderId);

  const award = awardLoyaltyForOrder(orderId);

  assert.equal(award.reason, "promo_applied");
  assert.equal(getBalance(customerId, liquidsCategoryId), 0);
}

async function testAwardMixedCartPartialAccrual() {
  const customerId = createCustomer({
    id: "cust-loyalty-mixed",
    telegramId: "2008",
    telegramUsername: "loyalty_mixed",
  });
  const liquidsCategoryId = getLoyaltyCategoryId("liquids");

  const created = await createPublicOrder(
    {
      telegram_id: "2008",
      telegram_username: "loyalty_mixed",
    },
    {
      items: [
        {
          product_id: "liquid-1",
          variant_id: null,
          quantity: 1,
          price_per_unit: 15,
          product_title: "Liquid Cherry",
        },
        {
          product_id: "liquid-1",
          variant_id: null,
          quantity: 1,
          price_per_unit: 15,
          product_title: "Liquid Cherry",
        },
      ],
    },
  );

  assert.equal(created.response.status, 200);
  const orderId = created.data.order_id;
  const items = getOrderItems(orderId);

  db.prepare(
    `
    UPDATE order_items
    SET price_per_unit = 14,
        total_price = 14
    WHERE id = ?
  `,
  ).run(items[1].id);

  markOrderDelivered(orderId);
  const award = awardLoyaltyForOrder(orderId);

  assert.equal(award.awarded, true);
  assert.equal(award.rows, 1);
  assert.equal(getBalance(customerId, liquidsCategoryId), 1);
}

async function testAwardSkipsVariantWithLoweredPrice() {
  seedVariantLiquid();

  const customerId = createCustomer({
    id: "cust-loyalty-variant-lowered",
    telegramId: "2009",
    telegramUsername: "loyalty_variant_lowered",
  });
  const liquidsCategoryId = getLoyaltyCategoryId("liquids");

  const created = await createPublicOrder(
    {
      telegram_id: "2009",
      telegram_username: "loyalty_variant_lowered",
    },
    {
      items: [
        {
          product_id: "liquid-1",
          variant_id: "liquid-1-vanilla",
          quantity: 1,
          price_per_unit: 14,
          product_title: "Liquid Cherry",
          variant_name: "Vanilla",
        },
      ],
    },
  );

  assert.equal(created.response.status, 200);
  const orderId = created.data.order_id;

  db.prepare(
    `
    UPDATE order_items
    SET price_per_unit = 14,
        total_price = 14
    WHERE order_id = ?
  `,
  ).run(orderId);

  const orderItem = getOrderItem(orderId);
  assert.equal(isPositionSalePriceReduced(orderItem), true);
  markOrderDelivered(orderId);

  const award = awardLoyaltyForOrder(orderId);

  assert.equal(award.reason, "nothing_to_award");
  assert.equal(getBalance(customerId, liquidsCategoryId), 0);
}

async function testAwardAllowsVariantAtCatalogPrice() {
  seedVariantLiquid();

  const customerId = createCustomer({
    id: "cust-loyalty-variant-catalog",
    telegramId: "2011",
    telegramUsername: "loyalty_variant_catalog",
  });
  const liquidsCategoryId = getLoyaltyCategoryId("liquids");

  const created = await createPublicOrder(
    {
      telegram_id: "2011",
      telegram_username: "loyalty_variant_catalog",
    },
    {
      items: [
        {
          product_id: "liquid-1",
          variant_id: "liquid-1-vanilla",
          quantity: 2,
          price_per_unit: 15,
          product_title: "Liquid Cherry",
          variant_name: "Vanilla",
        },
      ],
    },
  );

  assert.equal(created.response.status, 200);
  const orderId = created.data.order_id;

  markOrderDelivered(orderId);
  const award = awardLoyaltyForOrder(orderId);

  assert.equal(award.awarded, true);
  assert.equal(getBalance(customerId, liquidsCategoryId), 2);
}

async function testAwardStatusNotFinal() {
  const customerId = createCustomer({
    id: "cust-loyalty-status",
    telegramId: "2012",
    telegramUsername: "loyalty_status",
  });
  const liquidsCategoryId = getLoyaltyCategoryId("liquids");

  const created = await createPublicOrder(
    {
      telegram_id: "2012",
      telegram_username: "loyalty_status",
    },
  );

  assert.equal(created.response.status, 200);
  const orderId = created.data.order_id;

  const inProgressAward = awardLoyaltyForOrder(orderId);
  assert.equal(inProgressAward.reason, "status_not_final");

  db.prepare("UPDATE orders SET status = 'in_progress' WHERE id = ?").run(orderId);
  const stillPendingAward = awardLoyaltyForOrder(orderId);
  assert.equal(stillPendingAward.reason, "status_not_final");
  assert.equal(getBalance(customerId, liquidsCategoryId), 0);
}

async function testAwardNoCustomer() {
  const created = await createPublicOrder(
    {
      telegram_id: "2099",
      telegram_username: "orphan_order",
    },
  );

  assert.equal(created.response.status, 200);
  const orderId = created.data.order_id;

  db.prepare("UPDATE orders SET customer_id = NULL WHERE id = ?").run(orderId);
  markOrderDelivered(orderId);

  const award = awardLoyaltyForOrder(orderId);
  assert.equal(award.reason, "no_customer");
}

async function testAwardRegression8148LikeOrder() {
  seedProduct8148Like();

  const customerId = createCustomer({
    id: "cust-loyalty-8148",
    telegramId: "2013",
    telegramUsername: "polatranezh",
  });
  const liquidsCategoryId = getLoyaltyCategoryId("liquids");

  const created = await createPublicOrder(
    {
      telegram_id: "2013",
      telegram_username: "polatranezh",
    },
    {
      items: [
        {
          product_id: "liquid-8148",
          variant_id: null,
          quantity: 1,
          price_per_unit: 16,
          product_title: "Polatranezh",
        },
      ],
    },
  );

  assert.equal(created.response.status, 200);
  const orderId = created.data.order_id;

  db.prepare(
    `
    UPDATE orders
    SET discount_amount = 1,
        final_amount = 15,
        status = 'delivered',
        completed_at = DATETIME('now')
    WHERE id = ?
  `,
  ).run(orderId);

  const orderItem = getOrderItem(orderId);
  assert.equal(isPositionSalePriceReduced(orderItem), false);

  const award = awardLoyaltyForOrder(orderId);

  assert.equal(award.awarded, true);
  assert.equal(getBalance(customerId, liquidsCategoryId), 1);
}

async function testAwardDetailPageOrderDiscountMatchesKanbanPencil() {
  const customerId = createCustomer({
    id: "cust-loyalty-detail-discount",
    telegramId: "2014",
    telegramUsername: "loyalty_detail_discount",
  });
  const liquidsCategoryId = getLoyaltyCategoryId("liquids");

  const created = await createPublicOrder(
    {
      telegram_id: "2014",
      telegram_username: "loyalty_detail_discount",
    },
    {
      items: [
        {
          product_id: "liquid-1",
          variant_id: null,
          quantity: 2,
          price_per_unit: 15,
          product_title: "Liquid Cherry",
        },
      ],
    },
  );

  assert.equal(created.response.status, 200);
  const orderId = created.data.order_id;

  db.prepare(
    `
    UPDATE orders
    SET discount_amount = 3,
        final_amount = 27,
        status = 'delivered',
        completed_at = DATETIME('now')
    WHERE id = ?
  `,
  ).run(orderId);

  const award = awardLoyaltyForOrder(orderId);

  assert.equal(award.awarded, true);
  assert.equal(getBalance(customerId, liquidsCategoryId), 2);
}

async function testAwardMultipleCategoriesInOneOrder() {
  const customerId = createCustomer({
    id: "cust-loyalty-multi-earn",
    telegramId: "2015",
    telegramUsername: "loyalty_multi_earn",
  });
  const liquidsCategoryId = getLoyaltyCategoryId("liquids");
  const disposablesCategoryId = getLoyaltyCategoryId("disposables");

  const created = await createPublicOrder(
    {
      telegram_id: "2015",
      telegram_username: "loyalty_multi_earn",
    },
    {
      items: [
        {
          product_id: "liquid-1",
          variant_id: null,
          quantity: 1,
          price_per_unit: 15,
          product_title: "Liquid Cherry",
        },
        {
          product_id: "disposable-1",
          variant_id: null,
          quantity: 2,
          price_per_unit: 25,
          product_title: "Disposable Mint",
        },
      ],
    },
  );

  assert.equal(created.response.status, 200);
  markOrderDelivered(created.data.order_id);

  const award = awardLoyaltyForOrder(created.data.order_id);

  assert.equal(award.awarded, true);
  assert.equal(award.rows, 2);
  assert.equal(getBalance(customerId, liquidsCategoryId), 1);
  assert.equal(getBalance(customerId, disposablesCategoryId), 2);
}

async function testAwardDeductsLoyaltyUnitsFromEarnedStamps() {
  const customerId = createCustomer({
    id: "cust-loyalty-earn-minus-spent",
    telegramId: "2016",
    telegramUsername: "loyalty_earn_minus_spent",
  });
  const liquidsCategoryId = getLoyaltyCategoryId("liquids");
  setBalance(customerId, liquidsCategoryId, 10);

  const created = await createPublicOrder(
    {
      telegram_id: "2016",
      telegram_username: "loyalty_earn_minus_spent",
    },
    {
      items: [
        {
          product_id: "liquid-1",
          variant_id: null,
          quantity: 3,
          price_per_unit: 15,
          product_title: "Liquid Cherry",
          loyalty_units_applied: 1,
        },
      ],
    },
  );

  assert.equal(created.response.status, 200);
  assert.equal(getBalance(customerId, liquidsCategoryId), 0);

  markOrderDelivered(created.data.order_id);
  const award = awardLoyaltyForOrder(created.data.order_id);

  assert.equal(award.awarded, true);
  assert.equal(getBalance(customerId, liquidsCategoryId), 2);
}

async function testAwardMissingOrderId() {
  const award = awardLoyaltyForOrder(null);
  assert.equal(award.reason, "missing_order_id");
}

/**
 * Скидку ставят на линейку куда чаще, чем на отдельный товар: на проде сейчас
 * так сделаны вообще все акции. Проверка на скидку читала поле линейки не под
 * тем именем, из-за чего скидочная жидкость всё равно предлагала бонусную
 * карту, и покупатель мог сложить акцию с бонусом.
 */
async function testGroupDiscountBlocksBonus() {
  const { buildLoyaltyApplication } = await import("../loyalty.js");
  const { saveDiscount } = await import("../utils/catalog-discounts.js");

  db.prepare(
    `INSERT OR IGNORE INTO category_groups (id, categoryId, slug, name, [order])
     VALUES ('g-discount', 'c_liquids_salt', 'discount-line', 'Скидочная линейка', 1)`,
  ).run();
  db.prepare(
    `INSERT OR IGNORE INTO products (
       id, categoryId, groupId, title, priceRub, description, use_category_image,
       createdAt, cost_price, stock, min_stock, has_variants
     ) VALUES ('liquid-discounted', 'c_liquids_salt', 'g-discount', 'Ягодный пирог', 16, '', 0,
       DATETIME('now'), 5, 50, 0, 0)`,
  ).run();

  resetMappingsToLiquidsOnly();
  const categoryId = getLoyaltyCategoryId("liquids");
  // Предыдущие проверки в файле могли выключить категорию: тест должен стоять
  // на своих ногах, иначе он молча перестанет проверять что-либо.
  db.prepare(
    "UPDATE loyalty_category_settings SET active = 1 WHERE loyalty_category_id = ?",
  ).run(categoryId);
  const customerId = "cust-group-discount";
  db.prepare("DELETE FROM customers WHERE id = ?").run(customerId);
  createCustomer({ id: customerId, telegramId: "990001", telegramUsername: "discount_tester" });
  setBalance(customerId, categoryId, 99);

  const line = () => {
    const application = buildLoyaltyApplication({
      customerId,
      items: [
        {
          product_id: "liquid-discounted",
          variant_id: null,
          quantity: 1,
          price_per_unit: 16,
          product_title: "Ягодный пирог",
        },
      ],
      requestedUnitsByLine: {},
    });
    const category = (application.categories || []).find(
      (item) => (item.line_items || []).length,
    );
    return category?.line_items?.[0] || null;
  };

  const withoutDiscount = line();
  assert.ok(withoutDiscount, "без скидки позиция обязана попадать в бонусную программу");
  assert.ok(
    Number(withoutDiscount.max_redeemable_units) > 0,
    "без скидки бонус должен предлагаться",
  );

  saveDiscount("group", "g-discount", { price: 12, untilDate: null });
  const withDiscount = line();
  assert.equal(
    Number(withDiscount?.max_redeemable_units || 0),
    0,
    "скидка на линейку обязана закрывать позиции доступ к бонусной карте",
  );

  saveDiscount("group", "g-discount", { price: null });
  console.log("  OK: скидка на линейку не пускает позицию в бонусы");
}

async function testAwardCompletedStatusAllowed() {
  const customerId = createCustomer({
    id: "cust-loyalty-completed",
    telegramId: "2017",
    telegramUsername: "loyalty_completed",
  });
  const liquidsCategoryId = getLoyaltyCategoryId("liquids");

  const created = await createPublicOrder(
    {
      telegram_id: "2017",
      telegram_username: "loyalty_completed",
    },
  );

  assert.equal(created.response.status, 200);
  const orderId = created.data.order_id;

  db.prepare(
    "UPDATE orders SET status = 'completed', completed_at = DATETIME('now') WHERE id = ?",
  ).run(orderId);

  const award = awardLoyaltyForOrder(orderId);

  assert.equal(award.awarded, true);
  assert.equal(getBalance(customerId, liquidsCategoryId), 1);
}

async function main() {
  seedLoyaltyCatalog();
  seedDefaultLoyaltyData();

  await testSeedRepairsPartialMappings();
  await testPreviewReserveAndAward();
  await testCancelReturnsReservedBalance();
  await testAwardSkipsLoweredSalePriceOnPosition();
  await testAwardAllowsOrderLevelDiscount();
  await testAwardSkipsManualPositionDiscountWhenPriceUnchanged();
  await testSnapshotIsReadOnly();
  await testUsernameChangeDoesNotResetBalanceOnOrderCreate();
  await testOnlyOneBonusUnitCanBeAppliedPerCategory();
  await testBonusesCanBeAppliedAcrossDifferentCategories();
  await testMissingTelegramAuthRejectedForSnapshot();
  testIsPositionLoyaltyStampBlockedBoundary();
  testIsPositionSalePriceReducedBoundary();
  await testAwardSkipsPromoOrder();
  await testAwardMixedCartPartialAccrual();
  await testAwardSkipsVariantWithLoweredPrice();
  await testAwardAllowsVariantAtCatalogPrice();
  await testAwardStatusNotFinal();
  await testAwardNoCustomer();
  await testAwardRegression8148LikeOrder();
  await testAwardDetailPageOrderDiscountMatchesKanbanPencil();
  await testAwardMultipleCategoriesInOneOrder();
  await testAwardDeductsLoyaltyUnitsFromEarnedStamps();
  await testAwardMissingOrderId();
  await testAwardCompletedStatusAllowed();
  await testGroupDiscountBlocksBonus();

  console.log("[loyalty-smoke] OK");
}

try {
  await main();
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
