<template>
  <div class="group-line-card" :class="{ expanded: isExpanded }">
    <NewLineupBadge v-if="node.isNew" />
    <button
      :id="headerId"
      type="button"
      class="group-line-header"
      :aria-expanded="isExpanded"
      :aria-controls="panelId"
      @click="toggle"
    >
      <span class="group-line-main">
        <span class="group-line-image-wrapper">
          <span v-if="topRank" class="group-line-top-rank">#{{ topRank }}</span>
          <span class="group-line-image-box">
            <span v-if="coverImage" class="group-line-image">
              <img :src="coverImage" :alt="node.name" loading="lazy" decoding="async" />
            </span>
            <span v-else class="group-line-image group-line-image-placeholder">
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
            </span>
            <DiscountBadge v-if="hasDiscount" class="group-line-discount" />
          </span>
          <span v-if="firstProductPrice" class="group-line-image-price">
            <span class="group-line-image-price-amount">{{ formatPrice(firstProductPrice) }}</span>
            <span class="group-line-image-price-currency">BYN</span>
          </span>
        </span>

        <span class="group-line-info">
          <span class="group-line-title">{{ node.name }}</span>
          <span v-if="metaText" class="group-line-meta">{{ metaText }}</span>
          <ReviewRatingLink
            v-if="showReviewSummary"
            :ready="reviewsLoaded"
            :count="reviewCount"
            :average-rating="averageRating"
            :mode="reviewDisplayMode"
            @click="openReviewsModal"
          />
        </span>
      </span>

      <span class="group-line-side">
        <span class="group-line-toggle" :class="{ expanded: isExpanded }" aria-hidden="true">
          <ChevronDownIcon class="group-line-toggle-icon" />
        </span>
      </span>
    </button>

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
        v-if="isExpanded"
        :id="panelId"
        ref="bodyWrapper"
        class="group-line-body-wrapper"
        role="region"
        :aria-labelledby="headerId"
      >
        <div class="group-line-body">
          <GroupLineItemContent
            :node="node"
            :category-image="categoryImage"
            @showToast="forwardToast"
          />

          <div v-if="node.children.length" class="group-line-children">
            <GroupLineItem
              v-for="child in node.children"
              :key="child.id"
              :node="child"
              :top-rank="resolveChildTopRank(child.id)"
              :top-rank-by-group-id="topRankByGroupId"
              :category-image="categoryImage"
              :expanded-groups="expandedGroups"
              @toggle="$emit('toggle', $event)"
              @productClick="$emit('productClick', $event)"
              @heightChanged="handleNestedHeightChanged"
              @showToast="forwardToast"
            />
          </div>
        </div>
      </div>
    </Transition>

    <GroupReviewsModal
      :open="showReviewsModal"
      :group-id="node.id"
      :group-name="node.name"
      @close="showReviewsModal = false"
    />
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
} from "vue";
import GroupReviewsModal from "@/components/reviews/GroupReviewsModal.vue";
import ReviewRatingLink from "@/components/reviews/ReviewRatingLink.vue";
import {
  isParentGroupLine,
  shouldShowGroupReviewSummary,
} from "@/utils/groupReviewDisplay";
import { useCustomerOrders } from "@/composables/useCustomerOrders";
import { ChevronDownIcon } from "@heroicons/vue/24/outline";
import { useCatalogStore, type Product } from "@/stores/catalog";
import GroupLineItemContent from "@/components/product/GroupLineItemContent.vue";
import NewLineupBadge from "@/components/product/NewLineupBadge.vue";
import DiscountBadge from "@/components/product/DiscountBadge.vue";
import { getMinBasePriceForProducts, hasDiscountInTree } from "@/components/product/groupPrice";

const GroupLineItem = defineAsyncComponent(
  () => import("@/components/product/GroupLineItem.vue"),
);

interface GroupNode {
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
  isNew?: boolean;
  newSince?: string | null;
  children: GroupNode[];
  products: Product[];
}

const props = defineProps<{
  categoryImage?: string | null;
  node: GroupNode;
  expandedGroups: Record<string, boolean>;
  topRank?: number | null;
  topRankByGroupId?: Record<string, number>;
}>();

const emit = defineEmits<{
  (e: "toggle", groupId: string): void;
  (e: "productClick", product: Product): void;
  (e: "showToast", message: string, type: "error" | "success" | "info"): void;
  (e: "heightChanged"): void;
}>();

const catalogStore = useCatalogStore();
const { fetchGroupReviewSummary } = useCustomerOrders();
const bodyWrapper = ref<HTMLElement | null>(null);
const reviewCount = ref(0);
const averageRating = ref<number | null>(null);
const reviewsLoaded = ref(false);
const showReviewsModal = ref(false);
const showReviewSummary = computed(() => shouldShowGroupReviewSummary(props.node));
const reviewDisplayMode = computed(() =>
  isParentGroupLine(props.node) ? "parent" : "leaf",
);
const headerId = computed(() => `group-line-header-${props.node.id}`);
const panelId = computed(() => `group-line-panel-${props.node.id}`);
const isExpanded = computed(() => props.expandedGroups[props.node.id] ?? false);
const coverImage = computed(
  () => props.node.coverImage || catalogStore.getGroupImage(props.node.id) || null,
);

function resolveChildTopRank(groupId: string): number | null {
  return props.topRankByGroupId?.[groupId] ?? null;
}

let transitionTimer: ReturnType<typeof setTimeout> | null = null;

const totalProductCount = computed(() => {
  return props.node.products.length + props.node.children.reduce((count, child) => {
    return count + (child.totalProductCount ?? child.productCount ?? 0);
  }, 0);
});

const firstProductPrice = computed(() => {
  if (props.node.children.length > 0) return null;
  // Скидка на отдельный вкус цену линейки не занижает: остальные вкусы
  // продаются по-старому.
  return getMinBasePriceForProducts(props.node.products);
});

/** Плашка: скидка где угодно в линейке, включая вложенные. */
const hasDiscount = computed(() => hasDiscountInTree(props.node));

const metaText = computed(() => {
  const label = (props.node.metaLabel ?? "").trim();
  const value = (props.node.metaValue ?? "").trim();
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
  emit("heightChanged");
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
  emit("heightChanged");
}

function onCancelled(element: Element) {
  const panel = element as HTMLElement;
  clearTransitionTimer();
  resetTransitionStyles(panel);

  if (isExpanded.value) {
    panel.style.height = "auto";
    panel.style.opacity = "1";
    panel.style.overflow = "visible";
  } else {
    panel.style.height = "0px";
    panel.style.opacity = "0";
    panel.style.overflow = "hidden";
  }
}

async function handleNestedHeightChanged() {
  await nextTick();
  if (bodyWrapper.value && bodyWrapper.value.style.height !== "auto") {
    bodyWrapper.value.style.height = `${getBodyHeight(bodyWrapper.value)}px`;
  }
  emit("heightChanged");
}

function toggle() {
  emit("toggle", props.node.id);
}

function openReviewsModal() {
  showReviewsModal.value = true;
}

onMounted(async () => {
  try {
    const summary = await fetchGroupReviewSummary(props.node.id);
    reviewCount.value = summary.review_count;
    averageRating.value = summary.average_rating;
  } catch {
    reviewCount.value = 0;
    averageRating.value = null;
  } finally {
    reviewsLoaded.value = true;
  }
});

function forwardToast(
  message: string,
  type: "error" | "success" | "info",
) {
  emit("showToast", message, type);
}

function formatPrice(value?: number | null) {
  if (value === null || value === undefined) return "-";
  return value.toLocaleString("ru-RU");
}

onBeforeUnmount(() => {
  clearTransitionTimer();
});
</script>

<style scoped>
.group-line-card {
  box-sizing: border-box;
  background: #ffffff;
  border-radius: 20px;
  padding: 16px;
  margin-bottom: 0;
}

.group-line-card:last-of-type {
  margin-bottom: 0;
}

/* Плашка лежит на обложке линейки, ровно как на карточке категории. */
.group-line-image-box {
  position: relative;
  display: flex;
}

.group-line-discount {
  position: absolute;
  left: 50%;
  bottom: 6px;
  transform: translateX(-50%);
  padding: 3px 8px;
  font-size: 9px;
  line-height: 11px;
  letter-spacing: 0.04em;
}

.group-line-header {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.group-line-header:focus-visible {
  outline: 2px solid rgba(25, 25, 25, 0.18);
  outline-offset: 4px;
  border-radius: 20px;
}

.group-line-main {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.group-line-image-wrapper {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  position: relative;
}

.group-line-top-rank {
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

.group-line-image {
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

.group-line-image img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.group-line-image-placeholder {
  background: #fafafa;
}

.group-line-image-price {
  display: inline-flex;
  align-items: baseline;
  justify-content: center;
  gap: 4px;
  margin: 0;
  font-family: "Montserrat", sans-serif;
  font-style: normal;
  font-weight: 700;
  font-size: 16px;
  line-height: 20px;
  white-space: nowrap;
}

.group-line-image-price-amount {
  color: var(--navalivay-red, #d32f2f);
}

.group-line-image-price-currency {
  color: #191919;
}

.group-line-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.group-line-title,
.group-line-meta {
  display: block;
  margin: 0;
}

.group-line-title {
  font-family: "Montserrat", sans-serif;
  font-style: normal;
  font-weight: 700;
  font-size: 16px;
  line-height: 20px;
  color: #191919;
}

.group-line-meta {
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

.group-reviews-link {
  margin-top: 4px;
  padding: 0;
  border: none;
  background: none;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 13px;
  line-height: 16px;
  color: #5c6470;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}

.group-line-side {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-shrink: 0;
}

.group-line-toggle {
  width: 40px;
  height: 40px;
  border-radius: 512px;
  background: #f5f7fa;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    background-color 0.2s ease,
    transform 0.2s ease;
  flex-shrink: 0;
}

.group-line-header:hover .group-line-toggle {
  background: #e6e9ed;
}

.group-line-toggle.expanded .group-line-toggle-icon {
  transform: rotate(0deg);
}

.group-line-toggle-icon {
  width: 12px;
  height: 12px;
  color: #191919;
  transition: transform 0.3s ease;
  transform: rotate(-90deg);
}

.group-line-body-wrapper {
  overflow: hidden;
}

.group-line-body {
  margin-top: 0;
  padding: 0;
}

.group-line-children {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

@media (max-width: 1024px) {
  .group-line-card {
    padding: 16px;
  }

  .group-line-image {
    width: 88px;
    height: 104px;
    border-radius: 16px;
    padding: 6px;
  }

  .group-line-image img {
    max-width: 100%;
    max-height: 100%;
  }

  .group-line-title {
    font-size: 16px;
    line-height: 20px;
  }

  .group-line-image-price {
    font-size: 16px;
    line-height: 20px;
  }

  .group-line-header {
    gap: 10px;
  }

  .group-line-main {
    gap: 12px;
  }

  .group-line-toggle {
    width: 40px;
    height: 40px;
  }

  .group-line-toggle-icon {
    width: 12px;
    height: 12px;
  }
}

@media (max-width: 768px) {
  .group-line-card {
    padding: 16px;
    border-radius: 20px;
    margin-bottom: 0;
  }

  .group-line-header {
    gap: 10px;
  }

  .group-line-main {
    gap: 12px;
  }

  .group-line-image {
    width: 88px;
    height: 104px;
    border-radius: 16px;
    padding: 6px;
  }

  .group-line-image img {
    max-width: 100%;
    max-height: 100%;
  }

  .group-line-info {
    gap: 6px;
  }

  .group-line-title {
    font-size: 16px;
    line-height: 20px;
  }

  .group-line-image-price {
    font-size: 15px;
    line-height: 19px;
  }

  .group-line-toggle {
    width: 40px;
    height: 40px;
  }

  .group-line-toggle-icon {
    width: 12px;
    height: 12px;
  }
}

@media (max-width: 480px) {
  .group-line-card {
    padding: 16px;
    border-radius: 20px;
  }

  .group-line-header {
    gap: 10px;
  }

  .group-line-main {
    gap: 12px;
  }

  .group-line-image {
    width: 88px;
    height: 104px;
    border-radius: 16px;
    padding: 6px;
  }

  .group-line-image img {
    max-width: 100%;
    max-height: 100%;
  }

  .group-line-info {
    gap: 6px;
  }

  .group-line-title {
    font-size: 16px;
    line-height: 20px;
  }

  .group-line-image-price {
    font-size: 14px;
    line-height: 18px;
  }

  .group-line-toggle {
    width: 40px;
    height: 40px;
  }

  .group-line-toggle-icon {
    width: 12px;
    height: 12px;
  }
}

@media (max-width: 360px) {
  .group-line-card {
    padding: 14px;
    border-radius: 18px;
  }

  .group-line-header {
    gap: 8px;
  }

  .group-line-main {
    gap: 10px;
  }

  .group-line-image {
    width: 80px;
    height: 96px;
    border-radius: 14px;
    padding: 4px;
  }

  .group-line-image img {
    max-width: 100%;
    max-height: 100%;
  }

  .group-line-info {
    gap: 5px;
  }

  .group-line-title {
    font-size: 15px;
    line-height: 19px;
  }

  .group-line-image-price {
    font-size: 13px;
    line-height: 17px;
  }

  .group-line-toggle {
    width: 36px;
    height: 36px;
  }

  .group-line-toggle-icon {
    width: 11px;
    height: 11px;
  }
}
</style>
