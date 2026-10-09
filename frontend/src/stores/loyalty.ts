import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { getTelegramIdentity, type CustomerIdentity } from '@/utils/customerOrders'
import { withTelegramAuthHeaders } from '@/utils/telegramAuth'

export interface LoyaltySnapshotCategory {
  id: string
  key: string
  title: string
  description: string | null
  threshold: number
  discount_amount: number
  balance: number
  available_bonus_count: number
  remaining_to_next: number
  active: number
}

export interface LoyaltyPreviewLineItem {
  key: string
  product_id: string | null
  variant_id: string | null
  quantity: number
  loyalty_units_applied: number
  max_redeemable_units: number
  product_title: string
}

export interface LoyaltyPreviewCategory {
  category_id: string
  category_key: string
  title: string
  description: string | null
  threshold: number
  discount_amount: number
  current_balance: number
  current_available_bonus_count: number
  items_in_cart: number
  eligible_purchase_units: number
  loyalty_units_applied: number
  spent_now: number
  earned_after_fulfillment: number
  projected_balance: number
  available_bonus_count: number
  remaining_to_next: number
  line_items: LoyaltyPreviewLineItem[]
}

export interface LoyaltyAdminMapping {
  id: string
  loyalty_category_id: string
  category_id: string | null
  group_id: string | null
  created_at: string
}

export interface LoyaltyAdminCategory {
  id: string
  key: string
  title: string
  description: string | null
  threshold: number
  discount_amount: number
  sort_order: number
  active: number
  mappings: LoyaltyAdminMapping[]
}

export interface LoyaltyAdminCustomerCategory {
  key: string
  balance: number
  available_bonus_count: number
}

export interface LoyaltyAdminCustomer {
  id: string
  telegram_username: string | null
  first_name: string | null
  last_name: string | null
  last_activity_at: string | null
  categories: LoyaltyAdminCustomerCategory[]
}

export interface LoyaltyLedgerEntry {
  id: string
  customer_id: string
  loyalty_category_id: string
  order_id: string | null
  order_item_id: string | null
  delta: number
  balance_after: number
  reason: string
  created_at: string
  category_key: string
  category_title: string
}

const POPUP_SESSION_KEY = 'navalivay_loyalty_popup_seen'

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: withTelegramAuthHeaders({
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    }),
    credentials: options?.credentials ?? 'include',
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const message = data?.message || data?.error || 'Request failed'
    throw new Error(message)
  }

  return data as T
}

export const useLoyaltyStore = defineStore('loyalty', () => {
  const snapshot = ref<LoyaltySnapshotCategory[]>([])
  const previewCategories = ref<LoyaltyPreviewCategory[]>([])
  const totalLoyaltyDiscount = ref(0)
  const loadingSnapshot = ref(false)
  const loadingPreview = ref(false)
  const loadingAdmin = ref(false)
  const snapshotError = ref('')
  const previewError = ref('')
  const adminCategories = ref<LoyaltyAdminCategory[]>([])
  const adminCustomers = ref<LoyaltyAdminCustomer[]>([])
  const adminLedger = ref<LoyaltyLedgerEntry[]>([])
  let checkoutPreviewRequestId = 0

  const availableCategories = computed(() =>
    snapshot.value.filter((category) => Number(category.available_bonus_count || 0) > 0),
  )
  const hasAvailableBonuses = computed(() => availableCategories.value.length > 0)

  async function fetchSnapshot(identity: CustomerIdentity = getTelegramIdentity()) {
    const params = new URLSearchParams()
    if (identity.telegramId) params.set('telegram_id', identity.telegramId)
    if (identity.telegramUsername) params.set('telegram_username', identity.telegramUsername)

    loadingSnapshot.value = true
    snapshotError.value = ''
    try {
      const response = await fetchJson<{ categories: LoyaltySnapshotCategory[] }>(
        `/api/loyalty/me?${params.toString()}`,
      )
      snapshot.value = response.categories || []
      return snapshot.value
    } catch (error: any) {
      snapshotError.value = error?.message || 'Не удалось загрузить бонусы'
      throw error
    } finally {
      loadingSnapshot.value = false
    }
  }

  async function fetchCheckoutPreview(payload: {
    telegram_id?: string
    telegram_username?: string
    promo_code?: string
    editing_order_id?: string | null
    items: Array<{
      product_id: string
      variant_id?: string | null
      product_title?: string | null
      quantity: number
      price_per_unit: number
      discount_amount?: number
      manual_discount_amount?: number
      loyalty_units_applied?: number
    }>
  }) {
    const requestId = ++checkoutPreviewRequestId

    if (!payload.items.length) {
      previewCategories.value = []
      totalLoyaltyDiscount.value = 0
      previewError.value = ''
      return []
    }

    loadingPreview.value = true
    previewError.value = ''
    try {
      const response = await fetchJson<{
        categories: LoyaltyPreviewCategory[]
        total_loyalty_discount: number
      }>('/api/loyalty/checkout-preview', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      if (requestId !== checkoutPreviewRequestId) {
        return response.categories || []
      }
      previewCategories.value = response.categories || []
      totalLoyaltyDiscount.value = Number(response.total_loyalty_discount || 0)
      return previewCategories.value
    } catch (error: any) {
      if (requestId !== checkoutPreviewRequestId) {
        return []
      }
      previewCategories.value = []
      totalLoyaltyDiscount.value = 0
      previewError.value = error?.message || 'Не удалось рассчитать бонусы'
      throw error
    } finally {
      if (requestId === checkoutPreviewRequestId) {
        loadingPreview.value = false
      }
    }
  }

  function resetPreview() {
    checkoutPreviewRequestId += 1
    previewCategories.value = []
    totalLoyaltyDiscount.value = 0
    loadingPreview.value = false
    previewError.value = ''
  }

  function canShowAvailableBonusPopup() {
    if (typeof window === 'undefined') return false
    if (!hasAvailableBonuses.value) return false
    return sessionStorage.getItem(POPUP_SESSION_KEY) !== '1'
  }

  function markPopupSeen() {
    if (typeof window === 'undefined') return
    sessionStorage.setItem(POPUP_SESSION_KEY, '1')
  }

  async function fetchAdminCategories() {
    loadingAdmin.value = true
    try {
      const response = await fetchJson<{ categories: LoyaltyAdminCategory[] }>(
        '/api/admin/crm/loyalty/categories',
      )
      adminCategories.value = response.categories || []
      return adminCategories.value
    } finally {
      loadingAdmin.value = false
    }
  }

  async function updateAdminCategory(id: string, payload: {
    threshold: number
    discount_amount: number
    title: string
    description?: string | null
    active: boolean
  }) {
    const category = await fetchJson<LoyaltyAdminCategory>(
      `/api/admin/crm/loyalty/categories/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      },
    )
    const index = adminCategories.value.findIndex((item) => item.id === id)
    if (index !== -1) {
      adminCategories.value[index] = category
    }
    return category
  }

  async function updateAdminMappings(id: string, payload: {
    category_ids: string[]
    group_ids: string[]
  }) {
    const category = await fetchJson<LoyaltyAdminCategory>(
      `/api/admin/crm/loyalty/categories/${id}/mappings`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
    )
    const index = adminCategories.value.findIndex((item) => item.id === id)
    if (index !== -1) {
      adminCategories.value[index] = category
    }
    return category
  }

  async function fetchAdminCustomers(search = '') {
    const params = new URLSearchParams()
    if (search.trim()) params.set('search', search.trim())
    const response = await fetchJson<{ customers: LoyaltyAdminCustomer[] }>(
      `/api/admin/crm/loyalty/customers?${params.toString()}`,
    )
    adminCustomers.value = response.customers || []
    return adminCustomers.value
  }

  async function fetchAdminLedger(customerId: string) {
    const response = await fetchJson<{ entries: LoyaltyLedgerEntry[] }>(
      `/api/admin/crm/loyalty/customers/${customerId}/ledger`,
    )
    adminLedger.value = response.entries || []
    return adminLedger.value
  }

  return {
    snapshot,
    previewCategories,
    totalLoyaltyDiscount,
    loadingSnapshot,
    loadingPreview,
    loadingAdmin,
    snapshotError,
    previewError,
    adminCategories,
    adminCustomers,
    adminLedger,
    availableCategories,
    hasAvailableBonuses,
    fetchSnapshot,
    fetchCheckoutPreview,
    resetPreview,
    canShowAvailableBonusPopup,
    markPopupSeen,
    fetchAdminCategories,
    updateAdminCategory,
    updateAdminMappings,
    fetchAdminCustomers,
    fetchAdminLedger,
  }
})
