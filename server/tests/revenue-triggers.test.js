import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Триггеры выручки (раздел «Финансы»).
 *
 * Проверяет: миграцию (таблица), поиск счёта «Выручка» (и fallback на
 * дефолтную кассу), срабатывание одноразового триггера при достижении
 * порога, автосоздание системного повторяющегося триггера, суточную
 * проверку в 11:20 (уведомление каждый день при ≥ порога, без дублей
 * в течение дня, молчание после закупки, возобновление при новом
 * накоплении), пропуск получателя без карточки.
 */

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "navalivay-revenue-triggers-"));
process.env.DATABASE_FILE = path.join(tempDir, "test.db");
process.env.BOT_TOKEN = "test-bot-token";
process.env.NODE_ENV = "test";

const { initDb, db } = await import("../db.js");
const {
  checkRevenueTriggers,
  runDailySystemCheck,
  isDailyCheckDue,
  ensureSystemTrigger,
  getSystemTrigger,
  getSystemThreshold,
  findRevenueAccount,
  parseRecipientUsernames,
  SYSTEM_TRIGGER_ID,
} = await import("../utils/revenue-trigger-scheduler.js");

initDb();

function createCustomer(id, telegramId, username) {
  db.prepare(
    `
    INSERT INTO customers (id, telegram_id, telegram_username, first_name, last_name)
    VALUES (?, ?, ?, 'Test', 'User')
  `,
  ).run(id, String(telegramId), username);
}

function insertTrigger(id, threshold, usernames) {
  db.prepare(
    `
    INSERT INTO revenue_triggers (id, threshold_amount, recipient_usernames, enabled)
    VALUES (?, ?, ?, 1)
  `,
  ).run(id, threshold, JSON.stringify(usernames));
}

function outboxCount() {
  return db
    .prepare("SELECT COUNT(*) AS c FROM internal_notification_outbox WHERE event_type = 'revenue.trigger'")
    .get().c;
}

try {
  console.log("migration: таблица на месте");
  const columns = db.prepare("PRAGMA table_info(revenue_triggers)").all().map((c) => c.name);
  for (const expected of [
    "id", "threshold_amount", "recipient_usernames", "enabled",
    "triggered_at", "triggered_balance", "created_at",
  ]) {
    assert.ok(columns.includes(expected), `колонка ${expected}`);
  }

  console.log("account: счёт «Выручка» по имени, fallback на кассу");
  // В свежей базе только дефолтная «Касса» — fallback сработает.
  const fallbackAccount = findRevenueAccount(db);
  assert.equal(fallbackAccount.name, "Касса", "fallback на дефолтную кассу");

  // Заводим счёт «Выручка» — теперь он главный.
  db.prepare(
    "INSERT INTO cash_accounts (id, name, balance, is_default, active) VALUES ('acc_revenue', 'Выручка', 0, 0, 1)",
  ).run();
  const revenueAccount = findRevenueAccount(db);
  assert.equal(revenueAccount.id, "acc_revenue", "нашёлся счёт «Выручка»");

  console.log("helpers: parseRecipientUsernames");
  assert.deepEqual(parseRecipientUsernames('["ppofic","rk0ff"]'), ["ppofic", "rk0ff"]);
  assert.deepEqual(parseRecipientUsernames("[]"), []);
  assert.deepEqual(parseRecipientUsernames("битый json"), []);

  console.log("trigger: ниже порога — не срабатывает");
  createCustomer("cust-trg-1", "4001", "ppofic");
  createCustomer("cust-trg-2", "4002", "rk0ff");
  insertTrigger("trg-1", 2500, ["ppofic", "rk0ff"]);
  const below = checkRevenueTriggers(db, { now: new Date("2026-10-20T12:00:00Z") });
  assert.equal(below.checked, 1);
  assert.equal(below.enqueued, 0, "баланс 0 < 2500 — отправок нет");
  assert.equal(outboxCount(), 0);
  const stillEnabled = db
    .prepare("SELECT enabled FROM revenue_triggers WHERE id = 'trg-1'")
    .get().enabled;
  assert.equal(stillEnabled, 1, "триггер остался активным");

  console.log("trigger: достиг порога — уведомления всем");
  db.prepare("UPDATE cash_accounts SET balance = 2500 WHERE id = 'acc_revenue'").run();
  const hit = checkRevenueTriggers(db, { now: new Date("2026-10-20T12:01:00Z") });
  assert.equal(hit.checked, 1);
  assert.equal(hit.enqueued, 2, "уведомления обоим получателям");
  assert.deepEqual(hit.triggered, ["trg-1"]);
  const rows = db
    .prepare("SELECT unique_key, recipient_username, payload_json FROM internal_notification_outbox WHERE event_type = 'revenue.trigger'")
    .all();
  const usernames = rows.map((row) => row.recipient_username).sort();
  assert.deepEqual(usernames, ["ppofic", "rk0ff"]);
  const payload = JSON.parse(rows[0].payload_json);
  assert.match(payload.text, /2500\.00/);
  assert.match(payload.text, /Выручка/);

  console.log("trigger: одноразовый деактивирован и завёл системный");
  const afterHit = db
    .prepare("SELECT enabled, triggered_at, triggered_balance FROM revenue_triggers WHERE id = 'trg-1'")
    .get();
  assert.equal(afterHit.enabled, 0, "одноразовый: выключен после срабатывания");
  assert.equal(Number(afterHit.triggered_balance), 2500);
  const repeat = checkRevenueTriggers(db, { now: new Date("2026-10-20T12:02:00Z") });
  assert.equal(repeat.checked, 0, "выключенные не проверяются");
  assert.equal(outboxCount(), 2, "дублей нет");

  const system = getSystemTrigger(db);
  assert.ok(system, "системный триггер создан автоматически");
  assert.equal(system.id, SYSTEM_TRIGGER_ID);
  assert.equal(system.threshold_amount, 2500, "порог системного — 2500 по умолчанию");
  assert.deepEqual(
    parseRecipientUsernames(system.recipient_usernames),
    ["ppofic", "rk0ff"],
    "получатели скопированы из одноразового",
  );

  console.log("daily: 11:20, баланс ≥ порога — уведомление");
  const daily1 = runDailySystemCheck(db, { now: new Date("2026-10-21T08:20:00Z") });
  assert.equal(daily1.active, true);
  assert.equal(daily1.enqueued, 2, "уведомление обоим");
  assert.equal(outboxCount(), 4);

  console.log("daily: повтор в тот же день — без дубля");
  const daily2 = runDailySystemCheck(db, { now: new Date("2026-10-21T14:00:00Z") });
  assert.equal(daily2.enqueued, 0);
  assert.equal(daily2.alreadyNotifiedToday, true);
  assert.equal(outboxCount(), 4);

  console.log("daily: новый день, всё ещё ≥ порога — напоминание снова");
  const daily3 = runDailySystemCheck(db, { now: new Date("2026-10-22T08:25:00Z") });
  assert.equal(daily3.enqueued, 2, "каждый день, пока не закупите");
  assert.equal(outboxCount(), 6);

  console.log("daily: закупка — баланс упал, молчим");
  db.prepare("UPDATE cash_accounts SET balance = 400 WHERE id = 'acc_revenue'").run();
  const daily4 = runDailySystemCheck(db, { now: new Date("2026-10-23T08:25:00Z") });
  assert.equal(daily4.enqueued, 0, "ниже порога — молчим");
  assert.equal(outboxCount(), 6);

  console.log("daily: снова накопилось — уведомление вернулось");
  db.prepare("UPDATE cash_accounts SET balance = 2500 WHERE id = 'acc_revenue'").run();
  const daily5 = runDailySystemCheck(db, { now: new Date("2026-10-24T08:25:00Z") });
  assert.equal(daily5.enqueued, 2, "цикл перезапустился сам");
  assert.equal(outboxCount(), 8);

  console.log("trigger: получатель без карточки — уведомление не ставится");
  db.prepare("UPDATE revenue_triggers SET enabled = 1 WHERE id = 'trg-1'").run();
  const withGhost = checkRevenueTriggers(db, { now: new Date("2026-10-20T12:03:00Z") });
  assert.equal(withGhost.enqueued, 0, "ключи уже заняты — дублей нет");
  assert.equal(outboxCount(), 8);

  console.log("daily: расписание 11:20");
  assert.equal(
    isDailyCheckDue(db, { now: new Date("2026-10-25T07:00:00Z") }),
    false,
    "10:00 по Минску — ещё не время",
  );
  assert.equal(
    isDailyCheckDue(db, { now: new Date("2026-10-25T08:20:00Z") }),
    true,
    "11:20 по Минску в ещё не проверенный день — пора",
  );
  // Сразу после проверки — уже не пора (до следующего дня); баланс 2500
  // ≥ порога, поэтому проверка ещё раз отправит уведомление (новый день).
  runDailySystemCheck(db, { now: new Date("2026-10-25T08:20:00Z") });
  assert.equal(outboxCount(), 10, "суточная проверка нового дня отправила ещё 2");
  assert.equal(
    isDailyCheckDue(db, { now: new Date("2026-10-25T12:00:00Z") }),
    false,
    "после проверки дня — не пора до завтра",
  );

  insertTrigger("trg-ghost", 100, ["ghost_user"]);
  const ghost = checkRevenueTriggers(db, { now: new Date("2026-10-20T12:04:00Z") });
  assert.equal(ghost.enqueued, 0, "нет карточки — нет отправки");
  const ghostRow = db
    .prepare("SELECT enabled FROM revenue_triggers WHERE id = 'trg-ghost'")
    .get();
  assert.equal(ghostRow.enabled, 0, "но триггер погашен — не зависает");

  console.log("system: ensureSystemTrigger обновляет получателей");
  ensureSystemTrigger(db, ["quaillll"], { now: new Date("2026-10-20T13:00:00Z") });
  const refreshed = getSystemTrigger(db);
  assert.deepEqual(
    parseRecipientUsernames(refreshed.recipient_usernames),
    ["quaillll"],
    "последнее решение админа важнее",
  );
  assert.equal(getSystemThreshold(db), 2500, "порог системного из настроек/дефолт");

  console.log("revenue-triggers.test.js: ok");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
