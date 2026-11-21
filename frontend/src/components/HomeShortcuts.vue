<template>
  <div class="home-shortcuts" aria-label="Быстрые разделы">
    <!-- Плитка «Скидки» из navalivay-discounts-component.html.
         Только вёрстка: обработчиков, переходов и загрузки данных нет.
         Счётчик подготовлен, но скрыт через hidden — подключим вместе
         с реальным количеством товаров со скидкой. -->
    <button class="nvl-discounts" type="button">
      <span class="nvl-discounts__picture">
        <img
          class="nvl-discounts__art"
          src="/shortcuts/discounts-art.png"
          alt=""
          loading="lazy"
          decoding="async"
        />
      </span>
      <span class="nvl-discounts__count" hidden aria-label="4 товара со скидкой">4</span>
      <span class="nvl-discounts__label">Скидки</span>
    </button>

    <button
      class="home-shortcuts__item home-shortcuts__item--favorites"
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

    <!-- Декоративная плитка «Баланс кэшбэка»: визуал из отдельного
         HTML-прототипа. Пока не интерактивная — логику подключим позже. -->
    <div
      class="home-shortcuts__item home-shortcuts__item--cashback"
      role="img"
      aria-label="Баланс кэшбэка, 15 BYN"
    >
      <span class="home-shortcuts__cashback-panel">
        <span class="home-shortcuts__cashback-amount"><b>15</b><small>BYN</small></span>
        <span class="r-coin r-coin--cashback">
          <img
            class="r-coin__image"
            src="/shortcuts/cashback-coin.png"
            alt=""
            width="1024"
            height="1024"
            loading="lazy"
            decoding="async"
          />
        </span>
      </span>
      <span class="home-shortcuts__label">Баланс кэшбэка</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'

/**
 * Пара компактных плиток над сеткой категорий на главной
 * (по демо-образцу navalivay-home-shortcuts.html):
 * «Избранное» — рабочий переход, «Баланс кэшбэка» — декоративный
 * баланс из прототипа без обработчика, пока не готова логика.
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

/* ===== Плитка «Скидки» =====
   Перенесено из navalivay-discounts-component.html (блок
   BEGIN/END COMPONENT STYLES). Единственное отступление от
   исходника: цвет выреза счётчика берётся из токена фона страницы,
   а не из #f4f5fa предпросмотра, иначе ореол вокруг счётчика
   не совпал бы с фоном главной. */
.nvl-discounts {
  --nvl-badge-cutout: var(--customer-bg, #f5f7fa);
  position: relative;
  display: block;
  width: 100%;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  color: #080a0b;
  font: inherit;
  text-align: center;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  box-sizing: border-box;
}

.nvl-discounts__picture {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
  width: 100%;
  aspect-ratio: 3.03;
  background: #fff;
  border-radius: 19px;
}

.nvl-discounts__art {
  display: block;
  width: 96%;
  height: 90%;
  object-fit: contain;
  pointer-events: none;
  user-select: none;
}

/* Подпись — 1в1 с соседними плитками (.home-shortcuts__label):
   Montserrat / 600 / 12px, как и было в исходном компоненте плитки
   отличалось (13px / 650), из-за чего «Скидки» выбивались из ряда. */
.nvl-discounts__label {
  display: block;
  margin-top: 8px;
  font-family: "Montserrat", sans-serif;
  font-size: 12px;
  font-weight: 600;
  line-height: 15px;
  letter-spacing: 0.008em;
  text-align: center;
  color: #000000;
}

.nvl-discounts__count {
  position: absolute;
  top: -7px;
  right: -5px;
  z-index: 2;
  display: grid;
  place-items: center;
  width: 25px;
  height: 25px;
  box-sizing: content-box;
  border: 3px solid var(--nvl-badge-cutout);
  border-radius: 50%;
  background: linear-gradient(145deg, #ff4035, #c51214);
  color: #fff;
  box-shadow: 0 3px 7px #bc14151c;
  font-size: 13px;
  font-weight: 750;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}

/* Счётчик подготовлен, но скрыт. Не снимать hidden до подключения
   реальных данных. */
.nvl-discounts__count[hidden] {
  display: none !important;
}

.nvl-discounts:focus-visible {
  outline: 2px solid #cf2020;
  outline-offset: 5px;
  border-radius: 19px;
}

@media (max-width: 350px) {
  .nvl-discounts__label {
    font-size: 11px;
    line-height: 14px;
  }
}
/* ===== /Плитка «Скидки» ===== */

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

/* Раскладка трёх плиток:
     Скидки   | (пусто)
     Избранное | Баланс кэшбэка
   «Скидки» занимает верхнюю ячейку, под ней в левой колонке —
   «Избранное», в правой нижней — баланс кэшбэка. Позиции заданы
   явно: авторазмещение ставило «Избранное» в правый верх, а баланс
   уводило в левый низ. */
.home-shortcuts__item--favorites {
  grid-column: 1;
  grid-row: 2;
}

.home-shortcuts__item--cashback {
  grid-column: 2;
  grid-row: 2;
}

.home-shortcuts__cashback-panel {
  position: relative;
  display: flex;
  align-items: center;
  height: 58px;
  padding: 0 10px;
  overflow: hidden;
  isolation: isolate;
  border-radius: 18px;
  background: radial-gradient(ellipse at 85% 95%, #eeeef1, transparent 62%), #ffffff;
}

.home-shortcuts__cashback-amount {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: baseline;
  gap: 3px;
  white-space: nowrap;
  color: #383a40;
  font-family: system-ui, -apple-system, sans-serif;
}

.home-shortcuts__cashback-amount b {
  position: relative;
  z-index: 1;
  font-size: 40px;
  font-weight: 900;
  line-height: 0.9;
  letter-spacing: -2.7px;
}

.home-shortcuts__cashback-amount b::before {
  content: "15";
  position: absolute;
  z-index: -1;
  left: 65%;
  top: 50%;
  color: #dfe1e5;
  font-size: 72px;
  font-weight: 900;
  line-height: 0.9;
  letter-spacing: -4px;
  opacity: 0.45;
  pointer-events: none;
  transform: translate(-50%, -50%);
  white-space: nowrap;
}

.home-shortcuts__cashback-amount small {
  position: relative;
  z-index: 2;
  align-self: flex-end;
  margin-bottom: 2px;
  color: #666b75;
  font-size: 8px;
  font-weight: 650;
  line-height: 1;
}

/* Монета кэшбэка (cashback-coin.html) вместо бирки.
   Кошелёк и бирка сохранены в public/shortcuts/_backup/ — вернуть
   одним копированием (см. комментарий у .home-shortcuts__cashback-panel).

   Сам элемент из исходника — .r-coin / .r-coin__image. В исходнике
   размер задаётся переменной --coin-size; здесь её роль играет
   height и absolute-позиция внутри панели баланса. */
.r-coin {
  display: inline-block;
  width: var(--coin-size, 160px);
  max-width: 100%;
  aspect-ratio: 1;
  vertical-align: middle;
}

.r-coin__image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.r-coin--cashback {
  position: absolute;
  /* Позиция и размер — те же, что были у бирки: монета заняла её
     место один в один, чтобы вид блока не менялся. */
  right: 8px;
  bottom: -19px;
  width: 95px;
  height: 95px;
  aspect-ratio: 1 / 1;
  filter: drop-shadow(0 3px 6px #1b1d2326);
  transform-origin: 85% 94%;
  animation: cashback-coin-gesture 6s ease-in-out infinite;
}

@keyframes cashback-coin-gesture {
  0%, 9%, 100% { transform: none; }
  19% { transform: translate(-2px, -4px) rotate(-3deg); }
  29% { transform: translate(-1px, -1px) rotate(-1deg); }
  36%, 44% { transform: none; }
  55% { transform: translate(-3px, -1px) rotate(-5deg); }
  64% { transform: translate(-1px, 0) rotate(1deg); }
  71%, 78% { transform: none; }
  85% { transform: translate(-1px, -2px) rotate(2deg); }
  94% { transform: none; }
}

.home-shortcuts__tile {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 58px;
  border-radius: 18px;
  background: var(--customer-surface, #ffffff);
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

@media (prefers-reduced-motion: reduce) {
  .r-coin--cashback {
    animation: none;
  }
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
