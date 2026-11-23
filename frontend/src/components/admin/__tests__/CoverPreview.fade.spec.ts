/**
 * Наплыва на фото нет нигде: ни в редакторе, ни у клиента.
 *
 * Белый наплыв растворял правый край и низ фото в фоне карточки. Сначала
 * его выключили в редакторе, потом убрали совсем — держать выключенный
 * механизм и проп ради него незачем.
 *
 * Тест сторожит именно это: наплыв не должен вернуться ни в разметку, ни
 * в стили. Если однажды понадобится снова — это осознанная правка, и тест
 * скажет, что делает.
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

const CLIENT_FILES = [
  "src/components/product/liquid/LiquidLineCard.vue",
  "src/components/product/GroupLineItem.vue",
];

describe("Белый наплыв убран", () => {
  it("в компоненте фото нет ни разметки, ни стилей наплыва", async () => {
    const source = await readFile("src/components/product/ImageFade.vue", "utf-8");
    console.log("упоминаний наплыва:", (source.match(/image-fade__fade|fade\?:/g) || []).length);

    expect(source).not.toContain("image-fade__fade");
    expect(source).not.toContain("fade?:");
    // И градиенты, которые его рисовали.
    expect(source).not.toContain("--fade");
  });

  it("в редакторе обложки наплыва тоже нет", async () => {
    const source = await readFile("src/components/admin/CoverPreview.vue", "utf-8");
    console.log("пропов fade в редакторе:", (source.match(/:fade/g) || []).length);
    expect(source).not.toContain(":fade");
  });

  it("ни одно фото не рисует наплыв", () => {
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

    expect(all.length).toBe(4);
    expect(faded.length).toBe(0);
    w.unmount();
  });

  it("витрина тоже без наплыва — фото не растворяется", async () => {
    /* Это и была просьба: убрать дымку у клиента. Проверяем, что фото
       витрины идёт без слоя наплыва. */
    for (const file of CLIENT_FILES) {
      const source = await readFile(file, "utf-8");
      const tags = source.match(/<ImageFade[\s\S]*?\/>/g) ?? [];
      console.log(file.split("/").pop(), "| фото:", tags.length);
      expect(tags.length).toBeGreaterThan(0);
      // Пропа fade не осталось нигде.
      expect(tags.some((t) => t.includes("fade"))).toBe(false);
    }
  });

  it("обрезка фото осталась — наплыв её не заменял", async () => {
    /* Наплыв был оформлением поверх обрезки, а не самой обрезкой. Если
       убрать и её, фото полезет на текст. */
    const source = await readFile("src/components/product/ImageFade.vue", "utf-8");
    const block = source.slice(source.indexOf(".image-fade {"));
    const rule = block.slice(0, block.indexOf("}"));

    console.log("обрезка:", /overflow:\s*hidden/.test(rule) ? "на месте" : "ПОТЕРЯНА");
    expect(rule).toContain("overflow: hidden");
  });
});
