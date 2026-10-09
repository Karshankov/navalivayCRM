import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import WheelStrip from "@/components/wheel/WheelStrip.vue";

function buildPrize(id: string, title: string, rarityCode = "common") {
  return {
    id,
    title,
    description: null,
    image_url: null,
    rarity: {
      code: rarityCode,
      label: rarityCode,
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

describe("WheelStrip", () => {
  it("lands on the authoritative spin result snapshot instead of the stale prop pool", async () => {
    const stalePrize = buildPrize("stale-prize", "Обычный приз", "common");
    const resultPrize = buildPrize("result-prize", "Мифический приз", "mythic");

    const wrapper = mount(WheelStrip, {
      props: {
        prizes: [stalePrize],
      },
      global: {
        stubs: {
          WheelPrizeCard: {
            props: ["prize"],
            template: "<article>{{ prize.title }}</article>",
          },
        },
      },
    });

    await wrapper.vm.runSpin({
      prizeId: resultPrize.id,
      seed: 123,
      durationMs: 0,
      prizes: [stalePrize, resultPrize],
    });
    await flushPromises();

    const landed = wrapper.find(".wheel-strip__card--landed");
    expect(landed.exists()).toBe(true);
    expect(landed.text()).toContain("Мифический приз");
    expect(wrapper.emitted("animationDone")?.[0]).toEqual([{ prizeId: "result-prize" }]);
  });

  it("does not rebuild the visible strip from prop updates while a spin is running", async () => {
    vi.useFakeTimers();
    const stalePrize = buildPrize("stale-prize", "Старый приз");
    const resultPrize = buildPrize("result-prize", "Приз результата");
    const newPropPrize = buildPrize("new-prop-prize", "Новый приз из фона");

    const wrapper = mount(WheelStrip, {
      props: {
        prizes: [stalePrize],
      },
      global: {
        stubs: {
          WheelPrizeCard: {
            props: ["prize"],
            template: "<article>{{ prize.title }}</article>",
          },
        },
      },
    });

    const spinPromise = wrapper.vm.runSpin({
      prizeId: resultPrize.id,
      seed: 123,
      durationMs: 5000,
      prizes: [stalePrize, resultPrize],
    });
    await flushPromises();
    await wrapper.setProps({ prizes: [newPropPrize] });

    expect(wrapper.text()).toContain("Приз результата");
    expect(wrapper.text()).not.toContain("Новый приз из фона");

    await vi.advanceTimersByTimeAsync(5080);
    await spinPromise;
    await flushPromises();

    const landed = wrapper.find(".wheel-strip__card--landed");
    expect(landed.exists()).toBe(true);
    expect(landed.text()).toContain("Приз результата");
    expect(landed.text()).not.toContain("Новый приз из фона");
    vi.useRealTimers();
  });

  it("accepts prop updates again after the spin finishes", async () => {
    const initialPrize = buildPrize("initial-prize", "Стартовый приз");
    const resultPrize = buildPrize("result-prize", "Приз результата");
    const nextPrize = buildPrize("next-prize", "Следующий свежий приз");

    const wrapper = mount(WheelStrip, {
      props: {
        prizes: [initialPrize],
      },
      global: {
        stubs: {
          WheelPrizeCard: {
            props: ["prize"],
            template: "<article>{{ prize.title }}</article>",
          },
        },
      },
    });

    await wrapper.vm.runSpin({
      prizeId: resultPrize.id,
      seed: 321,
      durationMs: 0,
      prizes: [initialPrize, resultPrize],
    });
    await wrapper.setProps({ prizes: [nextPrize] });
    await flushPromises();

    expect(wrapper.text()).toContain("Следующий свежий приз");
    expect(wrapper.text()).not.toContain("Приз результата");
  });

  it("throws for a missing explicit result prize and resets the running guard", async () => {
    const initialPrize = buildPrize("initial-prize", "Стартовый приз");
    const nextPrize = buildPrize("next-prize", "Следующий приз");

    const wrapper = mount(WheelStrip, {
      props: {
        prizes: [initialPrize],
      },
      global: {
        stubs: {
          WheelPrizeCard: {
            props: ["prize"],
            template: "<article>{{ prize.title }}</article>",
          },
        },
      },
    });

    await expect(wrapper.vm.runSpin({
      prizeId: "missing-prize",
      seed: 111,
      durationMs: 0,
      prizes: [initialPrize],
    })).rejects.toThrow("spin_prize_missing_from_animation_pool");

    await wrapper.setProps({ prizes: [nextPrize] });
    await flushPromises();
    expect(wrapper.text()).toContain("Следующий приз");
  });
});
