<template>
  <div
    v-if="ready && (count > 0 || mode !== 'parent')"
    class="review-rating-row"
  >
    <!-- Отзывы есть: оценка и количество одной строкой. Нажимается
         вся строка — так проще попасть пальцем, чем по слову. -->
    <button
      v-if="count > 0"
      type="button"
      class="review-rating-row__score"
      :aria-label="actionAriaLabel"
      @click.stop="emit('click')"
    >
      <span class="review-rating-row__star" aria-hidden="true">★</span>
      <span class="review-rating-row__average">{{ formattedAverage }}</span>
      <span class="review-rating-row__label">Отзывы</span>
      <span class="review-rating-row__dot" aria-hidden="true">·</span>
      <span class="review-rating-row__count">{{ count }}</span>
    </button>
    <!-- У родительских линеек отзывы живут на дочерних: своей строки
         не показываем, чтобы не занимать место пустой подсказкой. -->
    <p v-else-if="mode !== 'parent'" class="review-rating-row__empty">Нет отзывов</p>
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
  /* Небольшой отступ от крепости: строка стоит вплотную к ней, но
     не слипается. Общий gap контейнера даёт ещё 2px. */
  margin-top: 1px;
  min-height: 14px;
  min-width: 0;
}

/* Строка отзывов: оценка и количество синим, «отзывы» и тире тише.
   Вся строка — одна кнопка, чтобы попадать пальцем без прицела. */
.review-rating-row__score {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  /* Montserrat: строка стоит рядом с названием линейки, набранным им же. */
  font-family: "Montserrat", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 12px;
  line-height: 14px;
  white-space: nowrap;
  cursor: pointer;
  transition: opacity 0.2s ease;
  -webkit-tap-highlight-color: transparent;
}

.review-rating-row__score:active {
  opacity: 0.72;
}

.review-rating-row__score:focus-visible {
  outline: 2px solid #0273f5;
  outline-offset: 2px;
  border-radius: 4px;
}

.review-rating-row__star {
  color: #f50302;
  font-size: 12px;
  line-height: 1;
}

/* Оценка обычным цветом текста, количество — синим акцентом.
   Вес у числа и слова общий: «отзывы · 2» читаются одной фразой. */
.review-rating-row__average {
  font-weight: 600;
  color: #191919;
}

.review-rating-row__count {
  font-weight: 400;
  color: #0273f5;
}

/* Вся строка в синем акценте: слово, разделитель и число читаются
   одним блоком. */
.review-rating-row__label,
.review-rating-row__dot,
.review-rating-row__count {
  color: #0273f5;
}

/* После оценки воздух больше, чем внутри «отзывы · 2»: это граница
   между показателем рейтинга и ссылкой на список отзывов. */
.review-rating-row__average {
  margin-right: 5px;
}

/* Точка-разделитель: стоит по центру строки, а не на基线 шрифта. */
.review-rating-row__dot {
  display: inline-flex;
  align-items: center;
  font-size: 14px;
  line-height: 1;
}

/* Пустое состояние: тот же синий, что у «Отзывы» — строка отвечает
   на один вопрос, меняется только текст. */
.review-rating-row__empty {
  margin: 0;
  font-family: "Montserrat", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 12px;
  line-height: 14px;
  font-weight: 400;
  color: #0273f5;
}
</style>