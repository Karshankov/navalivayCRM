import { beforeEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import LiquidLineCard from "@/components/product/liquid/LiquidLineCard.vue";
import type { Product } from "@/stores/catalog";

const makeProduct = (overrides: Partial<Product> = {}): Product => ({
  id: "p-1",
  categoryId: "c-1",
  title: "CHAPPMAN",
  priceRub: 15,
  description: "",
  images: [],
  createdAt: "2025-01-01T00:00:00.000Z",
  ...overrides,
});

describe("LiquidLineCard", () => {
  let pinia: ReturnType<typeof createPinia>;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    localStorage.clear();
  });

  it("shows meta in info and price under the image", () => {
    const wrapper = mount(LiquidLineCard, {
      global: {
        plugins: [pinia],
        stubs: {
          ColorPreviewModal: true,
        },
      },
      props: {
        groupId: "g-1",
        title: "CHAPPMAN",
        products: [
          makeProduct({
            hasVariants: true,
            variants: [
              { id: "v-1", name: "20 мг", priceRub: 15, stock: 5, images: [] },
            ],
          }),
        ],
        expanded: false,
        coverImage: null,
        fallbackImage: "/placeholder-category.png",
        subgroups: [],
        metaLabel: "Крепость",
        metaValue: "20 мг",
      },
    });

    expect(wrapper.find(".liquid-line-meta").text()).toBe("Крепость 20 мг");
    expect(wrapper.find(".liquid-line-info .liquid-line-image-price").exists()).toBe(false);
    expect(wrapper.find(".liquid-line-image-price").exists()).toBe(true);
    expect(wrapper.find(".liquid-line-image-price-amount").text()).toBe("15");
    expect(wrapper.find(".liquid-line-image-wrapper .liquid-line-image-price").exists()).toBe(true);
  });

  it("рисует ленту новинки только когда линейка отмечена", () => {
    const mountCard = (isNew: boolean) =>
      mount(LiquidLineCard, {
        global: { plugins: [pinia], stubs: { ColorPreviewModal: true } },
        props: {
          groupId: "g-1",
          title: "CHAPPMAN",
          products: [makeProduct()],
          expanded: false,
          coverImage: null,
          fallbackImage: "/placeholder-category.png",
          subgroups: [],
          isNew,
        },
      });

    const marked = mountCard(true);
    const ribbon = marked.find(".new-ribbon");
    expect(ribbon.exists()).toBe(true);
    expect(ribbon.text()).toBe("НОВИНКА");

    // Карточка становится хостом ленты: от неё считается угол, и по её
    // скруглению лента обрезается.
    expect(marked.find(".liquid-line-card").classes()).toContain("has-new-ribbon");

    // Нажатия лента не перехватывает — под ней кнопки карточки.
    expect(ribbon.attributes("style") ?? "").not.toContain("pointer-events");
    const plain = mountCard(false);
    expect(plain.find(".new-ribbon").exists()).toBe(false);
    expect(plain.find(".liquid-line-card").classes()).not.toContain("has-new-ribbon");
  });

  it("показывает скидку зачёркнутой ценой и плашкой", () => {
    const wrapper = mount(LiquidLineCard, {
      global: { plugins: [pinia], stubs: { ColorPreviewModal: true } },
      props: {
        groupId: "g-1",
        title: "CHAPPMAN",
        products: [
          makeProduct({ priceRub: 12, oldPriceRub: 16, hasDiscount: true }),
        ],
        expanded: false,
        coverImage: null,
        fallbackImage: "/placeholder-category.png",
        subgroups: [],
      },
    });

    expect(wrapper.find(".liquid-line-image-price-amount").text()).toBe("12");
    expect(wrapper.find(".liquid-line-image-price-old").text()).toBe("16");
    // Числа на плашке нет: точная глубина скидки живёт бейджем у самой позиции.
    expect(wrapper.find(".liquid-line-discount").text()).toBe("Скидки");
  });

  it("не зачёркивает цену линейки, когда подешевел только один вкус", () => {
    const wrapper = mount(LiquidLineCard, {
      global: { plugins: [pinia], stubs: { ColorPreviewModal: true } },
      props: {
        groupId: "g-1",
        title: "CHAPPMAN",
        products: [
          makeProduct({ id: "p-1", title: "Малина", priceRub: 12, oldPriceRub: 16, hasDiscount: true }),
          makeProduct({ id: "p-2", title: "Апельсин", priceRub: 16 }),
        ],
        expanded: true,
        coverImage: null,
        fallbackImage: "/placeholder-category.png",
        subgroups: [],
      },
    });

    // Скидка на один вкус цену линейки не занижает: остальные продаются по 16,
    // и обложка обязана называть цену, по которой линейку реально можно взять.
    expect(wrapper.find(".liquid-line-image-price-amount").text()).toBe("16");
    expect(wrapper.find(".liquid-line-image-price-old").exists()).toBe(false);
    expect(wrapper.find(".liquid-line-discount").exists()).toBe(true);

    // Зачёркнутая цена и процент живут в раскрытом списке, рядом со вкусом.
    // Апельсин за 16 повторил бы цену обложки, поэтому его цена скрыта.
    const prices = wrapper.findAll(".liquid-flavor-price");
    expect(prices).toHaveLength(1);
    expect(prices[0].find(".liquid-price-old").text()).toBe("16");
    expect(prices[0].find(".liquid-price-drop").text()).toBe("-25%");
  });

  it("подешевела вся линейка — на обложке новая цена и зачёркнутая старая", () => {
    const wrapper = mount(LiquidLineCard, {
      global: { plugins: [pinia], stubs: { ColorPreviewModal: true } },
      props: {
        groupId: "g-1",
        title: "CHAPPMAN",
        products: [
          makeProduct({ id: "p-1", title: "Малина", priceRub: 12, oldPriceRub: 16, hasDiscount: true }),
          makeProduct({ id: "p-2", title: "Апельсин", priceRub: 14, oldPriceRub: 18, hasDiscount: true }),
        ],
        expanded: false,
        coverImage: null,
        fallbackImage: "/placeholder-category.png",
        subgroups: [],
      },
    });

    expect(wrapper.find(".liquid-line-image-price-amount").text()).toBe("12");
    expect(wrapper.find(".liquid-line-image-price-old").text()).toBe("16");
  });

  it("показывает цену скидочного вкуса, даже когда она совпала с минимумом", () => {
    const wrapper = mount(LiquidLineCard, {
      global: { plugins: [pinia], stubs: { ColorPreviewModal: true } },
      props: {
        groupId: "g-1",
        title: "CHAPPMAN",
        products: [
          makeProduct({ id: "p-1", title: "Малина", priceRub: 12, oldPriceRub: 16, hasDiscount: true }),
          makeProduct({ id: "p-2", title: "Апельсин", priceRub: 20 }),
        ],
        expanded: true,
        coverImage: null,
        fallbackImage: "/placeholder-category.png",
        subgroups: [],
      },
    });

    // Скидочный вкус обычно и есть самый дешёвый в линейке. Спрячь его цену как
    // повтор минимума, и зачёркивать с процентом станет нечего.
    const prices = wrapper.findAll(".liquid-flavor-price");
    expect(prices).toHaveLength(2);
    expect(prices[0].find(".liquid-price-drop").text()).toBe("-25%");
  });

  it("зажигает плашку у родителя, когда подешевело внутри подлинейки", () => {
    const wrapper = mount(LiquidLineCard, {
      global: { plugins: [pinia], stubs: { ColorPreviewModal: true } },
      props: {
        groupId: "g-root",
        title: "PODONKI",
        products: [],
        expanded: false,
        coverImage: null,
        fallbackImage: "/placeholder-category.png",
        subgroups: [
          {
            id: "g-kid",
            name: "PODONKI INFERNO",
            productCount: 1,
            products: [makeProduct({ id: "p-9", priceRub: 12, oldPriceRub: 16, hasDiscount: true })],
          },
        ],
      },
    });

    expect(wrapper.find(".liquid-line-discount").exists()).toBe(true);
  });

  it("без скидки не рисует ни зачёркнутой цены, ни плашки", () => {
    const wrapper = mount(LiquidLineCard, {
      global: { plugins: [pinia], stubs: { ColorPreviewModal: true } },
      props: {
        groupId: "g-1",
        title: "CHAPPMAN",
        products: [makeProduct({ priceRub: 16 })],
        expanded: false,
        coverImage: null,
        fallbackImage: "/placeholder-category.png",
        subgroups: [],
      },
    });

    expect(wrapper.find(".liquid-line-image-price-old").exists()).toBe(false);
    expect(wrapper.find(".liquid-line-discount").exists()).toBe(false);
  });

  it("hides flavor prices in the expanded list when they match the header price", () => {
    const wrapper = mount(LiquidLineCard, {
      global: {
        plugins: [pinia],
        stubs: {
          ColorPreviewModal: true,
        },
      },
      props: {
        groupId: "g-podgon",
        title: "PODONKI PODGON",
        products: [
          makeProduct({ id: "p-1", title: "Малиновая конфета", priceRub: 15 }),
          makeProduct({ id: "p-2", title: "Апельсин", priceRub: 15 }),
        ],
        expanded: true,
        coverImage: null,
        fallbackImage: "/placeholder-category.png",
        subgroups: [],
        metaLabel: "Крепость",
        metaValue: "50 мг",
      },
    });

    expect(wrapper.findAll(".liquid-flavor-price").length).toBe(0);
    expect(wrapper.find(".liquid-line-image-price-amount").text()).toBe("15");
  });

  it("shows only differing flavor prices in red in the expanded list", () => {
    const wrapper = mount(LiquidLineCard, {
      global: {
        plugins: [pinia],
        stubs: {
          ColorPreviewModal: true,
        },
      },
      props: {
        groupId: "g-mix",
        title: "MIX LINE",
        products: [
          makeProduct({ id: "p-1", title: "Обычный", priceRub: 18 }),
          makeProduct({ id: "p-2", title: "Премиум", priceRub: 20 }),
        ],
        expanded: true,
        coverImage: null,
        fallbackImage: "/placeholder-category.png",
        subgroups: [],
        metaLabel: null,
        metaValue: null,
      },
    });

    const flavorPrices = wrapper.findAll(".liquid-flavor-price");
    expect(flavorPrices.length).toBe(1);
    expect(flavorPrices[0]?.text()).toBe("20 BYN");
  });

  it("does not show a price for a parent line with subgroups", () => {
    const wrapper = mount(LiquidLineCard, {
      global: {
        plugins: [pinia],
        stubs: {
          ColorPreviewModal: true,
        },
      },
      props: {
        groupId: "g-2",
        title: "PODONKI",
        products: [makeProduct({ id: "p-2", priceRub: 12 })],
        expanded: false,
        coverImage: null,
        fallbackImage: "/placeholder-category.png",
        subgroups: [{ id: "child-1", name: "PODONKI V1", productCount: 3 }],
        metaLabel: null,
        metaValue: null,
      },
    });

    expect(wrapper.find(".liquid-line-image-price").exists()).toBe(false);
  });

  it("shows price under the image when meta is absent", () => {
    const wrapper = mount(LiquidLineCard, {
      global: {
        plugins: [pinia],
        stubs: {
          ColorPreviewModal: true,
        },
      },
      props: {
        groupId: "g-3",
        title: "CHAPPMAN",
        products: [makeProduct({ priceRub: 15 })],
        expanded: false,
        coverImage: null,
        fallbackImage: "/placeholder-category.png",
        subgroups: [],
        metaLabel: null,
        metaValue: null,
      },
    });

    expect(wrapper.find(".liquid-line-image-price").exists()).toBe(true);
    expect(wrapper.find(".liquid-line-image-price-amount").text()).toBe("15");
  });
});
