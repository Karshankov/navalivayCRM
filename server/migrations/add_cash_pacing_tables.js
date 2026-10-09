import { db } from "../db.js";

export function migrateCashPacingTables() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS cash_pacing_months (
        id TEXT PRIMARY KEY,
        month_key TEXT NOT NULL UNIQUE,
        title TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
        updated_at TEXT NOT NULL DEFAULT (DATETIME('now'))
      );

      CREATE TABLE IF NOT EXISTS cash_pacing_items (
        id TEXT PRIMARY KEY,
        month_id TEXT NOT NULL REFERENCES cash_pacing_months(id) ON DELETE CASCADE,
        entry_type TEXT NOT NULL DEFAULT 'base',
        title TEXT NOT NULL,
        quantity REAL NOT NULL,
        cost_with_vat REAL NOT NULL,
        markup_percent REAL NOT NULL,
        effective_from TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
        updated_at TEXT NOT NULL DEFAULT (DATETIME('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_cash_pacing_items_month ON cash_pacing_items(month_id);
      CREATE INDEX IF NOT EXISTS idx_cash_pacing_items_effective_from ON cash_pacing_items(effective_from);

      CREATE TABLE IF NOT EXISTS cash_pacing_daily_facts (
        id TEXT PRIMARY KEY,
        month_id TEXT NOT NULL REFERENCES cash_pacing_months(id) ON DELETE CASCADE,
        fact_date TEXT NOT NULL,
        actual_amount REAL NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
        updated_at TEXT NOT NULL DEFAULT (DATETIME('now')),
        UNIQUE(month_id, fact_date)
      );
      CREATE INDEX IF NOT EXISTS idx_cash_pacing_daily_facts_month ON cash_pacing_daily_facts(month_id);
      CREATE INDEX IF NOT EXISTS idx_cash_pacing_daily_facts_date ON cash_pacing_daily_facts(fact_date);
    `);

    console.log("[migration] Cash pacing tables ready");
  } catch (error) {
    console.error("[migration] Cash pacing tables migration failed:", error);
    throw error;
  }
}
