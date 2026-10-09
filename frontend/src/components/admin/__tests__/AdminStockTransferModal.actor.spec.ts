import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import AdminStockTransferModal from "@/components/admin/AdminStockTransferModal.vue";
import { useAdminStore } from "@/stores/admin";
import { useCrmStore } from "@/stores/crm";

/**
 * Настоящие AdminModal и StaffActorPrompt, без заглушек: с заглушками путь
 * «ввёл ПИН и нажал кнопку» вообще не проверялся.
 */
describe("AdminStockTransferModal: подтверждение сотрудника", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useCrmStore().$patch({ staffTrackingEnabled: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("создаёт заявку после ввода ПИН", async () => {
    const adminStore = useAdminStore();
    const crmStore = useCrmStore();

    vi.spyOn(adminStore, "fetchInventoryTransfers").mockResolvedValue({
      transfers: [],
      pagination: { page: 1, totalPages: 1 },
    } as any);
    vi.spyOn(adminStore, "fetchInventoryGroups").mockResolvedValue([] as never);
    vi.spyOn(adminStore, "fetchInventoryItems").mockResolvedValue([
      {
        id: "product_1",
        title: "Манго",
        category_name: "Жидкости",
        group_name: "PODONKI PODGON",
        image: null,
        retail_stock: 0,
        warehouse_stock: 5,
        available_stock: 5,
      },
    ] as any);
    const createTransfer = vi
      .spyOn(adminStore, "createInventoryTransfer")
      .mockResolvedValue({ id: "move_1", transfer_number: 7, items: [] } as any);
    vi.spyOn(adminStore, "fetchInventoryTransfer").mockResolvedValue({
      id: "move_1",
      transfer_number: 7,
      items: [],
    } as any);
    vi.spyOn(crmStore, "fetchStaffShiftCandidates").mockImplementation(async () => {
      const candidates = [
        { id: "employee_1", first_name: "Константин", last_name: "Жмурков" },
      ];
      crmStore.$patch({ staffShiftCandidates: candidates as any });
      return candidates as any;
    });
    crmStore.$patch({
      staffIdentity: {
        role: "manager",
        employee: { id: "employee_1", first_name: "Константин", last_name: "Жмурков" },
      } as any,
    });

    const wrapper = mount(AdminStockTransferModal, {
      props: { isOpen: false, initialSource: "warehouse" },
      attachTo: document.body,
    });
    await wrapper.setProps({ isOpen: true });
    await flushPromises();

    // Настоящий AdminModal рендерит содержимое в портал, ищем по документу.
    const buttons = () => Array.from(document.querySelectorAll("button"));
    const byText = (text: string) =>
      buttons().find((button) => (button.textContent || "").includes(text));

    const start = byText("Новая заявка");
    expect(start, "кнопка новой заявки").toBeTruthy();
    start!.click();
    await flushPromises();

    const plus = buttons().find(
      (button) => button.getAttribute("aria-label") === "Увеличить количество",
    );
    expect(plus, "кнопка добавления позиции").toBeTruthy();
    plus!.click();
    await flushPromises();

    const create = byText("Создать заявку на");
    expect(create, "кнопка создания заявки").toBeTruthy();
    create!.click();
    await flushPromises();

    const pinInput = document.getElementById("staff-actor-pin") as HTMLInputElement | null;
    expect(pinInput, "поле ПИН").not.toBeNull();

    const employeeSelect = document.getElementById("staff-actor") as HTMLSelectElement;
    expect(employeeSelect.value, "сотрудник подставлен").toBe("employee_1");

    pinInput!.value = "1111";
    pinInput!.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();

    const confirm = byText("Создать заявку на перемещение");
    expect(confirm, "кнопка подтверждения").toBeTruthy();
    expect(
      (confirm as HTMLButtonElement).disabled,
      "кнопка подтверждения не должна быть заблокирована",
    ).toBe(false);
    confirm!.click();
    await flushPromises();

    expect(createTransfer).toHaveBeenCalledTimes(1);
    expect(createTransfer.mock.calls[0][0]).toMatchObject({
      actor_employee_id: "employee_1",
      actor_pin: "1111",
    });
  });
});
