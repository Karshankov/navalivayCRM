import { db } from '../db.js';

function tableExists(database, table) {
  return Boolean(database.prepare(`
    SELECT 1
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
    LIMIT 1
  `).get(table));
}

function columnExists(database, table, column) {
  if (!tableExists(database, table)) return false;
  return database
    .prepare(`PRAGMA table_info("${table}")`)
    .all()
    .some((item) => item.name === column);
}

function addColumn(database, table, column, definition) {
  if (!tableExists(database, table) || columnExists(database, table, column)) return;
  database.exec(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`);
}

function addImmutableTriggers(database, table) {
  database.exec(`
    CREATE TRIGGER IF NOT EXISTS ${table}_immutable_update
    BEFORE UPDATE ON ${table}
    BEGIN
      SELECT RAISE(ABORT, 'immutable_${table}');
    END;

    CREATE TRIGGER IF NOT EXISTS ${table}_immutable_delete
    BEFORE DELETE ON ${table}
    BEGIN
      SELECT RAISE(ABORT, 'immutable_${table}');
    END;
  `);
}

/**
 * Изолированное ядро учёта сотрудников.
 *
 * Важно: миграцию нужно подключать в db.js ПОСЛЕ migrateInventoryLocations().
 * Она намеренно не восстанавливает авторов старых операций: таких данных нет.
 */
export function migrateStaffManagement(database = db) {
  if (!tableExists(database, 'employees')) {
    throw new Error('staff_management_requires_employees_table');
  }

  const migrate = database.transaction(() => {
    addColumn(database, 'employees', 'avatar_url', 'TEXT');
    addColumn(database, 'employees', 'color', 'TEXT');
    addColumn(database, 'employees', 'responsibilities', "TEXT NOT NULL DEFAULT '[]'");
    addColumn(database, 'employees', 'role', "TEXT NOT NULL DEFAULT 'employee'");
    addColumn(database, 'employees', 'deactivated_at', 'TEXT');
    // Личные уведомления сотруднику: юзернейм вводит руководитель, telegram_id
    // подставляется из карточки клиента с тем же юзернеймом.
    addColumn(database, 'employees', 'telegram_id', 'TEXT');
    addColumn(database, 'employees', 'telegram_username', 'TEXT');
    addColumn(database, 'employees', 'pin_hash', 'TEXT');
    addColumn(database, 'employees', 'pin_fingerprint', 'TEXT');
    addColumn(database, 'employees', 'pin_updated_at', 'TEXT');
    addColumn(database, 'employees', 'last_staff_login_at', 'TEXT');

    database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_pin_fingerprint
        ON employees(pin_fingerprint)
        WHERE pin_fingerprint IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_employees_staff_role_active
        ON employees(role, active);
    `);

    database.exec(`
      CREATE TABLE IF NOT EXISTS staff_sessions (
        id TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        scope TEXT NOT NULL DEFAULT 'staff',
        issued_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_seen_at TEXT,
        revoked_at TEXT,
        ip_hash TEXT,
        user_agent_hash TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_staff_sessions_employee
        ON staff_sessions(employee_id, revoked_at, expires_at);
      CREATE INDEX IF NOT EXISTS idx_staff_sessions_expiry
        ON staff_sessions(expires_at);

      CREATE TABLE IF NOT EXISTS staff_login_attempts (
        scope_key TEXT PRIMARY KEY,
        failures INTEGER NOT NULL DEFAULT 0,
        window_started_at TEXT NOT NULL,
        last_failed_at TEXT NOT NULL,
        locked_until TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_staff_login_attempts_locked
        ON staff_login_attempts(locked_until);

      CREATE TABLE IF NOT EXISTS staff_shifts (
        id TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
        employee_name_snapshot TEXT NOT NULL,
        business_date TEXT NOT NULL,
        planned_start_at TEXT NOT NULL,
        planned_end_at TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        close_reason TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        created_by_employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_shifts_one_active
        ON staff_shifts((1))
        WHERE status = 'active';
      CREATE INDEX IF NOT EXISTS idx_staff_shifts_employee_date
        ON staff_shifts(employee_id, business_date DESC);
      CREATE INDEX IF NOT EXISTS idx_staff_shifts_active_end
        ON staff_shifts(status, planned_end_at);

      CREATE TABLE IF NOT EXISTS staff_shift_audit (
        id TEXT PRIMARY KEY,
        shift_id TEXT NOT NULL REFERENCES staff_shifts(id) ON DELETE RESTRICT,
        action TEXT NOT NULL,
        actor_employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
        actor_name_snapshot TEXT,
        actor_kind TEXT NOT NULL,
        before_json TEXT,
        after_json TEXT,
        reason TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_staff_shift_audit_shift
        ON staff_shift_audit(shift_id, created_at);

      CREATE TABLE IF NOT EXISTS staff_events (
        id TEXT PRIMARY KEY,
        employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
        employee_name_snapshot TEXT NOT NULL,
        event_type TEXT NOT NULL,
        polarity TEXT NOT NULL DEFAULT 'neutral',
        points INTEGER NOT NULL DEFAULT 0,
        entity_type TEXT,
        entity_id TEXT,
        source_number_snapshot TEXT,
        source_type_snapshot TEXT,
        source_name_snapshot TEXT,
        source TEXT NOT NULL DEFAULT 'system',
        happened_at TEXT NOT NULL,
        business_date TEXT NOT NULL,
        idempotency_key TEXT UNIQUE,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_by_employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
        created_by_name_snapshot TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_staff_events_employee_date
        ON staff_events(employee_id, business_date DESC, happened_at DESC);
      CREATE INDEX IF NOT EXISTS idx_staff_events_type_date
        ON staff_events(event_type, business_date DESC);
      CREATE INDEX IF NOT EXISTS idx_staff_events_entity
        ON staff_events(entity_type, entity_id);

      CREATE TABLE IF NOT EXISTS staff_manual_marks (
        id TEXT PRIMARY KEY,
        employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
        employee_name_snapshot TEXT NOT NULL,
        mark_type TEXT NOT NULL,
        points INTEGER NOT NULL DEFAULT 0,
        title TEXT NOT NULL,
        description TEXT,
        happened_at TEXT NOT NULL,
        business_date TEXT NOT NULL,
        current_version INTEGER NOT NULL DEFAULT 1,
        deleted_at TEXT,
        created_by_employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
        created_by_name_snapshot TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_staff_manual_marks_employee_date
        ON staff_manual_marks(employee_id, business_date DESC, happened_at DESC);

      CREATE TABLE IF NOT EXISTS staff_manual_mark_versions (
        id TEXT PRIMARY KEY,
        mark_id TEXT NOT NULL REFERENCES staff_manual_marks(id) ON DELETE RESTRICT,
        version INTEGER NOT NULL,
        action TEXT NOT NULL,
        mark_type TEXT NOT NULL,
        points INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        happened_at TEXT NOT NULL,
        changed_by_employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
        changed_by_name_snapshot TEXT NOT NULL,
        reason TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(mark_id, version)
      );

      CREATE INDEX IF NOT EXISTS idx_staff_manual_mark_versions_mark
        ON staff_manual_mark_versions(mark_id, version);

      CREATE TABLE IF NOT EXISTS staff_monthly_salary_expectations (
        id TEXT PRIMARY KEY,
        employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
        employee_name_snapshot TEXT NOT NULL,
        month TEXT NOT NULL,
        amount_minor INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'BYN',
        status TEXT NOT NULL DEFAULT 'published',
        calculation_json TEXT NOT NULL DEFAULT '{}',
        note TEXT,
        visible_to_employee INTEGER NOT NULL DEFAULT 1,
        visible_from TEXT,
        current_version INTEGER NOT NULL DEFAULT 1,
        set_by_employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
        set_by_name_snapshot TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(employee_id, month)
      );

      CREATE INDEX IF NOT EXISTS idx_staff_salary_month
        ON staff_monthly_salary_expectations(month, employee_id);

      CREATE TABLE IF NOT EXISTS staff_monthly_salary_versions (
        id TEXT PRIMARY KEY,
        salary_expectation_id TEXT NOT NULL
          REFERENCES staff_monthly_salary_expectations(id) ON DELETE RESTRICT,
        version INTEGER NOT NULL,
        amount_minor INTEGER NOT NULL,
        currency TEXT NOT NULL,
        status TEXT NOT NULL,
        calculation_json TEXT NOT NULL,
        note TEXT,
        visible_to_employee INTEGER NOT NULL,
        visible_from TEXT,
        changed_by_employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
        changed_by_name_snapshot TEXT NOT NULL,
        reason TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(salary_expectation_id, version)
      );

      CREATE INDEX IF NOT EXISTS idx_staff_salary_versions_expectation
        ON staff_monthly_salary_versions(salary_expectation_id, version);

      CREATE TABLE IF NOT EXISTS staff_tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        target_employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
        target_employee_name_snapshot TEXT,
        assignee_employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
        assignee_employee_name_snapshot TEXT,
        due_at TEXT,
        claimed_at TEXT,
        submitted_at TEXT,
        approved_at TEXT,
        cancelled_at TEXT,
        result_note TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        created_by_employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
        created_by_name_snapshot TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_staff_tasks_status_due
        ON staff_tasks(status, due_at);
      CREATE INDEX IF NOT EXISTS idx_staff_tasks_assignee_status
        ON staff_tasks(assignee_employee_id, status);
      CREATE INDEX IF NOT EXISTS idx_staff_tasks_target_status
        ON staff_tasks(target_employee_id, status);

      CREATE TABLE IF NOT EXISTS staff_task_history (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES staff_tasks(id) ON DELETE RESTRICT,
        action TEXT NOT NULL,
        previous_status TEXT,
        new_status TEXT NOT NULL,
        actor_employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
        actor_name_snapshot TEXT NOT NULL,
        note TEXT,
        idempotency_key TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(task_id, idempotency_key)
      );

      CREATE INDEX IF NOT EXISTS idx_staff_task_history_task
        ON staff_task_history(task_id, created_at);

      CREATE TABLE IF NOT EXISTS staff_task_commands (
        idempotency_key TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES staff_tasks(id) ON DELETE RESTRICT,
        operation TEXT NOT NULL,
        actor_employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS staff_operation_idempotency (
        key TEXT PRIMARY KEY,
        operation TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_staff_operation_idempotency_created
        ON staff_operation_idempotency(created_at);
    `);

    addColumn(database, 'staff_shifts', 'version', 'INTEGER NOT NULL DEFAULT 1');

    addImmutableTriggers(database, 'staff_shift_audit');
    addImmutableTriggers(database, 'staff_events');
    addImmutableTriggers(database, 'staff_manual_mark_versions');
    addImmutableTriggers(database, 'staff_monthly_salary_versions');
    addImmutableTriggers(database, 'staff_task_history');

    addColumn(
      database,
      'orders',
      'assembled_by_employee_id',
      'TEXT REFERENCES employees(id) ON DELETE SET NULL',
    );
    addColumn(database, 'orders', 'assembled_at', 'TEXT');
    addColumn(
      database,
      'orders',
      'issued_by_employee_id',
      'TEXT REFERENCES employees(id) ON DELETE SET NULL',
    );
    addColumn(database, 'orders', 'issued_at', 'TEXT');

    addColumn(
      database,
      'procurements',
      'created_by_employee_id',
      'TEXT REFERENCES employees(id) ON DELETE SET NULL',
    );
    addColumn(
      database,
      'procurements',
      'accepted_by_employee_id',
      'TEXT REFERENCES employees(id) ON DELETE SET NULL',
    );

    addColumn(
      database,
      'stock_transfers',
      'created_by_employee_id',
      'TEXT REFERENCES employees(id) ON DELETE SET NULL',
    );
    addColumn(
      database,
      'stock_transfers',
      'completed_by_employee_id',
      'TEXT REFERENCES employees(id) ON DELETE SET NULL',
    );
    addColumn(
      database,
      'stock_transfers',
      'cancelled_by_employee_id',
      'TEXT REFERENCES employees(id) ON DELETE SET NULL',
    );
    addColumn(
      database,
      'stock_transfers',
      'updated_by_employee_id',
      'TEXT REFERENCES employees(id) ON DELETE SET NULL',
    );

    if (tableExists(database, 'orders')) {
      database.exec(`
        CREATE INDEX IF NOT EXISTS idx_orders_assembled_employee
          ON orders(assembled_by_employee_id, assembled_at);
        CREATE INDEX IF NOT EXISTS idx_orders_issued_employee
          ON orders(issued_by_employee_id, issued_at);
      `);
    }
    if (tableExists(database, 'procurements')) {
      database.exec(`
        CREATE INDEX IF NOT EXISTS idx_procurements_created_employee
          ON procurements(created_by_employee_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_procurements_accepted_employee
          ON procurements(accepted_by_employee_id, completed_at);
      `);
    }
    if (tableExists(database, 'stock_transfers')) {
      database.exec(`
        CREATE INDEX IF NOT EXISTS idx_stock_transfers_created_employee
          ON stock_transfers(created_by_employee_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_stock_transfers_completed_employee
          ON stock_transfers(completed_by_employee_id, completed_at);
        CREATE INDEX IF NOT EXISTS idx_stock_transfers_cancelled_employee
          ON stock_transfers(cancelled_by_employee_id);
      `);
    }

    if (tableExists(database, 'settings')) {
      database.prepare(`
        INSERT OR IGNORE INTO settings (key, value)
        VALUES ('staff_tracking_enabled', 'false')
      `).run();
    }
  });

  migrate();
}
