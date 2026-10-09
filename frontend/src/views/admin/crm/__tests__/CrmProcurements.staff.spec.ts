import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, shallowMount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import CrmProcurements from "@/views/admin/crm/CrmProcurements.vue";
import { useAdminStore } from "@/stores/admin";
import { useCrmStore } from "@/stores/crm";

const product = {
  id: "product-1",
  title: "Манго",
  priceRub: 20,
  costPrice: 10,
  stock: 1,
  warehouseStock: 0,
  isVariant: false,
};
const procurement = {
  id: "procurement-1",
  procurement_number: 1,
  employee_id: null,
  supplier_name: null,
  total_amount: 10,
  status: "draft" as const,
  notes: null,
  created_at: "2026-07-23T07:00:00.000Z",
  completed_at: null,
  items: [],
};

function mountProcurements(tracking: boolean) {
  const crm = useCrmStore();
  const admin = useAdminStore();
  crm.$patch({
    profitUnlocked: true,
    staffTrackingEnabled: tracking,
    procurements: [],
  });
  vi.spyOn(crm, "fetchStaffSettings").mockResolvedValue({
    trackingEnabled: tracking,
    orderShiftRestrictionEnabled: tracking,
  });
  vi.spyOn(crm, "fetchProcurements").mockResolvedValue(undefined as any);
  vi.spyOn(crm, "fetchProcurement").mockResolvedValue(procurement as any);
  vi.spyOn(crm, "fetchLowStockProducts").mockResolvedValue(undefined as any);
  vi.spyOn(admin, "fetchCategories").mockResolvedValue(undefined as any);
  const wrapper = shallowMount(CrmProcurements);
  return { crm, wrapper };
}

function validDraft(wrapper: ReturnType<typeof shallowMount>) {
  (wrapper.vm as any).draftItems = [
    {
      product,
      quantity: 1,
      costPerUnit: 10,
      warehouseQuantity: 0,
    },
  ];
}

describe("CrmProcurements: rollout учёта сотрудников", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  it("в старом режиме создаёт закупку без ПИНа", async () => {
    const { crm, wrapper } = mountProcurements(false);
    const create = vi
      .spyOn(crm, "createProcurement")
      .mockResolvedValue(procurement as any);
    validDraft(wrapper);
    await (wrapper.vm as any).requestSaveProcurement();
    await flushPromises();

    expect((wrapper.vm as any).actorPromptOpen).toBe(false);
    expect(create).toHaveBeenCalledWith(
      expect.not.objectContaining({
        actor_employee_id: expect.anything(),
        actor_pin: expect.anything(),
      }),
    );

    const complete = vi
      .spyOn(crm, "completeProcurement")
      .mockResolvedValue({ ...procurement, status: "completed" } as any);
    await (wrapper.vm as any).requestCompleteProcurement(procurement.id);
    await flushPromises();
    expect(complete).toHaveBeenCalledWith(
      procurement.id,
      expect.not.objectContaining({
        actor_employee_id: expect.anything(),
        actor_pin: expect.anything(),
      }),
    );
  });

  it("при включённом учёте требует ПИН только для создания", async () => {
    const { crm, wrapper } = mountProcurements(true);
    const create = vi.spyOn(crm, "createProcurement");
    validDraft(wrapper);
    await (wrapper.vm as any).requestSaveProcurement();

    expect((wrapper.vm as any).actorPromptOpen).toBe(true);
    expect((wrapper.vm as any).actorPromptContext).toContain("Новая закупка");
    expect((wrapper.vm as any).actorPromptContext).toContain("1 поз. · 1 шт");
    expect(create).not.toHaveBeenCalled();

    (wrapper.vm as any).actorPromptOpen = false;
    (wrapper.vm as any).editingProcurementId = procurement.id;
    const update = vi
      .spyOn(crm, "updateProcurement")
      .mockResolvedValue(procurement as any);
    await (wrapper.vm as any).requestSaveProcurement();
    await flushPromises();

    expect((wrapper.vm as any).actorPromptOpen).toBe(false);
    expect(update).toHaveBeenCalledWith(
      procurement.id,
      expect.not.objectContaining({
        actor_employee_id: expect.anything(),
        actor_pin: expect.anything(),
      }),
    );
  });
});
