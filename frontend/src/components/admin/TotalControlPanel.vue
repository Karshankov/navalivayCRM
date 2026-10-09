<template>
  <section
    ref="panelRef"
    class="rounded-xl border border-blue-100 bg-white p-4 shadow-sm"
    :aria-busy="loading"
  >
    <header class="mb-3">
      <h2 class="text-lg font-bold text-gray-900">Тотальный контроль</h2>
      <p class="mt-0.5 text-xs leading-4 text-gray-500">
        Остатки выбранных линеек. Сначала показаны позиции, которые заканчиваются быстрее всего.
      </p>
    </header>

    <div
      v-if="loading && !groups.length"
      class="flex flex-wrap gap-3"
      role="status"
      aria-label="Загрузка сводки тотального контроля"
    >
      <div v-for="index in 2" :key="index" class="h-48 w-full animate-pulse rounded-xl bg-gray-100 sm:w-[27.5rem]"></div>
    </div>

    <div
      v-if="errorText"
      class="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-red-50 p-3 text-sm text-red-700"
      :class="groups.length ? 'mb-3' : ''"
      role="alert"
    >
      <span>{{ errorText }}</span>
      <button type="button" class="font-semibold underline" @click="loadGroups">Повторить</button>
    </div>

    <div
      v-if="!loading && !groups.length && !errorText"
      class="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-5 text-sm text-gray-600"
      role="status"
    >
      Нет линеек на контроле. Включите «Тотальный контроль» в настройках нужной линейки в разделе «Категории».
    </div>

    <div v-if="groups.length" class="flex flex-wrap items-start gap-3">
      <article
        v-for="group in groups"
        :key="group.id"
        :data-total-control-group-id="group.id"
        class="w-full rounded-xl border border-gray-200 bg-gray-50/70 p-3 sm:w-[27.5rem]"
      >
        <div class="flex min-w-0 items-center gap-2.5">
          <div class="flex h-[52px] w-[52px] flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white ring-1 ring-gray-200">
            <img
              v-if="coverImages[group.id]"
              :src="coverImages[group.id]"
              alt=""
              class="h-full w-full object-cover"
              loading="lazy"
            />
            <span v-else class="text-xs font-bold text-blue-600" aria-hidden="true">
              {{ initialsFor(group.name) }}
            </span>
          </div>
          <div class="min-w-0 flex-1">
            <h3 class="line-clamp-2 break-words text-sm font-bold leading-4 text-gray-900">{{ group.name }}</h3>
            <p v-if="group.categoryName" class="mt-0.5 truncate text-[11px] text-gray-500">{{ group.categoryName }}</p>
          </div>
          <div class="flex-shrink-0 text-right">
            <p class="text-base font-bold leading-none text-blue-600">{{ group.totalStock }} шт</p>
            <p class="mt-1 text-[11px] uppercase tracking-wide text-gray-500">всего</p>
          </div>
        </div>

        <div class="mt-2.5 border-t border-gray-200/80 pt-2">
          <p v-if="group.items.length" class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Меньше всего
          </p>
          <ul
            v-if="group.items.length"
            :id="`total-control-items-${group.id}`"
            class="divide-y divide-gray-200/70 text-xs text-gray-700"
          >
            <li
              v-for="item in group.items.slice(0, PREVIEW_LIMIT)"
              :key="item.id"
              class="grid min-h-7 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-1"
            >
              <span class="line-clamp-2 min-w-0 break-words leading-4">{{ item.label }}</span>
              <span class="font-semibold tabular-nums" :class="stockTextClass(item.stock)">{{ item.stock }} шт</span>
            </li>
          </ul>
          <p v-else class="py-2 text-xs text-gray-500">В линейке пока нет товаров</p>

          <button
            v-if="group.items.length > PREVIEW_LIMIT"
            type="button"
            class="mt-1.5 flex h-10 w-full items-center justify-between rounded-lg px-2 text-xs font-semibold text-blue-600 transition hover:bg-blue-50 hover:text-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            aria-haspopup="dialog"
            @click="openItems(group)"
          >
            <span>Все позиции · {{ group.items.length }}</span>
            <svg class="h-4 w-4" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="m7 5 5 5-5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        </div>
      </article>
    </div>
  </section>

  <AdminModal
    :isOpen="selectedGroup !== null"
    :title="selectedGroup?.name || 'Все позиции'"
    :description="selectedGroup ? `${selectedGroup.totalStock} шт всего` : ''"
    size="md"
    :showActions="false"
    @close="closeItems"
    @cancel="closeItems"
  >
    <div class="space-y-3">
      <label class="block">
        <span class="sr-only">Поиск по позициям</span>
        <input
          v-model="searchQuery"
          type="search"
          class="h-10 w-full rounded-lg border border-gray-300 px-3 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
          placeholder="Найти вкус, цвет или товар"
        />
      </label>

      <div class="overflow-hidden rounded-lg border border-gray-200">
        <ul v-if="filteredItems.length" class="max-h-[55vh] divide-y divide-gray-100 overflow-y-auto">
          <li
            v-for="item in filteredItems"
            :key="item.id"
            class="grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-3 py-2 text-sm"
          >
            <span class="min-w-0 break-words text-gray-700">{{ item.label }}</span>
            <span class="font-semibold tabular-nums" :class="stockTextClass(item.stock)">{{ item.stock }} шт</span>
          </li>
        </ul>
        <p v-else class="px-4 py-8 text-center text-sm text-gray-500" role="status">
          Ничего не найдено
        </p>
      </div>
    </div>
  </AdminModal>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { useCrmStore, type TotalControlGroup } from "@/stores/crm";
import AdminModal from "@/components/AdminModal.vue";

const PREVIEW_LIMIT = 4;
const crmStore = useCrmStore();
const {
  totalControlGroups: groups,
  totalControlGroupsLoading: loading,
  totalControlGroupsError: errorText,
} = storeToRefs(crmStore);
const selectedGroup = ref<TotalControlGroup | null>(null);
const searchQuery = ref("");
const panelRef = ref<HTMLElement | null>(null);
const coverImages = reactive<Record<string, string>>({});
const coverFetchInFlight = new Set<string>();
let coverObserver: IntersectionObserver | null = null;

const filteredItems = computed(() => {
  const items = selectedGroup.value?.items || [];
  const query = searchQuery.value.trim().toLocaleLowerCase("ru");
  if (!query) return items;
  return items.filter((item) => item.label.toLocaleLowerCase("ru").includes(query));
});

function openItems(group: TotalControlGroup) {
  selectedGroup.value = group;
  searchQuery.value = "";
}

function closeItems() {
  selectedGroup.value = null;
  searchQuery.value = "";
}

function stockTextClass(stock: number) {
  if (stock === 0) return "text-red-600";
  if (stock <= 5) return "text-orange-700";
  return "text-gray-900";
}

function initialsFor(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}

async function loadCoverImage(groupId: string) {
  if (!groupId || coverImages[groupId] || coverFetchInFlight.has(groupId)) return;
  coverFetchInFlight.add(groupId);
  try {
    const response = await fetch(`/api/admin/category-groups/${encodeURIComponent(groupId)}/image`, {
      credentials: "include",
    });
    if (!response.ok) return;
    const data = await response.json() as { cover_image?: string | null };
    if (data.cover_image) coverImages[groupId] = data.cover_image;
  } catch (error) {
    console.warn("[TotalControlPanel] cover load failed", error);
  } finally {
    coverFetchInFlight.delete(groupId);
  }
}

async function loadGroups() {
  try {
    await crmStore.fetchTotalControlGroups();
  } catch (error) {
    console.error("[TotalControlPanel] groups load failed", error);
  }
}

function observeCoverCards() {
  void nextTick(() => {
    const cards = panelRef.value?.querySelectorAll<HTMLElement>("[data-total-control-group-id]") || [];
    if (!coverObserver) return;
    cards.forEach((card) => coverObserver?.observe(card));
  });
}

watch(groups, (list) => {
  const liveIds = new Set(list.map((group) => group.id));
  if (selectedGroup.value) {
    selectedGroup.value = list.find((group) => group.id === selectedGroup.value?.id) || null;
  }
  for (const group of list) {
    if (!group.hasCoverImage) delete coverImages[group.id];
  }
  observeCoverCards();
}, { immediate: true });

onMounted(() => {
  if (typeof IntersectionObserver !== "undefined") {
    coverObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const groupId = (entry.target as HTMLElement).dataset.totalControlGroupId || "";
        const group = groups.value.find((item) => item.id === groupId);
        if (group?.hasCoverImage) void loadCoverImage(group.id);
        coverObserver?.unobserve(entry.target);
      }
    }, { rootMargin: "160px" });
  }
  observeCoverCards();
  void loadGroups();
});

onBeforeUnmount(() => coverObserver?.disconnect());
</script>
