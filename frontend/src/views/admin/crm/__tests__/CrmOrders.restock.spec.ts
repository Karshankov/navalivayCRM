import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent } from "vue";
import CrmOrders from "@/views/admin/crm/CrmOrders.vue";
import { useCrmStore } from "@/stores/crm";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

const AdminModalStub = defineComponent({
  props: ["isOpen", "title"],
  emits: ["close", "confirm"],
  template: `<section v-if="isOpen"><h2>{{ title }}</h2><slot /><slot name="footer" /></section>`,
});

const RestockStub = defineComponent({
  name: "RestockSuggestionsModal",
  props: ["isOpen", "groups", "totals", "threshold", "loading", "errorText"],
  emits: ["close", "retry", "transfer", "open-transfers"],
  // Кнопки повторяют контракт настоящего окна: так тест проверяет, что
  // экран заказов правильно реагирует на его события.
  template: `<div v-if="isOpen" data-test="restock-stub">
    <button
      data-test="restock-emit-transfer"
      @click="$emit('transfer', { items: [{ productId: 'p1', variantId: null, displayName: 'Манго', groupName: 'PODONKI PODGON', categoryName: 'Жидкости', warehouseStock: 5, quantity: 3 }] })"
    >Создать заявку</button>
    <button data-test="restock-emit-all" @click="$emit('open-transfers')">Все перемещения</button>
  </div>`,
});

const TransferStub = defineComponent({
  name: "AdminStockTransferModal",
  props: ["isOpen", "initialSource", "initialItems", "openInCreate"],
  emits: ["close", "saved", "completed", "cancelled"],
  template: '<div v-if="isOpen" data-test="transfer-stub" />',
});

let wrapper: VueWrapper | undefined;

async function setup(
  restock: {
    itemCount: number;
    groupCount: number;
    draftItemCount?: number;
    /** Достигнут ли порог показа — по умолчанию «да», если есть позиции. */
    triggered?: boolean;
  } = { itemCount: 3, groupCount: 2, draftItemCount: 0 },
) {
  const store = useCrmStore();
  store.orders = [];
  store.restockItemCount = restock.itemCount;
  store.restockGroupCount = restock.groupCount;
  store.restockDraftItemCount = restock.draftItemCount ?? 0;
  // Значок виден только при достигнутом пороге: в тестах по умолчанию считаем,
  // что порог достигнут, если позиции есть.
  store.restockTriggered = restock.triggered ?? restock.itemCount > 0;
  vi.spyOn(store, "fetchKanbanBoard").mockResolvedValue(undefined as never);
  vi.spyOn(store, "fetchPickupCells").mockResolvedValue(undefined as never);
  vi.spyOn(store, "fetchCashAccounts").mockResolvedValue(undefined as never);
  vi.spyOn(store, "unlockAudioContext").mockImplementation(() => {});
  vi.spyOn(store, "fetchRestockSummary").mockResolvedValue(null);
  const fetchCandidates = vi
    .spyOn(store, "fetchRestockCandidates")
    .mockResolvedValue([] as never);
  const refreshRestock = vi
    .spyOn(store, "refreshRestockState")
    .mockResolvedValue(undefined as never);

  wrapper = mount(CrmOrders, {
    global: {
      stubs: {
        AdminModal: AdminModalStub,
        RestockSuggestionsModal: RestockStub,
        AdminStockTransferModal: TransferStub,
        CustomerHubModal: true,
        FindInviterModal: true,
        CustomerBlockModal: true,
        CustomerNoteModal: true,
        CustomerInviteBanModal: true,
        OrderCreateModal: true,
        CardPaymentsModal: true,
        StaffShiftBar: {
          template:
            '<section data-test="staff-shift-bar"><slot name="financial-close" /></section>',
        },
        StaffCurrentActorBadge: true,
        CrmProfitPasswordField: true,
        CrmButton: true,
        ManagerActionSummary: true,
        DiscountBlockModal: true,
        CustomerSettingsModal: true,
        FinancialDayCloseModal: true,
      },
    },
  });
  await flushPromises();
  return { store, wrapper, fetchCandidates, refreshRestock };
}

beforeEach(() => {
  setActivePinia(createPinia());
  push.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ userbot_connected: true }), { status: 200 }),
    ),
  );
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("CrmOrders: значок «заканчивается в рознице»", () => {
  it("не показывается, когда пополнять нечего", async () => {
    await setup({ itemCount: 0, groupCount: 0 });
    expect(wrapper!.find('[data-test="orders-restock-flag"]').exists()).toBe(false);
  });

  it("показывает количество позиций и подпись для менеджера", async () => {
    await setup({ itemCount: 5, groupCount: 2 });
    const flag = wrapper!.get('[data-test="orders-restock-flag"]');
    expect(flag.text()).toBe("5");
    expect(flag.attributes("aria-label")).toContain("Заканчивается в рознице: 5 поз.");
    expect(flag.attributes("title")).toContain("в 2 линейках");
    expect(flag.attributes("aria-haspopup")).toBe("dialog");
  });

  it("скрыт, пока не достигнут порог показа", async () => {
    // Позиции есть, но порог (например, 25) не набран — значок не отвлекает.
    await setup({ itemCount: 5, groupCount: 2, triggered: false });
    expect(wrapper!.find('[data-test="orders-restock-flag"]').exists()).toBe(false);
  });

  it("ограничивает счётчик значением 99+", async () => {
    await setup({ itemCount: 148, groupCount: 9 });
    expect(wrapper!.get('[data-test="orders-restock-flag"]').text()).toBe("99+");
  });

  it("по клику перечитывает список и открывает окно", async () => {
    const { fetchCandidates } = await setup();
    await wrapper!.get('[data-test="orders-restock-flag"]').trigger("click");
    await flushPromises();

    expect(fetchCandidates).toHaveBeenCalledTimes(1);
    const modal = wrapper!.findComponent(RestockStub);
    expect(modal.props("isOpen")).toBe(true);
    expect(modal.props("threshold")).toBe(0);
    expect(wrapper!.get('[data-test="orders-restock-flag"]').attributes("aria-expanded")).toBe(
      "true",
    );
  });

  it("закрывает окно со списком", async () => {
    await setup();
    await wrapper!.get('[data-test="orders-restock-flag"]').trigger("click");
    await flushPromises();
    wrapper!.findComponent(RestockStub).vm.$emit("close");
    await flushPromises();
    expect(wrapper!.findComponent(RestockStub).props("isOpen")).toBe(false);
  });

  it("передаёт выбранные позиции в форму перемещения склад → розница", async () => {
    await setup();
    await wrapper!.get('[data-test="orders-restock-flag"]').trigger("click");
    await flushPromises();

    wrapper!.findComponent(RestockStub).vm.$emit("transfer", {
      items: [
        {
          productId: "p1",
          variantId: null,
          displayName: "Манго",
          groupName: "PODONKI PODGON",
          categoryName: "Жидкости",
          warehouseStock: 7,
          quantity: 3,
        },
        {
          productId: "p2",
          variantId: "v2",
          displayName: "Холодная вишня",
          groupName: "PODONKI PODGON",
          categoryName: "Жидкости",
          warehouseStock: 4,
          quantity: 0,
        },
      ],
    });
    await flushPromises();

    // Список закрывается до открытия формы: две модалки одновременно нельзя.
    expect(wrapper!.findComponent(RestockStub).props("isOpen")).toBe(false);

    const transfer = wrapper!.findComponent(TransferStub);
    expect(transfer.props("isOpen")).toBe(true);
    expect(transfer.props("openInCreate")).toBe(true);
    expect(transfer.props("initialSource")).toBe("warehouse");
    expect(transfer.props("initialItems")).toEqual([
      {
        productId: "p1",
        variantId: null,
        title: "Манго",
        categoryName: "Жидкости",
        groupName: "PODONKI PODGON",
        available: 7,
        quantity: 3,
      },
    ]);
  });

  it("открывает список всех перемещений по второй кнопке", async () => {
    await setup();
    await wrapper!.get('[data-test="orders-restock-flag"]').trigger("click");
    await flushPromises();
    wrapper!.findComponent(RestockStub).vm.$emit("open-transfers");
    await flushPromises();

    expect(wrapper!.findComponent(RestockStub).props("isOpen")).toBe(false);
    const transfer = wrapper!.findComponent(TransferStub);
    expect(transfer.props("isOpen")).toBe(true);
    expect(transfer.props("openInCreate")).toBe(false);
    expect(transfer.props("initialItems")).toEqual([]);
  });

  it("после сохранения и оприходования обновляет числа на значке", async () => {
    const { refreshRestock } = await setup();

    wrapper!.findComponent(TransferStub).vm.$emit("saved", { number: 7 });
    await flushPromises();
    expect(refreshRestock).toHaveBeenCalled();

    wrapper!.findComponent(TransferStub).vm.$emit("completed", {
      quantity: 5,
      destination: "retail",
    });
    await flushPromises();
    expect(refreshRestock).toHaveBeenCalledTimes(2);
    expect(wrapper!.text()).toContain("Перемещено 5 шт в розницу");
  });

  it("считает только позиции, которые ещё не в заявке", async () => {
    // 5 кандидатов, 2 уже в черновике → значок зовёт к 3 оставшимся.
    await setup({ itemCount: 5, groupCount: 2, draftItemCount: 2 });
    const flag = wrapper!.get('[data-test="orders-restock-flag"]');
    expect(flag.text()).toBe("3");
    expect(flag.attributes("title")).toContain("Ещё 2 поз. уже в заявках");
  });

  it("прячет значок, когда все кандидаты уже в заявках", async () => {
    await setup({ itemCount: 4, groupCount: 2, draftItemCount: 4 });
    expect(wrapper!.find('[data-test="orders-restock-flag"]').exists()).toBe(false);
  });

  it("возвращает к списку, если форму перемещения закрыли и передумали", async () => {
    const { fetchCandidates } = await setup();
    await wrapper!.get('[data-test="orders-restock-flag"]').trigger("click");
    await flushPromises();
    await wrapper!.get('[data-test="restock-emit-transfer"]').trigger("click");
    await flushPromises();
    expect(wrapper!.findComponent(TransferStub).props("isOpen")).toBe(true);

    fetchCandidates.mockClear();
    wrapper!.findComponent(TransferStub).vm.$emit("close");
    await flushPromises();

    // Не выбрасываем на доску заказов: возвращаемся к списку и обновляем его.
    expect(wrapper!.findComponent(TransferStub).props("isOpen")).toBe(false);
    expect(wrapper!.findComponent(RestockStub).props("isOpen")).toBe(true);
    expect(fetchCandidates).toHaveBeenCalledTimes(1);
  });

  it("показывает ошибку загрузки и даёт повторить", async () => {
    const { fetchCandidates } = await setup();
    // Сбой загрузки экран пишет в консоль: в тесте это только шум.
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchCandidates.mockRejectedValueOnce(new Error("network"));

    await wrapper!.get('[data-test="orders-restock-flag"]').trigger("click");
    await flushPromises();
    expect(wrapper!.findComponent(RestockStub).props("errorText")).toContain(
      "Не удалось загрузить список",
    );

    wrapper!.findComponent(RestockStub).vm.$emit("retry");
    await flushPromises();
    expect(fetchCandidates).toHaveBeenCalledTimes(2);
  });
});