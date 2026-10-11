import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import OrderAuditTimeline from '@/components/crm/OrderAuditTimeline.vue'
import type { OrderAuditEvent } from '@/stores/crm'

function event(overrides: Partial<OrderAuditEvent> = {}): OrderAuditEvent {
  return {
    sequence: 1, id: 'event-1', order_id: 'order-1', operation_id: 'operation-1',
    event_type: 'order_created', occurred_at: '2026-10-11T07:00:00.123Z',
    actor_type: 'customer', actor_id: '123', actor_name: 'Покупатель Тест',
    source: 'miniapp.create', field: null, product_id: null,
    variant_id: null, product_title: null, before: null,
    after: { order: { status: 'new' }, items: [] }, ...overrides,
  }
}

function render(events: OrderAuditEvent[] = [], history: any[] = []) {
  return mount(OrderAuditTimeline, { props: { events, history, loading: false, error: '' } })
}

describe('OrderAuditTimeline', () => {
  it('не создаёт демонстрационные события для пустого заказа', () => {
    const wrapper = render()
    expect(wrapper.findAll('.audit-step')).toHaveLength(0)
    expect(wrapper.text()).toContain('Событий пока нет')
    expect(wrapper.find('.audit-journal').exists()).toBe(false)
  })

  it('сортирует события и объединяет одну операцию в один шаг', async () => {
    const status = event({ sequence: 2, id: 'event-2', operation_id: 'operation-2',
      event_type: 'status_changed', source: 'crm.patch', field: 'status',
      before: 'new', after: 'in_progress', actor_type: 'admin',
      actor_id: 'admin', actor_name: 'Менеджер Тест', occurred_at: '2026-10-11T07:01:00.500Z' })
    const quantity = event({ ...status, sequence: 3, id: 'event-3',
      event_type: 'item_quantity_changed', field: 'quantity', before: 1, after: 2,
      product_id: 'product-1', product_title: 'Манго' })
    const wrapper = render([quantity, status, event()])
    expect(wrapper.findAll('.audit-step')).toHaveLength(2)
    expect(wrapper.findAll('.audit-step')[0]!.text()).toContain('Заказ создан')
    expect(wrapper.findAll('.audit-step')[1]!.get('strong').text()).toBe('Заказ собран менеджером')
    await wrapper.get('.audit-toggle').trigger('click')
    expect(wrapper.get('.audit-toggle').attributes('aria-expanded')).toBe('true')
    expect(wrapper.findAll('.audit-event')).toHaveLength(3)
    const changedQuantity = wrapper.findAll('.audit-event')[2]!
    expect(changedQuantity.text()).toContain('Манго')
    expect(changedQuantity.findAll('dd').map((cell) => cell.text())).toEqual(['1', '2'])
  })

  it('показывает старую историю с неизвестным автором без дублирования зеркала', () => {
    const wrapper = render([event()], [
      { id: 'old', previous_status: null, new_status: 'new',
        changed_at: '2026-10-10 07:00:00', note: 'Старое создание' },
      { id: 'mirror', previous_status: null, new_status: 'new',
        changed_at: '2026-10-11 07:00:00', note: 'Создан заказ' },
    ])
    expect(wrapper.findAll('.audit-step')).toHaveLength(2)
    expect(wrapper.findAll('.audit-step')[0]!.text()).toContain('Автор неизвестен')
    expect(wrapper.findAll('.audit-step')[0]!.text()).toContain('Старое создание')
  })

  it('форматирует UTC и старые SQLite даты по Минску, независимо от среды', () => {
    const wrapper = render([event()], [
      { id: 'old', previous_status: null, new_status: 'new',
        changed_at: '2026-10-10 21:30:00', note: 'Старое создание' },
    ])
    const times = wrapper.findAll('.audit-step time').map((time) => time.text())
    expect(times[0]).toContain('11.10.2026')
    expect(times[0]).toContain('00:30')
    expect(times[1]).toContain('10:00')
  })

  it('показывает ошибку загрузки, сохраняет события и предлагает повтор', async () => {
    const wrapper = render([event()])
    await wrapper.setProps({ error: 'Не удалось загрузить историю' })
    expect(wrapper.get('[role="alert"]').text()).toContain('Не удалось загрузить')
    expect(wrapper.findAll('.audit-step')).toHaveLength(1)
    await wrapper.findAll('button')[0]!.trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
    await wrapper.setProps({ loading: true })
    expect(wrapper.findAll('button')[0]!.attributes('disabled')).toBeDefined()
  })

  it('выводит сохранённый текст безопасно, не интерпретируя его как HTML', async () => {
    const wrapper = render([event({ event_type: 'order_field_changed', field: 'notes',
      before: '', after: '<script>alert(1)</script>', source: 'crm.patch' })])
    await wrapper.get('.audit-toggle').trigger('click')
    expect(wrapper.text()).toContain('<script>alert(1)</script>')
    expect(wrapper.find('script').exists()).toBe(false)
  })
})
