import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tempDb = path.resolve(__dirname, `.tmp-discounts-${Date.now()}.db`);
process.env.DATABASE_FILE = tempDb;

const { db, initDb } = await import('../db.js');
const { issueToken } = await import('../auth.js');
const { adminRouter } = await import('../routes/admin.js');
const { publicRouter } = await import('../routes/public.js');
const { saveDiscount, resolveDiscountPrice, applyDiscountToPrice } = await import('../utils/catalog-discounts.js');
const { isPositionLoyaltyStampBlocked } = await import('../loyalty.js');

let failed = 0;
let server;
function equal(actual, expected, message) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    console.log(`OK: ${message}`);
  } else {
    failed += 1;
    console.error(`FAIL: ${message}\nexpected ${JSON.stringify(expected)}\nactual   ${JSON.stringify(actual)}`);
  }
}

try {
  initDb();
  db.prepare("INSERT INTO categories (id, slug, name, [order]) VALUES ('c1', 'liquids', 'Жидкости', 1)").run();
  db.prepare("INSERT INTO category_groups (id, categoryId, slug, name, [order]) VALUES ('g1', 'c1', 'line', 'Линейка', 1)").run();
  db.prepare(`
    INSERT INTO products (id, categoryId, groupId, title, priceRub, stock, has_variants, createdAt)
    VALUES ('p_plain', 'c1', 'g1', 'Обычный', 20, 10, 0, DATETIME('now')),
           ('p_var', 'c1', 'g1', 'С вкусами', 20, 0, 1, DATETIME('now'))
  `).run();
  db.prepare(`
    INSERT INTO product_variants (id, product_id, name, price_rub, stock, position)
    VALUES ('v_one', 'p_var', 'Манго', 25, 5, 1), ('v_two', 'p_var', 'Барбарис', 25, 5, 2)
  `).run();

  console.log('\n--- выбор цены ---');
  saveDiscount('group', 'g1', { price: 15, untilDate: '2999-01-01' });
  equal(resolveDiscountPrice({ productId: 'p_plain', groupId: 'g1' }), 15, 'скидка линейки действует на её товары');

  saveDiscount('product', 'p_plain', { price: 12, untilDate: null });
  equal(
    resolveDiscountPrice({ productId: 'p_plain', groupId: 'g1' }),
    12,
    'из двух скидок берём выгодную покупателю',
  );

  saveDiscount('product', 'p_plain', { price: 18, untilDate: null });
  equal(
    resolveDiscountPrice({ productId: 'p_plain', groupId: 'g1' }),
    15,
    'менее выгодная скидка товара не перебивает линейку',
  );

  saveDiscount('variant', 'v_one', { price: 9, untilDate: null });
  equal(
    resolveDiscountPrice({ productId: 'p_var', variantId: 'v_one', groupId: 'g1' }),
    9,
    'скидка вкуса тоже участвует в выборе',
  );
  equal(
    resolveDiscountPrice({ productId: 'p_var', variantId: 'v_two', groupId: 'g1' }),
    15,
    'соседний вкус берёт скидку линейки',
  );

  console.log('\n--- срок действия ---');
  // Снимаем скидку товара, иначе она перебьёт проверку срока у линейки.
  saveDiscount('product', 'p_plain', { price: null });
  saveDiscount('group', 'g1', { price: 15, untilDate: '2020-01-01' });
  equal(resolveDiscountPrice({ productId: 'p_plain', groupId: 'g1' }), null, 'истёкшая скидка не действует');
  saveDiscount('group', 'g1', { price: 15, untilDate: null });
  equal(resolveDiscountPrice({ productId: 'p_plain', groupId: 'g1' }), 15, 'скидка без срока действует');

  console.log('\n--- скидка внешней линейки достаёт вложенные ---');
  db.prepare(`
    INSERT INTO category_groups (id, categoryId, slug, name, [order], parent_group_id)
    VALUES ('g_root', 'c1', 'podonki', 'PODONKI', 2, NULL),
           ('g_kid', 'c1', 'podonki-inferno', 'PODONKI INFERNO', 3, 'g_root'),
           ('g_grandkid', 'c1', 'podonki-inferno-x', 'PODONKI INFERNO X', 4, 'g_kid')
  `).run();
  db.prepare(`
    INSERT INTO products (id, categoryId, groupId, title, priceRub, stock, has_variants, createdAt)
    VALUES ('p_kid', 'c1', 'g_kid', 'Вкус внутри', 30, 5, 0, DATETIME('now')),
           ('p_grandkid', 'c1', 'g_grandkid', 'Вкус глубже', 30, 5, 0, DATETIME('now'))
  `).run();

  saveDiscount('group', 'g_root', { price: 22, untilDate: null });
  equal(
    resolveDiscountPrice({ productId: 'p_kid', groupId: 'g_kid' }),
    22,
    'скидка внешней линейки доходит до товаров вложенной',
  );
  equal(
    resolveDiscountPrice({ productId: 'p_grandkid', groupId: 'g_grandkid' }),
    22,
    'скидка внешней линейки доходит и через два уровня',
  );

  saveDiscount('group', 'g_kid', { price: 19, untilDate: null });
  equal(
    resolveDiscountPrice({ productId: 'p_kid', groupId: 'g_kid' }),
    19,
    'своя скидка вложенной линейки выигрывает, когда она выгоднее',
  );

  saveDiscount('group', 'g_kid', { price: 26, untilDate: null });
  equal(
    resolveDiscountPrice({ productId: 'p_kid', groupId: 'g_kid' }),
    22,
    'менее выгодная скидка вложенной линейки не перебивает внешнюю',
  );

  saveDiscount('group', 'g_kid', { price: null });
  saveDiscount('group', 'g_root', { price: 22, untilDate: '2020-01-01' });
  equal(
    resolveDiscountPrice({ productId: 'p_kid', groupId: 'g_kid' }),
    null,
    'истёкшая скидка внешней линейки не достаётся вложенной',
  );
  saveDiscount('group', 'g_root', { price: null });

  // Линейка, вложенная сама в себя, встречается только при порче данных, но
  // запрос обязан на ней закончиться, а не подвесить витрину.
  db.prepare("UPDATE category_groups SET parent_group_id = 'g_grandkid' WHERE id = 'g_root'").run();
  saveDiscount('group', 'g_root', { price: 21, untilDate: null });
  equal(
    resolveDiscountPrice({ productId: 'p_kid', groupId: 'g_kid' }),
    21,
    'кольцо во вложенности не вешает запрос',
  );
  db.prepare("UPDATE category_groups SET parent_group_id = NULL WHERE id = 'g_root'").run();
  saveDiscount('group', 'g_root', { price: null });

  console.log('\n--- защита от опечаток ---');
  equal(applyDiscountToPrice(20, 25), 20, 'скидка дороже базовой цены игнорируется');
  equal(applyDiscountToPrice(20, null), 20, 'без скидки остаётся базовая цена');
  equal(applyDiscountToPrice(20, 0), 0, 'нулевая цена допустима, это подарок');

  console.log('\n--- бонусы ---');
  // Скидка живёт отдельно от цены товара, поэтому продажа по ней выглядит как
  // продажа дешевле каталога, и штамп не начисляется.
  equal(
    isPositionLoyaltyStampBlocked({ product_id: 'p_plain', price_per_unit: 15 }),
    true,
    'за позицию со скидкой штамп не начисляется',
  );
  equal(
    isPositionLoyaltyStampBlocked({ product_id: 'p_plain', price_per_unit: 20 }),
    false,
    'за позицию по обычной цене штамп начисляется',
  );
  equal(
    db.prepare('SELECT priceRub FROM products WHERE id = ?').get('p_plain').priceRub,
    20,
    'базовая цена товара скидкой не переписана',
  );

  const app = express();
  app.use(express.json());
  app.use(adminRouter);
  app.use(publicRouter);
  server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const auth = { Authorization: `Bearer ${issueToken('discount-test')}`, 'Content-Type': 'application/json' };

  console.log('\n--- витрина ---');
  const listed = await (await fetch(`${baseUrl}/api/products?limit=50`)).json();
  const rows = Array.isArray(listed) ? listed : listed.products || [];
  const plain = rows.find((row) => row.id === 'p_plain');
  equal([plain?.priceRub, plain?.oldPriceRub, plain?.hasDiscount], [15, 20, true], 'витрина отдаёт цену со скидкой и старую');

  const card = await (await fetch(`${baseUrl}/api/product/p_var`)).json();
  const flavorOne = card.variants?.find((row) => row.id === 'v_one');
  const flavorTwo = card.variants?.find((row) => row.id === 'v_two');
  equal([flavorOne?.priceRub, flavorOne?.oldPriceRub], [9, 25], 'у вкуса своя скидка');
  equal([flavorTwo?.priceRub, flavorTwo?.oldPriceRub], [15, 25], 'соседний вкус получает скидку линейки');

  console.log('\n--- сохранение через админку ---');
  const saved = await fetch(`${baseUrl}/api/admin/category-groups/g1`, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ discount: { price: 11, untilDate: '2999-05-05' } }),
  });
  equal(saved.status, 200, 'скидку линейки можно сохранить');
  equal(resolveDiscountPrice({ productId: 'p_plain', groupId: 'g1' }), 11, 'новая цена применилась');

  for (const [payload, label] of [
    [{ price: -1 }, 'отрицательная цена'],
    [{ price: 10, untilDate: '05.05.2030' }, 'дата в чужом формате'],
  ]) {
    const bad = await fetch(`${baseUrl}/api/admin/category-groups/g1`, {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({ discount: payload }),
    });
    equal(bad.status, 400, `${label} отклоняется`);
  }
  equal(resolveDiscountPrice({ productId: 'p_plain', groupId: 'g1' }), 11, 'после отказов скидка не изменилась');

  const cleared = await fetch(`${baseUrl}/api/admin/category-groups/g1`, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ discount: { price: null } }),
  });
  equal(cleared.status, 200, 'скидку можно снять');
  equal(resolveDiscountPrice({ productId: 'p_plain', groupId: 'g1' }), null, 'после снятия скидки нет');

  const productSaved = await fetch(`${baseUrl}/api/admin/products/p_plain`, {
    method: 'PATCH',
    headers: auth,
    body: JSON.stringify({ discount: { price: 13, untilDate: null } }),
  });
  equal(productSaved.status, 200, 'скидку товара можно сохранить');
  equal(resolveDiscountPrice({ productId: 'p_plain', groupId: 'g1' }), 13, 'скидка товара применилась');

  console.log('\n--- заказ считает по скидке ---');
  const orderCheck = db.prepare('SELECT priceRub FROM products WHERE id = ?').get('p_plain');
  equal(
    applyDiscountToPrice(orderCheck.priceRub, resolveDiscountPrice({ productId: 'p_plain', groupId: 'g1' })),
    13,
    'цена позиции заказа берётся со скидкой',
  );
} finally {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  db.close();
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(`${tempDb}${suffix}`); } catch {}
  }
}

if (failed) process.exit(1);
console.log('\nCatalog discounts: all tests passed');
