import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

/**
 * Сторож против потери полей обложки на пути от API до карточки.
 *
 * Поля расположения кадра проходят через несколько мест, где объект
 * группы собирается заново. Если в одном из них поле не перечислено,
 * оно молча теряется: сотрудник в CRM видит свой кадр, а покупатель —
 * автоподбор. Так уже случилось с coverOffsetY и coverManual в
 * CategoryView.vue — тест это и стережёт.
 *
 * Пропs карточки: coverZoom, coverShift, coverOffsetY, coverManual.
 */
const COVER_FIELDS = ["coverZoom", "coverShift", "coverOffsetY", "coverManual"];

const SOURCES = [
  "src/stores/catalog.ts",
  "src/views/CategoryView.vue",
];

describe("Поля обложки не теряются по пути к карточке", () => {
  for (const file of SOURCES) {
    it(`${file}: перечислены все поля расположения кадра`, async () => {
      const source = await readFile(file, "utf-8");

      /* Ищем блок, где группа собирается заново: там рядом стоят
         coverImage и поля кадра. Если блока нет — файл строит группы
         через spread, и терять нечего. */
      const buildsGroup = source.includes("coverImage:");
      if (!buildsGroup) {
        console.log(`${file}: группы собираются через spread — пропускаем`);
        return;
      }

      const missing = COVER_FIELDS.filter((field) => !source.includes(`${field}:`));
      console.log(`${file} — найдены поля:`, COVER_FIELDS.filter((f) => source.includes(`${f}:`)));
      console.log(`${file} — не найдены:`, missing);

      expect(missing, `${file} теряет поля: ${missing.join(", ")}`).toEqual([]);
    });
  }

  it("карточка мини-аппа принимает все поля расположения кадра", async () => {
    /* Если карточка не объявит проп, значение не долетит до ImageFade
       даже когда оно есть в группе. */
    const card = await readFile("src/components/product/liquid/LiquidLineCard.vue", "utf-8");

    const propNames = ["coverZoom", "coverShift", "coverOffsetY", "coverManual"];
    const missing = propNames.filter((name) => !card.includes(`${name}?:`));
    console.log("пропs карточки:", propNames.filter((n) => card.includes(`${n}?:`)));

    expect(missing, `карточка без пропа: ${missing.join(", ")}`).toEqual([]);
  });

  it("ImageFade прокидывает оба сдвига в расчёт геометрии", async () => {
    const fade = await readFile("src/components/product/ImageFade.vue", "utf-8");

    // Оба сдвига и признак ручного кадра должны дойти до composable.
    for (const token of ["shiftX", "shiftY", "manual"]) {
      expect(fade, `ImageFade не передаёт ${token}`).toContain(token);
    }
    console.log("ImageFade передаёт shiftX, shiftY и manual — ок");
  });
});
