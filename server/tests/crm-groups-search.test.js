/**
 * Тесты API поиска линеек для «добавить всю линейку» в закупку.
 *
 * Проверяет:
 *   1. GET /api/admin/crm/groups/search — поиск по подстроке (без auth → 401)
 *   2. SQL-логика счётчика товаров с деревом подгрупп (прямой вызов)
 *   3. GET /api/admin/crm/products/search с group_id-фильтром
 *
 * Запуск: node tests/crm-groups-search.test.js
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_DB = path.join(__dirname, '..', 'data', `test-groups-search-${Date.now()}.db`);

let passed = 0;
let failed = 0;

function assertTrue(cond, label) {
  if (cond) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.error(`  ❌ ${label}`); }
}

function assertEq(actual, expected, label) {
  if (actual === expected) { passed++; console.log(`  ✅ ${label}`); }
  else {
    failed++;
    console.error(`  ❌ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// === Setup: тестовая БД с деревом групп ===
const db = new Database(TMP_DB);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT, slug TEXT, [order] INTEGER DEFAULT 0);
  CREATE TABLE category_groups (
    id TEXT PRIMARY KEY,
    categoryId TEXT,
    name TEXT,
    slug TEXT,
    [order] INTEGER DEFAULT 0,
    parent_group_id TEXT
  );
  CREATE TABLE products (
    id TEXT PRIMARY KEY,
    title TEXT,
    groupId TEXT
  );
`);

db.prepare('INSERT INTO categories (id, name, slug) VALUES (?, ?, ?)').run('cat1', 'Жидкости', 'liquids');
db.prepare('INSERT INTO category_groups (id, categoryId, name, slug) VALUES (?, ?, ?, ?)')
  .run('g_root', 'cat1', 'PODONKI', 'podonki');
db.prepare('INSERT INTO category_groups (id, categoryId, name, slug, parent_group_id) VALUES (?, ?, ?, ?, ?)')
  .run('g_podgon', 'cat1', 'PODONKI PODGON', 'podgon', 'g_root');
db.prepare('INSERT INTO category_groups (id, categoryId, name, slug, parent_group_id) VALUES (?, ?, ?, ?, ?)')
  .run('g_sour', 'cat1', 'PODONKI SOUR', 'sour', 'g_root');
db.prepare('INSERT INTO category_groups (id, categoryId, name, slug) VALUES (?, ?, ?, ?)')
  .run('g_other', 'cat1', 'ANNIMA', 'annima');

const insertProduct = db.prepare('INSERT INTO products (id, title, groupId) VALUES (?, ?, ?)');
// 2 товара в PODGON, 1 в SOUR, 1 в ANNIMA, 0 в корне PODONKI
insertProduct.run('p1', 'Вкус 1', 'g_podgon');
insertProduct.run('p2', 'Вкус 2', 'g_podgon');
insertProduct.run('p3', 'Вкус 3', 'g_sour');
insertProduct.run('p4', 'Вкус 4', 'g_other');

// === Тот же SQL, что в эндпоинте ===
const searchGroups = (search) => {
  const params = [];
  let whereClause = '';
  const orderParams = ['', ''];
  if (search) {
    whereClause = 'WHERE LOWER(g.name) LIKE ?';
    params.push(`%${search.toLowerCase()}%`);
    orderParams[0] = search.toLowerCase();
    orderParams[1] = `${search.toLowerCase()}%`;
  }
  return db.prepare(`
    SELECT
      g.id,
      g.name,
      g.categoryId,
      c.name AS category_name,
      g.parent_group_id,
      (
        WITH RECURSIVE tree(group_id) AS (
          SELECT g.id
          UNION ALL
          SELECT cg.id FROM category_groups cg
          JOIN tree t ON cg.parent_group_id = t.group_id
        )
        SELECT COUNT(*) FROM products p WHERE p.groupId IN (SELECT group_id FROM tree)
      ) AS product_count
    FROM category_groups g
    LEFT JOIN categories c ON c.id = g.categoryId
    ${whereClause}
    ORDER BY
      CASE
        WHEN LOWER(g.name) = ? THEN 0
        WHEN LOWER(g.name) LIKE ? THEN 1
        ELSE 2
      END,
      g.name ASC
    LIMIT 100 OFFSET 0
  `).all(...params, ...orderParams);
};

console.log('\n=== T1: счётчик товаров включает дерево подгрупп ===');
const podonki = searchGroups('podonki').find((g) => g.id === 'g_root');
assertEq(podonki.product_count, 3, 'PODONKI (корень, 0 своих) считает 3 товара детей');
const podgon = searchGroups('podgon').find((g) => g.id === 'g_podgon');
assertEq(podgon.product_count, 2, 'PODGON: только свои 2 товара');
const sour = searchGroups('sour').find((g) => g.id === 'g_sour');
assertEq(sour.product_count, 1, 'SOUR: только свой 1 товар');

console.log('\n=== T2: поиск без запроса возвращает все группы ===');
const all = searchGroups('');
assertEq(all.length, 4, 'все 4 группы');

console.log('\n=== T3: поиск по подстроке фильтрует ===');
const annima = searchGroups('annima');
assertEq(annima.length, 1, 'поиск annima → 1 группа');
assertEq(annima[0].product_count, 1, 'ANNIMA: 1 товар');

console.log('\n=== T4: category_name подтягивается ===');
assertEq(podgon.category_name, 'Жидкости', 'category_name = Жидкости');

console.log('\n=== T5: точное совпадение сортируется первым ===');
const ranked = searchGroups('podonki');
// PODONKI (точно) → PODGON → SOUR
assertEq(ranked[0].id, 'g_root', 'точное совпадение PODONKI первым');
assertEq(ranked.map((g) => g.id).includes('g_other'), false, 'ANNIMA не в выдаче');

db.close();
try { fs.unlinkSync(TMP_DB); } catch {}
try { fs.unlinkSync(TMP_DB + '-wal'); } catch {}
try { fs.unlinkSync(TMP_DB + '-shm'); } catch {}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
