import { db } from '../db.js';

export function migratePosSales() {
  try {
    // Проверяем, выполнена ли миграция
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='pos_sales'
    `).get();
    
    if (tableExists) {
      console.log('[migration] pos_sales table already exists, skipping');
      return;
    }

    console.log('[migration] Adding pos_sales table...');

    // POS Sales - продажи через кассовый интерфейс (без остатков)
    db.exec(`
      CREATE TABLE IF NOT EXISTS pos_sales (
        id TEXT PRIMARY KEY,
        sale_number INTEGER NOT NULL,
        product_name TEXT NOT NULL,
        price REAL NOT NULL,
        cost_price REAL,
        profit REAL,
        status TEXT NOT NULL DEFAULT 'completed',
        notes TEXT,
        employee_id TEXT,
        created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
        completed_at TEXT,
        FOREIGN KEY (employee_id) REFERENCES employees(id)
      );

      CREATE INDEX IF NOT EXISTS idx_pos_sales_status ON pos_sales(status);
      CREATE INDEX IF NOT EXISTS idx_pos_sales_created_at ON pos_sales(created_at);
    `);

    console.log('[migration] Created pos_sales table');
    console.log('[migration] pos_sales migration completed successfully');
  } catch (error) {
    // Игнорируем ошибки "table already exists" и "duplicate column"
    if (error.message?.includes('already exists') || error.message?.includes('duplicate column')) {
      console.log('[migration] pos_sales table/columns already exist, skipping');
      return;
    }
    console.error('[migration] pos_sales migration error:', error);
    throw error;
  }
}
