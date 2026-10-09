import { db } from '../db.js';

export function migrateManagerActionFields() {
  try {
    const columns = db.prepare(`PRAGMA table_info(orders)`).all();
    const columnNames = columns.map((col) => col.name);

    if (!columnNames.includes('needs_manager_action')) {
      console.log('[migration] Adding needs_manager_action column to orders table');
      db.exec(`ALTER TABLE orders ADD COLUMN needs_manager_action INTEGER DEFAULT 0`);
    }

    if (!columnNames.includes('manager_action_type')) {
      console.log('[migration] Adding manager_action_type column to orders table');
      db.exec(`ALTER TABLE orders ADD COLUMN manager_action_type TEXT`);
    }

    if (!columnNames.includes('manager_action_note')) {
      console.log('[migration] Adding manager_action_note column to orders table');
      db.exec(`ALTER TABLE orders ADD COLUMN manager_action_note TEXT`);
    }

    if (!columnNames.includes('manager_action_resolved_at')) {
      console.log('[migration] Adding manager_action_resolved_at column to orders table');
      db.exec(`ALTER TABLE orders ADD COLUMN manager_action_resolved_at TEXT`);
    }

    console.log('[migration] Manager action fields migration completed successfully');
  } catch (error) {
    console.error('[migration] Manager action fields migration failed:', error);
    if (!String(error.message).includes('duplicate column name')) {
      throw error;
    }
  }
}
