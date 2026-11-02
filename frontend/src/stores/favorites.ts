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
 *
 * Производительность и гонки:
 * - Map-индексы вместо поиска по массиву: сердца на сотнях карточек
 *   больше не пересчитывают весь список на каждый рендер.
 * - Версия стора: ответ «запоздалого» рефетча не перетирает более
 *   поздние оптимистичные изменения (сердца перестали «сами пропадать
 *   и добавляться»).
 * - Debounce рефетча после серий тапов.
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

  /** Версия данных: растёт при каждом изменении. Рефетч с устаревшей
   * версией ответа игнорируется — это чинит «сердца сами пропадают». */
  let dataVersion = 0
  /** Запланированный debounced-рефетч. */
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  let inflightRefresh: Promise<void> | null = null

  /** Индекс productId::variantId -> item. Пересобирается из items. */
  const itemsByKey = computed(() => {
    const map = new Map<string, FavoriteItem>()
    for (const item of items.value) {
      map.set(favoriteKey(item.productId, item.variantId), item)
    }
    return map
  })

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
    return itemsByKey.value.has(favoriteKey(productId, variantId))
  }

  function isTogglePending(productId: string, variantId: string | null = null): boolean {
    return pendingKeys.value.has(favoriteKey(productId, variantId))
  }

  async function fetchFavorites(): Promise<boolean> {
    isLoading.value = true
    loadError.value = null
    const capturedVersion = ++dataVersion
    try {
      const fetched = await fetchFavoritesApi()
      if (capturedVersion !== dataVersion) return true // оптимистичные правки новее
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

  /** Тихий рефетч после успешных операций: без isLoading/ошибок в UI.
   * Debounce 150мс: серия тапов по нескольким линейкам = один рефетч. */
  function scheduleQuietRefresh(delayMs = 150): void {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      void refreshQuietly()
    }, delayMs)
  }

  async function refreshQuietly(): Promise<void> {
    if (inflightRefresh) return inflightRefresh
    const capturedVersion = ++dataVersion
    const promise = (async () => {
      try {
        const fetched = await fetchFavoritesApi()
        if (capturedVersion !== dataVersion) return // летели дольше, чем меняли стор
        items.value = fetched.items
        groups.value = fetched.groups
        isLoaded.value = true
        isAuthError.value = false
        loadError.value = null
      } catch {
        // Мягкая ошибка: список остаётся как есть, следующий вход на экран
        // обновит его через fetchFavorites.
      } finally {
        inflightRefresh = null
      }
    })()
    inflightRefresh = promise
    return promise
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
    // Быстрый второй тап до ответа первого: НЕ игнорируем (старое
    // поведение оставляло сердце гореть — «по итогу не убирается»),
    // а ставим в очередь за первым: тапы применяются строго по порядку.
    if (pendingKeys.value.has(key)) {
      return enqueueToggle(key, () => applyToggleFavorite(productId, variantId))
    }
    return applyToggleFavorite(productId, variantId)
  }

  /** Очереди тапов по ключу: сериализуют быстрые клики. */
  const toggleQueues = new Map<string, Promise<unknown>>()

  function enqueueToggle<T>(key: string, run: () => Promise<T>): Promise<T> {
    const previous = toggleQueues.get(key) ?? Promise.resolve()
    const chained = previous.then(run, run)
    const cleanup = () => {
      if (toggleQueues.get(key) === chained) toggleQueues.delete(key)
    }
    chained.then(cleanup, cleanup)
    toggleQueues.set(key, chained)
    return chained
  }

  async function applyToggleFavorite(
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
    const snapshot = wasFavorite ? itemsByKey.value.get(key) ?? null : null

    // Оптимистичное обновление UI. Версию поднимаем: летящий рефетч
    // с этим снимком не должен перетереть свежее состояние.
    dataVersion += 1
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
        // Оптимистичная запись без названия/цены/картинки — догонит
        // данными с сервера (debounce собирает серию тапов в один).
        scheduleQuietRefresh()
      } else {
        await removeFavoriteApi(productId, variantId)
      }
      return nextFavorite
    } catch (error) {
      // Откат оптимистичного состояния.
      dataVersion += 1
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
   * Переключить избранное всей линейки. Оптимистично: сердце загорается
   * сразу — сервер подтверждает в фоне, полный список догоняет рефетчем.
   * Раньше кнопка ждала POST + полный GET (сотни мс на большой линейке),
   * сейчас отклик мгновенный.
   */
  async function toggleFavoriteGroup(groupId: string): Promise<boolean> {
    // Быстрые повторные тапы — в очередь, строго по порядку (как у
    // одиночного toggle: иначе «добавил и тут же убрал» оставлял линейку).
    if (pendingKeys.value.has(`group::${groupId}`)) {
      return enqueueToggle(`group::${groupId}`, () => applyToggleFavoriteGroup(groupId))
    }
    return applyToggleFavoriteGroup(groupId)
  }

  async function applyToggleFavoriteGroup(groupId: string): Promise<boolean> {
    if (pendingKeys.value.has(`group::${groupId}`)) {
      return isGroupFavorite(groupId)
    }

    const wasFavorite = isGroupFavorite(groupId)
    const nextFavorite = !wasFavorite

    // Снимок записей группы для отката при ошибке.
    const treeIds = collectGroupTreeIds(groupId)
    const groupSnapshot = items.value.filter(
      (item) => item.groupId != null && treeIds.has(item.groupId),
    )

    // Оптимистичный UI: маркер группы делает isGroupFavorite мгновенным.
    dataVersion += 1
    if (nextFavorite) {
      items.value = [
        {
          productId: `group::${groupId}`,
          variantId: null,
          createdAt: new Date().toISOString(),
          deleted: false,
          title: null,
          groupId,
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
        (item) => !(item.groupId != null && treeIds.has(item.groupId)),
      )
    }

    pendingKeys.value = new Set(pendingKeys.value).add(`group::${groupId}`)
    try {
      if (nextFavorite) {
        await addFavoriteGroupApi(groupId)
        // Полный список (все вкусы линии) догоняет фоном: кнопка уже
        // горит; debounce собирает серию тапов в один рефетч.
        scheduleQuietRefresh()
      } else {
        await removeFavoriteGroupApi(groupId)
        scheduleQuietRefresh()
      }
      return nextFavorite
    } catch (error) {
      // Откат оптимистичного состояния.
      dataVersion += 1
      if (nextFavorite) {
        items.value = items.value.filter((item) => item.productId !== `group::${groupId}`)
      } else {
        items.value = [...groupSnapshot, ...items.value]
        void fetchFavorites()
      }
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
   * Производительность: индекс групп один на рендер-цикл, а не
   * пересборка дерева на каждое сердце (O(категории) вместо O(записи)).
   */
  const itemsByGroupId = computed(() => {
    const map = new Map<string, FavoriteItem[]>()
    for (const item of items.value) {
      const gid = item.groupId
      if (gid == null) continue
      const list = map.get(gid)
      if (list) list.push(item)
      else map.set(gid, [item])
    }
    return map
  })

  /** Дерево групп каталога, пересобирается только при смене каталога. */
  const groupTreeIds = computed(() => {
    const children = new Map<string, string[]>()
    const catalogStore = useCatalogStore()
    for (const category of catalogStore.categories) {
      for (const group of category.groups) {
        if (group.parentId) {
          const list = children.get(group.parentId) ?? []
          list.push(group.id)
          children.set(group.parentId, list)
        }
      }
    }
    // Раскрываем дерево для каждой группы заранее.
    const result = new Map<string, Set<string>>()
    const expand = (root: string): Set<string> => {
      const cached = result.get(root)
      if (cached) return cached
      const ids = new Set<string>([root])
      const queue = [root]
      while (queue.length) {
        const current = queue.shift()!
        for (const child of children.get(current) ?? []) {
          if (!ids.has(child)) {
            ids.add(child)
            queue.push(child)
          }
        }
      }
      result.set(root, ids)
      return ids
    }
    for (const category of catalogStore.categories) {
      for (const group of category.groups) {
        expand(group.id)
      }
    }
    return result
  })

  function collectGroupTreeIds(groupId: string): Set<string> {
    return groupTreeIds.value.get(groupId) ?? new Set([groupId])
  }

  function isGroupFavorite(groupId: string): boolean {
    const treeIds = collectGroupTreeIds(groupId)
    for (const gid of treeIds) {
      if (itemsByGroupId.value.has(gid)) return true
    }
    return false
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
