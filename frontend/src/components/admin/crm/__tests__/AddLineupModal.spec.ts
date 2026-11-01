import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import AddLineupModal from '@/components/admin/crm/AddLineupModal.vue'
import type { CrmGroupSummary } from '@/stores/crm'

const searchCrmGroupsMock = vi.hoisted(() => vi.fn())

vi.mock('@/stores/crm', async () => {
  const actual = await vi.importActual('@/stores/crm')
  return {
    ...actual,
    useCrmStore: () => ({
      searchCrmGroups: searchCrmGroupsMock,
    }),
  }
})

function group(overrides: Partial<CrmGroupSummary> = {}): CrmGroupSummary {
  return {
    id: 'g1',
    name: 'PODONKI PODGON',
    slug: 'pp',
    categoryId: 'cat1',
    categoryName: 'Жидкости',
    parentGroupId: null,
    productCount: 30,
    ...overrides,
  }
}

async function mountModal() {
  const wrapper = mount(AddLineupModal, {
    props: { isOpen: true },
    global: {
      stubs: {
        AdminModal: {
          template: '<div class="modal-stub"><slot /></div>',
          props: ['isOpen', 'title', 'description', 'size', 'showActions', 'persistent', 'isLoading'],
        },
      },
    },
  })
  await flushPromises()
  return wrapper
}

describe('AddLineupModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('searches lineups by query after debounce', async () => {
    searchCrmGroupsMock.mockResolvedValue([group()])
    const wrapper = await mountModal()

    const input = wrapper.find('input[type="search"]')
    await input.setValue('podgon')
    // debounce 250мс реальный таймер — ждём
    await new Promise((r) => setTimeout(r, 320))
    await flushPromises()

    expect(searchCrmGroupsMock).toHaveBeenCalledWith({ search: 'podgon', limit: 25 })
    expect(wrapper.text()).toContain('PODONKI PODGON')
    expect(wrapper.text()).toContain('30 товаров')
    wrapper.unmount()
  })

  it('shows hint for one-char query and does not search', async () => {
    const wrapper = await mountModal()
    await wrapper.find('input[type="search"]').setValue('p')
    await new Promise((r) => setTimeout(r, 320))

    expect(searchCrmGroupsMock).not.toHaveBeenCalledWith(expect.objectContaining({ search: 'p' }))
    expect(wrapper.text()).toContain('от двух символов')
    wrapper.unmount()
  })

  it('selecting a group shows quantity/price form and confirm emits payload', async () => {
    searchCrmGroupsMock.mockResolvedValue([group()])
    const wrapper = await mountModal()
    await wrapper.find('input[type="search"]').setValue('podgon')
    await new Promise((r) => setTimeout(r, 320))
    await flushPromises()

    await wrapper.find('button:not([disabled])').trigger('click')
    await flushPromises()

    // Форма количества/цены
    expect(wrapper.text()).toContain('добавится в закупку')
    const numberInputs = wrapper.findAll('input[type="number"]')
    expect(numberInputs.length).toBe(2)

    // Значения по умолчанию: количество 5
    expect((numberInputs[0].element as HTMLInputElement).value).toBe('5')

    // Меняем значения
    await numberInputs[0].setValue('7')
    await numberInputs[1].setValue('5.5')

    // Confirm
    const confirmButton = wrapper.findAll('button').find((b) => b.text().includes('Добавить 30'))
    expect(confirmButton).toBeDefined()
    await confirmButton!.trigger('click')

    const emitted = wrapper.emitted('confirm')
    expect(emitted).toHaveLength(1)
    expect(emitted![0]).toEqual([
      {
        group: group(),
        quantity: 7,
        costPerUnit: 5.5,
      },
    ])
    wrapper.unmount()
  })

  it('blocks confirm with invalid quantity', async () => {
    searchCrmGroupsMock.mockResolvedValue([group()])
    const wrapper = await mountModal()
    await wrapper.find('input[type="search"]').setValue('podgon')
    await new Promise((r) => setTimeout(r, 320))
    await flushPromises()

    await wrapper.find('button:not([disabled])').trigger('click')
    await flushPromises()

    const numberInputs = wrapper.findAll('input[type="number"]')
    await numberInputs[0].setValue('0')

    const confirmButton = wrapper.findAll('button').find((b) => b.text().includes('Добавить 30'))
    expect(confirmButton!.attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('group without products cannot be selected', async () => {
    searchCrmGroupsMock.mockResolvedValue([group({ productCount: 0 })])
    const wrapper = await mountModal()
    await wrapper.find('input[type="search"]').setValue('podgon')
    await new Promise((r) => setTimeout(r, 320))
    await flushPromises()

    const selectButton = wrapper.find('button')
    expect(selectButton.attributes('disabled')).toBeDefined()
    expect(selectButton.text()).toContain('Нет товаров')
    wrapper.unmount()
  })

  it('close is not emitted while confirming', async () => {
    searchCrmGroupsMock.mockResolvedValue([group()])
    const wrapper = await mountModal()
    await wrapper.find('input[type="search"]').setValue('podgon')
    await new Promise((r) => setTimeout(r, 320))
    await flushPromises()

    // Выбор группы
    await wrapper.find('button:not([disabled])').trigger('click')
    await flushPromises()

    // Заполняем цену — иначе confirm заблокирован (цена по умолчанию пустая)
    const numberInputs = wrapper.findAll('input[type="number"]')
    await numberInputs[1].setValue('5.5')

    const confirmButton = wrapper.findAll('button').find((b) => b.text().includes('Добавить 30'))
    await confirmButton!.trigger('click')

    // Confirm эмитился — модалка в состоянии pending
    expect(wrapper.emitted('confirm')).toHaveLength(1)

    // Отмена при pending не эмитит close
    const closeCalls = wrapper.emitted('close')?.length ?? 0
    const cancelButton = wrapper.findAll('button').find((b) => b.text().trim().includes('Отмена'))
    await cancelButton!.trigger('click')
    expect((wrapper.emitted('close')?.length ?? 0) - closeCalls).toBe(0)
    wrapper.unmount()
  })
})
