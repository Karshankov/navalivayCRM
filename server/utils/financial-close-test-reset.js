import crypto from 'node:crypto';
import { FinancialCloseError, ledgerMoneyMinor } from './financial-close-calculations.js';
import { isFinancialCloseTestResetEnabled } from './financial-close-activation.js';
import { stableJson } from './internal-notifications.js';

const RESET_TABLE = 'financial_close_test_resets';
function hasResetTable(database) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(RESET_TABLE));
}
export function getFinancialCloseResetRevision(database) {
  return hasResetTable(database)
    ? database.prepare('SELECT COUNT(*) AS revision FROM financial_close_test_resets').get().revision : 0;
}
export function wasFinancialCloseReset(database, requestKey) {
  return hasResetTable(database)
    && Boolean(database.prepare('SELECT 1 FROM financial_close_test_resets WHERE request_key = ?').get(requestKey));
}

/** Fingerprint unrelated ledger records so net-zero edits cannot escape reset checks. */
export function financialCloseLedgerFingerprint(database, cashId, revenueId, excludedClosureId = '') {
  const rows = database.prepare(`SELECT * FROM cash_transactions
    WHERE account_id IN (?, ?) AND (financial_close_id IS NULL OR financial_close_id != ?)
    ORDER BY id`).all(cashId, revenueId, excludedClosureId);
  return crypto.createHash('sha256').update(stableJson(rows)).digest('hex');
}
function deliveryPattern(id) {
  return `financial-close:${String(id).replace(/[\\%_]/g, '\\$&')}:recipient:%`;
}
function requireResetAccess(actor, confirmationId, id) {
  if (!isFinancialCloseTestResetEnabled()) throw new FinancialCloseError('financial_close_test_reset_disabled', 403);
  if (!actor?.username || !['manager', 'admin'].includes(actor.role)) {
    throw new FinancialCloseError('closing_test_reset_manager_required', 403);
  }
  if (!id || confirmationId !== id) throw new FinancialCloseError('closing_test_reset_confirmation_required');
}

/** Local-only reversal of ONE closure, never a whole-database restore. */
export function resetFinancialCloseForTesting(database, id, { actor, verifyActor = () => {}, confirmationId } = {}) {
  requireResetAccess(actor, confirmationId, id);
  return database.transaction(() => {
    verifyActor();
    requireResetAccess(actor, confirmationId, id);
    if (hasResetTable(database)) {
      const previous = database.prepare('SELECT closure_id FROM financial_close_test_resets WHERE closure_id = ?').get(id);
      if (previous) return { reset: true, replay: true, closure_id: id };
    }
    const row = database.prepare('SELECT * FROM financial_day_closures WHERE id = ?').get(id);
    if (!row) throw new FinancialCloseError('closing_not_found', 404);
    const latest = database.prepare('SELECT id FROM financial_day_closures ORDER BY business_date DESC LIMIT 1').get();
    if (latest?.id !== id) throw new FinancialCloseError('closing_test_reset_not_latest', 409);
    let snapshot;
    try { snapshot = JSON.parse(row.snapshot_json); }
    catch { throw new FinancialCloseError('closing_test_reset_snapshot_invalid', 409); }
    const movements = database.prepare('SELECT * FROM cash_transactions WHERE financial_close_id = ? ORDER BY id').all(id);
    const expected = snapshot?.operations;
    const operations = new Set(['correction', 'owner_settlement', 'transfer_out', 'transfer_in']);
    if (!Array.isArray(expected) || expected.length !== movements.length
      || expected.length > 4 || new Set(expected.map(item => item.operation)).size !== expected.length) {
      throw new FinancialCloseError('closing_test_reset_movements_changed', 409);
    }
    for (const movement of movements) {
      const original = expected.find(item => item.id === movement.id);
      if (!original || !operations.has(original.operation)
        || ![row.cash_account_id, row.revenue_account_id].includes(movement.account_id)
        || original.operation !== movement.closing_operation || original.account_id !== movement.account_id
        || original.type !== movement.type || original.description !== movement.description
        || !['income', 'expense'].includes(movement.type)
        || ledgerMoneyMinor(movement.amount) !== original.amount_minor) {
        throw new FinancialCloseError('closing_test_reset_movements_changed', 409);
      }
    }
    const accounts = database.prepare('SELECT * FROM cash_accounts WHERE id IN (?, ?) ORDER BY id')
      .all(row.cash_account_id, row.revenue_account_id);
    const cash = accounts.find(account => account.id === row.cash_account_id);
    const revenue = accounts.find(account => account.id === row.revenue_account_id);
    if (!cash || !revenue || cash.active !== 1 || revenue.active !== 1
      || ledgerMoneyMinor(cash.balance) !== snapshot.cash_balance_after_minor
      || ledgerMoneyMinor(revenue.balance) !== snapshot.revenue_balance_after_minor) {
      throw new FinancialCloseError('closing_test_reset_accounts_changed', 409);
    }
    if (typeof snapshot.test_reset_ledger_hash === 'string') {
      if (financialCloseLedgerFingerprint(database, cash.id, revenue.id, id) !== snapshot.test_reset_ledger_hash) {
        throw new FinancialCloseError('closing_test_reset_later_movements', 409);
      }
    } else {
      // Legacy closures have no ledger fingerprint. Conservatively reject even
      // same-second unrelated entries rather than guess their ordering.
      const later = database.prepare(`SELECT 1 FROM cash_transactions
        WHERE account_id IN (?, ?) AND (financial_close_id IS NULL OR financial_close_id != ?)
          AND (datetime(created_at) IS NULL OR datetime(created_at) >= datetime(?)) LIMIT 1`)
        .get(cash.id, revenue.id, id, row.closed_at.slice(0, 19));
      if (later) throw new FinancialCloseError('closing_test_reset_later_movements', 409);
    }
    const deliveries = database.prepare("SELECT * FROM internal_notification_outbox WHERE unique_key LIKE ? ESCAPE '\\' ORDER BY id")
      .all(deliveryPattern(id));
    if (deliveries.some(item => !['pending', 'retry', 'failed', 'cancelled'].includes(item.status)
      || item.sent_at || item.telegram_message_id || item.locked_at)) {
      throw new FinancialCloseError('closing_test_reset_delivery_unsafe', 409);
    }
    const deltas = new Map([[cash.id, 0], [revenue.id, 0]]);
    for (const movement of movements) {
      const signed = (movement.type === 'income' ? 1 : -1) * ledgerMoneyMinor(movement.amount);
      const next = deltas.get(movement.account_id) + signed;
      if (!Number.isSafeInteger(next)) throw new FinancialCloseError('closing_test_reset_snapshot_invalid', 409);
      deltas.set(movement.account_id, next);
    }
    for (const [account, before, after] of [
      [cash, snapshot.cash_balance_before_minor, snapshot.cash_balance_after_minor],
      [revenue, snapshot.revenue_balance_before_minor, snapshot.revenue_balance_after_minor],
    ]) {
      if (!Number.isSafeInteger(before) || !Number.isSafeInteger(after)
        || !Number.isSafeInteger(after - deltas.get(account.id)) || after - deltas.get(account.id) !== before) {
        throw new FinancialCloseError('closing_test_reset_snapshot_invalid', 409);
      }
    }
    const pacing = snapshot.cash_pacing_fact;
    if (pacing?.status === 'inserted') {
      const fact = database.prepare('SELECT * FROM cash_pacing_daily_facts WHERE id = ?').get(pacing.fact_id);
      const month = database.prepare('SELECT month_key FROM cash_pacing_months WHERE id = ?').get(pacing.month_id);
      const hash = fact ? crypto.createHash('sha256').update(stableJson(fact)).digest('hex') : null;
      if (!fact || fact.month_id !== pacing.month_id || fact.fact_date !== row.business_date
        || pacing.fact_date !== row.business_date || month?.month_key !== row.business_date.slice(0, 7)
        || ledgerMoneyMinor(fact.actual_amount) !== pacing.amount_minor || hash !== pacing.row_hash) {
        throw new FinancialCloseError('closing_test_reset_cash_pacing_changed', 409);
      }
      // This deletion shares the reset transaction; any later failure restores it.
      if (database.prepare('DELETE FROM cash_pacing_daily_facts WHERE id = ?').run(fact.id).changes !== 1) {
        throw new FinancialCloseError('closing_test_reset_cash_pacing_changed', 409);
      }
    } else if (pacing && pacing.status !== 'preserved') {
      throw new FinancialCloseError('closing_test_reset_snapshot_invalid', 409);
    }
    // Keep a permanent local audit/tombstone. It invalidates delayed close POSTs
    // and supplies a new preview revision even after balances are restored.
    database.exec(`CREATE TABLE IF NOT EXISTS financial_close_test_resets (
      closure_id TEXT PRIMARY KEY, request_key TEXT NOT NULL UNIQUE,
      reset_at TEXT NOT NULL, actor_username TEXT NOT NULL, audit_json TEXT NOT NULL
    )`);
    database.prepare(`INSERT INTO financial_close_test_resets
      (closure_id, request_key, reset_at, actor_username, audit_json) VALUES (?, ?, ?, ?, ?)`)
      .run(id, row.request_key, new Date().toISOString(), actor.username,
        stableJson({ closure: row, movements, deliveries, accounts }));
    database.prepare("DELETE FROM internal_notification_outbox WHERE unique_key LIKE ? ESCAPE '\\'").run(deliveryPattern(id));
    if (database.prepare('DELETE FROM cash_transactions WHERE financial_close_id = ?').run(id).changes !== movements.length) {
      throw new FinancialCloseError('closing_test_reset_movements_changed', 409);
    }
    for (const [account, before] of [[cash, snapshot.cash_balance_before_minor], [revenue, snapshot.revenue_balance_before_minor]]) {
      const amount = before / 100;
      if (ledgerMoneyMinor(amount) !== before
        || database.prepare('UPDATE cash_accounts SET balance = ? WHERE id = ? AND active = 1').run(amount, account.id).changes !== 1) {
        throw new FinancialCloseError('closing_test_reset_accounts_changed', 409);
      }
    }
    if (database.prepare('DELETE FROM financial_day_closures WHERE id = ?').run(id).changes !== 1) {
      throw new FinancialCloseError('closing_test_reset_movements_changed', 409);
    }
    return { reset: true, replay: false, closure_id: id };
  }).immediate();
}
