import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isFinancialCloseEnabled,
  assertFinancialCloseDatabaseReady,
} from '../utils/financial-close-activation.js';

function databaseStub({ checks = [{ quick_check: 'ok' }], foreignKeys = [], failure } = {}) {
  const calls = [];
  return {
    calls,
    pragma(statement) {
      calls.push(statement);
      if (failure) throw failure;
      if (statement === 'quick_check') return checks;
      if (statement === 'foreign_key_check') return foreignKeys;
      throw new Error(`Unexpected database operation: ${statement}`);
    },
  };
}

const enabled = { FINANCIAL_DAY_CLOSE_ENABLED: '1' };
const isInvalidDatabaseError = (error) =>
  error instanceof Error && error.code === 'financial_close_database_invalid';

test('financial close accepts only explicit enabled flag values', () => {
  for (const value of ['1', 'true', ' TRUE ', ' 1 ']) {
    assert.equal(isFinancialCloseEnabled({ FINANCIAL_DAY_CLOSE_ENABLED: value }), true);
  }
  for (const value of ['', '0', 'false', 'yes', 'on', '2']) {
    assert.equal(isFinancialCloseEnabled({ FINANCIAL_DAY_CLOSE_ENABLED: value }), false);
  }
  assert.equal(isFinancialCloseEnabled({}), false);
});

test('disabled financial close performs no database operations', () => {
  const database = databaseStub({ failure: new Error('Must not access database') });
  assert.equal(assertFinancialCloseDatabaseReady(database, {}), false);
  assert.equal(assertFinancialCloseDatabaseReady(database, { FINANCIAL_DAY_CLOSE_ENABLED: 'false' }), false);
  assert.deepEqual(database.calls, []);
});

test('enabled financial close requires both integrity checks to pass', () => {
  const database = databaseStub();
  assert.equal(assertFinancialCloseDatabaseReady(database, enabled), true);
  assert.deepEqual(database.calls, ['quick_check', 'foreign_key_check']);
});

test('financial close rejects malformed or unsuccessful quick_check results', () => {
  const invalidResults = [
    [],
    [{ quick_check: 'Page 12: never used' }],
    [{ quick_check: 'ok' }, { quick_check: 'ok' }],
    [{}],
    [{ quick_check: 'ok', extra: 'unexpected' }],
    [{ quick_check: null }],
  ];
  for (const checks of invalidResults) {
    const database = databaseStub({ checks });
    assert.throws(() => assertFinancialCloseDatabaseReady(database, enabled), isInvalidDatabaseError);
    assert.deepEqual(database.calls, ['quick_check']);
  }
});

test('financial close rejects foreign key violations', () => {
  const database = databaseStub({
    foreignKeys: [{ table: 'cash_transactions', rowid: 1, parent: 'cash_accounts', fkid: 0 }],
  });
  assert.throws(() => assertFinancialCloseDatabaseReady(database, enabled), isInvalidDatabaseError);
  assert.deepEqual(database.calls, ['quick_check', 'foreign_key_check']);
});

test('financial close fails safely if quick_check throws', () => {
  const database = databaseStub({ failure: new Error('Database read failed') });
  assert.throws(() => assertFinancialCloseDatabaseReady(database, enabled), isInvalidDatabaseError);
  assert.deepEqual(database.calls, ['quick_check']);
});

test('financial close fails safely if foreign_key_check throws', () => {
  const calls = [];
  const database = {
    pragma(statement) {
      calls.push(statement);
      if (statement === 'quick_check') return [{ quick_check: 'ok' }];
      throw new Error('Foreign key check failed');
    },
  };
  assert.throws(() => assertFinancialCloseDatabaseReady(database, enabled), isInvalidDatabaseError);
  assert.deepEqual(calls, ['quick_check', 'foreign_key_check']);
});
