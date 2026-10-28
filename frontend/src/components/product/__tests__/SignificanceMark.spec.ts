import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import SignificanceMark from "@/components/product/SignificanceMark.vue";

const MARK = {
  code: "social",
  title: "Социально значимый товар",
  description: "Часть средств идёт на благотворительность",
  icon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP4//8/AwAF/gL+py0/RAAAAABJRU5ErkJggg==",
  color: "#16a34a",
  detailTitle: "О программе",
  detailBody: true,
  detailButtonText: "Узнать больше",
  detailUrl: null,
};

function mountMark(mark: any = MARK) {
  return mount(SignificanceMark, {
    props: { mark },
    global: { stubs: { Teleport: { template: "<div><slot /></div>" } } },
  });
}

describe("SignificanceMark: блок пометки в мини-аппе", () => {
  it("рисует светлую карточку с плиткой-градиентом из цвета пометки", () => {
    const wrapper = mountMark();

    expect(wrapper.text()).toContain("Социально значимый товар");
    expect(wrapper.text()).toContain("Часть средств идёт на благотворительность");
    expect(wrapper.text()).toContain("Узнать больше");

    // Плитка-иконка несёт градиент из цвета пометки.
    const tile = wrapper.find(".sig-mark__tile");
    expect(tile.exists()).toBe(true);
    const tileStyle = tile.attributes("style") || "";
    expect(tileStyle).toContain("linear-gradient");
    expect(tileStyle).toContain("#16a34a");
    // Иконка — загруженная картинка.
    expect(tile.find("img").attributes("src")).toBe(MARK.icon);

    // Кнопка тоже на градиенте: чуть затемнённые стопы цвета пометки
    // (shade -8%/-18%: #149644 / #12863d для #16a34a).
    const action = wrapper.find(".sig-mark__action");
    expect(action.exists()).toBe(true);
    const actionStyle = action.attributes("style") || "";
    expect(actionStyle).toContain("linear-gradient");
    expect(actionStyle).toContain("#149644");
    expect(actionStyle).toContain("#12863d");
  });

  it("без пометки ничего не рисует", () => {
    const wrapper = mountMark(null);
    expect(wrapper.find(".sig-mark").exists()).toBe(false);
  });

  it("кнопка «Подробнее» тянет текст по коду и открывает модалку", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        detailTitle: "О программе",
        detailBody: "Мы отдаём часть средств в фонд.",
        description: null,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mountMark();
    await wrapper.find("button").trigger("click");
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledWith("/api/significance-marks/social/detail");
    // Модалка открылась с текстом и кнопкой в том же стиле.
    expect(wrapper.text()).toContain("Мы отдаём часть средств в фонд.");
    expect(wrapper.find(".sig-mark-sheet").exists()).toBe(true);

    vi.unstubAllGlobals();
  });

  it("внешняя ссылка открывается без запроса текста", async () => {
    const openMock = vi.fn();
    vi.stubGlobal("open", openMock);

    const wrapper = mountMark({ ...MARK, detailUrl: "https://example.com/help", detailBody: false });
    await wrapper.find("button").trigger("click");

    expect(openMock).toHaveBeenCalledWith("https://example.com/help", "_blank", "noopener,noreferrer");

    vi.unstubAllGlobals();
  });

  it("другой цвет пометки красит плитку и кнопку", () => {
    const wrapper = mountMark({ ...MARK, color: "#0789ff" });
    const tileStyle = wrapper.find(".sig-mark__tile").attributes("style") || "";
    expect(tileStyle).toContain("#0789ff");
  });
});
