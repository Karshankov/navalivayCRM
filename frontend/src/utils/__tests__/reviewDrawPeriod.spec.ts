import { describe, expect, it } from "vitest";
import {
  formatReviewDrawPeriodKey,
  getCurrentReviewDrawPeriodKey,
  getReviewDrawAutoScheduleLabel,
  getReviewDrawPeriodStartLabel,
} from "@/utils/reviewDrawPeriod";

describe("reviewDrawPeriod", () => {
  const june21Minsk = new Date("2026-06-21T12:00:00+03:00");

  it("uses Minsk calendar month for current period key", () => {
    expect(getCurrentReviewDrawPeriodKey(june21Minsk)).toBe("2026-06");
    expect(formatReviewDrawPeriodKey("2026-06")).toBe("Июнь 2026");
  });

  it("builds period start and auto schedule labels", () => {
    expect(getReviewDrawPeriodStartLabel(june21Minsk)).toContain("1");
    expect(getReviewDrawPeriodStartLabel(june21Minsk)).toContain("июн");
    expect(getReviewDrawAutoScheduleLabel(june21Minsk)).toContain("30");
    expect(getReviewDrawAutoScheduleLabel(june21Minsk)).toContain("21:00");
  });
});