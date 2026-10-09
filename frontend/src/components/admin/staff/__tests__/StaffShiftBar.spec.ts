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
