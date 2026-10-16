import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import ProfileView from "@/views/ProfileView.vue";
import { useCustomerOrders } from "@/composables/useCustomerOrders";

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

describe("ProfileView loyalty section", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    sessionStorage.clear();

    (window as any).Telegram = {
      WebApp: {
        initData: "signed_init_data",
        initDataUnsafe: {
          user: {
            id: 11,
            username: "profile_user",
            first_name: "Profile",
            last_name: "User",
          },
        },
      },
    };
  });

  it("renders loyalty showcase card and keeps the bonus popup hidden on profile", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
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
        return createJsonResponse({
          found: true,
          customer_id: "customer-1",
          telegram_username: "profile_user",
          has_available_bonus: true,
          categories: [
            {
              id: "loyalty-liquids",
              key: "liquids",
              title: "Liquids",
              description: null,
              threshold: 10,
              discount_amount: 10,
              balance: 12,
              available_bonus_count: 1,
              remaining_to_next: 8,
              active: 1,
            },
          ],
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(ProfileView, {
      global: {
        stubs: {
          LoyaltyBonusPopup: {
            props: ["open"],
            template: "<div v-if=\"open\" class=\"bonus-popup-stub\"></div>",
          },
        },
      },
    });

    await flushPromises();

    expect(wrapper.findAll(".loyalty-card")).toHaveLength(1);
    expect(wrapper.text()).toContain("Бонусная система");
    expect(wrapper.find(".loyalty-tab--active").text()).toContain("Жидкости");
    expect(wrapper.find(".loyalty-progress-value").text()).toContain("2 / 10");
    // Кнопка «Оплата картой» удалена из профиля полностью: карта
    // настраивается в корзине при оформлении заказа.
    expect(wrapper.find(".card-pay-link").exists()).toBe(false);
    expect(wrapper.find(".card-limit-card").exists()).toBe(false);
    expect(wrapper.find(".bonus-popup-stub").exists()).toBe(false);

    await wrapper.find(".loyalty-rules-link").trigger("click");

    expect(wrapper.find(".rules-modal-overlay").exists()).toBe(true);
    expect(wrapper.text()).toContain("Бонусная система скидок, как работает?");
    expect(wrapper.text()).toContain("Отслеживать количество купленных позиций");
    expect(wrapper.text()).toContain("Каждая купленная позиция без скидок и промокодов");
    expect(wrapper.text()).toContain("появится окно с возможностью активировать скидку");

    await wrapper.find(".rules-modal-close").trigger("click");

    expect(wrapper.find(".rules-modal-overlay").exists()).toBe(false);

    wrapper.unmount();
  });
});

describe("ProfileView review preferences", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    sessionStorage.clear();
    const { reviewPreferences } = useCustomerOrders();
    reviewPreferences.value = {
      reviews_opt_out: false,
      reviews_prefer_anonymous: false,
    };

    (window as any).Telegram = {
      WebApp: {
        initData: "signed_init_data",
        initDataUnsafe: {
          user: {
            id: 11,
            username: "profile_user",
            first_name: "Profile",
            last_name: "User",
          },
        },
      },
    };
  });

  function buildFetchMock(patchHandler = vi.fn()) {
    const preferences = {
      reviews_opt_out: false,
      reviews_prefer_anonymous: false,
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
        return createJsonResponse({
          show: true,
          order_id: "ord1",
          pending_review_count: 1,
          preferences: { ...preferences },
        });
      }
      if (url === "/api/wheel/state") {
        return createJsonResponse({
          balance: 0,
          feed_consent: false,
          can_spin: false,
        });
      }
      if (url === "/api/profile/review-preferences" && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        patchHandler(body);
        if (body.reviews_opt_out !== undefined) {
          preferences.reviews_opt_out = Boolean(body.reviews_opt_out);
        }
        if (body.reviews_prefer_anonymous !== undefined) {
          preferences.reviews_prefer_anonymous = Boolean(body.reviews_prefer_anonymous);
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

  it("renders orders link and review preference toggles", async () => {
    vi.stubGlobal("fetch", buildFetchMock());

    const wrapper = mount(ProfileView, {
      global: {
        stubs: {
          LoyaltyBonusPopup: true,
        },
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("Мои заказы");
    expect(wrapper.text()).toContain("Напоминания об отзывах");
    expect(wrapper.text()).toContain("Анонимные отзывы");

    const switches = wrapper.findAll("button.wheel-feed-toggle");
    expect(switches[1].attributes("aria-checked")).toBe("true");
    expect(switches[2].attributes("aria-checked")).toBe("false");

    wrapper.unmount();
  });

  it("toggles review prompt opt-out via preferences API", async () => {
    const patchHandler = vi.fn();
    vi.stubGlobal("fetch", buildFetchMock(patchHandler));

    const wrapper = mount(ProfileView, {
      global: {
        stubs: {
          LoyaltyBonusPopup: true,
        },
      },
    });
    await flushPromises();

    const switches = wrapper.findAll("button.wheel-feed-toggle");
    await switches[1].trigger("click");
    await flushPromises();

    expect(patchHandler).toHaveBeenCalledWith({ reviews_opt_out: true });
    expect(switches[1].attributes("aria-checked")).toBe("false");

    wrapper.unmount();
  });

  it("shows anonymous preference from prompt on first load", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
        return createJsonResponse({
          show: false,
          reason: "nothing_to_review",
          preferences: {
            reviews_opt_out: false,
            reviews_prefer_anonymous: true,
          },
        });
      }
      if (url === "/api/wheel/state") {
        return createJsonResponse({
          balance: 0,
          feed_consent: false,
          can_spin: false,
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(ProfileView, {
      global: {
        stubs: {
          LoyaltyBonusPopup: true,
        },
      },
    });
    await flushPromises();

    const switches = wrapper.findAll("button.wheel-feed-toggle");
    expect(switches[2].attributes("aria-checked")).toBe("true");

    wrapper.unmount();
  });

  it("toggles anonymous review preference", async () => {
    const patchHandler = vi.fn();
    vi.stubGlobal("fetch", buildFetchMock(patchHandler));

    const wrapper = mount(ProfileView, {
      global: {
        stubs: {
          LoyaltyBonusPopup: true,
        },
      },
    });
    await flushPromises();

    const switches = wrapper.findAll("button.wheel-feed-toggle");
    await switches[2].trigger("click");
    await flushPromises();

    expect(patchHandler).toHaveBeenCalledWith({ reviews_prefer_anonymous: true });
    expect(switches[2].attributes("aria-checked")).toBe("true");

    wrapper.unmount();
  });
});
