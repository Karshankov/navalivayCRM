import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import CrmProcurements from "@/views/admin/crm/CrmProcurements.vue";
import { useAdminStore } from "@/stores/admin";
import { useCrmStore } from "@/stores/crm";

let wrapper: VueWrapper | null = null;

async function mountProcurements() {
  const crm = useCrmStore();
  const admin = useAdminStore();

  crm.$patch({
    profitUnlocked: true,
    staffTrackingEnabled: false,
    procurements: [],
    lowStockProducts: [],
  });
  admin.$patch({
    categories: [{ id: "cat-1", name: "Жидкости" }] as any,
    categoryGroups: [
      { id: "parent-1", categoryId: "cat-1", name: "ICEBERG", order: 0 },
    ] as any,
  });

  vi.spyOn(crm, "fetchStaffSettings").mockResolvedValue({
    trackingEnabled: false,
    orderShiftRestrictionEnabled: false,
  });
  vi.spyOn(crm, "fetchProcurements").mockResolvedValue(undefined as any);
  vi.spyOn(crm, "fetchLowStockProducts").mockResolvedValue(undefined as any);
  vi.spyOn(crm, "searchCrmProducts").mockResolvedValue([]);
  vi.spyOn(admin, "fetchCategories").mockResolvedValue(undefined as any);
  vi.spyOn(admin, "fetchCategoryGroups").mockResolvedValue([] as any);

  wrapper = mount(CrmProcurements, {
    attachTo: document.body,
    global: {
      stubs: {
        LowStockGroupsPanel: true,
        TotalControlPanel: true,
        CrmProfitPasswordField: true,
        StaffActorPrompt: true,
      },
    },
  });
  await flushPromises();

  return { admin, vm: wrapper.vm as any };
}

function visibleDialog(title: string) {
  return Array.from(document.body.querySelectorAll<HTMLElement>('[role="dialog"]')).find(
    (dialog) => dialog.querySelector("h2")?.textContent?.trim() === title,
  );
}

describe("CrmProcurements: стек быстрых окон", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("оставляет активной только новую линейку и сразу фокусирует название", async () => {
    const { vm } = await mountProcurements();

    vm.showCreateModal = true;
    await vm.openQuickProductModal();
    vm.quickProduct.categoryId = "cat-1";
    vm.quickProduct.titles = ["Манго"];
    await flushPromises();
    await vm.openQuickGroupModal();
    await flushPromises();

    expect(visibleDialog("Новая линейка")).toBeTruthy();
    expect(visibleDialog("Новая закупка")).toBeUndefined();
    expect(visibleDialog("Новый товар")).toBeUndefined();

    const nameInput = document.body.querySelector<HTMLInputElement>(
      'input[placeholder="Например, Кремовая"]',
    );
    expect(nameInput).not.toBeNull();
    expect(document.activeElement).toBe(nameInput);

    nameInput!.value = "Фруктовая";
    nameInput!.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
    expect(vm.quickGroupName).toBe("Фруктовая");

    vm.closeQuickGroupModal();
    await flushPromises();

    expect(visibleDialog("Новый товар")).toBeTruthy();
    expect(visibleDialog("Новая закупка")).toBeUndefined();
    expect(visibleDialog("Новая линейка")).toBeUndefined();
    expect(vm.quickProduct.titles).toEqual(["Манго"]);
  });

  it("создаёт линейку один раз, блокирует закрытие и сохраняет поля при ошибке", async () => {
    const { admin, vm } = await mountProcurements();
    let rejectCreate!: (reason: Error) => void;
    const pending = new Promise<never>((_, reject) => {
      rejectCreate = reject;
    });
    const create = vi.spyOn(admin, "createCategoryGroup").mockReturnValue(pending);

    vm.showCreateModal = true;
    await vm.openQuickProductModal();
    vm.quickProduct.categoryId = "cat-1";
    await flushPromises();
    await vm.openQuickGroupModal();
    vm.quickGroupName = "Фруктовая";
    vm.quickGroupParentId = "parent-1";

    const firstSubmit = vm.submitQuickGroup();
    void vm.submitQuickGroup();
    await flushPromises();

    expect(create).toHaveBeenCalledTimes(1);
    expect(vm.creatingQuickGroup).toBe(true);
    vm.closeQuickGroupModal();
    expect(vm.showQuickGroupModal).toBe(true);

    const groupDialog = visibleDialog("Новая линейка");
    const cancel = Array.from(groupDialog?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent?.trim() === "Отмена",
    ) as HTMLButtonElement | undefined;
    expect(cancel?.disabled).toBe(true);

    rejectCreate(new Error("Сервис временно недоступен"));
    await firstSubmit;
    await flushPromises();

    expect(vm.showQuickGroupModal).toBe(true);
    expect(vm.quickGroupName).toBe("Фруктовая");
    expect(vm.quickGroupParentId).toBe("parent-1");
    expect(vm.quickGroupError).toContain("Сервис временно недоступен");
  });

  it("после успеха выбирает созданную линейку", async () => {
    const { admin, vm } = await mountProcurements();
    vi.spyOn(admin, "createCategoryGroup").mockResolvedValue({
      id: "group-new",
      categoryId: "cat-1",
      name: "Фруктовая",
    } as any);

    vm.showCreateModal = true;
    await vm.openQuickProductModal();
    vm.quickProduct.categoryId = "cat-1";
    await flushPromises();
    await vm.openQuickGroupModal();
    vm.quickGroupName = "Фруктовая";
    vm.quickGroupParentId = "parent-1";
    await vm.submitQuickGroup();
    await flushPromises();

    expect(vm.quickProduct.groupId).toBe("group-new");
    expect(vm.showQuickGroupModal).toBe(false);
    expect(vm.showQuickProductModal).toBe(true);
    expect(visibleDialog("Новый товар")).toBeTruthy();
    expect(visibleDialog("Новая закупка")).toBeUndefined();
    expect(visibleDialog("Новая линейка")).toBeUndefined();
  });

  it("сохраняет прокрутку обоих нижних окон", async () => {
    const { vm } = await mountProcurements();

    vm.showCreateModal = true;
    await flushPromises();
    const procurementScroll = vm.createModalRef.scrollContainer as HTMLElement;
    procurementScroll.scrollTop = 137;

    await vm.openQuickProductModal();
    await flushPromises();
    const productScroll = vm.quickProductModalRef.scrollContainer as HTMLElement;
    productScroll.scrollTop = 83;
    vm.quickProduct.categoryId = "cat-1";
    await flushPromises();

    await vm.openQuickGroupModal();
    vm.closeQuickGroupModal();
    await flushPromises();
    expect((vm.quickProductModalRef.scrollContainer as HTMLElement).scrollTop).toBe(83);

    vm.closeQuickProductModal();
    await flushPromises();
    expect((vm.createModalRef.scrollContainer as HTMLElement).scrollTop).toBe(137);
  });

  it("сохраняет название категории при ошибке и выбирает её после повтора", async () => {
    const { admin, vm } = await mountProcurements();
    let rejectCreate!: (reason: Error) => void;
    const pending = new Promise<never>((_, reject) => {
      rejectCreate = reject;
    });
    const create = vi.spyOn(admin, "createCategory").mockReturnValueOnce(pending);

    vm.showCreateModal = true;
    await vm.openQuickProductModal();
    vm.openQuickCategoryModal();
    await flushPromises();

    const categoryInput = document.body.querySelector<HTMLInputElement>(
      'input[placeholder="Например, Мороженое"]',
    );
    expect(document.activeElement).toBe(categoryInput);
    vm.quickCategoryName = "Десерты";

    const firstSubmit = vm.submitQuickCategory();
    void vm.submitQuickCategory();
    await flushPromises();
    expect(create).toHaveBeenCalledTimes(1);
    vm.closeQuickCategoryModal();
    expect(vm.showQuickCategoryModal).toBe(true);

    rejectCreate(new Error("Категория временно недоступна"));
    await firstSubmit;
    expect(vm.quickCategoryName).toBe("Десерты");
    expect(vm.quickCategoryError).toContain("Категория временно недоступна");

    create.mockResolvedValueOnce({ id: "cat-new", name: "Десерты" } as any);
    await vm.submitQuickCategory();
    await flushPromises();
    expect(vm.quickProduct.categoryId).toBe("cat-new");
    expect(vm.showQuickCategoryModal).toBe(false);
    expect(visibleDialog("Новый товар")).toBeTruthy();
  });

  it("не создаёт товар повторно и не даёт закрыть форму во время запроса", async () => {
    const { admin, vm } = await mountProcurements();
    let resolveCreate!: (value: any) => void;
    const pending = new Promise((resolve) => {
      resolveCreate = resolve;
    });
    const create = vi.spyOn(admin, "createProduct").mockReturnValue(pending as any);

    vm.showCreateModal = true;
    await vm.openQuickProductModal();
    vm.quickProduct.categoryId = "cat-1";
    vm.quickProduct.titles = ["Манго"];
    vm.quickProduct.priceRub = 20;
    vm.quickProduct.costPrice = 8;
    await flushPromises();

    const firstSubmit = vm.submitQuickProduct();
    void vm.submitQuickProduct();
    await flushPromises();

    expect(create).toHaveBeenCalledTimes(1);
    const productDialog = visibleDialog("Новый товар")!;
    const close = productDialog.querySelector<HTMLButtonElement>(
      'button[aria-label="Закрыть модальное окно"]',
    );
    const cancel = Array.from(productDialog.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Отмена",
    );
    expect(close?.disabled).toBe(true);
    expect(cancel?.disabled).toBe(true);

    resolveCreate({
      id: "product-1",
      title: "Манго",
      categoryId: "cat-1",
      priceRub: 20,
      costPrice: 8,
      stock: 0,
      warehouseStock: 0,
    });
    await firstSubmit;
    await flushPromises();

    expect(vm.showQuickProductModal).toBe(false);
    expect(visibleDialog("Новый товар")).toBeUndefined();
    expect(visibleDialog("Новая закупка")).toBeTruthy();
  });
});
