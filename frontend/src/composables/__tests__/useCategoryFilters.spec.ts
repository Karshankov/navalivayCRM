import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getStrengthLabel,
  useCategoryFilters,
  type FilterableGroup,
} from "@/composables/useCategoryFilters";

const makeGroup = (
  overrides: Partial<FilterableGroup> & Pick<FilterableGroup, "id" | "name">,
): FilterableGroup => ({
  products: [],
  children: [],
  ...overrides,
});

describe("useCategoryFilters", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("getStrengthLabel returns Russian labels", () => {
    expect(getStrengthLabel("very_strong")).toBe("Очень крепкие");
    expect(getStrengthLabel("strong")).toBe("Крепкие");
    expect(getStrengthLabel("light")).toBe("Легкие");
  });

  it("filters by strength tier", () => {
    const { strengthTier, toggleStrengthFilter, filterGroupTree } =
      useCategoryFilters();
    const groups = [
      makeGroup({ id: "g1", name: "A", strengthTier: "strong" }),
      makeGroup({ id: "g2", name: "B", strengthTier: "light" }),
    ];

    toggleStrengthFilter("strong");
    expect(strengthTier.value).toBe("strong");

    const filtered = filterGroupTree(groups);
    expect(filtered.map((g) => g.id)).toEqual(["g1"]);
  });

  it("filters by search across group name and product titles", () => {
    const { searchQuery, filterGroupTree } = useCategoryFilters();
    const groups = [
      makeGroup({
        id: "g1",
        name: "Alpha",
        products: [{ title: "Mango" }],
      }),
      makeGroup({
        id: "g2",
        name: "Beta",
        products: [{ title: "DuDu ice" }],
      }),
    ];

    searchQuery.value = "dudu";
    expect(filterGroupTree(groups).map((g) => g.id)).toEqual(["g2"]);

    searchQuery.value = "alpha";
    expect(filterGroupTree(groups).map((g) => g.id)).toEqual(["g1"]);
  });

  it("strength filter flattens matching child lines without parent wrapper", () => {
    const { strengthTier, filterGroupTree } = useCategoryFilters();
    strengthTier.value = "light";

    const groups = [
      makeGroup({
        id: "parent",
        name: "ЗЛАЯ МОНАШКА",
        children: [
          makeGroup({ id: "child-light", name: "Light Line", strengthTier: "light" }),
          makeGroup({ id: "child-strong", name: "Strong Line", strengthTier: "strong" }),
        ],
      }),
    ];

    const filtered = filterGroupTree(groups);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("child-light");
    expect(filtered[0].children).toEqual([]);
  });

  it("top filter flattens matching child lines to root without parent wrapper", () => {
    const { topActive, topSales, toggleTopFilter, filterGroupTree } =
      useCategoryFilters();
    topSales.value = [{ groupId: "child", rank: 1, groupName: "Child" }];
    toggleTopFilter();
    expect(topActive.value).toBe(true);

    const groups = [
      makeGroup({
        id: "parent",
        name: "Parent",
        children: [makeGroup({ id: "child", name: "Child", strengthTier: "light" })],
      }),
      makeGroup({ id: "other", name: "Other" }),
    ];

    const filtered = filterGroupTree(groups);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("child");
    expect(filtered[0].children).toEqual([]);
  });

  it("top filter returns nested top lines sorted by rank ascending", () => {
    const { topActive, topSales, filterGroupTree } = useCategoryFilters();
    topActive.value = true;
    topSales.value = [
      { groupId: "line-b", rank: 2 },
      { groupId: "line-a", rank: 1 },
      { groupId: "line-c", rank: 3 },
    ];

    const groups = [
      makeGroup({
        id: "brand",
        name: "Brand",
        children: [
          makeGroup({ id: "line-b", name: "Line B" }),
          makeGroup({ id: "line-a", name: "Line A" }),
        ],
      }),
      makeGroup({ id: "solo", name: "Solo", children: [makeGroup({ id: "line-c", name: "Line C" })] }),
    ];

    const filtered = filterGroupTree(groups);
    expect(filtered.map((group) => group.id)).toEqual(["line-a", "line-b", "line-c"]);
    expect(filtered.every((group) => (group.children ?? []).length === 0)).toBe(true);
  });

  it("hides top rank badges until the top filter is active", () => {
    const { topSales, getTopRank } = useCategoryFilters();
    topSales.value = [{ groupId: "leaf", rank: 1 }];

    expect(getTopRank("leaf")).toBeNull();
  });

  it("top filter flattens snus-style three-level hierarchy to ranked root rows", () => {
    const { topActive, topSales, filterGroupTree, getTopRank } = useCategoryFilters();
    topActive.value = true;
    topSales.value = [
      { groupId: "cg_drymost_200", rank: 1 },
      { groupId: "cg_iceberg_150", rank: 5 },
    ];

    const groups = [
      makeGroup({
        id: "cg_snus_root",
        name: "СНЮС",
        children: [
          makeGroup({
            id: "cg_iceberg_brand",
            name: "Снюс ICEBERG",
            children: [makeGroup({ id: "cg_iceberg_150", name: "Снюс ICEBERG 150MG" })],
          }),
          makeGroup({
            id: "cg_drymost_brand",
            name: "Снюс DRYMOST",
            children: [makeGroup({ id: "cg_drymost_200", name: "Снюс DRYMOST 200MG" })],
          }),
        ],
      }),
    ];

    const filtered = filterGroupTree(groups);
    expect(filtered.map((group) => group.id)).toEqual(["cg_drymost_200", "cg_iceberg_150"]);
    expect(filtered.every((group) => (group.children ?? []).length === 0)).toBe(true);
    expect(getTopRank("cg_drymost_200")).toBe(1);
    expect(getTopRank("cg_iceberg_150")).toBe(5);
    expect(getTopRank("cg_snus_root")).toBeNull();
  });

  it("uses server-provided ranks after OOS groups are skipped", () => {
    const { topActive, topSales, filterGroupTree, getTopRank } = useCategoryFilters();
    topActive.value = true;
    topSales.value = [
      { groupId: "podgon", rank: 1 },
      { groupId: "duall", rank: 2 },
      { groupId: "fifth", rank: 3 },
    ];

    const groups = [
      makeGroup({ id: "podgon", name: "PODGON" }),
      makeGroup({ id: "critical", name: "CRITICAL" }),
      makeGroup({ id: "duall", name: "DUALL" }),
      makeGroup({ id: "fifth", name: "FIFTH" }),
    ];

    const filtered = filterGroupTree(groups);
    expect(filtered.map((g) => g.id)).toEqual(["podgon", "duall", "fifth"]);
    expect(getTopRank("duall")).toBe(2);
    expect(getTopRank("critical")).toBeNull();
  });

  it("sorts by top rank when top filter active", () => {
    const { topActive, topSales, filterGroupTree } = useCategoryFilters();
    topActive.value = true;
    topSales.value = [
      { groupId: "g2", rank: 1 },
      { groupId: "g1", rank: 2 },
    ];

    const groups = [
      makeGroup({ id: "g1", name: "B-line" }),
      makeGroup({ id: "g2", name: "A-line" }),
    ];

    const filtered = filterGroupTree(groups);
    expect(filtered.map((g) => g.id)).toEqual(["g2", "g1"]);
  });

  it("resetFilters clears all active state", () => {
    const { searchQuery, topActive, strengthTier, resetFilters } =
      useCategoryFilters();
    searchQuery.value = "test";
    topActive.value = true;
    strengthTier.value = "light";
    resetFilters();
    expect(searchQuery.value).toBe("");
    expect(topActive.value).toBe(false);
    expect(strengthTier.value).toBeNull();
  });

  it("loadTopSales maps API payload and handles errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{ groupId: "g1", rank: 1, groupName: "Line" }],
        }),
      })
      .mockResolvedValueOnce({ ok: false });
    vi.stubGlobal("fetch", fetchMock);

    const { loadTopSales, topSales, topSalesError } = useCategoryFilters();
    await loadTopSales("cat-1", 5);
    expect(topSales.value).toEqual([{ groupId: "g1", rank: 1, groupName: "Line" }]);
    expect(topSalesError.value).toBeNull();

    await loadTopSales("cat-1");
    expect(topSales.value).toEqual([]);
    expect(topSalesError.value).toBe("failed_to_load_top_sales");
  });

  describe("фильтр скидок", () => {
    const treeWithDiscounts = () => [
      makeGroup({
        id: "parent",
        name: "PODONKI",
        products: [{ title: "Обычный" }],
        children: [
          makeGroup({
            id: "kid",
            name: "PODONKI LAST HAP",
            products: [{ title: "Ягодный пирог", hasDiscount: true }],
          }),
        ],
      }),
      makeGroup({
        id: "plain",
        name: "ANNIMA",
        products: [{ title: "Без скидки" }],
      }),
      makeGroup({
        id: "variants",
        name: "XROS",
        products: [{ title: "Устройство", variants: [{ hasDiscount: true }] }],
      }),
    ];

    it("считает линейки, у которых скидка на своих товарах", () => {
      const { countDiscountedGroups } = useCategoryFilters();
      // Родитель не в счёте: у него на своём уровне ничего не подешевело.
      expect(countDiscountedGroups(treeWithDiscounts())).toBe(2);
    });

    it("скидка на отдельном вкусе устройства тоже считается", () => {
      const { countDiscountedGroups } = useCategoryFilters();
      const groups = [
        makeGroup({
          id: "x",
          name: "XROS",
          products: [{ title: "Устройство", variants: [{ hasDiscount: true }] }],
        }),
      ];
      expect(countDiscountedGroups(groups)).toBe(1);
    });

    it("показывает только скидочные линейки плоским списком", () => {
      const { discountActive, toggleDiscountFilter, filterGroupTree } =
        useCategoryFilters();

      toggleDiscountFilter();
      expect(discountActive.value).toBe(true);

      const filtered = filterGroupTree(treeWithDiscounts());
      // Вложенная линейка выходит наверх, родитель без своих скидок не едет.
      expect(filtered.map((group) => group.id).sort()).toEqual(["kid", "variants"]);
    });

    it("повторное нажатие возвращает полное дерево", () => {
      const { toggleDiscountFilter, filterGroupTree } = useCategoryFilters();

      toggleDiscountFilter();
      toggleDiscountFilter();

      const filtered = filterGroupTree(treeWithDiscounts());
      expect(filtered.map((group) => group.id)).toEqual(["parent", "plain", "variants"]);
      expect(filtered[0].children?.map((child) => child.id)).toEqual(["kid"]);
    });

    it("сброс фильтров выключает и скидки", () => {
      const { discountActive, toggleDiscountFilter, resetFilters, hasActiveFilters } =
        useCategoryFilters();

      toggleDiscountFilter();
      expect(hasActiveFilters.value).toBe(true);

      resetFilters();
      expect(discountActive.value).toBe(false);
      expect(hasActiveFilters.value).toBe(false);
    });
  });
});