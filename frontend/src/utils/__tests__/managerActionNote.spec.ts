import { describe, expect, it } from "vitest";
import { parseManagerActionNote } from "@/utils/managerActionNote";

describe("parseManagerActionNote", () => {
  it("groups added and removed items with quantity labels", () => {
    const summary = parseManagerActionNote(
      "добавлено: Испарители Boost/Hero 0.2 Ω [50-58W] x1; добавлено: Испарители Boost/Hero 0.3 Ω [30-38W] x2; убрано: Классическая кола со льдом x1",
    );

    expect(summary.hasStructuredContent).toBe(true);
    expect(summary.added).toEqual([
      {
        label: "Испарители Boost/Hero 0.2 Ω [50-58W]",
        quantityLabel: "1 шт.",
        raw: "Испарители Boost/Hero 0.2 Ω [50-58W] x1",
      },
      {
        label: "Испарители Boost/Hero 0.3 Ω [30-38W]",
        quantityLabel: "2 шт.",
        raw: "Испарители Boost/Hero 0.3 Ω [30-38W] x2",
      },
    ]);
    expect(summary.removed).toEqual([
      {
        label: "Классическая кола со льдом",
        quantityLabel: "1 шт.",
        raw: "Классическая кола со льдом x1",
      },
    ]);
  });

  it("parses quantity changes and promo code updates", () => {
    const summary = parseManagerActionNote(
      "количество: Liquid Cherry 1→2; промокод: SAVE10",
    );

    expect(summary.hasStructuredContent).toBe(true);
    expect(summary.changed).toEqual([
      {
        label: "Liquid Cherry",
        quantityLabel: "1 шт. -> 2 шт.",
        raw: "Liquid Cherry 1→2",
      },
    ]);
    expect(summary.promo).toEqual([
      {
        label: "Применен: SAVE10",
        raw: "промокод: SAVE10",
      },
    ]);
  });

  it("keeps plain notes as fallback text", () => {
    const summary = parseManagerActionNote("Клиент обновил заказ");

    expect(summary.hasStructuredContent).toBe(false);
    expect(summary.info).toEqual(["Клиент обновил заказ"]);
  });
});
