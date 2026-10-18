import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import AdminReminders from "@/components/admin/AdminReminders.vue";

const fetchMock = vi.fn();

vi.stubGlobal("fetch", fetchMock);
vi.stubGlobal("localStorage", {
  getItem: vi.fn(() => "test-token"),
  setItem: vi.fn(),
  removeItem: vi.fn(),
});

vi.mock("@/components/AdminModal.vue", () => ({
  default: {
    name: "AdminModal",
    props: ["isOpen", "title", "size", "showActions", "referenceDesign"],
    emits: ["update:isOpen", "close", "cancel", "confirm"],
    template: `
      <div v-if="isOpen" class="admin-modal-stub">
        <h2>{{ title }}</h2>
        <slot />
      </div>
    `,
  },
}));

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    json: async () => payload,
  };
}

const reminderFixture = {
  id: "rem-1",
  title: "Проверить остатки",
  message: "Проверить остатки на складе",
  schedule_type: "interval",
  schedule_hour: 15,
  schedule_minute: 0,
  interval_days: 1,
  monthly_date: null,
  enabled: true,
  schedule_label: "Каждый день в 15:00",
  recipients: [
    { username: "ppofic", display_name: "Павел Карш", telegram_ok: true },
    { username: "rk0ff", display_name: "Константин", telegram_ok: true },
  ],
  recipients_ok: true,
  next_run_at: "2026-10-18T12:00:00.000Z",
  next_runs: ["2026-10-18T12:00:00.000Z", "2026-10-19T12:00:00.000Z"],
  last_sent_at: null,
  last_delivery_status: "sent",
  last_delivery_sent_at: "2026-10-17T12:00:00.000Z",
  last_delivery_error: null,
};

const teamFixture = [
  { username: "ppofic", telegram_ok: true, telegram_id: "5000670859", display_name: "Павел" },
  { username: "rk0ff", telegram_ok: true, telegram_id: "2035055116", display_name: "Константин" },
  { username: "quaillll", telegram_ok: false, telegram_id: null, display_name: null },
];

const logFixture = [
  {
    id: 1,
    unique_key: "custom-reminder:rem-1:test:1",
    reminder_id: "rem-1",
    reminder_title: "Проверить остатки",
    message: "Проверить остатки на складе",
    recipient_telegram_id: "5000670859",
    recipient_username: "ppofic",
    status: "sent",
    attempts: 1,
    sent_at: "2026-10-17T12:00:00.000Z",
    last_error: null,
    created_at: "2026-10-17T12:00:00.000Z",
  },
];

describe("AdminReminders раздел «Напоминания»", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/recipients")) {
        return jsonResponse({ recipients: teamFixture });
      }
      if (url.includes("/log")) {
        return jsonResponse({ log: logFixture });
      }
      if (url === "/api/admin/reminders" && (!init?.method || init.method === "GET")) {
        return jsonResponse({ reminders: [reminderFixture] });
      }
      if (url === "/api/admin/reminders" && init?.method === "POST") {
        return jsonResponse({ reminder: reminderFixture }, 201);
      }
      return jsonResponse({ error: "failed" }, 404);
    });
  });

  it("показывает эталонный заголовок, список и счётчики", async () => {
    const wrapper = mount(AdminReminders);
    await flushPromises();

    expect(wrapper.find(".crm-ref-title").text()).toBe("Напоминания");
    expect(wrapper.find(".crm-ref-search-input").exists()).toBe(true);
    expect(wrapper.find(".crm-ref-toolbar").exists()).toBe(true);
    expect(wrapper.text()).toContain("1 всего");
    expect(wrapper.text()).toContain("1 активных");
    expect(wrapper.text()).toContain("Проверить остатки");
    expect(wrapper.text()).toContain("Каждый день в 15:00");
    expect(wrapper.text()).toContain("Павел Карш (@ppofic), Константин (@rk0ff)");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/reminders",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
      }),
    );
  });

  it("кнопка «Создать» — зелёный градиент эталонной кнопки", async () => {
    const wrapper = mount(AdminReminders);
    await flushPromises();

    const createButton = wrapper.find('[data-test="reminders-create"]');
    expect(createButton.exists()).toBe(true);
    expect(createButton.classes()).toContain("reminder-button--create");
    expect(createButton.classes()).not.toContain("crm-ref-button--primary");
  });

  it("показывает пустое состояние с зелёной CTA-кнопкой", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/recipients")) return jsonResponse({ recipients: teamFixture });
      if (url.includes("/log")) return jsonResponse({ log: [] });
      return jsonResponse({ reminders: [] });
    });
    const wrapper = mount(AdminReminders);
    await flushPromises();

    expect(wrapper.text()).toContain("Напоминаний пока нет");
    expect(wrapper.find(".reminder-chip--create").exists()).toBe(true);
  });

  it("показывает ошибку загрузки и кнопку повтора", async () => {
    fetchMock.mockRejectedValue(new Error("network"));
    const wrapper = mount(AdminReminders);
    await flushPromises();

    expect(wrapper.text()).toContain("Нет связи с сервером.");
    expect(wrapper.text()).toContain("Повторить");
  });

  it("фильтрует напоминания поиском", async () => {
    const wrapper = mount(AdminReminders);
    await flushPromises();

    await wrapper.find(".crm-ref-search-input").setValue("несуществующий запрос");
    expect(wrapper.text()).toContain("Ничего не найдено");

    await wrapper.find(".crm-ref-search-input").setValue("остатки");
    expect(wrapper.text()).toContain("Проверить остатки");
  });

  it("форма: три карточки команды, недоступный помечен", async () => {
    const wrapper = mount(AdminReminders);
    await flushPromises();

    await wrapper.find('[data-test="reminders-create"]').trigger("click");
    const members = wrapper.findAll(".reminder-member");
    expect(members.length).toBe(3);
    expect(members[0].text()).toContain("ppofic");
    expect(members[1].text()).toContain("rk0ff");
    expect(members[2].text()).toContain("quaillll");
    expect(members[2].text()).toContain("нет Telegram");
    expect(members[2].classes()).toContain("is-unavailable");
    // Превью: получатель не выбран
    expect(wrapper.text()).toContain("участнику команды");
  });

  it("форма: мультивыбор получателей и превью", async () => {
    const wrapper = mount(AdminReminders);
    await flushPromises();

    await wrapper.find('[data-test="reminders-create"]').trigger("click");
    await wrapper.findAll(".reminder-member")[0].trigger("click");
    expect(wrapper.text()).toContain("Отправим @ppofic каждый день в 15:00 по Минску.");

    await wrapper.findAll(".reminder-member")[1].trigger("click");
    expect(wrapper.text()).toContain("Отправим @ppofic, @rk0ff каждый день в 15:00 по Минску.");

    // Повторный клик снимает выбор
    await wrapper.findAll(".reminder-member")[1].trigger("click");
    expect(wrapper.text()).toContain("Отправим @ppofic каждый день в 15:00 по Минску.");
  });

  it("создаёт напоминание через API с юзернеймом получателя", async () => {
    const wrapper = mount(AdminReminders);
    await flushPromises();

    await wrapper.find('[data-test="reminders-create"]').trigger("click");
    await wrapper.find("#reminder-title").setValue("Проверить остатки");
    await wrapper.find("#reminder-message").setValue("Проверить остатки на складе");
    await wrapper.findAll(".reminder-member")[0].trigger("click");
    await wrapper.findAll(".reminder-member")[1].trigger("click");
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    const createCall = fetchMock.mock.calls.find(
      ([url, init]) => url === "/api/admin/reminders" && init?.method === "POST",
    );
    expect(createCall).toBeTruthy();
    expect(JSON.parse(String(createCall![1]!.body))).toMatchObject({
      title: "Проверить остатки",
      message: "Проверить остатки на складе",
      recipient_usernames: ["ppofic", "rk0ff"],
      schedule_type: "interval",
      interval_days: 1,
      time: "15:00",
    });
  });

  it("форма: без получателя не отправляется", async () => {
    const wrapper = mount(AdminReminders);
    await flushPromises();

    await wrapper.find('[data-test="reminders-create"]').trigger("click");
    await wrapper.find("#reminder-title").setValue("Проверить остатки");
    await wrapper.find("#reminder-message").setValue("Проверить остатки");
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    const createCall = fetchMock.mock.calls.find(
      ([url, init]) => url === "/api/admin/reminders" && init?.method === "POST",
    );
    expect(createCall).toBeFalsy();
    expect(wrapper.text()).toContain("Выберите хотя бы одного получателя.");
  });

  it("переключает режим расписания на ежемесячный", async () => {
    const wrapper = mount(AdminReminders);
    await flushPromises();

    await wrapper.find('[data-test="reminders-create"]').trigger("click");
    await wrapper.findAll("button").find((b) => b.text().includes("Каждый месяц"))!.trigger("click");
    expect(wrapper.find("#reminder-date").exists()).toBe(true);
    expect(wrapper.find("#reminder-date").attributes("type")).toBe("date");
    expect(wrapper.text()).toContain("каждый месяц");
    expect(wrapper.text()).toContain("в выбранное число");
    // Превью показывает выбранное число месяца
    const dateInput = wrapper.find("#reminder-date");
    await dateInput.setValue("2027-03-20");
    expect(wrapper.text()).toContain("каждый месяц 20-го числа");
  });

  it("журнал доставок выводится таблицей эталона с юзернеймом", async () => {
    const wrapper = mount(AdminReminders);
    await flushPromises();

    expect(wrapper.find(".crm-ref-table").exists()).toBe(true);
    expect(wrapper.text()).toContain("Журнал отправок");
    expect(wrapper.text()).toContain("Отправлено");
    expect(wrapper.text()).toContain("@ppofic");
  });

  it("подсказка внизу называет состав команды", async () => {
    const wrapper = mount(AdminReminders);
    await flushPromises();

    expect(wrapper.find(".crm-ref-hint").text()).toContain("@ppofic");
    expect(wrapper.find(".crm-ref-hint").text()).toContain("@QuaiLLLL");
  });
});
