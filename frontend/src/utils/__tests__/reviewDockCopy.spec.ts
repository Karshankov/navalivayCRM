import { describe, expect, it } from "vitest";
import {
  buildReviewDockIncentiveLine,
  buildReviewDockMetaLine,
  buildReviewDockTitle,
} from "@/utils/reviewDockCopy";

describe("reviewDockCopy", () => {
  it("builds title fallback", () => {
    expect(buildReviewDockTitle("PODONKI")).toBe("PODONKI");
    expect(buildReviewDockTitle("  ")).toBe("Ваш заказ");
  });

  it("builds meta for single and multiple pending lines", () => {
    expect(buildReviewDockMetaLine({
      order_number: 7615,
      pending_review_count: 1,
      lottery_hint_text: "В конце месяца разыгрываем 5 подарков",
    })).toBe("Заказ №7615 · 5 подарков в конце месяца");
    expect(buildReviewDockMetaLine({ order_number: 7615, pending_review_count: 4 }))
      .toBe("Заказ №7615 · ещё 4 линейки без отзыва");
  });

  it("prefers variant and short lottery incentive", () => {
    expect(buildReviewDockIncentiveLine({
      purchased_variant_name: "Ананасовая шипучка",
      lottery_hint_text: "В конце месяца разыгрываем 5 подарков среди оставивших отзывы",
    })).toBe("Ананасовая шипучка");

    expect(buildReviewDockIncentiveLine({
      lottery_hint_text: "В конце месяца разыгрываем 5 подарков среди оставивших отзывы",
    })).toBe("5 подарков в конце месяца");
  });
});