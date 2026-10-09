import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, nextTick, ref } from 'vue'
import AdminView from '@/views/AdminView.vue'
import { useAdminStore } from '@/stores/admin'

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(() => Promise.resolve()) }),
  useRoute: () => ({ path: '/admin', query: {} }),
}))

const AdminModalStub = defineComponent({
  name: 'AdminModal',
  props: {
    isOpen: Boolean,
    title: String,
  },
  emits: ['close', 'cancel'],
  setup(_props, { expose }) {
    const scrollContainer = ref<HTMLElement | null>(null)
    expose({ scrollContainer })
    return { scrollContainer }
  },
  template: `
    <section v-if="isOpen" data-test="admin-modal" :data-modal-title="title">
      <div ref="scrollContainer" data-test="modal-scroll"><slot /></div>
      <button data-test="modal-close" @click="$emit('close')">Закрыть</button>
    </section>
  `,
})

describe('AdminView: соседние окна линеек', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('скрывает линейки под оптовыми ссылками и возвращает состояние со скроллом', async () => {
    const adminStore = useAdminStore()
    vi.spyOn(adminStore, 'checkAuth').mockResolvedValue(false)
    vi.spyOn(adminStore, 'fetchWholesaleLinks').mockResolvedValue([] as never)

    const wrapper = shallowMount(AdminView, {
      global: {
        stubs: {
          AdminModal: AdminModalStub,
          RouterView: true,
        },
      },
    })
    await flushPromises()

    const category = { id: 'liquids', slug: 'liquids', name: 'Жидкости', order: 1 }
    const group = {
      id: 'group_1',
      categoryId: category.id,
      slug: 'iceberg',
      name: 'ICEBERG',
      order: 1,
      depth: 0,
    }
    const vm = wrapper.vm as any
    vm.activeGroupCategory = category
    vm.editableGroups = [group]
    vm.showGroupModal = true
    await nextTick()

    const groupModal = wrapper.get('[data-test="admin-modal"]')
    expect(groupModal.attributes('data-modal-title')).toBe('Линейки: Жидкости')
    const groupScroll = groupModal.get('[data-test="modal-scroll"]').element as HTMLElement
    groupScroll.scrollTop = 173

    await vm.openWholesaleLinksModal()
    await flushPromises()

    const wholesaleModal = wrapper.get('[data-test="admin-modal"]')
    expect(wrapper.findAll('[data-test="admin-modal"]')).toHaveLength(1)
    expect(wholesaleModal.attributes('data-modal-title')).toBe('Оптовые ссылки')
    expect(vm.activeGroupCategory).toEqual(category)
    expect(vm.editableGroups).toEqual([group])

    await wholesaleModal.get('[data-test="modal-close"]').trigger('click')
    await flushPromises()

    const restoredGroupModal = wrapper.get('[data-test="admin-modal"]')
    expect(restoredGroupModal.attributes('data-modal-title')).toBe('Линейки: Жидкости')
    expect((restoredGroupModal.get('[data-test="modal-scroll"]').element as HTMLElement).scrollTop).toBe(173)
    expect(vm.activeGroupCategory).toEqual(category)
    expect(vm.editableGroups).toEqual([group])

    vm.openMinStockEditor(group)
    await nextTick()
    expect(wrapper.findAll('[data-test="admin-modal"]')).toHaveLength(0)
    expect(vm.minStockEditorOpen).toBe(true)

    vm.closeMinStockEditor()
    await flushPromises()
    const afterMinStock = wrapper.get('[data-test="admin-modal"]')
    expect(afterMinStock.attributes('data-modal-title')).toBe('Линейки: Жидкости')
    expect((afterMinStock.get('[data-test="modal-scroll"]').element as HTMLElement).scrollTop).toBe(173)
  })
})
