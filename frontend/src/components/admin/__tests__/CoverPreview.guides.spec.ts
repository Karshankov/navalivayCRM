/**
 * Направляющие и соседи в редакторе обложки.
 *
 * Смысл колонки: сотрудник видит картинки соседних линеек в натуральную
 * величину и ставит свою так, чтобы середина кадра оказалась на той же
 * высоте. Без соседей сравнивать не с чем — тогда это просто сетка.
 */
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { readFile } from "node:fs/promises";
import CoverPreview, { type CoverNeighbour } from "@/components/admin/CoverPreview.vue";

function neighbour(id: string, name: string, extra: Partial<CoverNeighbour> = {}): CoverNeighbour {
  return {
    id,
    name,
    coverImage: `/api/covers/${id}.png`,
    coverZoom: 170,
    coverShift: 10,
    coverOffsetY: 14,
    coverManual: true,
    ...extra,
  };
}

async function stylesheet(): Promise<string> {
  const source = await readFile("src/components/admin/CoverPreview.vue", "utf-8");
  return source.split("<style scoped>")[1].split("</style>")[0];
}

function ruleBlock(css: string, selector: string): string {
  const start = css.search(new RegExp(`^\\s*\\${selector}\\s*\\{`, "m"));
  if (start < 0) return "";
  return css.slice(start, css.indexOf("}", start));
}

function prop(block: string, name: string): string | null {
  return block.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]?.trim() ?? null;
}

describe("Редактор обложки: направляющие с соседями", () => {
  it("показывает соседа сверху и соседа снизу", () => {
    const w = mount(CoverPreview, {
      props: {
        src: "/cover.png",
        title: "PODONKI PODGON",
        previous: neighbour("cg_a", "ЛИНЕЙКА ВЫШЕ"),
        next: neighbour("cg_c", "ЛИНЕЙКА НИЖЕ"),
      },
    });

    const prev = w.find('[data-test="guide-previous"]');
    const own = w.find('[data-test="guide-own"]');
    const nxt = w.find('[data-test="guide-next"]');

    console.log("сосед выше:", w.find(".cover-guides__slot").text().slice(0, 30));
    expect(prev.exists()).toBe(true);
    expect(own.exists()).toBe(true);
    expect(nxt.exists()).toBe(true);

    // Названия соседей подписаны — иначе непонятно, чей это кадр.
    const captions = w.findAll(".cover-guides__caption").map((c) => c.text());
    console.log("подписи:", captions);
    expect(captions.join(" ")).toContain("ЛИНЕЙКА ВЫШЕ");
    expect(captions.join(" ")).toContain("ЛИНЕЙКА НИЖЕ");
    w.unmount();
  });

  it("соседи рисуются в своих кадрах, а не общим автоподбором", () => {
    /* У соседа кадр может быть настроен руками. Если нарисовать его
       автоподбором, эталон будет врать: сотрудник выровняется по кадру,
       которого у соседа нет. */
    const w = mount(CoverPreview, {
      props: {
        src: "/cover.png",
        previous: neighbour("cg_a", "ВЫШЕ", { coverManual: true, coverZoom: 250 }),
        next: neighbour("cg_c", "НИЖЕ", { coverManual: false, coverZoom: null }),
      },
    });

    const prevImg = w.find('[data-test="guide-previous"] .image-fade__img');
    const nextImg = w.find('[data-test="guide-next"] .image-fade__img');
    console.log("кадр соседа выше:", prevImg.attributes("style"));
    console.log("кадр соседа ниже:", nextImg.attributes("style"));
    expect(prevImg.exists()).toBe(true);
    expect(nextImg.exists()).toBe(true);
    w.unmount();
  });

  it("без соседа показывает, что линейка крайняя", () => {
    const w = mount(CoverPreview, {
      props: { src: "/cover.png", previous: null, next: neighbour("cg_c", "НИЖЕ") },
    });

    const empty = w.findAll(".cover-guides__area--empty");
    console.log("пустых мест:", empty.length, "| текст:", empty[0]?.text());
    expect(empty.length).toBe(1);
    expect(empty[0]!.text()).toContain("Первая");
    w.unmount();
  });

  it("последняя линейка подписана снизу", () => {
    const w = mount(CoverPreview, {
      props: { src: "/cover.png", previous: neighbour("cg_a", "ВЫШЕ"), next: null },
    });
    const empty = w.findAll(".cover-guides__area--empty");
    expect(empty.length).toBe(1);
    expect(empty[0]!.text()).toContain("Последняя");
    w.unmount();
  });

  it("область эталона — ровно 76x124, как у клиента", async () => {
    /* В этом весь смысл: натуральный размер. Если область окажется
       крупнее или мельче, «не выбиваться из других» проверить нельзя. */
    const css = await stylesheet();
    const area = ruleBlock(css, ".cover-guides__area");
    console.log("область эталона:", prop(area, "width"), "x", prop(area, "height"));

    expect(prop(area, "width")).toBe("76px");
    expect(prop(area, "height")).toBe("124px");

    // Пропорция обязана совпасть с областью в карточке клиента.
    const w = Number(prop(area, "width")!.replace("px", ""));
    const h = Number(prop(area, "height")!.replace("px", ""));
    expect(Math.abs(w / h - 76 / 124)).toBeLessThan(0.001);
  });

  it("направляющие стоят на четвертях и на середине", async () => {
    const css = await stylesheet();
    const quarter = ruleBlock(css, ".cover-guides__line--quarter");
    const center = ruleBlock(css, ".cover-guides__line--center");
    const threeQuarter = ruleBlock(css, ".cover-guides__line--three-quarter");

    console.log("четверть:", prop(quarter, "top"), "| середина:", prop(center, "top"), "| три четверти:", prop(threeQuarter, "top"));
    expect(prop(quarter, "top")).toBe("25%");
    expect(prop(center, "top")).toBe("50%");
    expect(prop(threeQuarter, "top")).toBe("75%");

    /* Середина — сплошная и цветом акцента, четверти — пунктиром.
       Стиль линии задан в общем правиле, а модификаторы его уточняют,
       поэтому смотрим на общее правило вместе с модификатором. */
    const line = ruleBlock(css, ".cover-guides__line");
    console.log("общая линия:", prop(line, "border-top"));
    console.log("середина:", prop(center, "border-top"), prop(center, "background"));

    expect(prop(line, "border-top")).toContain("dashed");
    expect(prop(center, "border-top"), "середина должна быть сплошной").toContain("solid");
    expect(prop(center, "border-top"), "середина — цветом акцента").toContain("0958ff");
  });

  it("шаг между областями — 134px, как между карточками у клиента", async () => {
    /* Проверка счётом по правилам: 124 (область) + 10 (зазор) = 134.
       Этот шаг и делает колонку «рядом из ленты», а не просто столбиком
       картинок. Сначала подписи стояли НАД областями и добавляли к шагу
       свои 14px — ряд разъезжался. */
    const css = await stylesheet();
    const area = ruleBlock(css, ".cover-guides__area");
    const slot = ruleBlock(css, ".cover-guides__slot");

    const areaH = Number(prop(area, "height")!.replace("px", ""));
    const slotGap = Number(prop(slot, "margin-bottom")!.replace("px", ""));

    console.log("область:", areaH, "px | зазор слота:", slotGap, "px | шаг:", areaH + slotGap);
    expect(areaH + slotGap).toBe(134);

    /* Подпись обязана стоять сбоку, а не над областью: над областью она
       попадала бы в тот же столбик и увеличивала шаг. */
    expect(prop(slot, "display")).toBe("flex");
    expect(prop(slot, "min-height")).toBe("124px");
  });

  it("длинное название соседа не обрезается и не сбивает шаг", async () => {
    /* Название линейки бывает длинным, а колонка узкая. Первая версия
       резала его многоточием — становилось непонятно, чей это кадр.
       Теперь подпись занимает две строки и потому не влияет на шаг. */
    const css = await stylesheet();
    const caption = ruleBlock(css, ".cover-guides__caption");

    console.log("подпись:", prop(caption, "width"), prop(caption, "flex"), prop(caption, "overflow-wrap"));
    // Ширина фиксирована, перенос разрешён — обрезки нет.
    expect(prop(caption, "width")).toBe("92px");
    expect(prop(caption, "overflow-wrap")).toBe("anywhere");
    // text-overflow с многоточием не должен вернуться.
    expect(prop(caption, "text-overflow")).toBeNull();
    expect(prop(caption, "white-space")).toBeNull();

    /* Слот выравнивает по центру, поэтому подпись в две строки просто
       растёт вбок от области, не раздвигая области по вертикали. */
    const slot = ruleBlock(css, ".cover-guides__slot");
    expect(prop(slot, "align-items")).toBe("center");
  });

  it("направляющие не перехватывают нажатия", async () => {
    /* Иначе линии мешали бы тянуть фото в окне. */
    const css = await stylesheet();
    const lines = ruleBlock(css, ".cover-guides__lines");
    console.log("направляющие:", prop(lines, "pointer-events"));
    expect(prop(lines, "pointer-events")).toBe("none");
  });
});
