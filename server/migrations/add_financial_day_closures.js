/** Additive migration only: no historical balances or transactions are rewritten.
 * Back up an existing database before first activation of this migration.
 */
export function migrateFinancialDayClosures(database) {
  database.transaction(() => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS financial_day_closures (
        id TEXT PRIMARY KEY,
        business_date TEXT NOT NULL UNIQUE,
        time_zone TEXT NOT NULL,
        closed_at TEXT NOT NULL,
        employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
        employee_name TEXT NOT NULL,
        actor_username TEXT NOT NULL,
        request_key TEXT NOT NULL UNIQUE,
        request_hash TEXT NOT NULL,
        cash_account_id TEXT NOT NULL REFERENCES cash_accounts(id) ON DELETE RESTRICT,
        revenue_account_id TEXT NOT NULL REFERENCES cash_accounts(id) ON DELETE RESTRICT,
        snapshot_json TEXT NOT NULL,
        counts_json TEXT NOT NULL,
        report_text TEXT NOT NULL,
        notification_status TEXT NOT NULL DEFAULT 'pending',
        CHECK (cash_account_id != revenue_account_id)
      );
      CREATE INDEX IF NOT EXISTS idx_financial_day_closures_closed
        ON financial_day_closures(closed_at DESC);
    `);
    const columns = new Set(database.prepare('PRAGMA table_info(cash_transactions)').all().map((column) => column.name));
    if (!columns.has('financial_close_id')) {
      database.exec('ALTER TABLE cash_transactions ADD COLUMN financial_close_id TEXT REFERENCES financial_day_closures(id) ON DELETE RESTRICT');
    }
    if (!columns.has('closing_operation')) {
      database.exec('ALTER TABLE cash_transactions ADD COLUMN closing_operation TEXT');
    }
    database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_transactions_closure_operation
        ON cash_transactions(financial_close_id, closing_operation)
        WHERE financial_close_id IS NOT NULL;
      INSERT INTO internal_notification_settings
        (event_group, title, description, enabled)
      VALUES ('financial_close', 'Закрытие финансового дня', 'Итоговый отчёт владельцу после сверки кассы', 0)
      ON CONFLICT(event_group) DO NOTHING;
    `);
  }).immediate();
}
