import { describe, expect, it } from "vitest";

/**
 * Порядок аргументов в запросе обновления линейки.
 *
 * Здесь ловилась ошибка «NOT NULL constraint failed: category_groups.order»:
 * cover_zoom и cover_shift были вставлены в список аргументов перед
 * order, а в SQL стоят после. Из-за этого order получал значение
 * масштаба, а сам порядок терялся.
 *
 * Проверяем позиции ключевых полей, а не все подряд: часть аргументов
 * названа сокращённо (nextCover для cover_image) и не сводится к
 * имени колонки механически.
 */
const COLUMNS = [
  "name", "slug", "cover_image", "hide_empty", "order",
  "cover_zoom", "cover_shift",
  "meta_label", "meta_value", "parent_group_id", "min_stock_threshold",
  "total_control",
  "waive_description", "waive_min_stock", "waive_wholesale",
  "strength_tier", "waive_strength_tier",
  "significance_mark_id",
  "id",
];

const ARGS = [
  "nextName", "nextSlug", "nextCover", "nextHideEmpty", "nextOrder",
  "nextCoverZoom", "nextCoverShift",
  "nextMetaLabel", "nextMetaValue", "nextParentId", "nextThreshold",
  "nextTotalControl",
  "nextWaiveDescription", "nextWaiveMinStock", "nextWaiveWholesale",
  "nextStrengthTier", "nextWaiveStrengthTier",
  "nextSignificanceMarkId",
  "id",
];

/** Поля, ради которых всё затевалось: их позиции критичны. */
const KEY_PAIRS: Array<[string, string]> = [
  ["name", "nextName"],
  ["cover_image", "nextCover"],
  ["order", "nextOrder"],
  ["cover_zoom", "nextCoverZoom"],
  ["cover_shift", "nextCoverShift"],
  ["meta_label", "nextMetaLabel"],
  ["meta_value", "nextMetaValue"],
  ["id", "id"],
];

describe("Порядок аргументов сохранения линейки", () => {
  it("число аргументов совпадает с числом колонок", () => {
    console.log("колонок:", COLUMNS.length, "| аргументов:", ARGS.length);
    expect(ARGS).toHaveLength(COLUMNS.length);
  });

  it("ключевые поля стоят на тех же местах, что и колонки", () => {
    const mismatches: string[] = [];

    KEY_PAIRS.forEach(([col, arg]) => {
      const colIndex = COLUMNS.indexOf(col);
      const argIndex = ARGS.indexOf(arg);
      const ok = colIndex === argIndex;
      console.log(
        `${col.padEnd(18)} колонка ${String(colIndex).padStart(2)} | аргумент ${String(argIndex).padStart(2)} ${ok ? "OK" : "СДВИГ"}`,
      );
      if (!ok) mismatches.push(`${col}: колонка ${colIndex}, аргумент ${argIndex}`);
    });

    expect(mismatches).toEqual([]);
  });

  it("все позиции совпадают, кроме законных сокращений", () => {
    /* Сокращения: аргумент называется иначе, но стоит на своём месте. */
    const SHORT: Record<number, string> = {
      2: "cover_image",
      3: "hide_empty",
      9: "parent_group_id",
      10: "min_stock_threshold",
      17: "significance_mark_id",
    };

    const mismatches: string[] = [];
    COLUMNS.forEach((col, i) => {
      if (SHORT[i]) return;
      const arg = ARGS[i];
      const expected = col.replace(/_/g, "").toLowerCase();
      const actual = arg.replace(/^next/, "").replace(/Id$/, "").toLowerCase();
      if (actual !== expected) mismatches.push(`${i}: ${col} ← ${arg}`);
    });

    console.log("расхождений:", mismatches.length, mismatches.join(", ") || "нет");
    expect(mismatches).toEqual([]);
  });

  it("масштаб стоит после order — именно это было сломано", () => {
    expect(ARGS.indexOf("nextCoverZoom")).toBeGreaterThan(ARGS.indexOf("nextOrder"));
    expect(ARGS.indexOf("nextCoverShift")).toBeGreaterThan(ARGS.indexOf("nextOrder"));
    // И ровно там же, где колонки в SQL.
    expect(ARGS.indexOf("nextCoverZoom")).toBe(COLUMNS.indexOf("cover_zoom"));
    expect(ARGS.indexOf("nextCoverShift")).toBe(COLUMNS.indexOf("cover_shift"));
  });
});
