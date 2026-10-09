import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import CrmCustomers from "@/views/admin/crm/CrmCustomers.vue";
import { useCrmStore } from "@/stores/crm";

function response(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

function setupStore() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useCrmStore();
  store.fetchCustomers = vi.fn(async () => undefined);
  store.fetchCustomerFeedbacks = vi.fn(async () => undefined);
  store.fetchCustomerBlocksList = vi.fn(async () => undefined);
  return pinia;
}

function endpoint(input: RequestInfo | URL) {
  return String(input);
}

async function openAuthorization(pinia: ReturnType<typeof createPinia>) {
  const wrapper = mount(CrmCustomers, { global: { plugins: [pinia] } });
  await flushPromises();
  const authorizationTab = wrapper.findAll("button")
    .find((button) => button.text().includes("Авторизация"));
  if (!authorizationTab) throw new Error("Authorization tab not found");
  await authorizationTab.trigger("click");
  await flushPromises();
  return wrapper;
}

describe("CrmCustomers forbidden inviter settings", () => {
  beforeEach(() => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps access without inviter visible before restrictions and authorization history", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = endpoint(input);
      if (url.endsWith("/referral-authorizations")) return response({ items: [] });
      if (url.endsWith("/invite-bans")) return response({ items: [], pending: [] });
      if (url.endsWith("/disallowed-usernames")) return response({ items: [] });
      if (url.endsWith("/staff-access")) {
        return response({
          active: [{
            customer_id: "customer-1",
            telegram_id: "100",
            telegram_username: "allowed_client",
            first_name: "Allowed",
            access_authorized_by: "admin",
            has_issued_order: 0,
          }],
          pending: [{
            id: 7,
            telegram_username: "pending_client",
            granted_by: "admin",
            created_at: "2026-07-22",
          }],
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const wrapper = await openAuthorization(setupStore());
    const text = wrapper.text();
    expect(text).toContain("Доступ без пригласившего");
    expect(text).toContain("@allowed_client");
    expect(text).toContain("@pending_client");
    expect(text.indexOf("Доступ без пригласившего")).toBeLessThan(text.indexOf("Ограничения для пригласивших"));
    expect(text.indexOf("Ограничения для пригласивших")).toBeLessThan(text.indexOf("История авторизаций"));
    wrapper.unmount();
  });

  it("filters new customers by Minsk day, month, year and all time", async () => {
    vi.useFakeTimers();
    // 00:30 22 июля по Минску: проверяем границу суток, а не локальный час машины.
    vi.setSystemTime(new Date("2026-07-21T21:30:00Z"));
    const item = (telegram_id: string, username: string, access_authorized_at: string) => ({
      telegram_id,
      telegram_username: username,
      first_name: username,
      last_name: null,
      status: "authorized",
      attempts_used: 0,
      inviter_username: "inviter",
      has_issued_order: 0,
      access_authorization_source: "referral",
      access_authorized_by: null,
      access_authorized_at,
      updated_at: access_authorized_at,
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = endpoint(input);
      if (url.endsWith("/referral-authorizations")) return response({ items: [
        item("1", "today_client", "2026-07-21 21:10:00"),
        item("5", "previous_day_client", "2026-07-21 20:59:59"),
        item("2", "month_client", "2026-07-02 09:00:00"),
        item("3", "year_client", "2026-01-05 09:00:00"),
        item("4", "old_client", "2025-12-31 09:00:00"),
      ] });
      if (url.endsWith("/invite-bans")) return response({ items: [], pending: [] });
      if (url.endsWith("/disallowed-usernames")) return response({ items: [] });
      if (url.endsWith("/staff-access")) return response({ active: [], pending: [] });
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const wrapper = await openAuthorization(setupStore());
    expect(wrapper.text()).toContain("@today_client");
    expect(wrapper.text()).toContain("@previous_day_client");
    expect(wrapper.text()).toContain("@month_client");
    expect(wrapper.text()).not.toContain("@year_client");

    await wrapper.findAll("button").find((button) => button.text() === "За день")!.trigger("click");
    expect(wrapper.text()).toContain("@today_client");
    expect(wrapper.text()).not.toContain("@previous_day_client");
    expect(wrapper.text()).not.toContain("@month_client");

    vi.setSystemTime(new Date("2026-07-22T21:31:00Z"));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(wrapper.text()).not.toContain("@today_client");

    await wrapper.findAll("button").find((button) => button.text() === "За год")!.trigger("click");
    expect(wrapper.text()).toContain("@year_client");
    expect(wrapper.text()).not.toContain("@old_client");

    await wrapper.findAll("button").find((button) => button.text() === "Всё время")!.trigger("click");
    expect(wrapper.text()).toContain("@old_client");
    wrapper.unmount();
    vi.useRealTimers();
  });

  it("loads, batch-adds and removes usernames while updating the list", async () => {
    let items = [{ username: "admin_one", added_at: "2026-07-21", added_by: "admin" }];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = endpoint(input);
      if (url.endsWith("/referral-authorizations")) return response({ items: [] });
      if (url.endsWith("/invite-bans")) return response({ items: [] });
      if (url.endsWith("/staff-access")) return response({ active: [], pending: [] });
      if (url.includes("/disallowed-usernames/admin_two") && init?.method === "DELETE") {
        items = items.filter((item) => item.username !== "admin_two");
        return response({ ok: true });
      }
      if (url.endsWith("/disallowed-usernames") && init?.method === "POST") {
        const usernames = JSON.parse(String(init.body)).usernames as string[];
        items = [...new Set([...items.map((item) => item.username), ...usernames])]
          .map((username) => ({ username, added_at: "2026-07-21", added_by: "admin" }));
        return response({ items });
      }
      if (url.endsWith("/disallowed-usernames")) return response({ items });
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = await openAuthorization(setupStore());
    expect(wrapper.text()).toContain("@admin_one");

    await wrapper.get("#disallowed-inviter-input").setValue("@Admin_Two, admin_three");
    await wrapper.get("section form").trigger("submit");
    await flushPromises();

    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ usernames: ["admin_two", "admin_three"] });
    expect(wrapper.text()).toContain("@admin_two");
    expect(wrapper.text()).toContain("@admin_three");

    await wrapper.get("button[aria-label='Удалить @admin_two из наших аккаунтов']").trigger("click");
    await flushPromises();
    expect(window.confirm).toHaveBeenCalledWith("Разрешить использовать @admin_two как пригласившего?");
    expect(wrapper.text()).not.toContain("@admin_two");
    wrapper.unmount();
  });

  it("keeps a load error visible and retries without showing a false empty list", async () => {
    let listRequests = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = endpoint(input);
      if (url.endsWith("/referral-authorizations")) return response({ items: [] });
      if (url.endsWith("/invite-bans")) return response({ items: [] });
      if (url.endsWith("/staff-access")) return response({ active: [], pending: [] });
      if (url.endsWith("/disallowed-usernames")) {
        listRequests += 1;
        if (listRequests === 1) return response({ error: "failed" }, false, 500);
        return response({ items: [{ username: "admin_retry", added_at: "", added_by: null }] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const wrapper = await openAuthorization(setupStore());
    expect(wrapper.text()).toContain("Не удалось загрузить запрещённые username");
    expect(wrapper.text()).not.toContain("Список пока пуст");
    const retry = wrapper.findAll("button").find((button) => button.text() === "Повторить");
    expect(retry).toBeTruthy();
    await retry!.trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("@admin_retry");
    wrapper.unmount();
  });

  it("blocks repeated submits and shows invalid and server errors", async () => {
    let resolvePost: ((value: Response) => void) | null = null;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = endpoint(input);
      if (url.endsWith("/referral-authorizations")) return Promise.resolve(response({ items: [] }));
      if (url.endsWith("/invite-bans")) return Promise.resolve(response({ items: [] }));
      if (url.endsWith("/staff-access")) return Promise.resolve(response({ active: [], pending: [] }));
      if (url.endsWith("/disallowed-usernames") && init?.method === "POST") {
        return new Promise<Response>((resolve) => { resolvePost = resolve; });
      }
      if (url.endsWith("/disallowed-usernames")) return Promise.resolve(response({ items: [] }));
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = await openAuthorization(setupStore());
    const input = wrapper.get("#disallowed-inviter-input");
    const form = wrapper.get("section form");
    await input.setValue("правда, ok_admin");
    await form.trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("Некорректные username: @правда");
    expect(input.attributes("aria-invalid")).toBe("true");

    await input.setValue("valid_admin");
    await form.trigger("submit");
    await form.trigger("submit");
    await flushPromises();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    resolvePost!(response({ error: "failed" }, false, 500));
    await flushPromises();
    expect(wrapper.text()).toContain("Не удалось сохранить список");
    wrapper.unmount();
  });
});
