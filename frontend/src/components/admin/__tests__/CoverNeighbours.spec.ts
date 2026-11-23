/**
 * Соседи для направляющих: как форма собирает данные о них.
 *
 * В админском списке нет готового адреса обложки — приходит только флаг
 * hasCoverImage. Если взять оттуда coverImage напрямую, он окажется пустым
 * и направляющие покажут пустые места: сравнивать станет не с чем, а
 * колонка превратится в украшение.
 */
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const SOURCE = "src/components/admin/AdminCategoryGroupForm.vue";

describe("Соседи линейки для направляющих", () => {
  it("адрес обложки собирается из флага, а не берётся напрямую", async () => {
    const source = await readFile(SOURCE, "utf-8");

    console.log("сборка адреса:", source.includes("/api/category-groups/"));
    expect(source).toContain("/api/category-groups/");

    /* Прямое `coverImage: group.coverImage ?? null` и было ошибкой:
       в списке это поле пустое. */
    expect(source).not.toMatch(/coverImage:\s*group\.coverImage\s*\?\?\s*null/);
    expect(source).toContain("hasCoverImage");
  });

  it("проверка на пустую обложку стоит до сборки адреса", async () => {
    /* Если линейка без обложки, адрес собирать не из чего: запрос вернул
       бы ошибку, а в колонке появилась бы сломанная картинка вместо
       честного плейсхолдера. */
    const source = await readFile(SOURCE, "utf-8");
    const block = source.slice(source.indexOf("const coverNeighbours"));
    const fn = block.slice(0, block.indexOf("const toNeighbour"));

    console.log("условие:", fn.match(/if \(group\.coverImage\).*/)?.[0]);
    expect(fn).toMatch(/group\.hasCoverImage\s*\?/);
  });
});
