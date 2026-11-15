import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import CategoryQuickNav from "@/components/CategoryQuickNav.vue";
import { useCatalogStore } from "@/stores/catalog";

const routerReplace = vi.fn();
/** Реактивные params: компонент держит объект route в замыкании,
 *  поэтому подмена ссылки на новый объект до него не доходит —
 *  как и в настоящем vue-router, params должны быть реактивными. */
const routeState = reactive<{ params: { slug: string } }>({
  params: { slug: "zhidkosti" },
});

vi.mock("vue-router", () => ({
  useRoute: () => routeState,
  useRouter: () => ({ replace: routerReplace }),
}));

describe("CategoryQuickNav", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    routerReplace.mockClear();
    routeState.params = { slug: "zhidkosti" };
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
    routeState.params = { slug: "zhidkosti" };
    const wrapper = mount(CategoryQuickNav);

    const active = wrapper.find(".qnav__category--active");
    expect(active.exists()).toBe(true);
    expect(active.text()).toContain("Жидкости");

    wrapper.unmount();
  });

  it("заливка активной категории живёт в подложке, а не в background кнопки", () => {
    routeState.params = { slug: "zhidkosti" };
    const wrapper = mount(CategoryQuickNav);

    // У каждой кнопки есть подложка заливки — её и анимируем.
    expect(wrapper.findAll(".qnav__fill").length).toBe(6);
    const active = wrapper.find(".qnav__category--active");
    expect(active.find(".qnav__fill").exists()).toBe(true);

    wrapper.unmount();
  });

  it("заливка переключается сразу при клике, без летящей капсулы", async () => {
    routeState.params = { slug: "zhidkosti" };
    const wrapper = mount(CategoryQuickNav);
    const buttons = wrapper.findAll(".qnav__category");
    const find = (text: string) => buttons.find((b) => b.text().includes(text))!;

    // До клика активна «Жидкости».
    expect(find("Жидкости").classes()).toContain("qnav__category--active");
    expect(find("Расходники").classes()).not.toContain("qnav__category--active");

    await find("Расходники").trigger("click");
    // Мок роутера не обновляет params сам (в приложении это делает
    // vue-router) — доводим состояние до того, что видит компонент
    // сразу после навигации.
    routeState.params = { slug: "rashodniki" };
    await wrapper.vm.$nextTick();

    // Заливка уже на новой категории, старая погашена. Никаких
    // промежуточных классов и летящих слоёв — переключение мгновенное.
    expect(find("Расходники").classes()).toContain("qnav__category--active");
    expect(find("Жидкости").classes()).not.toContain("qnav__category--active");
    expect(wrapper.find(".qnav-sweep").exists()).toBe(false);
    expect(document.querySelector(".qnav-sweep")).toBeNull();
    // От прежней анимации не осталось ни частиц, ни служебных классов.
    expect(document.querySelector(".qnav-piece")).toBeNull();
    expect(wrapper.find(".qnav__category--arming").exists()).toBe(false);
    expect(wrapper.find(".qnav__category--fading").exists()).toBe(false);
    expect(wrapper.find(".qnav__category--grow").exists()).toBe(false);

    wrapper.unmount();
  });

  it("клик по другой категории меняет маршрут на её реальный slug", async () => {
    routeState.params = { slug: "zhidkosti" };
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
    routeState.params = { slug: "zhidkosti" };
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
    // В первой странице — жидкости/расходники/снюс.
    expect(pages[0].text()).toContain("Жидкости");
    expect(pages[0].text()).toContain("Расходники");
    expect(pages[0].text()).toContain("Снюс");
    // Во второй — одноразки/устройства/кальянка.
    expect(pages[1].text()).toContain("Одноразки");
    expect(pages[1].text()).toContain("Устройства");
    expect(pages[1].text()).toContain("Кальянка");
    // Точки-индикаторы.
    expect(wrapper.findAll(".qnav__dot").length).toBe(2);

    wrapper.unmount();
  });

  it("активная категория на второй странице раскрывает её", async () => {
    routeState.params = { slug: "ustrojstva" };
    const wrapper = mount(CategoryQuickNav);

    // Активная категория устройства — панель листается на вторую страницу.
    const active = wrapper.find(".qnav__category--active");
    expect(active.text()).toContain("Устройства");
    const track = wrapper.find(".qnav__track");
    expect(track.attributes("style")).toContain("-100%");

    wrapper.unmount();
  });

  it("подсказка «есть ещё» показывается до первого свайпа", () => {
    routeState.params = { slug: "zhidkosti" };
    const wrapper = mount(CategoryQuickNav);

    expect(wrapper.find(".qnav__hint").exists()).toBe(true);

    wrapper.unmount();
  });
});


