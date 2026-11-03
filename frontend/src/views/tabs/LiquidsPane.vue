<template>
  <CategoryPane
    ref="categoryPaneRef"
    tab-id="liquids"
    :slugs="SLUGS"
    :is-active="isActive"
    @scroll-change="(scrollTop: number) => emit('scroll-change', scrollTop)"
  />
</template>

<script setup lang="ts">
import { computed, ref } from "vue";

import CategoryPane from "./CategoryPane.vue";

/**
 * Вкладка «Жидкости»: объединённая категория с внутренним переключением
 * солевых/обычных жидкостей. Внутренние подтабы переключаются тапом —
 * свайп внутри оставляем карусели вкладок, чтобы жесты не конфликтовали.
 */
const props = withDefaults(
  defineProps<{
    isActive?: boolean;
  }>(),
  { isActive: false },
);

const emit = defineEmits<{
  (event: "scroll-change", scrollTop: number): void;
}>();

const SLUGS = ["salt-liquids", "freebase-liquids"] as const;

const categoryPaneRef = ref<InstanceType<typeof CategoryPane> | null>(null);

const activeInternalSlug = computed(
  () => categoryPaneRef.value?.internalSlug ?? SLUGS[0],
);

function switchTo(slug: string) {
  categoryPaneRef.value?.switchInternalSlug(slug);
}

defineExpose({ activeInternalSlug, switchTo });
</script>

<style scoped></style>
