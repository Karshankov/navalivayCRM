import { db } from '../db.js';

/**
 * Контроль заканчивающихся линеек:
 *   - `category_groups.min_stock_threshold` (INTEGER, DEFAULT NULL) — порог,
 *     ниже которого линейка попадает в плашку «Заканчивающиеся» в Закупках.
 *     NULL = порог не настроен (линейка попадает в плашку только при полном
 *     обнулении суммарного стока).
 *   - `category_group_supply_pauses` — отложенные плитки (когда менеджер
 *     знает, что закупка задерживается, и хочет временно скрыть линейку из
 *     списка заканчивающихся).
 *     pause_reason: 'short' (3 дня), 'no_supply' (5 дней), 'not_produced' (20 дней)
 *
 * Идемпотентно: PRAGMA table_info / CREATE TABLE IF NOT EXISTS.
 */
export function migrateLowStockGroups() {
  try {
    const cols = db.prepare(`PRAGMA table_info(category_groups)`).all();
    const hasThreshold = cols.some((c) => c.name === 'min_stock_threshold');
    if (!hasThreshold) {
      db.exec(`ALTER TABLE category_groups ADD COLUMN min_stock_threshold INTEGER DEFAULT NULL;`);
      console.log('[migration] Added category_groups.min_stock_threshold');
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS category_group_supply_pauses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id TEXT NOT NULL REFERENCES category_groups(id) ON DELETE CASCADE,
        paused_until TEXT NOT NULL,
        pause_reason TEXT NOT NULL,
        paused_by TEXT,
        paused_at TEXT NOT NULL DEFAULT (DATETIME('now'))
      );
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_supply_pauses_group_until
        ON category_group_supply_pauses(group_id, paused_until);
    `);

    console.log('[migration] Low stock groups migration complete');
  } catch (error) {
    console.error('[migration] Failed low stock groups migration:', error);
    throw error;
  }
}
