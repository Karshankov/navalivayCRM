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
  vi.spyOn(store, "fetchOrderAudit").mockResolvedValue([]);
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
  return wrapper.get('[data-test="order-save"]');
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

  it("загружает аватар через прокси, сохраняет Telegram-ссылку и показывает заглушку при ошибке", async () => {
    const { store, wrapper } = mountDetail(makeOrder({
      customer_id: "customer /1", customer_telegram_id: "12345", telegram_username: "customer_test", customer_name: "Тест Клиент",
    }));
    await flushPromises();
    const avatar = wrapper.get('[data-test="customer-avatar"] img');
    expect(avatar.attributes("src")).toBe("/api/customer-photo/customer%20%2F1");
    expect(avatar.attributes("src")).not.toContain("api.telegram.org");
    expect(wrapper.get('a[href="https://t.me/customer_test"]').text()).toBe("@customer_test");
    await avatar.trigger("error");
    expect(wrapper.find('[data-test="customer-avatar"] img').exists()).toBe(false);
    expect(wrapper.find('[data-test="customer-avatar-fallback"]').exists()).toBe(true);
    store.$patch({ currentOrder: { ...store.currentOrder!, customer_id: "customer-2" } });
    await flushPromises();
    expect(wrapper.get('[data-test="customer-avatar"] img').attributes("src")).toBe("/api/customer-photo/customer-2");
    wrapper.unmount();
  });

  it("показывает стандартный аватар для заказа без клиента и Telegram", async () => {
    const { wrapper } = mountDetail(makeOrder({ customer_id: null, telegram_username: undefined }));
    await flushPromises();
    expect(wrapper.find('[data-test="customer-avatar"] img').exists()).toBe(false);
    expect(wrapper.get('[data-test="customer-avatar-fallback"]').attributes("aria-label")).toBe("Стандартный аватар клиента");
    wrapper.unmount();
  });

  it("размещает единственный таймлайн непосредственно под верхними карточками", async () => {
    const { wrapper } = mountDetail(makeOrder());
    await flushPromises();
    const hero = wrapper.get(".order-detail-hero-grid").element;
    const timeline = wrapper.get(".order-detail-top-timeline").element;
    expect(wrapper.findAll(".order-audit")).toHaveLength(1);
    expect(timeline.parentElement).toBe(hero.parentElement);
    expect(hero.nextElementSibling).toBe(timeline);
    wrapper.unmount();
  });

  it("показывает иконки всех доступных финансовых показателей", async () => {
    const { wrapper } = mountDetail(makeOrder({ additional_cost: 3 }));
    await flushPromises();
    const labels = wrapper.findAll(".order-detail-stat-grid dt");
    expect(labels.length).toBeGreaterThanOrEqual(8);
    for (const label of labels) expect(label.find(".order-detail-stat-icon svg").exists()).toBe(true);
    expect(wrapper.findAll(".order-detail-discount-icon")).toHaveLength(2);
    expect(wrapper.find(".order-detail-pay-icon svg").exists()).toBe(true);
    wrapper.unmount();
  });

  it("скрывает служебные поля без потери существующего комментария", async () => {
    const { wrapper } = mountDetail(makeOrder({ notes: "Существующий комментарий" }));
    await flushPromises();
    expect(wrapper.get('[data-test="order-delivery-type"]').attributes("style")).toContain("display: none");
    expect(wrapper.get('[data-test="order-manager-comment"]').attributes("style")).toContain("display: none");
    expect((commentField(wrapper).element as HTMLTextAreaElement).value).toBe("Существующий комментарий");
    expect(saveButton(wrapper).attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });

  it("оставляет адрес доставки доступным при скрытых служебных полях", async () => {
    const { wrapper } = mountDetail(makeOrder({ delivery_type: "delivery", delivery_address: "Тестовый адрес" }));
    await flushPromises();
    expect(wrapper.get('[data-test="order-delivery-type"]').attributes("style")).toContain("display: none");
    expect(wrapper.get('[data-test="order-manager-comment"]').attributes("style")).toContain("display: none");
    const address = wrapper.findAll("textarea").find(field => String(field.attributes("placeholder") || "").includes("Улица"))!;
    expect(address.isVisible()).toBe(true);
    expect((address.element as HTMLTextAreaElement).value).toBe("Тестовый адрес");
    wrapper.unmount();
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

  it("показывает три строки, но считает количество и деньги по всем позициям", async () => {
    const items = [1, 2, 3, 4].map((quantity, index) => ({
      ...brokenItem(),
      id: `item-${index}`,
      product_id: `product-${index}`,
      product_title: `Товар ${index}`,
      quantity,
      price_per_unit: 10,
      cost_per_unit: 2,
      manual_discount_amount: 1,
      loyalty_discount_amount: 0,
      loyalty_units_applied: 0,
      discount_amount: 1,
      total_price: 10 * quantity - 1,
      total_cost: 2 * quantity,
    }));
    const { store, wrapper } = mountDetail(makeOrder({
      items, total_amount: 100, final_amount: 82.4,
      discount_amount: 10, discount_percent: 10, additional_cost: 5,
    } as Partial<Order>));
    const update = vi.spyOn(store, "updateOrder");
    await flushPromises();
    const money = (selector: string) => Number(wrapper.get(selector).text()
      .replace(/[^\d,.-]/g, "").replace(",", "."));

    expect(wrapper.findAll("article.order-detail-product")).toHaveLength(3);
    expect(wrapper.text()).toMatch(/Общее количество товаров:\s*10/);
    expect(money('[data-test="order-final-amount"]')).toBeCloseTo(82.4, 2);
    expect(money('[data-test="order-expected-profit"]')).toBeCloseTo(62.4, 2);
    await wrapper.get("button.order-detail-show-more").trigger("click");
    expect(wrapper.findAll("article.order-detail-product")).toHaveLength(4);
    await wrapper.get("button.order-detail-show-more").trigger("click");
    expect(wrapper.findAll("article.order-detail-product")).toHaveLength(3);
    expect(update).not.toHaveBeenCalled();
    expect(saveButton(wrapper).attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });

  it("сохраняет только комментарий и версию, не пересобирая старые позиции", async () => {
    const order = makeOrder({ audit_revision: 4 });
    const { store, wrapper } = mountDetail(order);
    const update = vi.spyOn(store, "updateOrder")
      .mockResolvedValue({ ...order, notes: "карта", audit_revision: 5 } as any);
    await flushPromises();
    await commentField(wrapper).setValue("карта");
    await saveButton(wrapper).trigger("click");
    await flushPromises();
    expect(update).toHaveBeenCalledWith(order.id, {
      notes: "карта", expected_audit_revision: 4,
    });
    expect(saveButton(wrapper).attributes("disabled")).toBeDefined();
    expect(store.fetchOrderAudit).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it("оставляет черновик после конфликта и не добавляет события локально", async () => {
    const order = makeOrder({ audit_revision: 4 });
    const { store, wrapper } = mountDetail(order);
    vi.spyOn(store, "updateOrder").mockRejectedValue(Object.assign(
      new Error("Заказ изменён другим пользователем"), { code: "order_conflict" },
    ));
    await flushPromises();
    await commentField(wrapper).setValue("Мой черновик");
    await saveButton(wrapper).trigger("click");
    await flushPromises();
    expect((commentField(wrapper).element as HTMLTextAreaElement).value).toBe("Мой черновик");
    expect(saveButton(wrapper).attributes("disabled")).toBeUndefined();
    expect(store.fetchOrderAudit).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain("Заказ изменён другим сотрудником или покупателем");
    expect(wrapper.text()).toContain("Ваш черновик сохранён");
    wrapper.unmount();
  });

  it("не отправляет повторное сохранение, пока первое не завершилось", async () => {
    const order = makeOrder();
    const { store, wrapper } = mountDetail(order);
    let finish!: (value: any) => void;
    const update = vi.spyOn(store, "updateOrder").mockImplementation(() =>
      new Promise((resolve) => { finish = resolve; }),
    );
    await flushPromises();
    await commentField(wrapper).setValue("карта");
    await saveButton(wrapper).trigger("click");
    expect(saveButton(wrapper).attributes("disabled")).toBeDefined();
    await saveButton(wrapper).trigger("click");
    expect(update).toHaveBeenCalledTimes(1);
    finish({ ...order, notes: "карта" });
    await flushPromises();
    expect(saveButton(wrapper).attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });

  it("показывает Telegram-имя заголовком вместо слова Клиент", async () => {
    const { wrapper } = mountDetail(makeOrder({
      customer_id: "c1", customer_telegram_id: "12345", first_name: "Анна", last_name: "Иванова",
      customer_name: "Гость", telegram_username: "anna",
    }));
    await flushPromises();
    expect(wrapper.get('[data-test="customer-display-name"]').text()).toBe("Анна Иванова");
    expect(wrapper.find(".order-detail-customer-name").exists()).toBe(false);
    expect(wrapper.get(".order-detail-customer").text()).not.toContain("Гость");
    wrapper.unmount();
  });

  it("не называет Telegram-клиента гостем при отсутствии имени", async () => {
    const { wrapper } = mountDetail(makeOrder({
      customer_id: "c1", customer_telegram_id: "12345", customer_name: "Гость",
    }));
    await flushPromises();
    expect(wrapper.get('[data-test="customer-display-name"]').text()).toBe("Пользователь Telegram");
    wrapper.unmount();
  });

  it("оставляет Гость только для заказа без Telegram", async () => {
    const { wrapper } = mountDetail(makeOrder({ customer_id: null, customer_name: "Гость" }));
    await flushPromises();
    expect(wrapper.get('[data-test="customer-display-name"]').text()).toBe("Гость");
    wrapper.unmount();
  });

  it("сохраняет изображение позиции, управление количеством и отдельную карточку суммы", async () => {
    const { wrapper } = mountDetail(makeOrder({ items: [{
      ...brokenItem(), manual_discount_amount: 0, loyalty_discount_amount: 0,
      product_image_url: "/uploads/thumbnails/covers/group.webp",
    }] }));
    await flushPromises();
    const row = wrapper.get("article.order-detail-product");
    expect(row.get(".order-detail-product-thumb img").attributes("src")).toBe("/uploads/thumbnails/covers/group.webp");
    expect(row.findAll(".order-detail-product-field")).toHaveLength(3);
    await row.get('button[aria-label="Увеличить количество: Жидкость"]').trigger("click");
    expect((row.get('input[aria-label="Количество: Жидкость"]').element as HTMLInputElement).value).toBe("2");
    expect(row.get(".order-detail-product-sum").text()).toContain("32");
    await row.get(".order-detail-product-thumb img").trigger("error");
    expect(row.find(".order-detail-product-thumb svg").exists()).toBe(true);
    wrapper.unmount();
  });

  it("не показывает пояснение о сборке под статусом при включённом учёте сотрудников", async () => {
    const { store, wrapper } = mountDetail(makeOrder());
    await flushPromises();
    store.$patch({ staffTrackingEnabled: true });
    await flushPromises();
    expect(wrapper.get(".order-detail-status-picker").text()).not.toContain("Сборка и выдача выполняются");
    expect(wrapper.get(".order-detail-status-picker select").exists()).toBe(true);
    wrapper.unmount();
  });

  it("показывает все операции истории, а не четыре демонстрационных шага", async () => {
    const { store, wrapper } = mountDetail(makeOrder());
    await flushPromises();
    const events = Array.from({ length: 7 }, (_, index) => ({
      id: `event-${index}`, operation_id: `operation-${index}`, sequence: index + 1,
      occurred_at: `2026-10-11T12:0${index}:00.000Z`, actor_type: "admin", actor_name: "Менеджер",
      actor_id: "admin", source: "crm.update", event_type: "field_changed", field: "notes",
      before: "", after: `Комментарий ${index}`, product_id: null, product_title: null,
    }));
    vi.mocked(store.fetchOrderAudit).mockResolvedValue(events as any);
    await wrapper.findAll("button").find((button) => button.text() === "Обновить историю")!.trigger("click");
    await flushPromises();
    expect(wrapper.findAll(".audit-step")).toHaveLength(7);
    await wrapper.get("button.audit-toggle").trigger("click");
    expect(wrapper.findAll(".audit-event")).toHaveLength(7);
    wrapper.unmount();
  });

  it.each([
    ["new", "Новый"],
    ["in_progress", "Собран"],
    ["completed", "Выдан"],
    ["delivered", "Выдан"],
    ["cancelled", "Отменён"],
  ] as const)("показывает подпись и значок статуса %s", async (status, label) => {
    const { wrapper } = mountDetail(makeOrder({ status }));
    await flushPromises();
    const card = wrapper.get(".order-detail-current-status");
    expect(card.attributes("data-status")).toBe(status);
    expect(card.get(".order-detail-status-caption").text()).toBe("Статус заказа");
    expect(card.get('[data-test="order-detail-status"]').text()).toBe(label);
    const icon = card.get(".order-detail-status-tick svg");
    if (status === "new") {
      expect(icon.find("circle").exists()).toBe(true);
    } else {
      expect(icon.get("path").attributes("d")).toBe(
        status === "cancelled" ? "m6 6 12 12M18 6 6 18" : "m5 12 4 4L19 6",
      );
    }
    wrapper.unmount();
  });

  it("сохраняет слоты подсказки и черновика при выборе статуса и сбросе", async () => {
    const { store, wrapper } = mountDetail(makeOrder({ status: "new" }));
    const update = vi.spyOn(store, "updateOrder");
    await flushPromises();
    const hintElement = wrapper.get(".order-detail-save-hint").element;
    const draftElement = wrapper.get(".order-detail-status-draft").element;
    expect(wrapper.get(".order-detail-status-draft").classes()).toContain("order-detail-status-draft-hidden");
    expect(wrapper.get(".order-detail-status-draft").attributes("aria-hidden")).toBe("true");
    await wrapper.get("select").setValue("in_progress");
    expect(wrapper.get(".order-detail-save-hint").element).toBe(hintElement);
    expect(wrapper.get(".order-detail-save-hint").text()).toBe("");
    expect(wrapper.get(".order-detail-status-draft").element).toBe(draftElement);
    expect(wrapper.get(".order-detail-status-draft").classes()).not.toContain("order-detail-status-draft-hidden");
    expect(wrapper.get(".order-detail-status-draft").attributes("aria-hidden")).toBe("false");
    expect(update).not.toHaveBeenCalled();
    await wrapper.findAll("button").find((button) => button.text() === "Сбросить изменения")!.trigger("click");
    expect(wrapper.get(".order-detail-save-hint").element).toBe(hintElement);
    expect(wrapper.get(".order-detail-status-draft").element).toBe(draftElement);
    expect(wrapper.get(".order-detail-status-draft").classes()).toContain("order-detail-status-draft-hidden");
    wrapper.unmount();
  });

  it("показывает реальную ячейку и меняет статус только в черновике", async () => {
    const { store, wrapper } = mountDetail(makeOrder({
      status: "new", pickup_cell_number: 7, telegram_username: "customer_test",
    }));
    const update = vi.spyOn(store, "updateOrder");
    await flushPromises();
    expect(wrapper.get('[data-test="order-detail-cell"]').text()).toBe("Ячейка 7");
    expect(wrapper.get('a[href="https://t.me/customer_test"]').text()).toBe("@customer_test");
    await wrapper.get("select").setValue("in_progress");
    expect(wrapper.get('[data-test="order-detail-status"]').text()).toBe("Собран");
    expect(wrapper.text()).toContain("Не сохранён");
    expect(update).not.toHaveBeenCalled();
    await wrapper.findAll("button").find((button) => button.text() === "Сбросить изменения")!.trigger("click");
    expect(wrapper.get('[data-test="order-detail-status"]').text()).toBe("Новый");
    expect(saveButton(wrapper).attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });
});
