import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { readFile } from "node:fs/promises";

/**
 * Замер настоящей области фото у карточки клиента.
 *
 * Область растянута по высоте карточки (align-self: stretch), поэтому
 * её высота не 92px из min-height, а больше. Пока мы не знаем точное
 * число, любое окно редактора будет показывать не ту пропорцию —
 * а значит и не тот кадр, что увидит покупатель.
 *
 * Здесь высота считается из состава карточки: строки, отступы, шрифты,
 * паддинги. Это тот же расчёт, что делает браузер.
 */

/** Разобрать свойство правила CSS, пропуская комментарии. */
async function css(selector: string): Promise<Record<string, string>> {
  const source = await readFile("src/components/product/liquid/LiquidLineCard.vue", "utf-8");
  const block = source.match(new RegExp(`^\\${selector}\\s*\\{([\\s\\S]*?)\\n\\}`, "m"))?.[1];
  if (!block) throw new Error(`нет правила ${selector}`);

  const result: Record<string, string> = {};
  block
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/[;\n]/)
    .forEach((line) => {
      const [key, value] = line.split(":").map((part) => part?.trim());
      if (key && value) result[key] = value;
    });
  return result;
}

const num = (value: string | undefined, fallback = 0): number => {
  const found = value?.match(/^(-?[\d.]+)/);
  return found ? Number(found[1]) : fallback;
};

describe("Замер области фото у карточки клиента", () => {
  it("высота области — не min-height, а высота вытянутой карточки", async () => {
    const card = await css(".liquid-line-card");
    const art = await css(".liquid-line-art");
    const info = await css(".liquid-line-info");

    const gap = num(info["gap"], 2);
    const paddingV = num(card["padding"]); // 16
    const artMarginTop = num(art["margin-top"]); // -16
    const artMarginBottom = num(art["margin-bottom"]); // -16
    const artMinHeight = num(art["min-height"]); // 92

    /* Строки info-колонки: название, характеристика, отзывы, пилюля.
       Высоты берём из их собственных правил — ровно как сложит браузер. */
    const title = num((await css(".liquid-line-title"))["line-height"]);
    const meta = num((await css(".liquid-line-meta"))["line-height"]);
    const reviews = 14; // ReviewRatingLink: min-height
    const reviewsMargin = 1; // margin-top
    /* Пилюля: padding 6+6, строка 18, рамка 1+1 = 32. min-height 30 —
       лишь нижняя граница, фактические размеры её перекрывают. */
    const favorite = 32;
    const favoriteMargin = num((await css(".liquid-line-favorite"))["margin-top"]);

    const infoHeight =
      title + gap + meta + gap + (reviews + reviewsMargin) + gap + (favorite + favoriteMargin);
    const sideHeight = 40; // шеврон

    /* Область растянута по высоте .liquid-line-main, а не карточки.
       Паддинг карточки сюда не входит: отрицательные поля области
       выходят за границы main ровно на их величину. */
    const mainHeight = Math.max(infoHeight, sideHeight);
    const artHeight = mainHeight - artMarginTop - artMarginBottom;

    console.log("состояние карточки клиента:");
    console.log("  info =", title, "+", gap, "+", meta, "+", gap, "+", reviews + reviewsMargin,
      "+", gap, "+", favorite + favoriteMargin, "=", infoHeight, "px");
    console.log("  боковой блок (шеврон) =", sideHeight, "px");
    console.log("  высота main =", mainHeight, "px (max из info и шеврона)");
    console.log("  ВЫСОТА ОБЛАСТИ ФОТО =", mainHeight, "+", -artMarginTop, "+", -artMarginBottom, "=", artHeight, "px");
    console.log("  (min-height", artMinHeight, "px — это лишь нижняя граница)");

    const ratio = 76 / artHeight;
    console.log();
    console.log("пропорция области фото у клиента: 76 /", artHeight, "=", ratio.toFixed(4));
    console.log("пропорция окна редактора сейчас:   141 / 171 =", (141 / 171).toFixed(4));

    // Область обязана быть выше своего min-height, иначе растяжение не работает.
    expect(artHeight, "область не вытянулась").toBeGreaterThan(artMinHeight);
    expect(artHeight).toBe(124);
    expect(infoHeight).toBe(92);
  });

  it("окно редактора должно иметь ровно те же пропорции, что область клиента", async () => {
    /* Окно — это тот же кадр, только крупнее. Если его пропорции
       отличаются, сотрудник видит другую обрезку: он двигает фото
       в одном прямоугольнике, а покупатель смотрит в другой. */
    const source = await readFile("src/components/admin/CoverPreview.vue", "utf-8");

    const sizes = [...source.matchAll(/\.cover-editor__viewport \{[\s\S]*?width: (\d+)px;\s*height: (\d+)px;/g)]
      .map(([, w, h]) => ({ w: Number(w), h: Number(h) }));

    const APP_RATIO = 76 / 124;
    console.log("пропорция области клиента:", APP_RATIO.toFixed(4));
    console.log("окон редактора найдено:", sizes.length);

    for (const { w, h } of sizes) {
      const ratio = w / h;
      const drift = Math.abs(ratio - APP_RATIO) / APP_RATIO;
      console.log(`  окно ${w}x${h}: пропорция ${ratio.toFixed(4)}, расхождение ${(drift * 100).toFixed(1)}%`);
      expect(drift, `окно ${w}x${h} не совпадает с областью клиента`).toBeLessThan(0.02);
    }
  });
});
