<template>
  <div class="smoke-container">
    <div 
      v-for="particle in particles" 
      :key="particle.id"
      class="smoke-particle"
      :style="getParticleStyle(particle)"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

interface Particle {
  id: number
  x: number
  y: number
  size: number
  delay: number
  duration: number
}

interface Props {
  count?: number
  area?: 'top' | 'bottom' | 'left' | 'right' | 'full'
}

const props = withDefaults(defineProps<Props>(), {
  count: 8,
  area: 'full'
})

const particles = ref<Particle[]>([])

function generateParticles() {
  const areaConfig = {
    top: { xRange: [0, 100], yRange: [0, 30] },
    bottom: { xRange: [0, 100], yRange: [70, 100] },
    left: { xRange: [0, 30], yRange: [0, 100] },
    right: { xRange: [70, 100], yRange: [0, 100] },
    full: { xRange: [0, 100], yRange: [0, 100] }
  }

  const config = areaConfig[props.area]
  
  particles.value = Array.from({ length: props.count }, (_, i) => ({
    id: i,
    x: Math.random() * (config.xRange[1] - config.xRange[0]) + config.xRange[0],
    y: Math.random() * (config.yRange[1] - config.yRange[0]) + config.yRange[0],
    size: Math.random() * 80 + 40, // 40-120px
    delay: Math.random() * 3,
    duration: Math.random() * 4 + 3 // 3-7s
  }))
}

function getParticleStyle(particle: Particle) {
  return {
    left: `${particle.x}%`,
    top: `${particle.y}%`,
    width: `${particle.size}px`,
    height: `${particle.size}px`,
    animationDelay: `${particle.delay}s`,
    animationDuration: `${particle.duration}s`
  }
}

onMounted(() => {
  generateParticles()
})
</script>

<style scoped>
.smoke-container {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 0;
}

.smoke-particle {
  position: absolute;
  background: radial-gradient(
    circle,
    rgba(255, 255, 255, 0.15) 0%,
    rgba(255, 255, 255, 0.08) 40%,
    transparent 70%
  );
  border-radius: 50%;
  opacity: 0;
  animation: smoke-rise 4s ease-out infinite;
  filter: blur(8px);
}

@keyframes smoke-rise {
  0% {
    opacity: 0;
    transform: translateY(0) translateX(0) scale(0.8) rotate(0deg);
  }
  20% {
    opacity: 0.3;
  }
  50% {
    opacity: 0.5;
    transform: translateY(-60px) translateX(20px) scale(1.2) rotate(90deg);
  }
  80% {
    opacity: 0.2;
  }
  100% {
    opacity: 0;
    transform: translateY(-120px) translateX(-10px) scale(1.5) rotate(180deg);
  }
}
</style>