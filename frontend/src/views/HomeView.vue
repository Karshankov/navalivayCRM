<template>
  <div ref="paneRef" class="home-pane">
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

    <!-- Быстрые ссылки: избранное с фирменным черепом, рулетка -->
    <section v-if="!wholesaleStore.isWholesale" class="home-section home-quick-links">
      <router-link to="/favorites" class="quick-link">
        <span class="quick-link__icon quick-link__icon--skull">
          <!-- Фирменный вейп-череп -->
          <svg viewBox="0 0 24 24" fill="none" width="24" height="24">
            <path
              d="M12 3C7.5 3 5 6 5 9.5C5 11.3 5.8 12.5 6.7 13.3L7 15.6C7 16.7 7.8 17.5 8.9 17.5H9.5V19C9.5 19.55 9.95 20 10.5 20H13.5C14.05 20 14.5 19.55 14.5 19V17.5H15.1C16.2 17.5 17 16.7 17 15.6L17.3 13.3C18.2 12.5 19 11.3 19 9.5C19 6 16.5 3 12 3Z"
              fill="#191919"
            />
            <ellipse cx="9.6" cy="10.4" rx="1.7" ry="2" fill="#fff" />
            <ellipse cx="14.4" cy="10.4" rx="1.7" ry="2" fill="#fff" />
            <path d="M11 12.2L12 13.7L13 12.2H11Z" fill="#fff" />
            <path
              d="M11.5 15.5V17M12.5 15.5V17"
              stroke="#fff"
              stroke-width="0.8"
              stroke-linecap="round"
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
        <svg class="quick-link__chevron" width="8" height="14" viewBox="0 0 8 14" fill="none">
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
        <svg class="quick-link__chevron" width="8" height="14" viewBox="0 0 8 14" fill="none">
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

import { useCatalogStore } from "@/stores/catalog";
import { useCartStore } from "@/stores/cart";
import { useWholesaleStore } from "@/stores/wholesale";
import { useFavoritesStore } from "@/stores/favorites";
import { useLoyaltyStore, type LoyaltySnapshotCategory } from "@/stores/loyalty";
import {
  fetchMyActiveOrder,
  getTelegramIdentity,
  type CustomerActiveOrder,
} from "@/utils/customerOrders";

/**
 * Главная вкладка карусели: мини-статус лояльности, активный заказ,
 * оптовая плашка, быстрые ссылки (избранное с черепом, рулетка).
 * Баннеров больше нет. Аватар и корзина — в общем AppHeader.
 */
defineProps<{
  isActive?: boolean;
}>();

const catalogStore = useCatalogStore();
const cartStore = useCartStore();
const wholesaleStore = useWholesaleStore();
const favoritesStore = useFavoritesStore();
const loyaltyStore = useLoyaltyStore();
const router = useRouter();
const paneRef = ref<HTMLElement | null>(null);
const activeOrder = ref<CustomerActiveOrder | null>(null);

const favoritesCount = computed(() => favoritesStore.inStockItems.length);

/* ===== Мини-прогресс лояльности ===== */

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
  // Прогресс текущего цикла: balance по модулю threshold.
  // balance=10, threshold=10 → цикл полный (скидка готова).
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
  // Каталог и лояльность уже предзагружены сплэшем — здесь только
  // свежесть активного заказа.
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
  padding: 16px 16px calc(var(--app-bottom-tab-bar-height, 52px) + 24px);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.home-section {
  animation: home-rise 0.4s cubic-bezier(0.22, 1, 0.36, 1) both;
}

.home-section:nth-child(2) {
  animation-delay: 0.06s;
}

.home-section:nth-child(3) {
  animation-delay: 0.12s;
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

@media (prefers-reduced-motion: reduce) {
  .home-section {
    animation: none;
  }
}

/* ===== Мини-лояльность ===== */

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
  /* Красный акцент — единственный на странице, по канону бренда */
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
  /* Плавное заполнение при появлении */
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

/* ===== Быстрые ссылки ===== */

.home-quick-links {
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

.quick-link__icon--skull {
  background: #f5f7fa;
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
