<template>
  <nav
    ref="bottomTabBarRef"
    class="bottom-tab-bar"
    aria-label="Навигация"
  >
    <button
      v-for="(tab, index) in tabs"
      :key="tab.id"
      type="button"
      class="tab-item"
      :class="[
        { 'tab-item--active': tab.id === activeId },
        { 'tab-item--collapsed': isCollapsed(index) },
      ]"
      :aria-label="tab.label"
      :aria-current="tab.id === activeId ? 'page' : undefined"
      :aria-hidden="isCollapsed(index) ? 'true' : undefined"
      @click="emit('select', tab.id)"
    >
      <span class="tab-icon-wrap">
        <!-- Жидкости: бутылёк с каплей -->
        <svg
          v-if="tab.icon === 'liquids'"
          class="tab-icon"
          viewBox="0 0 24 24"
          fill="none"
        >
          <path
            d="M10 3.5C10 2.67 10.67 2 11.5 2H12.5C13.33 2 14 2.67 14 3.5V5C14 5.55 14.45 6 15 6H15.2C16.75 6 18 7.25 18 8.8V18.2C18 19.75 16.75 21 15.2 21H8.8C7.25 21 6 19.75 6 18.2V8.8C6 7.25 7.25 6 8.8 6H9C9.55 6 10 5.55 10 5V3.5Z"
            :fill="isActive(tab.id) ? '#191919' : 'none'"
            :stroke="isActive(tab.id) ? '#191919' : '#48535E'"
            stroke-width="1.6"
            stroke-linejoin="round"
          />
          <path
            d="M9 13.2C9 11.4 10.3 9.8 12 9.2C13.7 9.8 15 11.4 15 13.2C15 14.75 13.66 16 12 16C10.34 16 9 14.75 9 13.2Z"
            :fill="isActive(tab.id) ? '#FFFFFF' : '#48535E'"
            :stroke="isActive(tab.id) ? '#FFFFFF' : '#48535E'"
            stroke-width="0.8"
            stroke-linejoin="round"
          />
        </svg>

        <!-- Одноразки: продолговатый стик с мундштуком -->
        <svg
          v-else-if="tab.icon === 'disposables'"
          class="tab-icon"
          viewBox="0 0 24 24"
          fill="none"
        >
          <path
            d="M9 2.8C9 2.36 9.36 2 9.8 2H14.2C14.64 2 15 2.36 15 2.8V21.2C15 21.64 14.64 22 14.2 22H9.8C9.36 22 9 21.64 9 21.2V2.8Z"
            :fill="isActive(tab.id) ? '#191919' : 'none'"
            :stroke="isActive(tab.id) ? '#191919' : '#48535E'"
            stroke-width="1.6"
            stroke-linejoin="round"
          />
          <path
            d="M11.4 4.4H12.6"
            :stroke="isActive(tab.id) ? '#FFFFFF' : '#48535E'"
            stroke-width="1.3"
            stroke-linecap="round"
          />
          <rect
            x="10.9"
            y="8"
            width="2.2"
            height="5"
            rx="1"
            :fill="isActive(tab.id) ? '#FFFFFF' : '#48535E'"
          />
        </svg>

        <!-- Снюс: пакетик-саше -->
        <svg
          v-else-if="tab.icon === 'snus'"
          class="tab-icon"
          viewBox="0 0 24 24"
          fill="none"
        >
          <path
            d="M7.5 4C7.5 3.45 7.95 3 8.5 3H15.5C16.05 3 16.5 3.45 16.5 4V7.5C16.5 7.5 19.5 9 19.5 13V18.5C19.5 19.88 18.38 21 17 21H7C5.62 21 4.5 19.88 4.5 18.5V13C4.5 9 7.5 7.5 7.5 7.5V4Z"
            :fill="isActive(tab.id) ? '#191919' : 'none'"
            :stroke="isActive(tab.id) ? '#191919' : '#48535E'"
            stroke-width="1.6"
            stroke-linejoin="round"
          />
          <path
            d="M7.5 6H16.5"
            :stroke="isActive(tab.id) ? '#FFFFFF' : '#48535E'"
            stroke-width="1.3"
            stroke-linecap="round"
          />
        </svg>

        <!-- Главная: домик -->
        <svg
          v-else-if="tab.icon === 'home'"
          class="tab-icon"
          viewBox="0 0 24 24"
          fill="none"
        >
          <path
            d="M4 10.2L11.1 4.25C11.6 3.83 12.4 3.83 12.9 4.25L20 10.2V19.4C20 20.28 19.28 21 18.4 21H15.5C15 21 14.6 20.6 14.6 20.1V16.4C14.6 15.63 13.97 15 13.2 15H10.8C10.03 15 9.4 15.63 9.4 16.4V20.1C9.4 20.6 9 21 8.5 21H5.6C4.72 21 4 20.28 4 19.4V10.2Z"
            :fill="isActive(tab.id) ? '#191919' : 'none'"
            :stroke="isActive(tab.id) ? '#191919' : '#48535E'"
            stroke-width="1.6"
            stroke-linejoin="round"
          />
        </svg>

        <!-- Устройства: POD-система — корпус с картриджем -->
        <svg
          v-else-if="tab.icon === 'devices'"
          class="tab-icon"
          viewBox="0 0 24 24"
          fill="none"
        >
          <path
            d="M8.5 5.6C8.5 4.16 9.66 3 11.1 3H12.9C14.34 3 15.5 4.16 15.5 5.6V18.4C15.5 19.84 14.34 21 12.9 21H11.1C9.66 21 8.5 19.84 8.5 18.4V5.6Z"
            :fill="isActive(tab.id) ? '#191919' : 'none'"
            :stroke="isActive(tab.id) ? '#191919' : '#48535E'"
            stroke-width="1.6"
            stroke-linejoin="round"
          />
          <rect
            x="10.2"
            y="5.8"
            width="3.6"
            height="4.2"
            rx="1"
            :fill="isActive(tab.id) ? '#FFFFFF' : '#48535E'"
          />
          <path
            d="M10.2 15.8H13.8"
            :stroke="isActive(tab.id) ? '#FFFFFF' : '#48535E'"
            stroke-width="1.3"
            stroke-linecap="round"
          />
        </svg>

        <!-- Расходники: испаритель-спираль -->
        <svg
          v-else-if="tab.icon === 'accessories'"
          class="tab-icon"
          viewBox="0 0 24 24"
          fill="none"
        >
          <path
            d="M6.5 8.2H8C8 6.8 9.1 6 10.3 6H13.7C14.9 6 16 6.8 16 8.2H17.5C18.6 8.2 19.5 9.1 19.5 10.2C19.5 11.3 18.6 12.2 17.5 12.2H16V15.8H17.5C18.6 15.8 19.5 16.7 19.5 17.8C19.5 18.9 18.6 19.8 17.5 19.8H6.5C5.4 19.8 4.5 18.9 4.5 17.8C4.5 16.7 5.4 15.8 6.5 15.8H8V12.2H6.5C5.4 12.2 4.5 11.3 4.5 10.2C4.5 9.1 5.4 8.2 6.5 8.2Z"
            :fill="isActive(tab.id) ? '#191919' : 'none'"
            :stroke="isActive(tab.id) ? '#191919' : '#48535E'"
            stroke-width="1.6"
            stroke-linejoin="round"
          />
          <path
            d="M10 8.5V15.5M12 8.5V15.5M14 8.5V15.5"
            :stroke="isActive(tab.id) ? '#FFFFFF' : '#48535E'"
            stroke-width="1.1"
            stroke-linecap="round"
          />
        </svg>

        <!-- Кальянка: колба кальяна -->
        <svg
          v-else-if="tab.icon === 'hookah'"
          class="tab-icon"
          viewBox="0 0 24 24"
          fill="none"
        >
          <path
            d="M12 2C11.45 2 11 2.45 11 3V5H13V3C13 2.45 12.55 2 12 2Z"
            :fill="isActive(tab.id) ? '#191919' : '#48535E'"
          />
          <path
            d="M13 5H18C18.55 5 19 5.45 19 6V7.5C19 9.2 17.6 10.5 15.9 10.5H13V5Z"
            :fill="isActive(tab.id) ? '#191919' : 'none'"
            :stroke="isActive(tab.id) ? '#191919' : '#48535E'"
            stroke-width="1.5"
            stroke-linejoin="round"
          />
          <path
            d="M11 5H6C5.45 5 5 5.45 5 6V7.5C5 9.2 6.4 10.5 8.1 10.5H11V5Z"
            :fill="isActive(tab.id) ? '#191919' : 'none'"
            :stroke="isActive(tab.id) ? '#191919' : '#48535E'"
            stroke-width="1.5"
            stroke-linejoin="round"
          />
          <path
            d="M10 10.5H14V12C14 12.55 13.55 13 13 13H11C10.45 13 10 12.55 10 12V10.5Z"
            :fill="isActive(tab.id) ? '#191919' : '#48535E'"
          />
          <path
            d="M9 21C8.45 21 8 20.55 8 20C8 17 9.8 15.5 11 14.5C11.4 14.15 12.6 14.15 13 14.5C14.2 15.5 16 17 16 20C16 20.55 15.55 21 15 21H9Z"
            :fill="isActive(tab.id) ? '#191919' : 'none'"
            :stroke="isActive(tab.id) ? '#191919' : '#48535E'"
            stroke-width="1.5"
            stroke-linejoin="round"
          />
        </svg>

        <span v-if="isActive(tab.id)" class="tab-active-dot"></span>
      </span>
    </button>
  </nav>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import type { TabDefinition, TabId } from "./shell/tabs";

const props = defineProps<{
  tabs: readonly TabDefinition[];
  activeId: TabId;
}>();

const emit = defineEmits<{
  (event: "select", id: TabId): void;
}>();

function isActive(id: string): boolean {
  return props.activeId === id;
}

/**
 * Коллапс краёв: видимы 2 иконки от центра в каждую сторону. Крайняя
 * третья вкладка (index 0 слева, последний справа) появляется плавно,
 * когда активная вкладка — соседняя с ней. Физика как в Instagram:
 * бар всегда лёгкий, лишние иконки не мозолят глаза.
 */
const activeIndex = computed(() =>
  props.tabs.findIndex((tab) => tab.id === props.activeId),
);

/** Иконка сжата (невидима): за пределами окна ±2 от активной. */
function isCollapsed(index: number): boolean {
  const distance = Math.abs(index - activeIndex.value);
  // Окно видимости: активная ±2. Крайние вкладки появляются по мере
  // приближения к краям — окно всегда показывает контекст навигации.
  return distance > 2;
}
// Пояснение: окно НЕ центрируется жёстко, а следует за активной
// вкладкой — на краях видны крайние иконки (как карусель контекста).

const bottomTabBarRef = ref<HTMLElement | null>(null);
let resizeObserver: ResizeObserver | null = null;

/* Контракт высоты: WheelHomeWidget и прочие абсолютные элементы
 * позиционируются от --app-bottom-tab-bar-height. Сохраняем механизм
 * ResizeObserver из старого бара. */
function syncBottomTabBarHeight() {
  if (typeof document === "undefined" || !bottomTabBarRef.value) {
    return;
  }

  document.documentElement.style.setProperty(
    "--app-bottom-tab-bar-height",
    `${bottomTabBarRef.value.offsetHeight}px`,
  );
}

onMounted(() => {
  requestAnimationFrame(syncBottomTabBarHeight);

  if (typeof ResizeObserver !== "undefined" && bottomTabBarRef.value) {
    resizeObserver = new ResizeObserver(syncBottomTabBarHeight);
    resizeObserver.observe(bottomTabBarRef.value);
  }

  window.addEventListener("resize", syncBottomTabBarHeight);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  window.removeEventListener("resize", syncBottomTabBarHeight);
});
</script>

<style scoped>
.bottom-tab-bar {
  position: sticky;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: space-around;
  height: calc(52px + env(safe-area-inset-bottom, 0px));
  padding-bottom: env(safe-area-inset-bottom, 0px);
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-top: 0.5px solid rgba(0, 0, 0, 0.08);
  pointer-events: auto;
}

.tab-item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 52px;
  border: none;
  background: none;
  padding: 0;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: opacity 0.2s ease;
}

.tab-item:active {
  opacity: 0.6;
}

/* Коллапс краёв: ШИРИНА сохраняется (позиции стабильны, клики
 * попадают в свои кнопки), растворяется только иконка —
 * fade + scale на обёртке иконки, layout не дёргается. */
.tab-item--collapsed .tab-icon-wrap {
  opacity: 0;
  transform: scale(0.55);
  pointer-events: none;
}

.tab-item--collapsed {
  opacity: 1;
}

.tab-icon-wrap {
  transition: opacity 0.22s ease, transform 0.22s cubic-bezier(0.34, 1.2, 0.64, 1);
}

.tab-icon-wrap {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
}

.tab-icon {
  width: 25px;
  height: 25px;
  /* Плавная смена цвета иконки при активации */
  transition: fill 0.18s ease, stroke 0.18s ease;
}

.tab-active-dot {
  position: absolute;
  bottom: -8px;
  left: 50%;
  transform: translateX(-50%);
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #f50302;
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease;
}
</style>
