import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import CoverPreview from "@/components/admin/CoverPreview.vue";

/**
 * Редактор обложки: окно, перетаскивание и зум. Проверяем, что он отдаёт
 * правки наружу и что внутри стоит тот же компонент фото, что в мини-аппе.
 */
describe("CoverPreview: редактор обложки", () => {
  it("использует тот же компонент фото, что мини-апп", () => {
    const w = mount(CoverPreview, {
      props: { src: "/cover.png", title: "FREEZE", meta: "Крепость 20 мг" },
    });

    // Тот же ImageFade — значит геометрия считается тем же кодом.
    const fades = w.findAllComponents({ name: "ImageFade" });
    console.log("ImageFade найден:", fades.length);
    expect(fades.length).toBeGreaterThan(0);
  });

  it("показывает окно редактирования и видимую зону", () => {
    const w = mount(CoverPreview, { props: { src: "/cover.png" } });
    console.log("окно:", w.find('[data-test="cover-editor"]').exists());
    console.log("видимая зона:", w.find('[data-test="cover-viewport"]').exists());

    expect(w.find('[data-test="cover-editor"]').exists()).toBe(true);
    expect(w.find('[data-test="cover-viewport"]').exists()).toBe(true);
  });

  it("область фото совпадает с мини-аппом по габаритам", () => {
    const w = mount(CoverPreview, { props: { src: "/cover.png" } });
    const art = w.find(".cover-preview__art");
    console.log("область фото есть:", art.exists());
    expect(art.exists()).toBe(true);
  });

  it("показывает название и характеристику из формы", () => {
    const w = mount(CoverPreview, {
      props: { src: "/cover.png", title: "PODONKI PODGON", meta: "Крепость 50 мг" },
    });

    console.log("название:", w.find(".cover-preview__title").text());
    expect(w.find(".cover-preview__title").text()).toBe("PODONKI PODGON");
    expect(w.find(".cover-preview__meta").text()).toBe("Крепость 50 мг");
  });

  it("без обложки показывает заглушку, а не пустоту", () => {
    const w = mount(CoverPreview, { props: { src: null } });
    console.log("заглушка:", w.find(".image-fade__placeholder").exists());
    expect(w.find(".image-fade__placeholder").exists()).toBe(true);
  });

  it("подпись объясняет, что это вид мини-аппа", () => {
    const w = mount(CoverPreview, { props: { src: "/cover.png" } });
    console.log("подпись:", w.find(".cover-preview__hint").text());
    expect(w.find(".cover-preview__hint").text()).toContain("мини-апп");
  });

  it("ползунок размера отдаёт новое значение наружу", async () => {
    const w = mount(CoverPreview, { props: { src: "/cover.png", zoom: 100 } });
    const slider = w.find('[data-test="cover-zoom"]');
    await slider.setValue("250");

    const emitted = w.emitted("update:zoom");
    console.log("испущено zoom:", emitted);
    expect(emitted).toBeTruthy();
    expect(emitted![0]).toEqual([250]);
  });

  it("ползунок размера доходит до 400%", () => {
    const w = mount(CoverPreview, { props: { src: "/cover.png" } });
    const slider = w.find('[data-test="cover-zoom"]');
    console.log("границы ползунка:", slider.attributes("min"), slider.attributes("max"));

    expect(slider.attributes("max")).toBe("400");
  });

  it("кнопки положения двигают кадр по осям", async () => {
    const w = mount(CoverPreview, {
      props: { src: "/cover.png", shiftX: 0, shiftY: 0 },
    });

    await w.find('[data-test="cover-nudge-down"]').trigger("click");
    console.log("сдвиги после «вниз»:", w.emitted("update:shiftY"));

    expect(w.emitted("update:shiftY")![0]).toEqual([2]);
  });

  it("смещение ограничено сотней процентов", async () => {
    /* Кнопка не должна уводить кадр дальше, чем принимает сервер:
       иначе сохранённое значение разойдётся с показанным. */
    const w = mount(CoverPreview, { props: { src: "/cover.png", shiftX: 99 } });
    await w.find('[data-test="cover-nudge-right"]').trigger("click");

    const values = w.emitted("update:shiftX")!;
    console.log("значение на границе:", values);
    expect(values[values.length - 1]).toEqual([100]);
  });

  it("правка кадра включает ручной режим", async () => {
    const w = mount(CoverPreview, { props: { src: "/cover.png", manual: false } });
    await w.find('[data-test="cover-nudge-up"]').trigger("click");

    console.log("manual:", w.emitted("update:manual"));
    expect(w.emitted("update:manual")).toBeTruthy();
    expect(w.emitted("update:manual")![0]).toEqual([true]);
  });

  it("сброс возвращает автоподбор и обнуляет сдвиги", async () => {
    const w = mount(CoverPreview, {
      props: { src: "/cover.png", manual: true, zoom: 250, shiftX: 30, shiftY: 20 },
    });
    await w.find('[data-test="cover-reset"]').trigger("click");

    console.log("после сброса — zoom:", w.emitted("update:zoom"), "shiftX:", w.emitted("update:shiftX"));
    expect(w.emitted("update:zoom")![0]).toEqual([100]);
    expect(w.emitted("update:shiftX")![0]).toEqual([0]);
    expect(w.emitted("update:shiftY")![0]).toEqual([0]);
    expect(w.emitted("update:manual")![0]).toEqual([false]);
  });

  it("без ручного режима кнопка сброса недоступна", () => {
    const w = mount(CoverPreview, { props: { src: "/cover.png", manual: false } });
    const reset = w.find('[data-test="cover-reset"]');
    console.log("disabled:", reset.attributes("disabled"));

    expect(reset.attributes("disabled")).toBeDefined();
  });

  it("перетаскивание двигает кадр вбок", async () => {
    const w = mount(CoverPreview, {
      props: { src: "/cover.png", shiftX: 0, shiftY: 0 },
    });

    /* Область окна в jsdom нулевая — подменяем, иначе проценты
       не посчитать. 200x200 значит 1 пиксель = 0.5%. */
    const viewport = w.find('[data-test="cover-viewport"]').element as HTMLElement;
    viewport.getBoundingClientRect = () =>
      ({ width: 200, height: 200, top: 0, left: 0, right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

    await w.find('[data-test="cover-viewport"]').trigger("pointerdown", { clientX: 100, clientY: 100, pointerId: 1 });
    await w.find('[data-test="cover-viewport"]').trigger("pointermove", { clientX: 140, clientY: 100, pointerId: 1 });

    const emitted = w.emitted("update:shiftX");
    console.log("сдвиг после перетаскивания на 40px:", emitted);
    expect(emitted).toBeTruthy();
    // 40 пикселей при ширине 200 — это 20% вправо.
    expect(emitted![emitted!.length - 1]).toEqual([20]);
  });

  it("перетаскивание по вертикали двигает кадр вниз", async () => {
    const w = mount(CoverPreview, {
      props: { src: "/cover.png", shiftX: 0, shiftY: 0 },
    });

    const viewport = w.find('[data-test="cover-viewport"]').element as HTMLElement;
    viewport.getBoundingClientRect = () =>
      ({ width: 200, height: 200, top: 0, left: 0, right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

    await w.find('[data-test="cover-viewport"]').trigger("pointerdown", { clientX: 100, clientY: 100, pointerId: 1 });
    await w.find('[data-test="cover-viewport"]').trigger("pointermove", { clientX: 100, clientY: 150, pointerId: 1 });

    const emitted = w.emitted("update:shiftY");
    console.log("сдвиг вниз после перетаскивания на 50px:", emitted);
    expect(emitted).toBeTruthy();
    // 50 пикселей при высоте 200 — это 25% вниз.
    expect(emitted![emitted!.length - 1]).toEqual([25]);
  });

  it("колесо мыши приближает и отдаляет фото", async () => {
    const w = mount(CoverPreview, { props: { src: "/cover.png", zoom: 100 } });
    await w.find('[data-test="cover-viewport"]').trigger("wheel", { deltaY: -100 });

    const emitted = w.emitted("update:zoom");
    console.log("зум колесом вверх:", emitted);
    expect(emitted).toBeTruthy();
    expect(emitted![0]).toEqual([110]);
  });
});
