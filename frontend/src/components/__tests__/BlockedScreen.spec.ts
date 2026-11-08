import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import BlockedScreen from '@/components/BlockedScreen.vue'

const refreshBlockMock = vi.hoisted(() => vi.fn())

vi.mock('@/composables/useCustomerBlock', () => ({
  useCustomerBlock: () => ({
    currentBlock: { value: null },
    isBlocked: { value: false },
    refreshBlock: refreshBlockMock,
  }),
}))

describe('BlockedScreen (полноэкранный дизайн из демо)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-07T12:00:00Z'))
    refreshBlockMock.mockClear()
  })

  it('рендерит маскота с мерцающими замками и заголовок', () => {
    const wrapper = mount(BlockedScreen, {
      props: { reason: 'Нарушение правил', blockUntil: null },
    })

    expect(wrapper.find('.blocked-screen__mascot').exists()).toBe(true)
    // Два замка в глазах (левый и правый, фазы разные).
    expect(wrapper.findAll('.blocked-screen__digits').length).toBe(2)
    expect(wrapper.find('.blocked-screen__digits--right').exists()).toBe(true)
    // Картинка маскота подключена.
    expect(wrapper.find('.blocked-screen__mascot image').attributes('href')).toBe(
      '/blocked/mascot.png',
    )
    expect(wrapper.find('.blocked-screen__title').text()).toBe('Аккаунт заблокирован')

    wrapper.unmount()
  })

  it('показывает причину и дату снятия из пропсов', () => {
    const wrapper = mount(BlockedScreen, {
      props: {
        reason: 'Спам в чате',
        // Больше суток: полная дата.
        blockUntil: '2026-11-10 15:00:00',
      },
    })

    expect(wrapper.text()).toContain('Причина блокировки')
    expect(wrapper.text()).toContain('Спам в чате')
    expect(wrapper.text()).toContain('Когда снимется блокировка')
    expect(wrapper.text()).toContain('10 ноября 2026')

    wrapper.unmount()
  })

  it('бессрочная блокировка: «Блокировка бессрочна»', () => {
    const wrapper = mount(BlockedScreen, {
      props: { reason: null, blockUntil: null },
    })

    expect(wrapper.text()).toContain('Причина не указана')
    expect(wrapper.text()).toContain('Блокировка бессрочна')

    wrapper.unmount()
  })

  it('меньше суток: таймер «Доступ откроется через X»', () => {
    const wrapper = mount(BlockedScreen, {
      props: {
        reason: 'Тест',
        // 2 часа от системного времени.
        blockUntil: '2026-11-07 14:00:00',
      },
    })

    expect(wrapper.text()).toContain('Доступ откроется через')
    expect(wrapper.text()).toContain('2 часа')

    wrapper.unmount()
  })

  it('истёкший срок: проверяем доступ и периодический refreshBlock', async () => {
    const wrapper = mount(BlockedScreen, {
      props: {
        reason: 'Тест',
        // Срок уже прошёл относительно системного времени.
        blockUntil: '2026-11-07 11:00:00',
      },
    })

    expect(wrapper.text()).toContain('Проверяем доступ…')

    // Тик через 30 секунд — refreshBlock дёргается повторно.
    await vi.advanceTimersByTimeAsync(31_000)
    expect(refreshBlockMock.mock.calls.length).toBeGreaterThanOrEqual(1)

    wrapper.unmount()
  })
})
