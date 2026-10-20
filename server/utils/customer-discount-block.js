import { db } from '../db.js';
import { BUSINESS_TIME_ZONE, getTimeZoneDateParts } from './business-time.js';
import {
  DISCOUNT_BLOCK_NOTIFY_TEMPLATE_KEY,
  DEFAULT_DISCOUNT_BLOCK_NOTIFY_TEMPLATE,
} from '../migrations/add_customer_discount_block.js';

/**
 * Утилиты временной блокировки (заморозки) скидочной системы клиента.
 *
 * Балансы штампов не удаляются и не обнуляются — блокировка только
 * запрещает их расход и начисление новых штампов, пока активна.
 * Истечение срока не требует «очистки»: все проверки сравнивают now с
 * discount_blocked_until на лету, заморозка рассасывается сама. Дата
 * остаётся в колонке как история последней блокировки.
 */

function pad2(value) {
  return String(value).padStart(2, '0');
}

/** ДД.ММ.ГГГГ по Минску. */
export function formatMinskDate(date) {
  const parsed = date instanceof Date ? date : new Date(String(date || '').replace(' ', 'T') + 'Z');
  if (!Number.isFinite(parsed.getTime())) return '';
  const parts = getTimeZoneDateParts(parsed, BUSINESS_TIME_ZONE);
  return `${pad2(parts.day)}.${pad2(parts.month)}.${parts.year}`;
}

/** 'YYYY-MM-DD HH:MM:SS' (UTC) → Date; null при пустом/битом значении. */
export function parseSqliteUtc(value) {
  if (!value) return null;
  const normalized = String(value).includes('T')
    ? String(value)
    : String(value).replace(' ', 'T') + 'Z';
  const parsed = new Date(normalized);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

/**
 * Статус блокировки клиента. Принимает строку customers или объект
 * { discount_blocked_until }. Активна, пока now < until.
 */
export function getDiscountBlockStatus(customer, now = new Date()) {
  const until = parseSqliteUtc(customer?.discount_blocked_until);
  const blocked = Boolean(until && until.getTime() > now.getTime());
  return {
    blocked,
    until: blocked ? customer.discount_blocked_until : null,
    comment: customer?.discount_block_comment
      ? String(customer.discount_block_comment).trim() || null
      : null,
  };
}

/** Статус по customer_id (без JOIN — просто читаем строку). */
export function getDiscountBlockStatusById(customerId, now = new Date()) {
  if (!customerId) return { blocked: false, until: null, comment: null };
  const row = db
    .prepare('SELECT discount_blocked_until, discount_block_comment FROM customers WHERE id = ?')
    .get(customerId);
  return getDiscountBlockStatus(row, now);
}

/**
 * Дата 'YYYY-MM-DD' + конец дня (23:59:59 по Минску) → SQLite UTC datetime.
 * Пользователь выбирает день — блокировка живёт до его конца.
 */
export function discountBlockUntilFromDate(dateString) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateString || '').trim());
  if (!match) return null;
  const [, year, month, day] = match;
  // Валидность календарной даты
  const probe = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    probe.getUTCFullYear() !== Number(year)
    || probe.getUTCMonth() !== Number(month) - 1
    || probe.getUTCDate() !== Number(day)
  ) {
    return null;
  }
  // 23:59:59 по Минску (UTC+3) = 20:59:59 UTC
  return `${year}-${month}-${day} 20:59:59`;
}

/** Текущий шаблон уведомления о блокировке из settings (или дефолт). */
export function getDiscountBlockNotifyTemplate() {
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(DISCOUNT_BLOCK_NOTIFY_TEMPLATE_KEY);
  const text = String(row?.value ?? '').trim();
  return text || DEFAULT_DISCOUNT_BLOCK_NOTIFY_TEMPLATE;
}

/**
 * Рендер текста уведомления: {date} → ДД.ММ.ГГГГ, {comment} → комментарий
 * (пустая строка, если не указан). Неизвестные подстановки остаются как есть,
 * чтобы опечатка была заметна (как в renderNotificationTemplate).
 */
export function renderDiscountBlockMessage(template, { until, comment } = {}) {
  const dateText = until ? formatMinskDate(until) : '';
  const commentText = String(comment ?? '').trim();
  return String(template ?? '')
    .replace(/\{date\}/g, dateText)
    .replace(/\{comment\}/g, commentText)
    .trim();
}
