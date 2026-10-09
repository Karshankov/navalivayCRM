import { describe, expect, it } from "vitest";
import {
  businessDateTimeInputToIso,
  formatBusinessDateTimeInput,
  formatBusinessPeriodLabel,
  formatBusinessPeriodTitle,
  getBusinessMonthValue,
  getBusinessYear,
} from "@/utils/businessTime";

describe("businessTime", () => {
  it("formats the current business day in Minsk instead of local browser time", () => {
    const referenceDate = new Date("2026-03-25T21:30:00.000Z");

    expect(formatBusinessPeriodLabel("today", 0, referenceDate)).toContain("26 марта 2026");
    expect(formatBusinessPeriodLabel("today", 0, referenceDate)).not.toContain("25 марта 2026");
  });

  it("shifts daily labels by offset using Minsk calendar days", () => {
    const referenceDate = new Date("2026-03-25T21:30:00.000Z");

    expect(formatBusinessPeriodLabel("today", -1, referenceDate)).toContain("25 марта 2026");
  });

  it("uses the Minsk year on the UTC year boundary", () => {
    const referenceDate = new Date("2025-12-31T22:30:00.000Z");

    expect(getBusinessYear(referenceDate)).toBe(2026);
    expect(formatBusinessPeriodLabel("month", 0, referenceDate)).toContain("2026");
    expect(formatBusinessPeriodLabel("month", 0, referenceDate).toLowerCase()).toContain("январ");
    expect(formatBusinessPeriodTitle("year", 0, referenceDate)).toBe("2026 год");
  });

  it("uses the Minsk month on the UTC month boundary", () => {
    expect(getBusinessMonthValue(new Date("2026-07-31T22:30:00.000Z"))).toBe(
      "2026-08",
    );
  });

  it("converts shift form values strictly in Europe/Minsk", () => {
    expect(
      formatBusinessDateTimeInput("2026-07-23T07:00:00.000Z"),
    ).toBe("2026-07-23T10:00");
    expect(businessDateTimeInputToIso("2026-07-23T21:15")).toBe(
      "2026-07-23T18:15:00.000Z",
    );
  });
});
