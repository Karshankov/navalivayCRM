import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

const STORAGE_KEY = 'navalivay_wholesale_context'

export interface WholesaleContext {
  code: string
  secret: string
  label: string
  minOrderAmount: number
}

function normalizeContext(raw: any): WholesaleContext | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const code = typeof raw.code === 'string' ? raw.code.trim() : ''
  const secret = typeof raw.secret === 'string' ? raw.secret.trim() : ''
  const label = typeof raw.label === 'string' ? raw.label.trim() : ''
  const minOrderAmount = Number(raw.minOrderAmount ?? raw.min_order_amount ?? 0)

  if (!code || !secret || !Number.isFinite(minOrderAmount) || minOrderAmount <= 0) {
    return null
  }

  return {
    code,
    secret,
    label: label || `Опт от ${code} BYN`,
    minOrderAmount,
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
      const response = await fetch(`/api/wholesale/context?${params.toString()}`)
      const payload = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(payload?.message || 'Не удалось открыть оптовый прайс')
      }

      const nextContext = normalizeContext({
        code: payload?.wholesale_code,
        secret,
        label: payload?.wholesale_label,
        minOrderAmount: payload?.wholesale_min_amount,
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

  function applyOrderWholesaleContext(payload: {
    code?: string | null
    secret?: string | null
    label?: string | null
    minOrderAmount?: number | null
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
    })
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

  function remainingToMinimum(totalAmount: number) {
    const minimum = Number(context.value?.minOrderAmount || 0)
    if (!minimum) {
      return 0
    }

    return Math.max(0, Number((minimum - Number(totalAmount || 0)).toFixed(2)))
  }

  function meetsMinimum(totalAmount: number) {
    if (!context.value) {
      return true
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
    activateFromLink,
    restoreFromStorage,
    applyOrderWholesaleContext,
    clearContext,
    isSameLink,
    buildHeaders,
    remainingToMinimum,
    meetsMinimum,
  }
})
