import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useCrmStore } from "@/stores/crm";

/**
 * Realtime (SSE) для CRM: startRealtime берёт тикет, открывает EventSource и
 * подаёт события в applyOrderPollSummary; недоступность SSE деградирует к
 * обычному polling; stopRealtime закрывает соединение.
 */

type FakeEventSourceOptions = {
  onSummary?: (send: (summary: unknown) => void, source: FakeEventSource) => void;
  connectShouldFail?: boolean;
};

let eventSourceInstances: FakeEventSource[] = [];

class FakeEventSource {
  static instances = () => eventSourceInstances;
  static reset = () => { eventSourceInstances = []; };

  url: string;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  listeners = new Map<string, ((event: { data: string }) => void)[]>();

  constructor(url: string) {
    this.url = url;
    eventSourceInstances.push(this);
  }

  addEventListener(type: string, listener: (event: { data: string }) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type)!.push(listener);
  }

  close() {
    this.closed = true;
  }

  emit(summary: unknown) {
    const listeners = this.listeners.get("summary") || [];
    for (const listener of listeners) {
      listener({ data: JSON.stringify(summary) });
    }
  }

  fail() {
    this.onerror?.();
  }
}

function stubTicketFetch(ticket: string | null) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/events/ticket") && (init?.method || "GET").toUpperCase() === "POST") {
      if (!ticket) throw new Error("network down");
      return new Response(JSON.stringify({ ticket }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/orders/poll-summary")) {
      return new Response(JSON.stringify({ newOrderIds: ["ord_poll_1"], actionRequiredIds: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/low-stock-groups/summary")) {
      return new Response(JSON.stringify({ hasAny: false, count: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("crm realtime SSE", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    FakeEventSource.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("берёт тикет и открывает EventSource с ним в query", async () => {
    stubTicketFetch("ticket-abc");
    vi.stubGlobal("EventSource", FakeEventSource);

    const crmStore = useCrmStore();
    crmStore.startRealtime();
    await vi.waitFor(() => {
      expect(FakeEventSource.instances()).toHaveLength(1);
    });

    const source = FakeEventSource.instances()[0];
    expect(source.url).toContain("/api/admin/crm/events?ticket=ticket-abc");
    expect(source.closed).toBe(false);

    crmStore.stopRealtime();
    expect(source.closed).toBe(true);
  });

  it("событие summary по SSE обновляет счётчики заказов как poll", async () => {
    stubTicketFetch("ticket-abc");
    vi.stubGlobal("EventSource", FakeEventSource);

    const crmStore = useCrmStore();
    crmStore.startRealtime();
    await vi.waitFor(() => {
      expect(FakeEventSource.instances()).toHaveLength(1);
    });

    const source = FakeEventSource.instances()[0];
    source.emit({ newOrderIds: ["ord_sse_1", "ord_sse_2"], actionRequiredIds: [] });

    await vi.waitFor(() => {
      expect(crmStore.newOrdersCount).toBe(2);
    });
    crmStore.stopRealtime();
  });

  it("тикет недоступен: после backoff-попыток деградирует к polling", async () => {
    const fetchMock = stubTicketFetch(null);
    vi.stubGlobal("EventSource", FakeEventSource);

    const crmStore = useCrmStore();
    crmStore.startPolling();
    crmStore.startRealtime();

    // Три попытки backoff: 5 + 10 + 20 секунд.
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(10000);
    await vi.advanceTimersByTimeAsync(20000);

    // EventSource так и не открыт.
    expect(FakeEventSource.instances()).toHaveLength(0);
    // Polling продолжает работать: следующий тик опрашивает poll-summary.
    const pollCalls = fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes("/orders/poll-summary"));
    expect(pollCalls.length).toBeGreaterThan(0);
  });

  it("ошибка соединения: переподключение с новым тикетом, не 401-цикл", async () => {
    let ticketSeq = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/events/ticket") && (init?.method || "GET").toUpperCase() === "POST") {
        ticketSeq += 1;
        return new Response(JSON.stringify({ ticket: `ticket-${ticketSeq}` }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/orders/poll-summary")) {
        return new Response(JSON.stringify({ newOrderIds: [], actionRequiredIds: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/low-stock-groups/summary")) {
        return new Response(JSON.stringify({ hasAny: false, count: 0 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", FakeEventSource);

    const crmStore = useCrmStore();
    crmStore.startRealtime();
    await vi.waitFor(() => {
      expect(FakeEventSource.instances()).toHaveLength(1);
    });

    // Соединение оборвалось: новый тикет и новый EventSource.
    FakeEventSource.instances()[0].fail();
    await vi.advanceTimersByTimeAsync(5000);
    await vi.waitFor(() => {
      expect(FakeEventSource.instances()).toHaveLength(2);
    });

    const second = FakeEventSource.instances()[1];
    expect(second.url).toContain("ticket-2");
    expect(FakeEventSource.instances()[0].closed).toBe(true);

    crmStore.stopRealtime();
    expect(second.closed).toBe(true);
  });

  it("setAutoRefreshEnabled(false) останавливает и SSE, и polling", async () => {
    stubTicketFetch("ticket-abc");
    vi.stubGlobal("EventSource", FakeEventSource);

    const crmStore = useCrmStore();
    crmStore.startRealtime();
    await vi.waitFor(() => {
      expect(FakeEventSource.instances()).toHaveLength(1);
    });

    crmStore.setAutoRefreshEnabled(false);
    expect(FakeEventSource.instances()[0].closed).toBe(true);
  });
});
