/**
 * Order line pricing scenarios (prod-like).
 * Run: node server/tests/order-line-pricing.test.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navalivay-order-line-pricing-'));
process.env.DATABASE_FILE = path.join(tempDir, 'test.db');
process.env.NODE_ENV = 'test';

const { initDb, db } = await import('../db.js');
const {
  resolveOrderLinePrice,
  sumOrderLinePrices,
  sumReviewLineItemTotals,
} = await import('../utils/order-line-pricing.js');

initDb();

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

function seedCatalog() {
  db.exec('DELETE FROM product_variants;');
  db.exec('DELETE FROM products;');
  db.exec('DELETE FROM category_groups;');
  db.exec('DELETE FROM categories;');

  db.prepare(
    `INSERT INTO categories (id, slug, name, [order], hide_empty, storefront_filters_profile)
     VALUES ('cat_snus', 'snus', 'Снюс', 1, 0, 'snus'),
            ('cat_dev', 'devices', 'Устройства', 2, 0, 'devices')`,
  ).run();

  db.prepare(
    `INSERT INTO category_groups (id, categoryId, slug, name, [order], hide_empty, createdAt, updatedAt)
     VALUES ('grp_snus', 'cat_snus', 'iceberg', 'ICEBERG 150', 1, 0, DATETIME('now'), DATETIME('now')),
            ('grp_xros', 'cat_dev', 'xros5', 'XROS 5 MINI', 1, 0, DATETIME('now'), DATETIME('now'))`,
  ).run();

  db.prepare(
    `INSERT INTO products (id, categoryId, groupId, title, priceRub, description, stock, has_variants, createdAt)
     VALUES ('prod_snus', 'cat_snus', 'grp_snus', 'Хвоя', 15, '', 5, 0, DATETIME('now')),
            ('prod_xros', 'cat_dev', 'grp_xros', 'XROS 5 MINI', 0, '', 5, 1, DATETIME('now'))`,
  ).run();

  db.prepare(
    `INSERT INTO product_variants (id, product_id, name, price_rub, stock, position, created_at)
     VALUES ('var_xros_red', 'prod_xros', 'Rose red', 75, 3, 0, DATETIME('now')),
            ('var_xros_blue', 'prod_xros', 'Sky blue', 75, 2, 1, DATETIME('now'))`,
  ).run();
}

console.log('\n--- resolveOrderLinePrice: catalog rows ---');
{
  seedCatalog();

  const snus = resolveOrderLinePrice(db, 'prod_snus');
  ok(snus.price_rub === 15, 'snus uses product priceRub');
  ok(snus.variant_id == null, 'snus has no variant');

  const deviceById = resolveOrderLinePrice(db, 'prod_xros', { variantId: 'var_xros_red' });
  ok(deviceById.price_rub === 75, 'device uses variant price by id');
  ok(deviceById.variant_name === 'Rose red', 'device resolves variant name by id');

  const deviceByName = resolveOrderLinePrice(db, 'prod_xros', { variantName: 'Sky blue' });
  ok(deviceByName.price_rub === 75, 'device uses variant price by name');
  ok(deviceByName.variant_id === 'var_xros_blue', 'device resolves variant id by name');

  let missingVariant = false;
  try {
    resolveOrderLinePrice(db, 'prod_xros', { variantName: 'Missing color' });
  } catch (error) {
    missingVariant = /Вариант не найден/.test(error.message);
  }
  ok(missingVariant, 'missing variant throws');

  const lines = [
    resolveOrderLinePrice(db, 'prod_snus'),
    resolveOrderLinePrice(db, 'prod_xros', { variantId: 'var_xros_red' }),
  ];
  ok(sumOrderLinePrices(lines) === 90, 'mixed order total is 90 BYN');
}

console.log('\n--- resolveOrderLinePrice: variant price fallback ---');
{
  seedCatalog();
  db.prepare(`UPDATE product_variants SET price_rub = 0 WHERE id = 'var_xros_red'`).run();
  db.prepare(`UPDATE products SET priceRub = 10 WHERE id = 'prod_xros'`).run();

  const line = resolveOrderLinePrice(db, 'prod_xros', { variantId: 'var_xros_red' });
  ok(line.price_rub === 10, 'zero variant price keeps base product price');
}

console.log('\n--- sumReviewLineItemTotals: UI line amount scenarios ---');
{
  ok(sumReviewLineItemTotals([{ total_price: 15 }]) === 15, 'single snus line');
  ok(
    sumReviewLineItemTotals([{ total_price: 75 }]) === 75,
    'device line with correct stored total',
  );
  ok(
    sumReviewLineItemTotals([{ total_price: 0 }]) === 0,
    'legacy bad row with zero total stays zero until data fixed',
  );
  ok(
    sumReviewLineItemTotals([
      { total_price: 25 },
      { total_price: 10 },
    ]) === 35,
    'multiple items in one review group sum together',
  );
}

console.log(`\nDone: ${results.passed} passed, ${results.failed} failed\n`);
process.exit(results.failed > 0 ? 1 : 0);