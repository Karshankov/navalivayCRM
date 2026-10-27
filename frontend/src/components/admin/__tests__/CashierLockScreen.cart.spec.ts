import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import CashierLockScreen from "@/components/admin/CashierLockScreen.vue";

const loginMock = vi.fn();
const adminAuthenticated = { value: true };

vi.mock("@/stores/admin", () => ({
  useAdminStore: () => ({ login: loginMock, isAuthenticated: adminAuthenticated.value }),
}));

const submitPosCheckMock = vi.fn();
const createPosProductMock = vi.fn();
const updatePosProductMock = vi.fn();
const deletePosProductMock = vi.fn();
const fetchPosCatalogMock = vi.fn();
const startPosSessionMock = vi.fn();

vi.mock("@/stores/crm", () => ({
  useCrmStore: () => ({
    fetchPendingPosSales: vi.fn().mockResolvedValue([]),
    createPosSale: vi.fn(),
    updatePosSale: vi.fn(),
    startPosSession: vi.fn().mockResolvedValue(null),
    startPosSession: startPosSessionMock,
    fetchPosCatalog: fetchPosCatalogMock,
    submitPosCheck: submitPosCheckMock,
    createPosProduct: createPosProductMock,
    updatePosProduct: updatePosProductMock,
    deletePosProduct: deletePosProductMock,
    uploadPosProductImage: vi.fn(),
  }),
}));

const CATALOG = [
  {
    id: "p_husky",
    source: "catalog",
    product_id: "p_husky",
    variant_id: null,
    title: "Жидкость HUSKY",
    price: 35,
    retail_price: 16,
    price_reason: "fixed",
    cost_price: 8,
    stock: 5,
    image_url: null,
  },
  {
    id: "posp_custom",
    source: "custom",
    pos_product_id: "posp_custom",
    title: "Одноразка PPWJ 2000",
    price: 10,
    retail_price: 10,
    price_reason: "custom",
    cost_price: 5,
    stock: 3,
    image_url: null,
  },
];

async function mountScreen(items = CATALOG) {
  fetchPosCatalogMock.mockResolvedValue({ items, has_more: false });
  const wrapper = mount(CashierLockScreen, {
    global: { stubs: { teleport: true, PosCustomerPanel: true } },
  });
  await flushPromises();
  return wrapper;
}

function tileButtons(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll("button").filter((button) =>
    button.text().includes("BYN") && button.attributes("disabled") === undefined,
  );
}

function findTile(wrapper: ReturnType<typeof mount>, title: string) {
  return wrapper.findAll("button").find((button) => button.text().includes(title));
}

function totalText(wrapper: ReturnType<typeof mount>) {
  return wrapper.text().replace(/\s+/g, " ");
}

describe("CashierLockScreen: каталог и чек", () => {
  beforeEach(() => {
    submitPosCheckMock.mockReset();
    submitPosCheckMock.mockResolvedValue({ id: "pos_1" });
    fetchPosCatalogMock.mockReset();
    createPosProductMock.mockReset();
    startPosSessionMock.mockReset();
    startPosSessionMock.mockResolvedValue(null);
    adminAuthenticated.value = true;
  });

  it("показывает 4 товара и «Показать все» только когда их больше", async () => {
    const many = Array.from({ length: 6 }, (_, index) => ({
      ...CATALOG[0],
      id: `p_${index}`,
      product_id: `p_${index}`,
      title: `Товар ${index}`,
    }));
    const wrapper = await mountScreen(many);

    const text = totalText(wrapper);
    expect(text).toContain("Показать все");
    expect(text).toContain("(6)");
    // Первые четыре плитки на экране, остальные — после разворота.
    expect(wrapper.text()).toContain("Товар 0");
    expect(wrapper.text()).toContain("Товар 3");
    expect(wrapper.text()).not.toContain("Товар 4");

    await wrapper.findAll("button").find((b) => b.text().includes("Показать все"))!.trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("Товар 5");
  });

  it("не показывает «Показать все» для короткого списка", async () => {
    const wrapper = await mountScreen();
    expect(totalText(wrapper)).not.toContain("Показать все");
  });

  it("показывает наценку рядом с ценой", async () => {
    const wrapper = await mountScreen();
    // 8 → 35: наценка 338%.
    expect(wrapper.text()).toContain("наценка 338%");
    // 5 → 10: 100%.
    expect(wrapper.text()).toContain("наценка 100%");
  });

  it("добавляет товары в чек и считает итог", async () => {
    const wrapper = await mountScreen();

    await findTile(wrapper, "Жидкость HUSKY")!.trigger("click");
    await findTile(wrapper, "Одноразка PPWJ")!.trigger("click");
    await flushPromises();

    const text = totalText(wrapper);
    expect(text).toContain("2 позиции");
    expect(text).toContain("45,00 BYN");
  });

  it("второе нажатие по товару увеличивает количество, а не дублирует позицию", async () => {
    const wrapper = await mountScreen();

    await findTile(wrapper, "Жидкость HUSKY")!.trigger("click");
    await findTile(wrapper, "Жидкость HUSKY")!.trigger("click");
    await flushPromises();

    const text = totalText(wrapper);
    expect(text).toContain("1 позиция");
    expect(text).toContain("70,00 BYN");
  });

  it("не добавляет товар сверх остатка", async () => {
    const wrapper = await mountScreen();

    const tile = findTile(wrapper, "Одноразка PPWJ")!;
    await tile.trigger("click");
    await tile.trigger("click");
    await tile.trigger("click");
    await tile.trigger("click");
    await flushPromises();

    // Остаток 3: четвёртый клик ничего не добавляет.
    expect(totalText(wrapper)).toContain("30,00 BYN");
  });

  it("удаляет позицию из чека", async () => {
    const wrapper = await mountScreen();

    await findTile(wrapper, "Жидкость HUSKY")!.trigger("click");
    await flushPromises();

    const removeButton = wrapper
      .findAll("button")
      .find((button) => button.attributes("aria-label") === "Удалить позицию")!;
    await removeButton.trigger("click");
    await flushPromises();

    expect(totalText(wrapper)).toContain("0 позиций");
    expect(totalText(wrapper)).toContain("Пока нет товаров в чеке");
  });

  it("скидка на чек уменьшает итог", async () => {
    const wrapper = await mountScreen();

    await findTile(wrapper, "Жидкость HUSKY")!.trigger("click");
    await flushPromises();

    const inputs = wrapper.findAll('input[type="number"]');
    // Первое числовое поле после добавления — скидка позиции, второе — скидка чека.
    const checkDiscountInput = inputs[inputs.length - 1];
    await checkDiscountInput.setValue("5");
    await flushPromises();

    expect(totalText(wrapper)).toContain("30,00 BYN");
  });

  it("проводит чек наличными и отправляет готовые позиции", async () => {
    const wrapper = await mountScreen();

    await findTile(wrapper, "Жидкость HUSKY")!.trigger("click");
    await findTile(wrapper, "Одноразка PPWJ")!.trigger("click");
    await flushPromises();

    const submit = wrapper.findAll("button").find((b) => b.text().includes("Провести чек"))!;
    await submit.trigger("click");
    await flushPromises();

    expect(submitPosCheckMock).toHaveBeenCalledTimes(1);
    const [payload, idempotencyKey] = submitPosCheckMock.mock.calls[0];
    expect(payload.payment_method).toBe("cash");
    expect(payload.items).toEqual([
      {
        source: "catalog",
        product_id: "p_husky",
        variant_id: null,
        pos_product_id: null,
        quantity: 1,
        discount_amount: 0,
      },
      {
        source: "custom",
        product_id: null,
        variant_id: null,
        pos_product_id: "posp_custom",
        quantity: 1,
        discount_amount: 0,
      },
    ]);
    expect(typeof idempotencyKey).toBe("string");
    expect(idempotencyKey.length).toBeGreaterThan(10);
    expect(wrapper.text()).toContain("Чек проведён");
  });

  it("оплата картой передаётся в запрос", async () => {
    const wrapper = await mountScreen();

    await findTile(wrapper, "Жидкость HUSKY")!.trigger("click");
    await flushPromises();

    const cardButton = wrapper.findAll("button").find((b) => b.text() === "Картой")!;
    await cardButton.trigger("click");
    await flushPromises();

    const submit = wrapper.findAll("button").find((b) => b.text().includes("Провести чек"))!;
    await submit.trigger("click");
    await flushPromises();

    expect(submitPosCheckMock.mock.calls[0][0].payment_method).toBe("card");
  });

  it("показывает понятную ошибку, когда лимит по карте исчерпан", async () => {
    submitPosCheckMock.mockRejectedValue(
      Object.assign(new Error("card_limit_exceeded"), {
        code: "card_limit_exceeded",
        status: 409,
      }),
    );
    const wrapper = await mountScreen();

    await findTile(wrapper, "Жидкость HUSKY")!.trigger("click");
    await flushPromises();

    const submit = wrapper.findAll("button").find((b) => b.text().includes("Провести чек"))!;
    await submit.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Лимит оплаты картой на сегодня исчерпан");
    // Чек не пропал: позиция остаётся в корзине, можно выбрать наличные.
    expect(wrapper.text()).toContain("1 позиция");
  });

  it("при нехватке остатка показывает, чего именно не хватило", async () => {
    submitPosCheckMock.mockRejectedValue(
      Object.assign(new Error("insufficient_stock"), {
        code: "insufficient_stock",
        status: 409,
        item: { title: "Жидкость HUSKY", available: 1, requested: 2 },
      }),
    );
    const wrapper = await mountScreen();

    await findTile(wrapper, "Жидкость HUSKY")!.trigger("click");
    await flushPromises();

    const submit = wrapper.findAll("button").find((b) => b.text().includes("Провести чек"))!;
    await submit.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Недостаточно товара");
    expect(wrapper.text()).toContain("Жидкость HUSKY");
  });

  it("кнопка «Провести» недоступна на пустом чеке", async () => {
    const wrapper = await mountScreen();
    const submit = wrapper.findAll("button").find((b) => b.text().includes("Провести чек"))!;
    expect(submit.attributes("disabled")).toBeDefined();
  });

  it("ключ из поля штрихкода открывает кассовую сессию и грузит каталог", async () => {
    adminAuthenticated.value = false;
    startPosSessionMock.mockResolvedValue({ ok: true, token: "pos-token", key_id: "posk_1", role: "pos" });
    const wrapper = await mountScreen();

    // До сессии каталог не загружался.
    expect(fetchPosCatalogMock).not.toHaveBeenCalled();

    await wrapper.find("form input").setValue("pos-key-123");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(startPosSessionMock).toHaveBeenCalledWith("pos-key-123");
    expect(fetchPosCatalogMock).toHaveBeenCalled();
    // Экран кассы не разблокировался: это кассир, а не менеджер.
    expect(wrapper.emitted("unlocked")).toBeUndefined();
    // Поле чистится под следующий скан.
    expect((wrapper.find("form input").element as HTMLInputElement).value).toBe("");
  });

  it("неудачный ключ молча чистит поле и не трогает каталог", async () => {
    adminAuthenticated.value = false;
    const wrapper = await mountScreen();

    await wrapper.find("form input").setValue("some-barcode-999");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(wrapper.emitted("unlocked")).toBeUndefined();
    expect((wrapper.find("form input").element as HTMLInputElement).value).toBe("");
    // Никакого сообщения об ошибке: это «поиск ничего не нашёл».
    expect(wrapper.text()).not.toContain("Не удалось");
  });

  it("плюсик открывает форму нового товара с полями из ТЗ", async () => {
    const wrapper = await mountScreen();

    const plus = wrapper.findAll("button").find((b) => b.attributes("aria-label") === "Добавить товар")!;
    await plus.trigger("click");
    await flushPromises();

    const text = wrapper.text();
    expect(text).toContain("Новый товар");
    expect(text).toContain("Себестоимость");
    expect(text).toContain("Розничная цена");
    expect(text).toContain("Количество на складе");
    expect(text).toContain("Фото");
  });

  it("свой товар можно открыть на правку с плитки", async () => {
    const wrapper = await mountScreen();

    const editButton = wrapper
      .findAll("button")
      .find((b) => (b.attributes("aria-label") || "").startsWith("Изменить товар"))!;
    expect(editButton).toBeTruthy();
    await editButton.trigger("click");
    await flushPromises();

    const text = wrapper.text();
    expect(text).toContain("Изменить товар");
    // Количество показывается как есть — правка задаёт итоговое наличие.
    const quantityInput = wrapper
      .findAll('input[type="number"]')
      .find((i) => (i.element as HTMLInputElement).value === "3")!;
    expect(quantityInput).toBeTruthy();
    // В режиме правки доступно удаление.
    expect(wrapper.findAll("button").some((b) => b.text() === "Удалить товар")).toBe(true);
  });

  it("у товаров каталога нет кнопки правки", async () => {
    const wrapper = await mountScreen();
    const editButtons = wrapper
      .findAll("button")
      .filter((b) => (b.attributes("aria-label") || "").startsWith("Изменить товар"));

    expect(editButtons).toHaveLength(1);
    expect(editButtons[0].attributes("aria-label")).toContain("Одноразка PPWJ");
  });

  it("в форме нового товара считает наценку на лету", async () => {
    const wrapper = await mountScreen();

    const plus = wrapper.findAll("button").find((b) => b.attributes("aria-label") === "Добавить товар")!;
    await plus.trigger("click");
    await flushPromises();

    const numberInputs = wrapper.findAll('input[type="number"]');
    // Себестоимость, розничная цена, количество — последние три числа в модалке.
    const costInput = numberInputs[numberInputs.length - 3];
    const retailInput = numberInputs[numberInputs.length - 2];
    await costInput.setValue("5");
    await retailInput.setValue("10");
    await flushPromises();

    expect(wrapper.text()).toContain("100%");
  });
});