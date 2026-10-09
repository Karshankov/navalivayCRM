import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ReviewRatingLink from "@/components/reviews/ReviewRatingLink.vue";

describe("ReviewRatingLink", () => {
  it("renders rating and separate view-reviews action", () => {
    const wrapper = mount(ReviewRatingLink, {
      props: { count: 12, averageRating: 4.83 },
    });

    expect(wrapper.text()).toContain("4.8");
    expect(wrapper.text()).toContain("(12)");
    expect(wrapper.text()).toContain("посмотреть отзывы");
  });

  it("shows empty state when there are no reviews on leaf lines", () => {
    const wrapper = mount(ReviewRatingLink, {
      props: { count: 0, averageRating: null, mode: "leaf" },
    });

    expect(wrapper.text()).toContain("нет отзывов");
    expect(wrapper.find(".review-rating-row__action").exists()).toBe(false);
  });

  it("shows neutral parent hint when parent row has no direct reviews", () => {
    const wrapper = mount(ReviewRatingLink, {
      props: { count: 0, averageRating: null, mode: "parent" },
    });

    expect(wrapper.text()).toContain("отзывы у линеек ниже");
    expect(wrapper.text()).not.toContain("нет отзывов");
    expect(wrapper.find(".review-rating-row__action").exists()).toBe(false);
  });

  it("shows rating on parent rows that have their own reviews", () => {
    const wrapper = mount(ReviewRatingLink, {
      props: { count: 2, averageRating: 4.5, mode: "parent" },
    });

    expect(wrapper.text()).toContain("4.5");
    expect(wrapper.text()).toContain("посмотреть отзывы");
  });

  it("hides row until review summary is ready", () => {
    const wrapper = mount(ReviewRatingLink, {
      props: { count: 0, averageRating: null, ready: false },
    });

    expect(wrapper.find(".review-rating-row").exists()).toBe(false);
  });

  it("renders rating and view-reviews action in the same row", () => {
    const wrapper = mount(ReviewRatingLink, {
      props: { count: 1, averageRating: 5 },
    });

    const row = wrapper.find(".review-rating-row");
    expect(row.exists()).toBe(true);
    expect(row.find(".review-rating-row__score").exists()).toBe(true);
    expect(row.find(".review-rating-row__action").exists()).toBe(true);
  });

  it("emits click from view-reviews action", async () => {
    const wrapper = mount(ReviewRatingLink, {
      props: { count: 3, averageRating: 5 },
    });

    await wrapper.find(".review-rating-row__action").trigger("click");
    expect(wrapper.emitted("click")).toHaveLength(1);
  });
});