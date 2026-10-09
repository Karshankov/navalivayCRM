import { db } from '../db.js';

export function migrateCategoryGroupHierarchy() {
  try {
    const columns = db.prepare(`PRAGMA table_info(category_groups)`).all();
    const hasParentColumn = columns.some((col) => col.name === 'parent_group_id');

    if (!hasParentColumn) {
      db.exec(`
        ALTER TABLE category_groups
        ADD COLUMN parent_group_id TEXT REFERENCES category_groups(id) ON DELETE SET NULL;
      `);
      console.log('[migration] Added parent_group_id to category_groups table');
    }

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_category_groups_parent
      ON category_groups(parent_group_id);
    `);

    console.log('[migration] Ensured idx_category_groups_parent index');
  } catch (error) {
    console.error('[migration] Failed to add parent_group_id column:', error);
    throw error;
  }
}
