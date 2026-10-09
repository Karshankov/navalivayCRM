import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useUserStore } from "@/stores/user";

function createJsonResponse(data: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => data,
  };
}

describe("useUserStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();

    (window as any).Telegram = {
      WebApp: {
        initData: "signed_init_data",
        initDataUnsafe: {
          user: {
            id: 42,
            username: "buyer42",
            first_name: "Иван",
            last_name: "Петров",
          },
        },
      },
    };
  });

  it("fetchProfile loads customer data from API", async () => {
    const fetchMock = vi.fn(async () =>
      createJsonResponse({
        id: "cust-42",
        telegram_id: "42",
        telegram_username: "buyer42",
        first_name: "Иван",
        last_name: "Петров",
        photo_url: "/photo.jpg",
        total_orders: 3,
        total_spent: 120,
        member_since: "2026-01-01T10:00:00.000Z",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const store = useUserStore();
    await store.fetchProfile("42");

    expect(store.profile?.id).toBe("cust-42");
    expect(store.displayName).toBe("Иван Петров");
    expect(store.profile?.totalOrders).toBe(3);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/customer/me?telegram_id=42",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Telegram-Init-Data": "signed_init_data",
        }),
      }),
    );
  });

  it("uses WebApp photo_url when API returns no cached photo", async () => {
    (window as any).Telegram.WebApp.initDataUnsafe.user.photo_url =
      "https://t.me/i/userpic/320/fallback.jpg";

    const fetchMock = vi.fn(async () =>
      createJsonResponse({
        id: "cust-42",
        telegram_id: "42",
        telegram_username: "buyer42",
        first_name: "Иван",
        last_name: "Петров",
        photo_url: null,
        total_orders: 0,
        total_spent: 0,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const store = useUserStore();
    await store.fetchProfile("42");

    expect(store.photoUrl).toBe("https://t.me/i/userpic/320/fallback.jpg");
  });

  it("falls back to Telegram initDataUnsafe when API fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createJsonResponse({}, false)),
    );

    const store = useUserStore();
    await store.fetchProfile("42");

    expect(store.error).toBeTruthy();
    expect(store.profile?.telegramId).toBe("42");
    expect(store.profile?.firstName).toBe("Иван");
    expect(store.hasUsername).toBe(true);
  });

  it("uses local Telegram user when telegram id is missing", async () => {
    (window as any).Telegram = {
      WebApp: {
        initData: "signed_init_data",
        initDataUnsafe: {
          user: {
            username: "buyer42",
            first_name: "Иван",
            last_name: "Петров",
          },
        },
      },
    };

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const store = useUserStore();
    await store.fetchProfile();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.profile?.firstName).toBe("Иван");
    expect(store.profile?.telegramUsername).toBe("buyer42");
  });
});