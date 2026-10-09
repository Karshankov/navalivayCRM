import { db } from '../db.js';

export function migrateOpenInNewTabToBanners() {
  try {
    // Check if openInNewTab column already exists
    const tableInfo = db.prepare("PRAGMA table_info(banners)").all();
    const openInNewTabColumnExists = tableInfo.some(column => column.name === 'openInNewTab');
    
    if (!openInNewTabColumnExists) {
      console.log('[migration] Adding openInNewTab column to banners table');
      db.exec('ALTER TABLE banners ADD COLUMN openInNewTab INTEGER NOT NULL DEFAULT 0');
      console.log('[migration] Successfully added openInNewTab column to banners table');
    } else {
      console.log('[migration] openInNewTab column already exists in banners table');
    }
  } catch (error) {
    console.error('[migration] Failed to add openInNewTab column to banners table:', error);
    throw error;
  }
}