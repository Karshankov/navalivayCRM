import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import HomeView from '@/views/HomeView.vue'
import { useCatalogStore } from '@/stores/catalog'
import { useFavoritesStore } from '@/stores/favorites'

const fetchMyActiveOrderMock = vi.hoisted(() => vi.fn())
const fetchFavoritesMock = vi.hoisted(() => vi.fn())
const routerPush = vi.hoisted(() => vi.fn())

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPush }),
  RouterLink: {
    props: ['to'],
    template: '<a><slot /></a>',
  },
}))

vi.mock('@/utils/customerOrders', () => ({
  getTelegramIdentity: () => ({ telegram_id: '11' }),
  fetchMyActiveOrder: fetchMyActiveOrderMock,
}))

vi.mock('@/utils/favoritesApi', () => ({
  fetchFavoritesApi: fetchFavoritesMock,
  addFavoriteApi: vi.fn(),
  removeFavoriteApi: vi.fn(),
  FavoritesAuthError: class extends Error {},
}))

/**
 * Новая главная вкладка: избранное и рулетка — быстрые ссылки-карточки,
 * а не отдельный баннер FavoritesBanner.
 */
describe('HomeView favorites banner', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    fetchMyActiveOrderMock.mockResolvedValue(null)
    fetchFavoritesMock.mockResolvedValue({ items: [], groups: [], ungrouped: [] })

    const catalogStore = useCatalogStore()
    catalogStore.categories = []
    catalogStore.banners = []
    vi.spyOn(catalogStore, 'initialize').mockResolvedValue(undefined)
  })

  it('renders the favorites quick link on the home pane', async () => {
    const wrapper = mount(HomeView)

    await flushPromises()

    const link = wrapper.findAll('.quick-link')[0]
    expect(link.exists()).toBe(true)
    expect(link.attributes('to')).toBe('/favorites')
    expect(wrapper.find('.quick-link__title').text()).toBe('Избранное')

    wrapper.unmount()
  })

  it('renders the wheel quick link on the home pane', async () => {
    const wrapper = mount(HomeView)

    await flushPromises()

    const links = wrapper.findAll('.quick-link')
    expect(links).toHaveLength(2)
    expect(links[1].attributes('to')).toBe('/wheel')
    expect(links[1].find('.quick-link__title').text()).toBe('Рулетка')

    wrapper.unmount()
  })

  it('loads favorites once on mount', async () => {
    mount(HomeView)

    await flushPromises()

    expect(fetchFavoritesMock).toHaveBeenCalledTimes(1)
    const favoritesStore = useFavoritesStore()
    expect(favoritesStore.isLoaded).toBe(true)
    expect(favoritesStore.items).toEqual([])
  })
})
