import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { withTelegramAuthHeaders } from '@/utils/telegramAuth'
import { useWholesaleStore } from '@/stores/wholesale'

export interface WheelRarity {
  code: string
  label: string
  bgColor: string
  textColor: string
  isElite: boolean
}

export interface WheelPrize {
  id: string
  title: string
  description: string | null
  image_url: string | null
  rarity: WheelRarity | null
  weight: number
  effective_weight: number
  max_total: number
  issued_count: number
  is_exhausted: boolean
  sort_order: number
}

export interface WheelFeedItem {
  id: string
  spun_at: string
  prize_title: string
  first_name: string
  last_initial: string
  photo: string | null
  rarity: WheelRarity | null
}

export interface WheelMyPrize {
  spin_id: string
  prize_title: string
  prize_description: string | null
  prize_image_url: string | null
  rarity_code: string
  rarity_label: string | null
  rarity_bg: string | null
  rarity_text: string | null
  promo_code: string | null
  promo_valid_until: string | null
  spun_at: string
  prize_used_at: string | null
  is_epic_release: boolean
}

export interface WheelBalance {
  spins_available: number
  accumulated_byn: number
  threshold_byn: number
  progress_percent: number
  consecutive_nothing: number
}

export interface WheelState {
  customer_id: string | null
  is_wholesale: boolean
  balance: WheelBalance
  prizes: WheelPrize[]
  rarities: WheelRarity[]
  feed: WheelFeedItem[]
  my_active_prizes: WheelMyPrize[]
  feed_consent: boolean
  feed_consent_required: boolean
  access: {
    is_allowed: boolean
    is_limited: boolean
  }
  settings: {
    pity_threshold: number
    spin_byn_retail: number
    spin_byn_wholesale: number
    elite_rarities: string[]
    wheel_access_usernames?: string[]
  }
}

export interface WheelSpinResult {
  spin_id: string
  prize: {
    id: string
    title: string
    description: string | null
    image_url: string | null
    rarity_code: string
  }
  is_epic_release: boolean
  is_pity_release: boolean
  promo_code: string | null
  promo_valid_until: string | null
  animation_seed: number
  spins_left: number
  accumulated_byn: number
  idempotent_replay?: boolean
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const wholesaleStore = useWholesaleStore()
  const wholesaleHeaders = wholesaleStore.buildHeaders()
  const response = await fetch(url, {
    ...options,
    headers: withTelegramAuthHeaders({
      'Content-Type': 'application/json',
      ...wholesaleHeaders,
      ...(options?.headers || {}),
    }),
    credentials: options?.credentials ?? 'include',
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const message = data?.message || data?.error || 'Request failed'
    const error = new Error(message) as Error & { code?: string }
    error.code = data?.error
    throw error
  }
  return data as T
}

/**
 * Generate an Idempotency-Key for /api/wheel/spin (P1).
 *
 * `crypto.randomUUID()` is the cleanest source: cryptographically
 * strong, length 36, available in every browser that runs the Mini
 * App and in Node 19+ (covers SSR). Falls back to Math.random when
 * the polyfill is missing — safe enough for retry-dedup since the
 * key is only used once per spin attempt and never persisted to the
 * client.
 */
function generateIdempotencyKey(): string {
  const cryptoObj = typeof globalThis !== 'undefined' ? (globalThis as { crypto?: Crypto }).crypto : undefined
  if (cryptoObj?.randomUUID) {
    return `wheel_${cryptoObj.randomUUID()}`
  }
  return `wheel_${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`
}

const EMPTY_BALANCE: WheelBalance = {
  spins_available: 0,
  accumulated_byn: 0,
  threshold_byn: 40,
  progress_percent: 0,
  consecutive_nothing: 0,
}

/**
 * UX cache TTL для /api/wheel/state и /api/wheel/my-prizes.
 *
 * Пользователь жаловался на flicker полного скелетона при переходе
 * `/wheel` → `/wheel/how-it-works` → `/wheel` (или `/wheel/my-prizes`)
 * хотя данные были загружены секунду назад. 1 минуты достаточно для
 * быстрых in-app переходов; за минуту feed успеет обновиться при
 * следующем «настоящем» заходе. Всё что свежее TTL — отдаём из памяти
 * сразу, в фоне опционально делаем silent refresh без скелетона.
 */
export const WHEEL_STATE_CACHE_TTL_MS = 60_000

export type WheelMyPrizeFilter = 'all' | 'active' | 'used' | 'expired'

export const useWheelStore = defineStore('wheel', () => {
  const balance = ref<WheelBalance>({ ...EMPTY_BALANCE })
  const prizes = ref<WheelPrize[]>([])
  const rarities = ref<WheelRarity[]>([])
  const feed = ref<WheelFeedItem[]>([])
  const myActivePrizes = ref<WheelMyPrize[]>([])
  const myAllPrizes = ref<WheelMyPrize[]>([])
  // P3-UX: snapshot per filter, чтобы при возврате на уже загруженный
  // таб мы могли сразу восстановить данные из памяти без пересылки.
  // Без этого общий myAllPrizes держал бы только последний загруженный
  // срез — и cache-hit на старый таб отрисовывал бы прежний (чужой)
  // массив.
  const myPrizesByStatus = ref<Record<WheelMyPrizeFilter, WheelMyPrize[]>>({
    all: [],
    active: [],
    used: [],
    expired: [],
  })
  const eliteRarityCodes = ref<string[]>([])
  const settings = ref<WheelState['settings']>({
    pity_threshold: 3,
    spin_byn_retail: 40,
    spin_byn_wholesale: 200,
    elite_rarities: [],
  })
  const customerId = ref<string | null>(null)
  const isWholesale = ref(false)
  const isLoading = ref(false)
  const isSpinning = ref(false)
  const lastResult = ref<WheelSpinResult | null>(null)
  const stateError = ref('')
  const spinError = ref('')
  const feedConsent = ref(false)
  const feedConsentRequired = ref(false)
  const accessAllowed = ref(true)
  const accessLimited = ref(false)
  const isUpdatingConsent = ref(false)
  // P3-UX: timestamp последнего успешного /api/wheel/state. Пока он
  // свежий (см. WHEEL_STATE_CACHE_TTL_MS), повторный mount компонента
  // отдаёт уже загруженные данные без скелетона.
  const lastFetchedAt = ref<number | null>(null)
  // Аналогично для /api/wheel/my-prizes. Кэш per-filter: смена таба
  // должна заново запросить нужный срез.
  const myPrizesLastFetchedAt = ref<Record<WheelMyPrizeFilter, number | null>>({
    all: null,
    active: null,
    used: null,
    expired: null,
  })

  const hasSpins = computed(() => balance.value.spins_available > 0)
  const sortedPrizes = computed(() =>
    [...prizes.value].sort((a, b) => a.sort_order - b.sort_order),
  )

  async function fetchState(options: { silent?: boolean; force?: boolean } = {}) {
    const { silent = false, force = false } = options
    // P3-UX: cache hit. Возвращаем сразу: вызывающий код получит
    // already-loaded state без сетевого запроса. fetchState() после
    // спина передаёт force:true, чтобы баланс гарантированно
    // обновился, даже если кэш свежий.
    if (
      !force
      && lastFetchedAt.value !== null
      && Date.now() - lastFetchedAt.value < WHEEL_STATE_CACHE_TTL_MS
    ) {
      return null
    }
    if (!silent) {
      isLoading.value = true
    }
    stateError.value = ''
    try {
      const data = await fetchJson<WheelState>('/api/wheel/state')
      balance.value = data.balance
      prizes.value = data.prizes
      rarities.value = data.rarities
      feed.value = data.feed
      myActivePrizes.value = data.my_active_prizes
      settings.value = data.settings
      eliteRarityCodes.value = data.settings.elite_rarities
      customerId.value = data.customer_id
      isWholesale.value = data.is_wholesale
      feedConsent.value = Boolean(data.feed_consent)
      feedConsentRequired.value = Boolean(data.feed_consent_required)
      accessAllowed.value = Boolean(data.access?.is_allowed ?? true)
      accessLimited.value = Boolean(data.access?.is_limited ?? false)
      lastFetchedAt.value = Date.now()
      return data
    } catch (error: any) {
      // На ошибке lastFetchedAt не обновляем — следующий заход
      // попробует ещё раз. В silent-режиме (фоновый refresh) ошибку
      // в stateError тоже не пишем: пользователь видит уже
      // загруженные данные, а network blip — не повод показывать
      // ему красный тост или скелетон.
      if (!silent) {
        stateError.value = error?.message || 'Не удалось загрузить рулетку'
      }
      throw error
    } finally {
      if (!silent) {
        isLoading.value = false
      }
    }
  }

  async function spin(): Promise<WheelSpinResult> {
    if (isSpinning.value) {
      throw new Error('spin_in_progress')
    }
    isSpinning.value = true
    spinError.value = ''
    try {
      // P1: each /api/wheel/spin POST carries a fresh idempotency key.
      // If the POST is retried (network blip, user double-tap that
      // bypasses the local guard, etc.) the server returns the
      // original spin payload instead of consuming a second spin.
      const idempotencyKey = generateIdempotencyKey()
      const result = await fetchJson<WheelSpinResult>('/api/wheel/spin', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({}),
      })
      lastResult.value = result
      balance.value = {
        ...balance.value,
        spins_available: result.spins_left,
        accumulated_byn: result.accumulated_byn,
      }
      // После спина баланс/feed на сервере уже изменились. Invalidate
      // кэш, чтобы вызванный сразу следом fetchState() (см. WheelView
      // S2-6) реально дёрнул сеть, а не вернулся из памяти. То же
      // самое для my-prizes: новый приз должен появиться в "active"
      // и "all" срезах при следующем открытии экрана.
      lastFetchedAt.value = null
      myPrizesLastFetchedAt.value = {
        all: null,
        active: null,
        used: null,
        expired: null,
      }
      return result
    } catch (error: any) {
      spinError.value = error?.message || 'Не удалось крутить'
      throw error
    } finally {
      isSpinning.value = false
    }
  }

  /**
   * Q6: persist the customer's live-feed PII consent. Called from the
   * first-visit modal (with `true` or `false`) and from the toggle on
   * the retail Profile page (any value the user picks).
   */
  async function setFeedConsent(consent: boolean) {
    isUpdatingConsent.value = true
    try {
      const data = await fetchJson<{ success: boolean; consent: boolean; consent_at: string | null }>(
        '/api/wheel/feed-consent',
        {
          method: 'POST',
          body: JSON.stringify({ consent: Boolean(consent) }),
        },
      )
      feedConsent.value = Boolean(data.consent)
      feedConsentRequired.value = false
      return data
    } finally {
      isUpdatingConsent.value = false
    }
  }

  async function fetchMyPrizes(
    status: WheelMyPrizeFilter = 'all',
    options: { silent?: boolean; force?: boolean } = {},
  ) {
    const { force = false } = options
    if (
      !force
      && myPrizesLastFetchedAt.value[status] !== null
      && Date.now() - (myPrizesLastFetchedAt.value[status] as number)
        < WHEEL_STATE_CACHE_TTL_MS
    ) {
      // Cache hit: восстанавливаем prepared snapshot для этого фильтра,
      // чтобы вью отрисовало правильный срез, даже если пользователь
      // переключал табы.
      myAllPrizes.value = myPrizesByStatus.value[status]
      return myAllPrizes.value
    }
    const data = await fetchJson<{ prizes: WheelMyPrize[] }>(
      `/api/wheel/my-prizes?status=${encodeURIComponent(status)}`,
    )
    const list = data.prizes || []
    myAllPrizes.value = list
    myPrizesByStatus.value = {
      ...myPrizesByStatus.value,
      [status]: list,
    }
    myPrizesLastFetchedAt.value = {
      ...myPrizesLastFetchedAt.value,
      [status]: Date.now(),
    }
    return myAllPrizes.value
  }

  function isMyPrizesCacheFresh(status: WheelMyPrizeFilter): boolean {
    const ts = myPrizesLastFetchedAt.value[status]
    return ts !== null && Date.now() - ts < WHEEL_STATE_CACHE_TTL_MS
  }

  return {
    balance,
    prizes,
    rarities,
    feed,
    myActivePrizes,
    myAllPrizes,
    eliteRarityCodes,
    settings,
    customerId,
    isWholesale,
    isLoading,
    isSpinning,
    lastResult,
    stateError,
    spinError,
    feedConsent,
    feedConsentRequired,
    accessAllowed,
    accessLimited,
    isUpdatingConsent,
    lastFetchedAt,
    myPrizesLastFetchedAt,
    hasSpins,
    sortedPrizes,
    fetchState,
    spin,
    fetchMyPrizes,
    isMyPrizesCacheFresh,
    setFeedConsent,
  }
})
