/**
 * Unit-тест для крайне важного инварианта:
 * fetchAPI при 401 НЕ должна делать window.location reload, а:
 *   1. Сбрасывать adminStore.isAuthenticated → false (реактивно)
 *   2. Бросать UnauthorizedError (типизированный маркер)
 *
 * Регрессия (которую этот тест ловит) — давний баг с бесконечным reload-циклом
 * при заходе незалогиненного пользователя на /admin: window.location.href = "/admin"
 * → новый mount CashierLockScreen → новый 401 → новый reload → ...
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useAdminStore } from "@/stores/admin";
import {
  StaffApiError,
  UnauthorizedError,
  useCrmStore,
} from "@/stores/crm";

describe("crm.fetchAPI — обработка 401", () => {
  // Сохраняем оригинальный дескриптор window.location, чтобы восстанавливать
  // его после каждого теста, который мог его подменить (vi.unstubAllGlobals
  // не снимает прямой Object.defineProperty).
  const originalLocationDescriptor = Object.getOwnPropertyDescriptor(
    window,
    "location",
  );

  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalLocationDescriptor) {
      Object.defineProperty(window, "location", originalLocationDescriptor);
    }
  });

  it("при 401 сбрасывает admin auth-state и бросает UnauthorizedError", async () => {
    const adminStore = useAdminStore();
    adminStore.isAuthenticated = true;
    adminStore.token = "stub-token";

    const crmStore = useCrmStore();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            staff_token: "manager-secret",
            shift_token: "shift-secret",
            role: "manager",
            employee: {
              id: "manager-1",
              first_name: "Мария",
              last_name: "Руководитель",
              role: "manager",
              active: true,
            },
            shift: {
              id: "shift-1",
              version: 1,
              employee_id: "manager-1",
              status: "active",
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await crmStore.openStaffShift({
      employee_id: "manager-1",
      pin: "1234",
    });
    await expect(crmStore.fetchEmployees()).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(adminStore.isAuthenticated).toBe(false);
    expect(adminStore.token).toBe("");
    expect(crmStore.hasStaffAccess).toBe(false);
    expect(crmStore.currentStaffShift?.id).toBe("shift-1");
  });

  it("при 401 не делает window.location reload (защита от бесконечного цикла)", async () => {
    const reloadSpy = vi.fn();
    const hrefSetter = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        get href() {
          return "http://localhost/admin";
        },
        set href(value: string) {
          hrefSetter(value);
        },
        reload: reloadSpy,
        pathname: "/admin",
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 401 })),
    );

    const crmStore = useCrmStore();
    await expect(crmStore.fetchEmployees()).rejects.toBeInstanceOf(
      UnauthorizedError,
    );

    expect(reloadSpy).not.toHaveBeenCalled();
    expect(hrefSetter).not.toHaveBeenCalled();
  });

  it("повторные параллельные 401 идемпотентны (не падают, logout вызывается единожды)", async () => {
    const adminStore = useAdminStore();
    adminStore.isAuthenticated = true;
    const logoutSpy = vi.spyOn(adminStore, "logout");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 401 })),
    );

    const crmStore = useCrmStore();
    const results = await Promise.allSettled([
      crmStore.fetchEmployees(),
      crmStore.fetchEmployees(),
      crmStore.fetchEmployees(),
    ]);

    // Все три должны зафейлиться UnauthorizedError-ом, ни одна — другим типом
    for (const r of results) {
      expect(r.status).toBe("rejected");
      if (r.status === "rejected") {
        expect(r.reason).toBeInstanceOf(UnauthorizedError);
      }
    }
    // Гард `if (adminStore.isAuthenticated)` гарантирует ровно один logout:
    // первый 401 переключает isAuthenticated → false, остальные пропускают вызов.
    // Строгое равенство ловит обе регрессии — и «вызвалось дважды», и «не вызвалось вообще».
    expect(logoutSpy).toHaveBeenCalledTimes(1);
  });

  it("неверный ПИН действия остаётся в форме и не снимает основной вход", async () => {
    const adminStore = useAdminStore();
    adminStore.isAuthenticated = true;
    adminStore.token = "stub-token";
    const logoutSpy = vi.spyOn(adminStore, "logout");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ error: "invalid_staff_credentials" }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );

    const crmStore = useCrmStore();
    const result = crmStore.createProcurement({
      actor_employee_id: "employee-1",
      actor_pin: "0000",
      items: [
        {
          product_id: "product-1",
          quantity: 1,
          cost_per_unit: 10,
        },
      ],
    });

    await expect(result).rejects.toMatchObject<Partial<StaffApiError>>({
      name: "StaffApiError",
      code: "invalid_staff_credentials",
      status: 401,
    });
    expect(logoutSpy).not.toHaveBeenCalled();
    expect(adminStore.isAuthenticated).toBe(true);
    expect(adminStore.token).toBe("stub-token");
  });

  it("успешный ответ не трогает auth-state", async () => {
    const adminStore = useAdminStore();
    adminStore.isAuthenticated = true;

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );

    const crmStore = useCrmStore();
    await crmStore.fetchEmployees();
    expect(adminStore.isAuthenticated).toBe(true);
  });

  it("передаёт смещение при догрузке товаров", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const crmStore = useCrmStore();
    await crmStore.searchCrmProducts({ search: "манго", limit: 51, offset: 50 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestedUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(requestedUrl).toContain("search=%D0%BC%D0%B0%D0%BD%D0%B3%D0%BE");
    expect(requestedUrl).toContain("limit=51");
    expect(requestedUrl).toContain("offset=50");
  });

  it("загружает карту ячеек и сохраняет новый лимит", async () => {
    const map = {
      capacity: 50,
      occupied: 1,
      available: 49,
      cells: [{ number: 1, occupied: true, order_id: "o1", order_number: 101 }],
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(map), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const crmStore = useCrmStore();
    await crmStore.fetchPickupCells();
    await crmStore.updatePickupCellCapacity(60);

    expect(crmStore.pickupCells.occupied).toBe(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/pickup-cells");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/pickup-cells/settings");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ capacity: 60 }),
    });
  });

  it("не завершает обновление сотрудников раньше всех запросов и не применяет устаревший ответ", async () => {
    let resolveFirst!: (response: Response) => void;
    let resolveSecond!: (response: Response) => void;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveSecond = resolve;
          }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const crmStore = useCrmStore();
    const firstRequest = crmStore.fetchStaffEmployees();
    const secondRequest = crmStore.fetchStaffEmployees();

    resolveFirst(
      new Response(
        JSON.stringify([
          {
            id: "old",
            first_name: "Старый",
            role: "employee",
            active: true,
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    await firstRequest;

    expect(crmStore.staffEmployeesLoading).toBe(true);
    expect(crmStore.staffEmployees).toEqual([]);

    resolveSecond(
      new Response(
        JSON.stringify([
          {
            id: "new",
            first_name: "Новый",
            role: "employee",
            active: true,
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    await secondRequest;

    expect(crmStore.staffEmployeesLoading).toBe(false);
    expect(crmStore.staffEmployees[0]?.id).toBe("new");
  });
});
