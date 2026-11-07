import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import TopCartBar from "@/components/TopCartBar.vue";
import { useCartStore } from "@/stores/cart";
import { useCartFlight } from "@/composables/useCartFlight";

const routerPush = vi.fn();

vi.mock("vue-router", () => ({
  useRoute: () => ({ path: "/" }),
  useRouter: () => ({ push: routerPush }),
}));

function makeProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: "p-1",
    categoryId: "cat-1",
    groupId: null,
    title: "Тестовый товар",
    priceRub: 25,
    description: "",
    images: ["/img/p1.png"],
    createdAt: "2026-06-04T00:00:00.000Z",
    isAvailable: true,
    ...overrides,
  };
}

/** В happy-dom нет Element.animate — подменяем фейком, чтобы
 *  flyToCart считал полёт запущенным. */
function stubAnimate() {
  (Element.prototype as unknown as Record<string, unknown>).animate = vi.fn(
    () => ({ finished: Promise.resolve() }),
  );
}

describe("useCartFlight + TopCartBar", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    routerPush.mockClear();
    useCartStore().clearCart();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.querySelectorAll(".navalivay-cart-flight").forEach((n) => n.remove());
  });

  it("данные раскрываются сразу, визуал — с задержкой под прилёт миниатюры", async () => {
    vi.useFakeTimers();
    stubAnimate();
    const { expanded, expandedVisual, totalAmount, addItemWithFlight } =
      useCartFlight();
    // attachTo: TopCartBar ищет цель полёта в реальном DOM.
    const host = document.createElement("div");
    document.body.appendChild(host);
    const wrapper = mount(TopCartBar, {
      props: { visible: true },
      attachTo: host,
    });

    expect(expanded.value).toBe(false);
    expect(wrapper.find(".nav-top-cart--expanded").exists()).toBe(false);

    const source = document.createElement("button");
    document.body.appendChild(source);
    addItemWithFlight(makeProduct(), 1, null, source);

    // Данные готовы сразу: корзина непуста, сумма реактивна.
    expect(expanded.value).toBe(true);
    expect(totalAmount.value).toBe(25);

    // Визуальное раскрытие отложено: миниатюра ещё летит,
    // красный овал не появляется «из ниоткуда».
    expect(expandedVisual.value).toBe(false);
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".nav-top-cart--expanded").exists()).toBe(false);

    // Полёт почти завершён (~58% от 900 мс) — овал раскрывается.
    vi.advanceTimersByTime(530);
    expect(expandedVisual.value).toBe(true);
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".nav-top-cart--expanded").exists()).toBe(true);
    // Копеек нет: целая сумма без «.00».
    expect(wrapper.find(".nav-top-cart__title").text()).toBe("Заказ на 25 BYN");

    source.remove();
    wrapper.unmount();
    host.remove();
  });

  it("плашка раскрыта с корзиной, восстановленной из localStorage", () => {
    // Имитируем корзину, живущую с прошлого визита: стор создан
    // и наполнен ДО первого обращения к композаблу. Раскрытие
    // мгновенное — полёта нет, ждать нечего.
    useCartStore().addItem(makeProduct(), 1);

    const { expanded, expandedVisual } = useCartFlight();
    expect(expanded.value).toBe(true);
    expect(expandedVisual.value).toBe(true);
  });

  it("плашка раскрывается, когда корзина дозагрузилась после обновления страницы", () => {
    // Реальный сценарий бага: TopCartBar смонтировался при пустой
    // корзине, стор дозагрузил товары из localStorage позже —
    // watch должен раскрыть визуал без полёта.
    // В приложении стор один на сессию; в тестах pinia пересоздаётся
    // — привязываем watch к текущему стору и сбрасываем состояние.
    const cartStore = useCartStore();
    cartStore.clearCart();
    const { expanded, expandedVisual, totalItems } = useCartFlight();
    // ensureStore: watch (immediate) привязывается к текущему стору.
    void totalItems.value;

    // «Дозагрузка»: товары приходят извне (не через addItemWithFlight).
    cartStore.addItem(makeProduct(), 1);

    expect(expanded.value).toBe(true);
    expect(expandedVisual.value).toBe(true);
  });

  it("без полёта (нет источника) плашка раскрывается сразу", () => {
    const { expanded, expandedVisual, addItemWithFlight } = useCartFlight();

    addItemWithFlight(makeProduct(), 1);

    expect(expanded.value).toBe(true);
    expect(expandedVisual.value).toBe(true);
    expect(useCartStore().totalItems).toBe(1);
  });

  it("схлопывает плашку после удаления последнего товара", async () => {
    const { expanded, expandedVisual, addItemWithFlight } = useCartFlight();
    const wrapper = mount(TopCartBar, { props: { visible: true } });
    const cartStore = useCartStore();

    addItemWithFlight(makeProduct(), 1);
    expect(expanded.value).toBe(true);
    expect(expandedVisual.value).toBe(true);

    cartStore.removeItem("p-1");
    expect(expanded.value).toBe(false);
    expect(expandedVisual.value).toBe(false);
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".nav-top-cart--expanded").exists()).toBe(false);

    wrapper.unmount();
  });

  it("клик по корзине ведёт на оформление заказа", async () => {
    const wrapper = mount(TopCartBar, { props: { visible: true } });

    await wrapper.find("[data-navalivay-cart-bar]").trigger("click");
    expect(routerPush).toHaveBeenCalledWith("/checkout");

    await wrapper.find(".nav-top-profile").trigger("click");
    expect(routerPush).toHaveBeenCalledWith("/profile");

    wrapper.unmount();
  });

  it("на экране профиля справа кнопка «На главную» с тёмным кружком", async () => {
    // route мок замокан на "/" — для проверки профиля монтируем с
    // другим моком пути нельзя (hoisted), поэтому проверяем через
    // отдельный тест-файл TopCartBar.reload*. Здесь — логика кнопки.
    const wrapper = mount(TopCartBar, { props: { visible: true } });
    // На "/" — обычный профиль с аватаркой.
    expect(wrapper.find(".nav-top-profile__avatar--back").exists()).toBe(false);
    expect(wrapper.text()).toContain("Мой профиль");
    wrapper.unmount();
  });

  it("быстрые повторные добавления не теряют товары", () => {
    const { addItemWithFlight } = useCartFlight();
    const source = document.createElement("button");
    stubAnimate();

    for (let i = 0; i < 10; i++) {
      addItemWithFlight(makeProduct({ id: `p-${i}`, images: [] }), 1, null, source);
    }

    expect(useCartStore().totalItems).toBe(10);

    source.remove();
  });

  it("flyImage карточки (обложка линейки) важнее вычисленной миниатюры", () => {
    vi.useFakeTimers();
    stubAnimate();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const wrapper = mount(TopCartBar, {
      props: { visible: true },
      attachTo: host,
    });
    const { addItemWithFlight } = useCartFlight();
    const source = document.createElement("button");
    document.body.appendChild(source);

    // У товара есть своё фото, но карточка передаёт обложку линейки —
    // в полёт идёт именно она (карточка знает контекст лучше).
    addItemWithFlight(
      makeProduct(),
      1,
      null,
      source,
      "/img/group-cover.png",
    );

    const img = document.querySelector<HTMLImageElement>(
      ".navalivay-cart-flight img",
    );
    expect(img?.getAttribute("src")).toBe("/img/group-cover.png");

    source.remove();
    wrapper.unmount();
    host.remove();
    vi.useRealTimers();
  });

  it("товар без фото и без обложки линейки летит нейтральной иконкой, не картинкой категории", () => {
    vi.useFakeTimers();
    stubAnimate();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const wrapper = mount(TopCartBar, {
      props: { visible: true },
      attachTo: host,
    });
    const { addItemWithFlight } = useCartFlight();
    const source = document.createElement("button");
    document.body.appendChild(source);

    addItemWithFlight(makeProduct({ images: [], links: [] }), 1, null, source);

    // Нет фото — нет <img>; летит нейтральная svg-иконка.
    expect(document.querySelector(".navalivay-cart-flight img")).toBeNull();
    expect(
      document.querySelector(".navalivay-cart-flight svg"),
    ).not.toBeNull();

    source.remove();
    wrapper.unmount();
    host.remove();
    vi.useRealTimers();
  });
});
