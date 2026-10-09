import { db } from '../db.js';

/**
 * Расширяет систему блокировок клиентов:
 *
 *   1) `customer_blocks` получает поля жизненного цикла:
 *        - `block_until` — TEXT (UTC ISO datetime, формат SQLite). NULL = блокировка
 *           бессрочна. Если выставлен — рассматривается как «активный» только пока
 *           current_time < block_until.
 *        - `unblocked_at` / `unblocked_by` / `unblock_reason` — заполняются когда
 *           менеджер снимает блок вручную (для аудита). При autoswitch по истечении
 *           `block_until` оставляются NULL.
 *
 *   2) Новая таблица `pending_customer_bans` — превентивные баны по @username
 *      для клиентов, которых ещё нет в БД. При первом контакте такого клиента
 *      (upsertPublicCustomer) запись переносится в `customer_blocks` уже с
 *      реальным `customer_id`.
 *
 * Миграция идемпотентна: PRAGMA table_info / CREATE TABLE IF NOT EXISTS.
 */
export function migrateCustomerBlockLifecycle() {
  try {
    // 1. Расширяем customer_blocks (если столбцов ещё нет).
    const columns = db.prepare(`PRAGMA table_info(customer_blocks)`).all();
    const colNames = new Set(columns.map((c) => c.name));

    const additions = [
      { name: 'block_until', sql: 'block_until TEXT' },
      { name: 'unblocked_at', sql: 'unblocked_at TEXT' },
      { name: 'unblocked_by', sql: 'unblocked_by TEXT' },
      { name: 'unblock_reason', sql: 'unblock_reason TEXT' },
    ];

    for (const col of additions) {
      if (!colNames.has(col.name)) {
        db.exec(`ALTER TABLE customer_blocks ADD COLUMN ${col.sql};`);
        console.log(`[migration] Added customer_blocks.${col.name}`);
      }
    }

    // 2. Создаём таблицу pending_customer_bans.
    db.exec(`
      CREATE TABLE IF NOT EXISTS pending_customer_bans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_username TEXT NOT NULL,
        block_until TEXT,
        reason TEXT,
        created_by TEXT,
        created_at TEXT DEFAULT (DATETIME('now'))
      );
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_pending_bans_username
        ON pending_customer_bans(telegram_username COLLATE NOCASE);
    `);

    // 3. Pre-cleanup для возможных исторических дублей: если у клиента
    // окажется несколько active=1 блоков (legacy bug), оставим самый свежий,
    // остальные деактивируем — иначе UNIQUE индекс ниже не создастся.
    const cleanup = db.prepare(`
      UPDATE customer_blocks
         SET active = 0,
             unblocked_at = COALESCE(unblocked_at, DATETIME('now')),
             unblock_reason = COALESCE(unblock_reason, 'auto: deduplicated by migration')
       WHERE active = 1
         AND id NOT IN (
           SELECT id FROM (
             SELECT id,
                    ROW_NUMBER() OVER (
                      PARTITION BY customer_id
                      ORDER BY blocked_at DESC, id DESC
                    ) AS rn
               FROM customer_blocks
              WHERE active = 1
           ) WHERE rn = 1
         )
    `).run();
    if (cleanup.changes > 0) {
      console.log(`[migration] Deduplicated ${cleanup.changes} duplicate active blocks before UNIQUE index`);
    }

    // 4. Partial UNIQUE — у клиента не может быть >1 активного блока одновременно.
    // Защита от race condition (два админа одновременно жмут «Заблокировать»).
    // Конкурирующий INSERT вместо тихого дубля получит SQLITE_CONSTRAINT.
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_blocks_one_active
        ON customer_blocks(customer_id) WHERE active = 1;
    `);

    console.log('[migration] customer block lifecycle migration complete');
  } catch (error) {
    console.error('[migration] Failed to migrate customer block lifecycle:', error);
    throw error;
  }
}
