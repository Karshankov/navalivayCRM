import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import WheelPrizeCard from "@/components/wheel/WheelPrizeCard.vue";

function buildPrize(imageUrl: string | null) {
  return {
    id: "prize-1",
    title: "Скидка 10%",
    description: null,
    image_url: imageUrl,
    rarity: {
      code: "common",
      label: "Обычный",
      bgColor: "#27A3FF",
      textColor: "#FFFFFF",
      isElite: false,
    },
    weight: 1,
    effective_weight: 1,
    max_total: 0,
    issued_count: 0,
    is_exhausted: false,
    sort_order: 0,
  };
}

describe("WheelPrizeCard", () => {
  it("restores the image after a previous load error when image_url changes", async () => {
    const wrapper = mount(WheelPrizeCard, {
      props: {
        prize: buildPrize("/broken.png"),
      },
    });

    await wrapper.find("img").trigger("error");
    expect(wrapper.find(".wheel-prize-card__icon-default").exists()).toBe(true);

    await wrapper.setProps({
      prize: buildPrize("/fixed.png"),
    });

    const img = wrapper.find("img");
    expect(img.exists()).toBe(true);
    expect(img.attributes("src")).toBe("/fixed.png");
  });
});
