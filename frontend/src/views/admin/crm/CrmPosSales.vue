<template>
  <div class="space-y-6">
    <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">Продажи касса</h1>
        <p class="mt-1 text-sm text-gray-500">Продажи через кассовый интерфейс</p>
      </div>

      <div v-if="profitUnlocked" class="flex items-center gap-4">
        <div class="rounded-lg border border-green-200 bg-green-50 px-4 py-2">
          <p class="text-xs font-medium text-green-600">Выручка</p>
          <p class="text-lg font-bold text-green-700">
            {{ formatCurrency(stats.totalRevenue) }}
          </p>
        </div>
        <div class="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2">
          <p class="text-xs font-medium text-blue-600">Прибыль</p>
          <p class="text-lg font-bold text-blue-700">
            {{ formatCurrency(stats.totalProfit) }}
          </p>
        </div>
        <div
          v-if="stats.pendingCount > 0"
          class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2"
        >
          <p class="text-xs font-medium text-amber-600">Отложено</p>
          <p class="text-lg font-bold text-amber-700">
            {{ stats.pendingCount }}
          </p>
        </div>
      </div>
    </div>

    <template v-if="profitUnlocked">
      <div class="flex flex-wrap items-center gap-3">
        <select
          v-model="filters.status"
          class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200"
        >
          <option value="">Все статусы</option>
          <option value="completed">Завершенные</option>
          <option value="pending">Отложенные</option>
        </select>

        <input
          v-model="filters.from"
          type="date"
          class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200"
          placeholder="От"
        />

        <input
          v-model="filters.to"
          type="date"
          class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200"
          placeholder="До"
        />

        <button
          @click="applyFilters"
          class="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          Применить
        </button>

        <button
          @click="resetFilters"
          class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Сбросить
        </button>
      </div>

      <div class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead class="border-b border-gray-200 bg-gray-50">
              <tr>
                <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">№</th>
                <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Дата</th>
                <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Товар</th>
                <th class="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-gray-600">Оплата</th>
                <th class="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-600">Цена</th>
                <th class="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-600">Скидка</th>
                <th class="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-600">Себестоимость</th>
                <th class="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-600">Прибыль</th>
                <th class="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-gray-600">Статус</th>
                <th class="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-600">Действия</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              <tr v-if="loading" class="animate-pulse">
                <td colspan="10" class="px-4 py-8 text-center text-gray-500">
                  Загрузка...
                </td>
              </tr>
              <tr v-else-if="sales.length === 0">
                <td colspan="10" class="px-4 py-8 text-center text-gray-500">
                  Нет продаж
                </td>
              </tr>
              <tr
                v-for="sale in sales"
                :key="sale.id"
                class="transition-colors hover:bg-gray-50"
              >
                <td class="px-4 py-3 text-sm font-medium text-gray-900">
                  #{{ sale.sale_number }}
                </td>
                <td class="px-4 py-3 text-sm text-gray-600">
                  {{ formatDateTime(sale.created_at) }}
                </td>
                <td class="px-4 py-3 text-sm text-gray-900">
                  <div class="flex items-start gap-1.5">
                    <button
                      v-if="hasItems(sale)"
                      type="button"
                      class="mt-0.5 rounded p-0.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
                      :aria-label="isExpanded(sale) ? 'Свернуть состав' : 'Показать состав'"
                      @click="toggleItems(sale)"
                    >
                      <ChevronRightIcon
                        class="h-4 w-4 transition-transform"
                        :class="{ 'rotate-90': isExpanded(sale) }"
                      />
                    </button>
                    <div class="min-w-0">
                      <p class="truncate">{{ sale.product_name }}</p>
                      <p v-if="itemsCount(sale) > 0" class="text-xs text-gray-500">
                        {{ itemsCount(sale) }}
                        {{ pluralize(itemsCount(sale), 'позиция', 'позиции', 'позиций') }}
                      </p>
                    </div>
                  </div>
                  <div v-if="isExpanded(sale) && sale.items" class="mt-2 space-y-1 rounded-lg bg-gray-50 p-2">
                    <div
                      v-for="item in sale.items"
                      :key="item.id"
                      class="flex items-center justify-between gap-3 text-xs"
                    >
                      <span class="min-w-0 truncate text-gray-700">
                        {{ item.title }}
                        <span class="text-gray-400">×{{ item.quantity }}</span>
                        <span
                          v-if="item.source === 'custom'"
                          class="ml-1 rounded bg-blue-100 px-1 py-0.5 text-[10px] font-semibold text-blue-700"
                        >свой</span>
                      </span>
                      <span class="shrink-0 text-right text-gray-600">
                        <span v-if="item.discount_amount > 0" class="mr-1 text-amber-600">
                          −{{ formatCurrency(item.discount_amount) }}
                        </span>
                        {{ formatCurrency(item.line_total) }}
                      </span>
                    </div>
                  </div>
                </td>
                <td class="px-4 py-3 text-center">
                  <span
                    class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
                    :class="
                      sale.payment_method === 'card'
                        ? 'bg-indigo-100 text-indigo-800'
                        : 'bg-emerald-100 text-emerald-800'
                    "
                  >
                    {{ sale.payment_method === 'card' ? 'Карта' : 'Наличные' }}
                  </span>
                </td>
                <td class="px-4 py-3 text-right text-sm font-medium text-gray-900">
                  {{ formatCurrency(sale.price) }}
                </td>
                <td class="px-4 py-3 text-right text-sm">
                  <span v-if="saleDiscount(sale) > 0" class="text-amber-600">
                    −{{ formatCurrency(saleDiscount(sale)) }}
                  </span>
                  <span v-else class="text-gray-400">-</span>
                </td>
                <td class="px-4 py-3 text-right text-sm">
                  <span v-if="sale.cost_price !== null" class="text-gray-600">
                    {{ formatCurrency(sale.cost_price) }}
                  </span>
                  <span v-else class="text-gray-400">-</span>
                </td>
                <td class="px-4 py-3 text-right text-sm font-medium">
                  <span
                    v-if="sale.profit !== null"
                    :class="sale.profit >= 0 ? 'text-green-600' : 'text-red-600'"
                  >
                    {{ formatCurrency(sale.profit) }}
                  </span>
                  <span v-else class="text-gray-400">-</span>
                </td>
                <td class="px-4 py-3 text-center">
                  <span
                    class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
                    :class="
                      sale.status === 'completed'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-amber-100 text-amber-800'
                    "
                  >
                    {{ sale.status === 'completed' ? 'Завершен' : 'Отложен' }}
                  </span>
                </td>
                <td class="px-4 py-3 text-right">
                  <div class="flex items-center justify-end gap-2">
                    <button
                      v-if="sale.status === 'pending'"
                      title="Дозаполнить"
                      class="rounded p-1.5 text-blue-600 transition-colors hover:bg-blue-50"
                      @click="openEditModal(sale)"
                    >
                      <PencilIcon class="h-4 w-4" />
                    </button>
                    <button
                      title="Удалить"
                      class="rounded p-1.5 text-red-600 transition-colors hover:bg-red-50"
                      @click="confirmDelete(sale)"
                    >
                      <TrashIcon class="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div
          v-if="totalPages > 1"
          class="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-4 py-3"
        >
          <p class="text-sm text-gray-600">
            Показано {{ (currentPage - 1) * pageSize + 1 }}-{{
              Math.min(currentPage * pageSize, total)
            }} из {{ total }}
          </p>
          <div class="flex items-center gap-2">
            <button
              :disabled="currentPage === 1"
              class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
              @click="goToPage(currentPage - 1)"
            >
              Назад
            </button>
            <button
              :disabled="currentPage === totalPages"
              class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
              @click="goToPage(currentPage + 1)"
            >
              Вперед
            </button>
          </div>
        </div>
      </div>
    </template>

    <div
      v-else
      class="relative overflow-hidden rounded-3xl border border-dashed border-blue-200 bg-white/80 p-10 text-center shadow-inner"
    >
      <div class="mx-auto flex max-w-xl flex-col items-center gap-5">
        <span
          class="inline-flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 text-blue-600"
        >
          <LockClosedIcon class="h-8 w-8" />
        </span>
        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
          :disabled="verifyingPassword"
          @click="openPasswordModal"
        >
          <LockClosedIcon class="h-5 w-5" />
          <span>{{
            verifyingPassword ? 'Проверяем…' : 'Ввести лицензионный ключ'
          }}</span>
        </button>
      </div>
    </div>

    <AdminModal
      :isOpen="showPasswordModal"
      title="Подтверждение доступа"
      size="sm"
      :showActions="false"
      @close="closePasswordModal"
      @cancel="closePasswordModal"
    >
      <form class="space-y-4" autocomplete="on" @submit.prevent="submitPassword">
        <CrmProfitPasswordField
          v-model="passwordInput"
          :password-error="passwordError"
          :verifying-password="verifyingPassword"
          input-class="w-full rounded-xl border border-[#eaf0f9] px-4 py-3 text-sm text-[#081b4b] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0958ff]"
        />
        <div class="flex gap-3 pt-2">
          <button
            type="submit"
            class="flex-1 rounded-xl bg-[linear-gradient(100deg,#05b8ff,#185dff)] px-4 py-3 text-[13px] font-bold text-white shadow-[0_8px_16px_#148cff30] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="verifyingPassword"
          >
            {{ verifyingPassword ? 'Проверяем…' : 'Показать' }}
          </button>
          <button
            type="button"
            class="flex-1 rounded-xl bg-[linear-gradient(#f7faff,#e9f0fa)] px-4 py-3 text-[13px] font-bold text-[#233e70] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="verifyingPassword"
            @click="closePasswordModal"
          >
            Отмена
          </button>
        </div>
      </form>
    </AdminModal>

    <Transition name="fade">
      <div
        v-if="showEditModal && editingSale"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        v-safe-backdrop-close="closeEditModal"
      >
        <div class="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
          <h3 class="mb-4 text-lg font-semibold text-gray-900">Редактировать продажу</h3>

          <div class="space-y-4">
            <div>
              <label class="mb-1 block text-sm font-medium text-gray-700">Товар</label>
              <input
                v-model="editForm.product_name"
                type="text"
                class="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200"
              />
            </div>

            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="mb-1 block text-sm font-medium text-gray-700">Цена</label>
                <input
                  v-model="editForm.price"
                  type="number"
                  step="0.01"
                  min="0"
                  class="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200"
                />
              </div>
              <div>
                <label class="mb-1 block text-sm font-medium text-gray-700">Себестоимость</label>
                <input
                  v-model="editForm.cost_price"
                  type="number"
                  step="0.01"
                  min="0"
                  class="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200"
                  placeholder="Введите себестоимость"
                />
              </div>
            </div>
          </div>

          <div class="mt-6 flex gap-3">
            <button
              :disabled="isSaving"
              class="flex-1 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
              @click="saveEdit"
            >
              {{ isSaving ? 'Сохраняем...' : 'Сохранить' }}
            </button>
            <button
              class="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              @click="closeEditModal"
            >
              Отмена
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <Transition name="fade">
      <div
        v-if="showDeleteModal && deletingSale"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        v-safe-backdrop-close="closeDeleteModal"
      >
        <div class="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
          <h3 class="mb-2 text-lg font-semibold text-gray-900">Удалить продажу?</h3>
          <p class="mb-4 text-sm text-gray-600">
            Вы уверены, что хотите удалить продажу "{{ deletingSale.product_name }}"?
          </p>

          <div class="flex gap-3">
            <button
              :disabled="isDeleting"
              class="flex-1 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              @click="deleteSale"
            >
              {{ isDeleting ? 'Удаляем...' : 'Удалить' }}
            </button>
            <button
              class="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              @click="closeDeleteModal"
            >
              Отмена
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { ChevronRightIcon, LockClosedIcon, PencilIcon, TrashIcon } from '@heroicons/vue/24/outline'
import AdminModal from '@/components/AdminModal.vue'
import { useCrmStore, type PosSale } from '@/stores/crm'
import CrmProfitPasswordField from '@/components/crm/CrmProfitPasswordField.vue'
import { vSafeBackdropClose } from '@/directives/safeBackdropClose'

const crmStore = useCrmStore()
const { profitUnlocked, verifyingProfitAccess } = storeToRefs(crmStore)

const loading = ref(false)
const sales = ref<PosSale[]>([])
const total = ref(0)
const currentPage = ref(1)
const pageSize = 50

const filters = reactive({
  status: '' as '' | 'completed' | 'pending',
  from: '',
  to: ''
})

const stats = reactive({
  totalRevenue: 0,
  totalProfit: 0,
  pendingCount: 0
})

const showPasswordModal = ref(false)
const passwordInput = ref('')
const passwordError = ref('')
const verifyingPassword = computed(() => verifyingProfitAccess.value)

const showEditModal = ref(false)
const editingSale = ref<PosSale | null>(null)
const editForm = reactive({
  product_name: '',
  price: '',
  cost_price: ''
})
const isSaving = ref(false)

const showDeleteModal = ref(false)
const deletingSale = ref<PosSale | null>(null)
const isDeleting = ref(false)

const totalPages = computed(() => Math.ceil(total.value / pageSize))

// Состав чека подгружается лениво: список продаж не должен тянуть все позиции.
const itemsBySale = reactive<Record<string, PosSale['items']>>({})
const expandedSaleIds = ref<string[]>([])
const loadingItems = ref<string[]>([])

function hasItems(sale: PosSale): boolean {
  // У чеков старого формата позиций нет вовсе — раскрывать нечего.
  const count = itemsCount(sale)
  if (count > 0) return true
  // Новый чек со списанным остатком: позиции есть, но могли ещё не
  // подгрузиться — кнопку раскрытия показываем, счётчик до загрузки не пишем.
  return sale.stock_deducted === 1
}

/** Сколько позиций чека уже известно (загружено или пришло в списке). */
function itemsCount(sale: PosSale): number {
  if (Array.isArray(sale.items)) return sale.items.length
  const cached = itemsBySale[sale.id]
  return Array.isArray(cached) ? cached.length : 0
}

function isExpanded(sale: PosSale): boolean {
  return expandedSaleIds.value.includes(sale.id)
}

async function toggleItems(sale: PosSale) {
  if (isExpanded(sale)) {
    expandedSaleIds.value = expandedSaleIds.value.filter((id) => id !== sale.id)
    return
  }

  if (!Array.isArray(sale.items) && !itemsBySale[sale.id] && !loadingItems.value.includes(sale.id)) {
    loadingItems.value = [...loadingItems.value, sale.id]
    try {
      const items = await crmStore.fetchPosSaleItems(sale.id)
      itemsBySale[sale.id] = items
      sale.items = items
    } catch (error) {
      console.error('[CrmPosSales] Failed to load check items', error)
    } finally {
      loadingItems.value = loadingItems.value.filter((id) => id !== sale.id)
    }
  }

  expandedSaleIds.value = [...expandedSaleIds.value, sale.id]
}

function saleDiscount(sale: PosSale): number {
  if (typeof sale.subtotal === 'number' && sale.subtotal > sale.price) {
    return Math.max(0, Math.round((sale.subtotal - sale.price) * 100) / 100)
  }
  const items = sale.items ?? itemsBySale[sale.id] ?? []
  const lineDiscount = items.reduce((sum, item) => sum + (Number(item.discount_amount) || 0), 0)
  return Math.round(lineDiscount * 100) / 100
}

function pluralize(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}

function formatCurrency(value: number | null): string {
  if (value === null) return '-'
  return value.toLocaleString('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }) + ' BYN'
}

function formatDateTime(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

async function loadSales() {
  if (!profitUnlocked.value) return

  loading.value = true
  try {
    const params: Record<string, string | number> = {
      limit: pageSize,
      offset: (currentPage.value - 1) * pageSize
    }

    if (filters.status) params.status = filters.status
    if (filters.from) params.from = filters.from
    if (filters.to) params.to = `${filters.to}T23:59:59`

    const response = await crmStore.fetchPosSales(params)
    sales.value = response.sales
    total.value = response.total
    calculateStats()
  } finally {
    loading.value = false
  }
}

function resetSalesState() {
  loading.value = false
  sales.value = []
  total.value = 0
  currentPage.value = 1
  stats.totalRevenue = 0
  stats.totalProfit = 0
  stats.pendingCount = 0
}

function calculateStats() {
  stats.totalRevenue = sales.value
    .filter((sale) => sale.status === 'completed')
    .reduce((sum, sale) => sum + sale.price, 0)

  stats.totalProfit = sales.value
    .filter((sale) => sale.status === 'completed' && sale.profit !== null)
    .reduce((sum, sale) => sum + (sale.profit || 0), 0)

  stats.pendingCount = sales.value.filter((sale) => sale.status === 'pending').length
}

function applyFilters() {
  currentPage.value = 1
  void loadSales()
}

function resetFilters() {
  filters.status = ''
  filters.from = ''
  filters.to = ''
  currentPage.value = 1
  void loadSales()
}

function goToPage(page: number) {
  if (page < 1 || page > totalPages.value) return
  currentPage.value = page
  void loadSales()
}

function openPasswordModal() {
  passwordInput.value = ''
  passwordError.value = ''
  showPasswordModal.value = true
}

function closePasswordModal() {
  showPasswordModal.value = false
  passwordInput.value = ''
  passwordError.value = ''
}

async function submitPassword() {
  if (!passwordInput.value.trim()) {
    passwordError.value = 'Введите ключ'
    return
  }

  passwordError.value = ''
  try {
    await crmStore.verifyProfitPassword(passwordInput.value.trim())
    closePasswordModal()
  } catch (error) {
    passwordError.value = 'Неверный ключ'
  }
}

function openEditModal(sale: PosSale) {
  editingSale.value = sale
  editForm.product_name = sale.product_name
  editForm.price = String(sale.price)
  editForm.cost_price = sale.cost_price !== null ? String(sale.cost_price) : ''
  showEditModal.value = true
}

function closeEditModal() {
  showEditModal.value = false
  editingSale.value = null
}

async function saveEdit() {
  if (!editingSale.value || isSaving.value) return

  isSaving.value = true
  try {
    await crmStore.updatePosSale(editingSale.value.id, {
      product_name: editForm.product_name,
      price: Number(editForm.price),
      cost_price: editForm.cost_price ? Number(editForm.cost_price) : undefined
    })

    closeEditModal()
    await loadSales()
  } catch (error) {
    console.error('Failed to update sale:', error)
  } finally {
    isSaving.value = false
  }
}

function confirmDelete(sale: PosSale) {
  deletingSale.value = sale
  showDeleteModal.value = true
}

function closeDeleteModal() {
  showDeleteModal.value = false
  deletingSale.value = null
}

async function deleteSale() {
  if (!deletingSale.value || isDeleting.value) return

  isDeleting.value = true
  try {
    await crmStore.deletePosSale(deletingSale.value.id)
    closeDeleteModal()
    await loadSales()
  } catch (error) {
    console.error('Failed to delete sale:', error)
  } finally {
    isDeleting.value = false
  }
}

onMounted(() => {
  // Ключ спрашивается при каждом входе в раздел: допуск живёт один визит.
  crmStore.resetProfitAccess()
  if (profitUnlocked.value) {
    void loadSales()
  }
})

watch(profitUnlocked, (unlocked) => {
  if (unlocked) {
    void loadSales()
    return
  }

  closePasswordModal()
  closeEditModal()
  closeDeleteModal()
  resetSalesState()
})
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
