/**
 * Customer blocks lifecycle tests.
 *
 * Покрытие критических инвариантов системы блокировок клиентов:
 *   1. createBlock(customer_id) — обычный блок, проверка получает active
 *   2. createBlock(@username) для существующего customer → активный блок
 *   3. createBlock(@username) для несуществующего → pending bаn
 *   4. UNIQUE-индекс: повторный createBlock того же customer → already_blocked
 *   5. unblockCustomerBlock — заполняет аудит-поля, get больше не возвращает
 *   6. computeBlockUntil — корректно считает разные единицы и forever
 *   7. activatePendingBansForCustomer — переносит pending в active с правильным id (НЕ NULL!)
 *   8. activatePendingBansForCustomer — НЕ удаляет pending когда уже есть active (C3 fix)
 *   9. Истёкший блок не возвращается getActive*
 *   10. LIKE-поиск pending по @username case-insensitive
 *
 * Запуск: node server/tests/customer-blocks.test.js
 */

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TMP_DB = path.resolve(__dirname, `./.tmp-blocks-${Date.now()}.db`);
process.env.DATABASE_FILE = TMP_DB;

const { db, initDb } = await import('../db.js');
initDb();
const {
  computeBlockUntil,
  createBlock,
  getActiveBlockForCustomerId,
  getActiveBlockForTelegramId,
  getPendingBanForUsername,
  unblockCustomerBlock,
  activatePendingBansForCustomer,
  normalizeUsername,
} = await import('../utils/customer-blocks.js');

const results = { passed: 0, failed: 0 };
function assertEq(actual, expected, msg) {
  if (actual === expected) {
    results.passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    results.failed++;
    console.log(`  ❌ ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function assertTrue(cond, msg) {
  assertEq(Boolean(cond), true, msg);
}

function makeCustomer({ id, telegram_id, telegram_username }) {
  db.prepare(
    `INSERT INTO customers (id, telegram_id, telegram_username, first_visit_at, total_orders, total_spent)
     VALUES (?, ?, ?, DATETIME('now'), 0, 0)`,
  ).run(id, telegram_id, telegram_username || null);
}

function setupSchema() {
  db.exec(`
    DELETE FROM customer_blocks;
    DELETE FROM pending_customer_bans;
    DELETE FROM customers;
  `);

  makeCustomer({ id: 'cust_alice', telegram_id: '111', telegram_username: 'alice' });
  makeCustomer({ id: 'cust_bob', telegram_id: '222', telegram_username: 'bob' });
  makeCustomer({ id: 'cust_carol', telegram_id: '333', telegram_username: 'CarolUPPER' });
}

function runTests() {
  console.log('\n=== Setup ===');
  setupSchema();

  console.log('\n=== Test 1: createBlock(customer_id) → active ===');
  const r1 = createBlock({
    customer_id: 'cust_alice',
    block_until: null,
    reason: 'flood',
    blocked_by: 'admin',
  });
  assertEq(r1.kind, 'active', 'kind = active');
  assertTrue(r1.block.id, 'block.id есть');
  assertTrue(r1.block.id.startsWith('block_'), 'id префикс block_');
  assertEq(r1.block.customer_id, 'cust_alice', 'customer_id корректен');
  assertEq(r1.block.reason, 'flood', 'reason сохранён');

  console.log('\n=== Test 2: createBlock(@username) для известного customer → active ===');
  const r2 = createBlock({
    telegram_username: 'bob',
    block_until: null,
    reason: 'spam',
    blocked_by: 'admin',
  });
  assertEq(r2.kind, 'active', 'kind = active (резолв username → customer_id)');
  assertEq(r2.block.customer_id, 'cust_bob', 'customer_id найден по username');

  console.log('\n=== Test 3: createBlock(@username) для НЕсуществующего → pending ===');
  const r3 = createBlock({
    telegram_username: 'newcomer',
    block_until: null,
    reason: 'preventive',
    blocked_by: 'admin',
  });
  assertEq(r3.kind, 'pending', 'kind = pending (нет customer)');
  assertEq(r3.block.telegram_username, 'newcomer', 'telegram_username сохранён');
  assertTrue(typeof r3.block.id === 'number', 'pending id это number (autoincrement)');

  console.log('\n=== Test 4: повторный createBlock → already_blocked (UNIQUE) ===');
  let dupErr = null;
  try {
    createBlock({ customer_id: 'cust_alice', block_until: null, reason: 'dup' });
  } catch (e) {
    dupErr = e;
  }
  assertTrue(dupErr, 'ошибка брошена');
  assertEq(dupErr?.code, 'already_blocked', 'код = already_blocked');
  assertTrue(dupErr?.existing?.id, 'existing блок приложен');
  assertEq(dupErr?.existing?.customer_id, 'cust_alice', 'existing.customer_id верный');

  console.log('\n=== Test 4b: UNIQUE-индекс существует и работает на уровне SQLite ===');
  // ОГРАНИЧЕНИЕ: better-sqlite3 синхронен, поэтому реальную гонку pre-check↔INSERT
  // внутри одного процесса не воспроизвести. Этот тест проверяет ТОЛЬКО что
  // partial UNIQUE индекс (`idx_customer_blocks_one_active`) реально отклоняет
  // прямые дубли — это «защитная сетка» для catch-ветки в insertCustomerBlock
  // (customer-blocks.js), которую сам код тестом сейчас не покрывает.
  // Test 4 выше покрывает основную ветку (pre-check внутри tx).
  db.prepare(
    `INSERT INTO customer_blocks (id, customer_id, active) VALUES ('block_carol_1', 'cust_carol', 1)`,
  ).run();
  let raceErr = null;
  try {
    db.prepare(
      `INSERT INTO customer_blocks (id, customer_id, active) VALUES ('block_carol_dup', 'cust_carol', 1)`,
    ).run();
  } catch (e) {
    raceErr = e;
  }
  assertTrue(raceErr, 'UNIQUE индекс отклоняет прямой дубль (защитная сетка для race-catch)');
  assertTrue(
    raceErr?.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE/i.test(raceErr?.message || ''),
    'ошибка от SQLITE_CONSTRAINT_UNIQUE (тот же код, что ловит наш catch)',
  );
  // Прибираемся для следующих тестов
  db.prepare(`DELETE FROM customer_blocks WHERE customer_id = 'cust_carol'`).run();

  console.log('\n=== Test 5: unblockCustomerBlock — аудит-поля заполнены ===');
  const u1 = unblockCustomerBlock(r1.block.id, {
    unblocked_by: 'admin',
    unblock_reason: 'apology',
  });
  assertTrue(u1, 'возвращена обновлённая запись');
  assertEq(u1.active, 0, 'active = 0');
  assertEq(u1.unblocked_by, 'admin', 'unblocked_by сохранён');
  assertEq(u1.unblock_reason, 'apology', 'unblock_reason сохранён');
  assertTrue(u1.unblocked_at, 'unblocked_at заполнен');
  assertEq(getActiveBlockForCustomerId('cust_alice'), null, 'getActive больше не возвращает');

  console.log('\n=== Test 6: computeBlockUntil ===');
  assertEq(computeBlockUntil({ unit: 'forever' }), null, 'forever → null');
  assertEq(computeBlockUntil({}), null, 'undefined unit → null (default forever)');
  const min10 = computeBlockUntil({ unit: 'minutes', value: 10 });
  assertTrue(min10 && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(min10), 'minutes → SQLite UTC формат');
  let invalidErr = null;
  try { computeBlockUntil({ unit: 'minutes', value: 0 }); } catch (e) { invalidErr = e; }
  assertEq(invalidErr?.message, 'invalid_block_value', 'value=0 → invalid_block_value');
  let badUnitErr = null;
  try { computeBlockUntil({ unit: 'years', value: 1 }); } catch (e) { badUnitErr = e; }
  assertEq(badUnitErr?.message, 'invalid_block_unit', 'неизвестный unit → invalid_block_unit');

  console.log('\n=== Test 7: activatePendingBansForCustomer — конвертирует pending в active с правильным id ===');
  // Создаём pending для нового клиента, потом регистрируем клиента
  createBlock({
    telegram_username: 'pre_banned',
    block_until: null,
    reason: 'pre-ban',
    blocked_by: 'admin',
  });
  const pendingBefore = getPendingBanForUsername('pre_banned');
  assertTrue(pendingBefore, 'pending создан');

  makeCustomer({ id: 'cust_prebanned', telegram_id: '999', telegram_username: 'pre_banned' });
  const activated = activatePendingBansForCustomer({
    id: 'cust_prebanned',
    telegram_username: 'pre_banned',
  });
  assertEq(activated, 1, 'activated = 1');
  const activeAfter = getActiveBlockForCustomerId('cust_prebanned');
  assertTrue(activeAfter, 'active блок создан');
  assertTrue(activeAfter.id, 'active.id НЕ NULL (регрессионная защита C1)');
  assertTrue(activeAfter.id.startsWith('block_'), 'id с правильным префиксом');
  assertEq(activeAfter.reason, 'pre-ban', 'reason перенесён');
  assertEq(activeAfter.blocked_by, 'admin', 'blocked_by перенесён');
  assertEq(getPendingBanForUsername('pre_banned'), null, 'pending удалён после активации');

  console.log('\n=== Test 8: pending НЕ удаляется при уже существующем active (C3) ===');
  // У cust_bob уже есть active с шага 2. Создаём pending по username 'bob'
  // (хотя customer уже есть — но представим что админ ввёл pre-ban не зная).
  // createBlock(@bob) НЕ создаст pending (customer найден), а попытается active → already_blocked.
  // Поэтому INSERT pending напрямую для теста сценария.
  db.prepare(
    `INSERT INTO pending_customer_bans (telegram_username, block_until, reason, created_by)
     VALUES ('bob', NULL, 'duplicate', 'admin2')`,
  ).run();
  assertTrue(getPendingBanForUsername('bob'), 'pending для bob создан вручную');

  const activatedAgain = activatePendingBansForCustomer({
    id: 'cust_bob',
    telegram_username: 'bob',
  });
  assertEq(activatedAgain, 0, 'не активирован (уже есть active)');
  // C3 fix: pending должен ОСТАТЬСЯ для аудита
  assertTrue(getPendingBanForUsername('bob'), 'pending НЕ удалён (C3 защита аудита)');

  console.log('\n=== Test 9: истёкший блок не возвращается getActive* ===');
  // Создаём блок в прошлом (block_until = вчера)
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, '');
  // Прямой INSERT с обходом UNIQUE (alice сейчас без active после Test 5)
  db.prepare(
    `INSERT INTO customer_blocks (id, customer_id, block_until, reason, active)
     VALUES ('expired_block_xx', 'cust_alice', ?, 'old', 1)`,
  ).run(yesterday);
  assertEq(
    getActiveBlockForCustomerId('cust_alice'),
    null,
    'истёкший блок не возвращается',
  );
  assertEq(
    getActiveBlockForTelegramId('111'),
    null,
    'getActiveByTelegramId тоже не возвращает',
  );

  console.log('\n=== Test 10: pending lookup case-insensitive ===');
  createBlock({
    telegram_username: 'CaseTest',
    block_until: null,
    reason: 'case',
  });
  const lower = getPendingBanForUsername('casetest');
  const upper = getPendingBanForUsername('CASETEST');
  const withAt = getPendingBanForUsername('@CaseTest');
  assertTrue(lower, 'найден по lowercase');
  assertTrue(upper, 'найден по UPPERCASE');
  assertTrue(withAt, 'найден с @');

  console.log('\n=== Test 11: normalizeUsername ===');
  assertEq(normalizeUsername('@Alice'), 'alice', 'обрезает @ + lowercase');
  assertEq(normalizeUsername('  @@bob  '), 'bob', 'trim + multiple @');
  assertEq(normalizeUsername(''), null, 'empty → null');
  assertEq(normalizeUsername(null), null, 'null → null');

  // Test 12: повторный createBlock после истёкшего блока должен ПРОХОДИТЬ.
  // Pavel 11.05.2026: «блок снялся (срок прошёл), но повторно заблокать
  // нельзя — пишет старый не снят». Причина — partial UNIQUE индекс
  // idx_customer_blocks_one_active работал по `active=1` без учёта
  // block_until, и истёкший блок занимал «слот». Фикс: insertCustomerBlock
  // ДО pre-check атомарно гасит истёкшие (active=0) этого клиента.
  console.log('\n=== Test 12: повторный createBlock после истёкшего → проходит ===');
  // Создаём клиента и истёкший активный блок
  makeCustomer({ id: 'cust_charlie', telegram_id: '7777', telegram_username: 'charlie' });
  const past = new Date(Date.now() - 60_000) // минуту назад
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, '');
  db.prepare(
    `INSERT INTO customer_blocks (id, customer_id, block_until, reason, active)
     VALUES ('expired_old_charlie', 'cust_charlie', ?, 'expired one', 1)`,
  ).run(past);
  // Новая блокировка на 1 час
  const newBlockUntil = computeBlockUntil({ unit: 'hours', value: 1 });
  let newBlock;
  try {
    newBlock = createBlock({
      customer_id: 'cust_charlie',
      block_until: newBlockUntil,
      reason: 'fresh',
    });
  } catch (err) {
    assertEq(err.message, 'NO_ERROR_SHOULD_OCCUR', `повторный createBlock упал: ${err.message}`);
    throw err;
  }
  assertEq(newBlock.kind, 'active', 'новый блок создан как active');
  // Старый истёкший должен быть помечен active=0 системой
  const oldRow = db
    .prepare(`SELECT active, unblocked_by, unblock_reason FROM customer_blocks WHERE id = 'expired_old_charlie'`)
    .get();
  assertEq(oldRow.active, 0, 'истёкший блок помечен active=0 автоматически');
  assertEq(oldRow.unblocked_by, 'system', 'unblocked_by=system');
  assertEq(oldRow.unblock_reason, 'auto-expired', 'unblock_reason=auto-expired');
  // Текущий активный блок — это новый
  const activeNow = getActiveBlockForCustomerId('cust_charlie');
  assertEq(activeNow?.reason, 'fresh', 'getActive теперь возвращает новый блок');
}

function cleanup() {
  db.close();
  try { fs.unlinkSync(TMP_DB); } catch {}
  try { fs.unlinkSync(TMP_DB + '-shm'); } catch {}
  try { fs.unlinkSync(TMP_DB + '-wal'); } catch {}
}

try {
  runTests();
  console.log(`\n=== Results: ${results.passed} passed, ${results.failed} failed ===`);
  cleanup();
  process.exit(results.failed > 0 ? 1 : 0);
} catch (err) {
  console.error(err);
  cleanup();
  process.exit(1);
}
