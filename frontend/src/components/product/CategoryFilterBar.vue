<template>
  <section v-if="visible" class="category-filter-bar" aria-label="Фильтры категории">
    <div
      v-if="chips.length || showDiscountChip"
      class="category-filter-rows"
      aria-label="Быстрые фильтры"
    >
      <div
        v-if="topChip || showDiscountChip"
        class="category-filter-row category-filter-row--top"
        role="group"
        aria-label="Популярные линейки и скидки"
      >
        <button
          v-if="topChip"
          type="button"
          class="category-filter-chip category-filter-chip--top"
          :class="{ 'is-active': topChip.active, 'is-loading': topChip.loading }"
          :disabled="topChip.loading"
          :aria-pressed="topChip.active"
          aria-label="Показать популярные линейки"
          data-test="filter-top"
          @click="topChip.onClick"
        >
          <span>{{ showDiscountChip ? "Чаще берут" : topChip.label }}</span>
        </button>
        <button
          v-if="showDiscountChip"
          type="button"
          class="category-filter-chip category-filter-chip--top"
          :class="{ 'is-active': discountActive }"
          :aria-pressed="discountActive"
          :aria-label="`Показать линейки со скидками, сейчас ${discountCount}`"
          data-test="filter-discount"
          @click="$emit('toggle-discount')"
        >
          <span>Скидки</span>
          <span class="category-filter-count" aria-hidden="true">{{ discountCount }}</span>
        </button>
      </div>

      <div
        v-if="strengthChips.length"
        class="category-filter-row category-filter-row--strength"
        role="group"
        aria-label="Крепость"
      >
        <button
          v-for="chip in strengthChips"
          :key="chip.id"
          type="button"
          class="category-filter-chip category-filter-chip--strength"
          :class="{ 'is-active': chip.active }"
          :aria-pressed="chip.active"
          @click="chip.onClick"
        >
          <span>{{ chip.label }}</span>
        </button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { StorefrontFiltersProfile, StrengthTier } from "@/composables/useCategoryFilters";
import { getStrengthLabel } from "@/composables/useCategoryFilters";

const props = withDefaults(
  defineProps<{
    profile?: StorefrontFiltersProfile;
    topActive?: boolean;
    strengthTier?: StrengthTier | null;
    topLoading?: boolean;
    discountActive?: boolean;
    discountCount?: number;
  }>(),
  {
    profile: "none",
    topActive: false,
    strengthTier: null,
    topLoading: false,
    discountActive: false,
    discountCount: 0,
  },
);

const emit = defineEmits<{
  (e: "toggle-top"): void;
  (e: "toggle-strength", tier: StrengthTier): void;
  (e: "toggle-discount"): void;
}>();

/**
 * Кнопка скидок появляется, только когда скидки в разделе есть. Пустой фильтр,
 * который ничего не находит, покупателю не нужен, а «чаще берут» в одиночестве
 * спокойно занимает всю ширину.
 */
const showDiscountChip = computed(() => props.discountCount > 0);

const visible = computed(
  () =>
    props.profile === "liquids" ||
    props.profile === "snus_plates" ||
    showDiscountChip.value,
);

const showTop = computed(
  () => props.profile === "liquids" || props.profile === "snus_plates",
);
const showStrength = computed(() => props.profile === "liquids");

type ChipItem = {
  id: string;
  label: string;
  active: boolean;
  loading?: boolean;
  onClick: () => void;
};

const chips = computed<ChipItem[]>(() => {
  const list: ChipItem[] = [];

  if (showTop.value) {
    list.push({
      id: "top",
      label: "Чаще всего берут",
      active: props.topActive,
      loading: props.topLoading,
      onClick: () => emit("toggle-top"),
    });
  }

  if (showStrength.value) {
    (["very_strong", "strong", "light"] as StrengthTier[]).forEach((tier) => {
      list.push({
        id: tier,
        label: getStrengthLabel(tier),
        active: props.strengthTier === tier,
        onClick: () => emit("toggle-strength", tier),
      });
    });
  }

  return list;
});

const topChip = computed(() => chips.value.find((chip) => chip.id === "top") ?? null);

const strengthChips = computed(() =>
  chips.value.filter((chip) => chip.id !== "top"),
);
</script>

<style scoped>
.category-filter-bar {
  margin-bottom: 16px;
}

.category-filter-rows {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.category-filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.category-filter-row--top {
  width: 100%;
  flex-wrap: nowrap;
}

.category-filter-row--strength {
  width: 100%;
  justify-content: stretch;
  flex-wrap: nowrap;
  gap: 8px;
}

.category-filter-chip {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 36px;
  white-space: nowrap;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid #e6e9ed;
  background: #ffffff;
  color: #191919;
  font-family: "Montserrat", sans-serif;
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  transition: all 0.2s ease;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}

/*
 * Кнопки верхнего ряда делят ширину поровну. flex-basis: 0 вместо auto — иначе
 * «Чаще берут» с более длинным текстом забрала бы себе больше места, и ряд
 * перестал бы выглядеть половинками.
 */
.category-filter-chip--top {
  flex: 1 1 0;
  min-width: 0;
  min-height: 44px;
  padding: 0 16px;
  font-size: 14px;
}

/* Сколько линеек сейчас со скидкой. */
.category-filter-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: linear-gradient(106.76deg, #f50302 -2.64%, #a90f0e 85.78%);
  color: #ffffff;
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
}

/* На нажатой кнопке фон уже красный: кружок выворачиваем, иначе он сливается. */
.category-filter-chip.is-active .category-filter-count {
  background: #ffffff;
  color: #a90f0e;
}

@media (max-width: 360px) {
  .category-filter-chip--top {
    padding: 0 10px;
    font-size: 13px;
  }
}

.category-filter-chip--strength {
  flex: 1 1 0;
  min-width: 0;
  min-height: 44px;
  padding: 0 10px;
  font-size: 13px;
}

@media (max-width: 360px) {
  .category-filter-chip--strength {
    padding: 0 6px;
    font-size: 12px;
  }
}

@media (hover: hover) and (pointer: fine) {
  .category-filter-chip:hover:not(:disabled):not(.is-active) {
    border-color: #d0d5dd;
    background: #f9fafb;
  }
}

.category-filter-chip.is-active,
.category-filter-chip.is-active:hover {
  border-color: transparent;
  color: #ffffff;
  background: linear-gradient(106.76deg, #f50302 -2.64%, #a90f0e 85.78%);
  box-shadow: 0 4px 12px rgba(211, 47, 47, 0.22);
}

.category-filter-chip.is-loading {
  opacity: 0.7;
  cursor: wait;
}
</style>