import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { reactive, ref } from "vue";
import CashierLockScreen from "@/components/admin/CashierLockScreen.vue";

const loginMock = vi.fn();
// Как в Pinia: стор обёрнут в reactive, поэтому ref внутри авто-распаковывается
// при чтении store.isAuthenticated — и остаётся реактивным. Тест
// «каталог грузится сам…» переворачивает флаг ПОСЛЕ монтирования.
const adminAuthenticated = ref(true);

vi.mock("@/stores/admin", () => ({
  useAdminStore: () => reactive({ login: loginMock, isAuthenticated: adminAuthenticated }),
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

function findTile(wrapper: ReturnType<typeof mount>, title: string) {
  return wrapper.findAll("button").find((button) => button.text().includes(title));
}

function totalText(wrapper: ReturnType<typeof mount>) {
  return wrapper.text().replace(/\s+/g, " ");
}

/** «Провести чек» открывает модалку кода: вводим код и отправляем. */
async function submitWithCode(wrapper: ReturnType<typeof mount>, code = "5599") {
  const submit = wrapper.findAll("button").find((b) => b.text().includes("Провести чек"))!;
  await submit.trigger("click");
  await flushPromises();
  const codeInput = wrapper.find("#pos-confirm-code");
  if (!codeInput.exists()) {
    throw new Error("модалка кода подтверждения не открылась");
  }
  await codeInput.setValue(code);
  await wrapper.findAll("button").find((b) => b.text() === "Провести")!.trigger("submit");
  await flushPromises();
  return submit;
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

  it("изначально виден только первый ряд, «Показать все» разворачивает список", async () => {
    const many = Array.from({ length: 30 }, (_, index) => ({
      ...CATALOG[0],
      id: `p_${index}`,
      product_id: `p_${index}`,
      title: `Товар ${index}`,
    }));
    const wrapper = await mountScreen(many);

    const text = totalText(wrapper);
    expect(text).toContain("Показать все");
    expect(text).toContain("(30)");
    // Первый ряд: 6 плиток, остальное — после «Показать все».
    expect(wrapper.text()).toContain("Товар 0");
    expect(wrapper.text()).toContain("Товар 5");
    expect(wrapper.text()).not.toContain("Товар 6");

    await wrapper.findAll("button").find((b) => b.text().includes("Показать все"))!.trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("Товар 29");
  });

  it("сетка каталога укладывает 6 плиток в ряд на большом экране", async () => {
    const many = Array.from({ length: 6 }, (_, index) => ({
      ...CATALOG[0],
      id: `p_${index}`,
      product_id: `p_${index}`,
      title: `Товар ${index}`,
    }));
    const wrapper = await mountScreen(many);

    // jsdom не считает CSS-сетку, поэтому проверяем класс контейнера:
    // компактные плитки, 6 колонок на десктопе.
    const grid = wrapper.find(".grid.grid-cols-2.sm\\:grid-cols-4.lg\\:grid-cols-6");
    expect(grid.exists()).toBe(true);
  });

  it("каталог грузится при монтировании и после позднего подтверждения входа", async () => {
    // Перезагрузка страницы с заблокированной панелью: экран кассы смонтирован
    // до checkAuth. Кассовая кука может уже лежать в браузере — каталог
    // пробуем загрузить сразу, без ожидания поиска или скана ключа.
    adminAuthenticated.value = false;
    fetchPosCatalogMock.mockClear();
    fetchPosCatalogMock.mockResolvedValue({ items: CATALOG, has_more: false });
    const wrapper = mount(CashierLockScreen, {
      global: { stubs: { teleport: true, PosCustomerPanel: true } },
    });
    await flushPromises();

    // Пробуем сразу при монтировании: товары видны и без поиска.
    expect(fetchPosCatalogMock).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain("Жидкость HUSKY");
    const search = wrapper
      .findAll('input[type="text"]')
      .find((i) => (i.element as HTMLInputElement).placeholder.includes("Найти товар"));
    expect((search!.element as HTMLInputElement).value).toBe("");

    // Вход менеджера подтвердился позже — каталог перезагружается сам.
    fetchPosCatalogMock.mockClear();
    adminAuthenticated.value = true;
    await flushPromises();
    expect(fetchPosCatalogMock).toHaveBeenCalled();
    wrapper.unmount();
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

    const submit = await submitWithCode(wrapper);

    expect(submitPosCheckMock).toHaveBeenCalledTimes(1);
    const [payload, idempotencyKey] = submitPosCheckMock.mock.calls[0];
    expect(payload.payment_method).toBe("cash");
    // Код подтверждения уходит в запрос: сервер без него чек не проведёт.
    expect(payload.confirmation_code).toBe("5599");
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

  it("«Провести чек» сначала спрашивает код: без кода запрос не уходит", async () => {
    const wrapper = await mountScreen();
    await findTile(wrapper, "Жидкость HUSKY")!.trigger("click");
    await flushPromises();

    const submit = wrapper.findAll("button").find((b) => b.text().includes("Провести чек"))!;
    await submit.trigger("click");
    await flushPromises();

    // Модалка открыта, код ещё не введён — чек не отправляется.
    expect(wrapper.find("#pos-confirm-code").exists()).toBe(true);
    expect(submitPosCheckMock).not.toHaveBeenCalled();

    // Пустой код: кнопка «Провести» в модалке недоступна.
    const confirmButton = wrapper.findAll("button").find((b) => b.text() === "Провести")!;
    expect(confirmButton.attributes("disabled")).toBeDefined();
  });

  it("неверный код — чек не проводится, ошибка в модалке, кассир пробует снова", async () => {
    submitPosCheckMock.mockRejectedValue(
      Object.assign(new Error("confirmation_code_required"), {
        code: "confirmation_code_required",
        status: 403,
      }),
    );
    const wrapper = await mountScreen();
    await findTile(wrapper, "Жидкость HUSKY")!.trigger("click");
    await flushPromises();

    await submitWithCode(wrapper, "0000");
    expect(submitPosCheckMock).toHaveBeenCalledTimes(1);

    // Ошибка в модалке, чек на месте, модалка не закрылась.
    expect(wrapper.text()).toContain("Неверный код подтверждения");
    expect(wrapper.find("#pos-confirm-code").exists()).toBe(true);
    expect(wrapper.text()).toContain("1 позиция");

    // Второй раз — верный код, всё проводится.
    submitPosCheckMock.mockResolvedValue({ id: "pos_2" });
    await submitWithCode(wrapper, "5599");
    expect(submitPosCheckMock).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain("Чек проведён");
    expect(wrapper.find("#pos-confirm-code").exists()).toBe(false);
  });

  it("оплата картой передаётся в запрос", async () => {
    const wrapper = await mountScreen();

    await findTile(wrapper, "Жидкость HUSKY")!.trigger("click");
    await flushPromises();

    const cardButton = wrapper.findAll("button").find((b) => b.text() === "Картой")!;
    await cardButton.trigger("click");
    await flushPromises();

    const submit = await submitWithCode(wrapper);

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

    const submit = await submitWithCode(wrapper);

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

    const submit = await submitWithCode(wrapper);

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

    // Монтирование уже пробует каталог по кассовой куке (её нет — тихий 401):
    // счётчик чистим, чтобы проверить загрузку именно после скана ключа.
    fetchPosCatalogMock.mockClear();

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

  it("неудачный ключ молча чистит поле и не дёргает каталог заново", async () => {
    adminAuthenticated.value = false;
    const wrapper = await mountScreen();
    fetchPosCatalogMock.mockClear();

    await wrapper.find("form input").setValue("some-barcode-999");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(wrapper.emitted("unlocked")).toBeUndefined();
    expect((wrapper.find("form input").element as HTMLInputElement).value).toBe("");
    // Ключ не подошёл — новых запросов каталога нет.
    expect(fetchPosCatalogMock).not.toHaveBeenCalled();
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