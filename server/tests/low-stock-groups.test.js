/**
 * Low-stock groups: smoke tests.
 *
 * Покрывает:
 *   1. threshold > 0 → линейка попадает в плашку при totalStock < threshold
 *   2. threshold NULL/0 → плашка только при полном обнулении (с продуктами)
 *   3. Пустая линейка (без продуктов) → не попадает в плашку даже при threshold=NULL
 *   4. Активная пауза (3/5/20 дней) скрывает линейку из плашки
 *   5. resumeGroup возвращает линейку обратно
 *   6. getLowStockSummary совпадает по count с computeLowStockGroups
 *
 * Запуск: node server/tests/low-stock-groups.test.js
 */

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TMP_DB = path.resolve(__dirname, `./.tmp-lowstock-${Date.now()}.db`);
process.env.DATABASE_FILE = TMP_DB;

const { db, initDb } = await import('../db.js');
initDb();
const {
  PAUSE_REASONS,
  computeLowStockGroups,
  getGroupStockItems,
  getLowStockSummary,
  pauseGroup,
  resumeGroup,
  getActivePauseForGroup,
} = await import('../utils/low-stock-groups.js');

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

function setup() {
  // Чистим только relevant таблицы — оставляем миграции/схему
  db.exec(`DELETE FROM category_group_supply_pauses;`);
  db.exec(`DELETE FROM products;`);
  db.exec(`DELETE FROM category_groups;`);
  db.exec(`DELETE FROM categories;`);

  db.prepare(`INSERT INTO categories (id, slug, name, [order]) VALUES ('c_t', 'test', 'Test', 1)`).run();

  // g1 — threshold=10, products дают stock=8 → попадает (8 < 10)
  // g2 — threshold=5, products дают stock=10 → не попадает
  // g3 — threshold=NULL, всё обнулено → попадает (totalStock=0)
  // g4 — threshold=NULL, products дают stock=3 → не попадает
  // g5 — threshold=NULL, БЕЗ продуктов → не попадает (нет товара = просто пусто)
  const groups = [
    { id: 'g1', name: 'Linear One', threshold: 10 },
    { id: 'g2', name: 'Linear Two', threshold: 5 },
    { id: 'g3', name: 'Linear Three', threshold: null },
    { id: 'g4', name: 'Linear Four', threshold: null },
    { id: 'g5', name: 'Linear Five (empty)', threshold: null },
  ];
  groups.forEach((g, idx) => {
    db.prepare(
      `INSERT INTO category_groups
        (id, categoryId, slug, name, [order], hide_empty, min_stock_threshold)
       VALUES (?, 'c_t', ?, ?, ?, 1, ?)`
    ).run(g.id, g.id, g.name, idx + 1, g.threshold);
  });

  // Продукты
  const products = [
    { id: 'p_g1_a', groupId: 'g1', stock: 8 },
    { id: 'p_g2_a', groupId: 'g2', title: 'Много', stock: 8 },
    { id: 'p_g2_b', groupId: 'g2', title: 'Нет', stock: 0 },
    { id: 'p_g2_c', groupId: 'g2', title: 'Варианты', stock: 0, hasVariants: 1 },
    // У вариативного товара родительский stock не участвует в продаже.
    // Даже при битом/устаревшем значении без вариантов должен отображаться 0.
    { id: 'p_g2_d', groupId: 'g2', title: 'Без цветов', stock: 99, hasVariants: 1 },
    { id: 'p_g3_a', groupId: 'g3', stock: 0 },
    { id: 'p_g4_a', groupId: 'g4', stock: 3 },
    // g5 — без продуктов
  ];
  products.forEach((p) => {
    db.prepare(
      `INSERT INTO products (id, categoryId, groupId, title, priceRub, createdAt, stock, has_variants)
       VALUES (?, 'c_t', ?, ?, 10, DATETIME('now'), ?, ?)`
    ).run(p.id, p.groupId, p.title ?? 'test', p.stock, p.hasVariants ?? 0);
  });
  db.prepare(
    `INSERT INTO product_variants
       (id, product_id, name, stock, warehouse_stock, position)
     VALUES
       ('pv_g2_c_1', 'p_g2_c', 'Первый', 2, 0, 1),
       ('pv_g2_c_2', 'p_g2_c', 'Нулевой', 0, 50, 2),
       ('pv_g2_c_3', 'p_g2_c', '   ', 1, 0, 3)`,
  ).run();
}

function runTests() {
  console.log('=== Setup ===');
  setup();

  console.log('\n=== Test 1: threshold > 0, totalStock < threshold → попадает ===');
  const initial = computeLowStockGroups();
  const ids = initial.map((g) => g.id).sort();
  assertEq(JSON.stringify(ids), JSON.stringify(['g1', 'g3']),
    'в плашке только g1 (8<10) и g3 (zero stock with products)');

  const g1 = initial.find((g) => g.id === 'g1');
  assertEq(g1?.threshold, 10, 'g1.threshold = 10');
  assertEq(g1?.totalStock, 8, 'g1.totalStock = 8');

  const g3 = initial.find((g) => g.id === 'g3');
  assertEq(g3?.threshold, null, 'g3.threshold = null (порог не задан)');
  assertEq(g3?.totalStock, 0, 'g3.totalStock = 0');

  console.log('\n=== Test 1a: варианты идут отдельно от меньшего остатка к большему ===');
  const flavors = getGroupStockItems('g2');
  assertEq(JSON.stringify(flavors), JSON.stringify([
    { id: 'p_g2_d', name: 'Без цветов', stock: 0, warehouse_stock: 0 },
    { id: 'p_g2_b', name: 'Нет', stock: 0, warehouse_stock: 0 },
    // Розница пустая, а на складе запас: ради этого случая склад и показываем.
    { id: 'pv_g2_c_2', name: 'Нулевой', stock: 0, warehouse_stock: 50 },
    { id: 'pv_g2_c_3', name: 'Варианты', stock: 1, warehouse_stock: 0 },
    { id: 'pv_g2_c_1', name: 'Первый', stock: 2, warehouse_stock: 0 },
    { id: 'p_g2_a', name: 'Много', stock: 8, warehouse_stock: 0 },
  ]), 'цвета и обычные товары возвращаются отдельными строками');
  assertEq(flavors.find((item) => item.id === 'pv_g2_c_2')?.stock, 0,
    'складской остаток варианта не попадает в розничный список');
  assertEq(flavors.find((item) => item.id === 'p_g2_d')?.stock, 0,
    'родительский stock вариативного товара без цветов игнорируется');
  assertEq(flavors.find((item) => item.id === 'pv_g2_c_3')?.name, 'Варианты',
    'пустое название цвета заменяется названием товара');

  console.log('\n=== Test 2: getLowStockSummary совпадает с computeLowStockGroups ===');
  const summary = getLowStockSummary();
  assertEq(summary.hasAny, true, 'summary.hasAny=true');
  assertEq(summary.count, 2, 'summary.count=2');

  console.log('\n=== Test 3: пауза short (3 дня) скрывает g1 из плашки ===');
  const paused = pauseGroup({ groupId: 'g1', reason: 'short', byUser: 'test-admin' });
  assertEq(typeof paused?.id === 'number', true, 'pauseGroup вернул запись с id');
  assertEq(paused.pause_reason, 'short', 'pause_reason сохранён');

  const afterPause = computeLowStockGroups();
  const idsAfterPause = afterPause.map((g) => g.id);
  assertEq(idsAfterPause.includes('g1'), false, 'g1 скрыта после паузы');
  assertEq(idsAfterPause.includes('g3'), true, 'g3 остаётся (её не паузили)');
  assertEq(getLowStockSummary().count, 1, 'summary.count=1 после паузы g1');

  const activeForG1 = getActivePauseForGroup('g1');
  assertEq(activeForG1?.pause_reason, 'short', 'getActivePauseForGroup возвращает активную');

  console.log('\n=== Test 4: resumeGroup возвращает g1 в плашку ===');
  const resumed = resumeGroup('g1');
  assertEq(resumed >= 1, true, 'resumeGroup удалил >=1 запись');
  const afterResume = computeLowStockGroups();
  assertEq(afterResume.map((g) => g.id).includes('g1'), true, 'g1 снова в плашке');
  assertEq(getActivePauseForGroup('g1'), null, 'активной паузы у g1 больше нет');

  console.log('\n=== Test 5: пауза not_produced (20 дней) — самая длинная ===');
  pauseGroup({ groupId: 'g3', reason: 'not_produced' });
  const after3paused = computeLowStockGroups();
  assertEq(after3paused.find((g) => g.id === 'g3'), undefined, 'g3 скрыта после паузы not_produced');

  console.log('\n=== Test 6: невалидная reason → ошибка ===');
  let threw = false;
  try {
    pauseGroup({ groupId: 'g1', reason: 'bogus' });
  } catch (err) {
    threw = err.code === 'invalid_pause_reason';
  }
  assertEq(threw, true, 'pauseGroup({reason:"bogus"}) бросает invalid_pause_reason');

  console.log('\n=== Test 7: pause без groupId → ошибка ===');
  threw = false;
  try {
    pauseGroup({ reason: 'short' });
  } catch (err) {
    threw = err.code === 'group_id_required';
  }
  assertEq(threw, true, 'pauseGroup без groupId бросает group_id_required');

  console.log('\n=== Test 8: pause несуществующей линейки → ошибка ===');
  threw = false;
  try {
    pauseGroup({ groupId: 'g_nonexistent', reason: 'short' });
  } catch (err) {
    threw = err.code === 'group_not_found';
  }
  assertEq(threw, true, 'pauseGroup({groupId:"g_nonexistent"}) бросает group_not_found');

  console.log('\n=== Test 9: PAUSE_REASONS — три ключа с правильными днями ===');
  assertEq(PAUSE_REASONS.short.days, 3, 'short = 3 дня');
  assertEq(PAUSE_REASONS.no_supply.days, 5, 'no_supply = 5 дней');
  assertEq(PAUSE_REASONS.not_produced.days, 20, 'not_produced = 20 дней');

  console.log('\n=== Test 10: g5 (пустая, без продуктов) никогда не попадает ===');
  const finalList = computeLowStockGroups();
  assertEq(finalList.find((g) => g.id === 'g5'), undefined, 'g5 не появилась в плашке (пустая линейка)');

  console.log('\n=== Test 11: Сортировка — «заканчивается» сверху, «закончилось» внизу ===');
  // Снимем все паузы и проверим сортировку.
  // По фидбэку Кости 08.05.2026: «то что заканчивается должно быть выше
  // чем то что закончилось» — успеваем дозаказать пока есть продажи.
  resumeGroup('g1');
  resumeGroup('g3');
  // Сейчас в плашке: g1 (totalStock=8, threshold=10 — «заканчивается»),
  // g3 (totalStock=0 — «закончилось»). Ожидаем g1 раньше g3.
  const sorted = computeLowStockGroups();
  assertEq(sorted[0].id, 'g1', '«заканчивается» (g1: 8/10) идёт ПЕРВЫМ');
  assertEq(sorted[1].id, 'g3', '«закончилось» (g3: 0) идёт ПОСЛЕ');

  console.log('\n=== Test 12: повторный pauseGroup НЕ плодит дублей в БД ===');
  // Симуляция двойного клика: 5 подряд pauseGroup для одной линейки
  for (let i = 0; i < 5; i++) {
    pauseGroup({ groupId: 'g1', reason: 'short', byUser: `user-${i}` });
  }
  const pauseRows = db.prepare(
    'SELECT COUNT(*) AS n FROM category_group_supply_pauses WHERE group_id = ?'
  ).get('g1');
  assertEq(pauseRows.n, 1, 'после 5 pauseGroup в БД ровно 1 строка');
  // Самая последняя пауза — с byUser='user-4'
  const latest = db.prepare(
    `SELECT paused_by FROM category_group_supply_pauses
      WHERE group_id = ? ORDER BY id DESC LIMIT 1`
  ).get('g1');
  assertEq(latest.paused_by, 'user-4', 'осталась самая последняя (user-4)');

  console.log('\n=== Test 13: getLowStockSummary совпадает с computeLowStockGroups.length ===');
  // Сейчас g1 спаузена, g3 спаузена → в плашке должна быть только g3 (которую снимали),
  // но на самом деле и g3 и g1 спаузены. Проверим инвариант "summary = list.length"
  // на рабочем состоянии.
  resumeGroup('g1');
  resumeGroup('g3');
  // Спаузим только g1
  pauseGroup({ groupId: 'g1', reason: 'short' });
  const fullList = computeLowStockGroups();
  const sum = getLowStockSummary();
  assertEq(sum.count, fullList.length, 'summary.count == computeLowStockGroups().length');
  assertEq(sum.hasAny, fullList.length > 0, 'summary.hasAny корректен');

  console.log('\n=== Test 14: hasCoverImage — boolean, cover_image НЕ передаётся ===');
  resumeGroup('g1');
  // Проставим cover_image для g3, чтобы проверить has_cover_image
  db.prepare(`UPDATE category_groups SET cover_image = ? WHERE id = ?`).run('https://example.com/p.jpg', 'g3');
  const withCover = computeLowStockGroups();
  const g3item = withCover.find((g) => g.id === 'g3');
  assertEq(g3item?.hasCoverImage, true, 'g3 имеет hasCoverImage=true');
  assertEq('cover_image' in (g3item || {}), false, 'поле cover_image отсутствует в payload (lazy-load)');
  // Очистим обратно
  db.prepare(`UPDATE category_groups SET cover_image = NULL WHERE id = ?`).run('g3');
  const withoutCover = computeLowStockGroups();
  const g3item2 = withoutCover.find((g) => g.id === 'g3');
  assertEq(g3item2?.hasCoverImage, false, 'g3 без cover → hasCoverImage=false');
}

try {
  runTests();
  console.log(`\n=== Total: ${results.passed} passed, ${results.failed} failed ===`);
  if (results.failed === 0) {
    console.log('low-stock-groups.test.js passed');
  }
} finally {
  // Cleanup tmp DB + sidecar файлы (WAL mode оставляет .db-shm и .db-wal).
  // Важно: cleanup идёт ПЕРЕД process.exit — иначе при падении теста файлы
  // остаются висеть в server/tests/ (process.exit не выполняет finally).
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
