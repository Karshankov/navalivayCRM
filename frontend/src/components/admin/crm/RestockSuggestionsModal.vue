<template>
  <!--
    Список «заканчивается в рознице, есть на складе».
    Родитель закрывает это окно ПЕРЕД открытием формы перемещения: две
    HeadlessUI-модалки рядом конфликтуют ловушками фокуса.
  -->
  <AdminModal
    :isOpen="isOpen"
    title="Заканчивается в рознице"
    :description="descriptionText"
    size="2xl"
    :showActions="false"
    @close="emit('close')"
    @cancel="emit('close')"
  >
    <div class="space-y-4" data-test="restock-modal">
      <div
        v-if="loading && !hasItems"
        class="py-10 text-center text-sm text-gray-500"
        role="status"
        aria-live="polite"
      >
        Считаем остатки…
      </div>

      <div
        v-else-if="errorText && !hasItems"
        class="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between"
        role="alert"
      >
        <span>{{ errorText }}</span>
        <button
          type="button"
          class="inline-flex min-h-10 items-center justify-center rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-50"
          data-test="restock-retry"
          @click="emit('retry')"
        >
          Повторить
        </button>
      </div>

      <div
        v-else-if="!hasItems"
        class="rounded-2xl border border-dashed border-gray-200 px-5 py-10 text-center"
        data-test="restock-empty"
      >
        <p class="font-medium text-gray-900">Пополнять нечего</p>
        <p class="mt-1 text-sm text-gray-500">
          В рознице нет позиций с остатком {{ retailLabel }}, у которых есть запас на складе.
        </p>
      </div>

      <template v-else>
        <!-- Список уже есть, но обновление не удалось: старые строки полезнее
             пустого экрана, поэтому показываем их и предлагаем повторить. -->
        <p
          v-if="errorText"
          class="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between"
          role="alert"
        >
          <span>Не удалось обновить остатки — показаны прошлые данные.</span>
          <button
            type="button"
            class="inline-flex min-h-10 items-center justify-center rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-900 transition hover:bg-amber-100"
            data-test="restock-retry"
            @click="emit('retry')"
          >
            Повторить
          </button>
        </p>

        <p v-if="totals.draftItemCount > 0" class="rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-900" role="status">
          {{ positionsLabel(totals.draftItemCount) }} уже в заявке на перемещение — их нужно оприходовать, а не заводить заново.
        </p>

        <section
          v-for="group in groups"
          :key="group.id || 'ungrouped'"
          class="min-w-0 rounded-2xl border border-gray-200"
          data-test="restock-group"
        >
          <header class="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-100 px-4 py-3">
            <div class="min-w-0">
              <h3 class="truncate text-sm font-semibold text-gray-900" :title="group.name">{{ group.name }}</h3>
              <p v-if="group.categoryName" class="truncate text-xs text-gray-500" :title="group.categoryName">{{ group.categoryName }}</p>
            </div>
            <span class="text-xs font-semibold text-gray-500">{{ positionsLabel(group.itemCount) }}</span>
          </header>

          <ul class="divide-y divide-gray-100">
            <li
              v-for="item in group.items"
              :key="item.key"
              class="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              :data-test="`restock-item-${item.key}`"
            >
              <div class="min-w-0">
                <p class="break-words text-sm font-medium text-gray-900">{{ item.displayName }}</p>
                <p v-if="item.variantName && item.productTitle !== item.displayName" class="text-xs text-gray-500">
                  {{ item.productTitle }}
                </p>
              </div>

              <div class="flex flex-wrap items-center gap-1.5">
                <span
                  class="rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums"
                  :class="item.retailStock === 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'"
                  :title="`В рознице: ${item.retailStock} шт`"
                >
                  розница {{ item.retailStock }}
                </span>
                <span
                  class="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold tabular-nums text-blue-700"
                  :title="`На складе: ${item.warehouseStock} шт`"
                >
                  склад {{ item.warehouseStock }}
                </span>

                <span
                  v-if="item.draftTransferId"
                  class="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-800"
                  :title="`Позиция уже в черновике перемещения №${item.draftTransferNumber}`"
                  data-test="restock-draft-chip"
                >
                  в заявке №{{ item.draftTransferNumber }}
                </span>

                <template v-else>
                  <label class="sr-only" :for="inputId(item)">Сколько переместить: {{ item.displayName }}</label>
                  <span class="relative inline-flex items-center">
                    <input
                      :id="inputId(item)"
                      v-model.number="quantities[item.key]"
                      type="number"
                      inputmode="numeric"
                      min="0"
                      step="1"
                      :max="item.warehouseStock"
                      class="w-24 rounded-lg border border-gray-300 py-1.5 pl-2 pr-7 text-sm tabular-nums focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      data-test="restock-qty"
                      @change="clampQuantity(item)"
                      @blur="clampQuantity(item)"
                    />
                    <span class="pointer-events-none absolute right-2 text-xs text-gray-400" aria-hidden="true">шт</span>
                  </span>
                  <button
                    type="button"
                    class="rounded-lg px-2 py-1 text-xs font-semibold text-blue-700 transition hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    :title="`Переместить весь складской остаток: ${item.warehouseStock} шт`"
                    :aria-label="`Переместить весь складской остаток: ${item.displayName}, ${item.warehouseStock} шт`"
                    data-test="restock-max"
                    @click="setMaxQuantity(item)"
                  >
                    макс
                  </button>
                </template>
              </div>
            </li>
          </ul>
        </section>
      </template>
    </div>

    <template #footer>
      <div class="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          class="inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-200"
          data-test="restock-open-transfers"
          @click="emit('open-transfers')"
        >
          Все перемещения
        </button>
        <div class="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
          <button
            type="button"
            class="inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-300 px-5 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-200"
            data-test="restock-close"
            @click="emit('close')"
          >
            Закрыть
          </button>
          <button
            type="button"
            class="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-300"
            :disabled="!canSubmit"
            data-test="restock-submit"
            @click="submit"
          >
            {{ submitLabel }}
          </button>
        </div>
      </div>
      <p class="mt-2 text-xs text-gray-500">
        Остатки не изменятся, пока заявку не оприходуют. Количество 0 — позицию не перемещаем.
      </p>

      <div class="mt-3 border-t border-gray-200 pt-3">
        <div class="flex flex-wrap items-center gap-3">
          <label
            class="text-xs font-medium text-gray-600"
            for="restock-min-variants"
          >
            Показывать значок, если позиций не меньше
          </label>
          <input
            id="restock-min-variants"
            v-model.number="minVariantsInput"
            type="number"
            min="0"
            :max="MIN_VARIANTS_LIMIT"
            step="1"
            inputmode="numeric"
            class="h-9 w-20 rounded-lg border border-gray-300 px-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-200"
            :disabled="settingsSaving"
            data-test="restock-min-variants"
            @change="commitMinVariants"
            @blur="commitMinVariants"
            @keyup.enter="commitMinVariants"
          />
          <span v-if="settingsSaving" class="text-xs text-gray-500">Сохраняем…</span>
        </div>
        <p
          class="mt-1 text-xs"
          :class="settingsError ? 'text-red-600' : 'text-gray-500'"
          data-test="restock-min-variants-hint"
        >
          {{ minVariantsHint }}
        </p>
      </div>
    </template>
  </AdminModal>
</template>

<script lang="ts">
/** Позиция, которую менеджер выбрал к перемещению со склада в розницу. */
export type RestockTransferRequestItem = {
  productId: string;
  variantId: string | null;
  displayName: string;
  groupName: string;
  categoryName: string | null;
  warehouseStock: number;
  quantity: number;
};
</script>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import AdminModal from "@/components/AdminModal.vue";
import type {
  RestockCandidateGroup,
  RestockCandidateItem,
  RestockCandidatesTotals,
} from "@/stores/crm";

const props = withDefaults(
  defineProps<{
    isOpen: boolean;
    groups: RestockCandidateGroup[];
    totals: RestockCandidatesTotals;
    threshold?: number;
    /** Порог показа значка: минимум позиций, при котором он загорается. */
    minVariants?: number;
    settingsSaving?: boolean;
    settingsError?: string | null;
    loading?: boolean;
    errorText?: string | null;
  }>(),
  {
    threshold: 0,
    minVariants: 0,
    settingsSaving: false,
    settingsError: null,
    loading: false,
    errorText: null,
  },
);

const emit = defineEmits<{
  (event: "close"): void;
  (event: "retry"): void;
  (event: "transfer", payload: { items: RestockTransferRequestItem[] }): void;
  (event: "open-transfers"): void;
  (event: "update-min-variants", value: number): void;
}>();

/** Сколько переместить по каждой позиции. Сбрасывается при открытии окна. */
const quantities = ref<Record<string, number>>({});

const hasItems = computed(() => props.groups.some((group) => group.items.length > 0));

function plural(count: number, one: string, few: string, many: string) {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${count} ${many}`;
  if (mod10 === 1) return `${count} ${one}`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} ${few}`;
  return `${count} ${many}`;
}

function positionsLabel(count: number) {
  return plural(count, "позиция", "позиции", "позиций");
}

function groupsLabel(count: number) {
  return plural(count, "линейка", "линейки", "линеек");
}

/**
 * Порог 0 — это «в рознице пусто». Диапазон «0–0 шт» читался бы как опечатка,
 * поэтому при нулевом пороге пишем просто «0 шт».
 */
const retailLabel = computed(() =>
  props.threshold > 0 ? `0–${props.threshold} шт` : "0 шт",
);

const descriptionText = computed(() => {
  if (props.loading) return "Считаем остатки в рознице и на складе.";
  if (props.errorText) return "Не удалось получить остатки.";
  if (!props.totals.itemCount) return "В рознице всё в порядке — пополнять нечего.";
  return `${positionsLabel(props.totals.itemCount)} в ${groupsLabel(props.totals.groupCount)}: в рознице ${retailLabel.value}, на складе есть запас.`;
});

/** Черновик поля порога: показываем значение с бэка, пока его не правят. */
const minVariantsInput = ref<number>(props.minVariants);
/**
 * Последнее отправленное значение. Браузер шлёт `change` перед `blur`, поэтому
 * без этой памяти один и тот же порог улетал бы на сервер дважды.
 */
const lastCommittedMinVariants = ref<number>(Number(props.minVariants ?? 0));

watch(
  () => props.minVariants,
  (value) => {
    const normalized = Number(value ?? 0);
    minVariantsInput.value = normalized;
    lastCommittedMinVariants.value = normalized;
  },
);

const MIN_VARIANTS_LIMIT = 999;

function clampMinVariants(value: unknown) {
  const numeric = Number(value);
  const integer = Number.isFinite(numeric) ? Math.floor(numeric) : 0;
  return Math.min(Math.max(integer, 0), MIN_VARIANTS_LIMIT);
}

/**
 * Сохраняем по уходу из поля и по Enter: щёлкать отдельную кнопку «сохранить»
 * ради одного числа — лишний шаг. Значение не менялось — запроса нет.
 */
function commitMinVariants() {
  const value = clampMinVariants(minVariantsInput.value);
  minVariantsInput.value = value;
  if (value === lastCommittedMinVariants.value) return;
  lastCommittedMinVariants.value = value;
  emit("update-min-variants", value);
}

/** Подсказка под полем: объясняет, что настраивается и что сейчас происходит. */
const minVariantsHint = computed(() => {
  if (props.settingsError) return props.settingsError;
  const limit = Number(props.minVariants ?? 0);
  const current = props.totals.itemCount;
  if (limit <= 0) {
    return "0 — показывать значок при любой непустой рознице.";
  }
  if (current === 0) {
    return `Значок появится, когда накопится ${positionsLabel(limit)}.`;
  }
  if (current >= limit) {
    return `Сейчас ${positionsLabel(current)} — порог достигнут, значок виден.`;
  }
  return `Сейчас ${positionsLabel(current)} из ${positionsLabel(limit)} — значок пока скрыт.`;
});

function clampValue(value: unknown, item: RestockCandidateItem) {
  const numeric = Number(value);
  const integer = Number.isFinite(numeric) ? Math.floor(numeric) : 0;
  return Math.min(Math.max(integer, 0), Math.max(item.warehouseStock, 0));
}

function initQuantities() {
  const next: Record<string, number> = {};
  for (const group of props.groups) {
    for (const item of group.items) {
      if (item.draftTransferId) continue;
      const previous = quantities.value[item.key];
      // Уже введённое количество сохраняем: список могут перечитать, пока окно
      // открыто, и терять ввод менеджера нельзя.
      next[item.key] = previous === undefined ? 1 : clampValue(previous, item);
    }
  }
  quantities.value = next;
}

watch(
  () => props.isOpen,
  (open) => {
    if (open) initQuantities();
    // На закрытии ввод НЕ сбрасываем: окно закрывается в том числе на время
    // формы перемещения, и при возврате менеджер должен увидеть свои числа.
    // Уже неактуальные ключи отбрасывает initQuantities при следующем открытии.
  },
  { immediate: true },
);

watch(
  () => props.groups,
  () => {
    if (props.isOpen) initQuantities();
  },
);

function clampQuantity(item: RestockCandidateItem) {
  quantities.value[item.key] = clampValue(quantities.value[item.key], item);
}

function setMaxQuantity(item: RestockCandidateItem) {
  quantities.value[item.key] = Math.max(item.warehouseStock, 0);
}

function inputId(item: RestockCandidateItem) {
  return `restock-qty-${item.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

const selectedItems = computed(() => {
  const items: Array<RestockCandidateItem & { quantity: number }> = [];
  for (const group of props.groups) {
    for (const item of group.items) {
      if (item.draftTransferId) continue;
      const quantity = clampValue(quantities.value[item.key], item);
      if (quantity > 0) items.push({ ...item, quantity });
    }
  }
  return items;
});

const selectedCount = computed(() => selectedItems.value.length);

const selectedQuantity = computed(() =>
  selectedItems.value.reduce((sum, item) => sum + item.quantity, 0),
);

const canSubmit = computed(
  () => !props.loading && !props.errorText && selectedCount.value > 0,
);

const submitLabel = computed(() => {
  // Пустая кнопка «Создать» с disabled не объясняет, чего не хватает.
  if (selectedCount.value === 0) return "Выберите позиции";
  if (!canSubmit.value) return "Создать заявку";
  return `Создать заявку · ${selectedCount.value} поз. · ${selectedQuantity.value} шт`;
});

function submit() {
  if (!canSubmit.value) return;
  emit("transfer", {
    items: selectedItems.value.map((item) => ({
      productId: item.productId,
      variantId: item.variantId,
      displayName: item.displayName,
      groupName: item.groupName,
      categoryName: item.categoryName,
      warehouseStock: item.warehouseStock,
      quantity: item.quantity,
    })),
  });
}
</script>