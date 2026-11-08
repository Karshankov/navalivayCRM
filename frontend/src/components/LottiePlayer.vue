<template>
  <div
    ref="containerEl"
    class="lottie-player"
    :style="{ width: `${size}px`, height: `${size}px` }"
    aria-hidden="true"
  />
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import lottie, { type AnimationItem } from "lottie-web";

/**
 * Lottie-плеер для анимаций в стиле Telegram (TGS = Lottie JSON).
 * Загружает JSON лениво (fetch при монтировании), играет по кругу,
 * prefers-reduced-motion — стоп-кадр первого фрейма.
 */
const props = withDefaults(
  defineProps<{
    /** Путь к Lottie JSON (публичная папка). */
    src: string;
    /** Размер стороны в px. */
    size?: number;
    /** Скорость (1 = нативная). */
    speed?: number;
    /** Играть по кругу. */
    loop?: boolean;
  }>(),
  { size: 48, speed: 1, loop: true },
);

const containerEl = ref<HTMLElement | null>(null);
let animation: AnimationItem | null = null;

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

async function load() {
  if (!containerEl.value) return;
  destroy();
  try {
    const response = await fetch(props.src);
    if (!response.ok) return;
    const data = await response.json();
    animation = lottie.loadAnimation({
      container: containerEl.value,
      renderer: "svg",
      loop: props.loop,
      autoplay: !reducedMotion(),
      animationData: data,
    });
    animation.setSpeed(props.speed);
    if (reducedMotion() && animation.totalFrames > 0) {
      animation.goToAndStop(0, true);
    }
  } catch {
    /* нет файла/сети — пустой контейнер, без ошибок в консоли UI */
  }
}

function destroy() {
  animation?.destroy();
  animation = null;
}

onMounted(load);
watch(() => props.src, load);
onBeforeUnmount(destroy);
</script>

<style scoped>
.lottie-player {
  display: block;
  flex: none;
  overflow: hidden;
}

.lottie-player :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
