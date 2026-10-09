import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h } from "vue";
import CrmOrderDetail from "@/views/admin/crm/CrmOrderDetail.vue";
import { useCrmStore, type Order } from "@/stores/crm";

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "order-1",
    order_number: 1001,
    status: "new",
    delivery_type: "pickup",
    delivery_address: null,
    notes: "Старый комментарий",
    total_amount: 100,
    final_amount: 100,
    discount_amount: 0,
    discount_percent: 0,
    paid_amount: 0,
    items: [
      {
        id: "item-1",
        order_id: "order-1",
        product_id: "product-1",
        product_title: "Манго",
        quantity: 1,
        price_per_unit: 100,
        total_price: 100,
        cost_per_unit: 50,
        manual_discount_amount: 0,
        loyalty_discount_amount: 0,
        loyalty_units_applied: 0,
      },
    ],
    created_at: "2026-07-23T07:00:00.000Z",
    updated_at: "2026-07-23T07:00:00.000Z",
    ...overrides,
  } as Order;
}

function setupOrder(order: Order, tracking = true) {
  const store = useCrmStore();
  store.$patch({
    currentOrder: order,
    staffTrackingEnabled: tracking,
  });
  vi.spyOn(store, "fetchOrder").mockResolvedValue(order);
  vi.spyOn(store, "fetchOrderHistory").mockResolvedValue([]);
  vi.spyOn(store, "fetchStaffSettings").mockResolvedValue({
    trackingEnabled: tracking,
  });
  const requestShiftRequired = vi.fn().mockResolvedValue(undefined);
  const StaffShiftBarStub = defineComponent({
    setup(_, { expose }) {
      expose({ requestShiftRequired });
      return () => h("div", { "data-test": "staff-shift-bar" });
    },
  });
  const wrapper = mount(CrmOrderDetail, {
    props: { id: order.id },
    global: {
      mocks: { $router: { back: vi.fn() } },
      stubs: {
        StaffShiftBar: StaffShiftBarStub,
        ManagerActionSummary: true,
      },
    },
  });
  return { store, wrapper, requestShiftRequired };
}

describe("CrmOrderDetail: обязательная смена", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  it("сохраняет форму и не повторяет сохранение автоматически", async () => {
    const order = makeOrder();
    const { store, wrapper, requestShiftRequired } = setupOrder(order);
    const update = vi
      .spyOn(store, "updateOrder")
      .mockRejectedValueOnce(
        Object.assign(new Error("shift_required"), { code: "shift_required" }),
      )
      .mockResolvedValueOnce({ ...order, notes: "Новый комментарий" } as any);
    await flushPromises();

    const notes = wrapper.get(
      'textarea[placeholder="Примечания по заказу, способу оплаты и т.д."]',
    );
    await notes.setValue("Новый комментарий");
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Сохранить изменения")!
      .trigger("click");
    await flushPromises();

    expect(update).toHaveBeenCalledTimes(1);
    expect(requestShiftRequired).toHaveBeenCalledTimes(1);
    expect(notes.element.value).toBe("Новый комментарий");
    expect(wrapper.text()).toContain("действие не повторялось");

    const retry = requestShiftRequired.mock.calls[0][1] as () => Promise<unknown>;
    await retry();
    await flushPromises();
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("не предлагает обходную выдачу через поле статуса", async () => {
    const tracked = setupOrder(makeOrder(), true);
    await flushPromises();
    const trackedOptions = tracked.wrapper
      .findAll("option")
      .map((option) => option.text());
    expect(trackedOptions).not.toContain("Завершён");
    expect(trackedOptions).not.toContain("Выдан");
    expect(tracked.wrapper.text()).toContain(
      "Сборка и выдача выполняются с доски заказов",
    );

    // Учёт выключен: магазин работает по-старому, обходных состояний нет.
    tracked.wrapper.unmount();
    setActivePinia(createPinia());
    const legacy = setupOrder(makeOrder(), false);
    await flushPromises();
    const legacyOptions = legacy.wrapper
      .findAll("option")
      .map((option) => option.text());
    expect(legacyOptions).toContain("Завершён");
    expect(legacyOptions).toContain("Выдан");
  });

  it.each([
    {
      name: "действие клиента",
      order: makeOrder({
        needs_manager_action: true,
        manager_action_type: "changed_by_customer",
      }),
      button: "Принять изменения",
      method: "resolveManagerAction" as const,
    },
    {
      name: "отмена оплаты",
      order: makeOrder({ status: "completed", paid_amount: 100 }),
      button: "Отменить оплату",
      method: "deleteOrderPayment" as const,
    },
    {
      name: "возобновление",
      order: makeOrder({ status: "cancelled" }),
      button: "Возобновить заказ",
      method: "updateOrder" as const,
    },
  ])("открывает смену для мутации: $name", async ({ order, button, method }) => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { store, wrapper, requestShiftRequired } = setupOrder(order);
    vi.spyOn(store, method as any).mockRejectedValue(
      Object.assign(new Error("shift_required"), { code: "shift_required" }),
    );
    await flushPromises();

    await wrapper
      .findAll("button")
      .find((candidate) => candidate.text() === button)!
      .trigger("click");
    await flushPromises();

    expect(requestShiftRequired).toHaveBeenCalledTimes(1);
    expect(requestShiftRequired.mock.calls[0][1]).toEqual(expect.any(Function));
  });
});
