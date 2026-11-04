<template>
  <CategoryPane tab-id="accessories" :slugs="SLUGS" :is-active="isActive" />
</template>

<script setup lang="ts">
import CategoryPane from "./CategoryPane.vue";

/** Вкладка «Расходники» — картриджи, испарители, баки и аксессуары. */
withDefaults(
  defineProps<{
    isActive?: boolean;
  }>(),
  { isActive: false },
);

const SLUGS = ["rashodniki"] as const;
</script>

<style scoped></style>
