import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useFavoritesStore, type FavoriteItem } from '@/stores/favorites'
import { useCatalogStore } from '@/stores/catalog'
import {
  addFavoriteApi,
  removeFavoriteApi,
  fetchFavoritesApi,
  FavoritesAuthError,
} from '@/utils/favoritesApi'

vi.mock('@/utils/favoritesApi', async () => {
  const actual = await vi.importActual<typeof import('@/utils/favoritesApi')>(
    '@/utils/favoritesApi',
  )
  return {
    ...actual,
    fetchFavoritesApi: vi.fn(),
    addFavoriteApi: vi.fn(),
    removeFavoriteApi: vi.fn(),
  }
})

const addMock = vi.mocked(addFavoriteApi)
const removeMock = vi.mocked(removeFavoriteApi)
const fetchMock = vi.mocked(fetchFavoritesApi)

function apiItem(overrides: Partial<Parameters<typeof fetchFavoritesApi>[0][number]> = {}) {
  return {
    product_id: 'prod1',
    variant_id: null,
    created_at: '2026-01-01 10:00:00',
    deleted: false,
    title: 'Товар',
    variant_name: null,
    priceRub: 10,
    image: null,
    stock: 5,
    in_stock: true,
    ...overrides,
  } as Parameters<typeof fetchFavoritesApi>[0][number]
}

describe('favorites store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('fetchFavorites loads and normalizes items', async () => {
    fetchMock.mockResolvedValue({ items: [
      {
        productId: 'prod1',
        variantId: null,
        createdAt: '2026-01-01 10:00:00',
        deleted: false,
        title: 'Товар',
        variantName: null,
        priceRub: 10,
        image: null,
        stock: 5,
        inStock: true,
      },
    ], groups: [], ungrouped: [] })

    const store = useFavoritesStore()
    const okResult = await store.fetchFavorites()

    expect(okResult).toBe(true)
    expect(store.isLoaded).toBe(true)
    expect(store.items).toHaveLength(1)
    expect(store.isFavorite('prod1', null)).toBe(true)
    expect(store.isFavorite('prod1', 'var1')).toBe(false)
  })

  it('fetchFavorites keeps auth error without throwing', async () => {
    fetchMock.mockRejectedValue(new FavoritesAuthError())

    const store = useFavoritesStore()
    const okResult = await store.fetchFavorites()

    expect(okResult).toBe(false)
    expect(store.isAuthError).toBe(true)
    expect(store.isLoaded).toBe(true)
    expect(store.items).toEqual([])
  })

  it('toggleFavorite optimistically adds and removes', async () => {
    // После добавления стор тихо рефетчится: мок отражает состояние сервера.
    const serverState = vi.fn(() => [] as FavoriteItem[])
    fetchMock.mockImplementation(() => Promise.resolve({ items: serverState(), groups: [], ungrouped: [] }))
    addMock.mockResolvedValue(undefined)
    removeMock.mockResolvedValue(undefined)

    const store = useFavoritesStore()
    await store.fetchFavorites()

    serverState.mockImplementation(() => [
      {
        productId: 'prod1',
        variantId: null,
        createdAt: '2026-01-01 10:00:00',
        deleted: false,
        title: 'Товар',
        variantName: null,
        priceRub: 10,
        image: null,
        stock: 5,
        inStock: true,
      },
    ])

    const added = await store.toggleFavorite('prod1', null)
    expect(added).toBe(true)
    expect(store.isFavorite('prod1', null)).toBe(true)
    expect(addMock).toHaveBeenCalledWith('prod1', null)
    // Ждём тихого рефетча после add.
    await new Promise((r) => setTimeout(r, 0))
    expect(store.isFavorite('prod1', null)).toBe(true)
    expect(store.items[0].title).toBe('Товар')

    const removed = await store.toggleFavorite('prod1', null)
    expect(removed).toBe(false)
    expect(store.isFavorite('prod1', null)).toBe(false)
    expect(removeMock).toHaveBeenCalledWith('prod1', null)
  })

  it('toggleFavorite rolls back optimistic add on failure', async () => {
    fetchMock.mockResolvedValue({ items: [], groups: [], ungrouped: [] })
    addMock.mockRejectedValue(new Error('network'))

    const store = useFavoritesStore()
    await store.fetchFavorites()

    await expect(store.toggleFavorite('prod1', null)).rejects.toThrow('network')
    expect(store.isFavorite('prod1', null)).toBe(false)
  })

  it('toggleFavorite rolls back optimistic remove on failure', async () => {
    fetchMock.mockResolvedValue({ items: [
      {
        productId: 'prod1',
        variantId: null,
        createdAt: '2026-01-01 10:00:00',
        deleted: false,
        title: 'Товар',
        variantName: null,
        priceRub: 10,
        image: null,
        stock: 5,
        inStock: true,
      },
    ], groups: [], ungrouped: [] })
    removeMock.mockRejectedValue(new Error('network'))

    const store = useFavoritesStore()
    await store.fetchFavorites()

    await expect(store.toggleFavorite('prod1', null)).rejects.toThrow('network')
    // Откат: снапшот записи восстанавливается без сетевого рефетча.
    expect(store.isFavorite('prod1', null)).toBe(true)
    expect(store.items[0].title).toBe('Товар')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('pending toggle blocks double click', async () => {
    fetchMock.mockResolvedValue({ items: [], groups: [], ungrouped: [] })
    let resolveAdd: () => void
    addMock.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveAdd = resolve
      }),
    )

    const store = useFavoritesStore()
    await store.fetchFavorites()

    const first = store.toggleFavorite('prod1', null)
    expect(store.isTogglePending('prod1', null)).toBe(true)

    // Второй вызов во время полёта — игнорируется.
    const second = await store.toggleFavorite('prod1', null)
    expect(second).toBe(true)

    resolveAdd!()
    await first
    expect(store.isTogglePending('prod1', null)).toBe(false)
  })

  it('separates in-stock and out-of-stock items', async () => {
    fetchMock.mockResolvedValue({ items: [
      {
        productId: 'prod1',
        variantId: null,
        createdAt: '2026-01-01 10:00:00',
        deleted: false,
        title: 'В наличии',
        variantName: null,
        priceRub: 10,
        image: null,
        stock: 5,
        inStock: true,
      },
      {
        productId: 'prod2',
        variantId: null,
        createdAt: '2026-01-02 10:00:00',
        deleted: false,
        title: 'Закончился',
        variantName: null,
        priceRub: 7,
        image: null,
        stock: 0,
        inStock: false,
      },
      {
        productId: 'prod3',
        variantId: null,
        createdAt: '2026-01-03 10:00:00',
        deleted: true,
        title: null,
        variantName: null,
        priceRub: null,
        image: null,
        stock: null,
        inStock: false,
      },
    ], groups: [], ungrouped: [] })

    const store = useFavoritesStore()
    await store.fetchFavorites()

    expect(store.inStockItems).toHaveLength(1)
    expect(store.outOfStockItems).toHaveLength(2)
  })

  it('variant granularity: same product different variants are separate', async () => {
    // Тихий рефетч после добавления: мок отражает серверное состояние,
    // запись «появляется на сервере» до тоггла — как в реальности.
    const server: FavoriteItem[] = []
    fetchMock.mockImplementation(() => Promise.resolve({ items: [...server], groups: [], ungrouped: [] }))
    addMock.mockImplementation(async (productId: string, variantId: string | null) => {
      server.push({ productId, variantId, createdAt: '', deleted: false, title: 'T', variantName: 'V', priceRub: 1, image: null, stock: 1, inStock: true })
    })
    removeMock.mockResolvedValue(undefined)

    const store = useFavoritesStore()
    await store.fetchFavorites()

    await store.toggleFavorite('prod1', 'varA')
    await store.toggleFavorite('prod1', 'varB')

    // Даём завершиться тихому рефетчу.
    await new Promise((r) => setTimeout(r, 0))

    expect(store.isFavorite('prod1', 'varA')).toBe(true)
    expect(store.isFavorite('prod1', 'varB')).toBe(true)
    expect(store.isFavorite('prod1', null)).toBe(false)
    expect(addMock).toHaveBeenCalledTimes(2)
  })

  it('group heart lights up for items added via group or from child groups', async () => {
    // Записи: одна добавлена через сердце линейки (added_group_id =
    // родитель), вторая поштучно — её группа = дочерняя подгруппа.
    fetchMock.mockResolvedValue({ items: [
      {
        productId: 'prodA',
        variantId: 'varA',
        createdAt: '',
        deleted: false,
        title: 'Через группу',
        groupId: 'grp_parent',
        groupName: 'Родитель',
        variantName: 'A',
        priceRub: 1,
        image: null,
        stock: 1,
        inStock: true,
      },
      {
        productId: 'prodB',
        variantId: null,
        createdAt: '',
        deleted: false,
        title: 'Поштучно',
        groupId: 'grp_child',
        groupName: 'Дочерняя',
        variantName: null,
        priceRub: 1,
        image: null,
        stock: 1,
        inStock: true,
      },
    ], groups: [], ungrouped: [] })

    const store = useFavoritesStore()
    await store.fetchFavorites()

    // Каталог: grp_child вложена в grp_parent.
    const catalogStore = useCatalogStore()
    catalogStore.categories = [
      {
        id: 'cat1',
        slug: 'cat1',
        name: 'К',
        order: 1,
        productCount: 2,
        groups: [
          { id: 'grp_parent', slug: 'p', name: 'Родитель', order: 1, productCount: 1, parentId: null },
          { id: 'grp_child', slug: 'c', name: 'Дочерняя', order: 2, productCount: 1, parentId: 'grp_parent' },
        ],
      },
    ] as never

    // Родительская группа: запись через группу + запись из дочерней.
    expect(store.isGroupFavorite('grp_parent')).toBe(true)
    // Дочерняя: только поштучная запись.
    expect(store.isGroupFavorite('grp_child')).toBe(true)
    // Незнакомая группа — нет.
    expect(store.isGroupFavorite('grp_other')).toBe(false)
  })
})
