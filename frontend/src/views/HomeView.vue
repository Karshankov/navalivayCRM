<template>
  <div class="home-pane" ref="paneRef">
    <!-- Баннер -->
    <div v-if="!wholesaleStore.isWholesale && catalogStore.banners.length" class="banner-wrapper">
      <div class="banner-container relative">
        <BannerCarousel
          :banners="catalogStore.banners"
          :is-loading="catalogStore.isLoading"
          :auto-play="true"
          :auto-play-interval="5000"
        />
      </div>
    </div>

    <!-- Активный заказ -->
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

    <!-- Оптовый режим -->
    <section v-if="wholesaleStore.isWholesale" class="wholesale-section">
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

    <!-- Избранное: быстрая ссылка -->
    <section v-if="!wholesaleStore.isWholesale" class="home-quick-links">
      <router-link to="/favorites" class="quick-link">
        <span class="quick-link__icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 20.3C11.77 20.3 11.55 20.25 11.36 20.14C7.54 17.89 4.2 15.7 4.2 11.63C4.2 8.52 6.59 6.2 9.53 6.2C10.56 6.2 11.62 6.6 12 7.35C12.38 6.6 13.44 6.2 14.47 6.2C17.41 6.2 19.8 8.52 19.8 11.63C19.8 15.7 16.46 17.89 12.64 20.14C12.45 20.25 12.23 20.3 12 20.3Z"
              fill="#F50302"
            />
          </svg>
        </span>
        <span class="quick-link__copy">
          <strong class="quick-link__title">Избранное</strong>
          <span v-if="favoritesCount > 0" class="quick-link__text">
            {{ favoritesCount }} {{ pluralFavorites(favoritesCount) }}
          </span>
          <span v-else class="quick-link__text">Пока пусто</span>
        </span>
        <svg
          class="quick-link__chevron"
          width="8"
          height="14"
          viewBox="0 0 8 14"
          fill="none"
        >
          <path
            d="M1 1L7 7L1 13"
            stroke="#AAB2BD"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </router-link>

      <router-link to="/wheel" class="quick-link">
        <span class="quick-link__icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="8.5" stroke="#191919" stroke-width="1.7" />
            <circle cx="12" cy="12" r="4.5" stroke="#191919" stroke-width="1.7" />
            <line x1="12" y1="3.5" x2="12" y2="7.5" stroke="#191919" stroke-width="1.7" />
            <line x1="12" y1="16.5" x2="12" y2="20.5" stroke="#191919" stroke-width="1.7" />
            <line x1="3.5" y1="12" x2="7.5" y2="12" stroke="#191919" stroke-width="1.7" />
            <line x1="16.5" y1="12" x2="20.5" y2="12" stroke="#191919" stroke-width="1.7" />
          </svg>
        </span>
        <span class="quick-link__copy">
          <strong class="quick-link__title">Рулетка</strong>
          <span class="quick-link__text">Крути и выигрывай призы</span>
        </span>
        <svg
          class="quick-link__chevron"
          width="8"
          height="14"
          viewBox="0 0 8 14"
          fill="none"
        >
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
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import { useCatalogStore, type Category } from "@/stores/catalog";
import { useCartStore } from "@/stores/cart";
import { useWholesaleStore } from "@/stores/wholesale";
import { useFavoritesStore } from "@/stores/favorites";
import BannerCarousel from "@/components/BannerCarousel.vue";
import {
  fetchMyActiveOrder,
  getTelegramIdentity,
  type CustomerActiveOrder,
} from "@/utils/customerOrders";

/**
 * Главная вкладка карусели. Минимализм: баннер, активный заказ,
 * оптовая плашка, быстрые ссылки. Аватар профиля и корзина — в общем
 * AppHeader (TabShell), категориям посвящены отдельные вкладки.
 */
defineProps<{
  isActive?: boolean;
}>();

const catalogStore = useCatalogStore();
const cartStore = useCartStore();
const wholesaleStore = useWholesaleStore();
const favoritesStore = useFavoritesStore();
const router = useRouter();
const paneRef = ref<HTMLElement | null>(null);
const activeOrder = ref<CustomerActiveOrder | null>(null);

const favoritesCount = computed(() => favoritesStore.inStockItems.length);

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

function pluralFavorites(value: number) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return "товар";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "товара";
  return "товаров";
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
.home-pane {
  min-height: 100%;
  background: #f5f7fa;
  padding-bottom: calc(var(--app-bottom-tab-bar-height, 52px) + 24px);
}

.banner-wrapper {
  overflow-x: hidden;
  overflow-y: visible;
  padding-top: 12px;
  padding-left: 16px;
  padding-right: 16px;
}

.active-order-section {
  padding: 0 16px;
  margin-top: 16px;
}

.wholesale-section {
  padding: 0 16px;
  margin-top: 16px;
}

.home-quick-links {
  padding: 0 16px;
  margin-top: 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.quick-link {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  background: #fff;
  border-radius: 16px;
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.15s ease, box-shadow 0.2s ease;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
}

.quick-link:active {
  transform: scale(0.98);
}

.quick-link__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: #f5f7fa;
  flex: 0 0 auto;
}

.quick-link__copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.quick-link__title {
  font-size: 15px;
  font-weight: 600;
  color: #191919;
  letter-spacing: -0.01em;
}

.quick-link__text {
  font-size: 13px;
  color: #7b8794;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.quick-link__chevron {
  flex: 0 0 auto;
}
</style>
