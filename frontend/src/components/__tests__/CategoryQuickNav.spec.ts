import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import CategoryQuickNav from "@/components/CategoryQuickNav.vue";
import { useCatalogStore } from "@/stores/catalog";

const routerReplace = vi.fn();
const routeParams = { value: { slug: "zhidkosti" } };

vi.mock("vue-router", () => ({
  useRoute: () => ({ params: routeParams.value }),
  useRouter: () => ({ replace: routerReplace }),
}));

describe("CategoryQuickNav", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    routerReplace.mockClear();
    routeParams.value = { slug: "zhidkosti" };
  });

  it("рендерит 6 категорий с реальными slug каталога", () => {
    const wrapper = mount(CategoryQuickNav);

    const buttons = wrapper.findAll(".qnav__category");
    expect(buttons.length).toBe(6);
    const labels = buttons.map((b) => b.text());
    expect(labels).toContain("Жидкости");
    expect(labels).toContain("Расходники");
    expect(labels).toContain("Устройства");
    expect(labels).toContain("Одноразки");
    expect(labels).toContain("Снюс");
    expect(labels).toContain("Кальянка");

    wrapper.unmount();
  });

  it("активная категория подсвечена красным градиентом", () => {
    routeParams.value = { slug: "zhidkosti" };
    const wrapper = mount(CategoryQuickNav);

    const active = wrapper.find(".qnav__category--active");
    expect(active.exists()).toBe(true);
    expect(active.text()).toContain("Жидкости");

    wrapper.unmount();
  });

  it("взрыв частиц: fixed-слой в body поверх панели по клику", async () => {
    routeParams.value = { slug: "zhidkosti" };
    const wrapper = mount(CategoryQuickNav);

    // До клика частиц нет.
    expect(document.querySelector(".qnav-piece")).toBeNull();

    const rashodniki = wrapper
      .findAll(".qnav__category")
      .find((b) => b.text().includes("Расходники"));
    await rashodniki!.trigger("click");

    // 12 частиц появились в body (Teleport), поверх всех блоков.
    const pieces = document.querySelectorAll(".qnav-piece");
    expect(pieces.length).toBe(12);

    // Чистим DOM после теста.
    pieces.forEach((n) => n.remove());

    wrapper.unmount();
  });

  it("клик по другой категории меняет маршрут на её реальный slug", async () => {
    routeParams.value = { slug: "zhidkosti" };
    const wrapper = mount(CategoryQuickNav);

    const snus = wrapper
      .findAll(".qnav__category")
      .find((b) => b.text().includes("Снюс"));
    expect(snus).toBeDefined();

    await snus!.trigger("click");
    expect(routerReplace).toHaveBeenCalledWith({
      name: "category",
      params: { slug: "snyus-i-plastiny" },
    });

    wrapper.unmount();
  });

  it("повторный клик по активной категории не меняет маршрут", async () => {
    routeParams.value = { slug: "zhidkosti" };
    const wrapper = mount(CategoryQuickNav);

    const liquids = wrapper
      .findAll(".qnav__category")
      .find((b) => b.text().includes("Жидкости"));

    await liquids!.trigger("click");
    expect(routerReplace).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it("карусель: один ряд, две страницы по три категории", () => {
    const wrapper = mount(CategoryQuickNav);

    // Две страницы дорожки.
    const pages = wrapper.findAll(".qnav__page");
    expect(pages.length).toBe(2);
    // В первой странице — жидкости/расходники/устройства.
    expect(pages[0].text()).toContain("Жидкости");
    expect(pages[0].text()).toContain("Расходники");
    expect(pages[0].text()).toContain("Устройства");
    // Во второй — одноразки/снюс/кальянка.
    expect(pages[1].text()).toContain("Одноразки");
    expect(pages[1].text()).toContain("Снюс");
    expect(pages[1].text()).toContain("Кальянка");
    // Точки-индикаторы.
    expect(wrapper.findAll(".qnav__dot").length).toBe(2);

    wrapper.unmount();
  });

  it("активная категория на второй странице раскрывает её", async () => {
    routeParams.value = { slug: "snyus-i-plastiny" };
    const wrapper = mount(CategoryQuickNav);

    // Активная категория снюс — панель листается на вторую страницу.
    const active = wrapper.find(".qnav__category--active");
    expect(active.text()).toContain("Снюс");
    const track = wrapper.find(".qnav__track");
    expect(track.attributes("style")).toContain("-100%");

    wrapper.unmount();
  });

  it("подсказка «есть ещё» показывается до первого свайпа", () => {
    routeParams.value = { slug: "zhidkosti" };
    const wrapper = mount(CategoryQuickNav);

    expect(wrapper.find(".qnav__hint").exists()).toBe(true);

    wrapper.unmount();
  });
});
