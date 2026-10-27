<template>
  <AdminModal
    :isOpen="isOpen"
    title="Пересорт линейки"
    description="Пересчитайте вкусы и введите фактический остаток — цифры в базе станут как на полке."
    size="2xl"
    :showActions="false"
    @close="emit('close')"
    @cancel="emit('close')"
  >
    <div class="space-y-4" data-test="inventory-modal">
      <!-- Ошибка загрузки превью -->
      <div
        v-if="loadingError && !hasItems && !result"
        class="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between"
        role="alert"
      >
        <span>{{ loadingError }}</span>
        <button
          type="button"
          class="inline-flex min-h-10 items-center justify-center rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100"
          data-test="inventory-retry"
          @click="reloadPreview"
        >
          Повторить
        </button>
      </div>

      <!-- Выбор линейки и точки -->
      <div
        v-if="!result"
        class="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 sm:flex-row sm:items-end sm:justify-between"
      >
        <div class="min-w-0 flex-1">
          <label class="block text-xs font-semibold text-gray-600" for="inventory-group-search">
            Линейка
          </label>
          <div ref="searchBlockRef" class="relative mt-1">
            <MagnifyingGlassIcon
              class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
              aria-hidden="true"
            />
            <input
              id="inventory-group-search"
              ref="searchInputRef"
              v-model="groupSearchQuery"
              type="text"
              role="combobox"
              aria-autocomplete="list"
              autocomplete="off"
              autocapitalize="none"
              spellcheck="false"
              class="h-10 w-full rounded-lg border border-gray-300 bg-white pl-9 pr-9 text-sm text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
              placeholder="Начните вводить название…"
              data-test="inventory-group-search"
              :aria-expanded="showGroupList"
              :aria-controls="showGroupList ? 'inventory-group-list' : undefined"
              :aria-activedescendant="showGroupList ? activeOptionId : undefined"
              :disabled="loading || loadingPreview"
              @focus="onSearchFocus"
              @input="showGroupList = true"
              @keydown.down.prevent="moveActive(1)"
              @keydown.up.prevent="moveActive(-1)"
              @keydown.enter.prevent="selectActiveOrFirst"
              @keydown.escape="onSearchEscape"
            />
            <button
              v-if="selectedGroup"
              type="button"
              class="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-40"
              :title="'Сбросить выбор линейки'"
              aria-label="Сбросить выбор линейки"
              data-test="inventory-group-clear"
              :disabled="loading || loadingPreview"
              @click="clearGroupSelection"
            >
              <XMarkIcon class="h-5 w-5" aria-hidden="true" />
            </button>

            <ul
              v-if="showGroupList"
              id="inventory-group-list"
              ref="groupListRef"
              role="listbox"
              aria-label="Линейки"
              class="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
              data-test="inventory-group-list"
            >
              <li
                v-for="(group, index) in filteredGroups"
                :id="`inventory-group-option-${group.id}`"
                :key="group.id"
                role="option"
                tabindex="-1"
                :aria-selected="group.id === selectedGroupId"
                class="flex min-h-10 cursor-pointer items-center px-3 py-2 text-sm"
                :class="group.id === selectedGroupId
                  ? 'bg-blue-50 font-semibold text-blue-900'
                  : index === activeIndex
                    ? 'bg-gray-100 text-gray-900'
                    : 'text-gray-800'"
                :data-test="'inventory-group-option'"
                @click="selectGroup(group.id)"
                @mousemove="activeIndex = index"
              >
                {{ group.name }}
              </li>
              <li
                v-if="!filteredGroups.length"
                class="cursor-default px-3 py-3 text-center text-sm text-gray-500"
              >
                <template v-if="groupSearchQuery.trim()">Ничего не найдено</template>
                <template v-else>Сначала создайте линейку с товарами.</template>
              </li>
            </ul>
          </div>
        </div>

        <div class="shrink-0">
          <span class="mb-1 block text-xs font-semibold text-gray-600">Точка</span>
          <div
            class="inline-flex overflow-hidden rounded-lg border border-gray-300"
            role="group"
            aria-label="Точка учёта"
          >
            <button
              v-for="option in locationOptions"
              :key="option.value"
              type="button"
              class="min-h-10 px-4 text-sm font-semibold transition"
              :class="location === option.value ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'"
              :aria-pressed="location === option.value"
              :data-test="`inventory-location-${option.value}`"
              :disabled="loading || loadingPreview"
              @click="switchLocation(option.value)"
            >
              {{ option.label }}
            </button>
          </div>
        </div>
      </div>

      <!-- Загрузка -->
      <div
        v-if="loadingPreview && !hasItems && !result"
        class="py-10 text-center text-sm text-gray-500"
        role="status"
        aria-live="polite"
      >
        Загружаем вкусы линейки…
      </div>

      <!-- Пустая линейка -->
      <div
        v-else-if="selectedGroupId && !loadingPreview && !hasItems && !result && !loadingError"
        class="rounded-2xl border border-dashed border-gray-200 px-5 py-10 text-center"
        data-test="inventory-empty"
      >
        <p class="font-medium text-gray-900">В линейке нет товаров</p>
        <p class="mt-1 text-sm text-gray-500">Пересорту нечего пересчитывать.</p>
      </div>

      <!-- Результат сохранения -->
      <template v-else-if="result">
        <div class="space-y-4" data-test="inventory-result">
          <div class="rounded-2xl border border-gray-200 bg-white px-4 py-4">
            <p class="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Пересорт №{{ result.check_number }} · {{ groupName }}
            </p>
            <p class="mt-2 text-lg font-semibold text-gray-900">
              <template v-if="result.diff_total > 0">
                Стало на {{ result.diff_total }} больше
              </template>
              <template v-else-if="result.diff_total < 0">
                Стало на {{ Math.abs(result.diff_total) }} меньше
              </template>
              <template v-else>Осталось так же</template>
            </p>
            <p class="mt-1 text-sm text-gray-500">
              Числится {{ result.total_before }} шт · по факту {{ result.total_after }} шт
            </p>
          </div>

          <section class="min-w-0 rounded-2xl border border-gray-200">
            <header class="border-b border-gray-100 px-4 py-3">
              <h3 class="text-sm font-semibold text-gray-900">Изменённые остатки</h3>
              <p class="text-xs text-gray-500">{{ result.items.length }} позиций</p>
            </header>
            <ul class="divide-y divide-gray-100">
              <li
                v-for="item in result.items"
                :key="item.id"
                class="flex items-center justify-between gap-3 px-4 py-2.5"
                :data-test="`inventory-result-${item.id}`"
              >
                <span class="min-w-0 break-words text-sm text-gray-900">
                  {{ item.product_title }}
                  <span v-if="item.variant_name" class="text-gray-500">({{ item.variant_name }})</span>
                </span>
                <span class="shrink-0 text-sm tabular-nums">
                  <span class="text-gray-500">{{ item.expected_quantity }} → {{ item.actual_quantity }}</span>
                  <span
                    class="ml-2 rounded-full px-2 py-0.5 text-xs font-semibold"
                    :class="diffChipClass(item.diff)"
                  >
                    {{ diffLabel(item.diff) }}
                  </span>
                </span>
              </li>
            </ul>
          </section>

          <p class="text-xs text-gray-500">
            Остатки обновлены. Денежных проводок нет: недостачу при желании оформите обычным Списанием.
          </p>
        </div>
      </template>

      <!-- Список вкусов -->
      <template v-else-if="hasItems">
        <!-- Живая сводка -->
        <div
          class="flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3 text-sm"
          :class="summaryChipClass"
          role="status"
          aria-live="polite"
          data-test="inventory-summary"
        >
          <span class="text-gray-600">
            Числится <b class="tabular-nums">{{ totalExpected }}</b> ·
            по факту <b class="tabular-nums">{{ totalActual }}</b>
          </span>
          <span class="font-semibold">
            {{ summaryText }}
          </span>
        </div>

        <p
          v-if="savingError"
          class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          role="alert"
          data-test="inventory-save-error"
        >
          {{ savingError }}
        </p>

        <section class="min-w-0 rounded-2xl border border-gray-200" data-test="inventory-list">
          <header class="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
            <div class="min-w-0">
              <h3 class="truncate text-sm font-semibold text-gray-900" :title="groupName">{{ groupName }}</h3>
              <p class="text-xs text-gray-500">
                {{ items.length }} вкусов · считаем по точке «{{ locationLabel }}»
              </p>
            </div>
            <button
              type="button"
              class="rounded-lg px-2 py-1 text-xs font-semibold text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
              :title="'Сбросить введённые числа к числящимся остаткам'"
              data-test="inventory-reset"
              @click="resetToExpected"
            >
              Сбросить
            </button>
          </header>

          <ul class="divide-y divide-gray-100">
            <li
              v-for="item in items"
              :key="item.key"
              class="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              :data-test="`inventory-item-${item.key}`"
            >
              <div class="min-w-0">
                <p class="break-words text-sm font-medium text-gray-900">{{ item.title }}</p>
                <p v-if="item.variant_name" class="text-xs text-gray-500">{{ item.variant_name }}</p>
              </div>

              <div class="flex flex-wrap items-center gap-2">
                <span
                  class="rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums"
                  :class="item.expected === 0 ? 'bg-gray-100 text-gray-600' : 'bg-gray-100 text-gray-800'"
                  :title="`Числится: ${item.expected} шт`"
                >
                  числится {{ item.expected }}
                </span>

                <label class="sr-only" :for="inputId(item)">
                  Фактический остаток: {{ item.title }}
                </label>
                <span class="relative inline-flex items-center">
                  <input
                    :id="inputId(item)"
                    v-model.number="actualValues[item.key]"
                    type="number"
                    inputmode="numeric"
                    min="0"
                    step="1"
                    class="w-24 rounded-lg border border-gray-300 py-1.5 pl-2 pr-7 text-sm tabular-nums focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    :data-test="`inventory-input-${item.key}`"
                    @blur="sanitizeValue(item)"
                  />
                  <span class="pointer-events-none absolute right-2 text-xs text-gray-400" aria-hidden="true">шт</span>
                </span>

                <span
                  v-if="itemDelta(item) !== null"
                  class="rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums"
                  :class="diffChipClass(itemDelta(item) ?? 0)"
                  :data-test="`inventory-delta-${item.key}`"
                >
                  {{ diffLabel(itemDelta(item) ?? 0) }}
                </span>
              </div>
            </li>
          </ul>
        </section>
      </template>

      <div v-else-if="!selectedGroupId && !result" class="rounded-2xl border border-dashed border-gray-200 px-5 py-10 text-center">
        <p class="font-medium text-gray-900">Найдите линейку</p>
        <p class="mt-1 text-sm text-gray-500">
          Начните вводить название — покажем все её вкусы, включая те, которых нет в наличии.
        </p>
      </div>
    </div>

    <!-- Кнопки -->
    <template #footer>
      <div class="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          class="inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-200"
          data-test="inventory-close"
          @click="emit('close')"
        >
          {{ result ? 'Закрыть' : 'Отмена' }}
        </button>
        <div class="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
          <button
            v-if="result"
            type="button"
            class="inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-300 px-5 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-200"
            data-test="inventory-new-check"
            @click="startNewCheck"
          >
            Новый пересорт
          </button>
          <button
            v-if="!result"
            type="button"
            class="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-300"
            :disabled="!canSave || loading || loadingPreview"
            data-test="inventory-save"
            @click="save"
          >
            {{ loading ? 'Сохраняем…' : 'Сохранить' }}
          </button>
        </div>
      </div>
      <p v-if="!result" class="mt-2 text-xs text-gray-500">
        Пустое поле — остаток не трогаем. Вводится фактическое число, не «насколько изменить».
      </p>
    </template>
  </AdminModal>
</template>

<script lang="ts">
export interface InventoryCheckPreviewItem {
  product_id: string;
  variant_id: string | null;
  title: string;
  variant_name: string | null;
  expected: number;
}

export interface InventoryCheckResultItem {
  id: string;
  product_id: string;
  variant_id: string | null;
  product_title: string;
  variant_name: string | null;
  expected_quantity: number;
  actual_quantity: number;
  diff: number;
}

export interface InventoryCheckResult {
  id: string;
  check_number: number;
  group: { id: string; name: string };
  location: 'retail' | 'warehouse';
  positions_count: number;
  counted_count: number;
  total_before: number;
  total_after: number;
  diff_total: number;
  created_by: string | null;
  notes: string | null;
  created_at: string;
  items: InventoryCheckResultItem[];
}
</script>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, reactive, ref, watch } from 'vue';
import { XMarkIcon, MagnifyingGlassIcon } from '@heroicons/vue/24/outline';
import { useAdminStore } from '@/stores/admin';
import AdminModal from '@/components/AdminModal.vue';

/**
 * Пересорт (инвентаризация линейки): выбрать линейку → пересчитать вкусы →
 * ввести фактический остаток → сохранить. Остатки становятся введёнными
 * числами, журнал хранит «было → стало».
 *
 * Модалка живёт в слое админки, поэтому ходит напрямую через adminStore
 * ($fetch с админским токеном), а не через crm-стор.
 */
const props = withDefaults(
  defineProps<{
    isOpen: boolean;
    groups: Array<{ id: string; name: string; categoryId: string }>;
    initialLocation?: 'retail' | 'warehouse';
  }>(),
  { initialLocation: 'retail' },
);

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'saved', result: InventoryCheckResult): void;
}>();

interface Row extends InventoryCheckPreviewItem {
  key: string;
}

const adminStore = useAdminStore();

const selectedGroupId = ref('');
const location = ref<'retail' | 'warehouse'>(props.initialLocation);
// Поиск линейки по названию вместо длинного выпадающего списка: линеек
// десятки, нужная находится за пару букв.
const groupSearchQuery = ref('');
const showGroupList = ref(false);
const activeIndex = ref(0);
const searchInputRef = ref<HTMLInputElement | null>(null);
const searchBlockRef = ref<HTMLDivElement | null>(null);
const groupListRef = ref<HTMLUListElement | null>(null);
const loadingPreview = ref(false);
const loadingError = ref('');
const loading = ref(false);
const savingError = ref('');
const result = ref<InventoryCheckResult | null>(null);

const items = ref<Row[]>([]);
// Пустая строка в поле = «не считал, не трогаю». Поэтому значение хранится
// как string|null, а не число: Number('') === 0 и «не вводил» стал бы нулём.
const actualValues = reactive<Record<string, string | null>>({});

const locationOptions = [
  { value: 'retail' as const, label: 'Розница' },
  { value: 'warehouse' as const, label: 'Склад' },
];

const locationLabel = computed(() =>
  location.value === 'warehouse' ? 'Склад' : 'Розница',
);

const groupName = computed(() =>
  props.groups.find((group) => group.id === selectedGroupId.value)?.name ?? '',
);

const selectedGroup = computed(() =>
  props.groups.find((group) => group.id === selectedGroupId.value) ?? null,
);

const filteredGroups = computed(() => {
  const query = groupSearchQuery.value.toLowerCase().trim();
  if (!query) return props.groups;
  return props.groups.filter((group) => group.name.toLowerCase().includes(query));
});

const activeOptionId = computed(() => {
  const group = filteredGroups.value[activeIndex.value];
  return group ? `inventory-group-option-${group.id}` : undefined;
});

function moveActive(step: number) {
  if (!filteredGroups.value.length) return;
  activeIndex.value =
    (activeIndex.value + step + filteredGroups.value.length) % filteredGroups.value.length;
  // Подсвеченная опция должна быть видна — прокручиваем список к ней.
  nextTick(() => {
    const active = groupListRef.value?.children[activeIndex.value] as HTMLElement | undefined;
    active?.scrollIntoView({ block: 'nearest' });
  });
}

function selectGroup(groupId: string) {
  selectedGroupId.value = groupId;
  showGroupList.value = false;
  // Выбранная линейка остаётся видна в поле — так понятнее, что проверяем.
  groupSearchQuery.value = selectedGroup.value?.name ?? '';
}

function clearGroupSelection() {
  selectedGroupId.value = '';
  groupSearchQuery.value = '';
  items.value = [];
  showGroupList.value = true;
  activeIndex.value = 0;
  void nextTick(() => searchInputRef.value?.focus());
}

function selectActiveOrFirst() {
  const group = filteredGroups.value[activeIndex.value] ?? filteredGroups.value[0];
  if (group) {
    selectGroup(group.id);
  } else if (groupSearchQuery.value.trim()) {
    // Ничего не найдено — Enter не должен ни сбрасывать ввод, ни выбирать
    // случайную линейку: остаёмся в поиске, можно поправить запрос.
  }
}

function onSearchFocus() {
  // Фокус после уже сделанного выбора — выделяем текст: первый же ввод
  // печатает новый запрос вместо «annimaLOVE…», а Enter возвращает прежнюю
  // линейку (выделение при Enter снимается браузером без правки запроса).
  if (selectedGroup.value) {
    void nextTick(() => searchInputRef.value?.select());
  }
  showGroupList.value = true;
}

function onSearchEscape(event: KeyboardEvent) {
  if (showGroupList.value) {
    // Headless UI Dialog ловит Escape на window и закрывает модалку —
    // первый Escape должен закрыть только список, отменяем событие.
    event.preventDefault();
    event.stopPropagation();
    showGroupList.value = false;
  }
}

function handleClickOutside(event: MouseEvent) {
  if (!showGroupList.value) return;
  if (searchBlockRef.value?.contains(event.target as Node)) return;
  // Набранный, но не выбранный запрос сохраняем (как и Escape): стирать
  // чужой ввод молчаливым кликом мимо поля — хуже, чем оставить его.
  showGroupList.value = false;
}

watch(groupSearchQuery, (query) => {
  // Каждая правка запроса начинается с чистой подсветки первой опции.
  activeIndex.value = 0;
  // Ручной ввод запроса отличает выбор от последующего редактирования поля.
  if (query !== (selectedGroup.value?.name ?? '')) {
    selectedGroupId.value = '';
    items.value = [];
  }
});

watch(
  () => props.isOpen,
  (open) => {
    document.removeEventListener('mousedown', handleClickOutside);
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      // Каждый запуск — с чистого листа: прошлые числа могли устареть.
      startNewCheck();
      location.value = props.initialLocation;
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  document.removeEventListener('mousedown', handleClickOutside);
});

const hasItems = computed(() => items.value.length > 0);

const totalExpected = computed(() =>
  items.value.reduce((sum, item) => sum + item.expected, 0),
);

/** Фактическая сумма по заполненным полям. */
const totalActual = computed(() =>
  items.value.reduce((sum, item) => {
    const value = parseActual(item.key);
    return value === null ? sum + item.expected : sum + value;
  }, 0),
);

/** Сумма расхождения только по заполненным полям. */
const diffTotal = computed(() =>
  items.value.reduce((sum, item) => {
    const value = parseActual(item.key);
    return value === null ? sum : sum + (value - item.expected);
  }, 0),
);

const summaryText = computed(() => {
  if (diffTotal.value > 0) return `расхождение +${diffTotal.value}`;
  if (diffTotal.value < 0) return `расхождение ${diffTotal.value}`;
  if (!filledCount.value) return 'ничего не введено';
  return 'расхождения нет';
});

const summaryChipClass = computed(() => {
  if (diffTotal.value > 0) return 'bg-emerald-50 text-emerald-900';
  if (diffTotal.value < 0) return 'bg-amber-50 text-amber-900';
  return 'bg-gray-100 text-gray-800';
});

const filledCount = computed(
  () => items.value.filter((item) => parseActual(item.key) !== null).length,
);

const canSave = computed(() => filledCount.value > 0 && !loading.value);

function inputId(item: Row) {
  return `inventory-input-${item.key}`;
}

function parseActual(key: string): number | null {
  const raw = actualValues[key];
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function itemDelta(item: Row): number | null {
  const value = parseActual(item.key);
  if (value === null) return null;
  return value - item.expected;
}

function diffChipClass(diff: number): string {
  if (diff > 0) return 'bg-emerald-100 text-emerald-800';
  if (diff < 0) return 'bg-amber-100 text-amber-800';
  return 'bg-gray-100 text-gray-600';
}

function diffLabel(diff: number): string {
  if (diff > 0) return `+${diff}`;
  if (diff < 0) return String(diff);
  return '=';
}

function sanitizeValue(item: Row) {
  const raw = actualValues[item.key];
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    actualValues[item.key] = null;
    return;
  }
  const parsed = Number(raw);
  // Отрицательные и дробные — не сохраняем, но и не выбрасываем ввод
  // целиком: прижимаем к 0, чтобы кассир видел, что поле не приняло число.
  actualValues[item.key] = String(Math.max(0, Number.isFinite(parsed) ? Math.trunc(parsed) : 0));
}

function resetToExpected() {
  for (const item of items.value) {
    actualValues[item.key] = String(item.expected);
  }
}

function switchLocation(next: 'retail' | 'warehouse') {
  if (location.value === next) return;
  location.value = next;
  if (selectedGroupId.value) {
    void reloadPreview();
  }
}

async function fetchPreview() {
  loadingPreview.value = true;
  loadingError.value = '';
  const fetchedGroupId = selectedGroupId.value;
  try {
    const response = await adminStore.fetchInventoryCheckPreview(
      fetchedGroupId,
      location.value,
    );
    // Пока грузилось, линейку могли сбросить (крестик) или сменить —
    // поздний ответ не должен возвращать в форму её вкусы.
    if (selectedGroupId.value !== fetchedGroupId) return;
    const rows: Row[] = response.items.map((item: InventoryCheckPreviewItem) => ({
      ...item,
      key: item.variant_id ? `${item.product_id}:${item.variant_id}` : item.product_id,
    }));
    items.value = rows;
    for (const row of rows) {
      // Подставляем числящийся остаток: кассир меняет только то, что
      // пересчитал и отличается. Пустое поле = «не трогаю» — поэтому
      // подстановка значения и есть «по умолчанию не менять ничего»:
      // если фактический равен числящемуся, правка ничего не меняет.
      actualValues[row.key] = String(row.expected);
    }
  } catch (error: any) {
    if (selectedGroupId.value !== fetchedGroupId) return;
    items.value = [];
    loadingError.value = error?.code === 'group_not_found'
      ? 'Линейка не найдена. Обновите список.'
      : 'Не удалось загрузить вкусы линейки. Попробуйте ещё раз.';
  } finally {
    if (selectedGroupId.value === fetchedGroupId) {
      loadingPreview.value = false;
    }
  }
}

async function reloadPreview() {
  await fetchPreview();
}

async function save() {
  if (!canSave.value || loading.value) return;
  loading.value = true;
  savingError.value = '';
  try {
    const payloadItems = items.value
      .map((item) => {
        const value = parseActual(item.key);
        if (value === null) return null;
        return {
          product_id: item.product_id,
          variant_id: item.variant_id,
          actual: value,
        };
      })
      .filter((item): item is { product_id: string; variant_id: string | null; actual: number } =>
        item !== null,
      );

    const saved = await adminStore.createInventoryCheck({
      group_id: selectedGroupId.value,
      location: location.value,
      items: payloadItems,
    });

    result.value = saved;
    emit('saved', saved);
  } catch (error: any) {
    savingError.value = error?.code === 'item_not_in_group'
      ? 'Состав линейки изменился: обновите список и введите числа заново.'
      : error?.code === 'invalid_quantity'
        ? 'Проверьте введённые числа: только целые от нуля.'
        : error?.message || 'Не удалось сохранить пересорт. Попробуйте ещё раз.';
  } finally {
    loading.value = false;
  }
}

function startNewCheck() {
  result.value = null;
  selectedGroupId.value = '';
  groupSearchQuery.value = '';
  showGroupList.value = true;
  activeIndex.value = 0;
  // Поздний ответ превью прошлой сессии не сбрасывает флаг сам (его
  // finally смотрит на уже сменённую линейку) — снимаем блокировку здесь.
  loadingPreview.value = false;
  items.value = [];
  for (const key of Object.keys(actualValues)) {
    delete actualValues[key];
  }
  savingError.value = '';
  loadingError.value = '';
  // Фокус сразу в поиск: следующий пересорт начинается с выбора линейки.
  void nextTick(() => searchInputRef.value?.focus());
}

watch(selectedGroupId, (groupId) => {
  if (!groupId) {
    items.value = [];
    loadingError.value = '';
    return;
  }
  void fetchPreview();
});
</script>