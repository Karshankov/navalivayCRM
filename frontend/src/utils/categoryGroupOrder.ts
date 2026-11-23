import type { CategoryGroup } from '@/stores/admin'

export type GroupOrderRow = CategoryGroup & { depth: number }

export function groupBlockRange<T extends GroupOrderRow>(rows: T[], id: string) {
  const start = rows.findIndex(row => row.id === id)
  if (start < 0) return null
  const root = rows[start]!
  let end = start + 1
  while (end < rows.length && rows[end]!.categoryId === root.categoryId && rows[end]!.depth > root.depth) end += 1
  return { start, end }
}

export function areGroupSiblings(a: GroupOrderRow, b: GroupOrderRow) {
  return a.categoryId === b.categoryId && a.depth === b.depth
    && (a.depth === 0 || (a.parentId ?? null) === (b.parentId ?? null))
}

export function siblingGroupId<T extends GroupOrderRow>(rows: T[], id: string, direction: -1 | 1): string | null {
  const row = rows.find(item => item.id === id)
  if (!row) return null
  const siblings = rows.filter(item => areGroupSiblings(row, item))
  const index = siblings.findIndex(item => item.id === id)
  return siblings[index + direction]?.id ?? null
}

export function moveGroupSubtree<T extends GroupOrderRow>(rows: T[], sourceId: string, targetId: string, placement: 'before' | 'after'): T[] {
  const source = rows.find(row => row.id === sourceId)
  const target = rows.find(row => row.id === targetId)
  if (!source || !target || sourceId === targetId || !areGroupSiblings(source, target)) return rows
  const sourceRange = groupBlockRange(rows, sourceId)!
  const block = rows.slice(sourceRange.start, sourceRange.end)
  const remaining = [...rows.slice(0, sourceRange.start), ...rows.slice(sourceRange.end)]
  const targetRange = groupBlockRange(remaining, targetId)
  if (!targetRange) return rows
  const insertion = placement === 'before' ? targetRange.start : targetRange.end
  remaining.splice(insertion, 0, ...block)
  return remaining.every((row, index) => row.id === rows[index]?.id) ? rows : remaining
}

/** Соседи линейки по ленте клиента: та, что показывается выше, и та, что
 *  ниже. Порядок как у покупателя — среди линеек той же категории и того
 *  же уровня. Нужны в редакторе обложки: по ним сотрудник видит, на какой
 *  высоте стоят картинки у соседей, и не выбивается из общего ряда.
 *
 *  Работает и для ещё не созданной линейки: идентификатора у неё нет, и
 *  тогда возвращаются две первые по порядку — как ориентир для новой. */
export function siblingNeighbours<T extends GroupOrderRow>(
  rows: T[],
  id: string | null | undefined,
  context?: { categoryId?: string | null; parentId?: string | null },
): { previous: T | null; next: T | null } {
  const row = id ? rows.find(item => item.id === id) : undefined;

  /* Новая линейка: берём ориентир по категории и родителю из формы, а
     если их нет — первые две строки списка. */
  const anchor: GroupOrderRow | null = row
    ?? (context?.categoryId
      ? {
          ...((rows[0] ?? {}) as T),
          categoryId: context.categoryId,
          parentId: context.parentId ?? null,
          depth: context.parentId ? 1 : 0,
        }
      : (rows[0] ?? null));

  if (!anchor) return { previous: null, next: null };

  const siblings = rows.filter(item => row
    ? areGroupSiblings(row, item)
    : item.categoryId === anchor.categoryId
      && (item.parentId ?? null) === (anchor.parentId ?? null));

  const index = row ? siblings.findIndex(item => item.id === id) : 0;
  if (index < 0) return { previous: null, next: null };

  /* У новой линейки сосед выше — первая строка, сосед ниже — вторая: она
     встанет между ними. Считать от нулевого индекса нельзя, иначе верхний
     ориентир пропадал бы и колонка начиналась с пустоты. */
  if (!row) {
    return { previous: siblings[0] ?? null, next: siblings[1] ?? null };
  }

  return {
    previous: siblings[index - 1] ?? null,
    next: siblings[index + 1] ?? null,
  };
}
