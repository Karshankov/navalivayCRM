<template>
  <CategoryPane tab-id="liquids" :slugs="SLUGS" :is-active="isActive" />
</template>

<script setup lang="ts">
import CategoryPane from "./CategoryPane.vue";

/**
 * Вкладка «Жидкости»: в БД это одна категория zhidkosti (солевые и
 * обычные внутри неё группами), отдельное переключение не нужно.
 */
withDefaults(
  defineProps<{
    isActive?: boolean;
  }>(),
  { isActive: false },
);

const SLUGS = ["zhidkosti"] as const;
</script>

<style scoped></style>
