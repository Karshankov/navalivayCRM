/**
 * Loyalty stamp accrual — adversarial + regression tests.
 * Run: node server/tests/loyalty-stamp-accrual-adversarial.test.js
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "navalivay-loyalty-adv-"));
process.env.DATABASE_FILE = path.join(tempDir, "test.db");
process.env.NODE_ENV = "test";

const { initDb, db } = await import("../db.js");
const { seedDefaultLoyaltyData } = await import("../migrations/add_loyalty_tables.js");
const {
  awardLoyaltyForOrder,
  isPositionLoyaltyStampBlocked,
  isPositionSalePriceReduced,
} = await import("../loyalty.js");

initDb();
seedDefaultLoyaltyData();

const results = { passed: 0, failed: 0 };

function ok(cond, msg) {
  if (cond) {
    results.passed++;
    console.log(`  OK: ${msg}`);
  } else {
    results.failed++;
    console.log(`  FAIL: ${msg}`);
  }
}

function seedCatalog() {
  db.prepare(
    `
    INSERT OR IGNORE INTO categories (id, slug, name, [order], hide_empty, display_mode)
    VALUES
      ('c_liquids_salt', 'zhidkosti', 'Жидкости', 0, 0, 'default'),
      ('c_dynamic_devices', 'ustrojstva', 'Устройства', 2, 0, 'default')
  `,
  ).run();

  db.prepare(
    `
    INSERT OR IGNORE INTO products (
      id, categoryId, groupId, title, priceRub, description, use_category_image,
      createdAt, cost_price, stock, min_stock, has_variants
    ) VALUES
      ('liquid-1', 'c_liquids_salt', NULL, 'Liquid Cherry', 15, '', 0, DATETIME('now'), 5, 50, 0, 0),
      ('device-xros', 'c_dynamic_devices', NULL, 'XROS 6', 100, '', 0, DATETIME('now'), 50, 20, 0, 1)
  `,
  ).run();

  db.prepare(
    `
    INSERT OR IGNORE INTO product_variants (id, product_id, name, price_rub, stock, position, created_at)
    VALUES ('device-xros-black', 'device-xros', 'Slate Black', 100, 10, 0, DATETIME('now'))
  `,
  ).run();

  db.prepare("DELETE FROM loyalty_category_mappings").run();
  db.prepare(
    `
    INSERT INTO loyalty_category_mappings (id, loyalty_category_id, category_id, group_id)
    VALUES
      ('map_liquids', 'loyalty_liquids', 'c_liquids_salt', NULL),
      ('map_devices', 'loyalty_devices', 'c_dynamic_devices', NULL)
  `,
  ).run();
}

function getCategoryId(key) {
  return db.prepare("SELECT id FROM loyalty_categories WHERE key = ?").get(key).id;
}

function createCustomer(id, telegramId) {
  db.prepare(
    `
    INSERT INTO customers (id, telegram_id, telegram_username, first_name, last_visit_at)
    VALUES (?, ?, ?, 'Adv', DATETIME('now'))
  `,
  ).run(id, String(telegramId), `adv_${telegramId}`);
  return id;
}

function createDeliveredOrder({
  orderId,
  customerId,
  orderNumber,
  discountAmount = 0,
  promoCodeText = "",
  items,
}) {
  db.prepare(
    `
    INSERT INTO orders (
      id, order_number, customer_id, status, total_amount, discount_amount,
      final_amount, promo_code_text, created_at, updated_at, completed_at
    ) VALUES (?, ?, ?, 'delivered', ?, ?, ?, ?, DATETIME('now'), DATETIME('now'), DATETIME('now'))
  `,
  ).run(
    orderId,
    orderNumber,
    customerId,
    items.reduce((sum, item) => sum + item.total_price, 0),
    discountAmount,
    Math.max(
      items.reduce((sum, item) => sum + item.total_price, 0) - discountAmount,
      0,
    ),
    promoCodeText || null,
  );

  for (const item of items) {
    db.prepare(
      `
      INSERT INTO order_items (
        id, order_id, product_id, variant_id, product_title, variant_name,
        quantity, price_per_unit, manual_discount_amount, loyalty_discount_amount,
        loyalty_units_applied, discount_amount, total_price, total_cost
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 0)
    `,
    ).run(
      item.id,
      orderId,
      item.product_id,
      item.variant_id ?? null,
      item.product_title,
      item.variant_name ?? null,
      item.quantity,
      item.price_per_unit,
      item.manual_discount_amount ?? 0,
      item.discount_amount ?? item.manual_discount_amount ?? 0,
      item.total_price,
    );
  }
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

console.log("\n--- A1: #9498-like device manual position discount blocks stamp ---");
{
  seedCatalog();
  const customerId = createCustomer("cust_adv_9498", 94981);
  const devicesCategoryId = getCategoryId("devices");

  createDeliveredOrder({
    orderId: "ord_adv_9498",
    customerId,
    orderNumber: 9498,
    items: [
      {
        id: "oi_adv_9498",
        product_id: "device-xros",
        variant_id: "device-xros-black",
        product_title: "XROS 6",
        variant_name: "Slate Black",
        quantity: 1,
        price_per_unit: 100,
        manual_discount_amount: 10,
        total_price: 90,
      },
    ],
  });

  ok(
    isPositionLoyaltyStampBlocked({
      product_id: "device-xros",
      variant_id: "device-xros-black",
      price_per_unit: 100,
      manual_discount_amount: 10,
    }),
    "manual position discount blocks stamp helper",
  );
  ok(isPositionSalePriceReduced({
    product_id: "device-xros",
    variant_id: "device-xros-black",
    price_per_unit: 100,
    manual_discount_amount: 10,
  }) === false, "catalog price unchanged — sale-price helper alone is false");

  const award = awardLoyaltyForOrder("ord_adv_9498");
  ok(award.reason === "nothing_to_award", "9498-like order awards nothing");
  ok(getBalance(customerId, devicesCategoryId) === 0, "9498-like customer devices balance stays 0");
}

console.log("\n--- A2: order-level discount still accrues (8148 regression) ---");
{
  const customerId = createCustomer("cust_adv_8148", 81481);
  const liquidsCategoryId = getCategoryId("liquids");

  createDeliveredOrder({
    orderId: "ord_adv_8148",
    customerId,
    orderNumber: 8148,
    discountAmount: 1,
    items: [
      {
        id: "oi_adv_8148",
        product_id: "liquid-1",
        product_title: "Liquid Cherry",
        quantity: 1,
        price_per_unit: 15,
        manual_discount_amount: 0,
        total_price: 15,
      },
    ],
  });

  const award = awardLoyaltyForOrder("ord_adv_8148");
  ok(award.awarded === true, "order discount alone still awards stamp");
  ok(getBalance(customerId, liquidsCategoryId) === 1, "8148-like accrual is +1 liquids");
}

console.log("\n--- A3: mixed cart — manual discount on one line only ---");
{
  const customerId = createCustomer("cust_adv_mixed_manual", 30001);
  const liquidsCategoryId = getCategoryId("liquids");

  createDeliveredOrder({
    orderId: "ord_adv_mixed_manual",
    customerId,
    orderNumber: 30001,
    items: [
      {
        id: "oi_adv_mixed_ok",
        product_id: "liquid-1",
        product_title: "Liquid Cherry A",
        quantity: 1,
        price_per_unit: 15,
        manual_discount_amount: 0,
        total_price: 15,
      },
      {
        id: "oi_adv_mixed_bad",
        product_id: "liquid-1",
        product_title: "Liquid Cherry B",
        quantity: 1,
        price_per_unit: 15,
        manual_discount_amount: 3,
        total_price: 12,
      },
    ],
  });

  const award = awardLoyaltyForOrder("ord_adv_mixed_manual");
  ok(award.awarded === true, "mixed cart still awards");
  ok(award.rows === 1, "mixed cart awards only the undiscounted line");
  ok(getBalance(customerId, liquidsCategoryId) === 1, "mixed cart balance is +1 not +2");
}

console.log("\n--- A4: order discount + manual position discount on same line ---");
{
  const customerId = createCustomer("cust_adv_both_discounts", 30002);
  const liquidsCategoryId = getCategoryId("liquids");

  createDeliveredOrder({
    orderId: "ord_adv_both_discounts",
    customerId,
    orderNumber: 30002,
    discountAmount: 2,
    items: [
      {
        id: "oi_adv_both",
        product_id: "liquid-1",
        product_title: "Liquid Cherry",
        quantity: 1,
        price_per_unit: 15,
        manual_discount_amount: 1,
        total_price: 14,
      },
    ],
  });

  const award = awardLoyaltyForOrder("ord_adv_both_discounts");
  ok(award.reason === "nothing_to_award", "position manual discount wins over order discount");
  ok(getBalance(customerId, liquidsCategoryId) === 0, "combined discounts do not accrue");
}

console.log("\n--- A5: adversarial inputs on block helper ---");
{
  ok(
    isPositionLoyaltyStampBlocked({
      product_id: "liquid-1",
      price_per_unit: 15,
      manual_discount_amount: -5,
    }) === false,
    "negative manual discount does not block",
  );
  ok(
    isPositionLoyaltyStampBlocked({
      product_id: "liquid-1",
      price_per_unit: 15,
      manual_discount_amount: null,
    }) === false,
    "null manual discount does not block",
  );
  ok(
    isPositionLoyaltyStampBlocked({
      product_id: "liquid-1",
      price_per_unit: 15,
      manual_discount_amount: "10",
    }) === true,
    "string numeric manual discount blocks",
  );
  ok(
    isPositionLoyaltyStampBlocked({
      product_id: "missing-product",
      price_per_unit: 10,
      manual_discount_amount: 0,
    }) === false,
    "unknown product without manual discount does not block via price helper",
  );
}

console.log("\n--- A6: double award attempt stays idempotent ---");
{
  const customerId = createCustomer("cust_adv_idempotent", 30003);
  const liquidsCategoryId = getCategoryId("liquids");

  createDeliveredOrder({
    orderId: "ord_adv_idempotent",
    customerId,
    orderNumber: 30003,
    items: [
      {
        id: "oi_adv_idempotent",
        product_id: "liquid-1",
        product_title: "Liquid Cherry",
        quantity: 1,
        price_per_unit: 15,
        manual_discount_amount: 0,
        total_price: 15,
      },
    ],
  });

  const first = awardLoyaltyForOrder("ord_adv_idempotent");
  const second = awardLoyaltyForOrder("ord_adv_idempotent");
  ok(first.awarded === true, "first award succeeds");
  ok(second.reason === "already_awarded", "second award is rejected");
  ok(getBalance(customerId, liquidsCategoryId) === 1, "balance not doubled");
}

console.log(`\nDone: ${results.passed} passed, ${results.failed} failed\n`);
db.close();
fs.rmSync(tempDir, { recursive: true, force: true });
process.exit(results.failed > 0 ? 1 : 0);