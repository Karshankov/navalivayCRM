<template>
  <Transition name="wheel-widget-fade" appear>
    <div
      v-if="visible"
      class="wheel-home-widget"
      role="button"
      tabindex="0"
      :aria-label="ariaLabel"
      @click="goToWheel"
      @keydown.enter.prevent="goToWheel"
      @keydown.space.prevent="goToWheel"
    >
      <p class="wheel-home-widget__title">{{ titleText }}</p>
      <p class="wheel-home-widget__progress-text">
        {{ accumulated }}/{{ threshold }} BYN
      </p>
      <div class="wheel-home-widget__track" aria-hidden="true">
        <div
          class="wheel-home-widget__fill"
          :style="{ width: `${clampedPercent}%` }"
        ></div>
      </div>
      <button
        type="button"
        class="wheel-home-widget__close"
        aria-label="Скрыть виджет рулетки"
        @click.stop="dismiss"
        @keydown.enter.stop
        @keydown.space.stop
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 13 13"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M2.5 2.5 L10.5 10.5 M10.5 2.5 L2.5 10.5"
            stroke="#FFFFFF"
            stroke-width="1.8"
            stroke-linecap="round"
          />
        </svg>
      </button>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useWheelStore } from '@/stores/wheel'
import { useWholesaleStore } from '@/stores/wholesale'

const props = withDefaults(
  defineProps<{
    autoLoad?: boolean
  }>(),
  { autoLoad: true },
)

const wheelStore = useWheelStore()
const wholesaleStore = useWholesaleStore()
const router = useRouter()

// localStorage keys (раньше использовался sessionStorage и dismiss
// сбрасывался при каждом перезапуске вкладки — теперь dismiss
// переживает закрытие приложения, но автоматически снимается через
// 24 часа или сразу при появлении нового спина).
// Розница и опт хранят dismiss отдельно — закрытие в одном режиме
// не влияет на другой.
const COOLDOWN_MS = 24 * 60 * 60 * 1000

const dismissed = ref(false)

function dismissStorageKeys() {
  const wholesale = wholesaleStore.isWholesale
  return {
    dismissedAt: wholesale
      ? 'wheel_widget_dismissed_at_wholesale'
      : 'wheel_widget_dismissed_at',
    lastSeenSpins: wholesale
      ? 'wheel_widget_last_seen_spins_wholesale'
      : 'wheel_widget_last_seen_spins',
  }
}

function readNumber(key: string): number {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return 0
    const n = Number(raw)
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
}

function clearDismissState() {
  const { dismissedAt, lastSeenSpins } = dismissStorageKeys()
  try {
    localStorage.removeItem(dismissedAt)
    localStorage.removeItem(lastSeenSpins)
  } catch {
    // localStorage недоступен — у нас всё равно нет persisted state.
  }
}

/**
 * Smart re-appear: виджет вновь становится видимым, если
 *   • прошло 24 часа с момента dismiss; или
 *   • баланс spins_available увеличился относительно сохранённого
 *     `wheel_widget_last_seen_spins` (новый спин — повод снова
 *     показать виджет).
 *
 * Возвращает `true`, если виджет должен быть виден.
 */
function shouldShow(): boolean {
  const { dismissedAt: dismissedAtKey, lastSeenSpins } = dismissStorageKeys()
  let dismissedAt = ''
  try {
    dismissedAt = localStorage.getItem(dismissedAtKey) || ''
  } catch {
    return true
  }
  if (!dismissedAt) return true

  const lastSeen = readNumber(lastSeenSpins)
  const currentSpins = wheelStore.balance.spins_available
  if (currentSpins > lastSeen) {
    clearDismissState()
    return true
  }

  const dismissedAtMs = new Date(dismissedAt).getTime()
  if (!Number.isFinite(dismissedAtMs)) {
    clearDismissState()
    return true
  }
  if (Date.now() - dismissedAtMs >= COOLDOWN_MS) {
    clearDismissState()
    return true
  }
  return false
}

function recomputeDismissed() {
  dismissed.value = !shouldShow()
}

onMounted(() => {
  recomputeDismissed()

  const modeMismatch =
    wheelStore.lastFetchedAt !== null
    && wheelStore.isWholesale !== wholesaleStore.isWholesale

  if (
    props.autoLoad
    && (wheelStore.lastFetchedAt === null || modeMismatch)
  ) {
    wheelStore.fetchState({ force: modeMismatch }).catch(() => {
      // Виджет работает в degraded-режиме, ошибку логируем тихо.
    })
  }
})

// Если пока виджет был dismiss, пользователь заработал новый спин
// (баланс пришёл из фонового fetchState), сразу пересчитываем флаг и
// показываем виджет: «вау, новый спин».
watch(
  () => wheelStore.balance.spins_available,
  () => {
    recomputeDismissed()
  },
)

// Смена розница ↔ опт — пересчитываем dismiss по своим ключам.
watch(
  () => wholesaleStore.isWholesale,
  () => {
    recomputeDismissed()
    if (wheelStore.lastFetchedAt !== null) {
      wheelStore.fetchState({ force: true, silent: true }).catch(() => {})
    }
  },
)

const spinsAvailable = computed(() => wheelStore.balance.spins_available)
const accumulated = computed(() =>
  Math.round(wheelStore.balance.accumulated_byn),
)
const threshold = computed(() =>
  Math.round(wheelStore.balance.threshold_byn || 40),
)
const clampedPercent = computed(() => {
  const raw = wheelStore.balance.progress_percent || 0
  if (Number.isNaN(raw)) return 0
  return Math.max(0, Math.min(100, raw))
})
const hasSpins = computed(() => spinsAvailable.value > 0)

const spinsLabel = computed(() => {
  const n = spinsAvailable.value
  if (n % 10 === 1 && n % 100 !== 11) return 'спин'
  if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return 'спина'
  return 'спинов'
})

const titleText = computed(() =>
  hasSpins.value ? `${spinsAvailable.value} ${spinsLabel.value}` : 'Рулетка',
)

const ariaLabel = computed(() =>
  hasSpins.value
    ? `Открыть рулетку. Доступно ${spinsAvailable.value} ${spinsLabel.value}.`
    : `Открыть рулетку. До спина ${accumulated.value} из ${threshold.value} BYN.`,
)

// Виджет ждёт первого успешного /api/wheel/state. До этого ничего
// не рендерим — иначе при первом mount пользователь видит «0 BYN /
// 40 BYN» из EMPTY_BALANCE, а через долю секунды значения мигают
// на реальные. Лучше короткий пустой слот, чем ложный 0%.
const visible = computed(
  () => !dismissed.value && wheelStore.lastFetchedAt !== null,
)

function goToWheel() {
  router.push('/wheel')
}

function dismiss() {
  const { dismissedAt, lastSeenSpins } = dismissStorageKeys()
  try {
    localStorage.setItem(dismissedAt, new Date().toISOString())
    localStorage.setItem(
      lastSeenSpins,
      String(wheelStore.balance.spins_available),
    )
  } catch {
    // ignore — виджет всё равно скроется на оставшуюся часть жизни компонента
  }
  dismissed.value = true
}
</script>

<style scoped>
.wheel-home-widget {
  position: fixed;
  right: 16px;
  /* Pin to ~38% of viewport height (slightly above middle) so the
     widget always sits in the same hot zone above the fold, regardless
     of viewport height. iOS uses dvh for dynamic chrome adjustments;
     vh is a safe fallback for older browsers. */
  top: 25dvh;
  top: 25vh;
  /* Ниже customer-модалок (CustomerModalShell = 80), но выше cart bar (~50). */
  z-index: 70;
  width: 120px;
  height: 78px;
  padding: 0;
  border: none;
  border-radius: 12px;
  background: linear-gradient(115.84deg, #3b3b3b 34.65%, #000000 78.12%);
  box-shadow: 0 4px 24px rgba(170, 178, 189, 0.24);
  color: #ffffff;
  cursor: pointer;
  overflow: visible;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.wheel-home-widget:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 28px rgba(170, 178, 189, 0.32);
}

.wheel-home-widget:active {
  transform: translateY(0);
}

.wheel-home-widget:focus-visible {
  outline: 2px solid #f50302;
  outline-offset: 2px;
}

.wheel-home-widget__title {
  position: absolute;
  left: 10px;
  top: 8px;
  margin: 0;
  font-family: 'Montserrat', sans-serif;
  font-weight: 700;
  font-size: 16px;
  line-height: 20px;
  color: #ffffff;
}

.wheel-home-widget__progress-text {
  position: absolute;
  left: 10px;
  top: 32px;
  margin: 0;
  font-family: -apple-system, 'SF Pro Display', system-ui, sans-serif;
  font-weight: 400;
  font-size: 12px;
  line-height: 14px;
  color: rgba(255, 255, 255, 0.92);
}

.wheel-home-widget__track {
  position: absolute;
  left: 8px;
  top: 58px;
  width: 104px;
  height: 12px;
  border-radius: 12px;
  background: #f5f7fa;
  overflow: hidden;
}

.wheel-home-widget__fill {
  height: 100%;
  border-radius: 12px;
  background: linear-gradient(106.76deg, #f50302 -2.64%, #a90f0e 85.78%);
  box-shadow: 0 8px 16px rgba(97, 1, 0, 0.16);
  transition: width 0.35s ease;
}

.wheel-home-widget__close {
  position: absolute;
  top: -3px;
  right: -3px;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: linear-gradient(144.09deg, #f50302 21.86%, #a90f0e 82.9%);
  box-shadow: 0 2px 6px rgba(97, 1, 0, 0.28);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.15s ease;
}

.wheel-home-widget__close:hover {
  transform: scale(1.06);
}

.wheel-home-widget__close:active {
  transform: scale(0.96);
}

.wheel-home-widget__close:focus-visible {
  outline: 2px solid #ffffff;
  outline-offset: 2px;
}

.wheel-widget-fade-enter-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.wheel-widget-fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.wheel-widget-fade-enter-from {
  opacity: 0;
  transform: scale(0.9) translateY(4px);
}

.wheel-widget-fade-leave-to {
  opacity: 0;
  transform: scale(0.95);
}

@media (max-width: 360px) {
  .wheel-home-widget {
    width: 110px;
    height: 72px;
  }

  .wheel-home-widget__title {
    top: 6px;
    font-size: 14px;
    line-height: 18px;
  }

  .wheel-home-widget__progress-text {
    top: 28px;
    font-size: 11px;
    line-height: 13px;
  }

  .wheel-home-widget__track {
    top: 52px;
    left: 8px;
    width: 94px;
    height: 11px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .wheel-home-widget,
  .wheel-home-widget__close,
  .wheel-home-widget__fill {
    transition: none;
  }

  .wheel-home-widget:hover,
  .wheel-home-widget:active,
  .wheel-home-widget__close:hover,
  .wheel-home-widget__close:active {
    transform: none;
  }

  .wheel-widget-fade-enter-active,
  .wheel-widget-fade-leave-active {
    transition: none;
  }

  .wheel-widget-fade-enter-from,
  .wheel-widget-fade-leave-to {
    transform: none;
  }
}
</style>
