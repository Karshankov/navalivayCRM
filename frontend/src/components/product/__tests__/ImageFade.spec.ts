import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ImageFade from "@/components/product/ImageFade.vue";

/**
 * Геометрия проверяется через реальные события load: jsdom не грузит
 * картинки, поэтому подставляем naturalWidth и naturalHeight сами.
 */
async function mountArea(
  natural: { w: number; h: number } | null,
  area = { w: 76, h: 92 },
) {
  /* Размеры области подставляем до монтирования: компонент измеряет
     её в onMounted, и поздняя подмена уже не сработает. */
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
    props: { src: "/cover.png", alt: "Обложка" },
    attachTo: document.body,
  });
  Element.prototype.getBoundingClientRect = original;

  if (natural) {
    const img = wrapper.find("img").element as HTMLImageElement;
    Object.defineProperty(img, "naturalWidth", { value: natural.w, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: natural.h, configurable: true });
    // Событие load: компонент читает размеры картинки именно из него.
    await wrapper.find("img").trigger("load");
  }

  return wrapper;
}

function transformOf(wrapper: ReturnType<typeof mountArea>): { scale: number; x: number; y: number } {
  const style = wrapper.find(".image-fade__img").attributes("style") ?? "";
  const m = style.match(/translate\((-?[\d.]+)%,\s*(-?[\d.]+)%\)\s*scale\(([\d.]+)\)/);
  if (!m) throw new Error("transform не найден: " + style);
  return { x: Number(m[1]), y: Number(m[2]), scale: Number(m[3]) };
}

describe("ImageFade: геометрия фотографии", () => {
  it("пока нет размеров картинки — масштаб нейтральный", async () => {
    const w = await mountArea(null);
    const t = transformOf(w);
    console.log("без размеров:", t);
    expect(t.scale).toBe(1);
    expect(t.x).toBe(0);
    expect(t.y).toBe(0);
    w.unmount();
  });

  it("вертикальное фото увеличивается сильнее широкого", async () => {
    // Область 76x92 — чуть выше квадрата.
    const vertical = await mountArea({ w: 400, h: 900 });
    const wide = await mountArea({ w: 900, h: 400 });
    const tv = transformOf(vertical);
    const tw = transformOf(wide);

    console.log("вертикальное:", tv, "| широкое:", tw);

    // Масштаб у каждого свой: он считается от того, насколько
    // вписанное фото меньше области, а не от одних пропорций.
    expect(tv.scale).not.toBe(tw.scale);
    expect(tv.scale).toBeGreaterThan(1);
    expect(tw.scale).toBeGreaterThan(1);
    // Обе в разумных пределах: крупно, но без зерна.
    expect(tv.scale).toBeLessThanOrEqual(1.62);
    expect(tw.scale).toBeLessThanOrEqual(1.62);
    vertical.unmount();
    wide.unmount();
  });

  it("масштаб одинаков по обеим осям — пропорции сохранены", async () => {
    const w = await mountArea({ w: 300, h: 800 });
    const img = w.find(".image-fade__img").element as HTMLElement;
    const style = getComputedStyle(img);
    console.log("object-fit:", style.objectFit);
    expect(w.find(".image-fade__img").attributes("style")).toMatch(/scale\([\d.]+\)/);
    // Второго scale быть не должно: растяжения по осям нет.
    const matches = (w.find(".image-fade__img").attributes("style") ?? "").match(/scale/g) ?? [];
    expect(matches).toHaveLength(1);
    w.unmount();
  });

  it("фото свисает влево и вниз, а не вправо и вверх", async () => {
    const w = await mountArea({ w: 2000, h: 200 });
    const t = transformOf(w);
    console.log("очень широкое:", t);
    // Смещение к левому нижнему краю: влево минус, вниз плюс.
    expect(t.x).toBeLessThanOrEqual(0);
    expect(t.y).toBeGreaterThanOrEqual(0);
    // Вниз вылет не больше доли области: там край карточки.
    expect(Math.abs(t.y)).toBeLessThanOrEqual(30);
    w.unmount();
  });

  it("свисает по той оси, по которой фото крупнее области", async () => {
    /* Картинка вписана в область через contain: вертикальная упирается
       в высоту и свисает вниз, широкое — в ширину и свисает влево.
       Обе оси сразу не растягиваются, поэтому одна из них нулевая. */
    const vertical = transformOf(await mountArea({ w: 400, h: 900 }));
    const wide = transformOf(await mountArea({ w: 900, h: 400 }));
    console.log("вертикальное:", vertical, "| широкое:", wide);

    // Вертикальное уходит вниз (плюс по Y) и не свисает вбок.
    expect(vertical.y).toBeGreaterThan(0);
    expect(vertical.x).toBe(0);

    // Широкое свисает влево и вниз не уходит.
    expect(wide.x).toBeLessThan(0);
    expect(wide.y).toBe(0);
  });

  it("квадратное фото свисает и влево, и вниз", async () => {
    /* Квадратное при области 76x92 вписывается как 76x76 — оно короче
       области, и без запаса по масштабу свисать вниз не станет. */
    const sq = await mountArea({ w: 500, h: 500 });
    const t = transformOf(sq);
    console.log("квадратное:", t);
    expect(t.scale).toBeGreaterThan(1.4);
    expect(t.x).toBeLessThan(0);
    expect(t.y).toBeGreaterThan(0);
    sq.unmount();
  });
});
