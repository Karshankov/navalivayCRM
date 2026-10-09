import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "navalivay-card-tariffs-"));
const tempDbPath = path.join(tempDir, "test.db");

process.env.DATABASE_FILE = tempDbPath;
process.env.BOT_TOKEN = "";
process.env.BUSINESS_TIMEZONE = "Europe/Minsk";

const { initDb, db } = await import("../db.js");
const { issueToken } = await import("../auth.js");
const { crmRouter } = await import("../routes/crm.js");
const {
  applyCardTariffToAccount,
  approveCardLimitRequest,
  forceIssueCardPayment,
  getCardAdminSnapshot,
  setCardAccount,
} = await import("../utils/card-payment-service.js");

initDb();

const app = express();
app.use(express.json());
app.use(crmRouter);

const server = await new Promise((resolve) => {
  const instance = app.listen(0, () => resolve(instance));
});
const token = issueToken("admin");
const auth = { Authorization: `Bearer ${token}` };

async function apiCall(method, url, body) {
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}${url}`,
    {
      method,
      headers: { "Content-Type": "application/json", ...auth },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
  return { status: response.status, payload: await response.json().catch(() => null) };
}

function ensureAccount(telegramId, username) {
  setCardAccount({
    telegramId,
    telegramUsername: username,
    enabled: true,
    monthlyLimitMinor: 25000,
    maxOrderMinor: 4500,
  });
}

// --- Подготовка: тарифы с двумя лимитами ---
db.prepare(`
  INSERT INTO card_payment_tariffs (id, title, limit_minor, monthly_limit_minor, per_order_limit_minor, transition_cost_text, position, active)
  VALUES ('tariff_test', 'Тест-тариф', 35000, 35000, 6000, '50 BYN единоразово', 10, 1)
  ON CONFLICT(id) DO UPDATE SET monthly_limit_minor = 35000, per_order_limit_minor = 6000
`).run();

console.log("card tariffs: admin snapshot includes both tariff limits and account tariff");
{
  ensureAccount("9001", "tariff_user");
  const snapshot = getCardAdminSnapshot();
  const account = snapshot.accounts.find((a) => a.telegram_id === "9001");
  assert.equal(account.tariff_id, null);
  const tariff = snapshot.tariffs.find((t) => t.id === "tariff_test");
  assert.equal(tariff.monthly_limit_minor, 35000);
  assert.equal(tariff.per_order_limit_minor, 6000);
}

console.log("card tariffs: apply tariff updates both account limits");
{
  applyCardTariffToAccount("9001", "tariff_test");
  const account = db
    .prepare("SELECT * FROM card_payment_accounts WHERE telegram_id = '9001'")
    .get();
  assert.equal(account.monthly_limit_minor, 35000);
  assert.equal(account.max_order_minor, 6000);
  assert.equal(account.tariff_id, "tariff_test");
}

console.log("card tariffs: apply null tariff resets to standard limits");
{
  applyCardTariffToAccount("9001", null);
  const account = db
    .prepare("SELECT * FROM card_payment_accounts WHERE telegram_id = '9001'")
    .get();
  assert.equal(account.monthly_limit_minor, 25000);
  assert.equal(account.max_order_minor, 4500);
  assert.equal(account.tariff_id, null);
}

console.log("card tariffs: apply unknown tariff fails");
{
  assert.throws(
    () => applyCardTariffToAccount("9001", "tariff_missing"),
    (error) => error.message === "card_tariff_not_found",
  );
}

console.log("card tariffs: PUT account tariff route applies via API");
{
  applyCardTariffToAccount("9001", null);
  const { status, payload } = await apiCall(
    "PUT",
    "/api/admin/crm/card-payments/accounts/9001/tariff",
    { tariff_id: "tariff_test" },
  );
  assert.equal(status, 200);
  const account = payload.accounts.find((a) => a.telegram_id === "9001");
  assert.equal(account.tariff_id, "tariff_test");
  assert.equal(account.tariff_monthly_limit_minor, 35000);
  assert.equal(account.tariff_per_order_limit_minor, 6000);
  const row = db
    .prepare("SELECT monthly_limit_minor, max_order_minor FROM card_payment_accounts WHERE telegram_id = '9001'")
    .get();
  assert.equal(row.monthly_limit_minor, 35000);
  assert.equal(row.max_order_minor, 6000);
}

console.log("card tariffs: approve request applies tariff limits automatically");
{
  ensureAccount("9002", "request_user");
  applyCardTariffToAccount("9002", null);
  const requestId = `req_${Date.now()}`;
  db.prepare(`
    INSERT INTO card_payment_limit_requests (
      id, telegram_id, telegram_username, tariff_id, tariff_title,
      current_limit_minor, requested_limit_minor, status
    ) VALUES (?, '9002', 'request_user', 'tariff_test', 'Тест-тариф', 4500, 35000, 'new')
  `).run(requestId);

  const approved = approveCardLimitRequest(requestId, "admin");
  assert.equal(approved.status, "processed");
  assert.equal(approved.resolved_by, "admin");
  const account = db
    .prepare("SELECT * FROM card_payment_accounts WHERE telegram_id = '9002'")
    .get();
  assert.equal(account.monthly_limit_minor, 35000);
  assert.equal(account.max_order_minor, 6000);
  assert.equal(account.tariff_id, "tariff_test");
  assert.equal(account.enabled, 1);
}

console.log("card tariffs: approving an already processed request fails");
{
  const requestId = `req_done_${Date.now()}`;
  db.prepare(`
    INSERT INTO card_payment_limit_requests (
      id, telegram_id, telegram_username, tariff_id, tariff_title,
      current_limit_minor, requested_limit_minor, status
    ) VALUES (?, '9002', 'request_user', 'tariff_test', 'Тест-тариф', 4500, 35000, 'processed')
  `).run(requestId);
  assert.throws(
    () => approveCardLimitRequest(requestId, "admin"),
    (error) => error.message === "card_request_already_resolved",
  );
}

console.log("card tariffs: approve route via API");
{
  ensureAccount("9003", "route_user");
  const requestId = `req_route_${Date.now()}`;
  db.prepare(`
    INSERT INTO card_payment_limit_requests (
      id, telegram_id, telegram_username, tariff_id, tariff_title,
      current_limit_minor, requested_limit_minor, status
    ) VALUES (?, '9003', 'route_user', 'tariff_test', 'Тест-тариф', 4500, 35000, 'new')
  `).run(requestId);
  const { status, payload } = await apiCall(
    "POST",
    `/api/admin/crm/card-payments/requests/${requestId}/approve`,
  );
  assert.equal(status, 200);
  const request = payload.requests.find((r) => r.id === requestId);
  assert.equal(request.status, "processed");
  assert.equal(request.tariff_transition_cost_text, "50 BYN единоразово");
  const account = payload.accounts.find((a) => a.telegram_id === "9003");
  assert.equal(account.tariff_id, "tariff_test");
  assert.equal(account.monthly_limit_minor, 35000);
}

console.log("card tariffs: force card payment records operation and cooldown");
{
  ensureAccount("9004", "forced_user");
  // FK: операция ссылается на реальный заказ — создаём минимальный.
  db.prepare(`
    INSERT INTO orders (id, order_number, status, total_amount, final_amount)
    VALUES ('order_force_1', 99001, 'in_progress', 50, 50)
    ON CONFLICT(id) DO NOTHING
  `).run();
  const before = db
    .prepare("SELECT cooldown_started_at FROM card_payment_accounts WHERE telegram_id = '9004'")
    .get();
  assert.equal(before.cooldown_started_at, null);

  const operationId = forceIssueCardPayment({
    orderId: "order_force_1",
    telegramId: "9004",
    amountMinor: 5000,
    note: "клиент без наличных",
    actorUsername: "admin",
  });
  assert.ok(operationId);

  const operation = db
    .prepare("SELECT * FROM card_payment_operations WHERE order_id = 'order_force_1'")
    .get();
  assert.equal(operation.operation_type, "order");
  assert.equal(operation.operation_status, "spent");
  assert.equal(operation.amount_minor, 5000);
  assert.ok(operation.cooldown_check !== "never");

  const account = db
    .prepare("SELECT cooldown_started_at FROM card_payment_accounts WHERE telegram_id = '9004'")
    .get();
  assert.ok(account.cooldown_started_at, "cooldown should be set after force issue");

  // Повторная принудительная выдача по тому же заказу не дублирует операцию
  forceIssueCardPayment({
    orderId: "order_force_1",
    telegramId: "9004",
    amountMinor: 5000,
  });
  const count = db
    .prepare("SELECT COUNT(*) AS c FROM card_payment_operations WHERE order_id = 'order_force_1'")
    .get();
  assert.equal(count.c, 1);
}

console.log("card tariffs: force card payment requires telegram id");
{
  assert.throws(
    () => forceIssueCardPayment({ orderId: "order_x", telegramId: "", amountMinor: 100 }),
    (error) => error.message === "customer_telegram_id_required",
  );
}

console.log("card tariffs: tariff create route persists both limits");
{
  const { status, payload } = await apiCall("POST", "/api/admin/crm/card-payments/tariffs", {
    title: "Тариф API",
    limit: 10000,
    monthly_limit: 10000,
    per_order_limit: 55,
    transition_cost_text: "20 BYN",
    position: 99,
  });
  assert.equal(status, 201);
  const created = payload.tariffs.find((t) => t.title === "Тариф API");
  assert.equal(created.monthly_limit_minor, 1000000);
  assert.equal(created.per_order_limit_minor, 5500);
}

server.close();
fs.rmSync(tempDir, { recursive: true, force: true });
console.log("card tariffs: all tests passed");
