import { db } from '../db.js';

export function migrateCategoryGroupMetaFields() {
  try {
    const columns = db.prepare(`PRAGMA table_info(category_groups)`).all();
    const hasMetaLabel = columns.some((col) => col.name === 'meta_label');
    const hasMetaValue = columns.some((col) => col.name === 'meta_value');

    if (!hasMetaLabel) {
      db.exec(`
        ALTER TABLE category_groups
        ADD COLUMN meta_label TEXT;
      `);
      console.log('[migration] Added meta_label to category_groups table');
    }

    if (!hasMetaValue) {
      db.exec(`
        ALTER TABLE category_groups
        ADD COLUMN meta_value TEXT;
      `);
      console.log('[migration] Added meta_value to category_groups table');
    }
  } catch (error) {
    console.error('[migration] Failed to add meta fields to category_groups:', error);
    throw error;
  }
}
