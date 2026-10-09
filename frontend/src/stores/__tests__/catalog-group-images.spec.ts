import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useCatalogStore } from "@/stores/catalog";

describe("catalog group images", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("updates category group coverImage after fetchGroupImage succeeds", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ image: "data:image/png;base64,abc" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const store = useCatalogStore();
    store.categories = [
      {
        id: "cat-1",
        slug: "snus",
        name: "Снюс",
        order: 0,
        productCount: 1,
        groups: [
          {
            id: "leaf-1",
            slug: "leaf-1",
            name: "Снюс ICEBERG 150MG",
            order: 0,
            productCount: 1,
            parentId: "brand-1",
            hasCoverImage: true,
            coverImage: null,
          },
        ],
      },
    ];

    const image = await store.fetchGroupImage("leaf-1");

    expect(image).toBe("data:image/png;base64,abc");
    expect(store.getGroupImage("leaf-1")).toBe("data:image/png;base64,abc");
    expect(store.categories[0].groups[0].coverImage).toBe("data:image/png;base64,abc");
    expect(fetchMock).toHaveBeenCalledWith("/api/category-groups/leaf-1/image");
  });

  it("loadGroupImages fetches nested groups that are not root-level", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({ image: "data:image/png;base64,xyz" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const store = useCatalogStore();
    store.categories = [
      {
        id: "cat-1",
        slug: "snus",
        name: "Снюс",
        order: 0,
        productCount: 1,
        groups: [
          {
            id: "leaf-1",
            slug: "leaf-1",
            name: "Снюс DRYMOST 200MG",
            order: 0,
            productCount: 2,
            parentId: "brand-1",
            hasCoverImage: true,
            coverImage: null,
          },
          {
            id: "leaf-2",
            slug: "leaf-2",
            name: "Снюс GLITCH 200MG",
            order: 1,
            productCount: 1,
            parentId: "brand-2",
            hasCoverImage: true,
            coverImage: null,
          },
        ],
      },
    ];

    await store.loadGroupImages(["leaf-1", "leaf-2"]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(store.categories[0].groups[0].coverImage).toBe("data:image/png;base64,xyz");
    expect(store.categories[0].groups[1].coverImage).toBe("data:image/png;base64,xyz");
  });

  it("exposes direct cover URLs returned by the categories endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
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
    });
    vi.stubGlobal("fetch", fetchMock);

    const store = useCatalogStore();
    await store.fetchCategories();

    expect(store.getCategoryImage("cat-liquids")).toBe(
      "/api/categories/cat-liquids/cover",
    );
    expect(store.getGroupImage("line-rick")).toBe(
      "/api/category-groups/line-rick/cover",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("applies a direct category cover to products that use the category image", async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: string) => {
      if (input === "/api/categories") {
        return {
          ok: true,
          json: async () => ([
            {
              id: "cat-consumables",
              slug: "rashodniki",
              name: "Расходники",
              order: 0,
              productCount: 1,
              coverImage: "/api/categories/cat-consumables/cover",
              hasCoverImage: true,
              groups: [],
            },
          ]),
        };
      }

      return {
        ok: true,
        json: async () => ({
          products: [
            {
              id: "product-with-category-cover",
              title: "Испаритель",
              description: "",
              categoryId: "cat-consumables",
              needsCategoryImage: true,
              images: [],
            },
          ],
          total: 1,
          hasMore: false,
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const store = useCatalogStore();
    await store.fetchCategories();
    await store.fetchProducts();

    expect(store.products[0].images).toEqual([
      "/api/categories/cat-consumables/cover",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
