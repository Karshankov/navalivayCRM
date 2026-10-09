import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { buildTelegramInitData, telegramHeaders } from "./helpers/telegram-auth.js";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "navalivay-public-order-"));
const tempDbPath = path.join(tempDir, "test.db");

process.env.DATABASE_FILE = tempDbPath;
process.env.BOT_TOKEN = "test-bot-token";
process.env.NODE_ENV = "test";
process.env.TEST_PUBLIC_MINIAPP_MUTATION_RATE_LIMIT_MAX = "1000";

const { initDb, db } = await import("../db.js");
const { publicRouter } = await import("../routes/public.js");
const { crmFinanceRouter } = await import("../routes/crm-finance.js");

initDb();

const app = express();
app.use(express.json());
app.use(publicRouter);
app.use(crmFinanceRouter);

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

function seedProduct({ productId = "product-1", stock = 10 } = {}) {
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

async function createOrder(identity, overrides = {}) {
  const payload = {
    telegram_id: identity.telegram_id,
    telegram_username: identity.telegram_username,
    first_name: identity.first_name || "Test",
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

async function authorizeReferral(identity, inviterUsername) {
  return requestJson("/api/referral-authorization/authorize", {
    method: "POST",
    headers: telegramHeaders(identity),
    body: JSON.stringify(
      typeof inviterUsername === "undefined"
        ? {}
        : { inviter_username: inviterUsername },
    ),
  });
}

function getOrderById(orderId) {
  return db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
}

function getCustomerById(customerId) {
  return db.prepare("SELECT * FROM customers WHERE id = ?").get(customerId);
}

function getOrderItems(orderId) {
  return db
    .prepare("SELECT * FROM order_items WHERE order_id = ? ORDER BY rowid ASC")
    .all(orderId);
}

function getProductStock() {
  return db.prepare("SELECT stock FROM products WHERE id = 'product-1'").get().stock;
}

function markOrderInProgress(orderId) {
  db.prepare(
    `
    UPDATE orders
    SET status = 'in_progress',
        stock_deducted = 1,
        updated_at = DATETIME('now')
    WHERE id = ?
  `,
  ).run(orderId);
}

async function testCreateAndDuplicateGuard() {
  const identity = {
    telegram_id: "1001",
    telegram_username: "customer_guard",
  };

  const first = await createOrder(identity);
  assert.equal(first.response.status, 200);
  assert.equal(first.data.success, true);

  const order = getOrderById(first.data.order_id);
  const pickupCell = db.prepare(
    `SELECT id, cell_number FROM order_pickup_cell_assignments
      WHERE order_id = ? AND released_at IS NULL`,
  ).get(first.data.order_id);
  assert.equal(order.status, "new");
  assert.equal(pickupCell.cell_number, 1);
  assert.equal(first.data.pickup_cell_number, 1);
  assert.equal(order.stock_deducted, 0);
  assert.equal(getProductStock(), 10);

  db.prepare("UPDATE orders SET order_number = 99991 WHERE id = ?").run(first.data.order_id);
  const active = await requestJson("/api/orders/my-active", {
    headers: telegramHeaders(identity),
  });
  assert.equal(active.response.status, 200);
  assert.equal(active.data.order_number, pickupCell.cell_number);
  assert.equal(active.data.pickup_cell_number, pickupCell.cell_number);
  assert.notEqual(active.data.order_number, 99991);

  const second = await createOrder(identity);
  assert.equal(second.response.status, 409);
  assert.equal(second.data.error, "active_order_exists");
}

async function testModifyNewOrder() {
  const identity = {
    telegram_id: "1002",
    telegram_username: "customer_modify_new",
  };

  const created = await createOrder(identity);
  const orderId = created.data.order_id;
  const assignmentBefore = db.prepare(
    `SELECT id FROM order_pickup_cell_assignments
      WHERE order_id = ? AND released_at IS NULL`,
  ).get(orderId);

  const updated = await requestJson(`/api/orders/${orderId}/modify-by-customer`, {
    method: "PUT",
    headers: telegramHeaders(identity),
    body: JSON.stringify({
      ...identity,
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
    }),
  });

  assert.equal(updated.response.status, 200);

  const order = getOrderById(orderId);
  const items = getOrderItems(orderId);

  assert.equal(order.status, "new");
  assert.equal(order.needs_manager_action, 1);
  assert.equal(order.manager_action_type, "modified");
  assert.equal(
    db.prepare(
      `SELECT id FROM order_pickup_cell_assignments
        WHERE order_id = ? AND released_at IS NULL`,
    ).get(orderId).id,
    assignmentBefore.id,
  );
  assert.equal(items[0].quantity, 2);
}

async function testModifyInProgressOrderRestoresStock() {
  const identity = {
    telegram_id: "1003",
    telegram_username: "customer_modify_progress",
  };

  const created = await createOrder(identity);
  const orderId = created.data.order_id;

  markOrderInProgress(orderId);
  db.prepare("UPDATE products SET stock = stock - 1 WHERE id = 'product-1'").run();

  const updated = await requestJson(`/api/orders/${orderId}/modify-by-customer`, {
    method: "PUT",
    headers: telegramHeaders(identity),
    body: JSON.stringify({
      ...identity,
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
    }),
  });

  assert.equal(updated.response.status, 200);

  const order = getOrderById(orderId);
  const items = getOrderItems(orderId);

  assert.equal(order.status, "new");
  assert.equal(order.needs_manager_action, 1);
  assert.equal(order.manager_action_type, "modified");
  assert.equal(order.stock_deducted, 0);
  assert.equal(items[0].quantity, 2);
  assert.equal(getProductStock(), 10);

  const modifiedAgain = await requestJson(
    `/api/orders/${orderId}/modify-by-customer`,
    {
      method: "PUT",
      headers: telegramHeaders(identity),
      body: JSON.stringify({
        ...identity,
        delivery_type: "pickup",
        items: [
          {
            product_id: "product-1",
            variant_id: null,
            quantity: 3,
            price_per_unit: 15,
            product_title: "Liquid Cherry",
            variant_name: null,
          },
        ],
      }),
    },
  );
  assert.equal(modifiedAgain.response.status, 200);
  assert.equal(getOrderById(orderId).previous_status, "in_progress");

  const cancelledAfterModification = await requestJson(
    `/api/orders/${orderId}/cancel-by-customer`,
    {
      method: "POST",
      headers: telegramHeaders(identity),
      body: JSON.stringify(identity),
    },
  );
  assert.equal(cancelledAfterModification.response.status, 200);
  assert.equal(cancelledAfterModification.data.needs_manager_action, 1);
  assert.equal(
    db.prepare(
      `SELECT COUNT(*) AS count FROM order_pickup_cell_assignments
        WHERE order_id = ? AND released_at IS NULL`,
    ).get(orderId).count,
    1,
  );
}

async function testCancelNewOrder() {
  const identity = {
    telegram_id: "1004",
    telegram_username: "customer_cancel_new",
  };

  const created = await createOrder(identity);
  const orderId = created.data.order_id;

  const cancelled = await requestJson(`/api/orders/${orderId}/cancel-by-customer`, {
    method: "POST",
    headers: telegramHeaders(identity),
    body: JSON.stringify(identity),
  });

  assert.equal(cancelled.response.status, 200);

  const order = getOrderById(orderId);
  assert.equal(order.status, "cancelled");
  assert.equal(order.needs_manager_action, 0);
  assert.equal(
    db.prepare(
      `SELECT COUNT(*) AS count FROM order_pickup_cell_assignments
        WHERE order_id = ? AND released_at IS NULL`,
    ).get(orderId).count,
    0,
  );
}

async function testCancelInProgressOrder() {
  const identity = {
    telegram_id: "1005",
    telegram_username: "customer_cancel_progress",
  };

  const created = await createOrder(identity);
  const orderId = created.data.order_id;

  markOrderInProgress(orderId);
  db.prepare("UPDATE products SET stock = stock - 1 WHERE id = 'product-1'").run();

  const cancelled = await requestJson(`/api/orders/${orderId}/cancel-by-customer`, {
    method: "POST",
    headers: telegramHeaders(identity),
    body: JSON.stringify(identity),
  });

  assert.equal(cancelled.response.status, 200);

  const order = getOrderById(orderId);
  assert.equal(order.status, "cancelled");
  assert.equal(order.needs_manager_action, 1);
  assert.equal(order.manager_action_type, "cancelled_by_customer");
  assert.equal(
    db.prepare(
      `SELECT COUNT(*) AS count FROM order_pickup_cell_assignments
        WHERE order_id = ? AND released_at IS NULL`,
    ).get(orderId).count,
    1,
  );
  assert.equal(order.stock_deducted, 0);
  assert.equal(getProductStock(), 10);
}

async function testClientPriceIsIgnored() {
  const identity = {
    telegram_id: "1006",
    telegram_username: "customer_price_guard",
  };

  const created = await createOrder(identity, {
    items: [
      {
        product_id: "product-1",
        variant_id: null,
        quantity: 2,
        price_per_unit: 1,
        product_title: "Liquid Cherry",
        variant_name: null,
      },
    ],
  });

  assert.equal(created.response.status, 200);
  const order = getOrderById(created.data.order_id);
  const items = getOrderItems(created.data.order_id);

  assert.equal(Number(order.total_amount || 0), 30);
  assert.equal(Number(items[0].price_per_unit || 0), 15);
}

async function testCatalogDiscountSnapshot() {
  const { saveDiscount } = await import("../utils/catalog-discounts.js");
  const identity = { telegram_id: "1010", telegram_username: "discount_snapshot" };
  const line = {
    product_id: "product-1",
    variant_id: null,
    quantity: 2,
    product_title: "Liquid Cherry",
    variant_name: null,
  };

  saveDiscount("product", "product-1", { price: 12, untilDate: null });
  const created = await createOrder(identity, { items: [line] });
  assert.equal(created.response.status, 200, JSON.stringify(created.data));

  const [item] = getOrderItems(created.data.order_id);
  // Продали по 12, а по каталогу товар стоит 15: в позиции видно и то, и другое.
  assert.equal(Number(item.price_per_unit), 12);
  assert.equal(Number(item.base_price_per_unit), 15);
  assert.equal(Number(item.catalog_discount_per_unit), 3);

  // Отменяем, иначе следующий заказ упрётся в «у вас уже есть активный».
  await requestJson(`/api/orders/${created.data.order_id}/cancel-by-customer`, {
    method: "POST",
    headers: telegramHeaders(identity),
    body: JSON.stringify(identity),
  });

  saveDiscount("product", "product-1", { price: null });
  const withoutDiscount = await createOrder(identity, { items: [line] });
  assert.equal(withoutDiscount.response.status, 200);

  const [plainItem] = getOrderItems(withoutDiscount.data.order_id);
  // Ноль, а не NULL: про этот заказ мы точно знаем, что скидки не было.
  assert.equal(Number(plainItem.price_per_unit), 15);
  assert.equal(Number(plainItem.base_price_per_unit), 15);
  assert.equal(Number(plainItem.catalog_discount_per_unit), 0);

  // Ячейки выдачи общие на весь файл: не отпустим свою, и следующему тесту
  // просто не хватит свободной.
  await requestJson(`/api/orders/${withoutDiscount.data.order_id}/cancel-by-customer`, {
    method: "POST",
    headers: telegramHeaders(identity),
    body: JSON.stringify(identity),
  });
}

async function testMissingTelegramAuthIsRejected() {
  const created = await requestJson("/api/orders", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      telegram_id: "1007",
      telegram_username: "customer_without_auth",
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
    }),
  });

  assert.equal(created.response.status, 401);
  assert.equal(created.data.error, "telegram_auth_required");
}

async function testInvalidTelegramSignatureIsRejected() {
  const identity = {
    telegram_id: "1008",
    telegram_username: "customer_bad_signature",
  };

  const created = await requestJson("/api/orders", {
    method: "POST",
    headers: {
      ...jsonHeaders(),
      "X-Telegram-Init-Data": buildTelegramInitData(identity, "wrong-test-bot-token"),
    },
    body: JSON.stringify({
      ...identity,
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
    }),
  });

  assert.equal(created.response.status, 401);
  assert.equal(created.data.error, "telegram_auth_invalid");
}

async function testBodyIdentitySpoofIsIgnored() {
  const identity = {
    telegram_id: "1009",
    telegram_username: "customer_header_identity",
  };

  const created = await createOrder(identity, {
    telegram_id: "9999",
    telegram_username: "spoofed_body_identity",
  });

  assert.equal(created.response.status, 200);

  const order = getOrderById(created.data.order_id);
  const customer = getCustomerById(order.customer_id);
  assert.equal(customer.telegram_id, "1009");
  assert.equal(customer.telegram_username, "customer_header_identity");
  assert.equal(order.telegram_username, "customer_header_identity");
}

async function testForeignOrderAccessIsRejected() {
  const owner = {
    telegram_id: "1010",
    telegram_username: "customer_owner",
  };
  const attacker = {
    telegram_id: "1011",
    telegram_username: "customer_attacker",
  };

  const created = await createOrder(owner);
  assert.equal(created.response.status, 200);
  const orderId = created.data.order_id;

  const activeForAttacker = await requestJson(`/api/orders/my-active?telegram_id=${owner.telegram_id}`, {
    headers: telegramHeaders(attacker),
  });
  assert.equal(activeForAttacker.response.status, 200);
  assert.equal(activeForAttacker.data.found, false);

  const modifyAttempt = await requestJson(`/api/orders/${orderId}/modify-by-customer`, {
    method: "PUT",
    headers: telegramHeaders(attacker),
    body: JSON.stringify({
      telegram_id: owner.telegram_id,
      telegram_username: owner.telegram_username,
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
    }),
  });
  assert.equal(modifyAttempt.response.status, 404);
  assert.equal(modifyAttempt.data.error, "not_found");

  const cancelAttempt = await requestJson(`/api/orders/${orderId}/cancel-by-customer`, {
    method: "POST",
    headers: telegramHeaders(attacker),
    body: JSON.stringify({
      telegram_id: owner.telegram_id,
      telegram_username: owner.telegram_username,
    }),
  });
  assert.equal(cancelAttempt.response.status, 404);
  assert.equal(cancelAttempt.data.error, "not_found");
}

async function testReferralAuthorizationOrderFlow() {
  const {
    addDisallowedInviterUsernames,
    createInviteBan,
    removeDisallowedInviterUsername,
    removeInviteBan,
    setReferralAuthorizationEnabled,
  } = await import('../utils/referral-authorization.js');
  const { createBlock, unblockCustomerBlock } = await import('../utils/customer-blocks.js');
  setReferralAuthorizationEnabled(true);

  db.prepare(`
    INSERT INTO customers (
      id, telegram_id, telegram_username, first_visit_at, total_orders, total_spent,
      access_authorized_at, access_authorization_source
    ) VALUES ('referrer', '7000', 'trusted_referrer', DATETIME('now'), 1, 20, DATETIME('now'), 'legacy')
  `).run();
  db.prepare(`
    INSERT INTO orders (
      id, order_number, customer_id, status, delivery_type,
      total_amount, final_amount, created_at, updated_at
    ) VALUES ('referrer-order', 9001, 'referrer', 'delivered', 'pickup', 20, 20, DATETIME('now'), DATETIME('now'))
  `).run();

  addDisallowedInviterUsernames(['@trusted_referrer'], 'test');
  const reservedEntryIdentity = { telegram_id: '7040', telegram_username: 'reserved_entry' };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const reservedEntry = await authorizeReferral(reservedEntryIdentity, '@TRUSTED_REFERRER');
    assert.equal(reservedEntry.response.status, 422);
    assert.equal(reservedEntry.data.error, 'referral_inviter_reserved');
    assert.equal(reservedEntry.data.attempts_remaining, 3);
  }
  assert.equal(db.prepare("SELECT COUNT(*) count FROM customers WHERE telegram_id = '7040'").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM referral_auth_states WHERE telegram_id = '7040'").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM customer_blocks b JOIN customers c ON c.id = b.customer_id WHERE c.telegram_id = '7040' AND b.active = 1").get().count, 0);

  const reservedOrderIdentity = { telegram_id: '7041', telegram_username: 'reserved_order' };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const reservedOrder = await createOrder(reservedOrderIdentity, { inviter_username: 'trusted_referrer' });
    assert.equal(reservedOrder.response.status, 422);
    assert.equal(reservedOrder.data.error, 'referral_inviter_reserved');
    assert.equal(reservedOrder.data.attempts_remaining, 3);
  }
  assert.equal(db.prepare("SELECT COUNT(*) count FROM customers WHERE telegram_id = '7041'").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM referral_auth_states WHERE telegram_id = '7041'").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM customer_blocks b JOIN customers c ON c.id = b.customer_id WHERE c.telegram_id = '7041' AND b.active = 1").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM customer_referrals").get().count, 0);

  // Изменение настройки применяется к следующей авторизации сразу.
  assert.equal(removeDisallowedInviterUsername('TRUSTED_REFERRER'), true);
  const afterRemoval = await authorizeReferral(reservedEntryIdentity, 'trusted_referrer');
  assert.equal(afterRemoval.response.status, 200);
  assert.equal(afterRemoval.data.authorized, true);

  // Telegram не обновляет initDataUnsafe, если пользователь свернул Mini App,
  // добавил username и вернулся. Повторная проверка и сама авторизация должны
  // получить свежий username по подписанному telegram_id, не доверяя query/body.
  const nativeFetch = globalThis.fetch;
  const liveUsernameIdentity = { telegram_id: '7045' };
  const telegramChatIds = [];
  let telegramAvailable = true;
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    if (url.startsWith('https://api.telegram.org/')) {
      const chatId = new URL(url).searchParams.get('chat_id');
      telegramChatIds.push(chatId);
      if (!telegramAvailable) throw new Error('telegram temporarily unavailable');
      assert.equal(chatId, liveUsernameIdentity.telegram_id);
      return new Response(JSON.stringify({
        ok: true,
        result: {
          id: 7045,
          username: 'fresh_live_username',
          first_name: 'Fresh',
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return nativeFetch(input, options);
  };
  try {
    telegramAvailable = false;
    const unavailableAuthorization = await authorizeReferral(
      { telegram_id: '7044' },
      'trusted_referrer',
    );
    assert.equal(unavailableAuthorization.response.status, 428);
    assert.equal(unavailableAuthorization.data.error, 'telegram_username_not_verified');
    assert.match(unavailableAuthorization.data.message, /Не удалось проверить обновлённый username/);
    assert.doesNotMatch(unavailableAuthorization.data.message, /Установите имя пользователя/);
    telegramAvailable = true;

    const unsignedLiveCheck = await requestJson('/api/telegram/username-status?telegram_id=7045');
    assert.equal(unsignedLiveCheck.response.status, 401);

    const liveCheck = await requestJson('/api/telegram/username-status?telegram_id=999999', {
      headers: telegramHeaders(liveUsernameIdentity),
    });
    assert.equal(liveCheck.response.status, 200);
    assert.match(liveCheck.response.headers.get('cache-control') || '', /no-store/);
    assert.equal(liveCheck.data.hasUsername, true);
    assert.equal(liveCheck.data.username, 'fresh_live_username');

    const liveAuthorized = await authorizeReferral(liveUsernameIdentity, 'trusted_referrer');
    assert.equal(liveAuthorized.response.status, 200);
    assert.equal(liveAuthorized.data.authorized, true);
    const liveCustomer = db.prepare("SELECT * FROM customers WHERE telegram_id = '7045'").get();
    assert.equal(liveCustomer.telegram_username, 'fresh_live_username');
    assert.deepEqual(telegramChatIds, ['7044', '7045', '7045']);
  } finally {
    globalThis.fetch = nativeFetch;
  }

  // Добавление username и авторизация могут прийти одновременно. Допустим
  // только линейный итог: запрос либо успел до запрета, либо увидел запрет
  // целиком. Частичного клиента, попытки или бана быть не должно.
  const raceIdentity = { telegram_id: '7042', telegram_username: 'reserved_race' };
  const [, raceAuthorization] = await Promise.all([
    new Promise((resolve) => {
      setImmediate(() => resolve(addDisallowedInviterUsernames(['trusted_referrer'], 'race-test')));
    }),
    authorizeReferral(raceIdentity, 'trusted_referrer'),
  ]);
  assert.ok([200, 422].includes(raceAuthorization.response.status));
  const raceCustomer = db.prepare("SELECT * FROM customers WHERE telegram_id = '7042'").get();
  if (raceAuthorization.response.status === 422) {
    assert.equal(raceAuthorization.data.error, 'referral_inviter_reserved');
    assert.equal(raceAuthorization.data.attempts_remaining, 3);
    assert.equal(raceCustomer, undefined);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM referral_auth_states WHERE telegram_id = '7042'").get().count, 0);
  } else {
    assert.equal(raceAuthorization.data.authorized, true);
    assert.ok(raceCustomer?.access_authorized_at);
    assert.equal(
      db.prepare('SELECT inviter_customer_id FROM customer_referrals WHERE invitee_customer_id = ?').get(raceCustomer.id)?.inviter_customer_id,
      'referrer',
    );
  }
  assert.equal(db.prepare("SELECT COUNT(*) count FROM customer_blocks b JOIN customers c ON c.id = b.customer_id WHERE c.telegram_id = '7042' AND b.active = 1").get().count, 0);
  assert.equal(removeDisallowedInviterUsername('trusted_referrer'), true);

  // Новый основной поток: обязательная авторизация сразу при входе,
  // до просмотра каталога и без создания заказа.
  const entryIdentity = { telegram_id: '7050', telegram_username: 'entry_referral' };
  const entryMissing = await authorizeReferral(entryIdentity);
  assert.equal(entryMissing.response.status, 428);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM referral_auth_states WHERE telegram_id = '7050'").get().count, 0);

  const entryWrong = await authorizeReferral(entryIdentity, 'missing_entry_inviter');
  assert.equal(entryWrong.response.status, 422);
  assert.equal(entryWrong.data.attempts_remaining, 2);

  const entryAuthorized = await authorizeReferral(entryIdentity, '@trusted_referrer');
  assert.equal(entryAuthorized.response.status, 200);
  assert.equal(entryAuthorized.data.authorized, true);
  const entryCustomer = db.prepare("SELECT * FROM customers WHERE telegram_id = '7050'").get();
  assert.equal(entryCustomer.access_authorization_source, 'referral');
  const entryRelation = db.prepare('SELECT * FROM customer_referrals WHERE invitee_customer_id = ?').get(entryCustomer.id);
  assert.equal(entryRelation.inviter_customer_id, 'referrer');
  assert.equal(entryRelation.first_order_id, null);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM orders WHERE customer_id = ?').get(entryCustomer.id).count, 0);

  const entryOrder = await createOrder(entryIdentity);
  assert.equal(entryOrder.response.status, 200);
  assert.equal(
    db.prepare('SELECT first_order_id FROM customer_referrals WHERE invitee_customer_id = ?').get(entryCustomer.id).first_order_id,
    entryOrder.data.order_id,
  );

  const entryFailedIdentity = { telegram_id: '7060', telegram_username: 'entry_failed' };
  const entryFailedResults = [];
  for (const inviter of ['missing_entry_one', 'missing_entry_two', 'missing_entry_three']) {
    entryFailedResults.push(await authorizeReferral(entryFailedIdentity, inviter));
  }
  assert.deepEqual(entryFailedResults.map((item) => item.response.status), [422, 422, 403]);
  const entryFailedState = db.prepare("SELECT * FROM referral_auth_states WHERE telegram_id = '7060'").get();
  assert.equal(entryFailedState.status, 'blocked');
  assert.equal(entryFailedState.attempts_used, 3);

  const identity = { telegram_id: '7100', telegram_username: 'fresh_referral' };
  const status = await requestJson('/api/referral-authorization/status', {
    headers: telegramHeaders(identity),
  });
  assert.equal(status.response.status, 200);
  assert.equal(status.data.required, true);

  const visitIdentity = { telegram_id: '7150', telegram_username: 'visit_only_new' };
  const visit = await requestJson('/api/visits/log', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(visitIdentity),
  });
  assert.equal(visit.response.status, 200);
  const visitCustomer = db.prepare("SELECT * FROM customers WHERE telegram_id = '7150'").get();
  assert.equal(visitCustomer.access_authorized_at, null);
  const visitStatus = await requestJson('/api/referral-authorization/status', {
    headers: telegramHeaders(visitIdentity),
  });
  assert.equal(visitStatus.data.required, true);

  const missing = await createOrder(identity);
  assert.equal(missing.response.status, 428);
  assert.equal(missing.data.error, 'referral_authorization_required');
  assert.equal(db.prepare("SELECT COUNT(*) count FROM customers WHERE telegram_id = '7100'").get().count, 0);

  const wrong = await createOrder(identity, { inviter_username: 'unknown_person' });
  assert.equal(wrong.response.status, 422);
  assert.equal(wrong.data.attempts_remaining, 2);

  const generalBlock = createBlock({ customer_id: 'referrer', reason: 'временно', blocked_by: 'test' });
  const blockedInviter = await createOrder(identity, { inviter_username: 'trusted_referrer' });
  assert.equal(blockedInviter.response.status, 422);
  assert.equal(blockedInviter.data.message, 'Пользователь заблокирован и не может быть пригласившим');
  assert.equal(blockedInviter.data.attempts_remaining, 2);
  unblockCustomerBlock(generalBlock.block.id);

  const inviteBan = createInviteBan({ customerId: 'referrer', reason: 'test', bannedBy: 'test' });
  const forbiddenInviter = await createOrder(identity, { inviter_username: 'trusted_referrer' });
  assert.equal(forbiddenInviter.response.status, 422);
  assert.equal(forbiddenInviter.data.message, 'Данный пользователь не может приглашать новых людей');
  assert.equal(forbiddenInviter.data.attempts_remaining, 1);
  removeInviteBan(inviteBan.id, { unbannedBy: 'test' });

  db.prepare(`
    INSERT INTO customers (id, telegram_id, telegram_username, first_visit_at, total_orders, total_spent)
    VALUES ('duplicate-referrer', '7001', 'TRUSTED_REFERRER', DATETIME('now'), 1, 20)
  `).run();
  db.prepare(`
    INSERT INTO orders (id, order_number, customer_id, status, delivery_type, total_amount, final_amount, created_at, updated_at)
    VALUES ('duplicate-referrer-order', 999002, 'duplicate-referrer', 'completed', 'pickup', 20, 20, DATETIME('now'), DATETIME('now'))
  `).run();
  const ambiguousInviter = await createOrder(identity, { inviter_username: 'trusted_referrer' });
  assert.equal(ambiguousInviter.response.status, 422);
  assert.equal(ambiguousInviter.data.error, 'referral_username_ambiguous');
  assert.equal(ambiguousInviter.data.attempts_remaining, 1);
  db.prepare("UPDATE customers SET telegram_username = 'former_referrer' WHERE id = 'duplicate-referrer'").run();

  const created = await createOrder(identity, { inviter_username: '@TRUSTED_referrer' });
  assert.equal(created.response.status, 200);
  const orderRow = getOrderById(created.data.order_id);
  const customerRow = getCustomerById(orderRow.customer_id);
  assert.equal(customerRow.access_authorization_source, 'referral');
  const relation = db.prepare('SELECT * FROM customer_referrals WHERE invitee_customer_id = ?').get(customerRow.id);
  assert.equal(relation.inviter_customer_id, 'referrer');
  assert.equal(relation.first_order_id, created.data.order_id);

  // Ошибка, возникшая после проверки пригласившего, не должна оставлять
  // клиента, авторизацию или связь частично сохранёнными.
  const atomicIdentity = { telegram_id: '7200', telegram_username: 'atomic_referral' };
  const invalidPromo = await createOrder(atomicIdentity, {
    inviter_username: 'trusted_referrer',
    promo_code: 'PROMO_DOES_NOT_EXIST',
  });
  assert.equal(invalidPromo.response.status, 400);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM customers WHERE telegram_id = '7200'").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM referral_auth_states WHERE telegram_id = '7200'").get().count, 0);

  // Неверный пригласивший вместе с ошибкой корзины/промокода не расходует попытку.
  const invalidBusinessIdentity = { telegram_id: '7210', telegram_username: 'invalid_business' };
  const invalidPromoAndInviter = await createOrder(invalidBusinessIdentity, {
    inviter_username: 'missing_inviter',
    promo_code: 'PROMO_DOES_NOT_EXIST',
  });
  assert.equal(invalidPromoAndInviter.response.status, 400);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM referral_auth_states WHERE telegram_id = '7210'").get().count, 0);

  const invalidProductAndInviter = await createOrder(invalidBusinessIdentity, {
    inviter_username: 'missing_inviter',
    items: [{ product_id: 'missing-product', quantity: 1 }],
  });
  assert.equal(invalidProductAndInviter.response.status, 500);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM referral_auth_states WHERE telegram_id = '7210'").get().count, 0);

  // Два одновременных правильных запроса создают ровно один заказ и одну связь.
  const doubleIdentity = { telegram_id: '7300', telegram_username: 'double_referral' };
  const doubleResults = await Promise.all([
    createOrder(doubleIdentity, { inviter_username: 'trusted_referrer' }),
    createOrder(doubleIdentity, { inviter_username: 'trusted_referrer' }),
  ]);
  assert.deepEqual(doubleResults.map((result) => result.response.status).sort(), [200, 409]);
  const doubleCustomer = db.prepare("SELECT * FROM customers WHERE telegram_id = '7300'").get();
  assert.equal(db.prepare('SELECT COUNT(*) count FROM orders WHERE customer_id = ?').get(doubleCustomer.id).count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM customer_referrals WHERE invitee_customer_id = ?').get(doubleCustomer.id).count, 1);

  const mixedIdentity = { telegram_id: '7350', telegram_username: 'mixed_referral' };
  const mixedResults = await Promise.all([
    createOrder(mixedIdentity, { inviter_username: 'trusted_referrer' }),
    createOrder(mixedIdentity, { inviter_username: 'definitely_missing' }),
  ]);
  assert(mixedResults.some((result) => result.response.status === 200));
  assert(mixedResults.every((result) => [200, 409, 422].includes(result.response.status)));
  const mixedCustomer = db.prepare("SELECT * FROM customers WHERE telegram_id = '7350'").get();
  assert.equal(mixedCustomer.access_authorization_source, 'referral');
  assert.equal(db.prepare('SELECT COUNT(*) count FROM orders WHERE customer_id = ?').get(mixedCustomer.id).count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM customer_referrals WHERE invitee_customer_id = ?').get(mixedCustomer.id).count, 1);

  // Три параллельные расходуемые ошибки дают один вечный бан, без потери инкрементов.
  const failedIdentity = { telegram_id: '7400', telegram_username: 'failed_referral' };
  const failedResults = await Promise.all([
    createOrder(failedIdentity, { inviter_username: 'missing_one' }),
    createOrder(failedIdentity, { inviter_username: 'missing_two' }),
    createOrder(failedIdentity, { inviter_username: 'missing_three' }),
  ]);
  assert.deepEqual(failedResults.map((result) => result.response.status).sort(), [403, 422, 422]);
  const failedState = db.prepare("SELECT * FROM referral_auth_states WHERE telegram_id = '7400'").get();
  assert.equal(failedState.attempts_used, 3);
  assert.equal(failedState.status, 'blocked');
  const failedCustomer = db.prepare("SELECT * FROM customers WHERE telegram_id = '7400'").get();
  assert.equal(db.prepare("SELECT COUNT(*) count FROM customer_blocks WHERE customer_id = ? AND block_type = 'authorization_failed' AND unblocked_at IS NULL").get(failedCustomer.id).count, 1);

  setReferralAuthorizationEnabled(false);
}

async function main() {
  seedProduct();

  await testCreateAndDuplicateGuard();
  await testModifyNewOrder();
  await testModifyInProgressOrderRestoresStock();
  await testCancelNewOrder();
  await testCancelInProgressOrder();
  await testClientPriceIsIgnored();
  await testCatalogDiscountSnapshot();
  await testMissingTelegramAuthIsRejected();
  await testInvalidTelegramSignatureIsRejected();
  await testBodyIdentitySpoofIsIgnored();
  await testForeignOrderAccessIsRejected();
  await testReferralAuthorizationOrderFlow();

  console.log("[public-order-smoke] OK");
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
