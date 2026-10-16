<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="tariff-sheet-preview"
      @keydown.escape="emitClose"
    >
      <main aria-label="Выбор лимита оплаты картой" class="tariff-sheet-phone">
        <!-- Скроллится только внутренняя область карточки, а не сам
             fixed-оверлей: position:fixed + overflow:auto в WebKit/Telegram
             не ловит тач-скролл. Кнопка закреплена в футере и всегда видна. -->
        <div class="tariff-sheet-scroll">
          <div class="tariff-sheet">
            <div class="tariff-sheet-top">
              <div>
                <h1>Увеличить лимиты</h1>
                <p>Выберите тариф, и заявка поступит продавцу на обработку.</p>
              </div>
              <button
                type="button"
                aria-label="Закрыть"
                class="tariff-sheet-close"
                :disabled="sending"
                @click="emitClose"
              >×</button>
            </div>
            <section aria-label="Тарифы" class="tariff-plans">
              <article
                v-for="(tariff, index) in tariffs"
                :key="tariff.id"
                class="tariff-plan"
                :class="{ 'tariff-plan--selected': tariff.id === modelValue }"
                :data-art="index % 3"
                role="radio"
                :aria-checked="tariff.id === modelValue"
                tabindex="0"
                @click="selectTariff(tariff.id)"
                @keydown="onPlanKeydown($event, index)"
              >
                <div aria-hidden="true" class="tariff-plan-art">
                  <img :src="artFor(index)" alt="" draggable="false">
                </div>
                <div class="tariff-plan-main">
                  <span class="tariff-plan-radio" aria-hidden="true" />
                  <div class="tariff-plan-copy">
                    <div class="tariff-plan-name">{{ tariff.title }}</div>
                    <div class="tariff-plan-price">
                      <strong>{{ priceValue(tariff) }}</strong>
                      <span v-if="priceSuffix(tariff)">{{ priceSuffix(tariff) }}</span>
                    </div>
                  </div>
                </div>
                <div class="tariff-plan-details">
                  <div class="tariff-plan-detail">
                    <div class="tariff-plan-ico">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <rect height="16" rx="2" width="18" x="3" y="5" />
                        <path d="M7 2v6M17 2v6M3 10h18" />
                      </svg>
                    </div>
                    <div>
                      <div class="tariff-plan-small">Доступно раз в</div>
                      <b>{{ cooldownLabel(tariff) }}</b>
                    </div>
                  </div>
                  <div aria-hidden="true" class="tariff-plan-divider" />
                  <div class="tariff-plan-detail">
                    <div class="tariff-plan-ico">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M5 8h14l1 13H4L5 8ZM9 9V6a3 3 0 0 1 6 0v3" />
                      </svg>
                    </div>
                    <div>
                      <div class="tariff-plan-small">Макс. сумма заказа</div>
                      <b>{{ formatMoney(tariff.per_order_limit_minor ?? tariff.limit_minor) }} BYN</b>
                    </div>
                  </div>
                </div>
              </article>
            </section>
          </div>
        </div>
        <div class="tariff-sheet-footer">
          <p v-if="error" class="tariff-sheet-error" role="alert">{{ error }}</p>
          <p v-else-if="requestBlocked" class="tariff-sheet-blocked">Повторную заявку можно отправить через час.</p>
          <button
            type="button"
            class="tariff-sheet-submit"
            :disabled="sending || !modelValue || requestBlocked"
            @click="emit('submit')"
          >{{ sending ? 'Отправляем…' : 'Отправить заявку' }}</button>
        </div>
      </main>

      <div
        v-if="success"
        aria-labelledby="tariff-sheet-dialog-title"
        aria-modal="true"
        class="tariff-sheet-overlay show"
        role="dialog"
      >
        <div class="tariff-sheet-dialog">
          <div class="tariff-sheet-check" aria-hidden="true">✓</div>
          <h2 id="tariff-sheet-dialog-title">Заявка отправлена</h2>
          <p>{{ successText }}</p>
          <button type="button" @click="emit('dismiss-success')">Понятно</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'
import startArt from '@/assets/tariffs/tariff-start.png'
import comfortArt from '@/assets/tariffs/tariff-comfort.png'
import maximumArt from '@/assets/tariffs/tariff-maximum.png'

export interface CardTariffPlan {
  id: string
  title: string
  limit_minor: number
  per_order_limit_minor?: number | null
  cooldown_days?: number | null
  transition_cost_text?: string | null
}

const props = withDefaults(
  defineProps<{
    open: boolean
    tariffs: CardTariffPlan[]
    modelValue: string
    sending?: boolean
    success?: boolean
    successText?: string
    error?: string
    requestBlocked?: boolean
    fallbackCooldownDays?: number
  }>(),
  {
    sending: false,
    success: false,
    successText: '',
    error: '',
    requestBlocked: false,
    fallbackCooldownDays: 10,
  },
)

const emit = defineEmits<{
  (e: 'update:modelValue', id: string): void
  (e: 'close'): void
  (e: 'submit'): void
  (e: 'dismiss-success'): void
}>()

// Лочим скролл страницы под шитом — иначе на iOS/Telegram тач перетаскивает
// фон, и прокрутка самой модалки до кнопки внизу не работает. Подход тот же,
// что в CustomerModalShell (html + body overflow hidden).
function syncScrollLock(isOpen: boolean) {
  if (typeof document === 'undefined') return
  const overflowValue = isOpen ? 'hidden' : ''
  document.documentElement.style.overflow = overflowValue
  document.body.style.overflow = overflowValue
}

watch(
  () => props.open,
  (isOpen) => syncScrollLock(isOpen),
  { immediate: true },
)

// При открытии шит всегда стартует сверху — например, после повторного
// открытия не остаёмся в середине списка тарифов.
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    requestAnimationFrame(() => {
      const scroller = document.body.querySelector('.tariff-sheet-scroll')
      if (scroller) scroller.scrollTop = 0
    })
  },
)

onBeforeUnmount(() => {
  if (props.open) syncScrollLock(false)
})

const planArts = [startArt, comfortArt, maximumArt]

function artFor(index: number) {
  return planArts[index % planArts.length]!
}

function selectTariff(id: string) {
  if (props.sending) return
  emit('update:modelValue', id)
}

function onPlanKeydown(event: KeyboardEvent, index: number) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    selectTariff(props.tariffs[index]!.id)
    return
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const count = props.tariffs.length
    const next = (index + (event.key === 'ArrowDown' ? 1 : count - 1)) % count
    selectTariff(props.tariffs[next]!.id)
  }
}

function emitClose() {
  if (!props.sending) emit('close')
}

// transition_cost_text вида «10 BYN» / «35 BYN единоразово» → цена «10 BYN»
// и подпись «за переход». Произвольный текст остаётся ценой целиком.
function priceMatch(tariff: CardTariffPlan) {
  const text = String(tariff.transition_cost_text || '').trim()
  if (!text) return null
  const match = text.match(/^\s*(\d+(?:[.,]\d+)?)\s*(?:руб|byn|р\.)?\s*$/i)
  if (match) return match[1]!.replace(',', '.')
  return null
}

function priceValue(tariff: CardTariffPlan) {
  const parsed = priceMatch(tariff)
  if (parsed !== null) return `${parsed} BYN`
  return String(tariff.transition_cost_text || '').trim() || '—'
}

function priceSuffix(tariff: CardTariffPlan) {
  return priceMatch(tariff) !== null ? 'за переход' : ''
}

function cooldownDays(tariff: CardTariffPlan) {
  if (tariff.cooldown_days !== null && tariff.cooldown_days !== undefined) {
    return Math.max(0, Math.round(Number(tariff.cooldown_days)))
  }
  return Math.max(0, Math.round(Number(props.fallbackCooldownDays ?? 10)))
}

function cooldownLabel(tariff: CardTariffPlan) {
  const days = cooldownDays(tariff)
  const mod10 = days % 10
  const mod100 = days % 100
  if (mod10 === 1 && mod100 !== 11) return `${days} день`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${days} дня`
  return `${days} дней`
}

function formatMoney(minor?: number | null) {
  return (Number(minor || 0) / 100).toLocaleString('ru-BY', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}
</script>

<style scoped>
.tariff-sheet-preview {
  --tariff-ink: #1c2733;
  --tariff-muted: #7e889b;
  --tariff-shadow: 0 20px 70px rgba(36, 25, 37, 0.18);
  position: fixed;
  inset: 0;
  /* Выше нижнего меню навигации (z-index 100): оверлей перекрывает таб-бар,
     карточка центрируется по полному экрану, кнопка ничего не перекрывает. */
  z-index: 110;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px 14px calc(20px + env(safe-area-inset-bottom, 0px));
  /* Сам оверлей никогда не скроллится (карточка ограничена max-height:
     прокручивается только её внутренняя область) — паттерн CustomerModalShell,
     проверенный в Telegram Mini App. */
  box-sizing: border-box;
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
  color: var(--tariff-ink);
  background: rgba(16, 24, 36, 0.53);
  backdrop-filter: blur(5px);
  -webkit-backdrop-filter: blur(5px);
  animation: tariff-sheet-fade-in 0.18s ease-out;
}

@keyframes tariff-sheet-fade-in {
  from {
    opacity: 0;
  }
}

@keyframes tariff-sheet-card-in {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
}

.tariff-sheet-preview *,
.tariff-sheet-preview *::before,
.tariff-sheet-preview *::after {
  box-sizing: border-box;
}

.tariff-sheet-phone {
  width: min(100%, 540px);
  /* Карточка никогда не выше оверлея: скроллится только внутренняя
     область, футер с кнопкой закреплён внизу. */
  max-height: 100%;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-radius: 36px;
  box-shadow: var(--tariff-shadow);
  overflow: hidden;
  position: relative;
  animation: tariff-sheet-card-in 0.18s ease-out;
}

/* Единственная прокручиваемая зона — внутренность карточки. */
.tariff-sheet-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}

.tariff-sheet-footer {
  flex-shrink: 0;
  padding: 0 22px 25px;
}

.tariff-sheet {
  padding: 16px 22px 0;
}

.tariff-sheet-top {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 16px;
}

/* Ручки-планки сверху нет: заголовок сразу под крестиком. */
.tariff-sheet-top h1 {
  font-size: clamp(24px, 5.2vw, 35px);
  letter-spacing: -1.3px;
  line-height: 1.1;
  margin: 2px 0 8px;
  font-weight: 850;
}

.tariff-sheet-top p {
  font-size: 15px;
  line-height: 1.45;
  color: var(--tariff-muted);
  margin: 0;
  max-width: 400px;
}

.tariff-sheet-close {
  border: 0;
  background: #f2f3f6;
  color: #1d2938;
  width: 45px;
  height: 45px;
  flex: 0 0 45px;
  border-radius: 50%;
  font-size: 28px;
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: background 0.2s;
}

.tariff-sheet-close:hover {
  background: #e5e7ec;
}

.tariff-plans {
  display: grid;
  gap: 12px;
}

.tariff-plan {
  border: 1.5px solid #f8d9dc;
  border-radius: 23px;
  padding: 16px 16px 12px;
  position: relative;
  cursor: pointer;
  background: linear-gradient(135deg, #fff9fa 0%, #fff2f3 65%, #fff8f9 100%);
  transition: transform 0.2s, border 0.2s, box-shadow 0.2s;
  overflow: hidden;
  color: var(--tariff-ink);
}

.tariff-plan:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 30px #c20a1820;
}

.tariff-plan--selected {
  background: linear-gradient(113deg, #f5000b 0%, #e00009 52%, #a80912 100%);
  border-color: transparent;
  color: white;
  box-shadow: 0 12px 28px rgba(189, 0, 13, 0.2);
}

.tariff-plan:focus-visible {
  outline: 3px solid #ff8a8f;
  outline-offset: 3px;
}

.tariff-plan-main {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  position: relative;
  z-index: 2;
  min-height: 64px;
}

.tariff-plan-radio {
  border: 2px solid #8792a4;
  border-radius: 50%;
  width: 23px;
  height: 23px;
  flex: 0 0 23px;
  margin-top: 5px;
  background: white;
  position: relative;
}

.tariff-plan--selected .tariff-plan-radio {
  border: 6px solid white;
  background: #ec0011;
  box-shadow: 0 0 0 2px #fff2;
}

.tariff-plan-copy {
  min-width: 0;
  /* Резервируем место под арт-картинку справа, чтобы название и цена
     никогда не заезжали под неё при длинных названиях. */
  padding-right: 135px;
}

.tariff-plan-name {
  font-size: 24px;
  line-height: 1.12;
  font-weight: 800;
  letter-spacing: -0.65px;
}

.tariff-plan-price {
  margin-top: 5px;
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}

.tariff-plan-price strong {
  font-size: 32px;
  line-height: 1;
  font-weight: 850;
  color: #d6000c;
  letter-spacing: -0.8px;
}

.tariff-plan--selected .tariff-plan-price strong {
  color: white;
}

.tariff-plan-price span {
  font-size: 15px;
  color: #8892a4;
  white-space: nowrap;
}

.tariff-plan--selected .tariff-plan-price span {
  color: #ffbdc0;
}

.tariff-plan-art {
  position: absolute;
  right: 12px;
  top: 9px;
  width: 112px;
  height: 105px;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  overflow: visible;
  isolation: isolate;
}

.tariff-plan-art img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  background: transparent !important;
  mix-blend-mode: normal !important;
  filter: drop-shadow(0 4px 7px rgba(190, 0, 15, 0.08));
}

.tariff-plan--selected .tariff-plan-art img {
  filter: drop-shadow(0 4px 8px rgba(120, 0, 0, 0.1));
}

.tariff-plan[data-art='0'] .tariff-plan-art {
  width: 125px;
  height: 103px;
  right: 8px;
  top: 8px;
}

.tariff-plan[data-art='1'] .tariff-plan-art {
  width: 98px;
  height: 98px;
  right: 9px;
  top: 8px;
}

.tariff-plan[data-art='2'] .tariff-plan-art {
  width: 103px;
  height: 99px;
  right: 7px;
  top: 10px;
}

.tariff-plan:not(.tariff-plan--selected) .tariff-plan-details {
  position: relative;
  z-index: 2;
  margin-top: 10px;
  background: rgba(255, 224, 226, 0.48);
  border-radius: 15px;
  display: flex;
  align-items: center;
  padding: 10px 12px;
}

.tariff-plan--selected .tariff-plan-details {
  background: rgba(255, 255, 255, 0.13);
}

/* Обе половины строго равные (flex: 1 1 0), разделитель — тонкая линия
   ровно в центре ряда, симметричные отступы с двух сторон. */
.tariff-plan-detail {
  flex: 1 1 0;
  display: flex;
  gap: 9px;
  align-items: center;
  min-width: 0;
}

.tariff-plan-divider {
  flex: 0 0 1px;
  align-self: stretch;
  background: #f3c9ce;
  margin: 0 10px;
}

.tariff-plan--selected .tariff-plan-divider {
  background: #ffffff55;
}

.tariff-plan-ico {
  display: grid;
  place-items: center;
  border-radius: 12px;
  width: 35px;
  height: 35px;
  flex: 0 0 35px;
  background: #f8cfd3;
  color: #c80815;
}

.tariff-plan--selected .tariff-plan-ico {
  background: #ffffff28;
  color: white;
}

.tariff-plan-ico svg {
  width: 21px;
  height: 21px;
  stroke: currentColor;
  stroke-width: 2;
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.tariff-plan-small {
  font-size: 11px;
  color: #8790a1;
  line-height: 1.3;
}

.tariff-plan--selected .tariff-plan-small {
  color: #ffcdcf;
}

.tariff-plan-detail b {
  font-size: 15px;
  line-height: 1.35;
  display: block;
  margin-top: 2px;
  font-weight: 700;
}

.tariff-sheet-error {
  margin: 12px 0 0;
  font-size: 13px;
  line-height: 1.45;
  color: #d6000c;
  text-align: center;
}

/* Подсказка, когда кнопка отправки заблокирована часовым откатом заявки. */
.tariff-sheet-blocked {
  margin: 12px 0 0;
  font-size: 12.5px;
  line-height: 1.45;
  color: #7e889b;
  text-align: center;
}

.tariff-sheet-submit {
  width: 100%;
  border: 0;
  border-radius: 19px;
  background: linear-gradient(100deg, #f0000a, #aa0710);
  color: white;
  font-weight: 800;
  font-size: 18px;
  padding: 20px 16px;
  margin-top: 15px;
  cursor: pointer;
  box-shadow: 0 7px 17px rgba(192, 0, 10, 0.14);
  transition: transform 0.15s, filter 0.15s;
  font-family: inherit;
}

.tariff-sheet-submit:hover:not(:disabled) {
  filter: brightness(1.06);
}

.tariff-sheet-submit:active:not(:disabled) {
  transform: scale(0.985);
}

.tariff-sheet-submit:disabled {
  cursor: default;
  opacity: 0.6;
  box-shadow: none;
}

.tariff-sheet-overlay {
  position: fixed;
  inset: 0;
  background: #10182488;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 20px;
  z-index: 10;
  backdrop-filter: blur(5px);
  -webkit-backdrop-filter: blur(5px);
}

.tariff-sheet-overlay.show {
  display: flex;
}

.tariff-sheet-dialog {
  width: min(100%, 380px);
  border-radius: 26px;
  background: white;
  padding: 30px;
  text-align: center;
  box-shadow: var(--tariff-shadow);
}

.tariff-sheet-check {
  font-size: 48px;
  color: #1fb865;
}

.tariff-sheet-dialog h2 {
  margin: 8px 0;
  font-size: 23px;
  font-weight: 800;
  letter-spacing: -0.4px;
}

.tariff-sheet-dialog p {
  line-height: 1.55;
  color: #677184;
  margin: 0 0 18px;
}

.tariff-sheet-dialog button {
  background: linear-gradient(90deg, #ef0010, #ac0712);
  border: 0;
  color: white;
  border-radius: 13px;
  padding: 13px 28px;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  font-family: inherit;
}

@media (min-width: 850px) {
  .tariff-sheet-preview {
    padding: 36px;
  }

  .tariff-sheet-phone {
    width: 540px;
  }

  .tariff-sheet {
    padding: 28px 27px 0;
  }

  .tariff-sheet-footer {
    padding: 0 27px 29px;
  }

  .tariff-plan {
    min-height: 190px;
  }
}

/* Телефоны: компактные арты и шрифты. Брейкпоинт 540px, а не 391:
   iPhone 393-430px иначе получают десктопные картинки 112-125px,
   и текст названия/цены заезжает под них. */
@media (max-width: 540px) {
  .tariff-sheet-preview {
    padding: 15px 10px calc(15px + env(safe-area-inset-bottom, 0px));
  }

  .tariff-sheet {
    padding: 12px 14px 0;
  }

  .tariff-sheet-footer {
    padding: 0 14px 20px;
  }

  .tariff-sheet-top {
    margin-bottom: 12px;
  }

  .tariff-sheet-top h1 {
    font-size: 24px;
  }

  .tariff-sheet-top p {
    font-size: 13.5px;
  }

  .tariff-plan {
    padding: 14px 12px 11px;
    min-height: 0;
  }

  .tariff-plan-copy {
    padding-right: 102px;
  }

  .tariff-plan-name {
    font-size: 22px;
  }

  .tariff-plan-price strong {
    font-size: 29px;
  }

  .tariff-plan-price {
    gap: 6px;
  }

  .tariff-plan-price span {
    font-size: 12px;
  }

  /* Арт уменьшен и поднят так, чтобы его низ (top + height) заканчивался
     выше строки деталей (main min-height 78 + margin 12 = 90). */
  .tariff-plan-art,
  .tariff-plan[data-art='0'] .tariff-plan-art {
    width: 92px;
    height: 76px;
    right: 4px;
    top: 6px;
  }

  .tariff-plan[data-art='1'] .tariff-plan-art,
  .tariff-plan[data-art='2'] .tariff-plan-art {
    width: 84px;
    height: 76px;
    right: 4px;
    top: 6px;
  }

  .tariff-plan-main {
    gap: 10px;
    min-height: 78px;
  }

    .tariff-plan-details {
    padding: 9px 8px;
  }

  .tariff-plan-detail {
    gap: 7px;
  }

  .tariff-plan-divider {
    margin: 0 7px;
  }

  .tariff-plan-ico {
    width: 29px;
    height: 29px;
    flex-basis: 29px;
  }

  .tariff-plan-ico svg {
    width: 18px;
    height: 18px;
  }

  .tariff-plan-small {
    font-size: 10px;
  }

  .tariff-plan-detail b {
    font-size: 13px;
  }
}

/* Совсем узкие экраны (<370px): ещё компактнее. */
@media (max-width: 370px) {
  .tariff-plan-copy {
    padding-right: 92px;
  }

  .tariff-plan-name {
    font-size: 20px;
  }

  .tariff-plan-price strong {
    font-size: 26px;
  }

  .tariff-plan-price span {
    font-size: 11px;
  }

  .tariff-plan-art,
  .tariff-plan[data-art='0'] .tariff-plan-art,
  .tariff-plan[data-art='1'] .tariff-plan-art,
  .tariff-plan[data-art='2'] .tariff-plan-art {
    width: 80px;
    height: 68px;
    right: 4px;
    top: 4px;
  }

    .tariff-plan-ico {
    width: 26px;
    height: 26px;
    flex-basis: 26px;
  }

  .tariff-plan-ico svg {
    width: 16px;
    height: 16px;
  }

  .tariff-plan-small {
    font-size: 9px;
  }

  .tariff-plan-detail b {
    font-size: 12px;
  }
}
</style>
