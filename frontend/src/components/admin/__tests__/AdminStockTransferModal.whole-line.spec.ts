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

function mountModal(props: Record<string, unknown> = {}) {
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

/** Линейка из трёх позиций с остатками и двумя пустыми: пустые брать нельзя. */
const LINE_ITEMS = [
  {
    id: "p1",
    product_id: "p1",
    title: "Вишня",
    groupId: "g1",
    group_name: "CATSWILL SOUR",
    is_variant: false,
    available_stock: 3,
    retail_stock: 0,
    warehouse_stock: 3,
  },
  {
    id: "p2",
    product_id: "p2",
    title: "Манго",
    groupId: "g1",
    group_name: "CATSWILL SOUR",
    is_variant: false,
    available_stock: 2,
    retail_stock: 0,
    warehouse_stock: 2,
  },
  {
    id: "p3",
    product_id: "p3",
    title: "Лимон",
    groupId: "g1",
    group_name: "CATSWILL SOUR",
    is_variant: false,
    available_stock: 1,
    retail_stock: 0,
    warehouse_stock: 1,
  },
  {
    id: "p4",
    product_id: "p4",
    title: "Пустой товар",
    groupId: "g1",
    group_name: "CATSWILL SOUR",
    is_variant: false,
    available_stock: 0,
    retail_stock: 0,
    warehouse_stock: 0,
  },
];

async function openFormWithLine(wrapper: ReturnType<typeof mountModal>) {
  await wrapper.setProps({ isOpen: true });
  await flushPromises();
  // Открываем форму создания: со склада в розницу.
  const createButton = wrapper
    .findAll("button")
    .find((button) => button.text().includes("Создать перемещение") || button.text().includes("Создать заявку"));
  if (createButton) {
    await createButton.trigger("click");
    await flushPromises();
  }
  const chip = wrapper.findAll('[data-test="transfer-group-chip"]')[1];
  await chip.trigger("click");
  await flushPromises();
}

function wholeLineButton(wrapper: ReturnType<typeof mountModal>) {
  return wrapper.find('[data-test="transfer-add-whole-line"]');
}

describe("AdminStockTransferModal: добавить всю линейку", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useCrmStore().$patch({ staffTrackingEnabled: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function stubStore() {
    const store = useAdminStore();
    vi.spyOn(store, "fetchInventoryTransfers").mockResolvedValue({
      transfers: [],
      pagination: { page: 1, totalPages: 1 },
    } as never);
    vi.spyOn(store, "fetchInventoryGroups").mockResolvedValue([
      { id: "g1", name: "CATSWILL SOUR", categoryId: "c1" },
    ] as never);
    const itemsSpy = vi.spyOn(store, "fetchInventoryItems").mockResolvedValue(LINE_ITEMS as never);
    return { store, itemsSpy };
  }

  it("кнопка появляется только при выбранной линейке", async () => {
    stubStore();
    const wrapper = mountModal({ openInCreate: true });
    await wrapper.setProps({ isOpen: true });
    await flushPromises();

    // Линейка не выбрана — кнопки нет.
    expect(wholeLineButton(wrapper).exists()).toBe(false);
  });

  it("добавляет все позиции линейки с остатком и ставит количество по остатку", async () => {
    stubStore();
    const wrapper = mountModal({ openInCreate: true });
    await openFormWithLine(wrapper);

    const button = wholeLineButton(wrapper);
    expect(button.exists()).toBe(true);
    await button.trigger("click");
    await flushPromises();

    // Три позиции с остатком: 3 + 2 + 1 = 6 шт.
    expect(wrapper.text()).toContain("Создать заявку на 6 шт");
    // Смотрим состав заявки, а не список поиска: «Пустой товар» в результатах
    // поиска есть, но в заявку попасть не должен.
    expect(wrapper.findAll("tbody tr")).toHaveLength(3);
    const plan = wrapper.find("table").text();
    expect(plan).toContain("Вишня");
    expect(plan).toContain("Манго");
    expect(plan).toContain("Лимон");
    expect(plan).not.toContain("Пустой товар");
  });

  it("показывает заголовок «Вся линейка» с названием и итогом", async () => {
    stubStore();
    const wrapper = mountModal({ openInCreate: true });
    await openFormWithLine(wrapper);
    await wholeLineButton(wrapper).trigger("click");
    await flushPromises();

    const banner = wrapper.find('[data-test="transfer-whole-line-banner"]');
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain("Вся линейка");
    expect(banner.text()).toContain("CATSWILL SOUR");
    expect(banner.text()).toContain("6 шт");
  });

  it("повторное нажатие не удваивает количества и не дублирует позиции", async () => {
    stubStore();
    const wrapper = mountModal({ openInCreate: true });
    await openFormWithLine(wrapper);
    await wholeLineButton(wrapper).trigger("click");
    await flushPromises();
    await wholeLineButton(wrapper).trigger("click");
    await flushPromises();

    // Итог остался прежним: количество доводится до остатка, а не складывается.
    expect(wrapper.text()).toContain("Создать заявку на 6 шт");
    expect(wrapper.findAll('[data-test="transfer-whole-line-banner"]')).toHaveLength(1);
  });

  it("после убавления позиции заголовок снимается — заявка больше не полный комплект", async () => {
    stubStore();
    const wrapper = mountModal({ openInCreate: true });
    await openFormWithLine(wrapper);
    await wholeLineButton(wrapper).trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="transfer-whole-line-banner"]').exists()).toBe(true);

    // Удаляем одну позицию из заявки.
    const removeButton = wrapper
      .findAll("button")
      .find((button) => button.text() === "Удалить");
    await removeButton!.trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-test="transfer-whole-line-banner"]').exists()).toBe(false);
  });

  it("сообщает, когда в линейке нет остатков", async () => {
    const store = useAdminStore();
    vi.spyOn(store, "fetchInventoryTransfers").mockResolvedValue({
      transfers: [],
      pagination: { page: 1, totalPages: 1 },
    } as never);
    vi.spyOn(store, "fetchInventoryGroups").mockResolvedValue([
      { id: "g1", name: "CATSWILL SOUR", categoryId: "c1" },
    ] as never);
    vi.spyOn(store, "fetchInventoryItems").mockResolvedValue([
      { ...LINE_ITEMS[3] },
    ] as never);

    const wrapper = mountModal({ openInCreate: true });
    await openFormWithLine(wrapper);
    await wholeLineButton(wrapper).trigger("click");
    await flushPromises();

    const error = wrapper.find('[data-test="transfer-whole-line-error"]');
    expect(error.exists()).toBe(true);
    expect(error.text()).toContain("нет остатков");
    // В заявку ничего не добавилось.
    expect(wrapper.text()).toContain("Создать заявку на 0 шт");
  });

  it("не предлагает кнопку при отправке из розницы", async () => {
    stubStore();
    const wrapper = mountModal({ openInCreate: true, initialSource: "retail" });
    await wrapper.setProps({ isOpen: true });
    await flushPromises();

    // Лента линеек в рознице не показывается — значит и кнопки нет.
    expect(wrapper.findAll('[data-test="transfer-group-chip"]')).toHaveLength(0);
    expect(wholeLineButton(wrapper).exists()).toBe(false);
  });
});

/**
 * Заголовок в списке заявок — самое опасное место: если он появится на неполной
 * заявке, кладовщик унесёт не тот комплект и решит, что взял всё.
 */
describe("AdminStockTransferModal: заголовок «Вся линейка» в сохранённой заявке", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useCrmStore().$patch({ staffTrackingEnabled: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /**
   * Заявка со складскими остатками: три позиции линейки g1.
   * `composition` — что сейчас лежит на складе (по этому и сверяем комплект).
   */
  function stubDetails(
    transferItems: Array<Record<string, unknown>>,
    composition: Array<Record<string, unknown>>,
  ) {
    const store = useAdminStore();
    vi.spyOn(store, "fetchInventoryTransfers").mockResolvedValue({
      transfers: [
        {
          id: "t1",
          transfer_number: 7,
          source_location: "warehouse",
          destination_location: "retail",
          status: "draft",
          created_at: "2026-11-17 10:00:00",
          total_quantity: 6,
          item_count: 3,
        },
      ],
      pagination: { page: 1, totalPages: 1 },
    } as never);
    vi.spyOn(store, "fetchInventoryGroups").mockResolvedValue([] as never);
    vi.spyOn(store, "fetchInventoryTransfer").mockResolvedValue({
      id: "t1",
      transfer_number: 7,
      source_location: "warehouse",
      destination_location: "retail",
      status: "draft",
      created_at: "2026-11-17 10:00:00",
      total_quantity: 6,
      item_count: transferItems.length,
      items: transferItems,
    } as never);
    vi.spyOn(store, "fetchInventoryItems").mockResolvedValue(composition as never);
  }

  function lineItem(id: string, quantity: number) {
    return {
      id,
      product_id: id,
      variant_id: null,
      product_title: `Товар ${id}`,
      group_id: "g1",
      group_name: "CATSWILL SOUR",
      quantity,
    };
  }

  it("показывает заголовок, когда заявка накрывает линейку целиком", async () => {
    stubDetails(
      [lineItem("p1", 3), lineItem("p2", 2), lineItem("p3", 1)],
      [
        { id: "p1", product_id: "p1", groupId: "g1", group_name: "CATSWILL SOUR", is_variant: false, available_stock: 3 },
        { id: "p2", product_id: "p2", groupId: "g1", group_name: "CATSWILL SOUR", is_variant: false, available_stock: 2 },
        { id: "p3", product_id: "p3", groupId: "g1", group_name: "CATSWILL SOUR", is_variant: false, available_stock: 1 },
      ],
    );

    const wrapper = mountModal();
    await wrapper.setProps({ isOpen: true });
    await flushPromises();
    const card = wrapper.findAll("button").find((b) => b.text().includes("№7"))!;
    await card.trigger("click");
    await flushPromises();

    const banner = wrapper.find('[data-test="transfer-details-whole-line"]');
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain("CATSWILL SOUR");
  });

  it("не показывает заголовок, если в заявке не хватает позиции линейки", async () => {
    stubDetails(
      // В заявке только две позиции из трёх.
      [lineItem("p1", 3), lineItem("p2", 2)],
      [
        { id: "p1", product_id: "p1", groupId: "g1", group_name: "CATSWILL SOUR", is_variant: false, available_stock: 3 },
        { id: "p2", product_id: "p2", groupId: "g1", group_name: "CATSWILL SOUR", is_variant: false, available_stock: 2 },
        { id: "p3", product_id: "p3", groupId: "g1", group_name: "CATSWILL SOUR", is_variant: false, available_stock: 1 },
      ],
    );

    const wrapper = mountModal();
    await wrapper.setProps({ isOpen: true });
    await flushPromises();
    const card = wrapper.findAll("button").find((b) => b.text().includes("№7"))!;
    await card.trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-test="transfer-details-whole-line"]').exists()).toBe(false);
  });

  it("не показывает заголовок, когда остатков в линейке не осталось вовсе", async () => {
    // Пустой состав линейки не должен давать заголовок: иначе он повис бы
    // на каждой заявке, где позиции просто разъехались.
    stubDetails([lineItem("p1", 3)], []);

    const wrapper = mountModal();
    await wrapper.setProps({ isOpen: true });
    await flushPromises();
    const card = wrapper.findAll("button").find((b) => b.text().includes("№7"))!;
    await card.trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-test="transfer-details-whole-line"]').exists()).toBe(false);
  });

  it("не показывает заголовок, если в заявке лишняя позиция сверх остатков", async () => {
    // В заявке три позиции, а на складе осталось две: комплект уже не полный
    // (одну позицию успели развезти), но наборы не совпадают.
    stubDetails(
      [lineItem("p1", 3), lineItem("p2", 2), lineItem("p3", 1)],
      [
        { id: "p1", product_id: "p1", groupId: "g1", group_name: "CATSWILL SOUR", is_variant: false, available_stock: 3 },
        { id: "p2", product_id: "p2", groupId: "g1", group_name: "CATSWILL SOUR", is_variant: false, available_stock: 2 },
      ],
    );

    const wrapper = mountModal();
    await wrapper.setProps({ isOpen: true });
    await flushPromises();
    const card = wrapper.findAll("button").find((b) => b.text().includes("№7"))!;
    await card.trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-test="transfer-details-whole-line"]').exists()).toBe(false);
  });
});
