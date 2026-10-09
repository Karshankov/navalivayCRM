import { db } from "../db.js";

export function migrateCardPaymentLimits() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS card_payment_months (
      month_key TEXT PRIMARY KEY,
      limit_minor INTEGER NOT NULL CHECK (limit_minor >= 0),
      updated_at TEXT NOT NULL DEFAULT (DATETIME('now'))
    );

    CREATE TABLE IF NOT EXISTS card_payment_day_adjustments (
      business_date TEXT PRIMARY KEY,
      limit_override_minor INTEGER CHECK (limit_override_minor IS NULL OR limit_override_minor >= 0),
      updated_at TEXT NOT NULL DEFAULT (DATETIME('now'))
    );

    CREATE TABLE IF NOT EXISTS card_payment_accounts (
      telegram_id TEXT PRIMARY KEY,
      telegram_username TEXT,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      monthly_limit_minor INTEGER NOT NULL DEFAULT 25000 CHECK (monthly_limit_minor >= 0),
      max_order_minor INTEGER NOT NULL DEFAULT 4500 CHECK (max_order_minor >= 0),
      cooldown_days INTEGER NOT NULL DEFAULT 10 CHECK (cooldown_days >= 1),
      cooldown_started_at TEXT,
      created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
      updated_at TEXT NOT NULL DEFAULT (DATETIME('now'))
    );

    CREATE TABLE IF NOT EXISTS card_payment_pending_accounts (
      telegram_username TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      monthly_limit_minor INTEGER NOT NULL DEFAULT 25000 CHECK (monthly_limit_minor >= 0),
      max_order_minor INTEGER NOT NULL DEFAULT 4500 CHECK (max_order_minor >= 0),
      cooldown_days INTEGER NOT NULL DEFAULT 10 CHECK (cooldown_days >= 1),
      created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
      updated_at TEXT NOT NULL DEFAULT (DATETIME('now'))
    );

    CREATE TABLE IF NOT EXISTS card_payment_operations (
      id TEXT PRIMARY KEY,
      operation_type TEXT NOT NULL CHECK (operation_type IN ('order', 'manual')),
      operation_status TEXT NOT NULL CHECK (operation_status IN ('reserved', 'spent', 'reversed')),
      order_id TEXT UNIQUE REFERENCES orders(id) ON DELETE SET NULL,
      customer_telegram_id TEXT,
      amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
      business_date TEXT NOT NULL,
      note TEXT,
      actor_username TEXT,
      created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
      issued_at TEXT,
      reversed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_card_payment_operations_day_status
      ON card_payment_operations(business_date, operation_status);
    CREATE INDEX IF NOT EXISTS idx_card_payment_operations_order
      ON card_payment_operations(order_id);
    CREATE INDEX IF NOT EXISTS idx_card_payment_operations_customer
      ON card_payment_operations(customer_telegram_id, operation_status);

    CREATE TABLE IF NOT EXISTS card_payment_tariffs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      limit_minor INTEGER NOT NULL CHECK (limit_minor >= 0),
      transition_cost_text TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      updated_at TEXT NOT NULL DEFAULT (DATETIME('now'))
    );

    CREATE TABLE IF NOT EXISTS card_payment_limit_requests (
      id TEXT PRIMARY KEY,
      telegram_id TEXT NOT NULL,
      telegram_username TEXT,
      tariff_id TEXT REFERENCES card_payment_tariffs(id) ON DELETE SET NULL,
      tariff_title TEXT NOT NULL,
      current_limit_minor INTEGER NOT NULL,
      requested_limit_minor INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'processed', 'rejected')),
      created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
      resolved_at TEXT,
      resolved_by TEXT,
      resolution_note TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_card_payment_requests_status_date
      ON card_payment_limit_requests(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_card_payment_requests_customer_date
      ON card_payment_limit_requests(telegram_id, created_at DESC);

    INSERT OR IGNORE INTO card_payment_tariffs
      (id, title, limit_minor, transition_cost_text, position)
    VALUES
      ('start', 'Старт', 6000, '10 BYN', 0),
      ('comfort', 'Комфорт', 8500, '20 BYN', 1),
      ('maximum', 'Максимум', 13000, '35 BYN', 2);
  `);

  for (const table of ["card_payment_accounts", "card_payment_pending_accounts"]) {
    const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
    if (!columns.has("monthly_limit_minor")) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN monthly_limit_minor INTEGER NOT NULL DEFAULT 25000`);
    }
  }
  // Permission expiry was removed. The ten-day cooldown remains a separate,
  // fixed business rule and is no longer configurable per account.
  db.exec(`
    UPDATE card_payment_accounts SET cooldown_days = 10 WHERE cooldown_days != 10;
    UPDATE card_payment_pending_accounts SET cooldown_days = 10 WHERE cooldown_days != 10;
  `);

  // The existing payment_type column is nullable and previously only accepted
  // cash from CRM issue actions. New card metadata lives in a dedicated ledger;
  // these columns make the chosen method and split amount visible on orders.
  const orderColumns = new Set(
    db.prepare("PRAGMA table_info(orders)").all().map((column) => column.name),
  );
  if (!orderColumns.has("card_amount_minor")) {
    db.exec(
      "ALTER TABLE orders ADD COLUMN card_amount_minor INTEGER NOT NULL DEFAULT 0",
    );
  }
  if (!orderColumns.has("cash_due_minor")) {
    db.exec(
      "ALTER TABLE orders ADD COLUMN cash_due_minor INTEGER NOT NULL DEFAULT 0",
    );
  }

  // Дневные корректировки: кто и зачем менял лимит дня (добавлено 2026-10-09,
  // часть работы по «Оплата картой 0.3»). Живые БД могли получить колонки
  // вручную — добавляем идемпотентно.
  const adjustmentColumns = db.prepare(
    "PRAGMA table_info(card_payment_day_adjustments)",
  ).all();
  if (!adjustmentColumns.some((column) => column.name === "actor_username")) {
    db.exec("ALTER TABLE card_payment_day_adjustments ADD COLUMN actor_username TEXT;");
  }
  if (!adjustmentColumns.some((column) => column.name === "reason")) {
    db.exec("ALTER TABLE card_payment_day_adjustments ADD COLUMN reason TEXT;");
  }

  // cooldown_days = 0 теперь допустим (пауза выключена) — CHECK >= 1 мешает.
  // SQLite не умеет менять CHECK: пересоздаём таблицу, если констрейнт старый.
  const accountsSql = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'card_payment_accounts'")
    .get();
  if (accountsSql?.sql && accountsSql.sql.includes("cooldown_days >= 1")) {
    db.exec("ALTER TABLE card_payment_accounts RENAME TO card_payment_accounts_old;");
    db.exec(`
      CREATE TABLE card_payment_accounts (
        telegram_id TEXT PRIMARY KEY,
        telegram_username TEXT,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        monthly_limit_minor INTEGER NOT NULL DEFAULT 25000 CHECK (monthly_limit_minor >= 0),
        max_order_minor INTEGER NOT NULL DEFAULT 4500 CHECK (max_order_minor >= 0),
        cooldown_days INTEGER NOT NULL DEFAULT 10 CHECK (cooldown_days >= 0),
        cooldown_started_at TEXT,
        tariff_id TEXT REFERENCES card_payment_tariffs(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
        updated_at TEXT NOT NULL DEFAULT (DATETIME('now'))
      );
    `);
    // tariff_id добавляется отдельной миграцией тарифов — здесь его может
    // ещё не быть в старой таблице, копируем условно.
    const oldAccountsColumns = new Set(
      db.prepare("PRAGMA table_info(card_payment_accounts_old)").all().map((c) => c.name),
    );
    if (oldAccountsColumns.has("tariff_id")) {
      db.exec(`
        INSERT INTO card_payment_accounts
          (telegram_id, telegram_username, enabled, monthly_limit_minor, max_order_minor,
           cooldown_days, cooldown_started_at, tariff_id, created_at, updated_at)
        SELECT telegram_id, telegram_username, enabled, monthly_limit_minor, max_order_minor,
               MAX(cooldown_days, 0), cooldown_started_at, tariff_id, created_at, updated_at
        FROM card_payment_accounts_old
      `);
    } else {
      db.exec(`
        INSERT INTO card_payment_accounts
          (telegram_id, telegram_username, enabled, monthly_limit_minor, max_order_minor,
           cooldown_days, cooldown_started_at, created_at, updated_at)
        SELECT telegram_id, telegram_username, enabled, monthly_limit_minor, max_order_minor,
               MAX(cooldown_days, 0), cooldown_started_at, created_at, updated_at
        FROM card_payment_accounts_old
      `);
    }
    db.exec("DROP TABLE card_payment_accounts_old");
    db.exec("CREATE INDEX IF NOT EXISTS idx_card_payment_accounts_tariff ON card_payment_accounts(tariff_id);");
  }

  const pendingSql = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'card_payment_pending_accounts'")
    .get();
  if (pendingSql?.sql && pendingSql.sql.includes("cooldown_days >= 1")) {
    db.exec("ALTER TABLE card_payment_pending_accounts RENAME TO card_payment_pending_accounts_old;");
    db.exec(`
      CREATE TABLE card_payment_pending_accounts (
        telegram_username TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        monthly_limit_minor INTEGER NOT NULL DEFAULT 25000 CHECK (monthly_limit_minor >= 0),
        max_order_minor INTEGER NOT NULL DEFAULT 4500 CHECK (max_order_minor >= 0),
        cooldown_days INTEGER NOT NULL DEFAULT 10 CHECK (cooldown_days >= 0),
        created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
        updated_at TEXT NOT NULL DEFAULT (DATETIME('now'))
      );
    `);
    db.exec(`
      INSERT INTO card_payment_pending_accounts
        (telegram_username, enabled, monthly_limit_minor, max_order_minor, cooldown_days, created_at, updated_at)
      SELECT telegram_username, enabled, monthly_limit_minor, max_order_minor,
             MAX(cooldown_days, 0), created_at, updated_at
      FROM card_payment_pending_accounts_old
    `);
    db.exec("DROP TABLE card_payment_pending_accounts_old");
  }
}
