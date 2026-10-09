import { db } from '../db.js'

function columnExists(table, column) {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`
      )
      .get(column)
  )
}

function tableExists(name) {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`
      )
      .get(name)
  )
}

export function migrateProductBadges() {
  if (!columnExists('products', 'variant')) {
    db.prepare(`ALTER TABLE products ADD COLUMN variant TEXT`).run()
  }

  if (!columnExists('products', 'strength')) {
    db.prepare(`ALTER TABLE products ADD COLUMN strength TEXT`).run()
  }

  if (!columnExists('products', 'cost_price')) {
    db.prepare(`ALTER TABLE products ADD COLUMN cost_price REAL DEFAULT 0`).run()
  }

  if (!columnExists('products', 'stock')) {
    db.prepare(`ALTER TABLE products ADD COLUMN stock INTEGER DEFAULT 0`).run()
  }

  if (!columnExists('products', 'min_stock')) {
    db.prepare(`ALTER TABLE products ADD COLUMN min_stock INTEGER DEFAULT 0`).run()
  }

  if (!tableExists('product_badges')) {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS product_badges (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        type TEXT,
        label TEXT,
        color TEXT,
        created_at TEXT NOT NULL DEFAULT (DATETIME('now'))
      )
    `).run()
  }

  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_product_badges_product
    ON product_badges(product_id)
  `).run()
}
