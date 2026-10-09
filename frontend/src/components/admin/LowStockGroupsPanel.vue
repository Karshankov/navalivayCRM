<template>
  <section
    v-if="isVisible && groups.length"
    class="rounded-xl border border-amber-200 bg-amber-50/70 p-4 sm:p-5 shadow-sm"
  >
    <header class="mb-3 flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h2 class="flex items-center gap-2 text-sm font-semibold text-amber-900 sm:text-base">
          <span
            class="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-white"
            aria-hidden="true"
          >!</span>
          Заканчивающиеся линейки
          <span class="text-xs font-medium text-amber-700">({{ groups.length }})</span>
        </h2>
        <p class="mt-1 text-xs text-amber-800/80">
          Сверху линейки, у которых остаток ещё есть, но уже ниже порога. Снизу те, что закончились полностью. Нажмите «Скрыть» рядом с карточкой, чтобы убрать линейку из плашки.
        </p>
      </div>
      <button
        type="button"
        class="flex-shrink-0 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 transition hover:bg-amber-100"
        @click="hidePanel"
      >
        ✕ Скрыть
      </button>
    </header>

    <!-- Две секции: «Заканчивается» сверху (важнее — успеваем дозаказать),
         «Закончилось» снизу (красные тайлы). По фидбэку Кости 08.05.2026:
         оранжевый и красный сливались в одной плашке, разделение и явные
         подзаголовки решают эту проблему. -->
    <div v-if="endingVisible.length" class="mb-4">
      <div class="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-orange-700">
        <span class="h-2 w-2 rounded-full bg-orange-500" aria-hidden="true"></span>
        Заканчивается
        <span class="text-orange-500/80">({{ endingGroups.length }})</span>
      </div>
      <div
        v-for="bucket in endingByCategory"
        :key="bucket.name"
        class="mb-3 last:mb-0"
      >
        <h4 class="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-orange-900/60">
          {{ bucket.name }}
          <span class="ml-1 text-orange-900/40">({{ bucket.items.length }})</span>
        </h4>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <article
            v-for="group in bucket.items"
            :key="group.id"
            :data-low-stock-group-id="group.id"
            class="flex gap-3 rounded-lg border border-orange-200 bg-white p-3 shadow-sm"
          >
            <LowStockGroupTile
              :group="group"
              :cover-image="coverImages[group.id]"
              :busy="busyGroupId === group.id"
              :menu-open="openMenuId === group.id"
              :reasons="reasonsList"
              severity="ending"
              @show-flavors="openFlavors(group)"
              @toggle-menu="toggleMenu(group.id)"
              @pause="(reason) => onPause(group.id, reason)"
            />
          </article>
        </div>
      </div>
    </div>

    <div v-if="endedVisible.length">
      <div class="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-red-700">
        <span class="h-2 w-2 rounded-full bg-red-500" aria-hidden="true"></span>
        Нет в наличии
        <span class="text-red-500/80">({{ endedGroups.length }})</span>
      </div>
      <div
        v-for="bucket in endedByCategory"
        :key="bucket.name"
        class="mb-3 last:mb-0"
      >
        <h4 class="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-red-900/60">
          {{ bucket.name }}
          <span class="ml-1 text-red-900/40">({{ bucket.items.length }})</span>
        </h4>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <article
            v-for="group in bucket.items"
            :key="group.id"
            :data-low-stock-group-id="group.id"
            class="flex gap-3 rounded-lg border border-red-200 bg-red-50/40 p-3 shadow-sm"
          >
            <LowStockGroupTile
              :group="group"
              :cover-image="coverImages[group.id]"
              :busy="busyGroupId === group.id"
              :menu-open="openMenuId === group.id"
              :reasons="reasonsList"
              severity="ended"
              @show-flavors="openFlavors(group)"
              @toggle-menu="toggleMenu(group.id)"
              @pause="(reason) => onPause(group.id, reason)"
            />
          </article>
        </div>
      </div>
    </div>

    <button
      v-if="canExpand"
      type="button"
      class="mt-3 inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 transition hover:bg-amber-100"
      @click="expanded = !expanded"
    >
      <template v-if="expanded">Свернуть</template>
      <template v-else>Показать ещё ({{ groups.length - INITIAL_VISIBLE_COUNT }})</template>
    </button>

    <LowStockFlavorsModal
      :is-open="selectedFlavorGroup !== null"
      :group-name="selectedFlavorGroup?.name ?? ''"
      :items="flavorItems"
      :loading="flavorsLoading"
      :error-text="flavorsError"
      @close="closeFlavors"
      @retry="retryFlavors"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, reactive, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import {
  useCrmStore,
  type LowStockFlavor,
  type LowStockGroup,
  type LowStockPauseReason,
  type LowStockPauseConfig,
} from "@/stores/crm";
import LowStockGroupTile from "@/components/admin/LowStockGroupTile.vue";
import LowStockFlavorsModal from "@/components/admin/LowStockFlavorsModal.vue";

const INITIAL_VISIBLE_COUNT = 3;

// Дефолтный набор причин на случай, если ответ ещё не пришёл —
// dropdown не должен моргать пустым (фикс race-condition при быстром
// клике до завершения первого fetch).
const DEFAULT_REASONS: Record<LowStockPauseReason, LowStockPauseConfig> = {
  short: { label: "Скрыть на 3 дня", days: 3 },
  no_supply: { label: "Скрыть на 5 дней", days: 5 },
  not_produced: { label: "Скрыть на 20 дней", days: 20 },
};

const crmStore = useCrmStore();
const { lowStockGroups, lowStockReasons, lowStockCount } = storeToRefs(crmStore);

// Локальный флаг скрытия панели на текущую сессию (просьба заказчика —
// без сохранения в БД, только до перезагрузки страницы).
const hiddenForSession = ref(false);
const expanded = ref(false);
const openMenuId = ref<string | null>(null);
const busyGroupId = ref<string | null>(null);
const error = ref<string | null>(null);
const selectedFlavorGroup = ref<LowStockGroup | null>(null);
const flavorItems = ref<LowStockFlavor[]>([]);
const flavorsLoading = ref(false);
const flavorsError = ref<string | null>(null);
let flavorsRequestId = 0;

// Лениво подгружаемые cover-images (server не шлёт base64 в основном payload —
// см. selectGroupStockAggregates в server/utils/low-stock-groups.js).
const coverImages = reactive<Record<string, string>>({});
const coverFetchInFlight = new Set<string>();

const groups = computed(() => lowStockGroups.value);
const isVisible = computed(() => !hiddenForSession.value && groups.value.length > 0);

const visibleGroups = computed(() => {
  if (expanded.value) return groups.value;
  return groups.value.slice(0, INITIAL_VISIBLE_COUNT);
});

const canExpand = computed(() => groups.value.length > INITIAL_VISIBLE_COUNT);

// Разделение на 2 секции по фидбэку Кости (08.05.2026):
// «заканчивается» (totalStock > 0) — сверху, важнее реагировать;
// «закончилось» (totalStock === 0) — снизу. Бэк уже сортирует
// в этом порядке, так что endingGroups идут в начале groups[].
const endingGroups = computed(() => groups.value.filter((g) => g.totalStock > 0));
const endedGroups = computed(() => groups.value.filter((g) => g.totalStock === 0));
const endingVisible = computed(() =>
  visibleGroups.value.filter((g) => g.totalStock > 0),
);
const endedVisible = computed(() =>
  visibleGroups.value.filter((g) => g.totalStock === 0),
);

/**
 * Группировка по категориям внутри каждой секции (Костя 10.05.2026:
 * «снюс жидкости жидкости снюс — это всё так разбросано, трудно
 * уловить»). Порядок категорий — как они впервые встречаются в массиве,
 * который уже отсортирован бэком; внутри категории сохраняется тот
 * же порядок.
 */
function groupByCategory(list: typeof groups.value) {
  const buckets = new Map<string, typeof list>();
  for (const g of list) {
    const key = g.categoryName || "Без категории";
    const existing = buckets.get(key);
    if (existing) {
      existing.push(g);
    } else {
      buckets.set(key, [g]);
    }
  }
  return Array.from(buckets, ([name, items]) => ({ name, items }));
}

const endingByCategory = computed(() => groupByCategory(endingVisible.value));
const endedByCategory = computed(() => groupByCategory(endedVisible.value));

const reasonsList = computed(() => {
  const fromServer = lowStockReasons.value;
  return fromServer && Object.keys(fromServer).length > 0 ? fromServer : DEFAULT_REASONS;
});

function hidePanel() {
  hiddenForSession.value = true;
  openMenuId.value = null;
}

function toggleMenu(groupId: string) {
  openMenuId.value = openMenuId.value === groupId ? null : groupId;
}

async function openFlavors(group: LowStockGroup) {
  const requestId = ++flavorsRequestId;
  openMenuId.value = null;
  selectedFlavorGroup.value = group;
  flavorItems.value = [];
  flavorsError.value = null;
  flavorsLoading.value = true;
  try {
    const items = await crmStore.fetchLowStockGroupFlavors(group.id);
    if (requestId === flavorsRequestId) flavorItems.value = items;
  } catch (err) {
    if (requestId === flavorsRequestId) {
      flavorsError.value = "Не удалось загрузить остатки.";
      console.error("[LowStockGroupsPanel] flavors fetch failed:", err);
    }
  } finally {
    if (requestId === flavorsRequestId) flavorsLoading.value = false;
  }
}

function closeFlavors() {
  flavorsRequestId += 1;
  selectedFlavorGroup.value = null;
  flavorItems.value = [];
  flavorsLoading.value = false;
  flavorsError.value = null;
}

function retryFlavors() {
  if (selectedFlavorGroup.value) void openFlavors(selectedFlavorGroup.value);
}

async function onPause(groupId: string, reason: LowStockPauseReason) {
  openMenuId.value = null;
  busyGroupId.value = groupId;
  error.value = null;
  try {
    await crmStore.pauseLowStockGroup(groupId, reason);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    console.error("[LowStockGroupsPanel] pause failed:", err);
  } finally {
    busyGroupId.value = null;
  }
}

function initialsFor(name: string): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join("") || "?";
}

async function loadCoverImage(groupId: string) {
  if (!groupId || coverImages[groupId] || coverFetchInFlight.has(groupId)) return;
  coverFetchInFlight.add(groupId);
  try {
    const response = await fetch(
      `/api/admin/category-groups/${encodeURIComponent(groupId)}/image`,
      { credentials: "include" },
    );
    if (!response.ok) return;
    const data = (await response.json()) as { cover_image?: string | null };
    if (data?.cover_image) {
      coverImages[groupId] = data.cover_image;
    }
  } catch (err) {
    // Лениво — не критично. Покажем initials.
    console.warn("[LowStockGroupsPanel] failed to load cover for", groupId, err);
  } finally {
    coverFetchInFlight.delete(groupId);
  }
}

// Watcher: для каждой видимой группы с has_cover_image грузим картинку лениво.
watch(
  visibleGroups,
  (list) => {
    for (const group of list) {
      if (group.hasCoverImage) {
        loadCoverImage(group.id);
      }
    }
  },
  { immediate: true, flush: "post" },
);

// Watcher: очистка coverImages-кеша от групп, которых больше нет в плашке.
// Без этого base64-обложки накапливаются на странице с долгой жизнью
// (CRM-менеджер может работать часами, через цикл pause→resume в кеше
// останутся «мёртвые» строки).
watch(groups, (list) => {
  const liveIds = new Set(list.map((g) => g.id));
  for (const id of Object.keys(coverImages)) {
    if (!liveIds.has(id)) {
      delete coverImages[id];
    }
  }
});

// Watcher: если summary показывает другое число, чем у нас в локальном списке —
// данные у другого менеджера разошлись с нашими, перезапросим полный список.
// Триггерится polling'ом каждые 15 сек через crmStore.fetchLowStockSummary.
watch(lowStockCount, (newCount) => {
  if (newCount !== groups.value.length) {
    crmStore.fetchLowStockGroups().catch((err) => {
      console.warn("[LowStockGroupsPanel] background refresh failed:", err);
    });
  }
});

// Закрываем меню при клике вне карточки. Используем data-low-stock-group-id
// на article — клик внутри карточки ИМЕННО с открытым меню оставляет открытым,
// клик в любую другую карточку или вне любых карточек закрывает.
function handleDocumentClick(event: MouseEvent) {
  if (!openMenuId.value) return;
  const target = event.target as HTMLElement | null;
  if (!target) return;
  const card = target.closest<HTMLElement>("[data-low-stock-group-id]");
  if (card?.dataset.lowStockGroupId === openMenuId.value) return;
  openMenuId.value = null;
}

onMounted(async () => {
  document.addEventListener("click", handleDocumentClick);
  try {
    await crmStore.fetchLowStockGroups();
  } catch (err) {
    console.warn("[LowStockGroupsPanel] initial fetch failed:", err);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener("click", handleDocumentClick);
});
</script>
