import { describe, expect, it } from "vitest";
import { formatReviewAverage } from "@/utils/formatReviewAverage";

describe("formatReviewAverage", () => {
  it("formats one-decimal averages", () => {
    expect(formatReviewAverage(4.83)).toBe("4.8");
    expect(formatReviewAverage(4.85)).toBe("4.9");
    expect(formatReviewAverage(4.86)).toBe("4.9");
  });

  it("drops trailing .0 for integers", () => {
    expect(formatReviewAverage(5)).toBe("5");
    expect(formatReviewAverage(4.0)).toBe("4");
  });

  it("returns em dash for missing values", () => {
    expect(formatReviewAverage(null)).toBe("—");
    expect(formatReviewAverage(undefined)).toBe("—");
  });

  describe("adversarial inputs", () => {
    it("rejects non-finite numbers", () => {
      expect(formatReviewAverage(Number.NaN)).toBe("—");
      expect(formatReviewAverage(Number.POSITIVE_INFINITY)).toBe("—");
      expect(formatReviewAverage(Number.NEGATIVE_INFINITY)).toBe("—");
    });

    it("formats edge ratings without throwing", () => {
      expect(formatReviewAverage(0)).toBe("0");
      expect(formatReviewAverage(-1)).toBe("-1");
      expect(formatReviewAverage(999.99)).toBe("1000");
    });
  });
});