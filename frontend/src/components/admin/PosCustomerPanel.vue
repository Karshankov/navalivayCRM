<template>
  <div class="pos-customer-panel">
    <!-- =========================================================
         1) Карточка «Клиент чека» — компактная, всегда сверху
         (placeholder когда никто не привязан).
         ========================================================= -->
    <div v-if="modelValue" class="pos-customer-selected">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <p class="text-xs uppercase tracking-wide text-gray-500">Клиент чека</p>
          <p class="text-sm font-semibold text-gray-900 truncate">
            {{ formatCustomerName(modelValue) }}
          </p>
          <p v-if="modelValue.phone" class="text-xs text-gray-600">
            {{ modelValue.phone }}
          </p>
          <p v-if="modelValue.telegram_username" class="text-xs text-blue-600">
            @{{ modelValue.telegram_username }}
          </p>
          <p
            v-if="modelValue.blocked_count && modelValue.blocked_count > 0"
            class="mt-1 inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-700"
          >
            ⚠ Клиент заблокирован
          </p>
        </div>
        <button
          type="button"
          class="text-xs text-red-500 hover:text-red-700 font-medium"
          @click="$emit('update:modelValue', null)"
          aria-label="Открепить клиента"
        >
          ✕
        </button>
      </div>

      <!-- История покупок (компактная) -->
      <div class="mt-3 border-t border-gray-100 pt-2">
        <div class="flex items-center justify-between mb-1">
          <p class="text-xs uppercase tracking-wide text-gray-500">История</p>
          <span class="text-xs text-gray-500">
            {{ historyLoading ? '…' : `${history.length} покупок` }}
          </span>
        </div>
        <ul v-if="history.length" class="space-y-1 max-h-32 overflow-y-auto">
          <li
            v-for="item in history.slice(0, 8)"
            :key="`${item.source}-${item.id}`"
            class="text-xs flex items-center justify-between gap-2"
          >
            <span class="truncate">
              <span
                class="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle"
                :class="item.source === 'pos' ? 'bg-amber-400' : 'bg-blue-500'"
              />
              {{ formatHistoryDate(item.created_at) }}
            </span>
            <span class="font-medium text-gray-900 whitespace-nowrap">
              {{ formatAmount(item.amount) }} BYN
            </span>
          </li>
        </ul>
        <p v-else-if="!historyLoading" class="text-xs text-gray-400">
          Покупок ещё нет, это первый чек.
        </p>
      </div>
    </div>
    <div v-else class="pos-customer-placeholder">
      <p class="text-xs uppercase tracking-wide text-gray-500">Клиент чека</p>
      <p class="mt-1 text-sm text-gray-500">
        Не привязан. Найдите в блокноте ниже или создайте нового.
      </p>
    </div>

    <!-- =========================================================
         2) «Блокнот клиентов» — ВСЕГДА видимый список с поиском
         и кнопкой создания. Не зависит от того, привязан ли
         кто-то к текущему чеку. Точно как описывал Костя:
         «у тебя по сути внутри некий блокнот... тут же поиск
         по клиенту → ввести номер телефона».
         ========================================================= -->
    <div class="pos-customer-notebook">
      <div class="flex items-center justify-between mb-2">
        <label class="text-sm font-medium text-gray-700">Блокнот клиентов</label>
        <span v-if="notebookItems.length" class="text-[11px] text-gray-400">
          {{ searchQuery.trim() ? 'найдено' : 'недавние' }}: {{ notebookItems.length }}
        </span>
      </div>

      <div class="relative">
        <MagnifyingGlassIcon class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Имя или телефон…"
          class="w-full rounded-lg border border-gray-300 pl-9 pr-9 py-2 text-sm focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200"
        />
        <button
          v-if="searchQuery"
          type="button"
          class="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          aria-label="Очистить поиск"
          @click="searchQuery = ''"
        >
          <XMarkIcon class="h-4 w-4" />
        </button>
      </div>

      <!-- Список (поиск или последние) -->
      <div class="mt-2 rounded-lg border border-gray-200 bg-white">
        <div v-if="searching" class="px-3 py-3 text-xs text-gray-500 text-center">
          Ищем…
        </div>
        <ul v-else-if="notebookItems.length" class="max-h-72 overflow-y-auto divide-y divide-gray-100">
          <li
            v-for="customer in notebookItems"
            :key="customer.id"
            class="px-3 py-2 text-sm cursor-pointer transition-colors"
            :class="
              isSelected(customer)
                ? 'bg-emerald-50 hover:bg-emerald-100'
                : 'hover:bg-gray-50'
            "
            @click="selectCustomer(customer)"
          >
            <div class="flex items-start gap-2">
              <span
                class="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center text-emerald-600"
                :aria-label="isSelected(customer) ? 'Привязан к текущему чеку' : ''"
              >
                <!-- Только зелёная ✓ для привязанного клиента. У остальных
                     иконку не рисуем — иначе UX читается как «радиогруппа»
                     с неактивным выбором, что неточно: можно привязать любого
                     просто кликом по строке. -->
                <CheckIcon v-if="isSelected(customer)" class="h-4 w-4" />
              </span>
              <div class="min-w-0 flex-1">
                <div class="font-medium text-gray-900 truncate">
                  {{ formatCustomerName(customer) }}
                </div>
                <div class="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  <span v-if="customer.phone">{{ customer.phone }}</span>
                  <span v-if="customer.telegram_username" class="text-blue-600">
                    @{{ customer.telegram_username }}
                  </span>
                  <span
                    v-if="(customer.total_orders ?? 0) > 0"
                    class="text-gray-400"
                  >
                    {{ customer.total_orders }} покуп.
                  </span>
                </div>
              </div>
              <span
                v-if="customer.blocked_count && customer.blocked_count > 0"
                class="ml-1 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700"
                title="Клиент заблокирован"
              >⚠</span>
              <!--
                Кнопка soft-delete. Показываем только если клиент НЕ привязан
                к текущему чеку (иначе случайный клик при покупке = потеря
                привязки + удаление). @click.stop останавливает bubble на
                <li>, который иначе бы переключил привязку к этому клиенту.
              -->
              <button
                v-if="!isSelected(customer)"
                type="button"
                class="ml-1 flex-shrink-0 rounded p-1 text-gray-300 transition hover:bg-red-50 hover:text-red-600"
                :title="`Удалить «${formatCustomerName(customer)}» из блокнота`"
                :disabled="busyDeleteId === customer.id"
                @click.stop="deleteCustomer(customer)"
              >
                <TrashIcon v-if="busyDeleteId !== customer.id" class="h-3.5 w-3.5" />
                <span v-else class="block h-3.5 w-3.5 text-[10px] leading-3.5">…</span>
              </button>
            </div>
          </li>
        </ul>
        <div v-else class="px-3 py-3 text-xs text-gray-500 text-center">
          <template v-if="searchQuery.trim()">
            Никого не нашли. Создайте нового кнопкой ниже.
          </template>
          <template v-else>
            В блокноте пока пусто. Добавьте первого клиента.
          </template>
        </div>
      </div>

      <button
        type="button"
        class="mt-2 w-full inline-flex items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
        @click="openCreateModal"
      >
        <PlusIcon class="h-4 w-4" />
        Добавить клиента
      </button>
    </div>

    <!-- Inline-баннер «слили с существующим клиентом» (вместо window.alert) -->
    <Transition name="fade">
      <div
        v-if="mergeBanner"
        class="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800"
      >
        {{ mergeBanner }}
      </div>
    </Transition>

    <!-- Modal: создать клиента -->
    <Transition name="fade">
      <div
        v-if="showCreateModal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pos-customer-modal-title"
        tabindex="-1"
        class="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 px-4"
        v-safe-backdrop-close="closeCreateModal"
        @keydown.esc="closeCreateModal"
      >
        <div class="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
          <h3 id="pos-customer-modal-title" class="text-lg font-semibold text-gray-900 mb-3">Новый клиент кассы</h3>
          <form class="space-y-3" @submit.prevent="submitCreate">
            <div>
              <label class="block text-xs font-medium text-gray-600 mb-1">Имя (или Имя Фамилия)</label>
              <input
                ref="newNameInputRef"
                v-model.trim="newName"
                type="text"
                placeholder="Иван Петров"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200"
                required
              />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 mb-1">Телефон</label>
              <input
                v-model.trim="newPhone"
                type="tel"
                placeholder="+375 33 123-45-67"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200"
                required
              />
              <p class="text-xs text-gray-500 mt-1">
                Если такой телефон уже есть в базе, мы привяжем чек к существующему клиенту.
              </p>
            </div>
            <!--
              Скидочные карты в модели Кости — это физические карточки-
              пропуска, которые продавец вручает на кассе («у меня в
              историях есть в профиле такая карточка, мы её типа выдаём»).
              В системе клиент идентифицируется ТОЛЬКО по номеру телефона:
              «вдруг он забыл эту карточку, и мы можем просто найти этого
              человека по номеру телефона, убедившись, что он наш клиент».
              Поэтому отдельной сущности «карта» в БД нет — запись в
              customers через эту форму уже = «карта выдана / клиент наш».
              «Купил ли уже» считаем по total_orders, виден в строке
              блокнота как «N покуп.». Если в будущем понадобится учитывать
              «вручили физическую карточку или нет» отдельно от факта
              записи в БД — добавится bool customers.pos_card_issued.
            -->
            <div v-if="createError" class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {{ createError }}
            </div>
            <div class="flex gap-2 pt-1">
              <button
                type="submit"
                :disabled="creating || !newName || !newPhone"
                class="flex-1 rounded-lg bg-green-500 px-4 py-2 text-sm font-semibold text-white hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {{ creating ? 'Сохраняем…' : 'Сохранить' }}
              </button>
              <button
                type="button"
                class="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                @click="closeCreateModal"
              >
                Отмена
              </button>
            </div>
          </form>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CheckIcon, MagnifyingGlassIcon, PlusIcon, TrashIcon, XMarkIcon } from '@heroicons/vue/24/outline'
import { useCrmStore, type Customer } from '@/stores/crm'
import { vSafeBackdropClose } from '@/directives/safeBackdropClose'

const props = defineProps<{
  /** Текущий выбранный клиент (v-model) — null когда не выбран. */
  modelValue: Customer | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', customer: Customer | null): void
}>()

const crmStore = useCrmStore()

// Блокнот: results = либо search-hits (если есть q), либо «недавние» при пустом q.
const searchQuery = ref('')
const searchResults = ref<Customer[]>([])
const recentResults = ref<Customer[]>([])
const searching = ref(false)
let searchDebounce: ReturnType<typeof setTimeout> | null = null
// Sequence number защищает от race-условия: быстрая печать может вызвать 2-3
// fetch'а одновременно, медленный (старый) запрос может приземлиться позже
// быстрого (нового) и затереть актуальный результат. Игнорируем устаревшие.
let searchSeq = 0
let recentSeq = 0

const NOTEBOOK_LIMIT = 30

const notebookItems = computed<Customer[]>(() =>
  searchQuery.value.trim() ? searchResults.value : recentResults.value,
)

function isSelected(customer: Customer): boolean {
  return Boolean(props.modelValue && customer.id === props.modelValue.id)
}

async function loadRecent() {
  const my = ++recentSeq
  try {
    const items = await crmStore.searchCustomersForPos('', NOTEBOOK_LIMIT, {
      includeRecent: true,
    })
    if (my !== recentSeq) return
    recentResults.value = items
  } catch (err) {
    if (my !== recentSeq) return
    console.error('[pos-customer] recent load failed', err)
    recentResults.value = []
  }
}

// Debounce поиска — иначе на каждый символ дёргаем backend.
//
// Когда q очищается (бекспейсом или ✕-кнопкой), мы сразу перезагружаем
// «недавние» — иначе после долгой работы кассиром recentResults рискует
// устареть (другой админ добавил/удалил клиента в CRM), а клик в empty-state
// «В блокноте пока пусто» ввёл бы пользователя в заблуждение — лучше
// гарантировать свежие данные на каждом возврате к recent-режиму.
watch(searchQuery, (q) => {
  if (searchDebounce !== null) clearTimeout(searchDebounce)
  if (!q.trim()) {
    searchResults.value = []
    searching.value = false
    loadRecent()
    return
  }
  searching.value = true
  const my = ++searchSeq
  searchDebounce = setTimeout(async () => {
    try {
      const items = await crmStore.searchCustomersForPos(q, NOTEBOOK_LIMIT)
      if (my !== searchSeq) return
      searchResults.value = items
    } catch (err) {
      if (my !== searchSeq) return
      console.error('[pos-customer] search failed', err)
      searchResults.value = []
    } finally {
      if (my === searchSeq) searching.value = false
    }
  }, 250)
})

function handleWindowEscape(event: KeyboardEvent) {
  if (event.key === 'Escape' && showCreateModal.value) {
    closeCreateModal()
  }
}

onMounted(() => {
  loadRecent()
  window.addEventListener('keydown', handleWindowEscape)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleWindowEscape)
  if (searchDebounce !== null) {
    clearTimeout(searchDebounce)
    searchDebounce = null
  }
  if (mergeBannerTimer !== null) {
    clearTimeout(mergeBannerTimer)
    mergeBannerTimer = null
  }
})

function selectCustomer(customer: Customer) {
  emit('update:modelValue', customer)
  // Поисковая строка остаётся, чтобы кассир мог быстро привязать другого
  // клиента, не перепечатывая запрос. Активный клиент подсвечивается ✓
  // в списке, поэтому ясно, кто сейчас на чеке.
}

// Soft-delete клиента из блокнота. Двойная защита от случайного клика:
// (1) кнопка не показывается у привязанного к чеку, (2) confirm перед
// запросом. После успеха обновляем оба источника (search + recent).
const busyDeleteId = ref<string | null>(null)
async function deleteCustomer(customer: Customer) {
  if (busyDeleteId.value) return
  if (!confirm(`Удалить «${formatCustomerName(customer)}» из блокнота?`)) return
  busyDeleteId.value = customer.id
  try {
    await crmStore.deletePosCustomer(customer.id)
    // Локально убираем из обоих списков, чтобы пользователь сразу увидел
    // результат, не дожидаясь refetch.
    searchResults.value = searchResults.value.filter((r) => r.id !== customer.id)
    recentResults.value = recentResults.value.filter((r) => r.id !== customer.id)
  } catch (err) {
    console.error('[pos-customer] delete failed', err)
    alert(err instanceof Error ? err.message : 'Не удалось удалить клиента')
    // На ошибке стоит перечитать актуальное состояние, вдруг кто-то
    // удалил параллельно (тогда наш запрос вернул 404).
    await loadRecent()
  } finally {
    busyDeleteId.value = null
  }
}

// Создание нового клиента
const showCreateModal = ref(false)
const newName = ref('')
const newPhone = ref('')
const createError = ref('')
const creating = ref(false)
const newNameInputRef = ref<HTMLInputElement | null>(null)
const mergeBanner = ref('')
let mergeBannerTimer: ReturnType<typeof setTimeout> | null = null

function openCreateModal() {
  newName.value = ''
  // Если в поле поиска была цифра — предзаполняем телефон.
  // Если буквы — предзаполняем имя.
  const q = searchQuery.value.trim()
  if (q && /\d/.test(q)) {
    newPhone.value = q
  } else if (q) {
    newName.value = q
    newPhone.value = ''
  } else {
    newPhone.value = ''
  }
  createError.value = ''
  showCreateModal.value = true
  nextTick(() => newNameInputRef.value?.focus())
}

function closeCreateModal() {
  if (creating.value) return
  showCreateModal.value = false
}

async function submitCreate() {
  if (creating.value) return
  creating.value = true
  createError.value = ''
  try {
    const result = await crmStore.createPosCustomer({
      name: newName.value,
      phone: newPhone.value,
    })
    emit('update:modelValue', result.customer)
    showCreateModal.value = false
    if (result.merged) {
      // Inline-баннер вместо window.alert — не блокирует интерфейс кассы.
      mergeBanner.value =
        `Этот телефон уже был в базе, привязали к: ${formatCustomerName(result.customer)}`
      if (mergeBannerTimer !== null) clearTimeout(mergeBannerTimer)
      mergeBannerTimer = setTimeout(() => { mergeBanner.value = '' }, 6000)
    }
    // Чистим поисковую строку — watch сам подхватит и перечитает «недавние»,
    // новый клиент окажется наверху списка. recentSeq внутри loadRecent
    // защищает от race-условий, поэтому отдельный await тут не нужен.
    searchQuery.value = ''
  } catch (err: any) {
    if (err?.message === 'phone_invalid') {
      createError.value = 'Введите корректный телефон (10–15 цифр)'
    } else if (err?.message === 'name_required') {
      createError.value = 'Имя обязательно'
    } else {
      createError.value = err?.message || 'Не удалось сохранить клиента'
    }
  } finally {
    creating.value = false
  }
}

// История покупок выбранного клиента (для карточки сверху)
const history = ref<
  Array<{ id: string; source: 'order' | 'pos'; amount: number; created_at: string }>
>([])
const historyLoading = ref(false)
let historySeq = 0

watch(
  () => props.modelValue?.id ?? null,
  async (customerId) => {
    const my = ++historySeq
    if (!customerId) {
      history.value = []
      return
    }
    historyLoading.value = true
    try {
      const items = await crmStore.fetchCustomerPurchaseHistory(customerId, 30)
      if (my !== historySeq) return
      history.value = items as typeof history.value
    } catch (err) {
      if (my !== historySeq) return
      console.error('[pos-customer] history failed', err)
      history.value = []
    } finally {
      if (my === historySeq) historyLoading.value = false
    }
  },
  { immediate: true },
)

function formatCustomerName(c: Customer): string {
  const parts = [c.first_name, c.last_name].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : c.telegram_username ? `@${c.telegram_username}` : 'Без имени'
}

function formatHistoryDate(iso: string): string {
  // Синхронно с server/utils/pos-customers.js:parseDbTimestamp — оба формата
  // datetime в БД нормализуем под UTC: 'YYYY-MM-DD HH:MM:SS' (без Z) и
  // 'YYYY-MM-DDTHH:MM:SS.sssZ' (уже UTC). Используем endsWith('Z') как
  // признак уже-UTC формата.
  const normalized = iso.endsWith('Z') ? iso : iso.replace(' ', 'T') + 'Z'
  const d = new Date(normalized)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })
}

function formatAmount(value: number | null | undefined): string {
  if (value == null) return ''
  return Number(value).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}
</script>

<style scoped>
.pos-customer-panel {
  font-size: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pos-customer-selected {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 12px;
}

.pos-customer-placeholder {
  background: #f9fafb;
  border: 1px dashed #d1d5db;
  border-radius: 12px;
  padding: 12px;
}

.pos-customer-notebook {
  display: flex;
  flex-direction: column;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
