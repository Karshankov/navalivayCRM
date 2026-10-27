/**
 * Кандидаты на пополнение полки (значок «!» на экране заказов): smoke-тесты.
 *
 * Покрывает:
 *   1. Порог: розница 0 шт при складе > 0 → в списке; розница 1–2 шт → нет
 *   2. Складской остаток 0 → позиция не попадает (перемещать нечего)
 *   3. Товары с вариантами — отдельной строкой на каждый вкус, родительский
 *      остаток не используется
 *   4. Пустое имя вкуса заменяется названием товара
 *   5. Товар без линейки попадает в псевдогруппу «Без линейки» (в конце)
 *   6. Черновик склад → розница помечает позицию; оприходованный черновик и
 *      обратное направление — не помечают
 *   7. summary согласован с полным списком
 *   8. Отрицательный остаток в рознице считается «закончилось»
 *   9. Отменённый черновик не помечает позицию
 *  10. Склад NULL не даёт кандидата; товар без флага вариантов не дублируется
 *      строками вкусов
 *  11. Категория группы берётся у линейки, а не у товара
 *  12. Порог срабатывания значка: меняется через settings, кэш сбрасывается
 *
 * Запуск: node server/tests/restock-candidates.test.js
 */

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TMP_DB = path.resolve(__dirname, `./.tmp-restock-${Date.now()}.db`);
process.env.DATABASE_FILE = TMP_DB;

const { db, initDb } = await import('../db.js');
initDb();
const {
  RESTOCK_RETAIL_MAX_STOCK,
  RESTOCK_MIN_VARIANTS_DEFAULT,
  computeRestockCandidates,
  getRestockCandidatesSummary,
  getRestockMinVariants,
  setRestockMinVariants,
  invalidateRestockCache,
} = await import('../utils/restock-candidates.js');

const results = { passed: 0, failed: 0 };
function assertEq(actual, expected, msg) {
  if (actual === expected) {
    results.passed++;
    console.log(`  OK: ${msg}`);
  } else {
    results.failed++;
    console.log(`  FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function insertProduct({ id, groupId = null, title = 'Товар', stock = 0, warehouse = 0, hasVariants = 0 }) {
  db.prepare(
    `INSERT INTO products
       (id, categoryId, groupId, title, priceRub, createdAt, stock, warehouse_stock, has_variants)
     VALUES (?, 'c_t', ?, ?, 10, DATETIME('now'), ?, ?, ?)`,
  ).run(id, groupId, title, stock, warehouse, hasVariants);
}

function insertTransfer({ id, number, status = 'draft', source = 'warehouse', destination = 'retail', items = [] }) {
  db.prepare(
    `INSERT INTO stock_transfers
       (id, transfer_number, source_location, destination_location, status, created_at)
     VALUES (?, ?, ?, ?, ?, DATETIME('now'))`,
  ).run(id, number, source, destination, status);
  items.forEach((item, index) => {
    db.prepare(
      `INSERT INTO stock_transfer_items
         (id, transfer_id, product_id, variant_id, product_title, variant_name, quantity)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(`${id}_item_${index}`, id, item.productId, item.variantId ?? null, 'Товар', null, 1);
  });
}

function setup() {
  db.exec('DELETE FROM stock_transfer_items;');
  db.exec('DELETE FROM stock_transfers;');
  db.exec('DELETE FROM product_variants;');
  db.exec('DELETE FROM products;');
  db.exec('DELETE FROM category_groups;');
  db.exec('DELETE FROM categories;');

  db.prepare(`INSERT INTO categories (id, slug, name, [order]) VALUES ('c_t', 'test', 'Test', 1)`).run();
  db.prepare(
    `INSERT INTO category_groups (id, categoryId, slug, name, [order], hide_empty)
     VALUES ('g1', 'c_t', 'g1', 'Linear One', 1, 1)`,
  ).run();
  db.prepare(
    `INSERT INTO category_groups (id, categoryId, slug, name, [order], hide_empty)
     VALUES ('g2', 'c_t', 'g2', 'Linear Two', 2, 1)`,
  ).run();

  // g1
  insertProduct({ id: 'p_zero', groupId: 'g1', title: 'Закончился', stock: 0, warehouse: 5 });
  // Перемещение по этому товару уже оприходовали — розница снова пустая.
  insertProduct({ id: 'p_done', groupId: 'g1', title: 'Оприходовано', stock: 0, warehouse: 6 });
  // Розница не пуста: при пороге 0 такие позиции в список не идут.
  insertProduct({ id: 'p_two', groupId: 'g1', title: 'Почти', stock: 2, warehouse: 7 });
  insertProduct({ id: 'p_three', groupId: 'g1', title: 'Ещё есть', stock: 3, warehouse: 9 });
  insertProduct({ id: 'p_no_warehouse', groupId: 'g1', title: 'Без склада', stock: 0, warehouse: 0 });

  // g2: обычный товар с NULL-остатком и товар с вариантами
  insertProduct({ id: 'p_null', groupId: 'g2', title: 'Нулл', stock: 0, warehouse: 4 });
  db.prepare(`UPDATE products SET stock = NULL WHERE id = 'p_null'`).run();
  insertProduct({ id: 'p_var', groupId: 'g2', title: 'Варианты', stock: 0, warehouse: 99, hasVariants: 1 });
  // Вариативный товар без единого варианта: продавать нечего, в список не идёт.
  insertProduct({ id: 'p_var_empty', groupId: 'g2', title: 'Без вкусов', stock: 0, warehouse: 10, hasVariants: 1 });

  db.prepare(
    `INSERT INTO product_variants (id, product_id, name, stock, warehouse_stock, position)
     VALUES
       ('v_zero', 'p_var', 'Нулевой', 0, 3, 1),
       ('v_two', 'p_var', 'Почти', 2, 8, 2),
       ('v_low_wh', 'p_var', 'Без склада', 1, 0, 3),
       ('v_blank', 'p_var', '   ', 0, 6, 4)`,
  ).run();

  // Товар вне линеек — не должен потеряться.
  insertProduct({ id: 'p_ungrouped', groupId: null, title: 'Без линейки', stock: 0, warehouse: 2 });

  // Черновик склад → розница (№1) и более свежий черновик (№5) на тот же товар.
  insertTransfer({ id: 't1', number: 1, items: [{ productId: 'p_zero' }] });
  insertTransfer({ id: 't5', number: 5, items: [{ productId: 'p_zero' }] });
  // Оприходованное перемещение не считается «в заявке».
  insertTransfer({ id: 't2', number: 2, status: 'completed', items: [{ productId: 'p_done' }] });
  // Обратное направление не помечает позицию.
  insertTransfer({
    id: 't3',
    number: 3,
    source: 'retail',
    destination: 'warehouse',
    items: [{ productId: 'p_ungrouped' }],
  });
  insertTransfer({ id: 't4', number: 4, items: [{ productId: 'p_var', variantId: 'v_zero' }] });
}

function flatten(groups) {
  return groups.flatMap((group) => group.items);
}

function runTests() {
  console.log('=== Setup ===');
  setup();

  console.log('\n=== Test 1: порог и склад ===');
  const list = computeRestockCandidates();
  assertEq(RESTOCK_RETAIL_MAX_STOCK, 0, 'порог розницы = 0');
  assertEq(list.threshold, 0, 'payload.threshold = 0');

  const keys = flatten(list.groups).map((item) => item.key).sort();
  assertEq(
    JSON.stringify(keys),
    JSON.stringify([
      'p_done:',
      'p_null:',
      'p_ungrouped:',
      // Товар с вариантами показывается только строками вкусов.
      'p_var:v_blank',
      'p_var:v_zero',
      'p_zero:',
    ]),
    'в списке только позиции с пустой розницей и запасом на складе',
  );
  assertEq(keys.includes('p_two:'), false, 'розница 2 шт не попадает');
  assertEq(keys.includes('p_var:v_two'), false, 'вкус с розницей 2 шт не попадает');
  assertEq(keys.includes('p_var:v_low_wh'), false, 'вкус с розницей 1 шт не попадает');
  assertEq(keys.includes('p_three:'), false, 'розница 3 шт не попадает');
  assertEq(keys.includes('p_no_warehouse:'), false, 'позиция без склада не попадает');
  assertEq(keys.includes('p_var_empty:'), false, 'вариативный товар без вкусов не попадает');

  console.log('\n=== Test 2: значения остатков и имена ===');
  const items = flatten(list.groups);
  const byKey = new Map(items.map((item) => [item.key, item]));
  assertEq(byKey.get('p_null:')?.retailStock, 0, 'NULL в рознице считается нулём');
  assertEq(byKey.get('p_null:')?.warehouseStock, 4, 'склад p_null = 4');
  assertEq(byKey.get('p_var:v_blank')?.displayName, 'Варианты', 'пустое имя вкуса заменено названием товара');
  assertEq(byKey.get('p_var:v_blank')?.variantName, null, 'пустой variantName = null');
  assertEq(byKey.get('p_var:v_zero')?.productTitle, 'Варианты', 'productTitle сохранён для формы перемещения');
  assertEq(byKey.get('p_var:v_zero')?.groupId, 'g2', 'groupId вкуса берётся у товара');

  console.log('\n=== Test 3: группировка, порядок и итоги ===');
  assertEq(
    list.groups.map((group) => group.name).join('|'),
    'Linear Two|Linear One|Без линейки',
    'группы: больше позиций выше, «Без линейки» в конце',
  );
  assertEq(list.groups[1].items.map((item) => item.key).join(','), 'p_done:,p_zero:',
    'внутри группы склад по убыванию');
  assertEq(list.groups[0].items.map((item) => item.key).join(','), 'p_var:v_blank,p_null:,p_var:v_zero',
    'внутри g2 склад по убыванию, при равенстве — по имени');
  assertEq(list.totals.itemCount, 6, 'всего 6 позиций');
  assertEq(list.totals.groupCount, 3, '3 группы');
  assertEq(list.totals.draftItemCount, 2, '2 позиции уже в черновиках');

  console.log('\n=== Test 4: черновики ===');
  assertEq(byKey.get('p_zero:')?.draftTransferNumber, 5, 'у p_zero самый свежий черновик №5');
  assertEq(byKey.get('p_var:v_zero')?.draftTransferId, 't4', 'v_zero помечен черновиком t4');
  assertEq(byKey.get('p_done:')?.draftTransferNumber, null, 'оприходованное перемещение не помечает');
  assertEq(byKey.get('p_ungrouped:')?.draftTransferNumber, null, 'обратное направление не помечает');
  assertEq(byKey.get('p_var:v_blank')?.draftTransferNumber, null, 'позиция без черновика не помечена');

  console.log('\n=== Test 5: summary согласован с полным списком ===');
  const summary = getRestockCandidatesSummary();
  assertEq(summary.hasAny, true, 'summary.hasAny=true');
  assertEq(summary.itemCount, list.totals.itemCount, 'summary.itemCount = totals.itemCount');
  assertEq(summary.groupCount, list.totals.groupCount, 'summary.groupCount = totals.groupCount');
  assertEq(summary.draftItemCount, list.totals.draftItemCount, 'summary.draftItemCount = totals.draftItemCount');

  console.log('\n=== Test 6: отрицательный остаток в рознице — это «закончилось» ===');
  insertProduct({ id: 'p_negative', groupId: 'g1', title: 'Минус', stock: -3, warehouse: 5 });
  invalidateRestockCache();
  const withNegative = computeRestockCandidates();
  const negative = flatten(withNegative.groups).find((item) => item.key === 'p_negative:');
  assertEq(negative?.retailStock, -3, 'отрицательный остаток вернулся как есть');
  assertEq(negative?.warehouseStock, 5, 'склад отрицательной позиции = 5');
  assertEq(getRestockCandidatesSummary().itemCount, list.totals.itemCount + 1, 'summary учитывает новую позицию');
  db.prepare(`DELETE FROM products WHERE id = 'p_negative'`).run();
  invalidateRestockCache();

  console.log('\n=== Test 7: пустая база — значка нет ===');
  db.exec('DELETE FROM stock_transfer_items;');
  db.exec('DELETE FROM stock_transfers;');
  db.exec('DELETE FROM product_variants;');
  db.exec('DELETE FROM products;');
  invalidateRestockCache();
  const empty = computeRestockCandidates();
  assertEq(empty.groups.length, 0, 'список групп пуст');
  assertEq(empty.totals.itemCount, 0, 'позиций нет');
  const emptySummary = getRestockCandidatesSummary();
  assertEq(emptySummary.hasAny, false, 'summary.hasAny=false');
  assertEq(emptySummary.itemCount, 0, 'summary.itemCount=0');
  assertEq(emptySummary.groupCount, 0, 'summary.groupCount=0');
  assertEq(emptySummary.draftItemCount, 0, 'summary.draftItemCount=0');

  console.log('\n=== Test 8: отменённый черновик не помечает позицию ===');
  // Заявку могли отменить — тогда вкус снова свободен и должен попасть в список.
  insertProduct({ id: 'p_cancelled', groupId: 'g1', title: 'Отменённая', stock: 0, warehouse: 4 });
  insertTransfer({ id: 't_cancelled', number: 9, status: 'cancelled', items: [{ productId: 'p_cancelled' }] });
  insertTransfer({ id: 't_active', number: 10, items: [{ productId: 'p_cancelled' }] });
  const cancelledDrafts = flatten(computeRestockCandidates().groups);
  assertEq(
    cancelledDrafts.find((item) => item.key === 'p_cancelled:')?.draftTransferNumber,
    10,
    'учитывается только действующий черновик, а не отменённый',
  );
  db.exec('DELETE FROM stock_transfer_items;');
  db.exec('DELETE FROM stock_transfers;');
  const onlyCancelled = flatten(computeRestockCandidates().groups);
  assertEq(
    onlyCancelled.find((item) => item.key === 'p_cancelled:')?.draftTransferId,
    null,
    'отменённая заявка не помечает позицию',
  );
  db.prepare(`DELETE FROM products WHERE id = 'p_cancelled'`).run();
  invalidateRestockCache();

  console.log('\n=== Test 9: товар без флага вариантов, но со строками вкусов ===');
  // has_variants = 0, а строки вкусов есть: считаем товар целиком, без дублей.
  insertProduct({ id: 'p_plain', groupId: 'g1', title: 'Без флага', stock: 0, warehouse: 6, hasVariants: 0 });
  db.prepare(
    `INSERT INTO product_variants (id, product_id, name, stock, warehouse_stock, position)
     VALUES ('v_plain', 'p_plain', 'Строка без флага', 0, 9, 1)`,
  ).run();
  invalidateRestockCache();
  const edgeItems = flatten(computeRestockCandidates().groups);
  const plainRows = edgeItems.filter((item) => item.productId === 'p_plain');
  assertEq(plainRows.length, 1, 'товар без флага вариантов даёт одну строку, без дублей по вкусам');
  assertEq(plainRows[0].key, 'p_plain:', 'строка товара, а не варианта');
  assertEq(plainRows[0].warehouseStock, 6, 'остаток берётся у товара, а не у строки вкуса');
  db.prepare(`DELETE FROM products WHERE id = 'p_plain'`).run();

  console.log('\n=== Test 10: категория группы берётся у линейки ===');
  // У линейки ровно одна категория. Если брать категорию у товара, заголовок
  // группы показывал бы случайную категорию из первой попавшейся позиции.
  db.prepare(`INSERT INTO categories (id, slug, name, [order]) VALUES ('c_other', 'other', 'Другая', 2)`).run();
  db.prepare(
    `INSERT INTO category_groups (id, categoryId, slug, name, [order], hide_empty)
     VALUES ('g_cat', 'c_t', 'g_cat', 'Линейка с категорией', 3, 1)`,
  ).run();
  insertProduct({ id: 'p_foreign_cat', groupId: 'g_cat', title: 'Чужая категория', stock: 0, warehouse: 3 });
  db.prepare(`UPDATE products SET categoryId = 'c_other' WHERE id = 'p_foreign_cat'`).run();
  invalidateRestockCache();
  const catGroup = computeRestockCandidates().groups.find((group) => group.id === 'g_cat');
  assertEq(catGroup?.categoryName, 'Test', 'категория группы = категория линейки, а не товара');
  db.prepare(`DELETE FROM products WHERE id = 'p_foreign_cat'`).run();
  db.prepare(`DELETE FROM category_groups WHERE id = 'g_cat'`).run();

  console.log('\n=== Test 11: порог срабатывания значка ===');
  // Готовим три позиции, чтобы проверить границу порога ровно на числе.
  db.exec('DELETE FROM products;');
  invalidateRestockCache();
  insertProduct({ id: 'p_a', title: 'Вкус A', stock: 0, warehouse: 3 });
  insertProduct({ id: 'p_b', title: 'Вкус B', stock: 0, warehouse: 3 });
  insertProduct({ id: 'p_c', title: 'Вкус C', stock: 0, warehouse: 3 });

  setRestockMinVariants(0);
  assertEq(getRestockMinVariants(), 0, 'порог по умолчанию 0');
  let sum = getRestockCandidatesSummary();
  assertEq(sum.itemCount, 3, 'в списке 3 позиции');
  assertEq(sum.triggered, true, 'при пороге 0 значок горит');

  setRestockMinVariants(3);
  sum = getRestockCandidatesSummary();
  assertEq(sum.minVariants, 3, 'порог сохранён в настройках');
  assertEq(sum.triggered, true, 'порог 3 при 3 позициях — срабатывает');

  setRestockMinVariants(4);
  sum = getRestockCandidatesSummary();
  assertEq(sum.triggered, false, 'порог 4 при 3 позициях — не срабатывает');

  setRestockMinVariants(2);
  assertEq(computeRestockCandidates().triggered, true, 'полный список тоже отдаёт triggered');
  assertEq(computeRestockCandidates().minVariants, 2, 'полный список отдаёт minVariants');

  // Кэш отдаёт снимок до сброса и пересчитывает после.
  invalidateRestockCache();
  assertEq(getRestockCandidatesSummary().itemCount, 3, 'кэш заполнен актуальным составом');
  insertProduct({ id: 'p_d', title: 'Вкус D', stock: 0, warehouse: 1 });
  assertEq(getRestockCandidatesSummary().itemCount, 3, 'без сброса кэша отдаётся прежний результат');
  invalidateRestockCache();
  assertEq(getRestockCandidatesSummary().itemCount, 4, 'после сброса кэша список пересчитан');

  // Некорректные значения не должны ломать настройку.
  let invalidRejected = false;
  try {
    setRestockMinVariants(-1);
  } catch (error) {
    invalidRejected = error.code === 'invalid_restock_min_variants';
  }
  assertEq(invalidRejected, true, 'отрицательный порог отклонён');
  assertEq(getRestockMinVariants(), 2, 'после ошибки порог остался прежним');

  assertEq(
    RESTOCK_MIN_VARIANTS_DEFAULT,
    0,
    'порог по умолчанию = 0 (любая непустая розница зажигает значок)',
  );
  setRestockMinVariants(RESTOCK_MIN_VARIANTS_DEFAULT);
}

try {
  runTests();
  console.log(`\n=== Total: ${results.passed} passed, ${results.failed} failed ===`);
  if (results.failed === 0) {
    console.log('restock-candidates.test.js passed');
  }
} finally {
  // Cleanup идёт до process.exit: иначе при падении файлы остаются висеть.
  try {
    db.close();
  } catch {}
  for (const p of [TMP_DB, `${TMP_DB}-shm`, `${TMP_DB}-wal`]) {
    try {
      fs.unlinkSync(p);
    } catch {}
  }
  if (results.failed > 0) {
    process.exit(1);
  }
}