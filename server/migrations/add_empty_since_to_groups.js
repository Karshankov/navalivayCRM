import { db } from '../db.js';

export function migrateEmptySinceToGroups() {
  try {
    const columns = db.prepare(`PRAGMA table_info(category_groups)`).all();
    const hasEmptySinceColumn = columns.some((col) => col.name === 'empty_since');

    if (!hasEmptySinceColumn) {
      db.exec(`
        ALTER TABLE category_groups
        ADD COLUMN empty_since TEXT DEFAULT NULL;
      `);
      console.log('[migration] Added empty_since to category_groups table');
    }

    console.log('[migration] empty_since column check complete');
  } catch (error) {
    console.error('[migration] Failed to add empty_since column:', error);
    throw error;
  }
}
