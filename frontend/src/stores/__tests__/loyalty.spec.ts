import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useLoyaltyStore, type LoyaltyPreviewCategory } from "@/stores/loyalty";

function response(categories: LoyaltyPreviewCategory[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ categories, total_loyalty_discount: 0 }),
  };
}

function previewCategory(productId: string): LoyaltyPreviewCategory {
  return {
    category_id: "loyalty-devices",
    category_key: "devices",
    title: "Устройства",
    description: null,
    threshold: 4,
    discount_amount: 25,
    current_balance: 4,
    current_available_bonus_count: 1,
    items_in_cart: 1,
    eligible_purchase_units: 1,
    loyalty_units_applied: 0,
    spent_now: 0,
    earned_after_fulfillment: 1,
    projected_balance: 5,
    available_bonus_count: 1,
    remaining_to_next: 3,
    line_items: [
      {
        key: `${productId}::`,
        product_id: productId,
        variant_id: null,
        quantity: 1,
        loyalty_units_applied: 0,
        max_redeemable_units: 1,
        product_title: productId,
      },
    ],
  };
}

describe("loyalty checkout preview", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  it("keeps the newest preview when responses arrive out of order", async () => {
    let resolveOld!: (value: ReturnType<typeof response>) => void;
    let resolveNew!: (value: ReturnType<typeof response>) => void;
    const oldResponse = new Promise<ReturnType<typeof response>>((resolve) => {
      resolveOld = resolve;
    });
    const newResponse = new Promise<ReturnType<typeof response>>((resolve) => {
      resolveNew = resolve;
    });

    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(oldResponse).mockReturnValueOnce(newResponse));

    const store = useLoyaltyStore();
    const oldRequest = store.fetchCheckoutPreview({
      items: [{ product_id: "removed-product", quantity: 1, price_per_unit: 10 }],
    });
    const newRequest = store.fetchCheckoutPreview({
      items: [{ product_id: "current-product", quantity: 1, price_per_unit: 10 }],
    });

    resolveNew(response([previewCategory("current-product")]));
    await newRequest;
    expect(store.previewCategories[0].line_items[0].product_id).toBe("current-product");
    expect(store.loadingPreview).toBe(false);

    resolveOld(response([previewCategory("removed-product")]));
    await oldRequest;
    expect(store.previewCategories[0].line_items[0].product_id).toBe("current-product");
  });

  it("clears loading when preview is reset during an active request", async () => {
    let resolveRequest!: (value: ReturnType<typeof response>) => void;
    const pendingResponse = new Promise<ReturnType<typeof response>>((resolve) => {
      resolveRequest = resolve;
    });
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(pendingResponse));

    const store = useLoyaltyStore();
    const request = store.fetchCheckoutPreview({
      items: [{ product_id: "removed-product", quantity: 1, price_per_unit: 10 }],
    });
    expect(store.loadingPreview).toBe(true);

    store.resetPreview();
    expect(store.loadingPreview).toBe(false);
    expect(store.previewCategories).toEqual([]);

    resolveRequest(response([previewCategory("removed-product")]));
    await request;
    expect(store.loadingPreview).toBe(false);
    expect(store.previewCategories).toEqual([]);
  });
});
