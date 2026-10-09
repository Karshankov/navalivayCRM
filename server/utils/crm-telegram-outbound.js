/**
 * Общие правила исходящих в Telegram из CRM (ручные и авто).
 * Вынесено для юнит-тестов без поднятия Express.
 */

import { getActiveBlockForCustomerId } from './customer-blocks.js';

/**
 * Ручное «Написать клиенту» не должно обходить CRM-блок: иначе клиент
 * получает личку от userbot, хотя менеджер пометил блок в CRM
 * (авто-уведомления уже режутся в auto-notify.js).
 *
 * @param {string|null|undefined} customerId
 * @returns {{ ok: true } | { ok: false, error: 'customer_blocked' }}
 */
export function gateSendCustomTelegramForCrmBlock(customerId) {
  if (!customerId) {
    return { ok: true };
  }
  const active = getActiveBlockForCustomerId(String(customerId));
  if (active) {
    return { ok: false, error: 'customer_blocked' };
  }
  return { ok: true };
}
