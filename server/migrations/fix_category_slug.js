import { db } from '../db.js';

export function fixCategorySlug() {
  try {
    // Проверяем, есть ли категория с неправильным слагом
    const wrongCategory = db.prepare("SELECT id FROM categories WHERE slug = 'novyy-drop'").get();
    
    if (wrongCategory) {
      console.log('[migration] Fixing category slug from novyy-drop to novyj-drop');
      db.prepare("UPDATE categories SET slug = 'novyj-drop' WHERE slug = 'novyy-drop'").run();
      console.log('[migration] Category slug fixed successfully');
    } else {
      console.log('[migration] Category slug is already correct or category not found');
    }
  } catch (error) {
    console.error('[migration] Failed to fix category slug:', error);
    throw error;
  }
}