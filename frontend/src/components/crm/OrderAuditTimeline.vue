<template>
  <section class="order-audit" aria-labelledby="order-audit-heading">
    <div class="audit-heading">
      <div>
        <h2 id="order-audit-heading">История заказа</h2>
        <p>Сохранённые события · время по Минску</p>
      </div>
      <button type="button" :disabled="loading" @click="$emit('retry')">Обновить историю</button>
    </div>
    <p v-if="loading" role="status">Загружаем историю…</p>
    <p v-if="error" class="audit-error" role="alert">{{ error }}</p>
    <p v-if="!loading && !lifecycle.length">Событий пока нет. Подробный аудит доступен только для изменений после его подключения.</p>
    <ol v-else class="audit-timeline" aria-label="Хронология заказа" tabindex="0">
      <li v-for="entry in lifecycle" :key="entry.id" class="audit-step">
        <span class="audit-dot" aria-hidden="true">✓</span>
        <strong>{{ entry.title }}</strong>
        <span>{{ entry.actor }}</span>
        <time :datetime="entry.at">{{ formatDate(entry.at) }}</time>
      </li>
    </ol>
    <button type="button" class="audit-toggle" :aria-expanded="expanded" aria-controls="order-audit-journal" @click="expanded = !expanded">
      {{ expanded ? 'Скрыть подробный журнал' : 'Показать подробный журнал' }} · {{ events.length }}
    </button>
    <div v-if="expanded" id="order-audit-journal" class="audit-journal">
      <p v-if="!events.length">Для старых изменений сохранилась только история статусов. Детальные значения и авторов восстановить нельзя.</p>
      <article v-for="event in orderedEvents" :key="event.id" class="audit-event">
        <div class="audit-event-heading">
          <strong>{{ eventLabel(event) }}</strong>
          <time :datetime="event.occurred_at">{{ formatDate(event.occurred_at, true) }}</time>
        </div>
        <p>{{ event.actor_name }} · {{ actorLabels[event.actor_type] }}<span v-if="event.product_title"> · {{ event.product_title }}</span></p>
        <dl class="audit-values">
          <div><dt>До</dt><dd><pre>{{ formatValue(event.before, event.field) }}</pre></dd></div>
          <div><dt>После</dt><dd><pre>{{ formatValue(event.after, event.field) }}</pre></dd></div>
        </dl>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { OrderAuditEvent } from '@/stores/crm'

type LegacyEntry = {
  id: string
  previous_status: string | null
  new_status: string
  changed_at: string
  note: string | null
}
const props = defineProps<{
  events: OrderAuditEvent[]
  history: LegacyEntry[]
  loading: boolean
  error: string
}>()
defineEmits<{ retry: [] }>()
const expanded = ref(false)
const actorLabels = { employee: 'Сотрудник', admin: 'Администратор', customer: 'Покупатель', system: 'Система' }
const statusLabels: Record<string, string> = {
  new: 'Новый', in_progress: 'Собран', completed: 'Завершён', delivered: 'Выдан', cancelled: 'Отменён',
}
const fieldLabels: Record<string, string> = {
  status: 'Статус', quantity: 'Количество', price_per_unit: 'Цена за единицу',
  manual_discount_amount: 'Ручная скидка строки', loyalty_discount_amount: 'Скидка лояльности',
  loyalty_units_applied: 'Бонусные единицы', discount_amount: 'Скидка BYN',
  discount_percent: 'Скидка %', additional_cost: 'Надбавка', final_amount: 'Итого к оплате',
  total_amount: 'Сумма позиций', profit: 'Прибыль', total_price: 'Сумма строки',
  cost_per_unit: 'Себестоимость единицы', total_cost: 'Себестоимость строки',
  delivery_address: 'Адрес доставки', delivery_type: 'Тип отдачи', notes: 'Комментарий',
  paid_amount: 'Оплаченная сумма', paid_at: 'Дата оплаты', payment_type: 'Способ оплаты',
  payment_account_id: 'Счёт оплаты', payment_notes: 'Комментарий к оплате',
  card_amount_minor: 'Оплата картой (коп.)', cash_due_minor: 'Наличные (коп.)',
  completed_at: 'Дата выдачи', archived: 'Архив', stock_deducted: 'Списание остатков',
  promo_code_text: 'Промокод', promo_code_id: 'ID промокода',
  manager_action_type: 'Действие менеджера', needs_manager_action: 'Требуется обработка',
  manager_action_note: 'Описание изменений', manager_action_resolved_at: 'Дата обработки',
  assembled_at: 'Дата сборки', assembled_by_employee_id: 'Сотрудник сборки',
  issued_at: 'Дата выдачи', issued_by_employee_id: 'Сотрудник выдачи',
  cancelled_at: 'Дата отмены', phone: 'Телефон', telegram_username: 'Telegram',
  base_price_per_unit: 'Цена каталога', catalog_discount_per_unit: 'Скидка каталога',
}
function utcDate(value: string) {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? value.replace(' ', 'T') + 'Z' : value
  return new Date(normalized)
}
function formatDate(value: string, precise = false) {
  const date = utcDate(value)
  if (!Number.isFinite(date.getTime())) return 'Дата неизвестна'
  return date.toLocaleString('ru-RU', {
    timeZone: 'Europe/Minsk', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', ...(precise ? { second: '2-digit' as const } : {}),
  })
}
const orderedEvents = computed(() => [...props.events].sort((a, b) => a.sequence - b.sequence))
function eventLabel(event: OrderAuditEvent) {
  if (event.event_type === 'order_created') return 'Заказ создан'
  if (event.event_type === 'item_added') return 'Товар добавлен'
  if (event.event_type === 'item_removed') return 'Товар удалён'
  const label = fieldLabels[event.field || ''] || event.field || 'Данные заказа'
  if (event.product_id && event.field === 'discount_amount') return 'Общая скидка строки'
  return `${label}: изменение`
}
function formatValue(value: unknown, field: string | null): string {
  if (value === null || value === undefined) return '—'
  if (field === 'status' && typeof value === 'string') return statusLabels[value] || value
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}
const lifecycle = computed(() => {
  const operations = new Map<string, OrderAuditEvent[]>()
  for (const event of orderedEvents.value) {
    const group = operations.get(event.operation_id) || []
    group.push(event)
    operations.set(event.operation_id, group)
  }
  const entries = [...operations.values()].map((group) => {
    const event = group[0]!
    const created = group.find((item) => item.event_type === 'order_created')
    const status = group.find((item) => item.event_type === 'status_changed')
    const role = event.actor_type === 'customer' ? 'покупателем'
      : event.actor_type === 'system' ? 'системой'
      : event.actor_type === 'employee' ? 'сотрудником' : 'менеджером'
    const title = created ? `Заказ создан ${role}`
      : event.source === 'crm.remove_payment' ? 'Оплата отменена'
      : event.source === 'miniapp.modify' ? 'Заказ изменён покупателем'
      : event.source === 'crm.resolve_action' ? 'Изменения обработаны менеджером'
      : status?.after === 'cancelled' ? `Заказ отменён ${role}`
      : status?.after === 'delivered' ? `Заказ выдан ${role}`
      : status?.after === 'in_progress' ? `Заказ собран ${role}`
      : status ? `Статус: ${formatValue(status.after, 'status')}`
      : event.source === 'system.archive' ? 'Заказ архивирован'
      : `Заказ изменён ${role}`
    return { id: event.operation_id, title, actor: event.actor_name, at: event.occurred_at }
  })
  const firstAuditAt = entries.length ? Math.min(...entries.map((entry) => utcDate(entry.at).getTime())) : Infinity
  // New status writes are mirrored into the legacy table. Only earlier
  // legacy entries are added, so the timeline does not show them twice.
  for (const entry of props.history) {
    if (utcDate(entry.changed_at).getTime() >= Math.floor(firstAuditAt / 1000) * 1000) continue
    entries.push({
      id: `legacy:${entry.id}`, title: entry.note || `Статус: ${statusLabels[entry.new_status] || entry.new_status}`,
      actor: 'Автор неизвестен · старая история', at: entry.changed_at,
    })
  }
  return entries.sort((a, b) => utcDate(a.at).getTime() - utcDate(b.at).getTime())
})
</script>

<style scoped>
.order-audit { min-width: 0; }
.audit-heading, .audit-event-heading { display: flex; justify-content: space-between; align-items: start; flex-wrap: wrap; gap: 12px; }
.audit-heading h2 { font-size: 18px; font-weight: 750; }
.audit-heading p, .audit-event p { color: #718198; font-size: 12px; margin-top: 4px; }
.order-audit button { border: 1px solid #cfe0ff; background: #fff; border-radius: 10px; padding: 8px 12px; color: #2066c8; font-size: 12px; }
.order-audit button:focus-visible, .audit-timeline:focus-visible { outline: 3px solid #05b8ff; outline-offset: 3px; }
.audit-timeline { display: flex; gap: 0; overflow-x: auto; padding: 18px 0 16px; margin: 0; list-style: none; }
.audit-step { flex: 1 0 190px; min-width: 0; position: relative; display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 0 10px 4px; text-align: center; font-size: 15px; overflow-wrap: anywhere; }
.audit-step::before { content: ''; position: absolute; top: 17px; left: 50%; width: 100%; height: 5px; background: linear-gradient(90deg,#1a6bff,#3f7eff); border-radius: 999px; }
.audit-step:last-child::before { display: none; }
.audit-dot { position: relative; display: grid; place-items: center; width: 38px; height: 38px; flex: 0 0 38px; box-sizing: border-box; border: 4px solid #dce8ff; border-radius: 50%; background: linear-gradient(180deg,#2d83ff,#2d57ff); color: white; margin: 0 auto 14px; font-size: 18px; font-weight: 900; z-index: 2; }
.audit-step strong { color: #0b164a; font-size: 15px; font-weight: 800; line-height: 1.25; }
.audit-step > span:not(.audit-dot) { color: #3a4570; font-size: 13px; line-height: 1.35; }
.audit-step time { color: #0b164a; font-size: 14px; font-weight: 900; margin-top: 4px; }
.audit-toggle { margin-top: 8px; }
.audit-journal { margin-top: 14px; display: grid; gap: 10px; }
.audit-event { border: 1px solid #e3ebf6; border-radius: 12px; padding: 12px; font-size: 12px; min-width: 0; }
.audit-event time { color: #718198; }
.audit-values { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 10px; }
.audit-values dt { color: #718198; margin-bottom: 4px; }
.audit-values dd { margin: 0; }
.audit-values pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; margin: 0; }
.audit-error { color: #b4233c; margin-top: 10px; }
@media (max-width: 640px) { .audit-values { grid-template-columns: 1fr; } .audit-step { flex-basis: 170px; } }
</style>
