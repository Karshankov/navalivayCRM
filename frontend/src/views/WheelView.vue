<template>
  <div class="wheel-page">
    <header class="wheel-header">
      <button
        type="button"
        class="wheel-header__back"
        aria-label="Назад"
        @click="goBack"
      >
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
      <h1 class="wheel-header__title">Рулетка призов</h1>
      <button
        type="button"
        class="wheel-header__help"
        aria-label="Как работает"
        @click="goToHowTo"
      >
        ?
      </button>
    </header>

    <section v-if="isWheelLocked" class="wheel-locked">
      <div class="wheel-locked__card">
        <p class="wheel-locked__eyebrow">Рулетка скоро откроется</p>
        <h2 class="wheel-locked__title">Сейчас идёт финальное тестирование</h2>
        <p class="wheel-locked__text">
          Мы постепенно открываем доступ к рулетке. Совсем скоро она станет доступна всем.
        </p>
        <button type="button" class="wheel-locked__cta" @click="goToHowTo">
          Как это будет работать
        </button>
      </div>
    </section>

    <section v-else class="wheel-stage">
      <div class="wheel-stage__strip">
        <template v-if="showSkeleton">
          <div class="wheel-stage__strip-skeleton" aria-hidden="true">
            <span
              v-for="n in 5"
              :key="n"
              class="wheel-stage__strip-skeleton-card"
            ></span>
          </div>
        </template>
        <template v-else>
          <WheelStrip
            ref="stripRef"
            :prizes="strippedPrizes"
          />
        </template>
      </div>

      <div v-if="showSkeleton" class="wheel-stage__progress">
        <div
          class="wheel-stage__progress-track"
          role="progressbar"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow="0"
          aria-label="Загрузка прогресса"
        >
          <span class="wheel-stage__progress-fill wheel-stage__progress-fill--skeleton"></span>
        </div>
        <p class="wheel-stage__progress-text">Загружаем рулетку…</p>
      </div>
      <div class="wheel-stage__progress" v-else-if="showProgress">
        <div
          class="wheel-stage__progress-track"
          role="progressbar"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-valuenow="progressPercent"
          :aria-label="progressAriaLabel"
        >
          <span
            class="wheel-stage__progress-fill"
            :style="{ width: `${progressPercent}%` }"
          ></span>
        </div>
        <p class="wheel-stage__progress-text">{{ progressLabel }}</p>
      </div>

      <button
        type="button"
        class="wheel-stage__cta"
        :class="{ 'wheel-stage__cta--disabled': isSpinDisabled }"
        :disabled="isSpinDisabled"
        :aria-busy="wheelStore.isSpinning || isAnimating"
        @click="spin"
      >
        <template v-if="showSkeleton">Загрузка…</template>
        <template v-else-if="wheelStore.isSpinning || isAnimating">Крутится…</template>
        <template v-else-if="hasSpins">Крутить</template>
        <template v-else>Сделай заказ от {{ threshold }} BYN</template>
      </button>

      <p v-if="showSkeleton" class="wheel-stage__balance wheel-stage__balance--skeleton" aria-hidden="true">
        &nbsp;
      </p>
      <p v-else class="wheel-stage__balance">
        Осталось {{ spinsAvailable }} {{ spinsWord }}
      </p>
    </section>

    <section v-if="!isWheelLocked" class="wheel-main">
      <WheelLiveFeed
        v-if="wheelStore.feed.length >= 3"
        :items="wheelStore.feed"
        class="wheel-main__feed"
      />

      <router-link to="/wheel/my-prizes" class="wheel-main__row">
        <span class="wheel-main__row-icon">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path
              d="M3 9H17V16C17 16.5523 16.5523 17 16 17H4C3.44772 17 3 16.5523 3 16V9Z"
              stroke="#1F2933"
              stroke-width="1.5"
              stroke-linejoin="round"
            />
            <path
              d="M2 6.5C2 6.22386 2.22386 6 2.5 6H17.5C17.7761 6 18 6.22386 18 6.5V8.5C18 8.77614 17.7761 9 17.5 9H2.5C2.22386 9 2 8.77614 2 8.5V6.5Z"
              stroke="#1F2933"
              stroke-width="1.5"
              stroke-linejoin="round"
            />
            <path
              d="M10 6V17"
              stroke="#1F2933"
              stroke-width="1.5"
              stroke-linecap="round"
            />
            <path
              d="M10 6C10 6 7.5 6 6.5 5C5.71776 4.21776 5.71776 2.78224 6.5 2C7.28224 1.21776 8.71776 1.21776 9.5 2C10.5 3 10 6 10 6Z"
              stroke="#1F2933"
              stroke-width="1.5"
              stroke-linejoin="round"
            />
            <path
              d="M10 6C10 6 12.5 6 13.5 5C14.2822 4.21776 14.2822 2.78224 13.5 2C12.7178 1.21776 11.2822 1.21776 10.5 2C9.5 3 10 6 10 6Z"
              stroke="#1F2933"
              stroke-width="1.5"
              stroke-linejoin="round"
            />
          </svg>
        </span>
        <span class="wheel-main__row-text">Мои активные призы</span>
        <span class="wheel-main__row-count">{{ activePrizesCount }}</span>
        <span class="wheel-main__row-arrow" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M5 3L9 7L5 11"
              stroke="#1F2933"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </span>
      </router-link>

      <router-link to="/wheel/how-it-works" class="wheel-main__row">
        <span class="wheel-main__row-icon wheel-main__row-icon--quiet">?</span>
        <span class="wheel-main__row-text">Как работает рулетка</span>
        <span class="wheel-main__row-arrow" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M5 3L9 7L5 11"
              stroke="#1F2933"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </span>
      </router-link>
    </section>

    <CustomerModalShell
      :open="showResult"
      :title="modalTitle"
      reserve-tab-bar
      compact
      @close="closeResult"
    >
      <div
        v-if="lastResult?.prize"
        class="wheel-result-body"
        :class="{ 'wheel-result-body--nothing': isNothingResult }"
      >
        <div v-if="isNothingResult" class="wheel-result-body__sad-face" aria-hidden="true">
          🗿
        </div>
        <div
          v-if="lastResult.prize.rarity_code && !isNothingResult"
          class="wheel-result-body__prize-card"
          :style="{ borderColor: rarityBorderColor(lastResult.prize.rarity_code) }"
        >
          <img
            v-if="lastResult.prize.image_url && !resultImageFailed"
            :src="lastResult.prize.image_url"
            :alt="lastResult.prize.title"
            class="wheel-result-body__prize-img"
            @error="resultImageFailed = true"
          />
          <div
            v-else
            class="wheel-result-body__prize-fallback"
            :style="resultPrizeFallbackStyle"
            role="img"
            :aria-label="lastResult.prize.title"
          ></div>
          <span
            class="wheel-result-body__rarity-text"
            :style="{ color: rarityBorderColor(lastResult.prize.rarity_code) }"
          >
            {{ rarityLabel(lastResult.prize.rarity_code) }}
          </span>
        </div>
        <p v-if="resultKicker" class="wheel-result-body__kicker">{{ resultKicker }}</p>
        <h3 class="wheel-result-body__title">
          {{ resultTitle }}
        </h3>
        <p v-if="resultDescription" class="wheel-result-body__desc">
          {{ resultDescription }}
        </p>
        <div v-if="showResultPromo" class="wheel-result-body__promo">
          <span class="wheel-result-body__promo-label">Промокод</span>
          <button
            type="button"
            class="wheel-result-body__promo-code"
            @click="copyResultPromo"
          >
            {{ lastResult.promo_code }}
          </button>
        </div>
        <p v-if="resultValidUntil" class="wheel-result-body__valid">
          Действует до {{ formatDate(resultValidUntil) }}
        </p>
      </div>

      <template #footer>
        <button type="button" class="wheel-result-cta" @click="closeResult">
          {{ resultCtaLabel }}
        </button>
      </template>
    </CustomerModalShell>

    <WheelConsentModal
      :open="showConsentModal"
      :busy="wheelStore.isUpdatingConsent"
      @decide="handleConsentDecision"
      @close="dismissConsentModal"
    />

    <Transition name="wheel-copy-toast-fade">
      <div v-if="showCopyToast" class="wheel-copy-toast" role="status">
        Промокод скопирован
      </div>
    </Transition>

    <ToastNotification
      v-if="toastMessage"
      :key="toastKey"
      :message="toastMessage"
      type="error"
      @close="toastMessage = ''"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import WheelStrip from '@/components/wheel/WheelStrip.vue'
import WheelLiveFeed from '@/components/wheel/WheelLiveFeed.vue'
import WheelConsentModal from '@/components/wheel/WheelConsentModal.vue'
import CustomerModalShell from '@/components/CustomerModalShell.vue'
import ToastNotification from '@/components/ToastNotification.vue'
import { useWheelStore, WHEEL_STATE_CACHE_TTL_MS, type WheelPrize, type WheelSpinResult } from '@/stores/wheel'
import defaultPrizeImage from '@/assets/wheel-default-prize.png'

const wheelStore = useWheelStore()
const router = useRouter()
const stripRef = ref<InstanceType<typeof WheelStrip> | null>(null)
const showResult = ref(false)
const lastResult = ref<WheelSpinResult | null>(null)
const toastMessage = ref('')
const toastKey = ref(0)
const showCopyToast = ref(false)
const resultImageFailed = ref(false)
let copyToastTimer: ReturnType<typeof setTimeout> | null = null

async function copyResultPromo() {
  const code = lastResult.value?.promo_code
  if (!code) return
  try {
    await navigator.clipboard.writeText(code)
  } catch (_error) {
    // best-effort: ignore failure (no clipboard API in older browsers)
  }
  showCopyToast.value = true
  if (copyToastTimer) clearTimeout(copyToastTimer)
  copyToastTimer = setTimeout(() => {
    showCopyToast.value = false
  }, 1800)
}
// C1-UX: `wheelStore.isSpinning` flips back to `false` as soon as the
// /api/wheel/spin response is received (~300ms), but the CSGO strip
// animation runs for ~5.4s after that. A second click during those
// seconds would commit a second server-side spin and burn the spin
// counter without ever showing the user the second result. `isAnimating`
// is the local "ongoing visual reveal" flag that stays true for the
// whole spin → animation → modal flow.
const isAnimating = ref(false)

// Q6: live-feed PII consent. We show the modal once per customer,
// the very first time they land on /wheel after the migration. The
// backend reports `feed_consent_required` based on
// customers.wheel_feed_consent_at being NULL — so a single accept
// or decline closes the modal forever. We additionally guard with a
// session-local flag so the user does not see the modal pop again
// while they navigate away and back within the same Mini App session
// before the state refresh lands.
const showConsentModal = ref(false)
const consentDismissedThisSession = ref(false)

const strippedPrizes = computed<WheelPrize[]>(() => wheelStore.sortedPrizes)
const spinsAvailable = computed(() => wheelStore.balance.spins_available)
const accumulated = computed(() =>
  Math.round(wheelStore.balance.accumulated_byn),
)
const threshold = computed(() => Math.round(wheelStore.balance.threshold_byn || 40))
const progressPercent = computed(() => wheelStore.balance.progress_percent)
const hasSpins = computed(() => wheelStore.hasSpins)
const activePrizesCount = computed(() => wheelStore.myActivePrizes.length)

// S2-8: progress bar should stay visible whenever there is meaningful
// progress to show — both when the customer has zero spins (motivates
// the next purchase) and when they already hold spins but are halfway
// to the next one. Hide it only when there is literally nothing to
// progress toward (no balance row yet, threshold misconfigured).
const showProgress = computed(() => {
  if (threshold.value <= 0) return false
  if (!hasSpins.value) return true
  return accumulated.value > 0
})

const progressLabel = computed(() => {
  const remaining = Math.max(0, threshold.value - accumulated.value)
  if (hasSpins.value && accumulated.value > 0) {
    return `Ещё ${remaining} BYN до следующего спина`
  }
  return `${accumulated.value} из ${threshold.value} BYN до начисления спина`
})

const progressAriaLabel = computed(() => `Прогресс до следующего спина: ${progressPercent.value}%`)
const isNothingResult = computed(() => lastResult.value?.prize?.rarity_code === 'nothing')

// S16 + P3-UX: skeleton показываем только пока ни одного успешного
// /api/wheel/state ещё не было. Как только store закэшировал хотя бы
// один ответ (lastFetchedAt !== null), повторный mount возвращается
// сразу к данным — даже если silent refresh ещё в полёте, скелетон
// не мерцает.
const showSkeleton = computed(
  () => wheelStore.lastFetchedAt === null && wheelStore.isLoading,
)
const isWheelLocked = computed(
  () => !showSkeleton.value && !wheelStore.accessAllowed,
)

const isSpinDisabled = computed(
  () => showSkeleton.value || isWheelLocked.value || !hasSpins.value || wheelStore.isSpinning || isAnimating.value,
)

const spinsWord = computed(() => {
  const n = spinsAvailable.value
  if (n % 10 === 1 && n % 100 !== 11) return 'прокрутка'
  if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) {
    return 'прокрутки'
  }
  return 'прокруток'
})

const resultKicker = computed(() => {
  if (isNothingResult.value) return ''
  if (lastResult.value?.is_epic_release) return 'Эпическая выдача'
  return 'Тебе выпало'
})

const modalTitle = computed(() => {
  if (isNothingResult.value) return ''
  if (lastResult.value?.is_epic_release) return 'Эпический приз'
  return 'Поздравляем'
})

const resultTitle = computed(() => {
  if (isNothingResult.value) return 'В следующий раз повезёт'
  return lastResult.value?.prize?.title || '—'
})

const resultDescription = computed(() => {
  if (isNothingResult.value) {
    return ''
  }
  return lastResult.value?.prize?.description || ''
})

const showResultPromo = computed(() => Boolean(lastResult.value?.promo_code) && !isNothingResult.value)
const resultValidUntil = computed(() => (isNothingResult.value ? '' : lastResult.value?.promo_valid_until || ''))
const resultCtaLabel = computed(() => (isNothingResult.value ? 'Понятно' : 'Забрать'))
const resultPrizeFallbackStyle = computed(() => ({
  backgroundColor: rarityBorderColor(lastResult.value?.prize?.rarity_code || ''),
  '--wheel-default-prize-image': `url('${defaultPrizeImage}')`,
}))

function extractFirstHex(value: string | undefined | null): string {
  if (!value) return '#E2E5EA'
  const match = value.match(/#([0-9a-fA-F]{3}){1,2}\b/)
  return match ? match[0] : value
}

function rarityColor(code: string): string {
  const rarity = wheelStore.rarities.find((r) => r.code === code)
  return rarity?.bgColor || '#1F2933'
}

function rarityBorderColor(code: string): string {
  return extractFirstHex(rarityColor(code))
}

function rarityLabel(code: string): string {
  const rarity = wheelStore.rarities.find((r) => r.code === code)
  return rarity?.label || code
}

function wheelPrizeFromSpinResult(result: WheelSpinResult, existing?: WheelPrize): WheelPrize {
  const rarity = wheelStore.rarities.find((item) => item.code === result.prize.rarity_code) || null
  return {
    id: result.prize.id,
    title: result.prize.title,
    description: result.prize.description,
    image_url: result.prize.image_url,
    rarity,
    weight: existing?.weight ?? 1,
    effective_weight: existing?.effective_weight ?? 1,
    max_total: existing?.max_total ?? 0,
    issued_count: existing?.issued_count ?? 0,
    is_exhausted: existing?.is_exhausted ?? false,
    sort_order: existing?.sort_order ?? strippedPrizes.value.length,
  }
}

function animationPrizesForResult(result: WheelSpinResult): WheelPrize[] {
  const snapshot = strippedPrizes.value.map((prize) => ({ ...prize }))
  const index = snapshot.findIndex((prize) => prize.id === result.prize.id)
  if (index === -1) {
    return [...snapshot, wheelPrizeFromSpinResult(result)]
  }
  snapshot[index] = wheelPrizeFromSpinResult(result, snapshot[index])
  return snapshot
}

function formatDate(iso: string): string {
  if (!iso) return ''
  const date = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function showToast(message: string) {
  toastMessage.value = message
  toastKey.value += 1
}

function spinErrorMessage(error: unknown): string {
  const code = (error as { code?: string })?.code
  if (code === 'not_enough_spins') {
    return 'Недостаточно спинов. Сделай заказ, чтобы получить ещё.'
  }
  if (code === 'wheel_disabled') {
    return 'Рулетка временно недоступна. Попробуй позже.'
  }
  if (code === 'no_prizes_configured' || code === 'no_prizes_available') {
    return 'Призы пока не настроены. Скоро всё заработает.'
  }
  if (code === 'customer_not_found') {
    return 'Не получилось найти твой профиль. Открой Mini App заново.'
  }
  return 'Не удалось крутить рулетку. Проверь интернет и попробуй снова.'
}

async function spin() {
  // C1-UX guard: block while either the network spin is in-flight OR the
  // CSGO animation is still rolling. Either condition means a second
  // server-side spin would happen "for free" without the user ever seeing
  // the previous result.
  if (!hasSpins.value || wheelStore.isSpinning || isAnimating.value) return

  isAnimating.value = true
  let result: WheelSpinResult | null = null
  try {
    try {
      await wheelStore.fetchState({ silent: true, force: true }).catch((error) => {
        console.warn('[wheel] pre-spin state refresh failed (non-fatal)', error)
      })
      if (wheelStore.balance.spins_available <= 0) {
        showToast(spinErrorMessage({ code: 'not_enough_spins' }))
        return
      }
      result = await wheelStore.spin()
      lastResult.value = result
      resultImageFailed.value = false
    } catch (error) {
      console.error('[wheel] spin error', error)
      showToast(spinErrorMessage(error))
      return
    }

    // S12: even if the strip animation can't run (e.g. prize_id missing
    // from the local pool, ref unmounted, animation throw), the spin is
    // already committed server-side and the customer paid one spin. Show
    // the result modal regardless so they see what they won.
    try {
      await stripRef.value?.runSpin({
        prizeId: result.prize.id,
        seed: result.animation_seed,
        prizes: animationPrizesForResult(result),
      })
    } catch (animError) {
      console.warn('[wheel] strip animation error (non-fatal)', animError)
    }
    showResult.value = true
    // S2-6: refresh state in the background so live-feed and balance
    // reflect the new spin while the user is still reading the modal.
    // Closing the modal no longer triggers a second fetch. Silent +
    // force: spin() сам обнулил lastFetchedAt, force здесь подстраховка
    // чтобы кэш точно не вернул старые данные; silent — чтобы фон
    // обновления не показывал скелетон поверх уже открытой модалки.
    wheelStore.fetchState({ silent: true, force: true }).catch(() => undefined)
  } finally {
    isAnimating.value = false
  }
}

function closeResult() {
  showResult.value = false
}

async function handleConsentDecision(consent: boolean) {
  consentDismissedThisSession.value = true
  showConsentModal.value = false
  try {
    await wheelStore.setFeedConsent(consent)
  } catch (error) {
    console.warn('[wheel] failed to save consent', error)
    showToast('Не удалось сохранить выбор. Попробуй ещё раз из профиля.')
  }
}

function dismissConsentModal() {
  // The user can dismiss the modal via the X button without making a
  // choice. We do not POST consent in that case — they will see the
  // modal again next visit until they explicitly accept or decline.
  consentDismissedThisSession.value = true
  showConsentModal.value = false
}

function goBack() {
  if (window.history.length > 1) {
    router.back()
  } else {
    router.push('/')
  }
}

function goToHowTo() {
  router.push('/wheel/how-it-works')
}

onMounted(async () => {
  // P3-UX: если кэш свежий — отдаём данные мгновенно, без скелетона.
  // В фоне всё равно дёргаем silent refresh, чтобы feed/balance не
  // отставали в редком кейсе «открыл рулетку, ушёл на 50 секунд,
  // вернулся через минус-эпсилон от TTL».
  const isCacheFresh = wheelStore.lastFetchedAt !== null
    && Date.now() - wheelStore.lastFetchedAt < WHEEL_STATE_CACHE_TTL_MS

  if (isCacheFresh) {
    wheelStore.fetchState({ silent: true, force: true }).catch(() => undefined)
    if (
      wheelStore.feedConsentRequired
      && !consentDismissedThisSession.value
    ) {
      showConsentModal.value = true
    }
    return
  }

  try {
    await wheelStore.fetchState()
    if (
      wheelStore.feedConsentRequired
      && !consentDismissedThisSession.value
    ) {
      showConsentModal.value = true
    }
  } catch (error) {
    console.error('[wheel] state error', error)
    showToast('Не удалось загрузить рулетку. Открой страницу заново.')
  }
})
</script>

<style scoped>
.wheel-page {
  min-height: 100vh;
  background: #f5f7fa;
  padding-bottom: 24px;
}

/* Простой клиентский header — паттерн из WheelMyPrizesView. */
.wheel-header {
  display: grid;
  grid-template-columns: 36px 1fr 36px;
  align-items: center;
  gap: 12px;
  padding: 18px 16px 12px;
}

.wheel-header__back,
.wheel-header__help {
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
  color: #1f2933;
  font-family: 'Montserrat', sans-serif;
  font-weight: 600;
  font-size: 18px;
}

/* S2-3: 36×36 visual chip с 44×44 невидимым hit-target. */
.wheel-header__back::before,
.wheel-header__help::before {
  content: "";
  position: absolute;
  inset: -4px;
  border-radius: inherit;
}

.wheel-header__title {
  margin: 0;
  text-align: center;
  font-family: 'Montserrat', sans-serif;
  font-weight: 700;
  font-size: 18px;
  line-height: 1.2;
  color: #1f2933;
}

/* Сцена рулетки — белый блок на фоне страницы. */
.wheel-stage {
  margin: 4px 0 16px;
  padding: 0;
  background: transparent;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.wheel-locked {
  margin: 8px 16px 16px;
}

.wheel-locked__card {
  background: #ffffff;
  border-radius: 24px;
  padding: 24px 20px;
  box-shadow: 0 18px 36px rgba(15, 23, 42, 0.06);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.wheel-locked__eyebrow {
  margin: 0;
  font-family: 'SF Pro Display', system-ui, sans-serif;
  font-size: 13px;
  color: #f50302;
  font-weight: 600;
}

.wheel-locked__title {
  margin: 0;
  font-family: 'Montserrat', sans-serif;
  font-size: 22px;
  line-height: 1.2;
  color: #1f2933;
}

.wheel-locked__text {
  margin: 0;
  font-family: 'SF Pro Display', system-ui, sans-serif;
  font-size: 15px;
  line-height: 1.4;
  color: #5c6470;
}

.wheel-locked__cta {
  margin-top: 4px;
  height: 48px;
  border: none;
  border-radius: 24px;
  background: linear-gradient(106.76deg, #f50302 -2.64%, #a90f0e 85.78%);
  color: #ffffff;
  font-family: 'Montserrat', sans-serif;
  font-weight: 700;
  font-size: 15px;
}

.wheel-stage__strip {
  position: relative;
}

.wheel-stage__strip-skeleton {
  display: flex;
  gap: 18px;
  height: 214px;
  align-items: flex-start;
  padding: 0;
  overflow: hidden;
}

.wheel-stage__strip-skeleton-card {
  flex: 0 0 152px;
  height: 152px;
  border-radius: 24px;
  background: linear-gradient(
    90deg,
    rgba(15, 23, 42, 0.06) 0%,
    rgba(15, 23, 42, 0.12) 50%,
    rgba(15, 23, 42, 0.06) 100%
  );
  background-size: 200% 100%;
  animation: wheel-skeleton-pulse 1.6s ease-in-out infinite;
}

@keyframes wheel-skeleton-pulse {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

.wheel-stage__progress {
  margin: -8px 24px 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.wheel-stage__progress-track {
  position: relative;
  width: 100%;
  height: 4px;
  border-radius: 4px;
  background: rgba(15, 23, 42, 0.08);
  overflow: hidden;
}

.wheel-stage__progress-fill {
  position: absolute;
  inset: 0;
  width: 0%;
  background: linear-gradient(106.76deg, #f50302 -2.64%, #a90f0e 85.78%);
  transition: width 0.4s ease;
}

.wheel-stage__progress-fill--skeleton {
  width: 40%;
  background: linear-gradient(
    90deg,
    rgba(15, 23, 42, 0.08) 0%,
    rgba(15, 23, 42, 0.16) 50%,
    rgba(15, 23, 42, 0.08) 100%
  );
  background-size: 200% 100%;
  animation: wheel-skeleton-pulse 1.6s ease-in-out infinite;
}

.wheel-stage__progress-text {
  margin: 0;
  font-family: 'SF Pro Display', system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.3;
  text-align: center;
  color: #1f2933;
  font-weight: 500;
}

.wheel-stage__cta {
  display: block;
  width: calc(100% - 48px);
  margin: 0 auto;
  height: 64px;
  border-radius: 32px;
  border: none;
  background: linear-gradient(106.76deg, #f50302 -2.64%, #a90f0e 85.78%);
  color: #ffffff;
  font-family: 'Montserrat', sans-serif;
  font-weight: 700;
  font-size: 17px;
  letter-spacing: 0;
  cursor: pointer;
  box-shadow: none;
  transition: transform 0.15s ease, opacity 0.2s ease, box-shadow 0.2s ease;
}

.wheel-stage__cta:active {
  transform: scale(0.98);
}

.wheel-stage__cta--disabled {
  opacity: 0.55;
  cursor: not-allowed;
  box-shadow: none;
}

.wheel-stage__balance {
  margin: 0;
  text-align: center;
  font-family: 'SF Pro Display', system-ui, sans-serif;
  font-size: 14px;
  color: #bcc2cb;
  min-height: 16px;
}

.wheel-stage__balance--skeleton {
  visibility: hidden;
}

.wheel-main {
  margin: 0 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.wheel-main__feed {
  margin: 0;
}

.wheel-main__row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px 20px;
  background: #ffffff;
  border-radius: 20px;
  text-decoration: none;
  color: #1f2933;
}

.wheel-main__row-icon {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #1f2933;
  font-family: 'Montserrat', sans-serif;
  font-weight: 600;
  font-size: 18px;
  background: transparent;
}

.wheel-main__row-icon--quiet {
  color: #1f2933;
  background: transparent;
}

.wheel-main__row-text {
  flex: 1 1 auto;
  font-family: 'SF Pro Display', system-ui, sans-serif;
  font-size: 15px;
  color: #1f2933;
  font-weight: 500;
}

.wheel-main__row-count {
  min-width: 26px;
  height: 26px;
  border-radius: 13px;
  background: linear-gradient(106.76deg, #f50302 -2.64%, #a90f0e 85.78%);
  color: #ffffff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 9px;
  font-family: 'Montserrat', sans-serif;
  font-weight: 700;
  font-size: 13px;
  letter-spacing: 0.02em;
}

.wheel-main__row-arrow {
  display: inline-flex;
}

.wheel-result-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 6px;
  padding-top: 0;
}

.wheel-result-body--nothing {
  gap: 10px;
}

.wheel-result-body__sad-face {
  font-size: 54px;
  line-height: 1;
  filter: drop-shadow(0 8px 16px rgba(31, 41, 51, 0.14));
}

.wheel-result-body__kicker {
  margin: 0;
  font-family: 'SF Pro Display', system-ui, sans-serif;
  font-size: 12px;
  line-height: 15px;
  color: #5c6470;
}

.wheel-result-body__prize-card {
  width: 88px;
  min-height: 104px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 5px;
  padding: 5px 5px 7px;
  border: 2px solid #e2e5ea;
  border-radius: 18px;
  background: #ffffff;
  box-shadow: 0 12px 24px rgba(31, 41, 51, 0.08);
  margin-bottom: 0;
}

.wheel-result-body__prize-img {
  width: 74px;
  height: 74px;
  display: block;
  border-radius: 13px;
  object-fit: cover;
  background: #f5f7fa;
}

.wheel-result-body__prize-fallback {
  width: 74px;
  height: 74px;
  border-radius: 13px;
  background-color: #9aa0a6;
  -webkit-mask-image: var(--wheel-default-prize-image);
  mask-image: var(--wheel-default-prize-image);
  -webkit-mask-size: 72%;
  mask-size: 72%;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}

.wheel-result-body__rarity-text {
  max-width: 100%;
  font-family: 'Montserrat', sans-serif;
  font-weight: 700;
  font-size: 9px;
  line-height: 1.15;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wheel-result-body__title {
  margin: 0;
  max-width: 100%;
  font-family: 'Montserrat', sans-serif;
  font-weight: 700;
  font-size: 20px;
  line-height: 24px;
  color: #1f2933;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.wheel-result-body__desc {
  margin: 0;
  max-width: 100%;
  font-family: 'SF Pro Display', system-ui, sans-serif;
  font-size: 13px;
  line-height: 16px;
  color: #5c6470;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.wheel-result-body__promo {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  margin-top: 4px;
  background: rgba(245, 3, 2, 0.08);
  padding: 9px 14px;
  border-radius: 15px;
  width: 100%;
}

.wheel-result-body__promo-label {
  font-family: 'SF Pro Display', system-ui, sans-serif;
  font-size: 11px;
  line-height: 13px;
  color: #5c6470;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.wheel-result-body__promo-code {
  font-family: 'Montserrat', sans-serif;
  font-weight: 700;
  font-size: 17px;
  line-height: 22px;
  color: #f50302;
  letter-spacing: 0.05em;
  background: transparent;
  border: 0;
  padding: 0;
  cursor: pointer;
  font-variant-numeric: tabular-nums;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wheel-result-body__valid {
  margin: 0;
  font-family: 'SF Pro Display', system-ui, sans-serif;
  font-size: 11px;
  line-height: 14px;
  color: #9aa0a6;
}

.wheel-result-cta {
  width: 100%;
  height: 44px;
  border: none;
  border-radius: 22px;
  background: linear-gradient(106.76deg, #f50302 -2.64%, #a90f0e 85.78%);
  color: #ffffff;
  font-family: 'Montserrat', sans-serif;
  font-weight: 700;
  font-size: 15px;
  cursor: pointer;
}

@media (max-width: 360px) {
  .wheel-stage {
    margin: 4px 0 16px;
    padding: 0;
  }

  .wheel-stage__cta {
    width: calc(100% - 32px);
    height: 56px;
    border-radius: 28px;
    font-size: 16px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .wheel-stage__strip-skeleton-card,
  .wheel-stage__progress-fill--skeleton {
    animation: none;
  }
}

.wheel-copy-toast {
  position: fixed;
  bottom: calc(var(--app-bottom-tab-bar-height, 130px) + 24px);
  left: 50%;
  transform: translateX(-50%);
  background: rgba(15, 23, 42, 0.92);
  color: #ffffff;
  font-family: 'SF Pro Display', system-ui, sans-serif;
  font-size: 14px;
  padding: 10px 18px;
  border-radius: 999px;
  z-index: 200;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18);
}

.wheel-copy-toast-fade-enter-active,
.wheel-copy-toast-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.wheel-copy-toast-fade-enter-from,
.wheel-copy-toast-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}
</style>
