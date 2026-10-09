<template>
  <div class="wheel-howto-page">
    <header class="wheel-howto-header">
      <button type="button" class="wheel-howto-back" aria-label="Назад" @click="goBack">
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
      <h1 class="wheel-howto-title">Как работает рулетка</h1>
    </header>

    <main class="wheel-howto-content">
      <section class="wheel-howto-card wheel-howto-card--hero">
        <div class="wheel-howto-card__copy">
          <h2 class="wheel-howto-card__title wheel-howto-card__title--inverted">
            Как получить спин
          </h2>
          <p class="wheel-howto-card__text wheel-howto-card__text--inverted">
            За каждые {{ spinThreshold }} BYN, потраченные у нас — вам выдается одна
            прокрутка (спин) рулетки призов
          </p>
        </div>
        <div class="wheel-howto-card__gift" aria-hidden="true">
          <span class="wheel-howto-card__gift-glow"></span>
          <img
            class="wheel-howto-card__gift-image"
            :src="giftImage"
            alt=""
          />
        </div>
      </section>

      <section class="wheel-howto-card">
        <h2 class="wheel-howto-card__title">Что внутри</h2>
        <p class="wheel-howto-card__text">
          В рулетке несколько уровней редкости. Чем редче приз, тем меньше его шанс.
          Призы выдаются автоматически — промокод сразу появится в карточке «Мои
          активные призы».
        </p>
        <ul class="wheel-howto-rarities">
          <li
            v-for="(rarity, index) in rarities"
            :key="rarity.code"
            class="wheel-howto-rarity"
            :class="{ 'wheel-howto-rarity--solo': isLastSolo(index) }"
            :style="{ background: rarity.bgColor, color: rarity.textColor }"
          >
            {{ rarity.label }}
          </li>
        </ul>
      </section>

      <section class="wheel-howto-card">
        <h2 class="wheel-howto-card__title">Важно</h2>
        <ul class="wheel-howto-list">
          <li>Спины не сгорают, копятся неограниченно.</li>
          <li>Срок жизни промокода указан на карточке приза.</li>
          <li>В одном заказе можно использовать только один промокод.</li>
        </ul>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useWheelStore } from '@/stores/wheel'
import { useWholesaleStore } from '@/stores/wholesale'
import giftImage from '@/assets/wheel-howto-gift.png'

const wheelStore = useWheelStore()
const wholesaleStore = useWholesaleStore()
const router = useRouter()

const rarities = computed(() =>
  wheelStore.rarities.filter((rarity) => rarity.code !== 'nothing'),
)

function isLastSolo(index: number): boolean {
  const total = rarities.value.length
  return total % 2 === 1 && index === total - 1
}
const spinThreshold = computed(() => {
  if (wheelStore.lastFetchedAt !== null && wheelStore.balance.threshold_byn > 0) {
    return Math.round(wheelStore.balance.threshold_byn)
  }
  const isWholesale = wheelStore.isWholesale || wholesaleStore.isWholesale
  return Math.round(
    isWholesale
      ? (wheelStore.settings.spin_byn_wholesale || 200)
      : (wheelStore.settings.spin_byn_retail || 40),
  )
})

function goBack() {
  if (window.history.length > 1) {
    router.back()
  } else {
    router.push('/wheel')
  }
}

onMounted(() => {
  // P3-UX: silent fetch использует TTL-кэш store. Если данные свежие,
  // ничего не происходит; если устарели или ещё не загружены, тихо
  // подтянем — у этого экрана нет скелетона, так что показывать
  // isLoading смысла нет.
  wheelStore.fetchState({ silent: true }).catch(() => undefined)
})
</script>

<style scoped>
.wheel-howto-page {
  min-height: 100vh;
  background: #f5f7fa;
  padding-bottom: 24px;
}

.wheel-howto-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 16px 12px;
}

.wheel-howto-back {
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

/* S2-3: visual chip 36×36, tap area 44×44 via invisible ::before. */
.wheel-howto-back::before {
  content: "";
  position: absolute;
  inset: -4px;
  border-radius: inherit;
}

.wheel-howto-title {
  font-family: 'Montserrat', sans-serif;
  font-weight: 700;
  font-size: 18px;
  color: #1f2933;
  margin: 0;
}

.wheel-howto-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 16px 24px;
}

.wheel-howto-card {
  background: #ffffff;
  border-radius: 22px;
  padding: 18px 18px 16px;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.04);
}

.wheel-howto-card--hero {
  position: relative;
  background: linear-gradient(135deg, #18181b 0%, #2a2a2f 52%, #17171a 100%);
  color: #FFFFFF;
  padding: 16px 102px 16px 18px;
  overflow: hidden;
  border-radius: 20px;
  box-shadow: none;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.wheel-howto-card__copy {
  position: relative;
  z-index: 2;
}

@media (max-width: 380px) {
  .wheel-howto-card--hero {
    padding: 14px 92px 14px 16px;
  }
}

.wheel-howto-card--hero .wheel-howto-card__title,
.wheel-howto-card--hero .wheel-howto-card__title--inverted {
  color: #FFFFFF;
  font-family: 'SF Pro Display', system-ui, sans-serif;
  font-weight: 700;
  font-size: 22px;
  line-height: 26px;
  margin: 0 0 8px;
  letter-spacing: -0.01em;
}

.wheel-howto-card--hero .wheel-howto-card__text,
.wheel-howto-card--hero .wheel-howto-card__text--inverted {
  color: #FFFFFF;
  font-family: 'SF Pro Display', system-ui, sans-serif;
  font-weight: 400;
  font-size: 13px;
  line-height: 16px;
  opacity: 1;
}

@media (max-width: 380px) {
  .wheel-howto-card--hero .wheel-howto-card__title,
  .wheel-howto-card--hero .wheel-howto-card__title--inverted {
    font-size: 20px;
    line-height: 24px;
    margin-bottom: 6px;
  }

  .wheel-howto-card--hero .wheel-howto-card__text,
  .wheel-howto-card--hero .wheel-howto-card__text--inverted {
    font-size: 12px;
    line-height: 15px;
  }
}

.wheel-howto-card__gift {
  position: absolute;
  right: 2px;
  top: 50%;
  transform: translateY(-50%);
  width: 104px;
  height: 96px;
  pointer-events: none;
  z-index: 1;
}

.wheel-howto-card__gift-glow {
  position: absolute;
  width: 84px;
  height: 84px;
  left: 10px;
  top: 6px;
  background: #FDD52A;
  opacity: 0.15;
  filter: blur(10px);
  border-radius: 50%;
  z-index: 1;
  pointer-events: none;
}

@media (max-width: 380px) {
  .wheel-howto-card__gift {
    right: 0;
    width: 92px;
    height: 84px;
  }
  .wheel-howto-card__gift-glow {
    width: 72px;
    height: 72px;
    left: 10px;
    top: 6px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .wheel-howto-card__gift {
    transform: translateY(-50%);
  }
}

.wheel-howto-card__gift-image {
  position: relative;
  width: 100%;
  height: 100%;
  object-fit: contain;
  z-index: 2;
}

.wheel-howto-card__title {
  font-family: 'Montserrat', sans-serif;
  font-weight: 700;
  font-size: 16px;
  color: #1f2933;
  margin: 0 0 8px;
}

.wheel-howto-card__text {
  font-family: 'SF Pro Display', system-ui, sans-serif;
  font-size: 14px;
  color: #5c6470;
  margin: 0;
  line-height: 1.4;
}

.wheel-howto-rarities {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.wheel-howto-rarity {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px 10px;
  border-radius: 6px;
  font-family: 'Montserrat', sans-serif;
  font-weight: 500;
  font-size: 10px;
  line-height: 12px;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: #ffffff;
}

.wheel-howto-rarity--solo {
  grid-column: 1 / -1;
  justify-self: center;
  width: calc(50% - 4px);
}

.wheel-howto-list {
  margin: 12px 0 0;
  padding-left: 20px;
  font-family: 'SF Pro Display', system-ui, sans-serif;
  font-size: 14px;
  color: #5c6470;
  line-height: 1.5;
}
</style>
