<template>
  <section v-if="visible" class="category-filter-bar" aria-label="Фильтры категории">
    <div v-if="showTop || showDiscountChip || showStrength" class="filter-tiles">
      <!-- «Чаще берут»: плитка с объёмным артом и переключаемым состоянием. -->
      <div v-if="topChip" class="filter-tile-slot">
        <button
          type="button"
          class="filter-tile filter-tile--top"
          :class="{ 'is-loading': topChip.loading }"
          :aria-pressed="topChip.active"
          :disabled="topChip.loading"
          :aria-label="topChip.label"
          data-test="filter-top"
          @click="topChip.onClick"
        >
          <span class="filter-tile__art filter-tile__art--top" aria-hidden="true" />
          <span class="filter-tile__caption">{{ topChip.tileLabel }}</span>
        </button>
      </div>

      <!-- Скидки: та же плитка, но со счётчиком вместо арта. -->
      <div v-if="showDiscountChip" class="filter-tile-slot">
        <button
          type="button"
          class="filter-tile filter-tile--discount"
          :aria-pressed="discountActive"
          :aria-label="`Показать линейки со скидками, сейчас ${discountCount}`"
          data-test="filter-discount"
          @click="$emit('toggle-discount')"
        >
          <span class="filter-tile__count" aria-hidden="true">{{ discountCount }}</span>
          <span class="filter-tile__caption">Со скидкой</span>
        </button>
      </div>

      <!-- Крепость: плитка, снизу выезжает панель с вариантами. -->
      <div v-if="showStrength" class="filter-tile-slot">
        <button
          type="button"
          class="filter-tile filter-tile--strength"
          aria-haspopup="dialog"
          :aria-label="strengthTileLabel"
          :aria-expanded="strengthOpen"
          data-test="filter-strength-open"
          @click="openStrength"
        >
          <span class="filter-tile__art filter-tile__art--strength" aria-hidden="true" />
          <span class="filter-tile__caption">{{ strengthTileLabel }}</span>
          <span class="filter-tile__chevron" aria-hidden="true">
            <svg viewBox="0 0 20 20"><path d="m5 8 5 5 5-5" /></svg>
          </span>
        </button>
      </div>
    </div>

    <!-- Панель выбора крепости: как нижние шторки в приложении. -->
    <Teleport to="body">
      <Transition name="strength-fade">
        <div
          v-if="strengthOpen"
          class="strength-backdrop"
          aria-hidden="true"
          @click="closeStrength"
        />
      </Transition>
      <Transition name="strength-rise">
        <div
          v-if="strengthOpen"
          class="strength-sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="strength-sheet-title"
          @keydown.esc="closeStrength"
        >
          <span class="strength-sheet__grip" aria-hidden="true" />
          <div class="strength-sheet__head">
            <h2 id="strength-sheet-title">Крепость</h2>
            <button
              type="button"
              class="strength-sheet__close"
              aria-label="Закрыть выбор крепости"
              @click="closeStrength"
            >
              ×
            </button>
          </div>
          <div class="strength-sheet__options">
            <button
              type="button"
              class="strength-option"
              :aria-pressed="strengthTier === null"
              data-test="strength-any"
              @click="pickStrength(null)"
            >
              Любая крепость
            </button>
            <button
              v-for="chip in strengthChips"
              :key="chip.id"
              type="button"
              class="strength-option"
              :aria-pressed="chip.active"
              :data-test="`strength-${chip.id}`"
              @click="pickStrength(chip.tier)"
            >
              {{ chip.label }}
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
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
  /** Название в панели выбора. */
  label: string;
  /** Название на плитке — короче, чем в панели. */
  tileLabel: string;
  tier: StrengthTier;
  active: boolean;
  loading?: boolean;
  onClick: () => void;
};

/** Крепость на плитке подписана коротко: «Крепкая», «Лёгкая». */
const STRENGTH_TILE_LABELS: Record<StrengthTier, string> = {
  very_strong: "Очень крепкая",
  strong: "Крепкая",
  light: "Лёгкая",
};

const chips = computed<ChipItem[]>(() => {
  const list: ChipItem[] = [];

  if (showTop.value) {
    list.push({
      id: "top",
      label: "Чаще всего берут",
      tileLabel: "Чаще берут",
      tier: "strong",
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
        tileLabel: STRENGTH_TILE_LABELS[tier],
        tier,
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

/** Подпись плитки крепости: выбранное значение или приглашение выбрать. */
const strengthTileLabel = computed(() => {
  const active = strengthChips.value.find((chip) => chip.active);
  return active ? active.tileLabel : "Выбрать крепость";
});

/* Панель выбора крепости открывается по плитке. Выбор сразу применяет
   фильтр и закрывает панель — как нижние шторки в приложении. */
const strengthOpen = ref(false);

function openStrength() {
  strengthOpen.value = true;
}

function closeStrength() {
  strengthOpen.value = false;
}

function pickStrength(tier: StrengthTier | null) {
  closeStrength();
  // Повторный выбор того же значения снимает фильтр, как переключатель.
  if (tier === null || props.strengthTier === tier) {
    if (props.strengthTier !== null) emit("toggle-strength", props.strengthTier);
    return;
  }
  emit("toggle-strength", tier);
}

/* Escape закрывает панель, а фон не должен прокручиваться под ней. */
watch(strengthOpen, (open) => {
  if (typeof document === "undefined") return;
  document.body.style.overflow = open ? "hidden" : "";
});

onBeforeUnmount(() => {
  if (typeof document !== "undefined") document.body.style.overflow = "";
});
</script>

<style scoped>
/* ===== Плитки фильтров =====
   Две плитки в ряд: «Чаще берут» и выбор крепости. Вид взят из
   присланного макета filters-final.html, логика фильтров не менялась. */
.filter-tiles {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 10px;
}

.filter-tile-slot {
  position: relative;
  min-width: 0;
}

.filter-tile {
  position: relative;
  display: block;
  width: 100%;
  height: 82px;
  padding: 0;
  overflow: hidden;
  border: 1px solid transparent;
  border-radius: 18px;
  background: #ffffff;
  color: #191919;
  font-family: "Montserrat", sans-serif;
  text-align: left;
  cursor: pointer;
  isolation: isolate;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  transition: box-shadow 0.22s ease, color 0.2s ease, border-color 0.2s ease,
    transform 0.18s ease;
}

/* Лёгкая тень под плиткой и внутренний блик по верхней кромке. */
.filter-tile::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  background: radial-gradient(ellipse at 50% 104%, #e5e8ee85, transparent 63%);
}

.filter-tile::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow: inset 0 1px 2px #ffffffd9;
  pointer-events: none;
}

.filter-tile:active:not(:disabled) {
  transform: scale(0.98);
}

.filter-tile:focus-visible {
  outline: 2px solid #147cec;
  outline-offset: 3px;
}

.filter-tile:disabled {
  cursor: wait;
  opacity: 0.7;
}

/* Выбранное состояние: красный градиент, как у навигационных плиток. */
.filter-tile[aria-pressed="true"] {
  border-color: transparent;
  color: #ffffff;
  background: linear-gradient(115deg, #ff2010 0%, #e4170c 43%, #a91e17 100%);
  box-shadow: 0 7px 19px -6px #df21144f, 0 3px 8px -4px #b819122e;
}

.filter-tile[aria-pressed="true"]::before {
  background: radial-gradient(ellipse at 4% -12%, #ffffff38, transparent 58%),
    radial-gradient(ellipse at 78% 130%, #ff806929, transparent 68%);
}

.filter-tile[aria-pressed="true"]::after {
  box-shadow: inset 0 1px 0 #ffffff29, inset 0 -1px 1px #7d090c18;
}

/* Подпись стоит слева по центру высоты. */
.filter-tile__caption {
  position: absolute;
  top: 50%;
  left: 12px;
  right: auto;
  z-index: 3;
  max-width: 76px;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.15px;
  transform: translateY(-50%);
  text-align: left;
  pointer-events: none;
}

.filter-tile--strength .filter-tile__caption {
  max-width: 70px;
  font-size: 12px;
}

.filter-tile[aria-pressed="true"] .filter-tile__caption {
  color: #ffffff;
  text-shadow: 0 1px 1px #8c0f1420;
}

/* Объёмные арты уходят вправо, растворяясь к тексту. */
.filter-tile__art {
  position: absolute;
  top: 50%;
  z-index: 1;
  background-repeat: no-repeat;
  pointer-events: none;
}

.filter-tile__art--top {
  right: -16px;
  width: 110px;
  height: 110px;
  background-image: url("/filters/top5-art.png");
  background-size: 100% 100%;
  transform: translateY(-50%);
  mask-image: linear-gradient(to right, transparent, #000 35%);
  -webkit-mask-image: linear-gradient(to right, transparent, #000 35%);
}

.filter-tile__art--strength {
  right: -10px;
  width: 96px;
  height: 96px;
  background-image: url("/filters/strength-art.png");
  background-size: 100% 100%;
  transform: translateY(-50%);
  mask-image: linear-gradient(to right, transparent, #000 35%);
  -webkit-mask-image: linear-gradient(to right, transparent, #000 35%);
}

.filter-tile[aria-pressed="true"] .filter-tile__art {
  filter: drop-shadow(0 0 6px #ffffff23);
}

/* Счётчик скидок вместо арта. */
.filter-tile__count {
  position: absolute;
  top: 50%;
  right: 14px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 30px;
  height: 30px;
  padding: 0 8px;
  border-radius: 50%;
  background: linear-gradient(106.76deg, #f50302 -2.64%, #a90f0e 85.78%);
  color: #ffffff;
  font-size: 13px;
  font-weight: 800;
  line-height: 1;
  transform: translateY(-50%);
}

.filter-tile[aria-pressed="true"] .filter-tile__count {
  background: #ffffff;
  color: #a90f0e;
}

/* Стрелка вниз у плитки крепости: показывает, что откроется список. */
.filter-tile__chevron {
  position: absolute;
  right: 9px;
  bottom: 11px;
  z-index: 3;
  display: grid;
  place-items: center;
  width: 19px;
  height: 19px;
  border-radius: 50%;
  background: #f0f2f7;
  color: #929aa6;
  pointer-events: none;
}

.filter-tile__chevron svg {
  width: 11px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
}

.filter-tile[aria-pressed="true"] .filter-tile__chevron {
  background: #ffffff2e;
  color: #ffffff;
}

/* ===== Панель выбора крепости ===== */
.strength-backdrop {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: #1c263550;
}

.strength-sheet {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 91;
  width: min(100%, 430px);
  margin: 0 auto;
  padding: 10px 18px max(22px, env(safe-area-inset-bottom));
  border-radius: 24px 24px 0 0;
  background: #ffffff;
  color: #202126;
  font-family: "Montserrat", sans-serif;
  box-shadow: 0 -12px 50px #19263c20;
}

.strength-sheet__grip {
  display: block;
  width: 34px;
  height: 4px;
  margin: 0 auto 18px;
  border-radius: 4px;
  background: #dce1e8;
}

.strength-sheet__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.strength-sheet__head h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.strength-sheet__close {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: #f1f3f7;
  color: #7e8998;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}

.strength-sheet__close:focus-visible {
  outline: 2px solid #147cec;
  outline-offset: 2px;
}

.strength-sheet__options {
  display: grid;
  gap: 8px;
}

.strength-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 49px;
  padding: 12px 14px;
  border: 1px solid #e7eaf0;
  border-radius: 12px;
  background: #f8f9fc;
  color: #191919;
  font-family: inherit;
  font-size: 14px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.2s ease, background 0.2s ease, color 0.2s ease;
}

.strength-option:focus-visible {
  outline: 2px solid #147cec;
  outline-offset: 2px;
}

.strength-option[aria-pressed="true"] {
  border-color: #e6b2ad;
  background: #fff1ee;
  color: #c3231b;
}

.strength-option[aria-pressed="true"]::after {
  content: "✓";
  font-size: 17px;
}

.strength-fade-enter-active,
.strength-fade-leave-active {
  transition: opacity 0.24s ease;
}

.strength-fade-enter-from,
.strength-fade-leave-to {
  opacity: 0;
}

.strength-rise-enter-active,
.strength-rise-leave-active {
  transition: transform 0.28s cubic-bezier(0.32, 0.72, 0, 1);
}

.strength-rise-enter-from,
.strength-rise-leave-to {
  transform: translateY(100%);
}

@media (hover: hover) and (pointer: fine) {
  .filter-tile:hover:not(:disabled):not([aria-pressed="true"]) {
    border-color: #e6e9ed;
    box-shadow: 0 6px 16px -8px #19263c1f;
  }
}

@media (max-width: 350px) {
  .filter-tiles {
    gap: 8px;
  }

  .filter-tile {
    height: 74px;
    border-radius: 16px;
  }

  .filter-tile__caption {
    left: 10px;
    max-width: 66px;
    font-size: 12px;
  }

  .filter-tile--strength .filter-tile__caption {
    max-width: 62px;
    font-size: 11px;
  }

  .filter-tile__art--top {
    right: -14px;
    width: 96px;
    height: 96px;
  }

  .filter-tile__art--strength {
    right: -8px;
    width: 84px;
    height: 84px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .filter-tile,
  .strength-option,
  .strength-fade-enter-active,
  .strength-fade-leave-active,
  .strength-rise-enter-active,
  .strength-rise-leave-active {
    transition: none;
  }
}

</style>
