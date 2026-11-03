<template>
  <div class="tab-shell">
    <AppHeader
      :title="activeTab.headerTitle"
      :show-wheel="activeTab.id === 'home'"
      :show-favorites="activeTab.id === 'home'"
      :avatar-active="activeTab.id === 'home'"
    />

    <div
      ref="carouselRef"
      class="tab-shell__carousel"
      :class="{ 'tab-shell__carousel--dragging': isDragging }"
      @scroll.passive="onScroll"
    >
      <div
        v-for="(tab, index) in tabs"
        :key="tab.id"
        class="tab-shell__pane"
        :data-tab-id="tab.id"
        :data-tab-index="index"
        :aria-hidden="index !== activeIndex"
      >
        <KeepAlive>
          <component
            :is="paneComponent(tab.id)"
            v-if="mountedPanes.has(tab.id)"
            :is-active="activeIndex === index"
          />
        </KeepAlive>
      </div>
    </div>

    <BottomTabBar
      :tabs="tabs"
      :active-id="activeTab.id"
      @select="selectTab"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import AppHeader from "./AppHeader.vue";
import BottomTabBar from "../BottomTabBar.vue";
import { TABS, tabByPath, type TabId } from "./tabs";

/* Панели вкладок лениво: главная грузится сразу, категории — по требованию. */
const HomePane = defineAsyncComponent(() => import("../../views/HomeView.vue"));
const LiquidsPane = defineAsyncComponent(() => import("../../views/tabs/LiquidsPane.vue"));
const DisposablesPane = defineAsyncComponent(
  () => import("../../views/tabs/DisposablesPane.vue"),
);
const PodsPane = defineAsyncComponent(() => import("../../views/tabs/PodsPane.vue"));
const AccessoriesPane = defineAsyncComponent(() => import("../../views/tabs/AccessoriesPane.vue"));

const PANE_COMPONENTS: Record<TabId, ReturnType<typeof defineAsyncComponent>> = {
  liquids: LiquidsPane,
  disposables: DisposablesPane,
  home: HomePane,
  pods: PodsPane,
  accessories: AccessoriesPane,
};

function paneComponent(id: TabId) {
  return PANE_COMPONENTS[id];
}

const router = useRouter();
const route = useRoute();

const carouselRef = ref<HTMLElement | null>(null);
const isDragging = ref(false);
const activeIndex = ref(initialIndex());
const mountedPanes = ref<Set<TabId>>(new Set<TabId>(["home", activeTabId()]));

const tabs = TABS;
const activeTab = computed(() => tabs[activeIndex.value]);

function initialIndex(): number {
  const tab = tabByPath(route.path);
  return tab ? tabsIndexOf(tab.id) : tabsIndexOf("home");
}

function activeTabId(): TabId {
  const tab = tabByPath(route.path);
  return tab?.id ?? "home";
}

function tabsIndexOf(id: TabId): number {
  const index = TABS.findIndex((tab) => tab.id === id);
  return index >= 0 ? index : TABS.findIndex((tab) => tab.id === "home");
}

/* Пришли по URL (тап, диплинк, «назад») — плавно доскроллить к pane. */
watch(
  () => route.path,
  (path) => {
    const tab = tabByPath(path);
    if (!tab) return;
    const target = tabsIndexOf(tab.id);
    if (target !== activeIndex.value) {
      activeIndex.value = target;
      mountedPanes.value.add(tab.id);
      scrollToIndex(target, "smooth");
    }
  },
);

/* Свайп закончился на другом pane — URL обновляем без записи в историю. */
function onScroll() {
  const carousel = carouselRef.value;
  if (!carousel || isDragging.value) return;
  const index = Math.round(carousel.scrollLeft / carousel.clientWidth);
  if (index === activeIndex.value) return;

  activeIndex.value = index;
  const tab = tabs[index];
  if (!tab) return;
  mountedPanes.value.add(tab.id);
  if (route.path !== tab.path) {
    router.replace(tab.path);
  }
}

function scrollToIndex(index: number, behavior: ScrollBehavior = "auto") {
  const carousel = carouselRef.value;
  if (!carousel) return;
  carousel.scrollTo({ left: index * carousel.clientWidth, behavior });
}

function selectTab(id: TabId) {
  const target = tabsIndexOf(id);
  activeIndex.value = target;
  mountedPanes.value.add(id);
  scrollToIndex(target, "smooth");
  const tab = TABS[target];
  if (route.path !== tab.path) {
    router.replace(tab.path);
  }
}

onMounted(() => {
  const carousel = carouselRef.value;
  if (!carousel) return;
  // Стартуем сразу на нужном pane без анимации.
  requestAnimationFrame(() => {
    scrollToIndex(activeIndex.value, "auto");
  });

  carousel.addEventListener("touchstart", onTouchStart, { passive: true });
  carousel.addEventListener("touchmove", onTouchMove, { passive: false });
  carousel.addEventListener("touchend", onTouchEnd, { passive: true });
});

onBeforeUnmount(() => {
  const carousel = carouselRef.value;
  if (!carousel) return;
  carousel.removeEventListener("touchstart", onTouchStart);
  carousel.removeEventListener("touchmove", onTouchMove);
  carousel.removeEventListener("touchend", onTouchEnd);
});

/* Физика жеста: пока палец тянет карусель — держим «dragging»-состояние,
 * чтобы onScroll не считал промежуточные позиции и не дёргал роутер.
 * Вертикальный скролл внутри pane не блокируем (touch-action: pan-y
 * на pane-ах, pan-x на контейнере решает конфликт осей). */
let touchStartX = 0;
let touchStartY = 0;
let touchMovedX = 0;
let horizontalIntent: null | boolean = null;

function onTouchStart(event: TouchEvent) {
  const touch = event.touches[0];
  touchStartX = touch.clientX;
  touchStartY = touch.clientY;
  touchMovedX = 0;
  horizontalIntent = null;
}

function onTouchMove(event: TouchEvent) {
  const touch = event.touches[0];
  const dx = touch.clientX - touchStartX;
  const dy = touch.clientY - touchStartY;
  if (horizontalIntent === null) {
    if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
      horizontalIntent = true;
      isDragging.value = true;
    } else if (Math.abs(dy) > 8) {
      horizontalIntent = false;
    }
  }
  touchMovedX = dx;
}

function onTouchEnd() {
  if (horizontalIntent) {
    isDragging.value = false;
    // Даём браузеру доскроллить по инерции; onScroll подхватит итог.
  }
  horizontalIntent = null;
}
</script>

<style scoped>
.tab-shell {
  position: relative;
  height: 100%;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: #f5f7fa;
}

.tab-shell__carousel {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow-x: auto;
  overflow-y: hidden;
  scroll-snap-type: x mandatory;
  scrollbar-width: none;
  -ms-overflow-style: none;
  overscroll-behavior-x: contain;
  touch-action: pan-x;
  -webkit-overflow-scrolling: touch;
}

.tab-shell__carousel::-webkit-scrollbar {
  display: none;
}

.tab-shell__carousel--dragging {
  scroll-behavior: auto;
}

.tab-shell__pane {
  flex: 0 0 100%;
  width: 100%;
  height: 100%;
  min-height: 100dvh;
  overflow-y: auto;
  scroll-snap-align: start;
  scroll-snap-stop: always;
  touch-action: pan-y;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
}
</style>
