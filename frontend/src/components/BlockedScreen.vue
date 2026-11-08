<template>
  <div
    class="blocked-screen"
    role="alertdialog"
    aria-modal="true"
    aria-labelledby="blocked-screen-title"
    data-no-smoke
  >
    <main class="blocked-screen__page">
      <section class="blocked-screen__message" aria-labelledby="blocked-screen-title">
        <!-- Маскот из демо: замки-цифры в глазах мерцают (flicker). -->
        <svg class="blocked-screen__mascot" viewBox="0 0 470 420" aria-hidden="true">
          <image width="470" height="420" href="/blocked/mascot.png" />
          <defs>
            <path
              id="blocked-lock"
              class="blocked-screen__lock"
              d="M4 8V5a4 4 0 0 1 8 0v3m-9 0h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Zm5 4v3"
            />
          </defs>
          <g class="blocked-screen__digits" transform="translate(161 134) rotate(-18) scale(.7)">
            <use href="#blocked-lock" />
          </g>
          <g
            class="blocked-screen__digits blocked-screen__digits--right"
            transform="translate(231 138) rotate(8) scale(1.1)"
          >
            <use href="#blocked-lock" />
          </g>
        </svg>

        <h1 id="blocked-screen-title" class="blocked-screen__title">
          Аккаунт заблокирован
        </h1>

        <!-- Карточка деталей: причина и срок — из реального состояния. -->
        <dl class="blocked-screen__details">
          <div class="blocked-screen__detail">
            <dt>Причина блокировки</dt>
            <dd>{{ reasonText }}</dd>
          </div>
          <div class="blocked-screen__detail">
            <dt>Когда снимется блокировка</dt>
            <dd>{{ countdownText }}</dd>
          </div>
        </dl>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useCustomerBlock } from '@/composables/useCustomerBlock'

const props = defineProps<{
  /** Причина блокировки, видна клиенту (опционально). */
  reason?: string | null
  /** ISO datetime в формате 'YYYY-MM-DD HH:MM:SS' (UTC) или ISO с 'T' и 'Z'. null = бессрочно. */
  blockUntil?: string | null
}>()

const { refreshBlock } = useCustomerBlock()

const now = ref(Date.now())
let timerId: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  // Тикаем каждые 30 секунд (для минут/часов хватает с запасом).
  // Дополнительно: если срок уже истёк (clock skew между клиентом и сервером
  // может удерживать `remainingMs` на нуле без срабатывания watch ниже),
  // дёргаем refreshBlock сами на каждом тике — пока сервер не подтвердит снятие.
  timerId = setInterval(() => {
    now.value = Date.now()
    if (
      blockUntilMs.value !== null &&
      blockUntilMs.value <= now.value
    ) {
      refreshBlock()
    }
  }, 30_000)
})

onBeforeUnmount(() => {
  if (timerId !== null) {
    clearInterval(timerId)
    timerId = null
  }
})

const blockUntilMs = computed(() => {
  if (!props.blockUntil) return null
  const normalized = props.blockUntil.includes('T')
    ? props.blockUntil
    : props.blockUntil.replace(' ', 'T') + 'Z'
  const t = new Date(normalized).getTime()
  return Number.isFinite(t) ? t : null
})

const remainingMs = computed(() => {
  if (blockUntilMs.value === null) return null
  return Math.max(0, blockUntilMs.value - now.value)
})

// Первичный триггер: момент перехода remainingMs в 0. Дальнейшие повторы
// делает setInterval-tick (см. onMounted), потому что Vue watcher не
// перевызывается на не-меняющемся значении.
watch(remainingMs, (val) => {
  if (val === 0) {
    refreshBlock()
  }
})

const reasonText = computed(() => (props.reason || '').trim() || 'Причина не указана')

/**
 * Строка срока в зависимости от состояния:
 *   - бессрочно → «Блокировка бессрочна»
 *   - истёк, ждём сервер → «Проверяем доступ…»
 *   - меньше 24 часов → таймер «через X минут/часов»
 *   - сутки и больше → дата и время «15 апреля 2026 в 14:45»
 */
const countdownText = computed(() => {
  if (blockUntilMs.value === null) return 'Блокировка бессрочна'
  if (remainingMs.value === 0) return 'Проверяем доступ…'

  if (remainingMs.value !== null && remainingMs.value < 24 * 60 * 60 * 1000) {
    return `Доступ откроется через ${formatRemainingShort(remainingMs.value)}`
  }
  return new Date(blockUntilMs.value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
})

function formatRemainingShort(ms: number): string {
  const totalMin = Math.ceil(ms / 60_000)
  if (totalMin < 60) {
    return `${totalMin} ${pluralizeMinutes(totalMin)}`
  }
  const hours = Math.floor(totalMin / 60)
  const min = totalMin % 60
  if (min === 0) {
    return `${hours} ${pluralizeHours(hours)}`
  }
  return `${hours} ${pluralizeHours(hours)} ${min} ${pluralizeMinutes(min)}`
}

function pluralizeMinutes(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'минуту'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'минуты'
  return 'минут'
}

function pluralizeHours(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'час'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'часа'
  return 'часов'
}
</script>

<style scoped>
/* Полноэкранный дизайн из демо account-blocked.html:
   белый фон, маскот с мерцающими замками в глазах, карточка деталей. */
.blocked-screen {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: #ffffff;
  color: #101010;
  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    "SF Pro Display",
    Arial,
    sans-serif;
  -webkit-text-size-adjust: 100%;
}

.blocked-screen__page {
  width: 100%;
  max-width: 480px;
  min-height: 100vh;
  min-height: 100svh;
  margin: 0 auto;
  padding:
    max(24px, env(safe-area-inset-top, 0px))
    20px
    max(24px, env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
}

.blocked-screen__message {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 20px 0;
}

/* ===== Маскот с замками в глазах ===== */
.blocked-screen__mascot {
  display: block;
  width: 250px;
  max-width: 80%;
  height: auto;
  overflow: hidden;
  margin: 0 0 12px;
  flex-shrink: 0;
}

/* Замки-цифры: красные, с лёгким свечением, мерцают по очереди
   (правый глаз со сдвигом фазы — как в демо .digits.right). */
.blocked-screen__digits {
  fill: #ff2626;
  font-family: monospace;
  font-weight: 700;
  text-anchor: middle;
  dominant-baseline: central;
  filter: drop-shadow(0 0 2px #f00);
  animation: blocked-flicker 3.8s linear infinite;
}

.blocked-screen__digits--right {
  animation-delay: -1.3s;
}

@keyframes blocked-flicker {
  0%,
  100% {
    opacity: 0.95;
  }
  15% {
    opacity: 0.6;
  }
  18%,
  43% {
    opacity: 1;
  }
  46% {
    opacity: 0.2;
  }
  49%,
  76% {
    opacity: 1;
  }
  79% {
    opacity: 0.45;
  }
  83% {
    opacity: 1;
  }
}

/* ===== Заголовок ===== */
.blocked-screen__title {
  margin: 0;
  font-family: "Montserrat", sans-serif;
  font-size: clamp(21px, 5.6vw, 27px);
  font-weight: 800;
  line-height: 1.18;
  letter-spacing: -0.65px;
  text-align: center;
  color: #101010;
}

/* ===== Карточка деталей (причина / срок) ===== */
.blocked-screen__details {
  width: 100%;
  max-width: 355px;
  margin: 24px 0 0;
  padding: 0 16px;
  background: #f5f6f8;
  border-radius: 18px;
}

.blocked-screen__detail {
  padding: 13px 0;
}

.blocked-screen__detail + .blocked-screen__detail {
  border-top: 1px solid #e5e7eb;
}

.blocked-screen__detail dt {
  margin-bottom: 5px;
  color: #656b75;
  font-size: 12px;
  line-height: 14px;
}

.blocked-screen__detail dd {
  margin: 0;
  font-size: 15px;
  font-weight: 500;
  line-height: 1.4;
  overflow-wrap: anywhere;
  color: #101010;
}

/* Контур замка внутри SVG. */
.blocked-screen__lock {
  fill: none;
  stroke: #ff3232;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

@media (max-height: 580px) {
  .blocked-screen__message {
    padding: 8px 0 24px;
  }

  .blocked-screen__mascot {
    width: 180px;
  }

  .blocked-screen__title {
    font-size: 22px;
  }

  .blocked-screen__details {
    margin-top: 12px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .blocked-screen__digits {
    animation: none;
  }
}
</style>
