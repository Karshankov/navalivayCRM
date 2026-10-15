import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { withTelegramAuthHeaders } from '@/utils/telegramAuth'

const STORAGE_KEY = 'navalivay_wholesale_context'

export interface WholesaleContext {
  code: string
  secret: string
  label: string
  /** Legacy: минимум в BYN (для заказов, созданных до перехода на позиции). */
  minOrderAmount: number
  /** Минимум уровня в позициях (null для старых контекстов). */
  minQuantity: number | null
  /** Применяемый минимум: персональный override ?? minQuantity. */
  effectiveMinQuantity: number | null
  /** Персональный минимум клиента, заданный админом (null = по уровню). */
  minOverride: number | null
}

function normalizeContext(raw: any): WholesaleContext | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const code = typeof raw.code === 'string' ? raw.code.trim() : ''
  const secret = typeof raw.secret === 'string' ? raw.secret.trim() : ''
  const label = typeof raw.label === 'string' ? raw.label.trim() : ''
  const minOrderAmount = Number(raw.minOrderAmount ?? raw.min_order_amount ?? 0)
  const minQuantityRaw = raw.minQuantity ?? raw.min_quantity ?? null
  const minQuantity = minQuantityRaw === null ? null : Number(minQuantityRaw)
  const overrideRaw = raw.minOverride ?? raw.min_override ?? null
  const minOverride = overrideRaw === null ? null : Number(overrideRaw)

  if (!code || !secret) {
    return null
  }

  // Должен быть минимум хотя бы одного вида: новый (позиции) или старый (сумма).
  const hasQuantity = minQuantity !== null && Number.isFinite(minQuantity) && minQuantity >= 1
  if (!hasQuantity && (!Number.isFinite(minOrderAmount) || minOrderAmount <= 0)) {
    return null
  }

  const effectiveMinQuantity = minOverride !== null && Number.isFinite(minOverride)
    ? Math.max(1, Math.floor(minOverride))
    : hasQuantity
      ? minQuantity
      : null

  return {
    code,
    secret,
    label: label || `Опт от ${code}`,
    minOrderAmount: Number.isFinite(minOrderAmount) ? minOrderAmount : 0,
    minQuantity: hasQuantity ? Math.max(1, Math.floor(minQuantity as number)) : null,
    effectiveMinQuantity,
    minOverride: minOverride !== null && Number.isFinite(minOverride)
      ? Math.max(1, Math.floor(minOverride))
      : null,
  }
}

function loadStoredContext(): WholesaleContext | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return null
    }
    return normalizeContext(JSON.parse(raw))
  } catch (error) {
    console.error('[wholesale] Failed to restore wholesale context', error)
    return null
  }
}

export const useWholesaleStore = defineStore('wholesale', () => {
  const context = ref<WholesaleContext | null>(loadStoredContext())
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  const isWholesale = computed(() => Boolean(context.value))
  const wholesaleCode = computed(() => context.value?.code || '')
  const wholesaleSecret = computed(() => context.value?.secret || '')
  const wholesaleLabel = computed(() => context.value?.label || '')
  const minOrderAmount = computed(() => Number(context.value?.minOrderAmount || 0))
  const minQuantity = computed(() => context.value?.minQuantity ?? null)
  const effectiveMinQuantity = computed(() => context.value?.effectiveMinQuantity ?? null)
  const minOverride = computed(() => context.value?.minOverride ?? null)

  function persistContext() {
    if (typeof window === 'undefined') {
      return
    }

    try {
      if (!context.value) {
        sessionStorage.removeItem(STORAGE_KEY)
        return
      }

      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(context.value))
    } catch (persistError) {
      console.error('[wholesale] Failed to persist wholesale context', persistError)
    }
  }

  function setContext(nextContext: WholesaleContext | null) {
    context.value = nextContext
    persistContext()
  }

  async function activateFromLink(code: string, secret: string) {
    isLoading.value = true
    error.value = null

    try {
      const params = new URLSearchParams({
        wholesale_code: code.trim(),
        wholesale_secret: secret.trim(),
      })
      const response = await fetch(`/api/wholesale/context?${params.toString()}`, {
        headers: withTelegramAuthHeaders(),
      })
      const payload = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(payload?.message || 'Не удалось открыть оптовый прайс')
      }

      const nextContext = normalizeContext({
        code: payload?.wholesale_code,
        secret,
        label: payload?.wholesale_label,
        minOrderAmount: payload?.wholesale_min_amount,
        minQuantity: payload?.wholesale_min_quantity,
        minOverride: payload?.wholesale_min_override ?? null,
      })

      if (!nextContext) {
        throw new Error('Сервер вернул неполный контекст оптового прайса')
      }

      setContext(nextContext)

      return nextContext
    } catch (requestError: any) {
      error.value = requestError?.message || 'Не удалось открыть оптовый прайс'
      throw requestError
    } finally {
      isLoading.value = false
    }
  }

  function restoreFromStorage() {
    const stored = loadStoredContext()
    context.value = stored
    return stored
  }

  /**
   * Обновить персональный минимум, не меняя остальной контекст.
   * Админ может поменять override среди сессии — вызывается на маунтах
   * HomeView и CheckoutView, пока клиент в опте.
   */
  async function refreshEffectiveMinimum() {
    if (!context.value) {
      return null
    }

    try {
      const params = new URLSearchParams({
        wholesale_code: context.value.code,
        wholesale_secret: context.value.secret,
      })
      const response = await fetch(`/api/wholesale/context?${params.toString()}`, {
        headers: {
          ...buildHeaders(),
          ...withTelegramAuthHeaders(),
        },
      })
      if (!response.ok) {
        return null
      }
      const payload = await response.json().catch(() => null)
      const overrideRaw = payload?.wholesale_min_override ?? null
      const override = overrideRaw === null ? null : Number(overrideRaw)
      if (override !== null && (!Number.isFinite(override) || override < 1)) {
        return null
      }
      const tierQuantityRaw = payload?.wholesale_min_quantity ?? null
      const tierQuantity = tierQuantityRaw === null ? null : Number(tierQuantityRaw)
      const hasTierQuantity = tierQuantity !== null && Number.isFinite(tierQuantity) && tierQuantity >= 1
      // Минимум уровня из активного контекста (для старых заказов снапшот
      // мог быть получен из applyOrderWholesaleContext, а API отдаёт null).
      const contextQuantity = hasTierQuantity ? tierQuantity : context.value.minQuantity
      // Персональный override имеет смысл только для минимума в позициях;
      // к старым (суммовым) заказам он не применяется.
      const effective = contextQuantity !== null ? (override ?? contextQuantity) : null

      context.value = {
        ...context.value,
        minOverride: contextQuantity !== null ? override : null,
        effectiveMinQuantity: effective,
        minQuantity: hasTierQuantity ? tierQuantity : context.value.minQuantity,
      }
      persistContext()
      return effective
    } catch (refreshError) {
      console.error('[wholesale] Failed to refresh effective minimum', refreshError)
      return null
    }
  }

  function applyOrderWholesaleContext(payload: {
    code?: string | null
    secret?: string | null
    label?: string | null
    minOrderAmount?: number | null
    minQuantity?: number | null
  }) {
    const normalizedCode = typeof payload.code === 'string' ? payload.code.trim() : ''
    const normalizedSecret =
      typeof payload.secret === 'string' && payload.secret.trim()
        ? payload.secret.trim()
        : context.value?.code === normalizedCode
          ? context.value.secret
          : ''

    const normalized = normalizeContext({
      code: normalizedCode,
      secret: normalizedSecret,
      label: payload.label,
      minOrderAmount: payload.minOrderAmount,
      minQuantity: payload.minQuantity,
      minOverride: null,
    })
    // Контекст заказа не знает про персональный override текущего клиента —
    // сохраняем его из активного контекста, если ссылка та же.
    if (
      normalized
      && context.value
      && context.value.code === normalized.code
      && context.value.minOverride !== null
    ) {
      normalized.minOverride = context.value.minOverride
      normalized.effectiveMinQuantity = context.value.minOverride
    }
    setContext(normalized)
    return normalized
  }

  function clearContext() {
    setContext(null)
    error.value = null
  }

  function isSameLink(code: string, secret: string) {
    return context.value?.code === code.trim() && context.value?.secret === secret.trim()
  }

  function buildHeaders(): Record<string, string> {
    if (!context.value) {
      return {}
    }

    return {
      'x-wholesale-code': context.value.code,
      'x-wholesale-secret': context.value.secret,
    }
  }

  /**
   * Сколько позиций не хватает до минимума опта.
   * Для старых (суммовых) контекстов без minQuantity — сколько BYN не хватает.
   */
  function remainingToMinimum(countableUnits: number, totalAmount = 0) {
    const minimum = Number(context.value?.effectiveMinQuantity || 0)
    if (minimum) {
      return Math.max(0, Math.ceil(minimum - Number(countableUnits || 0)))
    }

    const amountMinimum = Number(context.value?.minOrderAmount || 0)
    if (!amountMinimum) {
      return 0
    }

    return Math.max(0, Number((amountMinimum - Number(totalAmount || 0)).toFixed(2)))
  }

  /** Набран ли минимум опта: в позициях (новый режим) или по сумме (legacy). */
  function meetsMinimum(countableUnits: number, totalAmount = 0) {
    if (!context.value) {
      return true
    }

    const minimum = Number(context.value.effectiveMinQuantity || 0)
    if (minimum) {
      return Number(countableUnits || 0) >= minimum
    }

    return Number(totalAmount || 0) >= Number(context.value.minOrderAmount || 0)
  }

  return {
    context,
    isLoading,
    error,
    isWholesale,
    wholesaleCode,
    wholesaleSecret,
    wholesaleLabel,
    minOrderAmount,
    minQuantity,
    effectiveMinQuantity,
    minOverride,
    activateFromLink,
    restoreFromStorage,
    refreshEffectiveMinimum,
    applyOrderWholesaleContext,
    clearContext,
    isSameLink,
    buildHeaders,
    remainingToMinimum,
    meetsMinimum,
  }
})
