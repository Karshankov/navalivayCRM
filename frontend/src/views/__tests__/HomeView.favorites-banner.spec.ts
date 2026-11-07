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

describe('HomeView shortcuts (Избранное / Часто покупают)', () => {
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

  it('renders the shortcuts pair above the category grid', async () => {
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

    // Две плитки: рабочая «Избранное» и заглушка «Часто покупают».
    const items = wrapper.findAll('.home-shortcuts__item')
    expect(items.length).toBe(2)
    expect(wrapper.find('.home-shortcuts__label').text()).toBe('Избранное')
    expect(wrapper.text()).toContain('Часто покупают')

    // Старая длинная кнопка избранного больше не рендерится.
    expect(wrapper.find('.favorites').exists()).toBe(false)

    wrapper.unmount()
  })

  it('navigates to /favorites on Избранное click', async () => {
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

    await wrapper.find('.home-shortcuts__item:not(.home-shortcuts__item--placeholder)').trigger('click')
    expect(routerPush).toHaveBeenCalledWith({ name: 'favorites' })

    wrapper.unmount()
  })

  it('Часто покупают: заглушка без функционала — клик никуда не ведёт', async () => {
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

    const placeholder = wrapper.find('.home-shortcuts__item--placeholder')
    expect(placeholder.exists()).toBe(true)
    // Это не кнопка: ни обработчика, ни навигации.
    expect(placeholder.element.tagName).not.toBe('BUTTON')

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
