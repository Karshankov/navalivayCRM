<template>
  <div class="wheel-live-feed" aria-label="Последние выигрыши">
    <div v-if="items.length" class="wheel-live-feed__inner">
      <div class="wheel-live-feed__row" :style="{ animationDuration: `${animationSeconds}s` }">
        <div
          v-for="(item, index) in repeated"
          :key="`${item.id}-${index}`"
          class="wheel-live-feed__item"
        >
          <div class="wheel-live-feed__avatar">
            <img v-if="item.photo" :src="item.photo" :alt="item.first_name || 'Гость'" />
            <span v-else>{{ (item.first_name || '?').slice(0, 1).toUpperCase() }}</span>
          </div>
          <div class="wheel-live-feed__copy">
            <p class="wheel-live-feed__line wheel-live-feed__line--name">
              <span>{{ item.first_name || 'Гость' }}{{ item.last_initial ? ` ${item.last_initial}.` : '' }}</span>
              <span class="wheel-live-feed__time">{{ formatRelative(item.spun_at) }}</span>
            </p>
            <p class="wheel-live-feed__line wheel-live-feed__line--prize">
              {{ item.prize_title }}
            </p>
          </div>
          <span
            v-if="item.rarity"
            class="wheel-live-feed__rarity"
            :style="{ background: item.rarity.bgColor, color: item.rarity.textColor }"
          >
            {{ item.rarity.label }}
          </span>
        </div>
      </div>
    </div>
    <div v-else class="wheel-live-feed__empty" role="status">
      <span class="wheel-live-feed__empty-spark" aria-hidden="true">★</span>
      <p class="wheel-live-feed__empty-text">
        Будь первым: крути рулетку и попади в ленту выигрышей
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { WheelFeedItem } from '@/stores/wheel'

const props = defineProps<{
  items: WheelFeedItem[]
}>()

const repeated = computed(() => {
  if (!props.items.length) return []
  return [...props.items, ...props.items]
})

// M3-CR: cap the marquee duration so a feed of ~30 entries doesn't
// produce a 90s+ animation that looks frozen. 60s is roughly 4–5 full
// passes for a typical feed and keeps the motion noticeable.
const animationSeconds = computed(() =>
  Math.min(60, Math.max(20, props.items.length * 3)),
)

// S20: timestamps from the server arrive in two shapes:
//  1. SQLite "YYYY-MM-DD HH:MM:SS" (UTC, no offset) — most common today.
//  2. ISO "...T...Z" or "...T...+03:00" — for legacy / future-proofing.
// Without a timezone, JavaScript treats the SQLite shape as local time
// and produces wrong "10 ч назад"-style relatives. Normalize both into a
// real ISO string before constructing the Date.
function formatRelative(iso: string): string {
  if (!iso) return ''
  const isoNormalized = iso.includes('T')
    ? /[Z+\-]\d{2}:?\d{2}$/.test(iso)
      ? iso
      : `${iso}Z`
    : `${iso.replace(' ', 'T')}Z`
  const date = new Date(isoNormalized)
  const diff = Date.now() - date.getTime()
  if (Number.isNaN(diff) || diff < 0) return 'только что'
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'только что'
  if (minutes < 60) return `${minutes} мин назад`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ч назад`
  const days = Math.floor(hours / 24)
  return `${days} дн назад`
}
</script>

<style scoped>
.wheel-live-feed {
  width: 100%;
  background: #ffffff;
  border-radius: 20px;
  padding: 18px 0;
  overflow: hidden;
}

.wheel-live-feed__inner {
  width: 100%;
  overflow: hidden;
  position: relative;
  mask-image: linear-gradient(
    90deg,
    transparent 0,
    #000 40px,
    #000 calc(100% - 40px),
    transparent 100%
  );
}

.wheel-live-feed__row {
  display: flex;
  gap: 14px;
  width: max-content;
  padding: 0 20px;
  animation-name: wheel-feed-marquee;
  animation-iteration-count: infinite;
  animation-timing-function: linear;
}

.wheel-live-feed__item {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 0;
  background: transparent;
}

.wheel-live-feed__avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: #ECEEF2;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Montserrat', sans-serif;
  font-weight: 600;
  font-size: 14px;
  color: #5C6470;
  overflow: hidden;
  flex-shrink: 0;
}

.wheel-live-feed__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.wheel-live-feed__copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-family: 'SF Pro Display', system-ui, sans-serif;
  white-space: nowrap;
}

.wheel-live-feed__line {
  margin: 0;
  font-size: 14px;
  line-height: 1.25;
}

.wheel-live-feed__line--name {
  color: #1F2933;
  font-weight: 600;
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
}

.wheel-live-feed__line--prize {
  color: #5C6470;
  font-size: 13px;
}

.wheel-live-feed__rarity {
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

.wheel-live-feed__time {
  font-family: 'SF Pro Display', system-ui, sans-serif;
  font-size: 12px;
  color: #9AA0A6;
  font-weight: 400;
}

@keyframes wheel-feed-marquee {
  from {
    transform: translate3d(0, 0, 0);
  }
  to {
    transform: translate3d(-50%, 0, 0);
  }
}

.wheel-live-feed__empty {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
}

.wheel-live-feed__empty-spark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(245, 3, 2, 0.1);
  color: #f50302;
  font-family: 'Montserrat', sans-serif;
  font-weight: 700;
  font-size: 14px;
  flex-shrink: 0;
}

.wheel-live-feed__empty-text {
  margin: 0;
  font-family: 'SF Pro Display', system-ui, sans-serif;
  font-size: 13px;
  color: #5c6470;
  line-height: 1.3;
}

@media (prefers-reduced-motion: reduce) {
  .wheel-live-feed__row {
    animation: none;
  }
}
</style>
