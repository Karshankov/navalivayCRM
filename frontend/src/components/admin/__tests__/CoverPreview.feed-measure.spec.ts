/**
 * Замер ленты из трёх карточек: совпадает ли она с лентой клиента.
 *
 * Подписи «выше/ниже» сначала стояли сбоку и отнимали у карточки ~66px.
 * Длинное название переносилось на вторую строку, карточка становилась
 * выше, а область фото растягивалась вместе с ней: выходило 76x144 вместо
 * 76x124. Превью показывало не то, что видит покупатель. Тест сторожит
 * этот случай.
 */
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

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

describe("Лента из трёх карточек", () => {
  it("ширина карточки — 369px, как у клиента на телефоне 393px", async () => {
    const css = await stylesheet();
    const stage = ruleBlock(css, ".cover-preview__stage");
    console.log("ширина превью:", prop(stage, "width"));
    expect(prop(stage, "width")).toBe("369px");
  });

  it("карточка занимает всю ширину строки — подпись её не сужает", async () => {
    /* Если вернуть подпись сбоку, карточка станет ~303px, название
       перенесётся, и область фото вырастет с 124 до 144. */
    const source = await readFile("src/components/admin/CoverPreview.vue", "utf-8");

    console.log("подписей в разметке:", (source.match(/row-caption/g) || []).length);
    expect(source).not.toContain("row-caption");

    const css = await stylesheet();
    const row = ruleBlock(css, ".cover-preview__row");
    console.log("строка:", prop(row, "display"));
    // Без gap: карточка одна в строке и должна занять всю ширину.
    expect(prop(row, "display")).toBe("flex");
    expect(prop(row, "gap")).toBeNull();
  });

  it("область фото повторяет поведение клиента, а не жёсткие 124px", async () => {
    /* Высота области НЕ фиксирована: у клиента .liquid-line-art растянут
       через align-self: stretch по высоте карточки, а высоту задаёт
       содержимое. При переносе длинного названия карточка становится выше
       — и область фото растёт вместе с ней (замерено: 76x144 на названии
       в две строки). 124 — это случай, когда название влезло в строку.

       Поэтому проверяем не «всегда 124», а что превью повторяет ТУ ЖЕ
       механику: карточка тянет область фото, отступы те же. */
    const css = await stylesheet();
    const frame = ruleBlock(css, ".cover-preview__frame");
    const padding = prop(frame, "padding")!;
    const parts = padding.split(/\s+/).map((v) => Number(v.replace("px", "")));

    const top = parts[0]!;
    const bottom = parts[2] ?? parts[0]!;
    console.log("отступы карточки:", padding, "-> сверху", top, "снизу", bottom);

    // Однострочное название: 92 (пол высоты) + 16 + 16 = 124, как у клиента.
    expect(92 + top + bottom).toBe(124);

    /* Область фото тянется по высоте карточки и не имеет жёсткой высоты:
       иначе при переносе названия превью разойдётся с клиентом. Ровно те
       же правила, что у .liquid-line-art — сверяем построчно. */
    const art = ruleBlock(css, ".cover-preview__art");
    console.log("область фото:", prop(art, "min-height"), "| растяжение:", prop(art, "align-self"));

    /* Ищем именно `height:`, а не `min-height:`: регулярка по имени без
       привязки к началу строки ловила бы и его. */
    const hardHeight = art.match(/(?:^|[;\s])height:\s*([^;]+);/m);
    console.log("жёсткая высота:", hardHeight ? hardHeight[1] : "нет");
    expect(hardHeight, "жёсткая высота сломала бы перенос").toBeNull();
    expect(prop(art, "align-self")).toBe("stretch");
    expect(prop(art, "min-height")).toBe("92px");

    // Те же числа, что у клиента: отрицательные поля съедают отступы.
    const liquid = await readFile(
      "src/components/product/liquid/LiquidLineCard.vue",
      "utf-8",
    );
    const liquidArt = ruleBlock(liquid.split("<style scoped>")[1]!.split("</style>")[0]!, ".liquid-line-art");
    console.log("у клиента:", prop(liquidArt, "min-height"), prop(liquidArt, "align-self"));
    expect(prop(art, "min-height")).toBe(prop(liquidArt, "min-height"));
    expect(prop(art, "align-self")).toBe(prop(liquidArt, "align-self"));
    expect(prop(art, "margin-top")).toBe(prop(liquidArt, "margin-top"));
  });

  it("зазор между карточками — 10px, как в ленте", async () => {
    const css = await stylesheet();
    const feed = ruleBlock(css, ".cover-preview__stage--feed");
    console.log("зазор:", prop(feed, "gap"), "| шаг = 124 + 10 = 134");
    expect(prop(feed, "gap")).toBe("10px");
  });

  it("название переносится так же, как у клиента: без обрезки", async () => {
    /* Соблазн запретить перенос есть: тогда карточка всегда 124. Но у
       клиента длинное название переносится ЦЕЛИКОМ, без многоточия — и
       карточка становится выше. Запрет переноса сделал бы превью
       аккуратнее, но невернее. */
    const css = await stylesheet();
    const title = ruleBlock(css, ".cover-preview__title");
    console.log("название:", prop(title, "white-space"), "| перенос:", prop(title, "overflow-wrap"));

    expect(prop(title, "white-space"), "обрезки многоточием быть не должно").toBeNull();
    expect(prop(title, "text-overflow")).toBeNull();

    const liquid = await readFile(
      "src/components/product/liquid/LiquidLineCard.vue",
      "utf-8",
    );
    const liquidTitle = ruleBlock(liquid.split("<style scoped>")[1]!.split("</style>")[0]!, ".liquid-line-title");
    console.log("у клиента:", prop(liquidTitle, "overflow-wrap"));
    expect(prop(title, "overflow-wrap")).toBe(prop(liquidTitle, "overflow-wrap"));
  });
});
