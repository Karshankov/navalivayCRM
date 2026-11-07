import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import SingleProductCard from "@/components/product/SingleProductCard.vue";
import CategoryView from "@/views/CategoryView.vue";
import { useCartStore } from "@/stores/cart";
import { useCatalogStore, type Product } from "@/stores/catalog";

const routerPush = vi.fn();

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: routerPush }),
  useRoute: () => ({ name: "category", params: { slug: "liquids" }, query: {} }),
}));

function makeProduct(): Product {
  return {
    id: "p-1",
    categoryId: "cat-1",
    groupId: null,
    title: "Liquid Cherry",
    priceRub: 25,
    description: "",
    images: ["/img/p1.png"],
    createdAt: "2026-06-04T00:00:00.000Z",
    isAvailable: true,
    stock: 5,
  };
}

function installCatalogData() {
  const catalogStore = useCatalogStore();
  catalogStore.categories = [
    {
      id: "cat-1",
      slug: "liquids",
      name: "Жидкости",
      order: 1,
      productCount: 1,
      groups: [],
      displayMode: "visual",
    },
  ];
  catalogStore.products = [makeProduct()];
  catalogStore.allProducts = [...catalogStore.products];

  vi.spyOn(catalogStore, "setActiveCategory").mockImplementation(async (slug) => {
    catalogStore.activeCategory = slug;
  });
  vi.spyOn(catalogStore, "fetchCrossSell").mockResolvedValue([]);
  vi.spyOn(catalogStore, "loadCategoryImages").mockResolvedValue(undefined);
  vi.spyOn(catalogStore, "loadGroupImagesForCategory").mockResolvedValue(undefined);

  return catalogStore;
}

describe("SingleProductCard → CategoryView: один клик = один товар", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    sessionStorage.clear();
    routerPush.mockClear();
    vi.restoreAllMocks();
  });

  it("кнопка «+» карточки эмитит событие и не мутирует корзину сама", async () => {
    installCatalogData();
    const onAdd = vi.fn();
    const wrapper = mount(SingleProductCard, {
      props: { product: makeProduct(), quantity: 0 },
      attrs: { onAdd },
    });

    await wrapper.find(".single-qty-btn-add").trigger("click");

    // Карточка только эмитит — корзину не трогает.
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(useCartStore().totalItems).toBe(0);

    wrapper.unmount();
  });

  it("в связке с CategoryView клик «+» добавляет ровно 1 шт", async () => {
    installCatalogData();
    // Cross-sell карточки рендерятся на витрине категории и
    // используют SingleProductCard — проверяем связку через них.
    const catalogStore = useCatalogStore();
    catalogStore.crossSellProducts = { liquids: [makeProduct()] };
    vi.spyOn(catalogStore, "fetchCrossSell").mockResolvedValue([makeProduct()]);

    const wrapper = mount(CategoryView, {
      props: { slug: "liquids" },
      global: {
        stubs: {
          SmokeParticles: { template: "<div />" },
          LiquidLineTree: { template: "<div />" },
          GroupLineItem: { template: "<div />" },
          ToastNotification: { template: "<div />" },
          PhotoIcon: { template: "<span />" },
          ExclamationTriangleIcon: { template: "<span />" },
        },
      },
    });
    await flushPromises();

    const addBtn = wrapper.find(".single-qty-btn-add");
    expect(addBtn.exists()).toBe(true);

    await addBtn.trigger("click");
    expect(useCartStore().totalItems).toBe(1);
    expect(useCartStore().items[0]?.quantity).toBe(1);
    expect(wrapper.text()).toContain("Заказ на 25.00 BYN");

    // Повторное нажатие (инкремент) — тоже ровно +1.
    await wrapper.find(".single-qty-btn-plus").trigger("click");
    expect(useCartStore().totalItems).toBe(2);
    expect(useCartStore().items[0]?.quantity).toBe(2);

    wrapper.unmount();
  });
});
