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

describe("App shell visibility", () => {
  beforeEach(() => {
    routePath.value = "/";
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

  it("does not apply tab bar padding reserve on checkout", async () => {
    routePath.value = "/checkout";
    const wrapper = mountApp();
    await flushPromises();

    expect(wrapper.find(".app-shell--with-tab-bar").exists()).toBe(false);
    wrapper.unmount();
  });
});
