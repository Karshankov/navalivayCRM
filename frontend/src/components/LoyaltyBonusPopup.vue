<template>
  <CustomerModalShell
    :open="open"
    title="У вас уже есть доступные бонусы"
    close-label="Закрыть подсказку"
    @close="$emit('close')"
  >
    <div class="loyalty-popup-copy">
      <p class="loyalty-popup-kicker">Скидки за покупки</p>
      <p>{{ categorySummary }}</p>
    </div>

    <template #footer>
      <div class="loyalty-popup-actions">
        <button type="button" class="loyalty-popup-secondary" @click="$emit('close')">
          Позже
        </button>
        <button type="button" class="loyalty-popup-primary" @click="$emit('open-profile')">
          Открыть профиль
        </button>
      </div>
    </template>
  </CustomerModalShell>
</template>

<script setup lang="ts">
import { computed } from "vue";
import CustomerModalShell from "@/components/CustomerModalShell.vue";

interface PopupCategory {
  key: string;
  title: string;
  available_bonus_count: number;
}

const props = defineProps<{
  open: boolean;
  categories: PopupCategory[];
}>();

defineEmits<{
  (event: "close"): void;
  (event: "open-profile"): void;
}>();

const categorySummary = computed(() => {
  const relevant = props.categories
    .filter((category) => Number(category.available_bonus_count || 0) > 0)
    .map((category) => `${category.title}: ${category.available_bonus_count}`);

  if (!relevant.length) {
    return "Откройте профиль, чтобы посмотреть доступные скидки и применить их в заказе.";
  }

  return `${relevant.join(" • ")}. Откройте профиль, чтобы посмотреть детали.`;
});
</script>

<style scoped>
.loyalty-popup-copy {
  color: #191919;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-weight: 500;
  font-size: 16px;
  line-height: 19px;
}

.loyalty-popup-copy p {
  margin: 0;
}

.loyalty-popup-copy p + p {
  margin-top: 16px;
}

.loyalty-popup-kicker {
  font-size: 12px;
  line-height: 14px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #a90f0e;
  font-weight: 700;
}

.loyalty-popup-actions {
  display: flex;
  gap: 10px;
}

.loyalty-popup-secondary,
.loyalty-popup-primary {
  flex: 1;
  min-height: 64px;
  border-radius: 528px;
  border: none;
  font-family: "Montserrat", sans-serif;
  font-size: 15px;
  line-height: 20px;
  font-weight: 500;
  cursor: pointer;
}

.loyalty-popup-secondary {
  background: #f5f7fa;
  color: #191919;
}

.loyalty-popup-primary {
  background: linear-gradient(90deg, #f50302 0%, #a90f0e 100%);
  color: #ffffff;
}

@media (max-width: 360px) {
  .loyalty-popup-actions {
    flex-direction: column;
  }
}
</style>
