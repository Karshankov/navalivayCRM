import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "navalivay-cash-pacing-"));
const tempDbPath = path.join(tempDir, "test.db");

process.env.DATABASE_FILE = tempDbPath;
process.env.BOT_TOKEN = "";
process.env.BUSINESS_TIMEZONE = "Europe/Minsk";

const { initDb, db } = await import("../db.js");
const { issueToken } = await import("../auth.js");
const { crmFinanceRouter } = await import("../routes/crm-finance.js");
const {
  computeCashPacingMonthProjection,
  getCurrentBusinessDateKey,
  getCurrentBusinessMonthKey,
} = await import("../utils/cash-pacing.js");

initDb();

const app = express();
app.use(express.json());
app.use(crmFinanceRouter);

const server = await new Promise((resolve) => {
  const instance = app.listen(0, () => resolve(instance));
});

const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;
const authToken = issueToken("test-admin");

function authHeaders() {
  return {
    Authorization: `Bearer ${authToken}`,
    "Content-Type": "application/json",
  };
}

async function requestJson(url, options = {}) {
  const response = await fetch(`${baseUrl}${url}`, options);
  const data = await response.json().catch(() => null);
  return { response, data };
}

function shiftDateKey(dateKey, dayOffset) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  shifted.setUTCDate(shifted.getUTCDate() + dayOffset);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

function shiftMonthKey(monthKey, monthOffset) {
  const [year, month] = monthKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + monthOffset, 1, 12, 0, 0));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

const projection = computeCashPacingMonthProjection({
  month: { month_key: "2026-04" },
  items: [
    {
      id: "base",
      quantity: 10,
      cost_with_vat: 7.5,
      markup_percent: 170,
      effective_from: "2026-04-01",
    },
    {
      id: "addition",
      quantity: 10,
      cost_with_vat: 5,
      markup_percent: 100,
      effective_from: "2026-04-11",
      entry_type: "addition",
    },
  ],
  dailyFacts: [
    {
      id: "fact_1",
      fact_date: "2026-04-01",
      actual_amount: 50,
    },
  ],
  referenceDate: new Date("2026-04-10T09:00:00Z"),
});

assert.equal(projection.summary.total_limit, 303);
assert.equal(projection.summary.recommendation_date, "2026-04-10");
assert.equal(projection.summary.recommendation_amount, 7);
assert.equal(
  projection.dailyPlan.find((day) => day.date === "2026-04-10")?.recommended_amount,
  7,
);
assert.equal(
  projection.dailyPlan.find((day) => day.date === "2026-04-11")?.recommended_amount,
  13,
);

let result = await requestJson("/api/admin/crm/cash-pacing/months", {
  headers: authHeaders(),
});
assert.equal(result.response.status, 200);

result = await requestJson("/api/admin/crm/cash-pacing/months", {
  method: "POST",
  headers: authHeaders(),
  body: JSON.stringify({ month_key: "2025-04" }),
});
assert.equal(result.response.status, 200);
const monthId = result.data.month.id;

result = await requestJson(`/api/admin/crm/cash-pacing/months/${monthId}/items`, {
  method: "POST",
  headers: authHeaders(),
  body: JSON.stringify({
    title: "База апреля",
    quantity: 10,
    cost_with_vat: 7.5,
    markup_percent: 170,
    effective_from: "2025-04-01",
    entry_type: "base",
  }),
});
assert.equal(result.response.status, 200);

result = await requestJson(`/api/admin/crm/cash-pacing/months/${monthId}/items`, {
  method: "POST",
  headers: authHeaders(),
  body: JSON.stringify({
    title: "Дозагрузка апреля",
    quantity: 10,
    cost_with_vat: 5,
    markup_percent: 100,
    effective_from: "2025-04-11",
    entry_type: "addition",
  }),
});
assert.equal(result.response.status, 200);

result = await requestJson(`/api/admin/crm/cash-pacing/months/${monthId}/daily-facts`, {
  method: "POST",
  headers: authHeaders(),
  body: JSON.stringify({
    fact_date: "2025-04-01",
    actual_amount: 50,
  }),
});
assert.equal(result.response.status, 200);
assert.equal(
  result.data.daily_plan.find((day) => day.date === "2025-04-10")?.recommended_amount,
  7,
);
assert.equal(
  result.data.daily_plan.find((day) => day.date === "2025-04-11")?.recommended_amount,
  13,
);

result = await requestJson(`/api/admin/crm/cash-pacing/months/${monthId}/daily-facts`, {
  method: "POST",
  headers: authHeaders(),
  body: JSON.stringify({
    fact_date: "2025-04-10",
    actual_amount: 200,
  }),
});
assert.equal(result.response.status, 200);
assert.equal(
  result.data.daily_plan.find((day) => day.date === "2025-04-11")?.recommended_amount,
  3,
);

result = await requestJson(`/api/admin/crm/cash-pacing/months/${monthId}/daily-facts/2025-04-10`, {
  method: "DELETE",
  headers: authHeaders(),
});
assert.equal(result.response.status, 200);
assert.equal(
  result.data.daily_plan.find((day) => day.date === "2025-04-11")?.recommended_amount,
  13,
);

const currentMonthKey = getCurrentBusinessMonthKey();
const currentDateKey = getCurrentBusinessDateKey();

let currentMonthId = monthId;
if (currentMonthKey !== "2026-04") {
  result = await requestJson("/api/admin/crm/cash-pacing/months", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ month_key: currentMonthKey }),
  });
  assert.equal(result.response.status, 200);
  currentMonthId = result.data.month.id;
}

result = await requestJson(`/api/admin/crm/cash-pacing/months/${currentMonthId}/items`, {
  method: "POST",
  headers: authHeaders(),
  body: JSON.stringify({
    title: "Текущая дозагрузка сегодня",
    quantity: 1,
    cost_with_vat: 10,
    markup_percent: 100,
    effective_from: currentDateKey,
    entry_type: "addition",
  }),
});
assert.equal(result.response.status, 400);
assert.equal(result.data.error, "addition_starts_next_day");

const tomorrowDateKey = shiftDateKey(currentDateKey, 1);
if (tomorrowDateKey.startsWith(`${currentMonthKey}-`)) {
  result = await requestJson(`/api/admin/crm/cash-pacing/months/${currentMonthId}/daily-facts`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      fact_date: tomorrowDateKey,
      actual_amount: 123,
    }),
  });
  assert.equal(result.response.status, 400);
  assert.equal(result.data.error, "future_fact_date");
} else {
  const nextMonthKey = shiftMonthKey(currentMonthKey, 1);
  result = await requestJson("/api/admin/crm/cash-pacing/months", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ month_key: nextMonthKey }),
  });
  assert.ok([200, 409].includes(result.response.status));
  assert.ok(
    result.response.status === 200 || nextMonthKey === "2026-04",
    `Unexpected month conflict for ${nextMonthKey}`,
  );
  const futureMonthId =
    result.response.status === 200 ? result.data.month.id : monthId;
  result = await requestJson(`/api/admin/crm/cash-pacing/months/${futureMonthId}/daily-facts`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      fact_date: `${nextMonthKey}-01`,
      actual_amount: 123,
    }),
  });
  assert.equal(result.response.status, 400);
  assert.equal(result.data.error, "future_fact_date");
}

await new Promise((resolve, reject) => {
  server.close((error) => {
    if (error) reject(error);
    else resolve();
  });
});

db.close();
fs.rmSync(tempDir, { recursive: true, force: true });

console.log("cash-pacing.test.js passed");
