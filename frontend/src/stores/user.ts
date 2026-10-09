import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { withTelegramAuthHeaders } from '@/utils/telegramAuth'

export interface UserProfile {
  id: string | null
  telegramId: string
  telegramUsername: string | null
  firstName: string | null
  lastName: string | null
  photoUrl: string | null
  totalOrders: number
  totalSpent: number
  memberSince: string | null
}

export interface CustomerCardPaymentStatus {
  enabled: boolean
  monthly_limit_minor: number
  monthly_used_minor: number
  monthly_remaining_minor: number
  max_order_minor: number
  cooldown_until: string | null
  request_cooldown_until: string | null
  card_available: boolean
  limits: {
    monthly_limit_minor: number
    spent_month_minor: number
    remaining_month_minor: number
    daily_limit_minor: number
    spent_today_minor: number
    reserved_minor: number
    remaining_today_minor: number
  }
}

export const useUserStore = defineStore('user', () => {
  const profile = ref<UserProfile | null>(null)
  const cardPaymentStatus = ref<CustomerCardPaymentStatus | null>(null)
  const isLoadingCardPaymentStatus = ref(false)
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  const displayName = computed(() => {
    if (!profile.value) return 'Пользователь'
    const { firstName, lastName } = profile.value
    if (firstName && lastName) return `${firstName} ${lastName}`
    if (firstName) return firstName
    return 'Пользователь'
  })

  const hasUsername = computed(() => {
    return Boolean(profile.value?.telegramUsername)
  })

  const photoUrl = computed(() => {
    return profile.value?.photoUrl || null
  })

  function getTelegramUser() {
    if (typeof window === 'undefined') return null
    return window.Telegram?.WebApp?.initDataUnsafe?.user ?? null
  }

  async function fetchProfile(telegramId?: string): Promise<void> {
    const tgUser = getTelegramUser()
    const id = telegramId || (tgUser?.id ? String(tgUser.id) : null)

    if (!id) {
      // No Telegram context - use local data from initDataUnsafe
      if (tgUser) {
        profile.value = {
          id: null,
          telegramId: String(tgUser.id),
          telegramUsername: tgUser.username || null,
          firstName: tgUser.first_name || null,
          lastName: tgUser.last_name || null,
          photoUrl: tgUser.photo_url || null,
          totalOrders: 0,
          totalSpent: 0,
          memberSince: null,
        }
      }
      return
    }

    isLoading.value = true
    error.value = null

    try {
      const response = await fetch(`/api/customer/me?telegram_id=${encodeURIComponent(id)}`, {
        headers: withTelegramAuthHeaders(),
      })

      if (!response.ok) {
        throw new Error('Не удалось загрузить профиль')
      }

      const data = await response.json()

      profile.value = {
        id: data.id || null,
        telegramId: data.telegram_id || id,
        telegramUsername: data.telegram_username || tgUser?.username || null,
        firstName: data.first_name || tgUser?.first_name || null,
        lastName: data.last_name || tgUser?.last_name || null,
        photoUrl: data.photo_url || tgUser?.photo_url || null,
        totalOrders: data.total_orders || 0,
        totalSpent: data.total_spent || 0,
        memberSince: data.member_since || null,
      }
    } catch (e: any) {
      console.error('[UserStore] Failed to fetch profile:', e)
      error.value = e?.message || 'Ошибка загрузки профиля'

      // Fallback to Telegram data
      if (tgUser) {
        profile.value = {
          id: null,
          telegramId: String(tgUser.id),
          telegramUsername: tgUser.username || null,
          firstName: tgUser.first_name || null,
          lastName: tgUser.last_name || null,
          photoUrl: tgUser.photo_url || null,
          totalOrders: 0,
          totalSpent: 0,
          memberSince: null,
        }
      }
    } finally {
      isLoading.value = false
    }
  }

  async function fetchCardPaymentStatus(): Promise<void> {
    isLoadingCardPaymentStatus.value = true
    try {
      const response = await fetch('/api/card-payment/status', {
        headers: withTelegramAuthHeaders(),
      })
      if (!response.ok) {
        cardPaymentStatus.value = null
        return
      }
      cardPaymentStatus.value = await response.json()
    } catch (e) {
      console.warn('[UserStore] Failed to fetch card payment status:', e)
      cardPaymentStatus.value = null
    } finally {
      isLoadingCardPaymentStatus.value = false
    }
  }

  return {
    profile,
    cardPaymentStatus,
    isLoadingCardPaymentStatus,
    isLoading,
    error,
    displayName,
    hasUsername,
    photoUrl,
    fetchProfile,
    fetchCardPaymentStatus,
  }
})
