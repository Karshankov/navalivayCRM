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
                <th class="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-600">Цена</th>
                <th class="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-600">Себестоимость</th>
                <th class="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-600">Прибыль</th>
                <th class="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-gray-600">Статус</th>
                <th class="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-600">Действия</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              <tr v-if="loading" class="animate-pulse">
                <td colspan="8" class="px-4 py-8 text-center text-gray-500">
                  Загрузка...
                </td>
              </tr>
              <tr v-else-if="sales.length === 0">
                <td colspan="8" class="px-4 py-8 text-center text-gray-500">
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
                  {{ sale.product_name }}
                </td>
                <td class="px-4 py-3 text-right text-sm font-medium text-gray-900">
                  {{ formatCurrency(sale.price) }}
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
        <div class="space-y-2">
          <p class="text-sm text-gray-600">Оплатите подписку на сервис</p>
        </div>
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
      description="Введите лицензионный ключ"
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
          input-class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
        />
        <div class="flex gap-3 pt-2">
          <button
            type="submit"
            class="flex-1 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
            :disabled="verifyingPassword"
          >
            {{ verifyingPassword ? 'Проверяем…' : 'Показать' }}
          </button>
          <button
            type="button"
            class="flex-1 rounded-md bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-300"
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
import { LockClosedIcon, PencilIcon, TrashIcon } from '@heroicons/vue/24/outline'
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
