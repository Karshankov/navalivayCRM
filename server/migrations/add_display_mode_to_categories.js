import { db } from '../db.js'

export function migrateCategoryDisplayMode() {
  const hasColumn = db.prepare(`
    SELECT 1
    FROM pragma_table_info('categories')
    WHERE name = 'display_mode'
  `).get()

  if (!hasColumn) {
    db.prepare(`
      ALTER TABLE categories
      ADD COLUMN display_mode TEXT NOT NULL DEFAULT 'default'
    `).run()
  }

  // Normalize existing rows to the default mode if null
  db.prepare(`
    UPDATE categories
    SET display_mode = 'default'
    WHERE display_mode IS NULL OR TRIM(display_mode) = ''
  `).run()
}
