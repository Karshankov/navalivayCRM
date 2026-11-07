<template>
  <div class="min-h-screen" style="background: #f5f7fa">
    <SmokeParticles :count="4" area="full" />

    <!-- Хедер категории удалён: название показывают кнопки быстрой
         навигации снизу, выход — «На главную» в верхней панели. -->

    <!-- Плавная смена экрана категории: контент мягко уходит вниз
         с растворением и приходит снизу при переключении в панели. -->
    <Transition name="qnav-screen" mode="out-in">
      <div :key="screenKey" class="qnav-screen">
        <div v-if="showCompatibilityNotice" class="compatibility-notice-sticky">
          <div class="compatibility-notice-inner">
            <CompatibilityNotice />
          </div>
        </div>

        <div class="main-content-wrapper">
          <div v-if="showCategoryFilters" class="category-content">
            <CategoryFilterBar
              :profile="storefrontFiltersProfile"
              :top-active="filterTopActive"
              :strength-tier="filterStrengthTier"
              :top-loading="filterTopSalesLoading"
              :discount-active="filterDiscountActive"
              :discount-count="discountedGroupsCount"
              @toggle-top="toggleTopFilter()"
              @toggle-strength="toggleStrengthFilter($event)"
              @toggle-discount="toggleDiscountFilter()"
            />
          </div>

      <!-- Cross-sell товары (без заголовка, первыми) -->
      <div
        v-if="crossSellItems.length && !wholesaleStore.isWholesale"
        ref="crossSellContainer"
        class="category-content"
      >
        <SingleProductCard
          v-for="item in crossSellItems"
          :key="item.id"
          :product="item"
          :quantity="getCrossSellQuantity(item.id)"
          @add="handleCrossSellAdd(item, $event)"
          @increment="handleCrossSellIncrement(item, $event)"
          @decrement="decrementCrossSellQuantity(item)"
        />
      </div>

      <section class="category-content">
        <Transition name="fade" mode="out-in">
          <div
            v-if="groupCards.length && !showLiquidShowcase && activeGroupCard"
            key="group-focus"
            class="group-focus-panel"
          >
            <div class="group-focus-media" :style="groupFocusStyle"></div>
            <div class="group-focus-overlay"></div>
            <div class="group-focus-content">
              <div class="group-focus-top">
                <button class="back-chip" @click="backToGroups">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                  {{ selectedCategory?.name }}
                </button>
                <span class="group-focus-count"
                  >{{
                    activeGroupCard?.totalProductCount ??
                    activeGroupCard?.productCount
                  }}
                  вкусов</span
                >
              </div>
              <h3 class="group-focus-title">{{ activeGroupCard?.name }}</h3>
              <p class="group-focus-meta">
                Линейка выбрана и готова к просмотру
              </p>
            </div>
          </div>

          <div
            v-else-if="groupCards.length && !showLiquidShowcase"
            key="group-list"
            class="group-list-container"
          >
            <GroupLineItem
              v-for="group in filteredGroupCards"
              :key="group.id"
              :node="group"
              :top-rank="categoryFilters.getTopRank(group.id)"
              :top-rank-by-group-id="filterTopActive ? topRankMap : undefined"
              :category-image="selectedCategory?.coverImage"
              :expanded-groups="groupExpansionState"
              @toggle="toggleGroupExpansion"
              @productClick="openProduct"
              @heightChanged="() => {}"
              @showToast="showToast"
            />
          </div>
        </Transition>

        <p
          v-if="!filteredGroupCards.length && !showLiquidShowcase && groupCards.length"
          class="text-gray-600 bg-gray-100 border border-dashed border-gray-300 rounded-xl px-5 py-4 text-sm font-medium"
        >
          По выбранным фильтрам линеек не найдено. Сбросьте фильтры и попробуйте
          снова.
        </p>

        <p
          v-else-if="!groupCards.length && !showLiquidShowcase"
          class="text-gray-600 bg-gray-100 border border-dashed border-gray-300 rounded-xl px-5 py-4 text-sm font-medium"
        >
          Для категории пока не добавлены подгруппы - товары будут показаны в
          общем списке ниже.
        </p>

        <section
          v-if="showLiquidShowcase"
          class="liquid-showcase-container"
          ref="ungroupedContainer"
        >
          <!-- NiCa Booster - always first -->
          <SingleProductCard
            v-if="nicaBoosterProduct"
            :product="nicaBoosterProduct"
            :quantity="getUngroupedQuantity(nicaBoosterProduct.id)"
            @add="handleUngroupedAdd(nicaBoosterProduct, $event)"
            @increment="handleUngroupedIncrement(nicaBoosterProduct, $event)"
            @decrement="decrementUngroupedQuantity(nicaBoosterProduct)"
          />

          <p
            v-if="!filteredLiquidGroups.length && liquidGroups.length"
            class="text-gray-600 bg-gray-100 border border-dashed border-gray-300 rounded-xl px-5 py-4 text-sm font-medium"
          >
            По выбранным фильтрам линеек не найдено. Сбросьте фильтры и попробуйте
            снова.
          </p>

          <LiquidLineTree
            v-for="group in filteredLiquidGroups"
            :key="group.id"
            :group="group"
            :top-rank="categoryFilters.getTopRank(group.id)"
            :top-rank-by-group-id="filterTopActive ? topRankMap : undefined"
            :fallback-image="selectedCategory?.coverImage || PLACEHOLDER_IMAGE"
            :expanded-groups="liquidExpansionState"
            @toggle="toggleLiquidExpansion"
            @heightChanged="() => {}"
              @showToast="showToast"
          />

          <SingleProductCard
            v-for="product in liquidUngrouped"
            :key="product.id"
            :product="product"
            :quantity="getUngroupedQuantity(product.id)"
            @add="handleUngroupedAdd(product, $event)"
            @increment="handleUngroupedIncrement(product, $event)"
            @decrement="decrementUngroupedQuantity(product)"
          />
        </section>
      </section>

      <section v-if="showProducts" class="mt-12 category-content">
        <div class="flex items-center justify-between mb-6">
          <button
            class="back-chip"
            @click="catalogStore.activeGroup ? backToGroups() : goBack()"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
            {{
              catalogStore.activeGroup
                ? "Назад к подгруппам"
                : "Назад к категориям"
            }}
          </button>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          <template
            v-if="
              catalogStore.isLoading && !catalogStore.filteredProducts.length
            "
          >
            <div
              v-for="n in 8"
              :key="`skeleton-${n}`"
              class="animate-pulse"
            >
              <div class="aspect-square bg-gray-200 rounded-lg mb-3" />
              <div class="h-4 bg-gray-200 mb-2 rounded" />
              <div class="h-5 bg-gray-200 w-3/4 rounded" />
            </div>
          </template>

          <div
            v-for="product in catalogStore.filteredProducts"
            :key="product.id"
            class="product-card"
            @click="openProduct(product)"
          >
            <div class="product-card-media">
              <div
                v-if="getProductBadges(product).length"
                class="product-card-badges"
              >
                <span
                  v-for="(badge, index) in getProductBadges(product)"
                  :key="`${badge.type || 'badge'}-${index}`"
                  class="product-card-badge"
                  :style="getBadgeStyle(badge)"
                >
                  {{ getBadgeLabel(badge) }}
                </span>
              </div>
              <img
                v-if="getProductImage(product)"
                :src="getProductImage(product)!"
                :alt="product.title"
                loading="lazy"
              />
              <div v-else class="media-placeholder">
                <PhotoIcon class="w-10 h-10 text-gray-300" />
              </div>
            </div>
            <div class="product-card-body">
              <p class="product-card-price">
                <span class="product-card-price-amount">{{ formatPrice(product.priceRub) }}</span>
                <span class="product-card-price-currency">BYN</span>
              </p>
              <p class="product-card-title">
                {{ product.title || "Без названия" }}
              </p>
              <p v-if="product.variant" class="product-card-variant">
                {{ product.variant }}
              </p>
            </div>
          </div>
        </div>

        <div
          v-if="
            !catalogStore.isLoading && !catalogStore.filteredProducts.length
          "
          class="text-center py-20"
        >
          <ExclamationTriangleIcon
            class="w-16 h-16 text-gray-400 mx-auto mb-4"
          />
          <h3 class="text-xl font-bold text-black mb-3">Товары не найдены</h3>
          <p class="text-gray-600 mb-6">
            Выберите другую категорию или подгруппу
          </p>
          <button
            @click="catalogStore.activeGroup ? backToGroups() : goBack()"
            class="btn-navalivay"
          >
            <span>Вернуться</span>
          </button>
        </div>
      </section>
        </div>
      </div>
    </Transition>

    <!-- Быстрая навигация по категориям: закреплена снизу, не
         пропадает внутри «Наш ассортимент» — переключение экранов. -->
    <div class="qnav-dock">
      <CategoryQuickNav />
    </div>

    <!-- Toast Notification -->
    <ToastNotification
      v-if="toastMessage"
      :key="toastKey"
      :message="toastMessage"
      :type="toastType"
      :duration="toastDuration"
      :bottom-offset="toastBottomOffset"
      @close="toastMessage = ''"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from "vue";
import { useRouter, useRoute } from "vue-router";
import { ExclamationTriangleIcon, PhotoIcon } from "@heroicons/vue/24/outline";

import {
  useCatalogStore,
  type Product,
  type Category,
  type CategoryGroup,
  type ProductBadge,
} from "@/stores/catalog";
import { useCartStore } from "@/stores/cart";
import { useCartFlight } from "@/composables/useCartFlight";
import { useWholesaleStore } from "@/stores/wholesale";
import SmokeParticles from "@/components/SmokeParticles.vue";
import LiquidLineTree from "@/components/product/liquid/LiquidLineTree.vue";
import { arrangeLineups } from "@/utils/lineupOrder";
import ToastNotification from "@/components/ToastNotification.vue";
import GroupLineItem from "@/components/product/GroupLineItem.vue";
import CompatibilityNotice from "@/components/product/CompatibilityNotice.vue";
import type { ProductMark } from "@/stores/catalog";
import CategoryFilterBar from "@/components/product/CategoryFilterBar.vue";
import SingleProductCard from "@/components/product/SingleProductCard.vue";
import { useProductCardLayout } from "@/composables/useProductCardLayout";
import { useCategoryFilters } from "@/composables/useCategoryFilters";
import CategoryQuickNav from "@/components/CategoryQuickNav.vue";

const props = defineProps<{
  slug: string;
}>();

const catalogStore = useCatalogStore();
const cartStore = useCartStore();
const { addItemWithFlight, notifyArrivalFrom, eventSource } = useCartFlight();
const wholesaleStore = useWholesaleStore();
const router = useRouter();
const route = useRoute();
const categoryFilters = useCategoryFilters();

/** Ключ «экрана» категории: смена slug переключает контент с
 *  плавным переходом (fade + лёгкий сдвиг), а не пересборкой. */
const screenKey = computed(() => `screen-${props.slug}`);
const {
  topActive: filterTopActive,
  strengthTier: filterStrengthTier,
  topSalesLoading: filterTopSalesLoading,
  topSales: filterTopSales,
  hasActiveFilters: filterHasActiveFilters,
  discountActive: filterDiscountActive,
  toggleTopFilter,
  toggleStrengthFilter,
  toggleDiscountFilter,
} = categoryFilters;

// Toast notification
const toastMessage = ref("");
const toastType = ref<"error" | "success" | "info">("info");
const toastKey = ref(0);
const toastDuration = ref(3500);

function showToast(
  message: string,
  type: "error" | "success" | "info" = "info",
) {
  toastMessage.value = message;
  toastType.value = type;

  const msg = message.toLowerCase();
  const isOutOfStock =
    msg.includes("в наличии больше нет") || msg.includes("нет в наличии");

  toastDuration.value = isOutOfStock ? 3000 : 3500;
  toastKey.value++;
}

// Контейнеры для адаптации шрифтов
const crossSellContainer = ref<HTMLElement | null>(null);
const ungroupedContainer = ref<HTMLElement | null>(null);

// Используем новый композабл для адаптации шрифтов
const { adjustFontSizes: adjustCrossSellFontSizes } =
  useProductCardLayout(crossSellContainer);
const { adjustFontSizes: adjustUngroupedFontSizes } =
  useProductCardLayout(ungroupedContainer);

const PLACEHOLDER_IMAGE = "/placeholder-category.png";

const categories = computed<Category[]>(() => catalogStore.categories);

const LIQUID_SLUG_KEYWORDS = ["liquid", "liq", "zhidk", "juice", "salt"];
const LIQUID_NAME_KEYWORDS = ["жидк", "солев", "liquid", "juice", "salt"];

function resolveCategoryDisplayMode(
  category: Category | null,
): "default" | "liquid" | "visual" {
  if (!category) return "default";
  if (category.displayMode === "liquid" || category.displayMode === "visual") {
    return category.displayMode;
  }

  const slug = (category.slug || "").toLowerCase();

  // Исключения: категории устройств всегда используют стандартный режим
  if (
    slug.includes("pod") ||
    slug.includes("disposable") ||
    slug === "ustrojstva"
  ) {
    return "default";
  }

  if (LIQUID_SLUG_KEYWORDS.some((keyword) => slug.includes(keyword))) {
    return "liquid";
  }

  const name = (category.name || "").toLowerCase();
  if (LIQUID_NAME_KEYWORDS.some((keyword) => name.includes(keyword))) {
    return "liquid";
  }

  const productsPool = catalogStore.allProducts.length
    ? catalogStore.allProducts
    : catalogStore.products;
  if (productsPool.length) {
    const inCategory = productsPool.filter(
      (product) => product.categoryId === category.id,
    );
    if (inCategory.length) {
      const withStrength = inCategory.filter(
        (product) =>
          typeof product.strength === "string" &&
          product.strength.trim().length > 0,
      );
      if (
        withStrength.length >= Math.max(1, Math.round(inCategory.length * 0.4))
      ) {
        return "liquid";
      }
    }
  }

  return "default";
}

const selectedCategory = computed<Category | null>(() => {
  return (
    categories.value.find((category) => category.slug === props.slug) ?? null
  );
});

/** Плашка консультации: категория расходников (картриджи, испарители, баки). */
const showCompatibilityNotice = computed(
  () => props.slug === "rashodniki" && !wholesaleStore.isWholesale,
);

const storefrontFiltersProfile = computed(
  () => selectedCategory.value?.storefrontFiltersProfile ?? "none",
);

/**
 * Панель фильтров нужна не только жидкостям и снюсу: кнопка скидок работает в
 * любом разделе, где акции сейчас есть. В остальных категориях панель по-
 * прежнему не появляется, пока скидок нет.
 */
const showCategoryFilters = computed(
  () =>
    storefrontFiltersProfile.value === "liquids" ||
    storefrontFiltersProfile.value === "snus_plates" ||
    discountedGroupsCount.value > 0,
);

const topRankMap = computed(() => {
  const map: Record<string, number> = {};
  categoryFilters.topRankByGroupId.value.forEach((rank, groupId) => {
    map[groupId] = rank;
  });
  return map;
});

async function prefetchCurrentCategoryImages() {
  const categoryId = selectedCategory.value?.id;
  if (!categoryId) {
    return;
  }

  await Promise.all([
    catalogStore.loadCategoryImages([categoryId]),
    catalogStore.loadGroupImagesForCategory(categoryId),
  ]);
}

async function prefetchChildGroupImages(groupId: string) {
  const categoryId = selectedCategory.value?.id;
  if (!categoryId) {
    return;
  }

  await catalogStore.loadGroupImagesForCategory(categoryId, groupId);
}

function collectVisibleGroupIds(groups: Array<{ id: string; children?: Array<{ id: string }> }>): string[] {
  const ids: string[] = [];
  const walk = (group: { id: string; children?: Array<{ id: string }> }) => {
    ids.push(group.id);
    (group.children ?? []).forEach((child) => walk(child));
  };
  groups.forEach((group) => walk(group));
  return ids;
}

async function prefetchVisibleFilterGroupImages() {
  if (!filterHasActiveFilters.value) {
    return;
  }

  const categoryId = selectedCategory.value?.id;
  if (!categoryId) {
    return;
  }

  const ids = new Set<string>();
  if (filterTopActive.value) {
    filterTopSales.value.forEach((item) => {
      if (item.groupId) {
        ids.add(String(item.groupId));
      }
    });
  }

  if (showLiquidShowcase.value) {
    collectVisibleGroupIds(filteredLiquidGroups.value).forEach((groupId) => ids.add(groupId));
  } else {
    collectVisibleGroupIds(filteredGroupCards.value).forEach((groupId) => ids.add(groupId));
  }

  if (!ids.size) {
    return;
  }

  await catalogStore.loadGroupImages([...ids]);
}

const resolvedDisplayMode = computed<"default" | "liquid" | "visual">(() =>
  resolveCategoryDisplayMode(selectedCategory.value),
);
const isLiquidCategory = computed(() => resolvedDisplayMode.value === "liquid");
const showLiquidShowcase = computed(() => isLiquidCategory.value);

type GroupCard = CategoryGroup & {
  depth: number;
  previewImage: string;
  isActive: boolean;
};
type GroupCardNode = GroupCard & {
  children: GroupCardNode[];
  products: Product[];
};
type LiquidGroup = {
  id: string;
  name: string;
  slug: string;
  order: number;
  coverImage: string | null;
  products: Product[];
  productCount: number;
  badge?: string | null;
  badgeColor?: string | null;
  metaLabel?: string | null;
  metaValue?: string | null;
  strengthTier?: string | null;
  isNew?: boolean;
  newSince?: string | null;
  mark?: ProductMark | null;
  children: LiquidGroup[];
};

// Состояние раскрытия для линеек (включая подлинейки)
const groupExpansionState = ref<Record<string, boolean>>({});

function isGroupExpanded(groupId: string): boolean {
  return groupExpansionState.value[groupId] ?? false;
}

function toggleGroupExpansion(groupId: string) {
  const nextExpanded = !isGroupExpanded(groupId);

  groupExpansionState.value = {
    ...groupExpansionState.value,
    [groupId]: nextExpanded,
  };

  if (nextExpanded) {
    void prefetchChildGroupImages(groupId);
  }
}

// Строим иерархическое дерево линеек с товарами
const groupCards = computed<GroupCardNode[]>(() => {
  if (!selectedCategory.value) return [];

  const groups = selectedCategory.value.groups;
  // Используем allProducts для полного списка товаров (не ограниченного пагинацией)
  const productsPool = catalogStore.allProducts.length
    ? catalogStore.allProducts
    : catalogStore.products;
  const categoryProducts = productsPool.filter(
    (p) => p.categoryId === selectedCategory.value!.id,
  );
  const nodes = new Map<string, GroupCardNode>();

  // Создаём узлы для всех групп
  groups.forEach((group) => {
    const groupProducts = categoryProducts.filter(
      (p) => p.groupId === group.id,
    );
    nodes.set(group.id, {
      ...group,
      depth: 0,
      previewImage: group.coverImage || PLACEHOLDER_IMAGE,
      isActive: catalogStore.activeGroup === group.slug,
      children: [],
      products: groupProducts,
    });
  });

  const roots: GroupCardNode[] = [];

  // Строим иерархию
  nodes.forEach((node) => {
    const parentId = node.parentId ? String(node.parentId) : null;
    if (parentId && nodes.has(parentId)) {
      const parent = nodes.get(parentId)!;
      node.depth = parent.depth + 1;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  });

  // Новинка выходит из своей линейки наверх, дальше обычный порядок.
  const arranged = arrangeLineups(roots);

  return arranged.filter(
    (node) => (node.totalProductCount ?? node.productCount ?? 0) > 0,
  );
});

const liquidStructure = computed(() => {
  if (!showLiquidShowcase.value || !selectedCategory.value) {
    return { groups: [] as LiquidGroup[], ungrouped: [] as Product[] };
  }

  const category = selectedCategory.value;
  // Используем allProducts для полного списка товаров (не ограниченного пагинацией)
  const productsPool = catalogStore.allProducts.length
    ? catalogStore.allProducts
    : catalogStore.products;
  const categoryProducts = productsPool.filter(
    (p) => p.categoryId === category.id,
  );

  // Строим иерархическое дерево для liquid-режима
  const buildLiquidTree = (): LiquidGroup[] => {
    const groupMap = new Map<string, LiquidGroup>();

    // Создаём узлы для всех групп
    category.groups.forEach((group) => {
      const groupProducts = categoryProducts.filter(
        (p) => p.groupId === group.id,
      );
      groupMap.set(group.id, {
        id: group.id,
        name: group.name,
        slug: group.slug,
        order: group.order ?? 0,
        coverImage: group.coverImage || null,
        products: groupProducts,
        productCount: groupProducts.length,
        badge: group.badge ?? null,
        badgeColor: group.badgeColor ?? null,
        metaLabel: group.metaLabel ?? null,
        metaValue: group.metaValue ?? null,
        strengthTier: group.strengthTier ?? null,
        isNew: group.isNew ?? false,
        newSince: group.newSince ?? null,
        mark: group.mark ?? null,
        children: [],
      });
    });

    const roots: LiquidGroup[] = [];

    // Строим иерархию
    groupMap.forEach((group) => {
      const parentId = category.groups.find((g) => g.id === group.id)?.parentId;
      if (parentId && groupMap.has(parentId)) {
        groupMap.get(parentId)!.children.push(group);
      } else {
        roots.push(group);
      }
    });

    // Новинка выходит из своей линейки наверх, дальше обычный порядок.
    const arranged = arrangeLineups(roots);

    return arranged.filter((g) => g.products.length > 0 || g.children.length > 0);
  };

  const liquidGroups = buildLiquidTree();
  const ungrouped: Product[] = [];

  // Find NiCa Booster - ищем среди товаров без группы
  let nicaBooster: Product | null = null;

  categoryProducts.forEach((product) => {
    const isNicaBooster =
      product.title.toLowerCase().includes("никобустер") ||
      product.title.toLowerCase().includes("nikobuster") ||
      product.title.toLowerCase().includes("nica booster");

    if (isNicaBooster) {
      nicaBooster = product;
      return;
    }

    // Товары без группы добавляем в ungrouped
    if (!product.groupId) {
      ungrouped.push(product);
    }
  });

  // Add NiCa Booster to ungrouped at the beginning if found
  if (nicaBooster) {
    ungrouped.unshift(nicaBooster);
  }

  return { groups: liquidGroups, ungrouped };
});

const liquidGroups = computed(() => liquidStructure.value.groups);

const filteredLiquidGroups = computed(() =>
  categoryFilters.filterGroupTree(liquidGroups.value),
);

const filteredGroupCards = computed(() =>
  categoryFilters.filterGroupTree(groupCards.value),
);

/**
 * Сколько линеек раздела сейчас со скидкой. Считаем по неотфильтрованному
 * дереву: число на кнопке не должно меняться от того, что фильтр уже нажат.
 */
const discountedGroupsCount = computed(() =>
  categoryFilters.countDiscountedGroups(
    showLiquidShowcase.value ? liquidGroups.value : groupCards.value,
  ),
);

const liquidUngrouped = computed(() => {
  // Filter out NiCa Booster from ungrouped display
  return liquidStructure.value.ungrouped.filter((product) => {
    const title = product.title.toLowerCase();
    return !(
      title.includes("никобустер") ||
      title.includes("nikobuster") ||
      title.includes("nica booster")
    );
  });
});
const nicaBoosterProduct = computed(() => {
  if (!selectedCategory.value) return null;
  // Используем allProducts для полного списка товаров
  const productsPool = catalogStore.allProducts.length
    ? catalogStore.allProducts
    : catalogStore.products;
  const categoryProducts = productsPool.filter(
    (product) => product.categoryId === selectedCategory.value!.id,
  );
  return (
    categoryProducts.find(
      (p) =>
        p.title.toLowerCase().includes("никобустер") ||
        p.title.toLowerCase().includes("nikobuster") ||
        p.title.toLowerCase().includes("nica booster"),
    ) || null
  );
});

const liquidExpansionState = ref<Record<string, boolean>>({});

function collectLiquidGroupIds(groups: LiquidGroup[]): string[] {
  const ids: string[] = [];

  const visit = (group: LiquidGroup) => {
    ids.push(group.id);
    group.children.forEach(visit);
  };

  groups.forEach(visit);
  return ids;
}

watch(
  () => collectLiquidGroupIds(liquidGroups.value),
  (ids) => {
    if (!showLiquidShowcase.value) {
      liquidExpansionState.value = {};
      return;
    }

    const nextState: Record<string, boolean> = {};
    ids.forEach((id) => {
      nextState[id] = liquidExpansionState.value[id] ?? false;
    });
    liquidExpansionState.value = nextState;
  },
  { immediate: true },
);

watch(
  () => selectedCategory.value?.id,
  (categoryId) => {
    liquidExpansionState.value = {};
    groupExpansionState.value = {};

    if (categoryId) {
      void prefetchCurrentCategoryImages();
    }
  },
  { immediate: true },
);

watch(
  () =>
    [
      filterHasActiveFilters.value,
      filterTopActive.value,
      filterStrengthTier.value,
      filterTopSales.value.map((item) => item.groupId).join(","),
      showLiquidShowcase.value
        ? collectVisibleGroupIds(filteredLiquidGroups.value).join(",")
        : collectVisibleGroupIds(filteredGroupCards.value).join(","),
    ].join("|"),
  () => {
    if (!filterHasActiveFilters.value) {
      return;
    }
    void prefetchVisibleFilterGroupImages();
  },
);

const crossSellItems = computed<Product[]>(() => {
  if (!props.slug) return [];
  return catalogStore.crossSellProducts[props.slug] ?? [];
});

const activeGroupCard = computed(() => {
  if (!catalogStore.activeGroup) return null;
  return (
    groupCards.value.find((group) => group.slug === catalogStore.activeGroup) ??
    null
  );
});

const groupFocusStyle = computed(() => {
  const image =
    activeGroupCard.value?.previewImage ||
    selectedCategory.value?.coverImage ||
    PLACEHOLDER_IMAGE;
  return { backgroundImage: `url(${image})` };
});

const showProducts = computed(() => {
  if (showLiquidShowcase.value) {
    return false;
  }
  if (!selectedCategory.value) {
    return false;
  }
  if (resolvedDisplayMode.value === "visual") {
    return true;
  }
  if (!selectedCategory.value.groups.length) {
    return true;
  }
  return catalogStore.activeGroup !== null;
});

// Тост над футером: нижняя кнопка корзины убрана, смещение не нужно.
const toastBottomOffset = computed(() =>
  "calc(var(--app-bottom-tab-bar-height, 130px) + 20px)",
);

function getProductBadges(product: Product): ProductBadge[] {
  if (!Array.isArray(product.badges)) {
    return [];
  }
  return product.badges.filter((badge): badge is ProductBadge =>
    Boolean(badge && (badge.label || badge.type)),
  );
}

function getBadgeLabel(badge: ProductBadge) {
  return badge.label || badge.type || "";
}

function getBadgeStyle(badge: ProductBadge) {
  const style: Record<string, string> = {};
  if (badge.color) {
    style.backgroundColor = badge.color;
    style.borderColor = badge.color;
  }
  return style;
}

function formatPrice(price: number): string {
  return price.toLocaleString("ru-RU");
}

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
      // Проверяем что URL ведёт на картинку
      const url = link.url?.toLowerCase() || "";
      if (url.match(/\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i)) {
        return link.url;
      }
    }

    // Если не нашли картинку по расширению, пробуем первую ссылку как потенциальную картинку
    // (для ссылок без расширения в URL, например CDN)
    return product.links[0]?.url || null;
  }

  return null;
}

function goBack() {
  router.push({ name: "home" });
}

async function backToGroups() {
  await catalogStore.setActiveGroup(null);
}

function openProduct(product: Product) {
  catalogStore.currentProduct = product;
  router.push({ name: "product", params: { id: product.id } });
  catalogStore.fetchProduct(product.id);
}

function toggleLiquidExpansion(groupId: string) {
  const nextExpanded = !isLiquidGroupExpanded(groupId);

  liquidExpansionState.value = {
    ...liquidExpansionState.value,
    [groupId]: nextExpanded,
  };

  if (nextExpanded) {
    void prefetchChildGroupImages(groupId);
  }
}

function isLiquidGroupExpanded(groupId: string): boolean {
  return liquidExpansionState.value[groupId] ?? false;
}

// Cross-sell cart functions
function getCrossSellQuantity(productId: string): number {
  const item = cartStore.items.find((item) => item.productId === productId);
  return item ? item.quantity : 0;
}

function canAddCrossSell(product: Product) {
  const currentQty = getCrossSellQuantity(product.id);

  if (product.isAvailable === false) {
    return false;
  }
  if (typeof product.stock === "number") {
    const stock = Math.max(product.stock, 0);
    if (stock === 0) {
      return false;
    }
    return currentQty < stock;
  }
  return true;
}

function handleCrossSellAdd(product: Product, event?: MouseEvent) {
  if (!canAddCrossSell(product)) {
    if (
      product.isAvailable === false ||
      (typeof product.stock === "number" && product.stock <= 0)
    ) {
      showToast("Товара нет в наличии", "error");
    } else {
      showToast("В наличии больше нет", "error");
    }
    return;
  }
  addItemWithFlight(product, 1, null, eventSource(event));
}

function handleCrossSellIncrement(product: Product, event?: MouseEvent) {
  if (!canAddCrossSell(product)) {
    if (
      product.isAvailable === false ||
      (typeof product.stock === "number" && product.stock <= 0)
    ) {
      showToast("Товара нет в наличии", "error");
    } else {
      showToast("В наличии больше нет", "error");
    }
    return;
  }
  const currentQty = getCrossSellQuantity(product.id);
  if (currentQty > 0) {
    cartStore.updateQuantity(product.id, currentQty + 1);
    notifyArrivalFrom(eventSource(event), product);
  } else {
    addItemWithFlight(product, 1, null, eventSource(event));
  }
}

function decrementCrossSellQuantity(product: Product) {
  const currentQty = getCrossSellQuantity(product.id);
  if (currentQty > 1) {
    cartStore.updateQuantity(product.id, currentQty - 1);
  } else if (currentQty === 1) {
    cartStore.removeItem(product.id);
  }
}

// Ungrouped товары без линейки - cart functions
function getUngroupedQuantity(productId: string): number {
  const item = cartStore.items.find((item) => item.productId === productId);
  return item ? item.quantity : 0;
}

function canAddUngrouped(product: Product) {
  if (product.isAvailable === false) {
    return false;
  }
  if (typeof product.stock === "number") {
    const stock = Math.max(product.stock, 0);
    if (stock === 0) {
      return false;
    }
    return getUngroupedQuantity(product.id) < stock;
  }
  return true;
}

function handleUngroupedAdd(product: Product, event?: MouseEvent) {
  if (!canAddUngrouped(product)) {
    if (
      product.isAvailable === false ||
      (typeof product.stock === "number" && product.stock <= 0)
    ) {
      showToast("Товара нет в наличии", "error");
    } else {
      showToast("В наличии больше нет", "error");
    }
    return;
  }
  addItemWithFlight(product, 1, null, eventSource(event));
}

function handleUngroupedIncrement(product: Product, event?: MouseEvent) {
  if (!canAddUngrouped(product)) {
    if (
      product.isAvailable === false ||
      (typeof product.stock === "number" && product.stock <= 0)
    ) {
      showToast("Товара нет в наличии", "error");
    } else {
      showToast("В наличии больше нет", "error");
    }
    return;
  }
  const currentQty = getUngroupedQuantity(product.id);
  if (currentQty > 0) {
    cartStore.updateQuantity(product.id, currentQty + 1);
    notifyArrivalFrom(eventSource(event), product);
  } else {
    addItemWithFlight(product, 1, null, eventSource(event));
  }
}

function decrementUngroupedQuantity(product: Product) {
  const currentQty = getUngroupedQuantity(product.id);
  if (currentQty > 1) {
    cartStore.updateQuantity(product.id, currentQty - 1);
  } else if (currentQty === 1) {
    cartStore.removeItem(product.id);
  }
}

// При изменении cross-sell товаров или корзины - адаптируем шрифты
watch(
  () => [
    crossSellItems.value.length,
    cartStore.items.length,
    cartStore.items.map((i) => i.quantity).join(","),
  ],
  () => {
    // Задержка для завершения рендеринга DOM
    nextTick(() => {
      setTimeout(() => {
        adjustCrossSellFontSizes();
        adjustUngroupedFontSizes();
      }, 50);
    });
  },
  { flush: "post" },
);

async function syncCategoryFilters() {
  categoryFilters.resetFilters();
  const category = selectedCategory.value;
  if (!category?.id || !showCategoryFilters.value) {
    categoryFilters.topSales.value = [];
    return;
  }
  await categoryFilters.loadTopSales(category.id, 5);
}

onMounted(async () => {
  // Инициализируем каталог если ещё не загружен
  if (!catalogStore.categories.length) {
    await catalogStore.initialize();
  }

  // Устанавливаем активную категорию
  await catalogStore.setActiveCategory(props.slug);
  await syncCategoryFilters();

  // Загружаем cross-sell если нужно
  if (!wholesaleStore.isWholesale && props.slug && !catalogStore.crossSellProducts[props.slug]) {
    catalogStore.fetchCrossSell(props.slug);
  }
});

// Следим за изменением slug в роуте
watch(
  () => props.slug,
  async (newSlug) => {
    if (newSlug) {
      groupExpansionState.value = {};
      liquidExpansionState.value = {};
      await catalogStore.setActiveCategory(newSlug);
      await syncCategoryFilters();
      if (!wholesaleStore.isWholesale && !catalogStore.crossSellProducts[newSlug]) {
        catalogStore.fetchCrossSell(newSlug);
      }
    }
  },
);
</script>

<style scoped>
/* Main Content Wrapper: снизу — резерв под быструю навигацию. */
.main-content-wrapper {
  max-width: 1280px;
  margin: 0 auto;
  padding: 0 0 calc(140px + env(safe-area-inset-bottom, 0px)) 0;
  position: relative;
  z-index: 10;
}

/* ===== Быстрая навигация по категориям ===== */
.qnav-dock {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: calc(10px + env(safe-area-inset-bottom, 0px));
  width: min(calc(100% - 16px), 446px);
  z-index: 40;
}

/* ===== Плавный переход между экранами категорий =====
   Уходящий контент растворяется и мягко уезжает вниз; входящий
   приходит снизу с коротким разгоном — быстрый (0.22s) и понятный. */
.qnav-screen {
  will-change: opacity;
}

.qnav-screen-enter-active,
.qnav-screen-leave-active {
  transition:
    opacity 0.22s ease,
    transform 0.22s cubic-bezier(0.2, 0.65, 0.3, 1);
}

.qnav-screen-enter-from {
  opacity: 0;
  transform: translateY(14px);
}

.qnav-screen-leave-to {
  opacity: 0;
  transform: translateY(10px);
}

@media (prefers-reduced-motion: reduce) {
  .qnav-screen-enter-active,
  .qnav-screen-leave-active {
    transition: opacity 0.15s ease;
  }

  .qnav-screen-enter-from,
  .qnav-screen-leave-to {
    transform: none;
  }
}

/* Плашка консультации: хедер категории удалён — залипает прямо
   под закреплённой верхней панелью (TopCartBar). */
.compatibility-notice-sticky {
  position: sticky;
  top: var(--app-topbar-offset, 0px);
  z-index: 19;
  padding: 0 16px 16px;
  margin: 0 0 16px;
  /* При прилипании мягкий градиент вниз, без резкой подложки. */
  background: linear-gradient(#f5f7fa 86%, rgba(245, 247, 250, 0));
  border-radius: 0 0 24px 24px;
}
.compatibility-notice-inner {
  max-width: 430px;
  margin: 0 auto;
}

/* Category Content - контейнер для контента категории */
.category-content {
  padding: 0 16px;
}

/* Liquid Showcase Container */
.liquid-showcase-container {
  padding: 8px;
  background: #f5f7fa;
}

/* Group List Container - для устройств */
.group-list-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

@media (max-width: 768px) {
  .liquid-showcase-container {
    padding: 6px;
  }

  .category-content {
    padding: 0 12px;
  }
}

@media (max-width: 480px) {
  .liquid-showcase-container {
    padding: 5px;
  }

  .category-content {
    padding: 0 10px;
  }
}

@media (max-width: 360px) {
  .liquid-showcase-container {
    padding: 4px;
  }

  .category-content {
    padding: 0 8px;
  }
}

/* Плавные переходы - только fade */
.fade-enter-active {
  transition: opacity 0.25s ease-out;
}

.fade-leave-active {
  transition: opacity 0.2s ease-in;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.fade-enter-to,
.fade-leave-from {
  opacity: 1;
}

/* Group focus panel */
.group-focus-panel {
  position: relative;
  border-radius: 28px;
  overflow: hidden;
  border: 3px solid var(--navalivay-black);
  background: var(--navalivay-white);
  min-height: 240px;
  box-shadow: var(--navalivay-shadow);
}

.group-focus-media {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  filter: blur(6px) brightness(0.78);
  transform: scale(1.08);
}

.group-focus-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.85),
    rgba(255, 255, 255, 0.65)
  );
}

.group-focus-content {
  position: relative;
  padding: clamp(1.5rem, 3vw, 2.4rem);
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.group-focus-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.group-focus-count {
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(0, 0, 0, 0.55);
}

.group-focus-title {
  font-family: var(--font-display);
  font-size: clamp(1.6rem, 3vw, 2.1rem);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--navalivay-black);
}

.group-focus-meta {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(0, 0, 0, 0.5);
}

@media (max-width: 768px) {
  .group-focus-panel {
    min-height: 200px;
    border-width: 2px;
  }

  .group-focus-content {
    padding: 1.25rem;
    gap: 0.75rem;
  }

  .group-focus-top {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .group-focus-title {
    font-size: clamp(1.2rem, 6vw, 1.75rem);
  }
}

@media (max-width: 480px) {
  .group-focus-panel {
    border-radius: 18px;
  }

  .group-focus-content {
    padding: 1.1rem;
  }
}

/* Back chip */
.back-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 1rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  border: 3px solid var(--navalivay-black);
  transition: all 0.2s ease;
  background: var(--navalivay-white);
}

.back-chip:hover {
  transform: translate(-2px, -2px);
  box-shadow: var(--navalivay-shadow);
}

/* Product card styles */
.product-card {
  border-radius: 22px;
  overflow: visible;
  border: 3px solid var(--navalivay-black);
  background: var(--navalivay-white);
  transition:
    transform 0.25s ease,
    box-shadow 0.25s ease;
  cursor: pointer;
}

.product-card:hover {
  transform: translate(-4px, -4px);
  box-shadow: var(--navalivay-shadow-hover);
}

.product-card-media {
  width: 100%;
  padding-bottom: 100%;
  position: relative;
  background: #f3f3f3;
  overflow: hidden;
  border-radius: 20px 20px 0 0;
}

.product-card-badges {
  position: absolute;
  top: 0.75rem;
  left: 0.75rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  z-index: 2;
}

.product-card-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.35rem 0.75rem;
  border-radius: 9999px;
  background: #e60000;
  border: 2px solid #ffffff;
  font-size: 0.65rem;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #ffffff;
  box-shadow:
    0 6px 16px rgba(230, 0, 0, 0.4),
    0 2px 4px rgba(0, 0, 0, 0.2);
}

.product-card-media img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.3s ease;
}

.product-card:hover .product-card-media img {
  transform: scale(1.05);
}

.media-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #f8f8f8 0%, #ebebeb 100%);
}

.product-card-body {
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.product-card-title {
  font-weight: 800;
  font-size: 0.9rem;
  color: var(--navalivay-black);
  line-height: 1.35;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.product-card-variant {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--navalivay-gray);
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.product-card-price {
  display: inline-flex;
  align-items: baseline;
  gap: 0.25rem;
  font-size: 1.1rem;
  font-weight: 900;
  letter-spacing: 0.05em;
}

.product-card-price-amount {
  color: var(--navalivay-red);
}

.product-card-price-currency {
  color: var(--navalivay-black);
}

/* Deep styles for liquid components */
:deep(.liquid-ungrouped) {
  border-radius: 24px;
  border: 3px dashed var(--navalivay-black);
  background: rgba(255, 255, 255, 0.9);
  padding: 1.5rem 1.4rem 1.8rem;
}

:deep(.liquid-ungrouped-title) {
  font-family: var(--font-display);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 1rem;
  color: var(--navalivay-black);
  margin-bottom: 1rem;
}

:deep(.liquid-collapse-enter-active),
:deep(.liquid-collapse-leave-active) {
  transition:
    max-height 0.25s ease,
    opacity 0.2s ease;
  overflow: hidden;
}

:deep(.liquid-collapse-enter-from),
:deep(.liquid-collapse-leave-to) {
  max-height: 0;
  opacity: 0;
}

:deep(.liquid-collapse-enter-to),
:deep(.liquid-collapse-leave-from) {
  max-height: 800px;
  opacity: 1;
}
</style>
