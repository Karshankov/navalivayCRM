import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import ReviewForm from "@/components/reviews/ReviewForm.vue";
import { resolveQuickTagsLayout } from "@/utils/reviewQuickTagsLayout";

const quickTags = [
  { id: "tag1", label: "Вкусно", insert_text: "Вкусно" },
  { id: "tag2", label: "Быстрая доставка", insert_text: "Быстрая доставка" },
];

describe("ReviewForm", () => {
  it("does not show lottery disclosure inside the form", () => {
    const wrapper = mount(ReviewForm, {
      props: { quickTags },
    });

    expect(wrapper.find(".review-form__disclosure").exists()).toBe(false);
    expect(wrapper.find(".review-form__disclosure-badge").exists()).toBe(false);
    wrapper.unmount();
  });

  it("keeps submit disabled until rating and 20-char body are set", async () => {
    const wrapper = mount(ReviewForm, {
      props: { quickTags },
    });

    expect(wrapper.find(".review-form__submit").attributes("disabled")).toBeDefined();

    const stars = wrapper.findAll(".review-form__star");
    await stars[4].trigger("click");
    await wrapper.find(".review-form__textarea").setValue("Коротко");
    expect(wrapper.find(".review-form__submit").attributes("disabled")).toBeDefined();

    await wrapper.find(".review-form__textarea").setValue("Достаточно длинный текст отзыва");
    expect(wrapper.find(".review-form__submit").attributes("disabled")).toBeUndefined();
    expect(wrapper.find(".review-form__counter--ok").exists()).toBe(true);

    wrapper.unmount();
  });

  it("toggles quick tags without changing review text", async () => {
    const wrapper = mount(ReviewForm, {
      props: { initialRating: 5, quickTags },
    });

    await wrapper.find(".review-form__textarea").setValue("Достаточно длинный текст отзыва");

    const tag = wrapper.findAll(".review-form__tag")[0];
    await tag.trigger("click");

    expect(wrapper.find(".review-form__textarea").element).toHaveProperty(
      "value",
      "Достаточно длинный текст отзыва",
    );
    expect(wrapper.find(".review-form__tag--selected").exists()).toBe(true);

    await tag.trigger("click");
    expect(wrapper.find(".review-form__tag--selected").exists()).toBe(false);

    wrapper.unmount();
  });

  it("allows submit with only required text and optional selected tags", async () => {
    const wrapper = mount(ReviewForm, {
      props: { initialRating: 4, quickTags },
    });

    await wrapper.find(".review-form__textarea").setValue("  Достаточно длинный текст отзыва  ");
    await wrapper.findAll(".review-form__tag")[0].trigger("click");
    await wrapper.find(".review-form__anonymous-input").setValue(true);
    await wrapper.find("form").trigger("submit.prevent");

    expect(wrapper.emitted("submit")).toEqual([
      [
        {
          rating: 4,
          body_text: "Достаточно длинный текст отзыва",
          quick_tag_ids: ["tag1"],
          is_anonymous: true,
        },
      ],
    ]);

    wrapper.unmount();
  });

  it("clears selected tags when rating changes", async () => {
    const wrapper = mount(ReviewForm, {
      props: { initialRating: 5, quickTags },
    });

    await wrapper.findAll(".review-form__tag")[0].trigger("click");
    expect(wrapper.find(".review-form__tag--selected").exists()).toBe(true);

    await wrapper.findAll(".review-form__star")[2].trigger("click");
    expect(wrapper.find(".review-form__tag--selected").exists()).toBe(false);

    wrapper.unmount();
  });

  it("does not submit when disabled or already submitting", async () => {
    const wrapper = mount(ReviewForm, {
      props: {
        initialRating: 5,
        initialBodyText: "Достаточно длинный текст отзыва",
        disabled: true,
      },
    });

    await wrapper.find("form").trigger("submit.prevent");
    expect(wrapper.emitted("submit")).toBeUndefined();

    await wrapper.setProps({ disabled: false, submitting: true });
    await wrapper.find("form").trigger("submit.prevent");
    expect(wrapper.emitted("submit")).toBeUndefined();

    wrapper.unmount();
  });

  it("uses equal-width grid for three quick tags", async () => {
    const wrapper = mount(ReviewForm, {
      props: {
        initialRating: 1,
        quickTags: [
          ...quickTags,
          { id: "tag3", label: "Без сюрпризов", insert_text: "Без сюрпризов" },
        ],
      },
    });
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".review-form__tags-list").classes()).toContain(
      "review-form__tags-list--grid-3",
    );

    wrapper.unmount();
  });

  it("resolveQuickTagsLayout adapts to tag count", () => {
    expect(resolveQuickTagsLayout(3)).toBe("review-form__tags-list--grid-3");
    expect(resolveQuickTagsLayout(4)).toBe("review-form__tags-list--grid-4");
    expect(resolveQuickTagsLayout(5)).toBe("review-form__tags-list--scroll");
  });

  it("shows server error message when provided", () => {
    const wrapper = mount(ReviewForm, {
      props: {
        initialRating: 5,
        initialBodyText: "Достаточно длинный текст отзыва",
        errorMessage: "Отзыв уже на модерации",
      },
    });

    expect(wrapper.find(".review-form__error").text()).toBe("Отзыв уже на модерации");

    wrapper.unmount();
  });
});