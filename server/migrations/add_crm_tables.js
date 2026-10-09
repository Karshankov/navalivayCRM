import { db } from '../db.js';

export function migrateCrmTables() {
  try {
    // Проверяем, выполнена ли миграция
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='employees'
    `).get();
    
    if (tableExists) {
      console.log('[migration] CRM tables already exist, skipping');
      return;
    }

    console.log('[migration] Adding CRM tables...');

    // 1. Добавляем недостающие поля в products
    db.exec(`
      -- Добавляем поля для products (если не существуют)
      ALTER TABLE products ADD COLUMN strength TEXT;
      ALTER TABLE products ADD COLUMN cost_price REAL DEFAULT 0;
      ALTER TABLE products ADD COLUMN stock INTEGER DEFAULT 0;
      ALTER TABLE products ADD COLUMN min_stock INTEGER DEFAULT 0;
    `);
    console.log('[migration] Added fields to products table');

    // 2. Employees (сотрудники)
    db.exec(`
      CREATE TABLE IF NOT EXISTS employees (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        position TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
        updated_at TEXT NOT NULL DEFAULT (DATETIME('now'))
      );
    `);
    console.log('[migration] Created employees table');

    // 3. Customers (клиенты)
    db.exec(`
      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        telegram_id TEXT UNIQUE,
        telegram_username TEXT,
        first_name TEXT,
        last_name TEXT,
        phone TEXT,
        first_visit_at TEXT NOT NULL DEFAULT (DATETIME('now')),
        last_visit_at TEXT,
        last_order_at TEXT,
        total_orders INTEGER NOT NULL DEFAULT 0,
        total_spent REAL NOT NULL DEFAULT 0,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
        updated_at TEXT NOT NULL DEFAULT (DATETIME('now'))
      );
    `);
    console.log('[migration] Created customers table');

    // 4. Customer blocks (блокировки доставки)
    db.exec(`
      CREATE TABLE IF NOT EXISTS customer_blocks (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        block_type TEXT NOT NULL DEFAULT 'delivery',
        reason TEXT,
        blocked_at TEXT NOT NULL DEFAULT (DATETIME('now')),
        blocked_by TEXT,
        active INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_customer_blocks_customer ON customer_blocks(customer_id);
    `);
    console.log('[migration] Created customer_blocks table');

    // 5. Orders (заказы)
    db.exec(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        order_number INTEGER NOT NULL,
        customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
        employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'new',
        delivery_type TEXT NOT NULL DEFAULT 'pickup',
        delivery_address TEXT,
        total_amount REAL NOT NULL DEFAULT 0,
        discount_amount REAL NOT NULL DEFAULT 0,
        discount_percent REAL NOT NULL DEFAULT 0,
        final_amount REAL NOT NULL DEFAULT 0,
        profit REAL NOT NULL DEFAULT 0,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
        updated_at TEXT NOT NULL DEFAULT (DATETIME('now')),
        completed_at TEXT,
        UNIQUE(order_number)
      );
      CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
    `);
    console.log('[migration] Created orders table');

    // 6. Order items (позиции заказов)
    db.exec(`
      CREATE TABLE IF NOT EXISTS order_items (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
        product_title TEXT NOT NULL,
        group_name TEXT,
        base_product_title TEXT,
        base_product_id TEXT,
        variant_id TEXT REFERENCES product_variants(id) ON DELETE SET NULL,
        variant_name TEXT,
        quantity INTEGER NOT NULL DEFAULT 1,
        price_per_unit REAL NOT NULL,
        cost_per_unit REAL NOT NULL DEFAULT 0,
        discount_amount REAL NOT NULL DEFAULT 0,
        total_price REAL NOT NULL,
        total_cost REAL NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
    `);
    console.log('[migration] Created order_items table');

    // 7. Cash accounts (счета/кассы)
    db.exec(`
      CREATE TABLE IF NOT EXISTS cash_accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        balance REAL NOT NULL DEFAULT 0,
        is_default INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (DATETIME('now'))
      );

      -- Создаём кассу по умолчанию
      INSERT OR IGNORE INTO cash_accounts (id, name, balance, is_default, active)
      VALUES ('acc_default', 'Касса', 0, 1, 1);
    `);
    console.log('[migration] Created cash_accounts table');

    // 8. Cash transactions (движения денег)
    db.exec(`
      CREATE TABLE IF NOT EXISTS cash_transactions (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES cash_accounts(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        amount REAL NOT NULL,
        description TEXT,
        order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
        employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (DATETIME('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_cash_transactions_account ON cash_transactions(account_id);
      CREATE INDEX IF NOT EXISTS idx_cash_transactions_type ON cash_transactions(type);
      CREATE INDEX IF NOT EXISTS idx_cash_transactions_created ON cash_transactions(created_at);
    `);
    console.log('[migration] Created cash_transactions table');

    // 9. Procurements (закупки)
    db.exec(`
      CREATE TABLE IF NOT EXISTS procurements (
        id TEXT PRIMARY KEY,
        procurement_number INTEGER NOT NULL,
        employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
        supplier_name TEXT,
        total_amount REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'draft',
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
        completed_at TEXT,
        UNIQUE(procurement_number)
      );
    `);
    console.log('[migration] Created procurements table');

    // 10. Procurement items (позиции закупок)
    db.exec(`
      CREATE TABLE IF NOT EXISTS procurement_items (
        id TEXT PRIMARY KEY,
        procurement_id TEXT NOT NULL REFERENCES procurements(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        quantity INTEGER NOT NULL,
        cost_per_unit REAL NOT NULL,
        total_cost REAL NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_procurement_items_procurement ON procurement_items(procurement_id);
    `);
    console.log('[migration] Created procurement_items table');

    // 11. Write-offs (списания)
    db.exec(`
      CREATE TABLE IF NOT EXISTS write_offs (
        id TEXT PRIMARY KEY,
        writeoff_number INTEGER NOT NULL,
        employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
        reason TEXT NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
        UNIQUE(writeoff_number)
      );
    `);
    console.log('[migration] Created write_offs table');

    // 12. Write-off items (позиции списаний)
    db.exec(`
      CREATE TABLE IF NOT EXISTS writeoff_items (
        id TEXT PRIMARY KEY,
        writeoff_id TEXT NOT NULL REFERENCES write_offs(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        quantity INTEGER NOT NULL,
        cost_per_unit REAL NOT NULL DEFAULT 0,
        total_cost REAL NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_writeoff_items_writeoff ON writeoff_items(writeoff_id);
    `);
    console.log('[migration] Created writeoff_items table');

    // 13. Visit logs (логи посещений для холодных клиентов)
    db.exec(`
      CREATE TABLE IF NOT EXISTS visit_logs (
        id TEXT PRIMARY KEY,
        customer_id TEXT REFERENCES customers(id) ON DELETE CASCADE,
        telegram_id TEXT,
        telegram_username TEXT,
        page_path TEXT,
        action TEXT,
        visited_at TEXT NOT NULL DEFAULT (DATETIME('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_visit_logs_customer ON visit_logs(customer_id);
      CREATE INDEX IF NOT EXISTS idx_visit_logs_telegram ON visit_logs(telegram_id);
      CREATE INDEX IF NOT EXISTS idx_visit_logs_visited ON visit_logs(visited_at);
    `);
    console.log('[migration] Created visit_logs table');

    console.log('[migration] CRM tables migration completed successfully');
  } catch (error) {
    console.error('[migration] CRM tables migration failed:', error);
    // Продолжаем работу, даже если миграция не удалась (возможно, поля уже существуют)
    if (!error.message.includes('duplicate column name')) {
      throw error;
    }
  }
}
