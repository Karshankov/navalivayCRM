import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ReviewForm from "@/components/reviews/ReviewForm.vue";
import ReviewLineCard from "@/components/reviews/ReviewLineCard.vue";
import type { ReviewableLine } from "@/composables/useCustomerOrders";

const fetchQuickTagsMock = vi.hoisted(() => vi.fn());
const submitReviewMock = vi.hoisted(() => vi.fn());

vi.mock("@/composables/useCustomerOrders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/composables/useCustomerOrders")>();
  return {
    ...actual,
    useCustomerOrders: () => ({
      fetchQuickTags: fetchQuickTagsMock,
      submitReview: submitReviewMock,
    }),
  };
});

function buildLine(overrides: Partial<ReviewableLine> = {}): ReviewableLine {
  return {
    group_id: "grp1",
    group_name: "Подонки",
    group_cover_image: null,
    category_cover_image: null,
    purchased_variant_name: "Ананасовая шипучка",
    order_item_id: "oi1",
    review_category_key: "liquids",
    items: [{ total_price: 25 }],
    eligibility: { canReview: true, reason: null, cooldownEndsAt: null },
    latest_review: null,
    ...overrides,
  };
}

describe("ReviewLineCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchQuickTagsMock.mockResolvedValue([
      { id: "tag1", label: "Вкусно", insert_text: "Вкусно" },
    ]);
    submitReviewMock.mockResolvedValue({
      ok: true,
      review: {
        id: "rev1",
        status: "pending",
        rating: 5,
        body_text: "Достаточно длинный текст отзыва",
        is_anonymous: 0,
        created_at: "2026-06-21T20:16:00.000Z",
      },
    });
  });

  it("does not pass lottery hint into review form", async () => {
    const wrapper = mount(ReviewLineCard, {
      props: {
        line: buildLine(),
        orderId: "ord1",
        initialRating: 5,
      },
    });
    await flushPromises();

    const form = wrapper.findComponent(ReviewForm);
    expect(form.props()).not.toHaveProperty("lotteryHint");
    expect(wrapper.find(".review-form__disclosure").exists()).toBe(false);

    wrapper.unmount();
  });

  it("shows device variant line total from stored order_items", () => {
    const wrapper = mount(ReviewLineCard, {
      props: {
        line: buildLine({
          group_id: "grp_xros",
          group_name: "XROS 5 MINI",
          purchased_variant_name: "Rose red",
          items: [{ total_price: 75 }],
          eligibility: {
            canReview: false,
            reason: "pending_moderation",
            cooldownEndsAt: null,
          },
        }),
        orderId: "ord_device",
      },
    });

    expect(wrapper.text()).toContain("75 BYN");
    expect(wrapper.text()).toContain("Rose red");

    wrapper.unmount();
  });

  it("shows 0 BYN when legacy order_items stored zero device price", () => {
    const wrapper = mount(ReviewLineCard, {
      props: {
        line: buildLine({
          group_id: "grp_xros",
          group_name: "XROS 5 MINI",
          purchased_variant_name: "Rose red",
          items: [{ total_price: 0 }],
          eligibility: {
            canReview: false,
            reason: "pending_moderation",
            cooldownEndsAt: null,
          },
        }),
        orderId: "ord_device_bad",
      },
    });

    expect(wrapper.text()).toContain("0 BYN");

    wrapper.unmount();
  });

  it("sums multiple items in the same review group", () => {
    const wrapper = mount(ReviewLineCard, {
      props: {
        line: buildLine({
          items: [{ total_price: 10 }, { total_price: 20 }],
        }),
        orderId: "ord_multi",
      },
    });

    expect(wrapper.text()).toContain("30 BYN");

    wrapper.unmount();
  });

  it("renders review form when line is eligible", async () => {
    const wrapper = mount(ReviewLineCard, {
      props: {
        line: buildLine(),
        orderId: "ord1",
        initialRating: 3,
      },
    });
    await flushPromises();

    expect(wrapper.find(".review-form").exists()).toBe(true);
    expect(wrapper.text()).toContain("Подонки");
    expect(wrapper.text()).toContain("Ананасовая шипучка");
    expect(fetchQuickTagsMock).toHaveBeenCalledWith("liquids", 3);

    wrapper.unmount();
  });

  it("shows cooldown state instead of form", () => {
    const wrapper = mount(ReviewLineCard, {
      props: {
        line: buildLine({
          eligibility: {
            canReview: false,
            reason: "cooldown",
            cooldownEndsAt: "2026-07-01T12:00:00.000Z",
          },
        }),
        orderId: "ord1",
      },
    });

    expect(wrapper.find(".review-form").exists()).toBe(false);
    expect(wrapper.text()).toContain("Отзыв на эту линейку уже оставлен");
    expect(wrapper.text()).toContain("Новый отзыв");

    wrapper.unmount();
  });

  it("shows cooldown explanation on repeat LAST HAP purchase within admin cooldown", () => {
    const wrapper = mount(ReviewLineCard, {
      props: {
        line: buildLine({
          group_id: "grp_last_hap",
          group_name: "PODONKI LAST HAP",
          purchased_variant_name: "50 мг",
          eligibility: {
            canReview: false,
            reason: "cooldown",
            cooldownEndsAt: "2026-07-11T09:00:00.000Z",
          },
          latest_review: null,
        }),
        orderId: "ord_repeat",
      },
    });

    expect(wrapper.text()).toContain("PODONKI LAST HAP");
    expect(wrapper.text()).toContain("Отзыв на эту линейку уже оставлен");
    expect(wrapper.text()).toContain("Новый отзыв на «PODONKI LAST HAP» можно оставить");
    expect(wrapper.text()).toContain("розыгрыше подарков");
    expect(wrapper.find(".review-form").exists()).toBe(false);

    wrapper.unmount();
  });

  it("blocks repeat purchase form while moderation is pending on the line", () => {
    const wrapper = mount(ReviewLineCard, {
      props: {
        line: buildLine({
          group_id: "grp_last_hap",
          group_name: "PODONKI LAST HAP",
          eligibility: {
            canReview: false,
            reason: "pending_moderation",
            cooldownEndsAt: null,
          },
          latest_review: null,
        }),
        orderId: "ord_repeat",
      },
    });

    expect(wrapper.find(".review-form").exists()).toBe(false);
    expect(wrapper.text()).toContain("Отзыв отправлен");

    wrapper.unmount();
  });

  it("shows pending moderation state with rating stars", () => {
    const wrapper = mount(ReviewLineCard, {
      props: {
        line: buildLine({
          eligibility: {
            canReview: false,
            reason: "pending_moderation",
            cooldownEndsAt: null,
          },
          latest_review: {
            id: "rev1",
            status: "pending",
            rating: 4,
            body_text: "Хороший товар",
            is_anonymous: 0,
            created_at: "2026-06-01T10:00:00.000Z",
          },
        }),
        orderId: "ord1",
      },
    });

    expect(wrapper.text()).toContain("Отзыв отправлен");
    expect(wrapper.findAll(".review-line-card__rating-star")).toHaveLength(5);

    wrapper.unmount();
  });

  it("submits review and emits submitted on success", async () => {
    const wrapper = mount(ReviewLineCard, {
      props: {
        line: buildLine(),
        orderId: "ord1",
        initialRating: 5,
        preferAnonymous: true,
      },
    });
    await flushPromises();

    const form = wrapper.findComponent(ReviewForm);
    await form.vm.$emit("submit", {
      rating: 5,
      body_text: "Достаточно длинный текст отзыва",
      quick_tag_ids: ["tag1"],
      is_anonymous: true,
    });
    await flushPromises();

    expect(submitReviewMock).toHaveBeenCalledWith({
      order_id: "ord1",
      group_id: "grp1",
      order_item_id: "oi1",
      rating: 5,
      body_text: "Достаточно длинный текст отзыва",
      quick_tag_ids: ["tag1"],
      is_anonymous: true,
    });
    expect(wrapper.emitted("submitted")).toHaveLength(1);

    wrapper.unmount();
  });

  it("shows pending success state immediately after submit", async () => {
    const wrapper = mount(ReviewLineCard, {
      props: {
        line: buildLine(),
        orderId: "ord1",
        initialRating: 5,
      },
    });
    await flushPromises();

    const form = wrapper.findComponent(ReviewForm);
    await form.vm.$emit("submit", {
      rating: 5,
      body_text: "Достаточно длинный текст отзыва",
      quick_tag_ids: [],
      is_anonymous: false,
    });
    await flushPromises();

    expect(wrapper.find(".review-form").exists()).toBe(false);
    expect(wrapper.text()).toContain("Отзыв отправлен");
    expect(wrapper.text()).toContain("розыгрыше подарков");

    wrapper.unmount();
  });

  it("shows thank-you state for approved review", () => {
    const wrapper = mount(ReviewLineCard, {
      props: {
        line: buildLine({
          eligibility: {
            canReview: false,
            reason: null,
            cooldownEndsAt: null,
          },
          latest_review: {
            id: "rev1",
            status: "approved",
            rating: 5,
            body_text: "Отлично",
            is_anonymous: 0,
            created_at: "2026-06-01T10:00:00.000Z",
          },
        }),
        orderId: "ord1",
      },
    });

    expect(wrapper.text()).toContain("Спасибо за отзыв");
    expect(wrapper.find(".review-form").exists()).toBe(false);

    wrapper.unmount();
  });

  it("shows unavailable copy when review cannot be left", () => {
    const wrapper = mount(ReviewLineCard, {
      props: {
        line: buildLine({
          eligibility: {
            canReview: false,
            reason: "not_purchased",
            cooldownEndsAt: null,
          },
        }),
        orderId: "ord1",
      },
    });

    expect(wrapper.text()).toContain("купленные товары");

    wrapper.unmount();
  });

  it("surfaces submit errors without emitting submitted", async () => {
    submitReviewMock.mockRejectedValueOnce(new Error("Отзыв уже на модерации"));

    const wrapper = mount(ReviewLineCard, {
      props: {
        line: buildLine(),
        orderId: "ord1",
        initialRating: 5,
      },
    });
    await flushPromises();

    const form = wrapper.findComponent(ReviewForm);
    await form.vm.$emit("submit", {
      rating: 5,
      body_text: "Достаточно длинный текст отзыва",
      quick_tag_ids: [],
      is_anonymous: false,
    });
    await flushPromises();

    expect(wrapper.text()).toContain("Отзыв уже на модерации");
    expect(wrapper.emitted("submitted")).toBeUndefined();

    wrapper.unmount();
  });

  it("applies highlight class and anchor id for deep-link scroll", () => {
    const wrapper = mount(ReviewLineCard, {
      props: {
        line: buildLine(),
        orderId: "ord1",
        highlighted: true,
      },
    });

    expect(wrapper.attributes("id")).toBe("review-line-grp1");
    expect(wrapper.classes()).toContain("review-line-card--highlight");

    wrapper.unmount();
  });
});