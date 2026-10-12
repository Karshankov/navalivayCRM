import crypto from 'node:crypto';
import {
  BUSINESS_TIME_ZONE,
  getBusinessCalendarDayRange,
  getTimeZoneDateParts,
} from './business-time.js';
import { queryCrmFinancialStats } from './crm-financial-stats.js';
import {
  FinancialCloseError,
  calculateFinancialClosure,
  countCashMinor,
  ledgerMoneyMinor,
  parseMoneyMinor,
} from './financial-close-calculations.js';
import { buildFinancialCloseReport } from './financial-close-report.js';
import { captureFinancialCloseShift } from './financial-close-shift.js';
import { isFinancialCloseTestResetEnabled } from './financial-close-activation.js';
import {
  financialCloseLedgerFingerprint,
  getFinancialCloseResetRevision,
  resetFinancialCloseForTesting,
  wasFinancialCloseReset,
} from './financial-close-test-reset.js';
import {
  enqueueInternalNotificationForGroup,
  listInternalNotificationRecipients,
  stableJson,
} from './internal-notifications.js';

export const FINANCIAL_CLOSE_NOTIFICATION_GROUP = 'financial_close';
const digest = (value) => crypto.createHash('sha256').update(stableJson(value)).digest('hex');
const makeId = (prefix) => `${prefix}_${crypto.randomUUID()}`;

export function financialBusinessDate(now = new Date()) {
  const parts = getTimeZoneDateParts(now);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

/** Inject the database and verified actor callback; never contact Telegram here. */
export function createFinancialDayCloseService(database, { now = () => new Date() } = {}) {
  function rowById(id) {
    return database.prepare('SELECT * FROM financial_day_closures WHERE id = ?').get(id);
  }

  function reportDeliveries(id) {
    return database.prepare(`
      SELECT id, status, attempts, sent_at, last_error
      FROM internal_notification_outbox
      WHERE unique_key LIKE ? ESCAPE '\\'
      ORDER BY id
    `).all(`financial-close:${String(id).replace(/[\\%_]/g, '\\$&')}:recipient:%`);
  }

  function publicClosure(row) {
    if (!row) return null;
    const { snapshot_json, counts_json, request_hash, request_key, ...metadata } = row;
    const deliveries = reportDeliveries(row.id);
    let status = row.notification_status;
    if (deliveries.length) {
      if (deliveries.every((item) => item.status === 'sent')) status = 'sent';
      else if (deliveries.some((item) => item.status === 'unknown')) status = 'unknown';
      else if (deliveries.some((item) => item.status === 'failed')) status = 'failed';
      else if (deliveries.some((item) => item.status === 'retry')) status = 'retry';
      else if (deliveries.some((item) => item.status === 'sending')) status = 'sending';
      else status = 'pending';
    }
    return {
      ...metadata,
      snapshot: JSON.parse(snapshot_json),
      counts: JSON.parse(counts_json),
      notification_status: status,
      notifications: deliveries,
    };
  }

  function resolveAccounts(input = {}) {
    const accounts = database.prepare('SELECT * FROM cash_accounts WHERE active = 1 ORDER BY created_at, id').all();
    function resolve(id, name) {
      if (id) {
        const account = accounts.find((item) => item.id === id);
        if (!account) throw new FinancialCloseError('closing_account_not_found', 409, { account: name });
        return account;
      }
      const matches = accounts.filter((item) => String(item.name).trim().toLocaleLowerCase('ru-RU') === name.toLocaleLowerCase('ru-RU'));
      if (matches.length !== 1) {
        throw new FinancialCloseError('closing_account_selection_required', 409, { account: name });
      }
      return matches[0];
    }
    const cash = resolve(input.cash_account_id, 'Касса');
    const revenue = resolve(input.revenue_account_id, 'Выручка');
    if (cash.id === revenue.id) throw new FinancialCloseError('closing_accounts_must_differ', 400);
    return { cash, revenue };
  }

  function cashPacingRows(businessDate) {
    const monthKey = businessDate.slice(0, 7);
    const month = database.prepare('SELECT * FROM cash_pacing_months WHERE month_key = ?').get(monthKey);
    const fact = month ? database.prepare('SELECT * FROM cash_pacing_daily_facts WHERE month_id = ? AND fact_date = ?')
      .get(month.id, businessDate) : null;
    return { monthKey, month, fact };
  }

  /** Called only inside the immediate closing transaction. Never overwrite a fact. */
  function saveCashPacingFact(businessDate, totalMinor, reference) {
    const { monthKey, month, fact } = cashPacingRows(businessDate);
    if (!month) throw new FinancialCloseError('closing_cash_pacing_month_required', 409, { month_key: monthKey });
    if (!Number.isSafeInteger(totalMinor) || totalMinor < 0 || ledgerMoneyMinor(totalMinor / 100) !== totalMinor) {
      throw new FinancialCloseError('invalid_money');
    }
    let saved = fact;
    if (!saved) {
      const factId = makeId('cpf');
      const timestamp = reference.toISOString().replace('T', ' ').slice(0, 19);
      database.prepare(`INSERT INTO cash_pacing_daily_facts
        (id, month_id, fact_date, actual_amount, note, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(factId, month.id, businessDate, totalMinor / 100,
          `Из закрытия финансового дня ${businessDate}: наличные + карта по терминалу`, timestamp, timestamp);
      saved = database.prepare('SELECT * FROM cash_pacing_daily_facts WHERE id = ?').get(factId);
    }
    return { status: fact ? 'preserved' : 'inserted', fact_id: saved.id, month_id: month.id,
      fact_date: businessDate, amount_minor: ledgerMoneyMinor(saved.actual_amount),
      row_hash: digest(saved) };
  }

  function context(input = {}, reference = now()) {
    const businessDate = financialBusinessDate(reference);
    const parts = getTimeZoneDateParts(reference);
    const range = getBusinessCalendarDayRange(parts.year, parts.month, parts.day);
    const accounts = resolveAccounts(input);
    const stats = queryCrmFinancialStats(database, range);
    const recipients = listInternalNotificationRecipients(database, FINANCIAL_CLOSE_NOTIFICATION_GROUP);
    const pacing = cashPacingRows(businessDate);
    const values = {
      business_date: businessDate,
      time_zone: BUSINESS_TIME_ZONE,
      cash_account_id: accounts.cash.id,
      revenue_account_id: accounts.revenue.id,
      cash_balance_minor: ledgerMoneyMinor(accounts.cash.balance, 'cash_balance'),
      revenue_balance_minor: ledgerMoneyMinor(accounts.revenue.balance, 'revenue_balance'),
      revenue_minor: ledgerMoneyMinor(stats.revenue, 'revenue'),
      profit_minor: ledgerMoneyMinor(stats.profit, 'profit'),
      total_sales: stats.total_sales,
      unique_customers: stats.unique_customers,
      recipient_ids: recipients.map((item) => item.telegram_id),
      test_reset_revision: getFinancialCloseResetRevision(database),
      owner_cash_rounding: 'nearest_5_byn_half_up_v1',
      coins_retention: 'all_coins_reserved_in_total_retained_cash_v1',
      cash_pacing: { month_key: pacing.monthKey, month_id: pacing.month?.id ?? null,
        existing_amount_minor: pacing.fact ? ledgerMoneyMinor(pacing.fact.actual_amount) : null,
        revision: digest({ month_id: pacing.month?.id ?? null, fact: pacing.fact ?? null }) },
    };
    return {
      ...values,
      revision: digest(values),
      cash_account_name: accounts.cash.name,
      revenue_account_name: accounts.revenue.name,
      notification_ready: recipients.length > 0,
      closure: publicClosure(database.prepare('SELECT * FROM financial_day_closures WHERE business_date = ?').get(businessDate)),
    };
  }

  function normalizeInput(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new FinancialCloseError('invalid_closing_input');
    const coinsMinor = parseMoneyMinor(input.coins, 'coins');
    const countedCashMinor = countCashMinor(input.counts, coinsMinor);
    return {
      business_date: String(input.business_date || ''),
      cash_account_id: String(input.cash_account_id || ''),
      revenue_account_id: String(input.revenue_account_id || ''),
      terminal_cash_minor: parseMoneyMinor(input.terminal_cash, 'terminal_cash'),
      terminal_card_minor: parseMoneyMinor(input.terminal_card, 'terminal_card'),
      retained_cash_minor: parseMoneyMinor(input.retained_cash, 'retained_cash'),
      coins_minor: coinsMinor,
      counted_cash_minor: countedCashMinor,
      counts: Object.fromEntries(Object.entries(input.counts).sort(([a], [b]) => Number(b) - Number(a))),
    };
  }

  function calculate(input, current) {
    return calculateFinancialClosure({
      cashBalanceMinor: current.cash_balance_minor,
      revenueBalanceMinor: current.revenue_balance_minor,
      revenueMinor: current.revenue_minor,
      profitMinor: current.profit_minor,
      countedCashMinor: input.counted_cash_minor,
      terminalCashMinor: input.terminal_cash_minor,
      terminalCardMinor: input.terminal_card_minor,
      retainedCashMinor: input.retained_cash_minor,
      coinsMinor: input.coins_minor,
    });
  }

  function preview(input) {
    return database.transaction(() => {
      const normalized = normalizeInput(input);
      const current = context(normalized);
      if (normalized.business_date !== current.business_date) throw new FinancialCloseError('closing_day_changed', 409);
      if (current.closure) throw new FinancialCloseError('financial_day_already_closed', 409, { closure_id: current.closure.id });
      if (!current.cash_pacing.month_id) throw new FinancialCloseError('closing_cash_pacing_month_required', 409,
        { month_key: current.cash_pacing.month_key });
      return { context: current, snapshot: calculate(normalized, current) };
    })();
  }

  /** Durable report text remains in the closure when recipient configuration is absent. */
  function enqueueReport(id) {
    const row = rowById(id);
    if (!row) throw new FinancialCloseError('closing_not_found', 404);
    // An existing delivery set is immutable: configuration changes must not create
    // another copy of an already queued report or silently redirect financial data.
    const existing = reportDeliveries(id);
    if (existing.length) return publicClosure(row);
    const result = enqueueInternalNotificationForGroup(database, {
      eventGroup: FINANCIAL_CLOSE_NOTIFICATION_GROUP,
      uniqueKey: `financial-close:${row.id}`,
      eventType: 'shift_closed',
      payload: { closing_id: row.id, business_date: row.business_date, text: row.report_text },
    });
    database.prepare('UPDATE financial_day_closures SET notification_status = ? WHERE id = ?')
      .run(result.recipients ? 'pending' : 'awaiting_recipient', id);
    return publicClosure(rowById(id));
  }

  function close(input, { requestKey, actor, verifyActor = () => {} } = {}) {
    if (typeof requestKey !== 'string' || !/^[A-Za-z0-9:_-]{16,128}$/.test(requestKey)) {
      throw new FinancialCloseError('closing_idempotency_key_required');
    }
    if (!actor || !actor.name || !actor.username) throw new FinancialCloseError('closing_actor_required', 403);
    const normalized = normalizeInput(input);
    const requestHash = digest({ ...normalized, actor_id: actor.employeeId || actor.username });
    return database.transaction(() => {
      verifyActor();
      if (wasFinancialCloseReset(database, requestKey)) {
        throw new FinancialCloseError('closing_request_was_reset', 409);
      }
      const replay = database.prepare('SELECT * FROM financial_day_closures WHERE request_key = ?').get(requestKey);
      if (replay) {
        if (replay.request_hash !== requestHash) throw new FinancialCloseError('closing_idempotency_conflict', 409);
        return { closure: publicClosure(replay), replay: true };
      }
      const reference = now();
      const current = context(normalized, reference);
      if (normalized.business_date !== current.business_date) throw new FinancialCloseError('closing_day_changed', 409);
      if (current.closure) throw new FinancialCloseError('financial_day_already_closed', 409, { closure_id: current.closure.id });
      if (!current.cash_pacing.month_id) throw new FinancialCloseError('closing_cash_pacing_month_required', 409,
        { month_key: current.cash_pacing.month_key });
      if (typeof input.expected_revision !== 'string' || input.expected_revision !== current.revision) {
        throw new FinancialCloseError('closing_preview_stale', 409);
      }
      const snapshot = calculate(normalized, current);
      const id = makeId('fclose');
      const movements = [];
      const addMovement = (operation, accountId, signedMinor, description) => {
        if (signedMinor === 0) return;
        movements.push({ id: makeId('trans'), operation, account_id: accountId,
          type: signedMinor > 0 ? 'income' : 'expense', amount_minor: Math.abs(signedMinor), description });
      };
      addMovement('correction', current.cash_account_id, snapshot.correction_minor,
        `Сверка кассы ${current.business_date}: ${snapshot.discrepancy_type === 'shortage' ? 'недостача' : 'излишек'}`);
      addMovement('owner_settlement', current.cash_account_id, -snapshot.owner_total_minor,
        `Выдача владельцу ${current.business_date}: наличными ${(snapshot.owner_cash_minor / 100).toFixed(2)} BYN; уже картой ${(snapshot.owner_card_minor / 100).toFixed(2)} BYN`);
      addMovement('transfer_out', current.cash_account_id, -snapshot.transfer_minor,
        `Перевод в «${current.revenue_account_name}» при закрытии ${current.business_date}`);
      addMovement('transfer_in', current.revenue_account_id, snapshot.transfer_minor,
        `Перевод из «${current.cash_account_name}» при закрытии ${current.business_date}`);
      const savedSnapshot = {
        ...snapshot, coins_minor: normalized.coins_minor,
        cash_account_name: current.cash_account_name, revenue_account_name: current.revenue_account_name,
        operations: movements,
        staff_shift_to_close: captureFinancialCloseShift(database, actor, current.business_date),
        cash_pacing_fact: saveCashPacingFact(current.business_date, snapshot.terminal_total_minor, reference),
        ...(isFinancialCloseTestResetEnabled() ? {
          test_reset_ledger_hash: financialCloseLedgerFingerprint(database, current.cash_account_id, current.revenue_account_id),
        } : {}),
      };
      const report = buildFinancialCloseReport({ businessDate: current.business_date, employeeName: actor.name, snapshot: savedSnapshot });
      database.prepare(`
        INSERT INTO financial_day_closures (
          id, business_date, time_zone, closed_at, employee_id, employee_name,
          actor_username, request_key, request_hash, cash_account_id, revenue_account_id,
          snapshot_json, counts_json, report_text, notification_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
      `).run(id, current.business_date, current.time_zone, reference.toISOString(), actor.employeeId || null,
        actor.name, actor.username, requestKey, requestHash, current.cash_account_id, current.revenue_account_id,
        stableJson(savedSnapshot), stableJson(normalized.counts), report);
      const insertMovement = database.prepare(`
        INSERT INTO cash_transactions
          (id, account_id, type, amount, description, employee_id, financial_close_id, closing_operation, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const movement of movements) {
        insertMovement.run(movement.id, movement.account_id, movement.type, movement.amount_minor / 100,
          movement.description, actor.employeeId || null, id, movement.operation, reference.toISOString().replace('T', ' ').slice(0, 19));
        const delta = (movement.type === 'income' ? 1 : -1) * movement.amount_minor / 100;
        if (database.prepare('UPDATE cash_accounts SET balance = ROUND(balance + ?, 2) WHERE id = ? AND active = 1')
          .run(delta, movement.account_id).changes !== 1) {
          throw new FinancialCloseError('closing_account_changed', 409);
        }
      }
      const cashAfter = database.prepare('SELECT balance FROM cash_accounts WHERE id = ?').get(current.cash_account_id);
      const revenueAfter = database.prepare('SELECT balance FROM cash_accounts WHERE id = ?').get(current.revenue_account_id);
      if (ledgerMoneyMinor(cashAfter.balance) !== snapshot.cash_balance_after_minor
        || ledgerMoneyMinor(revenueAfter.balance) !== snapshot.revenue_balance_after_minor) {
        throw new FinancialCloseError('closing_balance_mismatch', 409);
      }
      // Only inserts a durable outbox task; network delivery runs after commit.
      return { closure: enqueueReport(id), replay: false };
    }).immediate();
  }

  function list({ limit = 50, offset = 0 } = {}) {
    const safeLimit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 200) : 50;
    const safeOffset = Number.isSafeInteger(offset) && offset >= 0 ? Math.min(offset, 1000000) : 0;
    return database.prepare('SELECT * FROM financial_day_closures ORDER BY closed_at DESC, id DESC LIMIT ? OFFSET ?')
      .all(safeLimit, safeOffset).map(publicClosure);
  }

  return {
    context: (input) => database.transaction(() => context(input))(),
    preview, close, list,
    resetForTesting: (id, options) => resetFinancialCloseForTesting(database, id, options),
    get: (id) => publicClosure(rowById(id)),
    enqueueReport: (id) => database.transaction(() => enqueueReport(id)).immediate(),
  };
}
