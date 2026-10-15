/**
 * Хаб действий с клиентом (customer-hub) — HTTP API тесты.
 * Запуск: node server/tests/crm-customer-hub-routes.test.js
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "navalivay-customer-hub-"));
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

function insertCustomer({
  id,
  telegram_id,
  telegram_username,
  override = null,
  totalOrders = 0,
  notes = null,
}) {
  db.prepare(
    `INSERT OR REPLACE INTO customers (
      id, telegram_id, telegram_username, first_name, last_name, notes,
      first_visit_at, last_visit_at, total_orders, total_spent, wholesale_min_override
    ) VALUES (?, ?, ?, 'Хаб', 'Клиент', ?, DATETIME('now'), DATETIME('now'), ?, 0, ?)`,
  ).run(id, telegram_id, telegram_username, notes, totalOrders, override);
}

let orderSeq = 8100;
function insertOrder({ id, customer_id, status = "new" }) {
  orderSeq += 1;
  db.prepare(
    `INSERT OR REPLACE INTO orders (
      id, order_number, customer_id, status, archived, needs_manager_action,
      total_amount, final_amount, is_wholesale, wholesale_tier_label, wholesale_min_quantity,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, 0, 0, 10, 10, 1, 'Опт от 25 позиций', 25, DATETIME('now'), DATETIME('now'))`,
  ).run(id, orderSeq, customer_id, status);
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
    console.log("\n=== H-API1: без авторизации → 401 ===");
    {
      const missing = await requestJson("/api/admin/crm/customer-hub/some_user");
      ok(missing.response.status === 401, "GET без токена отклоняется");
    }

    console.log("\n=== H-API2: неизвестный username → 404 ===");
    {
      const missing = await requestJson("/api/admin/crm/customer-hub/ghost_user", {
        headers: authHeaders(),
      });
      ok(missing.response.status === 404, "GET неизвестного клиента → 404");
      ok(missing.data?.error === "customer_not_found", "код customer_not_found");
    }

    insertCustomer({
      id: "cust-hub-1",
      telegram_id: "9011",
      telegram_username: "hub_customer",
      totalOrders: 7,
      notes: "Любит быструю доставку",
    });

    console.log("\n=== H-API3: карточка клиента без ограничений ===");
    {
      const found = await requestJson("/api/admin/crm/customer-hub/hub_customer", {
        headers: authHeaders(),
      });
      ok(found.response.status === 200, "GET находит клиента");
      const customer = found.data?.customer;
      ok(customer?.id === "cust-hub-1", "карточка клиента с id");
      ok(customer?.telegram_username === "hub_customer", "username в карточке");
      ok(customer?.telegram_id === "9011", "telegram_id в карточке");
      ok(customer?.total_orders === 7, "количество заказов в карточке");
      ok(customer?.notes === "Любит быструю доставку", "заметка клиента в карточке");
      ok(customer?.wholesale_min_override === null, "override пуст по умолчанию");

      ok(found.data?.block === null, "блокировки нет");
      ok(found.data?.invite_ban === null, "запрета приглашать нет");
      ok(found.data?.inviter === null, "пригласившего нет");
      ok(found.data?.card_profile === null, "карточного профиля нет");
      ok(found.data?.active_wholesale_order === null, "активного оптового заказа нет");

      const tiers = found.data?.tiers || [];
      ok(tiers.length === 4, "в ответе 4 оптовых уровня");
      ok(tiers.find((tier) => tier.code === "25")?.min_order_quantity === 25, "уровень 25 несёт количество 25");

      const withAt = await requestJson("/api/admin/crm/customer-hub/@hub_customer", {
        headers: authHeaders(),
      });
      ok(withAt.response.status === 200 && withAt.data?.customer?.id === "cust-hub-1", "поиск с @ находит клиента");

      const upper = await requestJson("/api/admin/crm/customer-hub/HUB_CUSTOMER", {
        headers: authHeaders(),
      });
      ok(upper.response.status === 200 && upper.data?.customer?.id === "cust-hub-1", "поиск регистронезависимый");
    }

    console.log("\n=== H-API4: активная блокировка и превентивный бан ===");
    {
      db.prepare(`
        INSERT INTO customer_blocks (id, customer_id, block_type, reason, blocked_by, active)
        VALUES ('block-hub-1', 'cust-hub-1', 'delivery', 'Спам', 'manager', 1)
      `).run();
      const found = await requestJson("/api/admin/crm/customer-hub/hub_customer", {
        headers: authHeaders(),
      });
      ok(found.data?.block?.kind === "active", "активная блокировка помечена как active");
      ok(found.data?.block?.id === "block-hub-1", "id блокировки в ответе");
      ok(found.data?.block?.reason === "Спам", "причина блокировки в ответе");

      db.prepare(`UPDATE customer_blocks SET active = 0 WHERE id = 'block-hub-1'`).run();
      insertCustomer({ id: "cust-hub-2", telegram_id: "9012", telegram_username: "hub_pending" });
      db.prepare(`
        INSERT INTO pending_customer_bans (telegram_username, reason, created_by)
        VALUES ('hub_pending', 'Ждёт первого захода', 'manager')
      `).run();
      const pending = await requestJson("/api/admin/crm/customer-hub/hub_pending", {
        headers: authHeaders(),
      });
      ok(pending.data?.block?.kind === "pending", "превентивный бан помечен как pending");
      ok(pending.data?.block?.reason === "Ждёт первого захода", "причина превентивного бана в ответе");
    }

    console.log("\n=== H-API5: запрет приглашать и пригласивший ===");
    {
      db.prepare(`
        INSERT INTO customer_invite_bans (id, customer_id, reason, banned_by, active)
        VALUES ('ban-hub-1', 'cust-hub-1', 'Слив приглашений', 'manager', 1)
      `).run();

      insertCustomer({ id: "cust-hub-inviter", telegram_id: "9013", telegram_username: "hub_inviter" });
      db.prepare(`
        INSERT INTO customer_referrals (
          invitee_customer_id, inviter_customer_id, inviter_username_snapshot, submitted_username
        ) VALUES ('cust-hub-1', 'cust-hub-inviter', 'hub_inviter', 'hub_inviter')
      `).run();
      db.prepare(`
        INSERT INTO customer_invite_bans (id, customer_id, reason, banned_by, active)
        VALUES ('ban-hub-inviter', 'cust-hub-inviter', 'Спамит приглашениями', 'manager', 1)
      `).run();

      const found = await requestJson("/api/admin/crm/customer-hub/hub_customer", {
        headers: authHeaders(),
      });
      ok(found.data?.invite_ban?.id === "ban-hub-1", "запрет приглашать в ответе");
      ok(found.data?.invite_ban?.reason === 'Слив приглашений', "причина запрета в ответе");

      const inviter = found.data?.inviter;
      ok(inviter?.customer_id === "cust-hub-inviter", "пригласивший найден по referrals");
      ok(inviter?.username === "hub_inviter", "username пригласившего из актуального профиля");
      ok(inviter?.is_invite_banned === true, "флаг запрета пригласившего в ответе");
      ok(inviter?.invite_ban_id === "ban-hub-inviter", "id запрета пригласившего в ответе");
    }

    console.log("\n=== H-API6: карточный профиль оплаты ===");
    {
      db.prepare(`
        INSERT INTO card_payment_accounts (
          telegram_id, telegram_username, enabled, monthly_limit_minor, max_order_minor,
          cooldown_days, cooldown_started_at
        ) VALUES ('9011', 'hub_customer', 1, 50000, 9000, 7, DATETIME('now'))
      `).run();

      const found = await requestJson("/api/admin/crm/customer-hub/hub_customer", {
        headers: authHeaders(),
      });
      const profile = found.data?.card_profile;
      ok(Boolean(profile), "карточный профиль найден по username клиента");
      ok(profile?.source === "linked", "профиль привязан к telegram_id");
      ok(profile?.enabled === true, "оплата картой разрешена");
      ok(profile?.monthly_limit_minor === 50000, "месячный лимит в профиле");
      ok(profile?.max_order_minor === 9000, "лимит на заказ в профиле");

      db.prepare(`UPDATE card_payment_accounts SET enabled = 0 WHERE telegram_id = '9011'`).run();
      const disabled = await requestJson("/api/admin/crm/customer-hub/hub_customer", {
        headers: authHeaders(),
      });
      ok(disabled.data?.card_profile?.enabled === false, "оплата картой запрещена после выключения");
    }

    console.log("\n=== H-API7: активный оптовый заказ в ответе ===");
    {
      insertOrder({ id: "order-hub-1", customer_id: "cust-hub-1" });
      const found = await requestJson("/api/admin/crm/customer-hub/hub_customer", {
        headers: authHeaders(),
      });
      const active = found.data?.active_wholesale_order;
      ok(Boolean(active), "активный оптовый заказ возвращается");
      ok(active?.wholesale_min_quantity === 25, "снапшот минимума заказа в ответе");
      ok(typeof active?.order_number === "number", "номер заказа в ответе");
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
