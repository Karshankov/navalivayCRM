<template>
  <section class="crm-hub-panel" data-test="customer-hub-recent-orders">
    <span class="crm-hub-head"><span class="crm-hub-head-icon" aria-hidden="true"><ShoppingBagIcon /></span><span class="crm-hub-section-title">{{ history ? 'Все заказы' : 'Последние заказы' }}</span></span>
    <p v-if="!rows.length" class="crm-note-hint">Заказов пока нет.</p>
    <ul v-else class="crm-hub-orders" :class="{ 'is-history': history }">
      <li v-for="order in rows" :key="order.id">
        <button
          type="button"
          class="crm-hub-order-row"
          :disabled="disabled"
          :aria-label="`Открыть заказ №${order.order_number}`"
          data-test="customer-hub-open-order"
          @click="$emit('open-order', order.id)"
        >
          <strong>№{{ order.order_number }}</strong>
          <span class="crm-hub-order-date">{{ formatHubDate(order.created_at, false) }}</span>
          <span class="crm-hub-plate" :class="statusClass(order.status)">{{ orderStatusText(order.status) }}</span>
          <strong class="crm-hub-orders-amount">{{ formatAmount(order.amount) }}</strong>
          <ChevronRightIcon class="crm-hub-order-arrow" aria-hidden="true" />
        </button>
      </li>
    </ul>
    <p v-if="error" class="crm-note-error" role="alert">{{ error }}</p>
    <button
      v-if="history"
      type="button"
      class="crm-hub-link crm-hub-orders-more"
      data-test="customer-hub-orders-collapse"
      @click="history = null"
    >Свернуть</button>
    <button
      v-else-if="total > orders.length"
      type="button"
      class="crm-hub-link crm-hub-orders-more"
      :disabled="loading"
      data-test="customer-hub-orders-history"
      @click="loadHistory"
    >{{ loading ? 'Загружаем…' : `Вся история · ${total} ${pluralRu(total, 'заказ', 'заказа', 'заказов')}` }}</button>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronRightIcon, ShoppingBagIcon } from '@heroicons/vue/24/outline'
import { fetchCustomerOrders, hubErrorText, type HubRecentOrder } from '@/utils/crmCustomerHubApi'
import { formatAmount, formatHubDate, orderStatusText, pluralRu } from './hubFormat'

const props = defineProps<{
  orders: HubRecentOrder[]
  customerId: string
  /** Всего заказов у клиента — для ссылки на всю историю. */
  total: number
  disabled?: boolean
}>()
defineEmits<{ (e: 'open-order', orderId: string): void }>()

/** Вся история, загруженная по кнопке; null — показываем последние заказы из хаба. */
const history = ref<HubRecentOrder[] | null>(null)
const loading = ref(false)
const error = ref('')
const rows = computed(() => history.value ?? props.orders)

let revision = 0
async function loadHistory() {
  const current = ++revision
  loading.value = true
  error.value = ''
  try {
    const { orders } = await fetchCustomerOrders(props.customerId)
    if (current === revision) history.value = orders
  } catch (err: unknown) {
    if (current === revision) error.value = hubErrorText(err, 'Не удалось загрузить историю заказов.')
  } finally {
    if (current === revision) loading.value = false
  }
}

// Другой клиент или перечитанный хаб — показываем свежие последние заказы.
watch(() => [props.customerId, props.orders], () => {
  revision += 1
  history.value = null
  loading.value = false
  error.value = ''
})

function statusClass(status: string) {
  if (status === 'cancelled') return 'crm-hub-plate--danger'
  // Выданный заказ — обычное завершение, без акцента; синим — то, что ещё в работе.
  if (status === 'delivered' || status === 'completed') return ''
  return 'crm-hub-plate--info'
}
</script>
