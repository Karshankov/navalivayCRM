import { describe, expect, it } from "vitest";
import {
  buildReviewDockIncentiveLine,
  buildReviewDockMetaLine,
  buildReviewDockTitle,
} from "@/utils/reviewDockCopy";

describe("reviewDockCopy adversarial", () => {
  it("never returns empty titles", () => {
    expect(buildReviewDockTitle(null)).toBe("Ваш заказ");
    expect(buildReviewDockTitle(undefined)).toBe("Ваш заказ");
    expect(buildReviewDockTitle("   \n\t")).toBe("Ваш заказ");
  });

  it("keeps unexpected but safe group names verbatim", () => {
    expect(buildReviewDockTitle("<script>alert(1)</script>")).toBe("<script>alert(1)</script>");
    expect(buildReviewDockTitle("🔥 PODONKI 🔥")).toBe("🔥 PODONKI 🔥");
  });

  it("clamps invalid pending counts to at least one", () => {
    expect(buildReviewDockMetaLine({ pending_review_count: 0 })).toContain("Ваш заказ ·");
    expect(buildReviewDockMetaLine({ pending_review_count: -4 })).toContain("Ваш заказ ·");
    expect(buildReviewDockMetaLine({ pending_review_count: Number.NaN })).toContain("Ваш заказ ·");
  });

  it("uses correct russian plural forms for pending lines", () => {
    expect(buildReviewDockMetaLine({ order_number: 1, pending_review_count: 2 })).toBe(
      "Заказ №1 · ещё 2 линейки без отзыва",
    );
    expect(buildReviewDockMetaLine({ order_number: 1, pending_review_count: 3 })).toBe(
      "Заказ №1 · ещё 3 линейки без отзыва",
    );
    expect(buildReviewDockMetaLine({ order_number: 1, pending_review_count: 5 })).toBe(
      "Заказ №1 · ещё 5 линеек без отзыва",
    );
    expect(buildReviewDockMetaLine({ order_number: 1, pending_review_count: 11 })).toBe(
      "Заказ №1 · ещё 11 линеек без отзыва",
    );
  });

  it("shortens long lottery hints without gift count", () => {
    const longHint =
      "В конце месяца мы разыгрываем подарки среди всех покупателей, оставивших честный отзыв";
    expect(buildReviewDockMetaLine({ lottery_hint_text: longHint })).toBe(
      "Ваш заказ · Розыгрыш подарков в конце месяца",
    );
  });

  it("keeps short custom lottery hints intact", () => {
    expect(buildReviewDockMetaLine({ lottery_hint_text: "Участвуйте в розыгрыше" })).toBe(
      "Ваш заказ · Участвуйте в розыгрыше",
    );
  });

  it("prefers variant incentive and ignores noisy whitespace", () => {
    expect(
      buildReviewDockIncentiveLine({
        purchased_variant_name: "  Ананасовая шипучка  ",
        lottery_hint_text: "5 подарков",
      }),
    ).toBe("Ананасовая шипучка");

    expect(buildReviewDockIncentiveLine({ purchased_variant_name: "   " })).toBe(
      "5 подарков в конце месяца",
    );
  });

  it("extracts gift count case-insensitively", () => {
    expect(
      buildReviewDockMetaLine({ lottery_hint_text: "Разыгрываем 12 ПОДАРКОВ в июне" }),
    ).toBe("Ваш заказ · 12 подарков в конце месяца");
  });
});