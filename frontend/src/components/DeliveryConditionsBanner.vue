<template>
  <CustomerModalShell
    :open="isOpen"
    title="Условия доставки"
    close-label="Закрыть условия доставки"
    max-width="393px"
    @close="close"
  >
    <div class="delivery-conditions-content">
      <div v-if="image" class="delivery-conditions-image">
        <img :src="image" alt="Условия доставки" />
      </div>

      <div v-else class="delivery-conditions-fallback">
        <p>Информация о доставке будет добавлена позже.</p>
      </div>
    </div>

    <template #footer>
      <button type="button" class="delivery-conditions-cta" @click="close">
        Продолжить оформление
      </button>
    </template>
  </CustomerModalShell>
</template>

<script setup lang="ts">
import CustomerModalShell from "@/components/CustomerModalShell.vue";

interface Props {
  isOpen: boolean;
  image?: string;
}

defineProps<Props>();

const emit = defineEmits<{
  (e: "close"): void;
}>();

function close() {
  emit("close");
}
</script>

<style scoped>
.delivery-conditions-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.delivery-conditions-image {
  width: 100%;
  border-radius: 16px;
  overflow: hidden;
  background: #f5f7fa;
}

.delivery-conditions-image img {
  display: block;
  width: 100%;
  max-height: min(56vh, 520px);
  object-fit: contain;
  background: #ffffff;
}

.delivery-conditions-fallback {
  color: #191919;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-weight: 500;
  font-size: 16px;
  line-height: 19px;
}

.delivery-conditions-fallback p {
  margin: 0;
}

.delivery-conditions-cta {
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
