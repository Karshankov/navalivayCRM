import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useAdminStore } from "@/stores/admin";
import { $fetch } from "@/utils/http";

vi.mock("@/utils/http", () => ({
  $fetch: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function productsResponse(id: string, title: string) {
  return {
    products: [
      {
        id,
        categoryId: "cat-hookah",
        title,
        priceRub: 10,
        description: "",
        images: [],
        createdAt: "2026-06-04 15:00:00",
      },
    ],
    pagination: {
      page: 1,
      limit: 10,
      total: 1,
      totalPages: 1,
    },
  };
}

describe("admin products search regressions", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked($fetch).mockReset();
  });

  it("keeps the latest product search response when an older request resolves last", async () => {
    const first = deferred<ReturnType<typeof productsResponse>>();
    const second = deferred<ReturnType<typeof productsResponse>>();
    vi.mocked($fetch)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const store = useAdminStore();
    store.token = "token";

    const staleRequest = store.fetchProducts({ search: "пер" });
    const latestRequest = store.fetchProducts({ search: "персик" });

    second.resolve(productsResponse("latest", "Персик"));
    await latestRequest;
    expect(store.products.map((product) => product.id)).toEqual(["latest"]);

    first.resolve(productsResponse("stale", "Перо"));
    await staleRequest;
    expect(store.products.map((product) => product.id)).toEqual(["latest"]);
  });

  it("does not let a stale failed request overwrite the latest successful search", async () => {
    const first = deferred<ReturnType<typeof productsResponse>>();
    const second = deferred<ReturnType<typeof productsResponse>>();
    vi.mocked($fetch)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const store = useAdminStore();
    store.token = "token";

    const staleRequest = store.fetchProducts({ search: "lit" });
    const latestRequest = store.fetchProducts({ search: "lit energy" });

    second.resolve(productsResponse("lit-energy", "Lit Energy Peach"));
    await latestRequest;

    first.reject(new Error("stale network error"));
    await staleRequest;

    expect(store.error).toBeNull();
    expect(store.products.map((product) => product.id)).toEqual(["lit-energy"]);
    expect(store.isLoading).toBe(false);
  });
});
