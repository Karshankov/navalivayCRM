import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ReviewPromptModal from "@/components/reviews/ReviewPromptModal.vue";

const routerPush = vi.hoisted(() => vi.fn());

const routeState = vi.hoisted(() => {
  const { reactive } = require("vue") as typeof import("vue");
  return reactive({
    path: "/",
    fullPath: "/",
    name: "home" as string | undefined,
    params: {} as Record<string, string>,
    query: {} as Record<string, string>,
  });
});

vi.mock("vue-router", () => ({
  useRoute: () => routeState,
  useRouter: () => ({ push: routerPush }),
}));

const fetchReviewPromptMock = vi.hoisted(() => vi.fn());

const reviewPromptState = vi.hoisted(() => {
  const { ref } = require("vue") as typeof import("vue");
  return ref({
    show: true,
    order_id: "ord1",
    order_number: 1001,
    group_id: "grp1",
    group_name: "Подонки",
    pending_review_count: 1,
    preview_icons: [
      {
        category_id: "cat1",
        group_id: "grp1",
        category_name: "Жидкости",
        group_name: "Подонки",
        image: "https://example.com/group.webp",
      },
    ],
    preview_icons_overflow: 0,
    lottery_hint_text:
      "В конце месяца разыгрываем 5 подарков среди оставивших отзывы",
  });
});

vi.mock("@/composables/useCustomerOrders", () => ({
  useCustomerOrders: () => ({
    reviewPrompt: reviewPromptState,
    fetchReviewPrompt: fetchReviewPromptMock,
  }),
}));

function mountModal(options: { autoLoad?: boolean } = {}) {
  return mount(ReviewPromptModal, {
    props: { autoLoad: options.autoLoad ?? true },
    global: {
      stubs: {
        CustomerModalShell: {
          props: ["open", "title"],
          emits: ["close"],
          template: `
            <div v-if="open" class="customer-modal-overlay">
              <h2>{{ title }}</h2>
              <button type="button" class="customer-modal-close" @click="$emit('close')">×</button>
              <slot />
              <slot name="footer" />
            </div>
          `,
        },
      },
    },
  });
}

describe("ReviewPromptModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    fetchReviewPromptMock.mockResolvedValue({ show: true });
    routeState.path = "/";
    routeState.fullPath = "/";
    routeState.name = "home";
    routeState.params = {};
    reviewPromptState.value = {
      show: true,
      order_id: "ord1",
      order_number: 1001,
      group_id: "grp1",
      group_name: "Подонки",
      pending_review_count: 1,
      preview_icons: [
        {
          category_id: "cat1",
          group_id: "grp1",
          category_name: "Жидкости",
          group_name: "Подонки",
          image: "https://example.com/group.webp",
        },
      ],
      preview_icons_overflow: 0,
      lottery_hint_text:
        "В конце месяца разыгрываем 5 подарков среди оставивших отзывы",
    };
  });

  it("opens on home with thumbnails, order label and lottery hint", async () => {
    const wrapper = mountModal();
    await flushPromises();

    expect(wrapper.text()).toContain("Оцените последний заказ");
    expect(wrapper.text()).toContain("Заказ №1001");
    expect(wrapper.text()).toContain(
      "В конце месяца разыгрываем 5 подарков среди оставивших отзывы",
    );
    expect(wrapper.find(".review-prompt-modal__thumb img").attributes("src")).toBe(
      "https://example.com/group.webp",
    );

    wrapper.unmount();
  });

  it("navigates to order detail from CTA", async () => {
    const wrapper = mountModal();
    await flushPromises();

    await wrapper.find(".review-prompt-modal__cta").trigger("click");

    expect(routerPush).toHaveBeenCalledWith({
      name: "order-detail",
      params: { orderId: "ord1" },
      query: { groupId: "grp1" },
    });

    wrapper.unmount();
  });

  it("does not open outside home route", async () => {
    routeState.path = "/profile";
    routeState.fullPath = "/profile";

    const wrapper = mountModal({ autoLoad: false });
    await flushPromises();

    expect(wrapper.find(".customer-modal-overlay").exists()).toBe(false);

    wrapper.unmount();
  });

  it("stays closed after dismiss for the same order in session", async () => {
    const wrapper = mountModal();
    await flushPromises();

    await wrapper.find(".customer-modal-close").trigger("click");
    await flushPromises();

    expect(wrapper.find(".customer-modal-overlay").exists()).toBe(false);
    expect(sessionStorage.getItem("review_prompt_dismissed_order_id")).toBe("ord1");

    wrapper.unmount();
  });

  it("fetches prompt on mount but not on order history routes", async () => {
    const wrapper = mountModal();
    await flushPromises();

    expect(fetchReviewPromptMock).toHaveBeenCalledTimes(1);

    routeState.path = "/profile/orders";
    routeState.fullPath = "/profile/orders";
    await flushPromises();

    const callsAfterOrders = fetchReviewPromptMock.mock.calls.length;
    routeState.path = "/";
    routeState.fullPath = "/";
    await flushPromises();

    expect(fetchReviewPromptMock.mock.calls.length).toBeGreaterThan(callsAfterOrders);

    wrapper.unmount();
  });
});