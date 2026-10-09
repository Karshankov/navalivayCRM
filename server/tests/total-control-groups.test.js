import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tempDb = path.resolve(__dirname, `.tmp-total-control-${Date.now()}.db`);
process.env.DATABASE_FILE = tempDb;

const { db, initDb } = await import('../db.js');
const { buildTotalControlGroups } = await import('../utils/total-control-groups.js');
const { issueToken } = await import('../auth.js');
const { crmOperationsRouter } = await import('../routes/crm-operations.js');

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
  db.prepare(`INSERT INTO categories (id, slug, name, [order]) VALUES ('c1', 'test', 'Расходники', 1)`).run();
  db.prepare(`
    INSERT INTO category_groups (id, categoryId, slug, name, [order], total_control)
    VALUES ('g1', 'c1', 'xros', 'Картриджи XROS', 1, 1),
           ('g2', 'c1', 'child', 'Дочерняя', 2, 0),
           ('g3', 'c1', 'hidden', 'Без контроля', 3, 0)
  `).run();
  db.prepare(`UPDATE category_groups SET cover_image = 'data:image/webp;base64,secret-image' WHERE id = 'g1'`).run();
  db.prepare(`UPDATE category_groups SET parent_group_id = 'g1' WHERE id = 'g2'`).run();

  const insertProduct = db.prepare(`
    INSERT INTO products (id, categoryId, groupId, title, priceRub, stock, has_variants, createdAt)
    VALUES (?, 'c1', ?, ?, 10, ?, ?, DATETIME('now'))
  `);
  insertProduct.run('p1', 'g1', 'XROS 0.4 Ω', 30, 0);
  insertProduct.run('p2', 'g1', 'XROS цвета', 999, 1);
  insertProduct.run('p3', 'g2', 'XROS 0.8 Ω', 5, 0);
  insertProduct.run('p4', 'g3', 'Не показывать', 100, 0);
  db.prepare(`
    INSERT INTO product_variants (id, product_id, name, stock, position)
    VALUES ('v1', 'p2', 'Красный', 7, 1), ('v2', 'p2', 'Синий', 3, 2)
  `).run();

  const result = buildTotalControlGroups(db);
  equal(result.length, 1, 'возвращается только отмеченная линейка');
  equal(result[0].totalStock, 45, 'общий остаток учитывает товар, варианты и дочернюю линейку');
  equal(result[0].itemCount, 4, 'варианты считаются отдельными строками');
  equal(
    result[0].items.map((item) => item.label),
    ['XROS цвета · Синий', 'XROS 0.8 Ω', 'XROS цвета · Красный', 'XROS 0.4 Ω'],
    'сначала идут позиции с наименьшим остатком',
  );

  const app = express();
  app.use(express.json());
  app.use(crmOperationsRouter);
  server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const unauthorized = await fetch(`${baseUrl}/api/admin/crm/total-control-groups`);
  equal(unauthorized.status, 401, 'маршрут закрыт авторизацией');

  const authorized = await fetch(`${baseUrl}/api/admin/crm/total-control-groups`, {
    headers: { Authorization: `Bearer ${issueToken('admin-test')}` },
  });
  const payload = await authorized.json();
  equal(authorized.status, 200, 'маршрут возвращает 200 с авторизацией');
  equal(payload.items?.[0]?.totalStock, 45, 'маршрут возвращает рассчитанный остаток');
  equal(payload.items?.[0]?.hasCoverImage, true, 'маршрут возвращает только признак обложки');
  equal(JSON.stringify(payload).includes('secret-image'), false, 'полное изображение не попадает в сводку');
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
console.log('Total control groups: all tests passed');
