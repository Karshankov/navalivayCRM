import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CASH_DENOMINATIONS,
  calculateFinancialClosure,
  countCashMinor,
  ledgerMoneyMinor,
  parseMoneyMinor,
} from '../utils/financial-close-calculations.js';

const control = {
  cashBalanceMinor: 303500,
  countedCashMinor: 253500,
  terminalCashMinor: 50000,
  terminalCardMinor: 50000,
  revenueMinor: 300000,
  profitMinor: 150000,
  retainedCashMinor: 3500,
  revenueBalanceMinor: 60000,
};
const closes = (changes = {}) => calculateFinancialClosure({ ...control, ...changes });
const emptyCounts = () => Object.fromEntries(CASH_DENOMINATIONS.map((denomination) => [denomination, 0]));

function hasCode(code) {
  return (error) => error.code === code;
}

test('authoritative example: one owner settlement and no duplicate terminal cash', () => {
  const result = closes();
  assert.equal(result.terminal_total_minor, 100000);
  assert.equal(result.actual_total_minor, 303500);
  assert.equal(result.discrepancy_minor, 0);
  assert.equal(result.discrepancy_type, 'none');
  assert.equal(result.owner_cash_minor, 100000);
  assert.equal(result.owner_card_minor, 50000);
  assert.equal(result.owner_total_minor, 150000);
  assert.equal(result.transfer_minor, 150000);
  assert.equal(result.revenue_balance_after_minor, 210000);
  assert.equal(result.cash_balance_after_minor, 3500);
  assert.equal(result.corrected_cash_minor - result.owner_total_minor - result.transfer_minor, 3500);
});

test('terminal cash is informational, not added a second time', () => {
  const first = closes();
  const second = closes({ terminalCashMinor: 123456 });
  assert.equal(second.actual_total_minor, first.actual_total_minor);
  assert.equal(second.transfer_minor, first.transfer_minor);
  assert.equal(second.discrepancy_minor, first.discrepancy_minor);
});

test('shortage remains closable and affects only ledger reconciliation', () => {
  const result = closes({ cashBalanceMinor: 305500 });
  assert.equal(result.discrepancy_type, 'shortage');
  assert.equal(result.correction_minor, -2000);
  assert.equal(result.revenue_minor, control.revenueMinor);
  assert.equal(result.profit_minor, control.profitMinor);
  assert.equal(result.cash_balance_after_minor, 3500);
});

test('surplus remains closable and is a positive correction', () => {
  const result = closes({ cashBalanceMinor: 298500 });
  assert.equal(result.discrepancy_type, 'surplus');
  assert.equal(result.correction_minor, 5000);
  assert.equal(result.cash_balance_after_minor, 3500);
});

test('editing retained cash changes transfer, not profit or owner payment', () => {
  const result = closes({ retainedCashMinor: 7500 });
  assert.equal(result.transfer_minor, 146000);
  assert.equal(result.owner_total_minor, 150000);
  assert.equal(result.cash_balance_after_minor, 7500);
});

test('zero transfer, zero owner cash, and empty day are valid boundaries', () => {
  assert.equal(closes({ countedCashMinor: 103500 }).transfer_minor, 0);
  assert.equal(closes({ profitMinor: 50000 }).owner_cash_minor, 0);
  const result = calculateFinancialClosure({
    cashBalanceMinor: 3500, countedCashMinor: 3500,
    terminalCashMinor: 0, terminalCardMinor: 0,
    revenueMinor: 0, profitMinor: 0,
    retainedCashMinor: 3500, revenueBalanceMinor: 0,
  });
  assert.equal(result.owner_total_minor, 0);
  assert.equal(result.transfer_minor, 0);
  assert.equal(result.cash_balance_after_minor, 3500);
});

test('negative physical owner payment and insufficient cash are diagnostic errors', () => {
  assert.throws(() => closes({ profitMinor: 49999 }), hasCode('negative_owner_cash'));
  assert.throws(() => closes({ profitMinor: -1 }), hasCode('negative_owner_cash'));
  assert.throws(() => closes({ countedCashMinor: 103499 }), hasCode('insufficient_counted_cash'));
  assert.throws(() => closes({ retainedCashMinor: 253501 }), hasCode('insufficient_counted_cash'));
});

test('decimal input accepts kopecks and comma, rejecting blanks and invalid precision', () => {
  for (const [input, expected] of [['0', 0], ['35', 3500], ['0.01', 1], ['0,29', 29], [' 123.4 ', 12340], [35, 3500]]) {
    assert.equal(parseMoneyMinor(input), expected);
  }
  for (const input of ['', ' ', null, undefined, true, {}, [], '-1', '1.001', 'NaN', Infinity, '1e3', '1,2,3', '1 000', '0x10']) {
    assert.throws(() => parseMoneyMinor(input), hasCode('invalid_money'));
  }
  assert.throws(() => parseMoneyMinor('90071992547410'), hasCode('invalid_money'));
});

test('banknotes plus small denominations preserve kopecks', () => {
  const counts = { 200: 10, 100: 4, 50: 2, 20: 1, 10: 1, 5: 1 };
  assert.equal(countCashMinor(counts, 0), 253500);
  assert.equal(countCashMinor(counts, 29), 253529);
  assert.equal(countCashMinor(emptyCounts(), 1), 1);
  assert.throws(() => countCashMinor({ ...counts, 5: -1 }), hasCode('invalid_note_count'));
  assert.throws(() => countCashMinor({ ...counts, 5: 1.5 }), hasCode('invalid_note_count'));
  assert.throws(() => countCashMinor({ ...counts, 5: '1' }), hasCode('invalid_note_count'));
  assert.throws(() => countCashMinor({ 200: 1 }), hasCode('invalid_note_count'));
  assert.throws(() => countCashMinor({ ...counts, 500: 1 }), hasCode('invalid_denomination'));
  assert.throws(() => countCashMinor(null), hasCode('invalid_note_counts'));
  assert.throws(() => countCashMinor(counts, -1), hasCode('invalid_minor_amount'));
});

test('legacy REAL adapter contains rounding at the boundary', () => {
  assert.equal(ledgerMoneyMinor(0.1 + 0.2), 30);
  assert.equal(ledgerMoneyMinor(1.005), 101);
  assert.equal(ledgerMoneyMinor(-1.005), -101);
  for (const value of [null, undefined, '35', NaN, Infinity]) {
    assert.throws(() => ledgerMoneyMinor(value), hasCode('invalid_ledger_amount'));
  }
});

test('invalid integer fields and overflow cannot produce financial movements', () => {
  for (const field of Object.keys(control)) {
    for (const value of [undefined, null, '100', NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => closes({ [field]: value }), hasCode('invalid_minor_amount'));
    }
  }
  assert.throws(() => closes({ terminalCashMinor: Number.MAX_SAFE_INTEGER }), hasCode('invalid_minor_amount'));
});

test('integer conservation across varied valid distributions', () => {
  for (let index = 0; index < 200; index += 1) {
    const card = index * 17;
    const ownerCash = index * 23;
    const retained = index * 3;
    const transfer = index * 31;
    const cash = ownerCash + retained + transfer;
    const result = calculateFinancialClosure({
      cashBalanceMinor: cash + card + (index % 3 - 1) * 101,
      countedCashMinor: cash, terminalCashMinor: index * 7,
      terminalCardMinor: card, revenueMinor: cash + card,
      profitMinor: ownerCash + card, retainedCashMinor: retained,
      revenueBalanceMinor: index * 11,
    });
    assert.equal(result.owner_cash_minor, ownerCash);
    assert.equal(result.transfer_minor, transfer);
    assert.equal(result.cash_balance_after_minor, retained);
    assert.equal(result.revenue_balance_after_minor, index * 11 + transfer);
  }
});
