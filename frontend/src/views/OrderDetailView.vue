<template>
  <div class="order-detail-page">
    <header class="order-detail-header">
      <button type="button" class="order-detail-back" aria-label="Назад" @click="goBack">
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
      <h1 class="order-detail-title">Заказ № {{ order?.order_number ?? "…" }}</h1>
    </header>

    <div class="order-detail-container">
      <div v-if="loading && !order" class="order-detail-state">
        <div class="order-detail-loader" aria-hidden="true" />
        <p>Загружаем заказ…</p>
      </div>

      <div v-else-if="errorMessage && !order" class="order-detail-state">
        <p>{{ errorMessage }}</p>
        <button type="button" class="order-detail-retry" @click="reload">Повторить</button>
      </div>

      <template v-else-if="order">
        <section class="order-detail-overview" aria-label="Информация о заказе">
          <div class="order-detail-overview__head">
            <div class="order-detail-overview__summary">
              <span class="order-detail-overview__amount">
                {{ formatPrice(order.final_amount) }} BYN
              </span>
              <span v-if="positionsCount > 0" class="order-detail-overview__positions">
                {{ formatPositionsCount(positionsCount) }}
              </span>
            </div>
            <span
              class="order-detail-overview__status"
              :class="`order-detail-overview__status--${order.status}`"
            >
              {{ formatOrderStatus(order.status, order.delivery_type) }}
            </span>
          </div>

          <ol
            v-if="fulfillmentLines.length"
            class="order-detail-overview__timeline"
            aria-label="Этапы заказа"
          >
            <li
              v-for="(line, index) in fulfillmentLines"
              :key="line.key"
              class="order-detail-overview__step"
              :class="{
                'order-detail-overview__step--last': index === fulfillmentLines.length - 1,
                'order-detail-overview__step--success':
                  index === fulfillmentLines.length - 1 && isFulfilledStatus,
                'order-detail-overview__step--cancelled':
                  index === fulfillmentLines.length - 1 && order.status === 'cancelled',
              }"
            >
              <span class="order-detail-overview__dot" aria-hidden="true" />
              <div class="order-detail-overview__step-body">
                <span class="order-detail-overview__step-label">{{ line.label }}</span>
                <time class="order-detail-overview__step-time" :datetime="line.at">
                  {{ formatOrderDateTime(line.at) }}
                </time>
              </div>
            </li>
          </ol>
        </section>

        <section v-if="order.reviewable_lines.length" class="order-detail-reviews">
          <header class="order-detail-reviews-head">
            <h2 class="order-detail-section-title">Отзывы по заказу</h2>
            <p v-if="order.lottery_hint_text" class="order-detail-hint">{{ order.lottery_hint_text }}</p>
          </header>

          <ReviewLineCard
            v-for="line in order.reviewable_lines"
            :key="line.group_id"
            :line="line"
            :order-id="order.id"
            :prefer-anonymous="reviewPreferences.reviews_prefer_anonymous"
            :initial-rating="initialRatingForLine(line.group_id)"
            :highlighted="highlightedGroupId === line.group_id"
            @submitted="reload"
          />
        </section>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import ReviewLineCard from "@/components/reviews/ReviewLineCard.vue";
import {
  buildFulfillmentTimelineLines,
  formatOrderDateTime,
  formatOrderStatus,
  useCustomerOrders,
  type OrderDetail,
} from "@/composables/useCustomerOrders";

const route = useRoute();
const router = useRouter();
const { fetchOrderDetail, reviewPreferences, fetchReviewPrompt } = useCustomerOrders();

const order = ref<OrderDetail | null>(null);
const loading = ref(false);
const errorMessage = ref<string | null>(null);

const positionsCount = computed(() => {
  if (!order.value) return 0;
  return order.value.reviewable_lines.reduce(
    (sum, line) => sum + line.items.length,
    0,
  );
});

const fulfillmentLines = computed(() => {
  if (!order.value) return [];
  return buildFulfillmentTimelineLines(
    order.value.fulfillment_milestones,
    order.value.status,
    order.value.delivery_type,
  );
});

const isFulfilledStatus = computed(
  () =>
    order.value?.status === "delivered" || order.value?.status === "completed",
);

const deepLinkRating = computed(() => {
  const raw = route.query.rating;
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(value) && value >= 1 && value <= 5 ? value : 0;
});

const highlightedGroupId = computed(() => {
  const raw = route.query.groupId;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value : null;
});

function initialRatingForLine(groupId: string) {
  if (highlightedGroupId.value && highlightedGroupId.value === groupId) {
    return deepLinkRating.value;
  }
  return 0;
}

async function reload() {
  const orderId = String(route.params.orderId || "");
  if (!orderId) return;

  loading.value = true;
  errorMessage.value = null;

  try {
    order.value = await fetchOrderDetail(orderId);
    await nextTick();
    scrollToHighlightedLine();
  } catch (error: unknown) {
    errorMessage.value =
      error instanceof Error ? error.message : "Не удалось загрузить заказ";
    order.value = null;
  } finally {
    loading.value = false;
  }
}

function scrollToHighlightedLine() {
  const groupId = highlightedGroupId.value;
  if (!groupId || typeof document === "undefined") return;

  const target = document.getElementById(`review-line-${groupId}`);
  target?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function goBack() {
  router.push({ name: "order-history" });
}

function formatPrice(value: number) {
  return value.toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatPositionsCount(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} позиция`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} позиции`;
  }
  return `${count} позиций`;
}

watch(
  () => route.params.orderId,
  () => {
    void reload();
  },
);

onMounted(async () => {
  await Promise.allSettled([
    reload(),
    fetchReviewPrompt().catch(() => undefined),
  ]);
});
</script>

<style scoped>
.order-detail-page {
  min-height: 100vh;
  background: #f5f7fa;
  padding-bottom: 24px;
}

.order-detail-header {
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

.order-detail-back {
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

.order-detail-title {
  margin: 0;
  font-family: "Montserrat", sans-serif;
  font-weight: 700;
  font-size: 20px;
  line-height: 24px;
  color: #191919;
}

.order-detail-container {
  width: min(393px, 100%);
  margin: 0 auto;
  padding: 8px 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-sizing: border-box;
}

.order-detail-state {
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

.order-detail-loader {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid #e6e9ed;
  border-top-color: #f50302;
  animation: order-detail-spin 0.8s linear infinite;
}

@keyframes order-detail-spin {
  to {
    transform: rotate(360deg);
  }
}

.order-detail-retry {
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
}

.order-detail-overview {
  background: #ffffff;
  border-radius: 20px;
  padding: 16px;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.04);
}

.order-detail-overview__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 14px;
  border-bottom: 1px solid #f0f2f5;
}

.order-detail-overview__summary {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.order-detail-overview__amount {
  font-family: "Montserrat", sans-serif;
  font-size: 22px;
  line-height: 26px;
  font-weight: 700;
  color: #191919;
}

.order-detail-overview__positions {
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 13px;
  line-height: 16px;
  color: #8a93a0;
}

.order-detail-overview__status {
  flex-shrink: 0;
  padding: 5px 10px;
  border-radius: 999px;
  background: #f0f2f5;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 12px;
  line-height: 14px;
  font-weight: 600;
  color: #5c6470;
}

.order-detail-overview__status--delivered,
.order-detail-overview__status--completed {
  background: #e8f7ef;
  color: #1d7a4b;
}

.order-detail-overview__status--cancelled {
  background: #fdeaea;
  color: #a90f0e;
}

.order-detail-overview__timeline {
  list-style: none;
  margin: 0;
  padding: 14px 0 0;
  display: flex;
  flex-direction: column;
}

.order-detail-overview__step {
  display: grid;
  grid-template-columns: 16px 1fr;
  gap: 12px;
  position: relative;
  padding-bottom: 16px;
}

.order-detail-overview__step--last {
  padding-bottom: 0;
}

.order-detail-overview__step:not(.order-detail-overview__step--last)::after {
  content: "";
  position: absolute;
  left: 5px;
  top: 14px;
  bottom: 0;
  width: 2px;
  background: #e6e9ed;
}

.order-detail-overview__dot {
  width: 12px;
  height: 12px;
  margin-top: 2px;
  border-radius: 50%;
  background: #d7dce3;
  position: relative;
  z-index: 1;
}

.order-detail-overview__step--last .order-detail-overview__dot {
  background: #8a93a0;
  box-shadow: 0 0 0 4px rgba(138, 147, 160, 0.12);
}

.order-detail-overview__step--success .order-detail-overview__dot {
  background: #22a06b;
  box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.14);
}

.order-detail-overview__step--cancelled .order-detail-overview__dot {
  background: #a90f0e;
  box-shadow: 0 0 0 4px rgba(169, 15, 14, 0.14);
}

.order-detail-overview__step--cancelled .order-detail-overview__step-label {
  color: #a90f0e;
}

.order-detail-overview__step-body {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.order-detail-overview__step-label {
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 14px;
  line-height: 18px;
  color: #5c6470;
}

.order-detail-overview__step--last .order-detail-overview__step-label {
  color: #191919;
  font-weight: 600;
}

.order-detail-overview__step-time {
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 13px;
  line-height: 16px;
  font-weight: 600;
  color: #191919;
  white-space: nowrap;
}

.order-detail-section-title {
  margin: 0;
  font-family: "Montserrat", sans-serif;
  font-weight: 700;
  font-size: 16px;
  line-height: 20px;
  color: #191919;
}

.order-detail-reviews {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.order-detail-reviews-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 2px;
}

.order-detail-hint {
  margin: 0;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 13px;
  line-height: 17px;
  color: #5c6470;
}

@media (max-width: 360px) {
  .order-detail-container {
    padding-inline: 12px;
  }
}
</style>