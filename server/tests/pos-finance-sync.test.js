import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navalivay-pos-finance-'));
const tempDbPath = path.join(tempDir, 'test.db');

process.env.DATABASE_FILE = tempDbPath;
process.env.BOT_TOKEN = '';

const { initDb, db } = await import('../db.js');
const { issueToken } = await import('../auth.js');
const { posRouter } = await import('../routes/pos.js');
const { crmFinanceRouter } = await import('../routes/crm-finance.js');

initDb();

const app = express();
app.use(express.json());
app.use(posRouter);
app.use(crmFinanceRouter);

const server = await new Promise((resolve) => {
  const instance = app.listen(0, () => resolve(instance));
});

const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;
const authToken = issueToken('test-admin');

function authHeaders() {
  return {
    Authorization: `Bearer ${authToken}`,
    'Content-Type': 'application/json',
  };
}

async function requestJson(url, options = {}) {
  const response = await fetch(`${baseUrl}${url}`, options);
  const data = await response.json().catch(() => null);
  return { response, data };
}

function getDefaultAccount() {
  return db.prepare(`SELECT * FROM cash_accounts WHERE id = 'acc_default'`).get();
}

function getSaleById(id) {
  return db.prepare(`SELECT * FROM pos_sales WHERE id = ?`).get(id);
}

function getTransactionById(id) {
  return db.prepare(`SELECT * FROM cash_transactions WHERE id = ?`).get(id);
}

async function testPendingToCompletedSync() {
  const created = await requestJson('/api/admin/pos/sales', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      product_name: 'iceburn siberian',
      price: 20,
    }),
  });

  assert.equal(created.response.status, 200);
  assert.equal(created.data.status, 'pending');
  assert.equal(getDefaultAccount().balance, 0);

  const completed = await requestJson(`/api/admin/pos/sales/${created.data.id}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({
      cost_price: 11.3,
    }),
  });

  assert.equal(completed.response.status, 200);
  assert.equal(completed.data.status, 'completed');
  assert.ok(completed.data.transaction_id);

  let sale = getSaleById(created.data.id);
  let transaction = getTransactionById(sale.transaction_id);

  assert.equal(transaction.amount, 20);
  assert.equal(transaction.type, 'income');
  assert.equal(transaction.description, `Продажа касса #${sale.sale_number}: ${sale.product_name}`);
  assert.equal(getDefaultAccount().balance, 20);

  const updated = await requestJson(`/api/admin/pos/sales/${created.data.id}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({
      price: 25,
      product_name: 'iceburn black',
    }),
  });

  assert.equal(updated.response.status, 200);

  sale = getSaleById(created.data.id);
  transaction = getTransactionById(sale.transaction_id);

  assert.equal(transaction.amount, 25);
  assert.equal(transaction.description, `Продажа касса #${sale.sale_number}: ${sale.product_name}`);
  assert.equal(getDefaultAccount().balance, 25);

  const financeList = await requestJson('/api/admin/crm/cash-transactions?limit=10', {
    method: 'GET',
    headers: authHeaders(),
  });

  assert.equal(financeList.response.status, 200);
  assert.equal(financeList.data[0].pos_sale_id, sale.id);
  assert.equal(financeList.data[0].pos_sale_number, sale.sale_number);

  const forbiddenEdit = await requestJson(`/api/admin/crm/cash-transactions/${sale.transaction_id}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({
      amount: 99,
    }),
  });

  assert.equal(forbiddenEdit.response.status, 409);
  assert.equal(forbiddenEdit.data.error, 'linked_pos_sale');

  const deleted = await requestJson(`/api/admin/pos/sales/${created.data.id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });

  assert.equal(deleted.response.status, 200);
  assert.equal(getSaleById(created.data.id), undefined);
  assert.equal(getTransactionById(sale.transaction_id), undefined);
  assert.equal(getDefaultAccount().balance, 0);
}

async function main() {
  await testPendingToCompletedSync();
  console.log('[pos-finance-sync] OK');
}

try {
  await main();
} finally {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
