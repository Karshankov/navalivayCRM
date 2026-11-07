<template>
  <nav
    ref="navRef"
    class="qnav"
    :class="{ 'qnav--dragging': isDragging }"
    aria-label="Категории товаров"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <!-- Дорожка-карусель: viewport прячет горизонтальный скролл
         страниц, но частицы взрыва летят свободно вверх. -->
    <div class="qnav__viewport">
      <div
        class="qnav__track"
        :class="{ 'qnav__track--teasing': teasing && teasingAnimating }"
        :style="{ transform: `translateX(calc(${-page * 100}% + ${dragOffset}px))` }"
      >
        <div
          v-for="(chunk, pageIndex) in pages"
          :key="`page-${pageIndex}`"
          class="qnav__page"
        >
          <button
            v-for="cat in chunk"
            :key="cat.slug"
            type="button"
            class="qnav__category"
            :class="{ 'qnav__category--active': isActive(cat.slug) }"
            :data-index="cat.index"
            :style="{ '--particle': `url(${cat.particle})` }"
            :aria-label="cat.name"
            @click="select(cat, $event)"
          >
            <span class="qnav__icon-pair" aria-hidden="true">
              <img class="qnav__icon-3d" :src="cat.icon" alt="" loading="lazy" decoding="async" />
            </span>
            <span class="qnav__label">{{ cat.name }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Взрыв частиц при активации: fixed-слой телепортируется в
         body — панель и её dock имеют transform, который создаёт
         containing block для fixed-потомков и уносит частицы за
         экран. В body они позиционируются честно от viewport и
         рендерятся поверх всех блоков. -->
    <Teleport to="body">
      <template v-if="burstActive">
        <span
          v-for="p in 12"
          :key="`burst-${burstKey}-${p}`"
          :class="`qnav-piece qnav-piece-${p - 1}`"
          :style="{
            left: `${burstOrigin.x - 6}px`,
            top: `${burstOrigin.y - 9}px`,
            '--particle': `url(${burstParticle})`,
          }"
          aria-hidden="true"
        ></span>
      </template>
    </Teleport>

    <!-- Подсказка «есть ещё»: справа мерцающий градиент. -->
    <span
      v-if="hasMore && teasing"
      class="qnav__hint"
      :class="{ 'qnav__hint--teasing': teasingAnimating }"
      aria-hidden="true"
    >
    </span>

    <!-- Точки-индикаторы страниц. -->
    <div class="qnav__dots" aria-hidden="true">
      <span
        v-for="(chunk, pageIndex) in pages"
        :key="`dot-${pageIndex}`"
        class="qnav__dot"
        :class="{ 'qnav__dot--active': pageIndex === page }"
      ></span>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

/**
 * Быстрая навигация по категориям внутри «Наш ассортимент».
 *
 * Один ряд по 3 категории; вторая тройка (Одноразки, Снюс,
 * Кальянка) — свайпом: горизонтальная карирусель из двух страниц.
 * Подсказка справа — мерцающий градиент со стрелкой и лёгкий
 * «подёргивающийся» сдвиг дорожки; после первого свайпа исчезает.
 * Активная категория — красный градиент, иконка «загорается»,
 * взрыв частиц; свайп — следующий экран категорий.
 */

interface QuickNavItem {
  index: number;
  slug: string;
  name: string;
  icon: string;
  particle: string;
}

/** Разделы по реальным slug каталога (демо-названия сохранены). */
const items: QuickNavItem[] = [
  { index: 0, slug: "zhidkosti", name: "Жидкости", icon: "/quicknav/liquids-icon.png", particle: "/quicknav/liquids-particle.png" },
  { index: 1, slug: "rashodniki", name: "Расходники", icon: "/quicknav/rashodniki-icon.png", particle: "/quicknav/rashodniki-particle.png" },
  { index: 2, slug: "ustrojstva", name: "Устройства", icon: "/quicknav/ustrojstva-icon.png", particle: "/quicknav/ustrojstva-particle.png" },
  { index: 3, slug: "odnorazki", name: "Одноразки", icon: "/quicknav/disposable-icon.png", particle: "/quicknav/disposable-particle.png" },
  { index: 4, slug: "snyus-i-plastiny", name: "Снюс", icon: "/quicknav/snus-icon.png", particle: "/quicknav/snus-particle.png" },
  { index: 5, slug: "kalyanka", name: "Кальянка", icon: "/quicknav/hookah-icon.png", particle: "/quicknav/hookah-particle.png" },
];

const PER_PAGE = 3;

/** Две страницы по три категории. */
const pages = computed<QuickNavItem[][]>(() => {
  const result: QuickNavItem[][] = [];
  for (let i = 0; i < items.length; i += PER_PAGE) {
    result.push(items.slice(i, i + PER_PAGE));
  }
  return result;
});

const emit = defineEmits<{
  (e: "select", slug: string): void;
}>();

const route = useRoute();
const router = useRouter();

/** Переключение той же кнопки — новый взрыв частиц. */
const burstKey = ref(0);
const lastActiveSlug = ref<string | null>(null);

/** Текущая страница карусели (0 — первая тройка, 1 — вторая). */
const page = ref(0);
const hasMore = computed(() => pages.value.length > 1);

/** Показывать подсказку «есть ещё»: до первого свайпа. */
const teasing = ref(true);

/* ===== Горизонтальный свайп ===== */
const navRef = ref<HTMLElement | null>(null);
const isDragging = ref(false);
const dragStartX = ref(0);
const dragOffset = ref(0);
/** Порог свайпа: короткий жест уже листает страницу. */
const SWIPE_THRESHOLD = 40;

function onPointerDown(event: PointerEvent) {
  // Только горизонтальный жест: вертикальный скролл страницы
  // не должен блокироваться панелью.
  isDragging.value = false;
  dragStartX.value = event.clientX;
  dragOffset.value = 0;
}

function onPointerMove(event: PointerEvent) {
  if (dragStartX.value === 0) return;
  const dx = event.clientX - dragStartX.value;
  // Начинаем перетаскивание только при выраженном горизонтальном
  // движении — иначе это тап или вертикальный скролл.
  if (!isDragging.value && Math.abs(dx) < 10) return;
  isDragging.value = true;

  // Резиновые края: за пределами первой/последней страницы
  // движение встречает сопротивление.
  const canGoLeft = page.value > 0;
  const canGoRight = page.value < pages.value.length - 1;
  if ((!canGoLeft && dx > 0) || (!canGoRight && dx < 0)) {
    dragOffset.value = dx * 0.25;
  } else {
    dragOffset.value = dx;
  }
}

function onPointerUp(event: PointerEvent) {
  if (!isDragging.value) {
    dragStartX.value = 0;
    return;
  }
  const dx = event.clientX - dragStartX.value;
  isDragging.value = false;
  dragOffset.value = 0;
  dragStartX.value = 0;

  if (dx <= -SWIPE_THRESHOLD && page.value < pages.value.length - 1) {
    page.value++;
    teasing.value = false;
    haptic();
  } else if (dx >= SWIPE_THRESHOLD && page.value > 0) {
    page.value--;
    haptic();
  }
}

/** Свайп вернул активную категорию на экран? Активная категория
 *  всегда держится на видимой странице. */
watch(
  () => route.params.slug,
  (slug) => {
    const idx = items.findIndex((item) => item.slug === slug);
    if (idx >= 0) {
      const targetPage = Math.floor(idx / PER_PAGE);
      if (targetPage !== page.value) {
        page.value = targetPage;
        teasing.value = false;
      }
    }
  },
  { immediate: true },
);

const hasActive = computed(() => items.some((item) => isActive(item.slug)));

function isActive(slug: string): boolean {
  return route.params.slug === slug;
}

/* ===== Взрыв частиц: fixed-слой поверх всего =====
   Координаты старта снимаем с фактической позиции иконки
   нажатой кнопки; частицы живут вне панели (её карусель
   обрезает контент) и рендерятся поверх всех блоков. */
const burstActive = ref(false);
const burstOrigin = ref({ x: 0, y: 0 });
const burstParticle = ref("");
let burstTimer: ReturnType<typeof setTimeout> | null = null;
const BURST_MS = 900;

function launchBurst(cat: QuickNavItem, button: HTMLElement) {
  if (prefersReducedMotion()) return;
  let x = 19;
  let y = 30;
  try {
    const rect = button.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) {
      x = rect.left + 19;
      y = rect.top + 30;
    }
  } catch {
    /* измерить не удалось — стартуем из левого верхнего угла панели */
  }
  burstOrigin.value = { x, y };
  burstParticle.value = cat.particle;
  burstKey.value++;
  burstActive.value = true;
  if (burstTimer) clearTimeout(burstTimer);
  burstTimer = setTimeout(() => {
    burstActive.value = false;
    burstTimer = null;
  }, BURST_MS);
}

function select(cat: QuickNavItem, event?: MouseEvent) {
  haptic();
  // Взрыв — от нажатой кнопки, всегда поверх.
  if (event?.currentTarget instanceof HTMLElement) {
    launchBurst(cat, event.currentTarget);
  }
  // Повторная активация той же категории — только эффект, без
  // перезагрузки контента.
  if (isActive(cat.slug)) {
    return;
  }
  emit("select", cat.slug);
  router.replace({ name: "category", params: { slug: cat.slug } });
}

/** Мягкая хаптика как в демо (platform-conditional). */
function haptic() {
  try {
    const tg = window.Telegram?.WebApp;
    if (tg?.platform && tg.platform !== "unknown" && tg.isVersionAtLeast?.("6.1")) {
      tg.HapticFeedback?.impactOccurred("soft");
    }
  } catch {
    /* нет Telegram — без хаптики */
  }
}

// Подсказка-дёргание: через 1.2 с после монтирования панель
// слегка «дёргается», намекая на свайп (класс навешивается на
// дорожку вместе с мерцающим градиентом справа).
const teasingAnimating = ref(false);

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

const timeoutHandles: ReturnType<typeof setTimeout>[] = [];

onMounted(() => {
  const timer = setTimeout(() => {
    if (!teasing.value || !hasMore.value) return;
    if (prefersReducedMotion()) return;
    teasingAnimating.value = true;
  }, 1200);
  timeoutHandles.push(timer);
});

onBeforeUnmount(() => {
  timeoutHandles.forEach(clearTimeout);
  if (burstTimer) clearTimeout(burstTimer);
});

// Отслеживаем смену активной категории (не через панель): взрыв
// запускаем от иконки активной кнопки, если она на видимой странице.
watch(
  () => route.params.slug,
  (slug) => {
    lastActiveSlug.value = (slug as string) ?? null;
  },
  { immediate: true },
);
</script>

<style scoped>
.qnav {
  position: relative;
  width: 100%;
  max-width: 430px;
  margin: 0 auto;
  padding: 12px 8px 16px;
  background: #ffffff;
  border-radius: 20px;
  /* Визуальное отделение от контента: тень сверху панели. */
  box-shadow:
    0 -3px 12px rgba(23, 34, 58, 0.06),
    0 -8px 24px rgba(23, 34, 58, 0.08),
    0 2px 10px rgba(23, 34, 58, 0.04);
  /* Частицы взрыва летят выше панели — не обрезаем.
     Скролл карусели ограничен отдельной обёрткой дорожки. */
  overflow: visible;
  /* Свайп-карусель: тапы по кнопкам не должны выделять текст. */
  touch-action: pan-y;
  user-select: none;
  -webkit-user-select: none;
}

/* Обёртка дорожки: маскирует горизонтальный скролл страниц,
   но прозрачна по вертикали для частиц. */
.qnav__viewport {
  overflow: hidden;
  position: relative;
}

/* ===== Карусельная дорожка ===== */
.qnav__track {
  display: flex;
  /* Плавный переход между страницами; при драге — мгновенно,
     движение ведёт палец (transition отключается классом). */
  transition: transform 0.32s cubic-bezier(0.2, 0.65, 0.3, 1);
}

.qnav--dragging .qnav__track {
  transition: none;
}

.qnav__page {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px 3px;
  flex: 0 0 100%;
  min-width: 0;
}

.qnav__category {
  position: relative;
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  align-items: center;
  justify-content: start;
  gap: 6px;
  height: 60px;
  padding: 8px 7px;
  border: 0;
  appearance: none;
  border-radius: 13px;
  min-width: 0;
  background: transparent;
  color: #303234;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.15s, color 0.15s;
  overflow: visible;
}

.qnav__category:active {
  background: #f5f5f7;
}

.qnav__category:focus-visible {
  outline: 2px solid #e40009;
  outline-offset: 2px;
}

.qnav__label {
  text-align: left;
  font-family: "Montserrat", sans-serif;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  letter-spacing: -0.25px;
}

/* 3D-иконка: в покое цветная, у активной — «белая раскалённая»
   (grayscale + brightness), лёгкий рост и световой ореол. */
.qnav__icon-pair {
  position: relative;
  display: block;
  width: 24px;
  height: 34px;
  font-size: 0;
  line-height: 0;
  isolation: isolate;
}

.qnav__icon-3d {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  transition:
    filter 0.25s ease,
    transform 0.25s cubic-bezier(0.2, 0.65, 0.3, 1);
}

.qnav__category--active {
  color: #fff;
  background: linear-gradient(110deg, #ff0505, #d40000 54%, #9b0000);
}

.qnav__category--active .qnav__icon-3d {
  filter: grayscale(1) brightness(2.6) contrast(0.65) drop-shadow(0 0 2px rgba(255, 255, 255, 0.7));
  transform: scale(1.04);
}

/* Световой ореол вокруг активной иконки — мягкая пульсация. */
.qnav__category--active .qnav__icon-pair::after {
  content: "";
  position: absolute;
  z-index: -1;
  inset: 4px 0;
  border-radius: 50%;
  background: radial-gradient(ellipse, rgba(255, 255, 255, 0.33) 0%, rgba(255, 255, 255, 0.1) 42%, transparent 72%);
  opacity: 0.65;
  animation: qnav-icon-light 2.8s ease-in-out infinite;
  pointer-events: none;
}

@keyframes qnav-icon-light {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.9);
  }
  50% {
    opacity: 0.8;
    transform: scale(1.22);
  }
}

/* Снюс-иконка шире остальных (как в демо data-index="4"). */
.qnav__category[data-index="4"] {
  grid-template-columns: 36px minmax(0, 1fr);
}

.qnav__category[data-index="4"] .qnav__icon-pair {
  width: 36px;
}

/* ===== Подсказка «есть ещё» справа =====
   Мерцающий градиент от белого к прозрачному; панель
   при этом слегка «дёргается» влево, намекая на свайп. */
.qnav__hint {
  position: absolute;
  top: 12px;
  right: 8px;
  bottom: 16px;
  width: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 5;
  /* Сам градиент-мерцание. */
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0) 0%,
    rgba(255, 255, 255, 0.75) 55%,
    rgba(255, 255, 255, 0.95) 100%
  );
  animation: qnav-hint-glow 2.4s ease-in-out infinite;
}

/* Мерцание градиента. */
@keyframes qnav-hint-glow {
  0%,
  100% {
    opacity: 0;
  }
  12% {
    opacity: 1;
  }
  55% {
    opacity: 1;
  }
  70% {
    opacity: 0;
  }
}

/* Лёгкий «дёргающийся» сдвиг дорожки — подсказка, что ряд
   листается. Волна с паузой, работает вместе с мерцанием. */
.qnav__track--teasing {
  animation: qnav-tease 2.4s ease-in-out infinite;
}

@keyframes qnav-tease {
  0%,
  12%,
  70%,
  100% {
    transform: translateX(0);
  }
  22% {
    transform: translateX(12px);
  }
  32% {
    transform: translateX(-6px);
  }
  42% {
    transform: translateX(10px);
  }
  55% {
    transform: translateX(0);
  }
}

/* ===== Точки-индикаторы страниц ===== */
.qnav__dots {
  display: flex;
  justify-content: center;
  gap: 6px;
  margin-top: 8px;
}

.qnav__dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #d5d9e0;
  transition:
    width 0.25s ease,
    background 0.25s ease;
}

.qnav__dot--active {
  width: 14px;
  border-radius: 999px;
  background: #ff0505;
}

/* ===== Позиции кнопок (дальше — глобальные стили частиц) ===== */
@media (max-width: 360px) {
  .qnav {
    padding: 10px 5px 14px;
  }

  .qnav__page {
    gap: 6px 2px;
  }

  .qnav__category {
    grid-template-columns: 20px minmax(0, 1fr);
    gap: 4px;
    padding: 6px 3px;
    height: 56px;
  }

  .qnav__category[data-index="4"] {
    grid-template-columns: 30px minmax(0, 1fr);
  }

  .qnav__category[data-index="4"] .qnav__icon-pair {
    width: 30px;
  }

  .qnav__icon-pair {
    width: 20px;
    height: 32px;
  }

  .qnav__label {
    font-size: 10.5px;
    letter-spacing: -0.3px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .qnav__track {
    transition: none;
  }

  .qnav__category,
  .qnav__icon-3d {
    transition: none;
  }

  .qnav__category--active .qnav__icon-pair::after {
    animation: none;
  }

  .qnav__hint {
    animation: none;
    opacity: 0.9;
  }

  .qnav__track--teasing {
    animation: none;
  }
}
</style>

<style>
/* ===== Глобальные стили взрыва частиц =====
   Частицы телепортируются в body (Teleport) — вне scoped-стилей.
   Fixed от viewport, поверх всех блоков (z-index 1000, как в демо). */
.qnav-piece {
  display: block;
  position: fixed;
  width: 12px;
  height: 18px;
  background: var(--particle) center/contain no-repeat;
  opacity: 0;
  pointer-events: none;
  transform-origin: center;
  z-index: 1000;
  animation: qnav-burst-fall 0.85s linear both;
}

/* Траектории 12 частиц — дословно из демо. */
.qnav-piece-0 { --launch: -190px; --x3: -66.0px; --y1: -60.6px; --y2: -18.2px; --y3: 91.0px;  --r: -58.5deg; }
.qnav-piece-1 { --launch: -208px; --x3: -54.0px; --y1: -43.9px; --y2: -13.2px; --y3: 119.5px; --r: 45.9deg; }
.qnav-piece-2 { --launch: -226px; --x3: -42.0px; --y1: -70.7px; --y2: -21.2px; --y3: 93.5px;  --r: -20.3deg; }
.qnav-piece-3 { --launch: -244px; --x3: -30.0px; --y1: -36.2px; --y2: -10.9px; --y3: 98.7px;  --r: 1.4deg; }
.qnav-piece-4 { --launch: -190px; --x3: -18.0px; --y1: -36.1px; --y2: -10.8px; --y3: 98.0px;  --r: 39.0deg; }
.qnav-piece-5 { --launch: -208px; --x3: -6.0px;  --y1: -56.8px; --y2: -17.0px; --y3: 98.8px;  --r: 23.2deg; }
.qnav-piece-6 { --launch: -226px; --x3: 6.0px;  --y1: -67.4px; --y2: -20.2px; --y3: 90.3px;  --r: 79.5deg; }
.qnav-piece-7 { --launch: -244px; --x3: 18.0px; --y1: -62.9px; --y2: -18.9px; --y3: 103.6px; --r: -89.6deg; }
.qnav-piece-8 { --launch: -190px; --x3: 30.0px; --y1: -73.3px; --y2: -22.0px; --y3: 103.5px; --r: -105.9deg; }
.qnav-piece-9 { --launch: -208px; --x3: 42.0px; --y1: -38.9px; --y2: -11.7px; --y3: 123.9px; --r: 27.0deg; }
.qnav-piece-10 { --launch: -226px; --x3: 54.0px; --y1: -67.3px; --y2: -20.2px; --y3: 119.2px; --r: 9.4deg; }
.qnav-piece-11 { --launch: -244px; --x3: 66.0px; --y1: -73.9px; --y2: -22.2px; --y3: 105.1px; --r: 13.5deg; }

@keyframes qnav-burst-fall {
  0%   { opacity: 0;     transform: translate(0, 0) scale(0.45) rotate(0deg); }
  10%  { opacity: 1;     transform: translate(calc(var(--x3) * 0.1), calc(var(--launch) * 0.085 + 2.5px)) scale(0.78) rotate(calc(var(--r) * 0.1)); }
  20%  { opacity: 1;     transform: translate(calc(var(--x3) * 0.2), calc(var(--launch) * 0.17 + 10.1px)) scale(1) rotate(calc(var(--r) * 0.2)); }
  35%  { opacity: 1;     transform: translate(calc(var(--x3) * 0.35), calc(var(--launch) * 0.2975 + 31px)) scale(1) rotate(calc(var(--r) * 0.35)); }
  50%  { opacity: 1;     transform: translate(calc(var(--x3) * 0.5), calc(var(--launch) * 0.425 + 63.2px)) scale(1) rotate(calc(var(--r) * 0.5)); }
  65%  { opacity: 1;     transform: translate(calc(var(--x3) * 0.65), calc(var(--launch) * 0.5525 + 106.8px)) scale(1) rotate(calc(var(--r) * 0.65)); }
  80%  { opacity: 0.6;   transform: translate(calc(var(--x3) * 0.8), calc(var(--launch) * 0.68 + 162.6px)) scale(1) rotate(calc(var(--r) * 0.8)); }
  100% { opacity: 0;     transform: translate(var(--x3), calc(var(--launch) * 0.85 + 231px)) scale(1) rotate(var(--r)); }
}

@media (prefers-reduced-motion: reduce) {
  .qnav-piece {
    animation: none;
    opacity: 0;
  }
}
</style>
