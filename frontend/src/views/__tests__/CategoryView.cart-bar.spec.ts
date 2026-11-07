import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import CategoryView from "@/views/CategoryView.vue";
import { useCartStore } from "@/stores/cart";
import { useCatalogStore } from "@/stores/catalog";
import { useWholesaleStore } from "@/stores/wholesale";

const routerPush = vi.fn();

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: routerPush }),
  useRoute: () => ({ name: "category", params: { slug: "liquids" }, query: {} }),
}));

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
  catalogStore.products = [
    {
      id: "p-1",
      categoryId: "cat-1",
      groupId: null,
      title: "Liquid Cherry",
      priceRub: 25,
      description: "",
      images: [],
      createdAt: "2026-06-04T00:00:00.000Z",
      isAvailable: true,
    },
  ];
  catalogStore.allProducts = [...catalogStore.products];

  vi.spyOn(catalogStore, "setActiveCategory").mockImplementation(async (slug) => {
    catalogStore.activeCategory = slug;
  });
  vi.spyOn(catalogStore, "fetchCrossSell").mockResolvedValue([]);
  vi.spyOn(catalogStore, "loadCategoryImages").mockResolvedValue(undefined);
  vi.spyOn(catalogStore, "loadGroupImagesForCategory").mockResolvedValue(undefined);

  return catalogStore;
}

function addCartItem() {
  const cartStore = useCartStore();
  cartStore.addItem(
    {
      id: "p-1",
      categoryId: "cat-1",
      groupId: null,
      title: "Liquid Cherry",
      priceRub: 25,
      description: "",
      images: [],
      createdAt: "2026-06-04T00:00:00.000Z",
      isAvailable: true,
    },
    1,
  );
  return cartStore;
}

async function mountCategory() {
  const wrapper = mount(CategoryView, {
    props: { slug: "liquids" },
    global: {
      stubs: {
        SmokeParticles: { template: "<div />" },
        SingleProductCard: { template: "<div />" },
        LiquidLineTree: { template: "<div />" },
        GroupLineItem: { template: "<div />" },
        ToastNotification: { template: "<div />" },
        PhotoIcon: { template: "<span />" },
        ExclamationTriangleIcon: { template: "<span />" },
      },
    },
  });
  await flushPromises();
  return wrapper;
}

describe("CategoryView: нижняя кнопка корзины удалена", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    sessionStorage.clear();
    routerPush.mockClear();
    vi.restoreAllMocks();
  });

  it("не рендерит нижнюю кнопку корзины при непустой корзине", async () => {
    installCatalogData();
    addCartItem();

    const wrapper = await mountCategory();

    // Функционал корзины живёт в верхней панели (TopCartBar),
    // дубль снизу удалён.
    expect(useCartStore().totalItems).toBe(1);
    expect(wrapper.find(".cart-wrapper").exists()).toBe(false);
    expect(wrapper.find(".cart-button").exists()).toBe(false);

    wrapper.unmount();
  });

  it("не рендерит нижнюю кнопку и для оптовиков с корзиной", async () => {
    installCatalogData();
    useWholesaleStore().applyOrderWholesaleContext({
      code: "100",
      secret: "secret",
      label: "Опт от 100 BYN",
      minOrderAmount: 100,
    });
    addCartItem();

    const wrapper = await mountCategory();

    expect(useWholesaleStore().isWholesale).toBe(true);
    expect(useCartStore().totalItems).toBe(1);
    expect(wrapper.find(".cart-wrapper").exists()).toBe(false);

    wrapper.unmount();
  });

  it("категория рендерится и с пустой корзиной", async () => {
    installCatalogData();

    const wrapper = await mountCategory();

    expect(useCartStore().totalItems).toBe(0);
    expect(wrapper.text()).toContain("Жидкости");

    wrapper.unmount();
  });
});
