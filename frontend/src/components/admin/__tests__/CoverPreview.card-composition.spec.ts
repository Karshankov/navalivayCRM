import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

/**
 * Сверка состава карточки: превью в CRM обязано повторять настоящую
 * карточку мини-аппа строка в строку.
 *
 * Зачем так строго: область фото растянута по высоте карточки
 * (align-self: stretch), а высота складывается из содержимого. Забудь
 * превью одну строку — область станет ниже, и тот же кадр обрежется
 * иначе. Сотрудник настроит одно, покупатель увидит другое.
 *
 * Тест сверяет числа из CSS обеих сторон. Он ловит именно ту ошибку,
 * что была допущена: без пилюли «Избранное» и бокового блока область
 * фото выходила 92px вместо 120px.
 */
const CARD = "src/components/product/liquid/LiquidLineCard.vue";
const PREVIEW = "src/components/admin/CoverPreview.vue";

/** Тело правила CSS: только точное совпадение селектора, от начала строки. */
function ruleBlock(css: string, selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  /* Якорь на начало строки обязателен: иначе селектор вида
     .liquid-line-title найдётся внутри
     .liquid-line-card--unavailable .liquid-line-title и числа возьмутся
     из чужого правила. */
  const found = css.match(new RegExp(`^${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`, "m"));
  return found ? found[1] : null;
}

function cssProp(css: string, selector: string, property: string): string | null {
  const block = ruleBlock(css, selector);
  if (!block) return null;
  /* Комментарии внутри правила мешают разбору: в CSS проекта они стоят
     между свойствами. Убираем их перед поиском. */
  const clean = block.replace(/\/\*[\s\S]*?\*\//g, "");
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const found = clean.match(new RegExp(`(?:^|[;{]|\\n)\\s*${escaped}:\\s*([^;\\n]+)`));
  return found ? found[1].trim() : null;
}

function px(value: string | null): number | null {
  if (value === null) return null;
  const found = value.match(/^(-?[\d.]+)px$/);
  return found ? Number(found[1]) : null;
}

describe("Превью CRM повторяет состав карточки мини-аппа", () => {
  it("область фото имеет те же габариты и то же растяжение", async () => {
    const card = await readFile(CARD, "utf-8");
    const preview = await readFile(PREVIEW, "utf-8");

    const props = [
      ["width", 76],
      ["min-height", 92],
      ["margin-top", -16],
      ["margin-bottom", -16],
      ["margin-right", 10],
    ] as const;

    for (const [name, expected] of props) {
      const cardValue = px(cssProp(card, ".liquid-line-art", name));
      const previewValue = px(cssProp(preview, ".cover-preview__art", name));
      console.log(`область фото, ${name}: мини-апп ${cardValue} | CRM ${previewValue}`);

      expect(previewValue, `область фото в CRM: ${name}`).toBe(cardValue);
      expect(previewValue, `область фото в CRM: ${name}`).toBe(expected);
    }

    // Растяжение по высоте — то, из-за чего состав карточки важен.
    expect(cssProp(card, ".liquid-line-art", "align-self")).toBe("stretch");
    expect(cssProp(preview, ".cover-preview__art", "align-self")).toBe("stretch");
    console.log("обе области растянуты по высоте карточки — ок");
  });

  it("превью повторяет все строки карточки, влияющие на высоту", async () => {
    const preview = await readFile(PREVIEW, "utf-8");

    /* Состав info-колонки мини-аппа: название, характеристика, отзывы
       и пилюля «Избранное». Каждая строка добавляет высоту. */
    for (const cls of [
      "cover-preview__title",
      "cover-preview__meta",
      "cover-preview__reviews",
      "cover-preview__favorite",
    ]) {
      expect(preview, `в превью нет строки ${cls}`).toContain(cls);
    }
    console.log("строки info на месте: название, характеристика, отзывы, избранное");

    // Боковой блок с шевроном: в аппе 40px и держит минимум высоты шапки.
    const toggle = px(cssProp(preview, ".cover-preview__toggle", "height"));
    console.log("шеврон в превью:", toggle, "px (в аппе 40)");
    expect(toggle).toBe(40);

    // Пилюля «Избранное»: 30px, как --favorite-height в аппе.
    const favorite = px(cssProp(preview, ".cover-preview__favorite", "min-height"));
    console.log("пилюля «Избранное»:", favorite, "px (в аппе 30)");
    expect(favorite).toBe(30);

    // Строка отзывов: 14px, как min-height в ReviewRatingLink.
    const reviews = px(cssProp(preview, ".cover-preview__reviews", "min-height"));
    console.log("строка отзывов:", reviews, "px (в аппе 14)");
    expect(reviews).toBe(14);
  });

  it("отступы и скругление карточки совпадают с мини-аппом", async () => {
    const card = await readFile(CARD, "utf-8");
    const preview = await readFile(PREVIEW, "utf-8");

    for (const name of ["padding", "border-radius"]) {
      const cardValue = cssProp(card, ".liquid-line-card", name);
      const previewValue = cssProp(preview, ".cover-preview__frame", name);
      console.log(`${name}: мини-апп ${cardValue} | CRM ${previewValue}`);
      expect(previewValue, `карточка в CRM: ${name}`).toBe(cardValue);
    }
  });

  it("превью держит ширину карточки телефона, а не ширину модалки", async () => {
    /* Это не косметика. Ширина решает, сколько места достанется названию,
       а значит — в одну строку оно уложится или в две. Две строки делают
       карточку выше, область фото длиннее, и кадр уезжает.
       Поэтому ширина задана числом, а не отдана на откуп модалке. */
    const preview = await readFile(PREVIEW, "utf-8");

    const stageWidth = px(cssProp(preview, ".cover-preview__stage", "width"));
    console.log("ширина превью:", stageWidth, "px (телефон 393 минус отступы 12+12)");
    expect(stageWidth).toBe(369);

    /* На узких экранах превью уменьшается целиком: сжимать содержимое
       нельзя — перенос строк разойдётся с покупателем. */
    const scale = preview.match(/\.cover-preview__stage \{[\s\S]*?transform: scale\(([\d.]+)\)/);
    console.log("масштаб превью на узких экранах:", scale?.[1]);
    expect(scale, "превью не масштабируется на узких экранах").toBeTruthy();
    expect(Number(scale![1])).toBeGreaterThan(0.5);
    expect(Number(scale![1])).toBeLessThan(1);
  });

  it("шрифты строк совпадают со шрифтами мини-аппа", async () => {
    const card = await readFile(CARD, "utf-8");
    const preview = await readFile(PREVIEW, "utf-8");

    const pairs = [
      ["название", ".liquid-line-title", ".cover-preview__title"],
      ["характеристика", ".liquid-line-meta", ".cover-preview__meta"],
    ] as const;

    for (const [label, cardSel, previewSel] of pairs) {
      for (const name of ["font-size", "font-weight", "line-height"]) {
        const cardValue = cssProp(card, cardSel, name);
        const previewValue = cssProp(preview, previewSel, name);
        console.log(`${label}, ${name}: мини-апп ${cardValue} | CRM ${previewValue}`);
        expect(previewValue, `${label}: ${name}`).toBe(cardValue);
      }
    }
  });

  it("в шапке карточки есть боковой блок с шевроном", async () => {
    /* В мини-аппе шапка это .liquid-line-main плюс .liquid-line-side.
       Забудь превью боковой блок — колонка станет ниже на 40px. */
    const card = await readFile(CARD, "utf-8");
    const preview = await readFile(PREVIEW, "utf-8");

    console.log("шапка превью, display:", cssProp(preview, ".cover-preview__main", "display"));
    expect(cssProp(preview, ".cover-preview__main", "display")).toBe("flex");
    expect(cssProp(preview, ".cover-preview__main", "gap")).toBe(
      cssProp(card, ".liquid-line-main", "gap"),
    );
    expect(ruleBlock(preview, ".cover-preview__side")).toBeTruthy();
    console.log("боковой блок с шевроном в превью есть");
  });
});
