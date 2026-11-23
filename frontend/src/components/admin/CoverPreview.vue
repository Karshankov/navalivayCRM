<template>
  <!-- Превью обложки ровно как в мини-аппе: тот же компонент и тот же
       расчёт геометрии. Что видно здесь — увидят покупатели. -->
  <div class="cover-preview">
    <div class="cover-preview__frame">
      <div class="cover-preview__art">
        <ImageFade :src="src" :alt="alt" :zoom="zoom / 100" :shift-x="shift" />
      </div>
      <div class="cover-preview__info">
        <span class="cover-preview__title">{{ title }}</span>
        <span v-if="meta" class="cover-preview__meta">{{ meta }}</span>
        <span class="cover-preview__reviews">★ 5 Отзывы · 12</span>
      </div>
    </div>
    <p class="cover-preview__hint">
      Так карточка выглядит в мини-аппе
    </p>

    <!-- Правки расположения: сотрудник видит результат сразу здесь. -->
    <div class="cover-preview__controls">
      <label class="cover-preview__control">
        <span class="cover-preview__control-label">
          Размер <b>{{ zoom }}%</b>
        </span>
        <input
          :value="zoom"
          type="range"
          min="60"
          max="200"
          step="5"
          class="cover-preview__slider"
          data-test="cover-zoom"
          @input="emit('update:zoom', Number(($event.target as HTMLInputElement).value))"
        />
      </label>

      <label class="cover-preview__control">
        <span class="cover-preview__control-label">
          Сдвиг <b>{{ shiftLabel }}</b>
        </span>
        <input
          :value="shift"
          type="range"
          min="-40"
          max="40"
          step="5"
          class="cover-preview__slider"
          data-test="cover-shift"
          @input="emit('update:shift', Number(($event.target as HTMLInputElement).value))"
        />
      </label>

      <button
        type="button"
        class="cover-preview__reset"
        data-test="cover-reset"
        @click="reset"
      >
        Сбросить
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import ImageFade from "@/components/product/ImageFade.vue";

const props = withDefaults(
  defineProps<{
    src: string | null;
    title?: string;
    meta?: string;
    alt?: string;
    /** Размер фото в процентах: 100 — как подобрал алгоритм. */
    zoom?: number;
    /** Сдвиг вбок в процентах: минус влево, плюс вправо. */
    shift?: number;
  }>(),
  { title: "Название линейки", meta: "Крепость 20 мг", alt: "", zoom: 100, shift: 0 },
);

const emit = defineEmits<{
  "update:zoom": [value: number];
  "update:shift": [value: number];
}>();

/** Подпись сдвига: ноль значит «как подобрал алгоритм». */
const shiftLabel = computed(() => {
  if (props.shift === 0) return "по центру";
  return props.shift > 0 ? `${props.shift}% вправо` : `${-props.shift}% влево`;
});

/** Возврат к автоподбору: множитель 1 и без сдвига. */
function reset() {
  emit("update:zoom", 100);
  emit("update:shift", 0);
}
</script>

<style scoped>
.cover-preview {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* Карточка в масштабе телефона: ширина мини-аппа, пропорции сохранены. */
.cover-preview__frame {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 16px 16px 12px;
  border-radius: 20px;
  background: #ffffff;
  border: 1px solid #e6e9ed;
}

/* Область фото: те же габариты, что в мини-аппе. */
.cover-preview__art {
  position: relative;
  flex: 0 0 auto;
  align-self: stretch;
  width: 76px;
  min-height: 92px;
  margin-top: -16px;
  margin-bottom: -16px;
  margin-right: 10px;
}

.cover-preview__info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  font-family: "Montserrat", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.cover-preview__title {
  font-size: 16px;
  font-weight: 700;
  line-height: 20px;
  color: #3a3a3a;
  overflow-wrap: break-word;
}

.cover-preview__meta {
  font-size: 13.2px;
  font-weight: 400;
  line-height: 17px;
  color: #aab2bd;
}

.cover-preview__reviews {
  margin-top: 1px;
  font-size: 12px;
  font-weight: 400;
  line-height: 14px;
  color: #0273f5;
}

.cover-preview__hint {
  margin: 0;
  font-size: 11px;
  color: #6b7280;
}

/* Управление расположением: два ползунка и сброс. */
.cover-preview__controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 12px;
  background: #f9fafb;
  border: 1px solid #e6e9ed;
}

.cover-preview__control {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 180px;
  flex: 1;
}

.cover-preview__control-label {
  flex-shrink: 0;
  font-size: 12px;
  color: #4b5563;
  white-space: nowrap;
}

.cover-preview__control-label b {
  color: #111827;
}

.cover-preview__slider {
  flex: 1;
  min-width: 90px;
  accent-color: #d82319;
  cursor: pointer;
}

.cover-preview__reset {
  flex-shrink: 0;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid #d1d5db;
  background: #ffffff;
  font-size: 12px;
  color: #374151;
  cursor: pointer;
}

.cover-preview__reset:hover {
  border-color: #9ca3af;
  color: #111827;
}
</style>
