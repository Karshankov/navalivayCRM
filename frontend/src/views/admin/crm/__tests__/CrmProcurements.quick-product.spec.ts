import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, shallowMount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import CrmProcurements from "@/views/admin/crm/CrmProcurements.vue";
import { useAdminStore } from "@/stores/admin";
import { useCrmStore } from "@/stores/crm";

/**
 * Вкусы одной линейки отличаются только названием. Форма быстрого создания
 * принимает их пачкой: остальные поля общие, и открывать её заново на каждый
 * вкус не нужно.
 */
function mountProcurements() {
  const crm = useCrmStore();
  const admin = useAdminStore();
  crm.$patch({ profitUnlocked: true, staffTrackingEnabled: false, procurements: [] });
  vi.spyOn(crm, "fetchStaffSettings").mockResolvedValue({
    trackingEnabled: false,
    orderShiftRestrictionEnabled: false,
  });
  vi.spyOn(crm, "fetchProcurements").mockResolvedValue(undefined as any);
  vi.spyOn(crm, "fetchLowStockProducts").mockResolvedValue(undefined as any);
  vi.spyOn(admin, "fetchCategories").mockResolvedValue(undefined as any);
  // Выбор категории подтягивает её линейки: без заглушки форма запишет свою
  // ошибку загрузки поверх той, которую проверяет тест.
  vi.spyOn(admin, "fetchCategoryGroups").mockResolvedValue([] as any);
  const wrapper = shallowMount(CrmProcurements);
  return { admin, wrapper };
}

async function fillCommonFields(
  wrapper: ReturnType<typeof shallowMount>,
  titles: string[],
) {
  const vm = wrapper.vm as any;
  vm.quickProduct.categoryId = "cat-1";
  // Смена категории сбрасывает линейку, поэтому ждём, пока форма догрузит
  // список, и только потом выбираем.
  await flushPromises();
  vm.quickProduct.groupId = "group-1";
  vm.quickProduct.priceRub = 20;
  vm.quickProduct.costPrice = 8;
  vm.quickProduct.stock = 3;
  vm.quickProduct.useCategoryImage = true;
  vm.quickProduct.titles = titles;
  vm.showQuickProductModal = true;
}

function createdProduct(title: string) {
  return {
    id: `product-${title}`,
    title,
    priceRub: 20,
    costPrice: 8,
    stock: 3,
    warehouseStock: 0,
  };
}

describe("CrmProcurements: несколько вкусов за одно открытие формы", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  it("создаёт товар на каждое название, поля остаются общими", async () => {
    const { admin, wrapper } = mountProcurements();
    const create = vi
      .spyOn(admin, "createProduct")
      .mockImplementation(async (payload: any) => createdProduct(payload.title) as any);

    await fillCommonFields(wrapper, ["Ананас", "Манго", "Барбарис"]);
    await (wrapper.vm as any).submitQuickProduct();
    await flushPromises();

    expect(create).toHaveBeenCalledTimes(3);
    expect(create.mock.calls.map((call: any[]) => call[0].title)).toEqual([
      "Ананас",
      "Манго",
      "Барбарис",
    ]);
    // Цена, себестоимость и линейка у всех одни и те же.
    for (const [payload] of create.mock.calls as any[][]) {
      expect(payload.groupId).toBe("group-1");
      expect(payload.priceRub).toBe(20);
      expect(payload.costPrice).toBe(8);
    }
    // Все три уехали в закупку, форма закрылась.
    expect((wrapper.vm as any).draftItems).toHaveLength(3);
    expect((wrapper.vm as any).showQuickProductModal).toBe(false);
  });

  it("пропускает пустые поля и повторы, чтобы не плодить дубли", async () => {
    const { admin, wrapper } = mountProcurements();
    const create = vi
      .spyOn(admin, "createProduct")
      .mockImplementation(async (payload: any) => createdProduct(payload.title) as any);

    await fillCommonFields(wrapper, ["Ананас", "  ", "ананас", "Манго"]);
    await (wrapper.vm as any).submitQuickProduct();
    await flushPromises();

    expect(create.mock.calls.map((call: any[]) => call[0].title)).toEqual([
      "Ананас",
      "Манго",
    ]);
  });

  it("на сбое посередине сохраняет созданное и оставляет в форме только несозданное", async () => {
    const { admin, wrapper } = mountProcurements();
    vi.spyOn(admin, "createProduct").mockImplementation(async (payload: any) => {
      if (payload.title === "Манго") throw new Error("склад недоступен");
      return createdProduct(payload.title) as any;
    });

    await fillCommonFields(wrapper, ["Ананас", "Манго", "Барбарис"]);
    await (wrapper.vm as any).submitQuickProduct();
    await flushPromises();

    const vm = wrapper.vm as any;
    // Первый уже создан: он в закупке, и повторное сохранение его не задвоит.
    expect(vm.draftItems).toHaveLength(1);
    expect(vm.quickProduct.titles).toEqual(["Манго", "Барбарис"]);
    // Форма остаётся открытой, и видно, на чём всё встало.
    expect(vm.showQuickProductModal).toBe(true);
    expect(vm.quickProductError).toContain("Добавили 1 из 3");
    expect(vm.quickProductError).toContain("Манго");
  });

  it("без единого названия ничего не создаёт", async () => {
    const { admin, wrapper } = mountProcurements();
    const create = vi.spyOn(admin, "createProduct");

    await fillCommonFields(wrapper, ["   ", ""]);
    await (wrapper.vm as any).submitQuickProduct();
    await flushPromises();

    expect(create).not.toHaveBeenCalled();
    expect((wrapper.vm as any).quickProductError).toBe("Укажите название товара");
  });

  it("добавляет поле сразу после того, из которого его вызвали", () => {
    const { wrapper } = mountProcurements();
    const vm = wrapper.vm as any;
    vm.quickProduct.titles = ["Ананас", "Барбарис"];

    vm.addQuickProductTitle(0);
    expect(vm.quickProduct.titles).toEqual(["Ананас", "", "Барбарис"]);

    vm.addQuickProductTitle();
    expect(vm.quickProduct.titles).toEqual(["Ананас", "", "Барбарис", ""]);
  });

  it("последнее поле убрать нельзя, иначе вводить будет некуда", () => {
    const { wrapper } = mountProcurements();
    const vm = wrapper.vm as any;
    vm.quickProduct.titles = ["Ананас", "Манго"];

    vm.removeQuickProductTitle(0);
    expect(vm.quickProduct.titles).toEqual(["Манго"]);

    vm.removeQuickProductTitle(0);
    expect(vm.quickProduct.titles).toEqual(["Манго"]);
  });
});
