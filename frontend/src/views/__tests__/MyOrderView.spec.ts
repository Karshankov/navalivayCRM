import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import MyOrderView from "@/views/MyOrderView.vue";

const routerPush = vi.fn();

vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: routerPush,
  }),
}));

function createJsonResponse(data: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    headers: {
      get: () => "application/json",
    },
    json: async () => data,
  };
}

function buildOrder(
  status: "new" | "in_progress",
  pickupCellNumber: number | null = null,
) {
  return {
    found: true,
    id: "order-1",
    order_number: 101,
    status,
    pickup_cell_number: pickupCellNumber,
    delivery_type: "pickup",
    delivery_address: null,
    phone: null,
    notes: null,
    total_amount: 30,
    discount_amount: 0,
    final_amount: 30,
    promo_code_text: null,
    telegram_username: "customer_one",
    created_at: "2026-03-24T10:00:00.000Z",
    updated_at: "2026-03-24T10:00:00.000Z",
    needs_manager_action: 0,
    manager_action_type: null,
    manager_action_note: null,
    can_edit: true,
    can_cancel: true,
    items: [
      {
        id: "oi-1",
        product_id: "p-1",
        product_title: "Liquid Cherry",
        base_product_title: "Liquid Cherry",
        quantity: 2,
        price_per_unit: 15,
        discount_amount: 0,
        total_price: 30,
        total_cost: 0,
        image: "/img/liquid.png",
        group_name: "Жидкости",
        variant_name: null,
        cart_item: {
          productId: "p-1",
          title: "Liquid Cherry",
          priceRub: 15,
          quantity: 2,
        },
      },
    ],
  };
}

describe("MyOrderView", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    routerPush.mockReset();
    vi.stubGlobal("fetch", vi.fn(async () => createJsonResponse(buildOrder("new"))));
    (window as any).Telegram = {
      WebApp: {
        initData: "signed_init_data",
        initDataUnsafe: {
          user: {
            id: 1,
            username: "customer_one",
          },
        },
      },
    };
  });

  it("shows pending pickup status for new order", async () => {
    const wrapper = mount(MyOrderView);

    await flushPromises();

    expect(wrapper.text()).toContain("Заказ собирают...");
    expect(wrapper.text()).toContain("Ваш заказ отправлен");
    expect(wrapper.text()).not.toContain("101");
    expect(wrapper.find(".order-pickup-cell").exists()).toBe(false);

    wrapper.unmount();
  });

  it("shows the assigned pickup number while a new order is still being assembled", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => createJsonResponse(buildOrder("new", 4))));
    const wrapper = mount(MyOrderView);

    await flushPromises();

    expect(wrapper.text()).toContain("Заказ собирают...");
    expect(wrapper.text()).toContain("Заказ №4");
    expect(wrapper.text()).not.toContain("101");
    expect(wrapper.find(".order-pickup-cell").attributes("aria-label")).toBe("Заказ №4");
    expect(wrapper.text()).toContain("Назовите этот номер сотруднику");

    wrapper.unmount();
  });

  it("shows ready status for assembled order", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => createJsonResponse(buildOrder("in_progress", 7))));
    const wrapper = mount(MyOrderView);

    await flushPromises();

    expect(wrapper.text()).toContain("Заказ готов к выдаче");
    expect(wrapper.text()).toContain("Заказ №7");
    expect(wrapper.text()).not.toContain("101");
    expect(wrapper.find(".order-pickup-cell").attributes("aria-label")).toBe("Заказ №7");
    expect(wrapper.text()).toContain("Назовите этот номер сотруднику");
    expect(wrapper.text()).toContain("Готовы к выдаче");
    expect(wrapper.text()).toContain("с 10:30 до 21:00");

    wrapper.unmount();
  });

  it("does not invent a cell for a legacy assembled order", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => createJsonResponse(buildOrder("in_progress"))));
    const wrapper = mount(MyOrderView);

    await flushPromises();

    expect(wrapper.text()).toContain("Заказ готов к выдаче");
    expect(wrapper.text()).not.toContain("101");
    expect(wrapper.find(".order-pickup-cell").exists()).toBe(false);

    wrapper.unmount();
  });
});
