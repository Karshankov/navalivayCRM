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
