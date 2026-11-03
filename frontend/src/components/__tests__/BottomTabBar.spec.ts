import { beforeEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import BottomTabBar from "@/components/BottomTabBar.vue";
import { TABS, type TabId } from "@/components/shell/tabs";

/**
 * Новый бар — презентационный: получает список вкладок и активный id,
 * эмитит select. Активность по route.path больше не вычисляет сам.
 */
describe("BottomTabBar", () => {
  beforeEach(() => {
    document.documentElement.style.removeProperty("--app-bottom-tab-bar-height");
  });

  it("renders all tabs and marks the active one", () => {
    const wrapper = mount(BottomTabBar, {
      props: { tabs: TABS, activeId: "home" as TabId },
    });

    const items = wrapper.findAll(".tab-item");
    expect(items).toHaveLength(TABS.length);

    const active = wrapper.findAll(".tab-item--active");
    expect(active).toHaveLength(1);
    expect(active[0].attributes("aria-current")).toBe("page");

    wrapper.unmount();
  });

  it("emits select with the tab id on click", async () => {
    const wrapper = mount(BottomTabBar, {
      props: { tabs: TABS, activeId: "home" as TabId },
    });

    const liquids = wrapper.findAll(".tab-item")[0];
    await liquids.trigger("click");

    expect(wrapper.emitted("select")).toEqual([["liquids"]]);

    wrapper.unmount();
  });

  it("syncs bottom tab bar CSS variable on mount", async () => {
    const wrapper = mount(BottomTabBar, {
      props: { tabs: TABS, activeId: "home" as TabId },
    });

    await new Promise((resolve) => requestAnimationFrame(resolve));

    const height = document.documentElement.style.getPropertyValue("--app-bottom-tab-bar-height");
    expect(height).not.toBe("");

    wrapper.unmount();
  });
});
