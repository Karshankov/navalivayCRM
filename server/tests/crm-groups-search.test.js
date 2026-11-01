/**
 * Тесты логики поиска линеек для «добавить всю линейку» в закупку.
 *
 * Проверяет (той же JS-логикой, что в эндпоинте
 * GET /api/admin/crm/groups/search):
 *   1. Регистронезависимый поиск по подстроке, включая кириллицу
 *      (SQLite LOWER() без ICU кириллицу не переводит — история бага
 *      с линейкой «ПРИЗРАК»).
 *   2. Счётчик товаров с деревом вложенных подгрупп.
 *   3. Сортировку: точное совпадение → префикс → остальное.
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

function assert(cond, label, actual, expected) {
  if (cond) { passed++; console.log(`  ✅ ${label}`); }
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
// Кириллица ЗАГЛАВНЫМИ — воспроизводит баг «ПРИЗРАК» на проде.
db.prepare('INSERT INTO category_groups (id, categoryId, name, slug) VALUES (?, ?, ?, ?)')
  .run('g_ghost', 'cat1', 'ПРИЗРАК', 'prizrak');

const insertProduct = db.prepare('INSERT INTO products (id, title, groupId) VALUES (?, ?, ?)');
insertProduct.run('p1', 'Вкус 1', 'g_podgon');
insertProduct.run('p2', 'Вкус 2', 'g_podgon');
insertProduct.run('p3', 'Вкус 3', 'g_sour');
insertProduct.run('p4', 'Вкус 4', 'g_other');
insertProduct.run('p5', 'Вкус 5', 'g_ghost');

// === Та же JS-логика, что в эндпоинте ===
function buildSearch(db_) {
  const groupRows = db_.prepare('SELECT id, name, slug, categoryId, parent_group_id FROM category_groups').all();
  const categoryNames = new Map(
    db_.prepare('SELECT id, name FROM categories').all().map((row) => [String(row.id), row.name]),
  );
  const productCounts = db_.prepare('SELECT groupId, COUNT(*) AS count FROM products GROUP BY groupId').all();

  const childrenByParent = new Map();
  for (const row of groupRows) {
    if (row.parent_group_id) {
      if (!childrenByParent.has(row.parent_group_id)) childrenByParent.set(row.parent_group_id, []);
      childrenByParent.get(row.parent_group_id).push(String(row.id));
    }
  }
  const ownCount = new Map(productCounts.map((row) => [String(row.groupId), Number(row.count ?? 0)]));

  const subtreeCount = (groupId) => {
    const seen = new Set();
    const stack = [groupId];
    let total = 0;
    while (stack.length) {
      const current = stack.pop();
      if (seen.has(current)) continue;
      seen.add(current);
      total += ownCount.get(current) ?? 0;
      for (const child of childrenByParent.get(current) ?? []) {
        if (!seen.has(child)) stack.push(child);
      }
    }
    return total;
  };

  const all = groupRows.map((row) => ({
    id: String(row.id),
    name: row.name,
    slug: row.slug ?? null,
    categoryId: String(row.categoryId ?? ''),
    categoryName: categoryNames.get(String(row.categoryId ?? '')) ?? null,
    parentGroupId: row.parent_group_id ?? null,
    productCount: subtreeCount(String(row.id)),
  }));

  return (search, { limit = 100, offset = 0 } = {}) => {
    const searchLower = search.trim().toLowerCase();
    let matches = all;
    if (searchLower) {
      matches = matches.filter((group) => group.name.toLowerCase().includes(searchLower));
      matches.sort((a, b) => {
        const aName = a.name.toLowerCase();
        const bName = b.name.toLowerCase();
        const rank = (name) => (name === searchLower ? 0 : name.startsWith(searchLower) ? 1 : 2);
        const rankDiff = rank(aName) - rank(bName);
        return rankDiff !== 0 ? rankDiff : a.name.localeCompare(b.name);
      });
    }
    return matches.slice(offset, offset + limit);
  };
}

const searchGroups = buildSearch(db);

console.log('\n=== T1: счётчик товаров включает дерево подгрупп ===');
const podonki = searchGroups('podonki').find((g) => g.id === 'g_root');
assert(podonki.productCount === 3, 'PODONKI (корень, 0 своих) считает 3 товара детей', podonki?.productCount, 3);
const podgon = searchGroups('podgon').find((g) => g.id === 'g_podgon');
assert(podgon.productCount === 2, 'PODGON: только свои 2 товара', podgon?.productCount, 2);

console.log('\n=== T2: КИРИЛЛИЦА ЗАГЛАВНЫМИ находит поиск в нижнем регистре (баг ПРИЗРАК) ===');
const ghosts = searchGroups('призрак');
assert(ghosts.length === 1 && ghosts[0].id === 'g_ghost', 'поиск «призрак» находит «ПРИЗРАК»', ghosts.map((g) => g.id), ['g_ghost']);
assert(ghosts[0]?.productCount === 1, 'ПРИЗРАК: 1 товар', ghosts[0]?.productCount, 1);
const ghostsMixed = searchGroups('Призрак');
assert(ghostsMixed.length === 1, 'поиск «Призрак» (смешанный регистр) тоже находит', ghostsMixed.length, 1);

console.log('\n=== T3: поиск без запроса возвращает все группы ===');
assert(searchGroups('').length === 5, 'все 5 групп', searchGroups('').length, 5);

console.log('\n=== T4: точное совпадение сортируется первым ===');
const ranked = searchGroups('podonki');
assert(ranked[0].id === 'g_root', 'точное совпадение PODONKI первым', ranked[0]?.id, 'g_root');
assert(!ranked.map((g) => g.id).includes('g_other'), 'ANNIMA не в выдаче', ranked.map((g) => g.id).includes('g_other'), false);

console.log('\n=== T5: offset/limit работают ===');
const page = searchGroups('', { limit: 2, offset: 3 });
assert(page.length === 2, 'страница из 2 после offset 3', page.length, 2);

db.close();
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.unlinkSync(TMP_DB + suffix); } catch {}
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
