import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { telegramHeaders } from "./helpers/telegram-auth.js";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "navalivay-promo-lifecycle-"));
const tempDbPath = path.join(tempDir, "test.db");

process.env.DATABASE_FILE = tempDbPath;
process.env.BOT_TOKEN = "test-bot-token";
process.env.SESSION_SECRET = "promo-lifecycle-secret";
process.env.NODE_ENV = "test";

const { initDb, db } = await import("../db.js");
const { issueToken } = await import("../auth.js");
const { publicRouter } = await import("../routes/public.js");
const { crmOperationsRouter } = await import("../routes/crm-operations.js");
const { promoRouter } = await import("../routes/promo.js");
const { validatePromoCode } = await import("../promo-code-service.js");

initDb();

const app = express();
app.use(express.json());
app.use(publicRouter);
app.use(crmOperationsRouter);
app.use(promoRouter);

const server = await new Promise((resolve) => {
  const instance = app.listen(0, () => resolve(instance));
});

const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;
const adminToken = issueToken("promo-admin");

function jsonHeaders(extra = {}) {
  return {
    "Content-Type": "application/json",
    ...extra,
  };
}

function adminHeaders() {
  return jsonHeaders({
    Authorization: `Bearer ${adminToken}`,
  });
}

async function requestJson(url, options = {}) {
  const response = await fetch(`${baseUrl}${url}`, options);
  const data = await response.json().catch(() => null);
  return { response, data };
}

function seedProduct({ productId = "product-1", stock = 20 } = {}) {
  db.prepare(
    `
    INSERT OR IGNORE INTO categories (id, slug, name, [order], hide_empty, display_mode)
    VALUES ('cat-test', 'cat-test', 'Test category', 0, 0, 'default')
  `,
  ).run();

  db.prepare(
    `
    INSERT OR IGNORE INTO products (
      id, categoryId, groupId, title, priceRub, description, use_category_image,
      createdAt, cost_price, stock, min_stock, has_variants
    ) VALUES (?, 'cat-test', NULL, 'Liquid Cherry', 15, '', 0, DATETIME('now'), 5, ?, 0, 0)
  `,
  ).run(productId, stock);
}

function seedPromo({
  promoId,
  code,
  discountValue = 3,
  maxUses = 1,
} = {}) {
  db.prepare(
    `
    INSERT INTO promo_codes (
      id, code, description, discount_type, discount_value, min_order_amount, max_uses, current_uses, active
    ) VALUES (?, ?, ?, 'fixed', ?, 0, ?, 0, 1)
  `,
  ).run(
    promoId,
    code,
    `${code} promo`,
    discountValue,
    maxUses,
  );
}

async function createOrder(identity, overrides = {}) {
  const payload = {
    telegram_id: identity.telegram_id,
    telegram_username: identity.telegram_username,
    first_name: identity.first_name || "Promo",
    last_name: identity.last_name || "User",
    delivery_type: "pickup",
    items: [
      {
        product_id: "product-1",
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

async function modifyOrder(orderId, identity, overrides = {}) {
  const payload = {
    telegram_id: identity.telegram_id,
    telegram_username: identity.telegram_username,
    delivery_type: "pickup",
    items: [
      {
        product_id: "product-1",
        variant_id: null,
        quantity: 2,
        price_per_unit: 15,
        product_title: "Liquid Cherry",
        variant_name: null,
      },
    ],
    ...overrides,
  };

  return requestJson(`/api/orders/${orderId}/modify-by-customer`, {
    method: "PUT",
    headers: telegramHeaders(identity),
    body: JSON.stringify(payload),
  });
}

function getOrder(orderId) {
  return db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
}

function getPromo(promoId) {
  return db.prepare("SELECT * FROM promo_codes WHERE id = ?").get(promoId);
}

function getPromoUsageForOrder(orderId) {
  return db
    .prepare("SELECT * FROM promo_usage WHERE order_id = ? ORDER BY rowid ASC")
    .all(orderId);
}

function getCustomerByTelegramId(telegramId) {
  return db
    .prepare("SELECT * FROM customers WHERE telegram_id = ?")
    .get(String(telegramId));
}

function ensureCustomer({ id, telegramId, username }) {
  db.prepare(
    `
    INSERT OR IGNORE INTO customers (
      id, telegram_id, telegram_username, first_name, last_name,
      first_visit_at, last_visit_at, total_orders, total_spent
    ) VALUES (?, ?, ?, 'Promo', 'User', DATETIME('now'), DATETIME('now'), 0, 0)
  `,
  ).run(id, String(telegramId), username);
}

function seedWheelOwnedPromo({
  promoId,
  code,
  ownerCustomerId,
  discountValue = 3,
  maxUses = 1,
} = {}) {
  db.prepare(
    `
    INSERT INTO promo_codes (
      id, code, description, discount_type, discount_value, min_order_amount,
      max_uses, current_uses, active, has_gift, is_wheel_template,
      wheel_owner_customer_id, created_at
    ) VALUES (?, ?, ?, 'fixed', ?, 0, ?, 0, 1, 0, 0, ?, DATETIME('now'))
  `,
  ).run(
    promoId,
    code,
    `${code} wheel promo`,
    discountValue,
    maxUses,
    ownerCustomerId,
  );
}

async function testGiftPromoCanHaveZeroDiscount() {
  const plainZero = await requestJson("/api/admin/crm/promo-codes", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      code: "ZEROPLAIN",
      discount_type: "fixed",
      discount_value: 0,
      has_gift: "0",
      max_uses: 1,
      active: 1,
    }),
  });
  assert.equal(plainZero.response.status, 400);
  assert.equal(plainZero.data.error, "invalid_discount");

  const giftZero = await requestJson("/api/admin/crm/promo-codes", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      code: "GIFTZERO",
      description: "Gift without monetary discount",
      customer_description: "Подарок к заказу",
      manager_description: "Выдать подарок",
      discount_type: "fixed",
      discount_value: 0,
      has_gift: 1,
      max_uses: 1,
      active: 1,
    }),
  });
  assert.equal(giftZero.response.status, 200, JSON.stringify(giftZero.data));
  assert.equal(giftZero.data.discount_value, 0);
  assert.equal(giftZero.data.has_gift, 1);

  const validated = validatePromoCode("GIFTZERO", 15);
  assert.equal(validated.valid, true);
  assert.equal(validated.calculated_discount, 0);
  assert.equal(validated.has_gift, 1);

  const publicValidated = await requestJson("/api/promo/validate", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ code: "GIFTZERO", order_amount: 15 }),
  });
  assert.equal(publicValidated.response.status, 200);
  assert.equal(publicValidated.data.valid, true);
  assert.equal(publicValidated.data.calculated_discount, 0);
  assert.equal(publicValidated.data.has_gift, 1);

  const giftPatch = await requestJson(`/api/admin/crm/promo-codes/${giftZero.data.id}`, {
    method: "PATCH",
    headers: adminHeaders(),
    body: JSON.stringify({
      discount_value: 0,
      has_gift: 1,
      manager_description: "Still a gift",
    }),
  });
  assert.equal(giftPatch.response.status, 200, JSON.stringify(giftPatch.data));
  assert.equal(giftPatch.data.discount_value, 0);
  assert.equal(giftPatch.data.has_gift, 1);

  const ordinary = await requestJson("/api/admin/crm/promo-codes", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      code: "ORDINARY5",
      discount_type: "fixed",
      discount_value: 5,
      has_gift: 0,
      max_uses: 1,
      active: 1,
    }),
  });
  assert.equal(ordinary.response.status, 200, JSON.stringify(ordinary.data));

  const ordinaryZeroPatch = await requestJson(`/api/admin/crm/promo-codes/${ordinary.data.id}`, {
    method: "PATCH",
    headers: adminHeaders(),
    body: JSON.stringify({
      discount_value: 0,
      has_gift: 0,
    }),
  });
  assert.equal(ordinaryZeroPatch.response.status, 400);
  assert.equal(ordinaryZeroPatch.data.error, "invalid_discount");
}

async function testBoundedPromoRequiresStartDateExceptForWheelTemplates() {
  const missingStart = await requestJson("/api/admin/crm/promo-codes", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      code: "DAYS-NO-START",
      discount_type: "fixed",
      discount_value: 5,
      duration_days: 25,
    }),
  });
  assert.equal(missingStart.response.status, 400);
  assert.equal(missingStart.data.error, "valid_from_date_required");

  const bounded = await requestJson("/api/admin/crm/promo-codes", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      code: "DAYS-WITH-START",
      description: "Старый заголовок",
      customer_description: "Старое описание",
      manager_description: "Старая инструкция",
      discount_type: "fixed",
      discount_value: 5,
      valid_from_date: "2026-07-19",
      duration_days: 25,
    }),
  });
  assert.equal(bounded.response.status, 200, JSON.stringify(bounded.data));
  assert.equal(bounded.data.valid_from_date, "2026-07-19");
  assert.equal(bounded.data.duration_days, 25);

  const updated = await requestJson(`/api/admin/crm/promo-codes/${bounded.data.id}`, {
    method: "PATCH",
    headers: adminHeaders(),
    body: JSON.stringify({
      code: "DAYS-UPDATED",
      description: null,
      customer_description: null,
      manager_description: null,
      discount_type: "percent",
      discount_value: 15,
      min_order_amount: 20,
      max_uses: 7,
      valid_from_date: "2026-07-20",
      duration_days: 21,
      active: 0,
    }),
  });
  assert.equal(updated.response.status, 200, JSON.stringify(updated.data));

  const reopened = await requestJson(`/api/admin/crm/promo-codes/${bounded.data.id}`, {
    method: "GET",
    headers: adminHeaders(),
  });
  assert.equal(reopened.response.status, 200, JSON.stringify(reopened.data));
  assert.equal(reopened.data.code, "DAYS-UPDATED");
  assert.equal(reopened.data.description, null);
  assert.equal(reopened.data.customer_description, null);
  assert.equal(reopened.data.manager_description, null);
  assert.equal(reopened.data.discount_type, "percent");
  assert.equal(reopened.data.discount_value, 15);
  assert.equal(reopened.data.min_order_amount, 20);
  assert.equal(reopened.data.max_uses, 7);
  assert.equal(reopened.data.valid_from_date, "2026-07-20");
  assert.equal(reopened.data.duration_days, 21);
  assert.equal(reopened.data.effective_valid_until_date, "2026-08-09");
  assert.equal(reopened.data.active, 0);

  const invalidPatch = await requestJson(`/api/admin/crm/promo-codes/${bounded.data.id}`, {
    method: "PATCH",
    headers: adminHeaders(),
    body: JSON.stringify({ valid_from_date: null, duration_days: 21 }),
  });
  assert.equal(invalidPatch.response.status, 400);
  assert.equal(invalidPatch.data.error, "valid_from_date_required");

  const wheelWithoutTitle = await requestJson("/api/admin/crm/promo-codes", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      code: "WHEEL-NO-TITLE",
      discount_type: "fixed",
      discount_value: 5,
      duration_days: 21,
      is_wheel_template: 1,
    }),
  });
  assert.equal(wheelWithoutTitle.response.status, 400);
  assert.equal(wheelWithoutTitle.data.error, "prize_title_required");

  const wheelTemplate = await requestJson("/api/admin/crm/promo-codes", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      code: "WHEEL-RELATIVE-DAYS",
      description: "Приз рулетки",
      discount_type: "fixed",
      discount_value: 5,
      duration_days: 21,
      is_wheel_template: 1,
    }),
  });
  assert.equal(wheelTemplate.response.status, 200, JSON.stringify(wheelTemplate.data));
  assert.equal(wheelTemplate.data.valid_from_date, null);
  assert.equal(wheelTemplate.data.duration_days, 21);
  assert.equal(wheelTemplate.data.is_wheel_template, 1);

  const clearedWheelTitle = await requestJson(`/api/admin/crm/promo-codes/${wheelTemplate.data.id}`, {
    method: "PATCH",
    headers: adminHeaders(),
    body: JSON.stringify({ description: null }),
  });
  assert.equal(clearedWheelTitle.response.status, 400);
  assert.equal(clearedWheelTitle.data.error, "prize_title_required");
}

async function testPromoReservationCanBeReusedBySameOrder() {
  const promoId = "promo-reserved";
  const promoCode = "SAVE3A";
  seedPromo({ promoId, code: promoCode });

  const identity = {
    telegram_id: "promo-user-1",
    telegram_username: "promo_user_1",
  };

  const created = await createOrder(identity, { promo_code: promoCode });
  assert.equal(created.response.status, 200);
  const orderId = created.data.order_id;

  let usageRows = getPromoUsageForOrder(orderId);
  assert.equal(usageRows.length, 1);
  assert.equal(usageRows[0].status, "reserved");
  assert.equal(usageRows[0].used_at, null);
  assert.equal(getPromo(promoId).current_uses, 1);

  const blocked = await requestJson("/api/promo/validate", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ code: promoCode, order_amount: 15 }),
  });
  assert.equal(blocked.response.status, 200);
  assert.equal(blocked.data.valid, false);
  assert.equal(blocked.data.error, "max_uses_reached");

  const sameOrder = await requestJson("/api/promo/validate", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      code: promoCode,
      order_amount: 30,
      editing_order_id: orderId,
    }),
  });
  assert.equal(sameOrder.response.status, 200);
  assert.equal(sameOrder.data.valid, true);
  assert.equal(sameOrder.data.calculated_discount, 3);

  const modified = await modifyOrder(orderId, identity, { promo_code: promoCode });
  assert.equal(modified.response.status, 200);

  const updatedOrder = getOrder(orderId);
  assert.equal(updatedOrder.total_amount, 30);
  assert.equal(updatedOrder.discount_amount, 3);
  assert.equal(updatedOrder.final_amount, 27);

  usageRows = getPromoUsageForOrder(orderId);
  assert.equal(usageRows.length, 1);
  assert.equal(usageRows[0].status, "reserved");
  assert.equal(usageRows[0].used_at, null);
  assert.equal(getPromo(promoId).current_uses, 1);

  const cancelled = await requestJson(`/api/orders/${orderId}/cancel-by-customer`, {
    method: "POST",
    headers: telegramHeaders(identity),
    body: JSON.stringify(identity),
  });
  assert.equal(cancelled.response.status, 200);
  assert.equal(getPromoUsageForOrder(orderId).length, 0);
  assert.equal(getPromo(promoId).current_uses, 0);

  const secondIdentity = {
    telegram_id: "promo-user-2",
    telegram_username: "promo_user_2",
  };
  const recreated = await createOrder(secondIdentity, { promo_code: promoCode });
  assert.equal(recreated.response.status, 200);
}

async function testPromoSwitchAndRemovalOnSameOrder() {
  const firstPromoId = "promo-switch-a";
  const firstPromoCode = "SAVE3D";
  const secondPromoId = "promo-switch-b";
  const secondPromoCode = "SAVE5D";

  seedPromo({ promoId: firstPromoId, code: firstPromoCode, discountValue: 3 });
  seedPromo({ promoId: secondPromoId, code: secondPromoCode, discountValue: 5 });

  const identity = {
    telegram_id: "promo-user-5",
    telegram_username: "promo_user_5",
  };

  const created = await createOrder(identity, { promo_code: firstPromoCode });
  assert.equal(created.response.status, 200);
  const orderId = created.data.order_id;

  let order = getOrder(orderId);
  assert.equal(order.promo_code_id, firstPromoId);
  assert.equal(order.promo_code_text, firstPromoCode);
  assert.equal(getPromo(firstPromoId).current_uses, 1);
  assert.equal(getPromo(secondPromoId).current_uses, 0);

  const switched = await modifyOrder(orderId, identity, {
    promo_code: secondPromoCode,
  });
  assert.equal(switched.response.status, 200);

  order = getOrder(orderId);
  assert.equal(order.promo_code_id, secondPromoId);
  assert.equal(order.promo_code_text, secondPromoCode);

  let usageRows = getPromoUsageForOrder(orderId);
  assert.equal(usageRows.length, 1);
  assert.equal(usageRows[0].promo_code_id, secondPromoId);
  assert.equal(usageRows[0].status, "reserved");
  assert.equal(getPromo(firstPromoId).current_uses, 0);
  assert.equal(getPromo(secondPromoId).current_uses, 1);

  const anotherIdentity = {
    telegram_id: "promo-user-6",
    telegram_username: "promo_user_6",
  };
  const reusedOriginalPromo = await createOrder(anotherIdentity, {
    promo_code: firstPromoCode,
  });
  assert.equal(reusedOriginalPromo.response.status, 200);

  const cleared = await modifyOrder(orderId, identity, { promo_code: null });
  assert.equal(cleared.response.status, 200);

  order = getOrder(orderId);
  assert.equal(order.promo_code_id, null);
  assert.equal(order.promo_code_text, null);

  usageRows = getPromoUsageForOrder(orderId);
  assert.equal(usageRows.length, 0);
  assert.equal(getPromo(secondPromoId).current_uses, 0);

  const thirdIdentity = {
    telegram_id: "promo-user-7",
    telegram_username: "promo_user_7",
  };
  const reusedSwitchedPromo = await createOrder(thirdIdentity, {
    promo_code: secondPromoCode,
  });
  assert.equal(reusedSwitchedPromo.response.status, 200);
}

async function testPromoConsumedAndReturnedToReservedByAdmin() {
  const promoId = "promo-admin-status";
  const promoCode = "SAVE3B";
  seedPromo({ promoId, code: promoCode });

  const identity = {
    telegram_id: "promo-user-3",
    telegram_username: "promo_user_3",
  };
  const created = await createOrder(identity, { promo_code: promoCode });
  assert.equal(created.response.status, 200);
  const orderId = created.data.order_id;

  const delivered = await requestJson(`/api/admin/crm/orders/${orderId}`, {
    method: "PATCH",
    headers: adminHeaders(),
    body: JSON.stringify({ status: "delivered" }),
  });
  assert.equal(delivered.response.status, 200);

  let usageRows = getPromoUsageForOrder(orderId);
  assert.equal(usageRows.length, 1);
  assert.equal(usageRows[0].status, "consumed");
  assert.ok(usageRows[0].used_at);
  assert.equal(getPromo(promoId).current_uses, 1);

  const usage = await requestJson(`/api/admin/crm/promo-codes/${promoId}/usage`, {
    method: "GET",
    headers: adminHeaders(),
  });
  assert.equal(usage.response.status, 200);
  assert.equal(Array.isArray(usage.data), true);
  assert.equal(usage.data.length, 1);
  assert.equal(usage.data[0].status, "consumed");

  const reopened = await requestJson(`/api/admin/crm/orders/${orderId}`, {
    method: "PATCH",
    headers: adminHeaders(),
    body: JSON.stringify({ status: "new" }),
  });
  assert.equal(reopened.response.status, 200);

  usageRows = getPromoUsageForOrder(orderId);
  assert.equal(usageRows.length, 1);
  assert.equal(usageRows[0].status, "reserved");
  assert.equal(usageRows[0].used_at, null);
  assert.equal(getPromo(promoId).current_uses, 1);
}

async function testIssueAndPaymentRollbackSyncPromoUsage() {
  const promoId = "promo-payment";
  const promoCode = "SAVE3C";
  seedPromo({ promoId, code: promoCode });

  const identity = {
    telegram_id: "promo-user-4",
    telegram_username: "promo_user_4",
  };
  const created = await createOrder(identity, { promo_code: promoCode });
  assert.equal(created.response.status, 200);
  const orderId = created.data.order_id;

  const inProgress = await requestJson(`/api/admin/crm/orders/${orderId}`, {
    method: "PATCH",
    headers: adminHeaders(),
    body: JSON.stringify({ status: "in_progress" }),
  });
  assert.equal(inProgress.response.status, 200);

  const issued = await requestJson(`/api/admin/crm/orders/${orderId}/issue`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      payment_type: "cash",
      payment_account_id: "acc_default",
      amount: 12,
    }),
  });
  assert.equal(issued.response.status, 200);

  let usageRows = getPromoUsageForOrder(orderId);
  assert.equal(usageRows.length, 1);
  assert.equal(usageRows[0].status, "consumed");
  assert.ok(usageRows[0].used_at);

  const paymentRemoved = await requestJson(
    `/api/admin/crm/orders/${orderId}/payment`,
    {
      method: "DELETE",
      headers: adminHeaders(),
    },
  );
  assert.equal(paymentRemoved.response.status, 200);

  usageRows = getPromoUsageForOrder(orderId);
  assert.equal(usageRows.length, 1);
  assert.equal(usageRows[0].status, "reserved");
  assert.equal(usageRows[0].used_at, null);
  assert.equal(getPromo(promoId).current_uses, 1);
}

async function testAdminPromoSourceFiltersSeparateWheelCodes() {
  seedPromo({ promoId: "promo-source-regular", code: "SOURCE-REGULAR" });
  seedPromo({ promoId: "promo-source-wheel-template", code: "SOURCE-WHEEL-TEMPLATE" });
  seedPromo({ promoId: "promo-source-wheel-issued", code: "SOURCE-WHEEL-ISSUED" });
  db.prepare("UPDATE promo_codes SET is_wheel_template = 1 WHERE id = ?").run(
    "promo-source-wheel-template",
  );
  db.prepare("UPDATE promo_codes SET wheel_owner_customer_id = ? WHERE id = ?").run(
    "customer-source-wheel",
    "promo-source-wheel-issued",
  );

  const regular = await requestJson("/api/admin/crm/promo-codes?source=regular&limit=200", {
    headers: adminHeaders(),
  });
  assert.equal(regular.response.status, 200);
  const regularCodes = regular.data.promo_codes.map((promo) => promo.code);
  assert.ok(regularCodes.includes("SOURCE-REGULAR"));
  assert.ok(!regularCodes.includes("SOURCE-WHEEL-TEMPLATE"));
  assert.ok(!regularCodes.includes("SOURCE-WHEEL-ISSUED"));

  const wheel = await requestJson("/api/admin/crm/promo-codes?source=wheel&limit=200", {
    headers: adminHeaders(),
  });
  assert.equal(wheel.response.status, 200);
  const wheelCodes = wheel.data.promo_codes.map((promo) => promo.code);
  assert.ok(!wheelCodes.includes("SOURCE-REGULAR"));
  assert.ok(wheelCodes.includes("SOURCE-WHEEL-TEMPLATE"));
  assert.ok(wheelCodes.includes("SOURCE-WHEEL-ISSUED"));

  const all = await requestJson("/api/admin/crm/promo-codes?source=all&limit=200", {
    headers: adminHeaders(),
  });
  assert.equal(all.response.status, 200);
  const allCodes = all.data.promo_codes.map((promo) => promo.code);
  assert.ok(allCodes.includes("SOURCE-REGULAR"));
  assert.ok(allCodes.includes("SOURCE-WHEEL-TEMPLATE"));
  assert.ok(allCodes.includes("SOURCE-WHEEL-ISSUED"));
}

async function testWheelOwnedPromoCanOnlyBeUsedByWinner() {
  const ownerIdentity = {
    telegram_id: "910001",
    telegram_username: "promo_wheel_owner",
  };
  const otherIdentity = {
    telegram_id: "910002",
    telegram_username: "promo_wheel_other",
  };

  ensureCustomer({
    id: "cust-promo-wheel-owner",
    telegramId: ownerIdentity.telegram_id,
    username: ownerIdentity.telegram_username,
  });
  const ownerCustomerId = getCustomerByTelegramId(ownerIdentity.telegram_id)?.id;
  assert.ok(ownerCustomerId);

  ensureCustomer({
    id: "cust-promo-wheel-other",
    telegramId: otherIdentity.telegram_id,
    username: otherIdentity.telegram_username,
  });
  const otherCustomerId = getCustomerByTelegramId(otherIdentity.telegram_id)?.id;
  assert.ok(otherCustomerId);

  const promoId = "promo-wheel-owned";
  const promoCode = "WHEEL-OWNER1";
  seedWheelOwnedPromo({ promoId, code: promoCode, ownerCustomerId });

  const ownerValidated = await requestJson("/api/promo/validate", {
    method: "POST",
    headers: telegramHeaders(ownerIdentity),
    body: JSON.stringify({ code: promoCode, order_amount: 15 }),
  });
  assert.equal(ownerValidated.response.status, 200);
  assert.equal(ownerValidated.data.valid, true);

  const otherValidated = await requestJson("/api/promo/validate", {
    method: "POST",
    headers: telegramHeaders(otherIdentity),
    body: JSON.stringify({ code: promoCode, order_amount: 15 }),
  });
  assert.equal(otherValidated.response.status, 200);
  assert.equal(otherValidated.data.valid, false);
  assert.equal(otherValidated.data.error, "wheel_promo_owner_mismatch");

  const otherCreate = await createOrder(otherIdentity, { promo_code: promoCode });
  assert.equal(otherCreate.response.status, 400);
  assert.equal(otherCreate.data.error, "invalid_promo");
  assert.equal(getPromo(promoId).current_uses, 0);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM promo_usage WHERE promo_code_id = ?").get(promoId)
      .count,
    0,
  );

  const otherBaseOrder = await createOrder(otherIdentity);
  assert.equal(otherBaseOrder.response.status, 200);
  const otherModify = await modifyOrder(otherBaseOrder.data.order_id, otherIdentity, {
    promo_code: promoCode,
  });
  assert.equal(otherModify.response.status, 400);
  assert.equal(otherModify.data.error, "invalid_promo");
  assert.equal(getPromo(promoId).current_uses, 0);

  const ownerCreate = await createOrder(ownerIdentity, { promo_code: promoCode });
  assert.equal(ownerCreate.response.status, 200, JSON.stringify(ownerCreate.data));
  const ownerOrder = getOrder(ownerCreate.data.order_id);
  assert.equal(ownerOrder.promo_code_id, promoId);
  assert.equal(ownerOrder.promo_code_text, promoCode);
  assert.equal(getPromo(promoId).current_uses, 1);
  const usageRows = getPromoUsageForOrder(ownerCreate.data.order_id);
  assert.equal(usageRows.length, 1);
  assert.equal(usageRows[0].customer_id, ownerCustomerId);
}

async function testWheelTemplatePromoCannotBeAppliedDirectly() {
  const identity = {
    telegram_id: "910003",
    telegram_username: "promo_wheel_template_user",
  };
  const promoId = "promo-wheel-template-direct";
  const promoCode = "WHEEL-TEMPLATE-DIRECT";
  seedPromo({ promoId, code: promoCode, maxUses: 0 });
  db.prepare("UPDATE promo_codes SET is_wheel_template = 1 WHERE id = ?").run(promoId);

  const validated = await requestJson("/api/promo/validate", {
    method: "POST",
    headers: telegramHeaders(identity),
    body: JSON.stringify({ code: promoCode, order_amount: 15 }),
  });
  assert.equal(validated.response.status, 200);
  assert.equal(validated.data.valid, false);
  assert.equal(validated.data.error, "wheel_template_not_applicable");

  const created = await createOrder(identity, { promo_code: promoCode });
  assert.equal(created.response.status, 400);
  assert.equal(created.data.error, "invalid_promo");
  assert.equal(getPromo(promoId).current_uses, 0);
}

async function main() {
  seedProduct();

  await testGiftPromoCanHaveZeroDiscount();
  await testBoundedPromoRequiresStartDateExceptForWheelTemplates();
  await testPromoReservationCanBeReusedBySameOrder();
  await testPromoSwitchAndRemovalOnSameOrder();
  await testPromoConsumedAndReturnedToReservedByAdmin();
  await testIssueAndPaymentRollbackSyncPromoUsage();
  await testAdminPromoSourceFiltersSeparateWheelCodes();
  await testWheelOwnedPromoCanOnlyBeUsedByWinner();
  await testWheelTemplatePromoCannotBeAppliedDirectly();

  console.log("[promo-lifecycle-smoke] OK");
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
