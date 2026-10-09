import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import CashierLockScreen from "@/components/admin/CashierLockScreen.vue";

const loginMock = vi.fn();
const adminStore = { login: loginMock, isAuthenticated: false };

vi.mock("@/stores/admin", () => ({
  useAdminStore: () => adminStore,
}));

vi.mock("@/stores/crm", () => ({
  useCrmStore: () => ({
    fetchPendingPosSales: vi.fn().mockResolvedValue([]),
    createPosSale: vi.fn(),
    updatePosSale: vi.fn(),
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
// форма отправляется.
describe("CashierLockScreen: вход по паролю с мобильной клавиатуры", () => {
  beforeEach(() => {
    loginMock.mockReset();
    loginMock.mockResolvedValue(undefined);
    adminStore.isAuthenticated = false;
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

  it("неверный пароль оставляет экран закрытым и показывает «не найдено»", async () => {
    const wrapper = await mountLockScreen();
    loginMock.mockRejectedValue(new Error("unauthorized"));

    await wrapper.find("form input").setValue("wrong-pass");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(wrapper.emitted("unlocked")).toBeUndefined();
    expect(wrapper.text()).toContain("товаров не найдено");
  });
});
