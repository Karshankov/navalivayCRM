import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useCatalogStore, type Banner, type Category, type Product } from "@/stores/catalog";

/**
 * Кэш каталога в localStorage: повторное открытие мини-аппа не тянет каталог
 * по сети, если ревизия витрины (`/api/catalog/version`) не изменилась.
 */

const CATALOG_URLS = ["/api/categories", "/api/products", "/api/banners"] as const;

function makeCategory(): Category {
  return {
    id: "cat-1",
    slug: "snus",
    name: "Снюс",
    order: 0,
    productCount: 1,
    groups: [],
  };
}

function makeProduct(): Product {
  return {
    id: "p-1",
    categoryId: "cat-1",
    title: "Liquid Cherry",
    priceRub: 15,
    description: "",
    images: [],
    createdAt: "2026-01-01 00:00:00",
  };
}

function makeBanner(): Banner {
  return {
    id: "b-1",
    image: "/uploads/x.jpg",
    href: null,
    active: 1,
    order: 0,
  };
}

type FetchHandler = (url: string) => Response | Promise<Response>;

function jsonResponse(payload: unknown, ok = true): Response {
  return {
    ok,
    json: async () => payload,
  } as Response;
}

/** Мок fetch, считающий вызовы по URL, с маршрутизацией по handler. */
function stubFetch(handler: FetchHandler) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    calls.push(url);
    return handler(url);
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

/** Полный каталог из одного товара — ответ всех каталоговых эндпоинтов. */
function fullCatalogHandler(revision: string): FetchHandler {
  return (url) => {
    if (url === "/api/catalog/version") {
      return jsonResponse({ revision, generatedAt: "2026-01-01T00:00:00.000Z" });
    }
    if (url === "/api/categories") {
      return jsonResponse([makeCategory()]);
    }
    if (url.startsWith("/api/products")) {
      return jsonResponse({ products: [makeProduct()], total: 1, hasMore: false });
    }
    if (url === "/api/banners") {
      return jsonResponse([makeBanner()]);
    }
    return jsonResponse({ ok: true });
  };
}

const CACHE_KEY = "navalivay_catalog_v1:__retail__";

function readCache(): any {
  return JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
}

function writeCache(payload: Record<string, unknown>) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
}

describe("catalog store localStorage cache", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("первое открытие без кэша: грузит каталог и записывает кэш с ревизией", async () => {
    const calls = stubFetch(fullCatalogHandler("rev-1"));

    const store = useCatalogStore();
    await store.initialize();

    expect(store.categories.length).toBe(1);
    expect(store.allProducts.length).toBe(1);
    expect(store.banners.length).toBe(1);
    expect(store.offline).toBe(false);

    const cache = readCache();
    expect(cache).not.toBeNull();
    expect(cache.revision).toBe("rev-1");
    expect(cache.categories.length).toBe(1);
    expect(cache.allProducts.length).toBe(1);

    // Полная загрузка: категории, товары (пагинация + все), баннеры, версия.
    expect(calls).toContain("/api/catalog/version");
    expect(calls).toContain("/api/categories");
    expect(calls.some((url) => url.startsWith("/api/products"))).toBe(true);
    expect(calls).toContain("/api/banners");
  });

  it("повторное открытие с той же ревизией: каталоговые запросы не выполняются", async () => {
    writeCache({
      revision: "rev-1",
      savedAt: Date.now(),
      categories: [makeCategory()],
      allProducts: [makeProduct()],
      banners: [makeBanner()],
    });
    const calls = stubFetch(fullCatalogHandler("rev-1"));

    const store = useCatalogStore();
    await store.initialize();

    // Единственный сетевой запрос — проверка ревизии.
    expect(calls).toEqual(["/api/catalog/version"]);

    // Данные гидрированы из кэша мгновенно.
    expect(store.categories.length).toBe(1);
    expect(store.allProducts[0]?.id).toBe("p-1");
    expect(store.banners.length).toBe(1);
    expect(store.products.length).toBe(1);
    expect(store.offline).toBe(false);
  });

  it("ревизия изменилась: каталог перезагружается и кэш перезаписывается", async () => {
    writeCache({
      revision: "rev-old",
      savedAt: Date.now(),
      categories: [makeCategory()],
      allProducts: [makeProduct()],
      banners: [makeBanner()],
    });
    const calls = stubFetch(fullCatalogHandler("rev-new"));

    const store = useCatalogStore();
    await store.initialize();

    expect(calls).toContain("/api/catalog/version");
    expect(calls).toContain("/api/categories");
    expect(calls.some((url) => url.startsWith("/api/products"))).toBe(true);
    expect(calls).toContain("/api/banners");

    const cache = readCache();
    expect(cache.revision).toBe("rev-new");
  });

  it("битый кэш игнорируется: полная загрузка как при первом открытии", async () => {
    localStorage.setItem(CACHE_KEY, "{ это не JSON");
    const calls = stubFetch(fullCatalogHandler("rev-1"));

    const store = useCatalogStore();
    await store.initialize();

    expect(store.categories.length).toBe(1);
    expect(calls).toContain("/api/catalog/version");
    expect(calls).toContain("/api/categories");
    // Кэш перезаписан валидной записью.
    expect(readCache().revision).toBe("rev-1");
  });

  it("кэш с неверной структурой (без массивов) игнорируется", async () => {
    writeCache({ revision: "rev-1", savedAt: 1, categories: null, allProducts: "no", banners: 3 });
    const calls = stubFetch(fullCatalogHandler("rev-1"));

    const store = useCatalogStore();
    await store.initialize();

    expect(calls).toContain("/api/categories");
    expect(store.categories.length).toBe(1);
  });

  it("сервер недоступен, но кэш есть: каталог показывается, оффлайн-заглушка не включается", async () => {
    writeCache({
      revision: "rev-1",
      savedAt: Date.now(),
      categories: [makeCategory()],
      allProducts: [makeProduct()],
      banners: [makeBanner()],
    });
    const calls = stubFetch(() => {
      throw new TypeError("network down");
    });

    const store = useCatalogStore();
    await store.initialize();

    expect(calls).toEqual(["/api/catalog/version"]);
    expect(store.offline).toBe(false);
    expect(store.categories.length).toBe(1);
    expect(store.allProducts[0]?.id).toBe("p-1");
  });

  it("quota-ошибка при записи кэша не ломает инициализацию", async () => {
    const realSetItem = localStorage.setItem.bind(localStorage);
    const setItemMock = vi.fn((key: string, value: string) => {
      if (key.startsWith("navalivay_catalog_v")) {
        throw new DOMException("QuotaExceededError", "QuotaExceededError");
      }
      return realSetItem(key, value);
    });
    Object.defineProperty(localStorage, "setItem", { value: setItemMock, configurable: true });

    try {
      const calls = stubFetch(fullCatalogHandler("rev-1"));

      const store = useCatalogStore();
      await store.initialize();

      expect(store.offline).toBe(false);
      expect(store.categories.length).toBe(1);
      expect(calls).toContain("/api/categories");
    } finally {
      Object.defineProperty(localStorage, "setItem", { value: realSetItem, configurable: true });
    }
  });

  it("чужие wholesale-ключи кэша чистятся при записи, розничный сохраняется", async () => {
    const staleKey = "navalivay_catalog_v1:opt1:secret1";
    localStorage.setItem(staleKey, JSON.stringify({ revision: "x", savedAt: 1, categories: [], allProducts: [], banners: [] }));
    stubFetch(fullCatalogHandler("rev-1"));

    const store = useCatalogStore();
    await store.initialize();

    expect(localStorage.getItem(staleKey)).toBeNull();
    expect(localStorage.getItem(CACHE_KEY)).not.toBeNull();
  });
});
