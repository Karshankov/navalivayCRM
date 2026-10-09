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
  adjustCardDailyLimit,
  applyCardTariffToAccount,
  approveCardLimitRequest,
  clearCardAccountCooldown,
  findCardAccountProfileByUsername,
  forceIssueCardPayment,
  getCardAdminSnapshot,
  issueCardOrder,
  setCardAccount,
  setCardAccountCooldownDays,
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

// --- Лимиты: месяцы, уменьшение дня, поиск профиля ---
console.log("card tariffs: adjust daily limit supports negative delta");
{
  adjustCardDailyLimit(5000, "admin");
  const snapshot = getCardAdminSnapshot();
  assert.equal(snapshot.limits.daily_increase_minor, 5000);
  // Уменьшение
  adjustCardDailyLimit(-2000, "admin");
  const snapshot2 = getCardAdminSnapshot();
  assert.equal(snapshot2.limits.daily_increase_minor, 3000);
  // Нельзя опустить ниже нуля
  assert.throws(
    () => adjustCardDailyLimit(-100000000, "admin"),
    (error) => error.message === "daily_limit_below_zero",
  );
}

console.log("card tariffs: months list returns current and next with limits");
{
  const months = getCardAdminSnapshot().months;
  assert.equal(months.length, 2);
  assert.equal(months[0].is_current, true);
  assert.equal(months[0].month_key, "2026-10");
  assert.ok(Number(months[0].limit_minor) >= 0);
  assert.equal(months[1].month_key, "2026-11");
}

console.log("card tariffs: exceeded_today_minor computed when over limit");
{
  // Загоняем committed выше дневного лимита: увеличиваем день и пробиваем больше
  const before = getCardAdminSnapshot().limits;
  db.prepare(`
    INSERT INTO card_payment_operations (
      id, operation_type, operation_status, customer_telegram_id, amount_minor, business_date
    ) VALUES (?, 'manual', 'spent', '9001', 100000000, ?)
  `).run("op_exceed_test", before.business_date);
  const after = getCardAdminSnapshot().limits;
  assert.ok(after.exceeded_today_minor > 0);
  db.prepare("DELETE FROM card_payment_operations WHERE id = 'op_exceed_test'").run();
}

console.log("card tariffs: profile search by username returns full view");
{
  ensureAccount("9005", "search_user");
  db.prepare(`
    UPDATE card_payment_accounts SET cooldown_started_at = ?
    WHERE telegram_id = '9005'
  `).run(new Date(Date.now() - 2 * 86400000).toISOString());
  const profile = findCardAccountProfileByUsername("@Search_User");
  assert.equal(profile.telegram_id, "9005");
  assert.equal(profile.enabled, true);
  assert.equal(profile.monthly_limit_minor, 25000);
  assert.equal(profile.max_order_minor, 4500);
  assert.equal(profile.cooldown_days_left, 8);
  assert.ok(profile.cooldown_until);
}

console.log("card tariffs: profile search misses unknown username");
{
  const profile = findCardAccountProfileByUsername("@no_such_user");
  assert.equal(profile, null);
}

console.log("card tariffs: profile search finds pending accounts");
{
  setCardAccount({
    telegramUsername: "pending_search",
    enabled: true,
    monthlyLimitMinor: 25000,
    maxOrderMinor: 4500,
  });
  const profile = findCardAccountProfileByUsername("pending_search");
  assert.equal(profile.source, "pending");
  assert.equal(profile.telegram_id, null);
  assert.equal(profile.enabled, true);
}

console.log("card tariffs: daily adjust route via API");
{
  const { status, payload } = await apiCall(
    "POST",
    "/api/admin/crm/card-payments/daily-adjust",
    { delta: -1 },
  );
  assert.equal(status, 200);
  assert.ok(payload.limits);
  assert.ok(Number.isFinite(payload.limits.daily_limit_minor));
}

console.log("card tariffs: profile route via API");
{
  const { status, payload } = await apiCall(
    "GET",
    "/api/admin/crm/card-payments/profile/search_user",
  );
  assert.equal(status, 200);
  assert.equal(payload.telegram_id, "9005");
  const missing = await apiCall(
    "GET",
    "/api/admin/crm/card-payments/profile/nobody_here",
  );
  assert.equal(missing.status, 404);
}

// --- Персональная длительность паузы ---
console.log("card tariffs: profile returns personal cooldown_days");
{
  ensureAccount("9010", "cooldown_user");
  db.prepare(`
    UPDATE card_payment_accounts SET cooldown_days = 3 WHERE telegram_id = '9010'
  `).run();
  const profile = findCardAccountProfileByUsername("cooldown_user");
  assert.equal(profile.cooldown_days, 3);
}

console.log("card tariffs: setCardAccountCooldownDays validates range");
{
  assert.throws(
    () => setCardAccountCooldownDays("9010", -1),
    (error) => error.message === "invalid_cooldown_days",
  );
  assert.throws(
    () => setCardAccountCooldownDays("9010", 1.5),
    (error) => error.message === "invalid_cooldown_days",
  );
  assert.throws(
    () => setCardAccountCooldownDays("nobody", 5),
    (error) => error.message === "card_account_not_found",
  );
  const row = setCardAccountCooldownDays("9010", 7);
  assert.equal(row.cooldown_days, 7);
}

console.log("card tariffs: zero cooldown_days disables pause on issue");
{
  ensureAccount("9011", "nopause_user");
  setCardAccountCooldownDays("9011", 0);
  db.prepare(`
    INSERT INTO orders (id, order_number, status, total_amount, final_amount)
    VALUES ('order_nopause', 99002, 'in_progress', 30, 30)
    ON CONFLICT(id) DO NOTHING
  `).run();
  // резерв, чтобы issueCardOrder нашёл операцию
  db.prepare(`
    INSERT INTO card_payment_operations (
      id, operation_type, operation_status, order_id, customer_telegram_id, amount_minor, business_date
    ) VALUES ('op_nopause', 'order', 'reserved', 'order_nopause', '9011', 3000, '2026-10-09')
    ON CONFLICT(order_id) DO NOTHING
  `).run();
  issueCardOrder("order_nopause", new Date());
  const account = db
    .prepare("SELECT cooldown_started_at FROM card_payment_accounts WHERE telegram_id = '9011'")
    .get();
  assert.equal(account.cooldown_started_at, null);
}

console.log("card tariffs: nonzero cooldown_days sets pause on issue");
{
  ensureAccount("9012", "pause_user");
  setCardAccountCooldownDays("9012", 5);
  db.prepare(`
    INSERT INTO orders (id, order_number, status, total_amount, final_amount)
    VALUES ('order_pause', 99003, 'in_progress', 30, 30)
    ON CONFLICT(id) DO NOTHING
  `).run();
  db.prepare(`
    INSERT INTO card_payment_operations (
      id, operation_type, operation_status, order_id, customer_telegram_id, amount_minor, business_date
    ) VALUES ('op_pause', 'order', 'reserved', 'order_pause', '9012', 3000, '2026-10-09')
    ON CONFLICT(order_id) DO NOTHING
  `).run();
  issueCardOrder("order_pause", new Date());
  const profile = findCardAccountProfileByUsername("pause_user");
  assert.ok(profile.cooldown_started_at, "pause should start on issue");
  assert.equal(profile.cooldown_days, 5);
}

console.log("card tariffs: clearCardAccountCooldown lifts active pause");
{
  const before = findCardAccountProfileByUsername("pause_user");
  assert.ok(before.cooldown_until, "pause should be active before clear");
  const result = clearCardAccountCooldown("9012", "admin");
  assert.equal(result.cleared, true);
  const after = findCardAccountProfileByUsername("pause_user");
  assert.equal(after.cooldown_until, null);
  assert.equal(after.cooldown_days, 5, "duration stays for next issue");
}

console.log("card tariffs: clear without active pause returns cleared:false");
{
  const result = clearCardAccountCooldown("9010", "admin");
  assert.equal(result.cleared, false);
}

console.log("card tariffs: cooldown days route via API");
{
  const { status, payload } = await apiCall(
    "PUT",
    "/api/admin/crm/card-payments/accounts/9010/cooldown-days",
    { days: 14 },
  );
  assert.equal(status, 200);
  assert.equal(payload.profile.cooldown_days, 14);
  const invalid = await apiCall(
    "PUT",
    "/api/admin/crm/card-payments/accounts/9010/cooldown-days",
    { days: -5 },
  );
  assert.equal(invalid.status, 400);
}

console.log("card tariffs: clear cooldown route via API");
{
  const { status, payload } = await apiCall(
    "POST",
    "/api/admin/crm/card-payments/accounts/9012/clear-cooldown",
  );
  assert.equal(status, 200);
  assert.equal(payload.cleared, true);
}

server.close();
fs.rmSync(tempDir, { recursive: true, force: true });
console.log("card tariffs: all tests passed");
