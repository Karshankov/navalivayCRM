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

test('integer conservation across varied rounded distributions', () => {
  for (let index = 0; index < 200; index += 1) {
    const card = index * 17;
    const ownerCash = index * 23;
    const roundedOwnerCash = Math.floor((ownerCash + 250) / 500) * 500;
    const retained = index * 3;
    const transferBeforeRounding = index * 31 + 500;
    const transfer = transferBeforeRounding - (roundedOwnerCash - ownerCash);
    const cash = ownerCash + retained + transferBeforeRounding;
    const result = calculateFinancialClosure({
      cashBalanceMinor: cash + card + (index % 3 - 1) * 101,
      countedCashMinor: cash, terminalCashMinor: index * 7,
      terminalCardMinor: card, revenueMinor: cash + card,
      profitMinor: ownerCash + card, retainedCashMinor: retained,
      revenueBalanceMinor: index * 11,
    });
    assert.equal(result.profit_minor, ownerCash + card);
    assert.equal(result.owner_cash_before_rounding_minor, ownerCash);
    assert.equal(result.owner_cash_minor, roundedOwnerCash);
    assert.equal(result.owner_cash_minor % 500, 0);
    assert.equal(result.owner_rounding_minor, roundedOwnerCash - ownerCash);
    assert.equal(result.owner_total_minor, roundedOwnerCash + card);
    assert.equal(result.transfer_minor, transfer);
    assert.equal(result.cash_balance_after_minor, retained);
    assert.equal(result.revenue_balance_after_minor, index * 11 + transfer);
    assert.equal(result.corrected_cash_minor - result.owner_total_minor - result.transfer_minor, retained);
  }
});

test('rounding uses physical owner cash, with midpoint upward and unchanged Overview profit', () => {
  for (const [rawCash, roundedCash] of [[0, 0], [1, 0], [249, 0], [250, 500], [251, 500], [499, 500], [500, 500], [501, 500], [58749, 58500], [58750, 59000], [58800, 59000], [48700, 48500]]) {
    const result = closes({ profitMinor: rawCash + 10100, terminalCardMinor: 10100 });
    assert.equal(result.owner_cash_before_rounding_minor, rawCash);
    assert.equal(result.owner_cash_minor, roundedCash);
    assert.equal(result.owner_rounding_minor, roundedCash - rawCash);
    assert.equal(result.owner_card_minor, 10100);
    assert.equal(result.owner_total_minor, roundedCash + 10100);
    assert.equal(result.profit_minor, rawCash + 10100);
    assert.equal(result.transfer_minor, control.countedCashMinor - roundedCash - control.retainedCashMinor);
    assert.equal(result.cash_balance_after_minor, control.retainedCashMinor);
  }
  const noCard = closes({ profitMinor: 58800, terminalCardMinor: 0 });
  assert.equal(noCard.owner_cash_minor, 59000);
  assert.equal(noCard.owner_rounding_minor, 200);
  const withCard = closes({ profitMinor: 58800, terminalCardMinor: 10100 });
  assert.equal(withCard.owner_cash_minor, 48500);
  assert.equal(withCard.owner_total_minor, 58600);
  assert.equal(withCard.owner_rounding_minor, -200);
});

test('all coins are reserved and cannot fund owner payout or revenue transfer', () => {
  const withCoins = closes({ countedCashMinor: 263500, cashBalanceMinor: 313500, coinsMinor: 10000, retainedCashMinor: 13500 });
  assert.equal(withCoins.owner_cash_minor, 100000);
  assert.equal(withCoins.transfer_minor, 150000);
  assert.equal(withCoins.coins_minor, 10000);
  assert.equal(withCoins.retained_notes_minor, 3500);
  assert.equal(withCoins.cash_balance_after_minor, 13500);
  assert.equal(withCoins.profit_minor, control.profitMinor);
  assert.equal(withCoins.revenue_minor, control.revenueMinor);
  const coinsOnly = closes({ cashBalanceMinor: 10029, countedCashMinor: 10029, terminalCardMinor: 0, profitMinor: 0, coinsMinor: 10029, retainedCashMinor: 10029 });
  assert.equal(coinsOnly.transfer_minor, 0);
  assert.equal(coinsOnly.owner_cash_minor, 0);
  assert.equal(coinsOnly.cash_balance_after_minor, 10029);
  assert.throws(() => closes({ coinsMinor: 10000, retainedCashMinor: 3500 }), hasCode('retained_cash_below_coins'));
  assert.throws(() => closes({ countedCashMinor: 110000, coinsMinor: 10000, retainedCashMinor: 13500 }), hasCode('insufficient_counted_cash'));
  for (const coinsMinor of [-1, null, '100', 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => closes({ coinsMinor }), hasCode('invalid_minor_amount'));
  }
  assert.throws(() => closes({ coinsMinor: 300000 }), hasCode('invalid_minor_amount'));
});

test('rounding cannot hide negative cash, exceed available cash, or overflow', () => {
  assert.throws(() => closes({ profitMinor: 49999 }), hasCode('negative_owner_cash'));
  assert.throws(() => closes({ profitMinor: 50250, countedCashMinor: 3750 }), hasCode('insufficient_counted_cash'));
  const fits = closes({ profitMinor: 50250, countedCashMinor: 4000 });
  assert.equal(fits.owner_cash_minor, 500);
  assert.equal(fits.transfer_minor, 0);
  assert.throws(() => closes({ profitMinor: Number.MAX_SAFE_INTEGER, terminalCardMinor: 0 }), hasCode('invalid_minor_amount'));
});
