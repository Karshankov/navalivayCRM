import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useAdminStore } from "@/stores/admin";
import { UnauthorizedError, useCrmStore } from "@/stores/crm";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requestHeaders(call: unknown[]) {
  return new Headers((call[1] as RequestInit | undefined)?.headers);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("безопасность учёта сотрудников", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("admin_token", "admin-token");
    useCrmStore().lockStaffAccess();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("держит допуски только в памяти и закрывает смену отдельным ключом", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          staff_token: "staff-secret",
          shift_token: "shift-secret",
          role: "employee",
          employee: {
            id: "employee-1",
            first_name: "Анна",
            last_name: "Иванова",
            active: true,
            position: null,
          },
          shift: {
            id: "shift-1",
            employee_id: "employee-1",
            employee_name: "Анна Иванова",
            status: "active",
            started_at: "2026-07-23T08:00:00.000Z",
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          active: false,
          closed: true,
          shift: {
            id: "shift-1",
            employee_id: "employee-1",
            status: "closed",
            started_at: "2026-07-23T08:00:00.000Z",
            ended_at: "2026-07-23T16:00:00.000Z",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const store = useCrmStore();
    await store.openStaffShift({ employee_id: "employee-1", pin: "1234" });

    expect(store.hasStaffAccess).toBe(true);
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.getItem("crm_staff_token")).toBeNull();

    await store.closeStaffShift();

    const closeHeaders = requestHeaders(fetchMock.mock.calls[1]);
    expect(closeHeaders.get("X-Staff-Token")).toBe("staff-secret");
    expect(closeHeaders.get("X-Shift-Token")).toBe("shift-secret");
    expect(store.staffShiftToken).toBe("");
    expect(sessionStorage.length).toBe(0);
  });

  it("выход из личной карточки не скрывает открытую общую смену", () => {
    const store = useCrmStore();
    store.$patch({
      staffToken: "employee-token",
      staffIdentity: {
        role: "employee",
        employee: {
          id: "employee-1",
          first_name: "Анна",
          last_name: "Иванова",
          active: true,
          position: null,
        },
      },
      currentStaffShift: {
        id: "shift-1",
        employee_id: "employee-1",
        status: "active",
      },
    });

    store.lockStaffAccess();

    expect(store.hasStaffAccess).toBe(false);
    expect(store.currentStaffShift?.id).toBe("shift-1");
  });

  it("общий вход CRM не наследует допуск руководителя после блокировки или новой сессии", async () => {
    const manager = {
      id: "manager-1",
      first_name: "Мария",
      last_name: "Руководитель",
      role: "manager" as const,
      active: true,
      position: null,
    };
    const managerAccess = {
      staff_token: "manager-secret",
      shift_token: "manager-shift-secret",
      role: "manager",
      employee: manager,
      shift: {
        id: "shift-1",
        version: 1,
        employee_id: manager.id,
        employee: manager,
        status: "active",
        started_at: "2026-07-23T08:00:00.000Z",
      },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/staff/shift/open")) {
        return jsonResponse(managerAccess);
      }
      if (url === "/api/admin/login") {
        return jsonResponse({
          token: "new-admin-token",
          user: { username: "admin", role: "admin" },
        });
      }
      if (url === "/api/admin/category-groups/incomplete/summary") {
        return jsonResponse({ hasAny: false, count: 0 });
      }
      if (url === "/api/admin/crm/employees") {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const crmStore = useCrmStore();
    const adminStore = useAdminStore();

    await crmStore.openStaffShift({ employee_id: manager.id, pin: "1234" });
    await crmStore.fetchEmployees();
    let employeeCalls = fetchMock.mock.calls.filter(
      (call) => String(call[0]) === "/api/admin/crm/employees",
    );
    expect(requestHeaders(employeeCalls[0]).get("X-Staff-Token")).toBe(
      "manager-secret",
    );

    // Даже без явной блокировки новый основной вход обязан оборвать старый
    // ПИН-допуск: это защита от смены пользователя в той же вкладке.
    await adminStore.login({ username: "admin", password: "main-password" });
    await crmStore.fetchEmployees();
    employeeCalls = fetchMock.mock.calls.filter(
      (call) => String(call[0]) === "/api/admin/crm/employees",
    );
    expect(requestHeaders(employeeCalls[1]).get("X-Staff-Token")).toBeNull();
    expect(crmStore.currentStaffShift?.id).toBe("shift-1");

    // Новый ПИН снова даёт допуск, а действие экрана блокировки снимает его,
    // не закрывая общую смену. Повторный вход CRM не должен его восстановить.
    await crmStore.openStaffShift({ employee_id: manager.id, pin: "1234" });
    crmStore.lockStaffAccess();
    await adminStore.login({ username: "admin", password: "main-password" });
    await crmStore.fetchEmployees();
    employeeCalls = fetchMock.mock.calls.filter(
      (call) => String(call[0]) === "/api/admin/crm/employees",
    );
    expect(requestHeaders(employeeCalls[2]).get("X-Staff-Token")).toBeNull();
    expect(crmStore.hasStaffAccess).toBe(false);
    expect(crmStore.currentStaffShift?.id).toBe("shift-1");
  });

  it("основной выход снимает ПИН-допуск, но сохраняет общую смену", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        staff_token: "manager-secret",
        shift_token: "manager-shift-secret",
        role: "manager",
        employee: {
          id: "manager-1",
          first_name: "Мария",
          last_name: "Руководитель",
          role: "manager",
          active: true,
          position: null,
        },
        shift: {
          id: "shift-1",
          version: 1,
          employee_id: "manager-1",
          status: "active",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const crmStore = useCrmStore();
    const adminStore = useAdminStore();
    adminStore.$patch({
      isAuthenticated: true,
      token: "admin-token",
      user: { username: "admin", role: "admin" },
    });

    await crmStore.openStaffShift({
      employee_id: "manager-1",
      pin: "1234",
    });
    await adminStore.logout();

    expect(adminStore.isAuthenticated).toBe(false);
    expect(crmStore.hasStaffAccess).toBe(false);
    expect(crmStore.currentStaffShift?.id).toBe("shift-1");
  });

  it("401 основной сессии снимает и основной, и ПИН-допуск", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          staff_token: "manager-secret",
          shift_token: "manager-shift-secret",
          role: "manager",
          employee: {
            id: "manager-1",
            first_name: "Мария",
            last_name: "Руководитель",
            role: "manager",
            active: true,
            position: null,
          },
          shift: {
            id: "shift-1",
            version: 1,
            employee_id: "manager-1",
            status: "active",
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, 401));
    vi.stubGlobal("fetch", fetchMock);
    const crmStore = useCrmStore();
    const adminStore = useAdminStore();
    adminStore.$patch({
      isAuthenticated: true,
      token: "admin-token",
      user: { username: "admin", role: "admin" },
    });

    await crmStore.openStaffShift({
      employee_id: "manager-1",
      pin: "1234",
    });
    await expect(crmStore.fetchStaffShift()).rejects.toBeInstanceOf(
      UnauthorizedError,
    );

    expect(adminStore.isAuthenticated).toBe(false);
    expect(adminStore.token).toBe("");
    expect(crmStore.hasStaffAccess).toBe(false);
    expect(crmStore.currentStaffShift?.id).toBe("shift-1");
  });

  it("обычный сотрудник не запрашивает руководительские настройки уведомлений", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        shift: {
          id: "shift-1",
          employee_id: "employee-1",
          status: "active",
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ tasks: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const store = useCrmStore();
    store.$patch({
      staffToken: "employee-token",
      staffIdentity: {
        role: "employee",
        employee: {
          id: "employee-1",
          first_name: "Анна",
          last_name: "Иванова",
          active: true,
          position: null,
        },
      },
    });

    await store.refreshStaffWorkspace();

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls).toContain("/api/admin/crm/staff/shift");
    expect(urls).toContain("/api/admin/crm/staff/tasks");
    expect(urls.some((url) => url.endsWith("/staff/notifications"))).toBe(false);
  });

  it("повторяет создание с тем же ключом защиты до подтверждённого ответа", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: "shift_required" }, 409),
    );
    vi.stubGlobal("fetch", fetchMock);

    const store = useCrmStore();
    const order = {
      delivery_type: "pickup" as const,
      items: [{ product_id: "product-1", quantity: 1 }],
    };
    const procurement = {
      actor_employee_id: "employee-1",
      actor_pin: "1234",
      items: [{
        product_id: "product-1",
        quantity: 1,
        warehouse_quantity: 0,
        cost_per_unit: 10,
      }],
    };

    await expect(store.createOrder(order)).rejects.toMatchObject({
      code: "shift_required",
    });
    await expect(store.createOrder(order)).rejects.toMatchObject({
      code: "shift_required",
    });
    await expect(store.createProcurement(procurement)).rejects.toBeTruthy();
    await expect(store.createProcurement(procurement)).rejects.toBeTruthy();

    const orderKey1 = requestHeaders(fetchMock.mock.calls[0]).get("Idempotency-Key");
    const orderKey2 = requestHeaders(fetchMock.mock.calls[1]).get("Idempotency-Key");
    const procurementKey1 = requestHeaders(fetchMock.mock.calls[2]).get("Idempotency-Key");
    const procurementKey2 = requestHeaders(fetchMock.mock.calls[3]).get("Idempotency-Key");
    expect(orderKey1).toBeTruthy();
    expect(orderKey2).toBe(orderKey1);
    expect(procurementKey1).toBeTruthy();
    expect(procurementKey2).toBe(procurementKey1);

    const adminStore = useAdminStore();
    adminStore.$patch({ token: "admin-token" });
    const transfer = {
      source_location: "warehouse" as const,
      destination_location: "retail" as const,
      actor_employee_id: "employee-1",
      actor_pin: "1234",
      items: [{ product_id: "product-1", quantity: 1 }],
    };
    await expect(adminStore.createInventoryTransfer(transfer)).rejects.toBeTruthy();
    await expect(adminStore.createInventoryTransfer(transfer)).rejects.toBeTruthy();

    const transferKey1 = requestHeaders(fetchMock.mock.calls[4]).get("Idempotency-Key");
    const transferKey2 = requestHeaders(fetchMock.mock.calls[5]).get("Idempotency-Key");
    expect(transferKey1).toBeTruthy();
    expect(transferKey2).toBe(transferKey1);
  });

  it("не подменяет руководителя сотрудником из чужой карточки или смены", async () => {
    const manager = {
      id: "manager-1",
      first_name: "Мария",
      last_name: "Руководитель",
      role: "manager",
      active: true,
      position: null,
    };
    const employee = {
      id: "employee-2",
      first_name: "Иван",
      last_name: "Сотрудник",
      role: "employee",
      active: true,
      position: null,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        staff_token: "manager-secret",
        shift_token: "manager-shift",
        role: "manager",
        employee: manager,
        shift: {
          id: "shift-manager",
          employee_id: manager.id,
          employee: manager,
          status: "active",
          started_at: "2026-07-23T08:00:00.000Z",
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        active: true,
        shift: {
          id: "shift-employee",
          employee_id: employee.id,
          employee,
          status: "active",
          started_at: "2026-07-23T08:00:00.000Z",
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        month: "2026-07",
        employee,
        worked_minutes: 60,
        shifts_count: 1,
        events: [],
        event_counts: [],
        daily_activity: [],
        metrics: {},
        tasks: {},
      }));
    vi.stubGlobal("fetch", fetchMock);

    const store = useCrmStore();
    await store.openStaffShift({ employee_id: manager.id, pin: "1234" });
    await store.fetchStaffShift();
    await store.fetchStaffAnalytics({
      month: "2026-07",
      employeeId: employee.id,
    });

    expect(store.staffIdentity?.employee.id).toBe(manager.id);
    expect(store.isStaffManager).toBe(true);
  });

  it("держит обязательную смену на одном выключателе учёта", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ enabled: true }))
      .mockResolvedValueOnce(jsonResponse({ enabled: false }));
    vi.stubGlobal("fetch", fetchMock);

    const store = useCrmStore();
    await store.fetchStaffSettings();
    expect(store.staffTrackingEnabled).toBe(true);

    store.$patch({
      staffToken: "manager-token",
      staffIdentity: {
        role: "manager",
        employee: {
          id: "manager-1",
          first_name: "Мария",
          last_name: "Руководитель",
          position: null,
          active: true,
          role: "manager",
        },
      },
    });
    await store.updateStaffTracking(false);
    expect(store.staffTrackingEnabled).toBe(false);

    // Отдельной настройки ограничения заказов больше нет, к ней никто не ходит.
    expect(store).not.toHaveProperty("updateStaffOrderShiftRestriction");
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain("order-shift-restriction");
    }
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/admin/crm/staff/settings/tracking",
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      "/api/admin/crm/staff/settings/tracking",
    );
  });

  it("настраивает и восстанавливает руководителя только через основной пароль", async () => {
    const manager = {
      id: "manager-1",
      first_name: "Мария",
      last_name: "Руководитель",
      role: "manager" as const,
      active: true,
      position: null,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { employee: manager, tracking_enabled: true },
          201,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ managers: [manager] }))
      .mockResolvedValueOnce(jsonResponse({ employee: manager }));
    vi.stubGlobal("fetch", fetchMock);

    const store = useCrmStore();
    await store.bootstrapStaffManager({
      admin_password: "main-password",
      first_name: "Мария",
      last_name: "Руководитель",
      new_pin: "1234",
      enable_tracking: true,
    });
    const candidates = await store.fetchStaffRecoveryManagerCandidates(
      "main-password",
    );
    await store.recoverStaffManager({
      admin_password: "main-password",
      employee_id: manager.id,
      new_pin: "4321",
    });

    expect(candidates).toEqual([manager]);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/admin/crm/staff/bootstrap-manager",
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      "/api/admin/crm/staff/recovery-manager/candidates",
    );
    expect(fetchMock.mock.calls[2][0]).toBe(
      "/api/admin/crm/staff/recovery-manager",
    );
    expect(localStorage.getItem("crm_staff_token")).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });

  it("не закрывает карточку руководителя из-за неверного основного пароля", async () => {
    const manager = {
      id: "manager-1",
      first_name: "Мария",
      last_name: "Руководитель",
      role: "manager",
      active: true,
      position: null,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          staff_token: "manager-token",
          shift_token: "shift-token",
          employee: manager,
          role: "manager",
          shift: {
            id: "shift-1",
            version: 1,
            employee_id: manager.id,
            status: "active",
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ error: "invalid_admin_password" }, 401),
      );
    vi.stubGlobal("fetch", fetchMock);
    const store = useCrmStore();
    await store.openStaffShift({ employee_id: manager.id, pin: "1234" });

    await expect(
      store.fetchStaffRecoveryManagerCandidates("wrong-password"),
    ).rejects.toMatchObject({ code: "invalid_admin_password" });
    expect(store.hasStaffAccess).toBe(true);
    expect(store.isStaffManager).toBe(true);
  });

  it("передаёт версию смены при исправлении и сохраняет серверный конфликт", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          shift: {
            id: "shift-1",
            version: 4,
            employee_id: "employee-1",
            status: "closed",
            started_at: "2026-07-23T07:00:00.000Z",
            ended_at: "2026-07-23T18:15:00.000Z",
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ error: "shift_version_conflict" }, 409),
      );
    vi.stubGlobal("fetch", fetchMock);
    const store = useCrmStore();
    store.$patch({
      staffToken: "manager-token",
      staffIdentity: {
        role: "manager",
        employee: {
          id: "manager-1",
          first_name: "Мария",
          last_name: "Руководитель",
          position: null,
          active: true,
          role: "manager",
        },
      },
    });
    const payload = {
      shift_id: "shift-1",
      expected_version: 3,
      started_at: "2026-07-23T07:00:00.000Z",
      ended_at: "2026-07-23T18:15:00.000Z",
      reason: "Исправление табеля",
    };
    await store.correctStaffShift(payload);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      expected_version: 3,
    });

    await expect(store.correctStaffShift(payload)).rejects.toMatchObject({
      status: 409,
    });
  });

  it("запрашивает произвольный период и сохраняет прибыль и отдельные отметки", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        period: {
          type: "custom",
          start: "2026-07-01",
          end: "2026-07-10",
        },
        employee: {
          id: "employee-1",
          first_name: "Анна",
          last_name: "Иванова",
          position: null,
          active: true,
        },
        worked_minutes: 120,
        shifts_count: 2,
        assembled_orders: 3,
        issued_orders: 2,
        issued_revenue: 100,
        issued_profit: 35,
        mark_counts: { positive: 4, negative: 1 },
        events: [],
        event_counts: [],
        daily_activity: [],
        metrics: {},
        marks: [],
        tasks: {},
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const store = useCrmStore();
    store.$patch({
      staffToken: "employee-token",
      staffIdentity: {
        role: "employee",
        employee: {
          id: "employee-1",
          first_name: "Анна",
          last_name: "Иванова",
          position: null,
          active: true,
        },
      },
    });

    const analytics = await store.fetchStaffAnalytics({
      period: "custom",
      from: "2026-07-01",
      to: "2026-07-10",
    });

    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "period=custom&from=2026-07-01&to=2026-07-10",
    );
    expect(analytics.issued_profit).toBe(35);
    expect(analytics.mark_counts).toEqual({ positive: 4, negative: 1 });
  });

  it("повторяет действие задачи с тем же ключом, пока ответ неизвестен", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network"));
    vi.stubGlobal("fetch", fetchMock);
    const store = useCrmStore();
    const firstNote = { result_note: "Готово" };

    await expect(
      store.performStaffTaskAction("task-idempotency", "submit", firstNote),
    ).rejects.toMatchObject({ outcomeUnknown: true });
    await expect(
      store.performStaffTaskAction("task-idempotency", "submit", firstNote),
    ).rejects.toMatchObject({ outcomeUnknown: true });
    await expect(
      store.performStaffTaskAction("task-idempotency", "submit", {
        result_note: "Исправлено",
      }),
    ).rejects.toMatchObject({ outcomeUnknown: true });

    const firstKey = requestHeaders(fetchMock.mock.calls[0]).get(
      "Idempotency-Key",
    );
    const repeatedKey = requestHeaders(fetchMock.mock.calls[1]).get(
      "Idempotency-Key",
    );
    const changedNoteKey = requestHeaders(fetchMock.mock.calls[2]).get(
      "Idempotency-Key",
    );
    expect(firstKey).toBeTruthy();
    expect(repeatedKey).toBe(firstKey);
    expect(changedNoteKey).toBeTruthy();
    expect(changedNoteKey).not.toBe(firstKey);
  });

  it("безопасно повторяет создание и исправление ручной отметки", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network"));
    vi.stubGlobal("fetch", fetchMock);
    const store = useCrmStore();
    const createPayload = {
      employee_id: "employee-1",
      kind: "positive" as const,
      title: "Помог с поставкой",
      description: "Всё сверил",
    };
    const updatePayload = {
      title: "Помог с крупной поставкой",
      expected_version: 3,
    };

    await expect(store.createStaffMark(createPayload)).rejects.toMatchObject({
      outcomeUnknown: true,
    });
    await expect(store.createStaffMark(createPayload)).rejects.toMatchObject({
      outcomeUnknown: true,
    });
    await expect(store.updateStaffMark("mark-1", updatePayload)).rejects.toMatchObject({
      outcomeUnknown: true,
    });
    await expect(store.updateStaffMark("mark-1", updatePayload)).rejects.toMatchObject({
      outcomeUnknown: true,
    });

    const createKey = requestHeaders(fetchMock.mock.calls[0]).get("Idempotency-Key");
    const createReplayKey = requestHeaders(fetchMock.mock.calls[1]).get("Idempotency-Key");
    const updateKey = requestHeaders(fetchMock.mock.calls[2]).get("Idempotency-Key");
    const updateReplayKey = requestHeaders(fetchMock.mock.calls[3]).get("Idempotency-Key");
    expect(createReplayKey).toBe(createKey);
    expect(updateReplayKey).toBe(updateKey);
    expect(updateKey).not.toBe(createKey);
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toMatchObject({
      expected_version: 3,
    });
  });

  it("не стирает новую смену и её ключ поздним ответом старой проверки", async () => {
    const oldShift = deferred<Response>();
    const employee = {
      id: "employee-race",
      first_name: "Анна",
      last_name: "Иванова",
      position: null,
      active: true,
      role: "employee" as const,
    };
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => oldShift.promise)
      .mockResolvedValueOnce(
        jsonResponse({
          staff_token: "staff-new",
          shift_token: "shift-new",
          employee,
          role: "employee",
          shift: {
            id: "shift-new",
            version: 1,
            employee_id: employee.id,
            status: "active",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const store = useCrmStore();

    const staleRequest = store.fetchStaffShift();
    await Promise.resolve();
    await store.openStaffShift({ employee_id: employee.id, pin: "1234" });
    oldShift.resolve(jsonResponse({ active: false, shift: null }));
    await staleRequest;

    expect(store.currentStaffShift?.id).toBe("shift-new");
    expect(store.staffShiftToken).toBe("shift-new");
  });

  it("сразу убирает закрытую смену после выключения учёта", async () => {
    const oldShift = deferred<Response>();
    const employee = {
      id: "employee-tracking-off",
      first_name: "Анна",
      last_name: "Иванова",
      position: null,
      active: true,
      role: "employee" as const,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          staff_token: "staff-active",
          shift_token: "shift-active",
          employee,
          role: "employee",
          shift: {
            id: "shift-active",
            version: 1,
            employee_id: employee.id,
            status: "active",
          },
        }),
      )
      .mockImplementationOnce(() => oldShift.promise)
      .mockResolvedValueOnce(
        jsonResponse({
          enabled: false,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const store = useCrmStore();

    await store.openStaffShift({ employee_id: employee.id, pin: "1234" });
    const staleRequest = store.fetchStaffShift();
    await Promise.resolve();
    await store.updateStaffTracking(false);

    expect(store.currentStaffShift).toBeNull();
    expect(store.staffShiftToken).toBe("");

    oldShift.resolve(
      jsonResponse({
        active: true,
        shift: {
          id: "shift-stale",
          version: 1,
          employee_id: employee.id,
          status: "active",
        },
      }),
    );
    await staleRequest;

    expect(store.currentStaffShift).toBeNull();
    expect(store.staffShiftToken).toBe("");
  });

  it("убирает старую смену, если учёт выключили в другой вкладке", async () => {
    const oldShift = deferred<Response>();
    const employee = {
      id: "employee-external-tracking-off",
      first_name: "Анна",
      last_name: "Иванова",
      position: null,
      active: true,
      role: "employee" as const,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          staff_token: "staff-active",
          shift_token: "shift-active",
          employee,
          role: "employee",
          shift: {
            id: "shift-active",
            version: 1,
            employee_id: employee.id,
            status: "active",
          },
        }),
      )
      .mockImplementationOnce(() => oldShift.promise)
      .mockResolvedValueOnce(
        jsonResponse({
          enabled: false,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const store = useCrmStore();

    await store.openStaffShift({ employee_id: employee.id, pin: "1234" });
    const staleRequest = store.fetchStaffShift();
    await Promise.resolve();
    await store.fetchStaffSettings();

    expect(store.currentStaffShift).toBeNull();
    expect(store.staffShiftToken).toBe("");

    oldShift.resolve(
      jsonResponse({
        active: true,
        shift: {
          id: "shift-stale",
          version: 1,
          employee_id: employee.id,
          status: "active",
        },
      }),
    );
    await staleRequest;

    expect(store.currentStaffShift).toBeNull();
    expect(store.staffShiftToken).toBe("");
  });

  it("не заменяет новые показатели, зарплаты, отметки и смены поздними ответами", async () => {
    const oldAnalytics = deferred<Response>();
    const oldSalary = deferred<Response>();
    const oldMarks = deferred<Response>();
    const oldShifts = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => oldAnalytics.promise)
      .mockResolvedValueOnce(jsonResponse({
        employee: { id: "employee-1", first_name: "Новая", last_name: "Карточка", active: true },
        worked_minutes: 200,
      }))
      .mockImplementationOnce(() => oldSalary.promise)
      .mockResolvedValueOnce(jsonResponse({
        salary: { id: "salary-new", employee_id: "employee-1", month: "2026-08", amount_minor: 12345 },
      }))
      .mockImplementationOnce(() => oldMarks.promise)
      .mockResolvedValueOnce(jsonResponse({
        marks: [{
          id: "mark-new",
          employee_id: "employee-1",
          mark_type: "positive",
          title: "Новая отметка",
          happened_at: "2026-08-02T10:00:00.000Z",
        }],
      }))
      .mockImplementationOnce(() => oldShifts.promise)
      .mockResolvedValueOnce(jsonResponse({
        shifts: [{
          id: "shift-history-new",
          version: 1,
          employee_id: "employee-1",
          status: "closed",
          started_at: "2026-08-02T07:00:00.000Z",
          ended_at: "2026-08-02T12:00:00.000Z",
        }],
      }))
      .mockResolvedValueOnce(jsonResponse({ audit: [] }))
      .mockResolvedValueOnce(jsonResponse({ audit: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const store = useCrmStore();
    store.$patch({
      staffToken: "employee-token",
      staffIdentity: {
        role: "employee",
        employee: {
          id: "employee-1",
          first_name: "Анна",
          last_name: "Иванова",
          position: null,
          active: true,
        },
      },
    });

    const staleAnalytics = store.fetchStaffAnalytics({ month: "2026-07" });
    await store.fetchStaffAnalytics({ month: "2026-08" });
    oldAnalytics.resolve(jsonResponse({
      employee: { id: "employee-1", first_name: "Старая", last_name: "Карточка", active: true },
      worked_minutes: 10,
    }));
    await staleAnalytics;
    expect(store.staffAnalytics?.worked_minutes).toBe(200);

    const staleSalary = store.fetchStaffSalaries({ month: "2026-07", employeeId: "employee-1" });
    await store.fetchStaffSalaries({ month: "2026-08", employeeId: "employee-1" });
    oldSalary.resolve(jsonResponse({
      salary: { id: "salary-old", employee_id: "employee-1", month: "2026-07", amount_minor: 1 },
    }));
    await staleSalary;
    expect(store.staffSalaries[0]?.id).toBe("salary-new");

    const staleMarks = store.fetchStaffMarks({ month: "2026-07", employeeId: "employee-1" });
    await store.fetchStaffMarks({ month: "2026-08", employeeId: "employee-1" });
    oldMarks.resolve(jsonResponse({
      marks: [{
        id: "mark-old",
        employee_id: "employee-1",
        mark_type: "negative",
        title: "Старая отметка",
        happened_at: "2026-07-02T10:00:00.000Z",
      }],
    }));
    await staleMarks;
    expect(store.staffMarks[0]?.id).toBe("mark-new");

    const staleShifts = store.fetchStaffShiftHistory({ month: "2026-07", employeeId: "employee-1" });
    await store.fetchStaffShiftHistory({ month: "2026-08", employeeId: "employee-1" });
    oldShifts.resolve(jsonResponse({
      shifts: [{
        id: "shift-history-old",
        version: 1,
        employee_id: "employee-1",
        status: "closed",
        started_at: "2026-07-02T07:00:00.000Z",
        ended_at: "2026-07-02T12:00:00.000Z",
      }],
    }));
    await staleShifts;
    expect(store.staffShiftHistory[0]?.id).toBe("shift-history-new");
  });

  it("не откатывает изменённую задачу поздним ответом старого списка", async () => {
    const oldTasks = deferred<Response>();
    const updatedTask = {
      id: "task-1",
      title: "Проверить остатки",
      status: "submitted" as const,
      assignee_employee_id: "employee-1",
      result_note: "Всё сверено",
    };
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => oldTasks.promise)
      .mockResolvedValueOnce(jsonResponse({ task: updatedTask }));
    vi.stubGlobal("fetch", fetchMock);
    const store = useCrmStore();
    store.$patch({
      staffToken: "employee-token",
      staffIdentity: {
        role: "employee",
        employee: {
          id: "employee-1",
          first_name: "Анна",
          last_name: "Иванова",
          position: null,
          active: true,
        },
      },
    });

    const staleRequest = store.fetchStaffTasks();
    await Promise.resolve();
    await store.performStaffTaskAction("task-1", "submit", {
      result_note: "Всё сверено",
    });
    oldTasks.resolve(
      jsonResponse({
        tasks: [
          {
            ...updatedTask,
            status: "claimed",
            result_note: null,
          },
        ],
      }),
    );
    await staleRequest;

    expect(store.staffTasks[0]?.status).toBe("submitted");
    expect(store.staffTasks[0]?.result_note).toBe("Всё сверено");
  });

  it("переводит коды ошибок сотрудников на понятный язык", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ error: "employee_not_found" }, 404),
      )
      .mockResolvedValueOnce(
        jsonResponse({ error: "technical_internal_code" }, 409),
      );
    vi.stubGlobal("fetch", fetchMock);
    const store = useCrmStore();
    store.$patch({ staffToken: "staff-token" });

    await expect(store.fetchStaffAnalytics()).rejects.toMatchObject({
      message: "Сотрудник не найден. Обновите список",
    });
    await expect(store.fetchStaffAnalytics()).rejects.toMatchObject({
      message: "Не удалось выполнить действие. Проверьте данные и повторите",
    });
  });

  it("загружает историю отметки и зарплаты через защищённые методы", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        mark: {
          id: "mark-1",
          employee_id: "employee-1",
          mark_type: "positive",
          title: "Помог",
          happened_at: "2026-07-02T10:00:00.000Z",
        },
        versions: [{ id: "mark-version-1", version: 1, action: "create" }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        salary: {
          id: "salary-1",
          employee_id: "employee-1",
          month: "2026-07",
          amount_minor: 12345,
        },
        versions: [{ id: "salary-version-1", version: 1, amount_minor: 12345 }],
      }));
    vi.stubGlobal("fetch", fetchMock);
    const store = useCrmStore();
    store.$patch({ staffToken: "staff-token" });

    const markHistory = await store.fetchStaffMarkHistory("mark-1");
    const salaryHistory = await store.fetchStaffSalaryHistory("salary-1");

    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/crm/staff/marks/mark-1/history");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/admin/crm/staff/salaries/salary-1/history");
    expect(markHistory.versions[0]?.action).toBe("create");
    expect(salaryHistory.salary.final_amount).toBe(123.45);
  });
});
