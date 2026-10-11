import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import CustomerBlockModal from '@/components/admin/CustomerBlockModal.vue'
import CustomerInviteBanModal from '@/components/admin/CustomerInviteBanModal.vue'
import { useCrmStore } from '@/stores/crm'

const ModalStub = defineComponent({
  name: 'AdminModal',
  props: {
    isOpen: Boolean,
    title: String,
    description: String,
    referenceDesign: Boolean,
    isLoading: Boolean,
    size: String,
  },
  emits: ['close'],
  template: '<section v-if="isOpen"><slot /></section>',
})
const wrappers: VueWrapper[] = []
const response = (data: unknown, ok = true) => ({ ok, json: async () => data }) as Response
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  setActivePinia(createPinia())
  fetchMock = vi.fn(async (url: string) => {
    if (url.includes('reason-templates')) return response({ templates: ['Тестовая причина'] })
    if (url.includes('/customers/search')) return response({ items: [] })
    return response({ ok: true })
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
async function block(props: Record<string, unknown> = {}) {
  const store = useCrmStore()
  const create = vi.spyOn(store, 'createCustomerBlock').mockResolvedValue({ kind: 'active', block: { id: 'block-test' } } as any)
  const wrapper = mount(CustomerBlockModal, {
    props: { isOpen: false, ...props },
    global: { stubs: { AdminModal: ModalStub } },
  })
  wrappers.push(wrapper)
  await wrapper.setProps({ isOpen: true })
  await flushPromises()
  return { wrapper, create }
}
async function invite(props: Record<string, unknown> = {}) {
  const wrapper = mount(CustomerInviteBanModal, {
    props: { isOpen: false, customerId: null, ...props },
    global: { stubs: { AdminModal: ModalStub } },
  })
  wrappers.push(wrapper)
  await wrapper.setProps({ isOpen: true })
  await flushPromises()
  return wrapper
}
const writesTo = (url: string) => fetchMock.mock.calls.filter(([path, options]) => path === url && options?.method === 'POST')

describe('Customer restriction modals: reference design and preserved actions', () => {
  it('opts both dialogs into the compact reference theme', async () => {
    const { wrapper: blocked } = await block()
    const invited = await invite()
    for (const wrapper of [blocked, invited]) {
      expect(wrapper.findComponent(ModalStub).props()).toMatchObject({ referenceDesign: true, size: 'md', isLoading: false })
      expect(wrapper.find('.crm-restriction-form').exists()).toBe(true)
      expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    }
  })

  it.each([['минуты', 'minutes'], ['часы', 'hours'], ['дни', 'days']])('keeps the %s block duration and reason', async (label, unit) => {
    const { wrapper, create } = await block({ prefillUsername: '@client_test' })
    await wrapper.findAll('.crm-restriction-duration').find(button => button.text() === label)!.trigger('click')
    await wrapper.get('#customer-block-duration').setValue(3)
    await wrapper.get('#customer-block-reason').setValue('  Причина  ')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(create).toHaveBeenCalledWith({ customer_id: undefined, telegram_username: 'client_test', reason: 'Причина', duration: { unit, value: 3 } })
    expect(wrapper.emitted('created')?.[0]).toEqual([{ kind: 'active', username: 'client_test' }])
    expect(writesTo('/api/admin/crm/blocks/block-test/notify')).toHaveLength(1)
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('keeps a card-selected customer ID and the forever option', async () => {
    const { wrapper, create } = await block({ customerId: 'real-customer', prefillUsername: 'old_username' })
    expect(wrapper.get('#customer-block-username').attributes('disabled')).toBeDefined()
    const forever = wrapper.findAll('.crm-restriction-duration').find(button => button.text() === 'навсегда')!
    await forever.trigger('click')
    expect(forever.attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('#customer-block-duration').exists()).toBe(false)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(create).toHaveBeenCalledWith({ customer_id: 'real-customer', telegram_username: undefined, reason: null, duration: { unit: 'forever' } })
  })

  it('keeps invalid-duration protection and recoverable block errors', async () => {
    const { wrapper, create } = await block({ prefillUsername: 'client_test' })
    await wrapper.get('#customer-block-duration').setValue(0)
    await wrapper.get('form').trigger('submit')
    expect(create).not.toHaveBeenCalled()
    await wrapper.get('#customer-block-duration').setValue(2)
    create.mockRejectedValueOnce(new Error('already_blocked'))
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Этот клиент уже заблокирован')
    expect(wrapper.emitted('close')).toBeUndefined()
    expect((wrapper.get('#customer-block-username').element as HTMLInputElement).value).toBe('client_test')
  })

  it('prevents duplicate blocking and cancellation until the request finishes', async () => {
    const { wrapper, create } = await block({ prefillUsername: 'client_test' })
    let resolve!: (value: any) => void
    create.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    await wrapper.get('form').trigger('submit')
    await wrapper.get('form').trigger('submit')
    await wrapper.get('.crm-restriction-actions .crm-restriction-secondary').trigger('click')
    expect(create).toHaveBeenCalledTimes(1)
    expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined()
    expect(wrapper.findComponent(ModalStub).props('isLoading')).toBe(true)
    expect(wrapper.emitted('close')).toBeUndefined()
    resolve({ kind: 'active', block: { id: 'block-test' } })
    await flushPromises()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('keeps quick-reason selection and accessible template removal', async () => {
    const { wrapper } = await block()
    await wrapper.get('.crm-restriction-chip').trigger('click')
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('Тестовая причина')
    await wrapper.get('.crm-restriction-link').trigger('click')
    expect(wrapper.get('.crm-restriction-remove').attributes('aria-label')).toBe('Удалить шаблон: Тестовая причина')
    await wrapper.get('.crm-restriction-remove').trigger('click')
    await flushPromises()
    expect(wrapper.find('.crm-restriction-chip').exists()).toBe(false)
    const saved = fetchMock.mock.calls.find(([url, options]) => url.includes('block-reason-templates') && options?.method === 'PUT')!
    expect(JSON.parse(saved[1].body)).toEqual({ templates: [] })
  })

  it('keeps invite bans separate from blocking and targets the selected ID', async () => {
    const wrapper = await invite({ customerId: 'selected-customer', username: 'client_test' })
    await wrapper.get('.crm-restriction-chip').trigger('click')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    const writes = writesTo('/api/admin/crm/invite-bans')
    expect(writes).toHaveLength(1)
    expect(JSON.parse(writes[0][1].body)).toEqual({ customer_id: 'selected-customer', reason: 'Тестовая причина' })
    expect(wrapper.text()).toContain('Заказы останутся доступны')
    expect(wrapper.emitted('created')).toHaveLength(1)
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('retains search and pending-username assignment for unknown invite targets', async () => {
    vi.useFakeTimers()
    const wrapper = await invite()
    await wrapper.get('input[type="search"]').setValue('@new_client')
    await vi.advanceTimersByTimeAsync(220)
    await flushPromises()
    expect(wrapper.text()).toContain('Решение применится при первом входе @new_client')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(JSON.parse(writesTo('/api/admin/crm/invite-bans')[0][1].body)).toEqual({ telegram_username: 'new_client', reason: null })
  })

  it('retains invite-ban errors without clearing the reason or target', async () => {
    const wrapper = await invite({ customerId: 'selected-customer', username: 'client_test' })
    fetchMock.mockImplementation(async (url: string) => url === '/api/admin/crm/invite-bans' ? response({ error: 'already_invite_banned' }, false) : response({ templates: [] }))
    await wrapper.get('textarea').setValue('Причина')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('Запрет уже действует')
    expect(wrapper.emitted('close')).toBeUndefined()
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('Причина')
    expect(wrapper.get('fieldset').attributes('disabled')).toBeUndefined()
  })

  it('prevents duplicate invite bans and cancellation while saving', async () => {
    const wrapper = await invite({ customerId: 'selected-customer' })
    let resolve!: (value: Response) => void
    fetchMock.mockImplementation((url: string) => url === '/api/admin/crm/invite-bans' ? new Promise(done => { resolve = done }) : Promise.resolve(response({ templates: [] })))
    await wrapper.get('form').trigger('submit')
    await wrapper.get('form').trigger('submit')
    await wrapper.get('.crm-restriction-actions .crm-restriction-secondary').trigger('click')
    expect(writesTo('/api/admin/crm/invite-bans')).toHaveLength(1)
    expect(wrapper.findComponent(ModalStub).props('isLoading')).toBe(true)
    expect(wrapper.emitted('close')).toBeUndefined()
    resolve(response({ ok: true }))
    await flushPromises()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
