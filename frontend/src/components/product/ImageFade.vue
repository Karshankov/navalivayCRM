<template>
  <!-- Область фото: увеличенная картинка обрезается её границами и не
       заходит на текст. z-index тут не поможет — обрезка физическая. -->
  <span ref="areaRef" class="image-fade" :class="{ 'image-fade--loaded': loaded }">
    <img
      v-if="src && !failed"
      ref="imgRef"
      class="image-fade__img"
      :src="src"
      :alt="alt"
      :style="imageStyle"
      loading="lazy"
      decoding="async"
      @load="onLoad"
      @error="onError"
    />
    <span v-else class="image-fade__placeholder" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="M21 15l-5-5L5 21" />
      </svg>
    </span>

    <!-- Белый наплыв: растворяет правый край фото в фоне карточки.
         pointer-events сняты — нажатия проходят сквозь. -->
    <span v-if="src && !failed" class="image-fade__fade" aria-hidden="true" />
  </span>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useImageFadeGeometry } from "@/composables/useImageFadeGeometry";

const props = withDefaults(
  defineProps<{
    src: string | null;
    alt?: string;
    /** Ручные поправки из CRM: множитель масштаба и сдвиги по осям. */
    zoom?: number;
    shiftX?: number;
    shiftY?: number;
    /** Кадр настроен руками: автоподбор не применяется. */
    manual?: boolean;
  }>(),
  { alt: "", zoom: undefined, shiftX: undefined, shiftY: undefined, manual: false },
);

const areaRef = ref<HTMLElement | null>(null);
const imgRef = ref<HTMLImageElement | null>(null);

/* Поправки передаём в расчёт: он применяет их поверх автоподбора
   либо, в ручном режиме, вместо него. */
const overrides = computed(() => ({
  zoom: props.zoom,
  shiftX: props.shiftX,
  shiftY: props.shiftY,
  manual: props.manual,
}));

const {
  imageStyle,
  loaded,
  failed,
  observe,
  handleLoad,
  handleError,
  syncFromImage,
} = useImageFadeGeometry(overrides);

function onLoad(event: Event) {
  handleLoad(event);
}

function onError() {
  handleError();
}

onMounted(() => {
  observe(areaRef.value);
  // Картинка могла успеть загрузиться из кэша до подписки.
  syncFromImage(imgRef.value);
});

defineExpose({ loaded, failed });
</script>

<style scoped>
.image-fade {
  position: relative;
  display: block;
  /* Занимает всю родительскую область: сама она задаёт габариты. */
  width: 100%;
  height: 100%;
  overflow: hidden;
  /* Область фото не участвует в нажатиях: кликается вся карточка. */
  pointer-events: none;
}

/* Фото крупнее области и вылезает за её края — обрезается overflow. */
.image-fade__img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  transform-origin: center center;
  /* Пока не загрузилось — не мигаем: размер области уже задан. */
  opacity: 0;
  transition: opacity 0.2s ease;
}

.image-fade--loaded .image-fade__img {
  opacity: 1;
}

/* Заглушка: те же габариты, что у фото, без скачка размеров. */
.image-fade__placeholder {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #e6e9ed;
}

.image-fade__placeholder svg {
  width: 40%;
  max-width: 40px;
  aspect-ratio: 1;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
}

/* Наплыв: мягкий. Смягчает стык фото с карточкой, но самого фото не
   прячет — раньше правый край закрывался белым полностью, и картинка
   у края пропадала.

   Плотность — 55% от исходной. Исходно было 5, 5, 18, 61, 100 (боковой)
   и 55 (низ); отсюда 3, 3, 10, 34, 55 и 30. Сперва поставили 40%, затем
   прибавили 15 — подняли плотность по всему градиенту, включая край.

   Край вместо 100 стал 55: белой пелены нет, фото у края видно, но стык
   смягчён заметнее.

   Правый наплыв сдвинут влево, ближе к фото: нарастание начинается
   раньше, 5, 8, 22, 42. Раньше до 40% ширины он почти не читался (3%),
   и смягчался только самый край. Край 55 оставлен — его не двигали.

   Нижний наплыв растянут вверх и усилен: держит 60% первые 10% высоты и
   сходит на нет к 50%. Раньше 30% стояло только у самого края и гасло уже
   к 32%, поэтому снизу читалось слабо. 60% плотнее исходного варианта
   (там было 55% у края, но сходило к 32%) — так и задумано, свечение
   снизу должно быть заметным.

   Цвет — фон карточки, иначе на стыке виден шов. */
.image-fade__fade {
  position: absolute;
  inset: 0;
  z-index: 1;
  --fade: var(--customer-surface, #ffffff);
  background:
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--fade) 5%, transparent) 0%,
      color-mix(in srgb, var(--fade) 8%, transparent) 40%,
      color-mix(in srgb, var(--fade) 22%, transparent) 62%,
      color-mix(in srgb, var(--fade) 42%, transparent) 82%,
      color-mix(in srgb, var(--fade) 55%, transparent) 100%
    ),
    linear-gradient(
      0deg,
      color-mix(in srgb, var(--fade) 60%, transparent) 0%,
      color-mix(in srgb, var(--fade) 60%, transparent) 10%,
      transparent 50%
    );
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  .image-fade__img {
    transition: none;
  }
}
</style>
