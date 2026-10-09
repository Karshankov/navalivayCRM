<template>
  <div class="group-line-content">
    <!-- Товары с вариантами (устройства) - сразу показываем варианты -->
    <div v-if="productsWithVariants.length" class="group-variants-list-direct">
      <div v-for="product in productsWithVariants" :key="product.id">
        <div
          v-for="variant in getInStockVariants(product)"
          :key="variant.id ?? variant.name"
          class="group-variant-row"
        >
          <!-- Круглое превью цвета/изображения -->
          <div class="group-variant-color-wrapper">
            <div
              class="group-variant-color"
              :style="getVariantColorStyle(variant)"
            >
              <!-- Режим "картинка": показываем colorImage в кружочке -->
              <img
                v-if="isImageDisplayMode(variant) && variant.colorImage"
                :src="variant.colorImage"
                :alt="variant.name"
                loading="lazy"
                decoding="async"
                @error="handleVariantPreviewError"
              />
            </div>
          </div>
          <div class="group-variant-info">
            <!-- Название варианта - всегда черным текстом -->
            <span class="group-variant-title">{{ variant.name }}</span>
            <span v-if="shouldShowVariantPrice(variant)" class="group-variant-price">
              <span v-if="oldPriceOf(variant)" class="group-price-old">{{ formatPrice(oldPriceOf(variant)) }}</span>
              <span class="group-price-amount">{{ formatPrice(variant.priceRub) }}</span>
              {{ ' ' }}
              <span class="group-price-currency">BYN</span>
              <span v-if="priceDropPercent(variant) > 0" class="group-price-drop">-{{ priceDropPercent(variant) }}%</span>
            </span>
            <!-- 
              Кнопка "Как выглядит цвет" показывается ВСЕГДА когда есть изображение товара варианта
              Независимо от режима отображения (цвет или картинка)
            -->
            <button
              v-if="getVariantProductImage(variant)"
              type="button"
              class="group-variant-color-link"
              @click.stop="showColorPreview(variant)"
            >
              Как выглядит цвет
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
              >
                <circle cx="6" cy="6" r="5.5" stroke="currentColor" />
                <text
                  x="6"
                  y="9"
                  text-anchor="middle"
                  font-size="8"
                  fill="currentColor"
                >
                  ?
                </text>
              </svg>
            </button>
          </div>
          <div class="group-variant-actions">
            <template
              v-if="variant.id && getVariantQuantity(variant.id) > 0"
            >
              <button
                type="button"
                class="group-qty-btn group-qty-btn-minus"
                :class="{
                  'is-first':
                    variant.id && getVariantQuantity(variant.id) === 1,
                }"
                @click.stop="decrementVariantQuantity(product, variant)"
                aria-label="Убавить количество"
              >
                <MinusIcon class="group-qty-icon" />
              </button>
              <span class="group-qty-field">{{
                variant.id ? getVariantQuantity(variant.id) : 0
              }}</span>
              <button
                type="button"
                class="group-qty-btn group-qty-btn-plus"
                :class="{
                  'is-disabled': isVariantAtStockLimit(variant),
                }"
                @click.stop="handleVariantIncrement(product, variant)"
                aria-label="Добавить еще"
              >
                <PlusIcon class="group-qty-icon" />
              </button>
            </template>
            <button
              v-else
              type="button"
              class="group-qty-btn group-qty-btn-add"
              :class="{ 'is-disabled': !canAddVariant(variant) }"
              @click.stop="handleVariantAdd(product, variant)"
              aria-label="Добавить в корзину"
            >
              <PlusIcon class="group-qty-icon" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Обычные товары без вариантов -->
    <ul v-if="productsWithoutVariants.length" class="group-product-list">
      <li
        v-for="product in productsWithoutVariants"
        :key="product.id"
        class="group-product-row"
      >
        <div class="group-product-info">
          <span class="group-product-title">{{ product.title }}</span>
          <span v-if="shouldShowProductPrice(product)" class="group-product-price">
            <span v-if="oldPriceOf(product)" class="group-price-old">{{ formatPrice(oldPriceOf(product)) }}</span>
            <span class="group-price-amount">{{ formatPrice(product.priceRub) }}</span>
            {{ ' ' }}
            <span class="group-price-currency">BYN</span>
            <span v-if="priceDropPercent(product) > 0" class="group-price-drop">-{{ priceDropPercent(product) }}%</span>
          </span>
        </div>
        <div class="group-product-actions">
          <template v-if="getQuantity(product.id) > 0">
            <button
              type="button"
              class="group-qty-btn group-qty-btn-minus"
              :class="{ 'is-first': getQuantity(product.id) === 1 }"
              @click.stop="decrementQuantity(product)"
              aria-label="Убавить количество"
            >
              <MinusIcon class="group-qty-icon" />
            </button>
            <span class="group-qty-field">{{
              getQuantity(product.id)
            }}</span>
            <button
              type="button"
              class="group-qty-btn group-qty-btn-plus"
              :class="{ 'is-disabled': isAtStockLimit(product) }"
              @click.stop="handleIncrement(product)"
              aria-label="Добавить еще"
            >
              <PlusIcon class="group-qty-icon" />
            </button>
          </template>
          <button
            v-else
            type="button"
            class="group-qty-btn group-qty-btn-add"
            :class="{ 'is-disabled': !canAdd(product) }"
            @click.stop="handleAdd(product)"
            aria-label="Добавить в корзину"
          >
            <PlusIcon class="group-qty-icon" />
          </button>
        </div>
      </li>
    </ul>

    <!-- Модальное окно для просмотра цвета -->
    <ColorPreviewModal
      :is-open="colorPreviewOpen"
      :image-url="colorPreviewImage"
      :title="colorPreviewTitle"
      @close="closeColorPreview"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { PlusIcon, MinusIcon } from "@heroicons/vue/24/outline";
import { useCartStore } from "@/stores/cart";
import type { Product, ProductVariant } from "@/stores/catalog";
import ColorPreviewModal from "@/components/product/ColorPreviewModal.vue";
import {
  discountPercent,
  getMinBasePriceForProducts,
  shouldShowPrice,
} from "@/components/product/groupPrice";

export interface GroupNode {
  id: string;
  name: string;
  slug: string;
  order: number;
  coverImage?: string | null;
  productCount: number;
  totalProductCount?: number;
  depth: number;
  parentId?: string | null;
  metaLabel?: string | null;
  metaValue?: string | null;
  children: GroupNode[];
  products: Product[];
}

const props = defineProps<{
  node: GroupNode;
  categoryImage?: string | null;
}>();

const emit = defineEmits<{
  (e: "showToast", message: string, type: "error" | "success" | "info"): void;
}>();

const cartStore = useCartStore();

// Состояние для модального окна просмотра цвета
const colorPreviewOpen = ref(false);
const colorPreviewImage = ref<string | null>(null);
const colorPreviewTitle = ref("");

function getSafeVariants(product: Product): ProductVariant[] {
  if (!Array.isArray(product.variants)) return [];
  return product.variants.filter(
    (variant): variant is ProductVariant => Boolean(variant),
  );
}

function getInStockVariants(product: Product): ProductVariant[] {
  return getSafeVariants(product).filter((variant) =>
    isVariantInStock(variant),
  );
}

// Разделяем товары на с вариантами и без
const productsWithVariants = computed(() =>
  props.node.products.filter(
    (p): p is Product =>
      Boolean(p && p.hasVariants && getSafeVariants(p).length),
  ),
);

const productsWithoutVariants = computed(() =>
  props.node.products.filter(
    (p): p is Product => Boolean(p && !p.hasVariants),
  ),
);

// Цена минимального товара для сравнения цен
// Та же цена, что стоит на обложке линейки: с ней сравниваем, показывать ли
// цену у позиции, чтобы не повторять одно и то же число.
const firstProductPrice = computed(() =>
  getMinBasePriceForProducts(props.node.products),
);

function shouldShowVariantPrice(variant: ProductVariant): boolean {
  return shouldShowPrice(variant, firstProductPrice.value);
}

function shouldShowProductPrice(product: Product): boolean {
  return shouldShowPrice(product, firstProductPrice.value);
}

/** Цена до скидки: ноль означает, что зачёркивать нечего. */
function oldPriceOf(item: { hasDiscount?: boolean; oldPriceRub?: number | null }): number {
  const oldPrice = Number(item?.oldPriceRub ?? 0)
  return item?.hasDiscount && oldPrice > 0 ? oldPrice : 0
}

/** Насколько подешевела позиция: для бейджа рядом с ценой. */
function priceDropPercent(item: Product | ProductVariant): number {
  return discountPercent(oldPriceOf(item), Number(item.priceRub ?? 0));
}

function formatPrice(value?: number | null) {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("ru-RU");
}

function getVariantColorStyle(variant: ProductVariant): Record<string, string> {
  if (variant.colorCode) {
    return { backgroundColor: variant.colorCode };
  }
  return { backgroundColor: "#F5F7FA" };
}

// Проверка режима "картинка" (colorDisplayMode === 'image')
function isImageDisplayMode(variant: ProductVariant): boolean {
  return variant.colorDisplayMode === 'image';
}

// Получить изображение товара варианта (НЕ colorImage, а фото самого товара)
function getVariantProductImage(variant: ProductVariant): string | null {
  if (!Array.isArray(variant.images)) return null;
  const url = variant.images.find(
    (src) => typeof src === "string" && src.trim().length > 0,
  );
  return url ? url : null;
}

function handleVariantPreviewError(event: Event) {
  const img = event.target as HTMLImageElement | null;
  if (img) {
    img.style.display = "none";
  }
}

function showColorPreview(variant: ProductVariant) {
  // При клике показываем фото ТОВАРА варианта (variant.images[0]), а НЕ colorImage
  const imageUrl = getVariantProductImage(variant);
  if (!imageUrl) return;
  colorPreviewImage.value = imageUrl;
  colorPreviewTitle.value = variant.name;
  colorPreviewOpen.value = true;
}

function closeColorPreview() {
  colorPreviewOpen.value = false;
}

// Функции для работы с обычными товарами
function getQuantity(productId: string): number {
  const item = cartStore.items.find((item) => item.productId === productId);
  return item ? item.quantity : 0;
}

function canAdd(product?: Product | null): boolean {
  if (!product) return false;
  if (product.isAvailable === false) return false;
  if (typeof product.stock === "number") {
    const stock = Math.max(product.stock, 0);
    if (stock === 0) return false;
    return getQuantity(product.id) < stock;
  }
  return true;
}

function isAtStockLimit(product?: Product | null): boolean {
  if (!product) return true;
  if (product.isAvailable === false) return true;
  if (typeof product.stock === "number") {
    const stock = Math.max(product.stock, 0);
    if (stock === 0) return true;
    return getQuantity(product.id) >= stock;
  }
  return false;
}

function handleAdd(product?: Product | null) {
  if (!product) return;
  if (!canAdd(product)) {
    if (
      product.isAvailable === false ||
      (typeof product.stock === "number" && product.stock <= 0)
    ) {
      emit("showToast", "Товара нет в наличии", "error");
    } else {
      emit("showToast", "В наличии больше нет", "error");
    }
    return;
  }
  cartStore.addItem(product, 1);
}

function handleIncrement(product?: Product | null) {
  if (!product) return;
  if (!canAdd(product)) {
    if (
      product.isAvailable === false ||
      (typeof product.stock === "number" && product.stock <= 0)
    ) {
      emit("showToast", "Товара нет в наличии", "error");
    } else {
      emit("showToast", "В наличии больше нет", "error");
    }
    return;
  }
  const currentQty = getQuantity(product.id);
  if (currentQty > 0) {
    cartStore.updateQuantity(product.id, currentQty + 1);
  } else {
    cartStore.addItem(product, 1);
  }
}

function decrementQuantity(product?: Product | null) {
  if (!product) return;
  const currentQty = getQuantity(product.id);
  if (currentQty > 1) {
    cartStore.updateQuantity(product.id, currentQty - 1);
  } else if (currentQty === 1) {
    cartStore.removeItem(product.id);
  }
}

// Функции для работы с вариантами
function getVariantQuantity(variantId?: string): number {
  if (!variantId) return 0;
  const item = cartStore.items.find((item) => item.variantId === variantId);
  return item ? item.quantity : 0;
}

function canAddVariant(variant?: {
  id?: string;
  stock?: number | null;
  isAvailable?: boolean;
} | null) {
  if (!variant || !variant.id) return false;
  if (variant.isAvailable === false) return false;
  if (typeof variant.stock === "number") {
    const stock = Math.max(variant.stock, 0);
    if (stock === 0) return false;
    return getVariantQuantity(variant.id) < stock;
  }
  return true;
}

function isVariantAtStockLimit(variant?: {
  id?: string;
  stock?: number | null;
  isAvailable?: boolean;
} | null) {
  if (!variant || !variant.id) return true;
  if (variant.isAvailable === false) return true;
  if (typeof variant.stock === "number") {
    const stock = Math.max(variant.stock, 0);
    if (stock === 0) return true;
    return getVariantQuantity(variant.id) >= stock;
  }
  return false;
}

// Проверяет, есть ли вариант в наличии (stock > 0)
function isVariantInStock(variant?: {
  id?: string;
  stock?: number | null;
  isAvailable?: boolean;
} | null) {
  if (!variant) return false;
  if (variant.isAvailable === false) return false;
  if (typeof variant.stock === "number") {
    return variant.stock > 0;
  }
  // Если stock не указан, считаем что в наличии
  return true;
}

function handleVariantAdd(
  product?: Product | null,
  variant?: { id?: string; stock?: number | null; isAvailable?: boolean } | null,
) {
  if (!product || !variant?.id) return;
  if (!canAddVariant(variant)) {
    if (
      variant.isAvailable === false ||
      (typeof variant.stock === "number" && variant.stock <= 0)
    ) {
      emit("showToast", "Товара нет в наличии", "error");
    } else {
      emit("showToast", "В наличии больше нет", "error");
    }
    return;
  }
  cartStore.addItem(product, 1, variant.id);
}

function handleVariantIncrement(
  product?: Product | null,
  variant?: { id?: string; stock?: number | null; isAvailable?: boolean } | null,
) {
  if (!product || !variant?.id) return;
  if (!canAddVariant(variant)) {
    if (
      variant.isAvailable === false ||
      (typeof variant.stock === "number" && variant.stock <= 0)
    ) {
      emit("showToast", "Товара нет в наличии", "error");
    } else {
      emit("showToast", "В наличии больше нет", "error");
    }
    return;
  }
  const currentQty = getVariantQuantity(variant.id);
  if (currentQty > 0) {
    cartStore.updateQuantity(product.id, currentQty + 1, variant.id);
  } else {
    cartStore.addItem(product, 1, variant.id);
  }
}

function decrementVariantQuantity(
  product?: Product | null,
  variant?: { id?: string } | null,
) {
  if (!product || !variant?.id) return;
  const currentQty = getVariantQuantity(variant.id);
  if (currentQty > 1) {
    cartStore.updateQuantity(product.id, currentQty - 1, variant.id);
  } else if (currentQty === 1) {
    cartStore.removeItem(product.id, variant.id);
  }
}
</script>

<style scoped>
.group-line-content {
  /* Container for content sections */
}

/* ========== Список вариантов (цветов) - прямой показ ========== */
.group-variants-list-direct {
  margin-top: 0;
}

.group-variant-row {
  display: flex;
  align-items: center;
  padding: 16px 0;
  border-bottom: 1px solid #e6e9ed;
  gap: 12px;
}

.group-variant-row:first-child {
  padding-top: 16px;
  border-top: 1px solid #e6e9ed;
}

.group-variant-row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.group-variant-color-wrapper {
  flex-shrink: 0;
}

.group-variant-color {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #f5f7fa;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.group-variant-color img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.group-variant-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.group-variant-title {
  font-family: "Montserrat", sans-serif;
  font-style: normal;
  font-weight: 700;
  font-size: 16px;
  line-height: 20px;
  color: #191919;
}

.group-variant-price {
  font-family: "Montserrat", sans-serif;
  font-style: normal;
  font-weight: 700;
  font-size: 16px;
  line-height: 20px;
  color: #191919;
}

.group-price-old {
  margin-right: 4px;
  color: #98a2b3;
  opacity: 0.6;
  text-decoration: line-through;
}

.group-price-drop {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  background: linear-gradient(106.76deg, #f50302 -2.64%, #a90f0e 85.78%);
  font-size: 11px;
  font-weight: 800;
  line-height: 14px;
  color: #ffffff;
  white-space: nowrap;
}

.group-price-amount {
  color: #f50302;
}

.group-price-currency {
  color: #191919;
}

.group-variant-color-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: none;
  background: none;
  font-family:
    "SF Pro Display",
    -apple-system,
    BlinkMacSystemFont,
    sans-serif;
  font-style: normal;
  font-weight: 400;
  font-size: 12px;
  line-height: 14px;
  color: #0273f5;
  cursor: pointer;
  transition: opacity 0.3s ease;
}

.group-variant-color-link:hover {
  opacity: 0.8;
}

.group-variant-color-link svg {
  flex-shrink: 0;
}

.group-variant-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* ========== Кнопки +/- согласно Figma ========== */
.group-qty-btn {
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

.group-qty-btn:hover:not(:disabled):not(.is-disabled) {
  background: #e6e9ed;
}

.group-qty-btn.is-disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.group-qty-btn.is-first {
  opacity: 0.4;
}

.group-qty-btn-minus {
  background: #f5f7fa;
}

.group-qty-btn-plus,
.group-qty-btn-add {
  background: #f5f7fa;
}

.group-qty-icon {
  width: 18px;
  height: 18px;
  color: #191919;
  stroke-width: 2;
}

.group-qty-field {
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

/* ========== Список обычных товаров ========== */
.group-product-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.group-product-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 0;
  border-bottom: 1px solid #e6e9ed;
}

.group-product-row:first-child {
  border-top: 1px solid #e6e9ed;
  margin-top: 16px;
}

.group-product-row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.group-product-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.group-product-title {
  font-family: "Montserrat", sans-serif;
  font-style: normal;
  font-weight: 700;
  font-size: 16px;
  line-height: 20px;
  color: #191919;
}

.group-product-price {
  font-family: "Montserrat", sans-serif;
  font-style: normal;
  font-weight: 700;
  font-size: 16px;
  line-height: 20px;
  color: #191919;
}

.group-product-actions {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* Адаптивные стили */

@media (max-width: 1024px) {
  .group-qty-btn {
    width: 36px;
    height: 36px;
  }

  .group-qty-field {
    width: 36px;
    height: 36px;
    font-size: 15px;
  }
}

@media (max-width: 768px) {
  .group-product-row,
  .group-variant-row {
    padding: 12px 0;
  }

  .group-product-title,
  .group-variant-title {
    font-size: 15px;
  }

  .group-product-price,
  .group-variant-price {
    font-size: 15px;
  }

  .group-qty-btn {
    width: 34px;
    height: 34px;
  }

  .group-qty-field {
    width: 34px;
    height: 34px;
    font-size: 14px;
    border-radius: 10px;
  }

  .group-qty-icon {
    width: 16px;
    height: 16px;
  }
}

@media (max-width: 480px) {
  .group-product-row,
  .group-variant-row {
    padding: 10px 0;
  }

  .group-product-title,
  .group-variant-title {
    font-size: 14px;
    line-height: 18px;
  }

  .group-product-price,
  .group-variant-price {
    font-size: 14px;
    line-height: 18px;
  }

  .group-qty-btn {
    width: 32px;
    height: 32px;
  }

  .group-qty-field {
    width: 32px;
    height: 32px;
    font-size: 13px;
    border-radius: 8px;
  }

  .group-qty-icon {
    width: 14px;
    height: 14px;
  }

  .group-variant-actions,
  .group-product-actions {
    gap: 6px;
  }

  .group-variant-color {
    width: 28px;
    height: 28px;
  }

  .group-variant-color-link {
    font-size: 11px;
  }
}

@media (max-width: 360px) {
  .group-product-row,
  .group-variant-row {
    padding: 8px 0;
  }

  .group-product-title,
  .group-variant-title {
    font-size: 13px;
    line-height: 16px;
  }

  .group-product-price,
  .group-variant-price {
    font-size: 13px;
    line-height: 16px;
  }

  .group-qty-btn {
    width: 28px;
    height: 28px;
  }

  .group-qty-field {
    width: 28px;
    height: 28px;
    font-size: 12px;
    border-radius: 6px;
  }

  .group-qty-icon {
    width: 12px;
    height: 12px;
  }

  .group-variant-actions,
  .group-product-actions {
    gap: 4px;
  }

  .group-variant-color {
    width: 24px;
    height: 24px;
  }

  .group-variant-color-link {
    font-size: 10px;
  }
}
</style>
