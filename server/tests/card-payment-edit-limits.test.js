// Проверка лимитов при ИЗМЕНЕНИИ карточного заказа (modify-by-customer).
// Сценарий из бага 2026-10-16: у клиента лимит 150 BYN, он оформил заказ
// картой, затем изменил его до суммы больше лимита — и изменение прошло.
// Покрываем: личный лимит, дневной лимит магазина, старый резерв.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { telegramHeaders } from "./helpers/telegram-auth.js";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "navalivay-card-edit-limit-"));
const tempDbPath = path.join(tempDir, "test.db");

process.env.DATABASE_FILE = tempDbPath;
process.env.BOT_TOKEN = "test-bot-token";
process.env.NODE_ENV = "test";
process.env.TEST_PUBLIC_MINIAPP_MUTATION_RATE_LIMIT_MAX = "1000";

const { initDb, db } = await import("../db.js");
const { publicRouter } = await import("../routes/public.js");

initDb();

const app = express();
app.use(express.json());
app.use(publicRouter);

const server = await new Promise((resolve) => {
  const instance = app.listen(0, () => resolve(instance));
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;

async function requestJson(url, options = {}) {
  const response = await fetch(`${baseUrl}${url}`, options);
  const data = await response.json().catch(() => null);
  return { response, data };
}

const TELEGRAM_ID = "90001";
const USERNAME = "card_edit_user";
const identity = { telegram_id: TELEGRAM_ID, telegram_username: USERNAME };
const monthKey = new Date().toISOString().slice(0, 7);

function seedProduct(priceRub = 10) {
  db.prepare(
    `INSERT OR IGNORE INTO categories (id, slug, name, [order], hide_empty, display_mode)
     VALUES ('cat-test', 'cat-test', 'Test category', 0, 0, 'default')`,
  ).run();
  db.prepare(
    `INSERT OR IGNORE INTO products (
      id, categoryId, groupId, title, priceRub, description, use_category_image,
      createdAt, cost_price, stock, min_stock, has_variants
    ) VALUES (?, 'cat-test', NULL, 'Limit Test Item', ?, '', 0, DATETIME('now'), 5, 100, 0, 0)`,
  ).run("product-limit", priceRub);
}

function createOrder(quantity, extra = {}) {
  return requestJson("/api/orders", {
    method: "POST",
    headers: telegramHeaders(identity),
    body: JSON.stringify({
      ...identity,
      first_name: "Card",
      last_name: "Editor",
      delivery_type: "pickup",
      items: [
        {
          product_id: "product-limit",
          variant_id: null,
          quantity,
          price_per_unit: 10,
          product_title: "Limit Test Item",
          variant_name: null,
        },
      ],
      ...extra,
    }),
  });
}

function modifyOrder(orderId, quantity) {
  return requestJson(`/api/orders/${orderId}/modify-by-customer`, {
    method: "PUT",
    headers: telegramHeaders(identity),
    body: JSON.stringify({
      ...identity,
      delivery_type: "pickup",
      items: [
        {
          product_id: "product-limit",
          variant_id: null,
          quantity,
          price_per_unit: 10,
          product_title: "Limit Test Item",
          variant_name: null,
        },
      ],
    }),
  });
}

function cardReserve(orderId) {
  const row = db
    .prepare(
      `SELECT amount_minor FROM card_payment_operations
       WHERE order_id = ? AND operation_type = 'order' AND operation_status = 'reserved'`,
    )
    .get(orderId);
  return Number(row?.amount_minor || 0);
}

try {
  seedProduct(10);

  // Личный лимит клиента — 150.00 BYN, карта разрешена.
  db.prepare(
    `INSERT INTO card_payment_accounts
       (telegram_id, telegram_username, enabled, monthly_limit_minor, max_order_minor, cooldown_days)
     VALUES (?, ?, 1, 100000, 15000, 10)`,
  ).run(TELEGRAM_ID, USERNAME);

  // Месячный лимит магазина 2000 BYN — не мешает проверке личного лимита.
  db.prepare(
    `INSERT INTO card_payment_months (month_key, limit_minor) VALUES (?, 200000)`,
  ).run(monthKey);

  // Заказ картой на 110 BYN (11 × 10 BYN) — внутри лимита 150.
  const created = await createOrder(11, { payment_method: "card" });
  assert.equal(created.response.status, 200, `заказ должен создаться: ${created.response.status} ${JSON.stringify(created.data)}`);
  const orderId = created.data.order_id;
  assert.equal(cardReserve(orderId), 11000, `резерв карты должен быть 11000: ${cardReserve(orderId)}`);
  console.log("setup: карточный заказ на 110 BYN создан, резерв 11000 minor");

  // 1) Изменение до 160 BYN (16 штук) — больше личного лимита 150:
  //    сервер обязан отклонить.
  const overPersonal = await modifyOrder(orderId, 16);
  assert.equal(overPersonal.response.status, 400, `ожидали 400: ${overPersonal.response.status} ${JSON.stringify(overPersonal.data)}`);
  assert.equal(overPersonal.data.error, "card_limit_exceeded_on_edit");
  assert.ok(
    String(overPersonal.data.message || "").includes("лимит"),
    `сообщение должно объяснять про лимит: ${overPersonal.data.message}`,
  );
  console.log("OK: изменение сверх личного лимита отклонено —", overPersonal.data.message);

  // 2) Заказ остался нетронутым: карточная сумма и резерв прежние,
  //    наличной части не появилось.
  const orderRow = db
    .prepare("SELECT card_amount_minor, cash_due_minor, final_amount FROM orders WHERE id = ?")
    .get(orderId);
  assert.equal(orderRow.card_amount_minor, 11000, "карточная сумма не должна измениться");
  assert.equal(orderRow.cash_due_minor, 0, "наличная часть не должна появиться");
  assert.equal(cardReserve(orderId), 11000, "резерв карты не должен измениться");
  console.log("OK: заказ и резерв карты остались прежними после отказа");

  // 3) Дневной лимит магазина: сжимаем месячный лимит до 120 BYN, тогда
  //    дневной остаток (120 − резерв 110 = 10) не даст вырасти до 120.
  db.prepare("DELETE FROM card_payment_months").run();
  db.prepare(
    `INSERT INTO card_payment_months (month_key, limit_minor) VALUES (?, 12000)`,
  ).run(monthKey);
  const overShop = await modifyOrder(orderId, 12); // 120 BYN
  assert.equal(overShop.response.status, 400, `ожидали 400: ${overShop.response.status} ${JSON.stringify(overShop.data)}`);
  assert.equal(overShop.data.error, "card_limit_exceeded_on_edit");
  console.log("OK: изменение сверх дневного лимита магазина отклонено —", overShop.data.message);

  // 4) Уменьшение заказа (до 90 BYN) — проходит, резерв уменьшается,
  //    наличной части нет.
  const shrink = await modifyOrder(orderId, 9);
  assert.equal(shrink.response.status, 200, `уменьшение должно проходить: ${shrink.response.status} ${JSON.stringify(shrink.data)}`);
  assert.equal(shrink.data.card_amount_minor, 9000);
  assert.equal(shrink.data.cash_due_minor, 0);
  assert.equal(cardReserve(orderId), 9000);
  console.log("OK: уменьшение заказа внутри резерва проходит без наличной части");

  // 5) Рост выше старого резерва (после уменьшения резерв 90) при
  //    свободных лимитах — тоже отклоняется: смешанной оплаты нет.
  db.prepare("DELETE FROM card_payment_months").run();
  db.prepare(
    `INSERT INTO card_payment_months (month_key, limit_minor) VALUES (?, 200000)`,
  ).run(monthKey);
  const overReserve = await modifyOrder(orderId, 10); // 100 BYN
  assert.equal(overReserve.response.status, 400, `ожидали 400: ${overReserve.response.status} ${JSON.stringify(overReserve.data)}`);
  assert.equal(overReserve.data.error, "card_limit_exceeded_on_edit");
  console.log("OK: рост выше старого резерва отклонён —", overReserve.data.message);

  console.log("\nВсе проверки изменения карточного заказа прошли.");
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log("[card-edit-limit] OK");
}
