<template>
  <div ref="paneRef" class="category-pane">
    <CategoryView :slug="activeSlug" :embedded="true" @scroll-change="onPaneScroll" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";

import CategoryView from "../CategoryView.vue";
import { useCatalogStore } from "@/stores/catalog";

/**
 * Обёртка категории для карусели вкладок: подбирает slug из каталога
 * (slug в БД может отличаться от «красивого» slug вкладки), скрывает
 * хедер с «назад» и сообщает наверх позицию скролла для стеклянной шапки.
 */
const props = defineProps<{
  tabId: "liquids" | "disposables" | "pods" | "accessories";
  isActive?: boolean;
  /** Несколько категорий внутри одной вкладки (жидкости). */
  slugs?: readonly string[];
}>();

const catalogStore = useCatalogStore();
const paneRef = ref<HTMLElement | null>(null);

const internalSlug = ref(props.slugs?.[0] ?? "");

/** Первый slug из списка, реально существующий в каталоге. */
const resolvedSlug = computed(() => {
  const candidates = props.slugs ?? [];
  for (const slug of candidates) {
    const found = catalogStore.categories.some((category) => category.slug === slug);
    if (found) return slug;
  }
  return candidates[0] ?? "";
});

// Когда каталог догрузился — подхватить настоящий slug.
watch(
  () => catalogStore.categories,
  () => {
    if (props.slugs?.length) {
      internalSlug.value = resolvedSlug.value || internalSlug.value;
    }
  },
  { immediate: true },
);

const activeSlug = computed(() =>
  props.slugs?.length ? internalSlug.value : resolvedSlug.value,
);

const emit = defineEmits<{
  (event: "scroll-change", scrollTop: number): void;
}>();

function onPaneScroll(scrollTop: number) {
  if (props.isActive) {
    emit("scroll-change", scrollTop);
  }
}

/** Свайп между внутренними категориями (солевые/обычные). */
function switchInternalSlug(slug: string) {
  if (props.slugs?.includes(slug)) {
    internalSlug.value = slug;
  }
}

onMounted(() => {
  if (props.slugs?.length) {
    internalSlug.value = resolvedSlug.value || props.slugs[0];
  }
});

defineExpose({
  switchInternalSlug,
  internalSlug,
  paneRef,
});
</script>

<style scoped>
.category-pane {
  height: 100%;
  min-height: 100dvh;
}
</style>
