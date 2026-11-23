/**
 * Направляющие и соседи в редакторе обложки.
 *
 * Направляющие вертикальные: края видимой части и середина. По ним фото
 * центруют влево-вправо. Соседи показаны настоящими карточками в блоке
 * «Так увидит клиент» — видно, как обложка встаёт в ряд, а не отдельно.
 */
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { readFile } from "node:fs/promises";
import CoverPreview, { type CoverNeighbour } from "@/components/admin/CoverPreview.vue";

function neighbour(id: string, name: string, extra: Partial<CoverNeighbour> = {}): CoverNeighbour {
  return {
    id,
    name,
    coverImage: `/api/category-groups/${id}/cover`,
    coverZoom: 170,
    coverShift: 10,
    coverOffsetY: 14,
    coverManual: true,
    ...extra,
  };
}

async function stylesheet(): Promise<string> {
  const source = await readFile("src/components/admin/CoverPreview.vue", "utf-8");
  return source.split("<style scoped>")[1].split("</style>")[0];
}

function ruleBlock(css: string, selector: string): string {
  const start = css.search(new RegExp(`^\\s*\\${selector}\\s*\\{`, "m"));
  if (start < 0) return "";
  return css.slice(start, css.indexOf("}", start));
}

function prop(block: string, name: string): string | null {
  return block.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]?.trim() ?? null;
}

describe("Редактор обложки: направляющие", () => {
  it("направляющие вертикальные — края и середина", () => {
    const w = mount(CoverPreview, { props: { src: "/cover.png" } });

    const lines = w.findAll(".cover-editor__guide-line");
    console.log("линий в окне:", lines.length, "|", lines.map((l) => l.classes().join(" ")));

    const classes = lines.map((l) => l.classes().join(" ")).join(" | ");
    expect(lines.length).toBe(3);
    expect(classes).toContain("--left");
    expect(classes).toContain("--center");
    expect(classes).toContain("--right");
    w.unmount();
  });

  it("линии стоят по краям и по середине ширины", async () => {
    const css = await stylesheet();
    const left = ruleBlock(css, ".cover-editor__guide-line--left");
    const center = ruleBlock(css, ".cover-editor__guide-line--center");
    const right = ruleBlock(css, ".cover-editor__guide-line--right");

    console.log("лево:", prop(left, "left"), "| центр:", prop(center, "left"), "| право:", prop(right, "right"));
    expect(prop(left, "left")).toBe("0");
    expect(prop(center, "left")).toBe("50%");
    expect(prop(right, "right")).toBe("0");

    /* Линия вертикальная: она тянется по высоте и не имеет ширины. */
    const line = ruleBlock(css, ".cover-editor__guide-line");
    console.log("линия:", prop(line, "top"), prop(line, "bottom"), prop(line, "border-left"));
    expect(prop(line, "top")).toBe("0");
    expect(prop(line, "bottom")).toBe("0");
    expect(prop(line, "border-left")).toContain("solid".replace("solid", "dashed"));

    /* Середина плотнее и цветом акцента — это главная ось. */
    expect(prop(center, "border-left")).toContain("solid");
    expect(prop(center, "border-left")).toContain("0958ff");
  });

  it("горизонтальных направляющих больше нет", async () => {
    /* Их заменили вертикальными: горизонтальные сравнивали высоту, а
       просили центровку по ширине. */
    const source = await readFile("src/components/admin/CoverPreview.vue", "utf-8");
    console.log("остатки горизонтальных:", source.includes("guide-line--quarter"));
    expect(source).not.toContain("guide-line--quarter");
    expect(source).not.toContain("cover-guides__line--center");
  });

  it("направляющие не перехватывают нажатия", async () => {
    /* Иначе линии мешали бы тянуть фото в окне. */
    const css = await stylesheet();
    const lines = ruleBlock(css, ".cover-editor__guide-lines");
    console.log("нажатия:", prop(lines, "pointer-events"));
    expect(prop(lines, "pointer-events")).toBe("none");
  });
});

describe("Редактор обложки: соседи в блоке результата", () => {
  it("соседи стоят внутри блока «Так увидит клиент», а не отдельно", () => {
    const w = mount(CoverPreview, {
      props: {
        src: "/cover.png",
        title: "PODONKI PODGON",
        previous: neighbour("cg_a", "PODONKI BLOOD"),
        next: neighbour("cg_d", "PODONKI VINTAGE"),
      },
    });

    const result = w.find(".cover-preview__result");
    console.log("в блоке результата карточек:", result.findAll(".cover-preview__frame").length);
    console.log("своя карточка в блоке:", result.find('[data-test="preview-own"]').exists());

    // Все три карточки — внутри блока результата.
    expect(result.find('[data-test="neighbour-previous"]').exists()).toBe(true);
    expect(result.find('[data-test="preview-own"]').exists()).toBe(true);
    expect(result.find('[data-test="neighbour-next"]').exists()).toBe(true);

    // Отдельного блока «Ряд с соседями» больше нет.
    expect(w.find('[data-test="cover-guides"]').exists()).toBe(false);
    w.unmount();
  });

  it("соседи показаны полными карточками — с текстом, как у клиента", () => {
    const w = mount(CoverPreview, {
      props: {
        src: "/cover.png",
        title: "PODONKI PODGON",
        meta: "Крепость 20 мг",
        previous: neighbour("cg_a", "PODONKI BLOOD"),
      },
    });

    const prev = w.find('[data-test="neighbour-previous"]');
    const text = prev.text();
    console.log("карточка соседа:", text.replace(/\s+/g, " ").trim().slice(0, 70));

    /* Полная карточка — значит название, строка отзывов и пилюля: от
       состава зависит высота, а по высоте растянута область фото. */
    expect(text).toContain("PODONKI BLOOD");
    expect(text).toContain("отзыв");
    expect(prev.find(".cover-preview__favorite").exists()).toBe(true);
    w.unmount();
  });

  it("соседи рисуются своими кадрами, а не общим автоподбором", () => {
    /* У соседа кадр может быть настроен руками. Автоподбор дал бы другую
       картинку — и выравниваться пришлось бы по несуществующему кадру. */
    const w = mount(CoverPreview, {
      props: {
        src: "/cover.png",
        previous: neighbour("cg_a", "ВЫШЕ", { coverZoom: 250, coverShift: 20 }),
        next: neighbour("cg_c", "НИЖЕ", { coverZoom: null, coverManual: false }),
      },
    });

    const prev = w.find('[data-test="neighbour-previous"]');
    console.log("кадров в карточке соседа:", prev.findAll(".cover-preview__art").length);
    expect(prev.find(".cover-preview__art").exists()).toBe(true);
    w.unmount();
  });

  it("без соседа на его месте подпись в размер карточки", () => {
    const w = mount(CoverPreview, {
      props: { src: "/cover.png", previous: null, next: neighbour("cg_c", "НИЖЕ") },
    });

    const empty = w.findAll(".cover-preview__frame--empty");
    console.log("пустых мест:", empty.length, "| текст:", empty[0]?.text());
    expect(empty.length).toBe(1);
    expect(empty[0]!.text()).toContain("Первая");
    w.unmount();
  });

  it("последняя линейка подписана снизу", () => {
    const w = mount(CoverPreview, {
      props: { src: "/cover.png", previous: neighbour("cg_a", "ВЫШЕ"), next: null },
    });
    const empty = w.findAll(".cover-preview__frame--empty");
    expect(empty.length).toBe(1);
    expect(empty[0]!.text()).toContain("Последняя");
    w.unmount();
  });

  it("зазор между карточками — 10px, как в ленте", async () => {
    const css = await stylesheet();
    const feed = ruleBlock(css, ".cover-preview__stage--feed");
    console.log("зазор ленты:", prop(feed, "gap"), "| раскладка:", prop(feed, "flex-direction"));
    expect(prop(feed, "gap")).toBe("10px");
    expect(prop(feed, "flex-direction")).toBe("column");
  });

  it("подпись соседа стоит сбоку, чтобы не раздвигать карточки", async () => {
    /* Над карточкой подпись увеличила бы зазор и ряд перестал бы
       совпадать с клиентским. */
    const css = await stylesheet();
    const row = ruleBlock(css, ".cover-preview__row");
    console.log("строка:", prop(row, "display"), prop(row, "align-items"));
    expect(prop(row, "display")).toBe("flex");
    expect(prop(row, "align-items")).toBe("center");
  });
});
