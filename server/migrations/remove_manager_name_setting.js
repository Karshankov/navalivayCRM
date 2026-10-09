import { db } from '../db.js';

export function removeManagerNameSetting() {
  try {
    // Проверяем, существует ли запись manager_name в таблице settings
    const managerNameExists = db.prepare('SELECT COUNT(*) as count FROM settings WHERE key = ?').get('manager_name');
    
    if (managerNameExists.count > 0) {
      console.log('[migration] Removing manager_name setting (no longer used)...');
      
      // Удаляем настройку manager_name
      db.prepare('DELETE FROM settings WHERE key = ?').run('manager_name');
      
      console.log('[migration] manager_name setting removed successfully');
    } else {
      console.log('[migration] manager_name setting not found, skipping removal...');
    }
  } catch (error) {
    console.error('[migration] Error removing manager_name setting:', error);
    throw error;
  }
}