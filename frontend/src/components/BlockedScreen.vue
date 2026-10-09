<template>
  <div
    class="blocked-screen"
    role="alertdialog"
    aria-modal="true"
    aria-labelledby="blocked-screen-title"
    data-no-smoke
  >
    <div class="blocked-card">
      <div class="blocked-pill">Блокировка</div>

      <div class="blocked-icon" aria-hidden="true">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
        </svg>
      </div>

      <div class="blocked-copy">
        <h1 id="blocked-screen-title" class="blocked-title">Доступ к заказам ограничен</h1>
        <p class="blocked-subtitle">{{ reasonHeading }}</p>
        <p v-if="reason" class="blocked-reason">{{ reason }}</p>
      </div>

      <div class="blocked-info">
        <p class="blocked-info-label">{{ countdownLabel }}</p>
        <p v-if="countdownValue" class="blocked-info-value">{{ countdownValue }}</p>
      </div>

      <p class="blocked-hint">
        Если блокировка по ошибке — напиши нам в Telegram.
      </p>
    </div>
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

const reason = computed(() => (props.reason || '').trim() || null)

// Подзаголовок-вступление для блока с причиной. По фидбэку Кости (08.05.2026):
// раньше «Не прошли авторизацию у менеджера» сливалось с заголовком и было
// неясно, что это конкретная причина. Теперь — явное «Причина блокировки:» как
// якорь, и сам текст причины — отдельной строкой.
const reasonHeading = computed(() => (reason.value ? 'Причина блокировки:' : 'Причина не указана.'))

/**
 * Метка-описатель и значение в зависимости от срока:
 *   - бессрочно → «Блокировка бессрочна»
 *   - меньше 24 часов → таймер «Доступ откроется через X»
 *   - сутки и больше → дата и время «15 апреля в 14:45»
 */
const countdownLabel = computed(() => {
  if (blockUntilMs.value === null) return 'Блокировка бессрочна'
  // Срок истёк, но сервер ещё не подтвердил снятие (или часы клиента опережают).
  // На каждом тике setInterval мы уже дёргаем refreshBlock — экран снимется как
  // только бэкенд тоже посчитает блок истёкшим.
  if (remainingMs.value === 0) return 'Проверяем доступ…'
  if (remainingMs.value !== null && remainingMs.value < 24 * 60 * 60 * 1000) {
    return 'Доступ откроется через'
  }
  return 'Доступ откроется'
})

const countdownValue = computed(() => {
  if (blockUntilMs.value === null) return ''
  if (remainingMs.value === 0) return ''

  if (remainingMs.value !== null && remainingMs.value < 24 * 60 * 60 * 1000) {
    return formatRemainingShort(remainingMs.value)
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
.blocked-screen {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(8, 9, 12, 0.78);
  backdrop-filter: blur(8px);
}

.blocked-card {
  position: relative;
  overflow: hidden;
  width: 100%;
  max-width: 420px;
  border-radius: 24px;
  padding: 24px 22px 26px;
  background: linear-gradient(135deg, #18181b 0%, #2a2a2f 52%, #17171a 100%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 28px 60px rgba(8, 10, 16, 0.55);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 16px;
}

/* Декоративное свечение в углу — как в order-status-card */
.blocked-card::before {
  content: "";
  position: absolute;
  inset: auto -14% -42% auto;
  width: 200px;
  height: 200px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(239, 68, 68, 0.18) 0%, rgba(239, 68, 68, 0) 72%);
  pointer-events: none;
}

.blocked-pill {
  position: relative;
  z-index: 1;
  align-self: center;
  padding: 8px 16px;
  border-radius: 14px;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 12px;
  line-height: 14px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: #ffffff;
  background: linear-gradient(90deg, #ef4444 0%, #b91c1c 100%);
  box-shadow: 0 10px 22px rgba(239, 68, 68, 0.32);
}

.blocked-icon {
  position: relative;
  z-index: 1;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  background: rgba(239, 68, 68, 0.18);
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.06),
    0 0 24px rgba(239, 68, 68, 0.55),
    inset 0 0 18px rgba(239, 68, 68, 0.25);
}

.blocked-copy {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.blocked-title {
  margin: 0;
  font-family: "Montserrat", sans-serif;
  font-size: 22px;
  line-height: 26px;
  font-weight: 700;
  color: #ffffff;
}

.blocked-subtitle {
  margin: 0;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 13px;
  line-height: 16px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.55);
}

.blocked-reason {
  margin: 0;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 16px;
  line-height: 22px;
  font-weight: 600;
  color: #ffffff;
  max-width: 320px;
}

.blocked-info {
  position: relative;
  z-index: 1;
  width: 100%;
  border-radius: 16px;
  padding: 16px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.blocked-info-label {
  margin: 0;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 12px;
  line-height: 14px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.6);
}

.blocked-info-value {
  margin: 0;
  font-family: "Montserrat", sans-serif;
  font-size: 22px;
  line-height: 26px;
  font-weight: 700;
  color: #fbbf24;
  text-shadow: 0 0 18px rgba(251, 191, 36, 0.35);
}

.blocked-hint {
  position: relative;
  z-index: 1;
  margin: 0;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 12px;
  line-height: 16px;
  color: rgba(255, 255, 255, 0.55);
  max-width: 300px;
}
</style>
