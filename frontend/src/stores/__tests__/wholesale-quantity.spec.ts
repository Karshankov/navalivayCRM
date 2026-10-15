import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useWholesaleStore, type WholesaleContext } from "@/stores/wholesale";

function quantityContext(overrides: Partial<WholesaleContext> = {}): WholesaleContext {
  return {
    code: "25",
    secret: "secret-25",
    label: "Опт от 25 позиций",
    minOrderAmount: 0,
    minQuantity: 25,
    effectiveMinQuantity: 25,
    minOverride: null,
    ...overrides,
  };
}

function stubFetch(handler: (url: string) => unknown) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const payload = handler(url);
    if (payload instanceof Error) throw payload;
    return {
      ok: true,
      json: async () => payload,
    } as Response;
  });
}

describe("wholesale store quantity minimum", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    sessionStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("normalizes a quantity context from a wholesale link payload", async () => {
    const fetchMock = stubFetch(() => ({
      wholesale_code: "25",
      wholesale_label: "Опт от 25 позиций",
      wholesale_min_amount: 0,
      wholesale_min_quantity: 25,
      wholesale_min_override: null,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const wholesaleStore = useWholesaleStore();
    const context = await wholesaleStore.activateFromLink("25", "secret-25");

    expect(context).toMatchObject({
      code: "25",
      secret: "secret-25",
      minQuantity: 25,
      effectiveMinQuantity: 25,
      minOverride: null,
    });
    expect(wholesaleStore.isWholesale).toBe(true);
    expect(wholesaleStore.effectiveMinQuantity).toBe(25);
  });

  it("rejects context without both a quantity and a legacy amount minimum", () => {
    const wholesaleStore = useWholesaleStore();
    wholesaleStore.clearContext();

    // Напрямую проверяем через applyOrderWholesaleContext: нет ни количества, ни суммы.
    const normalized = wholesaleStore.applyOrderWholesaleContext({
      code: "25",
      secret: "secret-25",
      label: "Опт от 25 позиций",
      minOrderAmount: 0,
      minQuantity: null,
    });

    expect(normalized).toBeNull();
    expect(wholesaleStore.isWholesale).toBe(false);
  });

  it("keeps legacy amount minimum working for old contexts", () => {
    const wholesaleStore = useWholesaleStore();
    wholesaleStore.clearContext();

    wholesaleStore.applyOrderWholesaleContext({
      code: "100",
      secret: "legacy-secret",
      label: "Опт от 100 BYN",
      minOrderAmount: 100,
      minQuantity: null,
    });

    expect(wholesaleStore.minQuantity).toBeNull();
    expect(wholesaleStore.remainingToMinimum(0, 40)).toBe(60);
    expect(wholesaleStore.meetsMinimum(0, 40)).toBe(false);
    expect(wholesaleStore.meetsMinimum(0, 100)).toBe(true);
  });

  it("counts the remaining units in quantity mode", () => {
    const wholesaleStore = useWholesaleStore();
    wholesaleStore.clearContext();
    wholesaleStore.applyOrderWholesaleContext({
      code: "25",
      secret: "secret-25",
      label: "Опт от 25 позиций",
      minQuantity: 25,
    });

    expect(wholesaleStore.remainingToMinimum(10, 0)).toBe(15);
    expect(wholesaleStore.remainingToMinimum(25, 0)).toBe(0);
    expect(wholesaleStore.remainingToMinimum(30, 0)).toBe(0);
    expect(wholesaleStore.meetsMinimum(24)).toBe(false);
    expect(wholesaleStore.meetsMinimum(25)).toBe(true);
  });

  it("applies a personal override and keeps the tier minimum visible", async () => {
    const wholesaleStore = useWholesaleStore();
    wholesaleStore.clearContext();

    const normalized = wholesaleStore.applyOrderWholesaleContext({
      code: "25",
      secret: "secret-25",
      label: "Опт от 25 позиций",
      minQuantity: 25,
    });
    expect(normalized).not.toBeNull();

    // Персональный минимум появляется через refreshEffectiveMinimum.
    const fetchMock = stubFetch(() => ({
      wholesale_min_quantity: 25,
      wholesale_min_override: 15,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const effective = await wholesaleStore.refreshEffectiveMinimum();
    expect(effective).toBe(15);

    expect(wholesaleStore.minOverride).toBe(15);
    expect(wholesaleStore.effectiveMinQuantity).toBe(15);
    expect(wholesaleStore.minQuantity).toBe(25);
    expect(wholesaleStore.remainingToMinimum(14, 0)).toBe(1);
    expect(wholesaleStore.meetsMinimum(15)).toBe(true);
    expect(wholesaleStore.meetsMinimum(14)).toBe(false);
    // Персональный минимум сохраняется в sessionStorage.
    expect(JSON.parse(sessionStorage.getItem("navalivay_wholesale_context") || "{}"))
      .toMatchObject({ minOverride: 15, effectiveMinQuantity: 15 });
  });

  it("clears the override back to the tier default on refresh", async () => {
    const wholesaleStore = useWholesaleStore();
    wholesaleStore.clearContext();
    wholesaleStore.applyOrderWholesaleContext({
      code: "25",
      secret: "secret-25",
      label: "Опт от 25 позиций",
      minQuantity: 25,
    });

    const fetchMock = stubFetch(() => ({
      wholesale_min_quantity: 25,
      wholesale_min_override: null,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const effective = await wholesaleStore.refreshEffectiveMinimum();

    expect(effective).toBe(25);
    expect(wholesaleStore.minOverride).toBeNull();
    expect(wholesaleStore.effectiveMinQuantity).toBe(25);
  });

  it("keeps the personal override when the active order context arrives for the same link", () => {
    const wholesaleStore = useWholesaleStore();
    wholesaleStore.clearContext();

    // Активный контекст с override (как после активации ссылки).
    wholesaleStore.applyOrderWholesaleContext({
      code: "25",
      secret: "secret-25",
      label: "Опт от 25 позиций",
      minQuantity: 25,
    });
    // Симулируем персональный минимум из активного контекста.
    const stored = quantityContext({ minOverride: 15, effectiveMinQuantity: 15 });
    wholesaleStore.context = stored;

    // Заказ с той же ссылкой: контекст заказа не знает про override — он сохраняется.
    const normalized = wholesaleStore.applyOrderWholesaleContext({
      code: "25",
      secret: "secret-25",
      label: "Опт от 25 позиций",
      minQuantity: 25,
    });

    expect(normalized?.minOverride).toBe(15);
    expect(normalized?.effectiveMinQuantity).toBe(15);
  });

  it("drops the personal override when the order uses another link", () => {
    const wholesaleStore = useWholesaleStore();
    wholesaleStore.clearContext();
    wholesaleStore.applyOrderWholesaleContext({
      code: "25",
      secret: "secret-25",
      label: "Опт от 25 позиций",
      minQuantity: 25,
    });
    wholesaleStore.context = quantityContext({ minOverride: 15, effectiveMinQuantity: 15 });

    const normalized = wholesaleStore.applyOrderWholesaleContext({
      code: "50",
      secret: "secret-50",
      label: "Опт от 50 позиций",
      minQuantity: 50,
    });

    expect(normalized?.minOverride).toBeNull();
    expect(normalized?.effectiveMinQuantity).toBe(50);
  });

  it("floors a non-integer personal override instead of failing the context", async () => {
    const wholesaleStore = useWholesaleStore();
    wholesaleStore.clearContext();

    const fetchMock = stubFetch(() => ({
      wholesale_code: "25",
      wholesale_label: "Опт от 25 позиций",
      wholesale_min_amount: 0,
      wholesale_min_quantity: 25,
      wholesale_min_override: 15.9,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const context = await wholesaleStore.activateFromLink("25", "secret-25");

    expect(context?.minOverride).toBe(15);
    expect(context?.effectiveMinQuantity).toBe(15);
    expect(wholesaleStore.remainingToMinimum(14, 0)).toBe(1);
  });
});
