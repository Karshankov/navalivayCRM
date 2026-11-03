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

  it('renders the favorites button (favorites.html design) on the home pane', async () => {
    const wrapper = mount(HomeView)

    await flushPromises()

    const link = wrapper.find('.favorites')
    expect(link.exists()).toBe(true)
    expect(link.attributes('to')).toBe('/favorites')
    expect(link.find('.favorites__title').text()).toBe('Избранное')
    // Стикер-череп из макета подключен
    expect(link.find('.favorites__sticker').exists()).toBe(true)

    wrapper.unmount()
  })

  it('renders the wheel mini card on the home pane', async () => {
    const wrapper = mount(HomeView)

    await flushPromises()

    const wheel = wrapper.find('.wheel-mini')
    expect(wheel.exists()).toBe(true)
    expect(wheel.attributes('to')).toBe('/wheel')
    expect(wheel.find('.wheel-mini__title').text()).toBe('Рулетка')

    wrapper.unmount()
  })

  it('does not refetch favorites when the store is already loaded (preload owns the first fetch)', async () => {
    const favoritesStore = useFavoritesStore()
    // Сплэш-прелоадер уже загрузил избранное до монтирования вкладки.
    favoritesStore.isLoaded = true

    mount(HomeView)
    await flushPromises()

    expect(fetchFavoritesMock).toHaveBeenCalledTimes(0)
    expect(favoritesStore.isLoaded).toBe(true)
  })
})
