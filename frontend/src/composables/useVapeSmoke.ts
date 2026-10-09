import { ref, onMounted, onUnmounted } from 'vue'

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
  timeoutId?: number
}

// Глобальное состояние для переиспользования
let puffIdCounter = 0
const activePuffs = ref<Puff[]>([])
let isInitialized = false

// Performance optimization: Object pool для переиспользования частиц
const particlePool: Particle[] = []
const maxPoolSize = 100

// Лимиты для производительности
const MAX_ACTIVE_PUFFS = 3 // Максимум 3 затяжки одновременно для предотвращения фризов
const MAX_PARTICLES_PER_PUFF = 10 // Уменьшено с 18 до 10
const MAX_PUFF_LIFETIME = 2400 // мс (соответствует ~2.4 секундам)
const MOBILE_PUFF_LIFETIME = 2000 // мс (2 секунды для мобильных устройств)

// Определяем, мобильное ли устройство
const isMobileDevice = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

function getParticleFromPool(): Particle | null {
  return particlePool.pop() || null
}

function returnParticleToPool(particle: Particle) {
  if (particlePool.length < maxPoolSize) {
    particlePool.push(particle)
  }
}

// Генерация частиц с оптимизацией
function generateParticles(count: number = MAX_PARTICLES_PER_PUFF): Particle[] {
  const particles: Particle[] = []
  const now = performance.now()
  
  for (let i = 0; i < count; i++) {
    // Пытаемся взять из pool
    let particle = getParticleFromPool()
    
    if (!particle) {
      particle = {
        id: 0,
        x: 0,
        y: 0,
        offsetX: 0,
        offsetY: 0,
        size: 0,
        duration: 0,
        delay: 0,
        rotation: 0,
        driftX: 0,
        startTime: 0
      }
    }
    
    // Обновляем значения
    particle.id = i
    particle.x = 0
    particle.y = 0
    particle.offsetX = (Math.random() - 0.5) * 35
    particle.offsetY = Math.random() * -15
    particle.size = Math.random() * 40 + 30 // Меньше: 30-70px вместо 40-100px
    // На мобильных устройствах анимация быстрее, чтобы завершиться за 2 секунды
    particle.duration = isMobileDevice 
      ? Math.random() * 0.5 + 0.8 // 0.8-1.3s для мобильных
      : Math.random() * 0.8 + 1.2 // 1.2-2s для десктопа
    particle.delay = isMobileDevice
      ? Math.random() * 0.15 // 0-0.15s для мобильных
      : Math.random() * 0.3 // 0-0.3s для десктопа
    particle.rotation = Math.random() * 360
    particle.driftX = (Math.random() - 0.5) * 120
    particle.startTime = now
    
    particles.push(particle)
  }
  
  return particles
}

// Создание затяжки
function createPuff(x: number, y: number) {
  // На мобильных устройствах удаляем все существующие затяжки перед созданием новой
  if (isMobileDevice && activePuffs.value.length > 0) {
    // Копируем массив для безопасного удаления
    const puffsToRemove = [...activePuffs.value]
    puffsToRemove.forEach(puff => removePuff(puff.id))
  }
  // На десктопе проверяем лимит активных затяжек
  else if (activePuffs.value.length >= MAX_ACTIVE_PUFFS) {
    const oldest = activePuffs.value[0]
    if (oldest) {
      removePuff(oldest.id)
    }
  }
  
  const puff: Puff = {
    id: puffIdCounter++,
    x,
    y,
    particles: generateParticles(),
    timestamp: performance.now()
  }
  
  activePuffs.value.push(puff)

  // Используем меньший timeout для мобильных устройств
  const lifetime = isMobileDevice ? MOBILE_PUFF_LIFETIME : MAX_PUFF_LIFETIME
  puff.timeoutId = window.setTimeout(() => {
    removePuff(puff.id)
  }, lifetime)
}

function removePuff(puffId: number) {
  const index = activePuffs.value.findIndex(puff => puff.id === puffId)

  if (index === -1) {
    return
  }

  const [puff] = activePuffs.value.splice(index, 1)

  if (puff.timeoutId) {
    clearTimeout(puff.timeoutId)
    puff.timeoutId = undefined
  }

  for (const particle of puff.particles) {
    returnParticleToPool(particle)
  }
}

// Throttled click handler для предотвращения spam
let lastClickTime = 0
const clickThrottle = 50 // мс между кликами (уменьшено для лучшей отзывчивости)

function handleClick(event: MouseEvent) {
  const now = performance.now()
  
  if (now - lastClickTime < clickThrottle) {
    return
  }
  
  // Проверяем, находится ли клик внутри элемента с data-no-smoke
  const target = event.target as HTMLElement
  if (target && target.closest('[data-no-smoke]')) {
    return
  }
  
  lastClickTime = now
  createPuff(event.clientX, event.clientY)
}

// Основной composable
export function useVapeSmoke() {
  onMounted(() => {
    if (!isInitialized) {
      window.addEventListener('click', handleClick, { passive: true })
      isInitialized = true
    }
  })
  
  onUnmounted(() => {
    window.removeEventListener('click', handleClick)
    for (const puff of activePuffs.value) {
      if (puff.timeoutId) {
        clearTimeout(puff.timeoutId)
      }

      for (const particle of puff.particles) {
        returnParticleToPool(particle)
      }
    }
    
    // Очистка pool при unmount
    particlePool.length = 0
    activePuffs.value = []
    isInitialized = false
  })
  
  return {
    puffs: activePuffs,
    createPuff
  }
}