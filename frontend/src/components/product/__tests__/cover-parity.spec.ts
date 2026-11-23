import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ImageFade from "@/components/product/ImageFade.vue";
import { useImageFadeGeometry } from "@/composables/useImageFadeGeometry";
import { ref, nextTick } from "vue";

/**
 * Сверка «1в1»: редактор в CRM и карточка мини-аппа должны считать
 * геометрию одинаково. Оба используют один компонент и один расчёт —
 * здесь это проверяется на одних и тех же входных данных.
 *
 * Область фото в мини-аппе — 76x124: ширина задана жёстко, высота
 * приходит от растяжения по карточке. Замерено в браузере, а не взято
 * из min-height: 92px — это лишь нижняя граница.
 */
async function geometryFor(
  natural: { w: number; h: number },
  props: Record<string, unknown>,
  area = { w: 76, h: 124 },
) {
  const rect = {
    width: area.w, height: area.h,
    top: 0, left: 0, right: area.w, bottom: area.h,
    x: 0, y: 0, toJSON: () => ({}),
  };
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    return rect as DOMRect;
  };

  const wrapper = mount(ImageFade, {
    props: { src: "/cover.png", alt: "", ...props },
    attachTo: document.body,
  });
  Element.prototype.getBoundingClientRect = original;

  const img = wrapper.find("img").element as HTMLImageElement;
  Object.defineProperty(img, "naturalWidth", { value: natural.w, configurable: true });
  Object.defineProperty(img, "naturalHeight", { value: natural.h, configurable: true });
  await wrapper.find("img").trigger("load");

  const style = wrapper.find(".image-fade__img").attributes("style") ?? "";
  const m = style.match(/translate\((-?[\d.]+)%,\s*(-?[\d.]+)%\)\s*scale\(([\d.]+)\)/);
  wrapper.unmount();
  return { style, x: Number(m![1]), y: Number(m![2]), scale: Number(m![3]) };
}

describe("Сверка редактора CRM и мини-аппа", () => {
  it("видимая зона редактора повторяет пропорции области мини-аппа", async () => {
    /* Обрезка зависит от отношения сторон области, а не от её размера.
       Разойдись пропорции хоть на процент — сотрудник увидит в окне
       не тот кадр, что попадёт в карточку. */
    const APP_AREA = { w: 76, h: 124 };
    const APP_RATIO = APP_AREA.w / APP_AREA.h;

    /* Габариты заданы в CSS-классе, а не инлайном: в jsdom scoped-стили
       не применяются, поэтому читаем сам файл компонента. */
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/components/admin/CoverPreview.vue", "utf-8");

    const desktop = source.match(
      /\.cover-editor__viewport \{[\s\S]*?width: (\d+)px;\s*height: (\d+)px;/,
    );
    expect(desktop, "не нашёл габариты видимой зоны").toBeTruthy();

    const w = Number(desktop![1]);
    const h = Number(desktop![2]);
    const editorRatio = w / h;

    console.log("пропорция области мини-аппа:", APP_RATIO.toFixed(4));
    console.log(`пропорция окна редактора (${w}x${h}):`, editorRatio.toFixed(4));
    console.log(
      "расхождение, %:",
      ((Math.abs(editorRatio - APP_RATIO) / APP_RATIO) * 100).toFixed(3),
    );

    // Допуск жёсткий: расхождение около процента уже заметно на глаз.
    expect(Math.abs(editorRatio - APP_RATIO) / APP_RATIO).toBeLessThan(0.01);

    /* Пропорции обязаны сохраняться во всех вариантах окна: сотрудник
       может настраивать кадр и с телефона, а кадр должен совпасть. */
    const sizes = [...source.matchAll(/\.cover-editor__viewport \{[\s\S]*?width: (\d+)px;\s*height: (\d+)px;/g)];
    console.log("вариантов окна найдено:", sizes.length);
    expect(sizes.length).toBeGreaterThanOrEqual(3);

    for (const [, rawW, rawH] of sizes) {
      const ratio = Number(rawW) / Number(rawH);
      const drift = Math.abs(ratio - APP_RATIO) / APP_RATIO;
      console.log(`${rawW}x${rawH}: пропорция ${ratio.toFixed(4)}, расхождение ${(drift * 100).toFixed(3)}%`);
      expect(drift, `вариант ${rawW}x${rawH} разошёлся по пропорциям`).toBeLessThan(0.01);
    }
  });

  it("одинаковые пропы дают одинаковую геометрию", async () => {
    /* Ключевая гарантия: если сотрудник настроил кадр, а покупатель
       получил те же пропы — картинка обязана совпасть до процента. */
    const saved = { manual: true, zoom: 1.8, shiftX: 15, shiftY: -20 };

    // Редактор в CRM: область окна 140x170.
    const editor = await geometryFor({ w: 800, h: 800 }, saved, { w: 140, h: 170 });
    // Карточка мини-аппа: область 76x124.
    const app = await geometryFor({ w: 800, h: 800 }, saved, { w: 76, h: 124 });

    console.log("редактор CRM:", editor);
    console.log("карточка мини-аппа:", app);

    /* В ручном режиме масштаб задан сотрудником и не зависит от области.
       Сдвиги пересчитываются в проценты от области и тоже совпадают. */
    expect(editor.scale).toBe(app.scale);
    expect(editor.x).toBe(app.x);
    expect(editor.y).toBe(app.y);
  });

  it("масштаб в ручном режиме не зависит от габаритов окна", async () => {
    const small = await geometryFor({ w: 800, h: 800 }, { manual: true, zoom: 2.5 }, { w: 76, h: 124 });
    const big = await geometryFor({ w: 800, h: 800 }, { manual: true, zoom: 2.5 }, { w: 300, h: 360 });

    console.log("малое окно:", small.scale, "| большое окно:", big.scale);
    expect(small.scale).toBe(big.scale);
  });

  it("автоподбор наоборот зависит от области — в этом его смысл", async () => {
    /* Автоматический режим считается от габаритов области: он вписывает
       фото. Ручной режим от них не зависит. */
    const small = await geometryFor({ w: 800, h: 800 }, {}, { w: 76, h: 124 });
    const big = await geometryFor({ w: 800, h: 800 }, {}, { w: 300, h: 360 });

    console.log("авто, малое окно:", small, "| авто, большое:", big);
    expect(small.scale).not.toBe(big.scale);
  });

  it("сохранённые значения из базы воспроизводятся без потерь", async () => {
    /* Значения, которые вернул сервер для линейки PODONKI:
       zoom=180, shift=15, offset_y=-20, manual=true. */
    const zoom = 180;
    const shiftX = 15;
    const shiftY = -20;

    const w = await geometryFor(
      { w: 1024, h: 1024 },
      { manual: true, zoom: zoom / 100, shiftX, shiftY },
    );
    console.log("воспроизведено:", w);

    expect(w.scale).toBeCloseTo(1.8, 5);
    // Сдвиг вправо на 15% двигает фото вправо — знак без переворота.
    expect(w.x).toBeGreaterThan(0);
    // Сдвиг вверх на 20% двигает фото вверх.
    expect(w.y).toBeLessThan(0);
  });
});
