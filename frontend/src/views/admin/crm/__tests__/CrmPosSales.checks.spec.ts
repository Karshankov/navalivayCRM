import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import CrmPosSales from "@/views/admin/crm/CrmPosSales.vue";

const crmStore = {
  profitUnlocked: true,
  verifyingProfitAccess: false,
  fetchPosSales: vi.fn().mockResolvedValue({ sales: [], total: 0 }),
  fetchPosStats: vi.fn().mockResolvedValue({ totalRevenue: 0, totalProfit: 0, pendingCount: 0 }),
  fetchPosSaleItems: vi.fn().mockResolvedValue([]),
  resetProfitAccess: vi.fn(),
};

vi.mock("pinia", () => ({
  storeToRefs: () => ({
    profitUnlocked: { value: crmStore.profitUnlocked },
    verifyingProfitAccess: { value: false },
  }),
  defineStore: vi.fn(),
}));

vi.mock("@/stores/crm", () => ({
  useCrmStore: () => crmStore,
}));

// У страницы есть роутер-зависимости? Проверяем только рендер таблицы.
const sale = {
  id: "pos_1",
  sale_number: 12,
  product_name: "Чек из трёх позиций",
  price: 45,
  cost_price: 20,
  profit: 25,
  status: "completed",
  notes: null,
  employee_id: null,
  employee_name: null,
  customer_id: null,
  created_at: "2026-10-27T10:00:00.000Z",
  completed_at: "2026-10-27T10:00:00.000Z",
  subtotal: 50,
  discount_percent: 0,
  payment_method: "card",
  stock_deducted: 1,
  items: [
    {
      id: "posi_1",
      sale_id: "pos_1",
      source: "catalog",
      product_id: "p_1",
      variant_id: null,
      pos_product_id: null,
      title: "Жидкость HUSKY",
      variant_name: null,
      unit_price: 35,
      catalog_price: 16,
      cost_price: 8,
      quantity: 1,
      discount_amount: 0,
      line_total: 35,
      line_cost: 8,
    },
    {
      id: "posi_2",
      sale_id: "pos_1",
      source: "custom",
      product_id: null,
      variant_id: null,
      pos_product_id: "posp_1",
      title: "Одноразка",
      variant_name: null,
      unit_price: 10,
      catalog_price: null,
      cost_price: 5,
      quantity: 1,
      discount_amount: 0,
      line_total: 10,
      line_cost: 5,
    },
  ],
};

async function mountPage(sales = [sale]) {
  crmStore.fetchPosSales.mockResolvedValue({ sales, total: sales.length });
  const wrapper = mount(CrmPosSales, {
    global: {
      stubs: {
        AdminModal: true,
        CrmProfitPasswordField: true,
        Teleport: true,
      },
    },
  });
  await flushPromises();
  return wrapper;
}

describe("CrmPosSales: таблица многострочных чеков", () => {
  beforeEach(() => {
    crmStore.fetchPosSales.mockClear();
    crmStore.fetchPosSaleItems.mockClear();
    crmStore.profitUnlocked = true;
  });

  it("рендерит строки чеков с колонками оплаты и скидки", async () => {
    const wrapper = await mountPage();
    const text = wrapper.text();

    expect(text).toContain("#12");
    expect(text).toContain("Карта");
    expect(text).toContain("−5 BYN");
    expect(text).toContain("2 позиции");
  });

  it("раскрывает состав чека по клику", async () => {
    const wrapper = await mountPage();

    const expand = wrapper.find('button[aria-label="Показать состав"]');
    expect(expand.exists()).toBe(true);
    await expand.trigger("click");
    await flushPromises();

    const text = wrapper.text();
    expect(text).toContain("Жидкость HUSKY");
    expect(text).toContain("свой");
  });

  it("пустой список показывает «Нет продаж»", async () => {
    const wrapper = await mountPage([]);
    expect(wrapper.text()).toContain("Нет продаж");
  });
});