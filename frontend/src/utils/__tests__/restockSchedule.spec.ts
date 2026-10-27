import { describe, expect, it } from "vitest";
import {
  RESTOCK_REFRESH_HOUR,
  msUntilNextRestockRefresh,
} from "@/utils/restockSchedule";

/**
 * Значок пополнения пересчитывается раз в сутки в 9:00 по Минску, поэтому
 * планировщик обязан считать задержку до ближайших 9:00, а не «через 24 часа».
 */
describe("restockSchedule", () => {
  it("считает часом пересчёта 9 утра", () => {
    expect(RESTOCK_REFRESH_HOUR).toBe(9);
  });

  it("до 9:00 ждёт наступления этого же утра", () => {
    // 06:00 по Минску = 03:00 UTC.
    const now = new Date("2026-05-12T03:00:00Z");
    // До 09:00 местного остаётся 3 часа.
    expect(msUntilNextRestockRefresh(now)).toBe(3 * 60 * 60 * 1000);
  });

  it("после 9:00 ждёт следующего утра", () => {
    // 12:00 по Минску = 09:00 UTC.
    const now = new Date("2026-05-12T09:00:00Z");
    // До 09:00 следующего дня — 21 час.
    expect(msUntilNextRestockRefresh(now)).toBe(21 * 60 * 60 * 1000);
  });

  it("ровно в 9:00 переносит пересчёт на завтра, а не запускает немедленно", () => {
    const now = new Date("2026-05-12T06:00:00Z"); // 09:00 Минск
    const delay = msUntilNextRestockRefresh(now);
    expect(delay).toBe(24 * 60 * 60 * 1000);
  });

  it("никогда не возвращает нулевую или отрицательную задержку", () => {
    for (const iso of [
      "2026-01-01T00:00:00Z",
      "2026-05-12T05:59:59Z",
      "2026-05-12T06:00:01Z",
      "2026-12-31T23:59:59Z",
    ]) {
      expect(msUntilNextRestockRefresh(new Date(iso))).toBeGreaterThan(0);
    }
  });

  it("учитывает переход на летнее время, а не фиксированный сдвиг", () => {
    // В январе Минск живёт в UTC+3, в июле — тоже UTC+3 (переход отменён),
    // поэтому проверяем устойчивость к поясу через явную передачу зоны.
    const now = new Date("2026-01-15T00:00:00Z");
    const minsk = msUntilNextRestockRefresh(now, "Europe/Minsk");
    const utc = msUntilNextRestockRefresh(now, "UTC");
    // В UTC сейчас 00:00 — до 9:00 девять часов; в Минске 03:00 — шесть часов.
    expect(utc).toBe(9 * 60 * 60 * 1000);
    expect(minsk).toBe(6 * 60 * 60 * 1000);
  });
});