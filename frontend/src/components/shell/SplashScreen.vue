<template>
  <!-- Монтируется/размонтируется через v-if в App.vue; Transition на
       корне ловит только фазу leave (появление мгновенное). -->
  <Transition name="splash-out" appear>
    <div class="splash-screen" aria-label="Загрузка приложения">
      <!-- Вейп-череп: фирменный лого в минималистичном контуре -->
      <div class="splash-screen__logo">
        <svg viewBox="0 0 120 120" fill="none" class="splash-skull">
          <!-- Череп -->
          <path
            class="splash-skull__bone"
            d="M60 14C36 14 22 30 22 50C22 60 26 66 30 70L32 84C32 90 36 94 42 94H46V102C46 105 48 107 51 107H69C72 107 74 105 74 102V94H78C84 94 88 90 88 84L90 70C94 66 98 60 98 50C98 30 84 14 60 14Z"
            stroke="currentColor"
            stroke-width="4"
            stroke-linejoin="round"
            fill="none"
          />
          <!-- Глаза -->
          <ellipse class="splash-skull__eye" cx="45" cy="52" rx="9" ry="11" fill="currentColor" />
          <ellipse class="splash-skull__eye" cx="75" cy="52" rx="9" ry="11" fill="currentColor" />
          <!-- Зубы -->
          <path
            class="splash-skull__teeth"
            d="M52 80V94M60 80V96M68 80V94"
            stroke="currentColor"
            stroke-width="3"
            stroke-linecap="round"
          />
          <!-- Нос -->
          <path
            class="splash-skull__nose"
            d="M60 60L56 70H64L60 60Z"
            fill="currentColor"
          />
        </svg>

        <!-- Струи пара из глаз -->
        <div class="splash-screen__smoke">
          <span class="splash-smoke splash-smoke--1"></span>
          <span class="splash-smoke splash-smoke--2"></span>
          <span class="splash-smoke splash-smoke--3"></span>
        </div>
      </div>

      <div class="splash-screen__brand">
        <span class="splash-screen__name">NAVALIVAY</span>
      </div>

      <!-- Прогресс предзагрузки -->
      <div class="splash-screen__progress">
        <div class="splash-progress-track">
          <div
            class="splash-progress-fill"
            :style="{ width: `${progressPercent}%` }"
          ></div>
        </div>
        <span class="splash-progress-label">{{ progressLabel }}</span>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    /** 0..100 */
    progress?: number;
    progressLabel?: string;
  }>(),
  {
    progress: 0,
    progressLabel: "Загружаем каталог...",
  },
);

const progressPercent = computed(() => Math.min(100, Math.max(0, props.progress)));
</script>

<style scoped>
.splash-screen {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 28px;
  background: #f5f7fa;
  padding-bottom: 10vh;
}

/* Исчезновение сплэша: лёгкий fade + scale */
.splash-out-leave-active {
  transition: opacity 0.45s ease, transform 0.45s ease;
}

.splash-out-leave-to {
  opacity: 0;
  transform: scale(1.04);
}

.splash-screen__logo {
  position: relative;
  width: 120px;
  height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.splash-skull {
  width: 120px;
  height: 120px;
  color: #191919;
}

/* Пульсация черепа */
.splash-skull__bone {
  animation: skull-glow 2.4s ease-in-out infinite;
  transform-origin: 60px 60px;
}

@keyframes skull-glow {
  0%,
  100% {
    opacity: 0.85;
  }
  50% {
    opacity: 1;
  }
}

/* Мигающие глаза */
.splash-skull__eye {
  animation: eye-blink 3.2s ease-in-out infinite;
}

.splash-skull__eye:nth-child(2) {
  animation-delay: 0.12s;
}

@keyframes eye-blink {
  0%,
  92%,
  100% {
    transform: scaleY(1);
  }
  95% {
    transform: scaleY(0.1);
  }
}

/* Пар: три струи поднимаются и растворяются */
.splash-screen__smoke {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.splash-smoke {
  position: absolute;
  bottom: 18px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(25, 25, 25, 0.16), rgba(25, 25, 25, 0));
  filter: blur(3px);
  opacity: 0;
  animation: smoke-rise 2.8s ease-out infinite;
}

.splash-smoke--1 {
  left: 32px;
  animation-delay: 0s;
}

.splash-smoke--2 {
  left: 54px;
  animation-delay: 0.9s;
}

.splash-smoke--3 {
  left: 76px;
  animation-delay: 1.8s;
}

@keyframes smoke-rise {
  0% {
    transform: translateY(0) scale(0.5);
    opacity: 0;
  }
  15% {
    opacity: 0.7;
  }
  100% {
    transform: translateY(-64px) scale(2.6);
    opacity: 0;
  }
}

.splash-screen__brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.splash-screen__name {
  font-size: 24px;
  font-weight: 800;
  letter-spacing: 0.14em;
  color: #191919;
}

.splash-screen__progress {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  width: 200px;
}

.splash-progress-track {
  width: 100%;
  height: 3px;
  border-radius: 2px;
  background: rgba(25, 25, 25, 0.08);
  overflow: hidden;
}

.splash-progress-fill {
  height: 100%;
  border-radius: 2px;
  background: #191919;
  transition: width 0.3s ease;
}

.splash-progress-label {
  font-size: 12px;
  color: #7b8794;
  letter-spacing: 0.02em;
}

@media (prefers-reduced-motion: reduce) {
  .splash-skull__bone,
  .splash-skull__eye,
  .splash-smoke {
    animation: none;
  }

  .splash-smoke {
    opacity: 0.4;
  }
}
</style>
