<template>
  <nav
    ref="bottomTabBarRef"
    class="bottom-tab-bar"
    aria-label="Навигация"
  >
    <div class="bottom-tab-bar__surface" aria-hidden="true">
      <svg
        class="bottom-tab-bar__surface-shape"
        viewBox="0 0 393 130"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient
            id="bottom-tab-bar-fill"
            x1="196.5"
            y1="0"
            x2="196.5"
            y2="130"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stop-color="#F50302" />
            <stop offset="1" stop-color="#D30707" />
          </linearGradient>
        </defs>
        <path
          d="M0 10.26A24 24 0 0 0 24 34.26H369A24 24 0 0 0 393 10.26V130H0V10.26Z"
          fill="url(#bottom-tab-bar-fill)"
        />
      </svg>
      <div class="bottom-tab-bar__safe-area-fill"></div>
    </div>

    <div class="bottom-tab-bar__row">
      <router-link
        v-for="tab in tabs"
        :key="tab.path"
        :to="tab.path"
        class="tab-item"
        :class="[
          { 'tab-item--active': isActive(tab.path) },
          `tab-item--${tab.id}`,
        ]"
        :aria-label="tab.label"
      >
        <div class="tab-icon-wrap">
          <svg
            v-if="tab.id === 'home'"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
          >
            <path
              d="M3 10.5L12 3L21 10.5V20C21 20.5304 20.7893 21.0391 20.4142 21.4142C20.0391 21.7893 19.5304 22 19 22H5C4.46957 22 3.96086 21.7893 3.58579 21.4142C3.21071 21.0391 3 20.5304 3 20V10.5Z"
              :stroke="isActive(tab.path) ? '#fff' : 'rgba(255,255,255,0.64)'"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>

          <svg
            v-else-if="tab.id === 'cart'"
            width="22"
            height="22"
            viewBox="0 0 22 22"
            fill="none"
          >
            <path
              d="M3 4H5L7 14H17L19 6H6"
              :stroke="isActive(tab.path) ? '#fff' : 'rgba(255,255,255,0.64)'"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <circle
              cx="9"
              cy="18"
              r="1.6"
              :stroke="isActive(tab.path) ? '#fff' : 'rgba(255,255,255,0.64)'"
              stroke-width="1.6"
            />
            <circle
              cx="16"
              cy="18"
              r="1.6"
              :stroke="isActive(tab.path) ? '#fff' : 'rgba(255,255,255,0.64)'"
              stroke-width="1.6"
            />
          </svg>

          <svg
            v-else-if="tab.id === 'wheel'"
            class="tab-icon-wheel"
            width="128"
            height="26"
            viewBox="132.55 69.25 128.8 27.5"
            fill="none"
            preserveAspectRatio="xMidYMid meet"
          >
            <rect
              x="133.3"
              y="73.8518"
              width="127.3"
              height="18.2963"
              rx="9.14815"
              :stroke="isActive(tab.path) ? '#fff' : 'rgba(255,255,255,0.64)'"
              stroke-width="1.5"
            />
            <rect
              x="148.3"
              y="79.6296"
              width="7"
              height="6.74074"
              rx="2"
              :stroke="isActive(tab.path) ? '#fff' : 'rgba(255,255,255,0.64)'"
              stroke-width="1.5"
            />
            <rect
              x="159.9"
              y="78.426"
              width="9.5"
              height="9.14815"
              rx="3"
              :stroke="isActive(tab.path) ? '#fff' : 'rgba(255,255,255,0.64)'"
              stroke-width="1.5"
            />
            <rect
              x="174.15"
              y="77.511"
              width="11.4"
              height="10.9778"
              rx="3"
              :stroke="isActive(tab.path) ? '#fff' : 'rgba(255,255,255,0.64)'"
              stroke-width="1.5"
            />
            <rect
              x="190.3"
              y="76.5962"
              width="13.3"
              height="12.8074"
              rx="3"
              :stroke="isActive(tab.path) ? '#fff' : 'rgba(255,255,255,0.64)'"
              stroke-width="1.5"
            />
            <rect
              x="208.35"
              y="77.511"
              width="11.4"
              height="10.9778"
              rx="3"
              :stroke="isActive(tab.path) ? '#fff' : 'rgba(255,255,255,0.64)'"
              stroke-width="1.5"
            />
            <rect
              x="224.5"
              y="78.426"
              width="9.5"
              height="9.14815"
              rx="3"
              :stroke="isActive(tab.path) ? '#fff' : 'rgba(255,255,255,0.64)'"
              stroke-width="1.5"
            />
            <rect
              x="238.3"
              y="79.6296"
              width="7"
              height="6.74074"
              rx="2"
              :stroke="isActive(tab.path) ? '#fff' : 'rgba(255,255,255,0.64)'"
              stroke-width="1.5"
            />
            <line
              x1="196.8"
              y1="70"
              x2="196.8"
              y2="96"
              :stroke="isActive(tab.path) ? '#fff' : 'rgba(255,255,255,0.64)'"
              stroke-width="1.2"
            />
          </svg>

          <svg
            v-else-if="tab.id === 'profile'"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              cx="12"
              cy="8"
              r="4"
              :stroke="isActive(tab.path) ? '#fff' : 'rgba(255,255,255,0.64)'"
              stroke-width="1.8"
            />
            <path
              d="M4 21C4 17.134 7.58172 14 12 14C16.4183 14 20 17.134 20 21"
              :stroke="isActive(tab.path) ? '#fff' : 'rgba(255,255,255,0.64)'"
              stroke-width="1.8"
              stroke-linecap="round"
            />
          </svg>

          <span v-if="isActive(tab.path)" class="tab-active-dot"></span>
        </div>
      </router-link>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useWholesaleStore } from '@/stores/wholesale'

interface TabItem {
  id: string
  path: string
  label: string
}

const props = withDefaults(
  defineProps<{
    variant?: 'retail' | 'wholesale'
  }>(),
  { variant: 'retail' },
)

const route = useRoute()
const wholesaleStore = useWholesaleStore()
const bottomTabBarRef = ref<HTMLElement | null>(null)
let resizeObserver: ResizeObserver | null = null

const retailTabs: TabItem[] = [
  { id: 'home', path: '/', label: 'Главная' },
  { id: 'wheel', path: '/wheel', label: 'Рулетка' },
  { id: 'profile', path: '/profile', label: 'Профиль' },
]

const wholesaleTabs: TabItem[] = [
  { id: 'home', path: '/', label: 'Главная' },
  { id: 'wheel', path: '/wheel', label: 'Рулетка' },
  { id: 'profile', path: '/profile', label: 'Профиль' },
]

const tabs = computed<TabItem[]>(() =>
  props.variant === 'wholesale' || wholesaleStore.isWholesale
    ? wholesaleTabs
    : retailTabs,
)

function isActive(path: string): boolean {
  if (path === '/') {
    return route.path === '/'
  }

  return route.path.startsWith(path)
}

function syncBottomTabBarHeight() {
  if (typeof document === 'undefined' || !bottomTabBarRef.value) {
    return
  }

  document.documentElement.style.setProperty(
    '--app-bottom-tab-bar-height',
    `${bottomTabBarRef.value.offsetHeight}px`,
  )
}

onMounted(() => {
  nextTick(syncBottomTabBarHeight)

  if (typeof ResizeObserver !== 'undefined' && bottomTabBarRef.value) {
    resizeObserver = new ResizeObserver(syncBottomTabBarHeight)
    resizeObserver.observe(bottomTabBarRef.value)
  }

  window.addEventListener('resize', syncBottomTabBarHeight)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  window.removeEventListener('resize', syncBottomTabBarHeight)
})
</script>

<style scoped>
.bottom-tab-bar {
  --bottom-tab-bar-base-height: clamp(108px, calc(100vw * 130 / 393), 130px);
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 100;
  height: calc(var(--bottom-tab-bar-base-height) + env(safe-area-inset-bottom, 0px));
  overflow: hidden;
  pointer-events: none;
}

.bottom-tab-bar__surface {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.bottom-tab-bar__surface-shape {
  position: absolute;
  left: 0;
  right: 0;
  bottom: env(safe-area-inset-bottom, 0px);
  width: 100%;
  height: var(--bottom-tab-bar-base-height);
}

.bottom-tab-bar__safe-area-fill {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: env(safe-area-inset-bottom, 0px);
  background: #d30707;
}

.bottom-tab-bar__row {
  position: absolute;
  left: 50%;
  top: clamp(60px, calc(100vw * 71 / 393), 71px);
  transform: translateX(-50%);
  width: min(calc(100% - 72px), clamp(208px, 59.03%, 320px));
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  pointer-events: auto;
}

.tab-item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;
  transition: opacity 0.2s ease;
}

.tab-item--wheel {
  width: auto;
  flex: 0 0 auto;
}

.tab-item:active {
  opacity: 0.7;
}

.tab-icon-wrap {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
}

.tab-item--wheel .tab-icon-wrap {
  width: auto;
  min-width: 24px;
}

.tab-icon-wrap :deep(svg) {
  width: clamp(15px, calc(100vw * 16 / 393), 16px);
  height: clamp(15px, calc(100vw * 16 / 393), 16px);
}

.tab-icon-wrap :deep(svg.tab-icon-wheel) {
  width: auto;
  height: clamp(20px, calc(100vw * 22 / 393), 24px);
  max-width: 100%;
}

.tab-active-dot {
  position: absolute;
  bottom: -10px;
  left: 50%;
  transform: translateX(-50%);
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #fff;
}

@media (max-width: 360px) {
  .bottom-tab-bar__row {
    top: clamp(58px, calc(100vw * 71 / 393), 71px);
    width: min(calc(100% - 56px), max(188px, 59.03%));
  }
}
</style>
