import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import CheckoutView from "@/views/CheckoutView.vue";
import { useCartStore } from "@/stores/cart";
import { useCatalogStore } from "@/stores/catalog";
import { useSettingsStore } from "@/stores/settings";
import { useWholesaleStore } from "@/stores/wholesale";

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

function buildActiveOrder() {
  return {
    found: true,
    id: "order-1",
    order_number: 101,
    status: "new",
    delivery_type: "pickup",
    delivery_address: null,
    phone: null,
    notes: null,
    total_amount: 15,
    discount_amount: 5,
    final_amount: 10,
    promo_code_text: "SAVE10",
    telegram_username: "checkout_user",
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
        quantity: 1,
        price_per_unit: 15,
        discount_amount: 0,
        total_price: 15,
        total_cost: 0,
        image: "/img/liquid.png",
        group_name: "Жидкости",
        variant_name: null,
        cart_item: {
          productId: "p-1",
          title: "Liquid Cherry",
          productTitle: "Liquid Cherry",
          groupName: "Жидкости",
          priceRub: 15,
          quantity: 1,
          image: "/img/liquid.png",
          variantId: null,
          variantName: null,
          groupId: "group-1",
          categoryId: "cat-1",
        },
      },
    ],
  };
}

function buildLoyaltySnapshot() {
  return {
    found: true,
    customer_id: "customer-1",
    telegram_username: "checkout_user",
    has_available_bonus: true,
    categories: [
      {
        id: "loyalty-liquids",
        key: "liquids",
        title: "Liquids",
        description: null,
        threshold: 10,
        discount_amount: 10,
        balance: 10,
        available_bonus_count: 1,
        remaining_to_next: 0,
        active: 1,
      },
    ],
  };
}

function buildLoyaltyPreview(appliedUnits = 0) {
  return {
    customer_id: "customer-1",
    promo_blocked: false,
    total_loyalty_discount: appliedUnits * 10,
    categories: [
      {
        category_id: "loyalty-liquids",
        category_key: "liquids",
        title: "Liquids",
        description: null,
        threshold: 10,
        discount_amount: 10,
        current_balance: 10,
        current_available_bonus_count: 1,
        items_in_cart: 1,
        eligible_purchase_units: 1,
        loyalty_units_applied: appliedUnits,
        spent_now: appliedUnits * 10,
        earned_after_fulfillment: Math.max(1 - appliedUnits, 0),
        projected_balance: appliedUnits > 0 ? 0 : 11,
        available_bonus_count: appliedUnits > 0 ? 0 : 1,
        remaining_to_next: appliedUnits > 0 ? 9 : 0,
        line_items: [
          {
            key: "p-1::",
            product_id: "p-1",
            variant_id: null,
            quantity: 1,
            loyalty_units_applied: appliedUnits,
            max_redeemable_units: 1,
            product_title: "Liquid Cherry",
          },
        ],
      },
    ],
  };
}

function buildMultiCategoryLoyaltyPreview() {
  return {
    customer_id: "customer-1",
    promo_blocked: false,
    total_loyalty_discount: 0,
    categories: [
      {
        category_id: "loyalty-liquids",
        category_key: "liquids",
        title: "Жидкости и снюс",
        description: null,
        threshold: 10,
        discount_amount: 10,
        current_balance: 0,
        current_available_bonus_count: 0,
        items_in_cart: 2,
        eligible_purchase_units: 2,
        loyalty_units_applied: 0,
        spent_now: 0,
        earned_after_fulfillment: 2,
        projected_balance: 2,
        available_bonus_count: 0,
        remaining_to_next: 8,
        line_items: [
          {
            key: "p-1::",
            product_id: "p-1",
            variant_id: null,
            quantity: 1,
            loyalty_units_applied: 0,
            max_redeemable_units: 1,
            product_title: "Liquid Cherry",
          },
          {
            key: "p-2::",
            product_id: "p-2",
            variant_id: null,
            quantity: 1,
            loyalty_units_applied: 0,
            max_redeemable_units: 1,
            product_title: "Snus Mint",
          },
        ],
      },
      {
        category_id: "loyalty-disposables",
        category_key: "disposables",
        title: "Одноразки",
        description: null,
        threshold: 5,
        discount_amount: 15,
        current_balance: 0,
        current_available_bonus_count: 0,
        items_in_cart: 1,
        eligible_purchase_units: 1,
        loyalty_units_applied: 0,
        spent_now: 0,
        earned_after_fulfillment: 1,
        projected_balance: 1,
        available_bonus_count: 0,
        remaining_to_next: 4,
        line_items: [
          {
            key: "p-3::",
            product_id: "p-3",
            variant_id: null,
            quantity: 1,
            loyalty_units_applied: 0,
            max_redeemable_units: 1,
            product_title: "Disposable Mint",
          },
        ],
      },
      {
        category_id: "loyalty-devices",
        category_key: "devices",
        title: "Устройства",
        description: null,
        threshold: 4,
        discount_amount: 25,
        current_balance: 0,
        current_available_bonus_count: 0,
        items_in_cart: 1,
        eligible_purchase_units: 1,
        loyalty_units_applied: 0,
        spent_now: 0,
        earned_after_fulfillment: 1,
        projected_balance: 1,
        available_bonus_count: 0,
        remaining_to_next: 3,
        line_items: [
          {
            key: "p-4::",
            product_id: "p-4",
            variant_id: null,
            quantity: 1,
            loyalty_units_applied: 0,
            max_redeemable_units: 1,
            product_title: "Device X",
          },
        ],
      },
    ],
  };
}

function buildSingleBonusChoicePreview() {
  return {
    customer_id: "customer-1",
    promo_blocked: false,
    total_loyalty_discount: 0,
    categories: [
      {
        category_id: "loyalty-liquids",
        category_key: "liquids",
        title: "Жидкости и снюс",
        description: null,
        threshold: 10,
        discount_amount: 10,
        current_balance: 10,
        current_available_bonus_count: 1,
        items_in_cart: 2,
        eligible_purchase_units: 2,
        loyalty_units_applied: 0,
        spent_now: 0,
        earned_after_fulfillment: 1,
        projected_balance: 1,
        available_bonus_count: 0,
        remaining_to_next: 9,
        line_items: [
          {
            key: "p-1::",
            product_id: "p-1",
            variant_id: null,
            quantity: 1,
            loyalty_units_applied: 0,
            max_redeemable_units: 1,
            product_title: "Liquid Cherry",
          },
          {
            key: "p-2::",
            product_id: "p-2",
            variant_id: null,
            quantity: 1,
            loyalty_units_applied: 0,
            max_redeemable_units: 1,
            product_title: "Snus Mint",
          },
        ],
      },
      {
        category_id: "loyalty-devices",
        category_key: "devices",
        title: "Устройства",
        description: null,
        threshold: 4,
        discount_amount: 25,
        current_balance: 0,
        current_available_bonus_count: 0,
        items_in_cart: 1,
        eligible_purchase_units: 1,
        loyalty_units_applied: 0,
        spent_now: 0,
        earned_after_fulfillment: 1,
        projected_balance: 1,
        available_bonus_count: 0,
        remaining_to_next: 3,
        line_items: [
          {
            key: "p-3::",
            product_id: "p-3",
            variant_id: null,
            quantity: 1,
            loyalty_units_applied: 0,
            max_redeemable_units: 1,
            product_title: "Device X",
          },
        ],
      },
    ],
  };
}

function buildCrossCategoryMultiBonusPreview() {
  return {
    customer_id: "customer-1",
    promo_blocked: false,
    total_loyalty_discount: 0,
    categories: [
      {
        category_id: "loyalty-liquids",
        category_key: "liquids",
        title: "Жидкости и снюс",
        description: null,
        threshold: 10,
        discount_amount: 10,
        current_balance: 20,
        current_available_bonus_count: 1,
        items_in_cart: 2,
        eligible_purchase_units: 2,
        loyalty_units_applied: 0,
        spent_now: 0,
        earned_after_fulfillment: 2,
        projected_balance: 22,
        available_bonus_count: 2,
        remaining_to_next: 8,
        line_items: [
          {
            key: "p-1::",
            product_id: "p-1",
            variant_id: null,
            quantity: 1,
            loyalty_units_applied: 0,
            max_redeemable_units: 1,
            product_title: "Liquid Cherry",
          },
          {
            key: "p-2::",
            product_id: "p-2",
            variant_id: null,
            quantity: 1,
            loyalty_units_applied: 0,
            max_redeemable_units: 1,
            product_title: "Snus Mint",
          },
        ],
      },
      {
        category_id: "loyalty-devices",
        category_key: "devices",
        title: "Устройства",
        description: null,
        threshold: 4,
        discount_amount: 25,
        current_balance: 8,
        current_available_bonus_count: 1,
        items_in_cart: 1,
        eligible_purchase_units: 1,
        loyalty_units_applied: 0,
        spent_now: 0,
        earned_after_fulfillment: 1,
        projected_balance: 9,
        available_bonus_count: 2,
        remaining_to_next: 3,
        line_items: [
          {
            key: "p-3::",
            product_id: "p-3",
            variant_id: null,
            quantity: 1,
            loyalty_units_applied: 0,
            max_redeemable_units: 1,
            product_title: "Device X",
          },
        ],
      },
    ],
  };
}

function buildVariantChoicePreview() {
  return {
    customer_id: "customer-1",
    promo_blocked: false,
    total_loyalty_discount: 0,
    categories: [
      {
        category_id: "loyalty-devices",
        category_key: "devices",
        title: "Устройства",
        description: null,
        threshold: 4,
        discount_amount: 25,
        current_balance: 4,
        current_available_bonus_count: 1,
        items_in_cart: 2,
        eligible_purchase_units: 2,
        loyalty_units_applied: 0,
        spent_now: 0,
        earned_after_fulfillment: 2,
        projected_balance: 6,
        available_bonus_count: 1,
        remaining_to_next: 2,
        line_items: [
          {
            key: "pasito::variant-black",
            product_id: "pasito",
            variant_id: "variant-black",
            quantity: 1,
            loyalty_units_applied: 0,
            max_redeemable_units: 1,
            product_title: "PASITO 2",
          },
          {
            key: "pasito::variant-silver",
            product_id: "pasito",
            variant_id: "variant-silver",
            quantity: 1,
            loyalty_units_applied: 0,
            max_redeemable_units: 1,
            product_title: "PASITO 2",
          },
        ],
      },
    ],
  };
}

describe("CheckoutView order flows", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    routerPush.mockReset();

    (window as any).Telegram = {
      WebApp: {
        initData: "signed_init_data",
        initDataUnsafe: {
          user: {
            id: 1,
            username: "checkout_user",
            first_name: "Checkout",
            last_name: "User",
          },
        },
      },
    };

    const settingsStore = useSettingsStore();
    settingsStore.fetchSettings = vi.fn(async () => undefined);
    settingsStore.settings = {
      manager_telegram: "manager",
      min_delivery_amount: "0",
      min_delivery_banner_image: "",
      min_delivery_banner_button_text: "Ок",
      min_delivery_banner_button_color: "#ffffff",
      delivery_conditions_image: "",
      order_redirect_telegram: "",
      order_redirect_text_template: "",
    };

    const catalogStore = useCatalogStore();
    catalogStore.fetchCategories = vi.fn(async () => undefined);
    catalogStore.categories = [];
  });

  it("shows warning and blocks card when the order exceeds the shared daily remainder", async () => {
    const cartStore = useCartStore();
    cartStore.replaceItemsFromOrder([
      {
        productId: "p-1",
        title: "Liquid Cherry",
        productTitle: "Liquid Cherry",
        groupName: "Жидкости",
        priceRub: 45,
        quantity: 1,
        image: "/img/liquid.png",
        variantId: null,
        variantName: null,
        groupId: "group-1",
        categoryId: "cat-1",
      },
    ]);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/product/")) {
        return createJsonResponse({ id: "p-1", hasVariants: false, stock: 10 });
      }
      if (url === "/api/card-payment/status") {
        return createJsonResponse({
          enabled: true,
          max_order_minor: 4500,
          card_available: true,
          monthly_limit_minor: 25000,
          monthly_used_minor: 14500,
          monthly_remaining_minor: 10500,
          limits: {
            daily_limit_minor: 25000,
            spent_today_minor: 23500,
            reserved_minor: 0,
          },
        });
      }
      if (url.startsWith("/api/loyalty/me")) {
        return createJsonResponse(buildLoyaltySnapshot());
      }
      if (url === "/api/loyalty/checkout-preview") {
        return createJsonResponse(buildLoyaltyPreview(0));
      }
      if (url === "/api/agreements") {
        return createJsonResponse({ items: [] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(CheckoutView, {
      global: {
        stubs: {
          MinDeliveryBanner: { template: "<div />" },
          DeliveryConditionsBanner: { template: "<div />" },
          AdminModal: { template: "<div><slot /></div>" },
          CustomerModalShell: {
            props: ["open", "title"],
            template: "<div v-if=\"open\" class=\"payment-modal\"><h2>{{ title }}</h2><slot /><slot name='footer' /></div>",
          },
          LoyaltyBonusPopup: { template: "<div />" },
          CheckoutAgreements: { template: "<div />" },
        },
      },
    });

    await flushPromises();
    await wrapper.find(".submit-button").trigger("click");
    await flushPromises();

    expect(wrapper.find(".payment-modal").exists()).toBe(true);
    expect(wrapper.text()).toContain("Как хотите оплатить заказ?");
    expect(wrapper.find(".payment-modal").text()).toContain("Наличными");
    expect(wrapper.find(".payment-modal").text()).toContain("Картой");
    expect(fetchMock.mock.calls.some(([input]) => String(input) === "/api/orders")).toBe(false);
    // Кнопка «Картой» всегда активна: даже при исчерпанном дневном лимите
    // клиент может открыть вкладку и посмотреть виджет.
    await wrapper.findAll(".payment-modal button")[1].trigger("click");
    await flushPromises();
    // Заказ 45 BYN при дневном остатке 15.00 BYN: картой нельзя, виджет
    // показывает состояние исчерпания и блокирует «Оформить заказ».
    expect(wrapper.find(".payment-modal").text()).toContain("Оплата картой недоступна");
    expect(wrapper.find(".payment-modal").text()).toContain("Общий лимит на сегодня исчерпан");
    const cardBtn = wrapper.findAll(".payment-modal button")[1];
    expect(cardBtn.attributes("disabled")).toBeUndefined();
    expect(
      wrapper.find(".payment-modal button.checkout-modal-cta:not(.checkout-modal-cta--dark)").attributes("disabled"),
    ).toBeDefined();
    // Виджет показывает лимит на заказ и быстрые действия.
    expect(wrapper.find(".payment-modal").text()).toContain("Лимит на заказ 45.00р");
    expect(wrapper.find(".payment-modal .card-widget__link").exists()).toBe(false);
    // Большая чёрная кнопка «Увеличить лимиты» — в футере модалки.
    expect(wrapper.find(".payment-modal .checkout-modal-cta--dark").exists()).toBe(true);

    wrapper.unmount();
  });

  it("shows cash-only message and disables card submit when the shared limit is exhausted", async () => {
    const cartStore = useCartStore();
    cartStore.replaceItemsFromOrder([
      {
        productId: "p-1",
        title: "Liquid Cherry",
        productTitle: "Liquid Cherry",
        groupName: "Жидкости",
        priceRub: 15,
        quantity: 1,
        image: "/img/liquid.png",
        variantId: null,
        variantName: null,
        groupId: "group-1",
        categoryId: "cat-1",
      },
    ]);

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/product/")) {
        return createJsonResponse({ id: "p-1", hasVariants: false, stock: 10 });
      }
      if (url === "/api/card-payment/status") {
        return createJsonResponse({
          enabled: true,
          max_order_minor: 4500,
          card_available: true,
          limits: {
            daily_limit_minor: 25000,
            spent_today_minor: 25000,
            reserved_minor: 0,
          },
        });
      }
      if (url.startsWith("/api/loyalty/me")) {
        return createJsonResponse(buildLoyaltySnapshot());
      }
      if (url === "/api/loyalty/checkout-preview") {
        return createJsonResponse(buildLoyaltyPreview(0));
      }
      if (url === "/api/agreements") {
        return createJsonResponse({ items: [] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const wrapper = mount(CheckoutView, {
      global: {
        stubs: {
          MinDeliveryBanner: { template: "<div />" },
          DeliveryConditionsBanner: { template: "<div />" },
          AdminModal: { template: "<div><slot /></div>" },
          CustomerModalShell: {
            props: ["open", "title"],
            template: "<div v-if=\"open\" class=\"payment-modal\"><h2>{{ title }}</h2><slot /><slot name='footer' /></div>",
          },
          LoyaltyBonusPopup: { template: "<div />" },
          CheckoutAgreements: { template: "<div />" },
        },
      },
    });

    await flushPromises();
    await wrapper.find(".submit-button").trigger("click");
    await flushPromises();
    await wrapper.findAll(".payment-modal button")[1].trigger("click");
    await flushPromises();

    // Дневной лимит исчерпан полностью: виджет показывает состояние блокировки.
    expect(wrapper.find(".payment-modal").text()).toContain(
      "Оплата картой недоступна",
    );
    expect(wrapper.find(".payment-modal").text()).toContain(
      "Оформите заказ за наличные. Общий лимит на сегодня исчерпан",
    );
    expect(wrapper.find(".payment-modal button.checkout-modal-cta:not(.checkout-modal-cta--dark)").attributes("disabled")).toBeDefined();

    wrapper.unmount();
  });

  it("shows cooldown days instead of dates when the card is paused", async () => {
    const cartStore = useCartStore();
    cartStore.replaceItemsFromOrder([
      {
        productId: "p-1",
        title: "Liquid Cherry",
        productTitle: "Liquid Cherry",
        groupName: "Жидкости",
        priceRub: 15,
        quantity: 1,
        image: "/img/liquid.png",
        variantId: null,
        variantName: null,
        groupId: "group-1",
        categoryId: "cat-1",
      },
    ]);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/product/")) {
        return createJsonResponse({ id: "p-1", hasVariants: false, stock: 10 });
      }
      if (url === "/api/card-payment/status") {
        return createJsonResponse({
          enabled: true,
          max_order_minor: 4500,
          card_available: false,
          cooldown_until: new Date(Date.now() + 3.5 * 86400000).toISOString(),
          monthly_limit_minor: 25000,
          monthly_used_minor: 0,
          monthly_remaining_minor: 25000,
          limits: {
            daily_limit_minor: 25000,
            spent_today_minor: 0,
            reserved_minor: 0,
          },
        });
      }
      if (url.startsWith("/api/loyalty/me")) {
        return createJsonResponse(buildLoyaltySnapshot());
      }
      if (url === "/api/loyalty/checkout-preview") {
        return createJsonResponse(buildLoyaltyPreview(0));
      }
      if (url === "/api/agreements") {
        return createJsonResponse({ items: [] });
      }
      if (url === "/api/orders") {
        return createJsonResponse({ ok: true, id: "order-1" });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(CheckoutView, {
      global: {
        stubs: {
          MinDeliveryBanner: { template: "<div />" },
          DeliveryConditionsBanner: { template: "<div />" },
          AdminModal: { template: "<div><slot /></div>" },
          CustomerModalShell: {
            props: ["open", "title"],
            template: "<div v-if=\"open\" class=\"payment-modal\"><h2>{{ title }}</h2><slot /><slot name='footer' /></div>",
          },
          LoyaltyBonusPopup: { template: "<div />" },
          CheckoutAgreements: { template: "<div />" },
        },
      },
    });

    await flushPromises();
    await wrapper.find(".submit-button").trigger("click");
    await flushPromises();

    // Карта на паузе: окно выбора открывается, «Картой» можно нажать и
    // посмотреть виджет со шкалой паузы, но «Оформить заказ» заблокирован.
    expect(wrapper.find(".payment-modal").exists()).toBe(true);
    const cardButton = wrapper.findAll(".payment-modal button")[1];
    expect(cardButton.attributes("disabled")).toBeUndefined();
    await cardButton.trigger("click");
    await flushPromises();
    expect(wrapper.find(".payment-modal").text()).toContain("Оплата картой недоступна");
    expect(wrapper.find(".payment-modal").text()).toContain("Следующая оплата будет доступна");
    // Шкалы паузы больше нет: только текст с датой на новой строке.
    expect(wrapper.find(".payment-modal .card-widget__bar").exists()).toBe(false);
    expect(wrapper.find(".payment-modal .card-widget__state-date").exists()).toBe(true);
    // Заказ не отправляется, пока карта на паузе
    expect(fetchMock.mock.calls.some(([input]) => String(input) === "/api/orders")).toBe(false);

    wrapper.unmount();
  });

  it("shows cooldown days instead of dates when the card is paused after opening the choice modal", async () => {
    const cartStore = useCartStore();
    cartStore.replaceItemsFromOrder([
      {
        productId: "p-1",
        title: "Liquid Cherry",
        productTitle: "Liquid Cherry",
        groupName: "Жидкости",
        priceRub: 15,
        quantity: 1,
        image: "/img/liquid.png",
        variantId: null,
        variantName: null,
        groupId: "group-1",
        categoryId: "cat-1",
      },
    ]);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/product/")) {
        return createJsonResponse({ id: "p-1", hasVariants: false, stock: 10 });
      }
      if (url === "/api/card-payment/status") {
        // Вызов №1 — onMounted (доступно), №2 — beginCheckout (доступно),
        // №3 — выбор «Картой» в модалке (пауза началась за это время).
        statusCalls += 1;
        if (statusCalls <= 2) {
          return createJsonResponse({
            enabled: true,
            max_order_minor: 4500,
            card_available: true,
            monthly_limit_minor: 25000,
            monthly_used_minor: 0,
            monthly_remaining_minor: 25000,
            limits: {
              daily_limit_minor: 25000,
              spent_today_minor: 0,
              reserved_minor: 0,
            },
          });
        }
        return createJsonResponse({
          enabled: true,
          max_order_minor: 4500,
          card_available: false,
          cooldown_until: new Date(Date.now() + 3.5 * 86400000).toISOString(),
          monthly_limit_minor: 25000,
          monthly_used_minor: 0,
          monthly_remaining_minor: 25000,
          limits: {
            daily_limit_minor: 25000,
            spent_today_minor: 0,
            reserved_minor: 0,
          },
        });
      }
      if (url.startsWith("/api/loyalty/me")) {
        return createJsonResponse(buildLoyaltySnapshot());
      }
      if (url === "/api/loyalty/checkout-preview") {
        return createJsonResponse(buildLoyaltyPreview(0));
      }
      if (url === "/api/agreements") {
        return createJsonResponse({ items: [] });
      }
      if (url === "/api/orders") {
        return createJsonResponse({ ok: true });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    let statusCalls = 0;
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(CheckoutView, {
      global: {
        stubs: {
          MinDeliveryBanner: { template: "<div />" },
          DeliveryConditionsBanner: { template: "<div />" },
          AdminModal: { template: "<div><slot /></div>" },
          CustomerModalShell: {
            props: ["open", "title"],
            template: "<div v-if=\"open\" class=\"payment-modal\"><h2>{{ title }}</h2><slot /><slot name='footer' /></div>",
          },
          LoyaltyBonusPopup: { template: "<div />" },
          CheckoutAgreements: { template: "<div />" },
        },
      },
    });

    await flushPromises();
    await wrapper.find(".submit-button").trigger("click");
    await flushPromises();
    expect(wrapper.find(".payment-modal").exists()).toBe(true);
    await wrapper.findAll(".payment-modal button")[1].trigger("click");
    await flushPromises();

    expect(wrapper.find(".payment-modal").text()).toContain("Оплата картой недоступна");
    expect(wrapper.find(".payment-modal").text()).toContain("Следующая оплата будет доступна");
    expect(wrapper.find(".payment-modal .card-widget__bar").exists()).toBe(false);
    expect(wrapper.find(".payment-modal .card-widget__state-date").exists()).toBe(true);

    wrapper.unmount();
  });

  it("shows per-order limit in the card status", async () => {
    const cartStore = useCartStore();
    cartStore.replaceItemsFromOrder([
      {
        productId: "p-1",
        title: "Liquid Cherry",
        productTitle: "Liquid Cherry",
        groupName: "Жидкости",
        priceRub: 15,
        quantity: 1,
        image: "/img/liquid.png",
        variantId: null,
        variantName: null,
        groupId: "group-1",
        categoryId: "cat-1",
      },
    ]);

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/product/")) {
        return createJsonResponse({ id: "p-1", hasVariants: false, stock: 10 });
      }
      if (url === "/api/card-payment/status") {
        return createJsonResponse({
          enabled: true,
          max_order_minor: 4500,
          card_available: true,
          limits: {
            daily_limit_minor: 25000,
            spent_today_minor: 0,
            reserved_minor: 0,
          },
        });
      }
      if (url.startsWith("/api/loyalty/me")) {
        return createJsonResponse(buildLoyaltySnapshot());
      }
      if (url === "/api/loyalty/checkout-preview") {
        return createJsonResponse(buildLoyaltyPreview(0));
      }
      if (url === "/api/agreements") {
        return createJsonResponse({ items: [] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const wrapper = mount(CheckoutView, {
      global: {
        stubs: {
          MinDeliveryBanner: { template: "<div />" },
          DeliveryConditionsBanner: { template: "<div />" },
          AdminModal: { template: "<div><slot /></div>" },
          CustomerModalShell: {
            props: ["open", "title"],
            template: "<div v-if=\"open\" class=\"payment-modal\"><h2>{{ title }}</h2><slot /><slot name='footer' /></div>",
          },
          LoyaltyBonusPopup: { template: "<div />" },
          CheckoutAgreements: { template: "<div />" },
        },
      },
    });

    await flushPromises();
    await wrapper.find(".submit-button").trigger("click");
    await flushPromises();
    await wrapper.findAll(".payment-modal button")[1].trigger("click");
    await flushPromises();

    expect(wrapper.find(".payment-modal").text()).toContain("Оплата картой разрешена");
    expect(wrapper.find(".payment-modal").text()).toContain("Лимит на заказ 45.00р");
    // Элемента шкалы паузы больше нет в разметке вовсе.
    expect(wrapper.find(".card-widget__bar").exists()).toBe(false);

    wrapper.unmount();
  });

  it("blocks card submit when the order exceeds the personal limit", async () => {
    const cartStore = useCartStore();
    cartStore.replaceItemsFromOrder([
      {
        productId: "p-1",
        title: "Liquid Cherry",
        productTitle: "Liquid Cherry",
        groupName: "Жидкости",
        priceRub: 50,
        quantity: 1,
        image: "/img/liquid.png",
        variantId: null,
        variantName: null,
        groupId: "group-1",
        categoryId: "cat-1",
      },
    ]);

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/product/")) {
        return createJsonResponse({ id: "p-1", hasVariants: false, stock: 10 });
      }
      if (url === "/api/card-payment/status") {
        // Личный лимит 45 BYN, корзина 50 BYN.
        return createJsonResponse({
          enabled: true,
          max_order_minor: 4500,
          card_available: true,
          limits: {
            daily_limit_minor: 25000,
            spent_today_minor: 0,
            reserved_minor: 0,
          },
        });
      }
      if (url.startsWith("/api/loyalty/me")) {
        return createJsonResponse(buildLoyaltySnapshot());
      }
      if (url === "/api/loyalty/checkout-preview") {
        return createJsonResponse(buildLoyaltyPreview(0));
      }
      if (url === "/api/agreements") {
        return createJsonResponse({ items: [] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const wrapper = mount(CheckoutView, {
      global: {
        stubs: {
          MinDeliveryBanner: { template: "<div />" },
          DeliveryConditionsBanner: { template: "<div />" },
          AdminModal: { template: "<div><slot /></div>" },
          CustomerModalShell: {
            props: ["open", "title"],
            template: "<div v-if=\"open\" class=\"payment-modal\"><h2>{{ title }}</h2><slot /><slot name='footer' /></div>",
          },
          LoyaltyBonusPopup: { template: "<div />" },
          CheckoutAgreements: { template: "<div />" },
        },
      },
    });

    await flushPromises();
    await wrapper.find(".submit-button").trigger("click");
    await flushPromises();
    await wrapper.findAll(".payment-modal button")[1].trigger("click");
    await flushPromises();

    // Заказ 50 BYN при личном лимите 45 BYN: смешанной оплаты нет, виджет
    // просит убрать 5.00 BYN или заплатить наличными.
    expect(wrapper.find(".payment-modal").text()).toContain("Заказ больше лимита на 5.00р");
    expect(wrapper.find(".payment-modal").text()).toContain("Уберите товары на 5.00р");
    expect(
      wrapper.find(".payment-modal button.checkout-modal-cta:not(.checkout-modal-cta--dark)").attributes("disabled"),
    ).toBeDefined();
    // Подсказка «Увеличить лимиты» показывается в заблокированном состоянии.
    expect(wrapper.find(".payment-modal .checkout-modal-cta--dark").exists()).toBe(true);

    wrapper.unmount();
  });

  it("uses modify endpoint in edit mode", async () => {
    const cartStore = useCartStore();
    let promoValidateBody: any = null;
    cartStore.replaceItemsFromOrder([
      {
        productId: "p-1",
        title: "Liquid Cherry",
        productTitle: "Liquid Cherry",
        groupName: "Жидкости",
        priceRub: 15,
        quantity: 1,
        image: "/img/liquid.png",
        variantId: null,
        variantName: null,
        groupId: "group-1",
        categoryId: "cat-1",
      },
    ]);
    cartStore.startOrderEdit("order-1", { promoCode: "SAVE10" });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/product/")) {
        return createJsonResponse({ id: "p-1", hasVariants: false, stock: 10 });
      }
      if (url.startsWith("/api/orders/my-active")) {
        return createJsonResponse(buildActiveOrder());
      }
      if (url.startsWith("/api/loyalty/me")) {
        return createJsonResponse(buildLoyaltySnapshot());
      }
      if (url === "/api/loyalty/checkout-preview") {
        const body = JSON.parse(String(init?.body || "{}"));
        const applied = Number(body?.items?.[0]?.loyalty_units_applied || 0);
        return createJsonResponse(buildLoyaltyPreview(applied));
      }
      if (url === "/api/promo/validate") {
        promoValidateBody = JSON.parse(String(init?.body || "{}"));
        return createJsonResponse({
          valid: true,
          discount_type: "fixed",
          discount_value: 10,
          calculated_discount: 5,
          description: "Promo",
        });
      }
      if (url === "/api/orders/order-1/modify-by-customer" && init?.method === "PUT") {
        return createJsonResponse({ success: true });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(CheckoutView, {
      global: {
        stubs: {
          MinDeliveryBanner: { template: "<div />" },
          DeliveryConditionsBanner: { template: "<div />" },
          AdminModal: { template: "<div><slot /></div>" },
          CustomerModalShell: { template: "<div><slot /><slot name='footer' /></div>" },
          LoyaltyBonusPopup: { template: "<div />" },
        },
      },
    });

    await flushPromises();
    expect(wrapper.text()).toContain("Редактирование заказа");
    expect(wrapper.text()).toContain("Вы меняете оформленный заказ");
    expect(wrapper.text()).toContain("После сохранения мы обновим состав заказа.");
    expect(wrapper.text()).not.toContain("Заказ №101");
    expect(wrapper.text()).not.toContain("№101");

    await wrapper.find(".submit-button").trigger("click");
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/orders/order-1/modify-by-customer",
      expect.objectContaining({
        method: "PUT",
      }),
    );
    expect(promoValidateBody?.editing_order_id).toBe("order-1");
    expect(cartStore.editingOrderId).toBeNull();
    expect(routerPush).toHaveBeenCalledWith("/my-order");

    wrapper.unmount();
  });

  it("redirects to my-order when create is blocked by active order", async () => {
    const cartStore = useCartStore();
    cartStore.replaceItemsFromOrder([
      {
        productId: "p-1",
        title: "Liquid Cherry",
        productTitle: "Liquid Cherry",
        groupName: "Жидкости",
        priceRub: 15,
        quantity: 1,
        image: "/img/liquid.png",
        variantId: null,
        variantName: null,
        groupId: "group-1",
        categoryId: "cat-1",
      },
    ]);

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/product/")) {
        return createJsonResponse({ id: "p-1", hasVariants: false, stock: 10 });
      }
      if (url === "/api/orders" && init?.method === "POST") {
        return createJsonResponse(
          {
            error: "active_order_exists",
            order_id: "order-1",
            order_number: 101,
          },
          false,
          409,
        );
      }
      if (url.startsWith("/api/loyalty/me")) {
        return createJsonResponse(buildLoyaltySnapshot());
      }
      if (url === "/api/loyalty/checkout-preview") {
        return createJsonResponse(buildLoyaltyPreview(0));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(CheckoutView, {
      global: {
        stubs: {
          MinDeliveryBanner: { template: "<div />" },
          DeliveryConditionsBanner: { template: "<div />" },
          AdminModal: { template: "<div><slot /></div>" },
          CustomerModalShell: { template: "<div><slot /><slot name='footer' /></div>" },
          LoyaltyBonusPopup: { template: "<div />" },
        },
      },
    });

    await flushPromises();
    await wrapper.find(".submit-button").trigger("click");
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/orders",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(routerPush).toHaveBeenCalledWith("/my-order");

    wrapper.unmount();
  });

  it("submits loyalty units selected in checkout", async () => {
    const cartStore = useCartStore();
    cartStore.replaceItemsFromOrder([
      {
        productId: "p-1",
        title: "Liquid Cherry",
        productTitle: "Liquid Cherry",
        groupName: "Liquids",
        priceRub: 15,
        quantity: 1,
        image: "/img/liquid.png",
        variantId: null,
        variantName: null,
        groupId: "group-1",
        categoryId: "c_liquids_salt",
      },
    ]);

    let submittedBody: any = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/product/")) {
        return createJsonResponse({ id: "p-1", hasVariants: false, stock: 10 });
      }
      if (url.startsWith("/api/loyalty/me")) {
        return createJsonResponse(buildLoyaltySnapshot());
      }
      if (url === "/api/loyalty/checkout-preview") {
        const body = JSON.parse(String(init?.body || "{}"));
        const applied = Number(body?.items?.[0]?.loyalty_units_applied || 0);
        return createJsonResponse(buildLoyaltyPreview(applied));
      }
      if (url === "/api/orders" && init?.method === "POST") {
        submittedBody = JSON.parse(String(init.body || "{}"));
        return createJsonResponse({ success: true, order_id: "order-loyalty" });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(CheckoutView, {
      global: {
        stubs: {
          MinDeliveryBanner: { template: "<div />" },
          DeliveryConditionsBanner: { template: "<div />" },
          AdminModal: { template: "<div><slot /></div>" },
          CustomerModalShell: { template: "<div><slot /><slot name='footer' /></div>" },
          LoyaltyBonusPopup: { template: "<div />" },
        },
      },
    });

    await flushPromises();
    await flushPromises();

    await wrapper.find(".loyalty-line-button").trigger("click");
    await flushPromises();
    await flushPromises();
    await wrapper.find(".submit-button").trigger("click");
    await flushPromises();

    expect(submittedBody?.items?.[0]?.loyalty_units_applied).toBe(1);
    expect(routerPush).toHaveBeenCalledWith("/my-order");

    wrapper.unmount();
  });

  it("reopens the global authorization gate if the server starts requiring it", async () => {
    const cartStore = useCartStore();
    cartStore.replaceItemsFromOrder([{
      productId: "p-referral",
      title: "Liquid",
      productTitle: "Liquid",
      groupName: "Liquids",
      priceRub: 15,
      quantity: 1,
      image: "/img/liquid.png",
      variantId: null,
      variantName: null,
      groupId: "group-1",
      categoryId: "c_liquids_salt",
    }]);

    let submittedBody: any = null;
    const gateRequired = vi.fn();
    window.addEventListener("referral-authorization-required", gateRequired);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/product/")) {
        return createJsonResponse({ id: "p-referral", hasVariants: false, stock: 10 });
      }
      if (url.startsWith("/api/loyalty/me")) return createJsonResponse(buildLoyaltySnapshot());
      if (url === "/api/loyalty/checkout-preview") return createJsonResponse(buildLoyaltyPreview(0));
      if (url === "/api/orders" && init?.method === "POST") {
        submittedBody = JSON.parse(String(init.body || "{}"));
        return createJsonResponse({
          error: "referral_authorization_required",
          message: "Укажите username пригласившего",
          attempts_used: 0,
          attempts_remaining: 3,
        }, false, 428);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(CheckoutView, {
      global: { stubs: {
        MinDeliveryBanner: { template: "<div />" },
        DeliveryConditionsBanner: { template: "<div />" },
        CustomerModalShell: { template: "<div><slot /><slot name='footer' /></div>" },
        LoyaltyBonusPopup: { template: "<div />" },
        CheckoutAgreements: { template: "<div />" },
      } },
    });

    await flushPromises();
    await wrapper.find(".submit-button").trigger("click");
    await flushPromises();
    expect(submittedBody.inviter_username).toBeUndefined();
    expect(gateRequired).toHaveBeenCalledTimes(1);
    expect(routerPush).not.toHaveBeenCalledWith("/my-order");
    window.removeEventListener("referral-authorization-required", gateRequired);
    wrapper.unmount();
  });

  it("shows loyalty preview widget in browser without Telegram", async () => {
    const cartStore = useCartStore();
    cartStore.replaceItemsFromOrder([
      {
        productId: "p-1",
        title: "Liquid Cherry",
        productTitle: "Liquid Cherry",
        groupName: "Liquids",
        priceRub: 15,
        quantity: 1,
        image: "/img/liquid.png",
        variantId: null,
        variantName: null,
        groupId: "group-1",
        categoryId: "c_liquids_salt",
      },
    ]);

    (window as any).Telegram = undefined;
    let resolvePromo!: (value: ReturnType<typeof createJsonResponse>) => void;
    const promoResponse = new Promise<ReturnType<typeof createJsonResponse>>((resolve) => {
      resolvePromo = resolve;
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/product/")) {
        return createJsonResponse({ id: "p-1", hasVariants: false, stock: 10 });
      }
      if (url.startsWith("/api/loyalty/me")) {
        return createJsonResponse(buildLoyaltySnapshot());
      }
      if (url === "/api/loyalty/checkout-preview") {
        return createJsonResponse(buildLoyaltyPreview(0));
      }
      if (url === "/api/promo/validate") {
        return promoResponse;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(CheckoutView, {
      global: {
        stubs: {
          MinDeliveryBanner: { template: "<div />" },
          DeliveryConditionsBanner: { template: "<div />" },
          AdminModal: { template: "<div><slot /></div>" },
          CustomerModalShell: { template: "<div><slot /><slot name='footer' /></div>" },
          LoyaltyBonusPopup: { template: "<div />" },
        },
      },
    });

    await flushPromises();
    await flushPromises();

    expect(wrapper.find(".loyalty-card").exists()).toBe(true);
    expect(wrapper.findAll(".loyalty-tab")).toHaveLength(0);
    expect(wrapper.find(".loyalty-card-title-main").text()).toBe(
      "Доступны скидки по бонусной карте",
    );
    expect(wrapper.find(".loyalty-available-title").text()).toBe("На жидкость");
    expect(wrapper.find(".loyalty-progress-value").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("До скидки");
    expect(wrapper.find(".user-info-input").exists()).toBe(true);

    await wrapper.find(".promo-input").setValue("PROMO5");
    await wrapper.find(".promo-apply-btn").trigger("click");
    await flushPromises();
    expect(wrapper.find(".submit-button").attributes("disabled")).toBeDefined();
    expect(wrapper.find(".submit-button").text()).toBe("Рассчитываем скидку...");
    await wrapper.find(".submit-button").trigger("click");
    expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith("/api/orders"))).toBe(false);

    resolvePromo(
      createJsonResponse({
        valid: true,
        discount_type: "fixed",
        discount_value: 5,
        calculated_discount: 5,
        has_gift: 0,
      }),
    );
    await flushPromises();
    expect(wrapper.find(".loyalty-card").exists()).toBe(false);

    await wrapper.find(".promo-cancel-btn").trigger("click");
    await flushPromises();
    expect(wrapper.find(".loyalty-card").exists()).toBe(true);

    wrapper.unmount();
  });

  it("hides the loyalty widget when no discount is available", async () => {
    const cartStore = useCartStore();
    cartStore.replaceItemsFromOrder([
      {
        productId: "p-1",
        title: "Liquid Cherry",
        productTitle: "Liquid Cherry",
        groupName: "Жидкости",
        priceRub: 15,
        quantity: 1,
        image: "/img/liquid.png",
        variantId: null,
        variantName: null,
        groupId: "group-1",
        categoryId: "c_liquids_salt",
      },
      {
        productId: "p-2",
        title: "Snus Mint",
        productTitle: "Snus Mint",
        groupName: "Снюс",
        priceRub: 8,
        quantity: 1,
        image: "/img/snus.png",
        variantId: null,
        variantName: null,
        groupId: "group-2",
        categoryId: "c_1762276690872_0lxz",
      },
      {
        productId: "p-3",
        title: "Disposable Mint",
        productTitle: "Disposable Mint",
        groupName: "Одноразки",
        priceRub: 25,
        quantity: 1,
        image: "/img/disposable.png",
        variantId: null,
        variantName: null,
        groupId: "group-3",
        categoryId: "c_disposables",
      },
      {
        productId: "p-4",
        title: "Device X",
        productTitle: "Device X",
        groupName: "Устройства",
        priceRub: 55,
        quantity: 1,
        image: "/img/device.png",
        variantId: null,
        variantName: null,
        groupId: "group-4",
        categoryId: "c_devices",
      },
    ]);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/product/")) {
        return createJsonResponse({ id: "p-1", hasVariants: false, stock: 10 });
      }
      if (url.startsWith("/api/loyalty/me")) {
        return createJsonResponse(buildLoyaltySnapshot());
      }
      if (url === "/api/loyalty/checkout-preview") {
        return createJsonResponse(buildMultiCategoryLoyaltyPreview());
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(CheckoutView, {
      global: {
        stubs: {
          MinDeliveryBanner: { template: "<div />" },
          DeliveryConditionsBanner: { template: "<div />" },
          AdminModal: { template: "<div><slot /></div>" },
          CustomerModalShell: { template: "<div><slot /><slot name='footer' /></div>" },
          LoyaltyBonusPopup: { template: "<div />" },
        },
      },
    });

    await flushPromises();
    await flushPromises();

    expect(wrapper.find(".loyalty-card").exists()).toBe(false);
    expect(wrapper.find(".loyalty-progress-value").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("До скидки");

    wrapper.unmount();
  });

  it("shows product types instead of flavors and allows only one bonus in the earned category", async () => {
    const cartStore = useCartStore();
    cartStore.replaceItemsFromOrder([
      {
        productId: "p-1",
        title: "Liquid Cherry",
        productTitle: "Liquid Cherry",
        groupName: "Жидкости",
        priceRub: 15,
        quantity: 1,
        image: "/img/liquid.png",
        variantId: null,
        variantName: null,
        groupId: "group-1",
        categoryId: "c_liquids_salt",
      },
      {
        productId: "p-2",
        title: "Snus Mint",
        productTitle: "Snus Mint",
        groupName: "Снюс",
        priceRub: 8,
        quantity: 1,
        image: "/img/snus.png",
        variantId: null,
        variantName: null,
        groupId: "group-2",
        categoryId: "c_1762276690872_0lxz",
      },
      {
        productId: "p-3",
        title: "Device X",
        productTitle: "Device X",
        groupName: "Устройства",
        priceRub: 55,
        quantity: 1,
        image: "/img/device.png",
        variantId: null,
        variantName: null,
        groupId: "group-3",
        categoryId: "c_devices",
      },
    ]);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/product/")) {
        return createJsonResponse({ id: "p-1", hasVariants: false, stock: 10 });
      }
      if (url.startsWith("/api/loyalty/me")) {
        return createJsonResponse(buildLoyaltySnapshot());
      }
      if (url === "/api/loyalty/checkout-preview") {
        return createJsonResponse(buildSingleBonusChoicePreview());
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(CheckoutView, {
      global: {
        stubs: {
          MinDeliveryBanner: { template: "<div />" },
          DeliveryConditionsBanner: { template: "<div />" },
          AdminModal: { template: "<div><slot /></div>" },
          CustomerModalShell: { template: "<div><slot /><slot name='footer' /></div>" },
          LoyaltyBonusPopup: { template: "<div />" },
        },
      },
    });

    await flushPromises();
    await flushPromises();

    const loyaltySection = wrapper.find(".loyalty-section");
    expect(loyaltySection.findAll(".loyalty-available-title").map((item) => item.text())).toEqual([
      "На жидкость",
      "На снюс",
    ]);
    expect(loyaltySection.text()).not.toContain("Liquid Cherry");
    expect(loyaltySection.text()).not.toContain("Snus Mint");
    expect(loyaltySection.text()).not.toContain("Device X");

    const buttons = wrapper.findAll(".loyalty-line-button");
    expect(buttons).toHaveLength(2);
    expect(buttons.map((button) => button.text())).toEqual(["Применить", "Применить"]);

    await buttons[0].trigger("click");
    await flushPromises();
    await flushPromises();

    const refreshedButtons = wrapper.findAll(".loyalty-line-button");
    expect(refreshedButtons).toHaveLength(1);
    expect(refreshedButtons[0].text()).toBe("Применено");
    expect(wrapper.findAll(".loyalty-line-state").map((item) => item.text())).toContain("Бонус уже выбран");

    expect(wrapper.findAll(".loyalty-available-category")).toHaveLength(2);
    expect(wrapper.text()).not.toContain("На устройство");
    expect(wrapper.find(".loyalty-progress-value").exists()).toBe(false);

    wrapper.unmount();
  });

  it("allows bonus selection in different categories within one order", async () => {
    const cartStore = useCartStore();
    cartStore.replaceItemsFromOrder([
      {
        productId: "p-1",
        title: "Liquid Cherry",
        productTitle: "Liquid Cherry",
        groupName: "Жидкости",
        priceRub: 15,
        quantity: 1,
        image: "/img/liquid.png",
        variantId: null,
        variantName: null,
        groupId: "group-1",
        categoryId: "c_liquids_salt",
      },
      {
        productId: "p-2",
        title: "Snus Mint",
        productTitle: "Snus Mint",
        groupName: "Снюс",
        priceRub: 8,
        quantity: 1,
        image: "/img/snus.png",
        variantId: null,
        variantName: null,
        groupId: "group-2",
        categoryId: "c_1762276690872_0lxz",
      },
      {
        productId: "p-3",
        title: "Device X",
        productTitle: "Device X",
        groupName: "Устройства",
        priceRub: 55,
        quantity: 1,
        image: "/img/device.png",
        variantId: null,
        variantName: null,
        groupId: "group-3",
        categoryId: "c_devices",
      },
    ]);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/product/")) {
        return createJsonResponse({ id: "p-1", hasVariants: false, stock: 10 });
      }
      if (url.startsWith("/api/loyalty/me")) {
        return createJsonResponse(buildLoyaltySnapshot());
      }
      if (url === "/api/loyalty/checkout-preview") {
        return createJsonResponse(buildCrossCategoryMultiBonusPreview());
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(CheckoutView, {
      global: {
        stubs: {
          MinDeliveryBanner: { template: "<div />" },
          DeliveryConditionsBanner: { template: "<div />" },
          AdminModal: { template: "<div><slot /></div>" },
          CustomerModalShell: { template: "<div><slot /><slot name='footer' /></div>" },
          LoyaltyBonusPopup: { template: "<div />" },
        },
      },
    });

    await flushPromises();
    await flushPromises();

    await wrapper.findAll(".loyalty-line-button")[0].trigger("click");
    await flushPromises();
    await flushPromises();

    const categoryCards = wrapper.findAll(".loyalty-available-category");
    expect(categoryCards).toHaveLength(3);
    const deviceCard = categoryCards.find(
      (card) => card.find(".loyalty-available-title").text() === "На устройство",
    );
    expect(deviceCard).toBeDefined();

    const deviceButton = deviceCard!.find(".loyalty-line-button");
    expect(deviceButton.text()).toBe("Применить");
    await deviceButton.trigger("click");
    await flushPromises();
    expect(cartStore.items.find((item) => item.productId === "p-3")?.loyaltyUnitsApplied).toBe(1);

    wrapper.unmount();
  });

  it("hides variants and internally applies the bonus to the highest-priced eligible line", async () => {
    const cartStore = useCartStore();
    cartStore.replaceItemsFromOrder([
      {
        productId: "pasito",
        title: "PASITO 2",
        productTitle: "PASITO 2",
        groupName: "Устройства",
        priceRub: 75,
        quantity: 1,
        image: null,
        variantId: "variant-black",
        variantName: "Black",
        groupId: "devices",
        categoryId: "c_devices",
      },
      {
        productId: "pasito",
        title: "PASITO 2",
        productTitle: "PASITO 2",
        groupName: "Устройства",
        priceRub: 85,
        quantity: 1,
        image: null,
        variantId: "variant-silver",
        variantName: "Silver",
        groupId: "devices",
        categoryId: "c_devices",
      },
    ]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/product/")) {
          return createJsonResponse({ id: "pasito", hasVariants: true, stock: 10 });
        }
        if (url.startsWith("/api/loyalty/me")) {
          return createJsonResponse(buildLoyaltySnapshot());
        }
        if (url === "/api/loyalty/checkout-preview") {
          return createJsonResponse(buildVariantChoicePreview());
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    const wrapper = mount(CheckoutView, {
      global: {
        stubs: {
          MinDeliveryBanner: { template: "<div />" },
          DeliveryConditionsBanner: { template: "<div />" },
          AdminModal: { template: "<div><slot /></div>" },
          CustomerModalShell: { template: "<div><slot /><slot name='footer' /></div>" },
          LoyaltyBonusPopup: { template: "<div />" },
        },
      },
    });

    await flushPromises();
    await flushPromises();

    const loyaltySection = wrapper.find(".loyalty-section");
    expect(loyaltySection.findAll(".loyalty-available-title").map((item) => item.text())).toEqual([
      "На устройство",
    ]);
    expect(loyaltySection.text()).not.toContain("PASITO 2");
    expect(loyaltySection.text()).not.toContain("Black");
    expect(loyaltySection.text()).not.toContain("Silver");

    await loyaltySection.find(".loyalty-line-button").trigger("click");
    await flushPromises();
    expect(cartStore.items.find((item) => item.variantId === "variant-black")?.loyaltyUnitsApplied || 0).toBe(0);
    expect(cartStore.items.find((item) => item.variantId === "variant-silver")?.loyaltyUnitsApplied).toBe(1);

    wrapper.unmount();
  });

  it("shows and applies a gift promo in wholesale checkout", async () => {
    const cartStore = useCartStore();
    const wholesaleStore = useWholesaleStore();
    wholesaleStore.applyOrderWholesaleContext({
      code: "500",
      secret: "wholesale-secret",
      label: "Опт от 500 BYN",
      minOrderAmount: 500,
    });
    cartStore.replaceItemsFromOrder([
      {
        productId: "p-wholesale",
        title: "Wholesale Liquid",
        productTitle: "Wholesale Liquid",
        groupName: "Жидкости",
        priceRub: 9.5,
        quantity: 60,
        image: "/img/liquid.png",
        variantId: null,
        variantName: null,
        groupId: "group-wholesale",
        categoryId: "cat-wholesale",
      },
    ]);

    let promoRequest: RequestInit | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/product/")) {
        return createJsonResponse({ id: "p-wholesale", hasVariants: false, stock: 100 });
      }
      if (url === "/api/promo/validate") {
        promoRequest = init;
        const body = JSON.parse(String(init?.body || "{}"));
        if (body.code === "REGULAR10") {
          return createJsonResponse({
            valid: false,
            error: "wholesale_gift_promo_required",
            message: "В оптовом заказе можно применить только промокод на подарок",
          });
        }
        return createJsonResponse({
          valid: true,
          discount_type: "fixed",
          discount_value: 25,
          calculated_discount: 0,
          customer_description: "Подарок из рулетки",
          has_gift: 1,
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(CheckoutView, {
      global: {
        stubs: {
          MinDeliveryBanner: { template: "<div />" },
          DeliveryConditionsBanner: { template: "<div />" },
          AdminModal: { template: "<div><slot /></div>" },
          CustomerModalShell: { template: "<div><slot /><slot name='footer' /></div>" },
          LoyaltyBonusPopup: { template: "<div />" },
          CheckoutAgreements: { template: "<div />" },
        },
      },
    });

    await flushPromises();
    expect(wrapper.find(".promo-input").exists()).toBe(true);
    await wrapper.find(".promo-input").setValue("WHOLESALEGIFT");
    await wrapper.find(".promo-apply-btn").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Подарок из рулетки");
    expect(promoRequest?.headers).toEqual(expect.objectContaining({
      "x-wholesale-code": "500",
      "x-wholesale-secret": "wholesale-secret",
    }));

    await wrapper.find(".promo-cancel-btn").trigger("click");
    await flushPromises();
    expect(wrapper.find(".promo-input").exists()).toBe(true);

    await wrapper.find(".promo-input").setValue("REGULAR10");
    await wrapper.find(".promo-apply-btn").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("только промокод на подарок");
    expect(wrapper.find(".promo-error-text").attributes("role")).toBe("alert");
    expect(wrapper.find(".promo-input").attributes("aria-describedby")).toBe("checkout-promo-error");

    wrapper.unmount();
  });

  it("restores a gift promo when editing a wholesale order", async () => {
    const cartStore = useCartStore();
    const wholesaleStore = useWholesaleStore();
    const cartItem = {
      productId: "p-wholesale-edit",
      title: "Wholesale Liquid",
      productTitle: "Wholesale Liquid",
      groupName: "Жидкости",
      priceRub: 9.5,
      quantity: 60,
      image: "/img/liquid.png",
      variantId: null,
      variantName: null,
      groupId: "group-wholesale",
      categoryId: "cat-wholesale",
    };
    cartStore.replaceItemsFromOrder([cartItem]);
    cartStore.startOrderEdit("order-wholesale-edit", { promoCode: "WHOLESALEGIFT" });
    wholesaleStore.applyOrderWholesaleContext({
      code: "500",
      secret: "wholesale-secret",
      label: "Опт от 500 BYN",
      minOrderAmount: 500,
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/product/")) {
        return createJsonResponse({ id: "p-wholesale-edit", hasVariants: false, stock: 100 });
      }
      if (url.startsWith("/api/orders/my-active")) {
        return createJsonResponse({
          ...buildActiveOrder(),
          id: "order-wholesale-edit",
          total_amount: 570,
          discount_amount: 0,
          final_amount: 570,
          promo_code_text: "WHOLESALEGIFT",
          is_wholesale: true,
          wholesale_code: "500",
          wholesale_secret: "wholesale-secret",
          wholesale_tier_label: "Опт от 500 BYN",
          wholesale_min_amount: 500,
          items: [{
            ...buildActiveOrder().items[0],
            product_id: "p-wholesale-edit",
            quantity: 60,
            price_per_unit: 9.5,
            total_price: 570,
            cart_item: cartItem,
          }],
        });
      }
      if (url === "/api/promo/validate") {
        return createJsonResponse({
          valid: true,
          discount_type: "fixed",
          discount_value: 25,
          calculated_discount: 0,
          customer_description: "Подарок из рулетки",
          has_gift: 1,
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(CheckoutView, {
      global: {
        stubs: {
          MinDeliveryBanner: { template: "<div />" },
          DeliveryConditionsBanner: { template: "<div />" },
          AdminModal: { template: "<div><slot /></div>" },
          CustomerModalShell: { template: "<div><slot /><slot name='footer' /></div>" },
          LoyaltyBonusPopup: { template: "<div />" },
        },
      },
    });

    await flushPromises();
    expect(wrapper.find(".promo-code-text").text()).toBe("WHOLESALEGIFT");
    expect(wrapper.text()).toContain("Подарок будет добавлен к заказу");
    expect(wrapper.text()).toContain("Подарок из рулетки");

    wrapper.unmount();
  });
});
