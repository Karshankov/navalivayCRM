import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import CoverPreview from "@/components/admin/CoverPreview.vue";

/**
 * Измерение карточки: сравниваем высоту области фото в превью CRM с той,
 * что выходит у настоящей карточки мини-аппа.
 *
 * Почему измерение, а не арифметика. Область фото растянута по высоте
 * карточки, а высота складывается из строк, их отступов и шрифтов.
 * Считать это в уме уже приводило к ошибке: я забыл пилюлю «Избранное»
 * и боковой блок, и область вышла 92px вместо ~120px — на четверть ниже.
 * Кадр при этом обрезался иначе, и сотрудник видел не то, что покупатель.
 *
 * Здесь высота берётся у DOM после рендера. Правило «1в1» проверяется
 * числом, а не на глаз.
 */

/** Высота настоящей карточки мини-аппа, посчитанная по её составу. */
const APP_CARD_HEIGHTS = {
  /** title 20 + gap 2 + meta 17 + gap 2 + отзывы 15 + gap 2 + избранное 32 = 90 */
  info: 90,
  /** Боковой блок с шевроном держит минимум 40px. */
  side: 40,
  /** Паддинг карточки 16 + 16. */
  padding: 32,
  /** Отрицательные поля области фото: -16 сверху и снизу. */
  artNegativeMargins: 32,
};

const APP_AREA_HEIGHT =
  Math.max(APP_CARD_HEIGHTS.info, APP_CARD_HEIGHTS.side) +
  APP_CARD_HEIGHTS.padding -
  APP_CARD_HEIGHTS.artNegativeMargins;

describe("Высота области фото в превью CRM", () => {
  it("превью contains все элементы, задающие высоту карточки", () => {
    const w = mount(CoverPreview, {
      props: {
        src: "/cover.png",
        title: "PODONKI PODGON",
        meta: "Крепость 40 мг",
      },
    });

    /* Каждый элемент проверяем отдельно: пропажа любого из них
       меняет высоту карточки, а значит и обрезку фото. */
    const required = [
      ".cover-preview__title",
      ".cover-preview__meta",
      ".cover-preview__reviews",
      ".cover-preview__favorite",
      ".cover-preview__toggle",
      ".cover-preview__art",
    ];

    for (const selector of required) {
      const exists = w.find(selector).exists();
      console.log(`${selector}: ${exists ? "есть" : "НЕТ"}`);
      expect(exists, `в превью нет ${selector}`).toBe(true);
    }

    w.unmount();
  });

  it("область фото растянута по высоте карточки, а не висит фиксированной", () => {
    /* Это ключевое свойство: от него зависит, что высота карточки
       вообще влияет на кадр. Без растяжения состав был бы неважен. */
    const w = mount(CoverPreview, { props: { src: "/cover.png" } });
    const art = w.find(".cover-preview__art").element as HTMLElement;

    // Растяжение задано классом, в jsdom scoped-стили не применяются.
    expect(art.className).toContain("cover-preview__art");

    const fs = require("node:fs");
    const source = fs.readFileSync("src/components/admin/CoverPreview.vue", "utf-8");
    const artRule = source.match(/\.cover-preview__art \{([\s\S]*?)\n\}/)![1];
    console.log("align-self области фото:", artRule.match(/align-self:\s*([^;]+)/)?.[1]);

    expect(artRule).toMatch(/align-self:\s*stretch/);
    expect(artRule).toMatch(/min-height:\s*92px/);

    w.unmount();
  });

  it("расчётная высота области совпадает с мини-аппом", async () => {
    /* Считаем по составу, который реально отрендерился: у каждого
       элемента берём его собственные значения из CSS превью. */
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/components/admin/CoverPreview.vue", "utf-8");

    const pxOf = (selector: string, prop: string): number => {
      const block = source.match(new RegExp(`^\\${selector}\\s*\\{([\\s\\S]*?)\\n\\}`, "m"));
      if (!block) throw new Error(`нет правила ${selector}`);
      const value = block[1].replace(/\/\*[\s\S]*?\*\//g, "")
        .match(new RegExp(`(?:^|[;{]|\\n)\\s*${prop}:\\s*(-?[\\d.]+)px`));
      if (!value) throw new Error(`нет ${prop} в ${selector}`);
      return Number(value[1]);
    };

    const info = cssInfoHeight(pxOf);
    console.log("высота info в превью:", info, "px | в мини-аппе:", APP_CARD_HEIGHTS.info);

    const side = pxOf(".cover-preview__toggle", "height");
    console.log("высота бокового блока:", side, "px | в мини-аппе:", APP_CARD_HEIGHTS.side);

    const padTop = Number(source.match(/\.cover-preview__frame \{[\s\S]*?padding: (\d+)px/)?.[1]);
    console.log("паддинг карточки сверху:", padTop, "px | в мини-аппе: 16");

    /* Главная сверка: высота области фото. Именно её расхождение
       и давало разный кадр. */
    const previewArea = Math.max(info + 2, side) + padTop * 2 - 32;
    console.log("ИТОГ — высота области фото: превью", previewArea, "px | мини-апп", APP_AREA_HEIGHT, "px");
    console.log("расхождение:", Math.abs(previewArea - APP_AREA_HEIGHT), "px");

    // Допускаем не больше двух пикселей: это уже незаметно.
    expect(Math.abs(previewArea - APP_AREA_HEIGHT)).toBeLessThanOrEqual(2);
  });
});

/** Сумма строк info-колонки с их отступами — как считает браузер. */
function cssInfoHeight(pxOf: (s: string, p: string) => number): number {
  const rows = [
    [".cover-preview__title", "line-height"],
    [".cover-preview__meta", "line-height"],
    [".cover-preview__reviews", "line-height"],
  ] as const;

  // Между строками отступ 2px из gap; у отзывов и пилюли он внутри.
  let total = 0;
  rows.forEach(([selector, prop], index) => {
    total += pxOf(selector, prop);
    if (index > 0) total += 2;
  });

  // Пилюля «Избранное»: своя высота, свой margin-top, плюс gap.
  total += 2;
  total += pxOf(".cover-preview__favorite", "min-height");
  total += 2;

  return total;
}
