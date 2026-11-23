/**
 * Вёрстка редактора обложки: проверки, которые нельзя сделать глазами.
 *
 * Здесь ловятся три ошибки, каждая из которых портит кадр молча:
 *  1. Сжатие превью вместо масштабирования меняет перенос строк и высоту
 *     карточки — кадр расходится с клиентским.
 *  2. Обрезка обёртки меньше содержимого срезает край карточки.
 *  3. Окно редактора с чужими пропорциями показывает не ту обрезку.
 */
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const SOURCE = "src/components/admin/CoverPreview.vue";

/** Вырезает блок правила по селектору: от селектора до закрывающей скобки. */
function ruleBlock(css: string, selector: string): string {
  const start = css.search(new RegExp(`^\\s*\\${selector}\\s*\\{`, "m"));
  if (start < 0) return "";
  const end = css.indexOf("}", start);
  return css.slice(start, end);
}

/** Значение свойства внутри блока. */
function prop(block: string, name: string): string | null {
  return block.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]?.trim() ?? null;
}

async function stylesheet(): Promise<string> {
  const source = await readFile(SOURCE, "utf-8");
  return source.split("<style scoped>")[1].split("</style>")[0];
}

describe("Обложка: вёрстка превью и окна", () => {
  it("превью не сжимается — сжатие развело бы кадр с клиентским", async () => {
    const css = await stylesheet();
    const stage = ruleBlock(css, ".cover-preview__stage");
    console.log("правило превью:", stage.replace(/\s+/g, " "));

    /* max-width заставил бы карточку сжаться: название перенеслось бы
       раньше, карточка стала бы выше, и область фото вытянулась бы
       вместе с ней. Уменьшать превью можно только целиком. */
    expect(prop(stage, "max-width"), "превью сожмётся и кадр разойдётся").toBeNull();
    expect(prop(stage, "width")).toBe("369px");
  });

  it("на узком экране превью уменьшается целиком и целиком же влезает", async () => {
    const css = await stylesheet();
    const media = css.slice(css.indexOf("@media (max-width: 640px)"));
    const stage = ruleBlock(media, ".cover-preview__stage");
    const result = ruleBlock(media, ".cover-preview__result");

    const scale = Number(prop(stage, "transform")?.match(/scale\(([\d.]+)\)/)?.[1]);
    const maxWidth = Number(prop(result, "max-width")?.replace("px", ""));
    const maxHeight = Number(prop(result, "max-height")?.replace("px", ""));

    console.log("масштаб:", scale, "| обёртка:", maxWidth, "x", maxHeight);

    expect(scale).toBeGreaterThan(0);
    expect(scale).toBeLessThan(1);

    // Карточка 369px после масштаба обязана поместиться в обёртку.
    const scaledCard = 369 * scale;
    console.log("карточка после масштаба:", scaledCard.toFixed(2), "px");
    expect(
      maxWidth,
      "карточка шире обёртки — правый край срежется",
    ).toBeGreaterThanOrEqual(scaledCard + 1);

    /* Высота: подпись не масштабируется, поэтому она входит в обёртку
       как есть. Карточка 126px, подпись 17px, зазор 4px. */
    const needed = 17 + 4 + 126 * scale;
    console.log("нужно высоты:", needed.toFixed(1), "px, дано:", maxHeight);
    expect(
      maxHeight,
      "обёртка ниже содержимого — подпись или низ карточки срежется",
    ).toBeGreaterThanOrEqual(needed);
  });

  it("окно редактора работает с той же пропорцией, что область клиента", async () => {
    const css = await stylesheet();
    const appRatio = 76 / 124;

    const sizes = [...css.matchAll(/\.cover-editor__viewport \{[\s\S]*?width: (\d+)px;\s*height: (\d+)px;/g)]
      .map(([, w, h]) => ({ w: Number(w), h: Number(h) }));

    console.log("пропорция клиента:", appRatio.toFixed(4));
    expect(sizes.length).toBeGreaterThanOrEqual(3);

    for (const { w, h } of sizes) {
      const drift = Math.abs(w / h - appRatio) / appRatio;
      console.log(`  окно ${w}x${h}: расхождение ${(drift * 100).toFixed(1)}%`);
      expect(drift, `окно ${w}x${h} показывает чужую обрезку`).toBeLessThan(0.02);
    }
  });

  it("окно и результат подписаны — иначе непонятно, куда смотреть", async () => {
    const source = await readFile(SOURCE, "utf-8");
    console.log("подписи на месте:", source.includes("Кадр крупным планом"), source.includes("Так увидит клиент"));
    expect(source).toContain("Кадр крупным планом");
    expect(source).toContain("Так увидит клиент");
  });
});
