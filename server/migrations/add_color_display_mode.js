import { db } from '../db.js';

export function migrateColorDisplayMode() {
  // Check if column already exists
  const columns = db.prepare("PRAGMA table_info(product_variants)").all();
  const hasColumn = columns.some(col => col.name === 'color_display_mode');
  
  if (!hasColumn) {
    console.log('[migration] Adding color_display_mode column to product_variants');
    db.exec(`
      ALTER TABLE product_variants 
      ADD COLUMN color_display_mode TEXT DEFAULT 'color'
    `);
    
    // Check if color_image column exists before trying to use it
    const hasColorImage = columns.some(col => col.name === 'color_image');
    
    if (hasColorImage) {
      // Set mode based on existing data: if color_image exists, set to 'image', otherwise 'color'
      db.exec(`
        UPDATE product_variants 
        SET color_display_mode = CASE 
          WHEN color_image IS NOT NULL AND color_image != '' THEN 'image' 
          ELSE 'color' 
        END
      `);
    }
    
    console.log('[migration] color_display_mode column added and populated');
  }
}
