<template>
  <div class="min-h-screen" style="background: #f5f7fa">
    <SmokeParticles :count="4" area="full" />

    <!-- Баннер -->
    <div v-if="!wholesaleStore.isWholesale && catalogStore.banners.length" class="mb-0 relative banner-wrapper">
      <div class="banner-container relative">
        <BannerCarousel
          :banners="catalogStore.banners"
          :is-loading="catalogStore.isLoading"
          :auto-play="true"
          :auto-play-interval="5000"
        />
      </div>
    </div>

    <div class="main-content-wrapper">
      <!-- Плитки «Избранное» / «Часто покупают» над категориями -->
      <section
        v-if="!wholesaleStore.isWholesale"
        class="home-shortcuts-section"
        aria-label="Быстрые разделы"
      >
        <HomeShortcuts />
      </section>

      <section v-if="wholesaleStore.isWholesale" class="px-4 pt-4">
        <div class="wholesale-mode-card">
          <p class="wholesale-mode-kicker">Оптовый режим</p>
          <p class="wholesale-mode-title">
            {{ wholesaleStore.wholesaleLabel }}
          </p>
          <p class="wholesale-mode-text">
            <template v-if="wholesaleStore.effectiveMinQuantity">
              Минимальное количество заказа -
              {{ wholesaleStore.effectiveMinQuantity }}
              {{ pluralPositions(wholesaleStore.effectiveMinQuantity) }}<span
                v-if="wholesaleStore.minOverride"
              > · персональный минимум</span>.
              <template v-if="remainingWholesaleMinimum > 0">
                Сейчас не хватает {{ remainingWholesaleMinimum }}
                {{ genitivePositions(remainingWholesaleMinimum) }}.
              </template>
              <template v-else>
                Минимум уже выполнен.
              </template>
            </template>
            <template v-else>
              Минимальная сумма заказа - {{ wholesaleStore.minOrderAmount.toFixed(0) }} BYN.
              <template v-if="remainingWholesaleMinimum > 0">
                Сейчас не хватает {{ remainingWholesaleMinimum.toFixed(2) }} BYN.
              </template>
              <template v-else>
                Минимум уже выполнен.
              </template>
            </template>
          </p>
        </div>
      </section>

      <section v-if="activeOrder && !cartStore.editingOrderId" class="active-order-section">
        <button class="active-order-banner" @click="router.push('/my-order')">
          <div class="active-order-copy">
            <span class="active-order-kicker">Активный заказ</span>
            <strong class="active-order-title">Заказ уже оформлен</strong>
            <span class="active-order-text">
              {{
                activeOrder.status === "in_progress"
                  ? "Он уже собран. Откройте заказ, чтобы посмотреть статус или отменить его."
                  : "Откройте заказ, чтобы изменить состав или посмотреть статус."
              }}
            </span>
          </div>
          <span class="active-order-action">Открыть</span>
        </button>
      </section>

      <!-- «Наш ассортимент» из демо: широкая витрина-картинка с
           3D-наклоном по касанию, дымом и дышащим LED; подпись
           снизу. Ведёт в жидкости (раздел по умолчанию). -->
      <section class="assortment-section" aria-label="Наш ассортимент">
        <button
          ref="assortmentRef"
          class="assortment"
          type="button"
          :style="{ '--tilt-x': tiltX, '--tilt-y': tiltY }"
          @click="openAssortment"
          @pointermove="handleAssortmentTilt"
          @pointerleave="resetAssortmentTilt"
        >
          <span class="assortment-picture">
            <span class="assortment-stage">
              <img
                class="assortment-art"
                src="/shortcuts/assortment-art.png"
                alt="Товары из шести категорий: жидкости, расходники, устройства, одноразки, снюс и кальянка"
                loading="lazy"
                decoding="async"
              />
              <span class="hose-smoke" aria-hidden="true">
                <i></i><i></i><i></i><i></i><i></i>
              </span>
              <span class="pod-led" aria-hidden="true"></span>
            </span>
          </span>
          <span class="assortment__label">Наш ассортимент</span>
        </button>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import { useCatalogStore } from "@/stores/catalog";
import { useCartStore } from "@/stores/cart";
import { useWholesaleStore } from "@/stores/wholesale";
import { useFavoritesStore } from "@/stores/favorites";
import HomeShortcuts from "@/components/HomeShortcuts.vue";
import SmokeParticles from "@/components/SmokeParticles.vue";
import BannerCarousel from "@/components/BannerCarousel.vue";
import {
  fetchMyActiveOrder,
  getTelegramIdentity,
  type CustomerActiveOrder,
} from "@/utils/customerOrders";

const catalogStore = useCatalogStore();
const cartStore = useCartStore();
const wholesaleStore = useWholesaleStore();
const favoritesStore = useFavoritesStore();
const router = useRouter();
const activeOrder = ref<CustomerActiveOrder | null>(null);

const remainingWholesaleMinimum = computed(() =>
  wholesaleStore.remainingToMinimum(cartStore.countableWholesaleUnits, cartStore.totalAmount),
);

function pluralPositions(value: number) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return "позиция";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "позиции";
  return "позиций";
}

// «Не хватает N …» — родительный падеж.
function genitivePositions(value: number) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return "позиции";
  return "позиций";
}

/** «Наш ассортимент» всегда открывается в жидкости — раздел по
 *  умолчанию (slug реальной категории каталога); переключение
 *  категорий внутри — быстрая навигация. */
function openAssortment() {
  router.push({ name: "category", params: { slug: "zhidkosti" } });
}

/* ===== 3D-наклон витрины «Наш ассортимент» (по демо) =====
   Только для устройств с мышью (hover + fine pointer): телефон
   наклон по касанию не даёт, там работает пресс-анимация. */
const assortmentRef = ref<HTMLElement | null>(null);
const tiltX = ref("0deg");
const tiltY = ref("0deg");

const canTilt =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(hover: hover) and (pointer: fine)").matches &&
  !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function handleAssortmentTilt(event: PointerEvent) {
  if (!canTilt || !assortmentRef.value) return;
  const rect = assortmentRef.value.getBoundingClientRect();
  tiltX.value = `${((event.clientX - rect.left) / rect.width - 0.5) * 5}deg`;
  tiltY.value = `${-((event.clientY - rect.top) / rect.height - 0.5) * 3}deg`;
}

function resetAssortmentTilt() {
  tiltX.value = "0deg";
  tiltY.value = "0deg";
}

async function refreshHomeState() {
  await catalogStore.initialize();

  if (!cartStore.editingOrderId) {
    try {
      activeOrder.value = await fetchMyActiveOrder(getTelegramIdentity());
    } catch (error) {
      activeOrder.value = null;
      console.warn("[Home] Failed to fetch active order", error);
    }
  } else {
    activeOrder.value = null;
  }
}

onMounted(async () => {
  await refreshHomeState();

  // Избранное грузим один раз за сессию: сердечки и страница берут из стора.
  if (!favoritesStore.isLoaded) {
    void favoritesStore.fetchFavorites();
  }

  // Персональный минимум мог смениться админом среди сессии.
  if (wholesaleStore.isWholesale) {
    void wholesaleStore.refreshEffectiveMinimum();
  }

  if (window.Telegram?.WebApp) {
    window.Telegram.WebApp.ready();
  }
});
</script>

<style scoped>
.banner-wrapper {
  overflow-x: hidden;
  overflow-y: visible;
  padding-top: 20px;
  background-color: #ffffff;
}

.banner-container {
  position: relative;
}

.wholesale-mode-card {
  background: linear-gradient(145deg, #191919 0%, #363636 100%);
  border-radius: 20px;
  padding: 18px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: #ffffff;
}

.wholesale-mode-kicker {
  margin: 0;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 12px;
  line-height: 14px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.58);
}

.wholesale-mode-title {
  margin: 0;
  font-family: "Montserrat", sans-serif;
  font-weight: 700;
  font-size: 18px;
  line-height: 22px;
}

.wholesale-mode-text {
  margin: 0;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 14px;
  line-height: 19px;
  color: rgba(255, 255, 255, 0.78);
}

.active-order-section {
  padding: 12px 16px 0;
}

.active-order-banner {
  width: 100%;
  border: none;
  border-radius: 24px;
  padding: 20px 20px 22px;
  background: linear-gradient(106.76deg, #f50302 -2.64%, #a90f0e 85.78%);
  color: #ffffff;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  text-align: left;
  cursor: pointer;
  box-shadow: 0 8px 16px rgba(97, 1, 0, 0.16);
}

.active-order-copy {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.active-order-kicker {
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 12px;
  line-height: 14px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 227, 226, 0.78);
}

.active-order-title {
  font-family: "Montserrat", sans-serif;
  font-size: 18px;
  line-height: 22px;
  font-weight: 700;
}

.active-order-text {
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 14px;
  line-height: 19px;
  color: #ffd8d7;
  max-width: 270px;
}

.active-order-action {
  flex-shrink: 0;
  min-width: 92px;
  min-height: 48px;
  padding: 0 18px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #ffffff;
  color: #191919;
  font-family: "Montserrat", sans-serif;
  font-size: 14px;
  font-weight: 600;
}

/* ===== «Наш ассортимент» — витрина по демо navalivay-assortment =====
   Стили перенесены ДОСЛОВНО из демо (позиции дыма/LED отсчитываются
   от .assortment-stage с пропорцией 801/360 — совпадает с картинкой
   один в один, поэтому 31.3%/95% и 54.18%/59.17% точны). */
.assortment {
  display: block;
  width: 100%;
  padding: 0;
  background: none;
  border: 0;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  appearance: none;
}

.assortment:focus-visible {
  outline: 3px solid #ed0000;
  outline-offset: 3px;
}

.assortment:active .assortment-picture {
  filter: brightness(0.98);
}

.assortment-picture {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  isolation: isolate;
  width: 100%;
  height: 122px;
  background: linear-gradient(150deg, #fff, #fcfcfd);
  border-radius: 20px;
  overflow: hidden;
  perspective: 700px;
}

/* Мягкие красные рефлексы по углам (демо .assortment-picture:before). */
.assortment-picture::before {
  content: "";
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at 15% 70%, rgba(248, 0, 0, 0.035), transparent 42%),
    radial-gradient(ellipse at 85% 50%, rgba(248, 0, 0, 0.03), transparent 42%);
  pointer-events: none;
}

/* Блик по витрине (демо product-sheen, тач-устройства). */
.assortment-picture::after {
  content: "";
  position: absolute;
  z-index: 2;
  inset: -30px auto -30px -80px;
  width: 65px;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.05) 20%,
    rgba(255, 255, 255, 0.72) 50%,
    rgba(255, 255, 255, 0.05) 80%,
    transparent
  );
  mix-blend-mode: screen;
  transform: translateX(-60px) skewX(-18deg);
  opacity: 0;
  pointer-events: none;
  animation: product-sheen 6s cubic-bezier(0.3, 0.2, 0.5, 1) 0.5s infinite;
}

@keyframes product-sheen {
  0%,
  55% {
    opacity: 0;
    transform: translateX(-60px) skewX(-18deg);
  }
  62% {
    opacity: 0.7;
  }
  87% {
    opacity: 0.7;
  }
  95%,
  100% {
    opacity: 0;
    transform: translateX(560px) skewX(-18deg);
  }
}

/* Сцена с той же пропорцией, что и картинка (801/360): проценты
   дыма и LED отсюда совпадают с пикселями картинки. */
.assortment-stage {
  position: relative;
  display: block;
  flex: none;
  width: 249.2px;
  max-width: calc(100% - 12px);
  aspect-ratio: 801 / 360;
  transform: rotateY(var(--tilt-x, 0deg)) rotateX(var(--tilt-y, 0deg));
  transition: transform 0.4s ease;
  isolation: isolate;
}

.assortment-stage .assortment-art {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  position: relative;
  z-index: 1;
}

.assortment:active .assortment-stage {
  transform: scale(0.975);
  transition: transform 0.15s ease;
}

/* Дым из шланга кальяна — дословно из демо. */
.hose-smoke {
  position: absolute;
  left: 31.3%;
  top: 95%;
  width: 0;
  height: 0;
  z-index: 3;
  pointer-events: none;
}

.hose-smoke i {
  position: absolute;
  left: 0;
  top: -3px;
  width: 30px;
  height: 10px;
  border-radius: 50%;
  background: radial-gradient(
    ellipse,
    rgba(162, 166, 183, 0.87) 0%,
    rgba(184, 188, 202, 0.8) 25%,
    rgba(208, 211, 221, 0.47) 48%,
    transparent 76%
  );
  filter: blur(0.8px);
  opacity: 0;
  transform-origin: left center;
  animation: hose-drift 3s linear infinite;
}

.hose-smoke i:nth-child(2) { animation-delay: -0.6s; }
.hose-smoke i:nth-child(3) { animation-delay: -1.2s; }
.hose-smoke i:nth-child(4) { animation-delay: -1.8s; }
.hose-smoke i:nth-child(5) { animation-delay: -2.4s; }

@keyframes hose-drift {
  0% {
    opacity: 0;
    transform: translate(0, 0) scale(0.3, 0.45) rotate(-4deg);
  }
  15% {
    opacity: 0.8;
  }
  45% {
    opacity: 0.65;
    transform: translate(18px, -5px) scale(1.1, 1) rotate(-12deg);
  }
  75% {
    opacity: 0.3;
    transform: translate(34px, -16px) scale(1.7, 1.7) rotate(-20deg);
  }
  100% {
    opacity: 0;
    transform: translate(48px, -29px) scale(2, 2.2) rotate(-28deg);
  }
}

/* Дышащий LED на под-системе — дословно из демо. */
.pod-led {
  position: absolute;
  z-index: 4;
  left: 54.18%;
  top: 59.17%;
  transform: translate(-50%, -50%);
  width: 1%;
  height: 10.5%;
  border-radius: 999px;
  background: #fff4ee;
  box-shadow:
    0 0 3px 1px #fff1e6,
    0 0 6px 2px #ff2222,
    0 0 12px 5px rgba(255, 0, 0, 0.67),
    0 0 21px 7px rgba(255, 0, 0, 0.3);
  opacity: 0.65;
  pointer-events: none;
  animation: pod-breathe 3s ease-in-out infinite;
}

@keyframes pod-breathe {
  0%,
  100% {
    opacity: 0.45;
  }
  50% {
    opacity: 1;
  }
}

/* Подпись: 1в1 с плитками «Избранное»/«Часто покупают» —
   Montserrat 600 (в демо был тонкий Arial-medium). */
.assortment__label {
  display: block;
  font-family: "Montserrat", sans-serif;
  font-size: 13px;
  font-weight: 600;
  line-height: 17px;
  letter-spacing: -0.25px;
  margin-top: 9px;
  text-align: center;
  color: #000000;
}

/* Десктоп с мышью: наклон вместо блика (как в демо). */
@media (hover: hover) and (pointer: fine) {
  .assortment-picture::after {
    display: none;
    animation: none;
  }
}

@media (max-width: 350px) {
  .assortment-picture {
    height: 106px;
    border-radius: 18px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .assortment-picture::after {
    animation: none;
  }

  .hose-smoke {
    display: none;
  }

  .pod-led {
    animation: none;
    opacity: 0.6;
  }

  .assortment-stage {
    transition: none;
    transform: none !important;
  }
}
/* Main Content Wrapper: нижний отступ — только safe-area
   (футер и нижняя кнопка корзины удалены). */
.main-content-wrapper {
  max-width: 1280px;
  margin: 0 auto;
  padding: 0 16px calc(24px + env(safe-area-inset-bottom, 0px)) 16px;
  position: relative;
  z-index: 10;
}

.assortment-section {
  position: relative;
  min-height: 0;
  margin-top: 1rem;
  width: 100%;
  box-sizing: border-box;
}
</style>
