import { nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import CrmEmployees from "@/views/admin/crm/CrmEmployees.vue";
import { useCrmStore, type StaffAnalytics } from "@/stores/crm";

const manager = {
  id: "manager-1",
  first_name: "Константин",
  last_name: "Жмурков",
  position: "Руководитель",
  role: "manager" as const,
  responsibilities: ["Команда", "Зарплаты", "Смены", "Команда"],
  active: true,
  pin_configured: true,
};
const employee = {
  id: "employee-1",
  first_name: "Павел",
  last_name: "Сергеевич",
  position: "Продавец",
  role: "employee" as const,
  active: true,
  pin_configured: true,
};

const modalStub = {
  props: ["isOpen", "title", "description"],
  template: `
    <section v-if="isOpen" :data-modal-title="title">
      <h2>{{ title }}</h2>
      <p v-if="description">{{ description }}</p>
      <slot />
    </section>
  `,
};

enableAutoUnmount(afterEach);

function mountEmployees() {
  return mount(CrmEmployees, {
    global: {
      stubs: {
        StaffShiftBar: { template: "<div />" },
        StaffAccessModal: { template: "<div />" },
        StaffTasksModal: { template: "<div />" },
        AdminModal: modalStub,
      },
    },
  });
}

describe("CrmEmployees: вход сотрудника", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    // График строится по текущему месяцу, а фикстуры ниже за июль. Без
    // фиксированной даты тесты начинали падать первого числа следующего месяца.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T12:00:00.000Z"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("сам загружает личные показатели после появления допуска", async () => {
    const store = useCrmStore();
    store.$patch({ staffTrackingEnabled: true });
    vi.spyOn(store, "fetchStaffSettings").mockResolvedValue({
      trackingEnabled: true,
      orderShiftRestrictionEnabled: false,
    });
    const analytics: StaffAnalytics = {
      employee: {
        id: "employee-1",
        first_name: "Павел",
        last_name: "Сергеевич",
        position: "Продавец",
        responsibilities: ["Заказы и поставки"],
        active: true,
      },
      worked_minutes: 240,
      shifts_count: 1,
      estimated_salary: 1450.5,
      mark_counts: { positive: 1, negative: 0 },
    };
    const fetchAnalytics = vi
      .spyOn(store, "fetchStaffAnalytics")
      .mockImplementation(async () => {
        store.$patch({ staffAnalytics: analytics });
        return analytics;
      });
    vi.spyOn(store, "fetchStaffMarks").mockResolvedValue([]);

    const wrapper = mount(CrmEmployees, {
      global: {
        stubs: {
          StaffShiftBar: { template: "<div />" },
          StaffAccessModal: { template: "<div />" },
          StaffTasksModal: { template: "<div />" },
          AdminModal: { template: "<div />" },
        },
      },
    });
    await flushPromises();

    store.$patch({
      staffToken: "employee-token",
      staffIdentity: {
        role: "employee",
        employee: {
          id: "employee-1",
          first_name: "Павел",
          last_name: "Сергеевич",
          position: "Продавец",
          active: true,
        },
      },
    });
    await nextTick();
    await flushPromises();

    expect(fetchAnalytics).toHaveBeenCalledWith(
      expect.objectContaining({ employeeId: "employee-1", period: "month" }),
    );
    expect(wrapper.text()).toContain("Павел Сергеевич");
    expect(wrapper.text().replace(/\s/g, " ")).toContain("1 450,5 BYN");
    expect(
      wrapper.get('[data-testid="staff-card-layout"]').classes(),
    ).not.toContain("lg:grid-cols-[260px_minmax(0,1fr)]");
  });

  it("показывает, что ожидаемая зарплата ещё не указана, и даёт доступное описание графика", async () => {
    const store = useCrmStore();
    store.$patch({
      staffTrackingEnabled: true,
      staffToken: "employee-token",
      staffIdentity: { role: "employee", employee },
    });
    vi.spyOn(store, "fetchStaffSettings").mockResolvedValue({
      trackingEnabled: true,
      orderShiftRestrictionEnabled: false,
    });
    const analytics: StaffAnalytics = {
      employee,
      worked_minutes: 60,
      estimated_salary: null,
      daily_activity: [
        { date: "2026-07-01T00:00:00.000Z", count: 1 },
        { date: "2026-07-02T00:00:00.000Z", count: 3 },
      ],
    };
    vi.spyOn(store, "fetchStaffAnalytics").mockImplementation(async () => {
      store.$patch({ staffAnalytics: analytics });
      return analytics;
    });
    vi.spyOn(store, "fetchStaffMarks").mockResolvedValue([]);

    const wrapper = mountEmployees();
    await flushPromises();

    expect(wrapper.text()).toContain("Ожидаемая зарплата");
    expect(wrapper.text()).toContain("Не указана");
    expect(wrapper.text()).not.toContain("не означает факт выплаты");
    expect(wrapper.get('[role="img"]').attributes("aria-label")).toContain(
      "1 июля: 1 действие",
    );
    expect(wrapper.get('[role="img"]').attributes("aria-label")).toContain(
      "2 июля: 3 действия",
    );
  });

  it("на графике плюсы совпадают с числом в плитке", async () => {
    const store = useCrmStore();
    store.$patch({
      staffTrackingEnabled: true,
      staffToken: "employee-token",
      staffIdentity: { role: "employee", employee },
    });
    vi.spyOn(store, "fetchStaffSettings").mockResolvedValue({
      trackingEnabled: true,
    });
    // Плюсы: 5 автоматических (документы и задачи) и 2 ручных.
    const analytics: StaffAnalytics = {
      employee,
      mark_counts: {
        positive: 7,
        negative: 1,
        manual_positive: 2,
        manual_negative: 1,
        system_positive: 5,
      },
      daily_activity: [
        {
          date: "2026-07-01T00:00:00.000Z",
          marks: { positive: 3, negative: 0, manual_positive: 1, system_positive: 2 },
        },
        {
          date: "2026-07-02T00:00:00.000Z",
          marks: { positive: 4, negative: 1, manual_positive: 1, system_positive: 3 },
        },
      ],
    };
    vi.spyOn(store, "fetchStaffAnalytics").mockImplementation(async () => {
      store.$patch({ staffAnalytics: analytics });
      return analytics;
    });
    vi.spyOn(store, "fetchStaffMarks").mockResolvedValue([]);

    const wrapper = mountEmployees();
    await flushPromises();

    // Плитка: одно число с расшифровкой.
    expect(wrapper.text()).toContain("из них вручную 2");

    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Плюсы")!
      .trigger("click");
    await flushPromises();

    const label = wrapper.get('[role="img"]').attributes("aria-label") || "";
    expect(label).toContain("1 июля: 3 плюса");
    expect(label).toContain("2 июля: 4 плюса");
  });

  it("показывает руководителю цель и текущие значения в денежных, ручных и сменных формах", async () => {
    const store = useCrmStore();
    const salary = {
      id: "salary-1",
      employee_id: employee.id,
      employee_name: "Павел Сергеевич",
      month: "2026-07",
      final_amount: 1450.5,
      status: "published",
      note: "Ожидаемая сумма",
    };
    const mark = {
      id: "mark-1",
      employee_id: employee.id,
      kind: "positive" as const,
      title: "Аккуратно принял поставку",
      description: "Без расхождений",
      occurred_at: "2026-07-25T06:55:00.000Z",
      current_version: 1,
    };
    const shift = {
      id: "shift-1",
      employee_id: employee.id,
      employee,
      status: "closed",
      started_at: "2026-07-24T07:00:00.000Z",
      ended_at: "2026-07-24T15:00:00.000Z",
      version: 1,
    };
    store.$patch({
      staffTrackingEnabled: true,
      staffToken: "manager-token",
      staffIdentity: { role: "manager", employee: manager },
      staffEmployees: [manager, employee],
      staffSalaries: [salary],
      staffMarks: [mark],
      staffShiftHistory: [shift],
    });
    vi.spyOn(store, "fetchStaffSettings").mockResolvedValue({
      trackingEnabled: true,
      orderShiftRestrictionEnabled: true,
    });
    vi.spyOn(store, "fetchStaffEmployees").mockResolvedValue([manager, employee]);
    vi.spyOn(store, "fetchStaffAnalytics").mockImplementation(async () => {
      const analytics: StaffAnalytics = { employee: manager };
      store.$patch({ staffAnalytics: analytics });
      return analytics;
    });
    vi.spyOn(store, "fetchStaffMarks").mockResolvedValue([mark]);
    vi.spyOn(store, "fetchStaffSalaries").mockResolvedValue([salary]);
    vi.spyOn(store, "fetchStaffShiftHistory").mockResolvedValue([shift]);

    const wrapper = mountEmployees();
    await flushPromises();

    const sectionSelect = wrapper.get("#staff-manager-section");
    expect(sectionSelect.findAll("option")).toHaveLength(7);

    await sectionSelect.setValue("salaries");
    await flushPromises();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Изменить")!
      .trigger("click");
    const salaryModal = wrapper.get('[data-modal-title="Ожидаемая зарплата"]');
    expect(salaryModal.text()).toContain("Павел Сергеевич");
    expect(salaryModal.text().toLocaleLowerCase("ru")).toContain("июль");
    expect(salaryModal.text()).toContain("2026");
    expect(salaryModal.text().replace(/\s/g, " ")).toContain("1 450,5 BYN");
    expect(salaryModal.text()).toContain("Ожидаемая зарплата, BYN");
    expect(salaryModal.text()).toContain("Сохранить сумму");
    await salaryModal
      .findAll("button")
      .find((button) => button.text() === "Отмена")!
      .trigger("click");

    await sectionSelect.setValue("marks");
    await flushPromises();
    const marksEmployeeSelect = wrapper.get(
      '[aria-label="Сотрудник для отметок"]',
    );
    await marksEmployeeSelect.setValue(employee.id);
    await flushPromises();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Изменить")!
      .trigger("click");
    const markModal = wrapper.get('[data-modal-title="Изменить отметку"]');
    const markContext = markModal.get('[aria-label="Текущая отметка"]');
    expect(markContext.text()).toContain("Павел Сергеевич");
    expect(markContext.text()).toContain("Положительная");
    expect(markContext.text()).toContain("Аккуратно принял поставку");
    expect(markModal.text()).toContain("Сохранить изменения");
    await markModal
      .findAll("button")
      .find((button) => button.text() === "Отмена")!
      .trigger("click");
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Аннулировать")!
      .trigger("click");
    const voidMarkModal = wrapper.get(
      '[data-modal-title="Аннулировать отметку «Аккуратно принял поставку»?"]',
    );
    expect(voidMarkModal.text()).toContain("Сотрудник: Павел Сергеевич.");
    expect(voidMarkModal.text()).toContain("Запись останется в истории");
    await voidMarkModal
      .findAll("button")
      .find((button) => button.text() === "Отмена")!
      .trigger("click");

    await sectionSelect.setValue("shifts");
    await flushPromises();
    await wrapper
      .get('[aria-label="Сотрудник для истории смен"]')
      .setValue(employee.id);
    await flushPromises();
    expect(wrapper.get('[aria-label="Месяц истории смен"]').exists()).toBe(true);
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Исправить время")!
      .trigger("click");
    expect(wrapper.text()).toContain("Журнал смен");
    expect(wrapper.text()).toContain(
      "Проверяйте время работы и исправляйте неточности.",
    );
    expect(wrapper.text()).toContain("Начало:");
    expect(wrapper.text()).toContain("Окончание:");
    expect(wrapper.text()).toContain("Смена ещё идёт");
    expect(wrapper.text()).toContain("Время смены исправляли");
    const shiftModal = wrapper.get('[data-modal-title="Исправить время смены"]');
    expect(shiftModal.text()).toContain("Павел Сергеевич");
    expect(shiftModal.text()).toContain("Текущее время");
    expect(shiftModal.text()).toContain(
      "Измените начало или окончание смены и укажите причину.",
    );
    expect(shiftModal.text()).toContain("Сохранить время");
  });

  it("объясняет, что выключение учёта снимает обязательную смену", async () => {
    const store = useCrmStore();
    store.$patch({
      staffTrackingEnabled: true,
      staffToken: "manager-token",
      staffIdentity: { role: "manager", employee: manager },
      staffEmployees: [manager],
    });
    vi.spyOn(store, "fetchStaffSettings").mockResolvedValue({
      trackingEnabled: true,
    });
    vi.spyOn(store, "fetchStaffEmployees").mockResolvedValue([manager]);
    vi.spyOn(store, "fetchStaffAnalytics").mockImplementation(async () => {
      const analytics: StaffAnalytics = { employee: manager };
      store.$patch({ staffAnalytics: analytics });
      return analytics;
    });
    vi.spyOn(store, "fetchStaffMarks").mockResolvedValue([]);
    const updateTracking = vi.spyOn(store, "updateStaffTracking");
    const wrapper = mountEmployees();
    await flushPromises();
    await wrapper.get("#staff-manager-section").setValue("settings");
    await flushPromises();

    // Отдельного выключателя обязательной смены в разделе больше нет.
    expect(wrapper.text()).not.toContain("Включить ограничение");
    expect(wrapper.text()).not.toContain("Выключить ограничение");

    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Выключить")!
      .trigger("click");
    const trackingConfirmation = wrapper.get(
      '[data-modal-title="Выключить общий учёт?"]',
    );
    expect(trackingConfirmation.text()).toContain("Открытая смена закроется");
    expect(trackingConfirmation.text()).toContain(
      "заказы снова можно будет менять без смены",
    );
    expect(updateTracking).not.toHaveBeenCalled();
  });

  it("показывает сотрудников без ПИНа и позволяет сразу настроить доступ", async () => {
    const employeeWithoutPin = {
      ...employee,
      id: "employee-without-pin",
      first_name: "Алина",
      last_name: null,
      position: "Старший продавец",
      pin_configured: false,
    };
    const store = useCrmStore();
    store.$patch({
      staffTrackingEnabled: true,
      staffToken: "manager-token",
      staffIdentity: { role: "manager", employee: manager },
      staffEmployees: [manager, employee, employeeWithoutPin],
    });
    vi.spyOn(store, "fetchStaffSettings").mockResolvedValue({
      trackingEnabled: true,
      orderShiftRestrictionEnabled: false,
    });
    const fetchEmployees = vi.spyOn(store, "fetchStaffEmployees").mockResolvedValue([
      manager,
      employee,
      employeeWithoutPin,
    ]);
    vi.spyOn(store, "fetchStaffAnalytics").mockImplementation(async () => {
      const analytics: StaffAnalytics = { employee: manager };
      store.$patch({ staffAnalytics: analytics });
      return analytics;
    });
    vi.spyOn(store, "fetchStaffMarks").mockResolvedValue([]);
    const resetPin = vi
      .spyOn(store, "resetStaffEmployeePin")
      .mockRejectedValueOnce(new Error("Этот ПИН уже используется"))
      .mockImplementation(async (id) => {
        const updated = { ...employeeWithoutPin, pin_configured: true };
        store.$patch({
          staffEmployees: store.staffEmployees.map((item) =>
            item.id === id ? updated : item,
          ),
        });
        return updated;
      });

    const wrapper = mountEmployees();
    await flushPromises();
    const employeeLoadsBeforeSettings = fetchEmployees.mock.calls.length;
    await wrapper.get("#staff-manager-section").setValue("settings");
    await flushPromises();
    expect(fetchEmployees.mock.calls.length).toBeGreaterThan(
      employeeLoadsBeforeSettings,
    );

    const panel = wrapper.get('[data-testid="staff-pin-setup-panel"]');
    expect(panel.text()).toContain("Сотрудники без ПИН: 1");
    expect(panel.text()).toContain("Алина");
    expect(panel.text()).not.toContain("null");
    expect(panel.text()).not.toContain("Павел Сергеевич");
    expect(wrapper.text().replace(/\s/g, " ")).toContain("2 из 3");

    const setupPinButton = panel
      .findAll("button")
      .find((button) => button.text() === "Настроить ПИН")!;
    store.$patch({ staffEmployeesLoading: true });
    await nextTick();
    expect(setupPinButton.attributes("disabled")).toBeDefined();
    store.$patch({ staffEmployeesLoading: false });
    await nextTick();
    await setupPinButton.trigger("click");
    await nextTick();

    const modal = wrapper.get('[data-modal-title="Настроить ПИН: Алина"]');
    expect(modal.text()).toContain("ПИН не будет показан снова");
    const pinInputs = modal.findAll('input[type="password"]');
    expect(pinInputs).toHaveLength(2);
    await pinInputs[0].setValue("2468");
    await pinInputs[1].setValue("1357");
    expect(modal.text()).toContain("ПИНы не совпадают");
    expect(
      modal
        .findAll("button")
        .find((button) => button.text() === "Сохранить ПИН")!
        .attributes("disabled"),
    ).toBeDefined();

    await pinInputs[1].setValue("2468");
    expect(modal.text()).not.toContain("ПИНы не совпадают");
    await modal.get("form").trigger("submit");
    await flushPromises();

    expect(resetPin).toHaveBeenCalledTimes(1);
    expect(modal.text()).toContain("Этот ПИН уже используется");
    expect(wrapper.find('[data-testid="staff-pin-setup-panel"]').exists()).toBe(
      true,
    );

    await pinInputs[0].setValue("3579");
    await pinInputs[1].setValue("3579");
    await modal.get("form").trigger("submit");
    await flushPromises();

    expect(resetPin).toHaveBeenCalledTimes(2);
    expect(resetPin).toHaveBeenLastCalledWith(employeeWithoutPin.id, "3579");
    expect(wrapper.find('[data-testid="staff-pin-setup-panel"]').exists()).toBe(
      false,
    );
    expect(wrapper.text().replace(/\s/g, " ")).toContain("3 из 3");
    expect(wrapper.text()).toContain("ПИН настроен: Алина");
  });

  it("не обходит основной пароль при настройке ПИНа руководителя", async () => {
    const managerWithoutPin = {
      ...manager,
      id: "manager-without-pin",
      first_name: "Мария",
      last_name: "Орлова",
      pin_configured: false,
    };
    const store = useCrmStore();
    store.$patch({
      staffTrackingEnabled: true,
      staffToken: "manager-token",
      staffIdentity: { role: "manager", employee: manager },
      staffEmployees: [manager, managerWithoutPin],
    });
    vi.spyOn(store, "fetchStaffSettings").mockResolvedValue({
      trackingEnabled: true,
      orderShiftRestrictionEnabled: false,
    });
    vi.spyOn(store, "fetchStaffEmployees").mockResolvedValue([
      manager,
      managerWithoutPin,
    ]);
    vi.spyOn(store, "fetchStaffAnalytics").mockImplementation(async () => {
      const analytics: StaffAnalytics = { employee: manager };
      store.$patch({ staffAnalytics: analytics });
      return analytics;
    });
    vi.spyOn(store, "fetchStaffMarks").mockResolvedValue([]);
    vi.spyOn(store, "fetchStaffRecoveryManagerCandidates").mockResolvedValue([
      manager,
      managerWithoutPin,
    ]);
    const resetPin = vi.spyOn(store, "resetStaffEmployeePin");
    const recoverPin = vi
      .spyOn(store, "recoverStaffManager")
      .mockImplementation(async () => {
        const updated = { ...managerWithoutPin, pin_configured: true };
        store.$patch({
          staffEmployees: store.staffEmployees.map((item) =>
            item.id === managerWithoutPin.id ? updated : item,
          ),
        });
        return updated;
      });
    const lockAccess = vi.spyOn(store, "lockStaffAccess");
    const accessStaff = vi.spyOn(store, "accessStaff");

    const wrapper = mountEmployees();
    await flushPromises();
    await wrapper.get("#staff-manager-section").setValue("settings");
    await flushPromises();

    const row = wrapper.get(
      '[data-testid="staff-pin-missing-manager-without-pin"]',
    );
    await row
      .findAll("button")
      .find((button) => button.text() === "Настроить ПИН руководителя")!
      .trigger("click");
    await nextTick();

    const modal = wrapper.get(
      '[data-modal-title="Настроить ПИН руководителя"]',
    );
    expect(modal.text()).toContain("Основной пароль CRM");
    expect(modal.text()).toContain("Проверить пароль");
    const checkPasswordButton = modal
      .findAll("button")
      .find((button) => button.text() === "Проверить пароль")!;
    expect(checkPasswordButton.attributes("disabled")).toBeDefined();
    await modal.get('input[autocomplete="current-password"]').setValue("998811");
    expect(checkPasswordButton.attributes("disabled")).toBeUndefined();
    await checkPasswordButton.trigger("click");
    await flushPromises();

    expect((modal.get("select").element as HTMLSelectElement).value).toBe(
      managerWithoutPin.id,
    );
    const pinInputs = modal.findAll('input[autocomplete="new-password"]');
    expect(pinInputs).toHaveLength(2);
    await pinInputs[0].setValue("1234");
    await pinInputs[1].setValue("4321");
    expect(modal.text()).toContain("ПИНы не совпадают");
    expect(
      modal
        .findAll("button")
        .find((button) => button.text() === "Сохранить ПИН")!
        .attributes("disabled"),
    ).toBeDefined();
    await pinInputs[1].setValue("1234");
    expect(modal.text()).not.toContain("ПИНы не совпадают");
    await modal.get("form").trigger("submit");
    await flushPromises();

    expect(recoverPin).toHaveBeenCalledWith({
      admin_password: "998811",
      employee_id: managerWithoutPin.id,
      new_pin: "1234",
    });
    expect(lockAccess).not.toHaveBeenCalled();
    expect(accessStaff).not.toHaveBeenCalled();
    expect(store.staffIdentity?.employee.id).toBe(manager.id);
    expect(wrapper.get("#staff-manager-section").element).toHaveProperty(
      "value",
      "settings",
    );
    expect(wrapper.text()).toContain("ПИН руководителя настроен");
    expect(
      wrapper.find(
        '[data-testid="staff-pin-missing-manager-without-pin"]',
      ).exists(),
    ).toBe(false);
    expect(resetPin).not.toHaveBeenCalled();
  });

  it("не подставляет другого руководителя, если выбранный уже недоступен", async () => {
    const managerWithoutPin = {
      ...manager,
      id: "manager-without-pin",
      first_name: "Мария",
      last_name: "Орлова",
      pin_configured: false,
    };
    const store = useCrmStore();
    store.$patch({
      staffTrackingEnabled: true,
      staffToken: "manager-token",
      staffIdentity: { role: "manager", employee: manager },
      staffEmployees: [manager, managerWithoutPin],
    });
    vi.spyOn(store, "fetchStaffSettings").mockResolvedValue({
      trackingEnabled: true,
      orderShiftRestrictionEnabled: false,
    });
    vi.spyOn(store, "fetchStaffEmployees").mockResolvedValue([
      manager,
      managerWithoutPin,
    ]);
    vi.spyOn(store, "fetchStaffAnalytics").mockResolvedValue({
      employee: manager,
    } as StaffAnalytics);
    vi.spyOn(store, "fetchStaffMarks").mockResolvedValue([]);
    vi.spyOn(store, "fetchStaffRecoveryManagerCandidates").mockResolvedValue([
      manager,
    ]);
    const recoverPin = vi.spyOn(store, "recoverStaffManager");

    const wrapper = mountEmployees();
    await flushPromises();
    await wrapper.get("#staff-manager-section").setValue("settings");
    await flushPromises();
    const row = wrapper.get(
      '[data-testid="staff-pin-missing-manager-without-pin"]',
    );
    await row
      .findAll("button")
      .find((button) => button.text() === "Настроить ПИН руководителя")!
      .trigger("click");

    const modal = wrapper.get(
      '[data-modal-title="Настроить ПИН руководителя"]',
    );
    await modal.get('input[autocomplete="current-password"]').setValue("998811");
    await modal
      .findAll("button")
      .find((button) => button.text() === "Проверить пароль")!
      .trigger("click");
    await flushPromises();

    expect(modal.text()).toContain("Этот руководитель больше недоступен");
    expect((modal.get("select").element as HTMLSelectElement).value).toBe("");
    expect(
      modal
        .findAll("button")
        .find((button) => button.text() === "Сохранить ПИН")!
        .attributes("disabled"),
    ).toBeDefined();
    expect(recoverPin).not.toHaveBeenCalled();
  });

  it("не теряет карточку после просмотра смен всей команды и показывает архив", async () => {
    const formerEmployee = {
      ...employee,
      id: "employee-former",
      first_name: "Анна",
      last_name: "Бывшая",
      active: false,
    };
    const store = useCrmStore();
    store.$patch({
      staffTrackingEnabled: true,
      staffToken: "manager-token",
      staffIdentity: { role: "manager", employee: manager },
      staffEmployees: [manager, employee, formerEmployee],
    });
    vi.spyOn(store, "fetchStaffSettings").mockResolvedValue({
      trackingEnabled: true,
      orderShiftRestrictionEnabled: false,
    });
    vi.spyOn(store, "fetchStaffEmployees").mockResolvedValue([
      manager,
      employee,
      formerEmployee,
    ]);
    vi.spyOn(store, "fetchStaffAnalytics").mockImplementation(
      async ({ employeeId }) => {
        const selected = [manager, employee, formerEmployee].find(
          (item) => item.id === employeeId,
        );
        const analytics: StaffAnalytics = { employee: selected };
        store.$patch({ staffAnalytics: analytics });
        return analytics;
      },
    );
    vi.spyOn(store, "fetchStaffMarks").mockResolvedValue([]);
    vi.spyOn(store, "fetchStaffShiftHistory").mockResolvedValue([]);

    const wrapper = mountEmployees();
    await flushPromises();
    expect(wrapper.text()).not.toContain("Обязанности сотрудника");
    expect(
      wrapper.find('[aria-label="Обязанности сотрудника"]').exists(),
    ).toBe(false);
    const sectionSelect = wrapper.get("#staff-manager-section");
    const cardEmployeeSelect = wrapper.get(
      '[aria-label="Сотрудник в карточке"]',
    );
    expect(cardEmployeeSelect.text()).toContain("Анна Бывшая");
    await cardEmployeeSelect.setValue(employee.id);
    await flushPromises();

    await sectionSelect.setValue("shifts");
    await flushPromises();
    await wrapper
      .get('[aria-label="Сотрудник для истории смен"]')
      .setValue("");
    await flushPromises();
    await sectionSelect.setValue("card");
    await flushPromises();

    expect(wrapper.text()).toContain("Павел Сергеевич");
    expect(wrapper.text()).not.toContain("Сотрудник не выбран");
  });

  it("показывает руководителю сравнимые показатели всей команды за период", async () => {
    const store = useCrmStore();
    store.$patch({
      staffTrackingEnabled: true,
      staffToken: "manager-token",
      staffIdentity: { role: "manager", employee: manager },
      staffEmployees: [manager, employee],
    });
    vi.spyOn(store, "fetchStaffSettings").mockResolvedValue({
      trackingEnabled: true,
      orderShiftRestrictionEnabled: true,
    });
    vi.spyOn(store, "fetchStaffEmployees").mockResolvedValue([manager, employee]);
    vi.spyOn(store, "fetchStaffAnalytics").mockImplementation(async () => {
      const analytics: StaffAnalytics = { employee: manager };
      store.$patch({ staffAnalytics: analytics });
      return analytics;
    });
    vi.spyOn(store, "fetchStaffMarks").mockResolvedValue([]);
    const team = [
      { employee: manager, worked_minutes: 60, shifts_count: 1 },
      {
        employee,
        worked_minutes: 240,
        shifts_count: 3,
        tasks_completed: 2,
        orders_assembled: 5,
        orders_issued: 4,
        orders_amount: 640,
        issued_profit: 220,
        procurements_created: 1,
        procurements_completed: 2,
        transfers_created: 3,
        transfers_completed: 1,
        mark_counts: { positive: 6, negative: 1 },
      },
    ] satisfies StaffAnalytics[];
    const fetchTeam = vi
      .spyOn(store, "fetchStaffTeamAnalytics")
      .mockImplementation(async () => {
        store.$patch({ staffTeamAnalytics: team });
        return team;
      });

    const wrapper = mountEmployees();
    await flushPromises();
    await wrapper.get("#staff-manager-section").setValue("team");
    await flushPromises();

    expect(fetchTeam).toHaveBeenCalledWith(
      expect.objectContaining({ period: "month" }),
    );
    expect(wrapper.text()).not.toContain("без общего искусственного балла");
    expect(wrapper.text()).not.toContain("без общего рейтинга");
    const employeeRow = wrapper
      .findAll("article")
      .find((article) => article.text().includes("Павел Сергеевич"));
    expect(employeeRow).toBeTruthy();
    expect(employeeRow!.text()).toContain("4 ч · 3");
    expect(employeeRow!.text()).toContain("5 / 4");
    expect(employeeRow!.text().replace(/\s/g, " ")).toContain("640 BYN / 220 BYN");
    expect(employeeRow!.text()).toContain("Поставки: создано / принято");
    expect(employeeRow!.text()).toContain("Перемещения: создано / принято");
    expect(employeeRow!.text()).toContain("Плюсы 6");
    expect(employeeRow!.text()).toContain("Минусы 1");

    const actionsButton = employeeRow!
      .findAll("button")
      .find((button) => button.text().includes("Действия"))!;
    expect(actionsButton.attributes("aria-expanded")).toBe("false");
    await actionsButton.trigger("click");
    await nextTick();

    const actionMenu = document.querySelector<HTMLElement>('[role="menu"]');
    expect(actionMenu).not.toBeNull();
    expect(actionMenu!.classList.contains("fixed")).toBe(true);
    expect(actionMenu!.textContent).toContain("Изменить данные");
    expect(actionMenu!.textContent).toContain("Уволить сотрудника");
    expect(document.activeElement?.textContent).toContain("Изменить данные");
    expect(actionsButton.attributes("aria-expanded")).toBe("true");

    actionMenu!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await nextTick();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(actionsButton.attributes("aria-expanded")).toBe("false");

    await actionsButton.trigger("click");
    await nextTick();
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("просит новый ПИН при восстановлении старого сотрудника без ПИНа", async () => {
    const formerEmployee = {
      ...employee,
      id: "employee-former",
      first_name: "Анна",
      last_name: "Бывшая",
      active: false,
      pin_configured: false,
    };
    const store = useCrmStore();
    store.$patch({
      staffTrackingEnabled: true,
      staffToken: "manager-token",
      staffIdentity: { role: "manager", employee: manager },
      staffEmployees: [manager, formerEmployee],
    });
    vi.spyOn(store, "fetchStaffSettings").mockResolvedValue({
      trackingEnabled: true,
      orderShiftRestrictionEnabled: true,
    });
    vi.spyOn(store, "fetchStaffEmployees").mockResolvedValue([
      manager,
      formerEmployee,
    ]);
    vi.spyOn(store, "fetchStaffAnalytics").mockImplementation(async () => {
      const analytics: StaffAnalytics = { employee: manager };
      store.$patch({ staffAnalytics: analytics });
      return analytics;
    });
    vi.spyOn(store, "fetchStaffMarks").mockResolvedValue([]);
    vi.spyOn(store, "fetchStaffTeamAnalytics").mockResolvedValue([
      { employee: manager },
      { employee: formerEmployee },
    ]);
    const restoreEmployee = vi
      .spyOn(store, "restoreStaffEmployee")
      .mockResolvedValue({ ...formerEmployee, active: true, pin_configured: true });

    const wrapper = mountEmployees();
    await flushPromises();
    await wrapper.get("#staff-manager-section").setValue("team");
    await flushPromises();
    await wrapper.get('[aria-label="Статус сотрудника"]').setValue("inactive");
    await flushPromises();

    const formerRow = wrapper
      .findAll("article")
      .find((article) => article.text().includes("Анна Бывшая"));
    expect(formerRow).toBeTruthy();
    await formerRow!
      .findAll("button")
      .find((button) => button.text().includes("Действия"))!
      .trigger("click");
    await nextTick();
    const restoreButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ).find((button) => button.textContent?.trim() === "Восстановить сотрудника");
    expect(restoreButton).toBeTruthy();
    restoreButton!.click();
    await nextTick();

    const modal = wrapper.get(
      '[data-modal-title="Восстановить сотрудника?"]',
    );
    expect(modal.text()).toContain("Сразу задайте ему новый ПИН");
    const pinInput = modal.get('[aria-label="Новый ПИН сотрудника"]');
    await pinInput.setValue("1234");
    await modal
      .findAll("button")
      .find((button) => button.text() === "Восстановить")!
      .trigger("click");
    await flushPromises();

    expect(restoreEmployee).toHaveBeenCalledWith(formerEmployee.id, {
      newPin: "1234",
      adminPassword: undefined,
    });
  });

  it("показывает длинную историю смен порциями", async () => {
    const store = useCrmStore();
    const shifts = Array.from({ length: 25 }, (_, index) => ({
      id: `shift-${index}`,
      employee_id: employee.id,
      employee,
      employee_name: "Павел Сергеевич",
      business_date: `2026-07-${String(index + 1).padStart(2, "0")}`,
      status: "closed",
      started_at: `2026-07-${String(index + 1).padStart(2, "0")}T07:00:00.000Z`,
      ended_at: `2026-07-${String(index + 1).padStart(2, "0")}T15:00:00.000Z`,
      version: 1,
    }));
    store.$patch({
      staffTrackingEnabled: true,
      staffToken: "manager-token",
      staffIdentity: { role: "manager", employee: manager },
      staffEmployees: [manager, employee],
      staffShiftHistory: shifts,
    });
    vi.spyOn(store, "fetchStaffSettings").mockResolvedValue({
      trackingEnabled: true,
      orderShiftRestrictionEnabled: false,
    });
    vi.spyOn(store, "fetchStaffEmployees").mockResolvedValue([manager, employee]);
    vi.spyOn(store, "fetchStaffAnalytics").mockImplementation(async () => {
      const analytics: StaffAnalytics = { employee: manager };
      store.$patch({ staffAnalytics: analytics });
      return analytics;
    });
    vi.spyOn(store, "fetchStaffMarks").mockResolvedValue([]);
    vi.spyOn(store, "fetchStaffShiftHistory").mockResolvedValue(shifts);

    const wrapper = mountEmployees();
    await flushPromises();
    await wrapper.get("#staff-manager-section").setValue("shifts");
    await flushPromises();

    expect(
      wrapper.findAll('[data-testid="staff-shift-history-item"]'),
    ).toHaveLength(20);
    expect(
      wrapper.get('[data-testid="staff-shift-history-more"]').text(),
    ).toContain("Показать ещё 5");
    await wrapper
      .get('[data-testid="staff-shift-history-more"]')
      .trigger("click");
    expect(
      wrapper.findAll('[data-testid="staff-shift-history-item"]'),
    ).toHaveLength(25);
  });

  it("не растягивает журнал действий и раскрывает его порциями", async () => {
    const store = useCrmStore();
    const activities = Array.from({ length: 15 }, (_, index) => ({
      id: `event-${index}`,
      type: "order_issued",
      title: `Заказ выдан ${index + 1}`,
      description: `Тестовая операция ${index + 1}`,
      occurred_at: `2026-07-${String(15 - index).padStart(2, "0")}T10:00:00.000Z`,
    }));
    const analytics = {
      employee: manager,
      activities,
      daily_activity: [],
    } as StaffAnalytics;
    store.$patch({
      staffTrackingEnabled: true,
      staffToken: "manager-token",
      staffIdentity: { role: "manager", employee: manager },
      staffEmployees: [manager, employee],
    });
    vi.spyOn(store, "fetchStaffSettings").mockResolvedValue({
      trackingEnabled: true,
      orderShiftRestrictionEnabled: false,
    });
    vi.spyOn(store, "fetchStaffEmployees").mockResolvedValue([manager, employee]);
    vi.spyOn(store, "fetchStaffAnalytics").mockImplementation(async () => {
      store.$patch({ staffAnalytics: analytics });
      return analytics;
    });
    vi.spyOn(store, "fetchStaffMarks").mockResolvedValue([]);

    const wrapper = mountEmployees();
    await flushPromises();

    expect(wrapper.findAll('[data-testid="staff-timeline-item"]')).toHaveLength(
      12,
    );
    expect(wrapper.get('[data-testid="staff-timeline-more"]').text()).toContain(
      "Показать ещё 3",
    );
    await wrapper.get('[data-testid="staff-timeline-more"]').trigger("click");
    expect(wrapper.findAll('[data-testid="staff-timeline-item"]')).toHaveLength(
      15,
    );

    await wrapper.get('[aria-label="Тип действий"]').setValue("tasks");
    expect(wrapper.text()).toContain("По выбранному фильтру записей нет");
  });

  it("не показывает служебные коды и ошибки Telegram руководителю", async () => {
    const store = useCrmStore();
    const notifications = {
      settings: [
        { event_group: "documents", enabled: true },
        { event_group: "tasks", enabled: true },
        { event_group: "salary", enabled: true },
      ],
      recipients: [
        {
          id: "recipient-1",
          event_group: "tasks",
          display_name: "Иван",
          telegram_username: "ivan_manager",
          telegram_id: "123456789",
        },
      ],
      outbox: [
        {
          id: "outbox-1",
          event_type: "unknown_internal_event",
          status: "failed",
          attempts: 2,
          recipient_username: "ivan_manager",
          recipient_telegram_id: "123456789",
          telegram_message_id: 777,
          last_error: "ETELEGRAM: chat not found",
          created_at: "2026-07-27T10:00:00.000Z",
        },
      ],
    };
    store.$patch({
      staffTrackingEnabled: true,
      staffToken: "manager-token",
      staffIdentity: { role: "manager", employee: manager },
      staffEmployees: [manager, employee],
      staffNotifications: notifications,
    });
    vi.spyOn(store, "fetchStaffSettings").mockResolvedValue({
      trackingEnabled: true,
      orderShiftRestrictionEnabled: false,
    });
    vi.spyOn(store, "fetchStaffEmployees").mockResolvedValue([manager, employee]);
    vi.spyOn(store, "fetchStaffAnalytics").mockImplementation(async () => {
      const analytics: StaffAnalytics = { employee: manager };
      store.$patch({ staffAnalytics: analytics });
      return analytics;
    });
    vi.spyOn(store, "fetchStaffMarks").mockResolvedValue([]);
    vi.spyOn(store, "fetchStaffNotifications").mockImplementation(async () => {
      store.$patch({ staffNotifications: notifications });
      return notifications;
    });

    const wrapper = mountEmployees();
    await flushPromises();
    await wrapper.get("#staff-manager-section").setValue("notifications");
    await flushPromises();

    expect(wrapper.text()).toContain("Внутреннее уведомление");
    expect(wrapper.text()).toContain("Не доставлено");
    expect(wrapper.text()).toContain(
      "Не удалось доставить уведомление. Проверьте получателя.",
    );
    expect(wrapper.text()).not.toContain("unknown_internal_event");
    expect(wrapper.text()).not.toContain("ETELEGRAM");
    expect(wrapper.text()).not.toContain("123456789");
    expect(wrapper.text()).not.toContain("777");
  });
});
