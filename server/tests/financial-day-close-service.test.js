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
