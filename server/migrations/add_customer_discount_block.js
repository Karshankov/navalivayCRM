import { db } from '../db.js';

/**
 * Временная блокировка (заморозка) скидочной системы клиента.
 *
 * `customers.discount_blocked_until` — TEXT, UTC datetime в формате SQLite
 * ('YYYY-MM-DD HH:MM:SS'). NULL = не заблокирован. Пока now < until,
 * публичный API и миниапка запрещают применение накопленных штампов и
 * промокодов; сама блокировка НЕ удаляет и НЕ обнуляет балансы
 * (customer_loyalty_balances) — они «размораживаются» при истечении срока
 * или ручном снятии администратором.
 *
 * `customers.discount_block_comment` — необязательный комментарий админа,
 * виден только в CRM.
 *
 * Настройка `settings.discount_block_notify_template` — шаблон текста
 * уведомления, отправляемого клиенту в Telegram при установке блокировки.
 * Подстановки: {date} → дата окончания в формате ДД.ММ.ГГГГ (по Минску),
 * {comment} → комментарий админа (пусто, если не указан).
 */

export const DISCOUNT_BLOCK_NOTIFY_TEMPLATE_KEY = 'discount_block_notify_template';

export const DEFAULT_DISCOUNT_BLOCK_NOTIFY_TEMPLATE =
  'Ваша скидочная система временно заморожена до {date}.';

export function migrateCustomerDiscountBlock(database = db) {
  const target = database || db;
  const columns = target.prepare('PRAGMA table_info(customers)').all();
  const names = new Set(columns.map((column) => column.name));

  if (!names.has('discount_blocked_until')) {
    target.exec('ALTER TABLE customers ADD COLUMN discount_blocked_until TEXT;');
    console.log('[migration] Added customers.discount_blocked_until');
  }
  if (!names.has('discount_block_comment')) {
    target.exec('ALTER TABLE customers ADD COLUMN discount_block_comment TEXT;');
    console.log('[migration] Added customers.discount_block_comment');
  }

  // Дефолтный шаблон уведомления — один раз, дальше редактируется в CRM.
  const existing = target
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(DISCOUNT_BLOCK_NOTIFY_TEMPLATE_KEY);
  if (!existing) {
    target
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
      .run(DISCOUNT_BLOCK_NOTIFY_TEMPLATE_KEY, DEFAULT_DISCOUNT_BLOCK_NOTIFY_TEMPLATE);
    console.log('[migration] Seeded discount_block_notify_template default');
  }

  console.log('[migration] customer discount block ready');
}
