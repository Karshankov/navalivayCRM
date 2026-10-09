/**
 * Порядок линеек в разделе.
 *
 * Линейка, отмеченная новинкой, встаёт в начало списка, пока не вышел срок.
 * Позиция при этом нигде не переписывается: когда срок истечёт, сервер перестанет
 * присылать `isNew`, и линейка вернётся туда, где стояла, по своему `order`.
 *
 * Подлинейка-новинка выходит из своего родителя и показывается отдельной
 * карточкой наверху раздела. Смысл в том, чтобы новинку было видно сразу, а не
 * после раскрытия родителя: приехал PODONKI HOTSPOT, он и стоит первым, а не
 * прячется внутри PODONKI. Как только отметку снимут, линейка вернётся внутрь
 * родителя на своё прежнее место.
 */
export interface OrderedLineup {
  order?: number | null
  isNew?: boolean | null
  newSince?: string | null
}

interface TreeLineup extends OrderedLineup {
  children?: TreeLineup[]
}

export function compareLineups(a: OrderedLineup, b: OrderedLineup): number {
  const aNew = a.isNew ? 1 : 0
  const bNew = b.isNew ? 1 : 0
  if (aNew !== bNew) return bNew - aNew

  if (aNew && bNew) {
    // Свежая новинка выше. Даты приходят из SQLite в виде «YYYY-MM-DD HH:MM:SS»,
    // одинаковая ширина позволяет сравнивать их как обычные строки.
    const aSince = a.newSince ?? ''
    const bSince = b.newSince ?? ''
    if (aSince !== bSince) return aSince < bSince ? 1 : -1
  }

  return (a.order ?? 0) - (b.order ?? 0)
}

/**
 * Вынимает новинки из вложенных линеек в корень раздела.
 *
 * Возвращает новый список корней: сама новинка со своими подлинейками уезжает
 * наверх, а из родителя пропадает, иначе она была бы на экране дважды.
 */
export function liftNewLineups<T extends TreeLineup>(roots: T[]): T[] {
  const lifted: T[] = []

  const extract = (nodes: T[]): T[] =>
    nodes.filter((node) => {
      if (node.children?.length) {
        node.children = extract(node.children as T[])
      }
      if (node.isNew) {
        lifted.push(node)
        return false
      }
      return true
    })

  // У корней новинку не вынимаем: она и так на верхнем уровне.
  const remaining = roots.filter((root) => {
    if (root.children?.length) {
      root.children = extract(root.children as T[])
    }
    return true
  })

  return [...lifted, ...remaining]
}

/** Сортирует дерево линеек на месте, вместе со всеми уровнями вложенности. */
export function sortLineupTree<T extends TreeLineup>(nodes: T[]): T[] {
  nodes.sort(compareLineups)
  for (const node of nodes) {
    if (node.children?.length) sortLineupTree(node.children)
  }
  return nodes
}

/**
 * Готовый порядок для витрины: новинки из глубины поднимаются в корень, затем
 * список сортируется. Возвращает новый массив корней.
 */
export function arrangeLineups<T extends TreeLineup>(roots: T[]): T[] {
  return sortLineupTree(liftNewLineups(roots))
}
