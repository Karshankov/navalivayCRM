import { describe, expect, it } from 'vitest';
import { CLOSE_DENOMINATIONS, PENDING_CLOSE_STORAGE_KEY, countCloseCash, formatCloseMoney, isFinancialCloseSnapshot, loadPendingFinancialClose, notificationCloseLabel, parseCloseMoney, parseCloseNoteCount, savePendingFinancialClose, type PendingFinancialClose } from '../financialDayClose';

const roundedSnapshot = () => ({
  cash_balance_before_minor: 110100, counted_cash_minor: 100000,
  terminal_cash_minor: 20000, terminal_card_minor: 10100, terminal_total_minor: 30100,
  actual_total_minor: 110100, revenue_minor: 80000, profit_minor: 58800,
  discrepancy_minor: 0, discrepancy_type: 'none', correction_minor: 0, corrected_cash_minor: 110100,
  owner_cash_before_rounding_minor: 48700, owner_rounding_minor: -200,
  owner_cash_minor: 48500, owner_card_minor: 10100, owner_total_minor: 58600,
  transfer_minor: 48000, revenue_balance_before_minor: 60000, revenue_balance_after_minor: 108000,
  retained_cash_minor: 3500, cash_balance_after_minor: 3500,
});
describe('coin reserve snapshot validation', () => {
  const reserved = () => ({ ...roundedSnapshot(), coins_minor: 10000, retained_notes_minor: 3500,
    retained_cash_minor: 13500, cash_balance_after_minor: 13500,
    transfer_minor: 38000, revenue_balance_after_minor: 98000 });
  it('accepts a complete coin reserve and keeps historical snapshots readable', () => {
    expect(isFinancialCloseSnapshot(reserved())).toBe(true);
    expect(isFinancialCloseSnapshot({ ...roundedSnapshot(), coins_minor: 10000 })).toBe(true);
  });
  it.each([
    { coins_minor: undefined }, { coins_minor: -1 }, { coins_minor: 0.5 },
    { retained_notes_minor: -1 }, { retained_cash_minor: 3500 },
    { cash_balance_after_minor: 3500 }, { transfer_minor: 48000 },
    { transfer_minor: -1 }, { owner_cash_minor: -500 },
  ])('rejects inconsistent or unsafe coin reserves %j', changes => {
    expect(isFinancialCloseSnapshot({ ...reserved(), ...changes })).toBe(false);
  });
});

describe('rounded closing snapshot validation', () => {
  it('accepts rounded distribution and historical snapshots without rounding fields', () => {
    expect(isFinancialCloseSnapshot(roundedSnapshot())).toBe(true);
    const { owner_cash_before_rounding_minor, owner_rounding_minor, ...legacy } = roundedSnapshot();
    expect(isFinancialCloseSnapshot({ ...legacy, owner_cash_minor: 48700, owner_total_minor: 58800, transfer_minor: 47800, revenue_balance_after_minor: 107800 })).toBe(true);
  });
  it.each([
    { owner_cash_before_rounding_minor: undefined }, { owner_rounding_minor: undefined },
    { owner_cash_before_rounding_minor: null }, { owner_rounding_minor: 0.5 },
    { owner_rounding_minor: -250 }, { owner_rounding_minor: 251 },
    { owner_cash_minor: 48501 }, { owner_total_minor: 58800 },
    { owner_cash_before_rounding_minor: -1 }, { profit_minor: 59000 },
  ])('rejects inconsistent rounding fields %j', changes => {
    expect(isFinancialCloseSnapshot({ ...roundedSnapshot(), ...changes })).toBe(false);
  });
});

const pending = (): PendingFinancialClose => ({
  version: 1, key: 'fclose_test_key_123456789',
  payload: { business_date: '2026-10-12', cash_account_id: 'cash', revenue_account_id: 'revenue', expected_revision: 'revision', terminal_cash: '12,50', terminal_card: '100', retained_cash: '50', coins: '0', counts: Object.fromEntries(CLOSE_DENOMINATIONS.map(value => [String(value), 0])) },
});
function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
describe('financial day close input and recovery', () => {
  it.each<[string, number]>([['0', 0], ['12,50', 1250], ['12.5', 1250], [' 001.09 ', 109], ['90071992547409.91', Number.MAX_SAFE_INTEGER]])('parses exact decimal input %s', (value, expected) => { expect(parseCloseMoney(value)).toBe(expected); });
  it.each(['', ' ', '-1', '+1', '1.001', '1,2.3', 'NaN', 'Infinity', '1e2', '12.', '90071992547409.92'])('does not turn invalid money %s into zero', value => { expect(parseCloseMoney(value)).toBeNull(); });
  it.each(['', '-1', '1.5', '1e2', '9007199254740992'])('rejects invalid note counts %s', value => { expect(parseCloseNoteCount(value)).toBeNull(); });
  it('counts denominations and coins without adding terminal cash', () => {
    const counts = Object.fromEntries(CLOSE_DENOMINATIONS.map(value => [String(value), '1']));
    expect(countCloseCash(counts, '2,30')).toBe(38730);
    expect(countCloseCash(counts, '')).toBeNull();
    expect(countCloseCash({ ...counts, '200': '' }, '0')).toBeNull();
    expect(countCloseCash({ ...counts, '200': String(Number.MAX_SAFE_INTEGER) }, '0')).toBeNull();
  });
  it('keeps negative results visible', () => { expect(formatCloseMoney(-1250)).toBe('−12,50 BYN'); expect(formatCloseMoney(0)).toBe('0,00 BYN'); });
  it('round-trips the identical key and payload without credentials', () => {
    const storage = memoryStorage(); const original = pending();
    savePendingFinancialClose(storage, original);
    expect(loadPendingFinancialClose(storage)).toEqual(original);
    expect(storage.getItem(PENDING_CLOSE_STORAGE_KEY)).not.toMatch(/token|authorization/i);
  });
  it('returns null only when no operation was stored', () => { expect(loadPendingFinancialClose(memoryStorage())).toBeNull(); });
  it('does not silently discard damaged recovery data', () => {
    const storage = memoryStorage(); storage.setItem(PENDING_CLOSE_STORAGE_KEY, '{');
    expect(() => loadPendingFinancialClose(storage)).toThrow();
    storage.setItem(PENDING_CLOSE_STORAGE_KEY, JSON.stringify({ ...pending(), key: 'bad' }));
    expect(() => loadPendingFinancialClose(storage)).toThrow();
    const damaged = pending(); damaged.payload.counts['200'] = -1;
    storage.setItem(PENDING_CLOSE_STORAGE_KEY, JSON.stringify(damaged));
    expect(() => loadPendingFinancialClose(storage)).toThrow();
  });
  it('does not swallow persistence failures before confirmation', () => {
    expect(() => savePendingFinancialClose({ setItem() { throw new Error('storage unavailable'); } }, pending())).toThrow('storage unavailable');
  });
  it('distinguishes saved report from actual Telegram delivery', () => {
    expect(notificationCloseLabel('pending')).toBe('В очереди');
    expect(notificationCloseLabel('awaiting_recipient')).toBe('Получатель не настроен');
    expect(notificationCloseLabel('unknown')).not.toBe('Отправлено');
    expect(notificationCloseLabel('sent')).toBe('Отправлено');
  });
});
