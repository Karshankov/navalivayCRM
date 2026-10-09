import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useCartStore } from "@/stores/cart";
import { useCatalogStore, type Product } from "@/stores/catalog";

describe("cart store order edit mode", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it("replaces cart items from order and persists edit state", () => {
    const cartStore = useCartStore();

    cartStore.replaceItemsFromOrder([
      {
        id: "oi-1",
        product_id: "p-1",
        product_title: "Liquid Cherry",
        quantity: 2,
        price_per_unit: 15,
        discount_amount: 0,
        total_price: 30,
        total_cost: 0,
        cart_item: {
          productId: "p-1",
          title: "Liquid Cherry",
          productTitle: "Liquid Cherry",
          groupName: "Жидкости",
          priceRub: 15,
          quantity: 2,
          image: "/img/liquid.png",
          variantId: null,
          variantName: null,
          groupId: "group-1",
          categoryId: "cat-1",
        },
      },
    ]);
    cartStore.startOrderEdit("order-123", { promoCode: "SAVE10" });

    expect(cartStore.items).toHaveLength(1);
    expect(cartStore.items[0].productId).toBe("p-1");
    expect(cartStore.editingOrderId).toBe("order-123");
    expect(cartStore.editingPromoCode).toBe("SAVE10");
    expect(localStorage.getItem("navalivay_edit_order_id")).toBe("order-123");
    expect(localStorage.getItem("navalivay_edit_promo_code")).toBe("SAVE10");

    cartStore.finishOrderEdit();

    expect(cartStore.editingOrderId).toBeNull();
    expect(cartStore.editingPromoCode).toBe("");
    expect(localStorage.getItem("navalivay_edit_order_id")).toBeNull();
    expect(localStorage.getItem("navalivay_edit_promo_code")).toBeNull();
  });

  it("clamps loyalty selections and clears them explicitly", () => {
    const cartStore = useCartStore();

    cartStore.replaceItemsFromOrder([
      {
        productId: "p-1",
        title: "Liquid Cherry",
        productTitle: "Liquid Cherry",
        groupName: "Liquids",
        priceRub: 15,
        quantity: 3,
        image: "/img/liquid.png",
        variantId: null,
        variantName: null,
        groupId: "group-1",
        categoryId: "cat-1",
        loyaltyUnitsApplied: 2,
      },
    ]);

    expect(cartStore.items[0].loyaltyUnitsApplied).toBe(2);

    cartStore.updateQuantity("p-1", 1);
    expect(cartStore.items[0].loyaltyUnitsApplied).toBe(1);

    cartStore.setLoyaltyUnits("p-1", 9);
    expect(cartStore.items[0].loyaltyUnitsApplied).toBe(1);

    cartStore.clearLoyaltySelections();
    expect(cartStore.items[0].loyaltyUnitsApplied).toBe(0);
  });
});

describe("cart store product images", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function liquidProduct(overrides: Partial<Product> = {}): Product {
    return {
      id: "liquid-rick-grape-kiwi",
      categoryId: "cat-liquids",
      groupId: "line-rick",
      groupName: "RICK AND MORTY RUSSIA",
      title: "Виноград киви",
      priceRub: 17,
      description: "",
      images: ["/api/categories/cat-liquids/cover"],
      createdAt: "2026-08-01T00:00:00.000Z",
      needsCategoryImage: true,
      ...overrides,
    };
  }

  function seedDirectCovers() {
    const catalogStore = useCatalogStore();
    catalogStore.categories = [
      {
        id: "cat-liquids",
        slug: "zhidkosti",
        name: "Жидкости",
        order: 0,
        productCount: 3,
        coverImage: "/api/categories/cat-liquids/cover",
        hasCoverImage: true,
        groups: [
          {
            id: "line-rick",
            slug: "rick-and-morty-russia",
            name: "RICK AND MORTY RUSSIA",
            order: 0,
            productCount: 1,
            coverImage: "/api/category-groups/line-rick/cover",
            hasCoverImage: true,
          },
          {
            id: "line-pixel",
            slug: "pixel-sour",
            name: "PIXEL SOUR",
            order: 1,
            productCount: 1,
            coverImage: "/api/category-groups/line-pixel/cover",
            hasCoverImage: true,
          },
          {
            id: "line-dogswill",
            slug: "dogswill",
            name: "DOGSWILL",
            order: 2,
            productCount: 1,
            coverImage: "/api/category-groups/line-dogswill/cover",
            hasCoverImage: true,
          },
        ],
      },
    ];
    return catalogStore;
  }

  it("keeps distinct line covers for liquids from different lines", () => {
    seedDirectCovers();
    const cartStore = useCartStore();

    cartStore.addItem(liquidProduct());
    cartStore.addItem(liquidProduct({
      id: "liquid-pixel-cranberry-lime",
      groupId: "line-pixel",
      groupName: "PIXEL SOUR",
      title: "Клюква лайм",
    }));
    cartStore.addItem(liquidProduct({
      id: "liquid-dogswill-mountain-dew",
      groupId: "line-dogswill",
      groupName: "DOGSWILL",
      title: "Маунтин дью",
    }));

    expect(cartStore.items.map((item) => item.image)).toEqual([
      "/api/category-groups/line-rick/cover",
      "/api/category-groups/line-pixel/cover",
      "/api/category-groups/line-dogswill/cover",
    ]);
  });

  it("keeps a product-specific image for a grouped product", () => {
    seedDirectCovers();
    const cartStore = useCartStore();

    cartStore.addItem(liquidProduct({
      id: "device-with-photo",
      categoryId: "cat-devices",
      title: "Устройство",
      images: ["/uploads/device.webp"],
      needsCategoryImage: false,
    }));

    expect(cartStore.items[0].image).toBe("/uploads/device.webp");
  });

  it("keeps the selected variant image", () => {
    seedDirectCovers();
    const cartStore = useCartStore();
    const device = liquidProduct({
      id: "device-with-variants",
      categoryId: "cat-devices",
      title: "Устройство",
      images: ["/uploads/device-default.webp"],
      needsCategoryImage: false,
      hasVariants: true,
      variants: [
        {
          id: "variant-black",
          name: "Чёрный",
          priceRub: 99,
          images: ["/uploads/device-black.webp"],
        },
      ],
    });

    cartStore.addItem(device, 1, "variant-black");

    expect(cartStore.items[0].image).toBe("/uploads/device-black.webp");
  });

  it("repairs a saved category cover and does not overwrite a saved product photo", () => {
    const catalogStore = seedDirectCovers();
    const liquid = liquidProduct();
    const device = liquidProduct({
      id: "device-with-photo",
      categoryId: "cat-devices",
      title: "Устройство",
      images: ["/uploads/device.webp"],
      needsCategoryImage: false,
    });
    catalogStore.allProducts = [liquid, device];
    localStorage.setItem("navalivay_cart", JSON.stringify([
      {
        productId: liquid.id,
        title: liquid.title,
        productTitle: liquid.title,
        groupName: liquid.groupName,
        priceRub: liquid.priceRub,
        quantity: 1,
        image: "/api/categories/cat-liquids/cover",
        groupId: liquid.groupId,
        categoryId: liquid.categoryId,
      },
      {
        productId: device.id,
        title: device.title,
        productTitle: device.title,
        groupName: device.groupName,
        priceRub: device.priceRub,
        quantity: 1,
        image: "/uploads/device.webp",
        groupId: device.groupId,
        categoryId: device.categoryId,
      },
    ]));

    const cartStore = useCartStore();

    expect(cartStore.items.find((item) => item.productId === liquid.id)?.image).toBe(
      "/api/category-groups/line-rick/cover",
    );
    expect(cartStore.items.find((item) => item.productId === device.id)?.image).toBe(
      "/uploads/device.webp",
    );
  });

  it("restores the line cover when checkout opens with an empty catalog", async () => {
    const liquid = liquidProduct();
    localStorage.setItem("navalivay_cart", JSON.stringify([
      {
        productId: liquid.id,
        title: liquid.title,
        productTitle: liquid.title,
        groupName: liquid.groupName,
        priceRub: liquid.priceRub,
        quantity: 1,
        image: "/api/categories/cat-liquids/cover",
        groupId: liquid.groupId,
        categoryId: liquid.categoryId,
      },
    ]));

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "/api/categories") {
        return {
          ok: true,
          json: async () => ([
            {
              id: "cat-liquids",
              slug: "zhidkosti",
              name: "Жидкости",
              order: 0,
              productCount: 1,
              coverImage: "/api/categories/cat-liquids/cover",
              hasCoverImage: true,
              groups: [
                {
                  id: "line-rick",
                  slug: "rick-and-morty-russia",
                  name: "RICK AND MORTY RUSSIA",
                  order: 0,
                  productCount: 1,
                  coverImage: "/api/category-groups/line-rick/cover",
                  hasCoverImage: true,
                },
              ],
            },
          ]),
        } as Response;
      }
      if (url.startsWith("/api/products?")) {
        return {
          ok: true,
          json: async () => ({ products: [liquid], total: 1, hasMore: false }),
        } as Response;
      }
      if (url === "/api/categories/cat-liquids/image") {
        return {
          ok: true,
          json: async () => ({ image: "/api/categories/cat-liquids/cover" }),
        } as Response;
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const cartStore = useCartStore();

    await vi.waitFor(() => {
      expect(cartStore.items[0]?.image).toBe(
        "/api/category-groups/line-rick/cover",
      );
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/categories",
      expect.objectContaining({ headers: {} }),
    );
  });
});
