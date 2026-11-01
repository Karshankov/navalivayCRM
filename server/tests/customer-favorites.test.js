/**
 * Customer favorites public route tests.
 * Run: node server/tests/customer-favorites.test.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navalivay-customer-favorites-'));
process.env.DATABASE_FILE = path.join(tempDir, 'test.db');
process.env.BOT_TOKEN = 'test-bot-token';
process.env.NODE_ENV = 'test';

const { initDb, db } = await import('../db.js');
const { publicRouter } = await import('../routes/public.js');

initDb();

const app = express();
app.use(express.json());
app.use(publicRouter);

const server = await new Promise((resolve) => {
  const instance = app.listen(0, () => resolve(instance));
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;

const results = { passed: 0, failed: 0 };

function ok(cond, msg) {
  if (cond) {
    results.passed++;
    console.log(`  OK: ${msg}`);
  } else {
    results.failed++;
    console.log(`  FAIL: ${msg}`);
  }
}

function authHeaders(id = '111', username = 'buyer1') {
  return {
    'Content-Type': 'application/json',
    'x-test-telegram-auth': JSON.stringify({ id, username, first_name: 'Buyer' }),
  };
}

function seedCatalog() {
  db.exec('DELETE FROM customer_favorites;');
  db.exec('DELETE FROM customers WHERE telegram_id IS NOT NULL;');
  db.exec('DELETE FROM product_variants;');
  db.exec('DELETE FROM product_images;');
  db.exec('DELETE FROM products;');
  db.exec('DELETE FROM category_groups;');
  db.exec('DELETE FROM categories;');

  db.prepare(
    `INSERT INTO categories (id, slug, name, [order], hide_empty, storefront_filters_profile)
     VALUES ('cat1', 'cat1', 'Категория', 1, 0, 'none')`,
  ).run();
  // Товар без вариантов, в наличии
  db.prepare(
    `INSERT INTO products (id, categoryId, title, priceRub, description, stock, has_variants, use_category_image, createdAt)
     VALUES ('prod_simple', 'cat1', 'Простой товар', 10, '', 5, 0, 0, DATETIME('now'))`,
  ).run();
  // Товар без вариантов, закончился
  db.prepare(
    `INSERT INTO products (id, categoryId, title, priceRub, description, stock, has_variants, use_category_image, createdAt)
     VALUES ('prod_out', 'cat1', 'Закончившийся товар', 7, '', 0, 0, 0, DATETIME('now'))`,
  ).run();
  // Товар с вариантами (вкусами)
  db.prepare(
    `INSERT INTO products (id, categoryId, title, priceRub, description, stock, has_variants, use_category_image, createdAt)
     VALUES ('prod_var', 'cat1', 'Товар с вкусами', 12, '', 0, 1, 0, DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO product_variants (id, product_id, name, stock, position, created_at)
     VALUES ('var_ok', 'prod_var', 'Клубника', 4, 0, DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO product_variants (id, product_id, name, stock, position, created_at)
     VALUES ('var_out', 'prod_var', 'Манго', 0, 1, DATETIME('now'))`,
  ).run();
}

async function apiCall(method, url, body, headers) {
  const response = await fetch(`${baseUrl}${url}`, {
    method,
    headers: headers ?? authHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, payload: await response.json().catch(() => null) };
}

console.log('\n=== customer favorites ===\n');

console.log('--- F1: авторизация обязательна ---');
{
  seedCatalog();
  const list = await apiCall('GET', '/api/favorites', undefined, { 'Content-Type': 'application/json' });
  ok(list.status === 401, 'GET без auth → 401');
  const add = await apiCall('POST', '/api/favorites', { product_id: 'prod_simple' }, { 'Content-Type': 'application/json' });
  ok(add.status === 401, 'POST без auth → 401');
  const remove = await apiCall('DELETE', '/api/favorites', { product_id: 'prod_simple' }, { 'Content-Type': 'application/json' });
  ok(remove.status === 401, 'DELETE без auth → 401');
}

console.log('--- F2: добавление и список ---');
{
  seedCatalog();
  const add = await apiCall('POST', '/api/favorites', { product_id: 'prod_simple' });
  ok(add.status === 201, 'add simple → 201');
  ok(add.payload.success === true, 'add success');

  // Клиент создаётся автоматически по telegram_id
  const customer = db.prepare('SELECT id FROM customers WHERE telegram_id = ?').get('111');
  ok(Boolean(customer), 'customer row created');

  const list = await apiCall('GET', '/api/favorites');
  ok(list.status === 200, 'list → 200');
  ok(Array.isArray(list.payload.items) && list.payload.items.length === 1, 'one item');
  const item = list.payload.items[0];
  ok(item.product_id === 'prod_simple', 'product id');
  ok(item.variant_id === null, 'variant null');
  ok(item.in_stock === true, 'in stock');
  ok(Number(item.priceRub) === 10, 'price from product');
}

console.log('--- F3: идемпотентность повтора ---');
{
  const again = await apiCall('POST', '/api/favorites', { product_id: 'prod_simple' });
  ok(again.status === 200, 'repeat add → 200');
  ok(Number(again.payload.already) === 1, 'already flag');
  const list = await apiCall('GET', '/api/favorites');
  ok(list.payload.items.length === 1, 'no duplicate rows');
}

console.log('--- F4: гранулярность по вариантам ---');
{
  const addOk = await apiCall('POST', '/api/favorites', { product_id: 'prod_var', variant_id: 'var_ok' });
  ok(addOk.status === 201, 'add variant in stock → 201');
  const addOut = await apiCall('POST', '/api/favorites', { product_id: 'prod_var', variant_id: 'var_out' });
  ok(addOut.status === 201, 'add out-of-stock variant → 201 (хранить можно)');

  const list = await apiCall('GET', '/api/favorites');
  const varItems = list.payload.items.filter((i) => i.product_id === 'prod_var');
  ok(varItems.length === 2, 'two variant records for same product');
  const mango = varItems.find((i) => i.variant_id === 'var_out');
  ok(mango.in_stock === false, 'mango in_stock false');
  ok(mango.variant_name === 'Манго', 'variant name');
  const strawberry = varItems.find((i) => i.variant_id === 'var_ok');
  ok(strawberry.in_stock === true, 'strawberry in_stock true');
}

console.log('--- F5: variant_required для товара с вкусами ---');
{
  const noVariant = await apiCall('POST', '/api/favorites', { product_id: 'prod_var' });
  ok(noVariant.status === 400, 'add product with variants without variant_id → 400');
  ok(noVariant.payload.error === 'variant_required', 'variant_required error');
}

console.log('--- F6: несуществующий товар/вариант ---');
{
  const badProduct = await apiCall('POST', '/api/favorites', { product_id: 'prod_missing' });
  ok(badProduct.status === 400, 'missing product → 400');
  const badVariant = await apiCall('POST', '/api/favorites', { product_id: 'prod_simple', variant_id: 'var_ok' });
  ok(badVariant.status === 400, 'variant of another product → 400');
  const emptyBody = await apiCall('POST', '/api/favorites', {});
  ok(emptyBody.status === 400, 'empty body → 400');
}

console.log('--- F7: закончившийся товар остаётся в списке ---');
{
  const list = await apiCall('GET', '/api/favorites');
  const outItem = list.payload.items.find((i) => i.product_id === 'prod_out');
  // prod_out не добавляли — добавим и проверим
  if (!outItem) {
    await apiCall('POST', '/api/favorites', { product_id: 'prod_out' });
  }
  const list2 = await apiCall('GET', '/api/favorites');
  const item = list2.payload.items.find((i) => i.product_id === 'prod_out');
  ok(Boolean(item), 'out-of-stock item in list');
  ok(item.in_stock === false, 'in_stock false');
  ok(item.deleted === false, 'not deleted');
  ok(Number(item.stock) === 0, 'stock 0');
}

console.log('--- F8: удаление идемпотентно ---');
{
  const remove = await apiCall('DELETE', '/api/favorites', { product_id: 'prod_simple' });
  ok(remove.status === 200, 'remove → 200');
  ok(remove.payload.removed === 1, 'removed 1');
  const removeAgain = await apiCall('DELETE', '/api/favorites', { product_id: 'prod_simple' });
  ok(removeAgain.status === 200, 'remove again → 200');
  ok(removeAgain.payload.removed === 0, 'removed 0 on repeat');
  const list = await apiCall('GET', '/api/favorites');
  ok(!list.payload.items.some((i) => i.product_id === 'prod_simple'), 'item gone');
}

console.log('--- F9: удалённый админом товар — флаг deleted ---');
{
  await apiCall('POST', '/api/favorites', { product_id: 'prod_simple' });
  // Админ удаляет товар: записи избранного остаются (нет FK)
  db.prepare('DELETE FROM products WHERE id = ?').run('prod_simple');
  const list = await apiCall('GET', '/api/favorites');
  const item = list.payload.items.find((i) => i.product_id === 'prod_simple');
  ok(Boolean(item), 'deleted product still listed');
  ok(item.deleted === true, 'deleted flag');
  ok(item.in_stock === false, 'in_stock false for deleted');
  ok(item.title === null, 'title null');
  // Восстановим для последующих проверок
  seedCatalog();
}

console.log('--- F10: изоляция между клиентами ---');
{
  await apiCall('POST', '/api/favorites', { product_id: 'prod_simple' });
  const otherList = await apiCall('GET', '/api/favorites', undefined, authHeaders('222', 'buyer2'));
  ok(otherList.status === 200, 'other client list → 200');
  ok(otherList.payload.items.length === 0, 'no items for other client');
  const otherAdd = await apiCall('POST', '/api/favorites', { product_id: 'prod_out' }, authHeaders('222', 'buyer2'));
  ok(otherAdd.status === 201, 'other client add → 201');
  const mine = await apiCall('GET', '/api/favorites');
  ok(mine.payload.items.length === 1, 'first client list unchanged');
}

console.log('--- F11: удаление одного варианта не трогает второй ---');
{
  await apiCall('POST', '/api/favorites', { product_id: 'prod_var', variant_id: 'var_ok' });
  const remove = await apiCall('DELETE', '/api/favorites', { product_id: 'prod_var', variant_id: 'var_out' });
  ok(remove.status === 200, 'remove one variant → 200');
  const list = await apiCall('GET', '/api/favorites');
  const varItems = list.payload.items.filter((i) => i.product_id === 'prod_var');
  ok(varItems.length === 1, 'one variant record left');
  ok(varItems[0].variant_id === 'var_ok', 'correct variant left');
}

console.log('--- F12: пустой запрос без product_id ---');
{
  const bad = await apiCall('POST', '/api/favorites', { product_id: '' });
  ok(bad.status === 400, 'empty product_id → 400');
  const badDelete = await apiCall('DELETE', '/api/favorites', {});
  ok(badDelete.status === 400, 'delete without product_id → 400');
}

console.log('--- F13: цена с каталогной скидкой ---');
{
  seedCatalog();
  await apiCall('POST', '/api/favorites', { product_id: 'prod_simple' });

  const { saveDiscount } = await import('../utils/catalog-discounts.js');
  saveDiscount('product', 'prod_simple', { price: 8, untilDate: null });

  const list = await apiCall('GET', '/api/favorites');
  const item = list.payload.items.find((i) => i.product_id === 'prod_simple');
  ok(Number(item.priceRub) === 8, 'favorites price applies catalog discount');

  saveDiscount('product', 'prod_simple', { price: null, untilDate: null });
  const listAfter = await apiCall('GET', '/api/favorites');
  const itemAfter = listAfter.payload.items.find((i) => i.product_id === 'prod_simple');
  ok(Number(itemAfter.priceRub) === 10, 'price back to base after discount removed');
}

console.log('--- F14: группа полкоторой в избранное целиком ---');
{
  seedCatalog();
  // Линейка: один товар с двумя вкусами
  db.prepare(
    `INSERT INTO category_groups (id, categoryId, slug, name, [order], hide_empty, createdAt, updatedAt)
     VALUES ('grp_line', 'cat1', 'grp_line', 'Podonki Podgon', 1, 0, DATETIME('now'), DATETIME('now'))`,
  ).run();
  db.prepare(
    `UPDATE products SET groupId = 'grp_line' WHERE id IN ('prod_var')`,
  ).run();
  db.prepare(
    `UPDATE products SET groupId = 'grp_line', stock = 3 WHERE id = 'prod_simple'`,
  ).run();

  const add = await apiCall('POST', '/api/favorites', { group_id: 'grp_line' });
  ok(add.status === 201, 'add whole group → 201');
  ok(Number(add.payload.total) === 3, 'total = 3 targets (2 вкуса + 1 простой)');
  ok(Number(add.payload.inserted) === 3, 'inserted 3');

  const list = await apiCall('GET', '/api/favorites');
  ok(list.payload.items.length === 3, 'three favorites rows');
  const groupItems = list.payload.items.filter((i) => i.group_id === 'grp_line');
  ok(groupItems.length === 3, 'all items carry group_id');
  ok(groupItems[0].group_name === 'Podonki Podgon', 'group_name present');

  // Повтор — идемпотентно
  const again = await apiCall('POST', '/api/favorites', { group_id: 'grp_line' });
  ok(again.status === 200, 'repeat group add → 200');
  ok(Number(again.payload.already) === 3, 'already 3, inserted 0');
  const list2 = await apiCall('GET', '/api/favorites');
  ok(list2.payload.items.length === 3, 'no duplicates');

  // Удаление группы одной командой
  const remove = await apiCall('DELETE', '/api/favorites', { group_id: 'grp_line' });
  ok(remove.status === 200, 'remove whole group → 200');
  ok(Number(remove.payload.removed) === 3, 'removed 3');
  const list3 = await apiCall('GET', '/api/favorites');
  ok(list3.payload.items.length === 0, 'group items gone');
}

console.log('--- F15: пустая и несуществующая группа ---');
{
  seedCatalog();
  const missing = await apiCall('POST', '/api/favorites', { group_id: 'grp_missing' });
  ok(missing.status === 404, 'missing group → 404');
  ok(missing.payload.error === 'group_empty', 'group_empty error');

  // Группа без товаров
  db.prepare(
    `INSERT INTO category_groups (id, categoryId, slug, name, [order], hide_empty, createdAt, updatedAt)
     VALUES ('grp_empty', 'cat1', 'grp_empty', 'Пустая', 2, 0, DATETIME('now'), DATETIME('now'))`,
  ).run();
  const empty = await apiCall('POST', '/api/favorites', { group_id: 'grp_empty' });
  ok(empty.status === 404, 'empty group → 404');
}

console.log('--- F16: группа с вложенной подгруппой ---');
{
  seedCatalog();
  db.prepare(
    `INSERT INTO category_groups (id, categoryId, slug, name, [order], hide_empty, createdAt, updatedAt)
     VALUES ('grp_parent', 'cat1', 'grp_parent', 'Родитель', 1, 0, DATETIME('now'), DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO category_groups (id, categoryId, slug, name, [order], hide_empty, createdAt, updatedAt)
     VALUES ('grp_child', 'cat1', 'grp_child', 'Вложенная', 2, 0, DATETIME('now'), DATETIME('now'))`,
  ).run();
  db.prepare(`UPDATE category_groups SET parent_group_id = 'grp_parent' WHERE id = 'grp_child'`).run();
  // Товар в родителе и товар во вложенной
  db.prepare(
    `INSERT INTO products (id, categoryId, groupId, title, priceRub, description, stock, has_variants, use_category_image, createdAt)
     VALUES ('prod_p', 'cat1', 'grp_parent', 'Род. товар', 11, '', 5, 0, 0, DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO products (id, categoryId, groupId, title, priceRub, description, stock, has_variants, use_category_image, createdAt)
     VALUES ('prod_c', 'cat1', 'grp_child', 'Влож. товар', 13, '', 5, 0, 0, DATETIME('now'))`,
  ).run();
  db.prepare(`UPDATE products SET groupId = 'grp_child' WHERE id = 'prod_simple'`).run();

  const add = await apiCall('POST', '/api/favorites', { group_id: 'grp_parent' });
  ok(add.status === 201, 'add parent group → 201');
  // prod_p (родитель) + prod_c и prod_simple (вложенная подгруппа)
  ok(Number(add.payload.inserted) === 3, 'parent + child products included');

  const list = await apiCall('GET', '/api/favorites');
  const ids = list.payload.items.map((i) => i.product_id).sort();
  ok(
    JSON.stringify(ids) === JSON.stringify(['prod_c', 'prod_p', 'prod_simple']),
    'child products included',
  );
}

server.close();
console.log(`\nDone: ${results.passed} passed, ${results.failed} failed\n`);
process.exit(results.failed > 0 ? 1 : 0);
