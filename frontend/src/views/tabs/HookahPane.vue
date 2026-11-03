<template>
  <CategoryPane tab-id="hookah" :slugs="SLUGS" :is-active="isActive" />
</template>

<script setup lang="ts">
import CategoryPane from "./CategoryPane.vue";

/** Вкладка «Кальянка». */
withDefaults(
  defineProps<{
    isActive?: boolean;
  }>(),
  { isActive: false },
);

const SLUGS = ["kalyanka"] as const;
</script>

<style scoped></style>
