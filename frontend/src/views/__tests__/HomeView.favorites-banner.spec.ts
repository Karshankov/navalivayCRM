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

describe('HomeView shortcuts (Избранное / Баланс кэшбэка)', () => {
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

    // Две плитки: рабочая «Избранное» и декоративный «Баланс кэшбэка».
    const items = wrapper.findAll('.home-shortcuts__item')
    expect(items.length).toBe(2)
    expect(wrapper.find('.home-shortcuts__label').text()).toBe('Избранное')
    expect(wrapper.text()).toContain('Баланс кэшбэка')

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

  it('Баланс кэшбэка: декоративный баланс без функционала — клик никуда не ведёт', async () => {
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

    const cashback = wrapper.find('.home-shortcuts__item--cashback')
    expect(cashback.exists()).toBe(true)
    expect(cashback.text()).toContain('15')
    expect(cashback.text()).toContain('BYN')
    expect(cashback.text()).toContain('Баланс кэшбэка')
    expect(cashback.element.tagName).not.toBe('BUTTON')
    expect(cashback.find('img').attributes('src')).toBe('/shortcuts/cashback-wallet.webp')

    await cashback.trigger('click')
    expect(routerPush).not.toHaveBeenCalled()

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
