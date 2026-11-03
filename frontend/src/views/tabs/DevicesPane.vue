<template>
  <CategoryPane tab-id="devices" :slugs="SLUGS" :is-active="isActive" />
</template>

<script setup lang="ts">
import CategoryPane from "./CategoryPane.vue";

/** Вкладка «Устройства» — POD-системы и многоразовые устройства. */
withDefaults(
  defineProps<{
    isActive?: boolean;
  }>(),
  { isActive: false },
);

const SLUGS = ["ustrojstva"] as const;
</script>

<style scoped></style>
