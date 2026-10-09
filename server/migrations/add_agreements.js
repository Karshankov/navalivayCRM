/**
 * Миграция: соглашения (agreements) перед оформлением заказа.
 *
 * Контекст: Костя попросил добавить чекбоксы между «Итого» и кнопкой «Оформить
 * заказ» в чекауте Telegram Mini App. Каждое соглашение редактируется в CRM
 * (заголовок виден на чекбоксе, полный текст — в модалке). Все активные
 * соглашения обязательны: без проставленных галочек заказ создать нельзя.
 *
 * Таблицы:
 *   - agreements: справочник (id, title, body, is_active, sort_order, ...)
 *   - orders.accepted_agreements: JSON-snapshot принятых соглашений на момент
 *     создания заказа (для аудита — если в будущем тексты обновятся, останется
 *     запись «что именно подписал клиент»).
 *
 * Идемпотентно: каждый запуск проверяет, нужно ли что-то делать.
 */
import { db } from '../db.js';

export function migrateAgreements() {
  // 1) Таблица agreements
  db.exec(`
    CREATE TABLE IF NOT EXISTS agreements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
      updated_at TEXT NOT NULL DEFAULT (DATETIME('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agreements_active_order
      ON agreements(is_active, sort_order, id);
  `);

  // 2) Колонка orders.accepted_agreements — JSON snapshot.
  // Используем PRAGMA table_info вместо ALTER ADD COLUMN IF NOT EXISTS,
  // потому что SQLite такого синтаксиса не поддерживает.
  const orderCols = db.prepare(`PRAGMA table_info(orders)`).all();
  const hasAcceptedAgreements = orderCols.some(
    (col) => col.name === 'accepted_agreements',
  );
  if (!hasAcceptedAgreements) {
    db.exec(`ALTER TABLE orders ADD COLUMN accepted_agreements TEXT`);
    console.log('[migration] Added orders.accepted_agreements column');
  }

  // 3) Колонка agreements.modal_title — отдельный заголовок для модалки
  // с полным текстом. Без него заголовок модалки дублирует ссылку из
  // чекбокса (например: «правилами заказа» — кликнул, в модалке тоже
  // «правилами заказа»). С modal_title админ может поставить нормальный
  // заголовок («Правила заказа»), сохранив грамматику ссылки.
  const agreementCols = db.prepare(`PRAGMA table_info(agreements)`).all();
  const hasModalTitle = agreementCols.some((col) => col.name === 'modal_title');
  if (!hasModalTitle) {
    db.exec(`ALTER TABLE agreements ADD COLUMN modal_title TEXT`);
    console.log('[migration] Added agreements.modal_title column');
  }
}
