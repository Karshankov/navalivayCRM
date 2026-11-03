<template>
  <CategoryPane tab-id="snus" :slugs="SLUGS" :is-active="isActive" />
</template>

<script setup lang="ts">
import CategoryPane from "./CategoryPane.vue";

/** Вкладка «Снюс и пластины». */
withDefaults(
  defineProps<{
    isActive?: boolean;
  }>(),
  { isActive: false },
);

const SLUGS = ["snyus-i-plastiny"] as const;
</script>

<style scoped></style>
