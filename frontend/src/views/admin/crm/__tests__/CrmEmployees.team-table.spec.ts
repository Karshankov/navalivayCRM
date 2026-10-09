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
  active: true,
  pin_configured: true,
};
const seller = {
  id: "employee-1",
  first_name: "Павел",
  last_name: "Сергеевич",
  position: "Продавец",
  role: "employee" as const,
  active: true,
  pin_configured: true,
};

enableAutoUnmount(afterEach);

function mountEmployees() {
  return mount(CrmEmployees, {
    global: {
      stubs: {
        StaffShiftBar: { template: "<div />" },
        StaffAccessModal: { template: "<div />" },
        StaffTasksModal: { template: "<div />" },
        AdminModal: { template: "<div />" },
      },
    },
  });
}

async function openTeamTable() {
  const store = useCrmStore();
  store.$patch({
    staffTrackingEnabled: true,
    staffToken: "manager-token",
    staffIdentity: { role: "manager", employee: manager },
    staffEmployees: [manager, seller],
  });
  vi.spyOn(store, "fetchStaffSettings").mockResolvedValue({
    trackingEnabled: true,
    orderShiftRestrictionEnabled: false,
  });
  vi.spyOn(store, "fetchStaffEmployees").mockResolvedValue([manager, seller]);
  vi.spyOn(store, "fetchStaffAnalytics").mockImplementation(async () => {
    const analytics: StaffAnalytics = { employee: manager };
    store.$patch({ staffAnalytics: analytics });
    return analytics;
  });
  vi.spyOn(store, "fetchStaffAnalyticsPrevious").mockResolvedValue(null);
  vi.spyOn(store, "fetchStaffMarks").mockResolvedValue([]);
  const team: StaffAnalytics[] = [
    {
      employee: manager,
      worked_minutes: 60,
      shifts_count: 1,
      orders_issued: 2,
      orders_amount: 100,
    },
    {
      employee: seller,
      worked_minutes: 240,
      shifts_count: 3,
      orders_issued: 7,
      orders_amount: 640,
    },
  ];
  vi.spyOn(store, "fetchStaffTeamAnalytics").mockImplementation(async () => {
    store.$patch({ staffTeamAnalytics: team });
    return team;
  });

  const wrapper = mountEmployees();
  await flushPromises();
  await wrapper.get("#staff-manager-section").setValue("team");
  await flushPromises();
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "Таблица")!
    .trigger("click");
  await flushPromises();
  return wrapper;
}

describe("CrmEmployees: таблица команды", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("по умолчанию сортирует по часам от большего", async () => {
    const wrapper = await openTeamTable();
    const table = wrapper.get('[data-testid="staff-team-table"]');
    const names = table.findAll("tbody th").map((cell) => cell.text());

    expect(names[0]).toContain("Павел Сергеевич");
    expect(names[1]).toContain("Константин Жмурков");
  });

  it("переворачивает порядок по повторному клику на колонку", async () => {
    const wrapper = await openTeamTable();
    const table = wrapper.get('[data-testid="staff-team-table"]');
    const hoursHeader = table
      .findAll("thead button")
      .find((button) => button.text().startsWith("Часы"))!;

    await hoursHeader.trigger("click");
    const names = table.findAll("tbody th").map((cell) => cell.text());
    expect(names[0]).toContain("Константин Жмурков");

    const hoursColumn = table.findAll("thead th")[1];
    expect(hoursColumn.attributes("aria-sort")).toBe("ascending");
  });

  it("сортирует по имени и помечает это в aria-sort", async () => {
    const wrapper = await openTeamTable();
    const table = wrapper.get('[data-testid="staff-team-table"]');
    await table
      .findAll("thead button")
      .find((button) => button.text().startsWith("Сотрудник"))!
      .trigger("click");

    const names = table.findAll("tbody th").map((cell) => cell.text());
    expect(names[0]).toContain("Константин Жмурков");
    expect(table.findAll("thead th")[0].attributes("aria-sort")).toBe("ascending");
  });

  it("суммирует колонки в строке итога", async () => {
    const wrapper = await openTeamTable();
    const footer = wrapper.get('[data-testid="staff-team-table"] tfoot');

    expect(footer.text()).toContain("Итого · 2");
    // 60 + 240 минут
    expect(footer.text()).toContain("5 ч");
    // 2 + 7 выданных заказов
    expect(footer.findAll("td")[4].text()).toBe("9");
  });

  it("показывает работу с документами отдельными колонками", async () => {
    const wrapper = await openTeamTable();
    const table = wrapper.get('[data-testid="staff-team-table"]');
    const headers = table.findAll("thead th").map((cell) => cell.text());

    for (const label of [
      "Закупки создал",
      "Закупки принял",
      "Перемещения создал",
      "Перемещения принял",
      "Плюсы вручную",
    ]) {
      expect(headers.some((header) => header.startsWith(label)), label).toBe(true);
    }

    // Новые колонки не должны сдвинуть «Выдано»: на неё завязана проверка итога.
    expect(headers[5]).toContain("Выдано");
  });

  it("оставляет карточки видом по умолчанию", async () => {
    const store = useCrmStore();
    store.$patch({
      staffTrackingEnabled: true,
      staffToken: "manager-token",
      staffIdentity: { role: "manager", employee: manager },
      staffEmployees: [manager, seller],
    });
    vi.spyOn(store, "fetchStaffSettings").mockResolvedValue({
      trackingEnabled: true,
      orderShiftRestrictionEnabled: false,
    });
    vi.spyOn(store, "fetchStaffEmployees").mockResolvedValue([manager, seller]);
    vi.spyOn(store, "fetchStaffAnalytics").mockResolvedValue({ employee: manager });
    vi.spyOn(store, "fetchStaffAnalyticsPrevious").mockResolvedValue(null);
    vi.spyOn(store, "fetchStaffMarks").mockResolvedValue([]);
    vi.spyOn(store, "fetchStaffTeamAnalytics").mockResolvedValue([]);

    const wrapper = mountEmployees();
    await flushPromises();
    await wrapper.get("#staff-manager-section").setValue("team");
    await flushPromises();

    expect(wrapper.find('[data-testid="staff-team-table"]').exists()).toBe(false);
  });
});
