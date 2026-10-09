/**
 * Правка черновика перемещения и быстрый фильтр по линейкам.
 *
 * Заявку заводят заранее, а товар собирают потом, поэтому забытую позицию
 * дописывают в ту же заявку. Тесты стерегут главное: правка идёт через PUT, не
 * создаёт вторую заявку и не может развернуть направление.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import AdminStockTransferModal from '@/components/admin/AdminStockTransferModal.vue'
import { useAdminStore } from '@/stores/admin'
import { useCrmStore } from '@/stores/crm'

const draftTransfer = {
  id: 'move_7',
  transfer_number: 7,
  source_location: 'warehouse' as const,
  destination_location: 'retail' as const,
  status: 'draft' as const,
  comment: 'Первый вариант',
  created_at: '2026-07-20 12:00:00',
  created_by: 'Павел',
  updated_at: '2026-07-21 09:30:00',
  updated_by: 'Костя',
  total_quantity: 2,
  item_count: 1,
  items: [{
    id: 'item_1',
    product_id: 'product_1',
    variant_id: null,
    product_title: 'Манго',
    category_name: 'Жидкости',
    group_name: 'PODONKI PODGON',
    product_image: null,
    quantity: 2,
    retail_stock: 1,
    warehouse_stock: 5,
  }],
}

const completedTransfer = { ...draftTransfer, status: 'completed' as const }

describe('AdminStockTransferModal: правка черновика', () => {
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
      props: { isOpen: false, initialSource: 'warehouse' as const },
      global: {
        stubs: {
          AdminModal: {
            props: ['isOpen'],
            emits: ['close'],
            template: '<section v-if="isOpen"><slot /><slot name="footer" /></section>',
          },
          StaffActorPrompt: {
            props: ['open', 'context', 'actionLabel'],
            emits: ['confirm', 'close'],
            template: `<div v-if="open">
              <span data-test="actor-context">{{ context }}</span>
              <span data-test="actor-action">{{ actionLabel }}</span>
              <button data-test="actor-confirm" @click="$emit('confirm', { employeeId: 'employee_1', pin: '1234' })">ok</button>
            </div>`,
          },
        },
      },
    })
  }

  /** Открывает карточку черновика, откуда начинается правка. */
  async function openDetails(transfer: unknown) {
    const store = useAdminStore()
    vi.spyOn(store, 'fetchInventoryTransfers').mockResolvedValue({
      transfers: [transfer],
      pagination: { page: 1, totalPages: 1 },
    } as never)
    vi.spyOn(store, 'fetchInventoryTransfer').mockResolvedValue(transfer as never)
    vi.spyOn(store, 'fetchInventoryItems').mockResolvedValue([{
      id: 'product_2',
      title: 'Барбарис',
      category_name: 'Жидкости',
      group_name: 'PODONKI ISTERIKA',
      image: null,
      available_stock: 4,
    }] as never)
    vi.spyOn(store, 'fetchInventoryGroups').mockResolvedValue([
      { id: 'group_1', name: 'PODONKI PODGON', categoryId: 'cat_1' },
      { id: 'group_2', name: 'PODONKI ISTERIKA', categoryId: 'cat_1' },
    ] as never)

    const wrapper = mountModal()
    await wrapper.setProps({ isOpen: true })
    await flushPromises()
    const openButton = wrapper.findAll('button').find((button) => button.text().includes('Перемещение №7'))
    await openButton!.trigger('click')
    await flushPromises()
    return { wrapper, store }
  }

  it('показывает кнопку правки только у черновика', async () => {
    const { wrapper } = await openDetails(draftTransfer)
    expect(wrapper.findAll('button').some((b) => b.text() === 'Изменить заявку')).toBe(true)
    expect(wrapper.text()).toContain('Изменил: Костя')
  })

  it('не предлагает править оприходованную заявку', async () => {
    const { wrapper } = await openDetails(completedTransfer)
    expect(wrapper.findAll('button').some((b) => b.text() === 'Изменить заявку')).toBe(false)
  })

  it('переносит состав и комментарий в форму, направление менять не даёт', async () => {
    const { wrapper } = await openDetails(draftTransfer)
    await wrapper.findAll('button').find((b) => b.text() === 'Изменить заявку')!.trigger('click')
    await flushPromises()

    expect(wrapper.find('textarea').element.value).toBe('Первый вариант')
    expect(wrapper.text()).toContain('Манго')
    expect(wrapper.text()).toContain('Направление задано при создании')
    expect(wrapper.findAll('button').some((b) => b.text() === 'Поменять')).toBe(false)
    expect(wrapper.findAll('button').some((b) => b.text() === 'Сохранить изменения')).toBe(true)
    // Остаток берётся по точке отправления, тут это склад.
    expect(wrapper.find('input[type="number"]').attributes('max')).toBe('5')
  })

  it('сохраняет правку через обновление, а не созданием второй заявки', async () => {
    const { wrapper, store } = await openDetails(draftTransfer)
    const updateTransfer = vi
      .spyOn(store, 'updateInventoryTransfer')
      .mockResolvedValue({ ...draftTransfer, comment: 'Дописали' } as never)
    const createTransfer = vi.spyOn(store, 'createInventoryTransfer')

    await wrapper.findAll('button').find((b) => b.text() === 'Изменить заявку')!.trigger('click')
    await flushPromises()
    await wrapper.get('button[aria-label="Увеличить количество"]').trigger('click')
    await wrapper.findAll('button').find((b) => b.text() === 'Сохранить изменения')!.trigger('click')

    expect(wrapper.get('[data-test="actor-action"]').text()).toBe('Сохранить изменения')
    expect(wrapper.get('[data-test="actor-context"]').text()).toContain('Перемещение №7')
    await wrapper.get('[data-test="actor-confirm"]').trigger('click')
    await flushPromises()

    expect(createTransfer).not.toHaveBeenCalled()
    expect(updateTransfer).toHaveBeenCalledTimes(1)
    const [id, payload] = updateTransfer.mock.calls[0]
    expect(id).toBe('move_7')
    expect(payload).toMatchObject({
      comment: 'Первый вариант',
      actor_employee_id: 'employee_1',
      actor_pin: '1234',
    })
    expect(payload.items).toEqual([
      { product_id: 'product_1', variant_id: null, quantity: 2 },
      { product_id: 'product_2', variant_id: null, quantity: 1 },
    ])
    // Направление в запрос не попадает: его определяет сама заявка.
    expect(payload).not.toHaveProperty('source_location')
    expect(payload).not.toHaveProperty('destination_location')
  })

  it('предупреждает, если остаток упал ниже заявленного количества', async () => {
    const shortStock = {
      ...draftTransfer,
      items: [{ ...draftTransfer.items[0], quantity: 9, warehouse_stock: 3 }],
    }
    const { wrapper } = await openDetails(shortStock)
    await wrapper.findAll('button').find((b) => b.text() === 'Изменить заявку')!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('остаток стал меньше')
    expect((wrapper.find('input[type="number"]').element as HTMLInputElement).value).toBe('3')
  })

  it('не даёт сохранить заявку с позицией, которой уже нет в точке', async () => {
    const goneItem = {
      ...draftTransfer,
      items: [{ ...draftTransfer.items[0], quantity: 2, warehouse_stock: 0 }],
    }
    const { wrapper } = await openDetails(goneItem)
    await wrapper.findAll('button').find((b) => b.text() === 'Изменить заявку')!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('остатка на складе больше нет')
    const saveButton = wrapper.findAll('button').find((b) => b.text() === 'Сохранить изменения')
    expect(saveButton!.attributes('disabled')).toBeDefined()
  })

  it('не показывает ленту линеек при отправке из розницы, там их сотни', async () => {
    const fromRetail = {
      ...draftTransfer,
      source_location: 'retail' as const,
      destination_location: 'warehouse' as const,
    }
    const { wrapper } = await openDetails(fromRetail)
    await wrapper.findAll('button').find((b) => b.text() === 'Изменить заявку')!.trigger('click')
    await flushPromises()

    expect(wrapper.findAll('[data-test="transfer-group-chip"]')).toHaveLength(0)
  })

  it('убирает предупреждение, когда лишнюю позицию удалили', async () => {
    const goneItem = {
      ...draftTransfer,
      items: [{ ...draftTransfer.items[0], quantity: 2, warehouse_stock: 0 }],
    }
    const { wrapper } = await openDetails(goneItem)
    await wrapper.findAll('button').find((b) => b.text() === 'Изменить заявку')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('остатка на складе больше нет')

    // Добавляем годную позицию и убираем ту, которой нет.
    await wrapper.get('button[aria-label="Увеличить количество"]').trigger('click')
    await wrapper.findAll('button').find((b) => b.text() === 'Удалить')!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).not.toContain('остатка на складе больше нет')
    const saveButton = wrapper.findAll('button').find((b) => b.text() === 'Сохранить изменения')
    expect(saveButton!.attributes('disabled')).toBeUndefined()
  })

  it('отказ от правки возвращает в карточку заявки, а не в список', async () => {
    const { wrapper, store } = await openDetails(draftTransfer)
    const openCard = store.fetchInventoryTransfer as unknown as ReturnType<typeof vi.fn>
    await wrapper.findAll('button').find((b) => b.text() === 'Изменить заявку')!.trigger('click')
    await flushPromises()

    openCard.mockClear()
    await wrapper.findAll('button').find((b) => b.text() === 'Не сохранять')!.trigger('click')
    await flushPromises()

    // Ничего не меняли, значит подтверждения быть не должно, и мы снова в карточке.
    expect(openCard).toHaveBeenCalledWith('move_7')
    expect(wrapper.text()).toContain('Изменил: Костя')
  })

  it('не переспрашивает при отказе от правки, но спрашивает при новой заявке', async () => {
    const confirmSpy = vi.fn(() => true)
    vi.stubGlobal('confirm', confirmSpy)
    const { wrapper } = await openDetails(draftTransfer)

    await wrapper.findAll('button').find((b) => b.text() === 'Изменить заявку')!.trigger('click')
    await flushPromises()
    await wrapper.get('button[aria-label="Увеличить количество"]').trigger('click')
    await wrapper.findAll('button').find((b) => b.text() === 'Не сохранять')!.trigger('click')
    await flushPromises()
    expect(confirmSpy).not.toHaveBeenCalled()

    // Новая заявка: состав набирали руками, тут подтверждение нужно.
    // После отказа от правки мы в карточке заявки, в список идём кнопкой.
    await wrapper.findAll('button').find((b) => b.text() === 'Все перемещения')!.trigger('click')
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text().includes('Новая заявка'))!.trigger('click')
    await flushPromises()
    await wrapper.get('button[aria-label="Увеличить количество"]').trigger('click')
    await wrapper.findAll('button').find((b) => b.text() === 'Отмена')!.trigger('click')
    expect(confirmSpy).toHaveBeenCalledTimes(1)
  })

  it('передаёт время последней правки, чтобы не затереть чужие изменения', async () => {
    const { wrapper, store } = await openDetails(draftTransfer)
    const updateTransfer = vi
      .spyOn(store, 'updateInventoryTransfer')
      .mockResolvedValue(draftTransfer as never)

    await wrapper.findAll('button').find((b) => b.text() === 'Изменить заявку')!.trigger('click')
    await flushPromises()
    await wrapper.get('button[aria-label="Увеличить количество"]').trigger('click')
    await wrapper.findAll('button').find((b) => b.text() === 'Сохранить изменения')!.trigger('click')
    await wrapper.get('[data-test="actor-confirm"]').trigger('click')
    await flushPromises()

    expect(updateTransfer.mock.calls[0][1]).toMatchObject({
      expected_updated_at: '2026-07-21 09:30:00',
    })
  })

  it('поднимает количество, когда товар довезли, пока форма открыта', async () => {
    const goneItem = {
      ...draftTransfer,
      items: [{ ...draftTransfer.items[0], quantity: 2, warehouse_stock: 0 }],
    }
    const store = useAdminStore()
    const { wrapper } = await openDetails(goneItem)
    // Поиск отдаёт ту же позицию, но остаток уже восстановился.
    ;(store.fetchInventoryItems as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([{
      id: 'product_1',
      title: 'Манго',
      category_name: 'Жидкости',
      group_name: 'PODONKI PODGON',
      image: null,
      available_stock: 5,
    }] as never)

    await wrapper.findAll('button').find((b) => b.text() === 'Изменить заявку')!.trigger('click')
    await flushPromises()
    await wrapper.get('button[aria-label="Увеличить количество"]').trigger('click')
    await flushPromises()

    expect((wrapper.find('input[type="number"]').element as HTMLInputElement).value).toBe('1')
    expect(wrapper.text()).not.toContain('остатка на складе больше нет')
    const saveButton = wrapper.findAll('button').find((b) => b.text() === 'Сохранить изменения')
    expect(saveButton!.attributes('disabled')).toBeUndefined()
  })

  it('возвращает в список, если карточку не удалось открыть', async () => {
    const { wrapper, store } = await openDetails(draftTransfer)
    await wrapper.findAll('button').find((b) => b.text() === 'Изменить заявку')!.trigger('click')
    await flushPromises()
    ;(store.fetchInventoryTransfer as unknown as ReturnType<typeof vi.fn>)
      .mockRejectedValue(new Error('сеть недоступна'))

    await wrapper.findAll('button').find((b) => b.text() === 'Не сохранять')!.trigger('click')
    await flushPromises()

    // Ошибка отрисована в списке, поэтому пустой формы создания быть не должно.
    expect(wrapper.text()).toContain('Не удалось открыть перемещение')
    expect(wrapper.findAll('button').some((b) => b.text() === 'Сохранить изменения')).toBe(false)
  })

  it('держит подсказку, пока в заявке меньше, чем просили изначально', async () => {
    const reducedItem = {
      ...draftTransfer,
      items: [{ ...draftTransfer.items[0], quantity: 9, warehouse_stock: 5 }],
    }
    const { wrapper } = await openDetails(reducedItem)
    await wrapper.findAll('button').find((b) => b.text() === 'Изменить заявку')!.trigger('click')
    await flushPromises()
    // Просили 9, на складе 5: количество подрезали и сказали об этом.
    expect(wrapper.text()).toContain('остаток стал меньше')
    expect((wrapper.find('input[type="number"]').element as HTMLInputElement).value).toBe('5')

    // Человек сам убавил ещё: заявка всё ещё меньше исходной, подсказка к месту.
    const input = wrapper.find('input[type="number"]')
    await input.setValue('3')
    await input.trigger('change')
    await flushPromises()
    expect(wrapper.text()).toContain('остаток стал меньше')

    // Позицию удалили: говорить больше не о чем.
    await wrapper.findAll('button').find((b) => b.text() === 'Удалить')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('остаток стал меньше')
  })

  it('оставляет список товаров растягиваемым по высоте', async () => {
    const { wrapper } = await openDetails(draftTransfer)
    await wrapper.findAll('button').find((b) => b.text() === 'Изменить заявку')!.trigger('click')
    await flushPromises()

    const list = wrapper.get('[data-test="transfer-search-list"]')
    expect(list.classes()).toContain('resize-y')
    expect(list.classes()).toContain('overscroll-contain')
  })

  it('фильтрует список товаров по линейке и снимает фильтр повторным кликом', async () => {
    const { wrapper, store } = await openDetails(draftTransfer)
    await wrapper.findAll('button').find((b) => b.text() === 'Изменить заявку')!.trigger('click')
    await flushPromises()

    const chips = wrapper.findAll('[data-test="transfer-group-chip"]')
    // Первый чип сбрасывает фильтр, дальше сами линейки.
    expect(chips).toHaveLength(3)
    expect(chips[0].text()).toBe('Все линейки')

    const loadItems = store.fetchInventoryItems as unknown as ReturnType<typeof vi.fn>
    loadItems.mockClear()
    await chips[2].trigger('click')
    await flushPromises()
    expect(loadItems).toHaveBeenCalledWith(expect.objectContaining({ groupId: 'group_2' }))

    loadItems.mockClear()
    await chips[0].trigger('click')
    await flushPromises()
    expect(loadItems).toHaveBeenCalledWith(expect.objectContaining({ groupId: undefined }))

    // Повторный клик по уже сброшенному фильтру лишний запрос не шлёт.
    loadItems.mockClear()
    await chips[0].trigger('click')
    await flushPromises()
    expect(loadItems).not.toHaveBeenCalled()
  })
})
