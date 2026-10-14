/**
 * Выключатель паролей раздела «Обзор» (переменная окружения сервера
 * OVERVIEW_PASSWORD_ENABLED, приезжает полем profit_required из
 * /api/admin/dashboard-access/state).
 *
 * Проверяем именно то, из-за чего выключатель заводили: когда пароли
 * выключены, интерфейс не должен просить их ни при заходе, ни после
 * блокировки экрана.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useAdminStore } from "@/stores/admin";
import { useCrmStore } from "@/stores/crm";

function stubState(body: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => body,
      text: async () => JSON.stringify(body),
    }),
  );
}

describe("crm: выключатель паролей «Обзора»", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    useAdminStore().token = "stub-token";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("выключённые пароли открывают раздел без запроса", async () => {
    const crm = useCrmStore();
    expect(crm.profitUnlocked).toBe(false);

    stubState({ locked: false, profit_required: false });
    await crm.fetchDashboardAccessState();

    expect(crm.overviewPasswordRequired).toBe(false);
    expect(crm.profitUnlocked).toBe(true);
    expect(crm.dashboardLocked).toBe(false);
  });

  it("с выключенными паролями блокировка экрана не запирает раздел обратно", async () => {
    const crm = useCrmStore();
    stubState({ locked: false, profit_required: false });
    await crm.fetchDashboardAccessState();

    crm.lockProfitAccess();

    expect(crm.profitUnlocked).toBe(true);
    expect(crm.dashboardLocked).toBe(false);
  });

  it("включённые пароли спрашиваются, как раньше", async () => {
    const crm = useCrmStore();
    crm.profitUnlocked = true;

    stubState({ locked: true, profit_required: true });
    await crm.fetchDashboardAccessState();

    expect(crm.overviewPasswordRequired).toBe(true);
    expect(crm.dashboardLocked).toBe(true);
    // Выданный допуск состояние не отбирает: иначе переход между вкладками
    // сбрасывал бы пароль, введённый минуту назад.
    expect(crm.profitUnlocked).toBe(true);

    // А вот блокировка экрана его отбирает, как и раньше.
    crm.lockProfitAccess();
    expect(crm.profitUnlocked).toBe(false);
    expect(crm.dashboardLocked).toBe(true);
  });

  it("сервер без нового поля ведёт себя как раньше", async () => {
    const crm = useCrmStore();
    stubState({ locked: true });
    await crm.fetchDashboardAccessState();

    expect(crm.overviewPasswordRequired).toBe(true);
    expect(crm.dashboardLocked).toBe(true);
  });

  it("возврат паролей отбирает поднятый нами допуск", async () => {
    const crm = useCrmStore();

    stubState({ locked: false, profit_required: false });
    await crm.fetchDashboardAccessState();
    expect(crm.profitUnlocked).toBe(true);

    // Магазин включил пароли обратно и перезапустил сервер.
    stubState({ locked: true, profit_required: true });
    await crm.fetchDashboardAccessState();

    expect(crm.overviewPasswordRequired).toBe(true);
    expect(crm.profitUnlocked).toBe(false);
  });

  it("resetProfitAccess отбирает допуск и пропуск для следующего входа", () => {
    const crm = useCrmStore();
    crm.overviewPasswordRequired = true;
    crm.profitUnlocked = true;
    crm.dashboardToken = "пропуск";

    crm.resetProfitAccess();

    expect(crm.profitUnlocked).toBe(false);
    expect(crm.dashboardToken).toBe("");
    expect(crm.dashboardLocked).toBe(true);
  });

  it("resetProfitAccess не запирает раздел с выключенными паролями", () => {
    const crm = useCrmStore();
    crm.overviewPasswordRequired = false;
    crm.profitUnlocked = true;

    crm.resetProfitAccess();

    expect(crm.profitUnlocked).toBe(true);
  });

  it("возврат паролей отбирает допуск, введённый паролем", async () => {
    // Допуск больше не переживает перезагрузку: localStorage убран, и
    // возврат паролей отбирает его безусловно.
    const crm = useCrmStore();
    crm.profitUnlocked = true;

    stubState({ locked: false, profit_required: false });
    await crm.fetchDashboardAccessState();
    stubState({ locked: true, profit_required: true });
    await crm.fetchDashboardAccessState();

    expect(crm.profitUnlocked).toBe(false);
  });

  it("любое значение поля кроме false оставляет пароль на месте", async () => {
    for (const value of [true, "0", "", 0, null]) {
      setActivePinia(createPinia());
      useAdminStore().token = "stub-token";
      const crm = useCrmStore();
      stubState({ locked: true, profit_required: value });
      await crm.fetchDashboardAccessState();

      expect(crm.overviewPasswordRequired).toBe(true);
      expect(crm.profitUnlocked).toBe(false);
    }
  });
});
