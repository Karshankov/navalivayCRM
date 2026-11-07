<template>
  <div class="home-shortcuts" aria-label="Быстрые разделы">
    <button
      class="home-shortcuts__item"
      type="button"
      aria-label="Открыть избранное"
      @click="openFavorites"
    >
      <span class="home-shortcuts__tile">
        <img
          class="home-shortcuts__art"
          src="/shortcuts/favorites-art.png"
          alt=""
          loading="lazy"
          decoding="async"
        />
      </span>
      <span class="home-shortcuts__label">Избранное</span>
    </button>

    <!-- Декоративная кнопка: раздел «Часто покупают» в разработке,
         функционала пока нет — визуально полноценная плитка. -->
    <span
      class="home-shortcuts__item home-shortcuts__item--placeholder"
      role="img"
      aria-label="Часто покупают — скоро будет доступно"
    >
      <span class="home-shortcuts__tile">
        <img
          class="home-shortcuts__art"
          src="/shortcuts/bag.png"
          alt=""
          loading="lazy"
          decoding="async"
        />
      </span>
      <span class="home-shortcuts__label">Часто покупают</span>
    </span>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'

/**
 * Пара компактных плиток над сеткой категорий на главной
 * (по демо-образцу navalivay-home-shortcuts.html):
 * «Избранное» — рабочий переход, «Часто покупают» — заглушка
 * без функционала. Шрифты и размеры — из дизайн-системы проекта
 * (Montserrat для подписей, как у кнопки избранного), а не из демо.
 */
const router = useRouter()

function openFavorites() {
  router.push({ name: 'favorites' })
}
</script>

<style scoped>
.home-shortcuts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin: 0 0 20px;
}

.home-shortcuts__item {
  display: block;
  min-width: 0;
  padding: 0;
  border: 0;
  background: none;
  text-align: center;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  appearance: none;
}

.home-shortcuts__item:focus-visible {
  outline: 3px solid #ed0000;
  outline-offset: 4px;
  border-radius: 18px;
}

.home-shortcuts__item--placeholder {
  cursor: default;
}

.home-shortcuts__tile {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 58px;
  border-radius: 18px;
  background: #ffffff;
  overflow: hidden;
  transition: transform 0.2s ease;
}

.home-shortcuts__item:active .home-shortcuts__tile {
  transform: scale(0.98);
}

.home-shortcuts__art {
  display: block;
  max-width: calc(100% - 14px);
  max-height: 46px;
  object-fit: contain;
}

.home-shortcuts__label {
  display: block;
  margin-top: 8px;
  /* 1в1 с подписями категорий на главной (.category-card-title):
     тот же Montserrat/600/12px и чёрный цвет. */
  font-family: "Montserrat", sans-serif;
  font-size: 12px;
  font-weight: 600;
  line-height: 15px;
  letter-spacing: 0.008em;
  text-align: center;
  color: #000000;
}

@media (max-width: 393px) {
  .home-shortcuts__label {
    font-size: 11px;
    line-height: 14px;
  }
}

@media (max-width: 350px) {
  .home-shortcuts {
    gap: 12px;
  }

  .home-shortcuts__tile {
    height: 52px;
    border-radius: 16px;
  }

  .home-shortcuts__art {
    max-height: 42px;
  }

  .home-shortcuts__label {
    font-size: 11px;
    line-height: 14px;
  }
}

@media (max-width: 320px) {
  .home-shortcuts__label {
    font-size: 10px;
    line-height: 13px;
  }
}
</style>
