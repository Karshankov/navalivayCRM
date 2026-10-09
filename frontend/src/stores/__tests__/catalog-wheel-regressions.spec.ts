import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const syncItemPricesFromCatalogMock = vi.fn();
let wholesaleHeaders: Record<string, string> = {};

vi.mock("@/stores/cart", () => ({
  useCartStore: () => ({
    syncItemPricesFromCatalog: syncItemPricesFromCatalogMock,
  }),
}));

vi.mock("@/stores/wholesale", () => ({
  useWholesaleStore: () => ({
    isWholesale: false,
    buildHeaders: () => wholesaleHeaders,
  }),
}));

import { useCatalogStore } from "@/stores/catalog";

function createJsonResponse(data: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    headers: {
      get: () => "application/json",
    },
    json: async () => data,
  };
}

function deferredResponse() {
  let resolve!: (value: ReturnType<typeof createJsonResponse>) => void;
  const promise = new Promise<ReturnType<typeof createJsonResponse>>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("catalog store fetchAllProducts regressions", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
    syncItemPricesFromCatalogMock.mockReset();
    wholesaleHeaders = {};
  });

  it("deduplicates concurrent retail fetchAllProducts calls", async () => {
    const pending = deferredResponse();
    const fetchMock = vi.fn(() => pending.promise);
    vi.stubGlobal("fetch", fetchMock);

    const store = useCatalogStore();
    const first = store.fetchAllProducts();
    const second = store.fetchAllProducts();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    pending.resolve(
      createJsonResponse({
        products: [
          {
            id: "product-1",
            title: "Cherry",
            description: "desc",
            categoryId: "cat-1",
            images: [],
          },
        ],
      }),
    );

    await Promise.all([first, second]);

    expect(store.allProducts).toHaveLength(1);
    expect(store.allProducts[0].id).toBe("product-1");
    expect(syncItemPricesFromCatalogMock).toHaveBeenCalledTimes(1);
  });

  it("drops a stale response when a forced refresh starts after it", async () => {
    const firstPending = deferredResponse();
    const secondPending = deferredResponse();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => firstPending.promise)
      .mockImplementationOnce(() => secondPending.promise);
    vi.stubGlobal("fetch", fetchMock);

    const store = useCatalogStore();
    const staleRequest = store.fetchAllProducts();
    const freshRequest = store.fetchAllProducts({ force: true });

    secondPending.resolve(
      createJsonResponse({
        products: [
          {
            id: "fresh-product",
            title: "Fresh",
            description: "desc",
            categoryId: "cat-1",
            images: [],
          },
        ],
      }),
    );

    firstPending.resolve(
      createJsonResponse({
        products: [
          {
            id: "stale-product",
            title: "Stale",
            description: "desc",
            categoryId: "cat-1",
            images: [],
          },
        ],
      }),
    );

    await Promise.all([staleRequest, freshRequest]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(store.allProducts).toHaveLength(1);
    expect(store.allProducts[0].id).toBe("fresh-product");
  });
});
