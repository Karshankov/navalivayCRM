import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tempDb = path.resolve(__dirname, `.tmp-new-badge-${Date.now()}.db`);
process.env.DATABASE_FILE = tempDb;

const { db, initDb } = await import('../db.js');
const { issueToken } = await import('../auth.js');
const { adminRouter } = await import('../routes/admin.js');
const { publicRouter } = await import('../routes/public.js');

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

const groupRow = (id) =>
  db.prepare('SELECT new_since, new_until FROM category_groups WHERE id = ?').get(id);

try {
  initDb();
  db.prepare("INSERT INTO categories (id, slug, name, [order]) VALUES ('c1', 'liquids', 'Жидкости', 1)").run();
  db.prepare(`
    INSERT INTO category_groups (id, categoryId, slug, name, [order])
    VALUES ('g_fresh', 'c1', 'fresh', 'Свежая линейка', 15),
           ('g_old', 'c1', 'old', 'Старая линейка', 1)
  `).run();
  const insertProduct = db.prepare(`
    INSERT INTO products (id, categoryId, groupId, title, priceRub, stock, has_variants, createdAt)
    VALUES (?, 'c1', ?, ?, 10, ?, 0, DATETIME('now'))
  `);
  insertProduct.run('p_fresh', 'g_fresh', 'Манго', 5);
  insertProduct.run('p_old', 'g_old', 'Барбарис', 5);

  const app = express();
  app.use(express.json());
  app.use(adminRouter);
  app.use(publicRouter);
  server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const auth = { Authorization: `Bearer ${issueToken('new-badge-test')}`, 'Content-Type': 'application/json' };

  const saveGroup = (id, body) =>
    fetch(`${baseUrl}/api/admin/category-groups/${id}`, {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify(body),
    });

  console.log('\n--- отметка новинкой ---');
  const marked = await saveGroup('g_fresh', { is_new: true, new_days: 10 });
  equal(marked.status, 200, 'линейку можно отметить новинкой');
  const afterMark = groupRow('g_fresh');
  equal(Boolean(afterMark.new_since), true, 'дата отметки записана');
  equal(Boolean(afterMark.new_until), true, 'срок записан');
  equal(
    db.prepare("SELECT new_until > DATETIME('now') AS active FROM category_groups WHERE id = 'g_fresh'").get().active,
    1,
    'срок в будущем',
  );
  // Формат должен совпадать с остальным временем в базе: без T и Z, иначе
  // сравнение строк в SQL поедет.
  equal(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(afterMark.new_until), true, 'формат даты как у остального времени');

  console.log('\n--- продление не сдвигает начало отсчёта ---');
  const since = afterMark.new_since;
  const until = afterMark.new_until;
  const extended = await saveGroup('g_fresh', { is_new: true, new_days: 40 });
  equal(extended.status, 200, 'срок можно поменять');
  const afterExtend = groupRow('g_fresh');
  equal(afterExtend.new_since, since, 'начало отсчёта осталось прежним');
  equal(afterExtend.new_until > until, true, 'срок отодвинулся');

  console.log('\n--- правка соседнего поля не продлевает показ ---');
  const renamed = await saveGroup('g_fresh', { name: 'Свежая линейка' });
  equal(renamed.status, 200, 'линейку можно переименовать');
  equal(groupRow('g_fresh').new_until, afterExtend.new_until, 'срок не тронут');

  console.log('\n--- сохранение формы не продлевает срок ---');
  // Форма шлёт is_new и срок при каждом сохранении, даже когда меняли обложку.
  // Срок считается от даты отметки, поэтому повтор с тем же числом дней ничего
  // не двигает: иначе плашка горела бы вечно, пока линейку правят.
  const beforeResave = groupRow('g_fresh');
  await saveGroup('g_fresh', { is_new: true, new_days: 40, name: 'Свежая линейка' });
  equal(groupRow('g_fresh'), beforeResave, 'повторное сохранение с тем же сроком ничего не меняет');
  const resavedTwice = await saveGroup('g_fresh', { is_new: true, new_days: 40 });
  equal(resavedTwice.status, 200, 'и третье сохранение проходит');
  equal(groupRow('g_fresh'), beforeResave, 'срок по-прежнему на месте');

  console.log('\n--- витрина ---');
  const categoriesResponse = await fetch(`${baseUrl}/api/categories`);
  const categories = await categoriesResponse.json();
  const groups = categories.find((row) => row.id === 'c1')?.groups ?? [];
  const fresh = groups.find((row) => row.id === 'g_fresh');
  const old = groups.find((row) => row.id === 'g_old');
  equal(fresh?.isNew, true, 'отмеченная линейка приходит новинкой');
  equal(Boolean(fresh?.newSince), true, 'дата отметки уходит на витрину');
  equal(old?.isNew, false, 'обычная линейка новинкой не приходит');
  // Порядок на витрине остаётся серверным: закрепление живёт в сортировке
  // клиента, иначе обложка категории на главной сменилась бы на обложку новинки.
  equal(
    groups.map((row) => row.id),
    ['g_old', 'g_fresh'],
    'сервер отдаёт линейки в обычном порядке',
  );

  console.log('\n--- истёкший срок ---');
  // Начало отсчёта уводим в прошлое: иначе следующая проверка сравнивала бы две
  // даты, записанные в одну и ту же секунду.
  db.prepare(`
    UPDATE category_groups
    SET new_since = DATETIME('now', '-40 days'), new_until = DATETIME('now', '-1 day')
    WHERE id = 'g_fresh'
  `).run();
  const expiredCategories = await (await fetch(`${baseUrl}/api/categories`)).json();
  const expiredGroup = expiredCategories
    .find((row) => row.id === 'c1')
    ?.groups.find((row) => row.id === 'g_fresh');
  equal(expiredGroup?.isNew, false, 'истёкшая новинка перестаёт быть новинкой');

  console.log('\n--- повторная отметка после истечения начинает отсчёт заново ---');
  const expiredSince = groupRow('g_fresh').new_since;
  const remarked = await saveGroup('g_fresh', { is_new: true, new_days: 5 });
  equal(remarked.status, 200, 'истёкшую линейку можно отметить снова');
  const afterRemark = groupRow('g_fresh');
  equal(afterRemark.new_since !== expiredSince, true, 'начало отсчёта сброшено');
  equal(
    db
      .prepare("SELECT CAST(julianday(new_until) - julianday(new_since) AS INTEGER) AS days FROM category_groups WHERE id = 'g_fresh'")
      .get().days,
    5,
    'срок считается от новой отметки, а не от старой',
  );
  equal(
    db.prepare("SELECT new_until > DATETIME('now') AS active FROM category_groups WHERE id = 'g_fresh'").get().active,
    1,
    'новинка снова горит',
  );

  console.log('\n--- снятие ---');
  const cleared = await saveGroup('g_fresh', { is_new: false });
  equal(cleared.status, 200, 'галку можно снять');
  equal(groupRow('g_fresh'), { new_since: null, new_until: null }, 'обе даты очищены');

  console.log('\n--- проверка срока ---');
  for (const [days, label] of [[0, 'ноль дней'], [181, 'слишком много дней'], ['abc', 'не число'], [1.5, 'дробное число']]) {
    const bad = await saveGroup('g_fresh', { is_new: true, new_days: days });
    const body = await bad.json();
    equal([bad.status, body.error], [400, 'invalid_new_days'], `${label} отклоняется`);
  }
  const badFlag = await saveGroup('g_fresh', { is_new: 'да' });
  equal([badFlag.status, (await badFlag.json()).error], [400, 'invalid_is_new'], 'нелогический флаг отклоняется своей ошибкой');
  equal(groupRow('g_fresh'), { new_since: null, new_until: null }, 'после отказов даты не появились');

  console.log('\n--- срок по умолчанию ---');
  const defaulted = await saveGroup('g_fresh', { is_new: true });
  equal(defaulted.status, 200, 'срок можно не указывать');
  equal(
    db
      .prepare("SELECT CAST(julianday(new_until) - julianday(new_since) AS INTEGER) AS days FROM category_groups WHERE id = 'g_fresh'")
      .get().days,
    30,
    'по умолчанию тридцать дней',
  );

  console.log('\n--- линейка без остатка ---');
  db.prepare("UPDATE products SET stock = 0 WHERE id = 'p_fresh'").run();
  const emptyCategories = await (await fetch(`${baseUrl}/api/categories`)).json();
  const emptyGroups = emptyCategories.find((row) => row.id === 'c1')?.groups ?? [];
  equal(
    emptyGroups.some((row) => row.id === 'g_fresh'),
    false,
    'линейка без остатка уходит с витрины вместе с плашкой',
  );

  console.log('\n--- новинка при создании линейки ---');
  const created = await fetch(`${baseUrl}/api/admin/category-groups`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ categoryId: 'c1', name: 'Совсем новая', is_new: true, new_days: 7 }),
  });
  equal(created.status, 200, 'линейку можно создать сразу новинкой');
  const createdId = (await created.json()).id;
  equal(
    db
      .prepare('SELECT CAST(julianday(new_until) - julianday(new_since) AS INTEGER) AS days FROM category_groups WHERE id = ?')
      .get(createdId).days,
    7,
    'срок проставлен при создании',
  );
  const createdPlain = await fetch(`${baseUrl}/api/admin/category-groups`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ categoryId: 'c1', name: 'Обычная' }),
  });
  equal(
    groupRow((await createdPlain.json()).id),
    { new_since: null, new_until: null },
    'без галки линейка создаётся без дат',
  );

  console.log('\n--- админская выдача ---');
  const adminList = await (await fetch(`${baseUrl}/api/admin/category-groups`, { headers: auth })).json();
  const adminFresh = adminList.find((row) => row.id === 'g_fresh');
  equal(adminFresh?.is_new, 1, 'список админки знает про новинку');
  equal(adminFresh?.new_days_total, 30, 'список отдаёт заданный срок');
  equal(typeof adminFresh?.new_days_left, 'number', 'список отдаёт остаток дней');
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
console.log('\nGroup new badge: all tests passed');
