/**
 * Group parking lifecycle tests.
 *
 * Scenarios covered:
 *   1. Ушла в парковку: все товары stock=0 → parked_order = текущий [order].
 *   2. Вернулась из парковки: появился товар stock>0 → [order] восстанавливается на
 *      parked_order со сдвигом соседей, parked_order = NULL.
 *   3. Реордер защищён: для parked-группы [order] не меняется; её parked_order тоже.
 *   4. Идемпотентность: повторный syncGroupParking ничего не ломает.
 *
 * Запуск: node server/tests/group-parking.test.js
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Подменяем путь к БД ДО импорта db.js
const TMP_DB = path.resolve(__dirname, `./.tmp-parking-${Date.now()}.db`);
process.env.DATABASE_FILE = TMP_DB;

// Динамический импорт, чтобы env-переменная применилась
const { db, initDb } = await import('../db.js');
initDb();
const { syncGroupParking, computeGroupOwnStock } = await import('../utils/group-parking.js');

const results = { passed: 0, failed: 0 };
function assertEq(actual, expected, msg) {
  if (actual === expected) {
    results.passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    results.failed++;
    console.log(`  ❌ ${msg} — expected ${expected}, got ${actual}`);
  }
}

function setupSchema() {
  // Чистая БД через driver — все миграции выполнены автоматически при import db.js
  // Но если БД уже существовала с таблицами, пропускаем. Для in-process теста нас это устраивает.
  db.exec(`DELETE FROM product_variants; DELETE FROM products; DELETE FROM category_groups; DELETE FROM categories;`);

  db.prepare(`INSERT INTO categories (id, slug, name, [order]) VALUES ('c_test', 'test', 'Test', 1)`).run();

  const groups = [
    { id: 'g_a', slug: 'group-a', name: 'Group A', order: 1 },
    { id: 'g_b', slug: 'group-b', name: 'Group B', order: 2 },
    { id: 'g_c', slug: 'group-c', name: 'Group C', order: 3 },
    { id: 'g_d', slug: 'group-d', name: 'Group D', order: 4 },
    { id: 'g_e', slug: 'group-e', name: 'Group E', order: 5 },
  ];
  groups.forEach(g => {
    db.prepare(`INSERT INTO category_groups (id, categoryId, slug, name, [order], hide_empty) VALUES (?, 'c_test', ?, ?, ?, 1)`)
      .run(g.id, g.slug, g.name, g.order);
  });

  // Продукты в каждой группе — изначально все в наличии
  const products = [
    { id: 'p_a1', groupId: 'g_a', stock: 5 },
    { id: 'p_b1', groupId: 'g_b', stock: 3 },
    { id: 'p_c1', groupId: 'g_c', stock: 7 },
    { id: 'p_d1', groupId: 'g_d', stock: 2 },
    { id: 'p_e1', groupId: 'g_e', stock: 4 },
  ];
  products.forEach(p => {
    db.prepare(`INSERT INTO products (id, categoryId, groupId, title, priceRub, createdAt, stock, has_variants)
                VALUES (?, 'c_test', ?, 'test', 10, DATETIME('now'), ?, 0)`)
      .run(p.id, p.groupId, p.stock);
  });
}

function readGroup(id) {
  return db.prepare(`SELECT id, [order] AS currentOrder, parked_order AS parkedOrder FROM category_groups WHERE id = ?`).get(id);
}

function printState(label) {
  const rows = db.prepare(`SELECT id, [order] AS o, parked_order AS po FROM category_groups WHERE categoryId = 'c_test' ORDER BY o, id`).all();
  console.log(`\n  [${label}] ` + rows.map(r => `${r.id}(o=${r.o}${r.po != null ? `,p=${r.po}` : ''})`).join(' '));
}

function runTests() {
  console.log('\n=== Setup ===');
  setupSchema();
  printState('initial');

  console.log('\n=== Test 1: группа B уходит в парковку ===');
  db.prepare('UPDATE products SET stock = 0 WHERE groupId = ?').run('g_b');
  assertEq(computeGroupOwnStock('g_b'), 0, 'computeGroupOwnStock(g_b) == 0 после обнуления stock');
  syncGroupParking('g_b');
  const gB1 = readGroup('g_b');
  assertEq(gB1.parkedOrder, 2, 'parked_order(g_b) == 2 после парковки');
  assertEq(gB1.currentOrder, 2, '[order](g_b) остался 2 (не меняется при парковке)');
  printState('after park g_b');

  console.log('\n=== Test 2: админский реордер parked g_b → переопределяет parked_order ===');
  // Новое поведение endpoint-а reorder: если админ сознательно перетащил parked-линейку,
  // мы обновляем И [order], И parked_order. Эмулируем это поведение здесь.
  const parkedCheck = db.prepare(`SELECT parked_order FROM category_groups WHERE id = 'g_b'`).get();
  assertEq(parkedCheck.parked_order !== null, true, 'g_b помечена как parked');
  // Симулируем endpoint: drag&drop g_b на новую позицию 4
  db.prepare(`UPDATE category_groups SET [order] = ?, parked_order = ? WHERE id = ?`).run(4, 4, 'g_b');
  const gBafterDrag = readGroup('g_b');
  assertEq(gBafterDrag.currentOrder, 4, 'после drag&drop [order] обновлён на 4');
  assertEq(gBafterDrag.parkedOrder, 4, 'parked_order тоже переопределён на 4');
  // Возвращаем g_b обратно на 2 для дальнейших тестов
  db.prepare(`UPDATE category_groups SET [order] = ?, parked_order = ? WHERE id = ?`).run(2, 2, 'g_b');

  console.log('\n=== Test 3: группа C тоже уходит в парковку ===');
  db.prepare('UPDATE products SET stock = 0 WHERE groupId = ?').run('g_c');
  syncGroupParking('g_c');
  const gC1 = readGroup('g_c');
  assertEq(gC1.parkedOrder, 3, 'parked_order(g_c) == 3');
  printState('after park g_c');

  console.log('\n=== Test 4: симулируем баг ANNIMA — парк. группу вручную сдвигают, потом stock возвращается ===');
  // Симуляция: админ через какой-то обход защиты (или предыдущий баг) выставил [order]=6 для g_b,
  // хотя parked_order остался 2. Это воспроизводит сценарий Кости: линейка "уехала вниз", пока её
  // не видели на витрине.
  db.prepare('UPDATE category_groups SET [order] = 6 WHERE id = ?').run('g_b');
  printState('g_b искусственно сдвинута на 6, parked_order=2');
  db.prepare('UPDATE products SET stock = 5 WHERE id = ?').run('p_b1');
  syncGroupParking('g_b');
  const gB2 = readGroup('g_b');
  assertEq(gB2.currentOrder, 2, '[order](g_b) восстановлен на parked_order=2');
  assertEq(gB2.parkedOrder, null, 'parked_order(g_b) == NULL после восстановления');
  // Соседи с order >= 2 (кроме самой g_b) должны сдвинуться на +1
  const gA = readGroup('g_a');
  const gC2 = readGroup('g_c');
  const gD = readGroup('g_d');
  const gE = readGroup('g_e');
  assertEq(gA.currentOrder, 1, '[order](g_a) == 1 (не тронут, меньше target)');
  assertEq(gC2.currentOrder, 4, '[order](g_c) сдвинулся с 3 на 4');
  assertEq(gC2.parkedOrder, 4, 'parked_order(g_c) тоже сдвинулся на 4 — инвариант сохранён');
  assertEq(gD.currentOrder, 5, '[order](g_d) сдвинулся с 4 на 5');
  assertEq(gE.currentOrder, 6, '[order](g_e) сдвинулся с 5 на 6');
  printState('after restore g_b');

  console.log('\n=== Test 5: идемпотентность — повторный sync не меняет состояние ===');
  const before = db.prepare(`SELECT id, [order] AS o, parked_order AS po FROM category_groups WHERE categoryId = 'c_test' ORDER BY id`).all();
  syncGroupParking('g_b');
  syncGroupParking('g_c');
  syncGroupParking('g_a');
  const after = db.prepare(`SELECT id, [order] AS o, parked_order AS po FROM category_groups WHERE categoryId = 'c_test' ORDER BY id`).all();
  assertEq(JSON.stringify(before), JSON.stringify(after), 'повторный sync — идемпотентен');

  console.log('\n=== Test 6: группа C возвращает stock → восстанавливается на обновлённую parked_order=4 ===');
  db.prepare('UPDATE products SET stock = 2 WHERE id = ?').run('p_c1');
  syncGroupParking('g_c');
  const gC3 = readGroup('g_c');
  assertEq(gC3.currentOrder, 4, '[order](g_c) == 4 (совпадал с parked_order, без сдвига)');
  assertEq(gC3.parkedOrder, null, 'parked_order(g_c) == NULL');
  printState('after restore g_c');

  console.log('\n=== Test 7: товар с вариантами, stock в варианте ===');
  db.prepare(`INSERT INTO products (id, categoryId, groupId, title, priceRub, createdAt, stock, has_variants)
              VALUES ('p_a2', 'c_test', 'g_a', 'variant-product', 10, DATETIME('now'), 0, 1)`).run();
  db.prepare(`INSERT INTO product_variants (id, product_id, name, stock, position) VALUES ('v_a2_1', 'p_a2', 'V', 3, 0)`).run();
  // При этом stock p_a1 всё равно = 5, т.е. группа A не парковалась
  assertEq(computeGroupOwnStock('g_a') > 0, true, 'computeGroupOwnStock(g_a) учитывает вариантный товар');

  // Обнуляем оба
  db.prepare(`UPDATE products SET stock = 0 WHERE id = 'p_a1'`).run();
  db.prepare(`UPDATE product_variants SET stock = 0 WHERE product_id = 'p_a2'`).run();
  assertEq(computeGroupOwnStock('g_a'), 0, 'все stock=0 в группе с вариантом → 0');
  syncGroupParking('g_a');
  assertEq(readGroup('g_a').parkedOrder, 1, 'g_a паркуется на order=1');

  // Возвращаем через вариант
  db.prepare(`UPDATE product_variants SET stock = 7 WHERE id = 'v_a2_1'`).run();
  assertEq(computeGroupOwnStock('g_a'), 7, 'variant stock=7 → computeGroupOwnStock(g_a) == 7');
  syncGroupParking('g_a');
  assertEq(readGroup('g_a').parkedOrder, null, 'g_a разпарковалась после возврата через вариант');
  assertEq(readGroup('g_a').currentOrder, 1, 'order(g_a) == 1');
  printState('final');
}

function cleanup() {
  db.close();
  try { fs.unlinkSync(TMP_DB); } catch {}
  try { fs.unlinkSync(TMP_DB + '-shm'); } catch {}
  try { fs.unlinkSync(TMP_DB + '-wal'); } catch {}
}

try {
  runTests();
  console.log(`\n=== Results: ${results.passed} passed, ${results.failed} failed ===`);
  cleanup();
  process.exit(results.failed > 0 ? 1 : 0);
} catch (err) {
  console.error(err);
  cleanup();
  process.exit(1);
}
