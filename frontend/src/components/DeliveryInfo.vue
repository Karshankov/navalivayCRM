<template>
  <div class="delivery-section">
    <!-- Черная полоса-заголовок -->
    <div class="section-header-navalivay grunge-texture">
      <ExplosionIcon :size="32" animated color="#d32f2f" highlight-color="#ef5350" />
      <h2 class="navalivay-title" style="color: white; font-size: var(--text-2xl); margin: 0;">НАША ДОСТАВКА</h2>
    </div>
    
    <!-- Серые карточки -->
    <div class="delivery-cards">
      <!-- Заказ от минимальной суммы (показываем только если есть минимум) -->
      <div v-if="hasMinDeliveryAmount" class="card-navalivay-dark">
        <div class="card-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M13 10V3L4 14h7v7l9-11h-7z" fill="currentColor"/>
          </svg>
        </div>
        <div class="card-content">
          <p class="card-title">Заказ от <span class="navalivay-text-red">{{ minDeliveryAmount }} BYN</span></p>
          <p class="card-subtitle">минимальная сумма для доставки</p>
        </div>
      </div>
      
      <!-- Без минимальной суммы -->
      <div v-else class="card-navalivay-dark">
        <div class="card-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M13 10V3L4 14h7v7l9-11h-7z" fill="currentColor"/>
          </svg>
        </div>
        <div class="card-content">
          <p class="card-title"><span class="navalivay-text-red">Без минимальной суммы</span></p>
          <p class="card-subtitle">доставим заказ любой суммы</p>
        </div>
      </div>
      
      <!-- В день заказа -->
      <div class="card-navalivay-dark">
        <div class="card-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
            <path d="M12 6v6l4 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </div>
        <div class="card-content">
          <p class="card-title">В день заказа</p>
          <p class="card-subtitle">
            доставим в интервале<br>
            с <span class="navalivay-text-red">12:00</span> до <span class="navalivay-text-red">21:00</span><br>
            к указанному адресу
          </p>
        </div>
      </div>
      
      <!-- Предупреждение о времени -->
      <div class="card-navalivay-dark card-warning">
        <div class="card-icon warning-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L2 20h20L12 2z" stroke="#ffd700" stroke-width="2" stroke-linejoin="round"/>
            <path d="M12 9v4M12 17h.01" stroke="#ffd700" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </div>
        <div class="card-content">
          <h3 class="warning-title">Заказы на доставку</h3>
          <p class="card-subtitle">
            Принимаем с <span class="navalivay-text-red">08:00</span> до <span class="navalivay-text-red">20:00</span>, 
            если заказ сделан позже переносим на следующий день.
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import ExplosionIcon from './icons/ExplosionIcon.vue'
import { useSettingsStore } from '@/stores/settings'

const settingsStore = useSettingsStore()

// Минимальная сумма для доставки из настроек (реальное значение, без hardcoded fallback)
const minDeliveryAmount = computed(() => {
  const val = parseFloat(settingsStore.settings.min_delivery_amount || '0')
  return isNaN(val) ? 0 : val
})

// Есть ли минимальная сумма для доставки
const hasMinDeliveryAmount = computed(() => {
  return minDeliveryAmount.value > 0
})

onMounted(() => {
  // Загружаем настройки если ещё не загружены
  if (!settingsStore.settings.min_delivery_amount) {
    settingsStore.fetchSettings()
  }
})
</script>

<style scoped>
.delivery-section {
  max-width: 1200px;
  margin: 3rem auto;
  padding: 0 1rem;
}

.delivery-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 1.5rem;
}

.card-navalivay-dark {
  display: flex;
  align-items: flex-start;
  gap: 1.5rem;
  position: relative;
  overflow: hidden;
  transition: all 0.3s ease;
}

.card-navalivay-dark:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);
}

.card-warning {
  grid-column: span 2;
}

@media (max-width: 768px) {
  .card-warning {
    grid-column: span 1;
  }
  
  .delivery-cards {
    grid-template-columns: 1fr;
  }
}

.card-icon {
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  color: var(--navalivay-white);
  display: flex;
  align-items: center;
  justify-content: center;
}

.warning-icon {
  animation: pulse-warning 2s ease-in-out infinite;
}

@keyframes pulse-warning {
  0%, 100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.1);
  }
}

.card-content {
  flex: 1;
}

.card-title {
  font-family: var(--font-body);
  font-size: var(--text-lg);
  font-weight: 700;
  color: var(--navalivay-white);
  margin: 0 0 0.5rem 0;
  text-transform: none;
}

.card-subtitle {
  font-family: var(--font-body);
  font-size: var(--text-sm);
  color: var(--navalivay-light-gray);
  margin: 0;
  line-height: 1.6;
}

.warning-title {
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: 900;
  color: var(--navalivay-white);
  margin: 0 0 0.5rem 0;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* Добавляем текстуру на карточки */
.card-navalivay-dark::before {
  content: '';
  position: absolute;
  inset: 0;
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Cfilter id='noise'%3E%3CfeTurbulence baseFrequency='0.7' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.03'/%3E%3C/svg%3E");
  pointer-events: none;
  opacity: 0.5;
}
</style>