import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, nextTick, ref } from 'vue'
import AdminView from '@/views/AdminView.vue'
import OrderModal from '@/components/admin/AdminCategoryGroupOrderModal.vue'
import { useAdminStore, type CategoryGroup } from '@/stores/admin'
import { moveGroupSubtree, type GroupOrderRow } from '@/utils/categoryGroupOrder'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn(() => Promise.resolve()) }), useRoute: () => ({ path: '/admin', query: {} }) }))
const wrappers: VueWrapper[] = []
const category = { id: 'a', slug: 'a', name: 'Жидкости', order: 1 }
const row = (id: string, order: number, parentId: string | null = null, categoryId = 'a') => ({ id, name: id, slug: id, order, parentId, categoryId, stockSum: 0, totalStockSum: 0 } as CategoryGroup)
const ids = (rows: GroupOrderRow[]) => rows.map(row => row.id)
const AdminModalStub = defineComponent({
  props: ['isOpen', 'title'],
  emits: ['close', 'cancel'],
  setup(_props, { expose }) { const scrollContainer = ref<HTMLElement | null>(null); expose({ scrollContainer }); return { scrollContainer } },
  template: '<section v-if="isOpen" data-test="admin-modal"><div ref="scrollContainer" data-test="modal-scroll"><slot /></div></section>',
})
async function setup() {
  const store = useAdminStore()
  vi.spyOn(store, 'checkAuth').mockResolvedValue(false)
  const wrapper = shallowMount(AdminView, { global: { stubs: { AdminModal: AdminModalStub, RouterView: true } } })
  wrappers.push(wrapper)
  await flushPromises()
  store.categoryGroups = [row('p', 1), row('p1', 2, 'p'), row('q', 3), row('other', 1, null, 'b')]
  const vm = wrapper.vm as any
  vm.activeGroupCategory = category
  vm.syncEditableGroups(category.id)
  vm.showGroupModal = true
  await nextTick()
  const current = [...vm.editableGroups] as GroupOrderRow[]
  const moved = moveGroupSubtree(current, 'p', 'q', 'after')
  return { store, wrapper, vm, current, moved }
}
beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
  vi.restoreAllMocks()
})

describe('AdminView category-scoped group order', () => {
  it('opens only the selected category and restores the parent window scroll', async () => {
    const { wrapper, vm } = await setup()
    const scroll = wrapper.get('[data-test="modal-scroll"]').element as HTMLElement
    scroll.scrollTop = 137
    await wrapper.get('[data-test="group-order-open"]').trigger('click')
    expect(wrapper.find('[data-test="admin-modal"]').exists()).toBe(false)
    expect(wrapper.getComponent(OrderModal).props('categoryName')).toBe('Жидкости')
    expect(ids(wrapper.getComponent(OrderModal).props('groups'))).toEqual(['p', 'p1', 'q'])
    await vm.closeGroupOrder()
    expect((wrapper.get('[data-test="modal-scroll"]').element as HTMLElement).scrollTop).toBe(137)
    expect(vm.activeGroupCategory.id).toBe('a')
  })
  it('saves only this category, blocks repeated writes and reconciles server order', async () => {
    const { store, vm, moved } = await setup()
    let resolveSave!: () => void
    const save = vi.spyOn(store, 'reorderCategoryGroups').mockImplementation(() => new Promise<void>(resolve => { resolveSave = resolve }))
    const fetch = vi.spyOn(store, 'fetchCategoryGroups').mockImplementation(async () => {
      store.categoryGroups = [row('q', 1), row('p', 2), row('p1', 3, 'p'), row('other', 1, null, 'b')]
      return [] as never
    })
    vm.openGroupOrder()
    const pending = vm.reorderGroups(moved)
    expect(vm.groupModalLoading).toBe(true)
    await vm.reorderGroups(moved)
    await vm.closeGroupOrder()
    expect(vm.showGroupOrderModal).toBe(true)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith([{ id: 'q', order: 1 }, { id: 'p', order: 2 }, { id: 'p1', order: 3 }])
    resolveSave()
    await pending
    expect(fetch).toHaveBeenCalledWith('a')
    expect(ids(vm.editableGroups)).toEqual(['q', 'p', 'p1'])
    expect(store.categoryGroups.find(group => group.id === 'other')?.order).toBe(1)
    expect(vm.groupModalLoading).toBe(false)
  })
  it('uses server truth when a save response is lost', async () => {
    const { store, vm, moved } = await setup()
    vi.spyOn(store, 'reorderCategoryGroups').mockRejectedValue(new Error('Lost response'))
    vi.spyOn(store, 'fetchCategoryGroups').mockImplementation(async () => {
      store.categoryGroups = [row('q', 1), row('p', 2), row('p1', 3, 'p'), row('other', 1, null, 'b')]
      return [] as never
    })
    await vm.reorderGroups(moved)
    expect(ids(vm.editableGroups)).toEqual(['q', 'p', 'p1'])
    expect(vm.groupOrderError).toContain('актуальный порядок с сервера')
    expect(vm.groupModalLoading).toBe(false)
  })
  it('restores the confirmed snapshot when saving and reconciliation both fail', async () => {
    const { store, vm, current, moved } = await setup()
    vi.spyOn(store, 'reorderCategoryGroups').mockRejectedValue(new Error('Offline'))
    vi.spyOn(store, 'fetchCategoryGroups').mockRejectedValue(new Error('Offline'))
    await vm.reorderGroups(moved)
    expect(ids(vm.editableGroups)).toEqual(ids(current))
    expect(vm.groupOrderError).toContain('Не удалось подтвердить')
    expect(vm.groupModalLoading).toBe(false)
  })
  it('keeps a successful save if the following refresh fails', async () => {
    const { store, vm, moved } = await setup()
    const save = vi.spyOn(store, 'reorderCategoryGroups').mockImplementation(async items => {
      items.forEach(item => { store.categoryGroups.find(group => group.id === item.id)!.order = item.order })
    })
    vi.spyOn(store, 'fetchCategoryGroups').mockRejectedValue(new Error('Refresh failed'))
    await vm.reorderGroups(moved)
    expect(save).toHaveBeenCalledTimes(1)
    expect(ids(vm.editableGroups)).toEqual(['q', 'p', 'p1'])
    expect(vm.groupOrderError).toContain('Порядок сохранён')
    expect(vm.groupModalLoading).toBe(false)
  })
  it('rejects foreign categories, changed parents and duplicate ids before writing', async () => {
    const { store, vm, current } = await setup()
    const save = vi.spyOn(store, 'reorderCategoryGroups').mockResolvedValue(undefined)
    await vm.reorderGroups([{ ...current[0], categoryId: 'b' }, ...current.slice(1)])
    await vm.reorderGroups([current[0], { ...current[1], parentId: 'q' }, current[2]])
    await vm.reorderGroups([current[0], current[0], current[2]])
    expect(save).not.toHaveBeenCalled()
    expect(vm.groupOrderError).toContain('Список линеек изменился')
  })
})
