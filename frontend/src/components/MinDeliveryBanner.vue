<template>
  <CustomerModalShell
    :open="isOpen"
    title="Минимальная сумма заказа"
    close-label="Закрыть подсказку"
    @close="close"
  >
    <div class="min-delivery-content">
      <div v-if="bannerImage" class="min-delivery-image">
        <img :src="bannerImage" alt="Минимальная сумма заказа" />
      </div>

      <div class="min-delivery-copy">
        <p>
          Для оформления доставки сумма заказа должна быть не менее
          <strong>{{ minAmount }} BYN</strong>.
        </p>
        <p>
          Сейчас в вашей корзине
          <strong>{{ currentAmount }} BYN</strong>.
        </p>
        <p class="min-delivery-copy-accent">
          Добавьте товаров еще на
          <strong>{{ diffAmount }} BYN</strong>.
        </p>
      </div>
    </div>

    <template #footer>
      <button type="button" class="min-delivery-cta" @click="close">
        {{ buttonText }}
      </button>
    </template>
  </CustomerModalShell>
</template>

<script setup lang="ts">
import { computed } from "vue";
import CustomerModalShell from "@/components/CustomerModalShell.vue";

interface Props {
  isOpen: boolean;
  minAmount: number;
  currentAmount: number;
  bannerImage?: string;
  buttonText?: string;
  buttonColor?: string;
}

const props = withDefaults(defineProps<Props>(), {
  bannerImage: "",
  buttonText: "Понятно",
  buttonColor: "",
});

const emit = defineEmits<{
  (e: "close"): void;
}>();

const diffAmount = computed(() => {
  const diff = props.minAmount - props.currentAmount;
  return diff > 0 ? diff.toFixed(2) : "0.00";
});

function close() {
  emit("close");
}
</script>

<style scoped>
.min-delivery-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.min-delivery-image {
  width: 100%;
  border-radius: 16px;
  overflow: hidden;
  background: #f5f7fa;
}

.min-delivery-image img {
  display: block;
  width: 100%;
  max-height: 200px;
  object-fit: cover;
}

.min-delivery-copy {
  color: #191919;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-weight: 500;
  font-size: 16px;
  line-height: 19px;
}

.min-delivery-copy p {
  margin: 0;
}

.min-delivery-copy p + p {
  margin-top: 18px;
}

.min-delivery-copy strong {
  font-weight: 700;
}

.min-delivery-copy-accent {
  color: #a90f0e;
}

.min-delivery-cta {
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
