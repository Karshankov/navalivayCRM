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

  emitPing() {
    const listeners = this.listeners.get("ping") || [];
    for (const listener of listeners) {
      listener({ data: String(Date.now()) });
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

  it("после подтверждённого SSE остаётся медленный страховочный polling", async () => {
    const fetchMock = stubTicketFetch("ticket-abc");
    vi.stubGlobal("EventSource", FakeEventSource);

    const crmStore = useCrmStore();
    crmStore.startPolling();
    crmStore.startRealtime();
    await vi.waitFor(() => {
      expect(FakeEventSource.instances()).toHaveLength(1);
    });

    // Первый summary подтверждает живой канал: быстрый 15-с polling гаснет...
    FakeEventSource.instances()[0].emit({
      newOrderIds: [],
      actionRequiredIds: [],
    });
    const pollsBefore = fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes("/orders/poll-summary")).length;

    // ...но 60 секунд тишины дают хотя бы один страховочный poll.
    await vi.advanceTimersByTimeAsync(60_000);
    const pollsAfter = fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes("/orders/poll-summary")).length;
    expect(pollsAfter).toBeGreaterThan(pollsBefore);

    crmStore.stopRealtime();
    crmStore.stopPolling();
  });

  it("watchdog: молчание SSE свыше лимита закрывает соединение и переподключает", async () => {
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

    const first = FakeEventSource.instances()[0];
    // Соединение подтверждено первым summary...
    first.emit({ newOrderIds: [], actionRequiredIds: [] });
    // ...а дальше — тишина (зомби-соединение: серверные ping не доходят).

    // Watchdog тикает раз в 60 с, тишина > 75 с считается зомби.
    await vi.advanceTimersByTimeAsync(60_000);
    // Ещё не сработал: тишина 60 с < 75 с лимита.
    expect(FakeEventSource.instances()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(60_000);
    // Теперь тишина 120 с > 75 с: соединение закрыто, взято свежее.
    await vi.waitFor(() => {
      expect(FakeEventSource.instances()).toHaveLength(2);
    });
    expect(first.closed).toBe(true);
    expect(FakeEventSource.instances()[1].url).toContain("ticket-2");

    // Новый источник живой: ping не даёт watchdog закрыть его.
    const second = FakeEventSource.instances()[1];
    second.emit({ newOrderIds: [], actionRequiredIds: [] });
    await vi.advanceTimersByTimeAsync(60_000);
    second.emitPing();
    await vi.advanceTimersByTimeAsync(60_000);
    second.emitPing();
    await vi.advanceTimersByTimeAsync(60_000);
    second.emitPing();
    expect(second.closed).toBe(false);

    crmStore.stopRealtime();
  });

  it("ensureRealtimeHealthyOnVisible: подтверждённое соединение не трогает, помечает активность", async () => {
    stubTicketFetch("ticket-abc");
    vi.stubGlobal("EventSource", FakeEventSource);

    const crmStore = useCrmStore();
    crmStore.startRealtime();
    await vi.waitFor(() => {
      expect(FakeEventSource.instances()).toHaveLength(1);
    });

    const source = FakeEventSource.instances()[0];
    source.emit({ newOrderIds: [], actionRequiredIds: [] });

    // Возврат на вкладку: соединение живое — закрывать/пересоздавать нельзя.
    crmStore.ensureRealtimeHealthyOnVisible();
    expect(FakeEventSource.instances()).toHaveLength(1);
    expect(source.closed).toBe(false);

    // Активность обновлена: 60 с тишины (после отметки) не рвут соединение.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(source.closed).toBe(false);

    crmStore.stopRealtime();
  });

  it("ensureRealtimeHealthyOnVisible: протухшее подтверждённое соединение переподключается сразу", async () => {
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

    const first = FakeEventSource.instances()[0];
    first.emit({ newOrderIds: [], actionRequiredIds: [] });

    // «Ноутбук проспал»: тишина превышает лимит, но realtimeConfirmed=true.
    await vi.advanceTimersByTimeAsync(120_000);

    // Возврат на вкладку должен переподключить НЕМЕДЛЕННО, а не откладывать
    // ещё на 75 с сбросом markRealtimeAlive.
    crmStore.ensureRealtimeHealthyOnVisible();
    await vi.waitFor(() => {
      expect(FakeEventSource.instances()).toHaveLength(2);
    });
    expect(first.closed).toBe(true);
    expect(FakeEventSource.instances()[1].url).toContain("ticket-2");

    crmStore.stopRealtime();
  });

  it("watchdog после закрытия зомби восстанавливает быстрый 15-с polling", async () => {
    const fetchMock = stubTicketFetch("ticket-abc");
    vi.stubGlobal("EventSource", FakeEventSource);

    const crmStore = useCrmStore();
    crmStore.startPolling();
    crmStore.startRealtime();
    await vi.waitFor(() => {
      expect(FakeEventSource.instances()).toHaveLength(1);
    });

    // SSE подтверждён → быстрый polling погашен, остался медленный 60-с.
    FakeEventSource.instances()[0].emit({
      newOrderIds: [],
      actionRequiredIds: [],
    });

    const pollsAt = () =>
      fetchMock.mock.calls
        .map(([url]) => String(url))
        .filter((url) => url.includes("/orders/poll-summary")).length;

    // Тишина до лимита: медленный интервал даёт максимум один poll за 120 с.
    await vi.advanceTimersByTimeAsync(120_000);

    // Watchdog закрыл зомби и вернул быстрый polling: за следующие 45 с
    // должно быть ≥ 2 опросов poll-summary (при 60-с интервале был бы 0-1).
    const before = pollsAt();
    await vi.advanceTimersByTimeAsync(45_000);
    const added = pollsAt() - before;
    expect(added).toBeGreaterThanOrEqual(2);

    crmStore.stopRealtime();
    crmStore.stopPolling();
  });

  it("watchdog оживляет SSE после fallback к чистому polling", async () => {
    // Первый тикет-запрос падает (сеть «недоступна»), последующие работают.
    let ticketSeq = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/events/ticket") && (init?.method || "GET").toUpperCase() === "POST") {
        ticketSeq += 1;
        if (ticketSeq === 1) throw new Error("network down");
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
    // Первая попытка — отказ тикета → backoff 5 с → успешный коннект.
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => {
      expect(FakeEventSource.instances()).toHaveLength(1);
    });
    FakeEventSource.instances()[0].emit({
      newOrderIds: [],
      actionRequiredIds: [],
    });

    // Полная потеря канала: соединение закрыто, fallback-таймеры не живут.
    // Единственный путь оживления — watchdog-тик с source=null.
    const first = FakeEventSource.instances()[0];
    first.onerror = null; // имитируем «тихую» смерть без onerror
    // Внешне соединение «есть», но событий нет: watchdog закроет по тишине.
    await vi.advanceTimersByTimeAsync(120_000);
    await vi.waitFor(() => {
      expect(FakeEventSource.instances()).toHaveLength(2);
    });
    expect(first.closed).toBe(true);

    // Новый источник получает summary → канал снова живой.
    FakeEventSource.instances()[1].emit({
      newOrderIds: [],
      actionRequiredIds: [],
    });
    expect(FakeEventSource.instances()[1].closed).toBe(false);

    crmStore.stopRealtime();
  });

  it("ветка source=null: после полного fallback watchdog-тик сам переподключает SSE", async () => {
    // Все тикеты сначала падают (SSE недоступен), потом «сеть ожила».
    let networkAlive = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/events/ticket") && (init?.method || "GET").toUpperCase() === "POST") {
        if (!networkAlive) throw new Error("network down");
        return new Response(JSON.stringify({ ticket: "ticket-revived" }), {
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

    // 3 неудачных попытки тикета с backoff 5+10+20 с → fallback к polling,
    // source===null, reconnect-таймеров нет.
    await vi.advanceTimersByTimeAsync(35_000);
    expect(FakeEventSource.instances()).toHaveLength(0);
    // Fallback: чистый polling работает.
    const polls = fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes("/orders/poll-summary"));
    expect(polls.length).toBeGreaterThan(0);

    // Сеть «ожила». Никаких visibilitychange и тумблера — только
    // watchdog-тик с source=null должен инициировать новый коннект.
    networkAlive = true;
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() => {
      expect(FakeEventSource.instances()).toHaveLength(1);
    });
    expect(FakeEventSource.instances()[0].url).toContain("ticket-revived");

    crmStore.stopRealtime();
    crmStore.stopPolling();
  });
});
