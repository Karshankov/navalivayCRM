import { describe, expect, it } from "vitest";
import { siblingNeighbours, type GroupOrderRow } from "../categoryGroupOrder";

function row(id: string, name: string, opts: Partial<GroupOrderRow> = {}): GroupOrderRow {
  return { id, name, categoryId: "c1", depth: 0, parentId: null, order: 0, slug: id, ...opts } as GroupOrderRow;
}

describe("Соседи линейки для направляющих", () => {
  const rows = [row("a", "А"), row("b", "Б"), row("c", "В"), row("d", "Г")];

  it("для средней линейки берёт верхнюю и нижнюю", () => {
    const { previous, next } = siblingNeighbours(rows, "b");
    console.log("соседи Б:", previous?.name, "/", next?.name);
    expect(previous?.id).toBe("a");
    expect(next?.id).toBe("c");
  });

  it("у первой сверху пусто — она начало списка", () => {
    const { previous, next } = siblingNeighbours(rows, "a");
    console.log("соседи А:", previous, "/", next?.name);
    expect(previous).toBeNull();
    expect(next?.id).toBe("b");
  });

  it("у последней снизу пусто", () => {
    const { previous, next } = siblingNeighbours(rows, "d");
    expect(previous?.id).toBe("c");
    expect(next).toBeNull();
  });

  it("линейки разных категорий не считаются соседями", () => {
    /* В ленте линейки идут внутри своей категории, поэтому чужой ряд
       ориентиром быть не может — это был бы обман. */
    const mixed = [
      row("a", "А"),
      row("x", "Чужая", { categoryId: "c2" }),
      row("b", "Б"),
    ];
    const { previous, next } = siblingNeighbours(mixed, "b");
    console.log("соседи Б среди чужих:", previous?.name, "/", next?.name);
    expect(previous?.id).toBe("a");
    expect(next).toBeNull();
  });

  it("подлинейки ищут соседей среди своего родителя", () => {
    const nested = [
      row("p1", "Родитель 1"),
      row("k1", "Ребёнок 1", { depth: 1, parentId: "p1" }),
      row("k2", "Ребёнок 2", { depth: 1, parentId: "p1" }),
      row("k3", "Чужой ребёнок", { depth: 1, parentId: "p2" }),
    ];
    const { previous, next } = siblingNeighbours(nested, "k2");
    console.log("соседи Ребёнка 2:", previous?.name, "/", next);
    expect(previous?.id).toBe("k1");
    expect(next).toBeNull();
  });

  it("для новой линейки даёт ориентир, а не пустоту", () => {
    /* Линейку ещё создают, идентификатора нет. Без ориентира колонка
       направляющих была бы пустой — и смысл терялся бы. */
    const { previous, next } = siblingNeighbours(rows, null, { categoryId: "c1" });
    console.log("ориентир для новой:", previous?.name, "/", next?.name);
    expect(previous?.id).toBe("a");
    expect(next?.id).toBe("b");
  });

  it("пустой список не роняет расчёт", () => {
    const { previous, next } = siblingNeighbours([], "a");
    expect(previous).toBeNull();
    expect(next).toBeNull();
  });
});
