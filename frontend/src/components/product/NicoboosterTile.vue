<template>
  <section v-if="product" class="nicobooster" aria-label="Никобустер">
    <!-- Плитка из макета glycerin-visual: та же высота и радиус, что
         у плиток фильтров выше. Слева название с ценой, справа арт,
         у правого края — кнопка добавления в корзину. -->
    <div class="nicobooster__tile">
      <div class="nicobooster__text">
        <p class="nicobooster__title">Никобустер</p>
        <p class="nicobooster__note">+20мг к крепости</p>
      </div>

      <span class="nicobooster__art" aria-hidden="true" />

      <!-- Кнопка та же, что в остальном приложении: количество берётся
           из корзины, поэтому счётчик и «плюс» ведут себя как везде. -->
      <div class="nicobooster__actions">
        <template v-if="quantity > 0">
          <button
            type="button"
            class="nicobooster__qty"
            aria-label="Убавить количество"
            @click.stop="emit('decrement')"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12h14" />
            </svg>
          </button>
          <span class="nicobooster__count">{{ quantity }}</span>
          <button
            type="button"
            class="nicobooster__qty"
            :class="{ 'is-disabled': !canAdd }"
            aria-label="Добавить ещё"
            @click.stop="emit('increment', $event)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </template>
        <button
          v-else
          type="button"
          class="nicobooster__add"
          :class="{ 'is-disabled': !canAdd }"
          :aria-label="`Добавить никобустер в корзину за ${priceLabel} BYN`"
          data-test="nicobooster-add"
          @click.stop="emit('add', $event)"
        >
          Добавить за
          <span class="nicobooster__add-price">{{ priceLabel }} BYN</span>
        </button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { Product } from "@/stores/catalog";

interface Props {
  product: Product | null;
  quantity?: number;
  /** Можно ли добавить: считается на экране, с учётом остатка. */
  canAdd?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  quantity: 0,
  canAdd: true,
});

const emit = defineEmits<{
  (e: "add", event: MouseEvent): void;
  (e: "increment", event: MouseEvent): void;
  (e: "decrement"): void;
}>();

/** Цена без лишних нулей: 4, а не 4.00. */
const priceLabel = computed(() => {
  const price = Number(props.product?.priceRub) || 0;
  if (!price) return "0";
  return Number.isInteger(price) ? String(price) : price.toFixed(2).replace(".", ",");
});
</script>

<style scoped>
.nicobooster {
  /* Совпадает с зазором после поиска: одинаковый ритм в блоке. */
  margin-top: 13px;
}

/* Размеры плитки совпадают с плитками фильтров: высота 50px,
   радиус 15px, подпись слева по центру высоты. */
.nicobooster__tile {
  position: relative;
  display: flex;
  align-items: center;
  height: 50px;
  overflow: hidden;
  border-radius: 15px;
  background: #ffffff;
  isolation: isolate;
}

.nicobooster__text {
  position: relative;
  z-index: 2;
  min-width: 0;
  padding-left: 12px;
  /* Montserrat: плитка наследует системный шрифт от родителя,
     а рядом лежащие плитки фильтров набраны им же. */
  font-family: "Montserrat", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.nicobooster__title {
  margin: 0;
  /* Чёрный, как подпись «Наш ассортимент» на главной. */
  color: #000000;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.15px;
}

/* Подпись мелким серым: поясняет, зачем товар. */
.nicobooster__note {
  margin: 2px 0 0;
  color: #949ca8;
  font-size: 10px;
  font-weight: 500;
  line-height: 1.2;
  letter-spacing: -0.1px;
}

/* Арт: 180×180 из макета, повёрнут и растворяется к тексту.
   Сдвинут влево от центра кнопки: справа остаётся место под кнопку,
   а композиция читается ровнее. */
.nicobooster__art {
  position: absolute;
  top: -33px;
  right: 40%;
  z-index: 1;
  width: 180px;
  height: 180px;
  background: url("/filters/nicobooster-art.png") center / contain no-repeat;
  transform: rotate(35deg);
  mask-image: linear-gradient(to right, transparent, #000 42%);
  -webkit-mask-image: linear-gradient(to right, transparent, #000 42%);
  pointer-events: none;
}

.nicobooster__actions {
  position: relative;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  padding-right: 10px;
}

/* Красная кнопка с ценой — вместо круглого плюса: покупателю видно,
   сколько он платит, ещё до нажатия. */
.nicobooster__add {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 31px;
  padding: 0 11px;
  border: 0;
  border-radius: 10px;
  background: linear-gradient(106.76deg, #f50302 -2.64%, #a90f0e 85.78%);
  color: #ffffff;
  /* Montserrat явно: кнопка — не поле ввода, шрифт не наследует
     от системных элементов. */
  font-family: "Montserrat", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: transform 0.16s ease, opacity 0.16s ease;
}

.nicobooster__add-price {
  font-weight: 700;
}

.nicobooster__qty {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: #f1f3f7;
  color: #3c4351;
  cursor: pointer;
  transition: transform 0.16s ease, opacity 0.16s ease;
}

/* У кнопок количества значок рисуем линией. */
.nicobooster__qty svg {
  width: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.2;
  stroke-linecap: round;
}

.nicobooster__add:active:not(.is-disabled),
.nicobooster__qty:active:not(.is-disabled) {
  transform: scale(0.92);
}

.nicobooster__add.is-disabled,
.nicobooster__qty.is-disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.nicobooster__add:focus-visible,
.nicobooster__qty:focus-visible {
  outline: 2px solid #147cec;
  outline-offset: 2px;
}

.nicobooster__count {
  min-width: 18px;
  color: var(--customer-ink, #191919);
  font-size: 13px;
  font-weight: 700;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 350px) {
  .nicobooster__tile {
    border-radius: 14px;
  }

  .nicobooster__text {
    padding-left: 10px;
  }

  .nicobooster__title {
    font-size: 12px;
  }

  .nicobooster__art {
    top: -28px;
    right: 32px;
    width: 164px;
    height: 164px;
  }

  .nicobooster__actions {
    padding-right: 8px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .nicobooster__add,
  .nicobooster__qty {
    transition: none;
  }
}
</style>
