<template>
  <nav
    ref="bottomTabBarRef"
    class="bottom-tab-bar"
    aria-label="Навигация"
  >
    <button
      v-for="tab in tabs"
      :key="tab.id"
      type="button"
      class="tab-item"
      :class="{ 'tab-item--active': tab.id === activeId }"
      :aria-label="tab.label"
      :aria-current="tab.id === activeId ? 'page' : undefined"
      @click="emit('select', tab.id)"
    >
      <span class="tab-icon-wrap">
        <!-- Жидкости: капля -->
        <svg
          v-if="tab.icon === 'liquids'"
          class="tab-icon"
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
        >
          <path
            d="M12 3.2C12 3.2 5.8 9.8 5.8 14.2C5.8 17.85 8.6 20.7 12 20.7C15.4 20.7 18.2 17.85 18.2 14.2C18.2 9.8 12 3.2 12 3.2Z"
            :fill="tab.id === activeId ? '#191919' : 'none'"
            :stroke="tab.id === activeId ? '#191919' : '#3E4C59'"
            stroke-width="1.7"
            stroke-linejoin="round"
          />
          <path
            d="M9.2 14.4C9.2 16.4 10.5 18 12.3 18.4"
            :stroke="tab.id === activeId ? '#fff' : '#3E4C59'"
            stroke-width="1.5"
            stroke-linecap="round"
          />
        </svg>

        <!-- Одноразки: прямоугольный стик -->
        <svg
          v-else-if="tab.icon === 'disposables'"
          class="tab-icon"
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
        >
          <rect
            x="7.5"
            y="3"
            width="9"
            height="18"
            rx="3.2"
            :fill="tab.id === activeId ? '#191919' : 'none'"
            :stroke="tab.id === activeId ? '#191919' : '#3E4C59'"
            stroke-width="1.7"
          />
          <line
            x1="10.5"
            y1="7.5"
            x2="13.5"
            y2="7.5"
            :stroke="tab.id === activeId ? '#fff' : '#3E4C59'"
            stroke-width="1.5"
            stroke-linecap="round"
          />
        </svg>

        <!-- Главная: дом -->
        <svg
          v-else-if="tab.icon === 'home'"
          class="tab-icon"
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
        >
          <path
            d="M3 10.5L12 3L21 10.5V20C21 20.55 20.78 21.04 20.41 21.41C20.04 21.78 19.55 22 19 22H5C4.45 22 3.96 21.78 3.59 21.41C3.22 21.04 3 20.55 3 20V10.5Z"
            :fill="tab.id === activeId ? '#191919' : 'none'"
            :stroke="tab.id === activeId ? '#191919' : '#3E4C59'"
            stroke-width="1.7"
            stroke-linejoin="round"
          />
        </svg>

        <!-- POD-системы: pod-картридж -->
        <svg
          v-else-if="tab.icon === 'pods'"
          class="tab-icon"
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
        >
          <rect
            x="4"
            y="5"
            width="16"
            height="14"
            rx="4"
            :fill="tab.id === activeId ? '#191919' : 'none'"
            :stroke="tab.id === activeId ? '#191919' : '#3E4C59'"
            stroke-width="1.7"
          />
          <path
            d="M8 5C8 4 8.5 3 10 3H14C15.5 3 16 4 16 5"
            :stroke="tab.id === activeId ? '#191919' : '#3E4C59'"
            stroke-width="1.7"
            stroke-linecap="round"
          />
          <circle
            cx="12"
            cy="12"
            r="2.6"
            :stroke="tab.id === activeId ? '#fff' : '#3E4C59'"
            stroke-width="1.5"
          />
        </svg>

        <!-- Расходники: шестерёнка-гайка -->
        <svg
          v-else-if="tab.icon === 'accessories'"
          class="tab-icon"
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
        >
          <path
            d="M12 15.2C13.77 15.2 15.2 13.77 15.2 12C15.2 10.23 13.77 8.8 12 8.8C10.23 8.8 8.8 10.23 8.8 12C8.8 13.77 10.23 15.2 12 15.2Z"
            :stroke="tab.id === activeId ? '#191919' : '#3E4C59'"
            stroke-width="1.7"
          />
          <path
            d="M19.4 15C19.55 15 19.7 14.85 19.7 14.7V13.2C19.7 13.05 19.55 12.9 19.4 12.9C19.8 12.9 20.1 12.6 20.1 12.2C20.1 11.8 19.8 11.5 19.4 11.5C19.55 11.5 19.7 11.35 19.7 11.2V9.7C19.7 9.55 19.55 9.4 19.4 9.4H17.1L14.8 7.1L12 9.9L9.2 7.1L6.9 9.4H4.6C4.45 9.4 4.3 9.55 4.3 9.7V11.2C4.3 11.35 4.45 11.5 4.6 11.5C4.2 11.5 3.9 11.8 3.9 12.2C3.9 12.6 4.2 12.9 4.6 12.9C4.45 12.9 4.3 13.05 4.3 13.2V14.7C4.3 14.85 4.45 15 4.6 15H6.9L9.2 17.3L12 14.5L14.8 17.3L17.1 15H19.4Z"
            :fill="tab.id === activeId ? '#191919' : 'none'"
            :stroke="tab.id === activeId ? '#191919' : '#3E4C59'"
            stroke-width="0.8"
            stroke-linejoin="round"
          />
        </svg>

        <span v-if="tab.id === activeId" class="tab-active-dot"></span>
      </span>
    </button>
  </nav>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

import type { TabDefinition, TabId } from "./shell/tabs";

defineProps<{
  tabs: readonly TabDefinition[];
  activeId: TabId;
}>();

const emit = defineEmits<{
  (event: "select", id: TabId): void;
}>();

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
  width: 56px;
  height: 52px;
  border: none;
  background: none;
  padding: 0;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.tab-item:active {
  opacity: 0.6;
  transform: scale(0.9);
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
  width: 26px;
  height: 26px;
}

.tab-active-dot {
  position: absolute;
  bottom: -7px;
  left: 50%;
  transform: translateX(-50%);
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #f50302;
}
</style>
