<template>
  <div
    class="wheel-prize-card"
    :class="{
      'wheel-prize-card--exhausted': prize.is_exhausted,
      'wheel-prize-card--nothing': prize.rarity?.code === 'nothing',
    }"
    :style="cardStyle"
  >
    <div
      class="wheel-prize-card__image"
      :class="{ 'wheel-prize-card__image--photo': prize.image_url && !imgFailed }"
      :style="{ background: imageBackground }"
    >
      <img
        v-if="prize.image_url && !imgFailed"
        :src="prize.image_url"
        :alt="prize.title"
        class="wheel-prize-card__img"
        @error="onImageError"
      />
      <div
        v-else
        class="wheel-prize-card__icon-default"
        :style="defaultIconStyle"
        role="img"
        :aria-label="prize.title"
      ></div>
    </div>
    <div
      v-if="prize.rarity"
      class="wheel-prize-card__rarity"
      :style="{
        background: prize.rarity.bgColor,
        color: prize.rarity.textColor,
      }"
    >
      {{ prize.rarity.label }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { WheelPrize } from '@/stores/wheel'
import defaultPrizeImage from '@/assets/wheel-default-prize.png'

const props = defineProps<{
  prize: WheelPrize
}>()

const imgFailed = ref(false)

function onImageError() {
  imgFailed.value = true
}

watch(
  () => props.prize.image_url,
  () => {
    imgFailed.value = false
  },
)

// CSS `border-color` does not accept gradient values, but `bg_color` from
// the wheel_rarities table can now be a `linear-gradient(...)` string.
// Pull the first hex out of the gradient as a sensible solid border —
// otherwise Vue silently drops the invalid value and the card loses its
// rarity-tinted border entirely.
function extractFirstHex(value: string | undefined | null): string {
  if (!value) return '#E2E5EA'
  const match = value.match(/#([0-9a-fA-F]{3}){1,2}\b/)
  return match ? match[0] : value
}

const borderColor = computed(() => {
  if (props.prize.rarity?.code === 'nothing') return '#E2E5EA'
  return extractFirstHex(props.prize.rarity?.bgColor)
})

const cardStyle = computed(() => {
  // Match Figma reference: clean white background. Rarity shows through
  // the colored border and the chip — no tinted backdrop on the card body.
  return {
    borderColor: borderColor.value,
    background: '#FFFFFF',
  }
})

const imageBackground = computed(() => 'transparent')

const defaultIconStyle = computed(() => {
  const tint = extractFirstHex(props.prize.rarity?.bgColor)
  return {
    backgroundColor: tint,
    '--wheel-default-prize-image': `url('${defaultPrizeImage}')`,
  }
})
</script>

<style scoped>
.wheel-prize-card {
  position: relative;
  width: 152px;
  flex: 0 0 152px;
  height: 152px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  border-radius: 24px;
  background: #ffffff;
  border: 2.5px solid #e6e9ed;
  box-shadow: 0 24px 32px rgba(170, 178, 189, 0.12);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.wheel-prize-card--exhausted {
  /* Intentionally no visual changes: prizes that ran out of stock should
     still look bright on the strip. Customers should not realise something
     is "out" — that's an internal/business concern, not a UX signal. */
}

.wheel-prize-card__image {
  position: relative;
  width: 90%;
  height: 90%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: auto;
}

.wheel-prize-card__image--photo {
  position: absolute;
  inset: 0;
  width: auto;
  height: auto;
  overflow: hidden;
  border-radius: 21px;
  margin: 0;
}

.wheel-prize-card__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: drop-shadow(0 10px 14px rgba(15, 23, 42, 0.1));
}

.wheel-prize-card__icon-default {
  width: 100%;
  height: 100%;
  aspect-ratio: 1 / 1;
  background-color: var(--wheel-default-prize-tint, #9aa0a6);
  -webkit-mask-image: var(--wheel-default-prize-image);
  mask-image: var(--wheel-default-prize-image);
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
}

.wheel-prize-card__rarity {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: absolute;
  /* Chip overhangs the bottom edge of the card, half above and half below,
     matching Figma reference 19:442 / 1:120. */
  bottom: -9px;
  left: 50%;
  transform: translateX(-50%);
  min-width: 86px;
  min-height: 18px;
  padding: 4px 10px;
  border-radius: 6px;
  font-family: 'Montserrat', sans-serif;
  font-weight: 500;
  font-size: 8px;
  line-height: 10px;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: #ffffff;
  white-space: nowrap;
  z-index: 2;
}

/* "Nothing" rarity already ships with #8D8D8D bg + white text from the
   DB — we just guard against the previous override that forced a light
   grey chip with dark text. */
.wheel-prize-card--nothing .wheel-prize-card__rarity {
  background: #8D8D8D;
  color: #ffffff;
}
</style>
