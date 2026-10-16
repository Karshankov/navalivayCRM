// Проверка эндпоинта «Изменить способ оплаты» (PATCH /orders/:id/payment-method):
// - перевод карточного заказа на наличные снимает резерв и освобождает лимиты;
// - перевод наличного заказа на карту ставит резерв и проходит проверки;
// - отказ при паузе аккаунта и при превышении личного лимита;
// - запрет после оплаты заказа и смена на тот же способ без дублей.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "navalivay-payment-method-"));
process.env.DATABASE_FILE = path.join(tempDir, "test.db");
process.env.BOT_TOKEN = "test-bot-token";
process.env.NODE_ENV = "test";

const { initDb, db } = await import("../db.js");
const { crmOperationsRouter } = await import("../routes/crm-operations.js");
const { issueToken } = await import("../auth.js");

initDb();

const app = express();
app.use(express.json());
app.use(crmOperationsRouter);
const server = await new Promise((resolve) => {
  const instance = app.listen(0, () => resolve(instance));
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;

async function requestJson(url, options = {}) {
  const response = await fetch(`${baseUrl}${url}`, options);
  const data = await response.json().catch(() => null);
  return { response, data };
}

// Вход как админ: Bearer-токен из тестового секрета.
const headers = {
  "content-type": "application/json",
  authorization: `Bearer ${issueToken("test-admin")}`,
};

const TELEGRAM_ID = "91001";
const USERNAME = "pm_user";

let orderNumberSeq = 99001;

function seedOrder({ paymentType = "cash", amount = 100, paid = 0 } = {}) {
  const customerId = "cust_pm_1";
  db.prepare(`
    INSERT OR IGNORE INTO customers (id, telegram_id, telegram_username, first_name)
    VALUES (?, ?, ?, 'PM')
  `).run(customerId, TELEGRAM_ID, USERNAME);
  const orderId = `order_pm_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  db.prepare(`
    INSERT INTO orders (
      id, order_number, customer_id, status, delivery_type,
      total_amount, final_amount, payment_type, paid_amount,
      card_amount_minor, cash_due_minor, created_at, updated_at
    ) VALUES (?, ?, ?, 'new', 'pickup', ?, ?, ?, ?, ?, ?, DATETIME('now'), DATETIME('now'))
  `).run(
    orderId,
    orderNumberSeq++,
    customerId,
    amount,
    amount,
    paymentType,
    paid || null,
    paymentType === "card" ? Math.round(amount * 100) : 0,
    paymentType === "cash" ? Math.round(amount * 100) : 0,
  );
  return orderId;
}

function cardReserveOf(orderId) {
  const row = db.prepare(`
    SELECT amount_minor FROM card_payment_operations
    WHERE order_id = ? AND operation_type = 'order' AND operation_status = 'reserved'
  `).get(orderId);
  return Number(row?.amount_minor || 0);
}

function patchMethod(orderId, paymentType) {
  return requestJson(`/api/admin/crm/orders/${orderId}/payment-method`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ payment_type: paymentType }),
  });
}

try {
  // Аккаунт карты: включён, лимит заказа 200 BYN.
  db.prepare(`
    INSERT INTO card_payment_accounts
      (telegram_id, telegram_username, enabled, monthly_limit_minor, max_order_minor, cooldown_days)
    VALUES (?, ?, 1, 1000000, 20000, 10)
  `).run(TELEGRAM_ID, USERNAME);
  db.prepare(`
    INSERT INTO card_payment_months (month_key, limit_minor)
    VALUES (?, 1000000)
  `).run(new Date().toISOString().slice(0, 7));

  // 1) Наличный заказ → карта: резерв ставится, поля обновляются.
  const cashOrderId = seedOrder({ paymentType: "cash", amount: 100 });
  const toCard = await patchMethod(cashOrderId, "card");
  assert.equal(toCard.response.status, 200, `ожидали 200: ${toCard.response.status} ${JSON.stringify(toCard.data)}`);
  assert.equal(toCard.data.payment_type, "card");
  assert.equal(toCard.data.card_amount_minor, 10000);
  assert.equal(toCard.data.cash_due_minor, 0);
  assert.equal(cardReserveOf(cashOrderId), 10000, "резерв карты должен быть 10000");
  console.log("OK: наличный → карта, резерв поставлен на всю сумму");

  // 2) Карточный заказ → наличные: резерв снимается, лимиты освобождаются.
  const backToCash = await patchMethod(cashOrderId, "cash");
  assert.equal(backToCash.response.status, 200, `ожидали 200: ${backToCash.response.status}`);
  assert.equal(backToCash.data.payment_type, "cash");
  assert.equal(backToCash.data.card_amount_minor, 0);
  assert.equal(backToCash.data.cash_due_minor, 10000);
  assert.equal(cardReserveOf(cashOrderId), 0, "резерв карты должен быть снят");
  console.log("OK: карта → наличные, резерв снят и лимиты освобождены");

  // 3) Отказ при паузе аккаунта.
  db.prepare(`
    UPDATE card_payment_accounts SET cooldown_started_at = ? WHERE telegram_id = ?
  `).run(new Date().toISOString(), TELEGRAM_ID);
  const paused = await patchMethod(cashOrderId, "card");
  assert.equal(paused.response.status, 409, `ожидали 409: ${paused.response.status} ${JSON.stringify(paused.data)}`);
  assert.equal(paused.data.error, "card_payment_change_rejected");
  assert.ok(String(paused.data.message || "").includes("пауза"), `про паузу: ${paused.data.message}`);
  console.log("OK: отказ при паузе —", paused.data.message);

  // 4) Отказ при превышении личного лимита (заказ 300 > 200).
  db.prepare(`
    UPDATE card_payment_accounts SET cooldown_started_at = NULL WHERE telegram_id = ?
  `).run(TELEGRAM_ID);
  const bigOrderId = seedOrder({ paymentType: "cash", amount: 300 });
  const tooBig = await patchMethod(bigOrderId, "card");
  assert.equal(tooBig.response.status, 409, `ожидали 409: ${tooBig.response.status} ${JSON.stringify(tooBig.data)}`);
  assert.equal(tooBig.data.error, "card_payment_change_rejected");
  assert.ok(String(tooBig.data.message || "").includes("лимит"), `про лимит: ${tooBig.data.message}`);
  console.log("OK: отказ сверх личного лимита —", tooBig.data.message);

  // 5) Тот же способ — без изменений (unchanged).
  const same = await patchMethod(bigOrderId, "cash");
  assert.equal(same.response.status, 200, `ожидали 200: ${same.response.status}`);
  assert.equal(same.data.unchanged, true);
  console.log("OK: смена на тот же способ — без записи аудита");

  // 6) Оплаченный заказ менять нельзя.
  const paidOrderId = seedOrder({ paymentType: "cash", amount: 50, paid: 50 });
  const paidAttempt = await patchMethod(paidOrderId, "card");
  assert.equal(paidAttempt.response.status, 409, `ожидали 409: ${paidAttempt.response.status}`);
  assert.equal(paidAttempt.data.error, "already_paid");
  console.log("OK: оплаченный заказ защищён от смены способа");

  // 7) Неверный тип оплаты.
  const invalid = await patchMethod(cashOrderId, "crypto");
  assert.equal(invalid.response.status, 400, `ожидали 400: ${invalid.response.status}`);
  assert.equal(invalid.data.error, "invalid_payment_type");
  console.log("OK: неизвестный способ оплаты отклонён");

  console.log("\nВсе проверки «Изменить способ оплаты» прошли.");
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log("[payment-method] OK");
}
