import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import BonusSystemTab from "@/views/admin/crm/loyalty/BonusSystemTab.vue";
import { useCatalogStore } from "@/stores/catalog";
import { useCrmStore } from "@/stores/crm";

const createCategory = () => ({
  id: "loyalty-liquids",
  key: "liquids",
  title: "Жидкости",
  description: "Скидка на жидкость",
  threshold: 10,
  discount_amount: 5,
  active: 1,
  mappings: [
    {
      id: "mapping-category",
      category_id: "catalog-1",
      group_id: null,
    },
    {
      id: "mapping-group",
      category_id: null,
      group_id: "group-1",
    },
  ],
});

describe("BonusSystemTab", () => {
  let pinia: ReturnType<typeof createPinia>;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
  });

  it("renders safely when remounted with cached loyalty categories", async () => {
    const crmStore = useCrmStore();
    const catalogStore = useCatalogStore();
    const category = createCategory();

    catalogStore.categories = [
      {
        id: "catalog-1",
        slug: "liquids",
        name: "Жидкости",
        order: 0,
        productCount: 1,
        groups: [
          {
            id: "group-1",
            slug: "line-1",
            name: "Линейка 1",
            order: 0,
            productCount: 1,
          },
        ],
      },
    ];

    crmStore.loyaltyCategories = [category];
    crmStore.loyaltyCustomers = [];

    vi.spyOn(catalogStore, "initialize").mockResolvedValue();
    vi.spyOn(crmStore, "fetchLoyaltyCategories").mockResolvedValue([category] as any);
    vi.spyOn(crmStore, "fetchLoyaltyCustomers").mockResolvedValue([]);

    const firstMount = mount(BonusSystemTab, {
      global: {
        plugins: [pinia],
      },
    });
    await flushPromises();
    firstMount.unmount();

    const secondMount = mount(BonusSystemTab, {
      global: {
        plugins: [pinia],
      },
    });
    await flushPromises();

    expect(secondMount.text()).toContain("Жидкости");
    expect(secondMount.find('input[type="checkbox"]').exists()).toBe(true);

    secondMount.unmount();
  });
});
