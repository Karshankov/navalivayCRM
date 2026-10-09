import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, ref } from 'vue'
import AdminStockTransferModal from '@/components/admin/AdminStockTransferModal.vue'
import { useAdminStore } from '@/stores/admin'
import { useCrmStore } from '@/stores/crm'

const draftTransfer = {
  id: 'move_1',
  transfer_number: 1,
  source_location: 'warehouse' as const,
  destination_location: 'retail' as const,
  status: 'draft' as const,
  created_at: '2026-07-20 12:00:00',
  created_by: 'admin',
  total_quantity: 2,
  item_count: 1,
  items: [{
    id: 'item_1',
    product_title: 'Манго',
    variant_name: 'Холодный манго',
    category_name: 'Жидкости',
    group_name: 'PODONKI PODGON',
    product_image: '/uploads/mango.jpg',
    quantity: 2,
  }],
}

const AdminModalStub = defineComponent({
  props: ['isOpen', 'title'],
  emits: ['close', 'cancel'],
  setup(_props, { expose }) {
    const scrollContainer = ref<HTMLElement | null>(null)
    expose({ scrollContainer })
    return { scrollContainer }
  },
  template: '<section v-if="isOpen" data-test="admin-modal" :data-modal-title="title"><div ref="scrollContainer" data-test="modal-scroll"><slot /><slot name="footer" /></div><button data-test="modal-close" @click="$emit(\'close\')">x</button></section>',
})

describe('AdminStockTransferModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useCrmStore().$patch({ staffTrackingEnabled: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function mountModal() {
    return mount(AdminStockTransferModal, {
      props: { isOpen: false, initialSource: 'warehouse' },
      global: {
        stubs: {
          AdminModal: AdminModalStub,
          StaffActorPrompt: {
            props: ['open', 'context'],
            emits: ['confirm', 'close'],
            template: '<div v-if="open"><p data-test="actor-context">{{ context }}</p><button data-test="actor-confirm" @click="$emit(\'confirm\', { employeeId: \'employee_1\', pin: \'1234\' })">Подтвердить сотрудника</button></div>',
          },
        },
      },
    })
  }

  it('changes quantity in search results and saves a draft without completing it', async () => {
    const store = useAdminStore()
    vi.spyOn(store, 'fetchInventoryTransfers').mockResolvedValue({
      transfers: [],
      pagination: { page: 1, totalPages: 1 },
    })
    vi.spyOn(store, 'fetchInventoryGroups').mockResolvedValue([] as never)
    vi.spyOn(store, 'fetchInventoryItems').mockResolvedValue([{
      id: 'product_1',
      title: 'Манго',
      category_name: 'Жидкости',
      group_name: 'PODONKI PODGON',
      image: null,
      available_stock: 5,
    }] as any)
    const createTransfer = vi.spyOn(store, 'createInventoryTransfer').mockResolvedValue(draftTransfer as any)
    vi.spyOn(store, 'fetchInventoryTransfer').mockResolvedValue(draftTransfer as any)

    const wrapper = mountModal()
    await wrapper.setProps({ isOpen: true })
    await flushPromises()
    await wrapper.get('button').trigger('click')
    await flushPromises()

    const increaseButton = wrapper.get('button[aria-label="Увеличить количество"]')
    expect(wrapper.text()).toContain('0 шт')
    await increaseButton.trigger('click')
    await increaseButton.trigger('click')
    expect(wrapper.text()).toContain('2 шт')
    expect(wrapper.text()).toContain('PODONKI PODGON')
    expect(wrapper.text()).toContain('Жидкости')
    expect(wrapper.get('[data-test="transfer-search-image-placeholder"]').exists()).toBe(true)
    expect(wrapper.get('[data-test="transfer-selected-image-placeholder"]').exists()).toBe(true)
    expect(wrapper.get('table').classes()).toContain('table-fixed')

    const saveButton = wrapper.findAll('button').find((button) => button.text().includes('Создать заявку'))
    await saveButton!.trigger('click')
    expect(wrapper.get('[data-test="actor-context"]').text()).toContain('Склад → Розница')
    expect(wrapper.get('[data-test="actor-context"]').text()).toContain('1 позиция · 2 шт')
    await wrapper.get('[data-test="actor-confirm"]').trigger('click')
    await flushPromises()

    expect(createTransfer).toHaveBeenCalledWith(expect.objectContaining({
      source_location: 'warehouse',
      destination_location: 'retail',
      items: [{ product_id: 'product_1', variant_id: null, quantity: 2 }],
      actor_employee_id: 'employee_1',
      actor_pin: '1234',
    }))
    expect(wrapper.emitted('saved')).toEqual([[{ number: 1 }]])
    expect(wrapper.emitted('completed')).toBeUndefined()
  })

  it('completes a saved draft only after confirmation', async () => {
    const store = useAdminStore()
    const pendingRefresh = new Promise(() => {})
    vi.spyOn(store, 'fetchInventoryTransfers')
      .mockResolvedValueOnce({
        transfers: [draftTransfer],
        pagination: { page: 1, totalPages: 1 },
      } as any)
      .mockReturnValueOnce(pendingRefresh as any)
    vi.spyOn(store, 'fetchInventoryTransfer').mockResolvedValue(draftTransfer as any)
    const completed = { ...draftTransfer, status: 'completed' as const, completed_at: '2026-07-20 12:30:00' }
    const completeTransfer = vi.spyOn(store, 'completeInventoryTransfer').mockResolvedValue(completed as any)
    vi.stubGlobal('confirm', vi.fn(() => true))

    const wrapper = mountModal()
    await wrapper.setProps({ isOpen: true })
    await flushPromises()
    expect(wrapper.text()).toContain('15:00')
    expect(wrapper.text()).toContain('1 позиция · 2 шт')
    expect(wrapper.text()).not.toContain('Открыть')
    const openButton = wrapper.findAll('button').find((button) => button.text().includes('Перемещение №1'))
    await openButton!.trigger('click')
    await flushPromises()
    const completeButton = wrapper.findAll('button').find((button) => button.text() === 'Оприходовать 2 шт')
    await completeButton!.trigger('click')
    expect(wrapper.get('[data-test="actor-context"]').text()).toContain('Перемещение №1')
    expect(wrapper.get('[data-test="actor-context"]').text()).toContain('Склад → Розница')
    await wrapper.get('[data-test="actor-confirm"]').trigger('click')
    await flushPromises()

    expect(completeTransfer).toHaveBeenCalledWith('move_1', expect.objectContaining({
      actor_employee_id: 'employee_1',
      actor_pin: '1234',
      idempotency_key: expect.any(String),
    }))
    expect(wrapper.emitted('completed')).toEqual([[{ quantity: 2, destination: 'retail' }]])
    expect(wrapper.text()).toContain('Оприходовано')
    expect(wrapper.text()).toContain('Манго, Холодный манго')
    expect(wrapper.text()).toContain('PODONKI PODGON')
    expect(wrapper.text()).toContain('Жидкости')
    expect(wrapper.get('img[alt="Манго"]').attributes('src')).toBe('/uploads/mango.jpg')
    await wrapper.get('[data-test="modal-close"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('ignores an old next-page response after reopening the modal', async () => {
    const store = useAdminStore()
    let resolveOldPage!: (value: any) => void
    const oldPage = new Promise((resolve) => { resolveOldPage = resolve })
    const freshTransfer = { ...draftTransfer, id: 'move_2', transfer_number: 2, status: 'completed' as const }
    vi.spyOn(store, 'fetchInventoryTransfers')
      .mockResolvedValueOnce({ transfers: [draftTransfer], pagination: { page: 1, totalPages: 2 } } as any)
      .mockReturnValueOnce(oldPage as any)
      .mockResolvedValueOnce({ transfers: [freshTransfer], pagination: { page: 1, totalPages: 1 } } as any)

    const wrapper = mountModal()
    await wrapper.setProps({ isOpen: true })
    await flushPromises()
    const moreButton = wrapper.findAll('button').find((button) => button.text() === 'Показать ещё')
    await moreButton!.trigger('click')

    await wrapper.setProps({ isOpen: false })
    await wrapper.setProps({ isOpen: true })
    await flushPromises()
    resolveOldPage({
      transfers: [{ ...draftTransfer, id: 'stale', transfer_number: 999 }],
      pagination: { page: 2, totalPages: 2 },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Перемещение №2')
    expect(wrapper.text()).not.toContain('Перемещение №999')
  })

  it('uses the same completion key after a lost response', async () => {
    const store = useAdminStore()
    vi.spyOn(store, 'fetchInventoryTransfers').mockResolvedValue({
      transfers: [draftTransfer],
      pagination: { page: 1, totalPages: 1 },
    } as any)
    vi.spyOn(store, 'fetchInventoryTransfer').mockResolvedValue(draftTransfer as any)
    const completeTransfer = vi.spyOn(store, 'completeInventoryTransfer')
      .mockRejectedValueOnce(Object.assign(new Error('network'), { outcomeUnknown: true }))
      .mockResolvedValueOnce({ ...draftTransfer, status: 'completed' } as any)

    const wrapper = mountModal()
    await wrapper.setProps({ isOpen: true })
    await flushPromises()
    const openButton = wrapper.findAll('button').find((button) => button.text().includes('Перемещение №1'))
    await openButton!.trigger('click')
    await flushPromises()
    await wrapper.findAll('button').find((button) => button.text() === 'Оприходовать 2 шт')!.trigger('click')
    await wrapper.get('[data-test="actor-confirm"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-test="actor-confirm"]').trigger('click')
    await flushPromises()

    const firstKey = completeTransfer.mock.calls[0][1].idempotency_key
    const secondKey = completeTransfer.mock.calls[1][1].idempotency_key
    expect(firstKey).toBeTruthy()
    expect(secondKey).toBe(firstKey)
  })

  it('asks for the employee PIN before cancelling a draft', async () => {
    const store = useAdminStore()
    vi.spyOn(store, 'fetchInventoryTransfers').mockResolvedValue({
      transfers: [draftTransfer],
      pagination: { page: 1, totalPages: 1 },
    } as any)
    vi.spyOn(store, 'fetchInventoryTransfer').mockResolvedValue(draftTransfer as any)
    const cancelTransfer = vi.spyOn(store, 'cancelInventoryTransfer').mockResolvedValue({
      ...draftTransfer,
      status: 'cancelled',
      cancelled_by_employee_id: 'employee_1',
    } as any)

    const wrapper = mountModal()
    await wrapper.setProps({ isOpen: true })
    await flushPromises()
    await wrapper.findAll('button').find((button) => button.text().includes('Перемещение №1'))!.trigger('click')
    await flushPromises()
    await wrapper.findAll('button').find((button) => button.text() === 'Отменить заявку')!.trigger('click')

    expect(wrapper.get('[data-test="actor-context"]').text()).toContain('Перемещение №1')
    await wrapper.get('[data-test="actor-confirm"]').trigger('click')
    await flushPromises()

    expect(cancelTransfer).toHaveBeenCalledWith('move_1', {
      actor_employee_id: 'employee_1',
      actor_pin: '1234',
    })
    expect(wrapper.emitted('cancelled')).toEqual([[{ number: 1 }]])
  })

  it('hides the transfer details while the legacy cancel confirmation is open', async () => {
    useCrmStore().$patch({ staffTrackingEnabled: false })
    const store = useAdminStore()
    vi.spyOn(store, 'fetchInventoryTransfers').mockResolvedValue({
      transfers: [draftTransfer],
      pagination: { page: 1, totalPages: 1 },
    } as any)
    vi.spyOn(store, 'fetchInventoryTransfer').mockResolvedValue(draftTransfer as any)
    const cancelTransfer = vi.spyOn(store, 'cancelInventoryTransfer')

    const wrapper = mountModal()
    await wrapper.setProps({ isOpen: true })
    await flushPromises()
    await wrapper.findAll('button').find((button) => button.text().includes('Перемещение №1'))!.trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-test="admin-modal"]').attributes('data-modal-title')).toBe('Перемещение №1')
    expect(wrapper.text()).toContain('Манго, Холодный манго')
    const detailsScroll = wrapper.get('[data-test="modal-scroll"]').element as HTMLElement
    detailsScroll.scrollTop = 91

    await wrapper.findAll('button').find((button) => button.text() === 'Отменить заявку')!.trigger('click')
    await flushPromises()

    const confirmation = wrapper.get('[data-test="admin-modal"]')
    expect(wrapper.findAll('[data-test="admin-modal"]')).toHaveLength(1)
    expect(confirmation.attributes('data-modal-title')).toBe('Отменить перемещение?')
    expect(wrapper.text()).not.toContain('Манго, Холодный манго')
    expect(cancelTransfer).not.toHaveBeenCalled()

    await confirmation.get('[data-test="modal-close"]').trigger('click')
    await flushPromises()

    const restoredDetails = wrapper.get('[data-test="admin-modal"]')
    expect(restoredDetails.attributes('data-modal-title')).toBe('Перемещение №1')
    expect(wrapper.text()).toContain('Манго, Холодный манго')
    expect((restoredDetails.get('[data-test="modal-scroll"]').element as HTMLElement).scrollTop).toBe(91)
  })

  it('keeps the legacy flow without employee prompt when tracking is off', async () => {
    useCrmStore().$patch({ staffTrackingEnabled: false })
    const store = useAdminStore()
    vi.spyOn(store, 'fetchInventoryTransfers').mockResolvedValue({
      transfers: [],
      pagination: { page: 1, totalPages: 1 },
    })
    vi.spyOn(store, 'fetchInventoryGroups').mockResolvedValue([] as never)
    vi.spyOn(store, 'fetchInventoryItems').mockResolvedValue([{
      id: 'product_1',
      title: 'Манго',
      available_stock: 5,
    }] as any)
    const createTransfer = vi.spyOn(store, 'createInventoryTransfer').mockResolvedValue(draftTransfer as any)
    const completeTransfer = vi.spyOn(store, 'completeInventoryTransfer').mockResolvedValue({
      ...draftTransfer,
      status: 'completed',
    } as any)

    const wrapper = mountModal()
    await wrapper.setProps({ isOpen: true })
    await flushPromises()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    await wrapper.get('button[aria-label="Увеличить количество"]').trigger('click')
    await wrapper.findAll('button').find((button) => button.text().includes('Создать заявку'))!.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="actor-confirm"]').exists()).toBe(false)
    expect(createTransfer).toHaveBeenCalledWith(expect.not.objectContaining({
      actor_employee_id: expect.anything(),
      actor_pin: expect.anything(),
    }))
    await wrapper.findAll('button').find((button) => button.text() === 'Оприходовать 2 шт')!.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="actor-confirm"]').exists()).toBe(false)
    expect(completeTransfer).toHaveBeenCalledWith(
      draftTransfer.id,
      expect.not.objectContaining({
        actor_employee_id: expect.anything(),
        actor_pin: expect.anything(),
      }),
    )
  })

  it('показывает остаток и в рознице, и на складе, выделяя точку отправления', async () => {
    const store = useAdminStore()
    vi.spyOn(store, 'fetchInventoryTransfers').mockResolvedValue({
      transfers: [],
      pagination: { page: 1, totalPages: 1 },
    })
    vi.spyOn(store, 'fetchInventoryGroups').mockResolvedValue([] as never)
    vi.spyOn(store, 'fetchInventoryItems').mockResolvedValue([{
      id: 'product_1',
      title: 'Aegis Nano 0.6',
      category_name: 'Расходники',
      group_name: 'Картриджи для AEGIS NANO',
      image: null,
      retail_stock: 2,
      warehouse_stock: 7,
      available_stock: 7,
    }] as any)

    const wrapper = mountModal()
    await wrapper.setProps({ isOpen: true })
    await flushPromises()
    await wrapper.get('button').trigger('click')
    await flushPromises()

    const row = wrapper.findAll('li').find((node) => node.text().includes('Aegis Nano 0.6'))!
    expect(row.text()).toContain('Розница: 2')
    expect(row.text()).toContain('Склад: 7')

    // Отправляем со склада, значит выделен склад, а не розница.
    const warehouse = row.findAll('span').find((node) => node.text().startsWith('Склад:'))!
    const retail = row.findAll('span').find((node) => node.text().startsWith('Розница:'))!
    expect(warehouse.classes()).toContain('font-semibold')
    expect(retail.classes()).not.toContain('font-semibold')
  })
})
