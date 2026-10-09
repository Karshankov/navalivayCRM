<template>
  <div class="single-product-card">
    <div class="single-product-main">
      <!-- Изображение товара -->
      <div class="single-product-image-wrapper">
        <div v-if="productImage" class="single-product-image">
          <img :src="productImage" :alt="product.title" />
        </div>
        <div
          v-else
          class="single-product-image single-product-image-placeholder"
        >
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#E6E9ED"
            stroke-width="1.5"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        </div>
        <p v-if="showPrice" class="single-product-image-price">
          <span class="single-product-image-price-amount">{{ formattedPrice }}</span>
          <span class="single-product-image-price-currency">BYN</span>
        </p>
      </div>

      <!-- Информация о товаре -->
      <div class="single-product-info">
        <h3 class="single-product-title">
          {{ product.title || "Без названия" }}
        </h3>
        <p v-if="product.description" class="single-product-description">
          {{ product.description }}
        </p>
      </div>
    </div>

    <!-- Кнопки действий -->
    <div class="single-product-actions">
      <template v-if="quantity > 0">
        <button
          type="button"
          class="single-qty-btn single-qty-btn-minus"
          :class="{ 'is-first': quantity === 1 }"
          @click.stop="$emit('decrement')"
          aria-label="Убавить количество"
        >
          <MinusIcon class="single-qty-icon" />
        </button>
        <span class="single-qty-field">{{ quantity }}</span>
        <button
          type="button"
          class="single-qty-btn single-qty-btn-plus"
          :class="{ 'is-disabled': isAtStockLimit }"
          @click.stop="$emit('increment')"
          aria-label="Добавить еще"
        >
          <PlusIcon class="single-qty-icon" />
        </button>
      </template>
      <button
        v-else
        type="button"
        class="single-qty-btn single-qty-btn-add"
        :class="{ 'is-disabled': !canAdd }"
        @click.stop="$emit('add')"
        aria-label="Добавить в корзину"
      >
        <PlusIcon class="single-qty-icon" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { PlusIcon, MinusIcon } from "@heroicons/vue/24/outline";
import { hasPositivePrice } from "@/components/product/groupPrice";
import type { Product } from "@/stores/catalog";

interface Props {
  product: Product;
  quantity?: number;
}

const props = withDefaults(defineProps<Props>(), {
  quantity: 0,
});

defineEmits<{
  (e: "add"): void;
  (e: "increment"): void;
  (e: "decrement"): void;
}>();

const productImage = computed(() => {
  // Для товаров с вариантами берём изображение первого варианта
  if (
    props.product.hasVariants &&
    props.product.variants?.length &&
    props.product.variants[0].images?.length
  ) {
    return props.product.variants[0].images[0];
  }

  if (props.product.images?.[0]) return props.product.images[0];
  if (props.product.links?.length) {
    for (const link of props.product.links) {
      const url = link.url?.toLowerCase() || "";
      if (url.match(/\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i)) {
        return link.url;
      }
    }
    return props.product.links[0]?.url || null;
  }
  return null;
});

const showPrice = computed(() => hasPositivePrice(props.product.priceRub));

const formattedPrice = computed(() => {
  return props.product.priceRub.toLocaleString("ru-RU");
});

const canAdd = computed(() => {
  if (props.product.isAvailable === false) return false;
  if (typeof props.product.stock === "number") {
    const stock = Math.max(props.product.stock, 0);
    if (stock === 0) return false;
    return props.quantity < stock;
  }
  return true;
});

const isAtStockLimit = computed(() => {
  if (props.product.isAvailable === false) return true;
  if (typeof props.product.stock === "number") {
    const stock = Math.max(props.product.stock, 0);
    if (stock === 0) return true;
    return props.quantity >= stock;
  }
  return false;
});
</script>

<style scoped>
/* Figma Redesign - Карточка единичного товара */
.single-product-card {
  background: #ffffff;
  border-radius: 20px;
  padding: 16px;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.single-product-card:last-of-type {
  margin-bottom: 0;
}

.single-product-main {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

/* Изображение товара */
.single-product-image-wrapper {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.single-product-image {
  width: 88px;
  height: 104px;
  background: #ffffff;
  border: 1px solid #e6e9ed;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  box-sizing: border-box;
  padding: 6px;
}

.single-product-image img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.single-product-image-placeholder {
  background: #fafafa;
}

.single-product-image-price {
  margin: 0;
  display: inline-flex;
  align-items: baseline;
  justify-content: center;
  gap: 4px;
  font-family: "Montserrat", sans-serif;
  font-style: normal;
  font-weight: 700;
  font-size: 16px;
  line-height: 20px;
  white-space: nowrap;
}

.single-product-image-price-amount {
  color: var(--navalivay-red, #d32f2f);
}

.single-product-image-price-currency {
  color: #191919;
}

/* Информация о товаре */
.single-product-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.single-product-title {
  margin: 0;
  font-family: "Montserrat", sans-serif;
  font-style: normal;
  font-weight: 700;
  font-size: 16px;
  line-height: 20px;
  color: #191919;
}

.single-product-description {
  margin: 0;
  font-family:
    "SF Pro Display",
    -apple-system,
    BlinkMacSystemFont,
    sans-serif;
  font-style: normal;
  font-weight: 500;
  font-size: 14.4px;
  line-height: 17.3px;
  color: #aab2bd;
}

/* Кнопки действий */
.single-product-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.single-qty-btn {
  width: 40px;
  height: 40px;
  border-radius: 512px;
  border: none;
  background: #f5f7fa;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.single-qty-btn:hover:not(:disabled):not(.is-disabled) {
  background: #e6e9ed;
}

.single-qty-btn.is-disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.single-qty-btn.is-first {
  opacity: 0.4;
}

.single-qty-btn-minus {
  background: #f5f7fa;
}

.single-qty-btn-plus,
.single-qty-btn-add {
  background: #f5f7fa;
}

.single-qty-icon {
  width: 18px;
  height: 18px;
  color: #191919;
  stroke-width: 2;
}

.single-qty-field {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 40px;
  height: 40px;
  background: #ffffff;
  border: 1px solid #e6e9ed;
  border-radius: 12px;
  font-family:
    "SF Pro Display",
    -apple-system,
    BlinkMacSystemFont,
    sans-serif;
  font-style: normal;
  font-weight: 500;
  font-size: 16px;
  line-height: 19px;
  color: #191919;
}

/* Адаптивные стили */
@media (max-width: 1024px) {
  .single-product-card {
    padding: 16px;
  }

  .single-product-image {
    width: 88px;
    height: 104px;
    padding: 6px;
  }

  .single-product-image img {
    max-width: 100%;
    max-height: 100%;
  }

  .single-product-title {
    font-size: 16px;
  }

  .single-product-image-price {
    font-size: 16px;
    line-height: 20px;
  }

  .single-qty-btn {
    width: 36px;
    height: 36px;
  }

  .single-qty-field {
    width: 36px;
    height: 36px;
    font-size: 15px;
  }
}

@media (max-width: 768px) {
  .single-product-card {
    padding: 16px;
    border-radius: 20px;
    margin-bottom: 8px;
  }

  .single-product-main {
    gap: 10px;
  }

  .single-product-image {
    width: 88px;
    height: 104px;
    border-radius: 16px;
    padding: 6px;
  }

  .single-product-image img {
    max-width: 100%;
    max-height: 100%;
  }

  .single-product-info {
    gap: 6px;
  }

  .single-product-title {
    font-size: 16px;
    line-height: 20px;
  }

  .single-product-description {
    font-size: 14.4px;
  }

  .single-product-image-price {
    font-size: 15px;
    line-height: 19px;
  }

  .single-product-actions {
    gap: 6px;
  }

  .single-qty-btn {
    width: 34px;
    height: 34px;
  }

  .single-qty-field {
    width: 34px;
    height: 34px;
    font-size: 14px;
    border-radius: 10px;
  }

  .single-qty-icon {
    width: 16px;
    height: 16px;
  }
}

@media (max-width: 480px) {
  .single-product-card {
    padding: 16px;
    border-radius: 20px;
  }

  .single-product-main {
    gap: 10px;
  }

  .single-product-image {
    width: 88px;
    height: 104px;
    border-radius: 16px;
    padding: 6px;
  }

  .single-product-image img {
    max-width: 100%;
    max-height: 100%;
  }

  .single-product-info {
    gap: 6px;
  }

  .single-product-title {
    font-size: 16px;
    line-height: 20px;
  }

  .single-product-description {
    font-size: 14.4px;
  }

  .single-product-image-price {
    font-size: 14px;
    line-height: 18px;
  }

  .single-product-actions {
    gap: 8px;
  }

  .single-qty-btn {
    width: 32px;
    height: 32px;
  }

  .single-qty-field {
    width: 32px;
    height: 32px;
    font-size: 13px;
    border-radius: 8px;
  }

  .single-qty-icon {
    width: 14px;
    height: 14px;
  }
}

@media (max-width: 360px) {
  .single-product-card {
    padding: 14px;
    border-radius: 18px;
  }

  .single-product-main {
    gap: 10px;
  }

  .single-product-image {
    width: 80px;
    height: 96px;
    border-radius: 14px;
    padding: 4px;
  }

  .single-product-image img {
    max-width: 100%;
    max-height: 100%;
  }

  .single-product-title {
    font-size: 15px;
    line-height: 19px;
  }

  .single-product-description {
    font-size: 14.4px;
  }

  .single-product-image-price {
    font-size: 13px;
    line-height: 17px;
  }

  .single-product-actions {
    gap: 6px;
  }

  .single-qty-btn {
    width: 28px;
    height: 28px;
  }

  .single-qty-field {
    width: 28px;
    height: 28px;
    font-size: 12px;
    border-radius: 6px;
  }

  .single-qty-icon {
    width: 12px;
    height: 12px;
  }
}
</style>
