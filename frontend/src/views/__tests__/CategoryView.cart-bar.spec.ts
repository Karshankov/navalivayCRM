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

describe("CategoryView cart bar visibility", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    sessionStorage.clear();
    routerPush.mockClear();
    vi.restoreAllMocks();
  });

  it("shows the checkout cart bar for retail customers when cart has items", async () => {
    installCatalogData();
    addCartItem();

    const wrapper = await mountCategory();

    expect(wrapper.find(".cart-wrapper").exists()).toBe(true);
    expect(wrapper.text()).toContain("Заказ на 25.00 BYN");

    await wrapper.find(".cart-button").trigger("click");
    expect(routerPush).toHaveBeenCalledWith("/checkout");

    wrapper.unmount();
  });

  it("keeps the checkout cart bar visible for wholesale customers with cart items", async () => {
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
    expect(wrapper.find(".cart-wrapper").exists()).toBe(true);
    expect(wrapper.text()).toContain("Заказ на 25.00 BYN");

    wrapper.unmount();
  });

  it("does not show the cart bar in wholesale mode when the cart is empty", async () => {
    installCatalogData();
    useWholesaleStore().applyOrderWholesaleContext({
      code: "100",
      secret: "secret",
      label: "Опт от 100 BYN",
      minOrderAmount: 100,
    });

    const wrapper = await mountCategory();

    expect(useWholesaleStore().isWholesale).toBe(true);
    expect(useCartStore().totalItems).toBe(0);
    expect(wrapper.find(".cart-wrapper").exists()).toBe(false);

    wrapper.unmount();
  });
});
