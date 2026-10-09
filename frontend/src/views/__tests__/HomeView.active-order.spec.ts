import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import HomeView from "@/views/HomeView.vue";
import { useCatalogStore } from "@/stores/catalog";

const fetchMyActiveOrderMock = vi.hoisted(() => vi.fn());
const routerPush = vi.hoisted(() => vi.fn());

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: routerPush }),
}));

vi.mock("@/utils/customerOrders", () => ({
  getTelegramIdentity: () => ({ telegram_id: "11" }),
  fetchMyActiveOrder: fetchMyActiveOrderMock,
}));

describe("HomeView active order banner", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    fetchMyActiveOrderMock.mockResolvedValue({
      found: true,
      id: "order-1",
      order_number: 7695,
      status: "new",
      is_wholesale: false,
    });

    const catalogStore = useCatalogStore();
    catalogStore.categories = [];
    catalogStore.banners = [];
    vi.spyOn(catalogStore, "initialize").mockResolvedValue(undefined);
  });

  it("does not show the order number on the customer active order card", async () => {
    const wrapper = mount(HomeView, {
      global: {
        stubs: {
          SmokeParticles: { template: "<div />" },
          BannerCarousel: { template: "<div />" },
          FloatingCartBar: { template: "<div />" },
        },
      },
    });

    await flushPromises();

    expect(wrapper.text()).toContain("Активный заказ");
    expect(wrapper.text()).toContain("Заказ уже оформлен");
    expect(wrapper.text()).not.toContain("№7695");
    expect(wrapper.text()).not.toContain("7695");

    wrapper.unmount();
  });
});
