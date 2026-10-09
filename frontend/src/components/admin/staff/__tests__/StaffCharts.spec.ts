import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import StaffMetricStrip from "../StaffMetricStrip.vue";
import StaffShiftHeatmap from "../StaffShiftHeatmap.vue";
import StaffSparkline from "../StaffSparkline.vue";
import type { StaffShift } from "@/stores/crm";

function shift(startedAt: string, endedAt: string): StaffShift {
  return {
    id: `shift-${startedAt}`,
    version: 1,
    employee_id: "employee-1",
    status: "closed",
    started_at: startedAt,
    ended_at: endedAt,
  };
}

describe("StaffMetricStrip", () => {
  it("показывает рост и падение разными знаками", () => {
    const wrapper = mount(StaffMetricStrip, {
      props: {
        items: [
          { label: "Выдано", value: 12, raw: 12, previous: 10 },
          { label: "Минусы", value: 3, raw: 3, previous: 6, lowerIsBetter: true },
        ],
      },
    });

    expect(wrapper.text()).toContain("+20%");
    expect(wrapper.text()).toContain("-50%");
  });

  it("красит рост зелёным, а для «меньше значит лучше» наоборот", () => {
    const wrapper = mount(StaffMetricStrip, {
      props: {
        items: [
          { label: "Выдано", value: 12, raw: 12, previous: 10 },
          { label: "Минусы", value: 6, raw: 6, previous: 3, lowerIsBetter: true },
        ],
      },
    });

    const chips = wrapper.findAll("span.font-semibold");
    expect(chips[0].classes()).toContain("text-emerald-600");
    expect(chips[1].classes()).toContain("text-rose-600");
  });

  it("не делит на ноль и подписывает новый показатель", () => {
    const wrapper = mount(StaffMetricStrip, {
      props: { items: [{ label: "Задач", value: 4, raw: 4, previous: 0 }] },
    });

    expect(wrapper.text()).toContain("новое");
    expect(wrapper.text()).not.toContain("Infinity");
    expect(wrapper.text()).not.toContain("NaN");
  });

  it("молчит, когда сравнивать не с чем", () => {
    const wrapper = mount(StaffMetricStrip, {
      props: { items: [{ label: "Смен", value: 5, raw: 5 }] },
    });

    expect(wrapper.text()).toContain("Смен");
    expect(wrapper.text()).not.toContain("%");
  });
});

describe("StaffSparkline", () => {
  it("рисует по точке на каждое значение", () => {
    const wrapper = mount(StaffSparkline, {
      props: { values: [0, 3, 1, 5], color: "#16a34a" },
    });

    const points = wrapper.get("polyline").attributes("points")!.trim().split(/\s+/);
    expect(points).toHaveLength(4);
    expect(wrapper.get("polyline").attributes("stroke")).toBe("#16a34a");
  });

  it("переживает пустой ряд без ошибок", () => {
    const wrapper = mount(StaffSparkline, { props: { values: [] } });

    expect(wrapper.get("polyline").attributes("points")).toBe("");
    expect(wrapper.get("svg").attributes("aria-label")).toContain("Данных нет");
  });

  it("не схлопывается, когда все значения одинаковые", () => {
    const wrapper = mount(StaffSparkline, { props: { values: [4, 4, 4] } });

    const points = wrapper.get("polyline").attributes("points")!;
    expect(points).not.toContain("NaN");
  });
});

describe("StaffShiftHeatmap", () => {
  it("раскладывает смену по часам делового пояса", () => {
    // 07:00-11:00 UTC это 10:00-14:00 в Минске, понедельник 2026-07-27.
    const wrapper = mount(StaffShiftHeatmap, {
      props: {
        shifts: [shift("2026-07-27T07:00:00Z", "2026-07-27T11:00:00Z")],
      },
    });

    const cells = wrapper.findAll("[title]");
    const filled = cells.filter((cell) => !cell.attributes("title")!.includes("смен не было"));
    expect(filled).toHaveLength(4);
    expect(filled[0].attributes("title")).toContain("Пн, 10:00");
    expect(filled[3].attributes("title")).toContain("Пн, 13:00");
    expect(wrapper.text()).toContain("Пик: Пн, 10:00");
  });

  it("разносит смену через полночь на два дня", () => {
    // 22:00-00:00 по Минску: воскресенье переходит в понедельник.
    const wrapper = mount(StaffShiftHeatmap, {
      props: {
        shifts: [shift("2026-07-26T19:00:00Z", "2026-07-26T21:00:00Z")],
      },
    });

    const titles = wrapper
      .findAll("[title]")
      .map((cell) => cell.attributes("title")!)
      .filter((title) => !title.includes("смен не было"));
    expect(titles.some((title) => title.startsWith("Вс, 22:00"))).toBe(true);
    expect(titles.some((title) => title.startsWith("Вс, 23:00"))).toBe(true);
  });

  it("показывает пустое состояние без смен", () => {
    const wrapper = mount(StaffShiftHeatmap, { props: { shifts: [] } });

    expect(wrapper.text()).toContain("За выбранный период смен не было");
  });

  it("игнорирует незакрытую запись длиной в месяц", () => {
    const wrapper = mount(StaffShiftHeatmap, {
      props: {
        shifts: [shift("2026-06-01T07:00:00Z", "2026-07-01T07:00:00Z")],
      },
    });

    expect(wrapper.text()).toContain("За выбранный период смен не было");
  });
});
