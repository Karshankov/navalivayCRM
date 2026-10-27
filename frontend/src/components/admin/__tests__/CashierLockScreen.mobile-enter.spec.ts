import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import CashierLockScreen from "@/components/admin/CashierLockScreen.vue";

const loginMock = vi.fn();
const adminStore = { login: loginMock, isAuthenticated: false };

vi.mock("@/stores/admin", () => ({
  useAdminStore: () => adminStore,
}));

const fetchPosCatalogMock = vi.fn().mockResolvedValue({ items: [], has_more: false });

vi.mock("@/stores/crm", () => ({
  useCrmStore: () => ({
    fetchPendingPosSales: vi.fn().mockResolvedValue([]),
    createPosSale: vi.fn(),
    updatePosSale: vi.fn(),
    startPosSession: vi.fn().mockResolvedValue(null),
    fetchPosCatalog: fetchPosCatalogMock,
    submitPosCheck: vi.fn(),
    createPosProduct: vi.fn(),
    updatePosProduct: vi.fn(),
    deletePosProduct: vi.fn(),
    uploadPosProductImage: vi.fn(),
  }),
}));

async function mountLockScreen() {
  const wrapper = mount(CashierLockScreen, {
    global: {
      stubs: { teleport: true, PosCustomerPanel: true },
    },
  });
  await flushPromises();
  return wrapper;
}

// Экран входа в админку с телефона: см. комментарий над полем в
// CashierLockScreen.vue. Клавиша на мобильной клавиатуре не даёт keydown с
// Enter, поэтому проверять надо не нажатие, а то, что поле лежит в форме и
// форма отправляется. Верхнее поле теперь называется «Поиск по штрихкоду» и
// служит только скрытым входом: товары выбираются в каталоге ниже.
describe("CashierLockScreen: вход по паролю с мобильной клавиатуры", () => {
  beforeEach(() => {
    loginMock.mockReset();
    loginMock.mockResolvedValue(undefined);
    adminStore.isAuthenticated = false;
    fetchPosCatalogMock.mockClear();
  });

  it("поле пароля лежит внутри формы и в ней нет других полей", async () => {
    const wrapper = await mountLockScreen();

    const form = wrapper.find("form");
    expect(form.exists()).toBe(true);

    const input = form.find('input[type="text"]');
    expect(input.exists()).toBe(true);

    // Неявная отправка формы по клавише срабатывает, только пока поле в форме
    // одно. Появится рядом второе — на телефоне вернётся «Далее», и вход снова
    // сломается, уже молча.
    expect(form.findAll("input, select, textarea, button")).toHaveLength(1);
  });

  it("на экране нет ни одного слова про пароль или вход", async () => {
    const wrapper = await mountLockScreen();
    const text = wrapper.text().toLowerCase();

    expect(text).not.toContain("парол");
    expect(text).not.toContain("вход");
    expect(text).not.toContain("логин");
    expect(wrapper.text()).toContain("ПОИСК ПО ШТРИХКОДУ");
  });

  it("отправка формы проверяет пароль и разблокирует экран", async () => {
    const wrapper = await mountLockScreen();

    await wrapper.find("form input").setValue("admin");
    adminStore.isAuthenticated = true;
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(loginMock).toHaveBeenCalledWith({ username: "admin", password: "admin" });
    expect(wrapper.emitted("unlocked")).toHaveLength(1);
  });

  it("пустой запрос не дёргает вход", async () => {
    const wrapper = await mountLockScreen();

    await wrapper.find("form input").setValue("   ");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(loginMock).not.toHaveBeenCalled();
    expect(wrapper.emitted("unlocked")).toBeUndefined();
  });

  it("ключ срабатывает сам, без нажатия Enter: пауза в вводе отправляет форму", async () => {
    vi.useFakeTimers();
    try {
      const wrapper = await mountLockScreen();
      adminStore.isAuthenticated = true;

      const input = wrapper.find("form input");
      await input.setValue("998811");
      // Ввод остановился — автосабмит через полсекунды сам проверяет ключ.
      await vi.advanceTimersByTimeAsync(600);
      await flushPromises();

      expect(loginMock).toHaveBeenCalledWith({ username: "admin", password: "998811" });
      expect(wrapper.emitted("unlocked")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("неверный ключ не разблокирует экран и не оставляет мусор в поле", async () => {
    const wrapper = await mountLockScreen();
    loginMock.mockRejectedValue(new Error("unauthorized"));

    await wrapper.find("form input").setValue("4600000000000");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(wrapper.emitted("unlocked")).toBeUndefined();
    // Строка не была ключом, и продавать её как товар больше не нужно:
    // позиции чека выбираются из каталога. Поле очищается под следующий скан.
    expect((wrapper.find("form input").element as HTMLInputElement).value).toBe("");
  });
});