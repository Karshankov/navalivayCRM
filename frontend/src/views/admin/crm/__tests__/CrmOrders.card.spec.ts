import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent } from 'vue';
import CrmOrders from '@/views/admin/crm/CrmOrders.vue';
import { useCrmStore, type Order, type OrderItem } from '@/stores/crm';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));

const ModalStub = defineComponent({
  name: 'AdminModal',
  props: ['isOpen', 'title', 'isLoading', 'isConfirmDisabled'],
  emits: ['close', 'confirm'],
  template: `<section v-if="isOpen" data-test="existing-modal"><h2>{{ title }}</h2><slot /><slot name="footer" /><button data-test="modal-confirm" :disabled="isLoading || isConfirmDisabled" @click="$emit('confirm')">Подтвердить</button></section>`,
});
const ActionsStub = defineComponent({
  name: 'CustomerActionsModal',
  props: ['isOpen', 'order', 'busy'],
  emits: ['close', 'action', 'inviter-action', 'after-leave'],
  template: '<div v-if="isOpen" data-test="customer-actions-modal" />',
});

const LookupStub = defineComponent({
  name: 'FindInviterModal', props: ['isOpen', 'busy'], emits: ['close', 'action', 'after-leave'],
  template: '<div v-if="isOpen" data-test="find-inviter-modal" />',
});

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1', order_number: 1001, customer_id: 'customer-1', employee_id: null,
    status: 'new', delivery_type: 'pickup', delivery_address: null,
    total_amount: 120, discount_amount: 10, discount_percent: 0, final_amount: 110,
    profit: 30, notes: 'Комментарий заказа', customer_notes: 'Важная заметка клиента',
    customer_name: 'Дима', telegram_username: 'real_customer', customer_telegram_id: '12345',
    created_at: '2026-07-23T07:00:00.000Z', updated_at: '2026-07-23T07:00:00.000Z',
    completed_at: null, pickup_cell_number: 37, payment_type: 'card',
    is_returning_customer: false, needs_manager_action: 0,
    referral: { invitee_customer_id: 'customer-1', inviter_customer_id: 'inviter-9',
      inviter_username: 'different_inviter', inviter_first_name: 'Иван', inviter_last_name: null,
      inviter_invite_ban_id: null, inviter_is_invite_banned: 0 },
    items: Array.from({ length: 6 }, (_, index) => ({
      id: `item-${index}`, order_id: 'order-1', product_id: `product-${index}`,
      product_title: `Товар ${index + 1}`, variant_name: `Вариант ${index + 1}`,
      quantity: index + 1, price_per_unit: 20, cost_per_unit: 10,
      discount_amount: 0, total_price: 20 * (index + 1), total_cost: 10 * (index + 1),
    } satisfies OrderItem)),
    ...overrides,
  };
}

let wrapper: VueWrapper | undefined;
async function setup(order = makeOrder()) {
  const store = useCrmStore();
  store.orders = [order];
  vi.spyOn(store, 'fetchKanbanBoard').mockResolvedValue(undefined as never);
  vi.spyOn(store, 'fetchPickupCells').mockResolvedValue(undefined as never);
  vi.spyOn(store, 'fetchCashAccounts').mockResolvedValue(undefined as never);
  vi.spyOn(store, 'unlockAudioContext').mockImplementation(() => {});
  wrapper = mount(CrmOrders, {
    global: { stubs: {
      AdminModal: ModalStub, CustomerActionsModal: ActionsStub, FindInviterModal: LookupStub,
      CustomerBlockModal: true, CustomerNoteModal: true, CustomerInviteBanModal: true,
      OrderCreateModal: true, CardPaymentsModal: true,
      StaffShiftBar: { template: '<section data-test="staff-shift-bar"><slot name="financial-close" /></section>' },
      StaffCurrentActorBadge: true, CrmProfitPasswordField: true, CrmButton: true,
      ManagerActionSummary: true,
    } },
  });
  await flushPromises();
  return { store, wrapper };
}
function buttonByText(text: string) {
  const button = wrapper!.findAll('button').find((item) => item.text() === text);
  expect(button, `button ${text}`).toBeDefined();
  return button!;
}
async function chooseAction(action: string) {
  await wrapper!.get('[data-test="order-customer-actions"]').trigger('click');
  const modal = wrapper!.findComponent(ActionsStub);
  expect(modal.props('isOpen')).toBe(true);
  modal.vm.$emit('action', action);
  await flushPromises();
  expect(modal.props('isOpen')).toBe(false);
  modal.vm.$emit('after-leave');
  await flushPromises();
}

beforeEach(() => {
  setActivePinia(createPinia());
  push.mockReset();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ userbot_connected: true }), { status: 200 })));
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('CrmOrders: toolbar inviter lookup', () => {
  it('renders financial closing once inside the staff header, not the order toolbar', async () => {
    await setup();
    expect(wrapper!.findAll('[data-test="orders-financial-close"]')).toHaveLength(1);
    const financialButton = wrapper!.get('[data-test="orders-financial-close"]');
    expect(financialButton.classes()).toContain('crm-reference-button--danger');
    expect(financialButton.classes()).not.toContain('crm-reference-button--gray');
    expect(wrapper!.get('[data-test="orders-block"]').classes()).toContain('crm-reference-button--danger');
    expect(wrapper!.get('[data-test="staff-shift-bar"]').find('[data-test="orders-financial-close"]').exists()).toBe(true);
    expect(wrapper!.get('.crm-orders-toolbar').find('[data-test="orders-financial-close"]').exists()).toBe(false);
  });
  it('keeps the lookup icon at the same small size as the customer note icon', async () => {
    await setup();
    await wrapper!.get('[data-test="orders-actions-toggle"]').trigger('click');
    const icon = wrapper!.get('[data-test="orders-find-inviter"] svg');
    expect(icon.attributes('width')).toBe('16');
    expect(icon.attributes('height')).toBe('16');
    expect(icon.classes()).toEqual(expect.arrayContaining(['h-4', 'w-4', 'shrink-0']));
  });
  const result = () => ({
    customer: { id: 'off-board-customer', telegram_username: 'off_board', first_name: 'Клиент', last_name: null },
    referral: { ...makeOrder().referral!, invitee_customer_id: 'off-board-customer' },
  });
  async function openLookup() {
    const context = await setup();
    context.store.orders = [];
    await wrapper!.get('[data-test="orders-actions-toggle"]').trigger('click');
    await wrapper!.get('[data-test="orders-find-inviter"]').trigger('click');
    const lookup = wrapper!.findComponent(LookupStub);
    expect(lookup.props('isOpen')).toBe(true);
    expect(wrapper!.find('#crm-orders-actions').exists()).toBe(false);
    return lookup;
  }
  it('opens from the actions menu even with no orders on the board', async () => { await openLookup(); });
  it('waits for the search dialog to leave before opening the existing block dialog for the inviter', async () => {
    const lookup = await openLookup();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(result()), {status:200}));
    lookup.vm.$emit('action', 'block', result()); await flushPromises();
    expect(lookup.props('isOpen')).toBe(false);
    expect(wrapper!.findComponent({name:'CustomerBlockModal'}).props('isOpen')).toBe(false);
    lookup.vm.$emit('after-leave'); await flushPromises();
    const block = wrapper!.findComponent({name:'CustomerBlockModal'});
    expect(block.props('isOpen')).toBe(true);
    expect(block.props('customerId')).toBe('inviter-9');
    expect(block.props('prefillUsername')).toBe('different_inviter');
  });
  it('rejects a changed inviter before opening an action', async () => {
    const lookup = await openLookup();
    const changed = result(); changed.referral.inviter_customer_id = 'replacement';
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(changed), {status:200}));
    lookup.vm.$emit('action', 'block', result()); await flushPromises();
    lookup.vm.$emit('after-leave'); await flushPromises();
    expect(wrapper!.findComponent({name:'CustomerBlockModal'}).props('isOpen')).toBe(false);
    expect(wrapper!.text()).toContain('Пригласивший изменился');
  });
  it('cancels a queued action on explicit close', async () => {
    const lookup = await openLookup();
    lookup.vm.$emit('action', 'block', result()); lookup.vm.$emit('close');
    await flushPromises(); lookup.vm.$emit('after-leave'); await flushPromises();
    expect(wrapper!.findComponent({name:'CustomerBlockModal'}).props('isOpen')).toBe(false);
  });
  it('reuses the message dialog with the inviter rather than the searched customer', async () => {
    const lookup = await openLookup();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(result()), {status:200}));
    lookup.vm.$emit('action', 'message', result()); await flushPromises();
    lookup.vm.$emit('after-leave'); await flushPromises();
    const message = wrapper!.findAllComponents(ModalStub).find(m=>m.props('title')==='Написать пригласившему')!;
    expect(message.props('isOpen')).toBe(true);
    await message.get('textarea').setValue('Тест');
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ok:true}), {status:200}));
    await message.get('form').trigger('submit'); await flushPromises();
    const call = vi.mocked(fetch).mock.calls.find(([url])=>url==='/api/admin/crm/bot/send-custom')!;
    expect(JSON.parse(String(call[1]?.body))).toEqual({customer_id:'inviter-9',text:'Тест'});
  });
});

describe('CrmOrders: redesign preserves order-card behavior', () => {
  async function setupCardLimit(remaining = 5500, daily = 10000) {
    const { getBusinessDateParts } = await import('@/utils/businessTime');
    const { year, month, day } = getBusinessDateParts();
    const business_date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const store = useCrmStore();
    store.cardPaymentAdminSnapshot = {
      limits: { business_date, daily_limit_minor: daily, remaining_today_minor: remaining },
      accounts: [], pending_accounts: [], tariffs: [], requests: [], operations: [],
    } as NonNullable<typeof store.cardPaymentAdminSnapshot>;
    const fetchLimits = vi.spyOn(store, 'fetchCardPaymentAdmin').mockResolvedValue(store.cardPaymentAdminSnapshot);
    return { ...await setup(), fetchLimits };
  }

  it('places the card allowance immediately after order actions and displays the server remainder', async () => {
    const { wrapper } = await setupCardLimit();
    const indicator = wrapper.get('[data-test="orders-card-limit"]');
    expect(indicator.element.previousElementSibling).toBe(wrapper.get('[data-test="orders-actions-toggle"]').element.parentElement);
    expect(indicator.get('[data-test="orders-card-limit-remaining"]').text().replace(/\s/g, '')).toBe('55,00BYN');
    expect(indicator.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('55');
    expect(indicator.text()).toContain('осталось');
    await indicator.trigger('click');
    expect(wrapper.findComponent({ name: 'CardPaymentsModal' }).props('isOpen')).toBe(true);
  });

  it('shows only new limit requests and does not clear the badge when they are viewed', async () => {
    const { store, wrapper } = await setupCardLimit();
    store.cardPaymentAdminSnapshot = {
      ...store.cardPaymentAdminSnapshot!,
      requests: [
        { id: 'request-1', status: 'new' },
        { id: 'request-2', status: 'new' },
        { id: 'request-approved', status: 'approved' },
        { id: 'request-rejected', status: 'rejected' },
      ] as NonNullable<typeof store.cardPaymentAdminSnapshot>['requests'],
    };
    await flushPromises();
    const indicator = wrapper.get('[data-test="orders-card-limit"]');
    expect(indicator.get('[data-test="orders-card-limit-request-count"]').text()).toBe('2');
    expect(indicator.classes()).toContain('crm-card-limit--has-requests');
    expect(indicator.attributes('aria-label')).toContain('Новых заявок на увеличение лимита: 2');
    store.markCardRequestsAsSeen();
    await indicator.trigger('click');
    expect(wrapper.findComponent({ name: 'CardPaymentsModal' }).props('isOpen')).toBe(true);
    expect(indicator.get('[data-test="orders-card-limit-request-count"]').text()).toBe('2');
  });

  it('updates the request badge with the shared snapshot and hides it at zero', async () => {
    const { store, wrapper } = await setupCardLimit();
    const indicator = wrapper.get('[data-test="orders-card-limit"]');
    expect(indicator.find('[data-test="orders-card-limit-request-count"]').exists()).toBe(false);
    const setRequests = async (statuses: string[]) => {
      store.cardPaymentAdminSnapshot = {
        ...store.cardPaymentAdminSnapshot!,
        requests: statuses.map((status, index) => ({ id: `request-${index}`, status })) as NonNullable<typeof store.cardPaymentAdminSnapshot>['requests'],
      };
      await flushPromises();
    };
    await setRequests(['new', 'new']);
    expect(indicator.get('[data-test="orders-card-limit-request-count"]').text()).toBe('2');
    await setRequests(['approved', 'new']);
    expect(indicator.get('[data-test="orders-card-limit-request-count"]').text()).toBe('1');
    await setRequests(['approved', 'rejected']);
    expect(indicator.find('[data-test="orders-card-limit-request-count"]').exists()).toBe(false);
    expect(indicator.classes()).not.toContain('crm-card-limit--has-requests');
    expect(indicator.attributes('aria-label')).not.toContain('Новых заявок');
    await setRequests(['new']);
    expect(indicator.get('[data-test="orders-card-limit-request-count"]').text()).toBe('1');
    store.cardPaymentAdminSnapshot = null;
    await flushPromises();
    expect(indicator.find('[data-test="orders-card-limit-request-count"]').exists()).toBe(false);
  });

  it('reacts to the same snapshot updated by the existing limits modal', async () => {
    const { store, wrapper } = await setupCardLimit();
    store.cardPaymentAdminSnapshot = {
      ...store.cardPaymentAdminSnapshot!,
      limits: { ...store.cardPaymentAdminSnapshot!.limits, remaining_today_minor: 1234 },
    };
    await flushPromises();
    expect(wrapper.get('[data-test="orders-card-limit-remaining"]').text().replace(/\s/g, '')).toBe('12,34BYN');
    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('12');
  });

  it.each([10000, 0])('shows an exhausted allowance without invalid percentages (daily: %s)', async daily => {
    const { wrapper } = await setupCardLimit(0, daily);
    const indicator = wrapper.get('[data-test="orders-card-limit"]');
    expect(indicator.classes()).toContain('crm-card-limit--exhausted');
    expect(indicator.text()).toContain('Лимит исчерпан');
    expect(indicator.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('0');
    await indicator.trigger('click');
    expect(wrapper.findComponent({ name: 'CardPaymentsModal' }).props('isOpen')).toBe(true);
  });

  it.each([-1, NaN, Infinity])('does not show invalid money as an available allowance (%s)', async remaining => {
    const { wrapper } = await setupCardLimit(remaining);
    expect(wrapper.find('[data-test="orders-card-limit-remaining"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="orders-card-limit"]').text()).toContain('Лимит недоступен');
    expect(wrapper.find('[role="progressbar"]').exists()).toBe(false);
  });

  it('does not present a previous business day snapshot as today', async () => {
    const { store, wrapper } = await setupCardLimit();
    store.cardPaymentAdminSnapshot = {
      ...store.cardPaymentAdminSnapshot!,
      limits: { ...store.cardPaymentAdminSnapshot!.limits, business_date: '2000-01-01' },
    };
    await flushPromises();
    expect(wrapper.find('[data-test="orders-card-limit-remaining"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="orders-card-limit"]').text()).toContain('Лимит недоступен');
  });

  it('distinguishes an initial loading state from a zero remainder', async () => {
    const store = useCrmStore();
    store.loadingCardPaymentAdmin = true;
    vi.spyOn(store, 'fetchCardPaymentAdmin').mockResolvedValue(null as never);
    const { wrapper } = await setup();
    const indicator = wrapper.get('[data-test="orders-card-limit"]');
    expect(indicator.text()).toContain('Загружаем лимит');
    expect(indicator.attributes('aria-busy')).toBe('true');
    expect(indicator.find('[data-test="orders-card-limit-remaining"]').exists()).toBe(false);
    await indicator.trigger('click');
    expect(wrapper.findComponent({ name: 'CardPaymentsModal' }).props('isOpen')).toBe(true);
  });

  it.each([37, null])('keeps order number and creation date in compact 9px metadata (cell: %s)', async (cell) => {
    const { wrapper } = await setup(makeOrder({ pickup_cell_number: cell }));
    const metadata = wrapper.get('[data-test="order-card-metadata"]');
    expect(metadata.get('[data-test="order-number"]').text()).toBe('#1001');
    expect(metadata.get('[data-test="order-created-at"]').text().trim()).not.toBe('');
    expect(wrapper.find('.order-card-status .order-card-number').exists()).toBe(false);
    expect(wrapper.get('[data-test="order-cell"]').text()).toBe(cell ? String(cell) : '#1001');
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/views/admin/crm/CrmOrders.vue', 'utf8');
    const metadataStyles = source.match(/\.order-card-metadata\s*\{([^}]+)\}/)?.[1] || '';
    expect(metadataStyles).toContain('font-size: 9px');
    expect(metadataStyles).toContain('flex-wrap: wrap');
  });

  it('keeps the heading before the reference toolbar and preserves all status columns', async () => {
    const { wrapper } = await setup();
    expect(wrapper.get('.crm-orders-title').text()).toBe('Заказы');
    const content = wrapper.get('.crm-orders-content').element;
    const children = Array.from(content.children);
    expect(children.indexOf(wrapper.get('.crm-orders-heading').element)).toBeLessThan(children.indexOf(wrapper.get('.crm-orders-toolbar').element));
    expect(wrapper.findAll('.crm-orders-column').map(column => column.attributes('data-column'))).toEqual(['action_required', 'new', 'in_progress']);
    expect(wrapper.find('#crm-orders-actions').exists()).toBe(false);
    await wrapper.get('[data-test="orders-actions-toggle"]').trigger('click');
    expect(wrapper.get('#crm-orders-actions').text()).toContain('Ячейки');
    expect(wrapper.get('#crm-orders-actions').text()).toContain('Выданные');
    expect(wrapper.get('#crm-orders-actions').text()).toContain('Заметка на клиента');
    await wrapper.get('#crm-orders-actions').trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('#crm-orders-actions').exists()).toBe(false);
  });

  it('retains creation and blocking from the reference toolbar without immediate writes', async () => {
    const { store, wrapper } = await setup();
    const update = vi.spyOn(store, 'updateOrder');
    await wrapper.get('[data-test="orders-create"]').trigger('click');
    expect(wrapper.findComponent({ name: 'OrderCreateModal' }).props('isOpen')).toBe(true);
    await wrapper.get('[data-test="orders-block"]').trigger('click');
    expect(wrapper.findComponent({ name: 'CustomerBlockModal' }).props('isOpen')).toBe(true);
    expect(update).not.toHaveBeenCalled();
  });

  it('opens the existing customer-note flow from the relocated menu and closes the menu', async () => {
    const { wrapper } = await setup();
    await wrapper.get('[data-test="orders-actions-toggle"]').trigger('click');
    await buttonByText('Заметка на клиента').trigger('click');
    expect(wrapper.find('#crm-orders-actions').exists()).toBe(false);
    expect(wrapper.findComponent({ name: 'CustomerNoteModal' }).props('isOpen')).toBe(true);
  });

  it.each([
    ['new', true], ['new', false], ['new', undefined],
    ['in_progress', true], ['in_progress', false], ['in_progress', undefined],
  ] as const)('shows the compact card-access icon only when allowed (%s, %s)', async (status, enabled) => {
    const { wrapper } = await setup(makeOrder({ status, customer_card_payment_enabled: enabled, payment_type: 'cash' }));
    const identity = wrapper.get('.order-card-client-identity');
    const badge = identity.find('[data-test="order-card-card-access"]');
    expect(badge.exists()).toBe(enabled === true);
    expect(identity.get('[data-test="order-customer-name"]').text()).toBe('Дима');
    if (enabled) {
      expect(badge.element.tagName).toBe('SPAN');
      expect(badge.text()).toBe('');
      expect(badge.attributes('role')).toBe('img');
      expect(badge.attributes('aria-label')).toBe('Клиенту разрешена оплата картой');
      expect(badge.attributes('title')).toBe('Клиенту разрешена оплата картой');
      expect(badge.get('.order-card-card-access-icon').attributes('aria-hidden')).toBe('true');
      expect(badge.find('button').exists()).toBe(false);
    }
    expect(wrapper.find('.order-card-client-flags').exists()).toBe(false);
    expect(wrapper.get('.order-card-payment').text()).toMatch(/налич/i);
  });

  it('keeps blocking visible separately from the card-access icon', async () => {
    const { wrapper } = await setup(makeOrder({ customer_card_payment_enabled: true, is_blocked: true }));
    expect(wrapper.get('.order-card-client-identity [data-test="order-card-card-access"]').exists()).toBe(true);
    expect(wrapper.get('.order-card-client-flags').text()).toContain('Заблокирован');
    expect(wrapper.find('.order-card-first').exists()).toBe(false);
  });

  it('keeps the approved HTML card palette and geometry', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/views/admin/crm/CrmOrders.vue', 'utf8');
    const cardStyles = source.match(/\.order-card\s*\{([^}]+)\}/)?.[1] || '';
    expect(cardStyles).toContain('linear-gradient(100deg, #05b8ff, #185dff)');
    expect(cardStyles).toContain('linear-gradient(115deg, #ff685a, #fa104f)');
    expect(cardStyles).toContain('border-color: #ffc72e');
    expect(cardStyles).toContain('border-width: 1.5px');
    expect(cardStyles).toContain('border-style: solid');
    expect(cardStyles).toContain('padding: 36px 18px 17px');
    expect(cardStyles).toContain('color: #081b4b');
    expect(source).toContain('background: linear-gradient(#f7faff, #e9f0fa)');
    const productToggleStyles = source.match(/\.order-card-products button\s*\{([^}]+)\}/)?.[1] || '';
    expect(productToggleStyles).toContain('color: #819bd0');
  });

  it('keeps the approved HTML customer-actions palette', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/components/admin/crm/CustomerActionsModal.vue', 'utf8');
    expect(source).toContain('backdrop-filter: blur(11px)');
    expect(source).toContain('padding: 23px');
    expect(source).toContain('background: #eaf1ff');
    expect(source).toContain('background: #fff1f3');
    expect(source).toContain('color: #d92342');
    expect(source).toContain('background: #edf5ff');
  });
  it('uses the actual pickup cell, keeps notes, products and a non-clickable customer name', async () => {
    const { wrapper } = await setup();
    expect(wrapper.get('[data-test="order-cell"]').text()).toBe('37');
    const name = wrapper.get('[data-test="order-customer-name"]');
    expect(name.element.tagName).toBe('SPAN');
    await name.trigger('click');
    expect(wrapper.findComponent({ name: 'CustomerBlockModal' }).props('isOpen')).toBe(false);
    expect(wrapper.find('article').text()).toContain('Важная заметка клиента');
    expect(wrapper.find('article').text()).toContain('Комментарий заказа');
    expect(wrapper.find('article').text()).toContain('Товар 1 - Вариант 1');
    expect(wrapper.find('article').text()).toContain('× 4');
    expect(wrapper.find('article').text()).not.toContain('Товар 6');
    await buttonByText('и ещё 2 позиции').trigger('click');
    expect(wrapper.find('article').text()).toContain('Товар 6 - Вариант 6');
    await buttonByText('свернуть').trigger('click');
    expect(wrapper.find('article').text()).not.toContain('Товар 6');
  });

  it('opens the order-cost modal from a semantic total button without saving', async () => {
    const { store, wrapper } = await setup();
    const update = vi.spyOn(store, 'updateOrder');
    const total = wrapper.get('[data-test="order-total"]');
    expect(total.element.tagName).toBe('BUTTON');
    await total.trigger('click');
    expect(wrapper.get('[data-test="existing-modal"] h2').text()).toBe('Стоимость заказа #1001');
    expect(wrapper.get('#order-price-additional').exists()).toBe(true);
    expect(update).not.toHaveBeenCalled();
  });

  function pricedOrder(overrides: Partial<Order> = {}) {
    const order = makeOrder();
    return makeOrder({
      total_amount: 58, final_amount: 58, profit: 18,
      discount_amount: 0, discount_percent: 0, additional_cost: 0,
      items: [{ ...order.items![0], quantity: 1, price_per_unit: 58,
        cost_per_unit: 40, total_price: 58, total_cost: 40 }],
      ...overrides,
    });
  }

  it('previews 58 + 2 = 60 and saves the absolute surcharge with discounts', async () => {
    const { store, wrapper } = await setup(pricedOrder());
    const update = vi.spyOn(store, 'updateOrder').mockResolvedValue(pricedOrder({ additional_cost: 2, final_amount: 60, profit: 20 }));
    await wrapper.get('[data-test="order-total"]').trigger('click');
    await wrapper.get('#order-price-additional').setValue('2');
    expect(wrapper.get('[data-test="order-price-preview"]').text().replace(/\s/g, '')).toBe('60BYN');
    await wrapper.get('[data-test="order-price-form"]').trigger('submit');
    await flushPromises();
    expect(update).toHaveBeenCalledWith('order-1', { discount_amount: 0, discount_percent: 0, additional_cost: 2 });
    expect(wrapper.find('[data-test="order-price-form"]').exists()).toBe(false);
  });

  it('preserves percentage discounts and adds the surcharge after both discounts', async () => {
    const { wrapper } = await setup(pricedOrder({ discount_amount: 8, discount_percent: 10, additional_cost: 2, final_amount: 47 }));
    await wrapper.get('[data-test="order-total"]').trigger('click');
    expect(wrapper.get('[data-test="order-price-preview"]').text().replace(/\s/g, '')).toBe('47BYN');
    expect((wrapper.get('#order-price-additional').element as HTMLInputElement).value).toBe('2');
  });

  it.each(['-1', '1.234', '', '1000000000'])('rejects invalid surcharge %j without a request', async value => {
    const { store, wrapper } = await setup(pricedOrder());
    const update = vi.spyOn(store, 'updateOrder');
    await wrapper.get('[data-test="order-total"]').trigger('click');
    await wrapper.get('#order-price-additional').setValue(value);
    expect((wrapper.get('[data-test="order-price-save"]').element as HTMLButtonElement).disabled).toBe(true);
    expect(wrapper.get('#order-price-validation').text()).toContain('Добавочная стоимость');
    await wrapper.get('[data-test="order-price-form"]').trigger('submit');
    expect(update).not.toHaveBeenCalled();
  });

  it('guards duplicate saves and closes after a pending request succeeds', async () => {
    const { store, wrapper } = await setup(pricedOrder());
    let resolve!: (order: Order) => void;
    const update = vi.spyOn(store, 'updateOrder').mockImplementation(() => new Promise<Order>(done => { resolve = done; }));
    await wrapper.get('[data-test="order-total"]').trigger('click');
    await wrapper.get('#order-price-additional').setValue('2');
    await wrapper.get('[data-test="order-price-form"]').trigger('submit');
    await wrapper.get('[data-test="order-price-form"]').trigger('submit');
    expect(update).toHaveBeenCalledTimes(1);
    expect((wrapper.get('[data-test="order-price-save"]').element as HTMLButtonElement).disabled).toBe(true);
    resolve(pricedOrder({ additional_cost: 2, final_amount: 60, profit: 20 }));
    await flushPromises();
    expect(wrapper.find('[data-test="order-price-form"]').exists()).toBe(false);
  });

  it('retains input on failure and allows an explicit retry', async () => {
    const { store, wrapper } = await setup(pricedOrder());
    const update = vi.spyOn(store, 'updateOrder')
      .mockRejectedValueOnce(new Error('Тестовая ошибка'))
      .mockResolvedValueOnce(pricedOrder({ additional_cost: 2, final_amount: 60 }));
    await wrapper.get('[data-test="order-total"]').trigger('click');
    await wrapper.get('#order-price-additional').setValue('2');
    await wrapper.get('[data-test="order-price-form"]').trigger('submit');
    await flushPromises();
    expect(wrapper.get('[data-test="order-price-form"]').text()).toContain('Тестовая ошибка');
    expect((wrapper.get('#order-price-additional').element as HTMLInputElement).value).toBe('2');
    await wrapper.get('[data-test="order-price-form"]').trigger('submit');
    await flushPromises();
    expect(update).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[data-test="order-price-form"]').exists()).toBe(false);
  });

  it('removes discounts without removing the surcharge', async () => {
    const { store, wrapper } = await setup(pricedOrder({ discount_amount: 8, discount_percent: 10, additional_cost: 2, final_amount: 47 }));
    const update = vi.spyOn(store, 'updateOrder').mockResolvedValue(pricedOrder({ additional_cost: 2, final_amount: 60 }));
    await wrapper.get('[data-test="order-total"]').trigger('click');
    await buttonByText('Убрать скидку').trigger('click');
    await flushPromises();
    expect(update).toHaveBeenCalledWith('order-1', { discount_amount: 0, discount_percent: 0, additional_cost: 2 });
  });

  it('locks surcharge changes for paid orders', async () => {
    const { wrapper } = await setup(pricedOrder({ paid_amount: 1 }));
    await wrapper.get('[data-test="order-total"]').trigger('click');
    expect((wrapper.get('#order-price-additional').element as HTMLInputElement).disabled).toBe(true);
  });

  it('locks the surcharge when the open order becomes delivered', async () => {
    const { store, wrapper } = await setup(pricedOrder());
    await wrapper.get('[data-test="order-total"]').trigger('click');
    store.orders = store.orders.map(order => ({ ...order, status: 'delivered' as const }));
    await flushPromises();
    expect((wrapper.get('#order-price-additional').element as HTMLInputElement).disabled).toBe(true);
  });

  it('keeps cancellation confirmation and existing detail navigation', async () => {
    const { store, wrapper } = await setup();
    const update = vi.spyOn(store, 'updateOrder');
    await wrapper.get('[data-test="order-cancel"]').trigger('click');
    expect(wrapper.get('[data-test="existing-modal"]').text()).toContain('Отмен');
    expect(update).not.toHaveBeenCalled();
    await buttonByText('Подробнее').trigger('click');
    expect(push).toHaveBeenCalledWith('/admin/crm/orders/order-1');
  });

  it('keeps the assembly mutation and guards a repeated click while pending', async () => {
    const { store } = await setup();
    let resolve!: (order: Order) => void;
    const update = vi.spyOn(store, 'updateOrder').mockImplementation(() => new Promise((done) => { resolve = done; }));
    await buttonByText('Собрано').trigger('click');
    await flushPromises();
    expect(update).toHaveBeenCalledWith('order-1', { status: 'in_progress' });
    await buttonByText('Назначаем ячейку...').trigger('click');
    expect(update).toHaveBeenCalledTimes(1);
    resolve({ ...makeOrder(), status: 'in_progress' });
    await flushPromises();
  });

  it('blocks the order customer by stable ID, never the inviter', async () => {
    const { wrapper } = await setup();
    await chooseAction('block');
    const modal = wrapper.findComponent({ name: 'CustomerBlockModal' });
    expect(modal.props('isOpen')).toBe(true);
    expect(modal.props('customerId')).toBe('customer-1');
    expect(modal.props('prefillUsername')).toBe('real_customer');
  });

  it('targets the customer for invitation bans and keeps inviter data in the dialog', async () => {
    const { wrapper } = await setup();
    expect(wrapper.find('article').text()).not.toContain('Пригласивший');
    expect(wrapper.findComponent(ActionsStub).props('order')).toBeNull();
    await chooseAction('invite-ban');
    const modal = wrapper.findComponent({ name: 'CustomerInviteBanModal' });
    expect(modal.props('customerId')).toBe('customer-1');
    expect(modal.props('username')).toBe('real_customer');
  });

  it.each([false, true, undefined])('moves returning status into dialog data and preserves first-order badge (%s)', async (status) => {
    const { wrapper } = await setup(makeOrder({ is_returning_customer: status }));
    expect(wrapper.get('article').text()).not.toContain('Постоянный');
    expect(wrapper.find('.order-card-first').exists()).toBe(status === false);
    expect(wrapper.get('article').text()).not.toContain('Пригласивший');
    await wrapper.get('[data-test="order-customer-actions"]').trigger('click');
    const order = wrapper.findComponent(ActionsStub).props('order');
    expect(order.is_returning_customer).toBe(status);
    expect(order.referral.inviter_username).toBe('different_inviter');
  });

  it.each(['block', 'invite-ban'])('routes inviter %s to the inviter, after the customer dialog finishes closing', async action => {
    const { wrapper } = await setup();
    await wrapper.get('[data-test="order-customer-actions"]').trigger('click');
    const actions = wrapper.findComponent(ActionsStub);
    actions.vm.$emit('inviter-action', action);
    await flushPromises();
    expect(actions.props('isOpen')).toBe(false);
    const name = action === 'block' ? 'CustomerBlockModal' : 'CustomerInviteBanModal';
    expect(wrapper.findComponent({ name }).props('isOpen')).toBe(false);
    actions.vm.$emit('after-leave');
    await flushPromises();
    const modal = wrapper.findComponent({ name });
    expect(modal.props('isOpen')).toBe(true);
    expect(modal.props('customerId')).toBe('inviter-9');
    expect(modal.props(action === 'block' ? 'prefillUsername' : 'username')).toBe('different_inviter');
  });

  it('rejects stale inviter data during the close transition', async () => {
    const { store, wrapper } = await setup();
    await wrapper.get('[data-test="order-customer-actions"]').trigger('click');
    const actions = wrapper.findComponent(ActionsStub);
    actions.vm.$emit('inviter-action', 'block');
    store.orders = [makeOrder({ referral: { ...makeOrder().referral!, inviter_customer_id: 'replacement-inviter', inviter_username: 'replacement' } })];
    await flushPromises();
    actions.vm.$emit('after-leave');
    await flushPromises();
    expect(wrapper.findComponent({ name: 'CustomerBlockModal' }).props('isOpen')).toBe(false);
  });

  it('never mixes a queued inviter action with a second customer action', async () => {
    const { wrapper } = await setup();
    await wrapper.get('[data-test="order-customer-actions"]').trigger('click');
    const actions = wrapper.findComponent(ActionsStub);
    actions.vm.$emit('inviter-action', 'block');
    actions.vm.$emit('action', 'block');
    await flushPromises();
    actions.vm.$emit('after-leave');
    await flushPromises();
    expect(wrapper.findComponent({ name: 'CustomerBlockModal' }).props('customerId')).toBe('inviter-9');
  });

  it('copies the inviter username, not the customer username', async () => {
    const { wrapper } = await setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await wrapper.get('[data-test="order-customer-actions"]').trigger('click');
    const actions = wrapper.findComponent(ActionsStub);
    actions.vm.$emit('inviter-action', 'copy');
    await flushPromises();
    actions.vm.$emit('after-leave');
    await flushPromises();
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith('@different_inviter');
  });

  it('retains confirmation for removing an inviter ban and rejects a replacement ban', async () => {
    const referral = { ...makeOrder().referral!, inviter_is_invite_banned: 1, inviter_invite_ban_id: 'ban-1' };
    const { store, wrapper } = await setup(makeOrder({ referral }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();
    await wrapper.get('[data-test="order-customer-actions"]').trigger('click');
    const actions = wrapper.findComponent(ActionsStub);
    actions.vm.$emit('inviter-action', 'remove-ban');
    await flushPromises();
    actions.vm.$emit('after-leave');
    await flushPromises();
    expect(confirm).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
    await wrapper.get('[data-test="order-customer-actions"]').trigger('click');
    actions.vm.$emit('inviter-action', 'remove-ban');
    store.orders = [makeOrder({ referral: { ...referral, inviter_invite_ban_id: 'replacement-ban' } })];
    await flushPromises();
    actions.vm.$emit('after-leave');
    await flushPromises();
    expect(confirm).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('opens existing note editing with the freshest board data after a refresh', async () => {
    const { store, wrapper } = await setup();
    await wrapper.get('[data-test="order-customer-actions"]').trigger('click');
    store.orders = [{ ...makeOrder(), customer_notes: 'Обновлённая заметка' }];
    await flushPromises();
    const actions = wrapper.findComponent(ActionsStub);
    expect(actions.props('order').customer_notes).toBe('Обновлённая заметка');
    actions.vm.$emit('action', 'note');
    await flushPromises();
    actions.vm.$emit('after-leave');
    await flushPromises();
    const modal = wrapper.findComponent({ name: 'CustomerNoteModal' });
    expect(modal.props('customerId')).toBe('customer-1');
    expect(modal.props('initialNotes')).toBe('Обновлённая заметка');
  });

  it('does not run a queued action when the selected order leaves the board', async () => {
    const { store, wrapper } = await setup();
    await wrapper.get('[data-test="order-customer-actions"]').trigger('click');
    const actions = wrapper.findComponent(ActionsStub);
    actions.vm.$emit('action', 'block');
    store.orders = [];
    await flushPromises();
    actions.vm.$emit('after-leave');
    await flushPromises();
    expect(wrapper.findComponent({ name: 'CustomerBlockModal' }).props('isOpen')).toBe(false);
  });

  it('rejects a queued action when the order customer changes during the close transition', async () => {
    const { store, wrapper } = await setup();
    await wrapper.get('[data-test="order-customer-actions"]').trigger('click');
    const actions = wrapper.findComponent(ActionsStub);
    actions.vm.$emit('action', 'block');
    store.orders = [makeOrder({ customer_id: 'replacement-customer', telegram_username: 'replacement_username' })];
    await flushPromises();
    actions.vm.$emit('after-leave');
    await flushPromises();
    expect(wrapper.findComponent({ name: 'CustomerBlockModal' }).props('isOpen')).toBe(false);
  });

  it('queues only the first customer action during the close transition', async () => {
    const { wrapper } = await setup();
    await wrapper.get('[data-test="order-customer-actions"]').trigger('click');
    const actions = wrapper.findComponent(ActionsStub);
    actions.vm.$emit('action', 'block');
    actions.vm.$emit('action', 'note');
    await flushPromises();
    actions.vm.$emit('after-leave');
    await flushPromises();
    expect(wrapper.findComponent({ name: 'CustomerBlockModal' }).props('isOpen')).toBe(true);
    expect(wrapper.findComponent({ name: 'CustomerNoteModal' }).props('isOpen')).toBe(false);
  });

  it('reuses generated Telegram messages for customers without a username', async () => {
    const { store } = await setup(makeOrder({ telegram_username: undefined }));
    const generate = vi.spyOn(store, 'generateOrderMessage').mockResolvedValue({ message: 'Реальное сообщение', telegramUsername: null, telegramId: '12345' } as never);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await chooseAction('contact');
    expect(generate).toHaveBeenCalledWith('order-1');
    expect(open).toHaveBeenCalledWith(`tg://openmessage?user_id=12345&text=${encodeURIComponent('Реальное сообщение')}`, '_blank');
  });

  it('retains manager-action restrictions and notification warnings', async () => {
    const { wrapper } = await setup(makeOrder({ needs_manager_action: 1, manager_action_type: 'modified', manager_action_note: 'Изменён состав', auto_notification: { status: 'failed' } }));
    expect(wrapper.find('[data-test="order-cancel"]').exists()).toBe(false);
    expect(wrapper.find('article').attributes('draggable')).toBe('false');
    expect(wrapper.find('article').text()).toContain('Не удалось отправить сообщение клиенту');
    expect(buttonByText('Принять изменения').exists()).toBe(true);
  });
});
