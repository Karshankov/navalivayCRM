import { db } from '../db.js';

/**
 * Пометки значимости линеек.
 *
 * Линейку можно пометить настраиваемым ярлыком («Социально значимый товар»
 * и т.п.): в мини-аппе карточка товара получает броский блок с иконкой,
 * названием и кнопкой «Подробнее», а после выдачи заказа с таким товаром
 * клиенту уходит персональное сообщение. Вся настройка — в одном каталоге
 * significance_marks: внешний вид, тексты и шаблон сообщения.
 *
 * Миграция идемпотентна: только CREATE TABLE IF NOT EXISTS и ADD COLUMN,
 * существующие данные не трогаются. Удаление пометки снимает её со всех
 * линеек (ON DELETE SET NULL).
 */

function tableExists(name) {
  return Boolean(
    db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name),
  );
}

function columnsOf(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
}

export function migrateSignificanceMarks() {
  try {
    if (!tableExists('significance_marks')) {
      db.exec(`
        CREATE TABLE significance_marks (
          id TEXT PRIMARY KEY,
          code TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          description TEXT,
          -- Иконка пометки: загруженная менеджером картинка (data-URL WebP).
          icon TEXT NOT NULL,
          color TEXT NOT NULL DEFAULT '#16a34a',
          detail_title TEXT,
          detail_body TEXT,
          detail_button_text TEXT,
          detail_url TEXT,
          notify_text TEXT,
          active INTEGER NOT NULL DEFAULT 1,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
          updated_at TEXT NOT NULL DEFAULT (DATETIME('now'))
        );

        CREATE INDEX idx_significance_marks_active
          ON significance_marks(active, sort_order);
      `);
      console.log('[migration] Created significance_marks table');
    }

    if (!columnsOf('category_groups').includes('significance_mark_id')) {
      db.exec(`
        ALTER TABLE category_groups
          ADD COLUMN significance_mark_id TEXT
            REFERENCES significance_marks(id) ON DELETE SET NULL;
      `);
      db.exec(
        'CREATE INDEX IF NOT EXISTS idx_category_groups_significance ON category_groups(significance_mark_id);',
      );
      console.log('[migration] Added category_groups.significance_mark_id');
    }

    if (!columnsOf('significance_marks').includes('admin_note')) {
      db.exec(`
        ALTER TABLE significance_marks
          ADD COLUMN admin_note TEXT;
      `);
      console.log('[migration] Added significance_marks.admin_note');
    }

    if (!tableExists('significance_notify_queue')) {
      db.exec(`
        CREATE TABLE significance_notify_queue (
          id TEXT PRIMARY KEY,
          order_id TEXT NOT NULL,
          mark_id TEXT NOT NULL,
          customer_id TEXT,
          send_at TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'sent', 'skipped', 'failed')),
          reason TEXT,
          attempt INTEGER NOT NULL DEFAULT 0,
          max_attempts INTEGER NOT NULL DEFAULT 5,
          created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
          updated_at TEXT NOT NULL DEFAULT (DATETIME('now')),
          UNIQUE(order_id, mark_id)
        );

        CREATE INDEX idx_significance_notify_queue_due
          ON significance_notify_queue(status, send_at);
      `);
      console.log('[migration] Created significance_notify_queue table');
    }
  } catch (error) {
    console.error('[migration] significance marks failed:', error);
    throw error;
  }
}
