import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import OrderModal from '../AdminCategoryGroupOrderModal.vue'
import type { GroupOrderRow } from '@/utils/categoryGroupOrder'

const row = (id: string, depth = 0, parentId: string | null = null) => ({ id, name: id, slug: id, order: 1, categoryId: 'a', depth, parentId } as GroupOrderRow)
const fixture = () => [row('p'), row('p1', 1, 'p'), row('p11', 2, 'p1'), row('p2', 1, 'p'), row('q'), row('q1', 1, 'q'), row('r')]
const ids = (rows: GroupOrderRow[]) => rows.map(row => row.id)
const wrappers: VueWrapper[] = []
const AdminModalStub = defineComponent({
  props: ['isOpen', 'title', 'isLoading', 'size'],
  emits: ['close', 'cancel'],
  template: '<section v-if="isOpen"><slot /><button data-test="shell-close" @click="$emit(\'close\')">Закрыть</button></section>',
})
function setup(groups = fixture()) {
  const wrapper = mount(OrderModal, { props: { isOpen: true, categoryName: 'Жидкости', groups }, global: { stubs: { AdminModal: AdminModalStub } } })
  wrappers.push(wrapper)
  return wrapper
}
function pointer(element: Element, type: string, x: number, y: number, pointerType = 'mouse') {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { button: 0, isPrimary: true, pointerId: 1, pointerType, clientX: x, clientY: y })
  element.dispatchEvent(event)
}
function rectangles(wrapper: VueWrapper) {
  const rect = (top: number, bottom: number) => ({ x: 0, y: top, left: 0, right: 400, top, bottom, width: 400, height: bottom - top, toJSON: () => ({}) })
  vi.spyOn(wrapper.get('ol').element, 'getBoundingClientRect').mockReturnValue(rect(0, 400))
  wrapper.findAll('[data-group-id]').forEach((item, index) => vi.spyOn(item.element, 'getBoundingClientRect').mockReturnValue(rect(index * 44, (index + 1) * 44)))
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})
afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('AdminCategoryGroupOrderModal', () => {
  it('uses the near-fullscreen shell for the order editor', () => {
    const wrapper = setup()
    expect(wrapper.findComponent(AdminModalStub).props('size')).toBe('screen')
  })
  it('fades only parents with no stock anywhere in their subtree', () => {
    const wrapper = setup(fixture().map(group => ({ ...group, stockSum: 0, totalStockSum: 0 })))
    const fadedIds = wrapper.findAll('.group-order-row--empty-parent').map(item => item.attributes('data-group-id'))
    expect(fadedIds).toEqual(['p', 'p1', 'q'])
    expect(wrapper.get('[data-group-id="p"] .group-order-name').attributes('title')).toContain('Нет товаров в наличии')
    expect(wrapper.get('[data-handle-id="p"]').attributes('disabled')).toBeUndefined()
  })
  it('keeps every ancestor visible when a deeply nested group has stock', () => {
    const groups = fixture().map(group => ({ ...group, stockSum: group.id === 'p11' ? 1 : 0, totalStockSum: 0 }))
    const wrapper = setup(groups.map(group => group.id === 'p11' ? { ...group, totalStockSum: 1 } : group))
    expect(wrapper.get('[data-group-id="p"]').classes()).not.toContain('group-order-row--empty-parent')
    expect(wrapper.get('[data-group-id="p1"]').classes()).not.toContain('group-order-row--empty-parent')
    expect(wrapper.get('[data-group-id="q"]').classes()).toContain('group-order-row--empty-parent')
  })
  it('uses direct stock when aggregate stock is missing and respects aggregate stock', () => {
    const groups = fixture().map(group => ({ ...group, stockSum: group.id === 'p' ? 2 : 0 }))
    const wrapper = setup(groups.map(group => group.id === 'q' ? { ...group, totalStockSum: 3 } : group))
    expect(wrapper.get('[data-group-id="p"]').classes()).not.toContain('group-order-row--empty-parent')
    expect(wrapper.get('[data-group-id="q"]').classes()).not.toContain('group-order-row--empty-parent')
    expect(wrapper.get('[data-group-id="p1"]').classes()).toContain('group-order-row--empty-parent')
  })
  it('updates faded parents when stock data changes', async () => {
    const groups = fixture().map(group => ({ ...group, stockSum: 0, totalStockSum: 0 }))
    const wrapper = setup(groups)
    expect(wrapper.get('[data-group-id="p"]').classes()).toContain('group-order-row--empty-parent')
    await wrapper.setProps({ groups: groups.map(group => group.id === 'p11' ? { ...group, totalStockSum: 1 } : group) })
    expect(wrapper.get('[data-group-id="p"]').classes()).not.toContain('group-order-row--empty-parent')
    expect(wrapper.get('[data-group-id="p1"]').classes()).not.toContain('group-order-row--empty-parent')
  })
  it('still moves and saves faded parents with their complete subtree', async () => {
    const wrapper = setup(fixture().map(group => ({ ...group, stockSum: 0, totalStockSum: 0 })))
    const handle = wrapper.get('[data-handle-id="p"]')
    await handle.trigger('keydown', { key: ' ' })
    expect(wrapper.get('[data-group-id="p"]').classes()).toContain('group-order-row--moving')
    await handle.trigger('keydown', { key: 'ArrowDown' })
    await handle.trigger('keydown', { key: 'Enter' })
    expect(ids(wrapper.emitted('reorder')![0]![0] as GroupOrderRow[])).toEqual(['q', 'q1', 'p', 'p1', 'p11', 'p2', 'r'])
  })
  it('moves the complete subtree with the keyboard and saves only on confirmation', async () => {
    const wrapper = setup()
    const handle = wrapper.get('[data-handle-id="p"]')
    await handle.trigger('keydown', { key: ' ' })
    await handle.trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.findAll('[data-group-id]').map(item => item.attributes('data-group-id'))).toEqual(['q', 'q1', 'p', 'p1', 'p11', 'p2', 'r'])
    expect(wrapper.emitted('reorder')).toBeUndefined()
    await handle.trigger('keydown', { key: 'Enter' })
    expect(ids(wrapper.emitted('reorder')![0]![0] as GroupOrderRow[])).toEqual(['q', 'q1', 'p', 'p1', 'p11', 'p2', 'r'])
  })
  it('cancels a keyboard move with Escape without closing the window', async () => {
    const wrapper = setup()
    const handle = wrapper.get('[data-handle-id="p"]')
    await handle.trigger('keydown', { key: ' ' })
    await handle.trigger('keydown', { key: 'ArrowDown' })
    await handle.trigger('keydown', { key: 'Escape' })
    expect(wrapper.findAll('[data-group-id]').map(item => item.attributes('data-group-id'))).toEqual(ids(fixture()))
    expect(wrapper.emitted('reorder')).toBeUndefined()
    expect(wrapper.emitted('close')).toBeUndefined()
  })
  it('does not move a child outside its parent or save an unchanged order', async () => {
    const wrapper = setup()
    const handle = wrapper.get('[data-handle-id="p2"]')
    await handle.trigger('keydown', { key: ' ' })
    await handle.trigger('keydown', { key: 'ArrowDown' })
    await handle.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('reorder')).toBeUndefined()
  })
  it.each(['mouse', 'touch'])('moves a parent and descendants using %s pointer input', async (pointerType) => {
    const wrapper = setup()
    rectangles(wrapper)
    const handle = wrapper.get('[data-handle-id="p"]').element
    pointer(handle, 'pointerdown', 20, 20, pointerType)
    pointer(handle, 'pointermove', 20, 248, pointerType)
    pointer(handle, 'pointerup', 20, 248, pointerType)
    expect(ids(wrapper.emitted('reorder')![0]![0] as GroupOrderRow[])).toEqual(['q', 'q1', 'p', 'p1', 'p11', 'p2', 'r'])
  })
  it('cancels pointer input and rejects dropping outside the list', () => {
    const wrapper = setup()
    rectangles(wrapper)
    const handle = wrapper.get('[data-handle-id="p"]').element
    pointer(handle, 'pointerdown', 20, 20)
    pointer(handle, 'pointermove', 20, 248)
    pointer(handle, 'pointercancel', 20, 248)
    pointer(handle, 'pointerup', 20, 248)
    pointer(handle, 'pointerdown', 20, 20)
    pointer(handle, 'pointermove', 500, 248)
    pointer(handle, 'pointerup', 500, 248)
    expect(wrapper.emitted('reorder')).toBeUndefined()
  })
  it('blocks movement and closing during a save', async () => {
    const wrapper = setup()
    await wrapper.setProps({ busy: true })
    expect(wrapper.findAll('[data-handle-id]').every(item => item.attributes('disabled') !== undefined)).toBe(true)
    await wrapper.get('[data-handle-id="p"]').trigger('keydown', { key: ' ' })
    await wrapper.get('[data-test="shell-close"]').trigger('click')
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(wrapper.emitted('reorder')).toBeUndefined()
    await wrapper.setProps({ busy: false })
    await wrapper.get('[data-test="shell-close"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
  it('shows empty and error states without product images', async () => {
    const wrapper = setup([])
    await wrapper.setProps({ errorText: 'Не удалось подтвердить сохранение' })
    expect(wrapper.get('[role="alert"]').text()).toContain('Не удалось подтвердить')
    expect(wrapper.text()).toContain('Линеек пока нет')
    expect(wrapper.find('img').exists()).toBe(false)
  })
})
