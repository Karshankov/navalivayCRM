import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import TopCartBar from "@/components/TopCartBar.vue";

const routerPush = vi.fn();
const routePath = { value: "/" };

vi.mock("vue-router", () => ({
  useRoute: () => ({ path: routePath.value }),
  useRouter: () => ({ push: routerPush }),
}));

describe("TopCartBar: кнопка профиля", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    routerPush.mockClear();
    routePath.value = "/";
  });

  it("на обычных экранах — «Мой профиль» с аватаркой", () => {
    const wrapper = mount(TopCartBar, { props: { visible: true } });

    expect(wrapper.text()).toContain("Мой профиль");
    expect(wrapper.find(".nav-top-profile__avatar--back").exists()).toBe(false);

    wrapper.unmount();
  });

  it("на /profile — «На главную» с тёмным кружком и стрелкой", async () => {
    routePath.value = "/profile";
    const wrapper = mount(TopCartBar, { props: { visible: true } });

    expect(wrapper.text()).toContain("На главную");
    expect(wrapper.text()).not.toContain("Мой профиль");
    const back = wrapper.find(".nav-top-profile__avatar--back");
    expect(back.exists()).toBe(true);
    // Стрелка влево — path в svg.
    expect(back.find("svg path").exists()).toBe(true);

    await wrapper.find(".nav-top-profile").trigger("click");
    expect(routerPush).toHaveBeenCalledWith("/");

    wrapper.unmount();
  });
});