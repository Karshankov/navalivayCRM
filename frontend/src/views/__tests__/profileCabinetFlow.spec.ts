import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import ProfileView from "@/views/ProfileView.vue";
import OrderHistoryView from "@/views/OrderHistoryView.vue";
import ReviewPromptModal from "@/components/reviews/ReviewPromptModal.vue";

const fetchOrderHistoryMock = vi.hoisted(() => vi.fn());
const promptFetchCount = vi.hoisted(() => ({ value: 0 }));

function createJsonResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    json: async () => data,
  };
}

function buildFetchMock() {
  const preferences = {
    reviews_opt_out: false,
    reviews_prefer_anonymous: true,
  };

  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/customer/me")) {
      return createJsonResponse({
        id: "customer-1",
        telegram_id: "11",
        telegram_username: "profile_user",
        first_name: "Profile",
        last_name: "User",
        total_orders: 2,
        total_spent: 30,
        member_since: "2026-03-01T10:00:00.000Z",
      });
    }
    if (url.startsWith("/api/loyalty/me")) {
      return createJsonResponse({ found: false, categories: [] });
    }
    if (url === "/api/reviews/prompt") {
      promptFetchCount.value += 1;
      return createJsonResponse({
        show: true,
        order_id: "ord1",
        group_id: "grp1",
        group_name: "Подонки",
        pending_review_count: 1,
        preferences: { ...preferences },
      });
    }
    if (url === "/api/wheel/state") {
      return createJsonResponse({ balance: 0, feed_consent: false, can_spin: false });
    }
    if (url.startsWith("/api/orders/my-history")) {
      return createJsonResponse({
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
        next_cursor: null,
      });
    }
    if (url === "/api/profile/review-preferences" && init?.method === "PATCH") {
      const body = JSON.parse(String(init.body));
      if (body.reviews_opt_out !== undefined) {
        preferences.reviews_opt_out = Boolean(body.reviews_opt_out);
      }
      return createJsonResponse({
        ok: true,
        reviews_opt_out: preferences.reviews_opt_out,
        reviews_prefer_anonymous: preferences.reviews_prefer_anonymous,
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

vi.mock("@/composables/useCustomerOrders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/composables/useCustomerOrders")>();
  return {
    ...actual,
    formatOrderHistoryTitle: (orderNumber: number) => `Заказ № ${orderNumber}`,
    formatOrderHistoryMeta: () => "Выдан",
    useCustomerOrders: () => {
      const api = actual.useCustomerOrders();
      return {
        ...api,
        fetchOrderHistory: fetchOrderHistoryMock,
      };
    },
  };
});

describe("profile cabinet flow", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    promptFetchCount.value = 0;
    fetchOrderHistoryMock.mockReset();
    fetchOrderHistoryMock.mockResolvedValue({
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
      next_cursor: null,
    });

    (window as any).Telegram = {
      WebApp: {
        initData: "signed_init_data",
        initDataUnsafe: {
          user: { id: 11, username: "profile_user", first_name: "Profile" },
        },
      },
    };
  });

  it("loads preferences on profile and suppresses dock on order history", async () => {
    vi.stubGlobal("fetch", buildFetchMock());

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/profile", name: "profile", component: ProfileView },
        { path: "/profile/orders", name: "order-history", component: OrderHistoryView },
      ],
    });
    router.push("/profile");
    await router.isReady();

    const profileWrapper = mount(
      { components: { ReviewPromptModal }, template: "<router-view /><ReviewPromptModal />" },
      {
        global: {
          plugins: [router],
          stubs: { LoyaltyBonusPopup: true },
        },
      },
    );
    await flushPromises();

    expect(profileWrapper.text()).toContain("Анонимные отзывы");
    const profilePromptCalls = promptFetchCount.value;

    await router.push("/profile/orders");
    await flushPromises();

    expect(fetchOrderHistoryMock).toHaveBeenCalled();
    expect(profileWrapper.find(".customer-modal-overlay").exists()).toBe(false);
    expect(promptFetchCount.value).toBe(profilePromptCalls);

    profileWrapper.unmount();
  });
});