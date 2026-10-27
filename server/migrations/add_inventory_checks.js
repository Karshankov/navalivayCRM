import { db } from '../db.js';

/**
 * Пересорт (инвентаризация линейки).
 *
 * Менеджер выбирает линейку, вводит фактический остаток по каждому вкусу, и
 * система приводит цифры в базе к факту. Денежных проводок нет: пересорт —
 * это правка остатка, а не списание себестоимости (недостачи при желании
 * оформляются обычным Списанием).
 *
 * Журнал хранит «было → стало» по каждой позиции, чтобы пересорт можно было
 * посмотреть и повторить: без истории повторная проверка считала бы от
 * уже исправленных чисел и расхождение «затиралось» бы.
 *
 * Структура повторяет write_offs / stock_transfers: шапка + позиции.
 * Миграция идемпотентна.
 */

function tableExists(name) {
  return Boolean(
    db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name),
  );
}

function columnsOf(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
}

function addColumn(table, name, definition) {
  const columns = columnsOf(table);
  if (columns.includes(name)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  return true;
}

export function migrateInventoryChecks() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS inventory_checks (
        id TEXT PRIMARY KEY,
        check_number INTEGER NOT NULL UNIQUE,
        group_id TEXT NOT NULL,
        group_name TEXT NOT NULL,
        location TEXT NOT NULL CHECK (location IN ('retail', 'warehouse')),
        positions_count INTEGER NOT NULL DEFAULT 0,
        counted_count INTEGER NOT NULL DEFAULT 0,
        total_before INTEGER NOT NULL DEFAULT 0,
        total_after INTEGER NOT NULL DEFAULT 0,
        diff_total INTEGER NOT NULL DEFAULT 0,
        created_by TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (DATETIME('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_inventory_checks_group
        ON inventory_checks(group_id);
      CREATE INDEX IF NOT EXISTS idx_inventory_checks_created
        ON inventory_checks(created_at);

      CREATE TABLE IF NOT EXISTS inventory_check_items (
        id TEXT PRIMARY KEY,
        check_id TEXT NOT NULL REFERENCES inventory_checks(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL,
        variant_id TEXT,
        product_title TEXT NOT NULL,
        variant_name TEXT,
        expected_quantity INTEGER NOT NULL DEFAULT 0,
        actual_quantity INTEGER NOT NULL DEFAULT 0,
        diff INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_inventory_check_items_check
        ON inventory_check_items(check_id);
    `);

    // Поле «кто провёл» появилось не сразу — на случай расширения старых
    // установок добавляем молча.
    addColumn('inventory_checks', 'created_by', 'created_by TEXT');
    addColumn('inventory_checks', 'counted_count', 'counted_count INTEGER NOT NULL DEFAULT 0');

    if (!tableExists('inventory_checks')) {
      console.log('[migration] Created inventory_checks tables');
    }
  } catch (error) {
    console.error('[migration] Failed inventory checks migration:', error);
    throw error;
  }
}