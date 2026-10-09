<template>
  <div class="vape-smoke-container">
    <div 
      v-for="puff in puffs" 
      :key="puff.id"
      class="vape-puff"
      :style="getPuffStyle(puff)"
    >
      <div 
        v-for="particle in puff.particles" 
        :key="particle.id"
        class="smoke-particle"
      :style="getParticleStyle(particle)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useVapeSmoke } from '@/composables/useVapeSmoke'

interface Particle {
  id: number
  x: number
  y: number
  offsetX: number
  offsetY: number
  size: number
  duration: number
  delay: number
  rotation: number
  driftX: number
  startTime: number
}

interface Puff {
  id: number
  x: number
  y: number
  particles: Particle[]
  timestamp: number
}

// Используем оптимизированный composable
const { puffs, createPuff } = useVapeSmoke()

function getPuffStyle(puff: Puff) {
  return {
    left: `${puff.x}px`,
    top: `${puff.y}px`
  }
}

function getParticleStyle(particle: Particle) {
  return {
    width: `${particle.size}px`,
    height: `${particle.size}px`,
    animationDuration: `${particle.duration}s`,
    animationDelay: `${particle.delay}s`,
    // Центрируем частицу относительно точки клика
    left: `${-particle.size / 2}px`,
    top: `${-particle.size / 2}px`,
    transform: `translate(${particle.offsetX}px, ${particle.offsetY}px) rotate(${particle.rotation}deg)`,
    '--drift-x': `${particle.driftX}px`
  }
}

// Экспортируем для внешнего использования
defineExpose({
  createPuff
})
</script>

<style scoped>
.vape-smoke-container {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9999;
  overflow: hidden;
}

.vape-puff {
  position: absolute;
  pointer-events: none;
}

.smoke-particle {
  position: absolute;
  background: radial-gradient(
    circle,
    rgba(240, 240, 245, 0.85) 0%,
    rgba(220, 220, 230, 0.6) 30%,
    rgba(200, 200, 220, 0.3) 60%,
    transparent 100%
  );
  border-radius: 50%;
  opacity: 0;
  animation: vape-smoke-rise cubic-bezier(0.33, 0.66, 0.66, 1) forwards;
  filter: blur(10px);
  mix-blend-mode: screen;
  will-change: transform;
  /* Performance: использовать GPU compositing */
  transform: translateZ(0);
  backface-visibility: hidden;
  -webkit-font-smoothing: antialiased;
  /* Центрирование через transform-origin */
  transform-origin: center center;
}

@keyframes vape-smoke-rise {
  0% {
    opacity: 0;
    transform: translate(0, 0) scale(0.6) rotate(0deg);
  }
  
  10% {
    opacity: 0.85;
  }
  
  30% {
    opacity: 0.7;
    transform: translate(calc(var(--drift-x, 0) * 0.5), -60px) scale(1) rotate(60deg);
  }
  
  60% {
    opacity: 0.4;
    transform: translate(calc(var(--drift-x, 0) * 1.2), -140px) scale(1.8) rotate(140deg);
  }
  
  100% {
    opacity: 0;
    transform: translate(calc(var(--drift-x, 0) * 1.8), -220px) scale(2.5) rotate(220deg);
  }
}

/* Альтернативная анимация для более густого дыма */
@keyframes vape-smoke-dense {
  0% {
    opacity: 0;
    transform: translate(0, 0) scale(0.5);
  }
  
  15% {
    opacity: 1;
  }
  
  50% {
    opacity: 0.8;
    transform: translate(var(--drift-x, 0), -120px) scale(1.8);
  }
  
  100% {
    opacity: 0;
    transform: translate(calc(var(--drift-x, 0) * 1.8), -240px) scale(3);
  }
}
</style>