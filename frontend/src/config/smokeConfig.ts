/**
 * Конфигурация эффекта дыма вейпа
 * 
 * Настройте эти параметры для балансировки качества и производительности
 */

export interface SmokeConfig {
  // Лимиты производительности
  maxActivePuffs: number        // Максимум затяжек одновременно
  maxParticlesPerPuff: number   // Частиц на затяжку
  
  // Throttling
  clickThrottle: number         // Минимальная задержка между кликами (мс)
  
  // Lifecycle
  puffLifetime: number          // Время жизни затяжки (мс)
  
  // Object Pool
  maxPoolSize: number           // Размер pool для переиспользования
  
  // Визуальные параметры
  particleSize: {
    min: number
    max: number
  }
  particleDuration: {
    min: number
    max: number
  }
  particleDelay: {
    min: number
    max: number
  }
  drift: number                 // Горизонтальное смещение (±px)
  spread: {
    x: number                   // Начальный разброс по X
    y: number                   // Начальный разброс по Y
  }
}

// Пресеты производительности

/** Максимальная производительность (слабые устройства, 30-45 FPS) */
export const PERFORMANCE_MODE: SmokeConfig = {
  maxActivePuffs: 5,
  maxParticlesPerPuff: 6,
  clickThrottle: 150,
  puffLifetime: 2000,
  maxPoolSize: 50,
  particleSize: { min: 25, max: 50 },
  particleDuration: { min: 1, max: 1.5 },
  particleDelay: { min: 0, max: 0.2 },
  drift: 80,
  spread: { x: 25, y: 10 }
}

/** Сбалансированный режим (средние устройства, 45-60 FPS) */
export const BALANCED_MODE: SmokeConfig = {
  maxActivePuffs: 8,
  maxParticlesPerPuff: 10,
  clickThrottle: 100,
  puffLifetime: 2500,
  maxPoolSize: 100,
  particleSize: { min: 30, max: 70 },
  particleDuration: { min: 1.2, max: 2 },
  particleDelay: { min: 0, max: 0.3 },
  drift: 100,
  spread: { x: 35, y: 15 }
}

/** Максимальное качество (мощные устройства, стабильные 60 FPS) */
export const QUALITY_MODE: SmokeConfig = {
  maxActivePuffs: 12,
  maxParticlesPerPuff: 18,
  clickThrottle: 50,
  puffLifetime: 3000,
  maxPoolSize: 150,
  particleSize: { min: 40, max: 100 },
  particleDuration: { min: 1.5, max: 2.5 },
  particleDelay: { min: 0, max: 0.4 },
  drift: 120,
  spread: { x: 40, y: 20 }
}

// Автоопределение режима по производительности устройства
function detectDevicePerformance(): SmokeConfig {
  // Проверяем количество ядер
  const cores = navigator.hardwareConcurrency || 4
  
  // Проверяем мобильное устройство
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  
  // Проверяем память (если доступно)
  const memory = (navigator as any).deviceMemory || 4 // GB
  
  if (isMobile || cores <= 4 || memory <= 4) {
    return PERFORMANCE_MODE
  } else if (cores <= 8 || memory <= 8) {
    return BALANCED_MODE
  } else {
    return QUALITY_MODE
  }
}

// Экспорт текущей конфигурации
export const currentConfig: SmokeConfig = detectDevicePerformance()

// Для ручной настройки - раскомментируйте нужный режим:
// export const currentConfig: SmokeConfig = PERFORMANCE_MODE
// export const currentConfig: SmokeConfig = BALANCED_MODE
// export const currentConfig: SmokeConfig = QUALITY_MODE