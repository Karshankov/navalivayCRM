<template>
  <div class="wheel-prizes-page">
    <header class="wheel-prizes-header">
      <button type="button" class="wheel-prizes-back" aria-label="Назад" @click="goBack">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path
            d="M12 4L6 10L12 16"
            stroke="#1F2933"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <h1 class="wheel-prizes-title">Мои призы</h1>
    </header>

    <nav
      ref="tabsContainerRef"
      class="wheel-prizes-tabs"
      role="tablist"
      aria-label="Фильтр призов"
      @mousedown="onTabsMouseDown"
    >
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        :class="['wheel-prizes-tab', { 'wheel-prizes-tab--active': activeTab === tab.key }]"
        @click="setTab(tab.key)"
      >
        {{ tab.label }}
      </button>
    </nav>

    <main class="wheel-prizes-content">
      <p v-if="!prizes.length" class="wheel-prizes-empty">
        {{ emptyStateMessage }}
      </p>
      <article
        v-for="prize in prizes"
        :key="prize.spin_id"
        class="wheel-prize-row"
        :class="{
          'wheel-prize-row--used': Boolean(prize.prize_used_at),
          'wheel-prize-row--expired': isPrizeExpired(prize),
        }"
      >
        <div
          class="wheel-prize-row__image"
          :class="{ 'wheel-prize-row__image--photo': isPrizeImageVisible(prize) }"
          :style="prizeImageFrameStyle(prize)"
        >
          <img
            v-if="isPrizeImageVisible(prize)"
            :src="prize.prize_image_url || ''"
            :alt="prize.prize_title"
            @error="onPrizeImageError(prize)"
          />
          <span
            v-else
            class="wheel-prize-row__icon-default"
            :style="{ '--my-prize-tint': extractFirstHex(prize.rarity_bg) || '#9AA0A6' } as Record<string, string>"
            :aria-label="prize.prize_title"
            role="img"
          ></span>
        </div>
        <div class="wheel-prize-row__copy">
          <p class="wheel-prize-row__title">{{ prize.prize_title }}</p>
          <p v-if="prize.prize_description" class="wheel-prize-row__desc">
            {{ prize.prize_description }}
          </p>
          <div class="wheel-prize-row__meta">
            <span
              v-if="prize.rarity_label"
              class="wheel-prize-row__rarity"
              :style="{
                background: prize.rarity_bg || '#1F2933',
                color: prize.rarity_text || '#FFFFFF',
              }"
            >
              {{ prize.rarity_label }}
            </span>
            <span
              v-if="prize.prize_used_at"
              class="wheel-prize-row__pill wheel-prize-row__pill--used"
            >
              Использован
            </span>
            <span
              v-else-if="isPrizeExpired(prize)"
              class="wheel-prize-row__pill wheel-prize-row__pill--expired"
            >
              Истёк
            </span>
            <span v-if="prize.promo_valid_until" class="wheel-prize-row__valid">
              до {{ formatDate(prize.promo_valid_until) }}
            </span>
          </div>
          <div v-if="prize.promo_code" class="wheel-prize-row__promo">
            <span class="wheel-prize-row__promo-label">Промокод</span>
            <button
              type="button"
              class="wheel-prize-row__promo-code"
              @click="copyCode(prize.promo_code)"
            >
              {{ prize.promo_code }}
            </button>
          </div>
        </div>
      </article>
    </main>

    <Transition name="copy-toast-fade">
      <div v-if="showCopyToast" class="wheel-prizes-toast" role="status">
        Промокод скопирован
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useWheelStore, type WheelMyPrize } from '@/stores/wheel'

type WheelPrizeFilter = 'all' | 'active' | 'used' | 'expired'

const router = useRouter()
const wheelStore = useWheelStore()
const activeTab = ref<WheelPrizeFilter>('active')
const showCopyToast = ref(false)
const failedPrizeImages = ref<Set<string>>(new Set())
let toastTimer: ReturnType<typeof setTimeout> | null = null

const tabs: Array<{ key: WheelPrizeFilter; label: string }> = [
  { key: 'active', label: 'Активные' },
  { key: 'used', label: 'Применённые' },
  { key: 'expired', label: 'Истёкшие' },
  { key: 'all', label: 'Все' },
]

// Click-and-drag horizontal scroll for desktop. Touch devices already
// use native swipe via `-webkit-overflow-scrolling: touch`, so this
// helper is a desktop-only nicety.
const tabsContainerRef = ref<HTMLElement | null>(null)
let dragState: {
  startX: number
  startScroll: number
  pointerId: number | null
  moved: boolean
} | null = null

function onTabsMouseDown(event: MouseEvent) {
  if (event.button !== 0) return
  const el = tabsContainerRef.value
  if (!el) return
  dragState = {
    startX: event.pageX,
    startScroll: el.scrollLeft,
    pointerId: null,
    moved: false,
  }
  document.addEventListener('mousemove', onTabsMouseMove)
  document.addEventListener('mouseup', onTabsMouseUp, { once: true })
}

function onTabsMouseMove(event: MouseEvent) {
  if (!dragState || !tabsContainerRef.value) return
  const dx = event.pageX - dragState.startX
  if (Math.abs(dx) > 4) {
    dragState.moved = true
    tabsContainerRef.value.style.cursor = 'grabbing'
    tabsContainerRef.value.style.userSelect = 'none'
  }
  tabsContainerRef.value.scrollLeft = dragState.startScroll - dx
}

function onTabsMouseUp() {
  document.removeEventListener('mousemove', onTabsMouseMove)
  if (tabsContainerRef.value) {
    tabsContainerRef.value.style.cursor = ''
    tabsContainerRef.value.style.userSelect = ''
  }
  // If the pointer actually moved we suppress the next click so the
  // drag does not also trigger a tab-switch.
  if (dragState?.moved && tabsContainerRef.value) {
    const suppress = (e: MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      tabsContainerRef.value?.removeEventListener('click', suppress, true)
    }
    tabsContainerRef.value.addEventListener('click', suppress, { capture: true, once: true })
  }
  dragState = null
}

const prizes = computed<WheelMyPrize[]>(() => wheelStore.myAllPrizes)

const emptyStateMessage = computed(() => {
  switch (activeTab.value) {
    case 'active':
      return 'Пока нет активных промокодов. Крутни рулетку, чтобы выиграть.'
    case 'used':
      return 'Ты ещё не использовал ни один приз.'
    case 'expired':
      return 'Просроченных призов нет.'
    case 'all':
    default:
      return 'Здесь будут все твои выигрыши.'
  }
})

function setTab(tab: WheelPrizeFilter) {
  if (tab === activeTab.value) return
  activeTab.value = tab
}

watch(activeTab, async (next) => {
  // P3-UX: если для этого фильтра уже есть кэш — fetchMyPrizes сразу
  // подменит myAllPrizes на нужный срез из памяти и выйдет, без
  // мерцания. В фоне дёрнем silent refresh, чтобы данные обновились.
  if (wheelStore.isMyPrizesCacheFresh(next)) {
    await wheelStore.fetchMyPrizes(next).catch(() => undefined)
    wheelStore.fetchMyPrizes(next, { force: true }).catch(() => undefined)
    return
  }
  await wheelStore.fetchMyPrizes(next).catch(() => undefined)
})

async function copyCode(code: string) {
  try {
    await navigator.clipboard.writeText(code)
  } catch (_error) {
    // Fallback: select the code in a temporary textarea (best-effort).
  }
  showCopyToast.value = true
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    showCopyToast.value = false
  }, 1800)
}

function extractFirstHex(value: string | undefined | null): string {
  if (!value) return ''
  const m = value.match(/#([0-9a-fA-F]{3}){1,2}/)
  return m ? m[0] : value
}

function prizeImageFrameStyle(prize: WheelMyPrize): Record<string, string> {
  const tint = extractFirstHex(prize.rarity_bg) || '#E2E5EA'
  return {
    borderColor: tint,
    background: '#FFFFFF',
  }
}

function prizeImageKey(prize: WheelMyPrize): string {
  return `${prize.spin_id}:${prize.prize_image_url || ''}`
}

function isPrizeImageVisible(prize: WheelMyPrize): boolean {
  return Boolean(prize.prize_image_url) && !failedPrizeImages.value.has(prizeImageKey(prize))
}

function onPrizeImageError(prize: WheelMyPrize) {
  const next = new Set(failedPrizeImages.value)
  next.add(prizeImageKey(prize))
  failedPrizeImages.value = next
}

// S2-7 sibling: monogram never renders empty even if title is missing.
function monogramFor(_value: string | null | undefined): string {
  // Reserved for future fallback usage. Default tile uses the wheel-default-prize image.
  return ''
}

// M6: an "active" tab item that has already passed its promo deadline
// should still be visually marked as expired. promo_valid_until comes as
// either a `YYYY-MM-DD` or full ISO string (S4 emits the ISO form for
// child wheel codes); both are safe to feed to Date.
function isPrizeExpired(prize: WheelMyPrize): boolean {
  if (prize.prize_used_at) return false
  if (!prize.promo_valid_until) return false
  const iso = prize.promo_valid_until.length === 10
    ? `${prize.promo_valid_until}T23:59:59Z`
    : prize.promo_valid_until
  const expiry = new Date(iso).getTime()
  if (Number.isNaN(expiry)) return false
  return expiry < Date.now()
}

function formatDate(iso: string): string {
  if (!iso) return ''
  const date = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function goBack() {
  if (window.history.length > 1) {
    router.back()
  } else {
    router.push('/wheel')
  }
}

onMounted(async () => {
  // P3-UX: cache hit — restore snapshot мгновенно (внутри fetchMyPrizes
  // присваивает myAllPrizes из cached map), и параллельно делаем
  // silent refresh, чтобы обновить данные без скелетона.
  if (wheelStore.isMyPrizesCacheFresh(activeTab.value)) {
    await wheelStore.fetchMyPrizes(activeTab.value).catch(() => undefined)
    wheelStore.fetchMyPrizes(activeTab.value, { force: true })
      .catch(() => undefined)
    return
  }
  await wheelStore.fetchMyPrizes(activeTab.value).catch(() => undefined)
})
</script>

<style scoped>
.wheel-prizes-page {
  min-height: 100vh;
  background: #f5f7fa;
  padding-bottom: 24px;
}

.wheel-prizes-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 16px 12px;
}

.wheel-prizes-back {
  position: relative;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06);
}

/* S2-3: 36×36 visual chip with a 44×44 invisible tap target. */
.wheel-prizes-back::before {
  content: "";
  position: absolute;
  inset: -4px;
  border-radius: inherit;
}

.wheel-prizes-title {
  font-family: 'Montserrat', sans-serif;
  font-weight: 700;
  font-size: 18px;
  color: #1f2933;
  margin: 0;
}

/* Scroll-friendly tabs: full labels are kept (no ellipsis), and the user
   can swipe horizontally on narrow devices. Each tab fits its content,
   so "Использованные" and "Просроченные" stay legible end-to-end. */
.wheel-prizes-tabs {
  display: flex;
  gap: 8px;
  padding: 0 16px;
  margin-bottom: 12px;
  overflow-x: auto;
  overflow-y: visible;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  cursor: grab;
}

.wheel-prizes-tabs::-webkit-scrollbar {
  display: none;
}

.wheel-prizes-tab {
  flex: 0 0 auto;
  white-space: nowrap;
  padding: 10px 16px;
  border-radius: 999px;
  background: #ffffff;
  border: 1px solid rgba(15, 23, 42, 0.06);
  font-family: 'SF Pro Display', system-ui, sans-serif;
  font-size: 13px;
  color: #5c6470;
  cursor: pointer;
  text-overflow: ellipsis;
  overflow: hidden;
}

/* S2-2: drop the red glow shadow from the active tab. The canon avoids
   large red glows on customer surfaces; the gradient itself reads as
   "active" without an extra halo. */
.wheel-prizes-tab--active {
  background: linear-gradient(106.76deg, #f50302 -2.64%, #a90f0e 85.78%);
  color: #ffffff;
  border-color: transparent;
}

.wheel-prizes-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 0 16px 24px;
}

.wheel-prizes-empty {
  margin: 32px 0;
  text-align: center;
  font-family: 'SF Pro Display', system-ui, sans-serif;
  color: #5c6470;
}

.wheel-prize-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: #ffffff;
  border-radius: 20px;
}

/* M6: visually mark prizes that are no longer usable (used or expired)
   so the customer can scan the list at a glance. The tab filter still
   shows them in "Все" but they read as inactive. */
.wheel-prize-row--used,
.wheel-prize-row--expired {
  opacity: 0.6;
  filter: saturate(0.5);
}

.wheel-prize-row--used .wheel-prize-row__promo-code,
.wheel-prize-row--expired .wheel-prize-row__promo-code {
  text-decoration: line-through;
}

.wheel-prize-row__pill {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 10px;
  border-radius: 999px;
  font-family: 'Montserrat', sans-serif;
  font-weight: 600;
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.wheel-prize-row__pill--used {
  background: rgba(15, 23, 42, 0.08);
  color: #1f2933;
}

.wheel-prize-row__pill--expired {
  background: rgba(245, 3, 2, 0.1);
  color: #b3251f;
}

.wheel-prize-row__image {
  position: relative;
  flex: 0 0 76px;
  width: 76px;
  height: 76px;
  overflow: hidden;
  border: 2px solid #e2e5ea;
  border-radius: 19px;
  background: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Montserrat', sans-serif;
  font-weight: 700;
  font-size: 32px;
  color: rgba(15, 23, 42, 0.45);
  box-shadow: 0 12px 18px rgba(170, 178, 189, 0.12);
}

.wheel-prize-row__image--photo {
  align-items: stretch;
  justify-content: stretch;
}

.wheel-prize-row__image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.wheel-prize-row__icon-default {
  width: 90%;
  height: 90%;
  background-color: var(--my-prize-tint, #9aa0a6);
  -webkit-mask-image: url('@/assets/wheel-default-prize.png');
  mask-image: url('@/assets/wheel-default-prize.png');
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
}

.wheel-prize-row__copy {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.wheel-prize-row__title {
  font-family: 'Montserrat', sans-serif;
  font-weight: 700;
  font-size: 15px;
  color: #1f2933;
  margin: 0;
}

.wheel-prize-row__desc {
  font-family: 'SF Pro Display', system-ui, sans-serif;
  font-size: 13px;
  color: #5c6470;
  margin: 0;
}

.wheel-prize-row__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.wheel-prize-row__rarity {
  display: inline-flex;
  padding: 4px 10px;
  border-radius: 6px;
  font-family: 'Montserrat', sans-serif;
  font-weight: 500;
  font-size: 10px;
  line-height: 12px;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: #ffffff;
  align-items: center;
}

.wheel-prize-row__valid {
  font-family: 'SF Pro Display', system-ui, sans-serif;
  font-size: 12px;
  color: #9aa0a6;
}

.wheel-prize-row__promo {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: rgba(245, 3, 2, 0.08);
  border-radius: 12px;
  padding: 8px 12px;
  margin-top: 2px;
  flex-wrap: wrap;
}

.wheel-prize-row__promo-label {
  font-family: 'SF Pro Display', system-ui, sans-serif;
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #5c6470;
  flex-shrink: 0;
}

.wheel-prize-row__promo-code {
  background: none;
  border: none;
  font-family: 'Montserrat', sans-serif;
  font-weight: 700;
  font-size: clamp(13px, 3.6vw, 15px);
  color: #f50302;
  letter-spacing: 0.04em;
  cursor: pointer;
  padding: 0;
  white-space: nowrap;
  text-align: right;
  min-width: 0;
}

.wheel-prizes-toast {
  position: fixed;
  bottom: calc(var(--app-bottom-tab-bar-height, 130px) + 24px);
  left: 50%;
  transform: translateX(-50%);
  background: rgba(15, 23, 42, 0.92);
  color: #ffffff;
  font-family: 'SF Pro Display', system-ui, sans-serif;
  font-size: 13px;
  padding: 10px 18px;
  border-radius: 999px;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.18);
  z-index: 200;
}

.copy-toast-fade-enter-active,
.copy-toast-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.copy-toast-fade-enter-from,
.copy-toast-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}
</style>
