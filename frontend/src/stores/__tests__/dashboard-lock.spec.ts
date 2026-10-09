/**
 * Замок на разделе «Обзор».
 *
 * Ловит найденный на проде сценарий: вход по паролю владельца, затем кнопка
 * блокировки, затем вход по обычному ключу CRM в другом разделе. Раздел
 * «Обзор» после этого открываться не должен, пропуск ушёл вместе с ключом.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useAdminStore } from "@/stores/admin";
import { useCrmStore } from "@/stores/crm";

function stubFetch(payload: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => payload,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("замок раздела «Обзор»", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    const adminStore = useAdminStore();
    adminStore.isAuthenticated = true;
    adminStore.token = "stub-token";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("до ответа сервера считает раздел закрытым", () => {
    const crmStore = useCrmStore();
    expect(crmStore.dashboardLocked).toBe(true);
    expect(crmStore.dashboardToken).toBe("");
  });

  it("блокировка панели забирает пропуск в «Обзор»", async () => {
    const crmStore = useCrmStore();
    stubFetch({ ok: true, token: "пропуск-владельца", expires_in_ms: 1800000 });

    await crmStore.verifyDashboardAccess("0002");
    expect(crmStore.dashboardToken).toBe("пропуск-владельца");
    expect(crmStore.profitUnlocked).toBe(true);

    crmStore.lockProfitAccess();
    expect(crmStore.dashboardToken).toBe("");
    expect(crmStore.profitUnlocked).toBe(false);
  });

  it("блокировка стирает загруженную сводку из памяти", async () => {
    const crmStore = useCrmStore();
    stubFetch({ ok: true, token: "пропуск-владельца", expires_in_ms: 1800000 });
    await crmStore.verifyDashboardAccess("0002");

    crmStore.dashboardStats = { stats: { revenue: 12345 } } as never;
    crmStore.dashboardTimeseries = [
      { label: "июль", orders: 3, revenue: 100, profit: 40 },
    ];

    crmStore.lockProfitAccess();
    expect(crmStore.dashboardStats).toBeNull();
    expect(crmStore.dashboardTimeseries).toEqual([]);
  });

  it("обычный ключ CRM не возвращает доступ к «Обзору»", async () => {
    const crmStore = useCrmStore();
    stubFetch({ ok: true, token: "пропуск-владельца", expires_in_ms: 1800000 });
    await crmStore.verifyDashboardAccess("0002");
    crmStore.lockProfitAccess();

    // Ключ CRM введён в другом разделе: финансы открылись, «Обзор» нет.
    stubFetch({ ok: true });
    await crmStore.verifyProfitPassword("обычный-ключ");

    expect(crmStore.profitUnlocked).toBe(true);
    expect(crmStore.dashboardToken).toBe("");
    expect(crmStore.dashboardLocked).toBe(true);
  });

  it("вход по паролю владельца не снимает сам замок, а выдаёт пропуск", async () => {
    const crmStore = useCrmStore();
    stubFetch({ ok: true, token: "пропуск-владельца", expires_in_ms: 1800000 });

    await crmStore.verifyDashboardAccess("0002");

    // Окно проверок идёт своим чередом, открыт раздел именно пропуском.
    expect(crmStore.dashboardLocked).toBe(true);
    expect(crmStore.dashboardToken).toBe("пропуск-владельца");
  });

  it("состояние замка приходит с сервера", async () => {
    const crmStore = useCrmStore();
    stubFetch({ locked: false, window: { from: 10, to: 16 } });

    await crmStore.fetchDashboardAccessState();
    expect(crmStore.dashboardLocked).toBe(false);
  });
});
