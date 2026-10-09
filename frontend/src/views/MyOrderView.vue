<template>
  <div class="order-page">
    <div class="order-header">
      <button class="order-back-button" @click="router.push('/')">
        <svg width="7" height="12" viewBox="0 0 7 12" fill="none">
          <path
            d="M6 1L1 6L6 11"
            stroke="#191919"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <h1 class="order-title">Мой заказ</h1>
    </div>

    <div class="order-container">
      <div v-if="isLoading && !order" class="order-state-card">
        <div class="loader"></div>
        <p>Загружаем ваш заказ…</p>
      </div>

      <div v-else-if="!order" class="order-state-card">
        <div class="order-state-icon">✓</div>
        <h2>Активного заказа нет</h2>
        <p>Когда оформите новый заказ, он появится здесь.</p>
        <button class="order-primary-button" @click="router.push('/')">На главную</button>
      </div>

      <template v-else>
        <section class="order-status-card">
          <div class="order-status-pill" :class="`order-status-pill--${order.status}`">
            {{ statusLabel }}
          </div>
          <div class="order-status-copy">
            <strong>{{ statusHeadline }}</strong>
            <div
              v-if="
                (order.status === 'new' || order.status === 'in_progress') &&
                order.pickup_cell_number
              "
              class="order-pickup-cell"
              :aria-label="`Заказ №${order.pickup_cell_number}`"
            >
              <span>Заказ №{{ order.pickup_cell_number }}</span>
              <small>Назовите этот номер сотруднику при получении</small>
            </div>
            <p>{{ statusDescription }}</p>
          </div>
        </section>

        <section v-if="order.is_wholesale" class="order-status-card">
          <div class="order-status-copy">
            <strong>Оптовый заказ</strong>
            <p>
              {{ order.wholesale_tier_label || 'Оптовый прайс' }}.
              Минимальная сумма - {{ formatPrice(order.wholesale_min_amount || 0) }} BYN.
            </p>
          </div>
        </section>

        <section class="order-items-card">
          <div class="order-card-header">
            <h2>Состав заказа</h2>
            <span>{{ order.items.length }} поз.</span>
          </div>

          <div class="order-items-list">
            <article
              v-for="item in order.items"
              :key="item.id"
              class="order-item"
            >
              <div class="order-item-image">
                <img v-if="item.image" :src="item.image" :alt="item.product_title" />
                <div v-else class="order-item-image-placeholder"></div>
              </div>

              <div class="order-item-copy">
                <span v-if="item.group_name" class="order-item-group">{{ item.group_name }}</span>
                <strong>{{ item.base_product_title || item.product_title }}</strong>
                <span v-if="item.variant_name" class="order-item-meta">{{ item.variant_name }}</span>
                <span class="order-item-meta">{{ item.quantity }} шт. · {{ formatPrice(item.total_price) }} BYN</span>
              </div>
            </article>
          </div>
        </section>

        <section class="order-summary-card">
          <div class="summary-row">
            <span>Сумма</span>
            <strong>{{ formatPrice(order.total_amount) }} BYN</strong>
          </div>
          <div v-if="order.discount_amount > 0" class="summary-row summary-row--muted">
            <span>Скидка</span>
            <strong>-{{ formatPrice(order.discount_amount) }} BYN</strong>
          </div>
          <div class="summary-row summary-row--total">
            <span>Итого</span>
            <strong>{{ formatPrice(order.final_amount) }} BYN</strong>
          </div>
        </section>

        <div class="order-sticky-panel">
          <p v-if="errorMessage" class="order-error">{{ errorMessage }}</p>

          <section class="order-actions-card">
            <button
              class="order-secondary-button"
              :disabled="isEditingOrder || !order.can_edit"
              @click="handleEditOrder"
            >
              {{ isEditingOrder ? "Открываем корзину…" : "Изменить заказ" }}
            </button>
            <button
              class="order-danger-button"
              :disabled="isCancellingOrder || !order.can_cancel"
              @click="handleCancelOrder"
            >
              {{ isCancellingOrder ? "Отменяем…" : "Отменить заказ" }}
            </button>
          </section>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useCartStore } from "@/stores/cart";
import { useWholesaleStore } from "@/stores/wholesale";
import {
  fetchMyActiveOrder,
  getTelegramIdentity,
  type CustomerActiveOrder,
} from "@/utils/customerOrders";
import { withTelegramAuthHeaders } from "@/utils/telegramAuth";

const router = useRouter();
const cartStore = useCartStore();
const wholesaleStore = useWholesaleStore();

const order = ref<CustomerActiveOrder | null>(null);
const isLoading = ref(false);
const isCancellingOrder = ref(false);
const isEditingOrder = ref(false);
const errorMessage = ref("");

let pollTimer: number | null = null;

const statusLabel = computed(() => {
  return order.value?.status === "in_progress" ? "Готовы к выдаче" : "Заказ собирают...";
});

const statusHeadline = computed(() => {
  return order.value?.status === "in_progress"
    ? "Заказ готов к выдаче"
    : "Ваш заказ отправлен";
});

const statusDescription = computed(() => {
  return order.value?.status === "in_progress"
    ? "Заказ еще можно изменить, если вдруг что-то забыли или передумали. Когда будете готовы, просто приходите за ним с 10:30 до 21:00."
    : "С вами свяжутся, когда заказ подготовят к выдаче. Если нужны изменения, нажмите кнопку «Изменить заказ».";
});

async function loadOrder(options: { silent?: boolean } = {}) {
  if (!options.silent) {
    isLoading.value = true;
  }

  try {
    errorMessage.value = "";
    order.value = await fetchMyActiveOrder(getTelegramIdentity());
  } catch (error: any) {
    console.error("[MyOrder] Failed to load order", error);
    errorMessage.value = error?.message || "Не удалось загрузить заказ";
  } finally {
    if (!options.silent) {
      isLoading.value = false;
    }
  }
}

async function handleEditOrder() {
  if (!order.value) return;

  if (
    cartStore.items.length > 0 &&
    !cartStore.editingOrderId &&
    !window.confirm("Текущая корзина будет заменена товарами из заказа. Продолжить?")
  ) {
    return;
  }

  isEditingOrder.value = true;
  try {
    if (order.value.is_wholesale) {
      wholesaleStore.applyOrderWholesaleContext({
        code: order.value.wholesale_code,
        secret: order.value.wholesale_secret,
        label: order.value.wholesale_tier_label,
        minOrderAmount: order.value.wholesale_min_amount,
      });
    } else if (wholesaleStore.isWholesale) {
      wholesaleStore.clearContext();
    }

    cartStore.replaceItemsFromOrder(order.value.items);
    cartStore.startOrderEdit(order.value.id, {
      promoCode: order.value.promo_code_text,
    });
    await router.push("/");
  } finally {
    isEditingOrder.value = false;
  }
}

async function handleCancelOrder() {
  if (!order.value) return;
  if (!window.confirm("Отменить текущий заказ?")) return;

  isCancellingOrder.value = true;
  errorMessage.value = "";

  try {
    const identity = getTelegramIdentity();
    const response = await fetch(`/api/orders/${order.value.id}/cancel-by-customer`, {
      method: "POST",
      headers: withTelegramAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        telegram_id: identity.telegramId || undefined,
        telegram_username: identity.telegramUsername || undefined,
      }),
    });

    const result = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(result?.message || "Не удалось отменить заказ");
    }

    cartStore.clearOrderEdit();
    order.value = null;
  } catch (error: any) {
    console.error("[MyOrder] Failed to cancel order", error);
    errorMessage.value = error?.message || "Не удалось отменить заказ";
  } finally {
    isCancellingOrder.value = false;
  }
}

function formatPrice(value: number) {
  return Number(value || 0).toFixed(0);
}

function startPolling() {
  stopPolling();
  pollTimer = window.setInterval(() => {
    void loadOrder({ silent: true });
  }, 12000);
}

function stopPolling() {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

onMounted(async () => {
  await loadOrder();
  startPolling();
});

onUnmounted(() => {
  stopPolling();
});
</script>

<style scoped>
.order-page {
  min-height: 100vh;
  background: linear-gradient(180deg, #f8f9fb 0%, #f1f4f8 100%);
}

.order-header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 64px;
  padding: 12px 16px 18px;
  background: #ffffff;
  border-radius: 0 0 24px 24px;
  box-shadow: 0 4px 32px rgba(170, 178, 189, 0.2);
}

.order-back-button {
  position: absolute;
  left: 16px;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  cursor: pointer;
}

.order-title {
  margin: 0;
  font-family: "Montserrat", sans-serif;
  font-size: 20px;
  line-height: 24px;
  font-weight: 700;
  color: #191919;
}

.order-container {
  padding: 18px 16px calc(env(safe-area-inset-bottom, 0px) + 200px);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.order-state-card,
.order-status-card,
.order-items-card,
.order-summary-card {
  background: #ffffff;
  border-radius: 24px;
  padding: 20px 18px;
}

.order-state-card {
  min-height: 260px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 12px;
}

.order-state-icon {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #ecfdf3;
  color: #16a34a;
  font-size: 28px;
  font-weight: 700;
}

.loader {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  border: 4px solid rgba(245, 3, 2, 0.15);
  border-top-color: #f50302;
  animation: spin 1s linear infinite;
}

.order-status-card {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: linear-gradient(135deg, #18181b 0%, #2a2a2f 52%, #17171a 100%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 18px 40px rgba(16, 18, 24, 0.18);
}

.order-status-card::before {
  content: "";
  position: absolute;
  inset: auto -12% -45% auto;
  width: 180px;
  height: 180px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.14) 0%, rgba(255, 255, 255, 0) 72%);
  pointer-events: none;
}

.order-status-pill {
  width: fit-content;
  padding: 8px 14px;
  border-radius: 14px;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 12px;
  line-height: 14px;
  font-weight: 700;
  letter-spacing: 0.01em;
  position: relative;
  z-index: 1;
}

.order-status-pill--new {
  background: linear-gradient(90deg, #14a4db 0%, #0b7fc4 100%);
  color: #ffffff;
  box-shadow: 0 10px 20px rgba(20, 164, 219, 0.28);
}

.order-status-pill--in_progress {
  background: linear-gradient(90deg, #70d80d 0%, #1dbb10 100%);
  color: #ffffff;
  box-shadow: 0 10px 20px rgba(46, 184, 39, 0.26);
}

.order-status-copy {
  display: flex;
  flex-direction: column;
  gap: 10px;
  position: relative;
  z-index: 1;
}

.order-status-copy strong,
.order-items-card h2 {
  font-family: "Montserrat", sans-serif;
  font-size: 20px;
  line-height: 24px;
  font-weight: 700;
}

.order-status-copy strong {
  color: #ffffff;
}

.order-pickup-cell {
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: fit-content;
  max-width: 100%;
  padding: 12px 14px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.16);
}

.order-pickup-cell span {
  font-family: "Montserrat", sans-serif;
  font-size: clamp(24px, 8vw, 32px);
  line-height: 1;
  font-weight: 800;
  color: #ffffff;
  white-space: nowrap;
}

.order-pickup-cell small {
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 12px;
  line-height: 16px;
  color: rgba(255, 255, 255, 0.74);
}

.order-status-copy p,
.order-state-card p {
  margin: 0;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 14px;
  line-height: 20px;
}

.order-status-copy p {
  max-width: 280px;
  color: rgba(255, 255, 255, 0.78);
}

.order-state-card p {
  color: #5f6675;
}

.order-card-header,
.summary-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.order-card-header span,
.summary-row span {
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 14px;
  line-height: 18px;
  color: #8f95a3;
}

.order-items-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 16px;
}

.order-item {
  display: flex;
  gap: 14px;
}

.order-item-image {
  width: 72px;
  height: 84px;
  border-radius: 18px;
  border: 1px solid #edf0f4;
  overflow: hidden;
  background: #f8fafc;
  flex-shrink: 0;
}

.order-item-image img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.order-item-image-placeholder {
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%);
}

.order-item-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.order-item-group {
  font-family: "Montserrat", sans-serif;
  font-size: 11px;
  line-height: 14px;
  font-weight: 600;
  color: #2563eb;
  text-transform: uppercase;
}

.order-item-copy strong {
  font-family: "Montserrat", sans-serif;
  font-size: 15px;
  line-height: 19px;
  font-weight: 700;
  color: #191919;
}

.order-item-meta {
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 14px;
  line-height: 18px;
  color: #7d8594;
}

.order-summary-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.summary-row strong {
  font-family: "Montserrat", sans-serif;
  font-size: 16px;
  line-height: 20px;
  font-weight: 700;
  color: #191919;
}

.summary-row--muted strong {
  color: #16a34a;
}

.summary-row--total {
  padding-top: 12px;
  border-top: 1px solid #eef1f5;
}

.summary-row--total span,
.summary-row--total strong {
  font-size: 18px;
  line-height: 22px;
  color: #191919;
}

.order-sticky-panel {
  position: fixed;
  left: 50%;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 12px);
  transform: translateX(-50%);
  width: min(560px, calc(100vw - 24px));
  display: flex;
  flex-direction: column;
  z-index: 16;
}

.order-actions-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.85);
  border-radius: 26px;
  box-shadow: 0 20px 48px rgba(17, 24, 39, 0.18);
  backdrop-filter: blur(18px);
}

.order-primary-button,
.order-secondary-button,
.order-danger-button {
  width: 100%;
  min-height: 56px;
  border: none;
  border-radius: 999px;
  font-family: "Montserrat", sans-serif;
  font-size: 15px;
  line-height: 18px;
  font-weight: 700;
  cursor: pointer;
}

.order-primary-button,
.order-secondary-button {
  background: linear-gradient(90deg, #f50302 0%, #a90f0e 100%);
  color: #ffffff;
}

.order-danger-button {
  background: linear-gradient(180deg, #ffffff 0%, #f5f6f9 100%);
  color: #191919;
  box-shadow: inset 0 0 0 1px #e5e7eb;
}

.order-primary-button:disabled,
.order-secondary-button:disabled,
.order-danger-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.order-error {
  margin: 0 0 10px;
  padding: 14px 16px;
  border-radius: 16px;
  background: #fee2e2;
  color: #b91c1c;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 14px;
  line-height: 18px;
  box-shadow: 0 10px 28px rgba(185, 28, 28, 0.16);
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
