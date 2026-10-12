import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { migrateInternalNotifications } from '../migrations/add_internal_notifications.js';
import { migrateFinancialDayClosures } from '../migrations/add_financial_day_closures.js';
import { createFinancialDayCloseService } from '../utils/financial-day-close-service.js';
import { isFinancialCloseTestResetEnabled } from '../utils/financial-close-activation.js';
import { startInternalNotificationWorker } from '../utils/internal-notification-worker.js';

const flags = { NODE_ENV: 'test', FINANCIAL_DAY_CLOSE_TEST_RESET: '1', LOCAL_CRM_TEST_MODE: '1' };
const isCode = code => error => error?.code === code;
function fixture({ balance = 3035, recipient = true } = {}) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE cash_pacing_months (id TEXT PRIMARY KEY, month_key TEXT NOT NULL UNIQUE);
    CREATE TABLE cash_pacing_daily_facts (id TEXT PRIMARY KEY, month_id TEXT NOT NULL REFERENCES cash_pacing_months(id) ON DELETE CASCADE,
      fact_date TEXT NOT NULL, actual_amount REAL NOT NULL, note TEXT,
      created_at TEXT NOT NULL DEFAULT (DATETIME('now')), updated_at TEXT NOT NULL DEFAULT (DATETIME('now')), UNIQUE(month_id, fact_date));
    INSERT INTO cash_pacing_months VALUES ('pacing_october', '2026-10');
    CREATE TABLE employees (id TEXT PRIMARY KEY);
    CREATE TABLE cash_accounts (id TEXT PRIMARY KEY, name TEXT, balance REAL, active INTEGER DEFAULT 1, created_at TEXT DEFAULT (DATETIME('now')));
    CREATE TABLE orders (id TEXT PRIMARY KEY, customer_id TEXT, status TEXT, final_amount REAL, total_amount REAL, profit REAL, paid_at TEXT);
    CREATE TABLE pos_sales (id TEXT PRIMARY KEY, price REAL, profit REAL, status TEXT, completed_at TEXT);
    CREATE TABLE cash_transactions (id TEXT PRIMARY KEY, account_id TEXT REFERENCES cash_accounts(id), type TEXT, amount REAL, description TEXT, employee_id TEXT REFERENCES employees(id), created_at TEXT DEFAULT (DATETIME('now')));
    INSERT INTO employees VALUES ('manager');
    INSERT INTO cash_accounts (id,name,balance) VALUES ('cash','Касса',3035),('revenue','Выручка',600),('unrelated','Другой',99);
    INSERT INTO orders VALUES ('paid','customer','delivered',3000,3000,1500,'2026-10-11 12:00:00');
    INSERT INTO cash_transactions (id,account_id,type,amount,description,created_at) VALUES ('old','cash','income',3,'Existing historical record','2026-10-10 10:00:00');
  `);
  db.prepare("UPDATE cash_accounts SET balance = ? WHERE id = 'cash'").run(balance);
  migrateInternalNotifications(db); migrateFinancialDayClosures(db);
  if (recipient) {
    db.exec(`UPDATE internal_notification_settings SET enabled = 1 WHERE event_group = 'financial_close';
      INSERT INTO internal_notification_recipients (event_group,telegram_id,telegram_username,confirmed_at) VALUES ('financial_close','123456789','test_owner','2026-10-11T00:00:00Z');`);
  }
  let clock = new Date('2026-10-11T17:00:00Z');
  const service = createFinancialDayCloseService(db, { now: () => new Date(clock) });
  const actor = { employeeId: 'manager', role: 'manager', name: 'Test Manager', username: 'test-admin' };
  const input = { business_date: '2026-10-11', cash_account_id: 'cash', revenue_account_id: 'revenue', terminal_cash: '500', terminal_card: '500', retained_cash: '35', coins: '0', counts: { 200: 10, 100: 4, 50: 2, 20: 1, 10: 1, 5: 1 } };
  const payload = { ...input, expected_revision: service.preview(input).context.revision };
  const close = (body = payload, requestKey = 'test_reset_close_0001') => service.close(body, { actor, requestKey });
  const reset = (id, options = {}) => service.resetForTesting(id, { actor, confirmationId: id, ...options });
  const state = () => Object.fromEntries(['cash_accounts', 'cash_transactions', 'orders', 'pos_sales', 'financial_day_closures', 'internal_notification_outbox', 'cash_pacing_months', 'cash_pacing_daily_facts'].map(name => [name, db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]));
  return { db, service, actor, input, payload, close, reset, state, setClock: value => { clock = new Date(value); } };
}
function scenario(name, fn) {
  test(name, () => {
    const previous = Object.fromEntries(Object.keys(flags).map(key => [key, process.env[key]]));
    Object.assign(process.env, flags); process.env.BUSINESS_TIMEZONE = 'Europe/Minsk';
    const fixtures = [];
    try { fn(options => { const f = fixture(options); fixtures.push(f); return f; }); }
    finally {
      for (const f of fixtures) f.db.close();
      for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  });
}

test('test reset requires an explicit isolated process and never enables in production', () => {
  assert.equal(isFinancialCloseTestResetEnabled(flags), true);
  for (const env of [{}, { ...flags, NODE_ENV: 'production' }, { ...flags, LOCAL_CRM_TEST_MODE: '0' }, { ...flags, FINANCIAL_DAY_CLOSE_TEST_RESET: '0' }]) assert.equal(isFinancialCloseTestResetEnabled(env), false);
});
scenario('reset exactly reverses rounded-up and rounded-down distributions without touching profit or historical ledger', create => {
  for (const [card, ownerCash, rounding] of [['0', 59000, 200], ['101', 48500, -200]]) {
    const f = create();
    f.db.prepare('UPDATE orders SET profit = ? WHERE id = ?').run(588, 'paid');
    const input = { ...f.input, terminal_card: card };
    const payload = { ...input, expected_revision: f.service.preview(input).context.revision };
    const before = f.state();
    const saved = f.close(payload).closure;
    assert.equal(saved.snapshot.owner_cash_minor, ownerCash);
    assert.equal(saved.snapshot.owner_rounding_minor, rounding);
    assert.equal(f.reset(saved.id).reset, true);
    assert.deepEqual(f.state(), before);
    assert.equal(f.reset(saved.id).replay, true);
    assert.deepEqual(f.state(), before);
    assert.throws(() => f.close(payload), isCode('closing_request_was_reset'));
    const fresh = { ...input, expected_revision: f.service.preview(input).context.revision };
    assert.equal(f.close(fresh, 'rounded_reset_fresh_0002').closure.snapshot.owner_cash_minor, ownerCash);
  }
});
scenario('reset restores a closing with all coins reserved and retained banknotes without losing any records', create => {
  const f = create({ balance: 3135 });
  const input = { ...f.input, coins: '100', retained_cash: '135' };
  const payload = { ...input, expected_revision: f.service.preview(input).context.revision };
  const before = f.state();
  const saved = f.close(payload).closure;
  assert.equal(saved.snapshot.coins_minor, 10000);
  assert.equal(saved.snapshot.retained_notes_minor, 3500);
  assert.equal(saved.snapshot.cash_balance_after_minor, 13500);
  assert.equal(f.reset(saved.id).reset, true);
  assert.deepEqual(f.state(), before);
  assert.equal(f.reset(saved.id).replay, true);
  assert.deepEqual(f.state(), before);
});

scenario('reset restores all original records and balances for balanced, shortage and surplus closures', create => {
  for (const balance of [3035, 3055, 2985]) {
    const f = create({ balance }); const before = f.state(); const saved = f.close().closure;
    assert.equal(f.reset(saved.id).reset, true);
    assert.deepEqual(f.state(), before);
    const audit = JSON.parse(f.db.prepare('SELECT audit_json FROM financial_close_test_resets').get().audit_json);
    assert.equal(audit.closure.id, saved.id);
    assert.equal(audit.movements.length, balance === 3035 ? 3 : 4);
    assert.equal(f.reset(saved.id).replay, true);
    assert.deepEqual(f.state(), before);
  }
});
scenario('reset invalidates delayed old requests and old preview revisions; a fresh close remains possible', create => {
  const f = create(); const saved = f.close().closure; f.reset(saved.id);
  assert.throws(() => f.close(), isCode('closing_request_was_reset'));
  assert.throws(() => f.close(f.payload, 'test_reset_close_0002'), isCode('closing_preview_stale'));
  const fresh = { ...f.input, expected_revision: f.service.preview(f.input).context.revision };
  const second = f.close(fresh, 'test_reset_close_0002').closure;
  assert.notEqual(second.id, saved.id);
  assert.equal(second.snapshot.cash_balance_after_minor, 3500);
});
scenario('reset refuses changed balances, ledger edits and net-zero later movements without writing', create => {
  for (const change of ['balance', 'historical_edit', 'net_zero']) {
    const f = create(); const saved = f.close().closure;
    if (change === 'balance') f.db.exec("UPDATE cash_accounts SET balance = balance + 1 WHERE id = 'cash'");
    if (change === 'historical_edit') f.db.exec("UPDATE cash_transactions SET description = 'edited' WHERE id = 'old'");
    if (change === 'net_zero') f.db.exec("INSERT INTO cash_transactions (id,account_id,type,amount) VALUES ('later-in','cash','income',10),('later-out','cash','expense',10)");
    const before = f.state();
    assert.throws(() => f.reset(saved.id), isCode(change === 'balance' ? 'closing_test_reset_accounts_changed' : 'closing_test_reset_later_movements'));
    assert.deepEqual(f.state(), before);
  }
});
scenario('reset preserves independent-account activity', create => {
  const f = create(); const saved = f.close().closure;
  f.db.exec("UPDATE cash_accounts SET balance = 123 WHERE id = 'unrelated'; INSERT INTO cash_transactions (id,account_id,type,amount) VALUES ('unrelated-new','unrelated','income',24)");
  f.reset(saved.id);
  assert.equal(f.db.prepare("SELECT balance FROM cash_accounts WHERE id = 'unrelated'").get().balance, 123);
  assert.ok(f.db.prepare("SELECT 1 FROM cash_transactions WHERE id = 'unrelated-new'").get());
});
scenario('sent, sending and unknown notifications block reset; pending notifications are removed', create => {
  for (const status of ['sent', 'sending', 'unknown']) {
    const f = create(); const saved = f.close().closure;
    f.db.prepare('UPDATE internal_notification_outbox SET status = ?').run(status);
    const before = f.state(); assert.throws(() => f.reset(saved.id), isCode('closing_test_reset_delivery_unsafe')); assert.deepEqual(f.state(), before);
  }
});
scenario('revoked actor, employee role, disabled mode and missing confirmation cannot reset', create => {
  const f = create(); const saved = f.close().closure; const before = f.state();
  assert.throws(() => f.reset(saved.id, { actor: { ...f.actor, role: 'employee' } }), isCode('closing_test_reset_manager_required'));
  assert.throws(() => f.reset(saved.id, { confirmationId: '' }), isCode('closing_test_reset_confirmation_required'));
  assert.throws(() => f.reset(saved.id, { verifyActor: () => { throw new Error('revoked'); } }), /revoked/);
  process.env.NODE_ENV = 'production';
  assert.throws(() => f.reset(saved.id), isCode('financial_close_test_reset_disabled'));
  assert.deepEqual(f.state(), before);
});
scenario('partial reset failure rolls back audit, balances, movements, history and outbox', create => {
  const f = create(); const saved = f.close().closure; const before = f.state();
  f.db.exec("CREATE TRIGGER reject_reset BEFORE DELETE ON financial_day_closures BEGIN SELECT RAISE(ABORT, 'reset_failure'); END");
  assert.throws(() => f.reset(saved.id), /reset_failure/);
  assert.deepEqual(f.state(), before);
  assert.equal(f.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'financial_close_test_resets'").get(), undefined);
});
scenario('a newer closure prevents resetting an earlier financial day', create => {
  const f = create({ recipient: false }); const first = f.close().closure;
  f.setClock('2026-10-12T17:00:00Z');
  const next = { ...f.input, business_date: '2026-10-12', terminal_cash: '0', terminal_card: '0', coins: '35', counts: { 200: 0, 100: 0, 50: 0, 20: 0, 10: 0, 5: 0 } };
  f.close({ ...next, expected_revision: f.service.preview(next).context.revision }, 'test_reset_next_day_0002');
  const before = f.state(); assert.throws(() => f.reset(first.id), isCode('closing_test_reset_not_latest')); assert.deepEqual(f.state(), before);
});
scenario('reset removes only its automatic daily fact and preserves other dates', create => {
  const f = create();
  f.db.exec("INSERT INTO cash_pacing_daily_facts (id,month_id,fact_date,actual_amount,note) VALUES ('other-date','pacing_october','2026-10-10',123,'Manual other day')");
  const before = f.state();
  const saved = f.close().closure;
  assert.equal(saved.snapshot.cash_pacing_fact.status, 'inserted');
  assert.equal(f.db.prepare('SELECT actual_amount FROM cash_pacing_daily_facts WHERE id = ?').get(saved.snapshot.cash_pacing_fact.fact_id).actual_amount, 1000);
  f.reset(saved.id);
  assert.deepEqual(f.state(), before);
  assert.equal(f.reset(saved.id).replay, true);
  assert.deepEqual(f.state(), before);
});
scenario('reset preserves existing manual facts including zero', create => {
  for (const amount of [0, 560]) {
    const f = create();
    f.db.prepare('INSERT INTO cash_pacing_daily_facts (id,month_id,fact_date,actual_amount,note) VALUES (?, ?, ?, ?, ?)')
      .run('manual', 'pacing_october', f.input.business_date, amount, 'Do not overwrite');
    const before = f.state();
    const payload = { ...f.input, expected_revision: f.service.preview(f.input).context.revision };
    const saved = f.close(payload).closure;
    assert.equal(saved.snapshot.cash_pacing_fact.status, 'preserved');
    assert.equal(saved.snapshot.cash_pacing_fact.amount_minor, amount * 100);
    f.reset(saved.id);
    assert.deepEqual(f.state(), before);
  }
});
scenario('changed or deleted automatic fact blocks the whole reset without writes', create => {
  for (const change of ['amount', 'note', 'deleted', 'replaced']) {
    const f = create();
    const saved = f.close().closure;
    const factId = saved.snapshot.cash_pacing_fact.fact_id;
    if (change === 'amount') f.db.prepare('UPDATE cash_pacing_daily_facts SET actual_amount = 560 WHERE id = ?').run(factId);
    if (change === 'note') f.db.prepare('UPDATE cash_pacing_daily_facts SET note = ? WHERE id = ?').run('Manually edited', factId);
    if (change === 'deleted' || change === 'replaced') f.db.prepare('DELETE FROM cash_pacing_daily_facts WHERE id = ?').run(factId);
    if (change === 'replaced') f.db.prepare('INSERT INTO cash_pacing_daily_facts (id,month_id,fact_date,actual_amount,note) VALUES (?, ?, ?, ?, ?)')
      .run('replacement', 'pacing_october', f.input.business_date, 1000, 'New manual row');
    const before = f.state();
    assert.throws(() => f.reset(saved.id), isCode('closing_test_reset_cash_pacing_changed'));
    assert.deepEqual(f.state(), before);
    assert.equal(f.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'financial_close_test_resets'").get(), undefined);
  }
});
scenario('automatic notification worker stays stopped in local reset mode', create => {
  const f = create(); assert.equal(startInternalNotificationWorker(f.db), null);
});
