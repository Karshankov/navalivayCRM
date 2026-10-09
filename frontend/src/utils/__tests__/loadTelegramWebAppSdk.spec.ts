import { afterEach, describe, expect, it } from "vitest";
import { shouldLoadTelegramWebAppSdk } from "@/utils/loadTelegramWebAppSdk";

describe("shouldLoadTelegramWebAppSdk", () => {
  afterEach(() => {
    delete (window as { Telegram?: unknown }).Telegram;
  });

  it("skips admin and plain browser", () => {
    window.history.replaceState({}, "", "/admin");
    expect(shouldLoadTelegramWebAppSdk()).toBe(false);

    window.history.replaceState({}, "", "/");
    expect(shouldLoadTelegramWebAppSdk()).toBe(false);
  });

  it("loads when tgWebAppData is in hash", () => {
    window.history.replaceState({}, "", "/#tgWebAppData=abc");
    expect(shouldLoadTelegramWebAppSdk()).toBe(true);
  });

  it("skips when Telegram WebApp already injected", () => {
    window.history.replaceState({}, "", "/#tgWebAppData=abc");
    (window as { Telegram?: { WebApp: object } }).Telegram = { WebApp: {} };
    expect(shouldLoadTelegramWebAppSdk()).toBe(false);
  });
});
