/**
 * Настройки клиента (оптовый персональный минимум) — HTTP API тесты.
 * Запуск: node server/tests/crm-wholesale-settings-routes.test.js
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "navalivay-wholesale-settings-"));
const tempDbPath = path.join(tempDir, "test.db");

process.env.DATABASE_FILE = tempDbPath;
process.env.BOT_TOKEN = "";
process.env.NODE_ENV = "test";

const { initDb, db } = await import("../db.js");
const { issueToken } = await import("../auth.js");
const { crmRouter } = await import("../routes/crm.js");

initDb();

const app = express();
app.use(express.json());
app.use(crmRouter);

const server = await new Promise((resolve) => {
  const instance = app.listen(0, () => resolve(instance));
});

const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;
const authToken = issueToken("crm-admin");

function authHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${authToken}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function requestJson(url, options = {}) {
  const response = await fetch(`${baseUrl}${url}`, options);
  const data = await response.json().catch(() => null);
  return { response, data };
}

const results = { passed: 0, failed: 0 };
function ok(cond, msg) {
  if (cond) {
    results.passed += 1;
    console.log(`  OK: ${msg}`);
  } else {
    results.failed += 1;
    console.log(`  FAIL: ${msg}`);
  }
}

function insertCustomer({ id, telegram_id, telegram_username, override = null }) {
  db.prepare(
    `INSERT OR REPLACE INTO customers (
      id, telegram_id, telegram_username, first_name, last_name, notes,
      first_visit_at, last_visit_at, total_orders, total_spent, wholesale_min_override
    ) VALUES (?, ?, ?, 'Опт', 'Клиент', NULL, DATETIME('now'), DATETIME('now'), 0, 0, ?)`,
  ).run(id, telegram_id, telegram_username, override);
}

let orderSeq = 7000;
function insertOrder({ id, customer_id, status = "new", isWholesale = 1 }) {
  orderSeq += 1;
  db.prepare(
    `INSERT OR REPLACE INTO orders (
      id, order_number, customer_id, status, archived, needs_manager_action,
      total_amount, final_amount, is_wholesale, wholesale_tier_label, wholesale_min_quantity,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, 0, 0, 10, 10, ?, 'Опт от 25 позиций', 25, DATETIME('now'), DATETIME('now'))`,
  ).run(id, orderSeq, customer_id, status, isWholesale);
}

async function cleanup() {
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

async function main() {
  try {
    console.log("\n=== A-API1: без авторизации → 401 ===");
    {
      const get = await requestJson("/api/admin/crm/wholesale-settings/some_user");
      ok(get.response.status === 401, "GET без токена отклоняется");

      const put = await requestJson("/api/admin/crm/wholesale-settings/some_user", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ min_quantity: 15 }),
      });
      ok(put.response.status === 401, "PUT без токена отклоняется");
    }

    insertCustomer({
      id: "cust-ws-1",
      telegram_id: "7011",
      telegram_username: "ws_customer",
    });
    insertCustomer({
      id: "cust-ws-2",
      telegram_id: "7012",
      telegram_username: "ws_busy",
      override: 20,
    });

    console.log("\n=== A-API2: неизвестный username → 404 ===");
    {
      const missing = await requestJson(
        "/api/admin/crm/wholesale-settings/ghost_user",
        { headers: authHeaders() },
      );
      ok(missing.response.status === 404, "GET неизвестного клиента → 404");
      ok(missing.data?.error === "customer_not_found", "код customer_not_found");
    }

    console.log("\n=== A-API3: GET настроек клиента ===");
    {
      const found = await requestJson("/api/admin/crm/wholesale-settings/ws_customer", {
        headers: authHeaders(),
      });
      ok(found.response.status === 200, "GET находит клиента");
      ok(found.data?.customer?.id === "cust-ws-1", "карточка клиента с id");
      ok(found.data?.customer?.telegram_username === "ws_customer", "username в карточке");
      ok(found.data?.customer?.wholesale_min_override === null, "override пуст по умолчанию");

      const tiers = found.data?.tiers || [];
      ok(tiers.length === 4, "в ответе 4 оптовых уровня");
      const tier25 = tiers.find((tier) => tier.code === "25");
      ok(Boolean(tier25), "уровень с кодом 25 присутствует");
      ok(tier25?.min_order_quantity === 25, "уровень 25 несёт количество 25");
      const tier150 = tiers.find((tier) => tier.code === "150");
      ok(tier150?.min_order_quantity === 150, "уровень 150 несёт количество 150");
      ok(found.data?.active_wholesale_order === null, "активного оптового заказа нет");

      const withAt = await requestJson("/api/admin/crm/wholesale-settings/@ws_customer", {
        headers: authHeaders(),
      });
      ok(withAt.response.status === 200, "поиск с @ тоже находит клиента");
      ok(withAt.data?.customer?.id === "cust-ws-1", "@username резолвится в того же клиента");
    }

    console.log("\n=== A-API4: активный оптовый заказ в ответе ===");
    {
      insertOrder({ id: "order-ws-1", customer_id: "cust-ws-1" });
      const found = await requestJson("/api/admin/crm/wholesale-settings/ws_customer", {
        headers: authHeaders(),
      });
      const active = found.data?.active_wholesale_order;
      ok(Boolean(active), "активный оптовый заказ возвращается");
      ok(active?.wholesale_min_quantity === 25, "снапшот минимума заказа в ответе");
      ok(typeof active?.order_number === "number", "номер заказа в ответе");
    }

    console.log("\n=== A-API5: PUT — валидация минимума ===");
    {
      for (const bad of [0, -5, 1.5, 10001, "abc"]) {
        const invalid = await requestJson("/api/admin/crm/wholesale-settings/ws_customer", {
          method: "PUT",
          headers: authHeaders(),
          body: JSON.stringify({ min_quantity: bad }),
        });
        ok(
          invalid.response.status === 400 && invalid.data?.error === "invalid_min_quantity",
          `некорректный min_quantity ${JSON.stringify(bad)} отклоняется`,
        );
      }

      const missing = await requestJson("/api/admin/crm/wholesale-settings/ghost_user", {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ min_quantity: 15 }),
      });
      ok(missing.response.status === 404, "PUT для неизвестного клиента → 404");
    }

    console.log("\n=== A-API6: PUT — сохранение и сброс ===");
    {
      const saved = await requestJson("/api/admin/crm/wholesale-settings/ws_customer", {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ min_quantity: 15 }),
      });
      ok(saved.response.status === 200 && saved.data?.ok === true, "PUT сохраняет минимум 15");
      ok(saved.data?.customer?.wholesale_min_override === 15, "ответ содержит обновлённый override");

      const stored = db
        .prepare("SELECT wholesale_min_override FROM customers WHERE id = 'cust-ws-1'")
        .get();
      ok(stored.wholesale_min_override === 15, "override записан в базу");

      const cleared = await requestJson("/api/admin/crm/wholesale-settings/ws_customer", {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ min_quantity: null }),
      });
      ok(cleared.response.status === 200, "PUT с null сбрасывает override");
      const afterClear = db
        .prepare("SELECT wholesale_min_override FROM customers WHERE id = 'cust-ws-1'")
        .get();
      ok(afterClear.wholesale_min_override === null, "override сброшен в базе");

      // Существующий override не затирается чтением.
      const existing = await requestJson("/api/admin/crm/wholesale-settings/ws_busy", {
        headers: authHeaders(),
      });
      ok(existing.data?.customer?.wholesale_min_override === 20, "чужой override не тронут");
    }

    console.log("\n=== A-API7: регистронезависимый поиск по username ===");
    {
      const upper = await requestJson("/api/admin/crm/wholesale-settings/WS_CUSTOMER", {
        headers: authHeaders(),
      });
      ok(upper.response.status === 200, "username находится без учёта регистра");
      ok(upper.data?.customer?.id === "cust-ws-1", "тот же клиент найден по верхнему регистру");
    }

    console.log(
      `\nИтог: ${results.passed} OK, ${results.failed} FAIL\n`,
    );
    if (results.failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await cleanup();
  }
}

await main();
