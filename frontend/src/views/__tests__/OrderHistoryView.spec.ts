import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import OrderHistoryView from "@/views/OrderHistoryView.vue";

const routerPush = vi.hoisted(() => vi.fn());
const routerBack = vi.hoisted(() => vi.fn());
const fetchOrderHistoryMock = vi.hoisted(() => vi.fn());

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: routerPush, back: routerBack }),
}));

vi.mock("@/composables/useCustomerOrders", () => ({
  formatOrderHistoryTitle: (orderNumber: number) => `Заказ № ${orderNumber}`,
  formatOrderHistoryMeta: (order: { status: string }) =>
    order.status === "delivered" ? "Выдан" : order.status,
  useCustomerOrders: () => ({
    fetchOrderHistory: fetchOrderHistoryMock,
  }),
}));

describe("OrderHistoryView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders order cards and opens detail on tap", async () => {
    fetchOrderHistoryMock.mockResolvedValue({
      items: [
        {
          id: "ord1",
          order_number: 1001,
          status: "delivered",
          created_at: "2026-06-01T10:00:00.000Z",
          completed_at: "2026-06-01T12:00:00.000Z",
          final_amount: 42,
          category_icons: [
            { category_id: "cat1", category_name: "Жидкости", image: null },
            { category_id: "cat2", category_name: "Расходники", image: null },
          ],
          category_icons_overflow: 0,
        },
      ],
      next_cursor: null,
    });

    const wrapper = mount(OrderHistoryView);
    await flushPromises();

    expect(wrapper.text()).toContain("Мои заказы");
    expect(wrapper.text()).toContain("Заказ № 1001");
    expect(wrapper.text()).not.toContain("Жидкости");
    expect(wrapper.text()).toContain("Выдан");
    expect(wrapper.find(".order-history-card__meta--fulfilled").exists()).toBe(true);
    expect(wrapper.text()).not.toContain("Оценить");
    expect(wrapper.text()).toContain("42 BYN");

    await wrapper.find(".order-history-card").trigger("click");
    expect(routerPush).toHaveBeenCalledWith({
      name: "order-detail",
      params: { orderId: "ord1" },
    });

    wrapper.unmount();
  });

  it("shows review hint on cooldown repeat-purchase order", async () => {
    fetchOrderHistoryMock.mockResolvedValue({
      items: [
        {
          id: "ord_repeat",
          order_number: 2002,
          status: "delivered",
          created_at: "2026-06-10T10:00:00.000Z",
          completed_at: "2026-06-10T12:00:00.000Z",
          final_amount: 55,
          category_icons: [],
          category_icons_overflow: 0,
          review_hint: "Отзыв на эту линейку уже оставлен",
        },
      ],
      next_cursor: null,
    });

    const wrapper = mount(OrderHistoryView);
    await flushPromises();

    expect(wrapper.text()).toContain("Отзыв на эту линейку уже оставлен");

    wrapper.unmount();
  });

  it("shows empty state when history has no items", async () => {
    fetchOrderHistoryMock.mockResolvedValue({ items: [], next_cursor: null });

    const wrapper = mount(OrderHistoryView);
    await flushPromises();

    expect(wrapper.text()).toContain("Здесь появятся завершённые заказы");

    wrapper.unmount();
  });

  it("loads more orders when cursor is present", async () => {
    fetchOrderHistoryMock
      .mockResolvedValueOnce({
        items: [
          {
            id: "ord1",
            order_number: 1001,
            status: "delivered",
            created_at: "2026-06-01T10:00:00.000Z",
            completed_at: "2026-06-01T12:00:00.000Z",
            final_amount: 42,
            category_icons: [],
            category_icons_overflow: 0,
          },
        ],
        next_cursor: "cursor-1",
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: "ord2",
            order_number: 1000,
            status: "delivered",
            created_at: "2026-05-01T10:00:00.000Z",
            completed_at: "2026-05-01T12:00:00.000Z",
            final_amount: 30,
            category_icons: [],
            category_icons_overflow: 0,
          },
        ],
        next_cursor: null,
      });

    const wrapper = mount(OrderHistoryView);
    await flushPromises();

    expect(wrapper.findAll(".order-history-card")).toHaveLength(1);

    await wrapper.find(".order-history-more").trigger("click");
    await flushPromises();

    expect(fetchOrderHistoryMock).toHaveBeenLastCalledWith({
      cursor: "cursor-1",
      limit: 20,
    });
    expect(wrapper.findAll(".order-history-card")).toHaveLength(2);

    wrapper.unmount();
  });

  it("navigates back to profile from header button", async () => {
    fetchOrderHistoryMock.mockResolvedValue({ items: [], next_cursor: null });

    const wrapper = mount(OrderHistoryView);
    await flushPromises();

    await wrapper.find(".order-history-back").trigger("click");
    expect(routerPush).toHaveBeenCalledWith({ name: "profile" });

    wrapper.unmount();
  });

  it("shows retry on fetch error", async () => {
    fetchOrderHistoryMock.mockRejectedValue(new Error("Сеть недоступна"));

    const wrapper = mount(OrderHistoryView);
    await flushPromises();

    expect(wrapper.text()).toContain("Сеть недоступна");
    expect(wrapper.find(".order-history-retry").exists()).toBe(true);

    wrapper.unmount();
  });
});