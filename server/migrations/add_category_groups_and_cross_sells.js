import { db } from '../db.js'

function tableExists(tableName) {
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(tableName)
  return !!row
}

function columnExists(tableName, columnName) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all()
  return columns.some(col => col.name === columnName)
}

export function migrateCategoryGroupsAndCrossSells() {
  try {
    if (!tableExists('category_groups')) {
      console.log('[migration] Creating category_groups table...')
      db.prepare(`
        CREATE TABLE IF NOT EXISTS category_groups (
          id TEXT PRIMARY KEY,
          categoryId TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
          slug TEXT NOT NULL,
          name TEXT NOT NULL,
          cover_image TEXT,
          [order] INTEGER NOT NULL DEFAULT 0,
          hide_empty INTEGER NOT NULL DEFAULT 0,
          createdAt TEXT NOT NULL DEFAULT (DATETIME('now')),
          updatedAt TEXT NOT NULL DEFAULT (DATETIME('now')),
          UNIQUE(categoryId, slug)
        )
      `).run()
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_category_groups_category ON category_groups(categoryId)`).run()
    }

    if (!columnExists('products', 'groupId')) {
      console.log('[migration] Adding groupId column to products table...')
      db.prepare(`ALTER TABLE products ADD COLUMN groupId TEXT REFERENCES category_groups(id)`).run()
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_products_group ON products(groupId)`).run()
    }

    if (!tableExists('category_cross_sells')) {
      console.log('[migration] Creating category_cross_sells table...')
      db.prepare(`
        CREATE TABLE IF NOT EXISTS category_cross_sells (
          id TEXT PRIMARY KEY,
          categoryId TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
          productId TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          [order] INTEGER NOT NULL DEFAULT 0,
          UNIQUE(categoryId, productId)
        )
      `).run()
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_cross_sells_category ON category_cross_sells(categoryId)`).run()
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_cross_sells_product ON category_cross_sells(productId)`).run()
    }
  } catch (error) {
    console.error('[migration] Failed to migrate category groups/cross-sells:', error)
    throw error
  }
}
