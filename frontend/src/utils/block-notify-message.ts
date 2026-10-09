/** Текст уведомления клиенту о блокировке (Telegram / ручная ссылка). */
export function formatBlockNotifyMessage(reason: string | null | undefined): string {
  const trimmed = String(reason ?? '').trim()
  if (!trimmed) return 'Ваш аккаунт заблокирован.'
  return trimmed
}
