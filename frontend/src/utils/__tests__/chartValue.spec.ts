import { describe, expect, it } from "vitest";
import { formatChartValueCompact } from "@/utils/chartValue";

describe("подпись над столбиком графика", () => {
  it("не показывает хвост после запятой", () => {
    // Ровно то, что печаталось на дашборде до починки.
    expect(formatChartValueCompact(1275.5360149761204)).not.toContain(".");
    expect(formatChartValueCompact(1275.5360149761204).replace(/\s/g, "")).toBe("1276");
  });

  it("разделяет тысячи, чтобы подписи читались", () => {
    expect(formatChartValueCompact(55853).replace(/\s/g, "")).toBe("55853");
    expect(formatChartValueCompact(55853)).not.toBe("55853");
  });

  it("переживает ноль и мусор", () => {
    expect(formatChartValueCompact(0)).toBe("0");
    expect(formatChartValueCompact(Number.NaN)).toBe("0");
  });
});
