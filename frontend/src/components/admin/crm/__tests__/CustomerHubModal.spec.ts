import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import CustomerHubModal from '@/components/admin/crm/CustomerHubModal.vue'

const crm = vi.hoisted(() => ({
  setCustomerCardPaymentEnabled: vi.fn(),
  clearCardAccountCooldown: vi.fn(),
}))
vi.mock('@/stores/crm', () => ({ useCrmStore: () => crm }))

const api = vi.hoisted(() => ({
  fetchCustomerHub: vi.fn(),
  fetchCustomerListCounts: vi.fn(),
  fetchCustomerList: vi.fn(),
  removeBlock: vi.fn(),
  grantStaffAccess: vi.fn(),
  revokeStaffAccess: vi.fn(),
  removePendingStaffAccess: vi.fn(),
  addReservedUsernames: vi.fn(),
  removeReservedUsername: vi.fn(),
  convertReservedToInviteBan: vi.fn(),
  removeInviteBan: vi.fn(),
  fetchCustomerOrders: vi.fn(),
}))
vi.mock('@/utils/crmCustomerHubApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/crmCustomerHubApi')>()),
  ...api,
}))

const ModalStub = defineComponent({
  name: 'AdminModal',
  props: { isOpen: Boolean, referenceDesign: Boolean, isLoading: Boolean, showActions: Boolean, title: String, size: String },
  emits: ['close', 'cancel'],
  template: '<section v-if="isOpen"><header><slot name="title">{{ title }}</slot></header><slot /></section>',
})

let wrapper: VueWrapper | undefined

const authorization = (overrides: Record<string, unknown> = {}) => ({
  feature_enabled: true,
  is_authorized: true,
  source: 'referral',
  authorized_at: null,
  authorized_by: null,
  state: null,
  staff_access: { active: false, permanent: false, pending_id: null },
  is_reserved_inviter: false,
  ...overrides,
})

function hubPayload(overrides: Record<string, unknown> = {}) {
  return {
    ghost: false,
    authorization: authorization(),
    pending_invite_ban: null,
    recent_orders: [],
    last_order_at: null,
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
  // Пауза ещё идёт: заканчивается через 3 дня от «сейчас».
  cooldown_until: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
  cooldown_days_left: 3,
  cooldown_days: 7,
  last_issued_at: null,
})

beforeEach(() => {
  vi.resetAllMocks()
  api.fetchCustomerHub.mockResolvedValue(hubPayload())
  crm.setCustomerCardPaymentEnabled.mockResolvedValue(undefined)
  api.fetchCustomerListCounts.mockResolvedValue({ blocked: 2, auth_errors: 1, staff_access: 0, invite_bans: 0, reserved: 3 })
  api.fetchCustomerList.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 })
  for (const fn of [api.removeBlock, api.grantStaffAccess, api.revokeStaffAccess, api.removePendingStaffAccess,
    api.addReservedUsernames, api.removeReservedUsername, api.convertReservedToInviteBan, api.removeInviteBan]) {
    fn.mockResolvedValue({ ok: true })
  }
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
    expect(w.findComponent(ModalStub).props('size')).toBe('xl')
    expect(w.get('label[for="customer-hub-username"]').text()).toBe('Найти клиента')
  })

  it('finds a client and puts name, username, TG ID and access status into the window title', async () => {
    const w = await setup()
    // До поиска заголовок — обычное «Клиент».
    expect(w.get('header').text()).toBe('Клиент')
    await findClient(w)
    expect(api.fetchCustomerHub).toHaveBeenCalledWith('alice')
    const title = w.get('header [data-test="customer-hub-customer"]')
    expect(title.get('[data-test="customer-hub-name"]').text()).toBe('Алиса')
    expect(title.get('[data-test="customer-hub-username"]').text()).toBe('@alice')
    expect(title.get('[data-test="customer-hub-copy-tg-id"]').text()).toBe('TG ID 7011')
    const status = title.get('[data-test="customer-hub-access-status"]')
    expect(status.text()).toBe('Доступ открыт')
    expect(status.classes()).toContain('crm-hub-plate--info')
    // Счётчик заказов в шапке больше не дублирует статистику.
    expect(title.text()).not.toContain('заказ')
    expect(w.get('[role="status"]').attributes('aria-live')).toBe('polite')
    expect(w.get('[role="status"]').text()).toContain('Клиент найден')
  })

  it('copies the TG ID with a short confirmation in place', async () => {
    vi.useFakeTimers()
    try {
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
      const w = await setup()
      await findClient(w)
      const copy = w.get('[data-test="customer-hub-copy-tg-id"]')
      await copy.trigger('click')
      await flushPromises()
      expect(writeText).toHaveBeenCalledWith('7011')
      expect(copy.text()).toBe('Скопировано')
      vi.advanceTimersByTime(1600)
      await flushPromises()
      expect(copy.text()).toBe('TG ID 7011')
    } finally {
      vi.useRealTimers()
      Reflect.deleteProperty(navigator, 'clipboard')
    }
  })

  it('omits the username line for a client without username and wraps a long name', async () => {
    const longName = 'Александра-Виктория Константинопольская-Длинноимённая'
    api.fetchCustomerHub.mockResolvedValue(hubPayload({
      username: null,
      customer: { ...hubPayload().customer, telegram_username: null, first_name: longName },
    }))
    const w = await setup()
    await w.get('#customer-hub-username').setValue('7011')
    await w.get('.crm-customer-settings-search').trigger('submit')
    await flushPromises()
    expect(w.get('[data-test="customer-hub-name"]').text()).toBe(longName)
    expect(w.find('[data-test="customer-hub-username"]').exists()).toBe(false)
    expect(w.get('[data-test="customer-hub-copy-tg-id"]').text()).toBe('TG ID 7011')
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
    api.fetchCustomerHub.mockReturnValueOnce(new Promise((resolve) => { resolveSearch = resolve }))
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
    api.fetchCustomerHub.mockResolvedValue(hubPayload({
      block: { id: 'b1', kind: 'active', block_until: null, reason: 'Спам', blocked_at: null, blocked_by: null },
      invite_ban: { id: 'ib1', reason: 'Массовые приглашения', banned_by: null, banned_at: null },
      customer: { ...hubPayload().customer, wholesale_min_override: 15 },
    }))
    const w = await setup()
    await findClient(w)
    // Блокировку показывает красная плашка-уведомление, отдельного бейджа нет.
    expect(w.find('[data-test="customer-hub-block-badge"]').exists()).toBe(false)
    expect(w.get('[data-test="customer-hub-block-notice"]').text()).toContain('Блокировка')
    expect(w.get('[data-test="customer-hub-invite-ban-badge"]').text()).toContain('Приглашения запрещены')
    expect(w.get('[data-test="customer-hub-customer"]').text()).toContain('Опт-минимум: 15')
    expect(w.get('[data-test="customer-hub-access-status"]').text()).toBe('Заблокирован')
    expect(w.get('[data-test="customer-hub-access-status"]').classes()).toContain('crm-hub-plate--danger')
    expect(w.get('[data-test="customer-hub-block-reason"]').text()).toBe('Спам')
    expect(w.get('[data-test="customer-hub-invite-ban-reason"]').text()).toBe('Причина запрета приглашать: Массовые приглашения')
  })

  it('shows no invite plate in the normal state — only exceptions get a badge', async () => {
    const w = await setup()
    await findClient(w)
    expect(w.find('[data-test="customer-hub-invite-ban-badge"]').exists()).toBe(false)
    expect(w.get('[data-test="customer-hub-customer"]').findAll('.crm-hub-customer-meta .crm-hub-plate')).toHaveLength(0)
    expect(w.find('[data-test="customer-hub-block-notice"]').exists()).toBe(false)
  })

  it('paints the invite plate red when an invite ban exists', async () => {
    api.fetchCustomerHub.mockResolvedValue(hubPayload({
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
    expect(api.fetchCustomerHub).not.toHaveBeenCalled()
    expect(w.get('[role="alert"]').text()).toContain('Введите @username или Telegram ID')
  })

  it('renders the not-found error without closing the modal', async () => {
    api.fetchCustomerHub.mockRejectedValueOnce({ code: 'customer_not_found' })
    const w = await setup()
    await findClient(w, '@ghost')
    expect(w.get('[role="alert"]').text()).toContain('Клиент не найден')
    expect(w.emitted('close')).toBeUndefined()
  })

  it('auto-searches the prefill and offers the contact action only with an order context', async () => {
    const w = await setup({ prefill: { username: '@alice', customerId: 'client-1', customerName: 'Алиса', orderId: 'order-1' } })
    expect(api.fetchCustomerHub).toHaveBeenCalledWith('alice')
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
    api.fetchCustomerHub.mockClear()
    await w.setProps({ isOpen: false })
    await w.setProps({ isOpen: true })
    await flushPromises()
    expect(api.fetchCustomerHub).not.toHaveBeenCalled()
    expect(w.find('[data-test="customer-hub-name"]').exists()).toBe(false)
    expect(w.find('[role="alert"]').exists()).toBe(false)
  })
})

describe('CustomerHubModal: card payment widget', () => {
  it('shows an unset state with an enable button and no limits', async () => {
    const w = await setup()
    const card = await findCardWidget(w)
    expect(card.get('[data-test="customer-hub-card-status"]').text()).toBe('Не настроена')
    expect(card.find('.crm-hub-card-row').exists()).toBe(false)
    expect(card.get('[data-test="customer-hub-card-settings"]').text()).toContain('Аккаунт не настроен')
    expect(card.find('[data-test="customer-hub-card-clear-cooldown"]').exists()).toBe(false)
    expect(card.get('[data-test="customer-hub-card-toggle"]').text()).toBe('Разрешить')
  })

  it('shows a forbidden state for a disabled card profile', async () => {
    api.fetchCustomerHub.mockResolvedValue(hubPayload({
      card_profile: { ...enabledCardProfile(), enabled: false },
    }))
    const w = await setup()
    const card = await findCardWidget(w)
    expect(card.get('[data-test="customer-hub-card-status"]').text()).toBe('Запрещена')
    expect(card.get('[data-test="customer-hub-card-toggle"]').text()).toBe('Разрешить')
  })

  it('shows limits, tariff and cooldown for an allowed profile', async () => {
    api.fetchCustomerHub.mockResolvedValue(hubPayload({ card_profile: enabledCardProfile() }))
    const w = await setup()
    const card = await findCardWidget(w)
    expect(card.get('[data-test="customer-hub-card-status"]').text()).toBe('Разрешена')
    expect(card.get('.crm-hub-card-details').text()).toContain('45,00 BYN')
    expect(card.get('.crm-hub-card-details').text()).not.toContain('250,00 BYN')
    expect(card.get('.crm-hub-card-details').text()).toContain('Стандарт')
    expect(card.get('[data-test="customer-hub-card-cooldown"]').text()).toContain('осталось 3 дн.')
    expect(card.get('[data-test="customer-hub-card-toggle"]').text()).toBe('Запретить')
  })

  it('enables card payment for a client without an account and reloads the hub', async () => {
    crm.setCustomerCardPaymentEnabled.mockResolvedValueOnce(undefined)
    api.fetchCustomerHub.mockResolvedValueOnce(hubPayload())
    api.fetchCustomerHub.mockResolvedValueOnce(hubPayload({ card_profile: enabledCardProfile() }))
    const w = await setup()
    const card = await findCardWidget(w)
    await card.get('[data-test="customer-hub-card-toggle"]').trigger('click')
    await flushPromises()
    expect(crm.setCustomerCardPaymentEnabled).toHaveBeenCalledWith('alice', '7011', true, null)
    expect(api.fetchCustomerHub).toHaveBeenCalledTimes(2)
    expect(card.get('[data-test="customer-hub-card-status"]').text()).toBe('Разрешена')
    expect(w.emitted('notify')?.at(-1)).toEqual([{ ok: true, message: 'Оплата картой разрешена для @alice' }])
  })

  it('disables card payment through the account endpoint without resetting limits', async () => {
    api.fetchCustomerHub.mockResolvedValue(hubPayload({ card_profile: enabledCardProfile() }))
    api.fetchCustomerHub.mockResolvedValueOnce(hubPayload({ card_profile: enabledCardProfile() }))
    api.fetchCustomerHub.mockResolvedValueOnce(hubPayload({ card_profile: { ...enabledCardProfile(), enabled: false } }))
    const w = await setup()
    const card = await findCardWidget(w)
    await card.get('[data-test="customer-hub-card-toggle"]').trigger('click')
    await flushPromises()
    expect(crm.setCustomerCardPaymentEnabled).toHaveBeenCalledWith('alice', '7011', false, {
      telegram_id: '7011', max_order_minor: 4500,
    })
    expect(card.get('[data-test="customer-hub-card-status"]').text()).toBe('Запрещена')
    expect(w.emitted('notify')?.at(-1)).toEqual([{ ok: true, message: 'Оплата картой запрещена для @alice' }])
  })

  it('patches the account by its own telegram id, not the CRM customer id', async () => {
    // Username повторно занят новым аккаунтом: переключаем именно найденный аккаунт.
    api.fetchCustomerHub.mockResolvedValue(hubPayload({ card_profile: { ...enabledCardProfile(), telegram_id: '9999' } }))
    api.fetchCustomerHub.mockResolvedValueOnce(hubPayload({ card_profile: { ...enabledCardProfile(), telegram_id: '9999' } }))
    api.fetchCustomerHub.mockResolvedValueOnce(hubPayload({ card_profile: { ...enabledCardProfile(), telegram_id: '9999', enabled: false } }))
    const w = await setup()
    const card = await findCardWidget(w)
    await card.get('[data-test="customer-hub-card-toggle"]').trigger('click')
    await flushPromises()
    expect(crm.setCustomerCardPaymentEnabled).toHaveBeenCalledWith('alice', '7011', false, {
      telegram_id: '9999', max_order_minor: 4500,
    })
  })

  it('carries pending profile limits when enabling card payment', async () => {
    const pendingProfile = () => ({ ...enabledCardProfile(), source: 'pending', telegram_id: null, enabled: false })
    api.fetchCustomerHub.mockResolvedValue(hubPayload({ card_profile: pendingProfile() }))
    api.fetchCustomerHub.mockResolvedValueOnce(hubPayload({ card_profile: pendingProfile() }))
    api.fetchCustomerHub.mockResolvedValueOnce(hubPayload({ card_profile: enabledCardProfile() }))
    const w = await setup()
    const card = await findCardWidget(w)
    expect(card.get('[data-test="customer-hub-card-status"]').text()).toBe('Запрещена')
    await card.get('[data-test="customer-hub-card-toggle"]').trigger('click')
    await flushPromises()
    expect(crm.setCustomerCardPaymentEnabled).toHaveBeenCalledWith('alice', '7011', true, {
      telegram_id: null, max_order_minor: 4500,
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
    api.fetchCustomerHub.mockResolvedValue(hubPayload({ card_profile: enabledCardProfile() }))
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

  it('clears an active card cooldown after a confirm and reloads the hub', async () => {
    crm.clearCardAccountCooldown.mockResolvedValue({ cleared: true, profile: null })
    api.fetchCustomerHub.mockResolvedValue(hubPayload({ card_profile: enabledCardProfile() }))
    const w = await setup()
    const card = await findCardWidget(w)
    await card.get('[data-test="customer-hub-card-clear-cooldown"]').trigger('click')
    expect(crm.clearCardAccountCooldown).not.toHaveBeenCalled()
    api.fetchCustomerHub.mockResolvedValue(hubPayload({
      card_profile: { ...enabledCardProfile(), cooldown_until: null, cooldown_days_left: 0 },
    }))
    await w.get('[data-test="customer-hub-card-cooldown-confirm-yes"]').trigger('click')
    await flushPromises()
    expect(crm.clearCardAccountCooldown).toHaveBeenCalledWith('7011')
    expect(w.emitted('notify')?.at(-1)).toEqual([{ ok: true, message: 'Пауза оплаты картой снята: @alice' }])
    expect(w.get('[data-test="customer-hub-card-cooldown"]').text()).toBe('нет')
    expect(w.find('[data-test="customer-hub-card-clear-cooldown"]').exists()).toBe(false)
    expect(w.find('[data-test="customer-hub-card-cooldown-confirm"]').exists()).toBe(false)
  })

  it('hides «Снять паузу» when the cooldown has already passed', async () => {
    api.fetchCustomerHub.mockResolvedValue(hubPayload({
      card_profile: { ...enabledCardProfile(), cooldown_until: '2020-01-01T00:00:00.000Z', cooldown_days_left: 0 },
    }))
    const w = await setup()
    const card = await findCardWidget(w)
    expect(card.find('[data-test="customer-hub-card-clear-cooldown"]').exists()).toBe(false)
    expect(card.get('[data-test="customer-hub-card-cooldown"]').text()).toBe('нет')
  })

  it('opens the card settings of this client by a click on the card details', async () => {
    api.fetchCustomerHub.mockResolvedValue(hubPayload({ card_profile: enabledCardProfile() }))
    const w = await setup()
    const card = await findCardWidget(w)
    await card.get('[data-test="customer-hub-card-settings"]').trigger('click')
    expect(w.emitted('open-card-settings')).toEqual([['alice']])
  })
})

describe('CustomerHubModal: actions', () => {
  it('emits each customer action with the full context', async () => {
    const w = await setup()
    await findClient(w)
    const expected = {
      username: 'alice', customerId: 'client-1', customerName: 'Алиса', notes: null, orderId: null, inviteBanId: null, discountBlock: null, telegramId: '7011',
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

  it('emits chat action for the Telegram dialog (available without an order)', async () => {
    const w = await setup()
    await findClient(w)
    const chat = w.get('[data-test="customer-hub-chat"]')
    expect(chat.attributes('disabled')).toBeUndefined()
    expect(chat.text()).toContain('Написать в Telegram')
    await chat.trigger('click')
    expect(w.emitted('action')?.at(-1)).toEqual(['chat', {
      username: 'alice', customerId: 'client-1', customerName: 'Алиса', notes: null, orderId: null, inviteBanId: null, discountBlock: null, telegramId: '7011',
    }])
    // Хаб не закрывается: переход в TG — не модалка.
    expect(w.emitted('close')).toBeUndefined()
  })

  it('carries notes and order context into the note action', async () => {
    api.fetchCustomerHub.mockResolvedValue(hubPayload({
      customer: { ...hubPayload().customer, notes: 'Перезвонить' },
    }))
    const w = await setup({ prefill: { username: 'alice', customerId: 'client-1', orderId: 'order-1' } })
    await w.get('[data-test="customer-hub-note"]').trigger('click')
    expect(w.emitted('action')?.at(-1)).toEqual(['note', {
      username: 'alice', customerId: 'client-1', customerName: 'Алиса', notes: 'Перезвонить', orderId: 'order-1', inviteBanId: null, discountBlock: null, telegramId: '7011',
    }])
  })

  it('allows re-blocking (replace) when a block exists and offers lifting the invite ban', async () => {
    api.fetchCustomerHub.mockResolvedValue(hubPayload({
      block: { id: 'b1', kind: 'active', block_until: null, reason: null, blocked_at: null, blocked_by: null },
      invite_ban: { id: 'ib1', reason: null, banned_by: null, banned_at: null },
    }))
    const w = await setup()
    await findClient(w)
    // Перебан доступен и на заблокированном клиенте (replace на сервере).
    expect(w.get('[data-test="customer-hub-block"]').attributes('disabled')).toBeUndefined()
    expect(w.get('[data-test="customer-hub-block"]').text()).toContain('Изменить блокировку')
    await w.get('[data-test="customer-hub-block"]').trigger('click')
    expect(w.emitted('action')?.at(-1)).toEqual(['block', {
      username: 'alice', customerId: 'client-1', customerName: 'Алиса', notes: null, orderId: null, inviteBanId: 'ib1', discountBlock: null, telegramId: '7011',
    }])
    // Действующий запрет — не мёртвая строка: её можно снять прямо из хаба.
    expect(w.find('[data-test="customer-hub-invite-ban"]').exists()).toBe(false)
    const unban = w.get('[data-test="customer-hub-invite-unban"]')
    expect(unban.attributes('disabled')).toBeUndefined()
    expect(unban.text()).toContain('Разрешить приглашать')
    await unban.trigger('click')
    expect(w.emitted('action')?.at(-1)).toEqual(['remove-invite-ban', {
      username: 'alice', customerId: 'client-1', customerName: 'Алиса', notes: null, orderId: null, inviteBanId: 'ib1', discountBlock: null, telegramId: '7011',
    }])
  })

  it('orders actions: work first, restrictions after a separator; only blocking is bright red', async () => {
    const w = await setup()
    await findClient(w)
    const actions = w.get('[data-test="customer-hub-actions"]')
    const order = actions.findAll('[data-test]').map((el) => el.attributes('data-test'))
    const idx = (t: string) => order.indexOf(t)
    expect(idx('customer-hub-chat')).toBeLessThan(idx('customer-hub-note'))
    expect(idx('customer-hub-note')).toBeLessThan(idx('customer-hub-wholesale'))
    expect(idx('customer-hub-wholesale')).toBeLessThan(idx('customer-hub-block'))
    expect(idx('customer-hub-block')).toBeLessThan(idx('customer-hub-invite-ban'))
    expect(idx('customer-hub-invite-ban')).toBeLessThan(idx('customer-hub-discount-block'))
    const sep = actions.get('.crm-hub-actions-sep').element
    const block = actions.get('[data-test="customer-hub-block"]')
    expect(sep.compareDocumentPosition(block.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(block.classes()).toContain('crm-hub-action--danger')
    for (const t of ['customer-hub-invite-ban', 'customer-hub-discount-block']) {
      const el = actions.get(`[data-test="${t}"]`)
      expect(el.classes()).toContain('crm-hub-action--soft-danger')
      expect(el.classes()).not.toContain('crm-hub-action--danger')
    }
    expect(actions.get('[data-test="customer-hub-note"]').text()).toContain('Добавить заметку')
  })

  it('shows no note card without a note', async () => {
    const w = await setup()
    await findClient(w)
    expect(w.find('[data-test="customer-hub-note-card"]').exists()).toBe(false)
  })

  it('shows an existing note in the right column and edits it via the note action', async () => {
    api.fetchCustomerHub.mockResolvedValue(hubPayload({
      customer: { ...hubPayload().customer, notes: 'Перезвонить\nпосле 18:00' },
    }))
    const w = await setup()
    await findClient(w)
    const card = w.get('[data-test="customer-hub-note-card"]')
    expect(card.get('[data-test="customer-hub-note-text"]').text()).toContain('после 18:00')
    expect(w.get('[data-test="customer-hub-note"]').text()).toContain('Изменить заметку')
    await card.get('[data-test="customer-hub-note-edit"]').trigger('click')
    expect(w.emitted('action')?.at(-1)?.[0]).toBe('note')
    expect((w.emitted('action')?.at(-1)?.[1] as { notes: string }).notes).toBe('Перезвонить\nпосле 18:00')
  })

  it('asks to find the inviter when the hub has none', async () => {
    const w = await setup()
    await findClient(w)
    expect(w.find('[data-test="customer-hub-inviter-panel"]').exists()).toBe(false)
    expect(w.get('[data-test="customer-hub-inviter-line"]').text()).toBe('Пригласивший не указан')
    await w.get('[data-test="customer-hub-inviter"]').trigger('click')
    expect(w.emitted('action')?.at(-1)?.[0]).toBe('find-inviter')
  })

  it('shows the inviter in one line with the invite date and does not repeat it in the auth source', async () => {
    api.fetchCustomerHub.mockResolvedValue(hubPayload({
      authorization: authorization({ authorized_at: '2026-10-12 10:00:00' }),
      inviter: { customer_id: 'inviter-9', username: 'boss', first_name: 'Иван', last_name: null, invite_ban_id: null, is_invite_banned: false, invited_at: '2026-10-12 10:00:00' },
    }))
    const w = await setup()
    await findClient(w)
    const line = w.get('[data-test="customer-hub-inviter-line"]').text()
    expect(line).toContain('Пригласил')
    expect(line).toContain('@boss')
    expect(line).toContain('12.10.2026')
    const details = w.get('[data-test="customer-hub-auth-details"]')
    expect(details.element.tagName).toBe('DETAILS')
    expect(details.attributes('open')).toBeUndefined()
    expect(details.get('[data-test="customer-hub-auth-source"]').text()).toContain('По приглашению')
    expect(details.get('[data-test="customer-hub-auth-source"]').text()).not.toContain('@boss')
    expect(w.get('[data-test="customer-hub-access"]').text().match(/@boss/g)).toHaveLength(1)
  })

  it('expands the inviter panel and emits inviter actions with the inviter', async () => {
    api.fetchCustomerHub.mockResolvedValue(hubPayload({
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
    api.fetchCustomerHub.mockResolvedValue(hubPayload({
      inviter: { customer_id: 'inviter-9', username: 'boss', first_name: null, last_name: null, invite_ban_id: 'ban-1', is_invite_banned: true },
    }))
    const w = await setup()
    await findClient(w)
    await w.get('[data-test="customer-hub-inviter"]').trigger('click')
    const panel = w.get('[data-test="customer-hub-inviter-panel"]')
    await panel.get('.crm-hub-inviter-actions button:nth-of-type(4)').trigger('click')
    expect(w.emitted('inviter-action')?.at(-1)?.[0]).toBe('remove-ban')
  })

  it('closes via the modal close and keeps only «Другой клиент» in the toolbar', async () => {
    const w = await setup()
    await findClient(w)
    const buttons = w.findAll('.crm-note-secondary')
    expect(buttons.map((b) => b.text())).toEqual(['Другой клиент'])
    w.findComponent({ name: 'AdminModal' }).vm.$emit('close')
    await flushPromises()
    expect(w.emitted('close')).toHaveLength(1)
  })
})

const ghostPayload = (overrides: Record<string, unknown> = {}) => hubPayload({
  ghost: true,
  customer: null,
  username: 'newbie',
  telegram_id: null,
  authorization: authorization({ is_authorized: false, source: null }),
  tiers: [],
  ...overrides,
})

describe('CustomerHubModal: ghost (not in the database)', () => {
  it('searches by Telegram ID or username and shows a ghost card without customer actions', async () => {
    api.fetchCustomerHub.mockResolvedValue(ghostPayload())
    const w = await setup()
    await findClient(w, '@newbie')
    expect(api.fetchCustomerHub).toHaveBeenCalledWith('newbie')
    expect(w.get('[data-test="customer-hub-name"]').text()).toBe('Нет в базе')
    expect(w.find('[data-test="customer-hub-card"]').exists()).toBe(false)
    expect(w.find('[data-test="customer-hub-note"]').exists()).toBe(false)
    expect(w.find('[data-test="customer-hub-wholesale"]').exists()).toBe(false)
    expect(w.find('[data-test="customer-hub-inviter"]').exists()).toBe(false)
    expect(w.find('[data-test="customer-hub-stats"]').exists()).toBe(false)
    // Модерация доступна и «призраку»: блок и запрет приглашать — в «Действиях».
    const actions = w.get('[data-test="customer-hub-actions"]')
    expect(actions.find('[data-test="customer-hub-block"]').exists()).toBe(true)
    expect(actions.find('[data-test="customer-hub-invite-ban"]').exists()).toBe(true)
    expect(w.emitted('customer-found')).toEqual([[{ username: 'newbie', customerId: null, customerName: null }]])
  })

  it('blocks a ghost by username and asks the parent with a null customer id', async () => {
    api.fetchCustomerHub.mockResolvedValue(ghostPayload())
    const w = await setup()
    await findClient(w, 'newbie')
    await w.get('[data-test="customer-hub-block"]').trigger('click')
    expect(w.emitted('action')?.at(-1)).toEqual(['block', expect.objectContaining({ username: 'newbie', customerId: null })])
  })

  it('creates a deferred staff access for a ghost after an inline confirm', async () => {
    api.fetchCustomerHub.mockResolvedValue(ghostPayload())
    const w = await setup()
    await findClient(w, 'newbie')
    await w.get('[data-test="customer-hub-grant-access"]').trigger('click')
    expect(api.grantStaffAccess).not.toHaveBeenCalled()
    api.fetchCustomerHub.mockResolvedValue(ghostPayload({
      authorization: authorization({ is_authorized: false, source: null, staff_access: { active: false, permanent: false, pending_id: 5 } }),
    }))
    await w.get('[data-test="customer-hub-auth-confirm-yes"]').trigger('click')
    await flushPromises()
    expect(api.grantStaffAccess).toHaveBeenCalledWith({ customerId: null, username: 'newbie' })
    expect(w.emitted('notify')?.at(-1)?.[0]).toMatchObject({ ok: true })
    expect(w.find('[data-test="customer-hub-revoke-pending-access"]').exists()).toBe(true)
  })
})

describe('CustomerHubModal: block, authorization and invites', () => {
  const authBlocked = () => hubPayload({
    block: { id: 'b1', kind: 'active', block_type: 'authorization_failed', block_until: null, reason: null, blocked_at: null, blocked_by: null },
    authorization: authorization({
      is_authorized: false, source: null,
      state: { status: 'blocked', attempts_used: 3, max_attempts: 3, last_error_code: 'inviter_not_found', last_username: null, blocked_at: null },
    }),
  })

  it('unblocks only after an inline confirm, then reloads the hub', async () => {
    api.fetchCustomerHub.mockResolvedValueOnce(authBlocked())
    const w = await setup()
    await findClient(w)
    await w.get('[data-test="customer-hub-unblock"]').trigger('click')
    expect(api.removeBlock).not.toHaveBeenCalled()
    expect(w.get('[data-test="customer-hub-unblock-confirm"]').text()).toContain('3 новые попытки')
    api.fetchCustomerHub.mockResolvedValueOnce(hubPayload())
    await w.get('[data-test="customer-hub-unblock-confirm-yes"]').trigger('click')
    await flushPromises()
    expect(api.removeBlock).toHaveBeenCalledWith('b1')
    expect(w.find('[data-test="customer-hub-block-badge"]').exists()).toBe(false)
    expect(w.emitted('notify')?.at(-1)).toEqual([{ ok: true, message: '@alice разблокирован' }])
  })

  it('cancels a preventive ban', async () => {
    api.fetchCustomerHub.mockResolvedValueOnce(hubPayload({
      block: { id: 'p1', kind: 'pending', block_until: null, reason: null, blocked_at: null, blocked_by: null },
    }))
    const w = await setup()
    await findClient(w)
    expect(w.get('[data-test="customer-hub-unblock"]').text()).toBe('Отменить превентивный бан')
    await w.get('[data-test="customer-hub-unblock"]').trigger('click')
    await w.get('[data-test="customer-hub-unblock-confirm-yes"]').trigger('click')
    await flushPromises()
    expect(api.removeBlock).toHaveBeenCalledWith('p1')
  })

  it('shows an error and keeps the hub when the action fails', async () => {
    api.fetchCustomerHub.mockResolvedValue(authBlocked())
    api.removeBlock.mockRejectedValueOnce({ code: 'not_found' })
    const w = await setup()
    await findClient(w)
    await w.get('[data-test="customer-hub-unblock"]').trigger('click')
    await w.get('[data-test="customer-hub-unblock-confirm-yes"]').trigger('click')
    await flushPromises()
    expect(w.get('[role="alert"]').text()).toContain('Запись уже удалена')
    expect(w.emitted('notify')?.at(-1)?.[0]).toMatchObject({ ok: false })
    expect(w.find('[data-test="customer-hub-name"]').exists()).toBe(true)
  })

  it('disables revoking a permanent staff access with an explanation', async () => {
    api.fetchCustomerHub.mockResolvedValue(hubPayload({
      authorization: authorization({ source: 'staff', staff_access: { active: true, permanent: true, pending_id: null } }),
    }))
    const w = await setup()
    await findClient(w)
    expect(w.get('[data-test="customer-hub-revoke-access"]').attributes('disabled')).toBeDefined()
    expect(w.get('[data-test="customer-hub-access-permanent"]').text()).toContain('Доступ постоянный')
  })

  it('revokes a temporary staff access after a confirm', async () => {
    api.fetchCustomerHub.mockResolvedValue(hubPayload({
      authorization: authorization({ source: 'staff', staff_access: { active: true, permanent: false, pending_id: null } }),
    }))
    const w = await setup()
    await findClient(w)
    await w.get('[data-test="customer-hub-revoke-access"]').trigger('click')
    await w.get('[data-test="customer-hub-auth-confirm-yes"]').trigger('click')
    await flushPromises()
    expect(api.revokeStaffAccess).toHaveBeenCalledWith('client-1')
  })

  it('has no «Наш аккаунт» switch — it lives in the «Списки» tab', async () => {
    api.fetchCustomerHub.mockResolvedValue(hubPayload({ authorization: authorization({ is_reserved_inviter: true }) }))
    const w = await setup()
    await findClient(w)
    expect(w.find('[data-test="customer-hub-reserved-toggle"]').exists()).toBe(false)
    expect(w.find('[data-test="customer-hub-convert-reserved"]').exists()).toBe(false)
    expect(w.get('[data-test="customer-hub-auth-section"]').text()).not.toContain('Наш аккаунт')
  })

  it('shows the «authorization is off» callout and recent orders', async () => {
    api.fetchCustomerHub.mockResolvedValue(hubPayload({
      authorization: authorization({ feature_enabled: false }),
      recent_orders: [{ id: 'o1', order_number: 41, created_at: '2026-10-01 10:00:00', status: 'completed', amount: 12.5 }],
    }))
    const w = await setup()
    await findClient(w)
    expect(w.find('[data-test="customer-hub-auth-disabled"]').exists()).toBe(true)
    expect(w.get('[data-test="customer-hub-recent-orders"]').text()).toContain('№41')
  })

  const order = (n: number) => ({ id: `o${n}`, order_number: n, created_at: '2026-10-01 10:00:00', status: 'delivered', amount: 10 })
  const statsWith = (overrides: Record<string, unknown> = {}) => ({
    orders_total: 0, orders_active: 0, orders_delivered: 0, orders_cancelled: 0, total_spent: 0, average_check: 0,
    first_order_at: null, last_order_at: null, invited_total: 0, invited_with_orders: 0, favorite_product: null,
    ...overrides,
  })

  it('shows the recent orders and opens the clicked one', async () => {
    api.fetchCustomerHub.mockResolvedValue(hubPayload({ recent_orders: [41, 40, 39, 38, 37].map(order), stats: statsWith({ orders_total: 5 }) }))
    const w = await setup()
    await findClient(w)
    const rows = w.findAll('[data-test="customer-hub-open-order"]')
    expect(rows).toHaveLength(5)
    // Все заказы уже на экране — ссылки на историю нет.
    expect(w.find('[data-test="customer-hub-orders-history"]').exists()).toBe(false)
    await rows[1].trigger('click')
    expect(w.emitted('open-order')?.at(-1)).toEqual(['o40'])
  })

  it('expands the full history inside the card and collapses it back', async () => {
    api.fetchCustomerHub.mockResolvedValue(hubPayload({ recent_orders: [41, 40, 39, 38, 37].map(order), stats: statsWith({ orders_total: 8 }) }))
    api.fetchCustomerOrders.mockResolvedValue({ orders: [41, 40, 39, 38, 37, 36, 35, 34].map(order) })
    const w = await setup()
    await findClient(w)
    const more = w.get('[data-test="customer-hub-orders-history"]')
    expect(more.text()).toBe('Вся история · 8 заказов')
    await more.trigger('click')
    await flushPromises()
    expect(api.fetchCustomerOrders).toHaveBeenCalledWith('client-1')
    expect(w.findAll('[data-test="customer-hub-open-order"]')).toHaveLength(8)
    expect(w.get('.crm-hub-orders').classes()).toContain('is-history')
    await w.findAll('[data-test="customer-hub-open-order"]')[7].trigger('click')
    expect(w.emitted('open-order')?.at(-1)).toEqual(['o34'])
    await w.get('[data-test="customer-hub-orders-collapse"]').trigger('click')
    expect(w.findAll('[data-test="customer-hub-open-order"]')).toHaveLength(5)
  })

  it('shows a load error for the history and keeps the recent orders', async () => {
    api.fetchCustomerHub.mockResolvedValue(hubPayload({ recent_orders: [41, 40, 39, 38, 37].map(order), stats: statsWith({ orders_total: 8 }) }))
    api.fetchCustomerOrders.mockRejectedValue({ code: 'network' })
    const w = await setup()
    await findClient(w)
    await w.get('[data-test="customer-hub-orders-history"]').trigger('click')
    await flushPromises()
    const block = w.get('[data-test="customer-hub-recent-orders"]')
    expect(block.find('[role="alert"]').exists()).toBe(true)
    expect(block.findAll('[data-test="customer-hub-open-order"]')).toHaveLength(5)
  })

  it('shows a compact empty state without orders', async () => {
    api.fetchCustomerHub.mockResolvedValue(hubPayload({ recent_orders: [], stats: statsWith() }))
    const w = await setup()
    await findClient(w)
    const block = w.get('[data-test="customer-hub-recent-orders"]')
    expect(block.text()).toContain('Заказов пока нет.')
    expect(block.find('[data-test="customer-hub-orders-history"]').exists()).toBe(false)
    expect(w.get('[data-test="customer-hub-stat-average"]').text()).toBeTruthy()
    expect(w.get('[data-test="customer-hub-stats"]').text()).toContain('нет выданных заказов')
  })

  it('renders the customer stats block', async () => {
    api.fetchCustomerHub.mockResolvedValue(hubPayload({
      stats: {
        orders_total: 7, orders_active: 2,
        orders_delivered: 4, orders_cancelled: 1, total_spent: 200, average_check: 50,
        first_order_at: '2025-03-01 10:00:00', last_order_at: '2026-10-01 10:00:00',
        invited_total: 3, invited_with_orders: 2, favorite_product: { title: 'Жидкость Б', quantity: 7 },
      },
    }))
    const w = await setup()
    await findClient(w)
    const stats = w.get('[data-test="customer-hub-stats"]')
    expect(w.get('[data-test="customer-hub-stat-average"]').text()).toContain('50')
    expect(w.get('[data-test="customer-hub-stat-spent"]').text()).toContain('200')
    // «Всего» — все заказы клиента, ниже — разбивка по реальным статусам.
    expect(w.get('[data-test="customer-hub-stat-orders"]').text()).toBe('7')
    expect(stats.text()).toContain('Заказов всего')
    const breakdown = w.get('[data-test="customer-hub-stat-orders-breakdown"]').text()
    expect(breakdown).toContain('Выдано — 4')
    expect(breakdown).toContain('Отменено — 1')
    expect(breakdown).toContain('В работе — 2')
    expect(stats.text()).toContain('по 4 выданным заказам')
    expect(w.get('[data-test="customer-hub-stat-invited"]').text()).toBe('3')
    expect(stats.text()).toContain('2 с покупками')
    expect(w.get('[data-test="customer-hub-stat-favorite"]').text()).toContain('Жидкость Б')
  })

  it('keeps block and invite-ban in «Действия» and shows block details above the columns', async () => {
    api.fetchCustomerHub.mockResolvedValue(hubPayload({
      block: { id: 'b1', kind: 'active', block_type: 'manual', block_until: null, reason: 'Спам', blocked_at: null, blocked_by: 'admin' },
    }))
    const w = await setup()
    await findClient(w)
    const actions = w.get('[data-test="customer-hub-actions"]')
    expect(actions.find('[data-test="customer-hub-unblock"]').exists()).toBe(true)
    expect(actions.find('[data-test="customer-hub-invite-ban"]').exists()).toBe(true)
    expect(w.find('[data-test="customer-hub-block-section"]').exists()).toBe(false)
    const notice = w.get('.crm-hub-notices [data-test="customer-hub-block-notice"]')
    expect(w.find('.crm-hub-layout [data-test="customer-hub-block-notice"]').exists()).toBe(false)
    expect(notice.text()).toContain('Спам')
    expect(notice.text()).toContain('бессрочно')
    expect(notice.text()).toContain('admin')
  })
})

describe('CustomerHubModal: lists tab', () => {
  const page = (items: unknown[], total: number, offset = 0) => ({ items, total, limit: 20, offset })
  const blockedRow = (n: number) => ({ kind: 'active', id: `b${n}`, username: `user_${n}`, telegram_username: `user_${n}`, block_type: 'manual', reason: 'Спам', date: '2026-10-01 10:00:00' })

  async function openLists() {
    const w = await setup()
    await w.get('[data-test="customer-hub-tab-lists"]').trigger('click')
    await flushPromises()
    return w
  }

  it('loads counts and the first page lazily with limit 20', async () => {
    api.fetchCustomerList.mockResolvedValueOnce(page([blockedRow(1)], 1))
    const w = await openLists()
    expect(api.fetchCustomerListCounts).toHaveBeenCalledTimes(1)
    expect(api.fetchCustomerList).toHaveBeenCalledTimes(1)
    expect(api.fetchCustomerList).toHaveBeenCalledWith('blocked', expect.objectContaining({ limit: 20, offset: 0 }))
    expect(w.get('[data-test="customer-hub-chip-count-reserved"]').text()).toBe('3')
    expect(w.findAll('.crm-hub-row')).toHaveLength(1)
    // Другие списки не грузятся, пока чип не выбран.
    await w.get('[data-test="customer-hub-chip-invite_bans"]').trigger('click')
    await flushPromises()
    expect(api.fetchCustomerList).toHaveBeenLastCalledWith('invite_bans', expect.objectContaining({ offset: 0 }))
  })

  it('appends the next page via «Ещё»', async () => {
    api.fetchCustomerList.mockResolvedValueOnce(page([blockedRow(1)], 2))
    api.fetchCustomerList.mockResolvedValueOnce(page([blockedRow(2)], 2, 1))
    const w = await openLists()
    await w.get('[data-test="customer-hub-list-more"]').trigger('click')
    await flushPromises()
    expect(api.fetchCustomerList).toHaveBeenLastCalledWith('blocked', expect.objectContaining({ offset: 1 }))
    expect(w.findAll('.crm-hub-row')).toHaveLength(2)
    expect(w.find('[data-test="customer-hub-list-more"]').exists()).toBe(false)
  })

  it('opens the client from a row', async () => {
    api.fetchCustomerList.mockResolvedValueOnce(page([blockedRow(1)], 1))
    const w = await openLists()
    await w.get('[data-test="customer-hub-row-open"]').trigger('click')
    await flushPromises()
    expect(api.fetchCustomerHub).toHaveBeenCalledWith('user_1')
    expect(w.find('[data-test="customer-hub-name"]').exists()).toBe(true)
  })

  it('unblocks a row inline after a confirm and removes it', async () => {
    api.fetchCustomerList.mockResolvedValueOnce(page([blockedRow(1)], 1))
    const w = await openLists()
    await w.get('[data-test="customer-hub-row-action"]').trigger('click')
    expect(api.removeBlock).not.toHaveBeenCalled()
    await w.get('[data-test="customer-hub-row-confirm"]').trigger('click')
    await flushPromises()
    expect(api.removeBlock).toHaveBeenCalledWith('b1')
    expect(w.findAll('.crm-hub-row')).toHaveLength(0)
    expect(api.fetchCustomerListCounts).toHaveBeenCalledTimes(2)
  })

  it('validates bulk-add usernames for «Наши аккаунты»', async () => {
    const w = await openLists()
    await w.get('[data-test="customer-hub-chip-reserved"]').trigger('click')
    await flushPromises()
    await w.get('#customer-hub-reserved-input').setValue('@ok_name1, bad')
    await w.get('[data-test="customer-hub-reserved-form"]').trigger('submit')
    await flushPromises()
    expect(api.addReservedUsernames).not.toHaveBeenCalled()
    expect(w.get('[data-test="customer-hub-reserved-form"] [role="alert"]').text()).toContain('Некорректные')
    await w.get('#customer-hub-reserved-input').setValue('@good_name1 @good_name2')
    await w.get('[data-test="customer-hub-reserved-form"]').trigger('submit')
    await flushPromises()
    expect(api.addReservedUsernames).toHaveBeenCalledWith(['good_name1', 'good_name2'])
  })
})
