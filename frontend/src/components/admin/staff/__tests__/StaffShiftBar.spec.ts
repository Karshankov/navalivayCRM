import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import StaffShiftBar from "@/components/admin/staff/StaffShiftBar.vue";
import { useCrmStore } from "@/stores/crm";

function mountBar() {
  return mount(StaffShiftBar, {
    global: {
      stubs: {
        AdminModal: {
          props: ["isOpen", "description"],
          template: '<section v-if="isOpen"><p>{{ description }}</p><slot /></section>',
        },
        StaffAccessModal: true,
        StaffTasksModal: true,
      },
    },
  });
}

describe("StaffShiftBar", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it.each([true, false])('keeps financial closing separately accessible with tracking enabled=%s', async enabled => {
    const store = useCrmStore();
    store.$patch({ staffTrackingEnabled: enabled });
    vi.spyOn(store, 'fetchStaffSettings').mockResolvedValue({ trackingEnabled: enabled, orderShiftRestrictionEnabled: enabled });
    vi.spyOn(store, 'fetchStaffShift').mockResolvedValue(null);
    const wrapper = mount(StaffShiftBar, {
      slots: { 'financial-close': '<button data-test="financial-close-slot">Закрыть финансовый день</button>' },
      global: { stubs: { AdminModal: true, StaffAccessModal: true, StaffTasksModal: true } },
    });
    try {
      await flushPromises();
      expect(wrapper.findAll('[data-test="financial-close-slot"]')).toHaveLength(1);
      expect(wrapper.get('[data-test="shift-financial-action"]').text()).toContain('Закрыть финансовый день');
      expect(wrapper.find('[data-test="shift-manual-close"]').exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });

  it.each([false, true])('requires confirmation for manual closing and handles failure=%s', async fails => {
    const store = useCrmStore();
    store.$patch({ staffTrackingEnabled: true, staffToken: 'employee-token',
      staffIdentity: { role: 'employee', employee: { id: 'employee-1', first_name: 'Анна', last_name: 'Иванова', role: 'employee', active: true, position: null } },
      currentStaffShift: { id: 'shift-1', version: 1, employee_id: 'employee-1', status: 'active', started_at: new Date().toISOString() },
    });
    vi.spyOn(store, 'fetchStaffSettings').mockResolvedValue({ trackingEnabled: true, orderShiftRestrictionEnabled: true });
    vi.spyOn(store, 'fetchStaffShift').mockResolvedValue(store.currentStaffShift);
    vi.spyOn(store, 'refreshStaffWorkspace').mockResolvedValue(undefined);
    vi.spyOn(store, 'fetchStaffTasks').mockResolvedValue(undefined as never);
    const close = vi.spyOn(store, 'closeStaffShift');
    if (fails) close.mockRejectedValue(new Error('Не удалось закрыть смену'));
    else close.mockResolvedValue(undefined as never);
    const wrapper = mountBar();
    try {
      await flushPromises();
      expect(wrapper.find('[data-test="shift-extra-actions"]').exists()).toBe(false);
      expect(wrapper.text()).not.toContain('Дополнительно');
      const manual = wrapper.get('[data-test="shift-manual-close"]');
      expect(manual.text()).toBe('Закрыть смену');
      await manual.trigger('click');
      expect(wrapper.text()).toContain('После закрытия рабочие действия потребуют открытия новой смены.');
      expect(close).not.toHaveBeenCalled();
      const cancel = wrapper.findAll('button').find(button => button.text() === 'Продолжить смену')!;
      await cancel.trigger('click');
      expect(close).not.toHaveBeenCalled();
      expect(wrapper.text()).not.toContain('Продолжить смену');
      store.$patch({ staffShiftLoading: true });
      await flushPromises();
      await manual.trigger('click');
      expect(wrapper.text()).not.toContain('Продолжить смену');
      store.$patch({ staffShiftLoading: false });
      await flushPromises();
      await manual.trigger('click');
      const confirm = wrapper.findAll('button').find(button => button.text() === 'Закрыть смену' && button.attributes('data-test') !== 'shift-manual-close')!;
      await confirm.trigger('click');
      await flushPromises();
      expect(close).toHaveBeenCalledTimes(1);
      expect(wrapper.text()).toContain(fails ? 'Не удалось закрыть смену' : 'Смена закрыта');
      expect(wrapper.text().includes('Продолжить смену')).toBe(fails);
    } finally { wrapper.unmount(); }
  });

  it.each(['no-access', 'another-employee'])('hides manual closing for %s', async mode => {
    const store = useCrmStore();
    store.$patch({ staffTrackingEnabled: true,
      staffToken: mode === 'no-access' ? '' : 'employee-token',
      staffIdentity: mode === 'no-access' ? null : { role: 'employee', employee: { id: 'employee-2', first_name: 'Анна', last_name: null, role: 'employee', active: true, position: null } },
      currentStaffShift: { id: 'shift-1', version: 1, employee_id: 'employee-1', status: 'active', started_at: new Date().toISOString() },
    });
    vi.spyOn(store, 'fetchStaffSettings').mockResolvedValue({ trackingEnabled: true, orderShiftRestrictionEnabled: true });
    vi.spyOn(store, 'fetchStaffShift').mockResolvedValue(store.currentStaffShift);
    vi.spyOn(store, 'refreshStaffWorkspace').mockResolvedValue(undefined);
    const close = vi.spyOn(store, 'closeStaffShift');
    const wrapper = mountBar();
    try {
      await flushPromises();
      expect(wrapper.find('[data-test="shift-manual-close"]').exists()).toBe(false);
      expect(close).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
  });

  it("не предлагает открыть смену, когда учёт выключен", async () => {
    const store = useCrmStore();
    store.$patch({ staffTrackingEnabled: false });
    vi.spyOn(store, "fetchStaffSettings").mockResolvedValue({
      trackingEnabled: false,
      orderShiftRestrictionEnabled: false,
    });
    const fetchShift = vi.spyOn(store, "fetchStaffShift");

    const wrapper = mountBar();
    await flushPromises();

    expect(wrapper.text()).toContain("Учёт сотрудников выключен");
    expect(wrapper.text()).not.toContain("Открыть смену");
    expect(fetchShift).not.toHaveBeenCalled();
  });

  it("хранит ожидающее действие и защищает ручной повтор от двойного клика", async () => {
    const store = useCrmStore();
    store.$patch({
      staffTrackingEnabled: true,
      staffShiftCandidates: [
        {
          id: "employee-1",
          first_name: "Анна",
          last_name: "Иванова",
        },
      ],
    });
    vi.spyOn(store, "fetchStaffSettings").mockResolvedValue({
      trackingEnabled: true,
      orderShiftRestrictionEnabled: true,
    });
    vi.spyOn(store, "fetchStaffShift").mockResolvedValue(null);
    vi.spyOn(store, "fetchStaffShiftCandidates").mockResolvedValue(
      store.staffShiftCandidates,
    );
    vi.spyOn(store, "openStaffShift").mockResolvedValue({
      id: "shift-1",
      version: 1,
      employee_id: "employee-1",
      status: "active",
    });
    let release!: () => void;
    const retry = vi.fn(
      () => new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const wrapper = mountBar();
    await flushPromises();

    await (wrapper.vm as any).requestShiftRequired("Сохранить заказ", retry);
    expect(wrapper.text()).toContain("10:00");
    expect(wrapper.text()).toContain("21:15");
    (wrapper.vm as any).shiftEmployeeId = "employee-1";
    (wrapper.vm as any).shiftPin = "1234";
    await (wrapper.vm as any).openShift();
    await flushPromises();
    expect(wrapper.text()).toContain("Действие не повторялось");
    expect(retry).not.toHaveBeenCalled();

    const retryButton = wrapper
      .findAll("button")
      .find((button) => button.text() === "Повторить вручную")!;
    await retryButton.trigger("click");
    await retryButton.trigger("click");
    expect(retry).toHaveBeenCalledTimes(1);
    release();
    await flushPromises();
  });

  it("сохраняет ручной повтор, если действие задачи вернуло false", async () => {
    const store = useCrmStore();
    store.$patch({
      staffTrackingEnabled: true,
      staffShiftCandidates: [
        {
          id: "employee-1",
          first_name: "Анна",
          last_name: "Иванова",
        },
      ],
    });
    vi.spyOn(store, "fetchStaffSettings").mockResolvedValue({
      trackingEnabled: true,
      orderShiftRestrictionEnabled: true,
    });
    vi.spyOn(store, "fetchStaffShift").mockResolvedValue(null);
    vi.spyOn(store, "fetchStaffShiftCandidates").mockResolvedValue(
      store.staffShiftCandidates,
    );
    vi.spyOn(store, "openStaffShift").mockResolvedValue({
      id: "shift-1",
      version: 1,
      employee_id: "employee-1",
      status: "active",
    });
    const retry = vi.fn().mockResolvedValue(false);
    const wrapper = mountBar();
    await flushPromises();

    await (wrapper.vm as any).handleTaskShiftRequired({
      label: "Отправить задачу на проверку",
      retry,
    });
    (wrapper.vm as any).shiftEmployeeId = "employee-1";
    (wrapper.vm as any).shiftPin = "1234";
    await (wrapper.vm as any).openShift();
    await flushPromises();

    const retryButton = wrapper
      .findAll("button")
      .find((button) => button.text() === "Повторить вручную")!;
    await retryButton.trigger("click");
    await flushPromises();

    expect(retry).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain("Действие не завершено");
    expect(wrapper.text()).not.toContain(
      "Действие повторено по вашему подтверждению",
    );
    expect((wrapper.vm as any).pendingRetry).not.toBeNull();
    expect((wrapper.vm as any).tasksOpen).toBe(true);
    expect(
      wrapper
        .findAll("button")
        .some((button) => button.text() === "Повторить вручную"),
    ).toBe(true);
  });

  it("отделяет вход в карточку от управления активной сменой", async () => {
    const store = useCrmStore();
    store.$patch({
      staffTrackingEnabled: true,
      currentStaffShift: {
        id: "shift-1",
        version: 1,
        employee_id: "employee-1",
        status: "active",
        started_at: new Date().toISOString(),
      },
    });
    vi.spyOn(store, "fetchStaffSettings").mockResolvedValue({
      trackingEnabled: true,
      orderShiftRestrictionEnabled: true,
    });
    vi.spyOn(store, "fetchStaffShift").mockResolvedValue(store.currentStaffShift);

    const wrapper = mountBar();
    await flushPromises();
    expect(wrapper.text()).toContain("Открыть личную карточку");
    expect(wrapper.text()).not.toContain("Войти к смене");

    store.$patch({
      staffToken: "employee-token",
      staffIdentity: {
        role: "employee",
        employee: {
          id: "employee-1",
          first_name: "Анна",
          last_name: "Иванова",
          role: "employee",
          active: true,
          position: null,
        },
      },
    });
    await flushPromises();
    expect(wrapper.text()).toContain("Выйти из карточки");
    expect(wrapper.text()).not.toContain("Сменить сотрудника");
  });
});
