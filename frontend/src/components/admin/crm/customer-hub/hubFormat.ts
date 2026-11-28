import type { CustomerHubData, HubListRow } from '@/utils/crmCustomerHubApi'

/** SQLite-даты хранятся в UTC без часового пояса; показываем по Минску. */
export function formatHubDate(value: string | null | undefined, withTime = true): string {
  if (!value) return ''
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`
  const parsed = new Date(normalized)
  if (!Number.isFinite(parsed.getTime())) return value
  return parsed.toLocaleString('ru-RU', {
    timeZone: 'Europe/Minsk',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  })
}

const AUTH_ERRORS: Record<string, string> = {
  referral_username_invalid: 'Указал некорректный username',
  referral_inviter_forbidden: 'Указал недопустимого пригласившего',
  referral_username_ambiguous: 'Username пригласившего неоднозначен',
  referral_inviter_reserved: 'Указал «наш» аккаунт',
  referral_inviter_not_eligible: 'Пригласивший не подходит (не заказывал или с запретом)',
  referral_self_invite: 'Указал самого себя',
  referral_inviter_blocked: 'Пригласивший заблокирован',
}

export function authErrorText(code: string | null | undefined): string {
  if (!code) return ''
  return AUTH_ERRORS[code] || 'Ошибка при вводе пригласившего'
}

const ORDER_STATUSES: Record<string, string> = {
  new: 'Новый',
  in_progress: 'Собран',
  completed: 'Завершён',
  delivered: 'Выдан',
  cancelled: 'Отменён',
}

export function orderStatusText(status: string): string {
  return ORDER_STATUSES[status] || status
}

export function formatAmount(value: number): string {
  return `${Number(value || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} BYN`
}

/** «сегодня», «вчера», «5 дн. назад» — по календарным дням Минска. */
export function daysAgoText(value: string | null | undefined): string {
  if (!value) return ''
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`
  const parsed = new Date(normalized)
  if (!Number.isFinite(parsed.getTime())) return ''
  const day = (date: Date) => date.toLocaleDateString('en-CA', { timeZone: 'Europe/Minsk' })
  const diff = Math.round((Date.parse(day(new Date())) - Date.parse(day(parsed))) / 86_400_000)
  if (diff <= 0) return 'сегодня'
  if (diff === 1) return 'вчера'
  return `${diff} дн. назад`
}

export function pluralRu(value: number, one: string, few: string, many: string): string {
  const mod10 = value % 10
  const mod100 = value % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

export function blockStatusText(block: CustomerHubData['block']): string {
  if (!block) return ''
  if (block.kind === 'pending') return 'Превентивный бан (клиент ещё не заходил)'
  return blockTypeText(block.block_type)
}

export function blockTypeText(blockType: string | null | undefined): string {
  return blockType === 'authorization_failed' ? 'Не прошёл авторизацию' : 'Блокировка'
}

/** Ключ открытия клиента: Telegram ID однозначен (username может повторяться), иначе username. last_username — это пригласивший, не клиент. */
export function rowLookupKey(row: HubListRow): string {
  return String(row.telegram_id || row.telegram_username || row.username || '').trim()
}

export function rowDisplayName(row: HubListRow): string {
  const name = [row.first_name, row.last_name].filter(Boolean).join(' ')
  const username = row.telegram_username || row.username
  if (username) return `@${username}`
  return name || (row.telegram_id ? `TG ${row.telegram_id}` : 'Без имени')
}

export type HubStatusTone = 'info' | 'danger' | 'neutral'
export interface HubStatus { label: string; tone: HubStatusTone }

/** Статус авторизации (доступа к магазину) — без учёта обычных блокировок. */
export function hubAuthStatus(hub: CustomerHubData): HubStatus | null {
  const auth = hub.authorization
  if (!auth) return null
  if (hub.ghost) return { label: 'Нет доступа', tone: 'neutral' }
  if (auth.is_authorized) return { label: 'Доступ открыт', tone: 'info' }
  if (!auth.feature_enabled) return { label: 'Не требуется', tone: 'neutral' }
  if (auth.state?.status === 'blocked') return { label: 'Авторизация не пройдена', tone: 'danger' }
  return { label: 'Не авторизован', tone: 'neutral' }
}

/** Главный статус возле имени: блокировка важнее статуса авторизации. */
export function hubHeaderStatus(hub: CustomerHubData): HubStatus | null {
  if (hub.block) {
    if (hub.block.kind === 'pending') return { label: 'Превентивный бан', tone: 'danger' }
    return { label: hub.block.block_type === 'authorization_failed' ? 'Не прошёл авторизацию' : 'Заблокирован', tone: 'danger' }
  }
  if (hub.ghost) return { label: 'Ещё не заходил', tone: 'neutral' }
  return hubAuthStatus(hub)
}
