import { db } from '../db.js';

function columnExists(table, column) {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`
      )
      .get(column)
  );
}

export function migrateProductListIndexes() {
  console.log('[migration] Ensuring product list indexes...');

  try {
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_products_category
      ON products(categoryId)
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_products_group
      ON products(groupId)
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_products_created_at
      ON products(createdAt)
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_products_price
      ON products(priceRub)
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_category_groups_slug
      ON category_groups(slug)
    `).run();

    if (columnExists('product_images', 'variant_id')) {
      db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_product_images_product_variant
        ON product_images(productId, variant_id, position)
      `).run();
    }

    console.log('[migration] Product list indexes ensured');
  } catch (error) {
    console.error('[migration] Failed to ensure product list indexes:', error);
    throw error;
  }
}
