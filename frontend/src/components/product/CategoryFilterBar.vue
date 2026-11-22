<template>
  <section v-if="visible" class="category-filter-bar" aria-label="Фильтры категории">
    <!-- Поиск по вкусам. Логика подключится позже: сейчас поле только
         показывает ввод и очищается крестиком. -->
    <label class="filter-search">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4.5 4.5" />
      </svg>
      <!-- Анимированная подсказка: пока поле пустое, вместо placeholder
           печатается фраза и примеры вкусов. Как только покупатель
           начал вводить — подсказка уходит. -->
      <span
        v-if="!searchQuery"
        class="filter-search__hint"
        :class="{ 'is-careless': isCarelessPause }"
        aria-hidden="true"
      >
        <span class="filter-search__hint-text">{{ typedHint }}</span><span
          class="filter-search__caret"
        />
      </span>
      <input
        v-model="searchQuery"
        type="search"
        :aria-label="searchAriaLabel"
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
      <!-- «Часто берут»: плитка с чекбоксом внутри. Выбранное
           состояние — красная заливка, как у навигационных плиток. -->
      <div v-if="topChip" class="filter-tile-slot">
        <label class="filter-tile filter-tile--top" :class="{ 'is-loading': topChip.loading }">
          <input
            class="filter-tile__toggle"
            type="checkbox"
            name="top5"
            :checked="topChip.active"
            :disabled="topChip.loading"
            aria-label="Часто берут"
            data-test="filter-top"
            @change="topChip.onClick()"
          />
          <span class="filter-tile__art filter-tile__art--top" aria-hidden="true" />
          <span class="filter-tile__caption">Часто&nbsp;берут</span>
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
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
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

/* ===== Анимированная подсказка в поиске =====
   Пока поле пустое, вместо placeholder печатается фраза, затем
   примеры вкусов — с паузой, стиранием и задержкой перед следующим.
   Работает только визуально: для скринридера у поля своя подпись,
   иначе он читал бы меняющийся текст как содержимое. */
const HINT_PHRASES = [
  "ищите по вкусу",
  "малина",
  "хотите что-то с арбузом? просто напишите",
  "клубника",
  "арбуз",
];

/** Скорость печати и стирания, пауза на прочтение. */
const TYPE_MS = 45;
const ERASE_MS = 22;
const HOLD_MS = 1600;
/** Длинную фразу держим дольше: её надо успеть прочитать целиком. */
const HOLD_LONG_MS = 2400;
const LONG_PHRASE_LENGTH = 30;

const searchQuery = ref("");
const typedHint = ref("");
const isCarelessPause = ref(false);

let hintTimer: ReturnType<typeof setTimeout> | 0 = 0;
let phraseIndex = 0;
let charIndex = 0;
let erasing = false;
/** Анимацию останавливаем, когда покупатель начал вводить. */
let hintRunning = false;

function scheduleHint(delay: number) {
  if (hintTimer) clearTimeout(hintTimer);
  hintTimer = setTimeout(tickHint, delay);
}

function tickHint() {
  if (!hintRunning) return;

  const phrase = HINT_PHRASES[phraseIndex];

  if (!erasing) {
    charIndex += 1;
    typedHint.value = phrase.slice(0, charIndex);

    if (charIndex === phrase.length) {
      // Фраза напечатана: держим её, потом стираем. Длинную — дольше,
      // иначе прочитать её не успевают.
      const isLong = phrase.length >= LONG_PHRASE_LENGTH;
      isCarelessPause.value = isLong;
      scheduleHint(isLong ? HOLD_LONG_MS : HOLD_MS);
      erasing = true;
      return;
    }
    scheduleHint(TYPE_MS);
    return;
  }

  charIndex -= 1;
  typedHint.value = phrase.slice(0, Math.max(0, charIndex));

  if (charIndex <= 0) {
    // Стёрли: переходим к следующей фразе.
    erasing = false;
    isCarelessPause.value = false;
    phraseIndex = (phraseIndex + 1) % HINT_PHRASES.length;
    // Небольшая пауза перед новой строкой, чтобы не мельтешило.
    scheduleHint(320);
    return;
  }
  scheduleHint(ERASE_MS);
}

function startHint() {
  hintRunning = true;
  phraseIndex = 0;
  charIndex = 0;
  erasing = false;
  typedHint.value = "";
  // Первая фраза появляется сразу, без задержки на старте.
  scheduleHint(400);
}

function stopHint() {
  hintRunning = false;
  isCarelessPause.value = false;
  if (hintTimer) {
    clearTimeout(hintTimer);
    hintTimer = 0;
  }
}

/* Подсказка живёт, только пока поле пустое и экран не скрыт. */
watch(
  [() => searchQuery.value, () => props.profile],
  () => {
    if (searchQuery.value) {
      stopHint();
      return;
    }
    if (!hintRunning) startHint();
  },
);

onMounted(() => {
  // Уважаем системную настройку: при отключённой анимации текст статичен.
  if (prefersReducedMotion()) {
    typedHint.value = HINT_PHRASES[0];
    return;
  }
  startHint();
});

onBeforeUnmount(() => {
  stopHint();
});

/** Скринридеру отдаём понятную подпись, а не бегущий текст. */
const searchAriaLabel = computed(() => "Поиск по вкусам");

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function clearSearch() {
  searchQuery.value = "";
  // Поле опустело — возвращаем бегущую подсказку.
  if (!hintRunning && !prefersReducedMotion()) startHint();
}
</script>

<style scoped>
/* Шрифт задан на корне блока: подписи плиток и поле поиска наследовали
   системный от родителя и выбивались из остального приложения. */
.category-filter-bar {
  font-family: "Montserrat", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

/* Системные поля не наследуют шрифт: задаём явно, иначе открытый
   список крепости набран другим шрифтом, чем сама плитка. */
.category-filter-bar input,
.category-filter-bar select {
  font-family: inherit;
}

/* ===== Поиск по вкусам =====
   Размеры и отступы взяты из присланного макета: высота 50px, радиус
   16px, отступ снизу 23px, внутренний 0 15px, зазор 10px. */
.filter-search {
  position: relative;
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

/* Поле лежит выше подсказки: каретка ввода и выделение текста
   не должны упираться в подсказку. */
.filter-search input {
  position: relative;
  z-index: 1;
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

/* Подсказка: на месте placeholder, поверх пустого поля. Ввод начинается
   с той же точки, поэтому текст не сдвигается, когда подсказка уходит. */
.filter-search__hint {
  position: absolute;
  top: 50%;
  left: 45px;
  z-index: 0;
  display: flex;
  align-items: center;
  max-width: calc(100% - 62px);
  color: #979fac;
  font-size: 14px;
  line-height: 1;
  pointer-events: none;
  transform: translateY(-50%);
}

.filter-search__hint-text {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* Мигающая каретка: показывает, что текст печатается сейчас. */
.filter-search__caret {
  flex: none;
  width: 1.5px;
  height: 15px;
  margin-left: 2px;
  background: #b4bcc8;
  animation: filter-caret-blink 1s steps(1) infinite;
}

@keyframes filter-caret-blink {
  50% {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .filter-search__caret {
    animation: none;
  }
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
  /* 15px — базовый радиус из макета; на узких экранах 14px. */
  border-radius: 15px;
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
   Слева по центру высоты: 13px, вес 600. Предел ширины подобран под
   самый длинный текст в одну строку — «Часто берут» занимает 81px. */
.filter-tile__caption {
  position: absolute;
  top: 50%;
  left: 10px;
  z-index: 3;
  max-width: 96px;
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

  /* На узких экранах радиус мельче — так в макете. */
  .filter-tile {
    border-radius: 14px;
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
