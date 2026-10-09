import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import GroupLineItemContent from "@/components/product/GroupLineItemContent.vue";
import type { Product } from "@/stores/catalog";

const makeProduct = (overrides: Partial<Product> = {}): Product => ({
  id: "p-1",
  categoryId: "c-1",
  title: "Aegis Hero 5",
  priceRub: 100,
  description: "",
  images: [],
  createdAt: "2025-01-01T00:00:00.000Z",
  ...overrides,
});

describe("GroupLineItemContent", () => {
  let pinia: ReturnType<typeof createPinia>;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    localStorage.clear();
  });

  it("renders only in-stock variants", () => {
    const product = makeProduct({
      hasVariants: true,
      variants: [
        { id: "v-1", name: "Variant 1", priceRub: 100, stock: 2, images: [] },
        { id: "v-2", name: "Variant 2", priceRub: 120, stock: 0, images: [] },
        { id: "v-3", name: "Variant 3", priceRub: 140, stock: null, images: [] },
      ],
    });

    const wrapper = mount(GroupLineItemContent, {
      global: {
        plugins: [pinia],
        stubs: { Teleport: true },
      },
      props: {
        node: {
          id: "g-1",
          name: "GEEKVAPE AEGIS",
          slug: "geekvape-aegis",
          order: 0,
          productCount: 1,
          totalProductCount: 1,
          depth: 0,
          parentId: null,
          metaLabel: null,
          metaValue: null,
          children: [],
          products: [product],
        },
        categoryImage: null,
      },
    });

    const rows = wrapper.findAll(".group-variant-row");
    expect(rows.length).toBe(2);
    expect(wrapper.text()).toContain("Variant 1");
    expect(wrapper.text()).toContain("Variant 3");
    expect(wrapper.text()).not.toContain("Variant 2");
  });

  it("hides the minimum direct product price instead of the first one", () => {
    const expensiveProduct = makeProduct({
      id: "p-2",
      title: "Smoant Knight 80",
      priceRub: 140,
    });
    const cheapProduct = makeProduct({
      id: "p-3",
      title: "Smoant Knight 40",
      priceRub: 50,
    });

    const wrapper = mount(GroupLineItemContent, {
      global: {
        plugins: [pinia],
        stubs: { Teleport: true },
      },
      props: {
        node: {
          id: "g-2",
          name: "SMOANT",
          slug: "smoant",
          order: 0,
          productCount: 2,
          totalProductCount: 2,
          depth: 0,
          parentId: null,
          metaLabel: null,
          metaValue: null,
          children: [],
          products: [expensiveProduct, cheapProduct],
        },
        categoryImage: null,
      },
    });

    const priceTexts = wrapper
      .findAll(".group-product-price")
      .map((node) => node.text().replace(/\s+/g, " ").trim());

    expect(priceTexts).toContain("140 BYN");
    expect(priceTexts).not.toContain("50 BYN");
  });
});
