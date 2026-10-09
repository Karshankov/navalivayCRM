import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useCrmStore } from "@/stores/crm";

describe("crm polling summary", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses lightweight poll-summary endpoint and notifies listeners on activity changes", async () => {
    let summaryCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/low-stock-groups/summary")) {
        return new Response(JSON.stringify({ hasAny: false, count: 0 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/orders/poll-summary")) {
        summaryCalls += 1;
        const payload = summaryCalls === 1
          ? {
              newOrderIds: ["ord_1"],
              actionRequiredIds: ["act_1"],
              latestOrderActivityAt: "2026-06-01 10:00:00",
            }
          : {
              newOrderIds: ["ord_1", "ord_2"],
              actionRequiredIds: ["act_1"],
              latestOrderActivityAt: "2026-06-01 10:05:00",
            };
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const crmStore = useCrmStore();
    const listener = vi.fn<(activitySince: string) => void>();
    const unsubscribe = crmStore.subscribeOrderActivity(listener);

    crmStore.startPolling();
    await vi.waitFor(() => {
      expect(crmStore.newOrdersCount).toBe(1);
      expect(crmStore.actionRequiredCount).toBe(1);
    });

    const firstUrls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(firstUrls.some((url) => url.endsWith("/api/admin/crm/orders/poll-summary"))).toBe(true);
    expect(firstUrls.some((url) => url.includes("/api/admin/crm/orders?limit=200"))).toBe(false);
    await vi.advanceTimersByTimeAsync(15000);
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/orders/poll-summary")).length).toBe(2);
    });

    expect(crmStore.newOrdersCount).toBe(2);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("2026-06-01 10:00:00");

    unsubscribe();
    crmStore.stopPolling();
  });

  it("shows draw alert until manager acknowledges the latest monthly draw", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/low-stock-groups/summary")) {
        return new Response(JSON.stringify({ hasAny: false, count: 0 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/orders/poll-summary")) {
        return new Response(JSON.stringify({
          newOrderIds: [],
          actionRequiredIds: [],
          latestOrderActivityAt: null,
          pendingReviewCount: 0,
          latestMonthlyDraw: {
            id: "draw_june",
            period_key: "2026-06",
            drawn_at: "2026-06-30 21:00:00",
            winner_count: 5,
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const crmStore = useCrmStore();
    crmStore.startPolling();
    await vi.waitFor(() => {
      expect(crmStore.hasUnseenDraw).toBe(true);
      expect(crmStore.latestMonthlyDraw?.period_key).toBe("2026-06");
    });

    crmStore.markDrawAsSeen("draw_june");
    expect(crmStore.hasUnseenDraw).toBe(false);
    expect(crmStore.isDrawBannerDismissed).toBe(true);

    crmStore.clearDrawAcknowledgement();
    expect(crmStore.hasUnseenDraw).toBe(true);
    expect(crmStore.isDrawBannerDismissed).toBe(false);

    crmStore.stopPolling();
  });
});
