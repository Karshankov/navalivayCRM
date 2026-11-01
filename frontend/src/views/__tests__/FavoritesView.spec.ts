import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import FavoritesView from '@/views/FavoritesView.vue'
import { useFavoritesStore, type FavoriteGroup } from '@/stores/favorites'
import { useCartStore } from '@/stores/cart'
import { useCatalogStore } from '@/stores/catalog'

const fetchFavoritesMock = vi.hoisted(() => vi.fn())
const addFavoriteGroupApiMock = vi.hoisted(() => vi.fn())
const removeFavoriteGroupApiMock = vi.hoisted(() => vi.fn())
const reorderFavoritesApiMock = vi.hoisted(() => vi.fn())
const routerPush = vi.hoisted(() => vi.fn())

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPush }),
}))

vi.mock('@/utils/favoritesApi', () => {
  class FavoritesAuthError extends Error {
    name = 'FavoritesAuthError'
  }
  return {
    fetchFavoritesApi: fetchFavoritesMock,
    addFavoriteGroupApi: addFavoriteGroupApiMock,
    removeFavoriteGroupApi: removeFavoriteGroupApiMock,
    reorderFavoritesApi: reorderFavoritesApiMock,
    addFavoriteApi: vi.fn(),
    removeFavoriteApi: vi.fn(),
    FavoritesAuthError,
  }
})

vi.mock('@/utils/telegramMiniAppContext', () => ({
  hasTelegramMiniAppUserContext: () => true,
}))

function favoriteItem(overrides: Record<string, unknown> = {}) {
  return {
    productId: 'prod1',
    variantId: null,
    createdAt: '2026-01-01 10:00:00',
    deleted: false,
    title: 'Товар один',
    groupId: 'grp1',
    groupName: 'PODONKI PODGON',
    groupPosition: null,
    variantName: null,
    strength: '50MG',
    priceRub: 10,
    image: null,
    stock: 5,
    inStock: true,
    ...overrides,
  }
}

function favoriteGroup(overrides: Partial<FavoriteGroup> = {}): FavoriteGroup {
  return {
    groupId: 'grp1',
    groupName: 'PODONKI PODGON',
    groupSlug: 'pp',
    groupCover: null,
    groupPosition: null,
    groupUnavailable: false,
    totalCount: 1,
    items: [favoriteItem()],
    ...overrides,
  }
}

function payload(groups: FavoriteGroup[], items = groups.flatMap((g) => g.items)) {
  return { items, groups, ungrouped: [] }
}

/** Каталог с категорией, линейкой и дочерней подгруппой. */
function seedCatalogStore() {
  const catalogStore = useCatalogStore()
  catalogStore.categories = [
    {
      id: 'cat1',
      slug: 'cat1',
      name: 'Жидкости',
      order: 1,
      productCount: 1,
      coverImage: null,
      hasCoverImage: false,
      displayMode: 'liquid',
      storefrontFiltersProfile: 'none',
      groups: [
        {
          id: 'grp1',
          slug: 'pp',
          name: 'PODONKI PODGON',
          order: 1,
          productCount: 1,
          coverImage: null,
          hasCoverImage: false,
          parentId: null,
          mark: null,
        },
        {
          id: 'grp_child',
          slug: 'pp-child',
          name: 'PODONKI PODGON SOUR',
          order: 2,
          productCount: 1,
          coverImage: null,
          hasCoverImage: false,
          parentId: 'grp1',
          mark: null,
        },
      ],
    },
  ] as never
  catalogStore.allProducts = [
    {
      id: 'prod1',
      categoryId: 'cat1',
      groupId: 'grp1',
      title: 'Товар один',
      priceRub: 10,
      description: '',
      images: [],
      createdAt: '',
      stock: 5,
      hasVariants: false,
    },
    {
      id: 'prod2',
      categoryId: 'cat1',
      groupId: 'grp_child',
      title: 'Кислый вкус',
      priceRub: 12,
      description: '',
      images: [],
      createdAt: '',
      stock: 3,
      hasVariants: false,
    },
  ] as never
  return catalogStore
}

describe('FavoritesView (карточки каталога LiquidLineTree)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    routerPush.mockClear()

    const cartStore = useCartStore()
    cartStore.items = []
  })

  async function mountView(
    groups: FavoriteGroup[],
    favPayload = payload(groups),
    extraSeed?: (catalogStore: ReturnType<typeof useCatalogStore>) => void,
  ) {
    seedCatalogStore()
    if (extraSeed) extraSeed(useCatalogStore())
    fetchFavoritesMock.mockResolvedValue(favPayload)
    const wrapper = mount(FavoritesView, {
      global: {
        stubs: { ToastNotification: { template: '<div />' } },
      },
    })
    await flushPromises()
    return wrapper
  }

  it('shows empty state when no favorite groups', async () => {
    const wrapper = await mountView([])
    expect(wrapper.text()).toContain('В избранном пока пусто')
    expect(wrapper.text()).toContain('К категориям')
    wrapper.unmount()
  })

  it('renders catalog LiquidLineCard with group name', async () => {
    const wrapper = await mountView([favoriteGroup()])

    // Настоящая карточка каталога, не самодельная
    expect(wrapper.find('.liquid-line-card').exists()).toBe(true)
    expect(wrapper.text()).toContain('PODONKI PODGON')
    wrapper.unmount()
  })

  it('editing mode shows same deduplicated cards: parent favorite absorbs nested child', async () => {
    // В избранном две записи: родитель grp1 и вложенная grp_child.
    // Фантом-баг: edit-режим показывал обе отдельными карточками.
    const groups = [
      favoriteGroup({
        items: [
          favoriteItem(),
          favoriteItem({ productId: 'prod2', groupId: 'grp1', groupName: 'PODONKI PODGON' }),
        ],
      }),
      favoriteGroup({
        groupId: 'grp_child',
        groupName: 'PODONKI PODGON SOUR',
        items: [favoriteItem({ productId: 'prod2', groupId: 'grp_child', groupName: 'PODONKI PODGON SOUR' })],
      }),
    ]
    reorderFavoritesApiMock.mockResolvedValue(undefined)
    const wrapper = await mountView(groups)

    await wrapper.find('.reorder').trigger('click')

    // В режиме сортировки — одна карточка (родитель поглотил ребёнка), не две
    const editCards = wrapper.findAll('.card')
    expect(editCards.length).toBe(1)
    expect(editCards[0].text()).toContain('PODONKI PODGON')
    expect(editCards[0].text()).not.toContain('SOUR')
    wrapper.unmount()
  })

  it('renders catalog cards in saved drag-n-drop order (group_position)', async () => {
    const groups = [
      favoriteGroup({
        groupId: 'grp1',
        groupName: 'PODONKI PODGON',
        groupPosition: 1,
      }),
      favoriteGroup({
        groupId: 'grp2',
        groupName: 'ЗЛАЯ МОНАШКА',
        groupPosition: 0,
        items: [favoriteItem({ productId: 'prod3', groupId: 'grp2', groupName: 'ЗЛАЯ МОНАШКА' })],
      }),
    ]
    const wrapper = await mountView(groups, payload(groups), (catalogStore) => {
      ;(catalogStore.categories[0] as never as { groups: unknown[] }).groups.push({
        id: 'grp2',
        slug: 'grp2',
        name: 'ЗЛАЯ МОНАШКА',
        order: 2,
        productCount: 1,
        coverImage: null,
        hasCoverImage: false,
        parentId: null,
        mark: null,
      })
      ;(catalogStore.allProducts as never as Array<Record<string, unknown>>).push({
        id: 'prod3',
        categoryId: 'cat1',
        groupId: 'grp2',
        title: 'Монашкин вкус',
        priceRub: 9,
        description: '',
        images: [],
        createdAt: '',
        stock: 2,
        hasVariants: false,
      })
    })

    // Первой должна идти ЗЛАЯ МОНАШКА (position 0), несмотря на порядок каталога.
    const titles = wrapper.findAll('.liquid-line-title').map((t) => t.text())
    expect(titles[0]).toBe('ЗЛАЯ МОНАШКА')
    expect(titles[1]).toBe('PODONKI PODGON')
    wrapper.unmount()
  })

  it('renders separate cards for multiple favorite groups in the same category', async () => {
    const groups = [
      favoriteGroup(),
      favoriteGroup({
        groupId: 'grp2',
        groupName: 'ЗЛАЯ МОНАШКА',
        items: [favoriteItem({ productId: 'prod3', groupId: 'grp2', groupName: 'ЗЛАЯ МОНАШКА' })],
      }),
    ]
    const wrapper = await mountView(groups, payload(groups), (catalogStore) => {
      ;(catalogStore.categories[0] as never as { groups: unknown[] }).groups.push({
        id: 'grp2',
        slug: 'grp2',
        name: 'ЗЛАЯ МОНАШКА',
        order: 2,
        productCount: 1,
        coverImage: null,
        hasCoverImage: false,
        parentId: null,
        mark: null,
      })
      ;(catalogStore.allProducts as never as Array<Record<string, unknown>>).push({
        id: 'prod3',
        categoryId: 'cat1',
        groupId: 'grp2',
        title: 'Монашкин вкус',
        priceRub: 9,
        description: '',
        images: [],
        createdAt: '',
        stock: 2,
        hasVariants: false,
      })
    })

    // Обе карточки каталога: не одна поглотила другую
    const cards = wrapper.findAll('.liquid-line-card')
    expect(cards.length).toBe(2)
    expect(wrapper.text()).toContain('PODONKI PODGON')
    expect(wrapper.text()).toContain('ЗЛАЯ МОНАШКА')
    wrapper.unmount()
  })

  it('expands a parent lineup into child sublines and flavors (as in catalog)', async () => {
    // Линейка grp1: позиция в родителе + позиция в дочерней подгруппе.
    const groups = [
      favoriteGroup({
        items: [
          favoriteItem(),
          favoriteItem({ productId: 'prod2', groupId: 'grp1', groupName: 'PODONKI PODGON' }),
        ],
      }),
    ]
    const wrapper = await mountView(groups)

    // Свёрнуто: вкусов не видно
    expect(wrapper.findAll('.liquid-flavor-row')).toHaveLength(0)

    // Раскрываем линейку: и подгруппа, и вкусы внутри карточки
    await wrapper.find('.liquid-line-header').trigger('click')
    expect(wrapper.text()).toContain('PODONKI PODGON SOUR')
    expect(wrapper.findAll('.liquid-flavor-row').length).toBeGreaterThanOrEqual(1)
    // Навигации не было — раскрытие на месте
    expect(routerPush).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('shows skeleton while loading', async () => {
    seedCatalogStore()
    fetchFavoritesMock.mockReturnValue(new Promise(() => {}))
    const wrapper = mount(FavoritesView, {
      global: { stubs: { ToastNotification: { template: '<div />' } } },
    })

    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('.card--skeleton')).toHaveLength(3)
    wrapper.unmount()
  })

  it('toggle editing button switches to save mode and persists order', async () => {
    reorderFavoritesApiMock.mockResolvedValue(undefined)
    const wrapper = await mountView([favoriteGroup()])

    const editButton = wrapper.find('.reorder')
    expect(editButton.text()).toContain('Изменить очередность')

    expect(wrapper.find('.favorites-app').classes()).not.toContain('editing')

    await editButton.trigger('click')
    expect(editButton.text()).toContain('Сохранить изменения')
    expect(wrapper.find('.favorites-app').classes()).toContain('editing')
    expect(reorderFavoritesApiMock).not.toHaveBeenCalled()

    await editButton.trigger('click')
    expect(reorderFavoritesApiMock).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('shows auth error screen when telegram context missing', async () => {
    const { FavoritesAuthError } = await import('@/utils/favoritesApi')
    fetchFavoritesMock.mockRejectedValue(new FavoritesAuthError())
    const favoritesStore = useFavoritesStore()

    const wrapper = mount(FavoritesView, {
      global: { stubs: { ToastNotification: { template: '<div />' } } },
    })
    await flushPromises()

    expect(favoritesStore.isAuthError).toBe(true)
    expect(wrapper.text()).toContain('Откройте мини-приложение из Telegram')
    wrapper.unmount()
  })

  it('shows red cart CTA when cart has items, hidden when empty', async () => {
    const cartStore = useCartStore()

    const emptyWrapper = await mountView([favoriteGroup()])
    expect(emptyWrapper.find('.cart-button').exists()).toBe(false)
    emptyWrapper.unmount()

    cartStore.items = [{ productId: 'prod1', title: 'Товар один', priceRub: 10, quantity: 2 }]
    const wrapper = await mountView([favoriteGroup()])
    const cta = wrapper.find('.cart-button')
    expect(cta.exists()).toBe(true)
    expect(cta.text()).toContain('Заказ на 20.00 BYN')

    await cta.trigger('click')
    expect(routerPush).toHaveBeenCalledWith('/checkout')
    wrapper.unmount()
  })

  it('cart CTA hidden while editing order', async () => {
    const cartStore = useCartStore()
    cartStore.items = [{ productId: 'prod1', title: 'Товар один', priceRub: 10, quantity: 1 }]

    reorderFavoritesApiMock.mockResolvedValue(undefined)
    const wrapper = await mountView([favoriteGroup()])
    expect(wrapper.find('.cart-button').exists()).toBe(true)

    await wrapper.find('.reorder').trigger('click')
    expect(wrapper.find('.cart-button').exists()).toBe(false)
    wrapper.unmount()
  })
})
