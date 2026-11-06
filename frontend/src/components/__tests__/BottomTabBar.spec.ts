import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import BottomTabBar from "@/components/BottomTabBar.vue";

const routePath = vi.hoisted(() => ({ value: "/" }));

vi.mock("vue-router", () => ({
  useRoute: () => ({
    path: routePath.value,
    fullPath: routePath.value,
  }),
}));

vi.mock("@/stores/wholesale", () => ({
  useWholesaleStore: () => ({
    isWholesale: false,
  }),
}));

describe("BottomTabBar", () => {
  beforeEach(() => {
    routePath.value = "/";
    document.documentElement.style.removeProperty("--app-bottom-tab-bar-height");
  });

  it("highlights profile tab on profile routes", async () => {
    routePath.value = "/profile";
    const wrapper = mount(BottomTabBar, {
      global: {
        stubs: {
          RouterLink: {
            props: ["to"],
            template: '<a class="tab-item" :class="$attrs.class"><slot /></a>',
          },
        },
      },
    });
    await flushPromises();

    const profileTab = wrapper.find(".tab-item--profile");
    expect(profileTab.classes()).toContain("tab-item--active");

    wrapper.unmount();
  });

  it("syncs bottom tab bar CSS variable on mount", async () => {
    const wrapper = mount(BottomTabBar, {
      global: {
        stubs: {
          RouterLink: {
            template: "<a><slot /></a>",
          },
        },
      },
    });
    await flushPromises();

    const height = document.documentElement.style.getPropertyValue("--app-bottom-tab-bar-height");
    expect(height).not.toBe("");

    wrapper.unmount();
  });
});