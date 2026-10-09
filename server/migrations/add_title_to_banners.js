import { db } from '../db.js';

export function migrateTitleToBanners() {
  try {
    // Check if title column already exists
    const tableInfo = db.prepare("PRAGMA table_info(banners)").all();
    const titleColumnExists = tableInfo.some(column => column.name === 'title');
    
    if (!titleColumnExists) {
      console.log('[migration] Adding title column to banners table');
      db.exec('ALTER TABLE banners ADD COLUMN title TEXT');
      console.log('[migration] Successfully added title column to banners table');
    } else {
      console.log('[migration] Title column already exists in banners table');
    }
  } catch (error) {
    console.error('[migration] Failed to add title column to banners table:', error);
    throw error;
  }
}