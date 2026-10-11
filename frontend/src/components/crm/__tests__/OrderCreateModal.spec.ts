import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent } from 'vue'
import OrderCreateModal from '@/components/crm/OrderCreateModal.vue'
import { useCrmStore, type CrmProductSummary, type Customer, type Order } from '@/stores/crm'

const ModalStub = defineComponent({
  name: 'AdminModal',
  props: {
    isOpen: Boolean,
    title: String,
    referenceDesign: { type: Boolean, default: false },
  },
  emits: ['close', 'cancel'],
  template: '<section v-if="isOpen"><h2>{{ title }}</h2><slot /></section>',
})
const product = (id = 'variant-1'): CrmProductSummary => ({
  id, productId: 'base-product', isVariant: true, title: `Товар ${id}`,
  priceRub: 20, costPrice: 5, stock: 10, minStock: 2, groupName: 'Линейка',
} as CrmProductSummary)
const createdOrder = { id: 'created-order', order_number: 101 } as Order
let wrapper: VueWrapper | undefined

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})
async function setup() {
  const store = useCrmStore()
  store.customers = [{ id: 'customer-1', telegram_username: 'client' } as Customer]
  const search = vi.spyOn(store, 'searchCrmProducts').mockResolvedValue([product()])
  const create = vi.spyOn(store, 'createOrder').mockResolvedValue(createdOrder)
  wrapper = mount(OrderCreateModal, {
    props: { isOpen: true },
    global: { stubs: { AdminModal: ModalStub, StaffCurrentActorBadge: true } },
  })
  await flushPromises()
  return { store, search, create, wrapper }
}
async function add(item = product()) {
  vi.mocked(useCrmStore().searchCrmProducts).mockResolvedValue([item])
  await wrapper!.get('#product-search').setValue(item.title)
  await vi.advanceTimersByTimeAsync(250)
  await flushPromises()
  await wrapper!.get('.order-create-add').trigger('click')
}

describe('OrderCreateModal: reference design preserves order creation', () => {
  it('opts into the new theme and keeps the empty form disabled', async () => {
    const { wrapper, create } = await setup()
    expect(wrapper.findComponent(ModalStub).props()).toMatchObject({ title: 'Создать заказ', referenceDesign: true })
    expect(wrapper.get('.order-create-empty').exists()).toBe(true)
    expect(wrapper.get('.order-create-submit').attributes('disabled')).toBeDefined()
    await wrapper.get('.order-create-submit').trigger('click')
    expect(create).not.toHaveBeenCalled()
  })

  it('preserves variants, quantities, discounts, customer, delivery and the success event', async () => {
    const { wrapper, create } = await setup()
    await add()
    await add()
    expect(wrapper.findAll('.order-create-item')).toHaveLength(1)
    expect((wrapper.get('.order-create-item input[type="number"]').element as HTMLInputElement).value).toBe('2')
    await wrapper.get('#order-customer-username').setValue('  @CLIENT  ')
    await wrapper.get('input[value="delivery"]').setValue(true)
    expect(wrapper.get('.order-create-submit').attributes('disabled')).toBeDefined()
    await wrapper.get('.order-create-main textarea').setValue('  Минск, дом 1  ')
    await wrapper.get('.order-create-aside textarea').setValue('  Комментарий  ')
    await wrapper.findAll('.order-create-item input[type="number"]')[2].setValue(1)
    const discounts = wrapper.findAll('.order-create-totals input')
    await discounts[0].setValue(2)
    await discounts[1].setValue(10)
    expect(wrapper.get('.order-create-total dd').text().replace(/\s/g, '')).toBe('33,3BYN')
    await wrapper.get('.order-create-submit').trigger('click')
    await flushPromises()
    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith({
      idempotency_key: expect.any(String), customer_username: 'client', delivery_type: 'delivery',
      delivery_address: 'Минск, дом 1', notes: 'Комментарий', discount_amount: 2, discount_percent: 10,
      items: [{ product_id: 'base-product', variant_id: 'variant-1', quantity: 2, price_per_unit: 20, discount_amount: 1 }],
    })
    expect(wrapper.text()).toContain('Заказ #101 успешно создан')
    expect(wrapper.get('.order-create-submit').attributes('disabled')).toBeDefined()
    await vi.advanceTimersByTimeAsync(3000)
    expect(wrapper.emitted('created')).toEqual([[createdOrder]])
    expect(wrapper.findAll('.order-create-item')).toHaveLength(0)
  })

  it.each(['', '   '])('creates an order without a customer for an empty username (%j)', async username => {
    const { wrapper, create } = await setup()
    await add()
    await wrapper.get('#order-customer-username').setValue(username)
    await wrapper.get('.order-create-submit').trigger('click')
    await flushPromises()
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][0].customer_username).toBeUndefined()
    expect(create.mock.calls[0][0].customer_id).toBeUndefined()
    await vi.advanceTimersByTimeAsync(3000)
    expect(wrapper.emitted('created')).toEqual([[createdOrder]])
  })

  it.each(['@', '@@client', 'bad-name', 'x'.repeat(33)])('rejects an invalid username before submission (%j)', async username => {
    const { wrapper, create } = await setup()
    await add()
    await wrapper.get('#order-customer-username').setValue(username)
    expect(wrapper.get('#order-customer-username').attributes('aria-invalid')).toBe('true')
    expect(wrapper.get('.order-create-submit').attributes('disabled')).toBeDefined()
    await wrapper.get('.order-create-submit').trigger('click')
    expect(create).not.toHaveBeenCalled()
    expect(wrapper.findAll('.order-create-item')).toHaveLength(1)
    await wrapper.get('#order-customer-username').setValue('client')
    expect(wrapper.get('.order-create-submit').attributes('disabled')).toBeUndefined()
  })

  it.each([
    ['customer_username_not_found', 'Клиент с таким username не найден в CRM.'],
    ['customer_username_ambiguous', 'В CRM несколько клиентов с таким username.'],
    ['customer_username_mismatch', 'Username не соответствует указанному клиенту.'],
  ])('preserves the form after customer resolution fails (%s)', async (code, message) => {
    const { wrapper, create } = await setup()
    await add()
    await wrapper.get('#order-customer-username').setValue('@client')
    create.mockRejectedValueOnce(new Error(code))
    await wrapper.get('.order-create-submit').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain(message)
    expect(wrapper.emitted('created')).toBeUndefined()
    expect(wrapper.findAll('.order-create-item')).toHaveLength(1)
    expect((wrapper.get('#order-customer-username').element as HTMLInputElement).value).toBe('@client')
    expect(create).toHaveBeenCalledTimes(1)
    await wrapper.get('#order-customer-username').setValue('')
    await wrapper.get('.order-create-submit').trigger('click')
    await flushPromises()
    expect(create).toHaveBeenCalledTimes(2)
    expect(create.mock.calls[1][0].customer_username).toBeUndefined()
    await vi.advanceTimersByTimeAsync(3000)
    expect(wrapper.emitted('created')).toEqual([[createdOrder]])
  })

  it('expands long orders and removes only the selected variant', async () => {
    const { wrapper } = await setup()
    for (let i = 1; i <= 6; i++) await add(product(`variant-${i}`))
    expect(wrapper.findAll('.order-create-item')).toHaveLength(5)
    const expand = wrapper.findAll('button').find(button => button.text().includes('Еще 1 позиция'))!
    await expand.trigger('click')
    expect(wrapper.findAll('.order-create-item')).toHaveLength(6)
    await wrapper.get('.order-create-item button').trigger('click')
    expect(wrapper.findAll('.order-create-item')).toHaveLength(5)
    expect(wrapper.text()).not.toContain('Товар variant-1')
    expect(wrapper.text()).toContain('Товар variant-2')
  })

  it('prevents duplicate submission and cancellation during a pending request', async () => {
    const { wrapper, create } = await setup()
    await add()
    let resolve!: (order: Order) => void
    create.mockImplementation(() => new Promise<Order>(done => { resolve = done }))
    await wrapper.get('.order-create-submit').trigger('click')
    await wrapper.get('.order-create-submit').trigger('click')
    await wrapper.get('.order-create-cancel').trigger('click')
    expect(create).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('Создаем...')
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(wrapper.findAll('.order-create-item')).toHaveLength(1)
    resolve(createdOrder)
    await flushPromises()
    await vi.advanceTimersByTimeAsync(3000)
    expect(wrapper.emitted('created')).toEqual([[createdOrder]])
  })

  it('keeps the form and idempotency key after an unknown server outcome', async () => {
    const { wrapper, create } = await setup()
    await add()
    create.mockRejectedValueOnce({ outcomeUnknown: true })
    await wrapper.get('.order-create-submit').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('заказ мог быть создан')
    expect(wrapper.findAll('.order-create-item')).toHaveLength(1)
    await wrapper.get('.order-create-submit').trigger('click')
    await flushPromises()
    expect(create).toHaveBeenCalledTimes(2)
    expect(create.mock.calls[1][0].idempotency_key).toBe(create.mock.calls[0][0].idempotency_key)
    await vi.advanceTimersByTimeAsync(3000)
  })

  it('preserves the order across the shift-required flow and retries only on request', async () => {
    const { wrapper, create } = await setup()
    await add()
    create.mockRejectedValueOnce({ code: 'shift_required' })
    await wrapper.get('.order-create-submit').trigger('click')
    await flushPromises()
    const event = wrapper.emitted('shift-required')?.[0]?.[0] as { label: string; retry: () => Promise<boolean> }
    expect(event.label).toBe('Создать заказ')
    await wrapper.setProps({ isOpen: false })
    await wrapper.setProps({ isOpen: true })
    expect(wrapper.findAll('.order-create-item')).toHaveLength(1)
    expect(create).toHaveBeenCalledTimes(1)
    expect(await event.retry()).toBe(true)
    expect(create.mock.calls[1][0].idempotency_key).toBe(create.mock.calls[0][0].idempotency_key)
    await vi.advanceTimersByTimeAsync(3000)
  })

  it('clears a cancelled form and delivery address when switching to pickup', async () => {
    const { wrapper, create } = await setup()
    await add()
    await wrapper.get('input[value="delivery"]').setValue(true)
    await wrapper.get('.order-create-main textarea').setValue('Адрес')
    await wrapper.get('input[value="pickup"]').setValue(true)
    await wrapper.get('input[value="delivery"]').setValue(true)
    expect((wrapper.get('.order-create-main textarea').element as HTMLTextAreaElement).value).toBe('')
    await wrapper.get('.order-create-cancel').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(wrapper.get('.order-create-empty').exists()).toBe(true)
    expect(create).not.toHaveBeenCalled()
  })
})
