import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ReferralAuthorizationGate from "@/components/ReferralAuthorizationGate.vue";

const blockMocks = vi.hoisted(() => ({
  applyBlockFromResponse: vi.fn(),
  refreshBlock: vi.fn(async () => undefined),
}));

vi.mock("@/composables/useCustomerBlock", () => ({
  useCustomerBlock: () => blockMocks,
}));

function response(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

function dispatchNativePaste(element: Element, text: string) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (type: string) => type === "text" ? text : "" },
  });
  element.dispatchEvent(event);
  return event;
}

const shellStub = {
  props: ["open", "title", "closable", "closeDisabled"],
  template: `
    <div v-if="open" class="modal-shell" :data-closable="String(closable)">
      <h2>{{ title }}</h2><slot /><slot name="footer" />
    </div>
  `,
};

describe("ReferralAuthorizationGate", () => {
  beforeEach(() => {
    Object.defineProperty(window, "Telegram", {
      configurable: true,
      value: {
        WebApp: {
          initData: "signed-init-data",
          initDataUnsafe: {
            user: { id: 990000030, username: "new_gate_user", first_name: "New" },
          },
        },
      },
    });
    blockMocks.applyBlockFromResponse.mockClear();
    blockMocks.refreshBlock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("opens immediately without a close action and authorizes before the catalog", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        enabled: true,
        required: true,
        attempts_used: 0,
        attempts_remaining: 3,
      }))
      .mockResolvedValueOnce(response({
        success: true,
        enabled: true,
        authorized: true,
        required: false,
        attempts_remaining: 3,
      }));
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(ReferralAuthorizationGate, {
      attachTo: document.body,
      global: { stubs: { CustomerModalShell: shellStub } },
    });
    await flushPromises();

    expect(wrapper.find(".modal-shell").attributes("data-closable")).toBe("false");
    expect(wrapper.text()).toContain("Чтобы посмотреть цены");
    expect(wrapper.find("button[aria-label*='Закрыть']").exists()).toBe(false);
    expect(document.activeElement).toBe(wrapper.find("input").element);

    await wrapper.find("input").setValue("@Good_User");
    expect((wrapper.find("input").element as HTMLInputElement).value).toBe("Good_User");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/referral-authorization/authorize",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      inviter_username: "Good_User",
    });
    expect(wrapper.find(".modal-shell").exists()).toBe(false);
    wrapper.unmount();
  });

  it("accepts a manually entered username without @", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        enabled: true,
        required: true,
        attempts_used: 0,
        attempts_remaining: 3,
      }))
      .mockResolvedValueOnce(response({
        success: true,
        enabled: true,
        authorized: true,
        required: false,
        attempts_remaining: 3,
      }));
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(ReferralAuthorizationGate, {
      global: { stubs: { CustomerModalShell: shellStub } },
    });
    await flushPromises();

    await wrapper.find("input").setValue("Good_User");
    expect((wrapper.find("input").element as HTMLInputElement).value).toBe("Good_User");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      inviter_username: "Good_User",
    });
    expect(wrapper.find(".modal-shell").exists()).toBe(false);
    wrapper.unmount();
  });

  it("pastes a Telegram username with @ from the clipboard without spending an attempt", async () => {
    const readText = vi.fn().mockResolvedValue("  @Good_User  ");
    vi.stubGlobal("navigator", { clipboard: { readText } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        enabled: true,
        required: true,
        attempts_used: 0,
        attempts_remaining: 3,
      }))
      .mockResolvedValueOnce(response({
        success: true,
        authorized: true,
        required: false,
        attempts_remaining: 3,
      }));
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(ReferralAuthorizationGate, {
      global: { stubs: { CustomerModalShell: shellStub } },
    });
    await flushPromises();
    await wrapper.find("input").setValue("Existing_User");

    await wrapper.find(".referral-gate__paste").trigger("click");
    await flushPromises();

    expect(readText).toHaveBeenCalledOnce();
    expect((wrapper.find("input").element as HTMLInputElement).value).toBe("Good_User");
    expect(wrapper.text()).toContain("Username вставлен");
    expect(wrapper.text()).toContain("Осталось попыток: 3");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      inviter_username: "Good_User",
    });
    wrapper.unmount();
  });

  it("uses Telegram clipboard fallback and accepts a copied t.me link", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { readText: vi.fn().mockRejectedValue(new DOMException("denied")) },
    });
    window.Telegram!.WebApp.readTextFromClipboard = vi.fn((callback) => {
      callback?.("https://t.me/Link_User?start=copy");
    });
    const fetchMock = vi.fn().mockResolvedValue(response({
      enabled: true,
      required: true,
      attempts_used: 0,
      attempts_remaining: 3,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(ReferralAuthorizationGate, {
      global: { stubs: { CustomerModalShell: shellStub } },
    });
    await flushPromises();

    await wrapper.find(".referral-gate__paste").trigger("click");
    await flushPromises();

    expect(window.Telegram!.WebApp.readTextFromClipboard).toHaveBeenCalledOnce();
    expect((wrapper.find("input").element as HTMLInputElement).value).toBe("Link_User");
    wrapper.unmount();
  });

  it("uses Telegram fallback when the WebView throws synchronously while reading clipboard", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        readText: vi.fn(() => {
          throw new DOMException("denied", "SecurityError");
        }),
      },
    });
    window.Telegram!.WebApp.readTextFromClipboard = vi.fn((callback) => callback?.("@Sync_Fallback"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      enabled: true,
      required: true,
      attempts_used: 0,
      attempts_remaining: 3,
    })));

    const wrapper = mount(ReferralAuthorizationGate, {
      global: { stubs: { CustomerModalShell: shellStub } },
    });
    await flushPromises();

    await wrapper.find(".referral-gate__paste").trigger("click");
    await flushPromises();

    expect(window.Telegram!.WebApp.readTextFromClipboard).toHaveBeenCalledOnce();
    expect((wrapper.find("input").element as HTMLInputElement).value).toBe("Sync_Fallback");
    wrapper.unmount();
  });

  it("uses Telegram clipboard after the browser clipboard times out", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", {
      clipboard: { readText: vi.fn(() => new Promise<string>(() => undefined)) },
    });
    window.Telegram!.WebApp.readTextFromClipboard = vi.fn((callback) => {
      callback?.("@Fallback_User");
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      enabled: true,
      required: true,
      attempts_used: 0,
      attempts_remaining: 3,
    })));

    const wrapper = mount(ReferralAuthorizationGate, {
      global: { stubs: { CustomerModalShell: shellStub } },
    });
    await flushPromises();

    await wrapper.find(".referral-gate__paste").trigger("click");
    expect(wrapper.find(".referral-gate__paste").attributes("aria-busy")).toBe("true");
    await vi.advanceTimersByTimeAsync(1200);
    await flushPromises();

    expect(window.Telegram!.WebApp.readTextFromClipboard).toHaveBeenCalledOnce();
    expect((wrapper.find("input").element as HTMLInputElement).value).toBe("Fallback_User");
    expect(wrapper.find(".referral-gate__paste").attributes("aria-busy")).toBe("false");
    wrapper.unmount();
  });

  it("deterministically prefers the browser clipboard when both sources disagree", async () => {
    let resolveBrowserClipboard: (value: string) => void = () => undefined;
    vi.stubGlobal("navigator", {
      clipboard: {
        readText: vi.fn(() => new Promise<string>((resolve) => {
          resolveBrowserClipboard = resolve;
        })),
      },
    });
    window.Telegram!.WebApp.readTextFromClipboard = vi.fn((callback) => callback?.("@Telegram_User"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      enabled: true,
      required: true,
      attempts_used: 0,
      attempts_remaining: 3,
    })));

    const wrapper = mount(ReferralAuthorizationGate, {
      global: { stubs: { CustomerModalShell: shellStub } },
    });
    await flushPromises();

    await wrapper.find(".referral-gate__paste").trigger("click");
    expect(wrapper.find(".referral-gate__paste").attributes("aria-busy")).toBe("true");
    resolveBrowserClipboard("@Browser_User");
    await flushPromises();

    expect((wrapper.find("input").element as HTMLInputElement).value).toBe("Browser_User");
    expect(wrapper.text()).not.toContain("Telegram_User");
    wrapper.unmount();
  });

  it("focuses the input and explains native paste when both clipboard APIs are unavailable", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", {
      clipboard: { readText: vi.fn(() => new Promise<string>(() => undefined)) },
    });
    window.Telegram!.WebApp.readTextFromClipboard = vi.fn((callback) => callback?.(null));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      enabled: true,
      required: true,
      attempts_used: 0,
      attempts_remaining: 3,
    })));

    const wrapper = mount(ReferralAuthorizationGate, {
      attachTo: document.body,
      global: { stubs: { CustomerModalShell: shellStub } },
    });
    await flushPromises();
    await wrapper.find("input").setValue("Existing_User");

    await wrapper.find(".referral-gate__paste").trigger("click");
    expect(wrapper.find(".referral-gate__paste").attributes("aria-busy")).toBe("true");
    await vi.advanceTimersByTimeAsync(1200);
    await flushPromises();

    expect(wrapper.text()).toContain("Зажмите поле");
    expect(document.activeElement).toBe(wrapper.find("input").element);
    expect((wrapper.find("input").element as HTMLInputElement).selectionStart).toBe(0);
    expect((wrapper.find("input").element as HTMLInputElement).selectionEnd).toBe("Existing_User".length);
    expect(wrapper.find(".referral-gate__paste").attributes("aria-busy")).toBe("false");
    wrapper.unmount();
  });

  it("does not insert arbitrary clipboard text or spend an authorization attempt", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { readText: vi.fn().mockResolvedValue("not a telegram username") },
    });
    const fetchMock = vi.fn().mockResolvedValue(response({
      enabled: true,
      required: true,
      attempts_used: 0,
      attempts_remaining: 3,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(ReferralAuthorizationGate, {
      global: { stubs: { CustomerModalShell: shellStub } },
    });
    await flushPromises();

    await wrapper.find(".referral-gate__paste").trigger("click");
    await flushPromises();

    expect((wrapper.find("input").element as HTMLInputElement).value).toBe("");
    expect(wrapper.text()).toContain("В буфере нет корректного Telegram username");
    expect(wrapper.text()).toContain("Осталось попыток: 3");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it.each([
    ["@Native_User", "Native_User"],
    ["Native_User", "Native_User"],
    ["https://t.me/Native_User?start=copy", "Native_User"],
  ])("normalizes native paste %s without spending an attempt", async (clipboardText, expectedUsername) => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      enabled: true,
      required: true,
      attempts_used: 0,
      attempts_remaining: 3,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(ReferralAuthorizationGate, {
      global: { stubs: { CustomerModalShell: shellStub } },
    });
    await flushPromises();

    const event = dispatchNativePaste(wrapper.find("input").element, clipboardText);
    await flushPromises();

    expect(event.defaultPrevented).toBe(true);
    expect((wrapper.find("input").element as HTMLInputElement).value).toBe(expectedUsername);
    expect(wrapper.text()).toContain("Username вставлен");
    expect(wrapper.text()).toContain("Осталось попыток: 3");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("blocks invalid native paste without changing the field or spending an attempt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      enabled: true,
      required: true,
      attempts_used: 0,
      attempts_remaining: 3,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(ReferralAuthorizationGate, {
      global: { stubs: { CustomerModalShell: shellStub } },
    });
    await flushPromises();
    await wrapper.find("input").setValue("Existing_User");

    const event = dispatchNativePaste(wrapper.find("input").element, "not a telegram username");
    await flushPromises();

    expect(event.defaultPrevented).toBe(true);
    expect((wrapper.find("input").element as HTMLInputElement).value).toBe("Existing_User");
    expect(wrapper.text()).toContain("В буфере нет корректного Telegram username");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("blocks native paste with unavailable clipboard data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      enabled: true,
      required: true,
      attempts_used: 0,
      attempts_remaining: 3,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(ReferralAuthorizationGate, {
      global: { stubs: { CustomerModalShell: shellStub } },
    });
    await flushPromises();
    await wrapper.find("input").setValue("Existing_User");

    const event = new Event("paste", { bubbles: true, cancelable: true });
    wrapper.find("input").element.dispatchEvent(event);
    await flushPromises();

    expect(event.defaultPrevented).toBe(true);
    expect((wrapper.find("input").element as HTMLInputElement).value).toBe("Existing_User");
    expect(wrapper.text()).toContain("Не удалось прочитать вставку");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it.each(["proxy", "confirmphone", "boost", "oauth"])(
    "does not accept the Telegram service link %s as an inviter username",
    async (servicePath) => {
      vi.stubGlobal("navigator", {
        clipboard: { readText: vi.fn().mockResolvedValue(`https://t.me/${servicePath}?value=example`) },
      });
      const fetchMock = vi.fn().mockResolvedValue(response({
        enabled: true,
        required: true,
        attempts_used: 0,
        attempts_remaining: 3,
      }));
      vi.stubGlobal("fetch", fetchMock);

      const wrapper = mount(ReferralAuthorizationGate, {
        global: { stubs: { CustomerModalShell: shellStub } },
      });
      await flushPromises();

      await wrapper.find(".referral-gate__paste").trigger("click");
      await flushPromises();

      expect((wrapper.find("input").element as HTMLInputElement).value).toBe("");
      expect(wrapper.text()).toContain("В буфере нет корректного Telegram username");
      expect(wrapper.text()).toContain("Осталось попыток: 3");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      wrapper.unmount();
    },
  );

  it("does not overwrite a username typed while clipboard reading is pending", async () => {
    let resolveClipboard: (value: string) => void = () => undefined;
    const clipboardPromise = new Promise<string>((resolve) => {
      resolveClipboard = resolve;
    });
    const readText = vi.fn().mockReturnValue(clipboardPromise);
    vi.stubGlobal("navigator", { clipboard: { readText } });
    const fetchMock = vi.fn().mockResolvedValue(response({
      enabled: true,
      required: true,
      attempts_used: 0,
      attempts_remaining: 3,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(ReferralAuthorizationGate, {
      global: { stubs: { CustomerModalShell: shellStub } },
    });
    await flushPromises();

    await wrapper.find("input").setValue("Existing_User");
    await wrapper.find(".referral-gate__paste").trigger("click");
    expect(wrapper.find(".referral-gate__paste").attributes("aria-busy")).toBe("true");
    expect(wrapper.find(".referral-gate__cta").attributes()).toHaveProperty("disabled");
    await wrapper.find("form").trigger("submit");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await wrapper.find("input").setValue("Manual_User");
    resolveClipboard("@Late_User");
    await flushPromises();

    expect((wrapper.find("input").element as HTMLInputElement).value).toBe("Manual_User");
    expect(wrapper.find(".referral-gate__paste").attributes("aria-busy")).toBe("false");
    wrapper.unmount();
  });

  it("fails closed when opened outside Telegram", async () => {
    Object.defineProperty(window, "Telegram", {
      configurable: true,
      value: { WebApp: { initData: "", initDataUnsafe: {} } },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(ReferralAuthorizationGate, {
      global: { stubs: { CustomerModalShell: shellStub } },
    });
    await flushPromises();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(wrapper.find(".modal-shell").exists()).toBe(true);
    expect(wrapper.text()).toContain("Откройте приложение через Telegram");
    expect(wrapper.emitted("gate-active")?.at(-1)).toEqual([true]);
    wrapper.unmount();
  });

  it("allows the explicit local dev Telegram mock without signed initData", async () => {
    sessionStorage.setItem(
      "navalivay_dev_telegram_mock",
      JSON.stringify({ id: "990000039", username: "dev_mock_user", first_name: "Dev" }),
    );
    Object.defineProperty(window, "Telegram", {
      configurable: true,
      value: {
        WebApp: {
          initData: "",
          initDataUnsafe: {
            user: { id: 990000039, username: "dev_mock_user", first_name: "Dev" },
          },
        },
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(response({
      enabled: false,
      required: false,
      blocked: false,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(ReferralAuthorizationGate, {
      global: { stubs: { CustomerModalShell: shellStub } },
    });
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/referral-authorization/status",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(wrapper.find(".modal-shell").exists()).toBe(false);
    sessionStorage.removeItem("navalivay_dev_telegram_mock");
    wrapper.unmount();
  });

  it("asks Telegram users without a username to set one in Telegram settings", async () => {
    Object.defineProperty(window, "Telegram", {
      configurable: true,
      value: {
        WebApp: {
          initData: "signed-init-data",
          initDataUnsafe: {
            user: { id: 990000031, first_name: "No Username" },
          },
        },
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(response({
      ok: true,
      status: "missing",
      hasUsername: false,
      username: null,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(ReferralAuthorizationGate, {
      global: { stubs: { CustomerModalShell: shellStub } },
    });
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/telegram\/username-status\?check=/),
      expect.objectContaining({ credentials: "include", cache: "no-store" }),
    );
    expect(wrapper.find(".modal-shell").exists()).toBe(true);
    expect(wrapper.text()).toContain("Установите имя пользователя @username в настройках Telegram");
    expect(wrapper.emitted("gate-active")?.at(-1)).toEqual([true]);
    wrapper.unmount();
  });

  it("rechecks a username after returning to the open Mini App and gives immediate feedback", async () => {
    Object.defineProperty(window, "Telegram", {
      configurable: true,
      value: {
        WebApp: {
          initData: "signed-init-data",
          initDataUnsafe: {
            user: { id: 990000032, first_name: "Fresh Username" },
          },
          HapticFeedback: { impactOccurred: vi.fn() },
        },
      },
    });
    let resolveRetry!: (value: Response) => void;
    const retryResponse = new Promise<Response>((resolve) => {
      resolveRetry = resolve;
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ status: "missing", hasUsername: false }))
      .mockReturnValueOnce(retryResponse)
      .mockResolvedValueOnce(response({
        enabled: true,
        required: true,
        attempts_remaining: 3,
      }));
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(ReferralAuthorizationGate, {
      global: { stubs: { CustomerModalShell: shellStub } },
    });
    await flushPromises();
    expect(wrapper.text()).toContain("Установите имя пользователя");

    await wrapper.find("button").trigger("click");
    expect(window.Telegram?.WebApp.HapticFeedback.impactOccurred).toHaveBeenCalledWith("light");
    expect(wrapper.text()).toContain("Проверяем ваш доступ");
    expect(wrapper.text()).not.toContain("Повторить");

    resolveRetry(response({ status: "confirmed", hasUsername: true, username: "fresh_username" }));
    await flushPromises();

    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/referral-authorization/status",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(wrapper.text()).toContain("Кто порекомендовал нас?");
    wrapper.unmount();
  });

  it("keeps polling while Telegram still returns the old missing username", async () => {
    vi.useFakeTimers();
    Object.defineProperty(window, "Telegram", {
      configurable: true,
      value: {
        WebApp: {
          initData: "signed-init-data",
          initDataUnsafe: {
            user: { id: 990000034, first_name: "Delayed Username" },
          },
          HapticFeedback: { impactOccurred: vi.fn() },
        },
      },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ status: "missing", hasUsername: false }))
      .mockResolvedValueOnce(response({ status: "missing", hasUsername: false }))
      .mockResolvedValueOnce(response({ status: "confirmed", hasUsername: true, username: "delayed_username" }))
      .mockResolvedValueOnce(response({ enabled: true, required: true, attempts_remaining: 3 }));
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(ReferralAuthorizationGate, {
      global: { stubs: { CustomerModalShell: shellStub } },
    });
    await flushPromises();

    await wrapper.find("button").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("Проверяем ваш доступ");

    await vi.advanceTimersByTimeAsync(1500);
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(wrapper.text()).toContain("Кто порекомендовал нас?");
    wrapper.unmount();
  });

  it("caps a slow Telegram retry and keeps the close fallback available", async () => {
    vi.useFakeTimers();
    const close = vi.fn();
    Object.defineProperty(window, "Telegram", {
      configurable: true,
      value: {
        WebApp: {
          initData: "signed-init-data",
          initDataUnsafe: {
            user: { id: 990000037, first_name: "Slow Telegram" },
          },
          HapticFeedback: { impactOccurred: vi.fn() },
          close,
        },
      },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ status: "missing", hasUsername: false }))
      .mockImplementationOnce((_url: string, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }));
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(ReferralAuthorizationGate, {
      global: { stubs: { CustomerModalShell: shellStub } },
    });
    await flushPromises();
    await wrapper.find("button").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Проверяем ваш доступ");
    expect(wrapper.text()).toContain("Закрыть магазин");

    await vi.advanceTimersByTimeAsync(16000);
    await flushPromises();

    expect(wrapper.text()).toContain("Telegram отвечает дольше обычного");
    expect(wrapper.text()).toContain("Повторить");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it("ignores a late result from a superseded retry", async () => {
    Object.defineProperty(window, "Telegram", {
      configurable: true,
      value: {
        WebApp: {
          initData: "signed-init-data",
          initDataUnsafe: {
            user: { id: 990000038, first_name: "Overlapping Retry" },
          },
          HapticFeedback: { impactOccurred: vi.fn() },
        },
      },
    });
    let resolveOldRetry!: (value: Response) => void;
    const oldRetry = new Promise<Response>((resolve) => {
      resolveOldRetry = resolve;
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ status: "missing", hasUsername: false }))
      .mockReturnValueOnce(oldRetry)
      .mockResolvedValueOnce(response({ status: "confirmed", hasUsername: true, username: "overlap_username" }))
      .mockResolvedValueOnce(response({ enabled: true, required: true, attempts_remaining: 3 }));
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(ReferralAuthorizationGate, {
      global: { stubs: { CustomerModalShell: shellStub } },
    });
    await flushPromises();
    await wrapper.find("button").trigger("click");
    await flushPromises();

    window.dispatchEvent(new Event("referral-authorization-required"));
    await flushPromises();
    expect(wrapper.text()).toContain("Кто порекомендовал нас?");

    resolveOldRetry(response({ status: "missing", hasUsername: false }));
    await flushPromises();
    expect(wrapper.text()).toContain("Кто порекомендовал нас?");
    expect(wrapper.text()).not.toContain("Установите имя пользователя");
    wrapper.unmount();
  });

  it("returns focus to the inviter field when the required gate is restored", async () => {
    let activatedHandler: (() => void) | undefined;
    const onEvent = vi.fn((eventType: string, handler: () => void) => {
      if (eventType === "activated") activatedHandler = handler;
    });
    Object.defineProperty(window, "Telegram", {
      configurable: true,
      value: {
        WebApp: {
          initData: "signed-init-data",
          initDataUnsafe: {
            user: { id: 990000036, username: "focus_user", first_name: "Focus" },
          },
          onEvent,
          offEvent: vi.fn(),
        },
      },
    });
    const requestAnimationFrameSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      enabled: true,
      required: true,
      attempts_remaining: 3,
    })));

    const outsideButton = document.createElement("button");
    document.body.appendChild(outsideButton);
    const wrapper = mount(ReferralAuthorizationGate, {
      attachTo: document.body,
      global: { stubs: { CustomerModalShell: shellStub } },
    });
    await flushPromises();
    outsideButton.focus();
    expect(document.activeElement).toBe(outsideButton);

    activatedHandler?.();

    expect(document.activeElement).toBe(wrapper.find("input").element);
    wrapper.unmount();
    outsideButton.remove();
    requestAnimationFrameSpy.mockRestore();
  });

  it("automatically rechecks when the Mini App returns from a minimized state", async () => {
    let activatedHandler: (() => void) | undefined;
    const onEvent = vi.fn((eventType: string, handler: () => void) => {
      if (eventType === "activated") activatedHandler = handler;
    });
    const offEvent = vi.fn();
    Object.defineProperty(window, "Telegram", {
      configurable: true,
      value: {
        WebApp: {
          initData: "signed-init-data",
          initDataUnsafe: {
            user: { id: 990000035, first_name: "Activated Username" },
          },
          onEvent,
          offEvent,
        },
      },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ status: "missing", hasUsername: false }))
      .mockResolvedValueOnce(response({ status: "confirmed", hasUsername: true, username: "activated_username" }))
      .mockResolvedValueOnce(response({ enabled: true, required: true, attempts_remaining: 3 }));
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(ReferralAuthorizationGate, {
      global: { stubs: { CustomerModalShell: shellStub } },
    });
    await flushPromises();
    expect(activatedHandler).toBeTypeOf("function");

    activatedHandler?.();
    await flushPromises();

    expect(wrapper.text()).toContain("Кто порекомендовал нас?");
    wrapper.unmount();
    expect(offEvent).toHaveBeenCalledWith("activated", activatedHandler);
  });

  it("can close the Mini App as a fallback without bypassing authorization", async () => {
    const close = vi.fn();
    Object.defineProperty(window, "Telegram", {
      configurable: true,
      value: {
        WebApp: {
          initData: "signed-init-data",
          initDataUnsafe: {
            user: { id: 990000036, first_name: "Close Fallback" },
          },
          close,
        },
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ status: "missing", hasUsername: false })));

    const wrapper = mount(ReferralAuthorizationGate, {
      global: { stubs: { CustomerModalShell: shellStub } },
    });
    await flushPromises();

    const closeButton = wrapper.findAll("button").find((button) => button.text() === "Закрыть магазин");
    expect(closeButton).toBeDefined();
    await closeButton?.trigger("click");
    expect(close).toHaveBeenCalledOnce();
    expect(wrapper.find(".modal-shell").exists()).toBe(true);
    wrapper.unmount();
  });

  it("does not blame a missing username when Telegram live verification is temporarily unavailable", async () => {
    Object.defineProperty(window, "Telegram", {
      configurable: true,
      value: {
        WebApp: {
          initData: "signed-init-data",
          initDataUnsafe: {
            user: { id: 990000033, first_name: "Retry Later" },
          },
        },
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      status: "retry",
      hasUsername: false,
      message: "Telegram временно не ответил. Попробуйте ещё раз.",
    })));

    const wrapper = mount(ReferralAuthorizationGate, {
      global: { stubs: { CustomerModalShell: shellStub } },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("Telegram временно не ответил");
    expect(wrapper.text()).not.toContain("Установите имя пользователя");
    wrapper.unmount();
  });

  it("switches an authorization ban to the common block screen", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      enabled: true,
      required: false,
      blocked: true,
      attempts_remaining: 0,
    })));

    const wrapper = mount(ReferralAuthorizationGate, {
      global: { stubs: { CustomerModalShell: shellStub } },
    });
    await flushPromises();

    expect(blockMocks.applyBlockFromResponse).toHaveBeenCalledWith({
      reason: "Авторизация не пройдена",
      block_until: null,
    });
    expect(wrapper.find(".modal-shell").exists()).toBe(false);
    wrapper.unmount();
  });

  it("keeps the mandatory window open and shows the remaining attempts", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response({ enabled: true, required: true, attempts_remaining: 3 }))
      .mockResolvedValueOnce(response({
        error: "referral_inviter_not_eligible",
        message: "Пользователь не найден или ещё не забирал заказ",
        attempts_remaining: 2,
      }, false, 422)));

    const wrapper = mount(ReferralAuthorizationGate, {
      global: { stubs: { CustomerModalShell: shellStub } },
    });
    await flushPromises();
    await wrapper.find("input").setValue("missing_user");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(wrapper.find(".modal-shell").exists()).toBe(true);
    expect(wrapper.text()).toContain("Осталось попыток: 2");
    expect(wrapper.text()).toContain("Пользователь не найден");
    wrapper.unmount();
  });
});
