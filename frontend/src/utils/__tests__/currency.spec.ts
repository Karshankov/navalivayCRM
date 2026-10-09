import { describe, expect, it } from "vitest";
import { formatBynCurrency } from "@/utils/currency";

describe("formatBynCurrency", () => {
  it("сохраняет копейки зарплаты и скрывает нулевые", () => {
    expect(formatBynCurrency(100.5)).toContain("100,5");
    expect(formatBynCurrency(100)).not.toContain(",00");
  });
});
