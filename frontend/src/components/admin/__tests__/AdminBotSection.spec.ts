import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import AdminBotSection from "@/components/admin/AdminBotSection.vue";

function jsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => data,
  };
}

describe("AdminBotSection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("explains status template variables and Telegram HTML formatting", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/status")) {
        return jsonResponse({
          auto_replies_enabled: false,
          bot_token_configured: false,
          bot_token_live: false,
          bot_token_error: null,
          bot_process_online: false,
          active_connection: null,
          connections: [],
          userbot_connected: false,
          delivery_ready: false,
          quick_reply_count: 0,
          quick_reply_active_count: 0,
          status_templates: [
            "order_accepted",
            "order_assembled",
            "order_issued",
            "order_cancelled",
            "price_list",
            "welcome",
          ].map((event, index) => ({
            id: index + 1,
            event,
            title: `Техническое название ${index + 1}`,
            body: `Проверка сообщения ${index + 1}`,
            is_active: 1,
          })),
          recent_log_count: 0,
        });
      }
      if (url.includes("/log")) {
        return jsonResponse({
          items: [
            ...[
              "order_accepted",
              "order_assembled",
              "order_issued",
              "order_cancelled",
              "price_list",
              "welcome",
            ].map((templateEvent, index) => ({
              id: index + 1,
              chat_id: String(index + 123),
              direction: "out",
              message_type: "status",
              template_event: templateEvent,
              text: `Проверка события ${index + 1}`,
              created_at: "14.08.2026",
              meta: { outcome: "sent" },
            })),
            ...["incoming", "manual", "quick_reply", "price", "unmatched"].map((messageType, index) => ({
              id: index + 7,
              chat_id: String(index + 129),
              direction: messageType === "incoming" ? "in" : "out",
              message_type: messageType,
              template_event: null,
              text: `Проверка ${index + 2}`,
              created_at: "14.08.2026",
              meta: null,
            })),
          ],
        });
      }
      return jsonResponse({ items: [] });
    }));

    const wrapper = mount(AdminBotSection, {
      global: {
        stubs: { AdminModal: true },
      },
    });
    await flushPromises();

    const statusTab = wrapper.findAll("button").find((button) =>
      button.text().includes("Сообщения клиентам"),
    );
    expect(statusTab).toBeTruthy();
    await statusTab!.trigger("click");

    expect(wrapper.text()).toContain("{order_number}");
    expect(wrapper.text()).toContain("{pickup_cell_number}");
    expect(wrapper.text()).toContain("покажет клиенту короткий номер заказа");
    expect(wrapper.text()).toContain("Полный номер заказа клиенту не отправляется");
    expect(wrapper.text()).toContain("{final_amount} покажет сумму заказа");
    expect(wrapper.text()).toContain(
      "В сообщениях о заказе и прайсе можно сделать текст жирным, курсивным или добавить ссылку:",
    );
    const codeExamples = wrapper.findAll("code").map((code) => code.text());
    expect(codeExamples).toEqual(expect.arrayContaining([
      "<b>жирный</b>",
      "<i>курсив</i>",
      '<a href="https://site.by">название ссылки</a>',
    ]));
    const statusText = wrapper.text();
    for (const label of [
      "Заказ принят",
      "Заказ собран",
      "Заказ выдан",
      "Заказ отменён",
      "Выдача прайса (с кодом)",
    ]) {
      expect(statusText).toContain(label);
    }
    expect(statusText).not.toContain("Приветствие новому клиенту");
    expect(statusText).not.toContain("Техническое название");

    const historyTab = wrapper.findAll("button").find((button) =>
      button.text().includes("История"),
    );
    expect(historyTab).toBeTruthy();
    await historyTab!.trigger("click");
    const historyText = wrapper.find("ul").text();
    expect(historyText).toContain("Сообщение о заказе");
    expect(historyText).toContain("чат №123");
    expect(historyText).toContain("Входящее");
    expect(historyText).toContain("Отправлено вручную");
    expect(historyText).toContain("Автоответ");
    expect(historyText).toContain("Прайс");
    expect(historyText).toContain("Без автоответа");
    for (const label of [
      "Заказ принят",
      "Заказ собран",
      "Заказ выдан",
      "Заказ отменён",
      "Выдача прайса (с кодом)",
      "Приветствие новому клиенту",
    ]) {
      expect(historyText).toContain(label);
    }
    expect(historyText).not.toMatch(
      /order_accepted|order_assembled|order_issued|order_cancelled|price_list|welcome|incoming|manual|quick_reply|price|unmatched/,
    );
  });
});
