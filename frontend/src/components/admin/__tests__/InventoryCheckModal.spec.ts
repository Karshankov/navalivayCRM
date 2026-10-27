import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import InventoryCheckModal from "@/components/admin/InventoryCheckModal.vue";

const fetchPreviewMock = vi.fn();
const createCheckMock = vi.fn();

const adminStore = {
  fetchInventoryCheckPreview: fetchPreviewMock,
  createInventoryCheck: createCheckMock,
};

vi.mock("@/stores/admin", () => ({
  useAdminStore: () => adminStore,
}));

const GROUPS = [
  { id: "cg_annima", name: "ANNIMA LOVE KILLER", categoryId: "c_1" },
  { id: "cg_hero", name: "HERO 2 CRYSTAL", categoryId: "c_2" },
];

const PREVIEW = {
  group: { id: "cg_annima", name: "ANNIMA LOVE KILLER" },
  location: "retail",
  items: [
    { product_id: "p_mohito", variant_id: null, title: "Мохито с клубникой", variant_name: null, expected: 6 },
    { product_id: "p_energy", variant_id: null, title: "Энергетик малина", variant_name: null, expected: 5 },
    { product_id: "p_zero", variant_id: null, title: "Апельсин вишня", variant_name: null, expected: 0 },
  ],
  total_expected: 11,
};

async function mountModal() {
  const wrapper = mount(InventoryCheckModal, {
    props: {
      isOpen: true,
      groups: GROUPS,
      initialLocation: "retail",
    },
    global: {
      stubs: {
        AdminModal: {
          template: `<div class="modal-stub"><slot /><slot name="footer" /></div>`,
          props: ["isOpen", "title", "description", "size", "showActions"],
        },
      },
    },
  });
  await flushPromises();
  return wrapper;
}

function inputFor(wrapper: ReturnType<typeof mount>, key: string) {
  return wrapper.find(`[data-test="inventory-input-${key}"]`);
}

/** Выбор линейки через поиск: печатаем название — кликаем опцию из списка. */
async function searchAndPickGroup(wrapper: ReturnType<typeof mount>, query: string, groupName: string) {
  await wrapper.find('[data-test="inventory-group-search"]').setValue(query);
  await flushPromises();
  const options = wrapper.findAll('[data-test="inventory-group-option"]');
  const option = options.find((o) => o.text() === groupName);
  if (!option) {
    throw new Error(`опция линейки «${groupName}» не найдена среди: ${options.map((o) => o.text()).join(", ")}`);
  }
  await option.trigger("click");
  await flushPromises();
}

describe("InventoryCheckModal: пересорт линейки", () => {
  beforeEach(() => {
    fetchPreviewMock.mockReset();
    fetchPreviewMock.mockResolvedValue(PREVIEW);
    createCheckMock.mockReset();
  });

  it("показывает поиск линейки и переключатель точки до выбора", async () => {
    const wrapper = await mountModal();

    expect(wrapper.find('[data-test="inventory-group-search"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("Найдите линейку");
    expect(wrapper.find('[data-test="inventory-location-retail"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="inventory-location-warehouse"]').exists()).toBe(true);
    // Пока линейка не выбрана — превью не грузится.
    expect(fetchPreviewMock).not.toHaveBeenCalled();
  });

  it("искомая линейка выбирается кликом по опции, весь список не нужен", async () => {
    const wrapper = await mountModal();

    await wrapper.find('[data-test="inventory-group-search"]').setValue("hero");
    await flushPromises();

    const options = wrapper.findAll('[data-test="inventory-group-option"]');
    expect(options).toHaveLength(1);
    expect(options[0].text()).toBe("HERO 2 CRYSTAL");
    await options[0].trigger("click");
    await flushPromises();

    expect(fetchPreviewMock).toHaveBeenCalledWith("cg_hero", "retail");
  });

  it("Enter выбирает подсвеченную опцию, Escape закрывает список не закрывая модалку", async () => {
    const wrapper = await mountModal();

    const search = wrapper.find('[data-test="inventory-group-search"]');
    await search.setValue("annima");
    await search.trigger("keydown.enter");
    await flushPromises();

    expect(fetchPreviewMock).toHaveBeenCalledWith("cg_annima", "retail");
    // Название выбранной линейки остаётся в поле — видно, что проверяем.
    expect((search.element as HTMLInputElement).value).toBe("ANNIMA LOVE KILLER");

    await search.trigger("keydown.escape");
    expect(wrapper.find('[data-test="inventory-group-list"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="inventory-modal"]').exists()).toBe(true);
  });

  it("Escape с открытым списком отменяет событие — Headless UI не закроет модалку", async () => {
    const wrapper = await mountModal();
    await wrapper.find('[data-test="inventory-group-search"]').setValue("ann");

    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    // Наследуем данные событий Vue Test Utils (через createElement) — проще
    // проверить сам обработчик: событие обязано быть отменённым.
    const search = wrapper.find('[data-test="inventory-group-search"]');
    (search.element as HTMLInputElement).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("клик мимо поля закрывает список, но сохраняет набранный запрос", async () => {
    const wrapper = await mountModal();

    await wrapper.find('[data-test="inventory-group-search"]').setValue("ann");
    await flushPromises();
    expect(wrapper.find('[data-test="inventory-group-list"]').exists()).toBe(true);

    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await flushPromises();

    expect(wrapper.find('[data-test="inventory-group-list"]').exists()).toBe(false);
    // Запрос не стёрт: Escape и клик мимо ведут себя одинаково.
    expect((wrapper.find('[data-test="inventory-group-search"]').element as HTMLInputElement).value).toBe("ann");
  });

  it("пока превью грузится, сброс и ввод недоступны — гонка с поздним ответом закрыта", async () => {
    let resolvePreview: (value: unknown) => void = () => {};
    fetchPreviewMock.mockReturnValue(
      new Promise((resolve) => {
        resolvePreview = resolve;
      }),
    );

    const wrapper = await mountModal();
    await searchAndPickGroup(wrapper, "annima", "ANNIMA LOVE KILLER");

    // Запрос в полёте: крестик и поиск заблокированы — сбросить линейку
    // до ответа нельзя, значит ответ не может прийти «не той» линейке.
    const search = wrapper.find('[data-test="inventory-group-search"]');
    expect((search.element as HTMLInputElement).disabled).toBe(true);
    expect((wrapper.find('[data-test="inventory-group-clear"]').element as HTMLButtonElement).disabled).toBe(true);

    resolvePreview({ items: PREVIEW.items });
    await flushPromises();

    expect((wrapper.find('[data-test="inventory-group-clear"]').element as HTMLButtonElement).disabled).toBe(false);
  });

  it("переоткрытие модалки вычищает вкусы прошлой линейки, даже если её ответ пришёл поздно", async () => {
    let resolvePreview: (value: unknown) => void = () => {};
    fetchPreviewMock.mockReturnValue(
      new Promise((resolve) => {
        resolvePreview = resolve;
      }),
    );

    const wrapper = await mountModal();
    await searchAndPickGroup(wrapper, "annima", "ANNIMA LOVE KILLER");

    // Модалку закрыли и открыли заново — ответ предыдущей сессии приходит
    // уже после переоткрытия.
    await wrapper.setProps({ isOpen: false });
    await wrapper.setProps({ isOpen: true });
    resolvePreview({ items: PREVIEW.items });
    await flushPromises();

    // Чистый лист: без блокировки загрузки, без вкусов прошлой линейки.
    const search = wrapper.find('[data-test="inventory-group-search"]');
    expect((search.element as HTMLInputElement).disabled).toBe(false);
    expect(wrapper.text()).toContain("Найдите линейку");
    expect(wrapper.text()).not.toContain("Мохито с клубникой");
    expect(fetchPreviewMock).toHaveBeenCalledTimes(1);
  });

  it("ничего не найдено — Enter не выбирает случайную линейку", async () => {
    const wrapper = await mountModal();

    const search = wrapper.find('[data-test="inventory-group-search"]');
    await search.setValue("нет такой линейки");
    await search.trigger("keydown.enter");
    await flushPromises();

    expect(fetchPreviewMock).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Ничего не найдено");
  });

  it("крестик сбрасывает выбор и фокусирует поиск", async () => {
    const wrapper = await mountModal();
    await searchAndPickGroup(wrapper, "annima", "ANNIMA LOVE KILLER");

    await wrapper.find('[data-test="inventory-group-clear"]').trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Найдите линейку");
    expect((wrapper.find('[data-test="inventory-group-search"]').element as HTMLInputElement).value).toBe("");
    expect(fetchPreviewMock).toHaveBeenCalledTimes(1);
  });

  it("после выбора линейки показывает все вкусы, включая нулевые", async () => {
    const wrapper = await mountModal();

    await searchAndPickGroup(wrapper, "annima", "ANNIMA LOVE KILLER");
    await flushPromises();

    expect(fetchPreviewMock).toHaveBeenCalledWith("cg_annima", "retail");
    const text = wrapper.text();
    expect(text).toContain("Мохито с клубникой");
    expect(text).toContain("Энергетик малина");
    // Нулевой вкус тоже в списке.
    expect(text).toContain("Апельсин вишня");
    expect(text).toContain("числится 0");
    expect(wrapper.text()).toContain("3 вкусов");
  });

  it("живая сводка считает расхождение по введённым числам", async () => {
    const wrapper = await mountModal();
    await searchAndPickGroup(wrapper, "annima", "ANNIMA LOVE KILLER");
    await flushPromises();

    // 6 → 5, 5 → 5, 0 → 2: расхождение −1 + 2 = +1.
    await inputFor(wrapper, "p_mohito").setValue("5");
    await inputFor(wrapper, "p_zero").setValue("2");
    await flushPromises();

    const summary = wrapper.find('[data-test="inventory-summary"]').text();
    expect(summary).toContain("по факту 12");
    expect(summary).toContain("+1");
  });

  it("подставляет числящийся остаток в поля и показывает дельту", async () => {
    const wrapper = await mountModal();
    await searchAndPickGroup(wrapper, "annima", "ANNIMA LOVE KILLER");
    await flushPromises();

    // Поля предзаполнены числящимся остатком — кассир меняет только отличия.
    expect((inputFor(wrapper, "p_mohito").element as HTMLInputElement).value).toBe("6");
    // Числа совпадают с числящимися — дельта «=».
    expect(wrapper.find('[data-test="inventory-delta-p_mohito"]').text()).toBe("=");

    await inputFor(wrapper, "p_mohito").setValue("4");
    await flushPromises();
    expect(wrapper.find('[data-test="inventory-delta-p_mohito"]').text()).toBe("-2");
  });

  it("кнопка «Сохранить» шлёт только заполненные позиции", async () => {
    createCheckMock.mockResolvedValue({
      id: "inv_1",
      check_number: 7,
      group: { id: "cg_annima", name: "ANNIMA LOVE KILLER" },
      location: "retail",
      positions_count: 3,
      counted_count: 2,
      total_before: 11,
      total_after: 10,
      diff_total: -1,
      created_by: "admin",
      notes: null,
      created_at: "2026-10-27T10:00:00.000Z",
      items: [
        {
          id: "invi_1",
          product_id: "p_mohito",
          variant_id: null,
          product_title: "Мохито с клубникой",
          variant_name: null,
          expected_quantity: 6,
          actual_quantity: 5,
          diff: -1,
        },
        {
          id: "invi_2",
          product_id: "p_zero",
          variant_id: null,
          product_title: "Апельсин вишня",
          variant_name: null,
          expected_quantity: 0,
          actual_quantity: 0,
          diff: 0,
        },
      ],
    });

    const wrapper = await mountModal();
    await searchAndPickGroup(wrapper, "annima", "ANNIMA LOVE KILLER");
    await flushPromises();

    await inputFor(wrapper, "p_mohito").setValue("5");
    // Остальные поля оставляем как есть (равны числящимся) — они тоже уйдут.
    await wrapper.find('[data-test="inventory-save"]').trigger("click");
    await flushPromises();

    expect(createCheckMock).toHaveBeenCalledTimes(1);
    const payload = createCheckMock.mock.calls[0][0];
    expect(payload.group_id).toBe("cg_annima");
    expect(payload.location).toBe("retail");
    expect(payload.items).toHaveLength(3);
    expect(payload.items[0]).toEqual({ product_id: "p_mohito", variant_id: null, actual: 5 });
  });

  it("после сохранения показывает итог расхождения в общей сумме", async () => {
    createCheckMock.mockResolvedValue({
      id: "inv_1",
      check_number: 7,
      group: { id: "cg_annima", name: "ANNIMA LOVE KILLER" },
      location: "retail",
      positions_count: 3,
      counted_count: 1,
      total_before: 6,
      total_after: 5,
      diff_total: -1,
      created_by: "admin",
      notes: null,
      created_at: "2026-10-27T10:00:00.000Z",
      items: [
        {
          id: "invi_1",
          product_id: "p_mohito",
          variant_id: null,
          product_title: "Мохито с клубникой",
          variant_name: null,
          expected_quantity: 6,
          actual_quantity: 5,
          diff: -1,
        },
      ],
    });

    const wrapper = await mountModal();
    await searchAndPickGroup(wrapper, "annima", "ANNIMA LOVE KILLER");
    await flushPromises();

    await inputFor(wrapper, "p_mohito").setValue("5");
    await wrapper.find('[data-test="inventory-save"]').trigger("click");
    await flushPromises();

    const result = wrapper.find('[data-test="inventory-result"]').text();
    expect(result).toContain("Пересорт №7");
    expect(result).toContain("Стало на 1 меньше");
    expect(result).toContain("Числится 6 шт · по факту 5 шт");
    expect(result).toContain("6 → 5");
    // Эмит «сохранено» уходит родителю для тоста и обновления таблицы.
    expect(wrapper.emitted("saved")).toHaveLength(1);

    // «Новый пересорт» сбрасывает форму к поиску линейки.
    await wrapper.find('[data-test="inventory-new-check"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("Найдите линейку");
    expect(fetchPreviewMock).toHaveBeenCalledTimes(1);
  });

  it("нулевой итог показывает «Осталось так же»", async () => {
    createCheckMock.mockResolvedValue({
      id: "inv_2",
      check_number: 8,
      group: { id: "cg_annima", name: "ANNIMA LOVE KILLER" },
      location: "retail",
      positions_count: 3,
      counted_count: 1,
      total_before: 6,
      total_after: 6,
      diff_total: 0,
      created_by: "admin",
      notes: null,
      created_at: "2026-10-27T10:00:00.000Z",
      items: [],
    });

    const wrapper = await mountModal();
    await searchAndPickGroup(wrapper, "annima", "ANNIMA LOVE KILLER");
    await flushPromises();

    await wrapper.find('[data-test="inventory-save"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-test="inventory-result"]').text()).toContain("Осталось так же");
  });

  it("излишек показывает «Стало на N больше»", async () => {
    createCheckMock.mockResolvedValue({
      id: "inv_3",
      check_number: 9,
      group: { id: "cg_annima", name: "ANNIMA LOVE KILLER" },
      location: "retail",
      positions_count: 3,
      counted_count: 1,
      total_before: 6,
      total_after: 9,
      diff_total: 3,
      created_by: "admin",
      notes: null,
      created_at: "2026-10-27T10:00:00.000Z",
      items: [],
    });

    const wrapper = await mountModal();
    await searchAndPickGroup(wrapper, "annima", "ANNIMA LOVE KILLER");
    await flushPromises();

    await wrapper.find('[data-test="inventory-save"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-test="inventory-result"]').text()).toContain("Стало на 3 больше");
  });

  it("ошибка сохранения показывается баннером, форма не закрывается", async () => {
    createCheckMock.mockRejectedValue(
      Object.assign(new Error("item_not_in_group"), { code: "item_not_in_group" }),
    );

    const wrapper = await mountModal();
    await searchAndPickGroup(wrapper, "annima", "ANNIMA LOVE KILLER");
    await flushPromises();

    await wrapper.find('[data-test="inventory-save"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-test="inventory-save-error"]').text()).toContain(
      "Состав линейки изменился",
    );
    // Список вкусов на месте — можно поправить и повторить.
    expect(wrapper.text()).toContain("Мохито с клубникой");
  });

  it("переключение точки перезагружает превью со складскими остатками", async () => {
    fetchPreviewMock.mockResolvedValue({
      ...PREVIEW,
      location: "warehouse",
      items: PREVIEW.items.map((item) => ({ ...item, expected: item.expected + 10 })),
    });

    const wrapper = await mountModal();
    await searchAndPickGroup(wrapper, "annima", "ANNIMA LOVE KILLER");
    await flushPromises();

    await wrapper.find('[data-test="inventory-location-warehouse"]').trigger("click");
    await flushPromises();

    expect(fetchPreviewMock).toHaveBeenLastCalledWith("cg_annima", "warehouse");
    expect(wrapper.text()).toContain("числится 16");
  });

  it("ошибка загрузки превью показывает баннер с повтором", async () => {
    fetchPreviewMock.mockRejectedValue(new Error("network"));

    const wrapper = await mountModal();
    await searchAndPickGroup(wrapper, "annima", "ANNIMA LOVE KILLER");
    await flushPromises();

    expect(wrapper.find('[data-test="inventory-retry"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("Не удалось загрузить вкусы");

    // Повтор вызван — и теперь успешен.
    fetchPreviewMock.mockResolvedValue(PREVIEW);
    await wrapper.find('[data-test="inventory-retry"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("Мохито с клубникой");
  });

  it("пустая линейка показывает пустое состояние", async () => {
    fetchPreviewMock.mockResolvedValue({
      group: { id: "cg_hero", name: "HERO 2 CRYSTAL" },
      location: "retail",
      items: [],
      total_expected: 0,
    });

    const wrapper = await mountModal();
    await searchAndPickGroup(wrapper, "hero", "HERO 2 CRYSTAL");
    await flushPromises();

    expect(wrapper.find('[data-test="inventory-empty"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("В линейке нет товаров");
  });
});