import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useCrmStore } from "@/stores/crm";

describe("crm kanban board sync", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("syncKanbanBoardSince merges changed orders and removes delivered", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/orders/board-sync?")) {
        return new Response(
          JSON.stringify({
            latestOrderActivityAt: "2026-06-03 11:00:00",
            boardOrderIds: ["o1", "o2"],
            changedOrderIds: ["o2"],
            removedOrderIds: ["o_gone"],
            orders: [
              {
                id: "o2",
                order_number: 2,
                status: "in_progress",
                needs_manager_action: 0,
                items: [],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const crmStore = useCrmStore();
    crmStore.orders = [
      { id: "o1", order_number: 1, status: "new", needs_manager_action: 0 } as never,
      { id: "o_gone", order_number: 3, status: "new", needs_manager_action: 0 } as never,
    ];

    await crmStore.syncKanbanBoardSince("2026-06-03 10:00:00");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/admin/crm/orders/board-sync?"),
      expect.anything(),
    );
    expect(crmStore.orders.map((o) => o.id).sort()).toEqual(["o1", "o2"]);
    expect(crmStore.orders.find((o) => o.id === "o2")?.status).toBe("in_progress");
  });

  it("poll activity listener passes previous activity for board-sync", async () => {
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
        const payload =
          summaryCalls === 1
            ? {
                newOrderIds: [],
                actionRequiredIds: [],
                latestOrderActivityAt: "2026-06-03 10:00:00",
              }
            : {
                newOrderIds: [],
                actionRequiredIds: [],
                latestOrderActivityAt: "2026-06-03 11:00:00",
              };
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/orders/board-sync?")) {
        return new Response(
          JSON.stringify({
            latestOrderActivityAt: "2026-06-03 11:00:00",
            boardOrderIds: [],
            changedOrderIds: [],
            removedOrderIds: [],
            orders: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const crmStore = useCrmStore();
    const listener = vi.fn();
    crmStore.subscribeOrderActivity(listener);

    crmStore.startPolling();
    await vi.advanceTimersByTimeAsync(15000);
    await vi.waitFor(() =>
      expect(listener).toHaveBeenCalledWith("2026-06-03 10:00:00"),
    );

    await crmStore.syncKanbanBoardSince("2026-06-03 10:00:00");

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls.some((url) => url.includes("/orders/board-sync?"))).toBe(true);
    expect(urls.some((url) => url.includes("/orders?limit=200"))).toBe(false);

    crmStore.stopPolling();
  });

  it("updateOrder removes delivered order from kanban list without full refresh", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/orders/o1") && !url.includes("board")) {
        return new Response(
          JSON.stringify({
            id: "o1",
            order_number: 1,
            status: "delivered",
            needs_manager_action: 0,
            items: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const crmStore = useCrmStore();
    crmStore.orders = [
      {
        id: "o1",
        order_number: 1,
        status: "in_progress",
        needs_manager_action: 0,
      } as never,
    ];

    await crmStore.updateOrder("o1", { status: "delivered" });
    expect(crmStore.orders.some((o) => o.id === "o1")).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/orders?"))).toBe(
      false,
    );
  });
});
