<template>
  <section class="crm-hub-panel crm-hub-stats" data-test="customer-hub-stats">
    <div class="crm-hub-stat-grid">
      <div class="crm-hub-stat">
        <span class="crm-hub-stat-label">Средний чек</span>
        <strong class="crm-hub-stat-value" data-test="customer-hub-stat-average">
          <template v-if="stats.orders_delivered">{{ money(stats.average_check) }}<span class="crm-hub-stat-unit">BYN</span></template>
          <template v-else>—</template>
        </strong>
        <small>{{ stats.orders_delivered ? `по ${stats.orders_delivered} ${pluralRu(stats.orders_delivered, 'выданному заказу', 'выданным заказам', 'выданным заказам')}` : 'нет выданных заказов' }}</small>
      </div>
      <div class="crm-hub-stat">
        <span class="crm-hub-stat-label">Потратил</span>
        <strong class="crm-hub-stat-value" data-test="customer-hub-stat-spent">{{ money(stats.total_spent) }}<span class="crm-hub-stat-unit">BYN</span></strong>
        <small>за выданные заказы</small>
      </div>
      <div class="crm-hub-stat">
        <span class="crm-hub-stat-label">Заказов всего</span>
        <strong class="crm-hub-stat-value" data-test="customer-hub-stat-orders">{{ stats.orders_total }}</strong>
        <span class="crm-hub-stat-breakdown" data-test="customer-hub-stat-orders-breakdown">
          <small>Выдано — {{ stats.orders_delivered }}</small>
          <small :class="{ 'is-danger': stats.orders_cancelled > 0 }">Отменено — {{ stats.orders_cancelled }}</small>
          <small v-if="stats.orders_active > 0">В работе — {{ stats.orders_active }}</small>
        </span>
      </div>
      <div class="crm-hub-stat">
        <span class="crm-hub-stat-label">Пригласил</span>
        <strong class="crm-hub-stat-value" data-test="customer-hub-stat-invited">{{ stats.invited_total }}</strong>
        <small>{{ stats.invited_total ? `${stats.invited_with_orders} с покупками` : 'пока никого' }}</small>
      </div>
    </div>
    <p v-if="stats.favorite_product || stats.last_order_at" class="crm-hub-stat-foot">
      <span v-if="stats.favorite_product" data-test="customer-hub-stat-favorite">
        <HeartIcon aria-hidden="true" />
        {{ stats.favorite_product.title }}<em>× {{ stats.favorite_product.quantity }}</em>
      </span>
      <span v-if="stats.last_order_at" data-test="customer-hub-stat-dates">
        Последний заказ {{ daysAgoText(stats.last_order_at) }}<template v-if="stats.first_order_at"> · покупает с {{ formatHubDate(stats.first_order_at, false) }}</template>
      </span>
    </p>
  </section>
</template>

<script setup lang="ts">
import { HeartIcon } from '@heroicons/vue/24/solid'
import type { HubCustomerStats } from '@/utils/crmCustomerHubApi'
import { daysAgoText, formatHubDate, pluralRu } from './hubFormat'

defineProps<{ stats: HubCustomerStats }>()

/** Сумма без «BYN» — валюта рисуется отдельным мелким юнитом; копейки только если есть. */
function money(value: number) {
  const amount = Number(value || 0)
  return amount.toLocaleString('ru-RU', { minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 })
}
</script>
