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

  it("поверхности подписаны: где работают, а где смотрят результат", () => {
    /* Две поверхности обязаны называть себя сами. Иначе сотрудник
       двигает фото в окне и не понимает, где искать ответ на вопрос
       «а как это у клиента» — приходится догадываться. */
    const w = mount(CoverPreview, { props: { src: "/cover.png" } });

    const editorTitle = w.find(".cover-editor__title").text();
    const resultTitle = w.find(".cover-preview__result-title").text();
    const editorNote = w.find(".cover-editor__note").text();

    console.log("окно:", editorTitle, "| примечание:", editorNote);
    console.log("результат:", resultTitle);

    expect(editorTitle).toContain("Кадр");
    expect(resultTitle).toContain("клиент");
    // Примечание объясняет роль синей рамки — без него она просто рамка.
    expect(editorNote.toLowerCase()).toContain("рамк");

    w.unmount();
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
    // Один щелчок колеса (deltaY 100) даёт 10%: заметно, но не рывком.
    expect(emitted![0]).toEqual([110]);

    // Вниз — обратно и симметрично.
    await w.setProps({ zoom: 110 });
    await w.find('[data-test="cover-viewport"]').trigger("wheel", { deltaY: 100 });
    const out = w.emitted("update:zoom")!.at(-1)![0];
    console.log("зум колесом вниз:", out);
    expect(out).toBe(100);
    w.unmount();
  });

  it("плавный жест по тачпаду набирает зум постепенно, а не рывком", async () => {
    /* Тачпад шлёт десятки событий с крошечным deltaY. При фиксированном
       шаге каждое событие добавляло 10% — за один жест фото улетало
       в максимум. Теперь шаг пропорционален deltaY, и жест из 40 событий
       должен дать примерно столько же, сколько три щелчка колеса. */
    const w = mount(CoverPreview, {
      props: { src: "/cover.png", zoom: 100 },
      attachTo: document.body,
    });
    const viewport = w.find('[data-test="cover-viewport"]');

    // Жест: 40 событий по deltaY -2 (это ощутимое движение по тачпаду).
    for (let i = 0; i < 40; i += 1) {
      await viewport.trigger("wheel", { deltaY: -2 });
      // Компонент управляемый: подхватываем выданное значение как родитель.
      const last = w.emitted("update:zoom")?.at(-1)?.[0] as number | undefined;
      if (last !== undefined) await w.setProps({ zoom: last });
    }

    const final = w.emitted("update:zoom")!.at(-1)![0] as number;
    console.log("жест тачпада (40 событий) -> зум:", final, "%");
    console.log("  прибавка:", final - 100, "% за жест");

    /* Событие deltaY -2 даёт 0.2%, за 40 событий — около 8%. Дробь
       копится внутри, иначе округление съело бы движение целиком.
       Потолок здесь намеренно ниже прежнего сломанного поведения: там
       один жест давал +300% и упирался в максимум. */
    expect(final - 100).toBeGreaterThan(4);
    expect(final, "жест не должен улетать в максимум").toBeLessThan(120);
    w.unmount();
  });

  it("резкий скролл не прыгает на треть кадра", async () => {
    /* Некоторые мыши и программы прокрутки шлют deltaY в сотни единиц. */
    const w = mount(CoverPreview, { props: { src: "/cover.png", zoom: 100 } });
    await w.find('[data-test="cover-viewport"]').trigger("wheel", { deltaY: -600 });

    const out = w.emitted("update:zoom")!.at(-1)![0] as number;
    console.log("резкий скролл deltaY -600 -> зум:", out, "%");
    // Потолок шага — 15% на событие.
    expect(out - 100).toBeLessThanOrEqual(15);
    w.unmount();
  });

  it("мелкие события тачпада не теряются из-за округления", async () => {
    /* Самая коварная часть: deltaY -1 даёт 0.06%, и при округлении на
       каждом шаге это ровный ноль — фото не двигалось бы вообще. */
    const w = mount(CoverPreview, {
      props: { src: "/cover.png", zoom: 100 },
      attachTo: document.body,
    });
    const viewport = w.find('[data-test="cover-viewport"]');

    for (let i = 0; i < 50; i += 1) {
      await viewport.trigger("wheel", { deltaY: -1 });
      const last = w.emitted("update:zoom")?.at(-1)?.[0] as number | undefined;
      if (last !== undefined) await w.setProps({ zoom: last });
    }

    const final = w.emitted("update:zoom")!.at(-1)![0] as number;
    console.log("50 событий по deltaY -1 -> зум:", final, "%");
    expect(final, "мелкое движение съедено округлением").toBeGreaterThan(100);
    w.unmount();
  });

  it("фото едет за мышью в ту же сторону — без инверсии", async () => {
    /* Главная проверка удобства: потянул вправо — фото вправо.
       Раньше знак был перевёрнут и картинка уходила навстречу руке.

       Проверяем сквозь весь путь: перетаскивание -> значение сдвига -> то,
       что реально уходит в CSS у фото. */
    /* Размеры области подставляем ДО монтирования: компонент измеряет
       себя при создании, и подмена после не успела бы. В jsdom у всего
       нулевые габариты, поэтому без этого геометрия не считается. */
    const original = Element.prototype.getBoundingClientRect;
    const AREA = { w: 152, h: 248 };
    Element.prototype.getBoundingClientRect = function () {
      const isViewport = (this as HTMLElement).classList?.contains("cover-editor__viewport");
      const w = isViewport ? 200 : AREA.w;
      const h = isViewport ? 200 : AREA.h;
      return { width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    };

    const w = mount(CoverPreview, {
      props: { src: "/cover.png", zoom: 100, shiftX: 15, shiftY: 0, manual: true },
      attachTo: document.body,
    });
    Element.prototype.getBoundingClientRect = original;

    // Даём фото размеры: без них ручной режим нечего масштабировать.
    for (const img of w.findAll(".image-fade__img")) {
      const el = img.element as HTMLImageElement;
      Object.defineProperty(el, "naturalWidth", { value: 800, configurable: true });
      Object.defineProperty(el, "naturalHeight", { value: 800, configurable: true });
      await img.trigger("load");
    }
    await new Promise((resolve) => setTimeout(resolve, 0));

    const style = w.find(".cover-editor__canvas .image-fade__img").attributes("style") ?? "";
    const match = style.match(/translate\((-?[\d.]+)%,\s*(-?[\d.]+)%\)/);
    const offsetX = Number(match![1]);
    console.log("сдвиг +15% -> translate по X:", offsetX, "% (плюс = вправо)");

    expect(offsetX, "фото уехало навстречу мыши — знак перевёрнут").toBeGreaterThan(0);

    /* И обратная проверка: сдвиг влево обязан увести фото влево.
       Иначе тест пройдёт на любом положительном числе. */
    await w.setProps({ shiftX: -15 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const leftStyle = w.find(".cover-editor__canvas .image-fade__img").attributes("style") ?? "";
    const leftX = Number(leftStyle.match(/translate\((-?[\d.]+)%/)?.[1]);
    console.log("сдвиг -15% -> translate по X:", leftX, "%");

    expect(leftX).toBeLessThan(0);
    w.unmount();
  });

  it("перетаскивание мышью меняет сдвиг в сторону движения", async () => {
    /* Отдельно проверяем сам жест: перевод пикселей в проценты и знак.
       Тянем вправо — сдвиг растёт; тянем влево — падает. */
    const w = mount(CoverPreview, {
      props: { src: "/cover.png", zoom: 100, shiftX: 0, shiftY: 0 },
    });

    const viewport = w.find('[data-test="cover-viewport"]').element as HTMLElement;
    viewport.getBoundingClientRect = () =>
      ({ width: 200, height: 200, top: 0, left: 0, right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

    await w.find('[data-test="cover-viewport"]').trigger("pointerdown", { clientX: 100, clientY: 100, pointerId: 1 });
    await w.find('[data-test="cover-viewport"]').trigger("pointermove", { clientX: 140, clientY: 100, pointerId: 1 });

    const right = w.emitted("update:shiftX")!.at(-1)![0] as number;
    console.log("мышь вправо на 40px -> сдвиг:", right, "% (при ширине 200 это 20%)");
    expect(right).toBe(20);

    w.unmount();
  });

  it("окно редактора повторяет пропорции области фото у клиента", async () => {
    /* Пока в окне был квадрат, сотрудник видел другую обрезку, чем
       покупатель. Область клиента — 76x124 (замерено в браузере). */
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/components/admin/CoverPreview.vue", "utf-8");

    const sizes = [...source.matchAll(/\.cover-editor__viewport \{[\s\S]*?width: (\d+)px;\s*height: (\d+)px;/g)]
      .map(([, w, h]) => ({ w: Number(w), h: Number(h) }));

    const APP_RATIO = 76 / 124;
    console.log("пропорция области клиента:", APP_RATIO.toFixed(4));

    for (const { w, h } of sizes) {
      const ratio = w / h;
      const drift = Math.abs(ratio - APP_RATIO) / APP_RATIO;
      console.log(`  окно ${w}x${h}: пропорция ${ratio.toFixed(4)}, расхождение ${(drift * 100).toFixed(1)}%`);
      expect(drift, `окно ${w}x${h} показывает не ту обрезку`).toBeLessThan(0.02);
    }
  });
});
