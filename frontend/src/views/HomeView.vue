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
      <section v-if="wholesaleStore.isWholesale" class="px-4 pt-4">
        <div class="wholesale-mode-card">
          <p class="wholesale-mode-kicker">Оптовый режим</p>
          <p class="wholesale-mode-title">
            {{ wholesaleStore.wholesaleLabel }}
          </p>
          <p class="wholesale-mode-text">
            Минимальный заказ - {{ wholesaleStore.minOrderAmount.toFixed(0) }} BYN.
            <template v-if="remainingWholesaleAmount > 0">
              Сейчас не хватает {{ remainingWholesaleAmount.toFixed(2) }} BYN.
            </template>
            <template v-else>
              Минимум уже выполнен.
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

      <section class="category-section">
        <!-- Сетка категорий -->
        <div class="category-grid">
          <button
            v-for="category in categoryCards"
            :key="category.id"
            class="category-card-wrapper"
            @click="openCategory(category.slug)"
          >
            <div class="category-card-box">
              <div
                class="category-card-media"
                :style="{ backgroundImage: `url(${category.previewImage})` }"
              ></div>
              <DiscountBadge v-if="category.hasDiscount" class="category-card-discount" />
            </div>
            <p class="category-card-title">{{ category.name }}</p>
          </button>
        </div>
      </section>
    </div>

    <!-- Cart Button - Figma Redesign -->
    <Transition name="cart-slide">
      <div v-if="totalCartItems > 0 && !wholesaleStore.isWholesale" class="cart-wrapper">
        <button class="cart-button" @click="goToCheckout">
          <svg
            width="17"
            height="16"
            viewBox="0 0 17 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            class="cart-icon"
          >
            <path
              d="M1 1H3.5L4.5 3M4.5 3L6.5 9H13.5L15.5 3H4.5Z"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <circle
              cx="6"
              cy="13"
              r="1.5"
              stroke="currentColor"
              stroke-width="1.6"
            />
            <circle
              cx="13"
              cy="13"
              r="1.5"
              stroke="currentColor"
              stroke-width="1.6"
            />
          </svg>
          <span class="cart-text">Заказ на {{ totalCartAmount }} BYN</span>
        </button>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import { useCatalogStore, type Category } from "@/stores/catalog";
import { useCartStore } from "@/stores/cart";
import { useWholesaleStore } from "@/stores/wholesale";
import SmokeParticles from "@/components/SmokeParticles.vue";
import BannerCarousel from "@/components/BannerCarousel.vue";
import DiscountBadge from "@/components/product/DiscountBadge.vue";
import { hasDiscountForProduct } from "@/components/product/groupPrice";
import {
  fetchMyActiveOrder,
  getTelegramIdentity,
  type CustomerActiveOrder,
} from "@/utils/customerOrders";

const catalogStore = useCatalogStore();
const cartStore = useCartStore();
const wholesaleStore = useWholesaleStore();
const router = useRouter();
const activeOrder = ref<CustomerActiveOrder | null>(null);

const PLACEHOLDER_IMAGE = "/placeholder-category.png";

const categories = computed<Category[]>(() => catalogStore.categories);

/**
 * Категории со скидками. Товар попал в этот список — значит он в наличии,
 * сервер отсеял пустые остатки ещё при выдаче каталога.
 */
const categoriesWithDiscount = computed(() => {
  const ids = new Set<string>();
  for (const product of catalogStore.allProducts) {
    if (product.categoryId && hasDiscountForProduct(product)) ids.add(product.categoryId);
  }
  return ids;
});

const categoryCards = computed(() => {
  return categories.value.map((category) => {
    const previewImage =
      category.coverImage ||
      category.groups.find((group) => group.coverImage)?.coverImage ||
      PLACEHOLDER_IMAGE;
    return {
      id: category.id,
      slug: category.slug,
      name: category.name,
      order: category.order,
      productCount: category.productCount,
      previewImage,
      hasDiscount: categoriesWithDiscount.value.has(category.id),
    };
  });
});

const totalCartItems = computed(() => cartStore.totalItems);
const totalCartAmount = computed(() => cartStore.totalAmount.toFixed(2));
const remainingWholesaleAmount = computed(() =>
  wholesaleStore.remainingToMinimum(cartStore.totalAmount),
);

function openCategory(slug: string) {
  router.push({ name: "category", params: { slug } });
}

function goToCheckout() {
  router.push("/checkout");
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

/* Category card wrapper - transparent, holds box + title */
.category-card-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  background: transparent;
  border: none;
  cursor: pointer;
  transition: transform 0.25s ease;
  padding: 0;
  -webkit-tap-highlight-color: transparent; /* Remove iOS tap highlight */
}

.category-card-wrapper:hover {
  transform: translateY(-4px);
}

/* White box containing the image */
.category-card-box {
  position: relative;
  width: 107px;
  height: 107px;
  background: #ffffff;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

/* Плашка прижата к низу картинки: там она не спорит с самим изображением. */
.category-card-discount {
  position: absolute;
  left: 50%;
  bottom: 6px;
  transform: translateX(-50%);
  padding: 3px 8px;
  font-size: 9px;
  line-height: 11px;
  letter-spacing: 0.04em;
}

.category-card-media {
  width: 84%;
  height: 84%;
  background-size: contain;
  background-position: center;
  background-repeat: no-repeat;
}

.category-card-title {
  font-family: "Montserrat", sans-serif;
  font-size: 12px;
  font-weight: 600;
  line-height: 15px;
  text-align: center;
  letter-spacing: 0.008em;
  color: #000000;
  margin: 0;
  /* Ровно по ширине карточки: иначе длинное название вылезает за её края и
     подпись перестаёт читаться как центрированная под картинкой. */
  width: 100%;
}

/* Сетка категорий - автоматические равномерные отступы включая края экрана */
.category-grid {
  display: grid;
  grid-template-columns: repeat(3, 107px);
  justify-content: space-around;
  row-gap: 12px;
  padding: 0;
  width: 100%;
  box-sizing: border-box;
}

@media (max-width: 393px) {
  /* iPhone 14/15 и аналогичные - 393px ширина */
  .category-grid {
    grid-template-columns: repeat(3, 107px);
    row-gap: 12px;
    padding: 0;
  }
}

@media (max-width: 375px) {
  /* iPhone SE/Mini - чуть меньше отступы */
  .category-grid {
    grid-template-columns: repeat(3, 103px);
    row-gap: 10px;
    padding: 0;
  }

  .category-card-box {
    width: 103px;
    height: 103px;
  }
}

@media (max-width: 360px) {
  .active-order-banner {
    padding: 16px;
    align-items: stretch;
    flex-direction: column;
  }

  .active-order-action {
    width: 100%;
  }

  /* 360px экраны */
  .category-grid {
    grid-template-columns: repeat(3, 97px);
    row-gap: 8px;
    padding: 0;
  }

  .category-card-box {
    width: 97px;
    height: 97px;
    border-radius: 14px;
  }

  .category-card-title {
    font-size: 11px;
    line-height: 14px;
  }

  .main-content-wrapper {
    padding-bottom: 88px;
  }

  .cart-wrapper {
    bottom: calc(var(--app-cart-bottom-offset) + 12px);
  }
}

@media (max-width: 320px) {
  /* 320px экраны */
  .category-grid {
    grid-template-columns: repeat(3, 85px);
    row-gap: 6px;
    padding: 0;
  }

  .category-card-box {
    width: 85px;
    height: 85px;
    border-radius: 12px;
  }

  .category-card-title {
    font-size: 10px;
    line-height: 13px;
  }
}

/* Main Content Wrapper */
.main-content-wrapper {
  max-width: 1280px;
  margin: 0 auto;
  padding: 0 16px 96px 16px;
  position: relative;
  z-index: 10;
}

.category-section {
  position: relative;
  min-height: 0;
  margin-top: 1rem;
  width: 100%;
  box-sizing: border-box;
}

/* ===== Cart Button Styles (Brutal Card Style) ===== */
.cart-wrapper {
  position: fixed;
  bottom: var(--app-cart-bottom-offset);
  left: 0;
  right: 0;
  z-index: 50;
  padding: 0 1rem;
  pointer-events: none;
  transition: bottom 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}

.cart-button {
  width: 100%;
  max-width: 345px;
  height: 64px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 0 2rem;
  position: relative;

  /* Figma: Red gradient */
  background: linear-gradient(90deg, #f50302 0%, #a90f0e 100%);
  border: none;
  border-radius: 528px;

  cursor: pointer;
  pointer-events: auto;
  transition: transform 0.25s ease;
}

.cart-button:hover {
  transform: translateY(-2px);
}

.cart-button:active {
  transform: translateY(-1px);
}

.cart-icon {
  flex-shrink: 0;
  color: #ffffff;
  transition: transform 0.25s ease;
}

.cart-button:hover .cart-icon {
  transform: scale(1.1);
}

.cart-text {
  font-family: "Montserrat", sans-serif;
  font-size: 16px;
  font-weight: 500;
  color: #ffffff;
}

/* Slide up animation with bounce */
.cart-slide-enter-active {
  transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.cart-slide-leave-active {
  transition: all 0.3s ease-out;
}

.cart-slide-enter-from {
  transform: translateY(150%);
  opacity: 0;
}

.cart-slide-leave-to {
  transform: translateY(150%);
  opacity: 0;
}

/* Mobile adjustments */
@media (max-width: 768px) {
  .cart-wrapper {
    padding: 0 0.75rem;
  }

  .cart-button {
    max-width: 320px;
    height: 56px;
    padding: 0 1.5rem;
  }

  .cart-text {
    font-size: 15px;
  }

  .cart-icon {
    width: 16px;
    height: 15px;
  }
}

@media (max-width: 480px) {
  .cart-wrapper {
    padding: 0 0.5rem;
  }

  .cart-button {
    max-width: 300px;
    height: 52px;
    padding: 0 1.25rem;
    gap: 0.5rem;
  }

  .cart-text {
    font-size: 14px;
  }

  .cart-icon {
    width: 15px;
    height: 14px;
  }
}
</style>
