export class FinancialCloseError extends Error {
  constructor(code, status = 400, details = {}) {
    super(code);
    this.name = 'FinancialCloseError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const CASH_DENOMINATIONS = Object.freeze([200, 100, 50, 20, 10, 5]);

function integer(value, field, { signed = false } = {}) {
  if (!Number.isSafeInteger(value) || (!signed && value < 0)) {
    throw new FinancialCloseError('invalid_minor_amount', 400, { field });
  }
  return value;
}

function checked(value, field) {
  return integer(value, field, { signed: true });
}

/** User input is parsed as decimal text, never multiplied as a float. */
export function parseMoneyMinor(value, field = 'amount') {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new FinancialCloseError('invalid_money', 400, { field });
  }
  const text = String(value).trim().replace(',', '.');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new FinancialCloseError('invalid_money', 400, { field });
  const result = BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0'));
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new FinancialCloseError('invalid_money', 400, { field });
  }
  return Number(result);
}

/** Boundary adapter for existing REAL ledger/statistics columns only. */
export function ledgerMoneyMinor(value, field = 'balance') {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new FinancialCloseError('invalid_ledger_amount', 409, { field });
  }
  const scaled = value * 100;
  const rounded = Math.sign(scaled) * Math.round(Math.abs(scaled) + Number.EPSILON * Math.abs(scaled));
  return checked(rounded, field);
}

export function countCashMinor(counts, coinsMinor = 0) {
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) {
    throw new FinancialCloseError('invalid_note_counts');
  }
  const allowed = new Set(CASH_DENOMINATIONS.map(String));
  for (const key of Object.keys(counts)) {
    if (!allowed.has(key)) throw new FinancialCloseError('invalid_denomination', 400, { denomination: key });
  }
  let total = integer(coinsMinor, 'coins_minor');
  for (const denomination of CASH_DENOMINATIONS) {
    const quantity = counts[String(denomination)];
    if (!Number.isSafeInteger(quantity) || quantity < 0) {
      throw new FinancialCloseError('invalid_note_count', 400, { denomination });
    }
    total = checked(total + checked(denomination * 100 * quantity, 'note_total'), 'counted_cash_minor');
  }
  return total;
}

/** All calculations and outputs are integer kopecks. No database side effects. */
export function calculateFinancialClosure({
  cashBalanceMinor,
  countedCashMinor,
  terminalCashMinor,
  terminalCardMinor,
  revenueMinor,
  profitMinor,
  retainedCashMinor,
  revenueBalanceMinor,
}) {
  integer(cashBalanceMinor, 'cash_balance_minor', { signed: true });
  integer(revenueBalanceMinor, 'revenue_balance_minor', { signed: true });
  integer(revenueMinor, 'revenue_minor', { signed: true });
  integer(profitMinor, 'profit_minor', { signed: true });
  integer(countedCashMinor, 'counted_cash_minor');
  integer(terminalCashMinor, 'terminal_cash_minor');
  integer(terminalCardMinor, 'terminal_card_minor');
  integer(retainedCashMinor, 'retained_cash_minor');

  const terminalTotalMinor = checked(terminalCashMinor + terminalCardMinor, 'terminal_total_minor');
  // Terminal cash is already part of counted notes: never add it again.
  const actualTotalMinor = checked(countedCashMinor + terminalCardMinor, 'actual_total_minor');
  const discrepancyMinor = checked(actualTotalMinor - cashBalanceMinor, 'discrepancy_minor');
  const ownerCashMinor = checked(profitMinor - terminalCardMinor, 'owner_cash_minor');
  if (ownerCashMinor < 0) {
    throw new FinancialCloseError('negative_owner_cash', 409, { profitMinor, terminalCardMinor });
  }
  const transferMinor = checked(countedCashMinor - ownerCashMinor - retainedCashMinor, 'transfer_minor');
  if (transferMinor < 0) {
    throw new FinancialCloseError('insufficient_counted_cash', 409, {
      countedCashMinor, ownerCashMinor, retainedCashMinor,
    });
  }
  const correctedCashMinor = checked(cashBalanceMinor + discrepancyMinor, 'corrected_cash_minor');
  // Profit is ONE owner settlement, including the card portion already received.
  const finalCashMinor = checked(correctedCashMinor - profitMinor - transferMinor, 'final_cash_minor');
  if (finalCashMinor !== retainedCashMinor || finalCashMinor < 0) {
    throw new FinancialCloseError('closing_balance_mismatch', 409);
  }
  const finalRevenueBalanceMinor = checked(revenueBalanceMinor + transferMinor, 'final_revenue_balance_minor');
  return {
    cash_balance_before_minor: cashBalanceMinor,
    counted_cash_minor: countedCashMinor,
    terminal_cash_minor: terminalCashMinor,
    terminal_card_minor: terminalCardMinor,
    terminal_total_minor: terminalTotalMinor,
    actual_total_minor: actualTotalMinor,
    revenue_minor: revenueMinor,
    profit_minor: profitMinor,
    discrepancy_minor: discrepancyMinor,
    discrepancy_type: discrepancyMinor < 0 ? 'shortage' : discrepancyMinor > 0 ? 'surplus' : 'none',
    correction_minor: discrepancyMinor,
    corrected_cash_minor: correctedCashMinor,
    owner_cash_minor: ownerCashMinor,
    owner_card_minor: terminalCardMinor,
    owner_total_minor: profitMinor,
    transfer_minor: transferMinor,
    revenue_balance_before_minor: revenueBalanceMinor,
    revenue_balance_after_minor: finalRevenueBalanceMinor,
    retained_cash_minor: retainedCashMinor,
    cash_balance_after_minor: finalCashMinor,
  };
}
