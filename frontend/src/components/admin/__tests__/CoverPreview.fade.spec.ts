/**
 * Белый наплыв на фото в редакторе обложки.
 *
 * Наплыв растворяет правый край фото в фоне карточки — это часть дизайна
 * витрины. В редакторе он мешает: по краю кадра видно, обрезано фото или
 * просто забелено, а сравнить с соседями нельзя, если у одних наплыв есть,
 * а у других нет.
 *
 * Поэтому в редакторе наплыв выключен у ВСЕХ четырёх фото, а у клиента
 * остаётся: компонент общий, и витрину ломать нельзя.
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

describe("Наплыв в редакторе обложки", () => {
  it("в редакторе наплыва нет ни на одном фото", () => {
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

    // Четыре фото: окно работы и три карточки — и ни одного наплыва.
    expect(all.length).toBe(4);
    expect(faded.length).toBe(0);
    w.unmount();
  });

  it("у витрины наплыв остаётся — компонент общий", async () => {
    /* Здесь легко сломать клиента: выключив наплыв в компоненте целиком,
       мы убрали бы его и из ленты покупателя. */
    const fade = await readFile("src/components/product/ImageFade.vue", "utf-8");
    console.log("по умолчанию:",
      fade.match(/manual: false, fade: [a-z]+/)?.[0]);

    expect(fade).toContain("fade: true");

    // Витрина проп не передаёт, значит остаётся значение по умолчанию.
    for (const file of [
      "src/components/product/liquid/LiquidLineCard.vue",
      "src/components/product/GroupLineItem.vue",
    ]) {
      const source = await readFile(file, "utf-8");
      const tags = source.match(/<ImageFade[\s\S]*?\/>/g) ?? [];
      console.log(file.split("/").pop(), "| фото:", tags.length,
        "| передаёт fade:", tags.filter((t) => t.includes("fade")).length);

      expect(tags.length).toBeGreaterThan(0);
      // Ни одно фото витрины проп не передаёт — работает умолчание.
      expect(tags.some((t) => t.includes(":fade"))).toBe(false);
    }
  });

  it("наплыв можно вернуть одним пропом", async () => {
    /* Пользователь просил «посмотрим как будет» и сказал, что вернёт.
       Проп fade — то место, где это делается: убираем :fade="false"
       в редакторе, и наплыв снова на месте. */
    const source = await readFile("src/components/admin/CoverPreview.vue", "utf-8");
    const count = (source.match(/:fade="false"/g) || []).length;
    console.log("выключений наплыва в редакторе:", count);

    expect(count).toBe(4);
    // И все четыре — на компоненте фото, а не в другом месте.
    expect((source.match(/<ImageFade[\s\S]*?\/>/g) || []).length).toBe(4);
  });
});
