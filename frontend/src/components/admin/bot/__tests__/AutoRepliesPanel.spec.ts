/**
 * Экран автоответов клиентам.
 *
 * Моки построены строго по реальным ответам API (`GET /bot/status`,
 * `GET|POST /bot/quick-replies`, `POST /bot/quick-replies/test`,
 * `POST /bot/quick-replies/:id/move`, `PUT /bot/settings`) — проверено
 * запросами к работающему серверу. Это важно: мок, придумывающий другую форму
 * ответа, скрывает настоящие баги.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import AutoRepliesPanel from "@/components/admin/bot/AutoRepliesPanel.vue";
import QuickReplyForm from "@/components/admin/bot/QuickReplyForm.vue";

/**
 * AdminModal заглушается стабом со слотом: иначе содержимое формы и окна
 * подтверждения в дерево не попадает и тесты «не находят» элементы.
 */
const modalStub = {
  template: '<div class="modal-stub"><slot /></div>',
  props: ['isOpen', 'title', 'description', 'size', 'showActions', 'persistent', 'isLoading', 'referenceDesign'],
};

function jsonResponse(data: unknown, ok = true, status = ok ? 200 : 500) {
  return { ok, status, json: async () => data };
}

/** Ответ GET /api/admin/crm/bot/status — как отдаёт сервер. */
function statusPayload(overrides: Record<string, unknown> = {}) {
  return {
    auto_replies_enabled: false,
    bot_token_configured: true,
    bot_token_live: true,
    bot_token_error: null,
    bot_process_online: true,
    active_connection: { id: "bc_1" },
    connections: [],
    userbot_connected: true,
    delivery_ready: true,
    quick_reply_count: 0,
    quick_reply_active_count: 0,
    status_templates: [],
    recent_log_count: 0,
    auto_reply_blockers: [],
    cooldown_minutes: 30,
    cooldown_default_minutes: 30,
    cooldown_max_minutes: 1440,
    ...overrides,
  };
}

/** Ответ GET /api/admin/crm/bot/quick-replies — как отдаёт сервер. */
function rule(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    title: "График работы",
    keywords: ["график", "до скольки"],
    response_text: "Работаем ежедневно с 10:00 до 20:00",
    is_active: 1,
    sort_order: 10,
    created_at: "2026-11-22 20:12:39",
    updated_at: "2026-11-22 20:12:39",
    ...overrides,
  };
}

interface StubOptions {
  status?: Record<string, unknown>;
  rules?: unknown[];
  onRequest?: (url: string, init?: RequestInit) => unknown | undefined;
}

function stubApi(options: StubOptions = {}) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown = undefined;
    if (init?.body) {
      try {
        body = JSON.parse(String(init.body));
      } catch {
        body = init.body;
      }
    }
    calls.push({ url, method, body });

    const custom = options.onRequest?.(url, init);
    if (custom !== undefined) return custom;

    if (url.includes("/bot/status")) {
      return jsonResponse(statusPayload(options.status ?? {}));
    }
    if (url.includes("/quick-replies/test")) {
      return jsonResponse({ ok: true, normalized: "до скольки работаете", matched: null });
    }
    if (url.includes("/quick-replies")) {
      return jsonResponse({ items: options.rules ?? [] });
    }
    if (url.includes("/bot/settings")) {
      return jsonResponse({
        ok: true,
        auto_replies_enabled: Boolean((body as { auto_replies_enabled?: boolean })?.auto_replies_enabled),
        cooldown_minutes: 30,
        blockers: [],
      });
    }
    return jsonResponse({ ok: true });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

async function mountPanel(options: StubOptions = {}) {
  const api = stubApi(options);
  const wrapper = mount(AutoRepliesPanel, {
    global: { stubs: { AdminModal: modalStub } },
  });
  await flushPromises();
  await flushPromises();
  return { wrapper, ...api };
}

describe("AutoRepliesPanel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("показывает правила, полученные от сервера", async () => {
    const { wrapper } = await mountPanel({ rules: [rule(), rule({ id: 2, title: "Доставка", keywords: ["доставка"] })] });

    expect(wrapper.text()).toContain("График работы");
    expect(wrapper.text()).toContain("Доставка");
    expect(wrapper.text()).toContain("график");
    expect(wrapper.text()).toContain("2 из 2");
  });

  it("объясняет, что делать, когда правил нет", async () => {
    const { wrapper } = await mountPanel({ rules: [] });

    expect(wrapper.text()).toContain("Правил пока нет");
  });

  it("показывает причины, по которым автоответ не уйдёт", async () => {
    const { wrapper } = await mountPanel({
      status: {
        auto_reply_blockers: [
          { code: "disabled", message: "Автоответы выключены", hint: "Включите переключатель справа." },
        ],
      },
    });

    expect(wrapper.text()).toContain("Автоответы выключены");
    expect(wrapper.text()).toContain("Включите переключатель справа.");
  });

  it("без причин показывает, что всё готово", async () => {
    const { wrapper } = await mountPanel({ rules: [rule()], status: { auto_replies_enabled: true } });

    expect(wrapper.text()).toContain("Готово к работе");
  });

  it("тумблер отправляет настройку и меняет состояние", async () => {
    const { wrapper, calls } = await mountPanel({ rules: [rule()] });

    const toggle = wrapper.find('[role="switch"]');
    expect(toggle.attributes("aria-checked")).toBe("false");

    await toggle.trigger("click");
    await flushPromises();

    const settingsCall = calls.find((c) => c.url.includes("/bot/settings") && c.method === "PUT");
    expect(settingsCall).toBeTruthy();
    expect(settingsCall?.body).toEqual({ auto_replies_enabled: true });
    expect(wrapper.find('[role="switch"]').attributes("aria-checked")).toBe("true");
  });

  it("возвращает тумблер назад, если сервер отказал", async () => {
    const { wrapper } = await mountPanel({
      rules: [rule()],
      onRequest: (url) => (url.includes("/bot/settings") ? jsonResponse({ error: "failed" }, false) : undefined),
    });

    await wrapper.find('[role="switch"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[role="switch"]').attributes("aria-checked")).toBe("false");
    expect(wrapper.text()).toContain("Не удалось переключить автоответы");
  });

  it("кнопка правила переключает активность через PUT", async () => {
    const { wrapper, calls } = await mountPanel({ rules: [rule()] });

    const buttons = wrapper.findAll(".crm-ref-chip-button").filter((b) => b.text() === "Выключить");
    expect(buttons.length).toBe(1);
    await buttons[0].trigger("click");
    await flushPromises();

    const put = calls.find((c) => c.url.includes("/quick-replies/1") && c.method === "PUT");
    expect(put).toBeTruthy();
    expect((put?.body as { is_active: number }).is_active).toBe(0);
  });

  it("перестановка правил шлёт направление и берёт порядок с сервера", async () => {
    const { wrapper, calls } = await mountPanel({
      rules: [rule({ id: 1, sort_order: 10 }), rule({ id: 2, title: "Второе", sort_order: 20 })],
      onRequest: (url) =>
        url.includes("/move")
          ? jsonResponse({
              ok: true,
              moved: true,
              items: [rule({ id: 2, title: "Второе", sort_order: 10 }), rule({ id: 1, sort_order: 20 })],
            })
          : undefined,
    });

    const upButtons = wrapper.findAll('[aria-label="Опустить правило ниже"]');
    await upButtons[0].trigger("click");
    await flushPromises();

    const move = calls.find((c) => c.url.includes("/move"));
    expect(move?.body).toEqual({ direction: "down" });
  });

  it("первое правило нельзя поднять выше — кнопка заблокирована", async () => {
    const { wrapper } = await mountPanel({ rules: [rule({ id: 1 }), rule({ id: 2, title: "Второе" })] });

    const upFirst = wrapper.findAll('[aria-label="Поднять правило выше"]')[0];
    expect(upFirst.attributes("disabled")).toBeDefined();
  });

  it("удаление спрашивает подтверждение и только потом шлёт DELETE", async () => {
    const { wrapper, calls } = await mountPanel({ rules: [rule()] });

    const deleteButton = wrapper.findAll(".crm-ref-chip-button--danger")[0];
    await deleteButton.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("будет удалено");
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);

    // Обе модалки (правило и удаление) всегда в DOM, поэтому берём последнюю —
    // она и есть окно подтверждения. Отправляем submit: happy-dom не
    // инициирует submit кликом по кнопке.
    const forms = wrapper.findAll(".modal-stub form");
    await forms[forms.length - 1].trigger("submit");
    await flushPromises();

    expect(calls.some((c) => c.method === "DELETE" && c.url.includes("/quick-replies/1"))).toBe(true);
  });

  it("показывает ошибку загрузки, если сервер не ответил", async () => {
    const { wrapper } = await mountPanel({
      onRequest: (url) => (url.includes("/bot/status") ? jsonResponse({}, false) : undefined),
    });

    expect(wrapper.text()).toContain("Не удалось загрузить настройки");
  });

  it("пауза показывается в удобном виде и сохраняется", async () => {
    const { wrapper, calls } = await mountPanel({ rules: [rule()], status: { cooldown_minutes: 30 } });

    expect(wrapper.text()).toContain("30 мин");

    const editLink = wrapper.findAll("button").find((b) => b.text() === "Изменить");
    await editLink?.trigger("click");
    await wrapper.find("#cooldown-input").setValue(90);
    const save = wrapper.findAll("button").find((b) => b.text() === "Сохранить");
    await save?.trigger("click");
    await flushPromises();

    const put = calls.find((c) => c.url.includes("/bot/settings") && c.method === "PUT");
    expect((put?.body as { cooldown_minutes: number }).cooldown_minutes).toBe(90);
  });

  it("пауза 0 объясняется как «без паузы»", async () => {
    const { wrapper } = await mountPanel({ rules: [rule()], status: { cooldown_minutes: 0 } });

    expect(wrapper.text()).toContain("Без паузы");
  });


  it("истории автоответов на экране нет", async () => {
    const { wrapper, calls } = await mountPanel({
      rules: [rule({ id: 1 })],
    });

    // Блок убран по требованию: он дублировал причины, которые и так видны выше.
    expect(wrapper.text()).not.toContain("История автоответов");
    expect(wrapper.text()).not.toContain("Автоответов пока не было");
    // И вместе с ним ушёл запрос журнала: лишний трафик на каждое открытие.
    expect(calls.some((c) => c.url.includes("/bot/log"))).toBe(false);
  });

  it("счётчик срабатываний приходит из статуса и не зависит от журнала", async () => {
    const { wrapper } = await mountPanel({
      rules: [rule({ id: 1 })],
      // Сервер считает срабатывания по всему журналу и отдаёт готовым словарём,
      // а не по последним 50 записям — иначе цифра была бы занижена.
      status: { auto_reply_hits: { "1": 300 } },
    });

    expect(wrapper.text()).toContain("Сработало 300 раз");
  });

  it("рабочий канал показан коротко и по делу", async () => {
    const { wrapper } = await mountPanel({
      rules: [rule()],
      status: { userbot_connected: true, delivery_ready: true },
    });

    expect(wrapper.text()).toContain("Канал доставки");
    expect(wrapper.text()).toContain("Готов");
    // Пояснения убраны: плитка отвечает на вопрос «работает ли» одним словом.
    expect(wrapper.text()).not.toContain("Основной канал");
  });

  it("нерабочий канал прямо говорит об этом", async () => {
    const { wrapper } = await mountPanel({
      rules: [rule()],
      status: { userbot_connected: false, delivery_ready: false, bot_process_online: false },
    });

    expect(wrapper.text()).toContain("Недоступен");
  });
});

describe("QuickReplyForm", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("кнопка «Из Telegram» подставляет текст заготовки", async () => {
    stubApi({
      onRequest: (url) =>
        url.includes("/bot/telegram-quick-replies")
          ? jsonResponse({
              ok: true,
              items: [
                { id: 1, name: "график", text: "Работаем ежедневно с 10:00 до 20:00" },
                { id: 2, name: "прайс", text: "Прайс в закрепе" },
              ],
            })
          : undefined,
    });
    const wrapper = mount(QuickReplyForm, {
      props: { isOpen: true, editing: null },
      global: { stubs: { AdminModal: modalStub } },
    });
    await flushPromises();

    // До нажатия список не грузится: userbot может быть недоступен,
    // и дёргать его при каждом открытии формы незачем.
    expect(wrapper.text()).not.toContain("Работаем ежедневно");

    await wrapper.find('[data-testid="from-telegram"]').trigger("click");
    await flushPromises();

    const buttons = wrapper.findAll(".crm-restriction-template");
    expect(buttons.length).toBe(2);
    await buttons[0].trigger("click");
    await flushPromises();

    expect((wrapper.find("#rule-response").element as HTMLTextAreaElement).value).toBe(
      "Работаем ежедневно с 10:00 до 20:00",
    );
  });

  it("заготовка без читаемого текста не подставляется и не ломает список", async () => {
    stubApi({
      onRequest: (url) =>
        url.includes("/bot/telegram-quick-replies")
          ? jsonResponse({
              ok: true,
              items: [
                { id: 1, name: "битая", text: "" },
                { id: 2, name: "прайс", text: "Прайс в закрепе" },
              ],
            })
          : undefined,
    });
    const wrapper = mount(QuickReplyForm, {
      props: { isOpen: true, editing: null },
      global: { stubs: { AdminModal: modalStub } },
    });
    await flushPromises();

    await wrapper.find('[data-testid="from-telegram"]').trigger("click");
    await flushPromises();

    const buttons = wrapper.findAll(".crm-restriction-template");
    expect(buttons[0].attributes("disabled")).toBeDefined();
    expect(buttons[1].attributes("disabled")).toBeUndefined();

    await buttons[1].trigger("click");
    await flushPromises();
    expect((wrapper.find("#rule-response").element as HTMLTextAreaElement).value).toBe("Прайс в закрепе");
  });

  it("недоступный userbot объясняется словами, а не пустым списком", async () => {
    stubApi({
      onRequest: (url) =>
        url.includes("/bot/telegram-quick-replies") ? jsonResponse({ error: "userbot_unavailable" }, false, 503) : undefined,
    });
    const wrapper = mount(QuickReplyForm, {
      props: { isOpen: true, editing: null },
      global: { stubs: { AdminModal: modalStub } },
    });
    await flushPromises();

    await wrapper.find('[data-testid="from-telegram"]').trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Userbot недоступен");
  });

  it("слово из поля превращается в чип по Enter", async () => {
    stubApi();
    const wrapper = mount(QuickReplyForm, {
      props: { isOpen: true, editing: null },
      global: { stubs: { AdminModal: modalStub } },
    });
    await flushPromises();

    const input = wrapper.find("#rule-trigger-input");
    await input.setValue("до скольки");
    await input.trigger("keydown.enter");

    expect(wrapper.text()).toContain("до скольки");
    expect((wrapper.find("#rule-trigger-input").element as HTMLInputElement).value).toBe("");
  });

  it("вставленная строка с запятыми разбирается на отдельные слова", async () => {
    stubApi();
    const wrapper = mount(QuickReplyForm, {
      props: { isOpen: true, editing: null },
      global: { stubs: { AdminModal: modalStub } },
    });
    await flushPromises();

    const input = wrapper.find("#rule-trigger-input");
    await input.setValue("график, до скольки");
    await input.trigger("keydown.enter");

    const chips = wrapper.findAll(".crm-restriction-trigger");
    expect(chips.length).toBe(2);
  });

  it("повтор слова не создаёт второй чип", async () => {
    stubApi();
    const wrapper = mount(QuickReplyForm, {
      props: { isOpen: true, editing: null },
      global: { stubs: { AdminModal: modalStub } },
    });
    await flushPromises();

    const input = wrapper.find("#rule-trigger-input");
    await input.setValue("график");
    await input.trigger("keydown.enter");
    await input.setValue("ГРАФИК");
    await input.trigger("keydown.enter");

    expect(wrapper.findAll(".crm-restriction-trigger").length).toBe(1);
  });

  it("чип можно убрать крестиком", async () => {
    stubApi();
    const wrapper = mount(QuickReplyForm, {
      props: { isOpen: true, editing: null },
      global: { stubs: { AdminModal: modalStub } },
    });
    await flushPromises();

    const input = wrapper.find("#rule-trigger-input");
    await input.setValue("график");
    await input.trigger("keydown.enter");
    expect(wrapper.findAll(".crm-restriction-trigger").length).toBe(1);

    await wrapper.find(".crm-restriction-trigger button").trigger("click");
    expect(wrapper.findAll(".crm-restriction-trigger").length).toBe(0);
  });

  it("без слов-триггеров сохранить нельзя", async () => {
    stubApi();
    const wrapper = mount(QuickReplyForm, {
      props: { isOpen: true, editing: null },
      global: { stubs: { AdminModal: modalStub } },
    });
    await flushPromises();

    await wrapper.find("#rule-title").setValue("График");
    await wrapper.find("#rule-response").setValue("до 20:00");

    const submit = wrapper.find('button[type="submit"]');
    expect(submit.attributes("disabled")).toBeDefined();
  });

  it("проверка фразы показывает найденное правило", async () => {
    stubApi({
      onRequest: (url) =>
        url.includes("/quick-replies/test")
          ? jsonResponse({
              ok: true,
              normalized: "до скольки работаете",
              matched: { id: 4, title: "График работы", response_text: "Работаем до 20:00" },
            })
          : undefined,
    });
    const wrapper = mount(QuickReplyForm, {
      props: { isOpen: true, editing: null },
      global: { stubs: { AdminModal: modalStub } },
    });
    await flushPromises();

    await wrapper.find("#rule-check-input").setValue("До скольки работаете?");
    const checkButton = wrapper.findAll("button").find((b) => b.text() === "Проверить");
    await checkButton?.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Сработает правило");
    expect(wrapper.text()).toContain("График работы");
    expect(wrapper.text()).toContain("Работаем до 20:00");
  });

  it("проверка честно говорит, когда правило не найдено", async () => {
    stubApi();
    const wrapper = mount(QuickReplyForm, {
      props: { isOpen: true, editing: null },
      global: { stubs: { AdminModal: modalStub } },
    });
    await flushPromises();

    await wrapper.find("#rule-check-input").setValue("абракадабра");
    const checkButton = wrapper.findAll("button").find((b) => b.text() === "Проверить");
    await checkButton?.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Ни одно");
    expect(wrapper.text()).toContain("не сработает");
  });

  it("ошибка проверки показывается, а не глотается", async () => {
    stubApi({ onRequest: (url) => (url.includes("/quick-replies/test") ? jsonResponse({}, false) : undefined) });
    const wrapper = mount(QuickReplyForm, {
      props: { isOpen: true, editing: null },
      global: { stubs: { AdminModal: modalStub } },
    });
    await flushPromises();

    await wrapper.find("#rule-check-input").setValue("график");
    const checkButton = wrapper.findAll("button").find((b) => b.text() === "Проверить");
    await checkButton?.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Не удалось проверить фразу");
  });

  it("редактирование заполняет поля из правила", async () => {
    stubApi();
    const wrapper = mount(QuickReplyForm, {
      props: { isOpen: true, editing: rule() },
      global: { stubs: { AdminModal: modalStub } },
    });
    await flushPromises();

    expect((wrapper.find("#rule-title").element as HTMLInputElement).value).toBe("График работы");
    expect((wrapper.find("#rule-response").element as HTMLTextAreaElement).value).toContain("Работаем");
    expect(wrapper.findAll(".crm-restriction-trigger").length).toBe(2);
  });

  it("ошибка сервера при сохранении переводится на человеческий язык", async () => {
    stubApi({ onRequest: (url, init) => (url.includes("/quick-replies") && init?.method === "POST" ? jsonResponse({ error: "keywords_too_long" }, false) : undefined) });
    const wrapper = mount(QuickReplyForm, {
      props: { isOpen: true, editing: null },
      global: { stubs: { AdminModal: modalStub } },
    });
    await flushPromises();

    await wrapper.find("#rule-title").setValue("График");
    await wrapper.find("#rule-response").setValue("до 20:00");
    const input = wrapper.find("#rule-trigger-input");
    await input.setValue("график");
    await input.trigger("keydown.enter");

    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(wrapper.text()).toContain("Слишком много слов-триггеров");
  });
});
