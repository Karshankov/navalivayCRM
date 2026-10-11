import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import Database from 'better-sqlite3';
import { migrateInternalNotifications } from '../migrations/add_internal_notifications.js';
import { migrateFinancialDayClosures } from '../migrations/add_financial_day_closures.js';
import { createFinancialDayCloseService } from '../utils/financial-day-close-service.js';

const databaseModule = pathToFileURL(createRequire(import.meta.url).resolve('better-sqlite3')).href;
const serviceModule = new URL('../utils/financial-day-close-service.js', import.meta.url).href;
const workerSource = `
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  let database;
  try {
    const { default: Database } = await import(workerData.databaseModule);
    const { createFinancialDayCloseService } = await import(workerData.serviceModule);
    database = new Database(workerData.databaseFile);
    database.pragma('foreign_keys = ON');
    database.pragma('busy_timeout = 5000');
    const service = createFinancialDayCloseService(database, {
      now: () => new Date('2026-10-11T17:00:00.000Z'),
    });
    const gate = new Int32Array(workerData.gate);
    parentPort.postMessage({ type: 'ready' });
    if (Atomics.wait(gate, 0, 0, 10000) === 'timed-out') throw new Error('race_barrier_timeout');
    let outcome;
    try {
      const result = service.close(workerData.payload, {
        requestKey: workerData.requestKey, actor: workerData.actor,
      });
      outcome = { ok: true, id: result.closure.id, replay: result.replay };
    } catch (error) {
      outcome = { ok: false, code: error.code, message: error.message };
    }
    database.close();
    database = null;
    parentPort.postMessage({ type: 'done', outcome });
  } catch (error) {
    parentPort.postMessage({ type: 'fatal', message: error.stack || String(error) });
    process.exitCode = 1;
  } finally {
    if (database) database.close();
  }
})();
`;

function launch(workerData, workers) {
  const worker = new Worker(workerSource, { eval: true, workerData });
  workers.push(worker);
  let resolveReady, rejectReady, resolveDone, rejectDone;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  // A worker can fail before the caller finishes awaiting the readiness barrier.
  done.catch(() => {});
  let finished = false;
  const fail = (error) => { rejectReady(error); rejectDone(error); };
  worker.on('message', (message) => {
    if (message.type === 'ready') resolveReady();
    if (message.type === 'done') { finished = true; resolveDone(message.outcome); }
    if (message.type === 'fatal') fail(new Error(message.message));
  });
  worker.once('error', fail);
  worker.once('exit', (code) => {
    if (!finished || code !== 0) fail(new Error(`Race worker exited without a clean result: ${code}`));
  });
  return { ready, done };
}

for (const mode of ['different_keys', 'identical_retry', 'conflicting_payload']) {
  test(`simultaneous independent SQLite connections: ${mode}`, { timeout: 20000 }, async (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'crm-financial-close-race-'));
    const workers = [];
    let database;
    t.after(async () => {
      await Promise.all(workers.map((worker) => worker.terminate()));
      if (database?.open) database.close();
      const absolute = resolve(directory);
      assert.equal(dirname(absolute), resolve(tmpdir()), 'Cleanup must stay inside the temporary root');
      assert.ok(basename(absolute).startsWith('crm-financial-close-race-'));
      rmSync(absolute, { recursive: true, force: true });
    });
    const databaseFile = join(directory, 'race.db');
    database = new Database(databaseFile);
    database.pragma('foreign_keys = ON');
    database.pragma('journal_mode = WAL');
    database.exec(`
      CREATE TABLE employees (id TEXT PRIMARY KEY);
      CREATE TABLE cash_accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, balance REAL NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (DATETIME('now')));
      CREATE TABLE orders (id TEXT PRIMARY KEY, customer_id TEXT, status TEXT, final_amount REAL, total_amount REAL, profit REAL, paid_at TEXT);
      CREATE TABLE pos_sales (id TEXT PRIMARY KEY, price REAL, profit REAL, status TEXT, completed_at TEXT);
      CREATE TABLE cash_transactions (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES cash_accounts(id), type TEXT NOT NULL, amount REAL NOT NULL, description TEXT, order_id TEXT REFERENCES orders(id), employee_id TEXT REFERENCES employees(id), created_at TEXT NOT NULL DEFAULT (DATETIME('now')));
      INSERT INTO cash_accounts (id,name,balance) VALUES ('cash','Касса',3035),('revenue','Выручка',600);
      INSERT INTO orders VALUES ('paid','customer','delivered',3000,3000,1500,'2026-10-11 12:00:00');
      INSERT INTO cash_transactions (id,account_id,type,amount,description,created_at)
        VALUES ('legacy','cash','income',3035,'Historical fixture','2026-10-10 12:00:00');
    `);
    migrateInternalNotifications(database);
    migrateFinancialDayClosures(database);
    database.exec(`
      UPDATE internal_notification_settings SET enabled = 1 WHERE event_group = 'financial_close';
      INSERT INTO internal_notification_recipients
        (event_group,telegram_id,telegram_username,display_name,confirmed_at)
        VALUES ('financial_close','123456789','owner_test','Test owner','2026-10-11T10:00:00.000Z');
    `);
    const legacy = database.prepare("SELECT * FROM cash_transactions WHERE id = 'legacy'").get();
    const service = createFinancialDayCloseService(database, { now: () => new Date('2026-10-11T17:00:00.000Z') });
    const input = {
      business_date: '2026-10-11', cash_account_id: 'cash', revenue_account_id: 'revenue',
      terminal_cash: '500', terminal_card: '500', retained_cash: '35', coins: '0',
      counts: { 200: 10, 100: 4, 50: 2, 20: 1, 10: 1, 5: 1 },
    };
    const payload = { ...input, expected_revision: service.preview(input).context.revision };
    const gate = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const jobs = [0, 1].map((index) => launch({
      databaseModule, serviceModule, databaseFile, gate,
      requestKey: mode === 'different_keys' ? `request_race_operator_${index}` : 'request_race_shared_0001',
      actor: { name: 'Тестовый оператор', username: mode === 'different_keys' ? `operator-${index}` : 'same-operator' },
      payload: mode === 'conflicting_payload' && index === 1 ? { ...payload, retained_cash: '36' } : payload,
    }, workers));
    await Promise.all(jobs.map((job) => job.ready));
    Atomics.store(new Int32Array(gate), 0, 1);
    Atomics.notify(new Int32Array(gate), 0, jobs.length);
    const outcomes = await Promise.all(jobs.map((job) => job.done));
    const successful = outcomes.filter((outcome) => outcome.ok);
    if (mode === 'identical_retry') {
      assert.equal(successful.length, 2, JSON.stringify(outcomes));
      assert.equal(successful[0].id, successful[1].id);
      assert.deepEqual(successful.map((outcome) => outcome.replay).sort(), [false, true]);
    } else {
      assert.equal(successful.length, 1, JSON.stringify(outcomes));
      assert.equal(successful[0].replay, false);
      const rejected = outcomes.find((outcome) => !outcome.ok);
      assert.equal(rejected.code, mode === 'different_keys' ? 'financial_day_already_closed' : 'closing_idempotency_conflict');
    }
    const closures = database.prepare('SELECT * FROM financial_day_closures').all();
    assert.equal(closures.length, 1);
    const saved = JSON.parse(closures[0].snapshot_json);
    assert.equal(closures[0].id, successful[0].id);
    const movements = database.prepare('SELECT * FROM cash_transactions WHERE financial_close_id IS NOT NULL').all();
    assert.equal(movements.length, 3);
    assert.ok(movements.every((movement) => movement.financial_close_id === closures[0].id));
    assert.deepEqual(movements.map((movement) => movement.closing_operation).sort(), ['owner_settlement', 'transfer_in', 'transfer_out']);
    assert.equal(movements.find((movement) => movement.closing_operation === 'owner_settlement').amount, 1500);
    assert.equal(database.prepare("SELECT balance FROM cash_accounts WHERE id = 'cash'").get().balance, saved.retained_cash_minor / 100);
    assert.equal(database.prepare("SELECT balance FROM cash_accounts WHERE id = 'revenue'").get().balance, 600 + saved.transfer_minor / 100);
    assert.ok([3500, 3600].includes(saved.retained_cash_minor));
    if (mode !== 'conflicting_payload') assert.equal(saved.retained_cash_minor, 3500);
    const outbox = database.prepare('SELECT * FROM internal_notification_outbox').all();
    assert.equal(outbox.length, 1);
    assert.equal(JSON.parse(outbox[0].payload_json).closing_id, closures[0].id);
    assert.equal(JSON.parse(outbox[0].payload_json).text, closures[0].report_text);
    assert.deepEqual(database.prepare("SELECT * FROM cash_transactions WHERE id = 'legacy'").get(), legacy);
    assert.deepEqual(database.pragma('foreign_key_check'), []);
  });
}
