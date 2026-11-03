<template>
  <div ref="paneRef" class="home-pane">
    <!-- Поиск -->
    <section class="home-section">
      <form class="home-search" role="search" @submit.prevent="submitSearch">
        <span class="home-search__icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <circle cx="10.5" cy="10.5" r="6.5" stroke="#8A94A0" stroke-width="1.8" />
            <line
              x1="15.5"
              y1="15.5"
              x2="20"
              y2="20"
              stroke="#8A94A0"
              stroke-width="1.8"
              stroke-linecap="round"
            />
          </svg>
        </span>
        <input
          v-model="searchText"
          class="home-search__input"
          type="search"
          inputmode="search"
          placeholder="Поиск по каталогу"
          aria-label="Поиск по каталогу"
          enterkeyhint="search"
        />
      </form>
    </section>

    <!-- Лояльность: мини-прогресс скидочной системы -->
    <section v-if="loyaltyCard" class="home-section">
      <button class="loyalty-mini" @click="router.push('/profile')">
        <span class="loyalty-mini__badge">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
              fill="#fff"
            />
          </svg>
        </span>
        <span class="loyalty-mini__copy">
          <span class="loyalty-mini__row">
            <strong class="loyalty-mini__title">Скидка {{ loyaltyDiscountLabel }}</strong>
            <span v-if="loyaltyBonusesLabel" class="loyalty-mini__bonuses">
              {{ loyaltyBonusesLabel }}
            </span>
          </span>
          <span class="loyalty-mini__track">
            <span
              class="loyalty-mini__fill"
              :style="{ width: `${loyaltyProgressPercent}%` }"
            ></span>
          </span>
          <span class="loyalty-mini__hint">{{ loyaltyHint }}</span>
        </span>
        <svg class="loyalty-mini__chevron" width="8" height="14" viewBox="0 0 8 14" fill="none">
          <path
            d="M1 1L7 7L1 13"
            stroke="#AAB2BD"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </section>

    <!-- Активный заказ -->
    <section v-if="activeOrder && !cartStore.editingOrderId" class="home-section">
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

    <!-- Оптовый режим -->
    <section v-if="wholesaleStore.isWholesale" class="home-section">
      <div class="wholesale-mode-card">
        <p class="wholesale-mode-kicker">Оптовый режим</p>
        <p class="wholesale-mode-title">{{ wholesaleStore.wholesaleLabel }}</p>
        <p class="wholesale-mode-text">
          <template v-if="wholesaleStore.effectiveMinQuantity">
            Минимальное количество заказа -
            {{ wholesaleStore.effectiveMinQuantity }}
            {{ pluralPositions(wholesaleStore.effectiveMinQuantity) }}<span
              v-if="wholesaleStore.minOverride"
              > · персональный минимум</span
            >.
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

    <!-- Быстрые ссылки: избранное по макету favorites.html + рулетка-мини -->
    <section v-if="!wholesaleStore.isWholesale" class="home-section">
      <!-- Избранное: утверждённый макет 1в1 -->
      <router-link
        to="/favorites"
        class="favorites"
        aria-label="Открыть избранное"
      >
        <img
          class="favorites__sticker"
          src="/img/favorites-sticker.webp"
          alt=""
          draggable="false"
        />
        <span class="favorites__title">Избранное</span>
        <svg
          class="favorites__arrow"
          viewBox="0 0 24 42"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M3 3 21 21 3 39" />
        </svg>
      </router-link>

      <!-- Мини-рулетка: баланс спинов + компактное колесо -->
      <router-link to="/wheel" class="wheel-mini">
        <span class="wheel-mini__wheel" aria-hidden="true">
          <svg viewBox="0 0 64 64" fill="none">
            <circle cx="32" cy="32" r="29" stroke="#191919" stroke-width="3" />
            <g class="wheel-mini__spokes">
              <line x1="32" y1="3" x2="32" y2="61" stroke="#191919" stroke-width="2" />
              <line x1="3" y1="32" x2="61" y2="32" stroke="#191919" stroke-width="2" />
              <line x1="11" y1="11" x2="53" y2="53" stroke="#191919" stroke-width="2" />
              <line x1="53" y1="11" x2="11" y2="53" stroke="#191919" stroke-width="2" />
            </g>
            <circle cx="32" cy="32" r="7" fill="#F50302" />
            <circle cx="32" cy="32" r="7" stroke="#191919" stroke-width="2" />
          </svg>
        </span>
        <span class="wheel-mini__copy">
          <strong class="wheel-mini__title">Рулетка</strong>
          <span v-if="wheelSpins > 0" class="wheel-mini__text">
            {{ wheelSpins }} {{ pluralSpins(wheelSpins) }} — крути!
          </span>
          <span v-else class="wheel-mini__text">Выигрывай призы каждый день</span>
        </span>
        <svg class="wheel-mini__chevron" width="8" height="14" viewBox="0 0 8 14" fill="none">
          <path
            d="M1 1L7 7L1 13"
            stroke="#AAB2BD"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </router-link>
    </section>

    <!-- Лента «Чаще покупают»: топ товаров, свайпается как сторис -->
    <section v-if="!wholesaleStore.isWholesale && topProducts.length" class="home-section">
      <h2 class="home-row-title">Чаще покупают</h2>
      <div class="top-products" ref="topRowRef">
        <button
          v-for="product in topProducts"
          :key="product.id"
          class="top-product"
          @click="openProduct(product)"
        >
          <span
            class="top-product__media"
            :style="product.image ? { backgroundImage: `url(${product.image})` } : {}"
          >
            <svg
              v-if="!product.image"
              width="30"
              height="30"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#C7CDD4"
              stroke-width="1.5"
            >
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </span>
          <span class="top-product__copy">
            <strong class="top-product__name">{{ product.title }}</strong>
            <span class="top-product__price">{{ product.priceLabel }}</span>
          </span>
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import { useCatalogStore, type Product } from "@/stores/catalog";
import { useCartStore } from "@/stores/cart";
import { useWholesaleStore } from "@/stores/wholesale";
import { useFavoritesStore } from "@/stores/favorites";
import { useLoyaltyStore, type LoyaltySnapshotCategory } from "@/stores/loyalty";
import { useWheelStore } from "@/stores/wheel";
import {
  fetchMyActiveOrder,
  getTelegramIdentity,
  type CustomerActiveOrder,
} from "@/utils/customerOrders";

/**
 * Главная вкладка: поиск, лояльность, активный заказ, опт-плашка,
 * избранное (макет favorites.html 1в1), мини-рулетка, топ-товары.
 * Все данные предзагружены сплэшем — рендер мгновенный.
 */
defineProps<{
  isActive?: boolean;
}>();

const catalogStore = useCatalogStore();
const cartStore = useCartStore();
const wholesaleStore = useWholesaleStore();
const favoritesStore = useFavoritesStore();
const loyaltyStore = useLoyaltyStore();
const wheelStore = useWheelStore();
const router = useRouter();
const paneRef = ref<HTMLElement | null>(null);
const topRowRef = ref<HTMLElement | null>(null);
const activeOrder = ref<CustomerActiveOrder | null>(null);
const searchText = ref("");

const favoritesCount = computed(() => favoritesStore.inStockItems.length);

/* ===== Поиск ===== */

function submitSearch() {
  const query = searchText.value.trim();
  if (!query) return;
  router.push({ name: "search-results", query: { q: query } });
}

/* ===== Рулетка ===== */

const wheelSpins = computed(() => wheelStore.balance.spins_available);

function pluralSpins(value: number) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return "спин";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "спина";
  return "спинов";
}

/* ===== Топ-товары ===== */

interface TopProductCard {
  id: string;
  title: string;
  priceLabel: string;
  image: string | null;
  product: Product;
}

const topProducts = computed<TopProductCard[]>(() => {
  // Из предзагруженного каталога: товары в наличии, сортировка —
  // простая эвристика (наличие вариантов/популярность недоступна без
  // отдельного API на главной — берём товары с фото).
  const products = catalogStore.allProducts
    .filter((p) => p.minStock === null || p.minStock === undefined || p.minStock > 0)
    .filter((p) => p.images?.[0])
    .slice(0, 12);

  return products.map((product) => {
    const price = product.variants?.[0]?.priceRub ?? product.priceRub ?? 0;
    return {
      id: product.id,
      title: product.title,
      priceLabel: `${Number(price).toFixed(2)} BYN`,
      image: product.images?.[0] ?? null,
      product,
    };
  });
});

function openProduct(card: TopProductCard) {
  catalogStore.currentProduct = card.product;
  router.push({ name: "product", params: { id: card.product.id } });
}

/* ===== Лояльность ===== */

const LOYALTY_CATEGORY_ORDER = ["liquids", "disposables", "devices"];

/** Основная категория лояльности: приоритет активной, иначе первая по порядку. */
const loyaltyCard = computed<LoyaltySnapshotCategory | null>(() => {
  const snapshot = loyaltyStore.snapshot;
  if (!snapshot.length) return null;
  const active = snapshot.find((item) => Number(item.active));
  if (active) return active;
  const sorted = [...snapshot].sort((left, right) => {
    const leftIndex = LOYALTY_CATEGORY_ORDER.indexOf(left.key);
    const rightIndex = LOYALTY_CATEGORY_ORDER.indexOf(right.key);
    const normalizedLeft = leftIndex === -1 ? 99 : leftIndex;
    const normalizedRight = rightIndex === -1 ? 99 : rightIndex;
    if (normalizedLeft !== normalizedRight) {
      return normalizedLeft - normalizedRight;
    }
    return left.title.localeCompare(right.title, "ru");
  });
  return sorted[0] ?? null;
});

const loyaltyProgressPercent = computed(() => {
  const card = loyaltyCard.value;
  if (!card) return 0;
  const threshold = Number(card.threshold || 0);
  if (!threshold) return 0;
  const balance = Number(card.balance || 0);
  const current = balance % threshold === 0 && balance > 0 ? threshold : balance % threshold;
  return Math.round((current / threshold) * 100);
});

const loyaltyDiscountLabel = computed(() => {
  const card = loyaltyCard.value;
  if (!card) return "";
  const amount = Number(card.discount_amount || 0);
  const available = Number(card.available_bonus_count || 0);
  return available > 0 ? `${amount} BYN готова` : `${amount} BYN`;
});

const loyaltyBonusesLabel = computed(() => {
  const available = loyaltyStore.snapshot.reduce(
    (sum, item) => sum + Number(item.available_bonus_count || 0),
    0,
  );
  return available > 0 ? `${available} к применению` : "";
});

const loyaltyHint = computed(() => {
  const card = loyaltyCard.value;
  if (!card) return "";
  const available = Number(card.available_bonus_count || 0);
  if (available > 0) {
    return `Скидка ${card.discount_amount} BYN ждёт в корзине`;
  }
  const threshold = Number(card.threshold || 0);
  const balance = Number(card.balance || 0);
  const remaining = Number(card.remaining_to_next || 0);
  if (remaining <= 0 && threshold > 0) return "Скидка почти готова";
  const current = threshold > 0 ? balance % threshold : 0;
  return `${current} / ${threshold} покупок — осталось ${remaining}`;
});

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

function genitivePositions(value: number) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return "позиции";
  return "позиций";
}

async function refreshHomeState() {
  if (!catalogStore.categories.length) {
    await catalogStore.initialize();
  }

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

  // Баланс рулетки подтягиваем тихо (кэшируется в сторе).
  if (!wheelStore.lastFetchedAt) {
    void wheelStore.fetchState().catch(() => undefined);
  }

  if (wholesaleStore.isWholesale) {
    void wholesaleStore.refreshEffectiveMinimum();
  }

  if (window.Telegram?.WebApp) {
    window.Telegram.WebApp.ready();
  }
});
</script>

<style scoped>
.home-pane {
  min-height: 100%;
  background: #f5f7fa;
  padding: 14px 16px calc(var(--app-bottom-tab-bar-height, 52px) + 24px);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.home-section {
  animation: home-rise 0.42s cubic-bezier(0.22, 1, 0.36, 1) both;
}

.home-section:nth-child(2) {
  animation-delay: 0.05s;
}

.home-section:nth-child(3) {
  animation-delay: 0.1s;
}

.home-section:nth-child(4) {
  animation-delay: 0.15s;
}

.home-section:nth-child(5) {
  animation-delay: 0.2s;
}

.home-section:nth-child(6) {
  animation-delay: 0.25s;
}

@keyframes home-rise {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/* ===== Активный заказ ===== */

.active-order-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 14px 16px;
  background: #fff;
  border: 1px solid rgba(25, 25, 25, 0.06);
  border-radius: 16px;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.15s ease, box-shadow 0.2s ease;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
}

.active-order-banner:active {
  transform: scale(0.98);
}

.active-order-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}

.active-order-kicker {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #f50302;
}

.active-order-title {
  font-size: 15px;
  font-weight: 700;
  color: #191919;
  letter-spacing: -0.01em;
}

.active-order-text {
  font-size: 12.5px;
  line-height: 1.45;
  color: #7b8794;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.active-order-action {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  height: 32px;
  padding: 0 14px;
  border-radius: 10px;
  background: #191919;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

/* ===== Оптовая плашка ===== */

.wholesale-mode-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  padding: 14px 16px;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
}

.wholesale-mode-kicker {
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #f50302;
}

.wholesale-mode-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: #191919;
  letter-spacing: -0.01em;
}

.wholesale-mode-text {
  margin: 2px 0 0;
  font-size: 12.5px;
  line-height: 1.5;
  color: #7b8794;
}

@media (prefers-reduced-motion: reduce) {
  .home-section {
    animation: none;
  }
}

/* ===== Поиск ===== */

.home-search {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 44px;
  padding: 0 14px;
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
  transition: box-shadow 0.2s ease;
}

.home-search:focus-within {
  box-shadow: 0 2px 12px rgba(16, 24, 40, 0.08);
}

.home-search__icon {
  display: flex;
  flex: 0 0 auto;
}

.home-search__input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: none;
  font-size: 15px;
  color: #191919;
  font-family: inherit;
}

.home-search__input::placeholder {
  color: #98a1ac;
}

.home-search__input::-webkit-search-cancel-button {
  -webkit-appearance: none;
}

/* ===== Лояльность ===== */

.loyalty-mini {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 14px 16px;
  background: #fff;
  border: none;
  border-radius: 16px;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.15s ease, box-shadow 0.2s ease;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
}

.loyalty-mini:active {
  transform: scale(0.98);
}

.loyalty-mini__badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 11px;
  background: linear-gradient(135deg, #f50302, #d30707);
  flex: 0 0 auto;
}

.loyalty-mini__copy {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.loyalty-mini__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.loyalty-mini__title {
  font-size: 15px;
  font-weight: 700;
  color: #191919;
  letter-spacing: -0.01em;
  white-space: nowrap;
}

.loyalty-mini__bonuses {
  font-size: 12px;
  font-weight: 600;
  color: #f50302;
  white-space: nowrap;
}

.loyalty-mini__track {
  display: block;
  width: 100%;
  height: 4px;
  border-radius: 2px;
  background: rgba(25, 25, 25, 0.06);
  overflow: hidden;
}

.loyalty-mini__fill {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: linear-gradient(90deg, #f50302, #d30707);
  transition: width 0.6s cubic-bezier(0.22, 1, 0.36, 1);
}

.loyalty-mini__hint {
  font-size: 12px;
  color: #7b8794;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.loyalty-mini__chevron {
  flex: 0 0 auto;
}

/* ===== Избранное: макет favorites.html 1в1 ===== */

.favorites {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 778 / 146;
  padding: 0;
  border: 0;
  border-radius: 4.756% / 25.342%;
  background: #fff;
  color: #080808;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
  cursor: pointer;
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;
  appearance: none;
  container-type: inline-size;
  transition: transform 0.15s ease;
}

.favorites:active {
  transform: scale(0.98);
}

.favorites:focus-visible {
  outline: 3px solid #ed0000;
  outline-offset: 4px;
}

.favorites__sticker {
  position: absolute;
  left: 7.712%;
  top: 2.74%;
  width: 16.71%;
  height: 94.52%;
  display: block;
  overflow: hidden;
  pointer-events: none;
  object-fit: cover;
}

.favorites__title {
  position: absolute;
  left: 31.105%;
  top: 50%;
  transform: translateY(-50%);
  margin: 0;
  white-space: nowrap;
  font-size: 5.6555cqi;
  line-height: 1;
  font-weight: 700;
  letter-spacing: -0.08cqi;
}

.favorites__arrow {
  position: absolute;
  left: 92.03%;
  top: 35.62%;
  width: 3.085%;
  height: 28.77%;
  fill: none;
  stroke: #969696;
  stroke-width: 4;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* ===== Мини-рулетка ===== */

.wheel-mini {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  background: #fff;
  border-radius: 16px;
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.15s ease;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
}

.wheel-mini:active {
  transform: scale(0.98);
}

.wheel-mini__wheel {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: #f5f7fa;
  flex: 0 0 auto;
}

.wheel-mini__wheel svg {
  width: 40px;
  height: 40px;
}

/* Живое колесо: постоянное медленное вращение спиц */
.wheel-mini__spokes {
  animation: wheel-rotate 9s linear infinite;
  transform-origin: 32px 32px;
}

@keyframes wheel-rotate {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .wheel-mini__spokes {
    animation: none;
  }
}

.wheel-mini__copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.wheel-mini__title {
  font-size: 15px;
  font-weight: 600;
  color: #191919;
  letter-spacing: -0.01em;
}

.wheel-mini__text {
  font-size: 13px;
  color: #7b8794;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wheel-mini__chevron {
  flex: 0 0 auto;
}

/* ===== Топ-товары ===== */

.home-row-title {
  margin: 6px 2px 0;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #191919;
}

.top-products {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding: 10px 2px 6px;
  scrollbar-width: none;
  -ms-overflow-style: none;
  overscroll-behavior-x: contain;
  -webkit-overflow-scrolling: touch;
}

.top-products::-webkit-scrollbar {
  display: none;
}

.top-product {
  display: flex;
  flex-direction: column;
  flex: 0 0 auto;
  width: 128px;
  border: none;
  background: #fff;
  border-radius: 16px;
  padding: 0 0 10px;
  cursor: pointer;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.15s ease;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
  overflow: hidden;
}

.top-product:active {
  transform: scale(0.96);
}

.top-product__media {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 128px;
  height: 128px;
  background: #f5f7fa center / cover no-repeat;
}

.top-product__copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px 0;
  min-width: 0;
}

.top-product__name {
  font-size: 12.5px;
  font-weight: 600;
  color: #191919;
  line-height: 1.25;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.top-product__price {
  font-size: 13px;
  font-weight: 700;
  color: #191919;
}
</style>
