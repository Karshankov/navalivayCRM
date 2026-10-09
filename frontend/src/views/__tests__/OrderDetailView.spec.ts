import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import OrderDetailView from "@/views/OrderDetailView.vue";

const routerPush = vi.hoisted(() => vi.fn());
const fetchOrderDetailMock = vi.hoisted(() => vi.fn());
const fetchReviewPromptMock = vi.hoisted(() => vi.fn());

const routeState = vi.hoisted(() => ({
  params: { orderId: "ord1" },
  query: {} as Record<string, string>,
}));

vi.mock("vue-router", () => ({
  useRoute: () => routeState,
  useRouter: () => ({ push: routerPush }),
}));

vi.mock("@/composables/useCustomerOrders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/composables/useCustomerOrders")>();
  return {
    ...actual,
    formatOrderDate: (value: string) => value.slice(0, 10),
    formatOrderDetailTitle: (_completedAt: string, createdAt: string) => createdAt.slice(0, 10),
    formatOrderStatus: (status: string) => (status === "delivered" ? "Доставлен" : status),
    useCustomerOrders: () => ({
      fetchOrderDetail: fetchOrderDetailMock,
      fetchReviewPrompt: fetchReviewPromptMock,
      reviewPreferences: { value: { reviews_prefer_anonymous: false, reviews_opt_out: false } },
    }),
  };
});

const orderDetail = {
  id: "ord1",
  order_number: 1001,
  status: "delivered",
  delivery_type: "pickup",
  created_at: "2026-06-01T10:00:00.000Z",
  completed_at: "2026-06-01T12:00:00.000Z",
  final_amount: 42,
  fulfillment_milestones: {
    submitted_at: "2026-06-01T10:00:00.000Z",
    ready_at: "2026-06-01T11:00:00.000Z",
    issued_at: "2026-06-01T12:00:00.000Z",
    cancelled_at: null,
  },
  lottery_hint_text: "Оставьте отзыв — участвуйте в розыгрыше",
  reviewable_lines: [
    {
      group_id: "grp1",
      group_name: "Подонки",
      group_cover_image: null,
      category_cover_image: null,
      purchased_variant_name: "Ананасовая шипучка",
      order_item_id: "oi1",
      review_category_key: "liquids",
      items: [{ total_price: 42 }],
      eligibility: { canReview: true, reason: null, cooldownEndsAt: null },
      latest_review: null,
    },
  ],
};

describe("OrderDetailView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeState.params = { orderId: "ord1" };
    routeState.query = {};
    fetchOrderDetailMock.mockResolvedValue(orderDetail);
    fetchReviewPromptMock.mockResolvedValue({ show: false });
    vi.spyOn(document, "getElementById").mockReturnValue({
      scrollIntoView: vi.fn(),
    } as unknown as HTMLElement);
  });

  it("renders order summary and review section", async () => {
    const wrapper = mount(OrderDetailView, {
      global: {
        stubs: {
          ReviewLineCard: {
            props: ["line", "orderId", "initialRating", "highlighted"],
            template:
              '<div class="review-line-stub" :data-rating="initialRating" :data-highlighted="highlighted">{{ line.group_name }}</div>',
          },
        },
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("Подонки");
    expect(wrapper.text()).toContain("42 BYN");
    expect(wrapper.text()).toContain("1 позиция");
    expect(wrapper.text()).toContain("Заказ № 1001");
    expect(wrapper.find(".order-detail-overview").exists()).toBe(true);
    expect(wrapper.text()).toContain("Оформлен");
    expect(wrapper.text()).toContain("Собран");
    expect(wrapper.text()).toContain("Выдан");
    expect(wrapper.text()).not.toContain("Выполнение");
    expect(wrapper.text()).not.toContain("выполнен за");
    expect(wrapper.text()).toContain("Оставьте отзыв — участвуйте в розыгрыше");
    expect(wrapper.find(".review-line-stub").text()).toBe("Подонки");

    wrapper.unmount();
  });

  it("passes deep-link rating and highlight to matching line", async () => {
    routeState.query = { rating: "4", groupId: "grp1" };

    const wrapper = mount(OrderDetailView, {
      global: {
        stubs: {
          ReviewLineCard: {
            props: ["line", "orderId", "initialRating", "highlighted"],
            template:
              '<div class="review-line-stub" :data-rating="initialRating" :data-highlighted="highlighted" />',
          },
        },
      },
    });
    await flushPromises();

    const stub = wrapper.find(".review-line-stub");
    expect(stub.attributes("data-rating")).toBe("4");
    expect(stub.attributes("data-highlighted")).toBe("true");
    expect(document.getElementById).toHaveBeenCalledWith("review-line-grp1");

    wrapper.unmount();
  });

  it("ignores invalid deep-link rating", async () => {
    routeState.query = { rating: "9", groupId: "grp1" };

    const wrapper = mount(OrderDetailView, {
      global: {
        stubs: {
          ReviewLineCard: {
            props: ["initialRating"],
            template: '<div class="review-line-stub" :data-rating="initialRating" />',
          },
        },
      },
    });
    await flushPromises();

    expect(wrapper.find(".review-line-stub").attributes("data-rating")).toBe("0");

    wrapper.unmount();
  });

  it("renders cancelled status badge in red", async () => {
    fetchOrderDetailMock.mockResolvedValue({
      ...orderDetail,
      status: "cancelled",
      fulfillment_milestones: {
        submitted_at: "2026-06-16T08:24:00.000Z",
        ready_at: null,
        issued_at: null,
        cancelled_at: "2026-06-16T09:13:00.000Z",
      },
      reviewable_lines: [],
      lottery_hint_text: null,
    });

    const wrapper = mount(OrderDetailView, {
      global: { stubs: { ReviewLineCard: true } },
    });
    await flushPromises();

    expect(wrapper.find(".order-detail-overview__status--cancelled").exists()).toBe(true);
    expect(wrapper.find(".order-detail-overview__step--cancelled").exists()).toBe(true);

    wrapper.unmount();
  });

  it("navigates back to order history", async () => {
    const wrapper = mount(OrderDetailView, {
      global: { stubs: { ReviewLineCard: true } },
    });
    await flushPromises();

    await wrapper.find(".order-detail-back").trigger("click");
    expect(routerPush).toHaveBeenCalledWith({ name: "order-history" });

    wrapper.unmount();
  });
});