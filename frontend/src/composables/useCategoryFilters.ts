import { computed, ref } from "vue";
import { hasDiscountForProduct } from "@/components/product/groupPrice";

export type StrengthTier = "very_strong" | "strong" | "light";
export type StorefrontFiltersProfile = "none" | "liquids" | "snus_plates";

export interface TopSalesItem {
  groupId: string;
  rank: number;
  groupName?: string;
}

export interface FilterableGroup {
  id: string;
  name: string;
  strengthTier?: string | null;
  products?: Array<{
    title: string;
    hasDiscount?: boolean;
    variants?: Array<{ hasDiscount?: boolean } | null | undefined> | null;
  }>;
  children?: FilterableGroup[];
}

const STRENGTH_LABELS: Record<StrengthTier, string> = {
  very_strong: "Очень крепкие",
  strong: "Крепкие",
  light: "Легкие",
};

export function getStrengthLabel(tier: StrengthTier): string {
  return STRENGTH_LABELS[tier];
}

export function useCategoryFilters() {
  const searchQuery = ref("");
  const topActive = ref(false);
  const discountActive = ref(false);
  const strengthTier = ref<StrengthTier | null>(null);
  const topSales = ref<TopSalesItem[]>([]);
  const topSalesLoading = ref(false);
  const topSalesError = ref<string | null>(null);

  const topRankByGroupId = computed(() => {
    const map = new Map<string, number>();
    topSales.value.forEach((item) => {
      map.set(String(item.groupId), item.rank);
    });
    return map;
  });

  const hasActiveFilters = computed(
    () =>
      searchQuery.value.trim().length > 0 ||
      topActive.value ||
      discountActive.value ||
      strengthTier.value !== null,
  );

  /**
   * Линейка попадает в фильтр скидок по своим собственным товарам, а не по
   * вложенным. Иначе рядом со скидочной подлинейкой в список приезжал бы её
   * родитель, у которого на своём уровне ничего не подешевело.
   */
  function groupHasOwnDiscount(group: FilterableGroup): boolean {
    return (group.products ?? []).some((product) => hasDiscountForProduct(product));
  }

  function countDiscountedGroups(groups: FilterableGroup[]): number {
    let count = 0;
    const walk = (group: FilterableGroup) => {
      if (groupHasOwnDiscount(group)) count += 1;
      (group.children ?? []).forEach(walk);
    };
    groups.forEach(walk);
    return count;
  }

  async function loadTopSales(categoryId: string, limit = 5) {
    topSalesLoading.value = true;
    topSalesError.value = null;
    try {
      const params = new URLSearchParams({
        category: categoryId,
        limit: String(limit),
      });
      const response = await fetch(`/api/top-sales-groups?${params.toString()}`);
      if (!response.ok) {
        throw new Error("failed_to_load_top_sales");
      }
      const data = await response.json();
      topSales.value = Array.isArray(data.items)
        ? data.items.map((row: Record<string, unknown>) => ({
            groupId: String(row.groupId),
            rank: Number(row.rank ?? 0),
            groupName:
              typeof row.groupName === "string" ? row.groupName : undefined,
          }))
        : [];
    } catch (error) {
      topSales.value = [];
      topSalesError.value =
        error instanceof Error ? error.message : "unknown_error";
    } finally {
      topSalesLoading.value = false;
    }
  }

  function resetFilters() {
    searchQuery.value = "";
    topActive.value = false;
    discountActive.value = false;
    strengthTier.value = null;
  }

  function toggleTopFilter() {
    topActive.value = !topActive.value;
  }

  function toggleDiscountFilter() {
    discountActive.value = !discountActive.value;
  }

  function toggleStrengthFilter(tier: StrengthTier) {
    strengthTier.value = strengthTier.value === tier ? null : tier;
  }

  function normalizeSearch(value: string): string {
    return value.trim().toLowerCase();
  }

  function groupMatchesSearch(group: FilterableGroup, query: string): boolean {
    if (!query) return true;
    const normalized = normalizeSearch(query);
    if (group.name.toLowerCase().includes(normalized)) {
      return true;
    }
    return (group.products ?? []).some((product) =>
      product.title.toLowerCase().includes(normalized),
    );
  }

  function groupMatchesStrength(group: FilterableGroup, tier: StrengthTier | null) {
    if (!tier) return true;
    return String(group.strengthTier ?? "").toLowerCase() === tier;
  }

  function groupMatchesTop(group: FilterableGroup, useTop: boolean) {
    if (!useTop) return true;
    return topRankByGroupId.value.has(String(group.id));
  }

  function groupMatchesDiscount(group: FilterableGroup, useDiscount: boolean) {
    if (!useDiscount) return true;
    return groupHasOwnDiscount(group);
  }

  function compareByTopRank(a: FilterableGroup, b: FilterableGroup): number {
    const rankA = topRankByGroupId.value.get(String(a.id)) ?? 999;
    const rankB = topRankByGroupId.value.get(String(b.id)) ?? 999;
    if (rankA !== rankB) return rankA - rankB;
    return (a.name || "").localeCompare(b.name || "", "ru");
  }

  function collectFlatMatches<T extends FilterableGroup>(
    groups: T[],
    query: string,
    tier: StrengthTier | null,
    useTop: boolean,
    useDiscount: boolean,
  ): T[] {
    const collected: T[] = [];

    const walk = (group: T) => {
      (group.children ?? []).forEach((child) => walk(child as T));

      const selfMatches =
        groupMatchesSearch(group, query) &&
        groupMatchesStrength(group, tier) &&
        groupMatchesTop(group, useTop) &&
        groupMatchesDiscount(group, useDiscount);

      if (!selfMatches) return;

      collected.push({
        ...group,
        children: [],
      });
    };

    groups.forEach((group) => walk(group));

    if (useTop) {
      return [...collected].sort(compareByTopRank);
    }

    return [...collected].sort((a, b) =>
      (a.name || "").localeCompare(b.name || "", "ru"),
    );
  }

  function filterGroupTree<T extends FilterableGroup>(groups: T[]): T[] {
    const query = normalizeSearch(searchQuery.value);
    const useTop = topActive.value;
    const useDiscount = discountActive.value;
    const tier = strengthTier.value;

    // Скидки показываются плоским списком, как и «чаще берут»: вложенная
    // скидочная линейка должна быть видна сразу, а не под раскрытым родителем.
    if (useTop || useDiscount || tier) {
      return collectFlatMatches(groups, query, tier, useTop, useDiscount);
    }

    const walk = (group: T): T | null => {
      const filteredChildren = (group.children ?? [])
        .map((child) => walk(child as T))
        .filter((child): child is T => child !== null);

      const selfMatches =
        groupMatchesSearch(group, query) &&
        groupMatchesStrength(group, tier) &&
        groupMatchesTop(group, useTop) &&
        groupMatchesDiscount(group, useDiscount);

      if (selfMatches) {
        return {
          ...group,
          children: filteredChildren,
        };
      }

      if (filteredChildren.length > 0) {
        return {
          ...group,
          products: [],
          children: filteredChildren,
        };
      }

      return null;
    };

    return groups
      .map((group) => walk(group))
      .filter((group): group is T => group !== null);
  }

  function getTopRank(groupId: string): number | null {
    if (!topActive.value) return null;
    return topRankByGroupId.value.get(String(groupId)) ?? null;
  }

  return {
    searchQuery,
    topActive,
    discountActive,
    toggleDiscountFilter,
    countDiscountedGroups,
    strengthTier,
    topSales,
    topSalesLoading,
    topSalesError,
    topRankByGroupId,
    hasActiveFilters,
    loadTopSales,
    resetFilters,
    toggleTopFilter,
    toggleStrengthFilter,
    filterGroupTree,
    getTopRank,
    getStrengthLabel,
  };
}