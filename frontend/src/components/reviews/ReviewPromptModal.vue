<template>
  <CustomerModalShell
    :open="modalOpen"
    title="Оцените последний заказ"
    close-label="Закрыть подсказку об отзыве"
    @close="closeModal"
  >
    <div v-if="previewIcons.length" class="review-prompt-modal__thumbs" aria-hidden="true">
      <div
        v-for="(icon, index) in previewIcons"
        :key="`${icon.group_id || icon.category_id || index}`"
        class="review-prompt-modal__thumb"
        :style="{ zIndex: previewIcons.length - index }"
      >
        <img
          v-if="icon.image"
          :src="icon.image"
          :alt="icon.group_name || icon.category_name || 'Товар из заказа'"
        />
        <span v-else class="review-prompt-modal__thumb-placeholder" />
      </div>
      <span v-if="previewOverflow > 0" class="review-prompt-modal__thumb-more">
        +{{ previewOverflow }}
      </span>
    </div>

    <p v-if="orderLabel" class="review-prompt-modal__order">{{ orderLabel }}</p>

    <p v-if="lotteryHintText" class="review-prompt-modal__hint">{{ lotteryHintText }}</p>

    <template #footer>
      <button type="button" class="review-prompt-modal__cta" @click="openOrderDetail">
        Оценить заказ
      </button>
    </template>
  </CustomerModalShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import CustomerModalShell from "@/components/CustomerModalShell.vue";
import { useCustomerOrders } from "@/composables/useCustomerOrders";
import {
  isReviewPromptDismissed,
  markReviewPromptDismissed,
} from "@/utils/reviewPromptDismiss";
import { isReviewPromptModalVisible } from "@/utils/reviewDockVisibility";

const props = withDefaults(
  defineProps<{
    autoLoad?: boolean;
  }>(),
  { autoLoad: true },
);

const route = useRoute();
const router = useRouter();
const { reviewPrompt, fetchReviewPrompt } = useCustomerOrders();

const modalOpen = ref(false);
const dismissed = ref(false);

const prompt = computed(() => reviewPrompt.value);

const previewIcons = computed(() => prompt.value?.preview_icons ?? []);
const previewOverflow = computed(() => Number(prompt.value?.preview_icons_overflow || 0));

const orderLabel = computed(() => {
  const orderNumber = prompt.value?.order_number;
  return orderNumber ? `Заказ №${orderNumber}` : "";
});

const lotteryHintText = computed(() => prompt.value?.lottery_hint_text?.trim() || "");

const shouldOffer = computed(() =>
  isReviewPromptModalVisible(
    {
      path: route.path,
      name: typeof route.name === "string" ? route.name : undefined,
      params: route.params,
    },
    prompt.value,
    { dismissed: dismissed.value },
  ),
);

function syncDismissedState(orderId?: string | null) {
  if (!orderId) {
    dismissed.value = false;
    return;
  }
  dismissed.value = isReviewPromptDismissed(orderId);
}

function closeModal() {
  const orderId = prompt.value?.order_id;
  if (orderId) {
    markReviewPromptDismissed(orderId);
    dismissed.value = true;
  }
  modalOpen.value = false;
}

function openOrderDetail() {
  const orderId = prompt.value?.order_id;
  const groupId = prompt.value?.group_id;
  if (!orderId) return;

  if (orderId) {
    markReviewPromptDismissed(orderId);
    dismissed.value = true;
  }
  modalOpen.value = false;

  router.push({
    name: "order-detail",
    params: { orderId },
    query: groupId ? { groupId } : {},
  });
}

watch(
  () => prompt.value?.order_id,
  (orderId) => {
    syncDismissedState(orderId);
  },
  { immediate: true },
);

watch(
  shouldOffer,
  (offer) => {
    modalOpen.value = offer;
  },
  { immediate: true },
);

async function loadPrompt() {
  if (!props.autoLoad) return;
  if (route.path.startsWith("/profile/orders")) return;
  try {
    await fetchReviewPrompt();
  } catch (error) {
    console.warn("[review-prompt-modal] prompt fetch failed", error);
  }
}

onMounted(() => {
  void loadPrompt();
});

watch(
  () => route.fullPath,
  () => {
    void loadPrompt();
  },
);
</script>

<style scoped>
.review-prompt-modal__thumbs {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 0 4px;
}

.review-prompt-modal__thumb {
  flex: 0 0 56px;
  width: 56px;
  height: 56px;
  min-width: 56px;
  max-width: 56px;
  border-radius: 16px;
  border: 2px solid #ffffff;
  margin-left: -16px;
  overflow: hidden;
  background: #f5f7fa;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.1);
}

.review-prompt-modal__thumb:first-child,
.review-prompt-modal__thumb-placeholder:first-child {
  margin-left: 0;
}

.review-prompt-modal__thumb img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.review-prompt-modal__thumb-placeholder {
  display: block;
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, #f5f7fa 0%, #e8edf3 100%);
}

.review-prompt-modal__thumb-more {
  margin-left: 8px;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 14px;
  line-height: 16px;
  color: #8a93a0;
  white-space: nowrap;
}

.review-prompt-modal__order {
  margin: 12px 0 0;
  text-align: center;
  font-family: "Montserrat", sans-serif;
  font-size: 14px;
  line-height: 18px;
  font-weight: 600;
  color: #64748b;
}

.review-prompt-modal__hint {
  margin: 12px 0 0;
  text-align: center;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 14px;
  line-height: 19px;
  font-weight: 500;
  color: #5c6470;
}

.review-prompt-modal__cta {
  width: 100%;
  min-height: 64px;
  border: none;
  border-radius: 528px;
  background: linear-gradient(90deg, #f50302 0%, #a90f0e 100%);
  color: #ffffff;
  font-family: "Montserrat", sans-serif;
  font-weight: 500;
  font-size: 16px;
  line-height: 20px;
  cursor: pointer;
}
</style>
