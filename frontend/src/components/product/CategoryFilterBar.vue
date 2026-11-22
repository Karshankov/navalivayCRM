<template>
  <section v-if="visible" class="category-filter-bar" aria-label="Фильтры категории">
    <!-- Поиск по вкусам. Логика подключится позже: сейчас поле только
         показывает ввод и очищается крестиком. -->
    <label class="filter-search">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4.5 4.5" />
      </svg>
      <input
        v-model="searchQuery"
        type="search"
        placeholder="Поиск по вкусам"
        aria-label="Поиск по вкусам"
        autocomplete="off"
        data-test="filter-search"
      />
      <button
        v-if="searchQuery"
        type="button"
        class="filter-search__clear"
        aria-label="Очистить поиск"
        @click="clearSearch"
      >
        ×
      </button>
    </label>

    <div class="filter-tiles">
      <!-- «ТОП-5»: плитка с чекбоксом внутри. Выбранное состояние —
           красная заливка, как у навигационных плиток. -->
      <div v-if="topChip" class="filter-tile-slot">
        <label class="filter-tile filter-tile--top" :class="{ 'is-loading': topChip.loading }">
          <input
            class="filter-tile__toggle"
            type="checkbox"
            name="top5"
            :checked="topChip.active"
            :disabled="topChip.loading"
            aria-label="ТОП-5"
            data-test="filter-top"
            @change="topChip.onClick()"
          />
          <span class="filter-tile__art filter-tile__art--top" aria-hidden="true" />
          <span class="filter-tile__caption">ТОП-5</span>
        </label>
      </div>

      <!-- Скидки: та же плитка со счётчиком, когда в разделе есть скидки. -->
      <div v-if="showDiscountChip" class="filter-tile-slot">
        <label class="filter-tile filter-tile--discount">
          <input
            class="filter-tile__toggle"
            type="checkbox"
            name="discount"
            :checked="discountActive"
            :aria-label="`Показать линейки со скидками, сейчас ${discountCount}`"
            data-test="filter-discount"
            @change="$emit('toggle-discount')"
          />
          <span class="filter-tile__count" aria-hidden="true">{{ discountCount }}</span>
          <span class="filter-tile__caption">Со скидкой</span>
        </label>
      </div>

      <!-- Крепость: прозрачный нативный select поверх плитки. При нажатии
           открывается системный список, подпись меняется по выбору. -->
      <div v-if="showStrength" class="filter-tile-slot filter-tile-slot--strength">
        <select
          v-model="strengthValue"
          class="filter-tile__select"
          name="strength"
          aria-label="Выбрать крепость"
          data-test="filter-strength"
          @change="onStrengthChange"
        >
          <option value="">Любая крепость</option>
          <option v-for="chip in strengthChips" :key="chip.id" :value="chip.id">
            {{ chip.label }}
          </option>
        </select>
        <span class="filter-tile filter-tile--strength" :class="{ 'is-selected': strengthTier !== null }">
          <span class="filter-tile__art filter-tile__art--strength" aria-hidden="true" />
          <span class="filter-tile__caption">{{ strengthTileLabel }}</span>
        </span>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
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

/* Крепость выбирается нативным списком системы: select прозрачный
   и лежит поверх плитки, поэтому нажатие открывает системный выбор. */
const strengthValue = ref<string>(props.strengthTier ?? "");

// Внешнее изменение фильтра (сброс на экране) синхронизируем с полем.
watch(
  () => props.strengthTier,
  (tier) => {
    strengthValue.value = tier ?? "";
  },
);

function onStrengthChange() {
  const next = strengthValue.value as StrengthTier | "";
  if (!next) {
    // «Любая крепость»: снимаем фильтр, если он был.
    if (props.strengthTier !== null) emit("toggle-strength", props.strengthTier);
    return;
  }
  emit("toggle-strength", next);
}

/* Поиск по вкусам. Логику подключим позже — сейчас поле только
   держит введённый текст. */
const searchQuery = ref("");

function clearSearch() {
  searchQuery.value = "";
}
</script>

<style scoped>
/* ===== Поиск по вкусам =====
   Размеры и отступы взяты из присланного макета: высота 50px, радиус
   16px, отступ снизу 23px, внутренний 0 15px, зазор 10px. */
.filter-search {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 50px;
  margin-bottom: 23px;
  padding: 0 15px;
  border: 1px solid #e5e8ef;
  border-radius: 16px;
  background: #ffffff;
  transition: border-color 0.2s ease;
}

.filter-search:focus-within {
  border-color: #c1ccd9;
}

.filter-search svg {
  flex: none;
  width: 20px;
  fill: none;
  stroke: #99a1ad;
  stroke-width: 1.7;
}

.filter-search input {
  width: 100%;
  min-width: 0;
  border: 0;
  background: none;
  color: #191919;
  font-family: inherit;
  /* 16px: при меньшем iOS зумит страницу при фокусе. */
  font-size: 16px;
  outline: none;
}

.filter-search input::placeholder {
  color: #979fac;
  font-size: 14px;
}

/* Крестик очистки: родной у type=search выглядит иначе. */
.filter-search input::-webkit-search-cancel-button {
  display: none;
}

.filter-search__clear {
  display: grid;
  place-items: center;
  flex: none;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: #f0f2f7;
  color: #7e8998;
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
}

.filter-search__clear:focus-visible {
  outline: 2px solid #147cec;
  outline-offset: 2px;
}

/* ===== Плитки =====
   Две плитки по 50px высотой, зазор 10px, радиус 14px. */
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
  height: 50px;
  overflow: hidden;
  border: 1px solid transparent;
  border-radius: 14px;
  background: #ffffff;
  color: #191919;
  font-family: inherit;
  isolation: isolate;
  cursor: pointer;
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

/* Нажатие: плитка чуть ужимается. */
.filter-tile:active {
  transform: scale(0.98);
}

.filter-tile.is-loading {
  cursor: wait;
  opacity: 0.7;
}

/* Чекбокс и select растянуты по плитке и прозрачны: нажатие ловят они,
   а вид рисуем на плите. Так выбор крепости открывается системным
   списком, как в нативных приложениях. */
.filter-tile__toggle,
.filter-tile__select {
  position: absolute;
  inset: 0;
  z-index: 10;
  width: 100%;
  height: 100%;
  margin: 0;
  border: 0;
  opacity: 0;
  cursor: pointer;
  touch-action: manipulation;
}

.filter-tile__select {
  /* 16px: при меньшем iOS зумит страницу при открытии списка. */
  font-size: 16px;
}

.filter-tile__toggle:disabled,
.filter-tile__select:disabled {
  cursor: wait;
}

/* Фокус показываем на самой плитке: поле ввода прозрачное. */
.filter-tile:has(.filter-tile__toggle:focus-visible),
.filter-tile-slot--strength:has(.filter-tile__select:focus-visible) .filter-tile {
  outline: 2px solid #147cec;
  outline-offset: 3px;
}

/* ===== Выбранное состояние =====
   Красная заливка, как у навигационных плиток. */
.filter-tile:has(.filter-tile__toggle:checked),
.filter-tile--strength.is-selected {
  border-color: transparent;
  color: #ffffff;
  background: linear-gradient(115deg, #ff2010 0%, #e4170c 43%, #a91e17 100%);
  box-shadow: 0 7px 19px -6px #df21144f, 0 3px 8px -4px #b819122e;
}

.filter-tile:has(.filter-tile__toggle:checked)::before,
.filter-tile--strength.is-selected::before {
  background: radial-gradient(ellipse at 4% -12%, #ffffff38, transparent 58%),
    radial-gradient(ellipse at 78% 130%, #ff806929, transparent 68%);
}

.filter-tile:has(.filter-tile__toggle:checked)::after,
.filter-tile--strength.is-selected::after {
  box-shadow: inset 0 1px 0 #ffffff29, inset 0 -1px 1px #7d090c18;
}

/* ===== Подпись =====
   Слева по центру высоты: 13px, вес 600, максимум 70px ширины. */
.filter-tile__caption {
  position: absolute;
  top: 50%;
  left: 10px;
  z-index: 3;
  max-width: 70px;
  color: inherit;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.15px;
  text-align: left;
  transform: translateY(-50%);
  pointer-events: none;
}

.filter-tile:has(.filter-tile__toggle:checked) .filter-tile__caption,
.filter-tile--strength.is-selected .filter-tile__caption {
  color: #ffffff;
  text-shadow: 0 1px 1px #8c0f1420;
}

/* ===== Арты =====
   Объёмные картинки справа, растворяются к тексту маской. */
.filter-tile__art {
  position: absolute;
  z-index: 1;
  background-repeat: no-repeat;
  background-position: center;
  background-size: 100% 100%;
  pointer-events: none;
  mask-image: linear-gradient(to right, transparent, #000 35%);
  -webkit-mask-image: linear-gradient(to right, transparent, #000 35%);
}

.filter-tile__art--top {
  top: -11px;
  right: -16px;
  width: 85px;
  height: 85px;
  background-image: url("/filters/top5-art.png");
  transform: rotate(-5deg);
}

.filter-tile__art--strength {
  top: -9px;
  right: -23px;
  width: 84px;
  height: 84px;
  background-image: url("/filters/strength-art.png");
  transform: rotate(8deg);
}

.filter-tile:has(.filter-tile__toggle:checked) .filter-tile__art,
.filter-tile--strength.is-selected .filter-tile__art {
  filter: drop-shadow(0 0 6px #ffffff23);
}

/* Счётчик скидок вместо арта. */
.filter-tile__count {
  position: absolute;
  top: 50%;
  right: 12px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 26px;
  height: 26px;
  padding: 0 7px;
  border-radius: 50%;
  background: linear-gradient(106.76deg, #f50302 -2.64%, #a90f0e 85.78%);
  color: #ffffff;
  font-size: 12px;
  font-weight: 800;
  line-height: 1;
  transform: translateY(-50%);
}

.filter-tile:has(.filter-tile__toggle:checked) .filter-tile__count {
  background: #ffffff;
  color: #a90f0e;
}

@media (max-width: 350px) {
  .filter-tiles {
    gap: 10px;
  }

  .filter-tile__caption {
    left: 10px;
    max-width: 70px;
    font-size: 12px;
  }

  .filter-tile--top .filter-tile__caption {
    font-size: 13px;
  }

  .filter-tile__art--top {
    top: -11px;
    right: -16px;
    width: 85px;
    height: 85px;
  }

  .filter-tile__art--strength {
    top: -9px;
    right: -23px;
    width: 84px;
    height: 84px;
  }
}

@media (hover: hover) and (pointer: fine) {
  .filter-tile:hover:not(:has(.filter-tile__toggle:checked)):not(.is-selected) {
    border-color: #e6e9ed;
    box-shadow: 0 6px 16px -8px #19263c1f;
  }
}

/* Плавающие арты: оживляют плитку, но не мешают чтению. */
@media (prefers-reduced-motion: no-preference) {
  .filter-tile__art--top {
    animation: filter-float-top 5s ease-in-out infinite;
  }

  .filter-tile__art--strength {
    animation: filter-float-gauge 5.8s ease-in-out infinite;
  }

  @keyframes filter-float-top {
    0%,
    100% {
      transform: rotate(-5deg) translateY(0);
    }
    50% {
      transform: rotate(-2deg) translateY(2px);
    }
  }

  @keyframes filter-float-gauge {
    0%,
    100% {
      transform: rotate(8deg) translateY(0);
    }
    50% {
      transform: rotate(5deg) translateY(2px);
    }
  }
}

@media (prefers-reduced-motion: reduce) {
  .filter-tile {
    transition: none;
  }
}

</style>
