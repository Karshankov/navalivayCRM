/**
 * Счета и кассы: удаление счёта.
 *
 * Главное, что здесь проверяется: счёт с транзакциями удаляется, а сами
 * транзакции остаются. Раньше ручка отвечала 409 has_transactions и советовала
 * «сначала удалите все транзакции», хотя транзакции заказов и продаж через
 * кассу удалить нельзя вовсе — счёт залипал в CRM навсегда.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navalivay-cash-accounts-'));
process.env.DATABASE_FILE = path.join(tempDir, 'test.db');
process.env.BOT_TOKEN = '';

const { initDb, db } = await import('../db.js');
const { issueToken } = await import('../auth.js');
const { crmFinanceRouter } = await import('../routes/crm-finance.js');
const { crmOperationsRouter } = await import('../routes/crm-operations.js');

initDb();

const app = express();
app.use(express.json());
app.use(crmFinanceRouter);
app.use(crmOperationsRouter);

const server = await new Promise((resolve) => {
  const instance = app.listen(0, () => resolve(instance));
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const authToken = issueToken('test-admin');

function authHeaders() {
  return { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' };
}

async function requestJson(url, options = {}) {
  const response = await fetch(`${baseUrl}${url}`, { headers: authHeaders(), ...options });
  const data = await response.json().catch(() => null);
  return { response, data };
}

async function createAccount(name, extra = {}) {
  const { response, data } = await requestJson('/api/admin/crm/cash-accounts', {
    method: 'POST',
    body: JSON.stringify({ name, ...extra }),
  });
  assert.equal(response.status, 200, `не создался счёт ${name}`);
  return data;
}

function accountRow(id) {
  return db.prepare('SELECT * FROM cash_accounts WHERE id = ?').get(id);
}

function countTransactions(accountId) {
  return db
    .prepare('SELECT COUNT(*) AS n FROM cash_transactions WHERE account_id = ?')
    .get(accountId).n;
}

let orderSeq = 0;
function insertPaidOrder({ accountId = null, transactionId = null } = {}) {
  orderSeq += 1;
  const orderId = `ord_test_${orderSeq}`;
  db.prepare(
    'INSERT INTO orders (id, order_number, payment_account_id) VALUES (?, ?, ?)',
  ).run(orderId, 9000 + orderSeq, accountId);
  if (transactionId) {
    db.prepare(
      `INSERT INTO cash_transactions (id, account_id, type, amount, description, order_id)
       VALUES (?, ?, 'income', 45, 'Оплата заказа (наличные)', ?)`,
    ).run(transactionId, accountId, orderId);
  }
  return orderId;
}

// Счёт, на котором висит транзакция заказа, обязан удаляться: такую транзакцию
// не убрать ни ручкой (409 linked_order), ни из интерфейса.
async function testDeleteAccountWithOrderTransaction() {
  const account = await createAccount('Акциз');
  insertPaidOrder({ accountId: account.id, transactionId: 'trans_excise_1' });
  assert.equal(countTransactions(account.id), 1);

  const { response } = await requestJson(`/api/admin/crm/cash-accounts/${account.id}`, {
    method: 'DELETE',
  });
  assert.equal(response.status, 200, 'счёт с транзакцией не удалился');

  const list = await requestJson('/api/admin/crm/cash-accounts');
  assert.ok(
    !list.data.some((item) => item.id === account.id),
    'удалённый счёт всё ещё в списке',
  );

  assert.equal(countTransactions(account.id), 1, 'транзакции счёта пропали вместе со счётом');

  // Обещание в окне подтверждения: «транзакции останутся в журнале».
  const journal = await requestJson('/api/admin/crm/cash-transactions');
  const kept = journal.data.find((item) => item.id === 'trans_excise_1');
  assert.ok(kept, 'транзакция скрытого счёта пропала из журнала');
  assert.equal(kept.account_name, 'Акциз', 'у транзакции потерялось название счёта');
  assert.equal(accountRow(account.id).active, 0, 'счёт не помечен скрытым');

  return account.id;
}

// Жёсткое DELETE такого счёта падало бы на внешнем ключе orders.payment_account_id
// (NO ACTION) и отдавало 500 без внятной причины.
async function testDeleteAccountReferencedByOrder() {
  const account = await createAccount('Зевс');
  insertPaidOrder({ accountId: account.id });

  const { response, data } = await requestJson(
    `/api/admin/crm/cash-accounts/${account.id}`,
    { method: 'DELETE' },
  );
  assert.equal(response.status, 200, `счёт из оплаченного заказа не удалился: ${JSON.stringify(data)}`);
  assert.equal(accountRow(account.id).active, 0);
}

// Касса по умолчанию должна остаться ровно одна и живая: приёмка закупки ищет
// счёт именно по is_default и молча не списывает деньги, если не нашла.
async function testDefaultFlagMovesToLivingAccount() {
  const account = await createAccount('Основная', { is_default: true });
  assert.equal(accountRow(account.id).is_default, 1);

  const { response } = await requestJson(`/api/admin/crm/cash-accounts/${account.id}`, {
    method: 'DELETE',
  });
  assert.equal(response.status, 200);

  assert.equal(accountRow(account.id).is_default, 0, 'у скрытого счёта остался флаг «по умолчанию»');

  const defaults = db
    .prepare('SELECT id FROM cash_accounts WHERE is_default = 1 AND active = 1')
    .all();
  assert.equal(defaults.length, 1, `касс по умолчанию должно быть ровно 1, а их ${defaults.length}`);
  assert.notEqual(defaults[0].id, account.id);
}

// Новые деньги на скрытый счёт не проводятся: иначе они уедут туда, где их
// никто не увидит.
async function testHiddenAccountRejectsNewTransaction(hiddenId) {
  const { response, data } = await requestJson('/api/admin/crm/cash-transactions', {
    method: 'POST',
    body: JSON.stringify({ account_id: hiddenId, type: 'income', amount: 10 }),
  });
  assert.equal(response.status, 404);
  assert.equal(data.error, 'account_not_found');
}

async function testRepeatedDeleteIsOk(hiddenId) {
  const { response } = await requestJson(`/api/admin/crm/cash-accounts/${hiddenId}`, {
    method: 'DELETE',
  });
  assert.equal(response.status, 200, 'повторное удаление должно быть безобидным');
}

async function testLastActiveAccountIsProtected() {
  const active = db.prepare('SELECT id FROM cash_accounts WHERE active = 1').all();
  assert.ok(active.length >= 1);
  const survivor = active[0].id;
  for (const row of active.slice(1)) {
    db.prepare('UPDATE cash_accounts SET active = 0 WHERE id = ?').run(row.id);
  }

  const { response, data } = await requestJson(`/api/admin/crm/cash-accounts/${survivor}`, {
    method: 'DELETE',
  });
  assert.equal(response.status, 409);
  assert.equal(data.error, 'last_account');
  assert.equal(accountRow(survivor).active, 1, 'последний счёт всё-таки скрыли');
}

async function testUnknownAccount() {
  const { response, data } = await requestJson('/api/admin/crm/cash-accounts/acc_missing', {
    method: 'DELETE',
  });
  assert.equal(response.status, 404);
  assert.equal(data.error, 'not_found');
}

// Стартовый остаток обязан попасть в журнал: иначе сумма движений по счёту
// никогда не объяснит его остаток.
async function testOpeningBalanceIsRecorded() {
  const account = await createAccount('Сейф', { balance: 500 });
  assert.equal(accountRow(account.id).balance, 500);

  const rows = db
    .prepare('SELECT type, amount, description FROM cash_transactions WHERE account_id = ?')
    .all(account.id);
  assert.equal(rows.length, 1, 'стартовый остаток не попал в журнал');
  assert.deepEqual(rows[0], { type: 'income', amount: 500, description: 'Начальный остаток' });

  const zero = await createAccount('Без остатка');
  assert.equal(countTransactions(zero.id), 0, 'нулевой остаток не должен заводить транзакцию');
}

async function testCreateAccountValidatesInput() {
  const blankName = await requestJson('/api/admin/crm/cash-accounts', {
    method: 'POST',
    body: JSON.stringify({ name: '   ' }),
  });
  assert.equal(blankName.response.status, 400);
  assert.equal(blankName.data.error, 'name_required');

  const badBalance = await requestJson('/api/admin/crm/cash-accounts', {
    method: 'POST',
    body: JSON.stringify({ name: 'Кривой', balance: 'много' }),
  });
  assert.equal(badBalance.response.status, 400);
  assert.equal(badBalance.data.error, 'invalid_balance');
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM cash_accounts WHERE name = 'Кривой'").get().n,
    0,
    'счёт с нечисловым остатком всё-таки создался',
  );
}

// Явный is_default: false обязан снимать флаг, а не молча возвращать прежний.
async function testDefaultFlagCanBeHandedOver() {
  const first = await createAccount('Первая касса', { is_default: true });
  const second = await createAccount('Вторая касса');
  assert.equal(accountRow(first.id).is_default, 1);

  const { response, data } = await requestJson(`/api/admin/crm/cash-accounts/${first.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_default: false }),
  });
  assert.equal(response.status, 200);
  assert.equal(data.is_default, 0, 'сервер ответил 200, но флаг не снял');
  assert.equal(accountRow(first.id).is_default, 0);

  const defaults = db.prepare('SELECT id FROM cash_accounts WHERE is_default = 1 AND active = 1').all();
  assert.equal(defaults.length, 1, `касс по умолчанию должно быть ровно 1, а их ${defaults.length}`);
  assert.notEqual(defaults[0].id, first.id);
  assert.ok(second.id, 'второй счёт нужен как наследник флага');
}

async function testTransactionListClampsPaging() {
  const garbage = await requestJson('/api/admin/crm/cash-transactions?limit=abc');
  assert.equal(garbage.response.status, 200, 'нечисловой limit уронил запрос');
  assert.ok(Array.isArray(garbage.data));

  const huge = await requestJson('/api/admin/crm/cash-transactions?limit=99999999');
  assert.equal(huge.response.status, 200);
  assert.ok(huge.data.length <= 500, `отдано ${huge.data.length} строк вместо не более 500`);

  const negative = await requestJson('/api/admin/crm/cash-transactions?offset=-5');
  assert.equal(negative.response.status, 200);
}

// Приёмка закупки без кассы по умолчанию обязана останавливаться, а не
// принимать товар молча и без списания денег.
async function testProcurementNeedsCashAccount() {
  const categoryId = db.prepare('SELECT id FROM categories LIMIT 1').get().id;
  db.prepare(
    `INSERT INTO products (id, categoryId, title, priceRub, createdAt)
     VALUES ('prod_cash_guard', ?, 'Товар для проверки кассы', 10, DATETIME('now'))`,
  ).run(categoryId);
  db.prepare(
    `INSERT INTO procurements (id, procurement_number, total_amount, status)
     VALUES ('proc_cash_guard', 9901, 100, 'draft')`,
  ).run();
  db.prepare(
    `INSERT INTO procurement_items (id, procurement_id, product_id, quantity, cost_per_unit, total_cost)
     VALUES ('procitem_cash_guard', 'proc_cash_guard', 'prod_cash_guard', 2, 50, 100)`,
  ).run();

  const stockBefore = db.prepare("SELECT stock FROM products WHERE id = 'prod_cash_guard'").get().stock;
  db.prepare('UPDATE cash_accounts SET is_default = 0').run();

  const { response, data } = await requestJson(
    '/api/admin/crm/procurements/proc_cash_guard/complete',
    { method: 'POST' },
  );
  assert.equal(response.status, 409, `приёмка прошла без кассы: ${JSON.stringify(data)}`);
  assert.equal(data.error, 'cash_account_required');
  assert.equal(
    db.prepare("SELECT status FROM procurements WHERE id = 'proc_cash_guard'").get().status,
    'draft',
    'закупка принялась, хотя деньги не списаны',
  );
  assert.equal(
    db.prepare("SELECT stock FROM products WHERE id = 'prod_cash_guard'").get().stock,
    stockBefore,
    'товар пришёл на склад без списания денег',
  );
}

try {
  const hiddenId = await testDeleteAccountWithOrderTransaction();
  await testDeleteAccountReferencedByOrder();
  await testDefaultFlagMovesToLivingAccount();
  await testHiddenAccountRejectsNewTransaction(hiddenId);
  await testRepeatedDeleteIsOk(hiddenId);
  await testUnknownAccount();
  await testOpeningBalanceIsRecorded();
  await testCreateAccountValidatesInput();
  await testDefaultFlagCanBeHandedOver();
  await testTransactionListClampsPaging();
  await testLastActiveAccountIsProtected();
  await testProcurementNeedsCashAccount();
  console.log('cash-accounts tests passed');
} finally {
  server.close();
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
