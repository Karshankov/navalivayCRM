<template>
  <span ref="display">{{ displayValue }}</span>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'

const props = defineProps<{
  value: number
  duration?: number
}>()

const display = ref<HTMLSpanElement>()
const displayValue = ref(0)

let animationFrame: number | null = null

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
  animateNumber(displayValue.value, newValue, props.duration ?? 600)
}, { immediate: true })

onMounted(() => {
  displayValue.value = props.value
})

onUnmounted(() => {
  cancelAnimation()
})
</script>