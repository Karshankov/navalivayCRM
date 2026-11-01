<template>
  <!-- Заглушка недоступного сервера: 1в1 с макетом error-404.html.
       Иллюстрация лежит локально (public/img), поэтому загрузится даже
       когда API лежит. «404» в глазах — flicker-анимация как в макете,
       правый глаз со сдвигом фазы. Кнопка «Попробовать снова» —
       прозрачная зона поверх красной кнопки на картинке. -->
  <main class="offline-page" aria-label="Сайт сделал плотную затяжку и умер. Выключите VPN или просто подождите — возможно, мы что-то чиним">
    <svg viewBox="0 0 864 1821" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <clipPath id="eye-l">
          <ellipse cx="356" cy="696" rx="17" ry="27" transform="rotate(26 356 696)" />
        </clipPath>
        <clipPath id="eye-r">
          <ellipse cx="429" cy="705" rx="27" ry="29" />
        </clipPath>
      </defs>
      <image width="864" height="1821" href="/img/error-offline.webp" />
      <g clip-path="url(#eye-l)">
        <text class="digits" x="356" y="696" font-size="12" transform="rotate(-18 356 696)">404</text>
      </g>
      <g clip-path="url(#eye-r)">
        <text class="digits right" x="429" y="705" font-size="18" transform="rotate(8 429 705)">404</text>
      </g>
    </svg>
    <button aria-label="Попробовать снова" @click="reload" />
  </main>
</template>

<script setup lang="ts">
function reload() {
  // Как в макете: полная перезагрузка приложения.
  window.location.reload();
}
</script>

<style scoped>
.offline-page {
  position: relative;
  width: 100%;
  max-width: 480px;
  margin: 0 auto;
  min-height: 100vh;
  background: white;
  /* Не даём прокрутке уехать: заглушка — весь экран. */
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.offline-page svg {
  display: block;
  width: 100%;
  height: auto;
  overflow: hidden;
}

.digits {
  fill: #ff2020;
  font-family: monospace;
  font-weight: 700;
  text-anchor: middle;
  dominant-baseline: central;
  filter: drop-shadow(0 0 2px #f00);
  animation: flicker 3.8s infinite;
}

.right {
  animation-delay: -1.3s;
}

@keyframes flicker {
  0%, 100% { opacity: .95; }
  15% { opacity: .65; }
  18%, 43% { opacity: 1; }
  46% { opacity: .25; }
  49%, 76% { opacity: 1; }
  79% { opacity: .5; }
  83% { opacity: 1; }
}

.offline-page button {
  position: absolute;
  left: 10.3%;
  top: 84.3%;
  width: 79.5%;
  height: 6.7%;
  background: transparent;
  border: 0;
  border-radius: 100px;
  cursor: pointer;
}

.offline-page button:focus-visible {
  outline: 3px solid #222;
  outline-offset: 4px;
}

@media (prefers-reduced-motion: reduce) {
  .digits {
    animation: none;
  }
}
</style>
