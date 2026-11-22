import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ReviewRatingLink from "@/components/reviews/ReviewRatingLink.vue";

describe("ReviewRatingLink", () => {
  it("показывает оценку и количество отзывов одной строкой", () => {
    const wrapper = mount(ReviewRatingLink, {
      props: { count: 12, averageRating: 4.83 },
    });

    expect(wrapper.text()).toContain("4.8");
    expect(wrapper.text()).toContain("Отзывы");
    expect(wrapper.text()).toContain("·12");
    // Оценка и число — акцент, оба синим.
    expect(wrapper.find(".review-rating-row__average").exists()).toBe(true);
    expect(wrapper.find(".review-rating-row__count").exists()).toBe(true);
  });

  it("shows empty state when there are no reviews on leaf lines", () => {
    const wrapper = mount(ReviewRatingLink, {
      props: { count: 0, averageRating: null, mode: "leaf" },
    });

    expect(wrapper.text()).toContain("Нет отзывов");
    // Кнопки нет: нажимать нечего, отзывов не оставили.
    expect(wrapper.find(".review-rating-row__score").exists()).toBe(false);
  });

  it("у родительской линейки строки нет — отзывы живут на дочерних", () => {
    const wrapper = mount(ReviewRatingLink, {
      props: { count: 0, averageRating: null, mode: "parent" },
    });

    // Пустая подсказка занимала место и ничего не сообщала: строку
    // не показываем вовсе, а не оставляем пустой.
    expect(wrapper.find(".review-rating-row").exists()).toBe(false);
    expect(wrapper.text()).toBe("");
  });

  it("shows rating on parent rows that have their own reviews", () => {
    const wrapper = mount(ReviewRatingLink, {
      props: { count: 2, averageRating: 4.5, mode: "parent" },
    });

    expect(wrapper.text()).toContain("4.5");
    expect(wrapper.text()).toContain("Отзывы");
  });

  it("hides row until review summary is ready", () => {
    const wrapper = mount(ReviewRatingLink, {
      props: { count: 0, averageRating: null, ready: false },
    });

    expect(wrapper.find(".review-rating-row").exists()).toBe(false);
  });

  it("вся строка целиком — одна кнопка", () => {
    const wrapper = mount(ReviewRatingLink, {
      props: { count: 1, averageRating: 5 },
    });

    const row = wrapper.find(".review-rating-row");
    expect(row.exists()).toBe(true);
    const score = row.find(".review-rating-row__score");
    // Кнопка одна и охватывает всё: попадать пальцем по слову неудобно.
    expect(score.element.tagName).toBe("BUTTON");
    expect(score.text()).toContain("5");
    expect(score.text()).toContain("Отзывы");
    expect(score.text()).toContain("·1");
  });

  it("нажатие по строке открывает отзывы", async () => {
    const wrapper = mount(ReviewRatingLink, {
      props: { count: 3, averageRating: 5 },
    });

    await wrapper.find(".review-rating-row__score").trigger("click");
    expect(wrapper.emitted("click")).toHaveLength(1);
  });
});