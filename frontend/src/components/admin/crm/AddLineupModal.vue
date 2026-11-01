<template>
  <AdminModal
    :isOpen="isOpen"
    title="Добавить всю линейку"
    description="Выберите линейку, укажите количество на каждый вкус и цену за 1 шт — все товары линейки попадут в закупку."
    size="lg"
    :showActions="false"
    :persistent="true"
    :isLoading="confirming"
    @close="requestClose"
    @cancel="requestClose"
  >
    <div class="w-full max-w-2xl space-y-5">
      <!-- Поиск линейки -->
      <div v-if="!selectedGroup" class="space-y-3">
        <input
          v-model="searchQuery"
          ref="searchInputRef"
          type="search"
          class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
          placeholder="Введите название линейки (минимум 2 символа)"
        >
        <p v-if="showSearchHint" class="text-xs text-gray-500">
          Для поиска введите от двух символов
        </p>

        <div
          class="min-h-[160px] max-h-[420px] overflow-y-auto rounded-lg border border-dashed border-gray-200"
          role="listbox"
          aria-label="Найденные линейки"
        >
          <div
            v-if="isSearching"
            class="flex items-center justify-center gap-2 py-6 text-sm text-gray-500"
          >
            <div class="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-r-transparent"></div>
            Поиск линеек…
          </div>
          <div v-else-if="searchError" class="px-4 py-6 text-sm text-red-600">
            {{ searchError }}
          </div>
          <div
            v-else-if="groups.length === 0 && searchQuery.trim().length >= 2"
            class="px-4 py-6 text-sm text-gray-500"
          >
            Ничего не нашли. Попробуйте скорректировать запрос.
          </div>
          <ul v-else class="divide-y text-sm">
            <li
              v-for="group in groups"
              :key="group.id"
              class="flex items-center justify-between gap-3 px-4 py-3 transition-colors"
              :class="group.productCount === 0 ? 'opacity-60' : 'hover:bg-gray-50'"
            >
              <div class="min-w-0">
                <div class="truncate font-medium text-gray-900">
                  {{ group.name }}
                </div>
                <div class="truncate text-xs text-gray-500">
                  {{ group.categoryName || 'Без категории' }} ·
                  {{ group.productCount }}
                  {{ pluralProducts(group.productCount) }}
                  <template v-if="group.parentGroupId"> · подгруппа</template>
                </div>
              </div>
              <button
                type="button"
                class="flex-shrink-0 rounded-full border border-blue-200 px-3 py-1 text-xs font-semibold text-blue-600 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
                :disabled="group.productCount === 0"
                @click="selectGroup(group)"
              >
                {{ group.productCount === 0 ? 'Нет товаров' : 'Выбрать' }}
              </button>
            </li>
          </ul>
        </div>
      </div>

      <!-- Форма количества и цены -->
      <div v-else class="space-y-5">
        <div class="rounded-xl border border-blue-100 bg-blue-50/60 p-4">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="truncate text-sm font-semibold text-gray-900">
                {{ selectedGroup.name }}
              </div>
              <div class="truncate text-xs text-gray-500">
                {{ selectedGroup.categoryName || 'Без категории' }} ·
                {{ selectedGroup.productCount }}
                {{ pluralProducts(selectedGroup.productCount) }}
                добавится в закупку
              </div>
            </div>
            <button
              type="button"
              class="flex-shrink-0 text-xs font-semibold text-blue-600 hover:text-blue-800"
              @click="backToSearch"
            >
              Выбрать другую
            </button>
          </div>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <label class="block">
            <span class="text-sm font-medium text-gray-700">Количество на каждый вкус, шт</span>
            <input
              v-model.number="quantity"
              type="number"
              min="1"
              step="1"
              class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            >
          </label>
          <label class="block">
            <span class="text-sm font-medium text-gray-700">Цена за 1 шт, BYN</span>
            <input
              v-model.number="costPerUnit"
              type="number"
              min="0"
              step="0.01"
              class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            >
          </label>
        </div>

        <p class="text-xs text-gray-500">
          Итого: {{ totalQuantity }} шт на {{ totalAmount }} BYN.
          Позиции можно будет поправить вручную в таблице закупки.
        </p>

        <p v-if="confirmError" class="text-sm text-red-600" role="alert">
          {{ confirmError }}
        </p>

        <div class="flex gap-3 pt-1">
          <button
            type="button"
            class="flex-1 rounded-xl bg-blue-600 px-4 py-3 text-[13px] font-bold text-white shadow-[0_8px_16px_#148cff30] transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="!canConfirm || confirming"
            @click="confirm"
          >
            {{ confirming ? 'Добавляем…' : `Добавить ${selectedGroup.productCount} ${pluralProducts(selectedGroup.productCount)}` }}
          </button>
          <button
            type="button"
            class="flex-1 rounded-xl bg-gray-100 px-4 py-3 text-[13px] font-bold text-gray-700 transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="confirming"
            @click="requestClose"
          >
            Отмена
          </button>
        </div>
      </div>
    </div>
  </AdminModal>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import AdminModal from '@/components/AdminModal.vue'
import { useCrmStore, type CrmGroupSummary } from '@/stores/crm'

const props = defineProps<{
  isOpen: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'confirm', payload: { group: CrmGroupSummary; quantity: number; costPerUnit: number }): void
}>()

const crmStore = useCrmStore()

const searchQuery = ref('')
const searchInputRef = ref<HTMLInputElement | null>(null)
const groups = ref<CrmGroupSummary[]>([])
const isSearching = ref(false)
const searchError = ref('')
const selectedGroup = ref<CrmGroupSummary | null>(null)
const quantity = ref(5)
const costPerUnit = ref<number | null>(null)
const confirming = ref(false)
const confirmError = ref('')

let searchDebounce: ReturnType<typeof setTimeout> | null = null
/** Ревизия запроса: поздний ответ закрытого поиска отбрасывается. */
let requestRevision = 0

const showSearchHint = computed(() => searchQuery.value.trim().length === 1)

const canConfirm = computed(
  () =>
    selectedGroup.value !== null &&
    Number.isFinite(quantity.value) &&
    quantity.value !== null &&
    quantity.value >= 1 &&
    costPerUnit.value !== null &&
    costPerUnit.value >= 0,
)

const totalQuantity = computed(() =>
  Math.max(selectedGroup.value?.productCount ?? 0, 0) * Math.max(quantity.value ?? 0, 0),
)

const totalAmount = computed(() => {
  const value = totalQuantity.value * Math.max(costPerUnit.value ?? 0, 0)
  return value.toFixed(2)
})

function pluralProducts(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return 'товар'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'товара'
  return 'товаров'
}

async function runSearch(query: string) {
  const revision = ++requestRevision
  isSearching.value = true
  searchError.value = ''
  try {
    const found = await crmStore.searchCrmGroups({ search: query, limit: 25 })
    if (revision !== requestRevision) return
    groups.value = found
  } catch (error: any) {
    if (revision !== requestRevision) return
    searchError.value = error?.message || 'Не удалось загрузить линейки'
    groups.value = []
  } finally {
    if (revision === requestRevision) {
      isSearching.value = false
    }
  }
}

watch(searchQuery, (query) => {
  if (searchDebounce) clearTimeout(searchDebounce)
  const trimmed = query.trim()
  if (!trimmed) {
    requestRevision++
    groups.value = []
    isSearching.value = false
    searchError.value = ''
    return
  }
  if (trimmed.length < 2) {
    groups.value = []
    return
  }
  searchDebounce = setTimeout(() => {
    void runSearch(trimmed)
  }, 250)
})

watch(
  () => props.isOpen,
  async (open) => {
    if (open) {
      reset()
      await nextTick()
      searchInputRef.value?.focus()
    } else {
      requestRevision++
      if (searchDebounce) clearTimeout(searchDebounce)
    }
  },
)

function reset() {
  searchQuery.value = ''
  groups.value = []
  isSearching.value = false
  searchError.value = ''
  selectedGroup.value = null
  quantity.value = 5
  costPerUnit.value = null
  confirming.value = false
  confirmError.value = ''
}

function selectGroup(group: CrmGroupSummary) {
  if (group.productCount === 0) return
  selectedGroup.value = group
  confirmError.value = ''
}

function backToSearch() {
  selectedGroup.value = null
  confirmError.value = ''
}

function confirm() {
  if (!canConfirm.value || confirming.value) return
  const group = selectedGroup.value
  if (!group) return
  confirming.value = true
  confirmError.value = ''
  emit('confirm', {
    group,
    quantity: Math.trunc(Number(quantity.value)),
    costPerUnit: Number(costPerUnit.value ?? 0),
  })
}

/** Родитель после успешной вставки вызывает close(); при ошибке — оставляет
 * модалку открытой с сообщением. */
function requestClose() {
  if (confirming.value) return
  emit('close')
}

/** Разблокировать кнопку после обработки confirm на родителе. */
function settle(error?: string) {
  confirming.value = false
  confirmError.value = error ?? ''
}

defineExpose({ settle })
</script>
