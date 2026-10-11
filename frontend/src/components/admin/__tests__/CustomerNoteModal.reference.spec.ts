import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import CustomerNoteModal from '@/components/admin/CustomerNoteModal.vue'

const crm = vi.hoisted(() => ({ upsertCustomerNote: vi.fn(), clearCustomerNote: vi.fn() }))
vi.mock('@/stores/crm', () => ({ useCrmStore: () => crm }))
const ModalStub = defineComponent({
  name: 'AdminModal',
  props: { isOpen: Boolean, referenceDesign: Boolean, isLoading: Boolean, title: String },
  emits: ['close'],
  template: '<section v-if="isOpen"><slot /></section>',
})
let wrapper: VueWrapper | undefined
beforeEach(() => {
  vi.resetAllMocks()
  crm.upsertCustomerNote.mockResolvedValue({ kind: 'active', customer: { id: 'client-1', telegram_username: 'alice' } })
  crm.clearCustomerNote.mockResolvedValue({ ok: true })
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined })
async function setup(props: Record<string, unknown> = {}) {
  wrapper = mount(CustomerNoteModal, {
    props: { isOpen: false, ...props },
    global: { stubs: { AdminModal: ModalStub } },
  })
  await wrapper.setProps({ isOpen: true })
  await flushPromises()
  return wrapper
}

describe('CustomerNoteModal: reference theme and preserved note actions', () => {
  it('uses the compact reference theme, labels and character counter', async () => {
    const w = await setup()
    expect(w.findComponent(ModalStub).props('referenceDesign')).toBe(true)
    expect(w.get('label[for="customer-note-username"]').text()).toBe('Telegram username')
    expect(w.get('textarea').attributes('maxlength')).toBe('2000')
    await w.get('textarea').setValue('Заметка')
    expect(w.get('#customer-note-counter').text()).toBe('7 / 2000')
  })
  it('creates a username note with normalized input and emits the resolved client', async () => {
    const w = await setup()
    await w.get('#customer-note-username').setValue('  @alice  ')
    await w.get('textarea').setValue('  Проверить при выдаче  ')
    await w.get('form').trigger('submit')
    await flushPromises()
    expect(crm.upsertCustomerNote).toHaveBeenCalledWith({ customer_id: undefined, telegram_username: 'alice', notes: 'Проверить при выдаче' })
    expect(w.emitted('saved')).toEqual([[{ kind: 'active', customerId: 'client-1', username: 'alice', notes: 'Проверить при выдаче' }]])
    expect(w.emitted('close')).toHaveLength(1)
  })
  it('preserves pending notes for a customer not yet in the database', async () => {
    crm.upsertCustomerNote.mockResolvedValue({ kind: 'pending', notes: 'Будущий клиент' })
    const w = await setup()
    await w.get('#customer-note-username').setValue('@new_client')
    await w.get('textarea').setValue('Будущий клиент')
    await w.get('form').trigger('submit')
    await flushPromises()
    expect(w.emitted('saved')?.[0]?.[0]).toMatchObject({ kind: 'pending', username: 'new_client', notes: 'Будущий клиент' })
  })
  it('keeps card-mode changes bound to the actual customer ID', async () => {
    const w = await setup({ mode: 'card', customerId: 'client-1', customerName: 'Алиса', prefillUsername: '@alice', initialNotes: 'Старая заметка' })
    expect(w.find('#customer-note-username').exists()).toBe(false)
    expect(w.get('.crm-note-customer').text()).toContain('Алиса')
    expect(w.get('.crm-note-customer').text()).toContain('@alice')
    await w.get('textarea').setValue('Новая заметка')
    await w.get('form').trigger('submit')
    await flushPromises()
    expect(crm.upsertCustomerNote).toHaveBeenCalledWith({ customer_id: 'client-1', telegram_username: 'alice', notes: 'Новая заметка' })
  })
  it('shows the selected client even without a Telegram username', async () => {
    const w = await setup({ mode: 'card', customerId: 'client-2', customerName: 'Иван' })
    expect(w.get('.crm-note-customer').text()).toContain('Иван')
    expect(w.get('.crm-note-customer').text()).toContain('ID client-2')
  })
  it('deletes a note by the same customer identity', async () => {
    const w = await setup({ mode: 'card', customerId: 'client-1', prefillUsername: '@alice', initialNotes: 'Удаляем' })
    await w.get('.crm-note-delete').trigger('click')
    await flushPromises()
    expect(crm.clearCustomerNote).toHaveBeenCalledWith({ customer_id: 'client-1', telegram_username: 'alice' })
    expect(w.emitted('saved')?.[0]?.[0]).toMatchObject({ kind: 'cleared', customerId: 'client-1', notes: null })
    expect(w.emitted('close')).toHaveLength(1)
  })
  it('preserves the existing clear-on-empty-save behavior', async () => {
    const w = await setup({ mode: 'card', customerId: 'client-1', prefillUsername: '@alice', initialNotes: 'Старая' })
    await w.get('textarea').setValue('   ')
    await w.get('form').trigger('submit')
    await flushPromises()
    expect(crm.clearCustomerNote).toHaveBeenCalledTimes(1)
    expect(crm.upsertCustomerNote).not.toHaveBeenCalled()
  })
  it('disables editing and closing during save, then closes after success', async () => {
    let finish!: (result: unknown) => void
    crm.upsertCustomerNote.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const w = await setup({ prefillUsername: 'alice' })
    await w.get('textarea').setValue('Заметка')
    await w.get('form').trigger('submit')
    expect(w.get('fieldset').attributes('disabled')).toBeDefined()
    expect(w.get('.crm-note-primary').attributes('disabled')).toBeDefined()
    expect(w.findComponent(ModalStub).props('isLoading')).toBe(true)
    w.findComponent(ModalStub).vm.$emit('close')
    await flushPromises()
    expect(w.emitted('close')).toBeUndefined()
    finish({ kind: 'active' })
    await flushPromises()
    expect(w.emitted('close')).toHaveLength(1)
  })
  it('keeps the text on error and permits retry', async () => {
    crm.upsertCustomerNote.mockRejectedValueOnce({ code: 'invalid_telegram_username' })
    const w = await setup({ prefillUsername: 'alice' })
    await w.get('textarea').setValue('Не потерять')
    await w.get('form').trigger('submit')
    await flushPromises()
    expect(w.get('[role="alert"]').text()).toContain('корректный Telegram username')
    expect((w.get('textarea').element as HTMLTextAreaElement).value).toBe('Не потерять')
    expect(w.emitted('close')).toBeUndefined()
    expect(w.get('.crm-note-primary').attributes('disabled')).toBeUndefined()
    await w.get('form').trigger('submit')
    await flushPromises()
    expect(crm.upsertCustomerNote).toHaveBeenCalledTimes(2)
    expect(w.emitted('close')).toHaveLength(1)
  })
  it('cancels without writing a note', async () => {
    const w = await setup()
    await w.get('.crm-note-secondary').trigger('click')
    expect(w.emitted('close')).toHaveLength(1)
    expect(crm.upsertCustomerNote).not.toHaveBeenCalled()
    expect(crm.clearCustomerNote).not.toHaveBeenCalled()
  })
})
