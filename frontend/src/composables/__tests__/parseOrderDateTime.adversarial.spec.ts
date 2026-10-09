import { describe, expect, it } from "vitest";
import {
  buildFulfillmentTimelineLines,
  formatOrderDate,
  formatOrderDateTime,
  formatOrderHistoryMeta,
  parseOrderDateTime,
} from "@/composables/useCustomerOrders";

const MINSK = "Europe/Minsk";

function formatMinskHourMinute(isoUtc: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: MINSK,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoUtc));
}

function sqliteUtcToMinskLabel(sqliteUtc: string): string {
  const iso = `${sqliteUtc.trim().replace(" ", "T")}Z`;
  return formatMinskHourMinute(iso);
}

describe("parseOrderDateTime adversarial", () => {
  it("regression: Konstantin 21:41 Minsk order must not show 18:41", () => {
    // 21:41 Minsk = 18:41 UTC stored as bare SQLite
    const sqliteUtc = "2026-06-24 18:41:00";
    expect(sqliteUtcToMinskLabel(sqliteUtc)).toBe("21:41");
    expect(formatOrderDateTime(sqliteUtc)).toContain("21:41");
    expect(formatOrderDateTime(sqliteUtc)).not.toContain("18:41");
  });

  it("prod order #9307: SQLite milestones display +3h in Minsk", () => {
    const milestones = {
      submitted_at: "2026-06-24 17:43:37",
      ready_at: "2026-06-24 17:45:25",
      issued_at: "2026-06-24 17:50:05",
      cancelled_at: null,
    };

    expect(formatOrderDateTime(milestones.submitted_at)).toContain("20:43");
    expect(formatOrderDateTime(milestones.ready_at)).toContain("20:45");
    expect(formatOrderDateTime(milestones.issued_at)).toContain("20:50");

    const lines = buildFulfillmentTimelineLines(milestones, "delivered", "pickup");
    const ready = formatOrderDateTime(lines.find((l) => l.key === "ready")?.at);
    const issued = formatOrderDateTime(lines.find((l) => l.key === "issued")?.at);
    expect(ready).toContain("20:45");
    expect(issued).toContain("20:50");
  });

  it("same instant in SQLite and ISO-Z formats shows the same Minsk minute", () => {
    const sqlite = "2026-06-24 17:50:05";
    const iso = "2026-06-24T17:50:05.129Z";
    expect(formatOrderDateTime(sqlite)).toContain("20:50");
    expect(formatOrderDateTime(iso)).toContain("20:50");
    expect(parseOrderDateTime(sqlite).getTime()).toBeLessThan(
      parseOrderDateTime(iso).getTime() + 1000,
    );
  });

  it("midnight rollover: late UTC evening becomes next Minsk calendar day", () => {
    const sqliteUtc = "2026-06-24 21:30:00";
    expect(formatOrderDateTime(sqliteUtc)).toContain("00:30");
    expect(formatOrderDate(sqliteUtc)).toMatch(/25/);
  });

  it("respects explicit +03:00 offset without double-shifting", () => {
    const explicitMinsk = "2026-06-24T21:41:00+03:00";
    expect(formatOrderDateTime(explicitMinsk)).toContain("21:41");
    expect(parseOrderDateTime(explicitMinsk).toISOString()).toBe("2026-06-24T18:41:00.000Z");
  });

  it("ISO without offset is treated as UTC, not browser local", () => {
    const bareIso = "2026-06-24T17:43:37";
    expect(parseOrderDateTime(bareIso).toISOString()).toBe("2026-06-24T17:43:37.000Z");
    expect(formatOrderDateTime(bareIso)).toContain("20:43");
  });

  it("does not double-append Z to values that already have Z", () => {
    const iso = "2026-06-24T17:43:37.000Z";
    expect(parseOrderDateTime(iso).toISOString()).toBe("2026-06-24T17:43:37.000Z");
    expect(formatOrderDateTime(iso)).toContain("20:43");
  });

  it("negative offset is preserved", () => {
    const value = "2026-06-24T12:00:00-05:00";
    expect(parseOrderDateTime(value).toISOString()).toBe("2026-06-24T17:00:00.000Z");
    expect(formatOrderDateTime(value)).toContain("20:00");
  });

  it("rejects empty, null, whitespace and garbage without throwing", () => {
    for (const value of [null, undefined, "", "   ", "not-a-date", "2026-13-40 99:99:99"]) {
      const parsed = parseOrderDateTime(value as string | null | undefined);
      expect(Number.isNaN(parsed.getTime())).toBe(true);
      expect(formatOrderDateTime(value as string | null | undefined)).toBe("—");
      expect(formatOrderDate(value as string | null | undefined)).toBe("—");
    }
  });

  it("trims surrounding whitespace on SQLite values", () => {
    const value = "  2026-06-24 18:41:00  ";
    expect(formatOrderDateTime(value)).toContain("21:41");
  });

  it("prod-like history: ready and issued within seconds share displayed minute", () => {
    const milestones = {
      submitted_at: "2026-06-22 17:08:55",
      ready_at: "2026-06-22 17:09:41",
      issued_at: "2026-06-22 17:09:44",
      cancelled_at: null,
    };
    const lines = buildFulfillmentTimelineLines(milestones, "delivered", "pickup");
    const ready = formatOrderDateTime(lines.find((l) => l.key === "ready")?.at);
    const issued = formatOrderDateTime(lines.find((l) => l.key === "issued")?.at);
    expect(ready).toContain("20:09");
    expect(issued).toContain("20:09");
  });

  it("cancelled order meta uses SQLite cancelled_at in Minsk", () => {
    const meta = formatOrderHistoryMeta({
      status: "cancelled",
      delivery_type: "pickup",
      created_at: "2026-06-24 17:43:37",
      completed_at: null,
      fulfillment_milestones: {
        submitted_at: "2026-06-24 17:43:37",
        ready_at: null,
        issued_at: null,
        cancelled_at: "2026-06-24 18:10:00",
      },
    });
    expect(meta).toContain("Отменён");
    expect(meta).toContain("21:10");
    expect(meta).not.toContain("18:10");
  });

  it("mixed created_at ISO-Z and milestone SQLite in one card stays consistent", () => {
    const meta = formatOrderHistoryMeta({
      status: "delivered",
      delivery_type: "pickup",
      created_at: "2026-06-24T17:43:37.000Z",
      completed_at: "2026-06-24T17:50:05.129Z",
      fulfillment_milestones: {
        submitted_at: "2026-06-24 17:43:37",
        ready_at: "2026-06-24 17:45:25",
        issued_at: "2026-06-24 17:50:05",
        cancelled_at: null,
      },
    });
    expect(meta).toContain("20:50");
    expect(meta).not.toContain("17:50");
  });

  it("old wrong parser would have been exactly 3 hours behind (documented trap)", () => {
    const sqliteUtc = "2026-06-24 18:41:00";
    const wrongAsMinsk = new Date(`${sqliteUtc.replace(" ", "T")}+03:00`);
    const correctAsUtc = parseOrderDateTime(sqliteUtc);
    const driftMs = correctAsUtc.getTime() - wrongAsMinsk.getTime();
    expect(driftMs).toBe(3 * 60 * 60 * 1000);
  });
});