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
      AdminModal: ModalStub, CustomerActionsModal: ActionsStub,
      CustomerBlockModal: true, CustomerNoteModal: true, CustomerInviteBanModal: true,
      OrderCreateModal: true, CardPaymentsModal: true, StaffShiftBar: true,
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

  it.each([true, false, undefined])('shows the card-access indicator only when card payment is allowed (%s)', async enabled => {
    const { wrapper } = await setup(makeOrder({ customer_card_payment_enabled: enabled, payment_type: 'cash' }));
    const badge = wrapper.find('[data-test="order-card-card-access"]');
    expect(badge.exists()).toBe(enabled === true);
    if (enabled) {
      expect(badge.element.tagName).toBe('SPAN');
      expect(badge.text()).toBe('Карта разрешена');
      expect(badge.attributes('title')).toBe('Клиенту разрешена оплата картой');
      expect(badge.get('svg').attributes('aria-hidden')).toBe('true');
      expect(badge.find('button').exists()).toBe(false);
    }
    expect(wrapper.get('.order-card-payment').text()).toMatch(/налич/i);
  });

  it('keeps blocking visible alongside the card-access indicator', async () => {
    const { wrapper } = await setup(makeOrder({ customer_card_payment_enabled: true, is_blocked: true }));
    const flags = wrapper.get('.order-card-client-flags');
    expect(flags.text()).toContain('Карта разрешена');
    expect(flags.text()).toContain('Заблокирован');
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

  it('opens the existing whole-order discount modal from a semantic total button', async () => {
    const { store, wrapper } = await setup();
    const update = vi.spyOn(store, 'updateOrder');
    const total = wrapper.get('[data-test="order-total"]');
    expect(total.element.tagName).toBe('BUTTON');
    await total.trigger('click');
    expect(wrapper.get('[data-test="existing-modal"]').text()).toContain('Скидка');
    expect(update).not.toHaveBeenCalled();
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
