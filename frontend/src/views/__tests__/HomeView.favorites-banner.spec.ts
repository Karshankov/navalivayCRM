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

  it('renders the favorites banner button below the banner area', async () => {
    const wrapper = mount(HomeView, {
      global: {
        stubs: {
          SmokeParticles: { template: '<div />' },
          BannerCarousel: { template: '<div />' },
          FloatingCartBar: { template: '<div />' },
        },
      },
    })

    await flushPromises()

    const banner = wrapper.find('.favorites')
    expect(banner.exists()).toBe(true)
    expect(banner.attributes('aria-label')).toBe('Открыть избранное')
    expect(wrapper.find('.favorites__title').text()).toBe('Избранное')

    wrapper.unmount()
  })

  it('navigates to /favorites on click', async () => {
    const wrapper = mount(HomeView, {
      global: {
        stubs: {
          SmokeParticles: { template: '<div />' },
          BannerCarousel: { template: '<div />' },
          FloatingCartBar: { template: '<div />' },
        },
      },
    })

    await flushPromises()

    await wrapper.find('.favorites').trigger('click')
    expect(routerPush).toHaveBeenCalledWith({ name: 'favorites' })

    wrapper.unmount()
  })

  it('loads favorites once on mount', async () => {
    mount(HomeView, {
      global: {
        stubs: {
          SmokeParticles: { template: '<div />' },
          BannerCarousel: { template: '<div />' },
          FloatingCartBar: { template: '<div />' },
        },
      },
    })

    await flushPromises()

    expect(fetchFavoritesMock).toHaveBeenCalledTimes(1)
    const favoritesStore = useFavoritesStore()
    expect(favoritesStore.isLoaded).toBe(true)
    expect(favoritesStore.items).toEqual([])
  })
})
