<template>
  <div v-if="ready" class="review-rating-row">
    <template v-if="count > 0">
      <span class="review-rating-row__score" aria-hidden="true">
        <span class="review-rating-row__star">★</span>
        <span class="review-rating-row__average">{{ formattedAverage }}</span>
        <span class="review-rating-row__count">({{ count }})</span>
      </span>
      <button
        type="button"
        class="review-rating-row__action"
        :aria-label="actionAriaLabel"
        @click.stop="emit('click')"
      >
        посмотреть отзывы
      </button>
    </template>
    <p v-else-if="mode === 'parent'" class="review-rating-row__parent-hint">
      отзывы у линеек ниже
    </p>
    <p v-else class="review-rating-row__empty">нет отзывов</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    count: number;
    averageRating: number | null;
    ready?: boolean;
    /** Parent rows aggregate child lines; empty state is a neutral hint, not an error. */
    mode?: "leaf" | "parent";
  }>(),
  { ready: true, mode: "leaf" },
);

const emit = defineEmits<{
  click: [];
}>();

const formattedAverage = computed(() => {
  if (props.averageRating == null) return "—";
  const rounded = Math.round(props.averageRating * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
});

const actionAriaLabel = computed(() => {
  const reviewsWord = props.count === 1 ? "отзыв" : props.count < 5 ? "отзыва" : "отзывов";
  return `Посмотреть ${props.count} ${reviewsWord}, средняя оценка ${formattedAverage.value} из 5`;
});
</script>

<style scoped>
.review-rating-row {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 6px;
  margin-top: 4px;
  min-height: 14px;
  min-width: 0;
}

.review-rating-row__score {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 12px;
  line-height: 14px;
  white-space: nowrap;
}

.review-rating-row__star {
  color: #f50302;
  font-size: 12px;
  line-height: 1;
}

.review-rating-row__average {
  font-weight: 600;
  color: #191919;
}

.review-rating-row__count {
  color: #8a93a0;
}

.review-rating-row__action {
  margin: 0;
  padding: 0;
  border: none;
  background: none;
  flex-shrink: 0;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 12px;
  line-height: 14px;
  font-weight: 400;
  color: #0273f5;
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
  transition: opacity 0.2s ease;
  -webkit-tap-highlight-color: transparent;
}

.review-rating-row__action:active {
  opacity: 0.72;
}

.review-rating-row__parent-hint {
  margin: 0;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 12px;
  line-height: 14px;
  font-weight: 400;
  color: #8a93a0;
}

.review-rating-row__empty {
  margin: 0;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 12px;
  line-height: 14px;
  font-weight: 500;
  color: #de2b2b;
}
</style>