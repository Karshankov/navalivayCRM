import { describe, expect, it } from "vitest";
import {
  isReviewDockSuppressed,
  isReviewDockVisible,
  isReviewPromptModalVisible,
} from "@/utils/reviewDockVisibility";

const activePrompt = {
  show: true,
  order_id: "ord1",
};

describe("reviewDockVisibility", () => {
  it("shows dock on catalog routes when prompt is active", () => {
    expect(
      isReviewDockVisible({ path: "/", name: "home" }, activePrompt),
    ).toBe(true);
    expect(
      isReviewDockVisible({ path: "/profile", name: "profile" }, activePrompt),
    ).toBe(true);
  });

  it("suppresses dock in order history and order detail flows", () => {
    expect(
      isReviewDockSuppressed(
        { path: "/profile/orders", name: "order-history" },
        activePrompt,
      ),
    ).toBe(true);
    expect(
      isReviewDockSuppressed(
        {
          path: "/profile/orders/ord1",
          name: "order-detail",
          params: { orderId: "ord1" },
        },
        activePrompt,
      ),
    ).toBe(true);
    expect(
      isReviewDockVisible(
        {
          path: "/profile/orders/ord1",
          name: "order-detail",
          params: { orderId: "ord1" },
        },
        activePrompt,
      ),
    ).toBe(false);
  });

  it("suppresses dock when route order matches prompted order", () => {
    expect(
      isReviewDockSuppressed(
        { path: "/orders/ord1", params: { orderId: "ord1" } },
        activePrompt,
      ),
    ).toBe(true);
  });

  it("hides dock when prompt is inactive", () => {
    expect(
      isReviewDockVisible({ path: "/", name: "home" }, { show: false }),
    ).toBe(false);
    expect(
      isReviewDockVisible({ path: "/", name: "home" }, { show: true }),
    ).toBe(false);
  });

  it("shows review prompt modal only on home when prompt is active", () => {
    expect(
      isReviewPromptModalVisible({ path: "/", name: "home" }, activePrompt),
    ).toBe(true);
    expect(
      isReviewPromptModalVisible({ path: "/profile", name: "profile" }, activePrompt),
    ).toBe(false);
  });

  it("hides review prompt modal when dismissed", () => {
    expect(
      isReviewPromptModalVisible(
        { path: "/", name: "home" },
        activePrompt,
        { dismissed: true },
      ),
    ).toBe(false);
  });
});