import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import CustomerSettingsModal from '@/components/admin/crm/CustomerSettingsModal.vue'

const crm = vi.hoisted(() => ({
  fetchCustomerWholesaleSettings: vi.fn(),
  saveCustomerWholesaleMinOverride: vi.fn(),
}))
vi.mock('@/stores/crm', () => ({ useCrmStore: () => crm }))

const ModalStub = defineComponent({
  name: 'AdminModal',
  props: { isOpen: Boolean, referenceDesign: Boolean, isLoading: Boolean, showActions: Boolean, title: String, size: String },
  emits: ['close', 'cancel'],
  template: '<section v-if="isOpen"><slot /></section>',
})

let wrapper: VueWrapper | undefined

function settingsPayload(overrides: Record<string, unknown> = {}) {
  return {
    customer: {
      id: 'client-1',
      telegram_id: '7011',
      telegram_username: 'alice',
      first_name: 'Алиса',
      last_name: '',
      wholesale_min_override: null,
    },
    tiers: [
      { id: 'wt_100', code: '25', label: 'Опт от 25 позиций', min_order_quantity: 25, sort_order: 25 },
      { id: 'wt_250', code: '50', label: 'Опт от 50 позиций', min_order_quantity: 50, sort_order: 50 },
      { id: 'wt_500', code: '100', label: 'Опт от 100 позиций', min_order_quantity: 100, sort_order: 100 },
      { id: 'wt_1000', code: '150', label: 'Опт от 150 позиций', min_order_quantity: 150, sort_order: 150 },
    ],
    active_wholesale_order: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  crm.fetchCustomerWholesaleSettings.mockResolvedValue(settingsPayload())
  crm.saveCustomerWholesaleMinOverride.mockResolvedValue(settingsPayload({
    customer: {
      id: 'client-1',
      telegram_id: '7011',
      telegram_username: 'alice',
      first_name: 'Алиса',
      last_name: '',
      wholesale_min_override: 15,
    },
  }))
})

afterEach(() => { wrapper?.unmount(); wrapper = undefined })

async function setup(props: Record<string, unknown> = {}) {
  wrapper = mount(CustomerSettingsModal, {
    props: { isOpen: false, ...props },
    global: { stubs: { AdminModal: ModalStub } },
  })
  await wrapper.setProps({ isOpen: true })
  await flushPromises()
  return wrapper
}

async function findClient(w: VueWrapper, username = '  @alice  ') {
  await w.get('#customer-settings-username').setValue(username)
  await w.get('.crm-customer-settings-search').trigger('submit')
  await flushPromises()
}

describe('CustomerSettingsModal: reference theme and client search', () => {
  it('uses the compact reference theme without built-in actions', async () => {
    const w = await setup()
    expect(w.findComponent(ModalStub).props('referenceDesign')).toBe(true)
    expect(w.findComponent(ModalStub).props('showActions')).toBe(false)
    expect(w.findComponent(ModalStub).props('size')).toBe('md')
    expect(w.get('label[for="customer-settings-username"]').text()).toBe('Telegram username')
  })

  it('finds a client by username and shows tiers with quantity minimums', async () => {
    const w = await setup()
    await findClient(w)
    expect(crm.fetchCustomerWholesaleSettings).toHaveBeenCalledWith('alice')
    expect(w.get('.crm-note-customer').text()).toContain('Алиса')
    expect(w.get('.crm-note-customer').text()).toContain('@alice')
    expect(w.find('[data-test="customer-settings-override-badge"]').exists()).toBe(false)
    const tierTexts = w.findAll('.crm-customer-settings-tier').map((row) => row.text())
    expect(tierTexts).toHaveLength(4)
    expect(tierTexts[0]).toContain('Опт от 25 позиций')
    expect(tierTexts[0]).toContain('25 позиций')
    expect(tierTexts[3]).toContain('150 позиций')
  })

  it('auto-searches the prefilled username from the customer hub', async () => {
    const w = await setup({ prefill: { username: '@alice' } })
    expect(crm.fetchCustomerWholesaleSettings).toHaveBeenCalledWith('alice')
    expect(w.get('.crm-note-customer').text()).toContain('@alice')
    expect(w.find('[data-test="customer-settings-override-badge"]').exists()).toBe(false)
  })

  it('shows the personal minimum badge for a client with an override', async () => {
    crm.fetchCustomerWholesaleSettings.mockResolvedValue(settingsPayload({
      customer: {
        id: 'client-1',
        telegram_id: '7011',
        telegram_username: 'alice',
        first_name: 'Алиса',
        last_name: '',
        wholesale_min_override: 15,
      },
      active_wholesale_order: {
        id: 'order-1',
        order_number: 123,
        wholesale_tier_label: 'Опт от 25 позиций',
        wholesale_min_quantity: 15,
      },
    }))
    const w = await setup()
    await findClient(w)
    expect(w.get('[data-test="customer-settings-override-badge"]').text())
      .toContain('Персональный минимум: 15 позиций')
    expect(w.get('[data-test="customer-settings-active-order"]').text())
      .toContain('№123')
    // Кнопка сброса появляется только при активном override.
    expect(w.get('.crm-customer-settings-reset').exists()).toBe(true)
  })

  it('requires a username before searching', async () => {
    const w = await setup()
    await w.get('#customer-settings-username').setValue('   ')
    await w.get('.crm-customer-settings-search').trigger('submit')
    await flushPromises()
    expect(crm.fetchCustomerWholesaleSettings).not.toHaveBeenCalled()
    expect(w.get('[role="alert"]').text()).toContain('Введите @username')
  })

  it('renders the not-found error without closing the modal', async () => {
    crm.fetchCustomerWholesaleSettings.mockRejectedValueOnce({ code: 'customer_not_found' })
    const w = await setup()
    await findClient(w, '@ghost')
    expect(w.get('[role="alert"]').text()).toContain('Клиент с таким username не найден')
    expect(w.emitted('close')).toBeUndefined()
  })
})

describe('CustomerSettingsModal: saving and resetting the personal minimum', () => {
  it('saves a personal minimum and emits the change', async () => {
    const w = await setup()
    await findClient(w)
    await w.get('#customer-settings-min').setValue('15')
    await w.get('.crm-customer-settings-edit').trigger('submit')
    await flushPromises()
    expect(crm.saveCustomerWholesaleMinOverride).toHaveBeenCalledWith('alice', 15)
    expect(w.emitted('saved')).toEqual([[{ username: 'alice', minQuantity: 15 }]])
    expect(w.get('[data-test="customer-settings-override-badge"]').text())
      .toContain('Персональный минимум: 15 позиций')
    expect(w.emitted('close')).toBeUndefined()
  })

  it('rejects an invalid minimum locally without calling the API', async () => {
    const w = await setup()
    await findClient(w)
    await w.get('#customer-settings-min').setValue('0')
    await w.get('.crm-customer-settings-edit').trigger('submit')
    await flushPromises()
    expect(crm.saveCustomerWholesaleMinOverride).not.toHaveBeenCalled()
    expect(w.get('[role="alert"]').text()).toContain('целое число от 1 до 10000')
  })

  it('shows the server validation error and permits retry', async () => {
    crm.saveCustomerWholesaleMinOverride.mockRejectedValueOnce({ code: 'invalid_min_quantity' })
    const w = await setup()
    await findClient(w)
    await w.get('#customer-settings-min').setValue('15')
    await w.get('.crm-customer-settings-edit').trigger('submit')
    await flushPromises()
    expect(w.get('[role="alert"]').text()).toContain('целое число от 1 до 10000')
    await w.get('.crm-customer-settings-edit').trigger('submit')
    await flushPromises()
    expect(crm.saveCustomerWholesaleMinOverride).toHaveBeenCalledTimes(2)
    expect(w.emitted('saved')).toHaveLength(1)
  })

  it('resets the override to the tier default and clears the input', async () => {
    crm.fetchCustomerWholesaleSettings.mockResolvedValue(settingsPayload({
      customer: {
        id: 'client-1',
        telegram_id: '7011',
        telegram_username: 'alice',
        first_name: 'Алиса',
        last_name: '',
        wholesale_min_override: 15,
      },
    }))
    crm.saveCustomerWholesaleMinOverride.mockResolvedValue(settingsPayload())
    const w = await setup()
    await findClient(w)
    expect((w.get('#customer-settings-min').element as HTMLInputElement).value).toBe('15')
    await w.get('.crm-customer-settings-reset').trigger('click')
    await flushPromises()
    expect(crm.saveCustomerWholesaleMinOverride).toHaveBeenCalledWith('alice', null)
    expect(w.emitted('saved')).toEqual([[{ username: 'alice', minQuantity: null }]])
    expect((w.get('#customer-settings-min').element as HTMLInputElement).value).toBe('')
    expect(w.find('[data-test="customer-settings-override-badge"]').exists()).toBe(false)
  })

  it('closes without saving when Закрыть is pressed', async () => {
    const w = await setup()
    await findClient(w)
    await w.get('.crm-note-secondary').trigger('click')
    expect(w.emitted('close')).toHaveLength(1)
    expect(crm.saveCustomerWholesaleMinOverride).not.toHaveBeenCalled()
  })

  it('resets the form state when reopened', async () => {
    const w = await setup()
    await findClient(w)
    await w.get('#customer-settings-min').setValue('15')
    await w.setProps({ isOpen: false })
    await w.setProps({ isOpen: true })
    await flushPromises()
    expect(w.find('.crm-note-customer').exists()).toBe(false)
    expect(w.find('#customer-settings-min').exists()).toBe(false)
    expect((w.get('#customer-settings-username').element as HTMLInputElement).value).toBe('')
    expect(w.find('[role="alert"]').exists()).toBe(false)
  })
})
