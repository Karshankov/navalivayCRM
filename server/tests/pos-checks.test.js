import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navalivay-pos-checks-'));
const tempDbPath = path.join(tempDir, 'test.db');

process.env.DATABASE_FILE = tempDbPath;
process.env.BOT_TOKEN = '';
// Свой конфиг админа с известным паролем: тест не должен зависеть от
// настоящего пароля на машине разработчика (и тем более проде).
const adminConfigPath = path.join(tempDir, 'admin.json');
fs.writeFileSync(
  adminConfigPath,
  JSON.stringify({ username: 'admin', passwordHash: 'PLAIN:pos-test-key' }),
);
process.env.ADMIN_CONFIG = adminConfigPath;

const { initDb, db } = await import('../db.js');
const { issueToken, authMiddleware } = await import('../auth.js');
const { posRouter, savePosPublication } = await import('../routes/pos.js');

initDb();

const app = express();
app.use(express.json());
app.use(posRouter);

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

function createCategory(name = 'Расходники') {
  seedCounter += 1;
  const id = `c_test_${seedCounter}`;
  db.prepare(`
    INSERT INTO categories (id, slug, name, [order], hide_empty)
    VALUES (?, ?, ?, 1, 0)
  `).run(id, `${id}-slug`, `${name} ${seedCounter}`);
  return id;
}

function createGroup(categoryId, name = 'HUSKY') {
  seedCounter += 1;
  const id = `cg_test_${seedCounter}`;
  db.prepare(`
    INSERT INTO category_groups (id, categoryId, slug, name, [order])
    VALUES (?, ?, ?, ?, 1)
  `).run(id, categoryId, `${id}-slug`, `${name} ${seedCounter}`);
  return id;
}

function createProduct({ categoryId, groupId = null, title, price, costPrice, stock, hasVariants = 0 }) {
  seedCounter += 1;
  const id = `p_test_${seedCounter}`;
  db.prepare(`
    INSERT INTO products (
      id, categoryId, groupId, title, priceRub, cost_price, stock, has_variants, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(id, categoryId, groupId, title, price, costPrice, stock, hasVariants ? 1 : 0);
  return id;
}

function createVariant({ productId, name, price, stock }) {
  seedCounter += 1;
  const id = `v_test_${seedCounter}`;
  db.prepare(`
    INSERT INTO product_variants (id, product_id, name, price_rub, stock, position)
    VALUES (?, ?, ?, ?, ?, 0)
  `).run(id, productId, name, price, stock);
  return id;
}

function publishGroup(groupId, { fixed_price = null, markup_amount = null, markup_percent = null } = {}) {
  db.prepare(`
    INSERT INTO pos_publications (scope, target_id, fixed_price, markup_amount, markup_percent)
    VALUES ('group', ?, ?, ?, ?)
  `).run(groupId, fixed_price, markup_amount, markup_percent);
}

function getProductStock(productId) {
  return db.prepare('SELECT stock FROM products WHERE id = ?').get(productId)?.stock;
}

function getVariantStock(variantId) {
  return db.prepare('SELECT stock FROM product_variants WHERE id = ?').get(variantId)?.stock;
}

function getPosProduct(id) {
  return db.prepare('SELECT * FROM pos_products WHERE id = ?').get(id);
}

function getSale(id) {
  return db.prepare('SELECT * FROM pos_sales WHERE id = ?').get(id);
}

function getSaleItems(saleId) {
  return db.prepare('SELECT * FROM pos_sale_items WHERE sale_id = ? ORDER BY rowid').all(saleId);
}

function todayBusinessDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Minsk',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function setDailyLimitOverride(amountMinor) {
  db.prepare(`
    INSERT INTO card_payment_day_adjustments (business_date, limit_override_minor)
    VALUES (?, ?)
    ON CONFLICT(business_date) DO UPDATE SET limit_override_minor = excluded.limit_override_minor
  `).run(todayBusinessDate(), amountMinor);
}

function salesCount() {
  return db.prepare('SELECT COUNT(*) AS total FROM pos_sales').get().total;
}

function getDefaultAccount() {
  return db.prepare(`SELECT * FROM cash_accounts WHERE id = 'acc_default'`).get();
}

function setMonthlyCardLimit(amountMinor) {
  const month = new Date().toISOString().slice(0, 7);
  db.prepare(`
    INSERT INTO card_payment_months (month_key, limit_minor)
    VALUES (?, ?)
    ON CONFLICT(month_key) DO UPDATE SET limit_minor = excluded.limit_minor
  `).run(month, amountMinor);
}

async function createCustomProduct(payload) {
  const created = await requestJson('/api/admin/pos/products', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  assert.equal(created.response.status, 200, JSON.stringify(created.data));
  return created.data;
}

// ------------------------------------------------------------------- тесты

async function testCheckWithCatalogAndCustomProduct() {
  const categoryId = createCategory('Акцизный товар');
  const groupId = createGroup(categoryId);
  const productId = createProduct({
    categoryId,
    groupId,
    title: 'Жидкость HUSKY',
    price: 16,
    costPrice: 8,
    stock: 10,
  });
  publishGroup(groupId, { fixed_price: 35 });

  const custom = await createCustomProduct({
    title: 'Одноразка PPWJ 2000',
    cost_price: 5,
    retail_price: 10,
    quantity: 5,
  });

  const check = await requestJson('/api/admin/pos/sales/check', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      confirmation_code: '5599',
      payment_method: 'cash',
      items: [
        { source: 'catalog', product_id: productId, quantity: 2 },
        { source: 'custom', pos_product_id: custom.id, quantity: 1 },
      ],
    }),
  });

  assert.equal(check.response.status, 200, JSON.stringify(check.data));

  // 35 * 2 + 10 = 80. Себестоимость 8 * 2 + 5 = 21. Прибыль 59.
  assert.equal(check.data.price, 80);
  assert.equal(check.data.cost_price, 21);
  assert.equal(check.data.profit, 59);
  assert.equal(check.data.payment_method, 'cash');
  assert.equal(check.data.stock_deducted, 1);
  assert.equal(check.data.items.length, 2);

  // Остатки списаны в обоих контурах.
  assert.equal(getProductStock(productId), 8);
  assert.equal(getPosProduct(custom.id).quantity, 4);

  // Наличные ушли в кассу магазина.
  assert.equal(getDefaultAccount().balance, 80);
  assert.ok(check.data.transaction_id);
}

async function testConfirmationCodeIsEnforced() {
  const categoryId = createCategory('Код подтверждения');
  const groupId = createGroup(categoryId);
  const productId = createProduct({
    categoryId,
    groupId,
    title: 'Жидкость под кодом',
    price: 16,
    costPrice: 8,
    stock: 10,
  });
  publishGroup(groupId, { fixed_price: 35 });

  // Перед тестом фиксируем точку отсчёта: чеки от предыдущих тестов уже есть.
  const salesBefore = salesCount();
  const balanceBefore = getDefaultAccount().balance;

  // Без кода чек не проводится, остатки не трогаются.
  const noCode = await requestJson('/api/admin/pos/sales/check', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      items: [{ source: 'catalog', product_id: productId, quantity: 1 }],
    }),
  });
  assert.equal(noCode.response.status, 403);
  assert.equal(noCode.data.error, 'confirmation_code_required');
  assert.equal(getProductStock(productId), 10);
  assert.equal(salesCount(), salesBefore);

  // Неверный код — то же самое.
  const badCode = await requestJson('/api/admin/pos/sales/check', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      confirmation_code: '0000',
      items: [{ source: 'catalog', product_id: productId, quantity: 1 }],
    }),
  });
  assert.equal(badCode.response.status, 403);
  assert.equal(badCode.data.error, 'confirmation_code_required');
  assert.equal(salesCount(), salesBefore);

  // Верный код — чек проходит, списание и деньги на месте.
  const ok = await requestJson('/api/admin/pos/sales/check', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      confirmation_code: '5599',
      items: [{ source: 'catalog', product_id: productId, quantity: 1 }],
    }),
  });
  assert.equal(ok.response.status, 200, JSON.stringify(ok.data));
  assert.equal(salesCount(), salesBefore + 1);
  assert.equal(getProductStock(productId), 9);
  assert.equal(getDefaultAccount().balance, balanceBefore + 35);
}

async function testCustomProductWithoutPublicationIsRejected() {
  const categoryId = createCategory('Неопубликованная');
  const productId = createProduct({
    categoryId,
    title: 'Товар не на кассу',
    price: 10,
    costPrice: 5,
    stock: 5,
  });

  const check = await requestJson('/api/admin/pos/sales/check', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      confirmation_code: '5599',
      items: [{ source: 'catalog', product_id: productId, quantity: 1 }],
    }),
  });

  assert.equal(check.response.status, 409);
  assert.equal(check.data.error, 'catalog_item_not_published');
  assert.equal(getProductStock(productId), 5);
}

async function testVariantPriceUsesPublicationAndDeductsVariantStock() {
  const categoryId = createCategory('Жидкости');
  const groupId = createGroup(categoryId, 'HUSKY LIT');
  const productId = createProduct({
    categoryId,
    groupId,
    title: 'HUSKY LIT',
    price: 16,
    costPrice: 6,
    stock: 0,
    hasVariants: 1,
  });
  const variantId = createVariant({ productId, name: 'Малина', price: 16, stock: 4 });
  publishGroup(groupId, { markup_amount: 5 });

  const check = await requestJson('/api/admin/pos/sales/check', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      confirmation_code: '5599',
      items: [{ source: 'catalog', variant_id: variantId, quantity: 2 }],
    }),
  });

  assert.equal(check.response.status, 200, JSON.stringify(check.data));
  assert.equal(check.data.price, 42); // (16 + 5) * 2
  assert.equal(getVariantStock(variantId), 2);
}

async function testInsufficientStockRollsBackEverything() {
  const categoryId = createCategory('Остатки');
  const groupId = createGroup(categoryId);
  const productId = createProduct({
    categoryId,
    groupId,
    title: 'Мало на складе',
    price: 20,
    costPrice: 10,
    stock: 1,
  });
  publishGroup(groupId, {});

  const salesCountBefore = salesCount();
  const check = await requestJson('/api/admin/pos/sales/check', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      confirmation_code: '5599',
      items: [{ source: 'catalog', product_id: productId, quantity: 5 }],
    }),
  });

  assert.equal(check.response.status, 409);
  assert.equal(check.data.error, 'insufficient_stock');
  // Ничего не списалось и чек не создан.
  assert.equal(getProductStock(productId), 1);
  assert.equal(salesCount(), salesCountBefore);
}

async function testSecondLineShortageUndoesFirstLine() {
  const categoryId = createCategory('Частичный отказ');
  const groupId = createGroup(categoryId);
  const plenty = createProduct({
    categoryId,
    groupId,
    title: 'Есть на складе',
    price: 10,
    costPrice: 5,
    stock: 10,
  });
  publishGroup(groupId, {});

  const customA = await createCustomProduct({
    title: 'Своих хватает',
    cost_price: 2,
    retail_price: 8,
    quantity: 5,
  });
  const customB = await createCustomProduct({
    title: 'Своих не хватает',
    cost_price: 2,
    retail_price: 8,
    quantity: 1,
  });

  const check = await requestJson('/api/admin/pos/sales/check', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      confirmation_code: '5599',
      items: [
        { source: 'catalog', product_id: plenty, quantity: 1 },
        { source: 'custom', pos_product_id: customA.id, quantity: 1 },
        { source: 'custom', pos_product_id: customB.id, quantity: 3 },
      ],
    }),
  });

  assert.equal(check.response.status, 409);
  // Первая и вторая позиции не должны остаться списанными.
  assert.equal(getProductStock(plenty), 10);
  assert.equal(getPosProduct(customA.id).quantity, 5);
  assert.equal(getPosProduct(customB.id).quantity, 1);
}

async function testCheckDiscountAndLineDiscount() {
  const categoryId = createCategory('Скидки');
  const groupId = createGroup(categoryId);
  const productId = createProduct({
    categoryId,
    groupId,
    title: 'Скидочный',
    price: 100,
    costPrice: 40,
    stock: 10,
  });
  publishGroup(groupId, {});

  const check = await requestJson('/api/admin/pos/sales/check', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      confirmation_code: '5599',
      discount_percent: 10,
      items: [
        { source: 'catalog', product_id: productId, quantity: 1, discount_amount: 10 },
      ],
    }),
  });

  assert.equal(check.response.status, 200, JSON.stringify(check.data));
  // 100 - 10 (позиция) = 90, скидка чека 10% = 9, итого 81.
  assert.equal(check.data.price, 81);
  assert.equal(check.data.profit, 41);
  assert.equal(check.data.subtotal, 100);
  assert.equal(check.data.discount_percent, 10);
}

async function testIdempotencyKeyPreventsDoubleCharge() {
  const categoryId = createCategory('Двойной клик');
  const groupId = createGroup(categoryId);
  const productId = createProduct({
    categoryId,
    groupId,
    title: 'Двойной',
    price: 30,
    costPrice: 10,
    stock: 10,
  });
  publishGroup(groupId, {});

  const key = `idem-${Date.now()}`;
  const payload = JSON.stringify({
    confirmation_code: '5599',
    items: [{ source: 'catalog', product_id: productId, quantity: 1 }],
  });

  const first = await requestJson('/api/admin/pos/sales/check', {
    method: 'POST',
    headers: { ...authHeaders(), 'Idempotency-Key': key },
    body: payload,
  });
  const second = await requestJson('/api/admin/pos/sales/check', {
    method: 'POST',
    headers: { ...authHeaders(), 'Idempotency-Key': key },
    body: payload,
  });

  assert.equal(first.response.status, 200);
  assert.equal(second.response.status, 200);
  assert.equal(first.data.id, second.data.id);
  assert.equal(getProductStock(productId), 9);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS total FROM pos_sales WHERE idempotency_key = ?').get(key).total,
    1,
  );
}

async function testCardPaymentConsumesDailyLimit() {
  setMonthlyCardLimit(100000);
  const businessDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Minsk',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  const salesBefore = db.prepare(`
    SELECT COALESCE(SUM(amount_minor), 0) AS spent
    FROM card_payment_operations
    WHERE operation_status = 'spent' AND business_date = ?
  `).get(businessDate).spent;
  const cashBalanceBefore = getDefaultAccount().balance;

  const custom = await createCustomProduct({
    title: 'Картой',
    cost_price: 5,
    retail_price: 25,
    quantity: 5,
  });

  const check = await requestJson('/api/admin/pos/sales/check', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      confirmation_code: '5599',
      payment_method: 'card',
      items: [{ source: 'custom', pos_product_id: custom.id, quantity: 1 }],
    }),
  });

  assert.equal(check.response.status, 200, JSON.stringify(check.data));
  assert.equal(check.data.payment_method, 'card');
  // Карта не увеличивает кассу наличных.
  assert.equal(check.data.transaction_id, null);
  assert.equal(getDefaultAccount().balance, cashBalanceBefore);

  const operation = db.prepare('SELECT * FROM card_payment_operations WHERE pos_sale_id = ?')
    .get(check.data.id);
  assert.ok(operation);
  assert.equal(operation.operation_status, 'spent');
  assert.equal(operation.amount_minor, 2500);
  assert.equal(operation.order_id, null);

  const spentAfter = db.prepare(`
    SELECT COALESCE(SUM(amount_minor), 0) AS spent
    FROM card_payment_operations
    WHERE operation_status = 'spent' AND business_date = ?
  `).get(businessDate).spent;
  assert.equal(spentAfter - salesBefore, 2500);
}

async function testCardOverDailyLimitIsRejected() {
  // Месяц уже почти израсходован: свободного дневного остатка не хватит.
  setMonthlyCardLimit(100000);
  db.prepare(`
    INSERT INTO card_payment_operations (
      id, operation_type, operation_status, amount_minor, business_date
    ) VALUES (?, 'manual', 'spent', ?, ?)
  `).run(
    `card_manual_test_${Date.now()}`,
    99000,
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Minsk',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date()),
  );

  const salesCountBefore = salesCount();
  const custom = await createCustomProduct({
    title: 'Дорогая карта',
    cost_price: 5,
    retail_price: 500,
    quantity: 5,
  });

  const check = await requestJson('/api/admin/pos/sales/check', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      confirmation_code: '5599',
      payment_method: 'card',
      items: [{ source: 'custom', pos_product_id: custom.id, quantity: 1 }],
    }),
  });

  assert.equal(check.response.status, 409);
  assert.equal(check.data.error, 'card_limit_exceeded');
  // Чек не создан, остаток не тронут.
  assert.equal(getPosProduct(custom.id).quantity, 5);
  assert.equal(salesCount(), salesCountBefore);
}

async function testDeleteSaleRestoresStockAndMoney() {
  const categoryId = createCategory('Возврат');
  const groupId = createGroup(categoryId);
  const productId = createProduct({
    categoryId,
    groupId,
    title: 'Возвратный',
    price: 50,
    costPrice: 20,
    stock: 3,
  });
  publishGroup(groupId, {});

  const custom = await createCustomProduct({
    title: 'Возвратный свой',
    cost_price: 5,
    retail_price: 20,
    quantity: 4,
  });

  const balanceBefore = getDefaultAccount().balance;

  const check = await requestJson('/api/admin/pos/sales/check', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      confirmation_code: '5599',
      items: [
        { source: 'catalog', product_id: productId, quantity: 1 },
        { source: 'custom', pos_product_id: custom.id, quantity: 2 },
      ],
    }),
  });
  assert.equal(check.response.status, 200);

  assert.equal(getProductStock(productId), 2);
  assert.equal(getPosProduct(custom.id).quantity, 2);
  assert.equal(getDefaultAccount().balance, balanceBefore + 90);

  const deleted = await requestJson(`/api/admin/pos/sales/${check.data.id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  assert.equal(deleted.response.status, 200);

  assert.equal(getProductStock(productId), 3);
  assert.equal(getPosProduct(custom.id).quantity, 4);
  assert.equal(getDefaultAccount().balance, balanceBefore);
  assert.equal(getSale(check.data.id), undefined);
  assert.equal(getSaleItems(check.data.id).length, 0);
}

async function testDeleteCardSaleReversesCardOperation() {
  // У этого сценария свой запас на день: тест на отказ по лимиту ниже
  // намеренно расходует дневной остаток целиком.
  setDailyLimitOverride(100000);
  const custom = await createCustomProduct({
    title: 'Карта возврат',
    cost_price: 5,
    retail_price: 30,
    quantity: 3,
  });

  const check = await requestJson('/api/admin/pos/sales/check', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      confirmation_code: '5599',
      payment_method: 'card',
      items: [{ source: 'custom', pos_product_id: custom.id, quantity: 1 }],
    }),
  });
  assert.equal(check.response.status, 200, JSON.stringify(check.data));

  const deleted = await requestJson(`/api/admin/pos/sales/${check.data.id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  assert.equal(deleted.response.status, 200);

  const operation = db.prepare('SELECT * FROM card_payment_operations WHERE pos_sale_id = ?')
    .get(check.data.id);
  assert.equal(operation.operation_status, 'reversed');
  assert.ok(operation.reversed_at);
  assert.equal(getPosProduct(custom.id).quantity, 3);
}

async function testEditingCompletedCheckIsForbidden() {
  const custom = await createCustomProduct({
    title: 'Не редактируется',
    cost_price: 5,
    retail_price: 15,
    quantity: 3,
  });

  const check = await requestJson('/api/admin/pos/sales/check', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      confirmation_code: '5599',
      items: [{ source: 'custom', pos_product_id: custom.id, quantity: 1 }],
    }),
  });
  assert.equal(check.response.status, 200);

  const patched = await requestJson(`/api/admin/pos/sales/${check.data.id}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ price: 99 }),
  });

  assert.equal(patched.response.status, 409);
  assert.equal(patched.data.error, 'pos_check_edit_forbidden');
  assert.equal(getSale(check.data.id).price, 15);
}

async function testDeleteCustomProductInUseIsRejected() {
  const custom = await createCustomProduct({
    title: 'Уже продавали',
    cost_price: 5,
    retail_price: 15,
    quantity: 3,
  });

  const check = await requestJson('/api/admin/pos/sales/check', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      confirmation_code: '5599',
      items: [{ source: 'custom', pos_product_id: custom.id, quantity: 1 }],
    }),
  });
  assert.equal(check.response.status, 200);

  const deleted = await requestJson(`/api/admin/pos/products/${custom.id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  assert.equal(deleted.response.status, 409);
  assert.equal(deleted.data.error, 'pos_product_in_use');
  assert.ok(getPosProduct(custom.id));
}

async function testCustomProductQuantityIsAbsolute() {
  const custom = await createCustomProduct({
    title: 'Считаем штуки',
    cost_price: 5,
    retail_price: 15,
    quantity: 5,
  });

  const patched = await requestJson(`/api/admin/pos/products/${custom.id}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ quantity: 10, cost_price: 6 }),
  });

  assert.equal(patched.response.status, 200);
  assert.equal(patched.data.quantity, 10);
  assert.equal(patched.data.cost_price, 6);
}

async function testCustomProductValidation() {
  const badPrice = await requestJson('/api/admin/pos/products', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ title: 'Без цены', retail_price: 0, quantity: 1 }),
  });
  assert.equal(badPrice.response.status, 400);
  assert.equal(badPrice.data.error, 'invalid_retail_price');

  const badQuantity = await requestJson('/api/admin/pos/products', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ title: 'Дробное', retail_price: 10, quantity: 1.5 }),
  });
  assert.equal(badQuantity.response.status, 400);
  assert.equal(badQuantity.data.error, 'invalid_quantity');

  const noTitle = await requestJson('/api/admin/pos/products', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ retail_price: 10, quantity: 1 }),
  });
  assert.equal(noTitle.response.status, 400);
  assert.equal(noTitle.data.error, 'title_required');
}

async function testCatalogOnlyShowsPublishedAndCheapestFirst() {
  const categoryId = createCategory('Каталог кассы');
  const groupId = createGroup(categoryId, 'Опубликованная');
  publishGroup(groupId, { markup_percent: 100 });
  const cheap = createProduct({
    categoryId, groupId, title: 'Дешёвый', price: 3, costPrice: 1, stock: 5,
  });
  const pricey = createProduct({
    categoryId, groupId, title: 'Дорогой', price: 40, costPrice: 10, stock: 5,
  });

  const hiddenCategory = createCategory('Скрытая');
  const hidden = createProduct({
    categoryId: hiddenCategory, title: 'Скрытый', price: 1, costPrice: 1, stock: 5,
  });

  const catalog = await requestJson('/api/admin/pos/catalog?source=catalog', {
    method: 'GET',
    headers: authHeaders(),
  });

  assert.equal(catalog.response.status, 200);
  const ids = catalog.data.items.map((item) => item.id);
  assert.ok(ids.includes(cheap));
  assert.ok(ids.includes(pricey));
  assert.ok(!ids.includes(hidden));
  // Наценка 100% применена к отображению.
  const cheapItem = catalog.data.items.find((item) => item.id === cheap);
  assert.equal(cheapItem.price, 6);
  // Дешёвые выше: расходники ищут первыми.
  assert.ok(ids.indexOf(cheap) < ids.indexOf(pricey));
}

async function testSaleIsCountedInFinancialStats() {
  const { queryCrmFinancialStats } = await import('../utils/crm-financial-stats.js');

  const start = new Date(Date.now() - 60 * 60 * 1000);
  const end = new Date(Date.now() + 60 * 60 * 1000);
  const before = queryCrmFinancialStats(db, { start, end });

  const custom = await createCustomProduct({
    title: 'В статистику',
    cost_price: 4,
    retail_price: 14,
    quantity: 5,
  });

  const check = await requestJson('/api/admin/pos/sales/check', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      confirmation_code: '5599',
      items: [{ source: 'custom', pos_product_id: custom.id, quantity: 1 }],
    }),
  });
  assert.equal(check.response.status, 200);

  const after = queryCrmFinancialStats(db, { start, end });
  assert.equal(after.revenue - before.revenue, 14);
  assert.equal(after.profit - before.profit, 10);
  assert.equal(after.total_sales - before.total_sales, 1);
}

async function testEmptyCheckIsRejected() {
  const empty = await requestJson('/api/admin/pos/sales/check', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ items: [] }),
  });
  assert.equal(empty.response.status, 400);
  assert.equal(empty.data.error, 'items_required');
}

async function testZeroQuantityIsRejected() {
  const custom = await createCustomProduct({
    title: 'Ноль',
    cost_price: 1,
    retail_price: 5,
    quantity: 3,
  });
  const check = await requestJson('/api/admin/pos/sales/check', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      confirmation_code: '5599',
      items: [{ source: 'custom', pos_product_id: custom.id, quantity: 0 }],
    }),
  });
  assert.equal(check.response.status, 400);
  assert.equal(check.data.error, 'invalid_quantity');
}

async function testClientCannotOverrideCatalogPrice() {
  const categoryId = createCategory('Подмена цены');
  const groupId = createGroup(categoryId);
  const productId = createProduct({
    categoryId, groupId, title: 'Правильная цена', price: 50, costPrice: 20, stock: 5,
  });
  publishGroup(groupId, {});

  const check = await requestJson('/api/admin/pos/sales/check', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      confirmation_code: '5599',
      items: [{
        source: 'catalog',
        product_id: productId,
        quantity: 1,
        unit_price: 1,
        unitPrice: 1,
        price: 1,
        cost_price: 0,
      }],
    }),
  });

  assert.equal(check.response.status, 200);
  // Цена и себестоимость берутся из базы, присланные в запросе игнорируются.
  assert.equal(check.data.price, 50);
  assert.equal(check.data.cost_price, 20);
  assert.equal(check.data.profit, 30);
}

async function testPosSessionAuth() {
  // 1) Без сессии кассовые эндпоинты закрыты.
  const noAuth = await requestJson('/api/admin/pos/catalog');
  assert.equal(noAuth.response.status, 401);

  // 2) Неверный ключ сессию не открывает.
  const badKey = await requestJson('/api/admin/pos/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'not-the-admin-password' }),
  });
  assert.equal(badKey.response.status, 401);
  assert.equal(badKey.data?.error, 'unauthorized');

  // 3) Ключ админа открывает кассовую сессию с ролью pos.
  const session = await requestJson('/api/admin/pos/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'pos-test-key' }),
  });
  assert.equal(session.response.status, 200);
  assert.equal(session.data?.ok, true);
  assert.equal(session.data?.role, 'pos');
  assert.ok(session.data?.token);

  // 4) Кассовый токен открывает каталог.
  const catalog = await requestJson('/api/admin/pos/catalog', {
    headers: { Authorization: `Bearer ${session.data.token}` },
  });
  assert.equal(catalog.response.status, 200);

  // 5) Кассовый токен НЕ проходит админскую авторизацию: сессия кассы
  //    не должна давать доступ в CRM. Проверяем сам authMiddleware —
  //    админских роутов в тестовом приложении нет.
  const adminGate = await new Promise((resolve) => {
    const fakeReq = {
      headers: { authorization: `Bearer ${session.data.token}` },
      cookies: {},
      method: 'GET',
      path: '/api/admin/banners',
    };
    const fakeRes = {
      status(code) {
        resolve(`rejected:${code}`);
        return { json() {} };
      },
    };
    authMiddleware(fakeReq, fakeRes, () => resolve('passed'));
    setTimeout(() => resolve('rejected:timeout'), 50);
  });
  assert.equal(adminGate, 'rejected:401');

  // 6) Сессия кассы пишет pos_key_id в проведённый чек.
  const pub = createCategory('Расходники с ключом');
  const group = createGroup(pub, 'Расходники');
  const product = createProduct({
    categoryId: pub,
    groupId: group,
    title: 'Скотч',
    price: 2,
    costPrice: 1,
    stock: 10,
  });
  savePosPublication('group', group, { published: true });
  const check = await requestJson('/api/admin/pos/sales/check', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.data.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      confirmation_code: '5599',
      items: [{ source: 'catalog', product_id: product, quantity: 1 }],
      payment_method: 'cash',
    }),
  });
  assert.equal(check.response.status, 200);
  const stored = db.prepare('SELECT pos_key_id FROM pos_sales WHERE id = ?').get(check.data.id);
  assert.ok(stored?.pos_key_id, 'чек должен запомнить ключ кассовой сессии');
}

async function main() {
  await testCheckWithCatalogAndCustomProduct();
  await testConfirmationCodeIsEnforced();
  await testCustomProductWithoutPublicationIsRejected();
  await testVariantPriceUsesPublicationAndDeductsVariantStock();
  await testInsufficientStockRollsBackEverything();
  await testSecondLineShortageUndoesFirstLine();
  await testCheckDiscountAndLineDiscount();
  await testIdempotencyKeyPreventsDoubleCharge();
  await testCardPaymentConsumesDailyLimit();
  await testDeleteSaleRestoresStockAndMoney();
  await testDeleteCardSaleReversesCardOperation();
  await testCardOverDailyLimitIsRejected();
  await testEditingCompletedCheckIsForbidden();
  await testDeleteCustomProductInUseIsRejected();
  await testCustomProductQuantityIsAbsolute();
  await testCustomProductValidation();
  await testCatalogOnlyShowsPublishedAndCheapestFirst();
  await testSaleIsCountedInFinancialStats();
  await testEmptyCheckIsRejected();
  await testZeroQuantityIsRejected();
  await testClientCannotOverrideCatalogPrice();
  // Тест сессии создаёт свой чек «Скотч» и меняет баланс кассы —
  // поэтому он последний: предыдущие тесты считают баланс с нуля.
  await testPosSessionAuth();
  console.log('[pos-checks] OK');
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