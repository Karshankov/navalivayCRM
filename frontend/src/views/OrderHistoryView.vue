<template>
  <div class="order-history-page">
    <header class="order-history-header">
      <button type="button" class="order-history-back" aria-label="Назад в профиль" @click="goBack">
        <svg width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden="true">
          <path
            d="M6 1L1 6L6 11"
            stroke="#191919"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <h1 class="order-history-title">Мои заказы</h1>
    </header>

    <div class="order-history-container">
      <div v-if="loading && !items.length" class="order-history-state">
        <div class="order-history-loader" aria-hidden="true" />
        <p>Загружаем историю…</p>
      </div>

      <div v-else-if="errorMessage && !items.length" class="order-history-state">
        <p>{{ errorMessage }}</p>
        <p v-if="devAuthHint" class="order-history-dev-hint">{{ devAuthHint }}</p>
        <button
          v-if="devAuthHint"
          type="button"
          class="order-history-retry"
          @click="applyDevAuthMock"
        >
          Включить dev-мок
        </button>
        <button type="button" class="order-history-retry" @click="reload">Повторить</button>
      </div>

      <div v-else-if="!items.length" class="order-history-state">
        <p>Здесь появятся завершённые заказы.</p>
        <button type="button" class="order-history-retry" @click="router.push('/')">
          На главную
        </button>
      </div>

      <ul v-else class="order-history-list">
        <li v-for="order in items" :key="order.id">
          <button type="button" class="order-history-card" @click="openOrder(order.id)">
            <div class="order-history-card__head">
              <strong class="order-history-card__title">
                {{ formatOrderHistoryTitle(order.order_number) }}
              </strong>
              <span class="order-history-card__amount">{{ formatPrice(order.final_amount) }} BYN</span>
            </div>

            <div class="order-history-card__foot">
              <div
                v-if="order.category_icons.length"
                class="order-history-card__thumbs"
                aria-hidden="true"
              >
                <div
                  v-for="(icon, index) in order.category_icons"
                  :key="`${order.id}-${icon.group_id || icon.category_id || index}`"
                  class="order-history-card__thumb"
                  :style="{ zIndex: order.category_icons.length - index }"
                >
                  <img
                    v-if="icon.image"
                    :src="icon.image"
                    :alt="icon.group_name || icon.category_name || ''"
                    loading="lazy"
                    decoding="async"
                  />
                  <span v-else class="order-history-card__thumb-placeholder" />
                </div>
                <span
                  v-if="order.category_icons_overflow > 0"
                  class="order-history-card__thumb-more"
                >
                  +{{ order.category_icons_overflow }}
                </span>
              </div>

              <div class="order-history-card__meta-wrap">
                <p
                  class="order-history-card__meta"
                  :class="{
                    'order-history-card__meta--fulfilled':
                      order.status === 'delivered' || order.status === 'completed',
                  }"
                >
                  {{ formatOrderHistoryMeta(order) }}
                </p>
                <p v-if="order.review_hint" class="order-history-card__hint">
                  {{ order.review_hint }}
                </p>
              </div>
            </div>
          </button>
        </li>
      </ul>

      <button
        v-if="nextCursor"
        type="button"
        class="order-history-more"
        :disabled="loadingMore"
        @click="loadMore"
      >
        {{ loadingMore ? "Загружаем…" : "Показать ещё" }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  formatOrderHistoryMeta,
  formatOrderHistoryTitle,
  useCustomerOrders,
  type OrderHistoryItem,
} from "@/composables/useCustomerOrders";

const router = useRouter();
const { fetchOrderHistory } = useCustomerOrders();

const items = ref<OrderHistoryItem[]>([]);
const nextCursor = ref<string | null>(null);
const loading = ref(false);
const loadingMore = ref(false);
const errorMessage = ref<string | null>(null);

const devAuthHint = computed(() => {
  if (!import.meta.env.DEV) return null;
  const message = errorMessage.value || "";
  if (!message.includes("Telegram")) return null;
  return "В браузере без Mini App откройте с ?telegram_id=… — см. docs/dev-telegram-mock.md";
});

function applyDevAuthMock() {
  const url = new URL(window.location.origin);
  url.searchParams.set("telegram_id", "900000001");
  url.searchParams.set("username", "review_demo");
  url.searchParams.set("first_name", "Review Demo");
  window.location.href = url.toString();
}

async function reload() {
  loading.value = true;
  errorMessage.value = null;

  try {
    const data = await fetchOrderHistory({ limit: 20 });
    items.value = data.items;
    nextCursor.value = data.next_cursor;
  } catch (error: unknown) {
    errorMessage.value =
      error instanceof Error ? error.message : "Не удалось загрузить историю";
    items.value = [];
    nextCursor.value = null;
  } finally {
    loading.value = false;
  }
}

async function loadMore() {
  if (!nextCursor.value || loadingMore.value) return;
  loadingMore.value = true;

  try {
    const data = await fetchOrderHistory({
      cursor: nextCursor.value,
      limit: 20,
    });
    items.value = [...items.value, ...data.items];
    nextCursor.value = data.next_cursor;
  } catch (error: unknown) {
    errorMessage.value =
      error instanceof Error ? error.message : "Не удалось загрузить ещё заказы";
  } finally {
    loadingMore.value = false;
  }
}

function openOrder(orderId: string) {
  router.push({ name: "order-detail", params: { orderId } });
}

function goBack() {
  router.push({ name: "profile" });
}

function formatPrice(value: number) {
  return value.toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

onMounted(() => {
  void reload();
});
</script>

<style scoped>
.order-history-page {
  min-height: 100vh;
  background: #f5f7fa;
}

.order-history-header {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 12px;
  padding:
    calc(12px + env(safe-area-inset-top, 0px))
    16px
    12px;
  background: rgba(245, 247, 250, 0.96);
  backdrop-filter: blur(12px);
}

.order-history-back {
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 50%;
  background: #ffffff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.06);
}

.order-history-title {
  margin: 0;
  font-family: "Montserrat", sans-serif;
  font-weight: 700;
  font-size: 20px;
  line-height: 24px;
  color: #191919;
}

.order-history-container {
  width: min(393px, 100%);
  margin: 0 auto;
  padding: 8px 16px 24px;
  box-sizing: border-box;
}

.order-history-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 48px 16px;
  text-align: center;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 14px;
  line-height: 18px;
  color: #5c6470;
}

.order-history-loader {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid #e6e9ed;
  border-top-color: #f50302;
  animation: order-history-spin 0.8s linear infinite;
}

@keyframes order-history-spin {
  to {
    transform: rotate(360deg);
  }
}

.order-history-retry,
.order-history-more {
  border: none;
  border-radius: 999px;
  min-height: 44px;
  padding: 0 18px;
  background: #ffffff;
  color: #191919;
  font-family: "Montserrat", sans-serif;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.05);
}

.order-history-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.order-history-card {
  width: 100%;
  border: none;
  border-radius: 20px;
  background: #ffffff;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
  text-align: left;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.04);
}

.order-history-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.order-history-card__title {
  flex: 1 1 auto;
  min-width: 0;
  font-family: "Montserrat", sans-serif;
  font-size: 15px;
  line-height: 19px;
  font-weight: 700;
  color: #191919;
}

.order-history-card__amount {
  flex-shrink: 0;
  font-family: "Montserrat", sans-serif;
  font-size: 15px;
  line-height: 19px;
  font-weight: 700;
  color: #191919;
  white-space: nowrap;
}

.order-history-card__foot {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.order-history-card__thumbs {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.order-history-card__thumb {
  flex: 0 0 30px;
  width: 30px;
  height: 30px;
  min-width: 30px;
  max-width: 30px;
  border-radius: 10px;
  border: 2px solid #ffffff;
  margin-left: -12px;
  overflow: hidden;
  background: #f5f7fa;
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.08);
}

.order-history-card__thumb-placeholder {
  display: block;
  flex: 0 0 30px;
  width: 30px;
  height: 30px;
  min-width: 30px;
  max-width: 30px;
  border-radius: 10px;
  border: 2px solid #ffffff;
  margin-left: -12px;
  background: #f5f7fa;
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.08);
}

.order-history-card__thumb:first-child,
.order-history-card__thumb-placeholder:first-child {
  margin-left: 0;
}

.order-history-card__thumb img {
  display: block;
  width: 100%;
  height: 100%;
  max-width: 100%;
  object-fit: cover;
}

.order-history-card__thumb-more {
  margin-left: 6px;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 12px;
  line-height: 14px;
  color: #8a93a0;
  white-space: nowrap;
}

.order-history-card__meta-wrap {
  margin: 0 0 0 auto;
  text-align: right;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.order-history-card__meta {
  margin: 0;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 13px;
  line-height: 16px;
  color: #8a93a0;
}

.order-history-card__meta--fulfilled {
  color: #1d7a4b;
}

.order-history-card__hint {
  margin: 0;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 12px;
  line-height: 14px;
  color: #8a93a0;
}

.order-history-more {
  width: 100%;
  margin-top: 12px;
}

@media (max-width: 360px) {
  .order-history-container {
    padding-inline: 12px;
  }
}
</style>