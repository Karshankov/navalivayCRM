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
         pointer-events сняты — нажатия проходят сквозь.

         В редакторе обложки наплыв выключен: там важно видеть самый край
         кадра, а наплыв его забеливает — и не понять, обрезано фото или
         растворено. -->
    <span v-if="fade && src && !failed" class="image-fade__fade" aria-hidden="true" />
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
    /** Растворять правый край в фоне карточки. По умолчанию да — так
     *  задумано у клиента. В редакторе выключаем, чтобы видеть край. */
    fade?: boolean;
  }>(),
  { alt: "", zoom: undefined, shiftX: undefined, shiftY: undefined, manual: false, fade: true },
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

/* Наплыв: лёгкий у основной части, плотнее у границы с текстом.
   Нижний слабее бокового. Цвет — фон карточки, иначе виден шов. */
.image-fade__fade {
  position: absolute;
  inset: 0;
  z-index: 1;
  --fade: var(--customer-surface, #ffffff);
  background:
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--fade) 5%, transparent) 0%,
      color-mix(in srgb, var(--fade) 5%, transparent) 40%,
      color-mix(in srgb, var(--fade) 18%, transparent) 62%,
      color-mix(in srgb, var(--fade) 61%, transparent) 82%,
      var(--fade) 100%
    ),
    linear-gradient(
      0deg,
      color-mix(in srgb, var(--fade) 55%, transparent) 0%,
      transparent 32%
    );
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  .image-fade__img {
    transition: none;
  }
}
</style>
