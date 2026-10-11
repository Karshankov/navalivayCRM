import { describe, expect, it } from 'vitest'
import { groupBlockRange, moveGroupSubtree, siblingGroupId, type GroupOrderRow } from '../categoryGroupOrder'

const row = (id: string, depth = 0, parentId: string | null = null, categoryId = 'a') => ({ id, name: id, slug: id, order: 1, categoryId, depth, parentId } as GroupOrderRow)
const fixture = () => [row('p'), row('p1', 1, 'p'), row('p11', 2, 'p1'), row('p2', 1, 'p'), row('q'), row('q1', 1, 'q'), row('r')]
const ids = (rows: GroupOrderRow[]) => rows.map(item => item.id)

describe('categoryGroupOrder', () => {
  it('moves a parent with all descendants after another complete subtree', () => {
    const rows = fixture()
    expect(ids(moveGroupSubtree(rows, 'p', 'q', 'after'))).toEqual(['q', 'q1', 'p', 'p1', 'p11', 'p2', 'r'])
    expect(ids(rows)).toEqual(['p', 'p1', 'p11', 'p2', 'q', 'q1', 'r'])
  })
  it('moves a nested parent and grandchild within their sibling list', () => {
    const rows = fixture()
    const moved = moveGroupSubtree(rows, 'p1', 'p2', 'after')
    expect(ids(moved)).toEqual(['p', 'p2', 'p1', 'p11', 'q', 'q1', 'r'])
    expect(moved.find(item => item.id === 'p11')?.parentId).toBe('p1')
  })
  it('moves upward before the target without splitting it', () => {
    expect(ids(moveGroupSubtree(fixture(), 'q', 'p', 'before'))).toEqual(['q', 'q1', 'p', 'p1', 'p11', 'p2', 'r'])
  })
  it('rejects different parents, levels, categories, missing ids and self drops', () => {
    const rows = [...fixture(), row('other', 0, null, 'b')]
    for (const [source, target] of [['p1', 'q1'], ['p', 'p1'], ['p', 'other'], ['p', 'p'], ['missing', 'q']]) {
      expect(moveGroupSubtree(rows, source!, target!, 'after')).toBe(rows)
    }
  })
  it('finds siblings rather than adjacent descendants and detects boundaries', () => {
    const rows = fixture()
    expect(siblingGroupId(rows, 'p', 1)).toBe('q')
    expect(siblingGroupId(rows, 'p1', 1)).toBe('p2')
    expect(siblingGroupId(rows, 'p2', -1)).toBe('p1')
    expect(siblingGroupId(rows, 'p', -1)).toBeNull()
    expect(siblingGroupId(rows, 'p2', 1)).toBeNull()
    expect(groupBlockRange(rows, 'p')).toEqual({ start: 0, end: 4 })
  })
  it('does not save unchanged placements and preserves empty rows', () => {
    const rows = fixture()
    Object.assign(rows[1]!, { stockSum: 0, totalStockSum: 0 })
    expect(moveGroupSubtree(rows, 'p', 'q', 'before')).toBe(rows)
    const moved = moveGroupSubtree(rows, 'p', 'r', 'after')
    expect(moved).toHaveLength(rows.length)
    expect(moved.find(item => item.id === 'p1')).toBe(rows[1])
  })
})
