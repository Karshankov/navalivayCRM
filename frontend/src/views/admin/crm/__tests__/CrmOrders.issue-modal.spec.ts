import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent } from 'vue';
import CrmOrders from '@/views/admin/crm/CrmOrders.vue';
import { useCrmStore, type CashAccount, type Order, type OrderItem } from '@/stores/crm';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));

const ModalStub = defineComponent({
  name: 'AdminModal',
  props: ['isOpen', 'title', 'isLoading', 'isConfirmDisabled'],
  emits: ['close', 'confirm'],
  // Слоты рендерим без условий: тестам важен контент модалки выдачи.
  template: `<section v-if="isOpen" data-test="issue-modal"><h2>{{ title }}</h2><slot /><slot name="footer" /><button data-test="modal-confirm" :disabled="isLoading || isConfirmDisabled" @click="$emit('confirm')">Подтвердить</button></section>`,
});

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1', order_number: 1001, customer_id: 'customer-1', employee_id: null,
    status: 'in_progress', delivery_type: 'pickup', delivery_address: null,
    total_amount: 32, discount_amount: 0, discount_percent: 0, final_amount: 32,
    profit: 12, notes: null, customer_notes: null,
    customer_name: 'Дима', telegram_username: 'real_customer', customer_telegram_id: '12345',
    created_at: '2026-07-23T07:00:00.000Z', updated_at: '2026-07-23T07:00:00.000Z',
    completed_at: null, pickup_cell_number: 37, payment_type: 'cash',
    is_returning_customer: false, needs_manager_action: 0, referral: null,
    items: [{
      id: 'item-1', order_id: 'order-1', product_id: 'product-1',
      product_title: 'Товар', variant_name: null,
      quantity: 1, price_per_unit: 32, cost_per_unit: 20,
      discount_amount: 0, total_price: 32, total_cost: 20,
    } satisfies OrderItem],
    ...overrides,
  } as Order;
}

let wrapper: VueWrapper | undefined;

async function setup(order = makeOrder()) {
  const store = useCrmStore();
  store.orders = [order];
  store.cashAccounts = [{
    id: 'acc_default', name: 'Касса', balance: 500, active: 1, is_default: 1, created_at: '',
  } satisfies CashAccount] as CashAccount[];
  vi.spyOn(store, 'fetchKanbanBoard').mockResolvedValue(undefined as never);
  vi.spyOn(store, 'fetchPickupCells').mockResolvedValue(undefined as never);
  vi.spyOn(store, 'fetchCashAccounts').mockResolvedValue(undefined as never);
  vi.spyOn(store, 'unlockAudioContext').mockImplementation(() => {});
  wrapper = mount(CrmOrders, {
    global: { stubs: {
      AdminModal: ModalStub, CustomerHubModal: true, FindInviterModal: true,
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
  const button = wrapper!.findAll('button').find((item) => item.text().includes(text));
  expect(button, `button ${text}`).toBeDefined();
  return button!;
}

async function openIssueModal(order = makeOrder()) {
  const context = await setup(order);
  await buttonByText('Выдать').trigger('click');
  await flushPromises();
  return context;
}

describe('CrmOrders — окно выдачи заказа', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    push.mockClear();
  });
  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    vi.restoreAllMocks();
  });

  it('не показывает выбор счёта и комментарий в окне выдачи', async () => {
    await openIssueModal();
    const modal = wrapper!.get('[data-test="issue-modal"]');
    const text = modal.text();
    expect(text).not.toContain('Касса');
    expect(text).not.toContain('Выберите счёт');
    expect(text).not.toContain('Комментарий');
    // Селекта счёта и текстового поля комментария в разметке нет вовсе.
    expect(modal.find('select').exists()).toBe(false);
    expect(
      modal.findAll('textarea').filter((node) => String(node.attributes('placeholder') || '').includes('кассира')),
    ).toHaveLength(0);
  });

  it('считает сдачу и подсказывает удобную доплату', async () => {
    // Заказ 32р, клиент дал 50 → сдача 18р, доплата 2р даст сдачу 20р.
    await openIssueModal(makeOrder({ final_amount: 32 }));
    const input = wrapper!.get('[data-test="change-calculator"]').find('input');
    await input.setValue('50');
    expect(wrapper!.get('[data-test="change-due"]').text()).toContain('18');
    expect(wrapper!.get('[data-test="convenient-change-hint"]').text())
      .toContain('даст ещё 2');
    expect(wrapper!.get('[data-test="convenient-change-hint"]').text())
      .toContain('сдача будет ровно 20');
  });

  it('показывает недостачу, если клиент дал меньше суммы заказа', async () => {
    await openIssueModal(makeOrder({ final_amount: 32 }));
    const input = wrapper!.get('[data-test="change-calculator"]').find('input');
    await input.setValue('20');
    expect(wrapper!.get('[data-test="change-shortfall"]').text()).toContain('12');
    expect(wrapper!.find('[data-test="convenient-change-hint"]').exists()).toBe(false);
  });

  it('выдаёт наличные через дефолтный счёт без ручного выбора', async () => {
    const { store } = await openIssueModal();
    const issue = vi.spyOn(store, 'issueOrder').mockResolvedValue({
      order: makeOrder({ status: 'delivered' as const }),
      transaction: null,
      auto_notification: null,
    } as never);
    // Настоящая кнопка «Подтвердить и выдать» лежит в footer-слоте модалки.
    await buttonByText('Подтвердить и выдать').trigger('click');
    // deferClick ставит вызов в microtask — flushPromises его исполнит.
    await flushPromises();
    await flushPromises();
    expect(issue).toHaveBeenCalledTimes(1);
    expect(issue.mock.calls[0][1].payment_type).toBe('cash');
    expect(issue.mock.calls[0][1].payment_account_id).toBe('acc_default');
    expect(issue.mock.calls[0][1].payment_notes).toBeUndefined();
  });

  it('не показывает калькулятор сдачи при оплате картой', async () => {
    await openIssueModal(makeOrder({ payment_type: 'card' }));
    // Кнопка «Наличными» переводит в кэш и открывает калькулятор.
    await buttonByText('Наличными').trigger('click');
    expect(wrapper!.find('[data-test="change-calculator"]').exists()).toBe(true);
    await buttonByText('По карте').trigger('click');
    expect(wrapper!.find('[data-test="change-calculator"]').exists()).toBe(false);
  });
});
