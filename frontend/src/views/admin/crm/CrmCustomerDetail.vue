<template>
  <div class="min-h-screen bg-gray-50 p-6">
    <div class="mx-auto max-w-6xl space-y-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <button
          @click="goBack"
          class="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Назад к списку
        </button>
        <div class="flex flex-wrap items-center gap-2">
          <button
            @click="loadCustomer()"
            class="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Обновить
          </button>
          <button
            v-if="hasActiveBlock"
            @click="unblockCustomer"
            class="inline-flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition-colors hover:bg-red-100"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m2 0a2 2 0 110 4H7a2 2 0 110-4m6-9v6" />
            </svg>
            Разблокировать доставку
          </button>
          <button
            v-else
            @click="showBlockModal = true"
            class="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 5.636l-12.728 12.728M5.636 5.636l12.728 12.728" />
            </svg>
            Заблокировать доставку
          </button>
          <button
            @click="showDiscountBlockModal = true"
            class="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors"
            :class="discountBlockActive
              ? 'border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
              : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-100'"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            {{ discountBlockActive ? `Скидки: до ${discountBlockUntilLabel}` : 'Блокировка скидок' }}
          </button>
        </div>
      </div>

      <div
        v-if="loading"
        class="flex min-h-[320px] items-center justify-center rounded-xl border border-dashed border-blue-200 bg-white"
      >
        <div class="flex flex-col items-center gap-4">
          <div class="h-12 w-12 animate-spin rounded-full border-4 border-blue-600 border-r-transparent"></div>
          <p class="text-sm text-gray-500">Загружаем данные клиента...</p>
        </div>
      </div>

      <div v-else-if="customer" class="space-y-6">
        <section class="grid gap-6 lg:grid-cols-[2fr,1fr]">
          <div class="rounded-xl bg-white p-6 shadow-sm">
            <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h1 class="text-2xl font-bold text-gray-900">
                  {{ customer.first_name || 'Без имени' }} {{ customer.last_name || '' }}
                </h1>
                <div class="mt-2 flex flex-wrap gap-2 text-sm text-gray-500">
                  <span
                    v-if="customer.telegram_username"
                    class="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-blue-700"
                  >
                    <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12l2 2 6-6" />
                    </svg>
                    <a :href="`https://t.me/${customer.telegram_username}`" target="_blank">@{{ customer.telegram_username }}</a>
                  </span>
                  <span
                    v-if="customer.telegram_id"
                    class="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-gray-600"
                  >
                    ID: {{ customer.telegram_id }}
                  </span>
                  <span
                    v-if="temperatureBadge"
                    class="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold"
                    :class="temperatureBadge.badgeClass"
                  >
                    {{ temperatureBadge.label }}
                  </span>
                </div>

                <div class="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <p class="text-xs uppercase text-gray-500">Телефон</p>
                    <p class="mt-1 text-sm text-gray-900">{{ customer.phone || '—' }}</p>
                  </div>
                  <div>
                    <p class="text-xs uppercase text-gray-500">Последний визит</p>
                    <p class="mt-1 text-sm text-gray-900">{{ lastVisitAt ? formatRelative(lastVisitAt) : 'Никогда' }}</p>
                  </div>
                  <div>
                    <p class="text-xs uppercase text-gray-500">Последний заказ</p>
                    <p class="mt-1 text-sm text-gray-900">{{ lastOrderAt ? formatDateTime(lastOrderAt) : 'Никогда' }}</p>
                  </div>
                  <div>
                    <p class="text-xs uppercase text-gray-500">Первый визит</p>
                    <p class="mt-1 text-sm text-gray-900">{{ customer.first_visit_at ? formatDateTime(customer.first_visit_at) : '—' }}</p>
                  </div>
                </div>

                <div v-if="customer.notes" class="mt-4 rounded-lg bg-gray-50 p-4 text-sm text-gray-700">
                  {{ customer.notes }}
                </div>
              </div>
              <div class="flex flex-col items-end gap-3 text-right">
                <div class="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-xs text-gray-500">
                  Обновлено: {{ customer.updated_at ? formatDateTime(customer.updated_at) : '—' }}
                </div>
                <div
                  v-if="hasActiveBlock"
                  class="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-600"
                >
                  Доставка заблокирована: {{ activeBlock?.reason || 'Без причины' }}
                </div>
              </div>
            </div>
          </div>

          <section
            class="rounded-xl border p-6 shadow-sm"
            :class="customer.card_payment?.enabled
              ? 'border-emerald-200 bg-emerald-50'
              : 'border-slate-200 bg-white'"
            aria-labelledby="customer-card-payment-title"
          >
            <div class="flex items-start justify-between gap-4">
              <div>
                <p class="text-xs font-semibold uppercase tracking-wide text-gray-500">Оплата картой</p>
                <h2 id="customer-card-payment-title" class="mt-1 text-lg font-bold text-gray-900">
                  {{ customer.card_payment?.enabled ? '✓ Разрешена' : '✕ Запрещена' }}
                </h2>
              </div>
              <span
                class="rounded-full px-3 py-1 text-xs font-bold"
                :class="customer.card_payment?.enabled
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-slate-100 text-slate-600'"
              >
                {{ customer.card_payment?.card_available ? 'Доступна сейчас' : 'Недоступна сейчас' }}
              </span>
            </div>
            <div v-if="customer.card_payment?.enabled" class="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div class="rounded-lg bg-white/80 p-3">
                <p class="text-xs text-gray-500">Лимит заказа</p>
                <p class="mt-1 font-bold text-gray-900">{{ formatCurrency((customer.card_payment.max_order_minor || 0) / 100) }}</p>
              </div>
              <div class="rounded-lg bg-white/80 p-3">
                <p class="text-xs text-gray-500">До разблокировки</p>
                <p class="mt-1 font-bold text-gray-900">
                  {{ customer.card_payment.cooldown_until ? formatDateTime(customer.card_payment.cooldown_until) : '—' }}
                </p>
              </div>
            </div>
          </section>

          <div class="space-y-4">
            <div class="rounded-xl bg-white p-6 shadow-sm">
              <p class="text-xs font-semibold uppercase text-gray-500">Статистика</p>
              <div class="mt-4 space-y-3 text-sm text-gray-700">
                <div class="flex items-center justify-between">
                  <span>Заказов</span>
                  <span class="font-semibold text-gray-900">{{ totalOrders }}</span>
                </div>
                <div class="flex items-center justify-between">
                  <span>Общая сумма</span>
                  <span class="font-semibold text-gray-900">{{ formatCurrency(totalSpent) }}</span>
                </div>
                <div class="flex items-center justify-between">
                  <span>Создан</span>
                  <span class="font-semibold text-gray-900">{{ formatDateTime(customer.created_at) }}</span>
                </div>
              </div>
            </div>

            <div class="rounded-xl bg-white p-6 shadow-sm">
              <p class="text-xs font-semibold uppercase text-gray-500">Контакты</p>
              <div class="mt-4 space-y-3">
                <label class="block text-xs font-medium text-gray-600">
                  Телефон
                  <input
                    v-model="phone"
                    type="tel"
                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    placeholder="+7"
                  />
                </label>
                <label class="block text-xs font-medium text-gray-600">
                  Заметка
                  <textarea
                    v-model="notes"
                    rows="3"
                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    placeholder="Комментарий для команды"
                  ></textarea>
                </label>
                <div class="flex items-center justify-between">
                  <span v-if="saveSuccess" class="text-xs text-emerald-600">Сохранено</span>
                  <button
                    @click="saveCustomer"
                    :disabled="saving"
                    class="ml-auto inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <svg v-if="saving" class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <circle cx="12" cy="12" r="10" stroke-opacity="0.25" stroke-width="4" />
                      <path d="M4 12a8 8 0 018-8" stroke-linecap="round" stroke-width="4" />
                    </svg>
                    <span>{{ saving ? 'Сохраняем...' : 'Сохранить' }}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="rounded-xl bg-white p-6 shadow-sm">
          <header class="mb-4 flex items-center justify-between">
            <div>
              <h2 class="text-lg font-semibold text-gray-900">Последние заказы</h2>
              <p class="text-sm text-gray-500">История взаимоотношений</p>
            </div>
            <span class="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">{{ orders.length }}</span>
          </header>
          <div v-if="orders.length" class="space-y-3">
            <article
              v-for="order in orders"
              :key="order.id"
              class="rounded-lg border border-gray-200 p-4 text-sm text-gray-700"
            >
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-semibold text-gray-900">#{{ order.order_number }}</span>
                  <span :class="['rounded-full px-2 py-0.5 text-xs font-semibold', orderStatusBadge(order).class]">
                    {{ orderStatusBadge(order).label }}
                  </span>
                </div>
                <div class="text-sm font-semibold text-gray-900">{{ formatCurrency(order.final_amount) }}</div>
              </div>
              <div class="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                <span>{{ formatDateTime(order.created_at) }}</span>
                <span v-if="order.delivery_type === 'delivery'" class="inline-flex items-center gap-1 text-rose-600">
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7m-9 2v8m4-8v8m2 0h6m-6 0V9m0 0l2 2 4-4" />
                  </svg>
                  Доставка
                </span>
                <span v-else class="inline-flex items-center gap-1 text-gray-500">
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7h18M3 12h18M3 17h18" />
                  </svg>
                  Самовывоз
                </span>
              </div>
              <p v-if="order.notes" class="mt-2 text-xs text-gray-500">{{ order.notes }}</p>
            </article>
          </div>
          <p
            v-else
            class="rounded-lg border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-400"
          >
            История заказов пуста.
          </p>
        </section>

        <section class="rounded-xl bg-white p-6 shadow-sm">
          <header class="mb-4 flex items-center justify-between">
            <div>
              <h2 class="text-lg font-semibold text-gray-900">Логи посещений</h2>
              <p class="text-sm text-gray-500">Последние действия клиента на витрине</p>
            </div>
            <span class="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">{{ visitLogs.length }}</span>
          </header>
          <div v-if="visitLogs.length" class="overflow-hidden rounded-lg border border-gray-200">
            <table class="min-w-full divide-y divide-gray-200 text-sm">
              <thead class="bg-gray-50 text-left text-xs font-semibold text-gray-500">
                <tr>
                  <th class="px-4 py-2">Дата</th>
                  <th class="px-4 py-2">Страница</th>
                  <th class="px-4 py-2">Действие</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100">
                <tr v-for="log in visitLogs" :key="log.id" class="text-gray-700">
                  <td class="px-4 py-2 text-xs text-gray-500">{{ formatDateTime(log.visited_at) }}</td>
                  <td class="px-4 py-2">{{ visitLabel(log) }}</td>
                  <td class="px-4 py-2 text-xs text-gray-500">{{ log.action || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p
            v-else
            class="rounded-lg border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-400"
          >
            Посещений ещё не зафиксировано.
          </p>
        </section>
      </div>
    </div>

    <div
      v-if="showBlockModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 px-4"
      v-safe-backdrop-close="() => (showBlockModal = false)"
    >
      <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h3 class="text-xl font-semibold text-gray-900">Блокировка доставки</h3>
        <p class="mt-2 text-sm text-gray-500">Укажите причину блокировки доставки для клиента.</p>
        <textarea
          v-model="blockReason"
          rows="3"
          class="mt-4 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-200"
          placeholder="Причина блокировки"
        ></textarea>
        <div class="mt-4 flex gap-3">
          <button
            @click="confirmBlock"
            :disabled="blockInProgress"
            class="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {{ blockInProgress ? 'Блокируем...' : 'Заблокировать' }}
          </button>
          <button
            @click="showBlockModal = false"
            class="flex-1 rounded-lg border border-gray-200 bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
          >
            Отмена
          </button>
        </div>
      </div>
    </div>

    <DiscountBlockModal
      :is-open="showDiscountBlockModal"
      :customer-id="customer?.id || ''"
      :status="customer?.discount_block ?? null"
      @close="showDiscountBlockModal = false"
      @changed="loadCustomer()"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useCrmStore } from '@/stores/crm'
import type { Customer, Order, VisitLog } from '@/stores/crm'
import DiscountBlockModal from '@/components/admin/DiscountBlockModal.vue'
import { vSafeBackdropClose } from '@/directives/safeBackdropClose'

type CustomerTemperature = 'cold' | 'inactive' | 'warm' | 'hot'

const route = useRoute()
const router = useRouter()
const crmStore = useCrmStore()

const loading = ref(true)
const saving = ref(false)
const customer = ref<Customer | null>(null)
const notes = ref('')
const phone = ref('')
const showBlockModal = ref(false)
const blockReason = ref('')
const blockInProgress = ref(false)
const saveSuccess = ref(false)
const showDiscountBlockModal = ref(false)

// Статус заморозки скидочной системы (кнопка в шапке)
const discountBlockActive = computed(() => Boolean(customer.value?.discount_block?.blocked))
const discountBlockUntilLabel = computed(() => {
  const until = customer.value?.discount_block?.until
  if (!until) return ''
  const normalized = until.includes('T') ? until : until.replace(' ', 'T') + 'Z'
  const parsed = new Date(normalized)
  if (!Number.isFinite(parsed.getTime())) return until
  const minsk = new Date(parsed.getTime() + 3 * 60 * 60 * 1000)
  const day = String(minsk.getUTCDate()).padStart(2, '0')
  const month = String(minsk.getUTCMonth() + 1).padStart(2, '0')
  return `${day}.${month}.${minsk.getUTCFullYear()}`
})

let saveSuccessTimeout: ReturnType<typeof setTimeout> | null = null

const customerId = computed(() => route.params.id as string | undefined)

const temperatureMeta: Record<CustomerTemperature, { label: string; badgeClass: string }> = {
  cold: { label: 'Холодный', badgeClass: 'bg-blue-100 text-blue-700' },
  inactive: { label: 'Пропал', badgeClass: 'bg-amber-100 text-amber-700' },
  warm: { label: 'Тёплый', badgeClass: 'bg-yellow-100 text-yellow-700' },
  hot: { label: 'Горячий', badgeClass: 'bg-rose-100 text-rose-700' }
}

const orderStatusMeta: Record<Order['status'], { label: string; class: string }> = {
  new: { label: 'Новый', class: 'bg-amber-100 text-amber-700' },
  in_progress: { label: 'Собран', class: 'bg-blue-100 text-blue-700' },
  delivered: { label: 'Выдан', class: 'bg-emerald-100 text-emerald-700' },
  completed: { label: 'Завершён', class: 'bg-emerald-100 text-emerald-700' },
  cancelled: { label: 'Отменён', class: 'bg-red-100 text-red-700' }
}

const temperature = computed<CustomerTemperature | null>(() => {
  if (!customer.value) return null
  return getCustomerTemperature(customer.value)
})

const temperatureBadge = computed(() => (temperature.value ? temperatureMeta[temperature.value] : null))
const totalOrders = computed(() => customer.value?.total_orders ?? 0)
const totalSpent = computed(() => customer.value?.total_spent ?? 0)
const lastOrderAt = computed(() => customer.value?.last_order_at ?? null)
const lastVisitAt = computed(() => customer.value?.last_visit_at ?? null)
const orders = computed(() => customer.value?.orders ?? [])
const visitLogs = computed(() => customer.value?.visitLogs ?? [])
const hasActiveBlock = computed(() => (customer.value?.blocks?.length ?? 0) > 0)
const activeBlock = computed(() => customer.value?.blocks?.[0] ?? null)

async function loadCustomer(showSpinner = true) {
  if (!customerId.value) {
    goBack()
    return
  }
  if (showSpinner) {
    loading.value = true
  }
  try {
    const data = await crmStore.fetchCustomer(customerId.value)
    customer.value = data
    notes.value = data.notes || ''
    phone.value = data.phone || ''
  } catch (error) {
    console.error('[CRM] Failed to load customer:', error)
  } finally {
    if (showSpinner) {
      loading.value = false
    }
  }
}

async function saveCustomer() {
  if (!customer.value) return
  saving.value = true
  try {
    await crmStore.updateCustomer(customer.value.id, {
      notes: notes.value || undefined,
      phone: phone.value || undefined
    })
    await loadCustomer(false)
    saveSuccess.value = true
    if (saveSuccessTimeout) {
      clearTimeout(saveSuccessTimeout)
    }
    saveSuccessTimeout = setTimeout(() => {
      saveSuccess.value = false
      saveSuccessTimeout = null
    }, 2500)
  } catch (error) {
    console.error('[CRM] Failed to save customer:', error)
  } finally {
    saving.value = false
  }
}

function getCustomerTemperature(data: Customer): CustomerTemperature {
  if (!data.total_orders || data.total_orders === 0) {
    return 'cold'
  }
  if (!data.last_order_at) {
    return 'cold'
  }
  const lastOrder = new Date(data.last_order_at).getTime()
  const diffDays = Math.floor((Date.now() - lastOrder) / (1000 * 60 * 60 * 24))
  if (diffDays >= 30) return 'inactive'
  if (diffDays <= 7) return 'hot'
  return 'warm'
}

function orderStatusBadge(order: Order) {
  return orderStatusMeta[order.status]
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'BYN',
    minimumFractionDigits: 0
  }).format(value)
}

function formatDateTime(dateString: string) {
  return new Date(dateString).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatRelative(dateString: string | null) {
  if (!dateString) return 'Никогда'
  const target = new Date(dateString).getTime()
  if (Number.isNaN(target)) return '—'
  const diff = Date.now() - target
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  const month = 30 * day
  const year = 365 * day

  if (diff < minute) return 'Только что'
  if (diff < hour) return `${Math.round(diff / minute)} мин назад`
  if (diff < day) return `${Math.round(diff / hour)} ч назад`
  if (diff < month) return `${Math.round(diff / day)} дн назад`
  if (diff < year) return `${Math.round(diff / month)} мес назад`
  return `${Math.round(diff / year)} г назад`
}

function visitLabel(visit: VisitLog) {
  if (visit.action) return visit.action
  if (visit.page_path) {
    if (visit.page_path === '/') return 'Главная'
    if (visit.page_path.startsWith('/category/')) {
      const slug = visit.page_path.split('/').pop()
      return `Категория • ${slug}`
    }
    if (visit.page_path.startsWith('/p/')) return 'Карточка товара'
    return visit.page_path
  }
  return 'Визит'
}

async function confirmBlock() {
  if (!customer.value || blockInProgress.value) return
  blockInProgress.value = true
  try {
    await crmStore.blockCustomer(customer.value.id, blockReason.value)
    showBlockModal.value = false
    blockReason.value = ''
    await loadCustomer(false)
  } catch (error) {
    console.error('[CRM] Failed to block customer:', error)
  } finally {
    blockInProgress.value = false
  }
}

async function unblockCustomer() {
  if (!customer.value) return
  try {
    await crmStore.unblockCustomer(customer.value.id)
    await loadCustomer(false)
  } catch (error) {
    console.error('[CRM] Failed to unblock customer:', error)
  }
}

function goBack() {
  router.push('/admin/crm/customers')
}

onMounted(() => {
  void loadCustomer()
})

watch(customerId, (next, prev) => {
  if (next && next !== prev) {
    void loadCustomer()
  }
})

onUnmounted(() => {
  if (saveSuccessTimeout) {
    clearTimeout(saveSuccessTimeout)
    saveSuccessTimeout = null
  }
})
</script>
