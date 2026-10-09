<template>
  <div class="wheel-strip">
    <div class="wheel-strip__viewport" ref="viewportRef">
      <div
        class="wheel-strip__track"
        ref="trackRef"
        :style="{ transform: `translate3d(${currentOffset}px, 0, 0)`, transition: trackTransition }"
      >
        <WheelPrizeCard
          v-for="(prize, index) in displayPrizes"
          :key="`${prize.id}-${index}`"
          :prize="prize"
          class="wheel-strip__card"
          :class="{ 'wheel-strip__card--landed': index === landedIndex }"
        />
      </div>
      <div class="wheel-strip__pointer" aria-hidden="true"></div>
      <div class="wheel-strip__edge wheel-strip__edge--left" aria-hidden="true"></div>
      <div class="wheel-strip__edge wheel-strip__edge--right" aria-hidden="true"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { WheelPrize } from '@/stores/wheel'
import WheelPrizeCard from './WheelPrizeCard.vue'

const props = defineProps<{
  prizes: WheelPrize[]
}>()

const emit = defineEmits<{
  (event: 'animationDone', payload: { prizeId: string }): void
}>()

const CARD_WIDTH = 152
const CARD_GAP = 18
const STEP = CARD_WIDTH + CARD_GAP
const REPEAT = 6
const REST_OFFSET_INDEX = 8

const viewportRef = ref<HTMLElement | null>(null)
const trackRef = ref<HTMLElement | null>(null)
const trackTransition = ref('none')
const currentOffset = ref(0)
const landedIndex = ref(-1)
const displayPrizes = ref<WheelPrize[]>([])
const isRunning = ref(false)
const pendingTimers = new Set<ReturnType<typeof setTimeout>>()

function trackTimer(timer: ReturnType<typeof setTimeout>) {
  pendingTimers.add(timer)
  return timer
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function buildBaseStrip(prizes: WheelPrize[]): WheelPrize[] {
  if (!prizes.length) return []
  const segment: WheelPrize[] = []
  for (let i = 0; i < REPEAT; i += 1) {
    segment.push(...prizes)
  }
  return segment
}

watch(
  () => props.prizes,
  (next) => {
    if (isRunning.value) return
    // S12: also rebuild when the prize pool changes after the first
    // load (e.g. CRM toggled a prize on/off, manager added new prize).
    // Previously the strip locked on the first non-empty array forever.
    if (!next.length) return
    displayPrizes.value = buildBaseStrip(next)
    requestAnimationFrame(() => {
      snapToRest()
    })
  },
  { immediate: true, deep: false },
)

function viewportWidth(): number {
  return viewportRef.value?.offsetWidth || 360
}

function offsetForIndex(index: number): number {
  const cardCenter = index * STEP + CARD_WIDTH / 2
  const viewportCenter = viewportWidth() / 2
  return viewportCenter - cardCenter
}

function snapToRest(prizes: WheelPrize[] = props.prizes) {
  if (!prizes.length) return
  trackTransition.value = 'none'
  const idx = prizes.length * 1 + REST_OFFSET_INDEX
  currentOffset.value = offsetForIndex(idx)
}

function mulberry32(seed: number) {
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let r = t
    r = Math.imul(r ^ (r >>> 15), r | 1)
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

interface SpinAnimationOptions {
  prizeId: string
  seed: number
  durationMs?: number
  prizes?: WheelPrize[]
}

async function runSpin(options: SpinAnimationOptions) {
  const spinPrizes = options.prizes?.length ? [...options.prizes] : [...props.prizes]
  if (!spinPrizes.length) return
  isRunning.value = true
  const rng = mulberry32(options.seed)
  const baseLength = spinPrizes.length
  displayPrizes.value = buildBaseStrip(spinPrizes)

  const targetIndexInPool = spinPrizes.findIndex((prize) => prize.id === options.prizeId)
  if (targetIndexInPool === -1) {
    isRunning.value = false
    throw new Error('spin_prize_missing_from_animation_pool')
  }

  const targetSegment = REPEAT - 2
  const targetIndex = targetSegment * baseLength + targetIndexInPool

  const jitter = (rng() - 0.5) * 24
  const targetOffset = offsetForIndex(targetIndex) + jitter

  trackTransition.value = 'none'
  currentOffset.value = offsetForIndex(REST_OFFSET_INDEX)
  try {
    await new Promise((resolve) => requestAnimationFrame(resolve))
    await new Promise((resolve) => requestAnimationFrame(resolve))

    // S15: respect prefers-reduced-motion. The original cinematic spin is
    // fine for most users but actively unpleasant for people with
    // vestibular sensitivity.
    // CSGO-style suspense: near-linear travel with a sharp stop in the
    // last few hundred ms. The previous easeOut curve felt artificially
    // drawn out because the slowdown started ~30% from the end; this
    // curve keeps the strip flying at constant speed and snaps it to
    // rest only at the very end.
    const reducedMotion = prefersReducedMotion()
    const duration = options.durationMs ?? (reducedMotion ? 800 : 5500)
    const easing = reducedMotion ? 'ease-out' : 'cubic-bezier(0.05, 0.05, 0.15, 1)'
    trackTransition.value = `transform ${duration}ms ${easing}`
    currentOffset.value = targetOffset
    landedIndex.value = -1

    await new Promise<void>((resolve) =>
      trackTimer(setTimeout(resolve, duration + 80)),
    )
    landedIndex.value = targetIndex
    emit('animationDone', { prizeId: options.prizeId })
  } finally {
    isRunning.value = false
  }
}

function reset() {
  landedIndex.value = -1
  snapToRest()
}

onMounted(() => {
  if (props.prizes.length && !displayPrizes.value.length) {
    displayPrizes.value = buildBaseStrip(props.prizes)
  }
  snapToRest()
})

onBeforeUnmount(() => {
  for (const timer of pendingTimers) {
    clearTimeout(timer)
  }
  pendingTimers.clear()
})

defineExpose({ runSpin, reset })
</script>

<style scoped>
.wheel-strip {
  width: 100%;
}

.wheel-strip__viewport {
  position: relative;
  width: 100%;
  height: 214px;
  overflow: hidden;
}

.wheel-strip__track {
  display: flex;
  gap: 18px;
  height: 100%;
  align-items: center;
  will-change: transform;
}

.wheel-strip__card {
  flex: 0 0 152px;
}

.wheel-strip__card--landed {
  transform: none;
  box-shadow: 0 24px 32px rgba(170, 178, 189, 0.12);
  transition: transform 0.4s ease, box-shadow 0.4s ease;
}

.wheel-strip__pointer {
  position: absolute;
  top: 0;
  height: 214px;
  left: 50%;
  width: 2px;
  transform: translateX(-50%);
  background: #f50302;
  pointer-events: none;
  z-index: 2;
  border-radius: 2px;
}

.wheel-strip__pointer::after {
  content: '';
  position: absolute;
  inset: 0;
  left: 50%;
  width: 4px;
  transform: translateX(-50%);
  border-left: 1px solid rgba(245, 3, 2, 0.24);
  border-right: 1px solid rgba(245, 3, 2, 0.24);
}

.wheel-strip__edge {
  /* Hidden — the viewport's mask-image handles the horizontal fade now,
     and these gradient overlays would otherwise paint over the card
     shadows in the centre. */
  display: none;
}

.wheel-strip__edge--left {
  left: 0;
}

.wheel-strip__edge--right {
  right: 0;
}
</style>
