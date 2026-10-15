import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import CustomerHubModal from '@/components/admin/crm/CustomerHubModal.vue'

const crm = vi.hoisted(() => ({
  fetchCustomerHub: vi.fn(),
  setCustomerCardPaymentEnabled: vi.fn(),
}))
vi.mock('@/stores/crm', () => ({ useCrmStore: () => crm }))

const ModalStub = defineComponent({
  name: 'AdminModal',
  props: { isOpen: Boolean, referenceDesign: Boolean, isLoading: Boolean, showActions: Boolean, title: String, size: String },
  emits: ['close', 'cancel'],
  template: '<section v-if="isOpen"><slot /></section>',
})

let wrapper: VueWrapper | undefined

function hubPayload(overrides: Record<string, unknown> = {}) {
  return {
    customer: {
      id: 'client-1',
      telegram_id: '7011',
      telegram_username: 'alice',
      first_name: 'Алиса',
      last_name: '',
      wholesale_min_override: null,
      total_orders: 3,
      notes: null,
    },
    block: null,
    invite_ban: null,
    inviter: null,
    card_profile: null,
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

const enabledCardProfile = () => ({
  source: 'linked',
  telegram_id: '7011',
  telegram_username: 'alice',
  enabled: true,
  monthly_limit_minor: 25000,
  max_order_minor: 4500,
  tariff_id: 'tariff-1',
  tariff_title: 'Стандарт',
  cooldown_started_at: null,
  cooldown_until: '2026-11-01T00:00:00.000Z',
  cooldown_days_left: 3,
  cooldown_days: 7,
  last_issued_at: null,
})

beforeEach(() => {
  vi.resetAllMocks()
  crm.fetchCustomerHub.mockResolvedValue(hubPayload())
  crm.setCustomerCardPaymentEnabled.mockResolvedValue(undefined)
})

afterEach(() => { wrapper?.unmount(); wrapper = undefined })

async function setup(props: Record<string, unknown> = {}) {
  wrapper = mount(CustomerHubModal, {
    props: { isOpen: false, ...props },
    global: { stubs: { AdminModal: ModalStub } },
  })
  await wrapper.setProps({ isOpen: true })
  await flushPromises()
  return wrapper
}

async function findClient(w: VueWrapper, username = '  @alice  ') {
  await w.get('#customer-hub-username').setValue(username)
  await w.get('.crm-customer-settings-search').trigger('submit')
  await flushPromises()
}

async function findCardWidget(w: VueWrapper) {
  await findClient(w)
  return w.get('[data-test="customer-hub-card"]')
}

describe('CustomerHubModal: search and customer card', () => {
  it('uses the compact reference theme without built-in actions', async () => {
    const w = await setup()
    expect(w.findComponent(ModalStub).props('referenceDesign')).toBe(true)
    expect(w.findComponent(ModalStub).props('showActions')).toBe(false)
    expect(w.findComponent(ModalStub).props('size')).toBe('md')
    expect(w.get('label[for="customer-hub-username"]').text()).toBe('Telegram username')
  })

  it('finds a client by username and shows identity with order count', async () => {
    const w = await setup()
    await findClient(w)
    expect(crm.fetchCustomerHub).toHaveBeenCalledWith('alice')
    expect(w.get('[data-test="customer-hub-name"]').text()).toBe('Алиса')
    expect(w.get('.crm-hub-customer-main').text()).toContain('@alice')
    expect(w.get('.crm-hub-customer-main').text()).toContain('TG ID 7011')
    expect(w.get('.crm-hub-customer-main').text()).toContain('3 заказа')
    expect(w.get('[role="status"]').attributes('aria-live')).toBe('polite')
    expect(w.get('[role="status"]').text()).toContain('Клиент найден')
  })

  it('announces a single order with the correct Russian plural', async () => {
    crm.fetchCustomerHub.mockResolvedValue(hubPayload({
      customer: { ...hubPayload().customer, total_orders: 1 },
    }))
    const w = await setup()
    await findClient(w)
    expect(w.get('.crm-hub-customer-main').text()).toContain('1 заказ')
  })

  it('emits customer-found so the parent can remember the searched client', async () => {
    const w = await setup()
    await findClient(w)
    expect(w.emitted('customer-found')).toEqual([[
      { username: 'alice', customerId: 'client-1', customerName: 'Алиса' },
    ]])
  })

  it('discards a stale search response after closing the modal', async () => {
    let resolveSearch: (value: unknown) => void = () => {}
    crm.fetchCustomerHub.mockReturnValueOnce(new Promise((resolve) => { resolveSearch = resolve }))
    const w = await setup()
    await w.get('#customer-hub-username').setValue('alice')
    await w.get('.crm-customer-settings-search').trigger('submit')
    await w.setProps({ isOpen: false })
    resolveSearch(hubPayload())
    await flushPromises()
    await w.setProps({ isOpen: true })
    await flushPromises()
    expect(w.find('[data-test="customer-hub-name"]').exists()).toBe(false)
    expect(w.get('#customer-hub-username').element as HTMLInputElement).toBeInstanceOf(HTMLInputElement)
  })

  it('shows status badges for block, invite ban and personal minimum', async () => {
    crm.fetchCustomerHub.mockResolvedValue(hubPayload({
      block: { id: 'b1', kind: 'active', block_until: null, reason: 'Спам', blocked_at: null, blocked_by: null },
      invite_ban: { id: 'ib1', reason: 'Массовые приглашения', banned_by: null, banned_at: null },
      customer: { ...hubPayload().customer, wholesale_min_override: 15 },
    }))
    const w = await setup()
    await findClient(w)
    expect(w.get('[data-test="customer-hub-block-badge"]').text()).toContain('Заблокирован')
    expect(w.get('[data-test="customer-hub-invite-ban-badge"]').text()).toContain('Приглашения запрещены')
    expect(w.get('.crm-hub-badges').text()).toContain('Опт-минимум: 15')
    expect(w.get('.crm-hub-customer + .crm-note-hint').text()).toContain('Причина блокировки: Спам')
    expect(w.get('.crm-hub-customer').text()).toContain('Причина запрета приглашать: Массовые приглашения')
  })

  it('always shows the invite plate: green when allowed', async () => {
    const w = await setup()
    await findClient(w)
    const plate = w.get('[data-test="customer-hub-invite-ban-badge"]')
    expect(plate.text()).toBe('Приглашения разрешены')
    expect(plate.classes()).toContain('crm-hub-plate--success')
    expect(plate.classes()).not.toContain('crm-hub-plate--danger')
  })

  it('paints the invite plate red when an invite ban exists', async () => {
    crm.fetchCustomerHub.mockResolvedValue(hubPayload({
      invite_ban: { id: 'ib1', reason: null, banned_by: null, banned_at: null },
    }))
    const w = await setup()
    await findClient(w)
    const plate = w.get('[data-test="customer-hub-invite-ban-badge"]')
    expect(plate.text()).toBe('Приглашения запрещены')
    expect(plate.classes()).toContain('crm-hub-plate--danger')
  })

  it('requires a username before searching', async () => {
    const w = await setup()
    await w.get('#customer-hub-username').setValue('   ')
    await w.get('.crm-customer-settings-search').trigger('submit')
    await flushPromises()
    expect(crm.fetchCustomerHub).not.toHaveBeenCalled()
    expect(w.get('[role="alert"]').text()).toContain('Введите @username')
  })

  it('renders the not-found error without closing the modal', async () => {
    crm.fetchCustomerHub.mockRejectedValueOnce({ code: 'customer_not_found' })
    const w = await setup()
    await findClient(w, '@ghost')
    expect(w.get('[role="alert"]').text()).toContain('Клиент с таким username не найден')
    expect(w.emitted('close')).toBeUndefined()
  })

  it('auto-searches the prefill and offers the contact action only with an order context', async () => {
    const w = await setup({ prefill: { username: '@alice', customerId: 'client-1', customerName: 'Алиса', orderId: 'order-1' } })
    expect(crm.fetchCustomerHub).toHaveBeenCalledWith('alice')
    expect(w.get('[data-test="customer-hub-contact"]').text()).toContain('Написать клиенту')
    expect(w.get('[data-test="customer-hub-contact"]').attributes('disabled')).toBeUndefined()
  })

  it('hides the contact action when opened from the toolbar without an order', async () => {
    await setup({ prefill: { username: 'alice' } })
    expect(wrapper!.find('[data-test="customer-hub-contact"]').exists()).toBe(false)
  })

  it('resets to search via «Другой клиент» and reloads fresh data on reopen', async () => {
    const w = await setup()
    await findClient(w)
    await w.get('.crm-note-secondary').trigger('click')
    expect(w.find('[data-test="customer-hub-name"]').exists()).toBe(false)
    expect((w.get('#customer-hub-username').element as HTMLInputElement).value).toBe('')
    crm.fetchCustomerHub.mockClear()
    await w.setProps({ isOpen: false })
    await w.setProps({ isOpen: true })
    await flushPromises()
    expect(crm.fetchCustomerHub).not.toHaveBeenCalled()
    expect(w.find('[data-test="customer-hub-name"]').exists()).toBe(false)
    expect(w.find('[role="alert"]').exists()).toBe(false)
  })
})

describe('CustomerHubModal: card payment widget', () => {
  it('shows an unset state with an enable button and no limits', async () => {
    const w = await setup()
    const card = await findCardWidget(w)
    expect(card.get('[data-test="customer-hub-card-status"]').text()).toBe('Не настроена')
    expect(card.find('.crm-hub-card-details').exists()).toBe(false)
    expect(card.get('[data-test="customer-hub-card-toggle"]').text()).toBe('Разрешить оплату картой')
  })

  it('shows a forbidden state for a disabled card profile', async () => {
    crm.fetchCustomerHub.mockResolvedValue(hubPayload({
      card_profile: { ...enabledCardProfile(), enabled: false },
    }))
    const w = await setup()
    const card = await findCardWidget(w)
    expect(card.get('[data-test="customer-hub-card-status"]').text()).toBe('Запрещена')
    expect(card.get('[data-test="customer-hub-card-toggle"]').text()).toBe('Разрешить оплату картой')
  })

  it('shows limits, tariff and cooldown for an allowed profile', async () => {
    crm.fetchCustomerHub.mockResolvedValue(hubPayload({ card_profile: enabledCardProfile() }))
    const w = await setup()
    const card = await findCardWidget(w)
    expect(card.get('[data-test="customer-hub-card-status"]').text()).toBe('Разрешена')
    expect(card.get('.crm-hub-card-details').text()).toContain('250,00 BYN')
    expect(card.get('.crm-hub-card-details').text()).toContain('45,00 BYN')
    expect(card.get('.crm-hub-card-details').text()).toContain('Стандарт')
    expect(card.get('[data-test="customer-hub-card-cooldown"]').text()).toContain('осталось 3 дн.')
    expect(card.get('[data-test="customer-hub-card-toggle"]').text()).toBe('Запретить оплату картой')
  })

  it('enables card payment for a client without an account and reloads the hub', async () => {
    crm.setCustomerCardPaymentEnabled.mockResolvedValueOnce(undefined)
    crm.fetchCustomerHub.mockResolvedValueOnce(hubPayload())
    crm.fetchCustomerHub.mockResolvedValueOnce(hubPayload({ card_profile: enabledCardProfile() }))
    const w = await setup()
    const card = await findCardWidget(w)
    await card.get('[data-test="customer-hub-card-toggle"]').trigger('click')
    await flushPromises()
    expect(crm.setCustomerCardPaymentEnabled).toHaveBeenCalledWith('alice', '7011', true, null)
    expect(crm.fetchCustomerHub).toHaveBeenCalledTimes(2)
    expect(card.get('[data-test="customer-hub-card-status"]').text()).toBe('Разрешена')
    expect(w.emitted('notify')?.at(-1)).toEqual([{ ok: true, message: 'Оплата картой разрешена для @alice' }])
  })

  it('disables card payment through the account endpoint without resetting limits', async () => {
    crm.fetchCustomerHub.mockResolvedValue(hubPayload({ card_profile: enabledCardProfile() }))
    crm.fetchCustomerHub.mockResolvedValueOnce(hubPayload({ card_profile: enabledCardProfile() }))
    crm.fetchCustomerHub.mockResolvedValueOnce(hubPayload({ card_profile: { ...enabledCardProfile(), enabled: false } }))
    const w = await setup()
    const card = await findCardWidget(w)
    await card.get('[data-test="customer-hub-card-toggle"]').trigger('click')
    await flushPromises()
    expect(crm.setCustomerCardPaymentEnabled).toHaveBeenCalledWith('alice', '7011', false, {
      telegram_id: '7011', monthly_limit_minor: 25000, max_order_minor: 4500,
    })
    expect(card.get('[data-test="customer-hub-card-status"]').text()).toBe('Запрещена')
    expect(w.emitted('notify')?.at(-1)).toEqual([{ ok: true, message: 'Оплата картой запрещена для @alice' }])
  })

  it('patches the account by its own telegram id, not the CRM customer id', async () => {
    // Username повторно занят новым аккаунтом: переключаем именно найденный аккаунт.
    crm.fetchCustomerHub.mockResolvedValue(hubPayload({ card_profile: { ...enabledCardProfile(), telegram_id: '9999' } }))
    crm.fetchCustomerHub.mockResolvedValueOnce(hubPayload({ card_profile: { ...enabledCardProfile(), telegram_id: '9999' } }))
    crm.fetchCustomerHub.mockResolvedValueOnce(hubPayload({ card_profile: { ...enabledCardProfile(), telegram_id: '9999', enabled: false } }))
    const w = await setup()
    const card = await findCardWidget(w)
    await card.get('[data-test="customer-hub-card-toggle"]').trigger('click')
    await flushPromises()
    expect(crm.setCustomerCardPaymentEnabled).toHaveBeenCalledWith('alice', '7011', false, {
      telegram_id: '9999', monthly_limit_minor: 25000, max_order_minor: 4500,
    })
  })

  it('carries pending profile limits when enabling card payment', async () => {
    const pendingProfile = () => ({ ...enabledCardProfile(), source: 'pending', telegram_id: null, enabled: false })
    crm.fetchCustomerHub.mockResolvedValue(hubPayload({ card_profile: pendingProfile() }))
    crm.fetchCustomerHub.mockResolvedValueOnce(hubPayload({ card_profile: pendingProfile() }))
    crm.fetchCustomerHub.mockResolvedValueOnce(hubPayload({ card_profile: enabledCardProfile() }))
    const w = await setup()
    const card = await findCardWidget(w)
    expect(card.get('[data-test="customer-hub-card-status"]').text()).toBe('Запрещена')
    await card.get('[data-test="customer-hub-card-toggle"]').trigger('click')
    await flushPromises()
    expect(crm.setCustomerCardPaymentEnabled).toHaveBeenCalledWith('alice', '7011', true, {
      telegram_id: null, monthly_limit_minor: 25000, max_order_minor: 4500,
    })
    expect(card.get('[data-test="customer-hub-card-status"]').text()).toBe('Разрешена')
  })

  it('keeps the modal open with an error when the toggle fails', async () => {
    crm.setCustomerCardPaymentEnabled.mockRejectedValueOnce({ message: 'server error' })
    const w = await setup()
    const card = await findCardWidget(w)
    await card.get('[data-test="customer-hub-card-toggle"]').trigger('click')
    await flushPromises()
    // Ошибка показывается рядом с виджетом карты, а не только в подвале.
    expect(card.get('[role="alert"]').text()).toContain('server error')
    expect(w.emitted('notify')?.at(-1)).toEqual([{ ok: false, message: 'Не удалось изменить разрешение на оплату картой.' }])
    expect(w.emitted('close')).toBeUndefined()
  })

  it('unsticks the card toggle when switching to another client mid-flight', async () => {
    let resolveToggle: (value: unknown) => void = () => {}
    crm.setCustomerCardPaymentEnabled.mockReturnValueOnce(new Promise((resolve) => { resolveToggle = resolve }))
    crm.fetchCustomerHub.mockResolvedValue(hubPayload({ card_profile: enabledCardProfile() }))
    const w = await setup()
    const card = await findCardWidget(w)
    await card.get('[data-test="customer-hub-card-toggle"]').trigger('click')
    // «Другой клиент» во время летящего переключателя не должна wedge-ить виджет.
    await w.get('.crm-note-secondary').trigger('click')
    await findClient(w, 'bob')
    const toggle = w.get('[data-test="customer-hub-card-toggle"]')
    expect(toggle.attributes('disabled')).toBeUndefined()
    expect(toggle.text()).not.toContain('Сохраняем')
    resolveToggle(undefined)
    await flushPromises()
    expect(w.find('[role="alert"]').exists()).toBe(false)
  })
})

describe('CustomerHubModal: actions', () => {
  it('emits each customer action with the full context', async () => {
    const w = await setup()
    await findClient(w)
    const expected = {
      username: 'alice', customerId: 'client-1', customerName: 'Алиса', notes: null, orderId: null, inviteBanId: null,
    }
    for (const [test, action] of [
      ['customer-hub-block', 'block'], ['customer-hub-note', 'note'],
      ['customer-hub-invite-ban', 'invite-ban'], ['customer-hub-wholesale', 'wholesale'],
    ] as const) {
      await w.get(`[data-test="${test}"]`).trigger('click')
      expect(w.emitted('action')?.at(-1)).toEqual([action, expected])
    }
    expect(w.emitted('close')).toBeUndefined()
  })

  it('carries notes and order context into the note action', async () => {
    crm.fetchCustomerHub.mockResolvedValue(hubPayload({
      customer: { ...hubPayload().customer, notes: 'Перезвонить' },
    }))
    const w = await setup({ prefill: { username: 'alice', customerId: 'client-1', orderId: 'order-1' } })
    await w.get('[data-test="customer-hub-note"]').trigger('click')
    expect(w.emitted('action')?.at(-1)).toEqual(['note', {
      username: 'alice', customerId: 'client-1', customerName: 'Алиса', notes: 'Перезвонить', orderId: 'order-1', inviteBanId: null,
    }])
  })

  it('disables blocking when it exists and offers lifting the invite ban', async () => {
    crm.fetchCustomerHub.mockResolvedValue(hubPayload({
      block: { id: 'b1', kind: 'active', block_until: null, reason: null, blocked_at: null, blocked_by: null },
      invite_ban: { id: 'ib1', reason: null, banned_by: null, banned_at: null },
    }))
    const w = await setup()
    await findClient(w)
    expect(w.get('[data-test="customer-hub-block"]').attributes('disabled')).toBeDefined()
    expect(w.get('[data-test="customer-hub-block"]').text()).toContain('Клиент уже заблокирован')
    // Действующий запрет — не мёртвая строка: её можно снять прямо из хаба.
    expect(w.find('[data-test="customer-hub-invite-ban"]').exists()).toBe(false)
    const unban = w.get('[data-test="customer-hub-invite-unban"]')
    expect(unban.attributes('disabled')).toBeUndefined()
    expect(unban.text()).toContain('Разрешить приглашать')
    await unban.trigger('click')
    expect(w.emitted('action')?.at(-1)).toEqual(['remove-invite-ban', {
      username: 'alice', customerId: 'client-1', customerName: 'Алиса', notes: null, orderId: null, inviteBanId: 'ib1',
    }])
  })

  it('asks to find the inviter when the hub has none', async () => {
    const w = await setup()
    await findClient(w)
    expect(w.find('[data-test="customer-hub-inviter-panel"]').exists()).toBe(false)
    await w.get('[data-test="customer-hub-inviter"]').trigger('click')
    expect(w.emitted('action')?.at(-1)?.[0]).toBe('find-inviter')
  })

  it('expands the inviter panel and emits inviter actions with the inviter', async () => {
    crm.fetchCustomerHub.mockResolvedValue(hubPayload({
      inviter: { customer_id: 'inviter-9', username: 'boss', first_name: 'Иван', last_name: null, invite_ban_id: null, is_invite_banned: false },
    }))
    const w = await setup()
    await findClient(w)
    await w.get('[data-test="customer-hub-inviter"]').trigger('click')
    const panel = w.get('[data-test="customer-hub-inviter-panel"]')
    expect(panel.text()).toContain('Иван')
    expect(panel.text()).toContain('@boss')
    await panel.get('.crm-hub-inviter-actions button:nth-of-type(3)').trigger('click')
    expect(w.emitted('inviter-action')?.at(-1)).toEqual(['block', {
      customer_id: 'inviter-9', username: 'boss', first_name: 'Иван', last_name: null, invite_ban_id: null, is_invite_banned: false,
    }])
    expect(w.emitted('action')).toBeUndefined()
  })

  it('offers removing the inviter ban for a banned inviter', async () => {
    crm.fetchCustomerHub.mockResolvedValue(hubPayload({
      inviter: { customer_id: 'inviter-9', username: 'boss', first_name: null, last_name: null, invite_ban_id: 'ban-1', is_invite_banned: true },
    }))
    const w = await setup()
    await findClient(w)
    await w.get('[data-test="customer-hub-inviter"]').trigger('click')
    const panel = w.get('[data-test="customer-hub-inviter-panel"]')
    await panel.get('.crm-hub-inviter-actions button:nth-of-type(4)').trigger('click')
    expect(w.emitted('inviter-action')?.at(-1)?.[0]).toBe('remove-ban')
  })

  it('closes on the secondary close button', async () => {
    const w = await setup()
    await findClient(w)
    const buttons = w.findAll('.crm-note-secondary')
    await buttons[buttons.length - 1].trigger('click')
    expect(w.emitted('close')).toHaveLength(1)
  })
})
