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

    // Три плитки: «Скидки» (только вёрстка), рабочая «Избранное» и
    // декоративный «Баланс кэшбэка».
    const tiles = wrapper.findAll('.nvl-discounts, .home-shortcuts__item')
    expect(tiles.length).toBe(3)
    expect(wrapper.find('.nvl-discounts__label').text()).toBe('Скидки')
    // Подписи ищутся по своей плитке, а не «первая попавшаяся»:
    // порядок плиток в сетке менялся и больше не совпадает с DOM.
    expect(wrapper.find('.home-shortcuts__item--favorites .home-shortcuts__label').text()).toBe('Избранное')
    expect(wrapper.find('.home-shortcuts__item--cashback .home-shortcuts__label').text()).toBe('Баланс кэшбэка')

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

    // Только «Избранное» ведёт на /favorites; «Скидки» пока без
    // обработчика, «Баланс кэшбэка» — декоративный.
    const favorites = wrapper
      .findAll('.home-shortcuts__item:not(.home-shortcuts__item--placeholder)')
      .find((item) => item.text().includes('Избранное'))
    expect(favorites).toBeDefined()
    await favorites!.trigger('click')
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
    // Картинка баланса — монета кэшбэка; кошелёк и бирка лежат
    // в public/shortcuts/_backup/ на случай возврата.
    expect(cashback.find('img').attributes('src')).toBe('/shortcuts/cashback-coin.png')

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
