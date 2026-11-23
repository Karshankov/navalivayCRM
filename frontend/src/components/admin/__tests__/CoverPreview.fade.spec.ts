/**
 * Белый наплыв на фото: есть везде, но едва заметный.
 *
 * Наплыв смягчает стык фото с карточкой. Его убирали совсем, потом
 * усиливали, теперь ослабили почти до прозрачного: раньше правый край
 * закрывался белым полностью, и картинка у края пропадала.
 *
 * Тест сторожит главное: край не должен снова стать сплошным белым, иначе
 * фото у края перестанет быть видно. И что наплыв стоит на каждом фото —
 * и у клиента, и в редакторе, иначе превью показывает не то, что видит
 * покупатель. Отдельно проверяется обрезка: наплыв — оформление поверх
 * неё, а не замена.
 */
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { readFile } from "node:fs/promises";
import CoverPreview, { type CoverNeighbour } from "@/components/admin/CoverPreview.vue";

function neighbour(id: string, name: string): CoverNeighbour {
  return {
    id,
    name,
    coverImage: `/api/category-groups/${id}/cover`,
    coverZoom: 170,
    coverShift: 10,
    coverOffsetY: 14,
    coverManual: true,
  };
}

async function imageFadeSource(): Promise<string> {
  return readFile("src/components/product/ImageFade.vue", "utf-8");
}

function fadeRule(source: string): string {
  const rule = source.slice(
    source.indexOf(".image-fade__fade {"),
    source.indexOf("}", source.indexOf(".image-fade__fade {")),
  );
  return rule.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Плотность нижнего наплыва: первая точка градиента `0deg`. */
function bottomDensity(rule: string): number | null {
  const bottom = rule.slice(Math.max(0, rule.search(/\(\s*0deg/)));
  return Number(bottom.match(/--fade\) (\d+)%, transparent/)?.[1] ?? NaN);
}

/** Плотность по точкам бокового градиента. Правило содержит два градиента,
 *  и у обоих точки вида `--fade) N%, transparent`. Берём только боковой:
 *  он идёт первым и содержит пять точек. */
function densities(rule: string): number[] {
  /* Ищем именно `linear-gradient(
      0deg` — иначе indexOf("0deg")
     попадает внутрь "90deg" и отрезает правило целиком. */
  const bottomStart = rule.search(/\(\s*0deg/);
  const side = bottomStart < 0 ? rule : rule.slice(0, bottomStart);
  return [...side.matchAll(/--fade\) (\d+)%, transparent/g)].map((m) => Number(m[1]));
}

/** Правило по селектору из таблицы стилей, без комментариев: в них тоже
 *  встречается `z-index: 1`, и поиск по сырому тексту читал бы комментарий
 *  вместо значения. */
function cssRule(source: string, selector: string): string {
  const start = source.indexOf(selector);
  const rule = source.slice(start, source.indexOf("}", start));
  return rule.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("Белый наплыв вернулся и стал плотнее", () => {
  it("наплыв стоит на каждом фото — и у клиента, и в редакторе", () => {
    const w = mount(CoverPreview, {
      props: {
        src: "/cover.png",
        previous: neighbour("cg_a", "ВЫШЕ"),
        next: neighbour("cg_c", "НИЖЕ"),
      },
    });

    const all = w.findAll(".image-fade");
    const faded = w.findAll(".image-fade__fade");
    console.log("фото в редакторе:", all.length, "| с наплывом:", faded.length);

    // Четыре фото — окно работы и три карточки, и на каждом свой наплыв.
    expect(all.length).toBe(4);
    expect(faded.length).toBe(4);
    w.unmount();
  });

  it("плотность — 55% от исходной", async () => {
    const rule = fadeRule(await imageFadeSource());
    const values = densities(rule);
    console.log("плотность по точкам:", values);

    /* Порядок точек: 0%, 40%, 62%, 82%, 100% (боковой градиент). */
    expect(values).toEqual([3, 3, 10, 34, 55]);

    /* Это ровно 55% от исходного: 5, 5, 18, 61, 100. Сперва поставили
       40%, затем прибавили 15. Держим пропорцию явно, чтобы значение не
       «уехало» при следующей правке. */
    const source = [5, 5, 18, 61, 100];
    console.log("исходный:", source.join(", "), "-> 55%:", values.join(", "));

    for (const [i, value] of values.entries()) {
      const expected = Math.max(1, Math.round(source[i]! * 0.55));
      expect(value, `точка ${i}: 55% от ${source[i]}`).toBe(expected);
    }
  });

  it("правый край не сплошной — фото у края остаётся видно", async () => {
    /* Раньше край закрывался на 100%, и картинка у края исчезала.
       Теперь 55% — стык смягчён, но фото видно. Порог с запасом: если
       плотность поднимут ещё, тест напомнит, что край забеливается. */
    const rule = fadeRule(await imageFadeSource());
    const edge = densities(rule)[4]!;

    console.log("плотность у правого края:", edge + "%",
      edge < 70 ? "— фото видно" : "— фото почти закрыто");

    expect(rule).not.toMatch(/var\(--fade\) 100%/);
    expect(edge).toBeLessThan(70);
  });

  it("нижний наплыв как исходно — до 32% высоты", async () => {
    const rule = fadeRule(await imageFadeSource());
    const stop = rule.match(/transparent (\d+)%/)?.[1];
    const bottom = bottomDensity(rule);
    console.log("низ:", bottom + "%", "до", stop + "% высоты");

    // Высоту вернули к исходной, плотность — 55% от исходных 55.
    expect(Number(stop)).toBe(32);
    expect(bottom).toBe(30);
    // И это тоже 55% от исходного значения.
    expect(bottom).toBe(Math.round(55 * 0.55));
  });

  it("направляющие лежат выше слоя фото", async () => {
    /* У наплыва z-index: 1, и он создаёт слой поверх остальных. По разметке
       блок линий идёт после фото, но порядок разметки уступает ненулевому
       z-index. Замерено в браузере: без явного z-index у линий блок фото
       оказывался сверху. Линии должны быть видны — иначе они бесполезны.

       Сравниваем именно с наплывом, а не с произвольным числом: если его
       z-index однажды изменится, тест это покажет. */
    const editor = await readFile("src/components/admin/CoverPreview.vue", "utf-8");
    const image = await imageFadeSource();

    const linesZ = Number(
      cssRule(editor, ".cover-editor__guide-lines {").match(/z-index:\s*(\d+)/)?.[1],
    );
    const fadeZ = Number(
      cssRule(image, ".image-fade__fade {").match(/z-index:\s*(\d+)/)?.[1],
    );

    console.log("z-index направляющих:", linesZ, "| у наплыва:", fadeZ);
    expect(fadeZ).toBeGreaterThan(0);
    expect(linesZ).toBeGreaterThan(fadeZ);
  });

  it("обрезка фото на месте — наплыв её не заменял", async () => {
    /* Если однажды уберут и обрезку, фото полезет на текст, а наплыв
       это скроет только у правого края. */
    const source = await imageFadeSource();
    const block = source.slice(source.indexOf(".image-fade {"));
    const rule = block.slice(0, block.indexOf("}"));

    console.log("обрезка:", /overflow:\s*hidden/.test(rule) ? "на месте" : "ПОТЕРЯНА");
    expect(rule).toContain("overflow: hidden");
  });

  it("витрина рисует наплыв, редактор его не выключает", async () => {
    for (const file of [
      "src/components/product/liquid/LiquidLineCard.vue",
      "src/components/product/GroupLineItem.vue",
    ]) {
      const source = await readFile(file, "utf-8");
      const tags = source.match(/<ImageFade[\s\S]*?\/>/g) ?? [];
      console.log(file.split("/").pop(), "| фото:", tags.length);
      expect(tags.length).toBeGreaterThan(0);
      // Пропа нет — работает общее поведение, наплыв включён.
      expect(tags.some((t) => t.includes("fade"))).toBe(false);
    }

    const editor = await readFile("src/components/admin/CoverPreview.vue", "utf-8");
    console.log("отключений наплыва в редакторе:", (editor.match(/:fade/g) || []).length);
    expect(editor).not.toContain(":fade");
  });
});
