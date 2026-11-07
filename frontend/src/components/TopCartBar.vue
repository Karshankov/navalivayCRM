<template>
  <header class="nav-topbar" :class="{ 'nav-topbar--admin': isAdmin }">
    <button
      ref="cartBarRef"
      type="button"
      class="nav-top-cart"
      :class="{ 'nav-top-cart--expanded': expandedVisual, 'nav-top-cart--bump': bumping }"
      data-navalivay-cart-bar
      :aria-label="
        expandedVisual ? 'Открыть корзину и оформить заказ' : 'Открыть корзину'
      "
      @click="goToCheckout"
    >
      <svg
        ref="cartIconRef"
        class="nav-top-cart__icon"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M3 4h2l2.2 11h11.6L21 7H6"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <circle cx="9" cy="20" r="1" fill="none" stroke="currentColor" stroke-width="1.5" />
        <circle cx="18" cy="20" r="1" fill="none" stroke="currentColor" stroke-width="1.5" />
      </svg>
      <span class="nav-top-cart__label">
        <span class="nav-top-cart__title">Заказ на {{ formattedAmount }} BYN</span>
        <span class="nav-top-cart__hint">Нажмите, чтобы оформить</span>
      </span>
    </button>

    <button
      v-if="isHomeRoute"
      type="button"
      class="nav-top-profile"
      aria-label="Открыть профиль"
      @click="goToProfile"
    >
      <span class="nav-top-profile__copy">Мой профиль</span>
      <span class="nav-top-profile__avatar">
        <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <circle cx="16" cy="11" r="5" stroke="currentColor" stroke-width="1.5" />
          <path d="M6 28v-3a10 10 0 0 1 20 0v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
      </span>
    </button>

    <!-- На всех экранах кроме главного — «На главную»: из разделов
         всегда есть быстрый выход к витрине. -->
    <button
      v-else
      type="button"
      class="nav-top-profile"
      aria-label="Вернуться на главную"
      @click="goHome"
    >
      <span class="nav-top-profile__copy">На главную</span>
      <span class="nav-top-profile__avatar nav-top-profile__avatar--back">
        <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <path d="M20 8l-8 8 8 8" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>
    </button>
  </header>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useCartFlight } from "@/composables/useCartFlight";

/**
 * Верхняя панель по демо-образцу: корзина слева, «Мой профиль» с
 * аватаркой справа; при раскрытии корзины справа ничего не смещается.
 * Панель закреплена (16px + safe-area), контент страницы не перекрыт
 * (App.vue резервирует высоту sizer'ом).
 */

const props = defineProps<{
  /** Панель рендерится только на витринных экранах (App.vue). */
  visible: boolean;
}>();
void props;

const route = useRoute();
// В юнит-тестах App.vue vue-router замокан без useRouter — навигация
// из панели тогда просто недоступна, панень не должна падать.
const routerRef = (() => {
  try {
    return useRouter();
  } catch {
    return null;
  }
})();
const cartBarRef = ref<HTMLElement | null>(null);
/** Иконка корзины — точная цель прилёта миниатюр (не центр плашки). */
const cartIconRef = ref<HTMLElement | null>(null);

// Раскрытием плашки и суммой управляет композабл useCartFlight —
// единое состояние для top-bar и карточек. expandedVisual отстаёт
// от данных на время полёта: красный овал раскрывается, когда
// миниатюра почти долетела.
const {
  expandedVisual,
  arrivalTick,
  totalAmount,
  registerCartFlyTarget,
  syncExpandedVisualOnMount,
} = useCartFlight();

/** Сумма из настоящего состояния корзины. Копеек нет: 25.00 → «25»,
 *  целая часть выводится как есть (20 → «20», 20.5 → «20.5»). */
const formattedAmount = computed(() => {
  const value = totalAmount.value;
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
});

const isAdmin = computed(() => route.path.startsWith("/admin"));

/** «Мой профиль» — только на главном экране; на остальных
 *  (ассортимент, избранное, профиль, рулетка...) — «На главную». */
const isHomeRoute = computed(() => route.path === "/");

function goToCheckout() {
  routerRef?.push("/checkout");
}

function goToProfile() {
  routerRef?.push("/profile");
}

function goHome() {
  routerRef?.push("/");
}

// Раскрытием управляет композабл: пустая корзина возвращает обычную
// иконку, любое наполнение держит плашку раскрытой.

// Мягкий отклик плашки на прилёт: масштаб 1 → 1.03 → 1 (~320 мс),
// без тряски. Реализован классом-модификатором, снимается по окончании.
let bumpTimer: ReturnType<typeof setTimeout> | null = null;
const bumping = ref(false);
watch(arrivalTick, () => {
  bumping.value = true;
  if (bumpTimer) clearTimeout(bumpTimer);
  bumpTimer = setTimeout(() => {
    bumping.value = false;
  }, 320);
});

function syncCartTarget() {
  // Полёт целится в иконку корзины, как в демо; на кнопку оставляем
  // фолбэк (иконка всегда внутри кнопки).
  registerCartFlyTarget(cartIconRef.value ?? cartBarRef.value);
  // Возврат на экран с непустой корзиной (localStorage / назад из
  // чекаута): плашка раскрыта сразу, полёта ждать нечего.
  syncExpandedVisualOnMount();
}

onMounted(syncCartTarget);
onBeforeUnmount(() => {
  if (bumpTimer) clearTimeout(bumpTimer);
});
</script>

<style scoped>
.nav-topbar {
  position: fixed;
  z-index: 60;
  top: calc(16px + env(safe-area-inset-top, 0px));
  left: 50%;
  transform: translateX(-50%);
  width: min(calc(100% - 24px), 424px);
  height: 54px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  box-sizing: border-box;
  /* Панель плотнее и контрастнее: менее прозрачный белый +
     заметная многослойная тень, чтобы не сливалась с контентом. */
  background: rgba(255, 255, 255, 0.97);
  backdrop-filter: blur(12px);
  border-radius: 14px;
  box-shadow:
    0 2px 8px rgba(28, 43, 69, 0.08),
    0 6px 18px rgba(28, 43, 69, 0.1),
    0 14px 32px rgba(28, 43, 69, 0.08);
}

/* Корзина слева: овал красный при раскрытии, обычная иконка при пустой.
   Ширина растёт с суммой, но не теснит блок профиля (max-width),
   текст обрезается эллипсисом. Внутренние отступы симметричны
   скруглению овала: справа тексту всегда 14px воздуха.

   Раскрытие — единая плавная волна без задержек внутри: овал,
   перекраска иконки и текст стартуют одновременно (expandedVisual
  уже отложен до прилёта миниатюры в композабле). */
.nav-top-cart {
  position: relative;
  isolation: isolate;
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 1 auto;
  min-width: 44px;
  max-width: 62%;
  height: 44px;
  padding: 0 14px;
  border: none;
  border-radius: 999px;
  background: transparent;
  overflow: hidden;
  cursor: pointer;
  transition: max-width 0.42s cubic-bezier(0.2, 0.65, 0.3, 1);
}

.nav-top-cart--expanded {
  min-width: 178px;
}

.nav-top-cart__icon {
  width: 20px;
  height: 20px;
  flex: none;
  margin-left: 0;
  fill: none;
  color: #080808;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  /* Цвет иконки перекрашивается в такт проявлению овала. */
  transition: color 0.42s cubic-bezier(0.2, 0.65, 0.3, 1);
}

.nav-top-cart--expanded .nav-top-cart__icon {
  color: #fff;
}

/* Красный овал: проявляется и растёт слева направо из центра
   иконки (24px от левого края с учётом паддинга). Цвет приходит
   одновременно с формой — без «чёрная иконка → красная плашка». */
.nav-top-cart::before {
  content: "";
  position: absolute;
  z-index: -1;
  inset: 0;
  border-radius: 999px;
  background: linear-gradient(105deg, #ff0505, #b6090b);
  opacity: 0;
  transform: scaleX(0.55);
  transform-origin: 24px center;
  transition:
    transform 0.42s cubic-bezier(0.2, 0.65, 0.3, 1),
    opacity 0.42s cubic-bezier(0.2, 0.65, 0.3, 1);
  pointer-events: none;
}

.nav-top-cart--expanded::before {
  opacity: 1;
  transform: scaleX(1);
}

/* Текст: обе строки от одного левого края, центрированная группа.
   Появляется по следам овала — чуть позже, чтобы не накладываться
   на его движение. Длинные суммы обрезаются эллипсисом. */
.nav-top-cart__label {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 1px;
  line-height: 1.05;
  white-space: nowrap;
  min-width: 0;
  opacity: 0;
  transform: translateX(-4px);
  pointer-events: none;
  color: #fff;
  transition:
    opacity 0.32s ease 0.18s,
    transform 0.36s cubic-bezier(0.2, 0.65, 0.3, 1) 0.12s;
}

.nav-top-cart--expanded .nav-top-cart__label {
  opacity: 1;
  transform: none;
}

.nav-top-cart__title {
  font-family: "Montserrat", sans-serif;
  font-size: 12px;
  font-weight: 600;
  line-height: 14px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nav-top-cart__hint {
  font-family: "SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 9px;
  font-weight: 400;
  line-height: 11px;
  letter-spacing: -0.05px;
  color: rgba(255, 255, 255, 0.72);
}

/* Белый блик: мягкая полупрозрачная волна раз в ~4.8 с. */
.nav-top-cart::after {
  content: "";
  position: absolute;
  inset: -20px auto -20px 0;
  width: 48px;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.03) 15%,
    rgba(255, 255, 255, 0.3) 50%,
    rgba(255, 255, 255, 0.03) 85%,
    transparent
  );
  transform: translateX(-65px) skewX(-22deg);
  opacity: 0;
  pointer-events: none;
}

.nav-top-cart--expanded::after {
  animation: nav-cart-sheen 4.8s linear 1.15s infinite;
}

@keyframes nav-cart-sheen {
  0% {
    opacity: 0;
    transform: translateX(-65px) skewX(-22deg);
  }
  5% {
    opacity: 0.85;
  }
  25% {
    opacity: 0.85;
  }
  30% {
    opacity: 0;
    transform: translateX(200px) skewX(-22deg);
  }
  100% {
    opacity: 0;
    transform: translateX(200px) skewX(-22deg);
  }
}

/* Отклик на прилёт: мягкий масштаб, без тряски. */
.nav-top-cart.nav-top-cart--bump {
  animation: nav-cart-bump 0.32s ease-out both;
}

@keyframes nav-cart-bump {
  0%,
  100% {
    transform: scale(1);
  }
  40% {
    transform: scale(1.03);
  }
}

/* Профиль справа: всегда виден и не смещается при раскрытии. */
.nav-top-profile {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 9px;
  background: none;
  border: none;
  padding: 0;
  flex: 1;
  min-width: 0;
  height: 44px;
  cursor: pointer;
}
.nav-top-profile__copy {
  font-family: "SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 14px;
  font-weight: 400;
  letter-spacing: -0.15px;
  white-space: nowrap;
  color: #080808;
}

.nav-top-profile__avatar {
  width: 32px;
  height: 32px;
  flex: none;
  background: #f0f2f6;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #a2a7b0;
}

.nav-top-profile__avatar svg {
  width: 21px;
  height: 21px;
  fill: none;
}

/* Кнопка «На главную» на экране профиля: тёмный кружок со стрелкой
   назад того же размера, что аватарка — кнопка не меняет геометрию
   панели при смене экрана. */
.nav-top-profile__avatar--back {
  background: #191919;
  color: #ffffff;
}

.nav-top-profile__avatar--back svg {
  width: 18px;
  height: 18px;
  margin-left: -2px;
}

@media (max-width: 350px) {
  .nav-top-profile__copy {
    font-size: 12px;
  }

  .nav-top-profile {
    gap: 6px;
  }

  .nav-top-profile__avatar {
    width: 28px;
    height: 28px;
  }

  /* Узкие экраны: плашка компактнее, сумма эллипсисом. */
  .nav-top-cart {
    max-width: 54%;
    padding: 0 10px;
  }

  .nav-top-cart--expanded {
    min-width: 150px;
  }

  .nav-top-cart__title {
    font-size: 11px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .nav-top-cart,
  .nav-top-cart__icon,
  .nav-top-cart::before,
  .nav-top-cart__label {
    transition: none;
  }

  .nav-top-cart--expanded::after {
    animation: none;
  }
}
</style>
