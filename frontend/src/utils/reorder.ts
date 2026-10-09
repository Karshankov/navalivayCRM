export function reorderArray<T>(list: T[], fromIndex: number, toIndex: number): T[] {
  const arr = [...list]
  if (fromIndex < 0 || fromIndex >= arr.length) return arr
  if (toIndex < 0 || toIndex >= arr.length) return arr
  if (fromIndex === toIndex) return arr
  const [item] = arr.splice(fromIndex, 1)
  arr.splice(toIndex, 0, item)
  return arr
}

export function moveUp<T>(list: T[], index: number): T[] {
  return reorderArray(list, index, index - 1)
}

export function moveDown<T>(list: T[], index: number): T[] {
  return reorderArray(list, index, index + 1)
}
