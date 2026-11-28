/**
 * API модалки «Клиент»: хаб клиента, списки с серверной пагинацией и
 * действия над блокировками, доступом и запретами. Все вызовы — обычные
 * fetch с cookie-входом CRM, как в остальных админских формах.
 */
import type { CardAccountProfile, CustomerWholesaleSettings, CustomerWholesaleTier } from '@/stores/crm'

export type HubBlockKind = 'active' | 'pending'

export interface HubBlock {
  id: string | number
  kind: HubBlockKind
  block_type?: string | null
  block_until: string | null
  reason: string | null
  blocked_at: string | null
  blocked_by: string | null
}

export interface HubAuthorization {
  feature_enabled: boolean
  is_authorized: boolean
  /** referral / staff / legacy / feature_disabled / issued_order */
  source: string | null
  authorized_at: string | null
  authorized_by: string | null
  state: {
    status: 'pending' | 'authorized' | 'blocked'
    attempts_used: number
    max_attempts: number
    last_error_code: string | null
    last_username: string | null
    blocked_at: string | null
  } | null
  staff_access: { active: boolean; permanent: boolean; pending_id: number | null }
  is_reserved_inviter: boolean
}

export interface HubRecentOrder {
  id: string
  order_number: number | string
  created_at: string
  status: string
  amount: number
}

/** Единый хаб действий с клиентом. Для «призрака» (клиента нет в базе) customer = null. */
export interface CustomerHubData {
  ghost?: boolean
  customer: (CustomerWholesaleSettings['customer'] & {
    total_orders: number
    notes: string | null
  }) | null
  /** Только у «призрака»: username / Telegram ID из запроса. */
  username?: string | null
  telegram_id?: string | null
  block: HubBlock | null
  invite_ban: {
    id: string
    reason: string | null
    banned_by: string | null
    banned_at: string | null
  } | null
  pending_invite_ban?: {
    id: number
    reason: string | null
    banned_by: string | null
    created_at: string | null
  } | null
  authorization?: HubAuthorization
  inviter: {
    customer_id: string | null
    username: string | null
    first_name: string | null
    last_name: string | null
    invite_ban_id: string | null
    is_invite_banned: boolean
    /** Когда клиент прошёл авторизацию по этому приглашению. */
    invited_at: string | null
  } | null
  card_profile: CardAccountProfile | null
  tiers: CustomerWholesaleTier[]
  active_wholesale_order: CustomerWholesaleSettings['active_wholesale_order']
  recent_orders?: HubRecentOrder[]
  last_order_at?: string | null
  /** Сводка по выданным заказам и приглашениям; у «призрака» null. */
  stats?: HubCustomerStats | null
}

export interface HubCustomerStats {
  /** Все заказы клиента в таблице orders, любой статус. */
  orders_total: number
  /** Новые и собранные (new, in_progress). */
  orders_active: number
  /** Выданные и завершённые (delivered, completed) — только они считаются покупками. */
  orders_delivered: number
  orders_cancelled: number
  total_spent: number
  average_check: number
  first_order_at: string | null
  last_order_at: string | null
  invited_total: number
  invited_with_orders: number
  favorite_product: { title: string; quantity: number } | null
}

export class HubApiError extends Error {
  code?: string
  status?: number
  constructor(message: string, code?: string, status?: number) {
    super(message)
    this.name = 'HubApiError'
    this.code = code
    this.status = status
  }
}

const BASE = '/api/admin/crm'

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, {
      credentials: 'include',
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    })
  } catch {
    throw new HubApiError('Нет связи с сервером. Проверьте результат перед повтором.')
  }
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const code = payload?.error ? String(payload.error) : undefined
    throw new HubApiError(String(payload?.message || code || 'Запрос не выполнен'), code, response.status)
  }
  return payload as T
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body ?? {}) })

/** @username, username или числовой Telegram ID. */
export function normalizeHubQuery(value: unknown): string {
  return String(value || '').trim().replace(/^@+/, '')
}

export function fetchCustomerHub(query: string) {
  const normalized = normalizeHubQuery(query)
  if (!normalized) {
    throw new HubApiError('Укажите @username или Telegram ID клиента.', 'invalid_query')
  }
  return request<CustomerHubData>(`/customer-hub/${encodeURIComponent(normalized)}`)
}

/** Вся история заказов клиента (до 500 последних). */
export function fetchCustomerOrders(customerId: string) {
  return request<{ orders: HubRecentOrder[] }>(`/customer-hub/${encodeURIComponent(customerId)}/orders`)
}

// ---- Списки -----------------------------------------------------------------

export type HubListKind = 'blocked' | 'auth_errors' | 'staff_access' | 'invite_bans' | 'reserved'

export interface HubListCounts {
  blocked: number
  auth_errors: number
  staff_access: number
  invite_bans: number
  reserved: number
}

export interface HubListRow {
  kind?: 'active' | 'pending'
  id?: string | number
  customer_id?: string | null
  telegram_id?: string | null
  telegram_username?: string | null
  first_name?: string | null
  last_name?: string | null
  username?: string | null
  block_type?: string | null
  reason?: string | null
  status?: string | null
  attempts_used?: number
  last_error_code?: string | null
  has_issued_order?: number
  date: string | null
  [key: string]: unknown
}

export interface HubListPage {
  items: HubListRow[]
  total: number
  limit: number
  offset: number
}

const LIST_PATHS: Record<HubListKind, string> = {
  blocked: '/blocks',
  auth_errors: '/referral-authorizations',
  staff_access: '/referral-authorization/staff-access',
  invite_bans: '/invite-bans',
  reserved: '/referral-authorization/disallowed-usernames',
}

const LIST_DATE_FIELDS = ['blocked_at', 'updated_at', 'granted_at', 'banned_at', 'added_at']

export function fetchCustomerListCounts() {
  return request<HubListCounts>('/customer-lists/counts')
}

export async function fetchCustomerList(
  kind: HubListKind,
  { q = '', offset = 0, limit = 20 }: { q?: string; offset?: number; limit?: number } = {},
): Promise<HubListPage> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (q.trim()) params.set('q', q.trim())
  if (kind === 'auth_errors') params.set('filter', 'errors')
  const page = await request<HubListPage>(`${LIST_PATHS[kind]}?${params.toString()}`)
  return {
    ...page,
    items: page.items.map((row) => ({
      ...row,
      date: (LIST_DATE_FIELDS.map((field) => row[field]).find((value) => typeof value === 'string') as string) ?? null,
    })),
  }
}

// ---- Действия ----------------------------------------------------------------

/** Снять блокировку; для превентивной (pending) тот же endpoint удаляет запись. */
export function removeBlock(blockId: string | number) {
  return request<{ ok: boolean; kind: string }>(`/blocks/${encodeURIComponent(String(blockId))}`, {
    method: 'DELETE',
    ...json({}),
  })
}

export function grantStaffAccess(target: { customerId?: string | null; username?: string | null }) {
  return request<{ ok: boolean; kind: string }>('/referral-authorization/staff-access', {
    method: 'POST',
    ...json(target.customerId
      ? { customer_id: target.customerId }
      : { telegram_username: target.username }),
  })
}

export function revokeStaffAccess(customerId: string) {
  return request<{ ok: boolean }>(`/referral-authorization/staff-access/${encodeURIComponent(customerId)}`, {
    method: 'DELETE',
  })
}

export function removePendingStaffAccess(id: string | number) {
  return request<{ ok: boolean }>(`/referral-authorization/staff-access/pending/${encodeURIComponent(String(id))}`, {
    method: 'DELETE',
  })
}

export function addReservedUsernames(usernames: string[]) {
  return request<{ items: unknown[] }>('/referral-authorization/disallowed-usernames', {
    method: 'POST',
    ...json({ usernames }),
  })
}

export function removeReservedUsername(username: string) {
  return request<{ ok: boolean }>(
    `/referral-authorization/disallowed-usernames/${encodeURIComponent(username)}`,
    { method: 'DELETE' },
  )
}

export function convertReservedToInviteBan(username: string, reason?: string) {
  return request<{ ok: boolean }>(
    `/referral-authorization/disallowed-usernames/${encodeURIComponent(username)}/convert-to-invite-ban`,
    { method: 'POST', ...json({ reason: reason || undefined }) },
  )
}

export function removeInviteBan(id: string | number, pending = false) {
  return request<{ ok: boolean }>(
    `/invite-bans/${pending ? 'pending/' : ''}${encodeURIComponent(String(id))}`,
    { method: 'DELETE', ...json({}) },
  )
}

const ERROR_TEXT: Record<string, string> = {
  access_is_permanent: 'Доступ постоянный: у клиента есть выданный заказ.',
  not_staff_authorized: 'Доступ выдан не вручную — отменять нечего.',
  username_has_invite_ban: 'У этого username есть запрет приглашать — сначала снимите его.',
  username_invalid: 'Некорректный username: 5–32 символа, латиница, цифры и «_».',
  username_ambiguous: 'Username принадлежит нескольким клиентам — укажите Telegram ID.',
  username_reserved: 'Этот username в «Наших аккаунтах» — запрет приглашать недоступен.',
  customer_not_found: 'Клиент не найден.',
  not_found: 'Запись уже удалена. Обновите данные.',
  invalid_query: 'Укажите @username или Telegram ID клиента.',
  usernames_count_invalid: 'Укажите от 1 до 100 username.',
}

/** Человекочитаемая ошибка по коду сервера. */
export function hubErrorText(err: unknown, fallback = 'Не удалось выполнить действие. Попробуйте ещё раз.'): string {
  const code = (err as { code?: string })?.code
  if (code && ERROR_TEXT[code]) return ERROR_TEXT[code]
  const message = (err as { message?: string })?.message
  if (message && !/^[a-z_]+$/.test(message)) return message
  return fallback
}
