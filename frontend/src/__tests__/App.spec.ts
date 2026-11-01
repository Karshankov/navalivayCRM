import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import App from "@/App.vue";

const routePath = vi.hoisted(() => ({ value: "/" }));

vi.mock("vue-router", () => ({
  RouterView: { template: "<div class='router-view-stub' />" },
  useRoute: () => ({
    path: routePath.value,
    name: undefined,
    params: {},
    fullPath: routePath.value,
  }),
}));

vi.mock("@/composables/useCustomerBlock", () => ({
  useCustomerBlock: () => ({
    currentBlock: ref(null),
    isBlocked: ref(false),
    refreshBlock: vi.fn(),
  }),
}));

vi.mock("@/stores/user", () => ({
  useUserStore: () => ({ fetchProfile: vi.fn().mockResolvedValue(undefined) }),
}));

const catalogState = vi.hoisted(() => ({
  offline: { value: false },
  categories: { value: [] as Array<{ id: string }> },
}));

vi.mock("@/stores/catalog", () => ({
  useCatalogStore: () => ({
    offline: catalogState.offline.value,
    categories: catalogState.categories.value,
  }),
}));

describe("App shell visibility", () => {
  beforeEach(() => {
    routePath.value = "/";
    catalogState.offline.value = false;
    catalogState.categories.value = [];
  });

  function mountApp(unlockCustomerContent = true) {
    return mount(App, {
      global: {
        stubs: {
          VapeSmoke: true,
          BottomTabBar: true,
          ReviewPromptModal: true,
          WheelHomeWidget: true,
          BlockedScreen: true,
          ReferralAuthorizationGate: unlockCustomerContent
            ? {
                emits: ["gate-active"],
                template: "<div class='referral-gate-stub' />",
                mounted() {
                  this.$emit("gate-active", false);
                },
              }
            : { template: "<div class='referral-gate-stub' />" },
        },
      },
    });
  }

  it("does not mount the catalog or prices before authorization", async () => {
    const wrapper = mountApp(false);
    await flushPromises();

    expect(wrapper.find(".referral-gate-stub").exists()).toBe(true);
    expect(wrapper.find(".router-view-stub").exists()).toBe(false);
    expect(wrapper.find("bottom-tab-bar-stub").exists()).toBe(false);
    expect(wrapper.find("wheel-home-widget-stub").exists()).toBe(false);

    wrapper.unmount();
  });

  it("shows review prompt modal host and wheel widget on home", async () => {
    const wrapper = mountApp();
    await flushPromises();

    expect(wrapper.find("review-prompt-modal-stub").exists()).toBe(true);
    expect(wrapper.find("wheel-home-widget-stub").exists()).toBe(true);

    wrapper.unmount();
  });

  it("hides wheel widget on order history routes", async () => {
    routePath.value = "/profile/orders";
    const wrapper = mountApp();
    await flushPromises();

    expect(wrapper.find("wheel-home-widget-stub").exists()).toBe(false);

    wrapper.unmount();
  });

  it("hides tab bar on checkout", async () => {
    routePath.value = "/checkout";
    const wrapper = mountApp();
    await flushPromises();

    expect(wrapper.find("bottom-tab-bar-stub").exists()).toBe(false);

    wrapper.unmount();
  });

  it("hides review prompt modal host when tab bar is hidden", async () => {
    for (const hiddenPath of ["/checkout", "/my-order", "/admin/crm/orders"]) {
      routePath.value = hiddenPath;
      const wrapper = mountApp();
      await flushPromises();

      expect(wrapper.find("review-prompt-modal-stub").exists()).toBe(false);
      wrapper.unmount();
    }
  });

  it("applies tab bar padding reserve class on customer routes", async () => {
    routePath.value = "/";
    const wrapper = mountApp();
    await flushPromises();

    expect(wrapper.find(".app-shell--with-tab-bar").exists()).toBe(true);
    wrapper.unmount();
  });

  it("uses the desktop admin shell only on admin routes", async () => {
    for (const path of ["/admin", "/admin/crm/orders", "/admin/crm/orders/order-1"]) {
      routePath.value = path;
      const wrapper = mountApp();
      await flushPromises();
      expect(wrapper.get(".app-shell").classes()).toContain("app-shell--admin");
      expect(wrapper.get(".app-shell").classes()).not.toContain("app-shell--with-tab-bar");
      wrapper.unmount();
    }
    routePath.value = "/";
    const wrapper = mountApp();
    await flushPromises();
    expect(wrapper.get(".app-shell").classes()).not.toContain("app-shell--admin");
    expect(wrapper.get(".app-shell").classes()).toContain("app-shell--with-tab-bar");
    wrapper.unmount();
  });

  it("does not apply tab bar padding reserve on checkout", async () => {
    routePath.value = "/checkout";
    const wrapper = mountApp();
    await flushPromises();

    expect(wrapper.find(".app-shell--with-tab-bar").exists()).toBe(false);
    wrapper.unmount();
  });

  it("shows offline placeholder instead of content when catalog failed to load", async () => {
    catalogState.offline.value = true;
    catalogState.categories.value = [];
    const wrapper = mountApp();
    await flushPromises();

    // Заглушка вместо контента: череп + кнопка «Попробовать снова».
    expect(wrapper.find(".offline-page").exists()).toBe(true);
    expect(wrapper.find(".router-view-stub").exists()).toBe(false);
    expect(wrapper.find("bottom-tab-bar-stub").exists()).toBe(false);

    wrapper.unmount();
  });

  it("shows offline placeholder when browser reports no network", async () => {
    // navigator.onLine = false эмулируем подменой.
    const original = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");
    Object.defineProperty(Navigator.prototype, "onLine", { configurable: true, get: () => false });
    try {
      const wrapper = mountApp();
      await flushPromises();
      expect(wrapper.find(".offline-page").exists()).toBe(true);
      expect(wrapper.find(".router-view-stub").exists()).toBe(false);
      wrapper.unmount();
    } finally {
      if (original) Object.defineProperty(Navigator.prototype, "onLine", original);
    }
  });

  it("clears offline placeholder once catalog loads after failure", async () => {
    catalogState.offline.value = false;
    catalogState.categories.value = [{ id: "c1" }];
    const wrapper = mountApp();
    await flushPromises();

    // Каталог загрузился — обычный контент.
    expect(wrapper.find(".offline-page").exists()).toBe(false);
    expect(wrapper.find(".router-view-stub").exists()).toBe(true);

    wrapper.unmount();
  });

  it("offline button reloads the page", async () => {
    catalogState.offline.value = true;
    catalogState.categories.value = [];
    const reloadSpy = vi.fn();
    const originalReload = window.location.reload;
    window.location.reload = reloadSpy;
    try {
      const wrapper = mountApp();
      await flushPromises();
      await wrapper.find(".offline-page button").trigger("click");
      expect(reloadSpy).toHaveBeenCalledTimes(1);
      wrapper.unmount();
    } finally {
      window.location.reload = originalReload;
    }
  });
});
