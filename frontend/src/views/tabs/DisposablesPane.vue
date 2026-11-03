<template>
  <CategoryPane tab-id="disposables" :slugs="SLUGS" :is-active="isActive" />
</template>

<script setup lang="ts">
import CategoryPane from "./CategoryPane.vue";

/** Вкладка «Одноразки» — одноразовые PODы. */
withDefaults(
  defineProps<{
    isActive?: boolean;
  }>(),
  { isActive: false },
);

const SLUGS = ["odnorazki"] as const;
</script>

<style scoped></style>
