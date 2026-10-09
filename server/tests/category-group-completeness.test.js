/**
 * Category group completeness — unit tests (regression + adversarial).
 * Запуск: node server/tests/category-group-completeness.test.js
 */
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TMP_DB = path.resolve(__dirname, `./.tmp-completeness-${Date.now()}.db`);
process.env.DATABASE_FILE = TMP_DB;

const { db, initDb } = await import('../db.js');
initDb();

const {
  computeIncompleteGroups,
  getIncompleteGroupsSummary,
  evaluateGroupCompleteness,
  updateGroupCompletenessWaivers,
  normalizeWaiverInput,
} = await import('../utils/category-group-completeness.js');
const { getActiveWholesaleTiers, getBulkGroupWholesalePrices } = await import('../wholesale-service.js');

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

function assertDeepEq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) {
    results.passed++;
    console.log(`  OK: ${msg}`);
  } else {
    results.failed++;
    console.log(`  FAIL: ${msg} — expected ${b}, got ${a}`);
  }
}

function resetTables() {
  db.exec('DELETE FROM category_group_wholesale_prices;');
  db.exec('DELETE FROM products;');
  db.exec('DELETE FROM category_groups;');
  db.exec('DELETE FROM categories;');
}

function seedCategory(id = 'c_t', name = 'Test Cat', profile = 'none') {
  db.prepare(
    `INSERT INTO categories (id, slug, name, [order], storefront_filters_profile)
     VALUES (?, 'test', ?, 1, ?)`,
  ).run(id, name, profile);
}

function seedGroup({
  id,
  name,
  metaValue = null,
  threshold = null,
  waiveDescription = 0,
  waiveMinStock = 0,
  waiveWholesale = 0,
  waiveStrengthTier = 0,
  strengthTier = null,
  categoryId = 'c_t',
}) {
  db.prepare(
    `INSERT INTO category_groups
      (id, categoryId, slug, name, [order], hide_empty, meta_value, min_stock_threshold,
       waive_description, waive_min_stock, waive_wholesale, waive_strength_tier, strength_tier,
       createdAt, updatedAt)
     VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?, ?, DATETIME('now'), DATETIME('now'))`,
  ).run(
    id,
    categoryId,
    id,
    name,
    metaValue,
    threshold,
    waiveDescription,
    waiveMinStock,
    waiveWholesale,
    waiveStrengthTier,
    strengthTier,
  );
}

function seedProduct(id, groupId, stock = 5) {
  db.prepare(
    `INSERT INTO products (id, categoryId, groupId, title, priceRub, stock, min_stock, createdAt)
     VALUES (?, 'c_t', ?, ?, 10, ?, 0, DATETIME('now'))`,
  ).run(id, groupId, `Product ${id}`, stock);
}

function seedWholesalePrices(groupId, pricesByCode) {
  const tiers = getActiveWholesaleTiers();
  const tierByCode = new Map(tiers.map((t) => [t.code, t.id]));
  const stmt = db.prepare(
    `INSERT INTO category_group_wholesale_prices (group_id, tier_id, price_byn, created_at, updated_at)
     VALUES (?, ?, ?, DATETIME('now'), DATETIME('now'))`,
  );
  for (const [code, price] of Object.entries(pricesByCode)) {
    const tierId = tierByCode.get(String(code));
    if (tierId) {
      stmt.run(groupId, tierId, price);
    }
  }
}

function allTierCodes() {
  return getActiveWholesaleTiers().map((t) => t.code);
}

function fullWholesalePrices(price = 5) {
  const result = {};
  allTierCodes().forEach((code) => {
    result[code] = price;
  });
  return result;
}

resetTables();
seedCategory();

console.log('\n=== R1: все поля заполнены → не в списке ===');
{
  resetTables();
  seedCategory();
  seedGroup({ id: 'g_ok', name: 'Complete', metaValue: '60 mg', threshold: 10 });
  seedProduct('p1', 'g_ok');
  seedWholesalePrices('g_ok', fullWholesalePrices());
  assertEq(computeIncompleteGroups().length, 0, 'complete group excluded');
}

console.log('\n=== R2: пустой meta_value → missing description ===');
{
  resetTables();
  seedCategory();
  seedGroup({ id: 'g_desc', name: 'No desc', threshold: 10 });
  seedProduct('p1', 'g_desc');
  seedWholesalePrices('g_desc', fullWholesalePrices());
  const items = computeIncompleteGroups();
  assertEq(items.length, 1, 'one incomplete');
  assertDeepEq(items[0].missingFields, ['description'], 'only description missing');
}

console.log('\n=== R3: min_stock_threshold NULL → missing min_stock ===');
{
  resetTables();
  seedCategory();
  seedGroup({ id: 'g_stock', name: 'No stock', metaValue: '50 mg' });
  seedProduct('p1', 'g_stock');
  seedWholesalePrices('g_stock', fullWholesalePrices());
  const items = computeIncompleteGroups();
  assertEq(items[0].missingFields.includes('min_stock'), true, 'min_stock missing');
}

console.log('\n=== R4: неполный опт → missing wholesale + tier list ===');
{
  resetTables();
  seedCategory();
  seedGroup({ id: 'g_wholesale', name: 'Partial opt', metaValue: '40 mg', threshold: 5 });
  seedProduct('p1', 'g_wholesale');
  const codes = allTierCodes();
  const partial = { [codes[0]]: 10 };
  seedWholesalePrices('g_wholesale', partial);
  const items = computeIncompleteGroups();
  assertEq(items[0].missingFields.includes('wholesale'), true, 'wholesale missing');
  assertEq(items[0].missingWholesaleTiers.length, codes.length - 1, 'missing tier codes');
  assertEq(items[0].wholesaleFilledCount, 1, 'one tier filled');
}

console.log('\n=== R5: waive_description → описание не блокирует ===');
{
  resetTables();
  seedCategory();
  seedGroup({
    id: 'g_waive_desc',
    name: 'Waived desc',
    threshold: 10,
    waiveDescription: 1,
  });
  seedProduct('p1', 'g_waive_desc');
  seedWholesalePrices('g_waive_desc', fullWholesalePrices());
  const items = computeIncompleteGroups();
  assertEq(items.length, 0, 'waived description + rest filled → complete');
}

console.log('\n=== R6: все waived + пусто → не в списке ===');
{
  resetTables();
  seedCategory();
  seedGroup({
    id: 'g_all_waived',
    name: 'All waived',
    waiveDescription: 1,
    waiveMinStock: 1,
    waiveWholesale: 1,
  });
  seedProduct('p1', 'g_all_waived');
  assertEq(computeIncompleteGroups().length, 0, 'all waived → not listed');
}

console.log('\n=== R7: summary.count === items.length ===');
{
  resetTables();
  seedCategory();
  seedGroup({ id: 'g_a', name: 'A' });
  seedGroup({ id: 'g_b', name: 'B', metaValue: 'x', threshold: 1 });
  seedProduct('p_a', 'g_a');
  seedProduct('p_b', 'g_b');
  const items = computeIncompleteGroups();
  const summary = getIncompleteGroupsSummary();
  assertEq(summary.count, items.length, 'summary matches list');
  assertEq(summary.hasAny, items.length > 0, 'hasAny true');
}

console.log('\n=== R8: заполнение поля → исчезает из списка ===');
{
  resetTables();
  seedCategory();
  seedGroup({ id: 'g_fill', name: 'Fill me', threshold: 10 });
  seedProduct('p1', 'g_fill');
  seedWholesalePrices('g_fill', fullWholesalePrices());
  assertEq(computeIncompleteGroups().length, 1, 'starts incomplete');
  db.prepare(`UPDATE category_groups SET meta_value = ? WHERE id = ?`).run('70 mg', 'g_fill');
  assertEq(computeIncompleteGroups().length, 0, 'complete after meta_value');
}

console.log('\n=== A1: линейка без продуктов → в списке с productCount 0 ===');
{
  resetTables();
  seedCategory();
  seedGroup({ id: 'g_empty', name: 'Empty line', threshold: 10 });
  const items = computeIncompleteGroups();
  assertEq(items.length, 1, 'empty line with missing fields listed');
  assertEq(items[0].productCount, 0, 'productCount is 0');
}

console.log('\n=== A1b: пустая линейка полностью waived → не в списке ===');
{
  resetTables();
  seedCategory();
  seedGroup({
    id: 'g_empty_ok',
    name: 'Empty waived',
    waiveDescription: 1,
    waiveMinStock: 1,
    waiveWholesale: 1,
  });
  assertEq(computeIncompleteGroups().length, 0, 'empty + all waived → skip');
}

console.log('\n=== A2: meta_value из пробелов → empty ===');
{
  resetTables();
  seedCategory();
  seedGroup({ id: 'g_spaces', name: 'Spaces', metaValue: '   ', threshold: 5 });
  seedProduct('p1', 'g_spaces');
  seedWholesalePrices('g_spaces', fullWholesalePrices());
  const items = computeIncompleteGroups();
  assertEq(items[0].missingFields.includes('description'), true, 'whitespace = empty');
}

console.log('\n=== A3: wholesale price 0 / negative → not counted ===');
{
  resetTables();
  seedCategory();
  seedGroup({ id: 'g_bad_price', name: 'Bad price', metaValue: 'x', threshold: 1 });
  seedProduct('p1', 'g_bad_price');
  const codes = allTierCodes();
  const bad = {};
  codes.forEach((code, idx) => {
    bad[code] = idx === 0 ? 10 : 0;
  });
  seedWholesalePrices('g_bad_price', bad);
  const items = computeIncompleteGroups();
  assertEq(items[0].missingWholesaleTiers.length >= 1, true, 'zero prices missing');
}

console.log('\n=== A4: unknown tier code in save ignored (evaluate still uses active tiers) ===');
{
  resetTables();
  seedCategory();
  seedGroup({ id: 'g_tiers', name: 'Tiers', metaValue: 'x', threshold: 1 });
  seedProduct('p1', 'g_tiers');
  seedWholesalePrices('g_tiers', fullWholesalePrices());
  const tiers = getActiveWholesaleTiers();
  const row = db.prepare('SELECT * FROM category_groups WHERE id = ?').get('g_tiers');
  row.group_id = row.id;
  const evalResult = evaluateGroupCompleteness(
    row,
    tiers,
    getBulkGroupWholesalePrices(['g_tiers']),
  );
  assertEq(evalResult.isComplete, true, 'known tiers complete');
}

console.log('\n=== A5: double PATCH waiver idempotent ===');
{
  resetTables();
  seedCategory();
  seedGroup({ id: 'g_patch', name: 'Patch' });
  updateGroupCompletenessWaivers('g_patch', { waiveDescription: true });
  updateGroupCompletenessWaivers('g_patch', { waiveDescription: true });
  const row = db.prepare('SELECT waive_description FROM category_groups WHERE id = ?').get('g_patch');
  assertEq(Number(row.waive_description), 1, 'still waived once');
}

console.log('\n=== A6: waiver на несуществующую группу → group_not_found ===');
{
  let threw = false;
  try {
    updateGroupCompletenessWaivers('g_missing', { waiveDescription: true });
  } catch (err) {
    threw = err.code === 'group_not_found';
  }
  assertEq(threw, true, 'group_not_found thrown');
}

console.log('\n=== A7: invalid waiver type → invalid_waiver_value ===');
{
  let threw = false;
  try {
    normalizeWaiverInput('yes');
  } catch (err) {
    threw = err.code === 'invalid_waiver_value';
  }
  assertEq(threw, true, 'invalid_waiver_value thrown');
}

console.log('\n=== A8: продукт только на дочерней — parent-контейнер не в списке ===');
{
  resetTables();
  seedCategory();
  seedGroup({ id: 'g_parent', name: 'Parent' });
  seedGroup({ id: 'g_child', name: 'Child', parentId: null });
  db.prepare(`UPDATE category_groups SET parent_group_id = ? WHERE id = ?`).run('g_parent', 'g_child');
  seedProduct('p_child', 'g_child');
  const byId = new Map(computeIncompleteGroups().map((i) => [i.id, i]));
  assertEq(byId.has('g_child'), true, 'child with product listed');
  assertEq(byId.has('g_parent'), false, 'parent container without direct products skipped');
}

console.log('\n=== A9: liquids profile requires strength_tier ===');
{
  resetTables();
  seedCategory('c_liq', 'Liquids', 'liquids');
  seedGroup({
    id: 'g_no_strength',
    name: 'No strength',
    categoryId: 'c_liq',
    metaValue: '60 mg',
    threshold: 10,
    waiveWholesale: 1,
  });
  const item = computeIncompleteGroups().find((row) => row.id === 'g_no_strength');
  assertEq(item?.missingFields.includes('strength_tier'), true, 'missing strength_tier flagged');
}

console.log('\n=== A10: strength_tier waiver clears liquids requirement ===');
{
  resetTables();
  seedCategory('c_liq', 'Liquids', 'liquids');
  seedGroup({
    id: 'g_waived_strength',
    name: 'Waived strength',
    categoryId: 'c_liq',
    metaValue: '60 mg',
    threshold: 10,
    waiveWholesale: 1,
    waiveStrengthTier: 1,
  });
  const item = computeIncompleteGroups().find((row) => row.id === 'g_waived_strength');
  assertEq(item, undefined, 'waived strength_tier not incomplete');
}

console.log(`\n=== Results: ${results.passed} passed, ${results.failed} failed ===`);
try {
  fs.unlinkSync(TMP_DB);
} catch {
  // ignore
}
if (results.failed > 0) {
  process.exit(1);
}