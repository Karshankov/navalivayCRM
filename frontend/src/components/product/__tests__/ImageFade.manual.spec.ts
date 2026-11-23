import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ImageFade from "@/components/product/ImageFade.vue";

/**
 * Проверяем ручной режим кадра: он задаётся сотрудником в CRM и должен
 * полностью заменять автоподбор. Заодно сторожим автоматический режим —
 * он общий с карточкой мини-аппа, и его поведение меняться не должно.
 *
 * Размеры подставляем сами: jsdom не грузит картинки.
 */
async function mountArea(
  natural: { w: number; h: number } | null,
  props: Record<string, unknown> = {},
  area = { w: 76, h: 92 },
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
    props: { src: "/cover.png", alt: "Обложка", ...props },
    attachTo: document.body,
  });
  Element.prototype.getBoundingClientRect = original;

  if (natural) {
    const img = wrapper.find("img").element as HTMLImageElement;
    Object.defineProperty(img, "naturalWidth", { value: natural.w, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: natural.h, configurable: true });
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

describe("ImageFade: ручной кадр из CRM", () => {
  it("без ручного режима работает автоподбор — прежнее поведение", async () => {
    /* Сторож против регрессии: этот же расчёт использует карточка
       мини-аппа. Если автоматический режим поедет — поедет и витрина. */
    const w = await mountArea({ w: 500, h: 500 }, { zoom: undefined });
    const t = transformOf(w);
    console.log("автоподбор:", t);

    // Автокадр: масштаб из коридора автоподбора и свисание влево-вниз.
    expect(t.scale).toBeGreaterThanOrEqual(1.08);
    expect(t.scale).toBeLessThanOrEqual(1.62);
    expect(t.x).toBeLessThan(0);
    expect(t.y).toBeGreaterThan(0);
    w.unmount();
  });

  it("ручной режим берёт масштаб как задал сотрудник", async () => {
    const w = await mountArea({ w: 500, h: 500 }, { manual: true, zoom: 2 });
    const t = transformOf(w);
    console.log("ручной 200%:", t);

    expect(t.scale).toBe(2);
    w.unmount();
  });

  it("ручной режим снимает автокадр: без правок фото по центру", async () => {
    /* Ноль сдвига должен значить «ровно по центру», иначе сотрудник не
       поймёт, от какого положения он двигает. */
    const w = await mountArea({ w: 500, h: 500 }, { manual: true, zoom: 1 });
    const t = transformOf(w);
    console.log("ручной, без сдвига:", t);

    expect(t.scale).toBe(1);
    expect(t.x).toBe(0);
    expect(t.y).toBe(0);
    w.unmount();
  });

  it("сдвиг идёт в ту же сторону, что и мышь: влево — влево, вправо — вправо", async () => {
    /* Сотрудник тащит фото вправо — фото обязано ехать вправо. Раньше
       знак был перевёрнут, и картинка уходила навстречу руке. */
    const left = transformOf(await mountArea({ w: 500, h: 500 }, { manual: true, zoom: 1, shiftX: -10 }));
    const right = transformOf(await mountArea({ w: 500, h: 500 }, { manual: true, zoom: 1, shiftX: 10 }));
    console.log("влево:", left, "| вправо:", right);

    // Знак translate совпадает со знаком сдвига — без переворота.
    expect(left.x).toBeLessThan(0);
    expect(right.x).toBeGreaterThan(0);
  });

  it("ручной сдвиг по вертикали двигает фото вниз и вверх", async () => {
    const down = transformOf(await mountArea({ w: 500, h: 500 }, { manual: true, zoom: 1, shiftY: 10 }));
    const up = transformOf(await mountArea({ w: 500, h: 500 }, { manual: true, zoom: 1, shiftY: -10 }));
    console.log("вниз:", down, "| вверх:", up);

    // Вниз — плюс по Y, вверх — минус.
    expect(down.y).toBeGreaterThan(0);
    expect(up.y).toBeLessThan(0);
  });

  it("вертикальный сдвиг работает и без ручного режима", async () => {
    /* Складывается с автокадром: так сотрудник может чуть опустить
       фото, не забирая кадр целиком под себя. */
    const base = transformOf(await mountArea({ w: 500, h: 500 }));
    const down = transformOf(await mountArea({ w: 500, h: 500 }, { shiftY: 10 }));
    console.log("база:", base, "| со сдвигом вниз:", down);

    expect(down.y).toBeGreaterThan(base.y);
  });

  it("зум ограничен коридором ручного режима", async () => {
    // Больше 400% не даём: дальше фото превращается в пиксели.
    const tooBig = transformOf(await mountArea({ w: 500, h: 500 }, { manual: true, zoom: 10 }));
    const tooSmall = transformOf(await mountArea({ w: 500, h: 500 }, { manual: true, zoom: 0.01 }));
    console.log("запредельный зум:", tooBig.scale, "| слишком мелкий:", tooSmall.scale);

    expect(tooBig.scale).toBe(4);
    expect(tooSmall.scale).toBe(0.6);
  });

  it("пропорции держатся: масштаб один по обеим осям", async () => {
    const w = await mountArea({ w: 500, h: 500 }, { manual: true, zoom: 2.5 });
    const matches = (w.find(".image-fade__img").attributes("style") ?? "").match(/scale/g) ?? [];
    console.log("количество scale:", matches.length);

    expect(matches).toHaveLength(1);
    w.unmount();
  });

  it("ручной кадр не зависит от пропорций исходного фото", async () => {
    /* Одинаковые правки на разных фото дают один масштаб — сотрудник
       задаёт его сам, а не получает разный на каждую картинку. */
    const vertical = transformOf(await mountArea({ w: 400, h: 900 }, { manual: true, zoom: 1.5 }));
    const wide = transformOf(await mountArea({ w: 900, h: 400 }, { manual: true, zoom: 1.5 }));
    console.log("вертикальное:", vertical, "| широкое:", wide);

    expect(vertical.scale).toBe(1.5);
    expect(wide.scale).toBe(1.5);
    // Без сдвигов оба стоят по центру.
    expect(vertical.x).toBe(0);
    expect(wide.x).toBe(0);
  });
});
