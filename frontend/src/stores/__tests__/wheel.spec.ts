import { createPinia, setActivePinia } from "pinia";
import { useWheelStore } from "@/stores/wheel";

let wholesaleHeaders: Record<string, string> = {};

vi.mock("@/stores/wholesale", () => ({
  useWholesaleStore: () => ({
    buildHeaders: () => wholesaleHeaders,
  }),
}));

function createJsonResponse(data: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    headers: {
      get: () => "application/json",
    },
    json: async () => data,
  };
}

function buildWheelState(overrides: Record<string, unknown> = {}) {
  return {
    customer_id: "cust-wheel",
    is_wholesale: false,
    balance: {
      spins_available: 1,
      accumulated_byn: 0,
      threshold_byn: 40,
      progress_percent: 0,
      consecutive_nothing: 0,
    },
    prizes: [],
    rarities: [],
    feed: [],
    my_active_prizes: [],
    feed_consent: false,
    feed_consent_required: false,
    access: {
      is_allowed: true,
      is_limited: false,
    },
    settings: {
      pity_threshold: 3,
      spin_byn_retail: 40,
      spin_byn_wholesale: 200,
      elite_rarities: [],
    },
    ...overrides,
  };
}

describe("wheel store adversarial regressions", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
    wholesaleHeaders = {};
    vi.stubGlobal("crypto", {
      randomUUID: () => "11111111-2222-4333-8444-555555555555",
    });
  });

  it("hydrates rollout lock state without exposing wheel data", async () => {
    const fetchMock = vi.fn(async () =>
      createJsonResponse(
        buildWheelState({
          balance: {
            spins_available: 0,
            accumulated_byn: 0,
            threshold_byn: 40,
            progress_percent: 0,
            consecutive_nothing: 0,
          },
          access: {
            is_allowed: false,
            is_limited: true,
          },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const store = useWheelStore();
    await store.fetchState();

    expect(store.accessAllowed).toBe(false);
    expect(store.accessLimited).toBe(true);
    expect(store.balance.spins_available).toBe(0);
  });

  it("uses cached state until forced and refetches after a spin", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse(buildWheelState()))
      .mockResolvedValueOnce(
        createJsonResponse({
          spin_id: "spin-1",
          prize: {
            id: "prize-1",
            title: "Prize",
            description: null,
            image_url: null,
            rarity_code: "common",
          },
          is_epic_release: false,
          is_pity_release: false,
          promo_code: "CODE",
          promo_valid_until: null,
          animation_seed: 123,
          spins_left: 0,
          accumulated_byn: 0,
        }),
      )
      .mockResolvedValueOnce(createJsonResponse(buildWheelState({ customer_id: "cust-wheel-fresh" })));
    vi.stubGlobal("fetch", fetchMock);

    const store = useWheelStore();
    await store.fetchState();
    await store.fetchState();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await store.spin();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({
      "Idempotency-Key": "wheel_11111111-2222-4333-8444-555555555555",
    });

    await store.fetchState();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(store.customerId).toBe("cust-wheel-fresh");
  });

  it("surfaces wheel_locked errors from customer actions", async () => {
    const fetchMock = vi.fn(async () =>
      createJsonResponse(
        {
          error: "wheel_locked",
          message: "Рулетка пока доступна только участникам тестирования",
        },
        false,
        403,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const store = useWheelStore();
    await expect(store.spin()).rejects.toMatchObject({ code: "wheel_locked" });
    expect(store.spinError).toBe("Рулетка пока доступна только участникам тестирования");
    expect(store.isSpinning).toBe(false);
  });

  it("keeps my-prizes cache separately for each status filter", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse({
          prizes: [{ spin_id: "active-spin", prize_title: "Active" }],
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          prizes: [{ spin_id: "used-spin", prize_title: "Used" }],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const store = useWheelStore();
    await store.fetchMyPrizes("active");
    expect(store.myAllPrizes.map((item) => item.spin_id)).toEqual(["active-spin"]);

    await store.fetchMyPrizes("used");
    expect(store.myAllPrizes.map((item) => item.spin_id)).toEqual(["used-spin"]);

    await store.fetchMyPrizes("active");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(store.myAllPrizes.map((item) => item.spin_id)).toEqual(["active-spin"]);
  });

  it("uses a fresh idempotency key for each separate spin and applies backend balance", async () => {
    let uuidCounter = 0;
    vi.stubGlobal("crypto", {
      randomUUID: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, "0")}`,
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse({
          spin_id: "spin-1",
          prize: {
            id: "prize-1",
            title: "Prize 1",
            description: null,
            image_url: null,
            rarity_code: "common",
          },
          is_epic_release: false,
          is_pity_release: false,
          promo_code: null,
          promo_valid_until: null,
          animation_seed: 111,
          spins_left: 1,
          accumulated_byn: 20,
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          spin_id: "spin-2",
          prize: {
            id: "prize-2",
            title: "Prize 2",
            description: null,
            image_url: null,
            rarity_code: "valuable",
          },
          is_epic_release: false,
          is_pity_release: false,
          promo_code: null,
          promo_valid_until: null,
          animation_seed: 222,
          spins_left: 0,
          accumulated_byn: 5,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const store = useWheelStore();
    await store.spin();
    await store.spin();

    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      "Idempotency-Key": "wheel_00000000-0000-4000-8000-000000000001",
    });
    expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({
      "Idempotency-Key": "wheel_00000000-0000-4000-8000-000000000002",
    });
    expect(store.balance.spins_available).toBe(0);
    expect(store.balance.accumulated_byn).toBe(5);
    expect(store.lastResult?.spin_id).toBe("spin-2");
  });

  it("rejects concurrent spin calls before a second network request is sent", async () => {
    let resolveSpin!: (value: unknown) => void;
    const fetchMock = vi.fn(
      () => new Promise((resolve) => {
        resolveSpin = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const store = useWheelStore();
    const firstSpin = store.spin();
    await expect(store.spin()).rejects.toThrow("spin_in_progress");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveSpin(createJsonResponse({
      spin_id: "spin-1",
      prize: {
        id: "prize-1",
        title: "Prize",
        description: null,
        image_url: null,
        rarity_code: "common",
      },
      is_epic_release: false,
      is_pity_release: false,
      promo_code: null,
      promo_valid_until: null,
      animation_seed: 123,
      spins_left: 0,
      accumulated_byn: 0,
    }));
    await firstSpin;
    expect(store.isSpinning).toBe(false);
  });
});
