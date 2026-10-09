<template>
  <span>{{ formattedValue }}</span>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'

const props = defineProps<{
  value: number
  duration?: number
}>()

const displayValue = ref(0)
let animationFrame: number | null = null

const formattedValue = computed(() => {
  if (displayValue.value === undefined || displayValue.value === null || Number.isNaN(displayValue.value)) {
    return '—'
  }
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'BYN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(displayValue.value)
})

function animateNumber(start: number, end: number, duration: number) {
  const startTime = Date.now()
  const change = end - start

  function updateValue() {
    const now = Date.now()
    const progress = Math.min((now - startTime) / duration, 1)
    
    // Easing function (ease-out)
    const easedProgress = 1 - Math.pow(1 - progress, 3)
    
    displayValue.value = Math.round(start + change * easedProgress)
    
    if (progress < 1) {
      animationFrame = requestAnimationFrame(updateValue)
    }
  }
  
  updateValue()
}

function cancelAnimation() {
  if (animationFrame) {
    cancelAnimationFrame(animationFrame)
    animationFrame = null
  }
}

watch(() => props.value, (newValue) => {
  cancelAnimation()
  animateNumber(displayValue.value, newValue || 0, props.duration ?? 600)
}, { immediate: true })

onMounted(() => {
  displayValue.value = props.value || 0
})

onUnmounted(() => {
  cancelAnimation()
})
</script>