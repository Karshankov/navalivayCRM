import { describe, expect, it } from "vitest";
import {
  isReviewDockSuppressed,
  isReviewDockVisible,
} from "@/utils/reviewDockVisibility";

const activePrompt = {
  show: true,
  order_id: "ord-7615",
};

describe("reviewDockVisibility adversarial", () => {
  it("hides dock when prompt is incomplete or inactive", () => {
    expect(isReviewDockVisible({ path: "/" }, null)).toBe(false);
    expect(isReviewDockVisible({ path: "/" }, undefined)).toBe(false);
    expect(isReviewDockVisible({ path: "/" }, { show: false, order_id: "ord1" })).toBe(false);
    expect(isReviewDockVisible({ path: "/" }, { show: true })).toBe(false);
    expect(isReviewDockVisible({ path: "/" }, { show: true, order_id: "" })).toBe(false);
  });

  it("shows dock on catalog routes with a valid prompt", () => {
    expect(isReviewDockVisible({ path: "/category/salt", name: "category" }, activePrompt)).toBe(
      true,
    );
    expect(isReviewDockVisible({ path: "/wheel", name: "wheel" }, activePrompt)).toBe(true);
    expect(isReviewDockVisible({ path: "/profile", name: "profile" }, activePrompt)).toBe(true);
  });

  it("suppresses dock across order history path variants", () => {
    const suppressedPaths = [
      "/profile/orders",
      "/profile/orders/",
      "/profile/orders/ord-7615",
      "/profile/orders/ord-7615?rating=4",
    ];

    for (const path of suppressedPaths) {
      expect(isReviewDockSuppressed({ path }, activePrompt)).toBe(true);
      expect(isReviewDockVisible({ path }, activePrompt)).toBe(false);
    }
  });

  it("suppresses only the prompted order detail, not other orders", () => {
    const sameOrder = {
      path: "/profile/orders/ord-7615",
      name: "order-detail",
      params: { orderId: "ord-7615" },
    };
    const otherOrder = {
      path: "/profile/orders/ord-9999",
      name: "order-detail",
      params: { orderId: "ord-9999" },
    };

    expect(isReviewDockVisible(sameOrder, activePrompt)).toBe(false);
    expect(isReviewDockSuppressed(otherOrder, activePrompt)).toBe(true);
    expect(isReviewDockVisible(otherOrder, activePrompt)).toBe(false);
  });

  it("matches order ids across string and numeric param shapes", () => {
    const prompt = { show: true, order_id: 7615 };
    const numericRoute = { path: "/orders/7615", params: { orderId: 7615 } };
    const stringRoute = { path: "/orders/7615", params: { orderId: "7615" } };

    expect(isReviewDockSuppressed(numericRoute, prompt)).toBe(true);
    expect(isReviewDockSuppressed(stringRoute, prompt)).toBe(true);
  });

  it("does not suppress unrelated routes that merely contain order id text", () => {
    expect(
      isReviewDockVisible({ path: "/product/ord-7615-special" }, activePrompt),
    ).toBe(true);
    expect(
      isReviewDockSuppressed(
        { path: "/profile/orders-history" },
        activePrompt,
      ),
    ).toBe(false);
  });

  it("respects route name even when path looks innocent", () => {
    expect(
      isReviewDockSuppressed({ path: "/catalog", name: "order-history" }, activePrompt),
    ).toBe(true);
    expect(
      isReviewDockVisible({ path: "/catalog", name: "home" }, activePrompt),
    ).toBe(true);
  });
});