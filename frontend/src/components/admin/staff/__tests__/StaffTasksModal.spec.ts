import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import StaffTasksModal from "@/components/admin/staff/StaffTasksModal.vue";
import { useCrmStore, type StaffTask } from "@/stores/crm";

const manager = {
  id: "manager-1",
  first_name: "Константин",
  last_name: "Жмурков",
  role: "manager" as const,
  active: true,
};
const staffEmployee = {
  id: "employee-1",
  first_name: "Павел",
  last_name: "Сергеевич",
  role: "employee" as const,
  active: true,
};

const tasks: StaffTask[] = [
  {
    id: "free-1",
    title: "Проверить витрину",
    description: "Сверить остатки",
    status: "open",
    due_at: "2099-07-28T12:00:00.000Z",
  },
  {
    id: "review-1",
    title: "Пересчитать склад",
    description: "Готово к проверке",
    status: "submitted",
    assignee_employee_id: "employee-1",
    assignee_name: "Павел Сергеевич",
    due_at: "2099-07-27T12:00:00.000Z",
  },
  {
    id: "overdue-1",
    title: "Старая задача",
    description: "Просрочена",
    status: "claimed",
    assignee_employee_id: "employee-1",
    assignee_name: "Павел Сергеевич",
    due_at: "2020-01-01T12:00:00.000Z",
  },
];

const modalStub = {
  props: ["isOpen", "title", "description"],
  template: `
    <section v-if="isOpen">
      <h2>{{ title }}</h2>
      <p>{{ description }}</p>
      <slot />
    </section>
  `,
};

describe("StaffTasksModal: рабочая очередь руководителя", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("выделяет проверку и не предлагает взять задачу во время чужой смены", async () => {
    const store = useCrmStore();
    store.$patch({
      staffToken: "manager-token",
      staffIdentity: { role: "manager", employee: manager },
      staffTasks: tasks,
      currentStaffShift: {
        id: "shift-1",
        version: 1,
        employee_id: "employee-1",
        employee_name: "Павел Сергеевич",
        status: "active",
      },
    });
    vi.spyOn(store, "fetchStaffTasks").mockResolvedValue(tasks);

    const wrapper = mount(StaffTasksModal, {
      props: { open: false },
      global: { stubs: { AdminModal: modalStub } },
    });
    await wrapper.setProps({ open: true });
    await flushPromises();

    expect(wrapper.text()).toContain("Задачи команды");
    expect(wrapper.text()).toContain("На проверке");
    expect(wrapper.text()).toContain("Пересчитать склад");
    expect(wrapper.text()).not.toContain("Проверить витрину");

    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("Активные"))!
      .trigger("click");
    expect(wrapper.text()).toContain("Проверить витрину");
    expect(wrapper.text()).toContain("Сейчас смена Павел Сергеевич");
    expect(
      wrapper.findAll("button").some((button) => button.text() === "Взять задачу"),
    ).toBe(false);

    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("Просрочены"))!
      .trigger("click");
    expect(wrapper.text()).toContain("Старая задача");
    expect(wrapper.text()).toContain("Просрочена");
    expect(wrapper.text()).not.toContain("Проверить витрину");
  });

  it("объясняет пустой список с учётом выбранного фильтра", async () => {
    const store = useCrmStore();
    store.$patch({
      staffToken: "manager-token",
      staffIdentity: { role: "manager", employee: manager },
      staffTasks: [],
    });
    vi.spyOn(store, "fetchStaffTasks").mockResolvedValue([]);

    const wrapper = mount(StaffTasksModal, {
      props: { open: true },
      global: { stubs: { AdminModal: modalStub } },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("Активных задач пока нет");
    expect(wrapper.text()).toContain("Создайте новую задачу");

    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("На проверке"))!
      .trigger("click");
    expect(wrapper.text()).toContain("Нет задач на проверке");

    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("Завершённые"))!
      .trigger("click");
    expect(wrapper.text()).toContain("Завершённых задач пока нет");
  });

  it("не предлагает сдать задачу во время чужой смены", async () => {
    const employeeTask: StaffTask = {
      id: "employee-task",
      title: "Проверить старые резервы",
      description: "Задача Павла",
      status: "claimed",
      assignee_employee_id: staffEmployee.id,
      assignee_name: "Павел Сергеевич",
      due_at: "2099-07-28T12:00:00.000Z",
    };
    const store = useCrmStore();
    store.$patch({
      staffToken: "employee-token",
      staffIdentity: { role: "employee", employee: staffEmployee },
      staffTasks: [employeeTask],
      currentStaffShift: {
        id: "shift-manager",
        version: 1,
        employee_id: manager.id,
        employee_name: "Константин Жмурков",
        status: "active",
      },
    });
    vi.spyOn(store, "fetchStaffTasks").mockResolvedValue([employeeTask]);

    const wrapper = mount(StaffTasksModal, {
      props: { open: false },
      global: { stubs: { AdminModal: modalStub } },
    });
    await wrapper.setProps({ open: true });
    await flushPromises();

    expect(wrapper.text()).toContain("Проверить старые резервы");
    expect(wrapper.text()).toContain(
      "Сейчас смена Константин Жмурков. Сдать задачу можно в своей смене",
    );
    expect(
      wrapper
        .findAll("button")
        .some((button) => button.text() === "Отправить на проверку"),
    ).toBe(false);
  });

  it("объясняет обязательные поля и оставляет все фильтры доступными на телефоне", async () => {
    const store = useCrmStore();
    store.$patch({
      staffToken: "manager-token",
      staffIdentity: { role: "manager", employee: manager },
      staffTasks: tasks,
      currentStaffShift: {
        id: "shift-manager",
        version: 1,
        employee_id: manager.id,
        employee_name: "Константин Жмурков",
        status: "active",
      },
    });
    vi.spyOn(store, "fetchStaffTasks").mockResolvedValue(tasks);

    const wrapper = mount(StaffTasksModal, {
      props: { open: true },
      global: { stubs: { AdminModal: modalStub } },
    });
    await flushPromises();

    const filterGroup = wrapper.get('[role="group"][aria-label="Фильтр задач"]');
    expect(filterGroup.classes()).toContain("grid");
    expect(filterGroup.classes()).toContain("grid-cols-2");
    expect(filterGroup.findAll("button")).toHaveLength(4);

    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Новая задача")!
      .trigger("click");
    expect(wrapper.text()).toContain("Название задачи *");
    expect(wrapper.text()).toContain("Срок *");
    expect(wrapper.text()).toContain("Описание задачи *");
    expect(wrapper.text()).toContain(
      "Чтобы создать задачу, заполните: название, срок, описание.",
    );
    expect(
      wrapper
        .findAll("button")
        .find((button) => button.text() === "Создать задачу")!
        .attributes("disabled"),
    ).toBeDefined();

    await wrapper.get('input[type="datetime-local"]').setValue("2020-01-01T12:00");
    expect(wrapper.text()).toContain(
      "Срок должен быть в будущем по времени Минска",
    );
  });

  it("называет отправку на проверку и завершённый статус без двусмысленности", async () => {
    const employeeTasks: StaffTask[] = [
      {
        id: "claimed-1",
        title: "Проверить остатки",
        description: "Сверить полку",
        status: "claimed",
        assignee_employee_id: staffEmployee.id,
        assignee_name: "Павел Сергеевич",
        due_at: "2099-07-28T12:00:00.000Z",
      },
      {
        id: "done-1",
        title: "Закрытая задача",
        status: "approved",
        assignee_employee_id: staffEmployee.id,
        assignee_name: "Павел Сергеевич",
        result_note: "Готово, расхождений нет",
        due_at: "2099-07-28T12:00:00.000Z",
      },
    ];
    const store = useCrmStore();
    store.$patch({
      staffToken: "employee-token",
      staffIdentity: { role: "employee", employee: staffEmployee },
      staffTasks: employeeTasks,
      currentStaffShift: {
        id: "shift-employee",
        version: 1,
        employee_id: staffEmployee.id,
        employee_name: "Павел Сергеевич",
        status: "active",
      },
    });
    vi.spyOn(store, "fetchStaffTasks").mockResolvedValue(employeeTasks);

    const wrapper = mount(StaffTasksModal, {
      props: { open: true },
      global: { stubs: { AdminModal: modalStub } },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("Отправить на проверку");
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("Завершённые"))!
      .trigger("click");
    expect(wrapper.text()).toContain("Завершена");
    expect(wrapper.text()).toContain("Результат сотрудника");
    expect(wrapper.text()).toContain("Готово, расхождений нет");
  });
});
