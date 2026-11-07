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

// Каталог отвечает мгновенно — как в реальном приложении после F5.
vi.mock("@/stores/catalog", () => {
  return {
    useCatalogStore: () => ({
      allProducts: [{ id: "p-1", images: [], variants: [] }],
      categories: [{ id: "cat-1" }],
      getGroupImage: () => null,
      getCategoryImage: () => null,
    }),
  };
});

describe("reload with stored cart", () => {
  it("плашка раскрыта после F5 с корзиной в localStorage", async () => {
    localStorage.setItem("navalivay_cart", JSON.stringify([
      { productId: "p-1", productTitle: "Т", title: "Т", priceRub: 25, quantity: 1, image: null, loyaltyUnitsApplied: 0, excludedFromWholesaleMin: true },
    ]));

    const pinia = createPinia();
    setActivePinia(pinia);

    // Первый touch стора — как в реальном приложении (loadFromStorage
    // стартует при создании стора и ждёт каталог).
    const { expanded, expandedVisual, totalItems } = useCartFlight();
    void totalItems.value; // ensureStore → watch создан

    // loadFromStorage идёт асинхронно (await каталога).
    await flushPromises();

    // Стор корзины создан, товары восстановлены.
    expect(useCartStore().totalItems).toBe(1);
    expect(expanded.value).toBe(true);
    expect(expandedVisual.value).toBe(true);
  });
});