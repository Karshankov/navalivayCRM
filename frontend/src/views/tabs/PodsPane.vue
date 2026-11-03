<template>
  <CategoryPane tab-id="pods" :slugs="SLUGS" :is-active="isActive" />
</template>

<script setup lang="ts">
import CategoryPane from "./CategoryPane.vue";

/** Вкладка «POD-системы» — многоразовые под-системы. */
withDefaults(
  defineProps<{
    isActive?: boolean;
  }>(),
  { isActive: false },
);

const SLUGS = ["pod-systems"] as const;
</script>

<style scoped></style>
