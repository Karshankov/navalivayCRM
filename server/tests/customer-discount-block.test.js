import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import express from "express";
import { telegramHeaders } from "./helpers/telegram-auth.js";

// Свободный порт под фейковый userbot ДО импорта модулей: userbot-client
// фиксирует USERBOT_BASE при первой загрузке.
function findFreePort() {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}
const fakeUserbotPort = await findFreePort();
process.env.USERBOT_HTTP_PORT = String(fakeUserbotPort);

/**
 * Временная блокировка (заморозка) скидочной системы клиента.
 *
 * Проверяет: миграцию (колонки + дефолтный шаблон), статус-хелперы,
 * запрет применения штампов в buildLoyaltyApplication/создании заказа,
 * запрет промокодов, начисление штампов при выдаче (не начисляются,
 * пока блокировка активна; начисляются после истечения), ручное снятие,
 * шаблон уведомления ({date}/{comment}) и админ-API.
 */

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "navalivay-discount-block-"));
const tempDbPath = path.join(tempDir, "test.db");

process.env.DATABASE_FILE = tempDbPath;
process.env.BOT_TOKEN = "test-bot-token";
process.env.NODE_ENV = "test";

const { initDb, db } = await import("../db.js");
const { crmRouter } = await import("../routes/crm.js");
const { publicRouter } = await import("../routes/public.js");
const { loyaltyRouter } = await import("../routes/loyalty.js");
const { awardLoyaltyForOrder, buildLoyaltyApplication } = await import("../loyalty.js");
const { seedDefaultLoyaltyData } = await import("../migrations/add_loyalty_tables.js");
const { issueToken } = await import("../auth.js");
const {
  getDiscountBlockStatus,
  getDiscountBlockStatusById,
  discountBlockUntilFromDate,
  formatMinskDate,
  renderDiscountBlockMessage,
  getDiscountBlockNotifyTemplate,
} = await import("../utils/customer-discount-block.js");
const { sendViaUserbot } = await import("../utils/userbot-client.js");

initDb();
seedDefaultLoyaltyData();

// Каталог для лояльности (жидкости с порогом).
db.prepare(
  `
  INSERT OR IGNORE INTO categories (id, slug, name, [order], hide_empty, display_mode)
  VALUES ('c_liquids_salt', 'zhidkosti', 'Жидкости', 0, 0, 'default')
`,
).run();
db.prepare(
  `
  INSERT OR IGNORE INTO products (
    id, categoryId, groupId, title, priceRub, description, use_category_image,
    createdAt, cost_price, stock, min_stock, has_variants
  ) VALUES
    ('liquid-1', 'c_liquids_salt', NULL, 'Liquid Cherry', 15, '', 0, DATETIME('now'), 5, 50, 0, 0)
`,
).run();
db.prepare("DELETE FROM loyalty_category_mappings").run();
db.prepare(
  `
  INSERT INTO loyalty_category_mappings (id, loyalty_category_id, category_id, group_id)
  VALUES ('manual_liquids_only', 'loyalty_liquids', 'c_liquids_salt', NULL)
`,
).run();

const app = express();
app.use(express.json());
app.use(publicRouter);
app.use(loyaltyRouter);
app.use(crmRouter);

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

function createCustomer({ id, telegramId, telegramUsername }) {
  db.prepare(
    `
    INSERT INTO customers (id, telegram_id, telegram_username, first_name, last_name, last_visit_at)
    VALUES (?, ?, ?, 'Test', 'User', DATETIME('now'))
  `,
  ).run(id, String(telegramId), telegramUsername);
  return id;
}

function getLoyaltyCategoryId() {
  return db.prepare("SELECT id FROM loyalty_categories WHERE key = 'liquids'").get().id;
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
        "SELECT balance FROM customer_loyalty_balances WHERE customer_id = ? AND loyalty_category_id = ?",
      )
      .get(customerId, categoryId)?.balance || 0,
  );
}

const identity = { id: 3001, telegram_id: "3001", username: "frozen_user" };

const adminToken = issueToken({ u: "discount-admin" });
function adminHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` };
}

function makeOrderRow(customerId, orderId) {
  db.prepare(
    `
    INSERT INTO orders (id, order_number, customer_id, status, delivery_type,
      total_amount, discount_amount, final_amount, profit, telegram_username, created_at)
    VALUES (?, 1, ?, 'delivered', 'pickup', 15, 0, 15, 10, 'frozen_user', DATETIME('now'))
  `,
  ).run(orderId, customerId);
  db.prepare(
    `
    INSERT INTO order_items (id, order_id, product_id, product_title, quantity,
      price_per_unit, cost_per_unit, discount_amount, total_price, total_cost)
    VALUES ('oi_1', ?, 'liquid-1', 'Liquid Cherry', 2, 15, 5, 0, 30, 10)
  `,
  ).run(orderId);
}

try {
  // ===== Миграция и хелперы =====
  console.log("migration: колонки и дефолтный шаблон");
  const columns = db.prepare("PRAGMA table_info(customers)").all().map((c) => c.name);
  assert.ok(columns.includes("discount_blocked_until"), "колонка discount_blocked_until");
  assert.ok(columns.includes("discount_block_comment"), "колонка discount_block_comment");
  assert.ok(
    getDiscountBlockNotifyTemplate().includes("{date}"),
    "дефолтный шаблон содержит {date}",
  );

  console.log("helpers: untilFromDate — конец дня по Минску");
  assert.equal(discountBlockUntilFromDate("2031-05-20"), "2031-05-20 20:59:59");
  assert.equal(discountBlockUntilFromDate("2031-02-31"), null, "несуществующая дата");
  assert.equal(discountBlockUntilFromDate("nope"), null);
  assert.equal(formatMinskDate("2031-05-20 20:59:59"), "20.05.2031");

  console.log("helpers: renderDiscountBlockMessage");
  assert.equal(
    renderDiscountBlockMessage("Заморожено до {date}. {comment}", {
      until: "2031-05-20 20:59:59",
      comment: "звонок",
    }),
    "Заморожено до 20.05.2031. звонок",
  );
  assert.equal(
    renderDiscountBlockMessage("До {date}.", { until: "2031-05-20 20:59:59" }),
    "До 20.05.2031.",
    "без комментария подстановка пустая",
  );

  console.log("helpers: статус блокировки");
  const statusActive = getDiscountBlockStatus({
    discount_blocked_until: "2099-01-01 00:00:00",
    discount_block_comment: " x ",
  });
  assert.deepEqual(
    { blocked: statusActive.blocked, comment: statusActive.comment },
    { blocked: true, comment: "x" },
  );
  assert.equal(
    getDiscountBlockStatus({ discount_blocked_until: "2020-01-01 00:00:00" }).blocked,
    false,
    "истёкшая блокировка неактивна",
  );
  assert.equal(getDiscountBlockStatus(null).blocked, false);

  // ===== buildLoyaltyApplication =====
  const customerId = createCustomer({
    id: "cust-frozen-1",
    telegramId: "3001",
    telegramUsername: "frozen_user",
  });
  const categoryId = getLoyaltyCategoryId();
  setBalance(customerId, categoryId, 10);

  console.log("loyalty: заморозка не даёт применить штампы, баланс не трогает");
  const blockedApplication = buildLoyaltyApplication({
    customerId,
    items: [
      {
        product_id: "liquid-1",
        quantity: 2,
        price_per_unit: 15,
        loyalty_units_applied: 1,
      },
    ],
    discountBlocked: true,
  });
  assert.equal(blockedApplication.total_loyalty_discount, 0, "скидка не применяется");
  assert.equal(
    blockedApplication.items[0].loyalty_units_applied,
    0,
    "юниты обнулены",
  );
  assert.equal(
    blockedApplication.categories[0].current_balance,
    10,
    "баланс в preview виден (накопленное не сгорело)",
  );
  assert.equal(
    blockedApplication.categories[0].current_available_bonus_count,
    0,
    "доступных к списанию нет",
  );
  assert.equal(getBalance(customerId, categoryId), 10, "баланс в БД не тронут");

  console.log("loyalty: без заморозки штампы применяются");
  const freeApplication = buildLoyaltyApplication({
    customerId,
    items: [
      {
        product_id: "liquid-1",
        quantity: 2,
        price_per_unit: 15,
        loyalty_units_applied: 1,
      },
    ],
  });
  assert.ok(freeApplication.total_loyalty_discount > 0);

  // ===== Публичный API =====
  console.log("api: /api/loyalty/me отдаёт статус заморозки");
  db.prepare(
    "UPDATE customers SET discount_blocked_until = '2099-01-01 00:00:00', discount_block_comment = 'тест' WHERE id = ?",
  ).run(customerId);
  const me = await requestJson(
    `/api/loyalty/me?telegram_id=3001&telegram_username=frozen_user`,
    { headers: telegramHeaders(identity) },
  );
  assert.equal(me.response.status, 200);
  assert.equal(me.data.discount_block.blocked, true);
  assert.equal(me.data.discount_block.comment, "тест");

  console.log("api: checkout-preview не применяет штампы при заморозке");
  const preview = await requestJson("/api/loyalty/checkout-preview", {
    method: "POST",
    headers: telegramHeaders(identity),
    body: JSON.stringify({
      items: [
        {
          product_id: "liquid-1",
          quantity: 2,
          price_per_unit: 15,
          loyalty_units_applied: 1,
        },
      ],
    }),
  });
  assert.equal(preview.response.status, 200);
  assert.equal(preview.data.total_loyalty_discount, 0, "скидка не применена");
  assert.equal(preview.data.discount_block.blocked, true, "статус в ответе");

  console.log("api: /api/promo/validate отклоняет промокод при заморозке");
  // Промокод не создаём: проверка заморозки идёт ДО валидации кода.
  const promoCheck = await requestJson("/api/promo/validate", {
    method: "POST",
    headers: telegramHeaders(identity),
    body: JSON.stringify({ code: "FROZEN10", order_amount: 30 }),
  });
  assert.equal(promoCheck.data.valid, false);
  assert.equal(promoCheck.data.error, "discount_blocked");

  console.log("api: заказ с бонусами отклоняется (403), без бонусов проходит");
  const blockedOrder = await requestJson("/api/orders", {
    method: "POST",
    headers: telegramHeaders(identity),
    body: JSON.stringify({
      telegram_username: "frozen_user",
      delivery_type: "pickup",
      items: [
        {
          product_id: "liquid-1",
          quantity: 2,
          price_per_unit: 15,
          loyalty_units_applied: 1,
        },
      ],
    }),
  });
  assert.equal(blockedOrder.response.status, 403);
  assert.equal(blockedOrder.data.error, "discount_blocked");
  assert.ok(blockedOrder.data.block?.until, "block_until в ответе для UI");

  // ===== Выдача заказа: начисление штампов =====
  console.log("award: при активной заморозке штампы не начисляются");
  makeOrderRow(customerId, "ord_frozen_1");
  const awardBlocked = awardLoyaltyForOrder("ord_frozen_1");
  assert.equal(awardBlocked.awarded, false);
  assert.equal(awardBlocked.reason, "discount_blocked");
  assert.equal(getBalance(customerId, categoryId), 10, "баланс не изменился");

  console.log("award: после истечения заморозки штампы начисляются");
  db.prepare(
    "UPDATE customers SET discount_blocked_until = '2020-01-01 00:00:00' WHERE id = ?",
  ).run(customerId);
  const awardAfter = awardLoyaltyForOrder("ord_frozen_1");
  assert.equal(awardAfter.awarded, true, "начисление прошло");
  assert.ok(getBalance(customerId, categoryId) > 10);

  // ===== Админ-API =====
  console.log("crm: установка блокировки с уведомлением через userbot");
  const fakeUserbot = express();
  fakeUserbot.use(express.json());
  const sentMessages = [];
  fakeUserbot.post("/send-message", (req, res) => {
    sentMessages.push(req.body);
    res.json({ ok: true, outcome: "sent", message_id: 1 });
  });
  const userbotServer = await new Promise((resolve) => {
    const instance = fakeUserbot.listen(fakeUserbotPort, "127.0.0.1", () => resolve(instance));
  });

  const setBlock = await requestJson(
    `/api/admin/crm/customers/${customerId}/discount-block`,
    {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ until: "2031-06-15", comment: "проверка" }),
    },
  );
  assert.equal(setBlock.response.status, 200);
  assert.equal(setBlock.data.ok, true);
  assert.equal(setBlock.data.discount_block.blocked, true);
  const stored = db
    .prepare("SELECT discount_blocked_until, discount_block_comment FROM customers WHERE id = ?")
    .get(customerId);
  assert.equal(stored.discount_blocked_until, "2031-06-15 20:59:59", "конец дня по Минску");
  assert.equal(stored.discount_block_comment, "проверка");

  console.log("crm: карточка клиента отдаёт discount_block");
  const detail = await requestJson(`/api/admin/crm/customers/${customerId}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(detail.data.discount_block.blocked, true);
  assert.equal(detail.data.discount_block.until, "2031-06-15 20:59:59");

  console.log("crm: шаблон уведомления — валидация и сохранение");
  const badTemplate = await requestJson("/api/admin/crm/discount-block-notify-template", {
    method: "PUT",
    headers: adminHeaders(),
    body: JSON.stringify({ template: "Без переменной даты" }),
  });
  assert.equal(badTemplate.response.status, 400);
  assert.equal(badTemplate.data.error, "template_date_required");

  const goodTemplate = await requestJson("/api/admin/crm/discount-block-notify-template", {
    method: "PUT",
    headers: adminHeaders(),
    body: JSON.stringify({ template: "Заморозка до {date}. Причина: {comment}" }),
  });
  assert.equal(goodTemplate.response.status, 200);
  assert.equal(
    getDiscountBlockNotifyTemplate(),
    "Заморозка до {date}. Причина: {comment}",
  );

  console.log("crm: снятие блокировки вручную");
  const removed = await requestJson(
    `/api/admin/crm/customers/${customerId}/discount-block`,
    { method: "DELETE", headers: adminHeaders() },
  );
  assert.equal(removed.response.status, 200);
  assert.equal(removed.data.discount_block.blocked, false);
  const cleared = db
    .prepare("SELECT discount_blocked_until, discount_block_comment FROM customers WHERE id = ?")
    .get(customerId);
  assert.equal(cleared.discount_blocked_until, null);
  assert.equal(cleared.discount_block_comment, null);

  console.log("crm: установка с кастомным шаблоном рендерится в уведомление");
  const blockedAgain = await requestJson(
    `/api/admin/crm/customers/${customerId}/discount-block`,
    {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ until: "2031-07-01" }),
    },
  );
  assert.equal(blockedAgain.response.status, 200);
  assert.equal(blockedAgain.data.discount_block.blocked, true);

  assert.equal(
    blockedAgain.data.notify.ok,
    true,
    "уведомление ушло через userbot",
  );
  assert.equal(sentMessages.length, 2, "два уведомления: дефолтный шаблон и кастомный");
  assert.equal(
    sentMessages[0].text,
    "Ваша скидочная система временно заморожена до 15.06.2031.",
    "дефолтный шаблон с подстановкой {date}",
  );
  assert.equal(
    sentMessages[1].text,
    "Заморозка до 01.07.2031. Причина:",
    "кастомный шаблон: {date} и пустой {comment} (хвостовой пробел триммится)",
  );
  assert.equal(
    sentMessages[0].chat_id,
    "3001",
    "адресат — telegram_id клиента",
  );

  userbotServer.close();

  console.log("customer-discount-block.test.js: ok");
} finally {
  server.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
