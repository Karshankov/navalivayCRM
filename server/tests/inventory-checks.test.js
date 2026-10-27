import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navalivay-inventory-'));
const tempDbPath = path.join(tempDir, 'test.db');

process.env.DATABASE_FILE = tempDbPath;
process.env.BOT_TOKEN = '';

const { initDb, db } = await import('../db.js');
const { issueToken } = await import('../auth.js');
const { adminRouter } = await import('../routes/admin.js');

initDb();

const app = express();
app.use(express.json());
app.use(adminRouter);

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

// ---------------------------------------------------------------- фикстуры

let seedCounter = 0;

function createCategory(name = 'Жидкости') {
  seedCounter += 1;
  const id = `c_inv_${seedCounter}`;
  db.prepare(`
    INSERT INTO categories (id, slug, name, [order], hide_empty)
    VALUES (?, ?, ?, 1, 0)
  `).run(id, `${id}-slug`, `${name} ${seedCounter}`);
  return id;
}

function createGroup(categoryId, name = 'ANNIMA') {
  seedCounter += 1;
  const id = `cg_inv_${seedCounter}`;
  db.prepare(`
    INSERT INTO category_groups (id, categoryId, slug, name, [order])
    VALUES (?, ?, ?, ?, 1)
  `).run(id, categoryId, `${id}-slug`, `${name} ${seedCounter}`);
  return id;
}

function createProduct({ categoryId, groupId = null, title, stock = 0, warehouseStock = 0, hasVariants = 0, price = 20, costPrice = 10 }) {
  seedCounter += 1;
  const id = `p_inv_${seedCounter}`;
  db.prepare(`
    INSERT INTO products (
      id, categoryId, groupId, title, priceRub, cost_price, stock, warehouse_stock, has_variants, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(id, categoryId, groupId, title, price, costPrice, stock, warehouseStock, hasVariants ? 1 : 0);
  return id;
}

function createVariant({ productId, name, stock = 0, warehouseStock = 0, price = 20 }) {
  seedCounter += 1;
  const id = `v_inv_${seedCounter}`;
  db.prepare(`
    INSERT INTO product_variants (id, product_id, name, price_rub, stock, warehouse_stock, position)
    VALUES (?, ?, ?, ?, ?, ?, 0)
  `).run(id, productId, name, price, stock, warehouseStock);
  return id;
}

function getProductStock(productId) {
  return db.prepare('SELECT stock, warehouse_stock FROM products WHERE id = ?').get(productId);
}

function getVariantStock(variantId) {
  return db.prepare('SELECT stock, warehouse_stock FROM product_variants WHERE id = ?').get(variantId);
}

function countChecks() {
  return db.prepare('SELECT COUNT(*) AS total FROM inventory_checks').get().total;
}

// ------------------------------------------------------------------- тесты

async function testPreviewShowsAllFlavorsIncludingZero() {
  const categoryId = createCategory();
  const groupId = createGroup(categoryId, 'ANNIMA LOVE KILLER');
  const p1 = createProduct({ categoryId, groupId, title: 'Ананас апельсин', stock: 2, warehouseStock: 6 });
  const p2 = createProduct({ categoryId, groupId, title: 'Апельсин вишня', stock: 0, warehouseStock: 3 });
  const p3 = createProduct({ categoryId, groupId, title: 'Вишня скитлс лимон', stock: 3, warehouseStock: 0 });

  const preview = await requestJson(`/api/admin/inventory-checks/preview?group=${groupId}&location=retail`, {
    headers: authHeaders(),
  });

  assert.equal(preview.response.status, 200);
  // Имя содержит порядковый номер фикстуры — проверяем только префикс.
  assert.ok(preview.data.group.name.startsWith('ANNIMA LOVE KILLER'));
  assert.equal(preview.data.items.length, 3);
  // Нулевые вкусы тоже видны: без них пересорт неполный.
  const byTitle = new Map(preview.data.items.map((item) => [item.title, item]));
  assert.equal(byTitle.get('Ананас апельсин').expected, 2);
  assert.equal(byTitle.get('Апельсин вишня').expected, 0);
  assert.equal(byTitle.get('Вишня скитлс лимон').expected, 3);
  assert.equal(preview.data.total_expected, 5);

  // Склад — другой остаток, но тот же состав.
  const previewWarehouse = await requestJson(`/api/admin/inventory-checks/preview?group=${groupId}&location=warehouse`, {
    headers: authHeaders(),
  });
  assert.equal(previewWarehouse.data.items.length, 3);
  const byTitleW = new Map(previewWarehouse.data.items.map((item) => [item.title, item]));
  assert.equal(byTitleW.get('Ананас апельсин').expected, 6);
  assert.equal(previewWarehouse.data.total_expected, 9);
  void p1; void p2; void p3;
}

async function testPreviewExpandsVariants() {
  const categoryId = createCategory();
  const groupId = createGroup(categoryId, 'HERO');
  const productId = createProduct({ categoryId, groupId, title: 'HERO 2 CRYSTAL', hasVariants: 1 });
  const v1 = createVariant({ productId, name: 'Green', stock: 4 });
  const v2 = createVariant({ productId, name: 'Pink', stock: 0 });

  const preview = await requestJson(`/api/admin/inventory-checks/preview?group=${groupId}&location=retail`, {
    headers: authHeaders(),
  });

  assert.equal(preview.response.status, 200);
  // Не товар, а каждая строка-вкус отдельно.
  assert.equal(preview.data.items.length, 2);
  const byVariant = new Map(preview.data.items.map((item) => [item.variant_name, item]));
  assert.equal(byVariant.get('Green').expected, 4);
  assert.equal(byVariant.get('Pink').expected, 0);
  void v1; void v2;
}

async function testCheckCorrectsRetailStockAndWritesJournal() {
  const categoryId = createCategory();
  const groupId = createGroup(categoryId, 'ANNIMA LOVE');
  const p1 = createProduct({ categoryId, groupId, title: 'Мохито с клубникой', stock: 6 });
  const p2 = createProduct({ categoryId, groupId, title: 'Энергетик малина', stock: 5 });
  const p3 = createProduct({ categoryId, groupId, title: 'Клубника банан', stock: 4 });
  const checksBefore = countChecks();

  const check = await requestJson('/api/admin/inventory-checks', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      group_id: groupId,
      location: 'retail',
      items: [
        { product_id: p1, actual: 5 },
        { product_id: p2, actual: 5 },
        { product_id: p3, actual: 7 },
      ],
    }),
  });

  assert.equal(check.response.status, 200, JSON.stringify(check.data));
  // Числится 6+5+4=15, факт 5+5+7=17 → +2.
  assert.equal(check.data.total_before, 15);
  assert.equal(check.data.total_after, 17);
  assert.equal(check.data.diff_total, 2);
  assert.equal(check.data.items.length, 3);

  // Остатки стали фактическими.
  assert.equal(getProductStock(p1).stock, 5);
  assert.equal(getProductStock(p2).stock, 5);
  assert.equal(getProductStock(p3).stock, 7);

  // Журнал записан.
  assert.equal(countChecks(), checksBefore + 1);
  const stored = db.prepare('SELECT * FROM inventory_checks WHERE id = ?').get(check.data.id);
  assert.equal(stored.diff_total, 2);
  assert.equal(stored.counted_count, 3);
  assert.equal(stored.created_by, 'test-admin');

  const storedItems = db.prepare('SELECT * FROM inventory_check_items WHERE check_id = ? ORDER BY rowid').all(check.data.id);
  assert.equal(storedItems.length, 3);
  const byExpected = new Map(storedItems.map((item) => [item.expected_quantity, item]));
  assert.equal(byExpected.get(6).diff, -1);
  assert.equal(byExpected.get(5).diff, 0);
  assert.equal(byExpected.get(4).diff, 3);
}

async function testCheckWarehouseColumn() {
  const categoryId = createCategory();
  const groupId = createGroup(categoryId, 'Складская линейка');
  const p1 = createProduct({ categoryId, groupId, title: 'Виноград алоэ', stock: 3, warehouseStock: 9 });

  const check = await requestJson('/api/admin/inventory-checks', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      group_id: groupId,
      location: 'warehouse',
      items: [{ product_id: p1, actual: 8 }],
    }),
  });

  assert.equal(check.response.status, 200, JSON.stringify(check.data));
  // Розничный остаток не тронут: пересорт шёл по складской колонке.
  const stocks = getProductStock(p1);
  assert.equal(stocks.warehouse_stock, 8);
  assert.equal(stocks.stock, 3);
}

async function testCheckCorrectsVariantStock() {
  const categoryId = createCategory();
  const groupId = createGroup(categoryId, 'Девайсы');
  const productId = createProduct({ categoryId, groupId, title: 'HERO 2 CRYSTAL', hasVariants: 1, stock: 0 });
  const v1 = createVariant({ productId, name: 'Green', stock: 4, warehouseStock: 10 });
  const v2 = createVariant({ productId, name: 'Pink', stock: 2, warehouseStock: 5 });

  const check = await requestJson('/api/admin/inventory-checks', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      group_id: groupId,
      location: 'retail',
      items: [
        { product_id: productId, variant_id: v1, actual: 3 },
        { product_id: productId, variant_id: v2, actual: 2 },
      ],
    }),
  });

  assert.equal(check.response.status, 200, JSON.stringify(check.data));
  assert.equal(getVariantStock(v1).stock, 3);
  assert.equal(getVariantStock(v2).stock, 2);
  // Складские остатки вариантов не тронуты.
  assert.equal(getVariantStock(v1).warehouse_stock, 10);
  assert.equal(getVariantStock(v2).warehouse_stock, 5);
}

async function testEmptyActualSkipsItem() {
  const categoryId = createCategory();
  const groupId = createGroup(categoryId, 'Пропуск');
  const p1 = createProduct({ categoryId, groupId, title: 'Не считал', stock: 6 });
  const p2 = createProduct({ categoryId, groupId, title: 'Считал', stock: 2 });

  const check = await requestJson('/api/admin/inventory-checks', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      group_id: groupId,
      location: 'retail',
      items: [
        { product_id: p1, actual: null },
        { product_id: p2, actual: '' },
      ],
    }),
  });

  // Пустые поля = «не трогаю»: пересорта без единой позиции не бывает.
  assert.equal(check.response.status, 400);
  assert.equal(check.data.error, 'items_required');
  assert.equal(getProductStock(p1).stock, 6);
  assert.equal(getProductStock(p2).stock, 2);
}

async function testSecondCheckCountsFromCorrectedStock() {
  const categoryId = createCategory();
  const groupId = createGroup(categoryId, 'Повторный');
  const p1 = createProduct({ categoryId, groupId, title: 'Вкус', stock: 6 });

  const first = await requestJson('/api/admin/inventory-checks', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ group_id: groupId, location: 'retail', items: [{ product_id: p1, actual: 5 }] }),
  });
  assert.equal(first.response.status, 200);
  assert.equal(first.data.total_before, 6);
  assert.equal(first.data.diff_total, -1);

  // Второй пересорт считает уже от исправленного остатка.
  const second = await requestJson('/api/admin/inventory-checks', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ group_id: groupId, location: 'retail', items: [{ product_id: p1, actual: 5 }] }),
  });
  assert.equal(second.response.status, 200);
  assert.equal(second.data.total_before, 5);
  assert.equal(second.data.diff_total, 0);
  // Номера пересортом растут.
  assert.equal(second.data.check_number, first.data.check_number + 1);
}

async function testStalePreviewIsRecountedAtSave() {
  const categoryId = createCategory();
  const groupId = createGroup(categoryId, 'Против гонки');
  const p1 = createProduct({ categoryId, groupId, title: 'Продали между превью и сохранением', stock: 6 });

  // Менеджер открыл превью (числится 6), потом кто-то продал 1.
  const preview = await requestJson(`/api/admin/inventory-checks/preview?group=${groupId}&location=retail`, {
    headers: authHeaders(),
  });
  assert.equal(preview.data.total_expected, 6);
  db.prepare('UPDATE products SET stock = 5 WHERE id = ?').run(p1);

  const check = await requestJson('/api/admin/inventory-checks', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ group_id: groupId, location: 'retail', items: [{ product_id: p1, actual: 5 }] }),
  });

  // Журнал фиксирует «было 5 → стало 5», а не копию устаревшего превью.
  assert.equal(check.response.status, 200);
  assert.equal(check.data.total_before, 5);
  assert.equal(check.data.diff_total, 0);
}

async function testValidationRejectsBadInput() {
  const categoryId = createCategory();
  const groupId = createGroup(categoryId, 'Валидация');
  const p1 = createProduct({ categoryId, groupId, title: 'Вкус', stock: 6 });

  // Отрицательный факт.
  const negative = await requestJson('/api/admin/inventory-checks', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ group_id: groupId, location: 'retail', items: [{ product_id: p1, actual: -1 }] }),
  });
  assert.equal(negative.response.status, 400);
  assert.equal(negative.data.error, 'invalid_quantity');

  // Дробный факт.
  const fractional = await requestJson('/api/admin/inventory-checks', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ group_id: groupId, location: 'retail', items: [{ product_id: p1, actual: 1.5 }] }),
  });
  assert.equal(fractional.response.status, 400);
  assert.equal(fractional.data.error, 'invalid_quantity');

  // Чужой товар (не из линейки).
  const otherCategory = createCategory();
  const otherGroup = createGroup(otherCategory, 'Другая линейка');
  const outsider = createProduct({ categoryId: otherCategory, groupId: otherGroup, title: 'Чужой', stock: 9 });
  const foreign = await requestJson('/api/admin/inventory-checks', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ group_id: groupId, location: 'retail', items: [{ product_id: outsider, actual: 1 }] }),
  });
  assert.equal(foreign.response.status, 400);
  assert.equal(foreign.data.error, 'item_not_in_group');
  assert.equal(getProductStock(outsider).stock, 9);

  // Без группы / без позиций.
  const noGroup = await requestJson('/api/admin/inventory-checks', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ items: [{ product_id: p1, actual: 1 }] }),
  });
  assert.equal(noGroup.response.status, 400);
  assert.equal(noGroup.data.error, 'group_required');

  const noItems = await requestJson('/api/admin/inventory-checks', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ group_id: groupId, location: 'retail', items: [] }),
  });
  assert.equal(noItems.response.status, 400);
  assert.equal(noItems.data.error, 'items_required');

  // Неизвестная группа.
  const unknownGroup = await requestJson(`/api/admin/inventory-checks/preview?group=cg_no_such&location=retail`, {
    headers: authHeaders(),
  });
  assert.equal(unknownGroup.response.status, 404);
}

async function testTransactionRollsBackOnMidListFailure() {
  const categoryId = createCategory();
  const groupId = createGroup(categoryId, 'Откат');
  const p1 = createProduct({ categoryId, groupId, title: 'Первый', stock: 6 });
  const p2 = createProduct({ categoryId, groupId, title: 'Второй', stock: 7 });
  const checksBefore = countChecks();

  // Вторая позиция — чужой товар: первая уже обновлена внутри транзакции,
  // но откат должен вернуть её остаток и не оставить запись в журнале.
  const otherCategory = createCategory();
  const otherGroup = createGroup(otherCategory, 'Посторонняя');
  const outsider = createProduct({ categoryId: otherCategory, groupId: otherGroup, title: 'Чужой', stock: 1 });

  const failed = await requestJson('/api/admin/inventory-checks', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      group_id: groupId,
      location: 'retail',
      items: [
        { product_id: p1, actual: 2 },
        { product_id: outsider, actual: 5 },
        { product_id: p2, actual: 9 },
      ],
    }),
  });

  assert.equal(failed.response.status, 400);
  assert.equal(failed.data.error, 'item_not_in_group');
  // Остатки не тронуты, журнал не пополнился.
  assert.equal(getProductStock(p1).stock, 6);
  assert.equal(getProductStock(p2).stock, 7);
  assert.equal(getProductStock(outsider).stock, 1);
  assert.equal(countChecks(), checksBefore);
}

async function testHistoryEndpoint() {
  const total = countChecks();
  const history = await requestJson('/api/admin/inventory-checks?limit=10', { headers: authHeaders() });
  assert.equal(history.response.status, 200);
  assert.equal(history.data.total, total);
  assert.ok(history.data.checks.length <= 10);
  // Свежие сверху.
  if (history.data.checks.length >= 2) {
    assert.ok(history.data.checks[0].created_at >= history.data.checks[1].created_at);
  }
}

async function testUnauthorized() {
  const noAuth = await requestJson('/api/admin/inventory-checks');
  assert.equal(noAuth.response.status, 401);

  const noAuthPost = await requestJson('/api/admin/inventory-checks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ group_id: 'x', items: [] }),
  });
  assert.equal(noAuthPost.response.status, 401);
}

async function main() {
  await testPreviewShowsAllFlavorsIncludingZero();
  await testPreviewExpandsVariants();
  await testCheckCorrectsRetailStockAndWritesJournal();
  await testCheckWarehouseColumn();
  await testCheckCorrectsVariantStock();
  await testEmptyActualSkipsItem();
  await testSecondCheckCountsFromCorrectedStock();
  await testStalePreviewIsRecountedAtSave();
  await testValidationRejectsBadInput();
  await testTransactionRollsBackOnMidListFailure();
  await testHistoryEndpoint();
  await testUnauthorized();
  console.log('[inventory-checks] OK');
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