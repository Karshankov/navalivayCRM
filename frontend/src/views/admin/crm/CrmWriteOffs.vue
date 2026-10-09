<template>
  <div class="min-h-screen bg-gray-50 px-4 py-6 sm:px-6 lg:px-8">
    <div class="mx-auto w-full max-w-7xl space-y-8">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="max-w-2xl space-y-2">
          <h1 class="text-2xl font-bold text-gray-900 sm:text-3xl">Списания</h1>
          <p class="text-sm text-gray-600 sm:text-base">Фиксируйте потери и держите склад в актуальном состоянии</p>
        </div>
        <div class="flex w-full flex-wrap gap-3 sm:w-auto sm:justify-end">
          <button
            @click="refreshWriteOffs"
            class="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 sm:w-auto"
          >
            Обновить
          </button>
          <button
            @click="openCreateModal"
            class="w-full rounded-lg bg-red-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-red-700 sm:w-auto"
          >
            Создать списание
          </button>
        </div>
      </div>

      <!-- Success banner -->
      <Transition
        enter-active-class="transition ease-out duration-200"
        enter-from-class="opacity-0 -translate-y-2"
        enter-to-class="opacity-100 translate-y-0"
        leave-active-class="transition ease-in duration-150"
        leave-from-class="opacity-100 translate-y-0"
        leave-to-class="opacity-0 -translate-y-2"
      >
        <div
          v-if="writeOffSuccess"
          class="rounded-lg border border-green-200 bg-green-50 p-4 shadow-sm"
        >
          <div class="flex items-start gap-3">
            <svg class="h-5 w-5 flex-shrink-0 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div class="flex-1">
              <p class="text-sm font-medium text-green-800">{{ writeOffSuccess }}</p>
            </div>
            <button
              @click="writeOffSuccess = ''"
              class="inline-flex h-6 w-6 items-center justify-center rounded-full text-green-500 transition hover:bg-green-100"
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </Transition>

      <div class="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div class="rounded-xl bg-white p-5 shadow-sm">
          <div class="text-sm text-gray-500">Всего списаний</div>
          <div class="mt-2 text-3xl font-bold text-gray-900">{{ writeOffs.length }}</div>
          <p class="mt-3 text-xs text-gray-500">Накопленная история потерь</p>
        </div>
        <div class="rounded-xl bg-white p-5 shadow-sm">
          <div class="text-sm text-gray-500">Последнее списание</div>
          <div class="mt-2 text-lg font-semibold text-gray-900">{{ lastWriteOffDate }}</div>
          <p class="mt-3 text-xs text-gray-500">Дата и время последней операции</p>
        </div>
        <div class="rounded-xl bg-white p-5 shadow-sm">
          <div class="text-sm text-gray-500">Стоимость текущего списания</div>
          <div class="mt-2 text-3xl font-bold text-gray-900">
            {{ draftItems.length ? formatCurrency(draftTotalCost) : '—' }}
          </div>
          <p class="mt-3 text-xs text-gray-500">Расчет по себестоимости товаров в черновике</p>
        </div>
      </div>

      <div v-if="loadingWriteOffs" class="rounded-xl bg-white py-16 text-center shadow-sm">
        <div class="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-blue-600 border-r-transparent"></div>
        <p class="mt-4 text-gray-600">Загрузка истории списаний…</p>
      </div>

      <div v-else-if="writeOffs.length" class="rounded-xl bg-white shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full min-w-[680px] text-left">
          <thead class="border-b bg-gray-50 text-xs font-medium uppercase text-gray-500">
            <tr>
              <th class="px-6 py-3">№</th>
              <th class="px-6 py-3">Причина</th>
              <th class="px-6 py-3">Сотрудник</th>
              <th class="px-6 py-3">Дата</th>
              <th class="px-6 py-3 text-right">Действия</th>
            </tr>
          </thead>
          <tbody class="divide-y">
            <tr v-for="writeOff in writeOffs" :key="writeOff.id" class="transition hover:bg-gray-50">
              <td class="px-6 py-4 text-sm font-semibold text-gray-900">#{{ writeOff.writeoff_number }}</td>
              <td class="px-6 py-4 text-sm text-gray-700">
                <div class="font-medium text-gray-900">{{ reasonLabel(writeOff.reason) }}</div>
                <div v-if="writeOff.notes" class="text-xs text-gray-500">{{ writeOff.notes }}</div>
              </td>
              <td class="px-6 py-4 text-sm text-gray-600">{{ writeOff.employee_name || '—' }}</td>
              <td class="px-6 py-4 text-sm text-gray-500">{{ formatDate(writeOff.created_at) }}</td>
              <td class="px-6 py-4 text-right text-sm">
                <button
                  class="admin-link-button admin-link-button--info"
                  @click="openDetails(writeOff.id)"
                >
                  Подробнее
                </button>
              </td>
            </tr>
          </tbody>
          </table>
        </div>
      </div>

      <div v-else class="rounded-xl bg-white py-16 text-center shadow-sm">
        <h3 class="text-lg font-semibold text-gray-900">Списаний пока нет</h3>
        <p class="mt-2 text-gray-600">Фиксируйте причины потерь, чтобы видеть реальную прибыль и управлять запасами.</p>
        <button
          class="mt-6 inline-flex items-center rounded-lg bg-red-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-red-700"
          @click="openCreateModal"
        >
          Создать списание
        </button>
      </div>
    </div>

    <AdminModal
      :isOpen="showCreateModal"
      :title="createModalTitle"
      size="2xl"
      :showActions="false"
      @close="closeCreateModal"
      @cancel="closeCreateModal"
    >
      <div class="w-full max-w-4xl rounded-2xl bg-white p-6 shadow-xl">
        <div class="mt-2 grid gap-6 md:grid-cols-[1.5fr,1fr]">
          <div class="space-y-6">
            <div class="grid gap-4 rounded-xl border border-gray-200 p-5">
              <label class="text-sm font-medium text-gray-700" for="reason">Причина списания</label>
              <select
                id="reason"
                v-model="selectedReason"
                class="rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100"
              >
                <option v-for="reason in reasons" :key="reason.value" :value="reason.value">{{ reason.label }}</option>
              </select>
              <label class="text-sm font-medium text-gray-700" for="writeoff-notes">Комментарий</label>
              <textarea
                id="writeoff-notes"
                v-model="writeOffNotes"
                rows="2"
                class="rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100"
                placeholder="Например, партия просрочена или повредилась при транспортировке"
              ></textarea>
            </div>

            <div class="rounded-xl border border-gray-200 p-5">
              <h4 class="text-lg font-semibold text-gray-900">Товары для списания</h4>
              <p class="mt-2 text-sm text-gray-500">Найдите товар по названию или добавьте из предложенных ниже.</p>
              <div class="mt-4">
                <input
                  v-model="productSearch"
                  type="search"
                  class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100"
                  placeholder="Введите минимум 2 символа"
                />
                <p v-if="showSearchHint" class="mt-2 text-xs text-gray-500">Для поиска введите от двух символов</p>
              </div>
              <div class="mt-4 max-h-52 overflow-y-auto rounded-lg border border-dashed border-gray-200">
                <div v-if="isSearchingProducts" class="flex items-center justify-center gap-2 py-6 text-sm text-gray-500">
                  <div class="h-5 w-5 animate-spin rounded-full border-2 border-red-500 border-r-transparent"></div>
                  Ищем товары…
                </div>
                <div v-else-if="searchError" class="px-4 py-6 text-sm text-red-600">{{ searchError }}</div>
                <div v-else-if="productResults.length === 0 && productSearch.trim().length >= 2" class="px-4 py-6 text-sm text-gray-500">
                  Нет совпадений. Попробуйте другую формулировку.
                </div>
                <ul v-else class="divide-y text-sm">
                  <li
                    v-for="product in productResults"
                    :key="product.id"
                    class="flex items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50"
                  >
                    <div>
                      <div class="font-medium text-gray-900">{{ product.title }}</div>
                      <div v-if="product.groupName" class="text-xs font-semibold text-blue-600">
                        {{ product.groupName }}
                      </div>
                      <div class="text-xs text-gray-500">На складе: {{ product.stock }} шт • Себестоимость: {{ formatCurrency(product.costPrice) }}</div>
                    </div>
                    <button
                      class="rounded-full border border-red-200 px-3 py-1 text-xs font-semibold text-red-600 transition hover:bg-red-50"
                      @click="addProduct(product)"
                      type="button"
                    >
                      Добавить
                    </button>
                  </li>
                </ul>
              </div>
            </div>

            <div class="rounded-xl border border-gray-200">
              <div
                v-if="isEditingDraft"
                class="border-b border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900"
              >
                В редактировании показываем лимит для сохранения: текущий остаток на складе плюс количество,
                которое уже было добавлено в это списание.
              </div>
              <div class="overflow-x-auto">
                <table class="w-full min-w-[600px] text-sm">
                <thead class="bg-gray-50 text-xs font-medium uppercase text-gray-500">
                  <tr>
                    <th class="px-4 py-3 text-left">Товар</th>
                    <th class="px-4 py-3 text-left">{{ draftStockColumnLabel }}</th>
                    <th class="px-4 py-3 text-left">Списать</th>
                    <th class="px-4 py-3 text-left">Себестоимость</th>
                    <th class="px-4 py-3 text-right">Потери</th>
                    <th class="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody v-if="draftItems.length" class="divide-y">
                  <tr
                    v-for="item in draftItems"
                    :key="item.product.id"
                    :class="{ 'bg-red-50': item.quantity > item.product.stock }"
                  >
                    <td class="px-4 py-3">
                      <div class="font-medium text-gray-900">{{ item.product.title }}</div>
                      <div v-if="item.product.groupName" class="text-xs font-semibold text-blue-600">
                        {{ item.product.groupName }}
                      </div>
                      <div class="text-xs текст-gray-500">Мин. остаток: {{ item.product.minStock }} шт</div>
                    </td>
                    <td class="px-4 py-3 text-sm text-gray-600">
                      <div>{{ item.product.stock }} шт</div>
                      <div
                        v-if="isEditingDraft && item.currentStock !== undefined"
                        class="mt-1 text-xs text-amber-700"
                      >
                        Сейчас на складе: {{ item.currentStock }} шт
                      </div>
                      <div
                        v-if="isEditingDraft && item.originalQuantity"
                        class="text-xs text-gray-500"
                      >
                        В этом списании уже было: {{ item.originalQuantity }} шт
                      </div>
                    </td>
                    <td class="px-4 py-3">
                      <input
                        v-model.number="item.quantity"
                        type="number"
                        min="1"
                        :max="item.product.stock"
                        class="w-24 rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-red-500 focus:outline-none"
                        @change="clampQuantity(item)"
                      />
                      <p v-if="item.quantity > item.product.stock" class="mt-1 text-xs text-red-600">
                        {{ getDraftQuantityError(item) }}
                      </p>
                    </td>
                    <td class="px-4 py-3 text-sm text-gray-600">{{ formatCurrency(item.product.costPrice) }}</td>
                    <td class="px-4 py-3 text-right text-sm font-semibold text-gray-900">
                      {{ formatCurrency(item.product.costPrice * item.quantity) }}
                    </td>
                    <td class="px-4 py-3 text-right">
                    <button class="admin-link-button admin-link-button--danger" @click="removeItem(item.product.id)">
                        Удалить
                      </button>
                    </td>
                  </tr>
                </tbody>
                <tbody v-else>
                  <tr>
                    <td colspan="6" class="px-4 py-6 text-center text-sm text-gray-500">Добавьте товары, чтобы оформить списание</td>
                  </tr>
                </tbody>
                </table>
              </div>
            </div>
          </div>

          <aside class="space-y-6">
            <div class="rounded-xl border border-red-100 bg-red-50 p-5">
              <h4 class="text-sm font-semibold text-red-900">Итого потери</h4>
              <div class="mt-4 space-y-2 text-sm text-red-900">
                <div class="flex justify-between">
                  <span>Позиции</span>
                  <span>{{ draftItems.length }}</span>
                </div>
                <div class="flex justify-between">
                  <span>Количество</span>
                  <span>{{ draftTotalQuantity }} шт</span>
                </div>
                <div class="flex justify-between text-base font-semibold">
                  <span>Стоимость</span>
                  <span>{{ formatCurrency(draftTotalCost) }}</span>
                </div>
              </div>
            </div>

            <button
              class="w-full rounded-lg bg-red-600 py-3 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-red-300"
              :disabled="!canSubmitWriteOff || creatingWriteOff"
              @click="submitWriteOff"
            >
              {{ creatingWriteOff ? 'Сохраняем…' : submitButtonLabel }}
            </button>
          </aside>
        </div>
      </div>
    </AdminModal>

    <AdminModal
      :isOpen="detailModalOpen"
      :title="activeWriteOff ? `Списание #${activeWriteOff.writeoff_number}` : 'Списание'"
      :description="activeWriteOff ? reasonLabel(activeWriteOff.reason) : ''"
      size="xl"
      :showActions="false"
      @close="closeDetails"
      @cancel="closeDetails"
    >
      <div class="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-xl">
        <div v-if="detailLoading" class="py-12 text-center text-gray-500">Загружаем детали…</div>
        <div v-else-if="activeWriteOff" class="space-y-6">
          <div class="flex justify-end gap-3">
            <button
              class="admin-link-button admin-link-button--edit"
              @click="startEditFromDetails"
            >
              Редактировать
            </button>
            <button
              class="admin-link-button admin-link-button--danger"
              @click="deleteCurrentWriteOff"
            >
              Удалить
            </button>
          </div>
          <div class="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div class="text-xs uppercase text-gray-500">Причина списания</div>
            <div class="mt-2 text-sm font-semibold text-gray-900">{{ reasonLabel(activeWriteOff.reason) }}</div>
            <div v-if="activeWriteOff.notes" class="mt-3 text-sm text-gray-600">{{ activeWriteOff.notes }}</div>
          </div>

          <div class="grid gap-4 md:grid-cols-3">
            <div class="rounded-lg border border-gray-200 p-4">
              <div class="text-xs uppercase text-gray-500">Дата</div>
              <div class="mt-2 text-sm font-semibold text-gray-900">{{ formatDate(activeWriteOff.created_at) }}</div>
            </div>
            <div class="rounded-lg border border-gray-200 p-4">
              <div class="text-xs uppercase text-gray-500">Сотрудник</div>
              <div class="mt-2 text-sm font-semibold text-gray-900">{{ activeWriteOff.employee_name || '—' }}</div>
            </div>
            <div class="rounded-lg border border-gray-200 p-4">
              <div class="text-xs uppercase text-gray-500">Позиций</div>
              <div class="mt-2 text-sm font-semibold text-gray-900">{{ (activeWriteOff.items || []).length }}</div>
            </div>
          </div>

          <div class="rounded-lg border border-gray-200">
            <div class="overflow-x-auto">
              <table class="w-full min-w-[520px] text-sm">
              <thead class="bg-gray-50 text-xs font-medium uppercase text-gray-500">
                <tr>
                  <th class="px-4 py-3 text-left">Товар</th>
                  <th class="px-4 py-3 text-left">Списано</th>
                  <th class="px-4 py-3 text-left">Себестоимость</th>
                  <th class="px-4 py-3 text-right">Потери</th>
                </tr>
              </thead>
              <tbody class="divide-y">
                <tr v-for="item in activeWriteOff.items || []" :key="item.id">
                  <td class="px-4 py-3">
                    <div class="font-medium text-gray-900">{{ item.product_title }}</div>
                    <div v-if="item.group_name" class="text-xs font-semibold text-blue-600">
                      {{ item.group_name }}
                    </div>
                  </td>
                  <td class="px-4 py-3 text-sm text-gray-600">{{ item.quantity }} шт</td>
                  <td class="px-4 py-3 text-sm text-gray-600">{{ formatCurrency(item.cost_per_unit) }}</td>
                  <td class="px-4 py-3 text-right text-sm font-semibold text-gray-900">{{ formatCurrency(item.total_cost) }}</td>
                </tr>
              </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </AdminModal>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useCrmStore, type CrmProductSummary, type WriteOff } from '@/stores/crm'
import AdminModal from '@/components/AdminModal.vue'

interface DraftWriteOffItem {
  product: CrmProductSummary
  quantity: number
  currentStock?: number
  originalQuantity?: number
}

const crmStore = useCrmStore()
const { writeOffs, loadingWriteOffs } = storeToRefs(crmStore)

const showCreateModal = ref(false)
const editingWriteOffId = ref<string | null>(null)
const selectedReason = ref<'damaged' | 'expired' | 'sample' | 'loss' | 'other'>('damaged')
const writeOffNotes = ref('')
const draftItems = ref<DraftWriteOffItem[]>([])
const productSearch = ref('')
const productResults = ref<CrmProductSummary[]>([])
const isSearchingProducts = ref(false)
const searchError = ref('')
const productSearchRequestId = ref(0)
const creatingWriteOff = ref(false)
const writeOffSuccess = ref('')
let writeOffSuccessTimer: ReturnType<typeof setTimeout> | null = null

const detailModalOpen = ref(false)
const detailLoading = ref(false)
const activeWriteOff = ref<WriteOff | null>(null)

const reasons = [
  { value: 'damaged', label: 'Порча / повреждение' },
  { value: 'expired', label: 'Просрочка' },
  { value: 'sample', label: 'Образцы / дегустация' },
  { value: 'loss', label: 'Недостача / кража' },
  { value: 'other', label: 'Другая причина' }
] as const

const draftTotalQuantity = computed(() => draftItems.value.reduce((sum, item) => sum + item.quantity, 0))
const draftTotalCost = computed(() => draftItems.value.reduce((sum, item) => sum + item.quantity * item.product.costPrice, 0))
const hasInvalidQuantities = computed(() => draftItems.value.some((item) => item.quantity <= 0 || item.quantity > item.product.stock))
const canSubmitWriteOff = computed(() => draftItems.value.length > 0 && !hasInvalidQuantities.value)
const isEditingDraft = computed(() => Boolean(editingWriteOffId.value))
const createModalTitle = computed(() => isEditingDraft.value ? 'Редактирование списания' : 'Новое списание')
const draftStockColumnLabel = computed(() => isEditingDraft.value ? 'Доступно' : 'На складе')
const submitButtonLabel = computed(() => isEditingDraft.value ? 'Сохранить изменения' : 'Сохранить списание')

const lastWriteOffDate = computed(() => {
  if (!writeOffs.value.length) return '—'
  return formatDate(writeOffs.value[0].created_at)
})

const showSearchHint = computed(() => {
  const length = productSearch.value.trim().length
  return length > 0 && length < 2
})

let searchDebounce: ReturnType<typeof setTimeout> | null = null

function invalidateProductSearch() {
  productSearchRequestId.value += 1
  isSearchingProducts.value = false
}

function clearProductSearchState() {
  if (searchDebounce) {
    clearTimeout(searchDebounce)
    searchDebounce = null
  }
  invalidateProductSearch()
  searchError.value = ''
  productResults.value = []
}

onMounted(async () => {
  await crmStore.fetchWriteOffs()
})

watch(productSearch, (query) => {
  if (!showCreateModal.value) return
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      clearProductSearchState()
      return
    }
    if (trimmed.length < 2) {
      clearProductSearchState()
      return
    }
    void loadProducts(trimmed)
  }, 250)
})

async function loadProducts(search: string) {
  const requestId = ++productSearchRequestId.value
  isSearchingProducts.value = true
  searchError.value = ''
  try {
    const results = await crmStore.searchCrmProducts({ search, limit: 20 })
    if (requestId !== productSearchRequestId.value) return
    productResults.value = results
  } catch (error) {
    if (requestId !== productSearchRequestId.value) return
    console.error('[CRM] write-off search error', error)
    searchError.value = 'Не удалось загрузить товары. Попробуйте еще раз.'
    productResults.value = []
  } finally {
    if (requestId === productSearchRequestId.value) {
      isSearchingProducts.value = false
    }
  }
}

function normalizeProduct(row: CrmProductSummary | any): CrmProductSummary {
  if ('costPrice' in row && 'stock' in row) {
    return row as CrmProductSummary
  }
  return {
    id: String(row.id),
    title: row.title ?? row.product_title ?? 'Без названия',
    priceRub: Number(row.priceRub ?? row.price_rub ?? 0),
    costPrice: Number(row.costPrice ?? row.cost_price ?? 0),
    stock: Number(row.stock ?? 0),
    minStock: Number(row.minStock ?? row.min_stock ?? 0),
    categoryId: String(row.categoryId ?? row.category_id ?? ''),
    categoryName: row.categoryName ?? row.category_name ?? null,
    groupId: row.groupId ? String(row.groupId) : row.group_id ? String(row.group_id) : null,
    groupName: row.groupName ?? row.group_name ?? null
  }
}

async function openCreateModal() {
  editingWriteOffId.value = null
  selectedReason.value = 'damaged'
  writeOffNotes.value = ''
  draftItems.value = []
  productSearch.value = ''
  clearProductSearchState()
  showCreateModal.value = true
}

function closeCreateModal() {
  showCreateModal.value = false
  editingWriteOffId.value = null
  clearProductSearchState()
}

function addProduct(product: CrmProductSummary) {
  const normalized = normalizeProduct(product)
  if (normalized.stock <= 0) {
    alert('Нельзя списать товар с нулевым остатком')
    return
  }
  const existing = draftItems.value.find((item) => item.product.id === normalized.id)
  if (existing) {
    existing.quantity = Math.min(existing.quantity + 1, normalized.stock)
    return
  }
  draftItems.value.push({
    product: normalized,
    quantity: normalized.stock > 0 ? 1 : 0,
    currentStock: normalized.stock,
    originalQuantity: 0
  })
}

function removeItem(productId: string) {
  draftItems.value = draftItems.value.filter((item) => item.product.id !== productId)
}

function clampQuantity(item: DraftWriteOffItem) {
  if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
    item.quantity = Math.min(1, item.product.stock)
  }
  if (item.quantity > item.product.stock) {
    item.quantity = item.product.stock
  }
}

function getDraftQuantityError(item: DraftWriteOffItem) {
  if (!isEditingDraft.value) {
    return `На складе только ${item.product.stock} шт`
  }

  return `Доступно к сохранению только ${item.product.stock} шт`
}

function buildWriteOffItemPayload(product: CrmProductSummary) {
  if (product.isVariant && product.productId) {
    return {
      product_id: product.productId,
      variant_id: product.id
    }
  }

  return {
    product_id: product.id
  }
}

function formatWriteOffErrorMessage(errorMessage: string) {
  if (!errorMessage) {
    return 'Не удалось сохранить списание. Проверьте данные и повторите попытку.'
  }

  const errorLower = errorMessage.toLowerCase()

  if (errorLower.includes('insufficient stock') || errorLower.includes('недостаточно товара')) {
    const productMatch = errorMessage.match(/for\s+(.+)$/i) || errorMessage.match(/для\s+(.+)$/i)
    const productName = productMatch ? productMatch[1].trim() : 'товара'
    return `Недостаточно остатка на складе для "${productName}". Обновите остатки и уменьшите количество в списании.`
  }

  if (errorLower.includes('product not found') || errorLower.includes('not found') || errorLower.includes('не найден')) {
    return 'Товар не найден. Возможно, он был изменен или удален. Обновите страницу и повторите попытку.'
  }

  if (errorLower.includes('invalid_quantity') || errorLower.includes('invalid quantity') || errorLower.includes('неверн')) {
    return 'Укажите корректное количество для списания.'
  }

  return errorMessage
}

async function submitWriteOff() {
  if (!canSubmitWriteOff.value || creatingWriteOff.value) return
  creatingWriteOff.value = true
  try {
    const payload = {
      reason: selectedReason.value,
      notes: writeOffNotes.value.trim() || undefined,
      items: draftItems.value.map((item) => ({
        ...buildWriteOffItemPayload(item.product),
        quantity: item.quantity
      }))
    }

    if (editingWriteOffId.value) {
      const targetId = editingWriteOffId.value
      const updated = await crmStore.updateWriteOff(targetId, payload)
      writeOffSuccess.value = `Списание #${updated.writeoff_number} успешно обновлено. Остатки пересчитаны.`
      if (writeOffSuccessTimer) clearTimeout(writeOffSuccessTimer)
      writeOffSuccessTimer = setTimeout(() => {
        writeOffSuccess.value = ''
      }, 5000)
      closeCreateModal()
      await crmStore.fetchWriteOffs()
      await openDetails(targetId)
    } else {
      const writeOff = await crmStore.createWriteOff(payload)
      writeOffSuccess.value = `Списание #${writeOff.writeoff_number} успешно создано. Остатки пересчитаны.`
      if (writeOffSuccessTimer) clearTimeout(writeOffSuccessTimer)
      writeOffSuccessTimer = setTimeout(() => {
        writeOffSuccess.value = ''
      }, 5000)
      closeCreateModal()
      await crmStore.fetchWriteOffs()
      await openDetails(writeOff.id)
    }
  } catch (error) {
    console.error('[CRM] create write-off error', error)
    alert(formatWriteOffErrorMessage((error as Error)?.message || 'Не удалось сохранить списание.'))
  } finally {
    creatingWriteOff.value = false
  }
}

async function refreshWriteOffs() {
  await crmStore.fetchWriteOffs()
}

async function openDetails(id: string) {
  detailModalOpen.value = true
  detailLoading.value = true
  try {
    activeWriteOff.value = await crmStore.fetchWriteOff(id)
  } catch (error) {
    console.error('[CRM] load write-off details error', error)
    alert('Не удалось загрузить списание')
    detailModalOpen.value = false
  } finally {
    detailLoading.value = false
  }
}

function closeDetails() {
  detailModalOpen.value = false
  activeWriteOff.value = null
}

function startEditFromDetails() {
  if (!activeWriteOff.value) return
  const writeOff = activeWriteOff.value
  editingWriteOffId.value = writeOff.id

  const allowed = reasons.find((item) => item.value === writeOff.reason)
  selectedReason.value = (allowed?.value || 'other') as typeof selectedReason.value
  writeOffNotes.value = writeOff.notes || ''

  draftItems.value = (writeOff.items || []).map((item) => {
    const currentStock = Number(item.stock ?? 0)
    const originalQuantity = Number(item.quantity ?? 0)
    const availableStock = currentStock + originalQuantity
    const variantId = item.variant_id || null
    return {
      product: {
        id: variantId || item.product_id,
        productId: variantId ? item.product_id : undefined,
        title: item.product_title || 'Без названия',
        priceRub: 0,
        costPrice: Number(item.cost_per_unit ?? 0),
        stock: availableStock,
        minStock: 0,
        categoryId: '',
        categoryName: null,
        groupId: null,
        groupName: item.group_name ?? null,
        isVariant: Boolean(variantId),
        variantName: item.variant_name ?? null
      },
      quantity: originalQuantity,
      currentStock,
      originalQuantity
    }
  })

  productSearch.value = ''
  clearProductSearchState()

  detailModalOpen.value = false
  showCreateModal.value = true
}

async function deleteCurrentWriteOff() {
  if (!activeWriteOff.value) return
  if (!confirm('Удалить это списание?')) return

  try {
    await crmStore.deleteWriteOff(activeWriteOff.value.id)
    closeDetails()
    await crmStore.fetchWriteOffs()
  } catch (error) {
    console.error('[CRM] delete write-off error', error)
    alert('Не удалось удалить списание. Попробуйте еще раз.')
  }
}

function reasonLabel(reason: string) {
  return reasons.find((item) => item.value === reason)?.label ?? reason
}

function formatCurrency(value?: number | null) {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'BYN',
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  }).format(value)
}

function formatDate(dateString?: string | null) {
  if (!dateString) return '—'
  return new Date(dateString).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}
</script>
