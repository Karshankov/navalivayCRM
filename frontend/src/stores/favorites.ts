import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  addFavoriteApi,
  addFavoriteGroupApi,
  fetchFavoritesApi,
  removeFavoriteApi,
  removeFavoriteGroupApi,
  reorderFavoritesApi,
  FavoritesAuthError,
  type FavoriteItem,
  type FavoriteGroup,
} from '@/utils/favoritesApi'
import { useCatalogStore } from '@/stores/catalog'

export type { FavoriteItem, FavoriteGroup }

/**
 * Избранное клиента: хранение на сервере, привязка к Telegram-аккаунту.
 * Тоггл оптимистичный — UI меняется сразу, при ошибке возвращается назад.
 */
export const useFavoritesStore = defineStore('favorites', () => {
  const items = ref<FavoriteItem[]>([])
  /** Линейки в избранном: группа + её позиции. */
  const groups = ref<FavoriteGroup[]>([])
  const isLoading = ref(false)
  const isLoaded = ref(false)
  const loadError = ref<string | null>(null)
  const isAuthError = ref(false)
  /** Ключи позиций, по которым запрос в полёте: анти-двойной-клик. */
  const pendingKeys = ref<Set<string>>(new Set())

  const inStockItems = computed(() =>
    items.value.filter((item) => !item.deleted && item.inStock),
  )

  const outOfStockItems = computed(() =>
    items.value.filter((item) => item.deleted || !item.inStock),
  )

  function favoriteKey(productId: string, variantId: string | null): string {
    return `${productId}::${variantId ?? ''}`
  }

  function isFavorite(productId: string, variantId: string | null = null): boolean {
    const key = favoriteKey(productId, variantId)
    return items.value.some((item) => favoriteKey(item.productId, item.variantId) === key)
  }

  function isTogglePending(productId: string, variantId: string | null = null): boolean {
    return pendingKeys.value.has(favoriteKey(productId, variantId))
  }

  async function fetchFavorites(): Promise<boolean> {
    isLoading.value = true
    loadError.value = null
    try {
      const fetched = await fetchFavoritesApi()
      items.value = fetched.items
      groups.value = fetched.groups
      isLoaded.value = true
      isAuthError.value = false
      return true
    } catch (error) {
      if (error instanceof FavoritesAuthError) {
        isAuthError.value = true
        items.value = []
        groups.value = []
        isLoaded.value = true
      } else {
        loadError.value =
          error instanceof Error ? error.message : 'Не удалось загрузить избранное'
      }
      return false
    } finally {
      isLoading.value = false
    }
  }

  /** Тихий рефетч после успешных операций: без isLoading/ошибок в UI. */
  async function refreshQuietly(): Promise<void> {
    try {
      const fetched = await fetchFavoritesApi()
      items.value = fetched.items
      groups.value = fetched.groups
      isLoaded.value = true
      isAuthError.value = false
      loadError.value = null
    } catch {
      // Мягкая ошибка: список остаётся как есть, следующий вход на экран
      // обновит его через fetchFavorites.
    }
  }

  /**
   * Переключить избранное. Возвращает итоговое состояние (true — в избранном).
   * Тост об ошибке показывает вызывающий экран.
   */
  async function toggleFavorite(
    productId: string,
    variantId: string | null = null,
  ): Promise<boolean> {
    const key = favoriteKey(productId, variantId)
    if (pendingKeys.value.has(key)) {
      return isFavorite(productId, variantId)
    }

    const wasFavorite = isFavorite(productId, variantId)
    const nextFavorite = !wasFavorite

    // Snapshot до мутации: для офлайн-отката неудачного удаления —
    // сетевой рефетч по той же упавшей сети запись не восстановит.
    const snapshot = wasFavorite
      ? items.value.find((item) => favoriteKey(item.productId, item.variantId) === key) ?? null
      : null

    // Оптимистичное обновление UI.
    if (nextFavorite) {
      items.value = [
        {
          productId,
          variantId,
          createdAt: new Date().toISOString(),
          deleted: false,
          title: null,
          groupId: null,
          groupName: null,
          groupPosition: null,
          variantName: null,
          strength: null,
          priceRub: null,
          image: null,
          stock: null,
          inStock: true,
        },
        ...items.value,
      ]
    } else {
      items.value = items.value.filter(
        (item) => favoriteKey(item.productId, item.variantId) !== key,
      )
    }

    pendingKeys.value = new Set(pendingKeys.value).add(key)
    try {
      if (nextFavorite) {
        await addFavoriteApi(productId, variantId)
        // Оптимистичная запись без названия/цены/картинки — сразу
        // обновляем её данными с сервера.
        void refreshQuietly()
      } else {
        await removeFavoriteApi(productId, variantId)
      }
      return nextFavorite
    } catch (error) {
      // Откат оптимистичного состояния.
      if (nextFavorite) {
        items.value = items.value.filter(
          (item) => favoriteKey(item.productId, item.variantId) !== key,
        )
      } else if (snapshot) {
        // Возврат закэшированной записи без сетевого рефетча.
        items.value = [snapshot, ...items.value]
      } else {
        await fetchFavorites()
      }
      throw error
    } finally {
      const nextPending = new Set(pendingKeys.value)
      nextPending.delete(key)
      pendingKeys.value = nextPending
    }
  }

  /**
   * Переключить избранное всей линейки. Возвращает итоговое состояние
   * (true — линейка добавлена). Полный список приходит с сервера:
   * для группы оптимистичная запись невозможна (нужны все вкусы).
   */
  async function toggleFavoriteGroup(groupId: string): Promise<boolean> {
    if (pendingKeys.value.has(`group::${groupId}`)) {
      return isGroupFavorite(groupId)
    }

    const wasFavorite = isGroupFavorite(groupId)
    const nextFavorite = !wasFavorite

    pendingKeys.value = new Set(pendingKeys.value).add(`group::${groupId}`)
    try {
      if (nextFavorite) {
        await addFavoriteGroupApi(groupId)
      } else {
        await removeFavoriteGroupApi(groupId)
      }
      // Точное состояние группы знает только сервер.
      await fetchFavorites()
      return nextFavorite
    } catch (error) {
      throw error
    } finally {
      const nextPending = new Set(pendingKeys.value)
      nextPending.delete(`group::${groupId}`)
      pendingKeys.value = nextPending
    }
  }

  /**
   * Группа «в избранном», если хоть одна запись из её дерева:
   * добавленная через сердце линейки (added_group_id = сама группа)
   * или поштучно (группа товара — возможно, дочерняя подгруппа).
   * Дерево собираем из каталога по parentId.
   */
  function isGroupFavorite(groupId: string): boolean {
    const treeIds = collectGroupTreeIds(groupId)
    return items.value.some((item) => {
      const gid = item.groupId
      return gid != null && (gid === groupId || treeIds.has(gid))
    })
  }

  function collectGroupTreeIds(groupId: string): Set<string> {
    const ids = new Set<string>([groupId])
    const queue = [groupId]
    const index = groupChildrenIndex()
    while (queue.length) {
      const current = queue.shift()!
      for (const child of index.get(current) ?? []) {
        if (!ids.has(child)) {
          ids.add(child)
          queue.push(child)
        }
      }
    }
    return ids
  }

  /** Индекс дочерних групп каталога: parentId -> [childId]. */
  function groupChildrenIndex(): Map<string, string[]> {
    const index = new Map<string, string[]>()
    const catalogStore = useCatalogStore()
    for (const category of catalogStore.categories) {
      for (const group of category.groups) {
        if (group.parentId) {
          const list = index.get(group.parentId) ?? []
          list.push(group.id)
          index.set(group.parentId, list)
        }
      }
    }
    return index
  }

  function isGroupTogglePending(groupId: string): boolean {
    return pendingKeys.value.has(`group::${groupId}`)
  }

  /**
   * Сохранить ручной порядок линеек после drag-n-drop.
   * Список обновляется локально сразу; сервер — источник истины.
   */
  async function reorderGroups(orderedIds: string[]): Promise<void> {
    await reorderFavoritesApi(orderedIds)
    // Пересортируем локально по новому порядку.
    const rank = new Map(orderedIds.map((id, index) => [id, index]))
    const sorted = [...groups.value].sort((a, b) => {
      const ra = rank.get(a.groupId) ?? Number.MAX_SAFE_INTEGER
      const rb = rank.get(b.groupId) ?? Number.MAX_SAFE_INTEGER
      if (a.groupUnavailable !== b.groupUnavailable) {
        return a.groupUnavailable ? 1 : -1
      }
      return ra - rb
    })
    groups.value = sorted.map((group, index) => ({ ...group, groupPosition: index }))
  }

  function $reset() {
    items.value = []
    groups.value = []
    isLoading.value = false
    isLoaded.value = false
    loadError.value = null
    isAuthError.value = false
    pendingKeys.value = new Set()
  }

  return {
    items,
    groups,
    isLoading,
    isLoaded,
    loadError,
    isAuthError,
    inStockItems,
    outOfStockItems,
    isFavorite,
    isTogglePending,
    isGroupFavorite,
    isGroupTogglePending,
    fetchFavorites,
    refreshQuietly,
    toggleFavorite,
    toggleFavoriteGroup,
    reorderGroups,
    $reset,
  }
})
