/**
 * Текст уведомления клиенту о блокировке (Telegram / ручная ссылка).
 */
export function formatBlockNotifyMessage(reason) {
  const trimmed = String(reason ?? "").trim();
  if (!trimmed) return "Ваш аккаунт заблокирован.";
  return trimmed;
}
