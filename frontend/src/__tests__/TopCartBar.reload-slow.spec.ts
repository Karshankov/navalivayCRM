import { describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount, flushPromises } from "@vue/test-utils";
import TopCartBar from "@/components/TopCartBar.vue";
import { useCartStore } from "@/stores/cart";
import { useCartFlight } from "@/composables/useCartFlight";

const routerPush = vi.fn();
vi.mock("vue-router", () => ({
  useRoute: () => ({ path: "/" }),
  useRouter: () => ({ push: routerPush }),
}));

// Каталог «дозагружается»: сначала пустой, после микротаски — полный.
const catalogState = { products: [] as unknown[] };
vi.mock("@/stores/catalog", () => ({
  useCatalogStore: () => ({
    get allProducts() { return catalogState.products; },
    categories: [{ id: "cat-1" }],
    getGroupImage: () => null,
    getCategoryImage: () => null,
  }),
}));

describe("reload with slow catalog", () => {
  it("плашка раскрыта после F5, когда корзина наполнена позже монтирования", async () => {
    localStorage.setItem("navalivay_cart", JSON.stringify([
      { productId: "p-1", productTitle: "Т", title: "Т", priceRub: 25, quantity: 1, image: null, loyaltyUnitsApplied: 0, excludedFromWholesaleMin: true },
    ]));

    const pinia = createPinia();
    setActivePinia(pinia);

    const host = document.createElement("div");
    document.body.appendChild(host);
    const wrapper = mount(TopCartBar, {
      props: { visible: true },
      attachTo: host,
    });

    // Монтирование при пустом стор корзины (загрузка ещё идёт).
    // Каталог «пришёл» — стор наполняет корзину после mount.
    catalogState.products = [{ id: "p-1", images: [], variants: [], groupId: null }];
    const { totalItems } = useCartFlight();
    // Наполняем как loadFromStorage: присваиваем items напрямую.
    const cartStore = useCartStore();
    cartStore.items.splice(0, cartStore.items.length, {
      productId: "p-1", productTitle: "Т", title: "Т", priceRub: 25, quantity: 1,
      image: null, loyaltyUnitsApplied: 0, excludedFromWholesaleMin: true,
    });

    await flushPromises();
    expect(cartStore.totalItems).toBe(1);
    void totalItems.value;

    const { expanded, expandedVisual } = useCartFlight();
    expect(expanded.value).toBe(true);
    expect(expandedVisual.value).toBe(true);
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".nav-top-cart--expanded").exists()).toBe(true);
    expect(wrapper.find(".nav-top-cart__title").text()).toBe("Заказ на 25 BYN");

    wrapper.unmount();
    host.remove();
  });
});