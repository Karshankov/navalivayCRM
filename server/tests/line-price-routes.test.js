/**
 * Цена линейки — HTTP API tests.
 * Запуск: node server/tests/line-price-routes.test.js
 *
 * Задача, которую проверяем: в линейке 40+ вкусов, каждый вкус — отдельный
 * товар, и цены у них разъезжаются (у CATSWILL встречались 9, 15 и 17).
 * Нужно менять цену всей линейки одним полем в её настройках.
 *
 * Главное в этих тестах — не «цена применилась», а «чужие данные уцелели»:
 * оптовые цены, скидки, товары соседних линеек и история заказов.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navalivay-line-price-'));
const tempDbPath = path.join(tempDir, 'test.db');

process.env.DATABASE_FILE = tempDbPath;
process.env.BOT_TOKEN = '';

const { initDb, db } = await import('../db.js');
const { issueToken } = await import('../auth.js');
const { adminRouter } = await import('../routes/admin.js');
const { getActiveWholesaleTiers } = await import('../wholesale-service.js');

initDb();

const app = express();
app.use(express.json());
app.use(adminRouter);

const server = await new Promise((resolve) => {
  const instance = app.listen(0, () => resolve(instance));
});

const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;
const authToken = issueToken('admin-test');

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

function authHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${authToken}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function requestJson(url, options = {}) {
  const response = await fetch(`${baseUrl}${url}`, options);
  const data = await response.json().catch(() => null);
  return { response, data };
}

function resetDb() {
  db.exec('DELETE FROM order_items;');
  db.exec('DELETE FROM orders;');
  db.exec('DELETE FROM category_group_wholesale_prices;');
  db.exec('DELETE FROM catalog_discounts;');
  db.exec('DELETE FROM products;');
  db.exec('DELETE FROM category_groups;');
  db.exec('DELETE FROM categories;');
  db.exec("DELETE FROM settings WHERE key LIKE 'group_line_price:%';");
}

function seedCategory() {
  db.prepare(
    `INSERT INTO categories (id, slug, name, [order])
     VALUES ('c1', 'cat', 'Liquids', 1)`,
  ).run();
}

/** Линейка с разными ценами — ровно как у CATSWILL (9, 15, 17). */
function seedGroupWithSpreadPrices() {
  db.prepare(
    `INSERT INTO category_groups
      (id, categoryId, slug, name, [order], hide_empty, createdAt, updatedAt)
     VALUES ('g1', 'c1', 'catswill', 'CATSWILL', 1, 0, DATETIME('now'), DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO category_groups
      (id, categoryId, slug, name, [order], hide_empty, createdAt, updatedAt)
     VALUES ('g2', 'c1', 'other', 'ДРУГАЯ ЛИНЕЙКА', 2, 0, DATETIME('now'), DATETIME('now'))`,
  ).run();

  const insert = db.prepare(
    `INSERT INTO products (id, categoryId, groupId, title, priceRub, stock, min_stock, cost_price, createdAt)
     VALUES (?, 'c1', ?, ?, ?, 5, 0, 7, DATETIME('now'))`,
  );
  // Цены нарочно разные: это и есть причина, по которой линейку выравнивают.
  insert.run('p1', 'g1', 'Арбуз', 15);
  insert.run('p2', 'g1', 'Вишня', 17);
  insert.run('p3', 'g1', 'Дыня', 9);
  insert.run('p9', 'g2', 'Чужой вкус', 25);
}

function productPrice(id) {
  return Number(db.prepare('SELECT priceRub FROM products WHERE id = ?').get(id)?.priceRub);
}

// ---------------------------------------------------------------------------

console.log('\n=== LP-1: цена применяется ко всем товарам линейки ===');
{
  resetDb();
  seedCategory();
  seedGroupWithSpreadPrices();

  const { response, data } = await requestJson('/api/admin/category-groups/g1', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ linePrice: 20 }),
  });

  ok(response.status === 200, 'PUT 200');
  ok(productPrice('p1') === 20, 'первый товар получил 20');
  ok(productPrice('p2') === 20, 'второй товар получил 20');
  ok(productPrice('p3') === 20, 'третий товар получил 20');
  ok(data?.line_price === 20, 'в ответе сохранённая цена линейки');
  ok(data?.updatedProductCount === 3, `в ответе число обновлённых товаров (${data?.updatedProductCount})`);
}

console.log('\n=== LP-2: соседняя линейка не затронута ===');
{
  ok(productPrice('p9') === 25, 'товар другой линейки остался 25');
}

console.log('\n=== LP-3: оптовые цены не изменились ===');
{
  resetDb();
  seedCategory();
  seedGroupWithSpreadPrices();

  const tier = getActiveWholesaleTiers()[0];
  db.prepare(
    `INSERT INTO category_group_wholesale_prices (group_id, tier_id, price_byn, created_at, updated_at)
     VALUES ('g1', ?, 11.5, DATETIME('now'), DATETIME('now'))`,
  ).run(tier.id);

  await requestJson('/api/admin/category-groups/g1', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ linePrice: 20 }),
  });

  const wholesale = db
    .prepare('SELECT price_byn FROM category_group_wholesale_prices WHERE group_id = ? AND tier_id = ?')
    .get('g1', tier.id);

  ok(Number(wholesale?.price_byn) === 11.5, 'оптовая цена осталась 11.5');
}

console.log('\n=== LP-4: скидки не изменяются ===');
{
  resetDb();
  seedCategory();
  seedGroupWithSpreadPrices();

  db.prepare(
    `INSERT INTO catalog_discounts (scope, target_id, price_byn, until_date, created_at, updated_at)
     VALUES ('product', 'p1', 14, NULL, DATETIME('now'), DATETIME('now'))`,
  ).run();

  await requestJson('/api/admin/category-groups/g1', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ linePrice: 20 }),
  });

  const discount = db
    .prepare("SELECT price_byn FROM catalog_discounts WHERE scope = 'product' AND target_id = 'p1'")
    .get();

  ok(Number(discount?.price_byn) === 14, 'скидка осталась 14 — её правит продавец, а не линейка');
}

console.log('\n=== LP-5: невалидная цена → 400 и данные не тронуты ===');
{
  resetDb();
  seedCategory();
  seedGroupWithSpreadPrices();

  for (const bad of ['abc', 0, -5, 999999]) {
    const { response, data } = await requestJson('/api/admin/category-groups/g1', {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ linePrice: bad }),
    });
    ok(response.status === 400, `мусорное значение ${JSON.stringify(bad)} → 400`);
    ok(data?.error === 'invalid_line_price', `код ошибки для ${JSON.stringify(bad)}`);
  }

  ok(productPrice('p1') === 15, 'после отказов цены не изменились (p1)');
  ok(productPrice('p2') === 17, 'после отказов цены не изменились (p2)');
  ok(productPrice('p3') === 9, 'после отказов цены не изменились (p3)');
}

console.log('\n=== LP-6: пустое поле цену не меняет ===');
{
  resetDb();
  seedCategory();
  seedGroupWithSpreadPrices();

  const { response } = await requestJson('/api/admin/category-groups/g1', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ linePrice: '' }),
  });

  ok(response.status === 200, 'пустое значение принимается');
  ok(productPrice('p1') === 15, 'цена осталась прежней (p1)');
  ok(productPrice('p2') === 17, 'цена осталась прежней (p2)');
}

console.log('\n=== LP-7: ключ не передан — цены не трогаются (PATCH-семантика) ===');
{
  resetDb();
  seedCategory();
  seedGroupWithSpreadPrices();

  // Это защита от аварии 9.05.2026: тогда фронт слал null для непереданных
  // полей и затирал данные. Сохранение линейки без цены не должно её менять.
  const { response } = await requestJson('/api/admin/category-groups/g1', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ name: 'CATSWILL NEW' }),
  });

  ok(response.status === 200, 'сохранение только названия прошло');
  ok(productPrice('p1') === 15, 'цена не тронута без ключа linePrice');
  ok(
    db.prepare('SELECT name FROM category_groups WHERE id = ?').get('g1')?.name === 'CATSWILL NEW',
    'название при этом сохранилось',
  );
}

console.log('\n=== LP-8: повторное сохранение той же цены идемпотентно ===');
{
  resetDb();
  seedCategory();
  seedGroupWithSpreadPrices();

  const put = () =>
    requestJson('/api/admin/category-groups/g1', {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ linePrice: 20 }),
    });

  const first = await put();
  const second = await put();

  ok(first.data?.updatedProductCount === 3, 'первый раз обновлено 3 товара');
  ok(second.data?.updatedProductCount === 3, 'второй раз тоже 3 товара');
  ok(productPrice('p1') === 20, 'цена осталась 20');
}

console.log('\n=== LP-9: разброс цен отдаётся в деталях линейки ===');
{
  resetDb();
  seedCategory();
  seedGroupWithSpreadPrices();

  const { data } = await requestJson('/api/admin/category-groups/g1', {
    method: 'GET',
    headers: authHeaders(),
  });

  const prices = Array.isArray(data?.distinct_prices) ? data.distinct_prices.map(Number) : null;
  ok(prices !== null, 'distinct_prices пришёл массивом');
  ok(
    prices && prices.length === 3 && prices.join(',') === '9,15,17',
    `разные цены перечислены по возрастанию (${prices?.join(',')})`,
  );
  ok(data?.line_price === null, 'до первого сохранения цена линейки пуста');
}

console.log('\n=== LP-10: чужие поля группы не затираются ===');
{
  resetDb();
  seedCategory();
  seedGroupWithSpreadPrices();

  db.prepare("UPDATE category_groups SET meta_label = 'Крепость', meta_value = '50мг', hide_empty = 1 WHERE id = 'g1'").run();

  await requestJson('/api/admin/category-groups/g1', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ linePrice: 20 }),
  });

  const group = db.prepare('SELECT meta_label, meta_value, hide_empty FROM category_groups WHERE id = ?').get('g1');
  ok(group?.meta_label === 'Крепость', 'meta_label уцелел');
  ok(group?.meta_value === '50мг', 'meta_value уцелел');
  ok(Number(group?.hide_empty) === 1, 'hide_empty уцелел');
}

console.log('\n=== LP-11: заказы не пересчитываются ===');
{
  resetDb();
  seedCategory();
  seedGroupWithSpreadPrices();

  // Заказ хранит собственную копию цены (`order_items.price_per_unit`), а не
  // ссылается на товар. Проверяем именно это: снимок цены в позиции заказа
  // остаётся прежним, хотя цена товара изменилась.
  db.prepare(
    `INSERT INTO orders
      (id, order_number, customer_id, employee_id, status, delivery_type, total_amount,
       discount_amount, discount_percent, final_amount, profit, created_at, updated_at)
     VALUES ('o1', 1, NULL, NULL, 'new', 'pickup', 17, 0, 0, 17, 0,
             DATETIME('now'), DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO order_items
      (id, order_id, product_id, product_title, quantity, price_per_unit,
       cost_per_unit, discount_amount, total_price, total_cost,
       manual_discount_amount, loyalty_discount_amount, loyalty_units_applied)
     VALUES ('oi1', 'o1', 'p2', 'Вишня', 1, 17, 7, 0, 17, 7, 0, 0, 0)`,
  ).run();

  await requestJson('/api/admin/category-groups/g1', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ linePrice: 20 }),
  });

  const item = db.prepare("SELECT price_per_unit FROM order_items WHERE id = 'oi1'").get();
  ok(Number(item?.price_per_unit) === 17, 'цена в старой позиции заказа осталась 17');
  ok(productPrice('p2') === 20, 'а в каталоге новая цена 20');
}

console.log('\n=== LP-12: дочерние линейки не затронуты (220 таких в базе) ===');
{
  resetDb();
  seedCategory();

  db.prepare(
    `INSERT INTO category_groups (id, categoryId, slug, name, [order], hide_empty, createdAt, updatedAt)
     VALUES ('parent', 'c1', 'glitch', 'Снюс GLITCH', 1, 0, DATETIME('now'), DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO category_groups (id, categoryId, slug, name, [order], hide_empty, parent_group_id, createdAt, updatedAt)
     VALUES ('child', 'c1', 'glitch-75', 'Снюс GLITCH 75MG', 2, 0, 'parent', DATETIME('now'), DATETIME('now'))`,
  ).run();

  const insert = db.prepare(
    `INSERT INTO products (id, categoryId, groupId, title, priceRub, stock, min_stock, cost_price, createdAt)
     VALUES (?, 'c1', ?, ?, ?, 5, 0, 7, DATETIME('now'))`,
  );
  insert.run('cp1', 'parent', 'Товар родителя', 20);
  insert.run('cc1', 'child', 'Товар ребёнка', 16);

  const { data } = await requestJson('/api/admin/category-groups/parent', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ linePrice: 33 }),
  });

  ok(data?.updatedProductCount === 1, `обновлён только товар родителя (${data?.updatedProductCount})`);
  ok(productPrice('cp1') === 33, 'товар родителя получил новую цену');
  ok(productPrice('cc1') === 16, 'товар дочерней линейки не изменился');
}

console.log('\n=== LP-13: линейка без своих товаров ===');
{
  resetDb();
  seedCategory();
  db.prepare(
    `INSERT INTO category_groups (id, categoryId, slug, name, [order], hide_empty, createdAt, updatedAt)
     VALUES ('empty', 'c1', 'empty', 'Пустая линейка', 1, 0, DATETIME('now'), DATETIME('now'))`,
  ).run();

  const { response, data } = await requestJson('/api/admin/category-groups/empty', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ linePrice: 20 }),
  });

  ok(response.status === 200, 'сохранение пустой линейки не падает');
  ok(data?.updatedProductCount === 0, 'обновлено 0 товаров');
}

console.log('\n=== LP-14: несуществующая линейка ===');
{
  resetDb();
  seedCategory();

  const { response } = await requestJson('/api/admin/category-groups/нет-такой', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ linePrice: 20 }),
  });

  // Ноль товаров — не ошибка: линейки могло не стать, пока шёл запрос.
  ok(response.status === 200 || response.status === 404, `понятный ответ (${response.status})`);
}

console.log('\n=== LP-15: пробелы и служебные значения не портят цены ===');
{
  resetDb();
  seedCategory();
  seedGroupWithSpreadPrices();

  // Пробелы — не «не менять»: это мусор, и лучше отказать, чем молча
  // оставить продавца думать, что цена применилась.
  const space = await requestJson('/api/admin/category-groups/g1', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ linePrice: '   ' }),
  });
  ok(space.response.status === 400, 'строка из пробелов отклонена');

  for (const bad of ['1e400', {}, [], 'двадцать']) {
    const { response } = await requestJson('/api/admin/category-groups/g1', {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ linePrice: bad }),
    });
    const label = typeof bad === 'object' ? JSON.stringify(bad) : String(bad);
    ok(response.status === 400, `${label} отклонено`);
  }

  // NaN и Infinity существуют только внутри JavaScript: в JSON они
  // становятся null, а null — это «цену не менять». Проверяем именно это,
  // чтобы никто потом не решил, что тут дыра.
  for (const special of [NaN, Infinity, -Infinity]) {
    const { response } = await requestJson('/api/admin/category-groups/g1', {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ linePrice: special }),
    });
    ok(response.status === 200, `${special} доходит как null и не меняет цены`);
  }
  ok(productPrice('p1') === 15, 'цены не изменились после NaN и Infinity');

  ok(productPrice('p1') === 15, 'цены уцелели после всех отказов');
}

console.log('\n=== LP-16: только переданный linePrice меняет цены, чужие поля целы ===');
{
  resetDb();
  seedCategory();
  seedGroupWithSpreadPrices();

  db.prepare(
    `INSERT INTO category_groups (id, categoryId, slug, name, [order], hide_empty, parent_group_id, meta_label, meta_value, createdAt, updatedAt)
     VALUES ('sub', 'c1', 'sub', 'ДОЧЕРНЯЯ', 3, 0, NULL, 'Крепость', '50мг', DATETIME('now'), DATETIME('now'))`,
  ).run();

  await requestJson('/api/admin/category-groups/g1', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ linePrice: 20 }),
  });

  const untouched = db.prepare('SELECT name, meta_label, meta_value, parent_group_id FROM category_groups WHERE id = ?').get('sub');
  ok(untouched?.name === 'ДОЧЕРНЯЯ', 'соседняя линейка не изменилась');
  ok(untouched?.meta_label === 'Крепость', 'метка соседней линейки цела');
}

console.log('\n=== LP-17: цена линейки сохраняется и видна после перезагрузки ===');
{
  resetDb();
  seedCategory();
  seedGroupWithSpreadPrices();

  await requestJson('/api/admin/category-groups/g1', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ linePrice: 20 }),
  });

  const { data } = await requestJson('/api/admin/category-groups/g1', {
    method: 'GET',
    headers: authHeaders(),
  });

  ok(data?.line_price === 20, 'цена линейки читается обратно');
  ok(
    Array.isArray(data?.distinct_prices) && data.distinct_prices.length === 1 && Number(data.distinct_prices[0]) === 20,
    'разнобой цен исчез — все товары по 20',
  );
}

console.log(`\n=== Results: ${results.passed} passed, ${results.failed} failed ===`);

server.close();
try {
  fs.rmSync(tempDir, { recursive: true, force: true });
} catch {
  // ignore
}

if (results.failed > 0) {
  process.exit(1);
}
