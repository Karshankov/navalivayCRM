<template>
  <section
    v-if="isVisible && groups.length"
    class="rounded-xl border border-rose-200 bg-rose-50/70 p-3.5 shadow-sm sm:p-4"
  >
    <header class="mb-3 flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h2 class="flex items-center gap-2 text-sm font-semibold text-rose-900">
          <span
            class="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white"
            aria-hidden="true"
          >!</span>
          Нужно дозаполнить
          <span class="text-xs font-medium text-rose-700">({{ groups.length }})</span>
        </h2>
        <p class="mt-0.5 text-xs text-rose-800/80">
          Линейки с товарами, где не указаны описание, минимальный остаток или оптовые цены.
          Поставьте «не требуется», если поле для этой линейки не нужно.
        </p>
      </div>
      <button
        type="button"
        class="flex-shrink-0 rounded-md border border-rose-300 bg-white px-2.5 py-1 text-xs font-medium text-rose-800 transition hover:bg-rose-100"
        @click="hidePanel"
      >
        ✕ Скрыть
      </button>
    </header>

    <div
      v-for="bucket in groupsByCategory"
      :key="bucket.name"
      class="mb-3 last:mb-0"
    >
      <h4 class="mb-2 text-[11px] font-semibold uppercase tracking-wide text-rose-900/60">
        {{ bucket.name }}
        <span class="ml-1 text-rose-900/40">({{ bucket.items.length }})</span>
      </h4>

      <div class="grid grid-cols-1 gap-2.5 md:grid-cols-2">
        <article
          v-for="group in bucket.items"
          :key="group.id"
          class="flex flex-col rounded-lg border border-rose-200 bg-white shadow-sm"
        >
          <div class="flex items-start gap-2.5 p-2.5">
            <div class="flex-shrink-0">
              <div
                v-if="group.hasCoverImage && coverImages[group.id]"
                class="h-12 w-12 overflow-hidden rounded-md bg-gray-100"
              >
                <img
                  :src="coverImages[group.id]"
                  :alt="group.name"
                  class="h-full w-full object-cover"
                  loading="lazy"
                />
              </div>
              <div
                v-else
                class="flex h-12 w-12 items-center justify-center rounded-md bg-rose-100 text-[11px] font-semibold uppercase text-rose-700"
              >
                {{ initials(group.name) }}
              </div>
            </div>

            <div class="min-w-0 flex-1">
              <div class="flex items-start justify-between gap-2">
                <h3
                  class="min-w-0 flex-1 text-sm font-semibold leading-snug text-gray-900 line-clamp-2"
                  :title="group.name"
                >
                  {{ group.name }}
                </h3>
                <button
                  type="button"
                  class="flex-shrink-0 inline-flex items-center gap-0.5 rounded-md border border-rose-200 bg-rose-50/80 px-2 py-1 text-[11px] font-medium text-rose-800 transition hover:border-rose-300 hover:bg-rose-100 focus:outline-none focus:ring-2 focus:ring-rose-300/40"
                  @click="openGroup(group)"
                >
                  Открыть
                  <svg class="h-3 w-3 text-rose-600/80" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path d="M4.5 2.5 8 6l-3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </button>
              </div>

              <div class="mt-1.5 flex flex-wrap gap-1">
                <span
                  v-if="(group.productCount ?? 0) === 0"
                  class="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800"
                  title="У линейки нет товаров, привязанных напрямую"
                >
                  0 товаров
                </span>
                <span
                  v-for="chip in missingChips(group)"
                  :key="chip"
                  class="inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-medium text-rose-800"
                >
                  {{ chip }}
                </span>
              </div>
            </div>
          </div>

          <div
            v-if="hasWaiverOptions(group)"
            class="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-rose-100 px-2.5 py-2"
          >
            <label
              v-if="group.missingFields.includes('description') || group.waivers.description"
              class="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-gray-700"
            >
              <input
                type="checkbox"
                class="rounded border-gray-300 text-brand-dark focus:ring-brand-dark/30"
                :checked="group.waivers.description"
                :disabled="busyGroupId === group.id"
                @change="onWaiverToggle(group, 'description', ($event.target as HTMLInputElement).checked)"
              />
              <span>Описание не требуется</span>
            </label>
            <label
              v-if="group.missingFields.includes('min_stock') || group.waivers.min_stock"
              class="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-gray-700"
            >
              <input
                type="checkbox"
                class="rounded border-gray-300 text-brand-dark focus:ring-brand-dark/30"
                :checked="group.waivers.min_stock"
                :disabled="busyGroupId === group.id"
                @change="onWaiverToggle(group, 'min_stock', ($event.target as HTMLInputElement).checked)"
              />
              <span>Мин. остаток не требуется</span>
            </label>
            <label
              v-if="group.missingFields.includes('wholesale') || group.waivers.wholesale"
              class="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-gray-700"
            >
              <input
                type="checkbox"
                class="rounded border-gray-300 text-brand-dark focus:ring-brand-dark/30"
                :checked="group.waivers.wholesale"
                :disabled="busyGroupId === group.id"
                @change="onWaiverToggle(group, 'wholesale', ($event.target as HTMLInputElement).checked)"
              />
              <span>Оптовые цены не требуются</span>
            </label>
            <label
              v-if="group.missingFields.includes('strength_tier') || group.waivers.strength_tier"
              class="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-gray-700"
            >
              <input
                type="checkbox"
                class="rounded border-gray-300 text-brand-dark focus:ring-brand-dark/30"
                :checked="group.waivers.strength_tier"
                :disabled="busyGroupId === group.id"
                @change="onWaiverToggle(group, 'strength_tier', ($event.target as HTMLInputElement).checked)"
              />
              <span>Крепость не требуется</span>
            </label>
            <span
              v-if="busyGroupId === group.id"
              class="text-[11px] text-rose-600"
            >Сохраняем…</span>
          </div>
        </article>
      </div>
    </div>

    <button
      v-if="canExpand"
      type="button"
      class="mt-2.5 inline-flex items-center gap-1 rounded-md border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-800 transition hover:bg-rose-100"
      @click="expanded = !expanded"
    >
      <template v-if="expanded">Свернуть</template>
      <template v-else>Показать ещё ({{ groups.length - INITIAL_VISIBLE_COUNT }})</template>
    </button>

    <p v-if="error" class="mt-2 text-xs text-red-600">{{ error }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { useAdminStore, type IncompleteGroupItem } from "@/stores/admin";

const INITIAL_VISIBLE_COUNT = 4;

const emit = defineEmits<{
  (e: "open-group", payload: { categoryId: string; groupId: string }): void;
}>();

const adminStore = useAdminStore();
const { incompleteGroups } = storeToRefs(adminStore);

const hiddenForSession = ref(false);
const expanded = ref(false);
const busyGroupId = ref<string | null>(null);
const error = ref<string | null>(null);
const coverImages = reactive<Record<string, string>>({});
const coverFetchInFlight = new Set<string>();

const groups = computed(() => incompleteGroups.value);
const isVisible = computed(() => !hiddenForSession.value && groups.value.length > 0);

const visibleGroups = computed(() => {
  if (expanded.value) return groups.value;
  return groups.value.slice(0, INITIAL_VISIBLE_COUNT);
});

const canExpand = computed(() => groups.value.length > INITIAL_VISIBLE_COUNT);

const groupsByCategory = computed(() => {
  const buckets: Array<{ name: string; items: IncompleteGroupItem[] }> = [];
  const map = new Map<string, IncompleteGroupItem[]>();
  for (const group of visibleGroups.value) {
    const key = group.categoryName || "Без категории";
    const list = map.get(key) || [];
    list.push(group);
    map.set(key, list);
  }
  for (const [name, items] of map) {
    buckets.push({ name, items });
  }
  return buckets;
});

function initials(name: string) {
  return (name || "?").trim().slice(0, 2).toUpperCase();
}

function missingChips(group: IncompleteGroupItem) {
  const chips: string[] = [];
  if (group.missingFields.includes("description")) chips.push("Нет описания");
  if (group.missingFields.includes("strength_tier")) chips.push("Нет крепости");
  if (group.missingFields.includes("min_stock")) chips.push("Нет порога остатка");
  if (group.missingFields.includes("wholesale")) {
    const total = group.wholesaleTotalCount || 0;
    const filled = group.wholesaleFilledCount || 0;
    chips.push(total > 0 ? `Опт ${filled}/${total}` : "Нет опта");
  }
  return chips;
}

function hasWaiverOptions(group: IncompleteGroupItem) {
  return (
    group.missingFields.includes("description")
    || group.missingFields.includes("min_stock")
    || group.missingFields.includes("wholesale")
    || group.waivers.description
    || group.waivers.min_stock
    || group.waivers.wholesale
    || group.waivers.strength_tier
  );
}

function openGroup(group: IncompleteGroupItem) {
  emit("open-group", { categoryId: group.categoryId, groupId: group.id });
}

function hidePanel() {
  hiddenForSession.value = true;
}

async function loadCoverImage(groupId: string) {
  if (coverImages[groupId] || coverFetchInFlight.has(groupId)) return;
  coverFetchInFlight.add(groupId);
  try {
    const image = await adminStore.fetchCategoryGroupImage(groupId);
    if (image) coverImages[groupId] = image;
  } catch {
    // ignore
  } finally {
    coverFetchInFlight.delete(groupId);
  }
}

watch(
  groups,
  (list) => {
    list.forEach((group) => {
      if (group.hasCoverImage) {
        void loadCoverImage(group.id);
      }
    });
  },
  { immediate: true },
);

async function onWaiverToggle(
  group: IncompleteGroupItem,
  field: "description" | "min_stock" | "wholesale" | "strength_tier",
  checked: boolean,
) {
  busyGroupId.value = group.id;
  error.value = null;
  try {
    await adminStore.updateGroupCompletenessWaivers(group.id, {
      waiveDescription: field === "description" ? checked : group.waivers.description,
      waiveMinStock: field === "min_stock" ? checked : group.waivers.min_stock,
      waiveWholesale: field === "wholesale" ? checked : group.waivers.wholesale,
      waiveStrengthTier: field === "strength_tier" ? checked : group.waivers.strength_tier,
    });
    await adminStore.fetchIncompleteGroups();
    await adminStore.fetchIncompleteGroupsSummary();
  } catch (err: any) {
    error.value = err?.message || "Не удалось сохранить настройку";
  } finally {
    busyGroupId.value = null;
  }
}

onMounted(() => {
  void adminStore.fetchIncompleteGroups();
});
</script>