import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import AdminProductsTable from "@/components/admin/AdminProductsTable.vue";

describe("AdminProductsTable search regressions", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function mountTable(extraProps: Record<string, unknown> = {}) {
    return mount(AdminProductsTable, {
      props: {
        products: [],
        categories: [
          { id: "cat-hookah", name: "Кальянка" },
          { id: "cat-other", name: "Другая" },
        ],
        pagination: {
          page: 1,
          limit: 10,
          total: 0,
          totalPages: 1,
        },
        ...extraProps,
      },
      global: {
        stubs: {
          AdminSectionHero: {
            template: "<section><slot name=\"actions\" /><slot /></section>",
          },
          Teleport: true,
        },
      },
    });
  }

  it("debounces product search and emits only the final query", async () => {
    const wrapper = mountTable();
    const searchInput = wrapper.find('input[type="text"]');

    await searchInput.setValue("п");
    await searchInput.setValue("пе");
    await searchInput.setValue("персик");

    await vi.advanceTimersByTimeAsync(299);
    expect(wrapper.emitted("filters")).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1);
    expect(wrapper.emitted("filters")).toEqual([
      [{ search: "персик", category: "", group: "" }],
    ]);
  });

  it("category changes cancel pending search debounce and emit immediately", async () => {
    const wrapper = mountTable();
    const searchInput = wrapper.find('input[type="text"]');
    const categorySelect = wrapper.find("select");

    await searchInput.setValue("персик");
    await vi.advanceTimersByTimeAsync(100);
    await categorySelect.setValue("cat-hookah");

    expect(wrapper.emitted("filters")).toEqual([
      [{ search: "персик", category: "cat-hookah", group: "" }],
    ]);

    await vi.advanceTimersByTimeAsync(300);
    expect(wrapper.emitted("filters")).toHaveLength(1);
  });

  it("shows a safe empty warehouse state without catalog editing actions", () => {
    const wrapper = mountTable({ location: "warehouse" });

    expect(wrapper.text()).toContain("На складе пока нет товаров");
    expect(wrapper.text()).toContain("Перемещение");
    expect(wrapper.text()).not.toContain("Добавить товар");
    expect(wrapper.text()).not.toContain("Выбрать все");
  });

  it("фильтрует по линейке чипом и снимает фильтр повторным кликом", async () => {
    const wrapper = mountTable({
      location: "warehouse",
      availableGroups: [
        { id: "group-podonki", name: "PODONKI PODGON", categoryId: "cat-hookah" },
        { id: "group-isterika", name: "PODONKI ISTERIKA", categoryId: "cat-hookah" },
      ],
    });

    const chips = wrapper.findAll('[data-test="product-group-chip"]');
    // Первый чип сбрасывает фильтр, дальше сами линейки.
    expect(chips).toHaveLength(3);
    expect(chips[0].text()).toBe("Все линейки");

    await chips[1].trigger("click");
    expect(wrapper.emitted("filters")).toEqual([
      [{ search: "", category: "", group: "group-isterika" }],
    ]);

    await chips[1].trigger("click");
    expect(wrapper.emitted("filters")).toHaveLength(2);
    expect(wrapper.emitted("filters")![1]).toEqual([
      { search: "", category: "", group: "" },
    ]);
  });

  it("не показывает ленту линеек в рознице, там их сотни", () => {
    const wrapper = mountTable({
      location: "retail",
      availableGroups: [
        { id: "group-podonki", name: "PODONKI PODGON", categoryId: "cat-hookah" },
      ],
    });

    expect(wrapper.findAll('[data-test="product-group-chip"]')).toHaveLength(0);
  });

  it("показывает скидку в строке товара и открывает быструю форму", async () => {
    const wrapper = mountTable({
      products: [
        {
          id: "p-1",
          title: "Арбузная жвачка",
          priceRub: 55,
          categoryId: "cat-hookah",
          discount: { price: 44, untilDate: "2030-03-01", active: true },
        },
      ],
    });

    const badge = wrapper.find('[data-test="product-discount-badge"]');
    expect(badge.exists()).toBe(true);
    // 55 стало 44, это пятая часть цены.
    expect(badge.text()).toBe("-20%");
    // Срок прячем в подсказку, чтобы не раздувать строку.
    expect(badge.attributes("title")).toContain("01.03.2030");

    await wrapper.find('[data-test="product-discount-button"]').trigger("click");
    expect(wrapper.emitted("discount")?.[0]?.[0]).toMatchObject({ id: "p-1" });
  });

  it("не показывает бейдж, когда срок скидки вышел", () => {
    const wrapper = mountTable({
      products: [
        {
          id: "p-2",
          title: "Без скидки",
          priceRub: 55,
          categoryId: "cat-hookah",
          discount: { price: 44, untilDate: "2020-01-01", active: false },
        },
      ],
    });

    expect(wrapper.find('[data-test="product-discount-badge"]').exists()).toBe(false);
  });

  it("emits warehouse location switch", async () => {
    const wrapper = mountTable();
    const warehouseButton = wrapper.find('[data-test="location-warehouse"]');

    expect(warehouseButton.exists()).toBe(true);
    await warehouseButton.trigger("click");
    expect(wrapper.emitted("changeLocation")).toEqual([["warehouse"]]);
  });
});
