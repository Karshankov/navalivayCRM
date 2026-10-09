import { computed, ref } from 'vue'
import { getTelegramIdentity } from '@/utils/customerOrders'

/**
 * Информация о блокировке клиента, отдаваемая backend'ом.
 * Совместима с ответом GET /api/customers/:telegramId/check-blocks
 * и body 403 от POST /api/orders.
 */
export interface CustomerBlockInfo {
  reason: string | null
  block_until: string | null
  blocked_at?: string
}

// Singleton-state на всё приложение: один источник правды о текущем блоке
// активного клиента. Используется и App.vue (для рендера экрана), и
// CheckoutView (для обработки 403 от submitOrder).
const currentBlock = ref<CustomerBlockInfo | null>(null)
let inflightRefresh: Promise<void> | null = null

export function useCustomerBlock() {
  const isBlocked = computed(() => currentBlock.value !== null)

  /**
   * Запрашивает текущий статус блокировки у backend'а.
   * Если запрос уже идёт — возвращаем тот же Promise (de-dup), чтобы
   * параллельные caller'ы дождались его, а не молча пропускали.
   * Используется на старте миниапки в App.vue.
   */
  async function refreshBlock(): Promise<void> {
    if (inflightRefresh) return inflightRefresh
    inflightRefresh = doRefresh().finally(() => {
      inflightRefresh = null
    })
    return inflightRefresh
  }

  async function doRefresh(): Promise<void> {
    const identity = getTelegramIdentity()
    if (!identity.telegramId) {
      clearBlock()
      return
    }
    try {
      const response = await fetch(
        `/api/customers/${encodeURIComponent(identity.telegramId)}/check-blocks`,
        { credentials: 'include' },
      )
      if (!response.ok) {
        // На 4xx/5xx не блокируем — приложение просто работает как обычно
        console.warn('[customer-block] check-blocks returned non-ok:', response.status)
        clearBlock()
        return
      }
      const data = await response.json()
      if (data?.blocked) {
        currentBlock.value = {
          reason: data.reason ?? null,
          block_until: data.block_until ?? null,
          blocked_at: data.blocked_at,
        }
      } else {
        clearBlock()
      }
    } catch (err) {
      // Сеть упала — не показываем ложный экран блокировки
      console.warn('[customer-block] check-blocks fetch failed:', err)
      clearBlock()
    }
  }

  function clearBlock(): void {
    currentBlock.value = null
  }

  /**
   * Применяет данные блокировки из 403-ответа конкретного запроса
   * (например, попытка оформить заказ). Backend возвращает
   *   { error: 'customer_blocked', block: { reason, block_until, ... } }
   */
  function applyBlockFromResponse(blockPayload: Partial<CustomerBlockInfo> | null | undefined): void {
    if (!blockPayload) return
    currentBlock.value = {
      reason: blockPayload.reason ?? null,
      block_until: blockPayload.block_until ?? null,
      blocked_at: blockPayload.blocked_at,
    }
  }

  return {
    currentBlock,
    isBlocked,
    refreshBlock,
    applyBlockFromResponse,
    clearBlock,
  }
}
