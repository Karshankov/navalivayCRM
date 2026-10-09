<template>
  <div class="liquid-line-card" :class="{ expanded }">
    <NewLineupBadge v-if="isNew" />
    <div class="liquid-line-header" @click="toggle">
      <div
        class="liquid-line-main"
        role="button"
        tabindex="0"
        @keyup.enter.prevent="toggle"
        @keyup.space.prevent="toggle"
      >
        <div class="liquid-line-image-wrapper">
          <span v-if="topRank" class="liquid-line-top-rank">#{{ topRank }}</span>
          <div class="liquid-line-image-box">
            <div v-if="coverUrl" class="liquid-line-image">
              <img :src="coverUrl" :alt="title" loading="lazy" decoding="async" />
            </div>
            <div v-else class="liquid-line-image liquid-line-image-placeholder">
              <svg
                width="40"
                height="40"
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
            <DiscountBadge v-if="hasDiscount" class="liquid-line-discount" />
          </div>
          <p v-if="minPriceLabel" class="liquid-line-image-price" :class="{ discounted: oldPriceLabel }">
            <span v-if="oldPriceLabel" class="liquid-line-image-price-old">{{ oldPriceLabel }}</span>
            <span class="liquid-line-image-price-amount">{{ minPriceLabel }}</span>
            <span class="liquid-line-image-price-currency">BYN</span>
          </p>
        </div>
        <div class="liquid-line-info">
          <h3 class="liquid-line-title">{{ title }}</h3>
          <p v-if="metaText" class="liquid-line-meta">{{ metaText }}</p>
          <ReviewRatingLink
            v-if="showReviewSummary"
            :ready="reviewsLoaded"
            :count="reviewCount"
            :average-rating="averageRating"
            :mode="reviewDisplayMode"
            @click="openReviewsModal"
          />
        </div>
      </div>
      <div class="liquid-line-side">
        <button
          type="button"
          class="liquid-line-toggle"
          :class="{ expanded }"
          @click.stop="toggle"
          aria-label="Переключить линейку"
        >
          <ChevronDownIcon class="liquid-line-toggle-icon" />
        </button>
      </div>
    </div>

    <Transition
      :css="false"
      @before-enter="onBeforeEnter"
      @enter="onEnter"
      @after-enter="onAfterEnter"
      @before-leave="onBeforeLeave"
      @leave="onLeave"
      @after-leave="onAfterLeave"
      @enter-cancelled="onCancelled"
      @leave-cancelled="onCancelled"
    >
      <div
        v-if="expanded"
        ref="bodyWrapper"
        class="liquid-line-body-wrapper"
      >
        <div class="liquid-line-body">
        <!-- Подлинейки (товары с вариантами) - новый дизайн -->
        <div v-if="productsWithVariants.length" class="liquid-sublines">
          <div
            v-for="product in productsWithVariants"
            :key="product.id"
            class="liquid-subline-card"
          >
            <!-- Разделитель сверху -->
            <div class="liquid-subline-divider"></div>

            <!-- Заголовок подлинейки -->
            <div
              class="liquid-subline-header"
              @click="toggleVariantProductExpansion(product.id)"
            >
              <div class="liquid-subline-image-wrapper">
                <div class="liquid-subline-image">
                  <img
                    v-if="getProductImage(product)"
                    :src="getProductImage(product)!"
                    :alt="product.title"
                    loading="lazy"
                    decoding="async"
                  />
                  <svg
                    v-else
                    width="24"
                    height="24"
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
              </div>
              <div class="liquid-subline-info">
                <h4 class="liquid-subline-title">{{ product.title }}</h4>
                <p v-if="product.variant" class="liquid-subline-description">
                  {{ product.variant }}
                </p>
                <p class="liquid-subline-price">
                  {{ formatPrice(product.priceRub) }} BYN
                </p>
              </div>
              <button
                type="button"
                class="liquid-subline-toggle"
                :class="{ expanded: isVariantProductExpanded(product.id) }"
                @click.stop="toggleVariantProductExpansion(product.id)"
                aria-label="Переключить подлинейку"
              >
                <ChevronDownIcon class="liquid-subline-toggle-icon" />
              </button>
            </div>

            <!-- Раскрытый список вариантов -->
            <Transition name="subline-expand">
              <div
                v-if="isVariantProductExpanded(product.id)"
                class="liquid-variants-list"
              >
                <div
                  v-for="variant in getInStockVariants(product)"
                  :key="variant.id ?? variant.name"
                  class="liquid-variant-row"
                >
                  <!-- Круглое превью варианта: colorImage если режим "картинка", иначе цвет -->
                  <div
                    class="liquid-variant-preview"
                    :style="getVariantColorStyle(variant)"
                  >
                    <!-- Режим "картинка": показываем colorImage в кружочке -->
                    <img
                      v-if="isImageDisplayMode(variant) && variant.colorImage && !isImageFailed(variant.colorImage)"
                      :src="variant.colorImage"
                      :alt="variant.name"
                      class="liquid-variant-preview-img"
                      loading="lazy"
                      decoding="async"
                      @error="(e) => handleImageError(e, variant.colorImage!)"
                    />
                  </div>
                  <div class="liquid-variant-info">
                    <!-- Название варианта - всегда черным текстом -->
                    <span class="liquid-variant-title">{{ variant.name }}</span>
                    <span v-if="shouldShowVariantPrice(variant, product)" class="liquid-variant-price">
                      <span v-if="variant.oldPriceRub" class="liquid-price-old">{{ formatPrice(variant.oldPriceRub) }}</span>
                      {{ formatPrice(variant.priceRub) }} BYN
                      <span v-if="priceDropPercent(variant) > 0" class="liquid-price-drop">-{{ priceDropPercent(variant) }}%</span>
                    </span>
                    <!-- 
                      Кнопка "Как выглядит цвет" показывается ВСЕГДА когда есть изображение товара варианта
                      Независимо от режима отображения (цвет или картинка)
                    -->
                    <button
                      v-if="getVariantProductImage(variant) && !isImageFailed(getVariantProductImage(variant)!)"
                      type="button"
                      class="liquid-variant-color-link"
                      @click.stop="openColorPreview(variant)"
                    >
                      Как выглядит цвет
                    </button>
                  </div>
                  <div class="liquid-variant-actions">
                    <template
                      v-if="variant.id && getVariantQuantity(variant.id) > 0"
                    >
                      <button
                        type="button"
                        class="liquid-qty-btn liquid-qty-btn-minus"
                        :class="{
                          'is-first':
                            variant.id && getVariantQuantity(variant.id) === 1,
                        }"
                        @click.stop="decrementVariantQuantity(product, variant)"
                        aria-label="Убавить количество"
                      >
                        <MinusIcon class="liquid-qty-icon" />
                      </button>
                      <span class="liquid-qty-field">{{
                        variant.id ? getVariantQuantity(variant.id) : 0
                      }}</span>
                      <button
                        type="button"
                        class="liquid-qty-btn liquid-qty-btn-plus"
                        :class="{
                          'is-disabled': isVariantAtStockLimit(variant),
                        }"
                        @click.stop="handleVariantIncrement(product, variant)"
                        aria-label="Добавить еще"
                      >
                        <PlusIcon class="liquid-qty-icon" />
                      </button>
                    </template>
                    <button
                      v-else
                      type="button"
                      class="liquid-qty-btn liquid-qty-btn-add"
                      :class="{ 'is-disabled': !canAddVariant(variant) }"
                      @click.stop="handleVariantAdd(product, variant)"
                      aria-label="Добавить в корзину"
                    >
                      <PlusIcon class="liquid-qty-icon" />
                    </button>
                  </div>
                </div>
              </div>
            </Transition>
          </div>
        </div>

        <!-- Обычные товары без вариантов -->
        <ul v-if="productsWithoutVariants.length" class="liquid-flavor-list">
          <li
            v-for="product in productsWithoutVariants"
            :key="product.id"
            class="liquid-flavor-row"
          >
            <div class="liquid-flavor-info">
              <span class="liquid-flavor-title">{{ product.title }}</span>
              <span v-if="shouldShowFlavorPrice(product)" class="liquid-flavor-price">
                <span v-if="product.oldPriceRub" class="liquid-price-old">{{ formatPrice(product.oldPriceRub) }}</span>
                {{ formatPrice(product.priceRub) }} BYN
                <span v-if="priceDropPercent(product) > 0" class="liquid-price-drop">-{{ priceDropPercent(product) }}%</span>
              </span>
            </div>
            <div class="liquid-flavor-actions">
              <template v-if="getQuantity(product.id) > 0">
                <button
                  type="button"
                  class="liquid-qty-btn liquid-qty-btn-minus"
                  :class="{ 'is-first': getQuantity(product.id) === 1 }"
                  @click.stop="decrementQuantity(product)"
                  aria-label="Убавить количество"
                >
                  <MinusIcon class="liquid-qty-icon" />
                </button>
                <span class="liquid-qty-field">{{
                  getQuantity(product.id)
                }}</span>
                <button
                  type="button"
                  class="liquid-qty-btn liquid-qty-btn-plus"
                  :class="{ 'is-disabled': isAtStockLimit(product) }"
                  @click.stop="handleIncrement(product)"
                  aria-label="Добавить еще"
                >
                  <PlusIcon class="liquid-qty-icon" />
                </button>
              </template>
              <button
                v-else
                type="button"
                class="liquid-qty-btn liquid-qty-btn-add"
                :class="{ 'is-disabled': !canAdd(product) }"
                @click.stop="handleAdd(product)"
                aria-label="Добавить в корзину"
              >
                <PlusIcon class="liquid-qty-icon" />
              </button>
            </div>
          </li>
        </ul>
        </div>
      </div>
    </Transition>

    <!-- Модальное окно для просмотра цвета -->
    <ColorPreviewModal
      :is-open="colorPreviewOpen"
      :image-url="colorPreviewImage"
      :title="colorPreviewTitle"
      @close="closeColorPreview"
    />

    <GroupReviewsModal
      :open="showReviewsModal"
      :group-id="groupId"
      :group-name="title"
      @close="showReviewsModal = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, nextTick } from "vue";
import NewLineupBadge from "@/components/product/NewLineupBadge.vue";
import GroupReviewsModal from "@/components/reviews/GroupReviewsModal.vue";
import ReviewRatingLink from "@/components/reviews/ReviewRatingLink.vue";
import { useCustomerOrders } from "@/composables/useCustomerOrders";
import {
  isParentGroupLine,
  shouldShowGroupReviewSummary,
} from "@/utils/groupReviewDisplay";
import {
  ChevronDownIcon,
  PlusIcon,
  MinusIcon,
} from "@heroicons/vue/24/outline";
import { useCartStore } from "@/stores/cart";
import { useCatalogStore, type Product, type ProductVariant } from "@/stores/catalog";
import ColorPreviewModal from "@/components/product/ColorPreviewModal.vue";
import DiscountBadge from "@/components/product/DiscountBadge.vue";
import {
  discountPercent,
  getMinBasePriceForProducts,
  getMinPriceForProducts,
  hasDiscountInTree,
  isFullyDiscountedProduct,
  shouldShowPrice,
} from "@/components/product/groupPrice";

/**
 * Подлинейка приезжает целиком, вместе со своими товарами и вложенностью:
 * плашка скидки на родителе зажигается от того, что подешевело внутри.
 */
interface SubgroupInfo {
  id: string;
  name: string;
  slug?: string;
  productCount?: number;
  products?: Product[];
  children?: SubgroupInfo[];
}

const props = defineProps<{
  groupId: string;
  title: string;
  products: Product[];
  expanded: boolean;
  coverImage?: string | null;
  fallbackImage?: string;
  subgroups?: SubgroupInfo[];
  badge?: string;
  badgeColor?: string;
  isNew?: boolean;
  metaLabel?: string | null;
  metaValue?: string | null;
  topRank?: number | null;
}>();

const emit = defineEmits<{
  (e: "toggle", groupId: string): void;
  (e: "showToast", message: string, type: "error" | "success" | "info"): void;
}>();

const cartStore = useCartStore();
const catalogStore = useCatalogStore();
const { fetchGroupReviewSummary } = useCustomerOrders();
const bodyWrapper = ref<HTMLElement | null>(null);
const reviewCount = ref(0);
const averageRating = ref<number | null>(null);
const reviewsLoaded = ref(false);
const showReviewsModal = ref(false);
const reviewTreeNode = computed(() => ({
  id: props.groupId,
  children: props.subgroups ?? [],
}));
const showReviewSummary = computed(() =>
  shouldShowGroupReviewSummary(reviewTreeNode.value),
);
const reviewDisplayMode = computed(() =>
  isParentGroupLine(reviewTreeNode.value) ? "parent" : "leaf",
);
const expandedVariantProducts = ref<Record<string, boolean>>({});
const failedImages = ref<Set<string>>(new Set());
let transitionTimer: ReturnType<typeof setTimeout> | null = null;

// Разделение товаров на те, у которых есть варианты, и без них
const productsWithVariants = computed(() =>
  props.products.filter(
    (p) => p.hasVariants && p.variants && p.variants.length > 0,
  ),
);

const productsWithoutVariants = computed(() =>
  props.products.filter((p) => !p.hasVariants),
);

const coverUrl = computed(
  () => props.coverImage || catalogStore.getGroupImage(props.groupId) || props.fallbackImage,
);

const discountedMinPrice = computed(() => getMinPriceForProducts(props.products));
const baseMinPrice = computed(() => getMinBasePriceForProducts(props.products));

/** Подешевела ли линейка целиком, а не отдельные её вкусы. */
const wholeLineDiscounted = computed(
  () =>
    props.products.length > 0 &&
    props.products.every((product) => isFullyDiscountedProduct(product)),
);

/**
 * Цена на обложке. Скидка на отдельный вкус её не трогает: остальные вкусы
 * продаются по-старому, и обложка обязана называть цену, по которой линейку
 * реально можно взять. Новую цену показываем, только когда подешевело всё.
 */
const groupMinPrice = computed(() =>
  wholeLineDiscounted.value ? discountedMinPrice.value : baseMinPrice.value,
);

const minPriceLabel = computed(() => {
  if (props.subgroups && props.subgroups.length > 0) return null;
  if (groupMinPrice.value === null) return null;
  return formatPrice(groupMinPrice.value);
});

/** Зачёркнутая цена на обложке — только у линейки, подешевевшей целиком. */
const oldPriceLabel = computed(() => {
  if (minPriceLabel.value === null) return null;
  if (!wholeLineDiscounted.value) return null;
  const oldPrice = Number(baseMinPrice.value ?? 0);
  if (!oldPrice || oldPrice <= Number(groupMinPrice.value ?? 0)) return null;
  return formatPrice(oldPrice);
});

/** Плашка: показываем, пока скидка есть хоть где-то в линейке или внутри неё. */
const hasDiscount = computed(() =>
  hasDiscountInTree({ products: props.products, children: props.subgroups }),
);

/** Насколько подешевела позиция: для бейджа рядом с ценой. */
function priceDropPercent(item: Product | ProductVariant): number {
  return discountPercent(Number(item.oldPriceRub ?? 0), Number(item.priceRub ?? 0));
}

function shouldShowFlavorPrice(product: Product): boolean {
  return shouldShowPrice(product, groupMinPrice.value);
}

function shouldShowVariantPrice(variant: ProductVariant, product: Product): boolean {
  return shouldShowPrice(variant, Number(product.priceRub ?? 0));
}

const metaText = computed(() => {
  const label = (props.metaLabel ?? '').trim();
  const value = (props.metaValue ?? '').trim();
  if (label && value) {
    return `${label} ${value}`;
  }
  return label || value;
});

function clearTransitionTimer() {
  if (transitionTimer === null) return;
  clearTimeout(transitionTimer);
  transitionTimer = null;
}

function queueNextFrame(callback: () => void) {
  requestAnimationFrame(() => {
    requestAnimationFrame(callback);
  });
}

function getBodyHeight(element: HTMLElement) {
  return Math.max(Math.ceil(element.scrollHeight), 1);
}

function applyTransitionStyles(element: HTMLElement) {
  element.style.overflow = "hidden";
  element.style.willChange = "height, opacity";
  element.style.transition =
    "height 360ms cubic-bezier(0.4, 0, 0.2, 1), opacity 220ms ease";
}

function resetTransitionStyles(element: HTMLElement) {
  element.style.transition = "";
  element.style.willChange = "";
}

function waitForHeightTransition(element: HTMLElement, done: () => void) {
  clearTransitionTimer();

  const finish = () => {
    element.removeEventListener("transitionend", handleTransitionEnd);
    clearTransitionTimer();
    done();
  };

  const handleTransitionEnd = (event: TransitionEvent) => {
    if (event.target !== element || event.propertyName !== "height") return;
    finish();
  };

  element.addEventListener("transitionend", handleTransitionEnd);
  transitionTimer = setTimeout(finish, 520);
}

function onBeforeEnter(element: Element) {
  const panel = element as HTMLElement;
  clearTransitionTimer();
  panel.style.height = "0px";
  panel.style.opacity = "0";
  panel.style.overflow = "hidden";
}

function onEnter(element: Element, done: () => void) {
  const panel = element as HTMLElement;
  applyTransitionStyles(panel);

  queueNextFrame(() => {
    panel.style.height = `${getBodyHeight(panel)}px`;
    panel.style.opacity = "1";
  });

  waitForHeightTransition(panel, done);
}

function onAfterEnter(element: Element) {
  const panel = element as HTMLElement;
  clearTransitionTimer();
  resetTransitionStyles(panel);
  panel.style.height = "auto";
  panel.style.opacity = "1";
  panel.style.overflow = "visible";
}

function onBeforeLeave(element: Element) {
  const panel = element as HTMLElement;
  clearTransitionTimer();
  panel.style.height = `${getBodyHeight(panel)}px`;
  panel.style.opacity = "1";
  panel.style.overflow = "hidden";
}

function onLeave(element: Element, done: () => void) {
  const panel = element as HTMLElement;
  applyTransitionStyles(panel);

  queueNextFrame(() => {
    panel.style.height = "0px";
    panel.style.opacity = "0";
  });

  waitForHeightTransition(panel, done);
}

function onAfterLeave(element: Element) {
  const panel = element as HTMLElement;
  clearTransitionTimer();
  resetTransitionStyles(panel);
  panel.style.height = "0px";
  panel.style.opacity = "0";
  panel.style.overflow = "hidden";
}

function onCancelled(element: Element) {
  const panel = element as HTMLElement;
  clearTransitionTimer();
  resetTransitionStyles(panel);

  if (props.expanded) {
    panel.style.height = "auto";
    panel.style.opacity = "1";
    panel.style.overflow = "visible";
  } else {
    panel.style.height = "0px";
    panel.style.opacity = "0";
    panel.style.overflow = "hidden";
  }
}

async function syncBodyHeightDuringTransition() {
  await nextTick();
  if (bodyWrapper.value && bodyWrapper.value.style.height !== "auto") {
    bodyWrapper.value.style.height = `${getBodyHeight(bodyWrapper.value)}px`;
  }
}

watch(
  () => cartStore.items.length,
  async () => {
    if (props.expanded) {
      await syncBodyHeightDuringTransition();
    }
  },
);

watch(
  expandedVariantProducts,
  async () => {
    if (props.expanded) {
      await syncBodyHeightDuringTransition();
    }
  },
  { deep: true },
);

function toggle() {
  emit("toggle", props.groupId);
}

function openReviewsModal() {
  showReviewsModal.value = true;
}

onMounted(async () => {
  try {
    const summary = await fetchGroupReviewSummary(props.groupId);
    reviewCount.value = summary.review_count;
    averageRating.value = summary.average_rating;
  } catch {
    reviewCount.value = 0;
    averageRating.value = null;
  } finally {
    reviewsLoaded.value = true;
  }
});

function formatPrice(value?: number | null) {
  if (value === null || value === undefined) return "-";
  return value.toLocaleString("ru-RU");
}

function getQuantity(productId: string): number {
  const item = cartStore.items.find((item) => item.productId === productId);
  return item ? item.quantity : 0;
}

function canAdd(product: Product) {
  if (product.isAvailable === false) {
    return false;
  }
  if (typeof product.stock === "number") {
    const stock = Math.max(product.stock, 0);
    if (stock === 0) {
      return false;
    }
    return getQuantity(product.id) < stock;
  }
  return true;
}

function isAtStockLimit(product: Product) {
  if (product.isAvailable === false) {
    return true;
  }
  if (typeof product.stock === "number") {
    const stock = Math.max(product.stock, 0);
    if (stock === 0) {
      return true;
    }
    return getQuantity(product.id) >= stock;
  }
  return false;
}

function handleAdd(product: Product) {
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
  addToCart(product);
}

function addToCart(product: Product) {
  cartStore.addItem(product, 1);
}

function handleIncrement(product: Product) {
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
  incrementQuantity(product);
}

function incrementQuantity(product: Product) {
  const currentQty = getQuantity(product.id);
  if (currentQty > 0) {
    cartStore.updateQuantity(product.id, currentQty + 1);
  } else {
    cartStore.addItem(product, 1);
  }
}

function decrementQuantity(product: Product) {
  const currentQty = getQuantity(product.id);
  if (currentQty > 1) {
    cartStore.updateQuantity(product.id, currentQty - 1);
  } else if (currentQty === 1) {
    cartStore.removeItem(product.id);
  }
}

// Функции для работы с товарами с вариантами
function isVariantProductExpanded(productId: string): boolean {
  return expandedVariantProducts.value[productId] ?? false;
}

function toggleVariantProductExpansion(productId: string) {
  expandedVariantProducts.value = {
    ...expandedVariantProducts.value,
    [productId]: !isVariantProductExpanded(productId),
  };
}

onBeforeUnmount(() => {
  clearTransitionTimer();
});

// Функции для работы с изображениями товаров
function getProductImage(product: Product): string | null {
  // Для товаров с вариантами берём изображение первого варианта
  if (
    product.hasVariants &&
    product.variants?.length &&
    product.variants[0].images?.length
  ) {
    return product.variants[0].images[0];
  }
  // Сначала проверяем загруженные изображения
  if (product.images?.[0]) {
    return product.images[0];
  }
  // Если нет изображений, ищем ссылку на картинку в links
  if (product.links?.length) {
    for (const link of product.links) {
      const url = link.url?.toLowerCase() || "";
      if (url.match(/\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i)) {
        return link.url;
      }
    }
    return product.links[0]?.url || null;
  }
  return null;
}

// Функции для работы с вариантами
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

function getVariantQuantity(variantId: string): number {
  const item = cartStore.items.find((item) => item.variantId === variantId);
  return item ? item.quantity : 0;
}

function canAddVariant(variant: {
  id?: string;
  stock?: number | null;
  isAvailable?: boolean;
}) {
  if (!variant.id) return false;
  if (variant.isAvailable === false) {
    return false;
  }
  if (typeof variant.stock === "number") {
    const stock = Math.max(variant.stock, 0);
    if (stock === 0) {
      return false;
    }
    return getVariantQuantity(variant.id) < stock;
  }
  return true;
}

function isVariantAtStockLimit(variant: {
  id?: string;
  stock?: number | null;
  isAvailable?: boolean;
}) {
  if (!variant.id) return true;
  if (variant.isAvailable === false) {
    return true;
  }
  if (typeof variant.stock === "number") {
    const stock = Math.max(variant.stock, 0);
    if (stock === 0) {
      return true;
    }
    return getVariantQuantity(variant.id) >= stock;
  }
  return false;
}

// Проверяет, есть ли вариант в наличии (stock > 0)
function isVariantInStock(variant: {
  id?: string;
  stock?: number | null;
  isAvailable?: boolean;
}) {
  if (variant.isAvailable === false) return false;
  if (typeof variant.stock === "number") {
    return variant.stock > 0;
  }
  // Если stock не указан, считаем что в наличии
  return true;
}

function handleVariantAdd(
  product: Product,
  variant: { id?: string; stock?: number | null; isAvailable?: boolean },
) {
  if (!variant.id) return;
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
  product: Product,
  variant: { id?: string; stock?: number | null; isAvailable?: boolean },
) {
  if (!variant.id) return;
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

function decrementVariantQuantity(product: Product, variant: { id?: string }) {
  if (!variant.id) return;
  const currentQty = getVariantQuantity(variant.id);
  if (currentQty > 1) {
    cartStore.updateQuantity(product.id, currentQty - 1, variant.id);
  } else if (currentQty === 1) {
    cartStore.removeItem(product.id, variant.id);
  }
}

// Функция для получения стиля цвета варианта
function getVariantColorStyle(variant: {
  colorCode?: string | null;
}): Record<string, string> {
  if (variant.colorCode) {
    return { backgroundColor: variant.colorCode };
  }
  return { backgroundColor: "#F5F7FA" };
}

// Проверка режима "картинка" (colorDisplayMode === 'image')
function isImageDisplayMode(variant: {
  colorDisplayMode?: 'color' | 'image';
}): boolean {
  return variant.colorDisplayMode === 'image';
}

// Получить изображение товара варианта (НЕ colorImage, а фото самого товара)
function getVariantProductImage(variant: { images?: string[] }): string | null {
  const url = Array.isArray(variant.images)
    ? variant.images.find((src) => typeof src === "string" && src.trim().length > 0)
    : null;
  return url ? url : null;
}

// Проверка, не загрузилось ли изображение
function isImageFailed(imageUrl: string): boolean {
  return failedImages.value.has(imageUrl);
}

// Обработка ошибки загрузки изображения
function handleImageError(event: Event, imageUrl: string) {
  failedImages.value.add(imageUrl);
  const img = event.target as HTMLImageElement;
  if (img) {
    img.style.display = "none";
  }
}

// Состояние для модального окна просмотра цвета
const colorPreviewOpen = ref(false);
const colorPreviewImage = ref<string | null>(null);
const colorPreviewTitle = ref("");

function openColorPreview(variant: {
  name: string;
  images?: string[];
}) {
  // При клике показываем фото ТОВАРА варианта (variant.images[0]), а НЕ colorImage
  const imageUrl = getVariantProductImage(variant);
  if (imageUrl && !isImageFailed(imageUrl)) {
    colorPreviewImage.value = imageUrl;
    colorPreviewTitle.value = variant.name;
    colorPreviewOpen.value = true;
  }
}

function closeColorPreview() {
  colorPreviewOpen.value = false;
}
</script>

<style scoped>
/* Figma Redesign - Карточка линейки жидкостей */
/* Плашка лежит на обложке линейки, ровно как на карточке категории. */
.liquid-line-image-box {
  position: relative;
  display: flex;
}

.liquid-line-discount {
  position: absolute;
  left: 50%;
  bottom: 6px;
  transform: translateX(-50%);
  padding: 3px 8px;
  font-size: 9px;
  line-height: 11px;
  letter-spacing: 0.04em;
}

/*
 * Старая цена того же размера и веса, что и новая: разный кегль сажает их на
 * разную высоту, и пара выглядит съехавшей. Отличается только цветом и
 * прозрачностью, чтобы взгляд цеплялся за новую цену.
 */
.liquid-line-image-price-old {
  color: #98a2b3;
  opacity: 0.6;
  text-decoration: line-through;
}

/* Старая цена и глубина скидки у позиции: одинаково у вкусов и у вариантов. */
.liquid-price-old {
  margin-right: 6px;
  color: #98a2b3;
  opacity: 0.6;
  text-decoration: line-through;
}

.liquid-price-drop {
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

.liquid-line-card {
  box-sizing: border-box;
  background: #ffffff;
  border-radius: 20px;
  padding: 16px;
  margin-bottom: 0;
}

.liquid-line-card:last-of-type {
  margin-bottom: 0;
}

.liquid-line-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  cursor: pointer;
}

.liquid-line-main {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  cursor: pointer;
  outline: none;
  min-width: 0;
}

.liquid-line-image-wrapper {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  position: relative;
}

.liquid-line-top-rank {
  position: absolute;
  top: -4px;
  left: -4px;
  z-index: 2;
  min-width: 28px;
  height: 28px;
  padding: 0 6px;
  border-radius: 999px;
  background: #e60000;
  border: 2px solid #ffffff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: "Montserrat", sans-serif;
  font-size: 11px;
  font-weight: 800;
  color: #ffffff;
  box-shadow: 0 4px 10px rgba(230, 0, 0, 0.35);
}

.liquid-line-image {
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

.liquid-line-image img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.liquid-line-image-placeholder {
  background: #fafafa;
}

.liquid-line-image-price {
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
  /* Цифры одной ширины: иначе 16 и 17 встают под обложкой с разным отступом. */
  font-variant-numeric: tabular-nums;
}

.liquid-line-image-price-amount {
  color: var(--navalivay-red, #d32f2f);
}

.liquid-line-image-price-currency {
  color: #191919;
}

.liquid-line-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.liquid-line-title {
  margin: 0;
  font-family: "Montserrat", sans-serif;
  font-style: normal;
  font-weight: 700;
  font-size: 16px;
  line-height: 20px;
  color: #191919;
}

.liquid-line-meta {
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

.liquid-reviews-link {
  margin: 0;
  padding: 0;
  border: none;
  background: none;
  align-self: flex-start;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 13px;
  line-height: 16px;
  color: #5c6470;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}

.liquid-line-side {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-shrink: 0;
}

.liquid-line-toggle {
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

.liquid-line-toggle:hover {
  background: #e6e9ed;
}

.liquid-line-toggle.expanded .liquid-line-toggle-icon {
  transform: rotate(-90deg) rotate(90deg);
}

.liquid-line-toggle-icon {
  width: 12px;
  height: 12px;
  color: #191919;
  transition: transform 0.3s ease;
  transform: rotate(-90deg);
}

/* ========== Подлинейки (sublines) ========== */
.liquid-sublines {
  margin-top: 0;
}

.liquid-subline-card {
  position: relative;
}

.liquid-subline-divider {
  width: 100%;
  height: 1px;
  background: #e6e9ed;
  margin: 16px 0;
}

.liquid-subline-header {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
}

.liquid-subline-image-wrapper {
  flex-shrink: 0;
}

.liquid-subline-image {
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

.liquid-subline-image img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.liquid-subline-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.liquid-subline-title {
  margin: 0;
  font-family: "Montserrat", sans-serif;
  font-style: normal;
  font-weight: 700;
  font-size: 16px;
  line-height: 20px;
  color: #191919;
}

.liquid-subline-description {
  margin: 0;
  font-family:
    "SF Pro Display",
    -apple-system,
    BlinkMacSystemFont,
    sans-serif;
  font-style: normal;
  font-weight: 400;
  font-size: 14px;
  line-height: 17px;
  color: #aab2bd;
}

.liquid-subline-price {
  margin: 0;
  font-family: "Montserrat", sans-serif;
  font-style: normal;
  font-weight: 700;
  font-size: 20px;
  line-height: 24px;
  color: #191919;
}

.liquid-subline-toggle {
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

.liquid-subline-toggle:hover {
  background: #e6e9ed;
}

.liquid-subline-toggle.expanded .liquid-subline-toggle-icon {
  transform: rotate(180deg);
}

.liquid-subline-toggle-icon {
  width: 12px;
  height: 12px;
  color: #191919;
  transition: transform 0.3s ease;
  transform: rotate(90deg);
}

/* ========== Список вариантов (variants) ========== */
.liquid-variants-list {
  margin-top: 16px;
}

.liquid-variant-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 0;
  border-bottom: 1px solid #e6e9ed;
}

.liquid-variant-row:first-child {
  padding-top: 0;
}

.liquid-variant-row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

/* Превью варианта (круглое изображение) */
.liquid-variant-preview {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 50%;
  overflow: hidden;
  border: 1px solid #e6e9ed;
}

.liquid-variant-preview-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}


/* Инфо варианта (название + ссылка) */
.liquid-variant-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.liquid-variant-title {
  font-family: "Montserrat", sans-serif;
  font-style: normal;
  font-weight: 700;
  font-size: 16px;
  line-height: 20px;
  color: #191919;
}

.liquid-variant-price {
  font-family: "Montserrat", sans-serif;
  font-style: normal;
  font-weight: 700;
  font-size: 16px;
  line-height: 20px;
  color: var(--navalivay-red, #d32f2f);
}

.liquid-variant-color-link {
  background: none;
  border: none;
  padding: 0;
  margin: 0;
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
  text-align: left;
  text-decoration: none;
}

.liquid-variant-color-link:hover {
  text-decoration: underline;
}

.liquid-variant-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* ========== Новые кнопки +/- согласно Figma ========== */
.liquid-qty-btn {
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

.liquid-qty-btn:hover:not(:disabled):not(.is-disabled) {
  background: #e6e9ed;
}

.liquid-qty-btn.is-disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.liquid-qty-btn.is-first {
  opacity: 0.4;
}

.liquid-qty-btn-minus {
  background: #f5f7fa;
}

.liquid-qty-btn-plus,
.liquid-qty-btn-add {
  background: #f5f7fa;
}

.liquid-qty-icon {
  width: 18px;
  height: 18px;
  color: #191919;
  stroke-width: 2;
}

.liquid-qty-field {
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

/* ========== Анимация раскрытия подлинейки ========== */
.subline-expand-enter-active {
  transition:
    max-height 0.4s ease,
    opacity 0.3s ease;
  overflow: hidden;
}

.subline-expand-leave-active {
  transition:
    max-height 0.3s ease,
    opacity 0.2s ease;
  overflow: hidden;
}

.subline-expand-enter-from,
.subline-expand-leave-to {
  max-height: 0;
  opacity: 0;
}

.subline-expand-enter-to,
.subline-expand-leave-from {
  max-height: 1000px;
  opacity: 1;
}

/* ========== Список вкусов (обычные товары) ========== */
.liquid-flavor-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.liquid-flavor-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 0;
  border-bottom: 1px solid #e6e9ed;
}

.liquid-flavor-row:first-child {
  border-top: 1px solid #e6e9ed;
  margin-top: 16px;
}

.liquid-flavor-row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.liquid-flavor-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.liquid-flavor-title {
  font-family: "Montserrat", sans-serif;
  font-style: normal;
  font-weight: 700;
  font-size: 16px;
  line-height: 20px;
  color: #191919;
}

.liquid-flavor-price {
  font-family: "Montserrat", sans-serif;
  font-style: normal;
  font-weight: 700;
  font-size: 16px;
  line-height: 20px;
  color: var(--navalivay-red, #d32f2f);
}

.liquid-flavor-actions {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.liquid-line-body-wrapper {
  overflow: hidden;
}

.liquid-line-body {
  margin-top: 0;
  padding: 0;
}

/* Адаптивные стили */

@media (max-width: 1024px) {
  .liquid-line-card {
    padding: 16px;
  }

  .liquid-line-image {
    width: 88px;
    height: 104px;
    border-radius: 16px;
    padding: 6px;
  }

  .liquid-line-image img {
    max-width: 100%;
    max-height: 100%;
  }

  .liquid-subline-image {
    width: 88px;
    height: 104px;
    border-radius: 16px;
    padding: 6px;
  }

  .liquid-subline-image img {
    max-width: 100%;
    max-height: 100%;
  }

  .liquid-line-title {
    font-size: 16px;
    line-height: 20px;
  }

  .liquid-line-image-price {
    font-size: 16px;
    line-height: 20px;
  }

  .liquid-subline-title {
    font-size: 16px;
    line-height: 20px;
  }

  .liquid-line-toggle {
    width: 40px;
    height: 40px;
  }

  .liquid-subline-toggle {
    width: 40px;
    height: 40px;
  }

  .liquid-line-toggle-icon {
    width: 12px;
    height: 12px;
  }

  .liquid-subline-toggle-icon {
    width: 12px;
    height: 12px;
  }

  .liquid-subline-price {
    font-size: 18px;
  }

  .liquid-qty-btn {
    width: 36px;
    height: 36px;
  }

  .liquid-qty-field {
    width: 36px;
    height: 36px;
    font-size: 15px;
  }
}

@media (max-width: 768px) {
  .liquid-line-card {
    padding: 16px;
    border-radius: 20px;
    margin-bottom: 0;
  }

  .liquid-line-header {
    gap: 10px;
  }

  .liquid-subline-header {
    gap: 12px;
  }

  .liquid-line-main {
    gap: 12px;
  }

  .liquid-line-image {
    width: 88px;
    height: 104px;
    border-radius: 16px;
    padding: 6px;
  }

  .liquid-line-image img {
    max-width: 100%;
    max-height: 100%;
  }

  .liquid-subline-image {
    width: 88px;
    height: 104px;
    border-radius: 16px;
    padding: 6px;
  }

  .liquid-subline-image img {
    max-width: 100%;
    max-height: 100%;
  }

  .liquid-line-info {
    gap: 6px;
  }

  .liquid-line-title {
    font-size: 16px;
    line-height: 20px;
  }

  .liquid-line-image-price {
    font-size: 15px;
    line-height: 19px;
  }

  .liquid-subline-title {
    font-size: 16px;
    line-height: 20px;
  }

  .liquid-line-toggle {
    width: 40px;
    height: 40px;
  }

  .liquid-subline-toggle {
    width: 40px;
    height: 40px;
  }

  .liquid-line-toggle-icon {
    width: 12px;
    height: 12px;
  }

  .liquid-subline-toggle-icon {
    width: 12px;
    height: 12px;
  }

  .liquid-subline-description {
    font-size: 13px;
  }

  .liquid-subline-price {
    font-size: 16px;
    line-height: 20px;
  }

  .liquid-flavor-row,
  .liquid-variant-row {
    padding: 12px 0;
  }

  .liquid-flavor-title,
  .liquid-variant-title {
    font-size: 15px;
  }

  .liquid-flavor-price,
  .liquid-variant-price {
    font-size: 15px;
  }

  .liquid-qty-btn {
    width: 34px;
    height: 34px;
  }

  .liquid-qty-field {
    width: 34px;
    height: 34px;
    font-size: 14px;
    border-radius: 10px;
  }

  .liquid-qty-icon {
    width: 16px;
    height: 16px;
  }
}

@media (max-width: 480px) {
  .liquid-line-card {
    padding: 16px;
    border-radius: 20px;
  }

  .liquid-line-header {
    gap: 10px;
  }

  .liquid-subline-header {
    gap: 12px;
  }

  .liquid-line-main {
    gap: 12px;
  }

  .liquid-line-image {
    width: 88px;
    height: 104px;
    border-radius: 16px;
    padding: 6px;
  }

  .liquid-line-image img {
    max-width: 100%;
    max-height: 100%;
  }

  .liquid-subline-image {
    width: 88px;
    height: 104px;
    border-radius: 16px;
    padding: 6px;
  }

  .liquid-subline-image img {
    max-width: 100%;
    max-height: 100%;
  }

  .liquid-line-info {
    gap: 6px;
  }

  .liquid-line-title {
    font-size: 16px;
    line-height: 20px;
  }

  .liquid-line-image-price {
    font-size: 14px;
    line-height: 18px;
  }

  .liquid-subline-title {
    font-size: 15px;
    line-height: 19px;
  }

  .liquid-line-toggle {
    width: 40px;
    height: 40px;
  }

  .liquid-subline-toggle {
    width: 40px;
    height: 40px;
  }

  .liquid-line-toggle-icon {
    width: 12px;
    height: 12px;
  }

  .liquid-subline-toggle-icon {
    width: 12px;
    height: 12px;
  }

  .liquid-subline-divider {
    margin: 12px 0;
  }

  .liquid-subline-description {
    font-size: 12px;
  }

  .liquid-subline-price {
    font-size: 14px;
    line-height: 18px;
  }

  .liquid-flavor-row,
  .liquid-variant-row {
    padding: 10px 0;
  }

  .liquid-flavor-title,
  .liquid-variant-title {
    font-size: 14px;
    line-height: 18px;
  }

  .liquid-flavor-price,
  .liquid-variant-price {
    font-size: 14px;
    line-height: 18px;
  }

  .liquid-qty-btn {
    width: 32px;
    height: 32px;
  }

  .liquid-qty-field {
    width: 32px;
    height: 32px;
    font-size: 13px;
    border-radius: 8px;
  }

  .liquid-qty-icon {
    width: 14px;
    height: 14px;
  }

  .liquid-variant-actions,
  .liquid-flavor-actions {
    gap: 6px;
  }
}

@media (max-width: 360px) {
  .liquid-line-card {
    padding: 14px;
    border-radius: 18px;
  }

  .liquid-line-header {
    gap: 8px;
  }

  .liquid-subline-header {
    gap: 10px;
  }

  .liquid-line-main {
    gap: 10px;
  }

  .liquid-line-image {
    width: 80px;
    height: 96px;
    border-radius: 14px;
    padding: 4px;
  }

  .liquid-line-image img {
    max-width: 100%;
    max-height: 100%;
  }

  .liquid-subline-image {
    width: 80px;
    height: 96px;
    border-radius: 14px;
    padding: 4px;
  }

  .liquid-subline-image img {
    max-width: 100%;
    max-height: 100%;
  }

  .liquid-line-info {
    gap: 5px;
  }

  .liquid-line-title {
    font-size: 15px;
    line-height: 19px;
  }

  .liquid-line-image-price {
    font-size: 13px;
    line-height: 17px;
  }

  .liquid-subline-title {
    font-size: 14px;
    line-height: 18px;
  }


  .liquid-line-toggle {
    width: 36px;
    height: 36px;
  }

  .liquid-subline-toggle {
    width: 36px;
    height: 36px;
  }

  .liquid-line-toggle-icon {
    width: 11px;
    height: 11px;
  }

  .liquid-subline-toggle-icon {
    width: 11px;
    height: 11px;
  }

  .liquid-subline-divider {
    margin: 10px 0;
  }

  .liquid-subline-description {
    font-size: 11px;
  }

  .liquid-subline-price {
    font-size: 13px;
    line-height: 16px;
  }

  .liquid-flavor-row,
  .liquid-variant-row {
    padding: 8px 0;
  }

  .liquid-flavor-title,
  .liquid-variant-title {
    font-size: 13px;
    line-height: 16px;
  }

  .liquid-flavor-price,
  .liquid-variant-price {
    font-size: 13px;
    line-height: 16px;
  }

  .liquid-qty-btn {
    width: 28px;
    height: 28px;
  }

  .liquid-qty-field {
    width: 28px;
    height: 28px;
    font-size: 12px;
    border-radius: 6px;
  }

  .liquid-qty-icon {
    width: 12px;
    height: 12px;
  }

  .liquid-variant-actions,
  .liquid-flavor-actions {
    gap: 4px;
  }
}
</style>
