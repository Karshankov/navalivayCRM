import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, ref } from "vue";
import AdminStockTransferModal from "@/components/admin/AdminStockTransferModal.vue";
import { useAdminStore } from "@/stores/admin";
import { useCrmStore } from "@/stores/crm";

const AdminModalStub = defineComponent({
  props: ["isOpen", "title", "description"],
  emits: ["close", "cancel"],
  setup(_props, { expose }) {
    const scrollContainer = ref<HTMLElement | null>(null);
    expose({ scrollContainer });
    return { scrollContainer };
  },
  template: `<section v-if="isOpen" data-test="admin-modal" :data-modal-title="title">
    <div ref="scrollContainer" data-test="modal-scroll"><slot /></div>
    <slot name="footer" />
  </section>`,
});

const StaffActorPromptStub = defineComponent({
  props: ["open", "context"],
  emits: ["confirm", "close"],
  template: '<div v-if="open" data-test="actor-prompt" />',
});

function mountModal(props: Record<string, unknown>) {
  return mount(AdminStockTransferModal, {
    props: { isOpen: false, initialSource: "warehouse", ...props },
    global: {
      stubs: {
        AdminModal: AdminModalStub,
        StaffActorPrompt: StaffActorPromptStub,
      },
    },
  });
}

function submitButton(wrapper: ReturnType<typeof mountModal>) {
  return wrapper.findAll("button").find((button) => button.text().includes("Создать заявку"));
}

describe("AdminStockTransferModal: открытие с готовым составом", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    // Без учёта сотрудников форма отправляется сразу, без окна с ПИН.
    useCrmStore().$patch({ staffTrackingEnabled: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("открывается сразу формой, склад → розница, и не грузит список заявок", async () => {
    const store = useAdminStore();
    const transfersSpy = vi.spyOn(store, "fetchInventoryTransfers").mockResolvedValue({
      transfers: [],
      pagination: { page: 1, totalPages: 1 },
    } as never);
    vi.spyOn(store, "fetchInventoryGroups").mockResolvedValue([] as never);
    vi.spyOn(store, "fetchInventoryItems").mockResolvedValue([] as never);

    const wrapper = mountModal({
      openInCreate: true,
      initialItems: [
        {
          productId: "p1",
          variantId: null,
          title: "Манго",
          categoryName: "Жидкости",
          groupName: "PODONKI PODGON",
          available: 5,
          quantity: 2,
        },
      ],
    });
    await wrapper.setProps({ isOpen: true });
    await flushPromises();

    expect(wrapper.text()).toContain("Создать заявку на 2 шт");
    expect(wrapper.text()).toContain("Манго");
    // Направление подставлено: со склада в розницу.
    expect(wrapper.text()).toContain("Склад");
    expect(wrapper.text()).toContain("Розница");
    // Список перемещений в этом сценарии не нужен.
    expect(transfersSpy).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it("обрезает количество до складского остатка и убирает дубли", async () => {
    const store = useAdminStore();
    vi.spyOn(store, "fetchInventoryTransfers").mockResolvedValue({
      transfers: [],
      pagination: { page: 1, totalPages: 1 },
    } as never);
    vi.spyOn(store, "fetchInventoryGroups").mockResolvedValue([] as never);
    vi.spyOn(store, "fetchInventoryItems").mockResolvedValue([] as never);

    const wrapper = mountModal({
      openInCreate: true,
      initialItems: [
        { productId: "p1", variantId: null, title: "Манго", available: 5, quantity: 99 },
        { productId: "p1", variantId: null, title: "Манго", available: 5, quantity: 99 },
        // Нет остатка в источнике — позицию не добавляем.
        { productId: "p2", variantId: null, title: "Пусто", available: 0, quantity: 3 },
      ],
    });
    await wrapper.setProps({ isOpen: true });
    await flushPromises();

    expect(wrapper.text()).toContain("Создать заявку на 5 шт");
    expect(wrapper.text()).not.toContain("Пусто");

    wrapper.unmount();
  });

  it("создаёт заявку с позициями и количествами из списка", async () => {
    const store = useAdminStore();
    vi.spyOn(store, "fetchInventoryTransfers").mockResolvedValue({
      transfers: [],
      pagination: { page: 1, totalPages: 1 },
    } as never);
    vi.spyOn(store, "fetchInventoryGroups").mockResolvedValue([] as never);
    vi.spyOn(store, "fetchInventoryItems").mockResolvedValue([] as never);
    const createSpy = vi.spyOn(store, "createInventoryTransfer").mockResolvedValue({
      id: "move_7",
      transfer_number: 7,
      source_location: "warehouse",
      destination_location: "retail",
      status: "draft",
      created_at: "2026-08-01 10:00:00",
      total_quantity: 2,
      item_count: 1,
      items: [],
    } as never);

    const wrapper = mountModal({
      openInCreate: true,
      initialItems: [
        {
          productId: "p1",
          variantId: "v1",
          title: "Холодная",
          categoryName: "Жидкости",
          groupName: "PODONKI PODGON",
          available: 5,
          quantity: 2,
        },
      ],
    });
    await wrapper.setProps({ isOpen: true });
    await flushPromises();

    const button = submitButton(wrapper);
    expect(button).toBeTruthy();
    await button!.trigger("click");
    await flushPromises();

    expect(createSpy).toHaveBeenCalledTimes(1);
    const payload = createSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.source_location).toBe("warehouse");
    expect(payload.destination_location).toBe("retail");
    expect(payload.items).toEqual([{ product_id: "p1", variant_id: "v1", quantity: 2 }]);
    expect(wrapper.emitted("saved")).toBeTruthy();

    wrapper.unmount();
  });

  it("без openInCreate по-прежнему открывает список перемещений", async () => {
    const store = useAdminStore();
    const transfersSpy = vi.spyOn(store, "fetchInventoryTransfers").mockResolvedValue({
      transfers: [],
      pagination: { page: 1, totalPages: 1 },
    } as never);

    const wrapper = mountModal({});
    await wrapper.setProps({ isOpen: true });
    await flushPromises();

    expect(transfersSpy).toHaveBeenCalled();
    expect(wrapper.text()).toContain("Новая заявка");

    wrapper.unmount();
  });

  it("с openInCreate и без состава открывает пустую форму, а не список", async () => {
    const store = useAdminStore();
    const transfersSpy = vi.spyOn(store, "fetchInventoryTransfers").mockResolvedValue({
      transfers: [],
      pagination: { page: 1, totalPages: 1 },
    } as never);
    vi.spyOn(store, "fetchInventoryGroups").mockResolvedValue([] as never);
    vi.spyOn(store, "fetchInventoryItems").mockResolvedValue([] as never);

    const wrapper = mountModal({ openInCreate: true });
    await wrapper.setProps({ isOpen: true });
    await flushPromises();

    expect(transfersSpy).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Комментарий");
    expect(wrapper.text()).toContain("Создать заявку на 0 шт");

    wrapper.unmount();
  });

  it("подрезает количество, если складского остатка стало меньше", async () => {
    const store = useAdminStore();
    vi.spyOn(store, "fetchInventoryTransfers").mockResolvedValue({
      transfers: [],
      pagination: { page: 1, totalPages: 1 },
    } as never);
    vi.spyOn(store, "fetchInventoryGroups").mockResolvedValue([] as never);
    // Список кандидатов показывал 5 шт, но на складе осталось 2: сервер такую
    // заявку отклонил бы целиком, поэтому максимум берём из свежего ответа.
    vi.spyOn(store, "fetchInventoryItems").mockResolvedValue([
      { id: "p1", product_id: "p1", is_variant: false, title: "Манго", available_stock: 2 },
    ] as never);

    const wrapper = mountModal({
      openInCreate: true,
      initialItems: [{ productId: "p1", variantId: null, title: "Манго", available: 5, quantity: 5 }],
    });
    await wrapper.setProps({ isOpen: true });
    await flushPromises();

    expect(wrapper.text()).toContain("Создать заявку на 2 шт");

    wrapper.unmount();
  });
});