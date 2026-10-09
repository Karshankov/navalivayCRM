import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import CrmOrderDetail from "@/views/admin/crm/CrmOrderDetail.vue";
import { useCrmStore, type Order } from "@/stores/crm";

/**
 * Позиция из старых заказов: скидка больше суммы строки. Такие строки оставила
 * миграция лояльности, скопировав общую скидку в ручную.
 */
function brokenItem() {
  return {
    id: "item-1",
    order_id: "order-1",
    product_id: "product-1",
    product_title: "Жидкость",
    quantity: 1,
    price_per_unit: 16,
    total_price: 16,
    cost_per_unit: 8,
    manual_discount_amount: 10,
    loyalty_discount_amount: 10,
    loyalty_units_applied: 1,
  };
}

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "order-1",
    order_number: 11641,
    status: "in_progress",
    delivery_type: "pickup",
    delivery_address: null,
    notes: "",
    total_amount: 16,
    final_amount: 6,
    discount_amount: 0,
    discount_percent: 0,
    paid_amount: 0,
    items: [brokenItem()],
    created_at: "2026-07-27T01:38:00.000Z",
    updated_at: "2026-07-27T01:38:00.000Z",
    ...overrides,
  } as Order;
}

function mountDetail(order: Order) {
  const store = useCrmStore();
  store.$patch({ currentOrder: order, staffTrackingEnabled: false });
  vi.spyOn(store, "fetchOrder").mockResolvedValue(order);
  vi.spyOn(store, "fetchOrderHistory").mockResolvedValue([]);
  vi.spyOn(store, "fetchStaffSettings").mockResolvedValue({
    trackingEnabled: false,
  });
  const wrapper = mount(CrmOrderDetail, {
    props: { id: order.id },
    global: {
      stubs: {
        StaffShiftBar: { template: "<div />" },
        StaffActorPrompt: { template: "<div />" },
        AdminModal: { template: "<div />" },
        RouterLink: { template: "<a><slot /></a>" },
      },
    },
  });
  return { store, wrapper };
}

function saveButton(wrapper: ReturnType<typeof mountDetail>["wrapper"]) {
  return wrapper
    .findAll("button")
    .find((button) => button.text().includes("Сохранить изменения"))!;
}

function commentField(wrapper: ReturnType<typeof mountDetail>["wrapper"]) {
  return wrapper
    .findAll("textarea")
    .find((field) =>
      String(field.attributes("placeholder") || "").includes("Примечания"),
    )!;
}

describe("CrmOrderDetail: комментарий менеджера", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
  });

  it("даёт сохранить комментарий, даже если старая позиция не сходится", async () => {
    const { wrapper } = mountDetail(makeOrder());
    await flushPromises();

    expect(saveButton(wrapper).attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("Изменений нет");

    await commentField(wrapper).setValue("карта");
    await flushPromises();

    expect(saveButton(wrapper).attributes("disabled")).toBeUndefined();
    expect(wrapper.text()).not.toContain("Изменений нет");
  });

  it("объясняет, почему нельзя сохранить, когда правка позиции не сходится", async () => {
    const { wrapper } = mountDetail(
      makeOrder({
        items: [
          {
            ...brokenItem(),
            manual_discount_amount: 0,
            loyalty_discount_amount: 0,
          },
        ],
      } as Partial<Order>),
    );
    await flushPromises();

    const quantity = wrapper.find('input[type="number"]');
    expect(quantity.exists()).toBe(true);
    await quantity.setValue(0);
    await flushPromises();

    expect(saveButton(wrapper).attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("Проверьте изменённые позиции");
  });

  it("не теряет набранный комментарий при обновлении заказа", async () => {
    const order = makeOrder();
    const { store, wrapper } = mountDetail(order);
    await flushPromises();

    await commentField(wrapper).setValue("карта");
    await flushPromises();

    // Фоновое обновление заказа приходит с прежним пустым комментарием.
    store.$patch({ currentOrder: { ...order, updated_at: "2026-07-27T02:00:00.000Z" } });
    await flushPromises();

    expect((commentField(wrapper).element as HTMLTextAreaElement).value).toBe("карта");
    expect(saveButton(wrapper).attributes("disabled")).toBeUndefined();
  });
});
