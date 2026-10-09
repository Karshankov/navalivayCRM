import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildFulfillmentTimelineLines,
  buildOrderSummaryFromLines,
  formatOrderCardTitle,
  formatOrderDateTime,
  formatOrderDetailTitle,
  formatOrderHistoryMeta,
  formatOrderHistoryTitle,
  formatOrderStatus,
  parseOrderDateTime,
  useCustomerOrders,
} from "@/composables/useCustomerOrders";

function createJsonResponse(data: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => data,
  };
}

describe("useCustomerOrders", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (window as any).Telegram = {
      WebApp: {
        initData: "signed_init_data",
      },
    };
  });

  it("fetchReviewPrompt stores prompt and preferences from API", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/reviews/prompt") {
        return createJsonResponse({
          show: false,
          reason: "opt_out",
          preferences: {
            reviews_opt_out: true,
            reviews_prefer_anonymous: true,
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fetchReviewPrompt, reviewPrompt, reviewPreferences } = useCustomerOrders();
    const result = await fetchReviewPrompt();

    expect(result.reason).toBe("opt_out");
    expect(reviewPrompt.value?.reason).toBe("opt_out");
    expect(reviewPreferences.value.reviews_opt_out).toBe(true);
    expect(reviewPreferences.value.reviews_prefer_anonymous).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/reviews/prompt",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Telegram-Init-Data": "signed_init_data",
        }),
      }),
    );
  });

  it("fetchOrderHistory returns paginated cards", async () => {
    const fetchMock = vi.fn(async () =>
      createJsonResponse({
        items: [
          {
            id: "ord1",
            order_number: 1001,
            status: "delivered",
            created_at: "2026-06-01T10:00:00.000Z",
            completed_at: "2026-06-01T12:00:00.000Z",
            final_amount: 42,
            category_icons: [],
            category_icons_overflow: 0,
          },
        ],
        next_cursor: "2026-06-01T10:00:00.000Z",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { fetchOrderHistory } = useCustomerOrders();
    const data = await fetchOrderHistory({ limit: 20 });

    expect(data.items).toHaveLength(1);
    expect(data.items[0].order_number).toBe(1001);
    expect(data.next_cursor).toBe("2026-06-01T10:00:00.000Z");
  });

  it("submitReview posts payload with telegram auth headers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse({
          ok: true,
          review: {
            id: "rev1",
            status: "pending",
            rating: 5,
            body_text: "Отличный товар, всем рекомендую",
            is_anonymous: 1,
            created_at: "2026-06-01T12:00:00.000Z",
          },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          show: false,
          reason: "nothing_to_review",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { submitReview } = useCustomerOrders();
    const result = await submitReview({
      order_id: "ord1",
      group_id: "grp1",
      order_item_id: "oi1",
      rating: 5,
      body_text: "Отличный товар, всем рекомендую",
      quick_tag_ids: [],
      is_anonymous: true,
    });

    expect(result.review.status).toBe("pending");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/reviews",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-Telegram-Init-Data": "signed_init_data",
        }),
        body: JSON.stringify({
          order_id: "ord1",
          group_id: "grp1",
          order_item_id: "oi1",
          rating: 5,
          body_text: "Отличный товар, всем рекомендую",
          quick_tag_ids: [],
          is_anonymous: true,
        }),
      }),
    );
  });

  it("fetchOrderDetail returns reviewable lines", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/orders/ord1/detail") {
        return createJsonResponse({
          id: "ord1",
          order_number: 1001,
          status: "delivered",
          created_at: "2026-06-01T10:00:00.000Z",
          completed_at: "2026-06-01T12:00:00.000Z",
          final_amount: 42,

          lottery_hint_text: null,
          reviewable_lines: [
            {
              group_id: "grp1",
              group_name: "Подонки",
              eligibility: { canReview: true, reason: null, cooldownEndsAt: null },
            },
          ],
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fetchOrderDetail } = useCustomerOrders();
    const detail = await fetchOrderDetail("ord1");

    expect(detail.order_number).toBe(1001);
    expect(detail.reviewable_lines).toHaveLength(1);
  });

  it("fetchGroupReviews returns public approved items only shape", async () => {
    const fetchMock = vi.fn(async () =>
      createJsonResponse({
        group_id: "grp1",
        review_count: 1,
        average_rating: 5,
        manager: {
          display_name: "Manager Rezonsky",
          avatar_url: "/favicon.png",
        },
        items: [
          {
            id: "rev1",
            rating: 5,
            body_text: "Отличный вкус",
            purchased_variant_name: "Ананас",
            quick_tag_labels: ["Вкусно"],
            created_at: "2026-06-01T10:00:00.000Z",
            manager_reply: null,
            reviewer: {
              display_name: "Покупатель",
              photo_url: null,
              is_anonymous: false,
            },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { fetchGroupReviews } = useCustomerOrders();
    const data = await fetchGroupReviews("grp1", { limit: 10 });

    expect(data.review_count).toBe(1);
    expect(data.items[0].reviewer.display_name).toBe("Покупатель");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/groups/grp1/reviews?limit=10",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Telegram-Init-Data": "signed_init_data",
        }),
      }),
    );
  });

  it("deduplicates parallel fetchReviewPrompt calls", async () => {
    let resolvePrompt: (value: unknown) => void = () => undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          resolvePrompt = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { fetchReviewPrompt } = useCustomerOrders();
    const first = fetchReviewPrompt();
    const second = fetchReviewPrompt();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolvePrompt(
      createJsonResponse({
        show: false,
        reason: "nothing_to_review",
        preferences: {
          reviews_opt_out: false,
          reviews_prefer_anonymous: false,
        },
      }),
    );

    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
  });

  it("fetchQuickTags loads tags for category and rating", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/reviews/quick-tags")) {
        return createJsonResponse({
          items: [
            {
              id: "tag1",
              label: "Вкусно",
              insert_text: "Очень вкусно.",
              sort_order: 1,
            },
          ],
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fetchQuickTags } = useCustomerOrders();
    const tags = await fetchQuickTags("liquids", 5);

    expect(tags).toHaveLength(1);
    expect(tags[0].label).toBe("Вкусно");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/reviews/quick-tags?category_key=liquids&star_rating=5",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Telegram-Init-Data": "signed_init_data",
        }),
      }),
    );
  });

  it("fetchGroupReviewSummary requests only one public review", async () => {
    const fetchMock = vi.fn(async () =>
      createJsonResponse({
        group_id: "grp1",
        review_count: 12,
        average_rating: 4.8,
        items: [{ id: "rev1", rating: 5 }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { fetchGroupReviewSummary } = useCustomerOrders();
    const summary = await fetchGroupReviewSummary("grp1");

    expect(summary.review_count).toBe(12);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/groups/grp1/reviews?limit=1",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Telegram-Init-Data": "signed_init_data",
        }),
      }),
    );
  });

  it("updateReviewPreferences syncs local state", async () => {
    const fetchMock = vi.fn(async () =>
      createJsonResponse({
        ok: true,
        reviews_opt_out: true,
        reviews_prefer_anonymous: true,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { updateReviewPreferences, reviewPreferences } = useCustomerOrders();
    await updateReviewPreferences({
      reviews_opt_out: true,
      reviews_prefer_anonymous: true,
    });

    expect(reviewPreferences.value.reviews_opt_out).toBe(true);
    expect(reviewPreferences.value.reviews_prefer_anonymous).toBe(true);
  });
});

describe("order display labels", () => {
  it("formatOrderCardTitle uses category names without order numbers", () => {
    expect(formatOrderCardTitle([], 0)).toBe("Покупка");
    expect(
      formatOrderCardTitle([{ category_name: "Жидкости" }], 0),
    ).toBe("Жидкости");
    expect(
      formatOrderCardTitle(
        [{ category_name: "Жидкости" }, { category_name: "Расходники" }],
        0,
      ),
    ).toBe("Жидкости · Расходники");
    expect(
      formatOrderCardTitle(
        [
          { category_name: "Жидкости" },
          { category_name: "Расходники" },
          { category_name: "Устройства" },
        ],
        0,
      ),
    ).toBe("Жидкости и ещё 2");
    expect(
      formatOrderCardTitle([{ category_name: "Жидкости" }], 2),
    ).toBe("Жидкости и ещё 2");
  });

  it("formatOrderDetailTitle prefers purchase date", () => {
    expect(formatOrderDetailTitle(null, null)).toBe("Покупка");
    expect(
      formatOrderDetailTitle("2026-06-19T12:00:00.000Z", "2026-06-18T10:00:00.000Z"),
    ).toMatch(/19/);
  });

  it("formatOrderStatus uses pickup wording for issued orders", () => {
    expect(formatOrderStatus("delivered", "pickup")).toBe("Выдан");
    expect(formatOrderStatus("delivered", "delivery")).toBe("Доставлен");
    expect(formatOrderStatus("in_progress")).toBe("Собран");
  });

  it("formatOrderHistoryTitle shows order number in card headline", () => {
    expect(formatOrderHistoryTitle(1254)).toBe("Заказ № 1254");
  });

  it("formatOrderHistoryMeta shows status and issued time without order number", () => {
    const meta = formatOrderHistoryMeta({
      status: "delivered",
      delivery_type: "pickup",
      created_at: "2026-06-19T09:54:00.000Z",
      completed_at: "2026-06-19T10:04:00.000Z",
      fulfillment_milestones: {
        submitted_at: "2026-06-19T09:54:00.000Z",
        ready_at: "2026-06-19T09:56:00.000Z",
        issued_at: "2026-06-19T10:04:00.000Z",
        cancelled_at: null,
      },
    });

    expect(meta).not.toContain("№");
    expect(meta).toContain("Выдан");
  });

  it("buildFulfillmentTimelineLines exposes submitted, ready and issued steps", () => {
    const lines = buildFulfillmentTimelineLines(
      {
        submitted_at: "2026-06-19T09:54:00.000Z",
        ready_at: "2026-06-19T09:56:00.000Z",
        issued_at: "2026-06-19T10:04:00.000Z",
        cancelled_at: null,
      },
      "delivered",
      "pickup",
    );

    expect(lines.map((line) => line.label)).toEqual(["Оформлен", "Собран", "Выдан"]);
  });

  it("parseOrderDateTime treats SQLite timestamps as UTC", () => {
    const parsed = parseOrderDateTime("2026-06-22 17:09:44");
    expect(parsed.toISOString()).toBe("2026-06-22T17:09:44.000Z");
    expect(formatOrderDateTime("2026-06-22 17:09:44")).toContain("20:09");
  });

  it("buildFulfillmentTimelineLines keeps ready and issued within one minute for prod-like data", () => {
    const lines = buildFulfillmentTimelineLines(
      {
        submitted_at: "2026-06-22 17:08:55",
        ready_at: "2026-06-22 17:09:41",
        issued_at: "2026-06-22 17:09:44",
        cancelled_at: null,
      },
      "delivered",
      "pickup",
    );

    const ready = formatOrderDateTime(lines.find((line) => line.key === "ready")?.at);
    const issued = formatOrderDateTime(lines.find((line) => line.key === "issued")?.at);

    expect(ready).toContain("20:09");
    expect(issued).toContain("20:09");
  });

  it("buildOrderSummaryFromLines mirrors history card title and thumbs", () => {
    const summary = buildOrderSummaryFromLines([
      {
        group_id: "grp1",
        group_name: "Подонки",
        category_id: "cat1",
        category_name: "Жидкости",
        group_cover_image: "/a.jpg",
        category_cover_image: "/b.jpg",
      },
      {
        group_id: "grp2",
        group_name: "Другая",
        category_id: "cat2",
        category_name: "Расходники",
        group_cover_image: null,
        category_cover_image: "/c.jpg",
      },
      {
        group_id: "grp3",
        group_name: "Третья",
        category_id: "cat3",
        category_name: "Снюс",
        group_cover_image: null,
        category_cover_image: null,
      },
      {
        group_id: "grp4",
        group_name: "Четвёртая",
        category_id: "cat4",
        category_name: "Устройства",
        group_cover_image: null,
        category_cover_image: null,
      },
      {
        group_id: "grp5",
        group_name: "Пятая",
        category_id: "cat5",
        category_name: "Аксессуары",
        group_cover_image: null,
        category_cover_image: null,
      },
    ]);

    expect(summary.title).toBe("Жидкости и ещё 4");
    expect(summary.thumbs).toHaveLength(4);
    expect(summary.overflow).toBe(1);
    expect(summary.thumbs[0]?.image).toBe("/a.jpg");
  });
});
