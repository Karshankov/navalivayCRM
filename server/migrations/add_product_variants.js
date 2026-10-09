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

function tableExists(name) {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`
      )
      .get(name)
  );
}

/**
 * Добавляет систему вариантов товаров (например, цвета для устройств).
 * - Создает таблицу product_variants для хранения вариантов
 * - Добавляет поле variant_id в product_images для привязки изображений к вариантам
 * - Добавляет флаг has_variants в products для товаров с вариантами
 */
export function migrateProductVariants() {
  console.log('[migration] Starting product variants migration...');

  try {
    // 1. Добавляем флаг has_variants в таблицу products
    if (!columnExists('products', 'has_variants')) {
      console.log('[migration] Adding has_variants column to products table...');
      db.prepare(`
        ALTER TABLE products
        ADD COLUMN has_variants INTEGER NOT NULL DEFAULT 0
      `).run();
      console.log('[migration] has_variants column added successfully');
    }

    // 2. Создаем таблицу product_variants
    if (!tableExists('product_variants')) {
      console.log('[migration] Creating product_variants table...');
      db.prepare(`
        CREATE TABLE IF NOT EXISTS product_variants (
          id TEXT PRIMARY KEY,
          product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          color_code TEXT,
          price_rub INTEGER,
          stock INTEGER DEFAULT 0,
          position INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
          UNIQUE(product_id, name)
        )
      `).run();
      console.log('[migration] product_variants table created successfully');

      // Создаем индекс для быстрого поиска вариантов по товару
      db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_product_variants_product
        ON product_variants(product_id)
      `).run();
      console.log('[migration] Index on product_variants created');
    }

    // 3. Добавляем поле variant_id в product_images для привязки изображений к вариантам
    if (!columnExists('product_images', 'variant_id')) {
      console.log('[migration] Adding variant_id column to product_images table...');
      
      // SQLite не поддерживает ADD COLUMN с REFERENCES, поэтому делаем в два шага
      db.prepare(`
        ALTER TABLE product_images
        ADD COLUMN variant_id TEXT
      `).run();
      console.log('[migration] variant_id column added to product_images');

      // Создаем индекс для variant_id
      db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_product_images_variant
        ON product_images(variant_id)
      `).run();
      console.log('[migration] Index on product_images(variant_id) created');
    }

    console.log('[migration] Product variants migration completed successfully');
  } catch (error) {
    console.error('[migration] Failed to migrate product variants:', error);
    throw error;
  }
}
