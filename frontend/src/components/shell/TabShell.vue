<template>
  <div class="tab-shell">
    <AppHeader :title="activeTab.headerTitle" />

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
const SnusPane = defineAsyncComponent(() => import("../../views/tabs/SnusPane.vue"));
const DevicesPane = defineAsyncComponent(() => import("../../views/tabs/DevicesPane.vue"));
const AccessoriesPane = defineAsyncComponent(() => import("../../views/tabs/AccessoriesPane.vue"));
const HookahPane = defineAsyncComponent(() => import("../../views/tabs/HookahPane.vue"));

const PANE_COMPONENTS: Record<TabId, ReturnType<typeof defineAsyncComponent>> = {
  liquids: LiquidsPane,
  disposables: DisposablesPane,
  snus: SnusPane,
  home: HomePane,
  devices: DevicesPane,
  accessories: AccessoriesPane,
  hookah: HookahPane,
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

/* Свайп закончился на другом pane — URL обновляем без записи в историю.
 *
 * МЕХАНИКА: scroll-события приходят потоком во время любого скролла
 * (пальцем, инерция snap, программный smooth). Считать позицию на
 * каждом событии нельзя — увидим транзитные pane-ы и переключим
 * вкладку «по пути». Вместо этого дебаунс: каждое событие
 * перезапускает таймер; когда поток затихает на DEBOUNCE_MS,
 * финальная позиция применяется ОДИН раз.
 *
 * Тап по табу и route-watcher выставляют activeIndex заранее и
 * скроллят к цели — при settle index совпадает с activeIndex и
 * роутер не дёргается. Свайп оставляет решение debounce-у. */
const SCROLL_DEBOUNCE_MS = 120;
let scrollSettleTimer: ReturnType<typeof setTimeout> | null = null;

function onScroll() {
  if (scrollSettleTimer) clearTimeout(scrollSettleTimer);
  // Палец ещё на экране — ждём touchend, потом поток иссякнет сам.
  if (isDragging.value) return;

  scrollSettleTimer = setTimeout(() => {
    const carousel = carouselRef.value;
    if (!carousel) return;
    const index = Math.round(carousel.scrollLeft / carousel.clientWidth);
    if (index === activeIndex.value) return;

    activeIndex.value = index;
    const tab = tabs[index];
    if (!tab) return;
    mountedPanes.value.add(tab.id);
    if (route.path !== tab.path) {
      router.replace(tab.path);
    }
  }, SCROLL_DEBOUNCE_MS);
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
  if (scrollSettleTimer) clearTimeout(scrollSettleTimer);
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
/* Шелл занимает ровно один экран: шапка + карусель + таб-бар.
 * Контент скроллится ВНУТРИ каждого pane (overflow-y: auto),
 * документ не скроллится вовсе — Instagram-модель. */
.tab-shell {
  position: fixed;
  inset: 0;
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
  /* Обе оси: горизонталь — свайп вкладок (snap), вертикаль уходит
   * в скролл активного pane (его контент скроллится внутри). */
  touch-action: pan-x pan-y;
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
  overflow-y: auto;
  scroll-snap-align: start;
  scroll-snap-stop: always;
  /* Обе оси: вертикаль скроллит контент pane, горизонталь уходит
   * родительскому carousel с scroll-snap. */
  touch-action: pan-x pan-y;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
}
</style>
