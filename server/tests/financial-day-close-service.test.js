import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { migrateInternalNotifications } from '../migrations/add_internal_notifications.js';
import { migrateFinancialDayClosures } from '../migrations/add_financial_day_closures.js';
import { createFinancialDayCloseService } from '../utils/financial-day-close-service.js';
import { queryCrmFinancialStats } from '../utils/crm-financial-stats.js';
import { getBusinessCalendarDayRange } from '../utils/business-time.js';

function setup({ recipient = true, cashBalance = 3035 } = {}) {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  database.exec(`
    CREATE TABLE cash_pacing_months (id TEXT PRIMARY KEY, month_key TEXT NOT NULL UNIQUE);
    CREATE TABLE cash_pacing_daily_facts (id TEXT PRIMARY KEY, month_id TEXT NOT NULL REFERENCES cash_pacing_months(id) ON DELETE CASCADE,
      fact_date TEXT NOT NULL, actual_amount REAL NOT NULL, note TEXT,
      created_at TEXT NOT NULL DEFAULT (DATETIME('now')), updated_at TEXT NOT NULL DEFAULT (DATETIME('now')), UNIQUE(month_id, fact_date));
    INSERT INTO cash_pacing_months VALUES ('pacing_october', '2026-10');
    CREATE TABLE employees (id TEXT PRIMARY KEY);
    CREATE TABLE cash_accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, balance REAL NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (DATETIME('now')));
    CREATE TABLE orders (id TEXT PRIMARY KEY, customer_id TEXT, status TEXT, final_amount REAL, total_amount REAL, profit REAL, paid_at TEXT);
    CREATE TABLE pos_sales (id TEXT PRIMARY KEY, price REAL, profit REAL, status TEXT, completed_at TEXT);
    CREATE TABLE cash_transactions (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES cash_accounts(id), type TEXT NOT NULL, amount REAL NOT NULL, description TEXT, order_id TEXT REFERENCES orders(id), employee_id TEXT REFERENCES employees(id), created_at TEXT NOT NULL DEFAULT (DATETIME('now')));
    INSERT INTO employees VALUES ('employee_test');
    INSERT INTO cash_accounts (id,name,balance) VALUES ('cash','Касса',0),('revenue','Выручка',600);
    INSERT INTO orders VALUES ('paid','customer','delivered',3000,3000,1500,'2026-10-11 12:00:00');
  `);
  database.prepare('UPDATE cash_accounts SET balance = ? WHERE id = ?').run(cashBalance, 'cash');
  migrateInternalNotifications(database);
  migrateFinancialDayClosures(database);
  // Idempotent schema application must never rewrite existing financial data.
  migrateFinancialDayClosures(database);
  const configure = (telegramId = '123456789', username = 'owner_test') => {
    database.prepare("UPDATE internal_notification_settings SET enabled = 1 WHERE event_group = 'financial_close'").run();
    database.prepare(`INSERT INTO internal_notification_recipients
      (event_group,telegram_id,telegram_username,display_name,confirmed_at)
      VALUES ('financial_close',?,?, 'Владелец','2026-10-11T10:00:00.000Z')`).run(telegramId, username);
  };
  if (recipient) configure();
  let clock = new Date('2026-10-11T17:00:00.000Z');
  const service = createFinancialDayCloseService(database, { now: () => new Date(clock) });
  const input = {
    business_date: '2026-10-11', cash_account_id: 'cash', revenue_account_id: 'revenue',
    terminal_cash: '500', terminal_card: '500', retained_cash: '35', coins: '0',
    counts: { 200: 10, 100: 4, 50: 2, 20: 1, 10: 1, 5: 1 },
  };
  const actor = { employeeId: 'employee_test', name: 'Тестовый сотрудник', username: 'test-admin' };
  const complete = (changes = {}, options = {}) => {
    const payload = { ...input, ...changes };
    return service.close({ ...payload, expected_revision: service.preview(payload).context.revision },
      { requestKey: 'request_control_0001', actor, ...options });
  };
  const balances = () => database.prepare('SELECT id,balance FROM cash_accounts ORDER BY id').all();
  const counts = () => ({
    closures: database.prepare('SELECT COUNT(*) AS n FROM financial_day_closures').get().n,
    transactions: database.prepare('SELECT COUNT(*) AS n FROM cash_transactions').get().n,
    notifications: database.prepare('SELECT COUNT(*) AS n FROM internal_notification_outbox').get().n,
  });
  return { database, service, input, actor, complete, configure, balances, counts,
    setClock: (iso) => { clock = new Date(iso); } };
}

function scenario(name, fn) {
  test(name, () => {
    const fixtures = [];
    const create = (options) => { const fixture = setup(options); fixtures.push(fixture); return fixture; };
    try { fn(create); } finally { for (const fixture of fixtures) fixture.database.close(); }
  });
}
const code = (expected) => (error) => error.code === expected;

scenario('rounded cash changes one owner settlement and revenue transfer, preserves profit and replays the saved report', create => {
  for (const [card, ownerCash, rounding] of [['0', 59000, 200], ['101', 48500, -200]]) {
    const f = create();
    f.database.prepare('UPDATE orders SET profit = ? WHERE id = ?').run(588, 'paid');
    const input = { ...f.input, terminal_card: card };
    const preview = f.service.preview(input);
    assert.equal(preview.snapshot.profit_minor, 58800);
    assert.equal(preview.snapshot.owner_cash_minor, ownerCash);
    assert.equal(preview.snapshot.owner_rounding_minor, rounding);
    const payload = { ...input, expected_revision: preview.context.revision };
    const first = f.service.close(payload, { requestKey: 'rounded_settlement_0001', actor: f.actor });
    const saved = first.closure;
    assert.equal(saved.snapshot.owner_total_minor, ownerCash + Number(card) * 100);
    assert.equal(saved.snapshot.transfer_minor, 253500 - ownerCash - 3500);
    assert.equal(saved.snapshot.cash_balance_after_minor, 3500);
    assert.deepEqual(f.balances(), [
      { id: 'cash', balance: 35 },
      { id: 'revenue', balance: 600 + saved.snapshot.transfer_minor / 100 },
    ]);
    const movements = f.database.prepare("SELECT * FROM cash_transactions WHERE financial_close_id = ? AND closing_operation = 'owner_settlement'").all(saved.id);
    assert.equal(movements.length, 1);
    assert.equal(movements[0].amount, saved.snapshot.owner_total_minor / 100);
    assert.match(saved.report_text, /Прибыль за день: 588,00 BYN/);
    assert.doesNotMatch(saved.report_text, /Округление до ближайших|из выручки|остаётся в выручке/);
    assert.match(saved.report_text, /Наличными до округления:/);
    assert.equal(f.service.context().profit_minor, 58800);
    const before = { balances: f.balances(), counts: f.counts() };
    f.database.prepare('UPDATE orders SET profit = 777 WHERE id = ?').run('paid');
    const retry = f.service.close(payload, { requestKey: 'rounded_settlement_0001', actor: f.actor });
    assert.equal(retry.replay, true);
    assert.deepEqual(retry.closure.snapshot, saved.snapshot);
    assert.equal(retry.closure.report_text, saved.report_text);
    assert.deepEqual({ balances: f.balances(), counts: f.counts() }, before);
  }
});

scenario('all coins remain in cash in addition to retained banknotes and retries preserve the saved reserve', create => {
  const f = create({ cashBalance: 3135 });
  const input = { ...f.input, coins: '100', retained_cash: '135' };
  const preview = f.service.preview(input);
  assert.equal(preview.snapshot.coins_minor, 10000);
  assert.equal(preview.snapshot.retained_notes_minor, 3500);
  assert.equal(preview.snapshot.retained_cash_minor, 13500);
  assert.equal(preview.snapshot.owner_cash_minor, 100000);
  assert.equal(preview.snapshot.transfer_minor, 150000);
  const payload = { ...input, expected_revision: preview.context.revision };
  const options = { requestKey: 'coins_reserved_close_0001', actor: f.actor };
  const first = f.service.close(payload, options);
  assert.deepEqual(f.balances(), [{ id: 'cash', balance: 135 }, { id: 'revenue', balance: 2100 }]);
  assert.equal(first.closure.snapshot.profit_minor, 150000);
  assert.doesNotMatch(first.closure.report_text, /Остаток в кассе|Монеты и мелкие номиналы|Оставлено купюрами/);
  const before = { balances: f.balances(), counts: f.counts(), fact: f.database.prepare('SELECT * FROM cash_pacing_daily_facts').all() };
  const retry = f.service.close(payload, options);
  assert.equal(retry.replay, true);
  assert.deepEqual(retry.closure.snapshot, first.closure.snapshot);
  assert.deepEqual({ balances: f.balances(), counts: f.counts(), fact: f.database.prepare('SELECT * FROM cash_pacing_daily_facts').all() }, before);
});

scenario('coins cannot cover insufficient banknotes or be omitted from the reserve', create => {
  for (const [retained, expectedCode] of [['35', 'retained_cash_below_coins'], ['135', 'insufficient_counted_cash']]) {
    const f = create();
    const input = { ...f.input, counts: { 200: 0, 100: 0, 50: 0, 20: 1, 10: 1, 5: 1 }, coins: '1500', retained_cash: retained === '135' ? '1535' : retained };
    const before = { balances: f.balances(), counts: f.counts() };
    assert.throws(() => f.service.preview(input), code(expectedCode));
    assert.throws(() => f.service.close({ ...input, expected_revision: f.service.context(input).revision },
      { requestKey: 'coins_insufficient_0001', actor: f.actor }), code(expectedCode));
    assert.deepEqual({ balances: f.balances(), counts: f.counts() }, before);
    assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM cash_pacing_daily_facts').get().n, 0);
  }
});

scenario('rounded-up cash that does not fit cannot write a closure, pacing fact, ledger or outbox', create => {
  const f = create();
  f.database.prepare('UPDATE orders SET profit = ? WHERE id = ?').run(502.5, 'paid');
  const input = { ...f.input, counts: { 200: 0, 100: 0, 50: 0, 20: 1, 10: 1, 5: 1 }, coins: '2.50' };
  const before = { balances: f.balances(), counts: f.counts() };
  assert.throws(() => f.service.preview(input), code('insufficient_counted_cash'));
  assert.throws(() => f.service.close({ ...input, expected_revision: f.service.context(input).revision },
    { requestKey: 'rounding_insufficient_0001', actor: f.actor }), code('insufficient_counted_cash'));
  assert.deepEqual({ balances: f.balances(), counts: f.counts() }, before);
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM cash_pacing_daily_facts').get().n, 0);
});

scenario('terminal cash plus card is saved once for the closing business date, not CRM revenue or counted cash', create => {
  const f = create();
  f.setClock('2026-10-05T17:00:00Z');
  f.database.exec("UPDATE orders SET paid_at = '2026-10-05 12:00:00'");
  const input = { ...f.input, business_date: '2026-10-05', terminal_cash: '400,50', terminal_card: '160.25' };
  const payload = { ...input, expected_revision: f.service.preview(input).context.revision };
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM cash_pacing_daily_facts').get().n, 0);
  const options = { requestKey: 'request_pacing_fifth_0001', actor: f.actor };
  const first = f.service.close(payload, options);
  const fact = f.database.prepare('SELECT * FROM cash_pacing_daily_facts').get();
  assert.equal(fact.month_id, 'pacing_october'); assert.equal(fact.fact_date, '2026-10-05');
  assert.equal(fact.actual_amount, 560.75);
  assert.equal(first.closure.snapshot.cash_pacing_fact.status, 'inserted');
  assert.equal(first.closure.snapshot.cash_pacing_fact.amount_minor, 56075);
  assert.equal(f.service.close(payload, options).replay, true);
  assert.deepEqual(f.database.prepare('SELECT * FROM cash_pacing_daily_facts').all(), [fact]);
  f.database.exec('DELETE FROM cash_pacing_daily_facts');
  assert.equal(f.service.close(payload, options).replay, true);
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM cash_pacing_daily_facts').get().n, 0);
});

scenario('existing manual daily facts including zero are preserved byte for byte', create => {
  for (const amount of [0, 560, 123.45]) {
    const f = create();
    f.database.prepare("INSERT INTO cash_pacing_daily_facts (id,month_id,fact_date,actual_amount,note) VALUES ('manual','pacing_october','2026-10-11',?,'Ручная запись')").run(amount);
    const before = f.database.prepare('SELECT * FROM cash_pacing_daily_facts').all();
    const result = f.complete();
    assert.equal(result.closure.snapshot.cash_pacing_fact.status, 'preserved');
    assert.equal(result.closure.snapshot.cash_pacing_fact.amount_minor, Math.round(amount * 100));
    assert.deepEqual(f.database.prepare('SELECT * FROM cash_pacing_daily_facts').all(), before);
  }
});

scenario('missing month rejects preview and final close without any financial writes or automatic month creation', create => {
  const f = create(); f.database.exec('DELETE FROM cash_pacing_months');
  const before = f.balances(); const current = f.service.context();
  assert.equal(current.cash_pacing.month_id, null);
  assert.throws(() => f.service.preview(f.input), code('closing_cash_pacing_month_required'));
  assert.throws(() => f.service.close({ ...f.input, expected_revision: current.revision },
    { actor: f.actor, requestKey: 'request_pacing_missing_0001' }), code('closing_cash_pacing_month_required'));
  assert.deepEqual(f.balances(), before); assert.deepEqual(f.counts(), { closures: 0, transactions: 0, notifications: 0 });
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM cash_pacing_months').get().n, 0);
});

scenario('daily fact changes after preview invalidate final confirmation and never overwrite manual data', create => {
  const f = create(); const payload = { ...f.input, expected_revision: f.service.preview(f.input).context.revision };
  f.database.exec("INSERT INTO cash_pacing_daily_facts (id,month_id,fact_date,actual_amount,note) VALUES ('manual','pacing_october','2026-10-11',560,'Сохранено после расчёта')");
  const before = f.balances(); const fact = f.database.prepare('SELECT * FROM cash_pacing_daily_facts').get();
  assert.throws(() => f.service.close(payload, { actor: f.actor, requestKey: 'request_pacing_race_0001' }), code('closing_preview_stale'));
  assert.deepEqual(f.balances(), before); assert.deepEqual(f.database.prepare('SELECT * FROM cash_pacing_daily_facts').get(), fact);
  assert.deepEqual(f.counts(), { closures: 0, transactions: 0, notifications: 0 });
});

scenario('failure inserting a fact or later outbox rolls back the entire closing and fact', create => {
  for (const table of ['cash_pacing_daily_facts', 'internal_notification_outbox']) {
    const f = create(); const before = f.balances();
    f.database.exec(`CREATE TRIGGER pacing_failure BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'pacing_atomic_failure'); END`);
    assert.throws(() => f.complete(), /pacing_atomic_failure/);
    assert.deepEqual(f.balances(), before); assert.deepEqual(f.counts(), { closures: 0, transactions: 0, notifications: 0 });
    assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM cash_pacing_daily_facts').get().n, 0);
  }
});

scenario('Minsk midnight at month and year boundaries chooses the new business month', create => {
  for (const [clock, date] of [['2026-10-31T21:00:00Z', '2026-11-01'], ['2026-12-31T21:00:00Z', '2027-01-01']]) {
    const f = create(); const month = date.slice(0, 7);
    f.database.prepare('INSERT INTO cash_pacing_months VALUES (?, ?)').run('boundary_month', month);
    f.setClock(clock);
    const input = { ...f.input, business_date: date, terminal_cash: '560', terminal_card: '0' };
    const payload = { ...input, expected_revision: f.service.preview(input).context.revision };
    f.service.close(payload, { actor: f.actor, requestKey: 'request_pacing_boundary_0001' });
    const fact = f.database.prepare('SELECT * FROM cash_pacing_daily_facts').get();
    assert.equal(fact.month_id, 'boundary_month'); assert.equal(fact.fact_date, date); assert.equal(fact.actual_amount, 560);
  }
});

scenario('shared totals use inclusive Minsk midnight and exclusive next midnight for orders and POS', (create) => {
  const f = create();
  f.database.exec(`
    DELETE FROM orders;
    INSERT INTO orders VALUES
      ('before','outside','completed',10000,10000,9000,'2026-10-10 20:59:59'),
      ('start','shared','completed',12,99,4,'2026-10-10 21:00:00'),
      ('inside','shared','delivered',NULL,20,5,'2026-10-11 12:00:00'),
      ('last','last-customer','delivered',8,88,2,'2026-10-11 20:59:59'),
      ('free',NULL,'completed',0,9999,0,'2026-10-11 12:00:00'),
      ('next','outside','completed',10000,10000,9000,'2026-10-11 21:00:00'),
      ('pending-order','outside','pending',10000,10000,9000,'2026-10-11 12:00:00'),
      ('cancelled-order','outside','cancelled',10000,10000,9000,'2026-10-11 12:00:00'),
      ('unpaid','outside','completed',10000,10000,9000,NULL);
    INSERT INTO pos_sales VALUES
      ('pos-before',10000,9000,'completed','2026-10-10T20:59:59.999Z'),
      ('pos-start',10,2,'completed','2026-10-10T21:00:00.000Z'),
      ('pos-inside',20,3,'completed','2026-10-11T12:00:00.000Z'),
      ('pos-last',30,4,'completed','2026-10-11T20:59:59.999Z'),
      ('pos-next',10000,9000,'completed','2026-10-11T21:00:00.000Z'),
      ('pos-pending',10000,9000,'pending','2026-10-11T12:00:00.000Z'),
      ('pos-cancelled',10000,9000,'cancelled','2026-10-11T12:00:00.000Z'),
      ('pos-undated',10000,9000,'completed',NULL);
  `);
  const baseline = f.balances();
  const expected = { total_sales: 7, revenue: 100, profit: 20, unique_customers: 2 };
  assert.deepEqual(queryCrmFinancialStats(f.database, getBusinessCalendarDayRange(2026, 10, 11)), expected);
  f.setClock('2026-10-10T21:00:00.000Z');
  const start = f.service.context();
  assert.equal(start.business_date, '2026-10-11');
  assert.equal(start.revenue_minor, 10000);
  assert.equal(start.profit_minor, 2000);
  assert.equal(start.total_sales, 7);
  assert.equal(start.unique_customers, 2);
  f.setClock('2026-10-11T20:59:59.999Z');
  assert.equal(f.service.context().revision, start.revision);
  assert.deepEqual(f.balances(), baseline);
  assert.deepEqual(f.counts(), { closures: 0, transactions: 0, notifications: 0 });
});

scenario('account and recipient changes after preview cannot silently change final settlement', (create) => {
  for (const change of ['revenue_balance', 'cash_disabled', 'revenue_disabled', 'recipient_added']) {
    const f = create();
    const payload = { ...f.input, expected_revision: f.service.preview(f.input).context.revision };
    if (change === 'revenue_balance') f.database.exec("UPDATE cash_accounts SET balance = balance + 1 WHERE id = 'revenue'");
    if (change === 'cash_disabled') f.database.exec("UPDATE cash_accounts SET active = 0 WHERE id = 'cash'");
    if (change === 'revenue_disabled') f.database.exec("UPDATE cash_accounts SET active = 0 WHERE id = 'revenue'");
    if (change === 'recipient_added') f.configure('987654321', 'another_owner');
    const baseline = f.balances();
    const expectedError = change.endsWith('_disabled') ? 'closing_account_not_found' : 'closing_preview_stale';
    assert.throws(() => f.service.close(payload, { requestKey: 'request_configuration_0001', actor: f.actor }), code(expectedError));
    assert.deepEqual(f.balances(), baseline);
    assert.deepEqual(f.counts(), { closures: 0, transactions: 0, notifications: 0 });
  }
});

scenario('context and all previews leave ledger, history and outbox unchanged', (create) => {
  const f = create(); const baseline = f.balances();
  f.service.context();
  f.service.preview(f.input);
  f.service.preview({ ...f.input, retained_cash: '75' });
  assert.deepEqual(f.balances(), baseline);
  assert.deepEqual(f.counts(), { closures: 0, transactions: 0, notifications: 0 });
});

scenario('control example posts one owner settlement and a linked transfer pair', (create) => {
  const f = create();
  const range = getBusinessCalendarDayRange(2026, 10, 11);
  const beforeStats = queryCrmFinancialStats(f.database, range);
  const result = f.complete();
  assert.equal(result.replay, false);
  assert.deepEqual(f.balances(), [{ id: 'cash', balance: 35 }, { id: 'revenue', balance: 2100 }]);
  assert.deepEqual(f.counts(), { closures: 1, transactions: 3, notifications: 1 });
  const movements = f.database.prepare('SELECT closing_operation,amount,type,financial_close_id FROM cash_transactions ORDER BY closing_operation').all();
  assert.deepEqual(movements.map((row) => [row.closing_operation, row.amount, row.type]),
    [['owner_settlement', 1500, 'expense'], ['transfer_in', 1500, 'income'], ['transfer_out', 1500, 'expense']]);
  assert.ok(movements.every((row) => row.financial_close_id === result.closure.id));
  assert.equal(result.closure.snapshot.owner_cash_minor, 100000);
  assert.equal(result.closure.snapshot.owner_card_minor, 50000);
  assert.equal(result.closure.notification_status, 'pending');
  const outbox = f.database.prepare('SELECT * FROM internal_notification_outbox').get();
  assert.equal(outbox.event_type, 'shift_closed');
  assert.equal(JSON.parse(outbox.payload_json).closing_id, result.closure.id);
  assert.match(result.closure.report_text, /1[\s\u00a0]000,00 BYN/);
  assert.deepEqual(queryCrmFinancialStats(f.database, range), beforeStats);
});

scenario('shortage and surplus create exactly one correction and conserve final balance', (create) => {
  for (const [balance, type, amount] of [[3055, 'expense', 20], [2985, 'income', 50]]) {
    const f = create({ cashBalance: balance }); const result = f.complete();
    const correction = f.database.prepare("SELECT * FROM cash_transactions WHERE closing_operation = 'correction'").get();
    assert.equal(correction.type, type); assert.equal(correction.amount, amount);
    assert.equal(f.counts().transactions, 4);
    assert.equal(result.closure.snapshot.cash_balance_after_minor, 3500);
    assert.equal(f.balances()[0].balance, 35);
  }
});

scenario('identical retries return saved closure without duplicating movements or messages', (create) => {
  const f = create(); const preview = f.service.preview(f.input);
  const payload = { ...f.input, expected_revision: preview.context.revision };
  const first = f.service.close(payload, { requestKey: 'request_control_0001', actor: f.actor });
  const retry = f.service.close(payload, { requestKey: 'request_control_0001', actor: f.actor });
  assert.equal(retry.replay, true); assert.equal(retry.closure.id, first.closure.id);
  assert.deepEqual(f.counts(), { closures: 1, transactions: 3, notifications: 1 });
  assert.throws(() => f.service.close({ ...payload, retained_cash: '36' },
    { requestKey: 'request_control_0001', actor: f.actor }), code('closing_idempotency_conflict'));
  assert.throws(() => f.service.close(payload, { requestKey: 'request_other_0002', actor: f.actor }), code('financial_day_already_closed'));
});

scenario('independent operators cannot close the same date twice', (create) => {
  const f = create(); const payload = { ...f.input, expected_revision: f.service.preview(f.input).context.revision };
  const second = createFinancialDayCloseService(f.database, { now: () => new Date('2026-10-11T17:00:00Z') });
  f.service.close(payload, { requestKey: 'request_first_0001', actor: f.actor });
  assert.throws(() => second.close(payload, { requestKey: 'request_second_0002', actor: { name: 'Другой', username: 'other-admin' } }), code('financial_day_already_closed'));
  assert.equal(f.counts().closures, 1);
});

scenario('stale balance, statistics and midnight each reject final confirmation', (create) => {
  for (const change of ['balance', 'stats', 'midnight']) {
    const f = create(); const payload = { ...f.input, expected_revision: f.service.preview(f.input).context.revision };
    if (change === 'balance') f.database.prepare("UPDATE cash_accounts SET balance = balance + 1 WHERE id = 'cash'").run();
    if (change === 'stats') f.database.prepare("UPDATE orders SET profit = profit + 1 WHERE id = 'paid'").run();
    if (change === 'midnight') f.setClock('2026-10-11T21:00:00.000Z');
    const baseline = f.balances();
    assert.throws(() => f.service.close(payload, { requestKey: 'request_stale_0001', actor: f.actor }),
      code(change === 'midnight' ? 'closing_day_changed' : 'closing_preview_stale'));
    assert.deepEqual(f.balances(), baseline);
    assert.deepEqual(f.counts(), { closures: 0, transactions: 0, notifications: 0 });
  }
});

scenario('failure of the final transfer rolls back correction, owner payment, history and outbox', (create) => {
  const f = create({ cashBalance: 3055 }); const baseline = f.balances();
  f.database.exec(`CREATE TRIGGER fail_transfer BEFORE INSERT ON cash_transactions
    WHEN NEW.closing_operation = 'transfer_in' BEGIN SELECT RAISE(ABORT,'test_transfer_failure'); END;`);
  assert.throws(() => f.complete(), /test_transfer_failure/);
  assert.deepEqual(f.balances(), baseline);
  assert.deepEqual(f.counts(), { closures: 0, transactions: 0, notifications: 0 });
});

scenario('outbox persistence failure rolls back the entire financial transaction', (create) => {
  const f = create(); const baseline = f.balances();
  f.database.exec(`CREATE TRIGGER fail_outbox BEFORE INSERT ON internal_notification_outbox
    BEGIN SELECT RAISE(ABORT,'test_outbox_failure'); END;`);
  assert.throws(() => f.complete(), /test_outbox_failure/);
  assert.deepEqual(f.balances(), baseline);
  assert.deepEqual(f.counts(), { closures: 0, transactions: 0, notifications: 0 });
});

scenario('actor recheck failure happens before any financial write', (create) => {
  const f = create(); const baseline = f.balances();
  assert.throws(() => f.complete({}, { verifyActor: () => { throw new Error('actor_revoked'); } }), /actor_revoked/);
  assert.deepEqual(f.balances(), baseline);
  assert.deepEqual(f.counts(), { closures: 0, transactions: 0, notifications: 0 });
});

scenario('missing recipient preserves report; later configuration queues it once', (create) => {
  const f = create({ recipient: false }); const result = f.complete();
  assert.equal(result.closure.notification_status, 'awaiting_recipient');
  assert.equal(f.counts().notifications, 0);
  const report = result.closure.report_text;
  f.configure();
  assert.equal(f.service.enqueueReport(result.closure.id).notification_status, 'pending');
  f.service.enqueueReport(result.closure.id);
  assert.equal(f.counts().notifications, 1);
  f.configure('987654321', 'another_owner');
  f.service.enqueueReport(result.closure.id);
  assert.equal(f.counts().notifications, 1, 'An existing report must not be redirected or sent again');
  assert.equal(f.service.get(result.closure.id).report_text, report);
});

scenario('Telegram statuses do not alter balances and unknown delivery is never auto-requeued', (create) => {
  const f = create(); const result = f.complete(); const baseline = f.balances();
  for (const status of ['retry', 'unknown', 'failed', 'sent']) {
    f.database.prepare('UPDATE internal_notification_outbox SET status = ?').run(status);
    assert.equal(f.service.get(result.closure.id).notification_status, status);
    f.service.enqueueReport(result.closure.id);
    assert.equal(f.database.prepare('SELECT status FROM internal_notification_outbox').get().status, status);
    assert.deepEqual(f.balances(), baseline);
  }
});

scenario('next Minsk day reopens closure and carries retained balance, not new revenue', (create) => {
  const f = create(); f.complete();
  f.setClock('2026-10-11T21:00:00.000Z');
  const context = f.service.context();
  assert.equal(context.business_date, '2026-10-12');
  assert.equal(context.closure, null); assert.equal(context.revenue_minor, 0); assert.equal(context.profit_minor, 0);
  const input = { ...f.input, business_date: context.business_date, terminal_cash: '0', terminal_card: '0',
    counts: { 200: 0, 100: 0, 50: 0, 20: 1, 10: 1, 5: 1 }, expected_revision: context.revision };
  const result = f.service.close(input, { requestKey: 'request_next_day_0002', actor: f.actor });
  assert.equal(result.closure.snapshot.cash_balance_after_minor, 3500);
  assert.equal(result.closure.snapshot.transfer_minor, 0);
  assert.deepEqual(f.counts(), { closures: 2, transactions: 3, notifications: 2 });
});

scenario('historical snapshots survive subsequent account and order changes', (create) => {
  const f = create(); const saved = f.complete().closure;
  f.database.exec("UPDATE cash_accounts SET balance = 9999; UPDATE orders SET profit = 1;");
  const history = f.service.get(saved.id);
  assert.deepEqual(history.snapshot, saved.snapshot);
  assert.equal(history.report_text, saved.report_text);
  assert.equal(f.service.list()[0].id, saved.id);
});

scenario('ambiguous names require explicit existing accounts and identical accounts are rejected', (create) => {
  const f = create();
  f.database.exec("INSERT INTO cash_accounts(id,name,balance) VALUES ('cash2','Касса',0)");
  assert.throws(() => f.service.context(), code('closing_account_selection_required'));
  assert.equal(f.service.context({ cash_account_id: 'cash', revenue_account_id: 'revenue' }).cash_account_id, 'cash');
  assert.throws(() => f.service.preview({ ...f.input, revenue_account_id: 'cash' }), code('closing_accounts_must_differ'));
  assert.throws(() => f.service.preview({ ...f.input, cash_account_id: 'missing' }), code('closing_account_not_found'));
});

scenario('shared Overview totals include completed POS only and ignore unrelated ledger movements', (create) => {
  const f = create();
  f.database.exec(`INSERT INTO pos_sales VALUES ('pos','20','8','completed','2026-10-11T12:00:00.000Z');
    INSERT INTO pos_sales VALUES ('pending','100','80','pending','2026-10-11T12:00:00.000Z');
    INSERT INTO cash_transactions (id,account_id,type,amount) VALUES ('manual','cash','income',500);`);
  const current = f.service.context();
  assert.equal(current.revenue_minor, 302000); assert.equal(current.profit_minor, 150800); assert.equal(current.total_sales, 2);
});

function deliveryScenario(name, run) {
  test(name, async () => {
    const fixture = setup();
    try {
      const worker = await import('../utils/internal-notification-worker.js');
      await run(fixture, worker);
    } finally {
      fixture.database.close();
    }
  });
}

const outboxRow = (f) => f.database.prepare('SELECT * FROM internal_notification_outbox').get();
const deliveryTime = () => new Date(Date.now() + 1000);

deliveryScenario('financial closing captures a shift without closing it until the saved report is delivered', async (f, worker) => {
  f.database.exec(`
    CREATE TABLE staff_shifts (id TEXT PRIMARY KEY, employee_id TEXT, business_date TEXT,
      started_at TEXT, planned_end_at TEXT, status TEXT, ended_at TEXT, close_reason TEXT,
      version INTEGER, updated_at TEXT);
    CREATE TABLE staff_sessions (id TEXT PRIMARY KEY, employee_id TEXT, scope TEXT, revoked_at TEXT);
    CREATE TABLE staff_shift_audit (id TEXT PRIMARY KEY, shift_id TEXT, action TEXT, actor_kind TEXT,
      before_json TEXT, after_json TEXT, reason TEXT, created_at TEXT);
    INSERT INTO staff_shifts VALUES ('closing-shift', 'employee_test', '2026-10-11',
      '2026-10-11T07:00:00.000Z', '2026-10-11T18:15:00.000Z', 'active', NULL, NULL, 1,
      '2026-10-11T07:00:00.000Z');
    INSERT INTO staff_sessions VALUES ('closing-token', 'employee_test', 'shift', NULL);
  `);
  const closure = f.complete().closure;
  assert.equal(closure.snapshot.staff_shift_to_close.id, 'closing-shift');
  assert.equal(f.database.prepare("SELECT status FROM staff_shifts WHERE id = 'closing-shift'").get().status, 'active');
  const baseline = { balances: f.balances(), counts: f.counts() };
  const result = await worker.deliverInternalNotification(f.database, outboxRow(f), {
    now: deliveryTime(), sender: async () => ({ ok: true, telegram_message_id: 44 }),
  });
  assert.equal(result.outcome, 'sent');
  assert.equal(f.database.prepare("SELECT status FROM staff_shifts WHERE id = 'closing-shift'").get().status, 'closed');
  assert.ok(f.database.prepare("SELECT revoked_at FROM staff_sessions WHERE id = 'closing-token'").get().revoked_at);
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM staff_shift_audit').get().n, 1);
  assert.deepEqual({ balances: f.balances(), counts: f.counts() }, baseline);
});

deliveryScenario('worker sends the immutable saved report once without changing financial or staff records', async (f, worker) => {
  const closure = f.complete().closure;
  const baseline = f.balances();
  const calls = [];
  // Later settings must not redirect an already queued financial report.
  f.database.exec("UPDATE internal_notification_recipients SET telegram_id = '987654321', telegram_username = 'changed_owner'; UPDATE orders SET profit = 1;");
  const sender = async (request) => {
    calls.push(request);
    assert.equal(f.counts().closures, 1, 'Delivery occurs only after a committed closure');
    assert.equal(f.database.inTransaction, false);
    return { ok: true, telegram_message_id: 42 };
  };
  const result = await worker.deliverInternalNotification(f.database, outboxRow(f), { now: deliveryTime(), sender });
  assert.equal(result.outcome, 'sent');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].chatId, '123456789');
  assert.equal(calls[0].username, 'owner_test');
  assert.equal(calls[0].text, closure.report_text);
  assert.equal(calls[0].verified, true);
  assert.equal(f.service.get(closure.id).notification_status, 'sent');
  assert.equal(outboxRow(f).attempts, 1);
  f.service.enqueueReport(closure.id);
  await worker.processInternalNotifications(f.database, { now: deliveryTime(), sender });
  assert.equal(calls.length, 1);
  assert.deepEqual(f.balances(), baseline);
  assert.deepEqual(f.counts(), { closures: 1, transactions: 3, notifications: 1 });
});

deliveryScenario('ambiguous or thrown delivery is paused and never automatically sends a second report', async (f, worker) => {
  const closure = f.complete().closure;
  const baseline = f.balances();
  let calls = 0;
  const sender = async () => {
    calls += 1;
    throw new Error('Connection lost after Telegram may have accepted the report');
  };
  const result = await worker.deliverInternalNotification(f.database, outboxRow(f), { now: deliveryTime(), sender });
  assert.equal(result.outcome, 'unknown');
  assert.equal(f.service.get(closure.id).notification_status, 'unknown');
  f.service.enqueueReport(closure.id);
  await worker.processInternalNotifications(f.database, { now: new Date(Date.now() + 86400000), sender });
  const retry = await worker.deliverInternalNotification(f.database, outboxRow(f), { now: deliveryTime(), sender });
  assert.equal(retry.outcome, 'skipped');
  assert.equal(calls, 1);
  assert.equal(outboxRow(f).attempts, 1);
  assert.deepEqual(f.balances(), baseline);
  assert.deepEqual(f.counts(), { closures: 1, transactions: 3, notifications: 1 });
});

deliveryScenario('confirmed rejection retries the same saved report without duplicating ledger or outbox', async (f, worker) => {
  const closure = f.complete().closure;
  const baseline = f.balances();
  const calls = [];
  const sender = async (request) => {
    calls.push(request);
    return calls.length === 1
      ? { ok: false, outcome: 'rejected', error: 'temporary_rejection' }
      : { ok: true, telegram_message_id: 43 };
  };
  const first = await worker.deliverInternalNotification(f.database, outboxRow(f), { now: deliveryTime(), sender, rng: () => 0.5 });
  assert.equal(first.outcome, 'retry');
  assert.equal(f.service.get(closure.id).notification_status, 'retry');
  const queued = outboxRow(f);
  const retryAt = new Date(`${queued.next_attempt_at.replace(' ', 'T')}Z`);
  assert.ok(Number.isFinite(retryAt.getTime()));
  const second = await worker.deliverInternalNotification(f.database, queued, { now: new Date(retryAt.getTime() + 1000), sender });
  assert.equal(second.outcome, 'sent');
  assert.equal(f.service.get(closure.id).notification_status, 'sent');
  assert.equal(outboxRow(f).id, queued.id);
  assert.equal(outboxRow(f).attempts, 2);
  assert.deepEqual(calls.map((request) => request.text), [closure.report_text, closure.report_text]);
  assert.deepEqual(f.balances(), baseline);
  assert.deepEqual(f.counts(), { closures: 1, transactions: 3, notifications: 1 });
});
