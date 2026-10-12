import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import FinancialDayCloseModal from '../FinancialDayCloseModal.vue';
import AdminModal from '@/components/AdminModal.vue';
import { StaffApiError } from '@/stores/crm';
import { CLOSE_DENOMINATIONS, PENDING_CLOSE_STORAGE_KEY, type FinancialCloseContext, type FinancialCloseSnapshot, type SavedFinancialClose } from '@/utils/financialDayClose';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  store: {
    dashboardToken: 'dashboard-test-access',
    cashAccounts: [] as import('@/stores/crm').CashAccount[],
    fetchCashAccounts: vi.fn(),
    fetchStaffShift: vi.fn().mockResolvedValue(null),
  },
}));
vi.mock('@/stores/crm', async () => {
  const actual = await vi.importActual<typeof import('@/stores/crm')>('@/stores/crm');
  return { ...actual, useCrmStore: () => mocks.store, requestFinancialDayClose: mocks.request };
});
vi.mock('@headlessui/vue', () => ({
  TransitionRoot: { props: ['show'], template: '<div v-if="show"><slot /></div>' },
  TransitionChild: { template: '<div><slot /></div>' },
  Dialog: { template: '<div><slot /></div>' },
  DialogPanel: { template: '<div><slot /></div>' },
  DialogTitle: { template: '<h2><slot /></h2>' },
  DialogDescription: { template: '<p><slot /></p>' },
}));
const noteCounts = () => Object.fromEntries(CLOSE_DENOMINATIONS.map(value => [String(value), value === 100 ? 3 : 0]));
function snapshot(): FinancialCloseSnapshot {
  return { cash_balance_before_minor: 40000, counted_cash_minor: 30000, terminal_cash_minor: 20000, terminal_card_minor: 10000, terminal_total_minor: 30000, actual_total_minor: 40000, revenue_minor: 80000, profit_minor: 15000, discrepancy_minor: 0, discrepancy_type: 'none', correction_minor: 0, corrected_cash_minor: 40000, owner_cash_minor: 5000, owner_card_minor: 10000, owner_total_minor: 15000, transfer_minor: 20000, revenue_balance_before_minor: 0, revenue_balance_after_minor: 20000, retained_cash_minor: 5000, cash_balance_after_minor: 5000, coins_minor: 0, cash_account_name: 'Касса', revenue_account_name: 'Выручка' };
}
function saved(): SavedFinancialClose {
  return { id: 'fclose_saved', business_date: '2026-10-12', time_zone: 'Europe/Minsk', closed_at: '2026-10-12T20:00:00.000Z', employee_name: 'Сотрудник', cash_account_id: 'cash', revenue_account_id: 'revenue', report_text: 'Сохранённый серверный отчёт', notification_status: 'pending', snapshot: snapshot(), counts: noteCounts() };
}
let current: FinancialCloseContext;
let wrapper: VueWrapper | undefined;
let complete: (options: RequestInit) => Promise<unknown>;
let historyItems: SavedFinancialClose[];
function setup() { wrapper = mount(FinancialDayCloseModal, { props: { isOpen: true } }); return wrapper; }
function completeCalls() { return mocks.request.mock.calls.filter(call => call[0] === '/complete'); }
async function preparePreview() {
  setup(); await flushPromises();
  await wrapper!.get('[data-test="close-terminal-cash"]').setValue('200');
  await wrapper!.get('[data-test="close-terminal-card"]').setValue('100');
  await wrapper!.get('form').trigger('submit');
  await wrapper!.get('#close-note-100').setValue('3');
  await wrapper!.get('[data-test="close-coins"]').setValue('0');
  await wrapper!.get('form').trigger('submit');
  await wrapper!.get('[data-test="close-retained"]').setValue('50');
  await wrapper!.get('[data-test="close-preview"]').trigger('click');
  await flushPromises();
}
beforeEach(() => {
  window.sessionStorage.clear(); mocks.request.mockReset(); historyItems = [];
  mocks.store.fetchCashAccounts.mockReset().mockResolvedValue(undefined);
  mocks.store.cashAccounts = [
    { id: 'cash', name: 'Касса', balance: 400, active: 1, is_default: 1, created_at: '' },
    { id: 'revenue', name: 'Выручка', balance: 0, active: 1, is_default: 0, created_at: '' },
    { id: 'inactive', name: 'Архивный', balance: 0, active: 0, is_default: 0, created_at: '' },
  ];
  vi.stubGlobal('crypto', { randomUUID: () => '00000000-0000-4000-8000-000000000001' });
  current = { business_date: '2026-10-12', time_zone: 'Europe/Minsk', cash_account_id: 'cash', revenue_account_id: 'revenue', cash_account_name: 'Касса', revenue_account_name: 'Выручка', cash_balance_minor: 40000, revenue_balance_minor: 0, revenue_minor: 80000, profit_minor: 15000, revision: 'preview-revision', notification_ready: false, closure: null };
  complete = async () => ({ closure: saved(), replay: false });
  mocks.request.mockImplementation(async (path: string, options: RequestInit = {}) => {
    if (path.startsWith('/context')) return { ...current };
    if (path === '/preview') return { context: { ...current }, snapshot: snapshot() };
    if (path === '/complete') return complete(options);
    if (path.startsWith('/history?')) return { items: historyItems };
    if (path.startsWith('/history/')) return { closure: saved() };
    throw new Error(`Unexpected endpoint: ${path}`);
  });
});
afterEach(() => { wrapper?.unmount(); wrapper = undefined; window.sessionStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('FinancialDayCloseModal', () => {
  it.each(['pending', 'sent'] as const)('refreshes the staff shift only after confirmed report status %s', async status => {
    mocks.store.fetchStaffShift.mockReset().mockResolvedValue(null);
    current.closure = saved();
    const original = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation(async (path: string, options: RequestInit = {}) => {
      if (path === '/history/fclose_saved') return { closure: { ...saved(), notification_status: status } };
      return original(path, options);
    });
    setup(); await flushPromises();
    const refresh = wrapper!.findAll('button').find(button => button.text() === 'Обновить статус Telegram')!;
    await refresh.trigger('click'); await flushPromises();
    expect(mocks.store.fetchStaffShift).toHaveBeenCalledTimes(status === 'sent' ? 1 : 0);
    expect(completeCalls()).toHaveLength(0);
    expect(wrapper!.find('[data-test="close-saved-report"]').exists()).toBe(true);
  });
  it('keeps the sent report visible when refreshing the staff shift fails', async () => {
    mocks.store.fetchStaffShift.mockReset().mockRejectedValue(new Error('Shift refresh unavailable'));
    current.closure = saved();
    const original = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation(async (path: string, options: RequestInit = {}) => {
      if (path === '/history/fclose_saved') return { closure: { ...saved(), notification_status: 'sent' } };
      return original(path, options);
    });
    setup(); await flushPromises();
    await wrapper!.findAll('button').find(button => button.text() === 'Обновить статус Telegram')!.trigger('click');
    await flushPromises();
    expect(mocks.store.fetchStaffShift).toHaveBeenCalledTimes(1);
    expect(wrapper!.get('[data-test="close-notification"]').text()).not.toContain('В очереди');
    expect(wrapper!.find('[data-test="close-saved-report"]').exists()).toBe(true);
    expect(completeCalls()).toHaveLength(0);
  });
  it('keeps original profit separate from rounded settlement in saved reports', async () => {
    current.closure = { ...saved(), snapshot: { ...snapshot(),
      cash_balance_before_minor: 110100, counted_cash_minor: 100000,
      terminal_card_minor: 10100, terminal_total_minor: 30100, actual_total_minor: 110100,
      corrected_cash_minor: 110100, profit_minor: 58800,
      owner_cash_before_rounding_minor: 48700, owner_rounding_minor: -200,
      owner_cash_minor: 48500, owner_card_minor: 10100, owner_total_minor: 58600,
      transfer_minor: 48000, revenue_balance_before_minor: 60000, revenue_balance_after_minor: 108000,
      retained_cash_minor: 3500, cash_balance_after_minor: 3500,
    } };
    setup(); await flushPromises();
    const rows = wrapper!.get('[data-test="close-saved-report"]').findAll('.close-totals > div');
    expect(rows.find(row => row.get('dt').text() === 'Прибыль дня из «Обзора»')!.get('dd').text()).toBe('588,00 BYN');
    expect(rows.find(row => row.get('dt').text() === 'Владельцу всего')!.get('dd').text()).toBe('586,00 BYN');
    expect(wrapper!.get('[data-test="close-saved-rounding"]').text()).toContain('2,00 BYN остаётся в выручке');
    expect(wrapper!.find('[data-test="close-saved-report"] .close-discrepancy-row').exists()).toBe(false);
    expect(completeCalls()).toHaveLength(0);
  });
  it('explains automatic daily fact insertion for the closing date without writing', async () => {
    current.cash_pacing = { month_key: '2026-10', month_id: 'october', existing_amount_minor: null, revision: 'pacing-revision' };
    setup(); await flushPromises();
    expect(wrapper!.get('[data-test="close-pacing-auto"]').text()).toContain('наличные + карта');
    expect(wrapper!.get('[data-test="close-pacing-auto"]').text()).toContain('12.10.2026');
    expect(completeCalls()).toHaveLength(0);
  });
  it.each([0, 56000])('shows existing daily fact %s as preserved rather than added again', async amount => {
    current.cash_pacing = { month_key: '2026-10', month_id: 'october', existing_amount_minor: amount, revision: 'pacing-revision' };
    setup(); await flushPromises();
    const notice = wrapper!.get('[data-test="close-pacing-preserved"]').text();
    expect(notice).toContain(amount === 0 ? '0,00 BYN' : '560,00 BYN');
    expect(notice).toContain('останется без изменений');
    expect(notice).toContain('не прибавляется');
    expect(wrapper!.find('[data-test="close-pacing-auto"]').exists()).toBe(false);
    expect(completeCalls()).toHaveLength(0);
  });
  it('asks to create the missing business month without sending a close', async () => {
    current.cash_pacing = { month_key: '2026-10', month_id: null, existing_amount_minor: null, revision: 'pacing-revision' };
    setup(); await flushPromises();
    expect(wrapper!.get('[data-test="close-pacing-month-missing"]').text()).toContain('2026-10');
    expect(wrapper!.get('[data-test="close-pacing-month-missing"]').text()).toContain('Без него закрытие не сохранится');
    expect(completeCalls()).toHaveLength(0);
  });
  it.each([null, {}, { month_key: '2026-10', month_id: 'october', existing_amount_minor: '560', revision: 'r' }])('rejects malformed cash-pacing context %j before enabling the wizard', async pacing => {
    const original = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation(async (path: string, options: RequestInit = {}) => path.startsWith('/context')
      ? { ...current, cash_pacing: pacing } : original(path, options));
    setup(); await flushPromises();
    expect(wrapper!.find('[data-test="close-terminal-step"]').exists()).toBe(false);
    expect(completeCalls()).toHaveLength(0);
  });
  it('does not accept malformed daily-fact metadata as a confirmed saved report', async () => {
    complete = async () => ({ closure: { ...saved(), snapshot: { ...snapshot(), cash_pacing_fact: { status: 'inserted', fact_date: '2026-10-12', amount_minor: '30000' } } }, replay: false });
    await preparePreview();
    await wrapper!.get('[data-test="close-confirm"]').trigger('click'); await flushPromises();
    expect(wrapper!.emitted('saved')).toBeUndefined();
    expect(window.sessionStorage.getItem(PENDING_CLOSE_STORAGE_KEY)).not.toBeNull();
    expect(completeCalls()).toHaveLength(1);
  });
  it('hides destructive reset unless the server explicitly enables it', async () => {
    current.closure = saved(); setup(); await flushPromises();
    expect(wrapper!.find('[data-test="close-reset"]').exists()).toBe(false);
  });
  it('requires reset confirmation, preserves focus and cancellation never sends a reset', async () => {
    current.closure = saved(); current.test_reset_enabled = true;
    wrapper = mount(FinancialDayCloseModal, { props: { isOpen: true }, attachTo: document.body });
    await flushPromises();
    (wrapper.get('[data-test="close-reset"]').element as HTMLButtonElement).focus();
    await wrapper.get('[data-test="close-reset"]').trigger('click'); await flushPromises();
    expect(wrapper.find('[data-test="close-reset-confirmation"]').exists()).toBe(true);
    expect(document.activeElement).toBe(wrapper.get('[data-test="close-reset-cancel"]').element);
    expect(mocks.request.mock.calls.some(call => String(call[0]).endsWith('/test-reset'))).toBe(false);
    await wrapper.get('[data-test="close-reset-cancel"]').trigger('click'); await flushPromises();
    expect(wrapper.find('[data-test="close-reset-confirmation"]').exists()).toBe(false);
    expect(document.activeElement).toBe(wrapper.get('[data-test="close-reset"]').element);
    expect(mocks.request.mock.calls.some(call => String(call[0]).endsWith('/test-reset'))).toBe(false);
  });
  it('resets one saved closure and returns to a blank first step', async () => {
    current.closure = saved(); current.test_reset_enabled = true;
    const original = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation(async (path: string, options: RequestInit = {}) => {
      if (path.endsWith('/test-reset')) {
        expect(JSON.parse(String(options.body))).toEqual({ confirm_closure_id: 'fclose_saved' });
        expect(options.method).toBe('POST'); current.closure = null;
        return { reset: true, closure_id: 'fclose_saved', replay: false };
      }
      return original(path, options);
    });
    setup(); await flushPromises();
    await wrapper!.get('[data-test="close-reset"]').trigger('click');
    await wrapper!.get('[data-test="close-reset-confirm"]').trigger('click'); await flushPromises();
    expect(wrapper!.emitted('reset')).toEqual([['fclose_saved']]);
    expect(wrapper!.find('[data-test="close-terminal-step"]').exists()).toBe(true);
    expect((wrapper!.get('[data-test="close-terminal-cash"]').element as HTMLInputElement).value).toBe('');
    expect(wrapper!.text()).toContain('Балансы восстановлены');
    expect(completeCalls()).toHaveLength(0);
  });
  it('locks close and suppresses duplicate reset while the response is pending', async () => {
    current.closure = saved(); current.test_reset_enabled = true;
    let resolveReset!: (value: unknown) => void;
    const original = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation((path: string, options: RequestInit = {}) => path.endsWith('/test-reset')
      ? new Promise(resolve => { resolveReset = resolve; }) : original(path, options));
    setup(); await flushPromises();
    await wrapper!.get('[data-test="close-reset"]').trigger('click');
    await wrapper!.get('[data-test="close-reset-confirm"]').trigger('click');
    await wrapper!.get('[data-test="close-reset-confirm"]').trigger('click');
    expect(mocks.request.mock.calls.filter(call => String(call[0]).endsWith('/test-reset'))).toHaveLength(1);
    expect(wrapper!.findComponent(AdminModal).props('persistent')).toBe(true);
    expect(wrapper!.findComponent(AdminModal).props('isLoading')).toBe(true);
    current.closure = null; resolveReset({ reset: true, closure_id: 'fclose_saved' }); await flushPromises();
    expect(wrapper!.findComponent(AdminModal).props('isLoading')).toBe(false);
  });
  it('keeps the report and does not emit reset on a definite unsafe-reset rejection', async () => {
    current.closure = saved(); current.test_reset_enabled = true;
    const original = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation(async (path: string, options: RequestInit = {}) => {
      if (path.endsWith('/test-reset')) throw new StaffApiError('После закрытия изменились проводки', { code: 'closing_test_reset_later_movements', status: 409 });
      return original(path, options);
    });
    setup(); await flushPromises(); await wrapper!.get('[data-test="close-reset"]').trigger('click');
    await wrapper!.get('[data-test="close-reset-confirm"]').trigger('click'); await flushPromises();
    expect(wrapper!.find('[data-test="close-saved-report"]').exists()).toBe(true);
    expect(wrapper!.emitted('reset')).toBeUndefined();
    expect(wrapper!.text()).toContain('После закрытия изменились проводки');
  });
  it('does not claim success for malformed reset responses and retries the same closure', async () => {
    current.closure = saved(); current.test_reset_enabled = true;
    const original = mocks.request.getMockImplementation()!;
    let attempts = 0;
    mocks.request.mockImplementation(async (path: string, options: RequestInit = {}) => {
      if (path.endsWith('/test-reset')) {
        attempts++; if (attempts === 1) return {};
        current.closure = null; return { reset: true, closure_id: 'fclose_saved', replay: true };
      }
      return original(path, options);
    });
    setup(); await flushPromises(); await wrapper!.get('[data-test="close-reset"]').trigger('click');
    await wrapper!.get('[data-test="close-reset-confirm"]').trigger('click'); await flushPromises();
    expect(wrapper!.emitted('reset')).toBeUndefined(); expect(wrapper!.text()).toContain('Ответ на сброс не подтверждён');
    await wrapper!.get('[data-test="close-reset-confirm"]').trigger('click'); await flushPromises();
    expect(wrapper!.emitted('reset')).toEqual([['fclose_saved']]);
    expect(mocks.request.mock.calls.filter(call => String(call[0]).endsWith('/test-reset')).map(call => call[0]))
      .toEqual(['/history/fclose_saved/test-reset', '/history/fclose_saved/test-reset']);
  });
  async function openCashCountStep() {
    setup(); await flushPromises();
    await wrapper!.get('[data-test="close-terminal-cash"]').setValue('200');
    await wrapper!.get('[data-test="close-terminal-card"]').setValue('100');
    await wrapper!.get('form').trigger('submit');
    await wrapper!.get('[data-test="close-coins"]').setValue('0');
  }
  it('groups notes into two columns with large labels above inputs and no increment buttons', async () => {
    await openCashCountStep();
    const columns = wrapper!.findAll('.close-note-column');
    expect(columns).toHaveLength(2);
    expect(columns.map(column => column.findAll('input').map(input => input.attributes('id'))))
      .toEqual([['close-note-200', 'close-note-100', 'close-note-50'], ['close-note-20', 'close-note-10', 'close-note-5']]);
    for (const note of wrapper!.findAll('.close-note')) {
      expect(note.findAll('button')).toHaveLength(0);
      expect(note.get('label').attributes('for')).toBe(note.get('input').attributes('id'));
      expect(note.get('.close-note-value').text()).toMatch(/^\d+$/);
    }
    expect(wrapper!.text()).not.toContain('Закрытие финансового дня не завершает');
    expect(wrapper!.text()).not.toContain('Europe/Minsk');
    expect(wrapper!.text()).not.toContain('Пересчитайте фактические наличные');
    expect(wrapper!.get('[data-test="close-discrepancy"]').classes()).toContain('close-discrepancy-row');
    await wrapper!.get('#close-note-100').setValue('3');
    expect(wrapper!.find('[data-test="close-discrepancy"]').exists()).toBe(false);
    await wrapper!.get('#close-note-20').setValue('1');
    expect(wrapper!.get('[data-test="close-discrepancy"]').text()).toContain('Излишек');
    expect(wrapper!.get('.close-steps li').classes()).toContain('passed');
    expect(completeCalls()).toHaveLength(0);
  });
  it.each([['0', '590,00 BYN', '2,00 BYN из выручки'], ['101', '485,00 BYN', '2,00 BYN остаётся в выручке'], ['100,50', '490,00 BYN', '2,50 BYN из выручки']])('shows rounded cash for card %s before any confirmation', async (card, payout, difference) => {
    current.profit_minor = 58800;
    setup(); await flushPromises();
    await wrapper!.get('[data-test="close-terminal-cash"]').setValue('200');
    await wrapper!.get('[data-test="close-terminal-card"]').setValue(card);
    await wrapper!.get('form').trigger('submit');
    await wrapper!.get('#close-note-100').setValue('10');
    await wrapper!.get('[data-test="close-coins"]').setValue('0');
    await wrapper!.get('form').trigger('submit');
    expect(wrapper!.get('[data-test="close-owner-rounded"]').text()).toContain(payout);
    expect(wrapper!.get('[data-test="close-owner-rounding"]').text()).toContain(difference);
    expect(wrapper!.text()).toContain('588,00 BYN');
    expect(completeCalls()).toHaveLength(0);
  });
  it('clears the default zero on focus for every note denomination', async () => {
    await openCashCountStep();
    for (const denomination of CLOSE_DENOMINATIONS) {
      const input = wrapper!.get(`#close-note-${denomination}`);
      expect((input.element as HTMLInputElement).value).toBe('0');
      await input.trigger('focus');
      expect((input.element as HTMLInputElement).value).toBe('');
      await input.trigger('blur');
      expect((input.element as HTMLInputElement).value).toBe('0');
    }
    expect(completeCalls()).toHaveLength(0);
    await wrapper!.get('form').trigger('submit');
    expect(wrapper!.find('[data-test="close-distribution-step"]').exists()).toBe(true);
  });
  it('preserves entered note counts on blur and subsequent focus', async () => {
    await openCashCountStep();
    const input = wrapper!.get('#close-note-100');
    await input.trigger('focus'); await input.setValue('12'); await input.trigger('blur');
    await input.trigger('focus');
    expect((input.element as HTMLInputElement).value).toBe('12');
    await input.setValue('-1'); await input.trigger('blur'); await input.trigger('focus');
    expect((input.element as HTMLInputElement).value).toBe('-1');
    expect(completeCalls()).toHaveLength(0);
  });
  it('restores an empty note count to zero and accepts direct keyboard entry without increment buttons', async () => {
    await openCashCountStep();
    const input = wrapper!.get('#close-note-100');
    await input.trigger('focus'); await input.trigger('blur');
    expect((input.element as HTMLInputElement).value).toBe('0');
    expect(wrapper!.find('button[aria-label="Добавить купюру 100 BYN"]').exists()).toBe(false);
    await input.setValue('1');
    expect((input.element as HTMLInputElement).value).toBe('1');
    expect(completeCalls()).toHaveLength(0);
  });
  it('adds all coins to retained banknotes once in preview and confirmation', async () => {
    current.cash_balance_minor = 50000;
    const reservedSnapshot: FinancialCloseSnapshot = {
      ...snapshot(), cash_balance_before_minor: 50000, counted_cash_minor: 40000,
      actual_total_minor: 50000, corrected_cash_minor: 50000,
      coins_minor: 10000, retained_notes_minor: 3500, retained_cash_minor: 13500,
      cash_balance_after_minor: 13500, transfer_minor: 21500, revenue_balance_after_minor: 21500,
    };
    const original = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation(async (path: string, options: RequestInit = {}) => {
      if (path === '/preview') return { context: { ...current }, snapshot: reservedSnapshot };
      return original(path, options);
    });
    complete = async () => ({ closure: { ...saved(), snapshot: reservedSnapshot }, replay: false });
    await openCashCountStep();
    await wrapper!.get('#close-note-100').setValue('3');
    await wrapper!.get('[data-test="close-coins"]').setValue('100');
    await wrapper!.get('form').trigger('submit');
    await wrapper!.get('[data-test="close-retained"]').setValue('35');
    expect(wrapper!.get('label[for="close-retained"]').text()).toContain('Оставить купюрами');
    expect(wrapper!.get('[data-test="close-retained-total"]').text()).toContain('135,00 BYN');
    await wrapper!.get('[data-test="close-preview"]').trigger('click'); await flushPromises();
    const previewCall = mocks.request.mock.calls.find(call => call[0] === '/preview')!;
    expect(JSON.parse(String(previewCall[1].body))).toMatchObject({ coins: '100', retained_cash: '135.00' });
    expect(completeCalls()).toHaveLength(0);
    await wrapper!.get('[data-test="close-confirm"]').trigger('click'); await flushPromises();
    expect(completeCalls()).toHaveLength(1);
    expect(JSON.parse(String(completeCalls()[0]![1].body))).toMatchObject({ coins: '100', retained_cash: '135.00' });
    expect(wrapper!.emitted('saved')).toHaveLength(1);
  });
  it('keeps blank terminal input invalid instead of closing a fictional zero day', async () => {
    setup(); await flushPromises(); await wrapper!.get('form').trigger('submit');
    expect(wrapper!.find('[data-test="close-terminal-step"]').exists()).toBe(true);
    expect(wrapper!.findAll('input[aria-invalid="true"]')).toHaveLength(2);
    expect(completeCalls()).toHaveLength(0);
  });
  it.each([41000, 39000])('allows proceeding with discrepancy against balance %s', async balance => {
    current.cash_balance_minor = balance; setup(); await flushPromises();
    await wrapper!.get('[data-test="close-terminal-cash"]').setValue('200');
    await wrapper!.get('[data-test="close-terminal-card"]').setValue('100');
    await wrapper!.get('form').trigger('submit');
    await wrapper!.get('#close-note-100').setValue('3');
    await wrapper!.get('[data-test="close-coins"]').setValue('0');
    expect(wrapper!.get('[data-test="close-discrepancy"]').text()).toContain(balance > 40000 ? 'Недостача' : 'Излишек');
    await wrapper!.get('form').trigger('submit');
    expect(wrapper!.find('[data-test="close-distribution-step"]').exists()).toBe(true);
    expect(completeCalls()).toHaveLength(0);
  });
  it.each([0, 5000])('uses saved owner cash %s in the highlighted report instead of the current day profit', async ownerCash => {
    const closure = saved();
    closure.snapshot = {
      ...snapshot(), owner_cash_minor: ownerCash, owner_total_minor: ownerCash + 10000,
      profit_minor: ownerCash + 10000, transfer_minor: 25000 - ownerCash,
      revenue_balance_after_minor: 25000 - ownerCash,
    };
    complete = async () => ({ closure, replay: false });
    await preparePreview();
    await wrapper!.get('[data-test="close-confirm"]').trigger('click');
    await flushPromises();
    expect(wrapper!.get('[data-test="close-saved-report"] .close-owner-card dd').text())
      .toBe(ownerCash === 0 ? '0,00 BYN' : '50,00 BYN');
    expect(completeCalls()).toHaveLength(1);
  });
  it('highlights physical owner cash in preview and saved report without mixing it with card proceeds', async () => {
    await preparePreview();
    const draftPayout = wrapper!.get('[data-test="close-owner-rounded"]');
    expect(draftPayout.get('dd').text()).toBe('50,00 BYN');
    const previewPayout = wrapper!.get('[data-test="close-preview-result"] .close-owner-card');
    expect(previewPayout.get('dt').text()).toContain('Передать наличными');
    expect(previewPayout.get('dd').text()).toBe('50,00 BYN');
    expect(completeCalls()).toHaveLength(0);
    await wrapper!.get('[data-test="close-confirm"]').trigger('click');
    await flushPromises();
    const report = wrapper!.get('[data-test="close-saved-report"]');
    const savedPayout = report.get('.close-owner-card');
    expect(savedPayout.get('dt').text()).toBe('Передать владельцу наличными');
    expect(savedPayout.get('dd').text()).toBe('50,00 BYN');
    const rows = report.findAll('.close-totals > div');
    expect(rows.find(row => row.get('dt').text() === 'Карта уже у владельца')!.get('dd').text()).toBe('100,00 BYN');
    expect(report.get('details').attributes('open')).toBeUndefined();
    expect(completeCalls()).toHaveLength(1);
  });
  it('does not write until confirmation and shows a saved report separately from Telegram', async () => {
    await preparePreview(); expect(completeCalls()).toHaveLength(0);
    expect(wrapper!.get('[data-test="close-preview-result"]').text()).toContain('200,00 BYN');
    await wrapper!.get('[data-test="close-confirm"]').trigger('click'); await flushPromises();
    expect(completeCalls()).toHaveLength(1);
    expect(wrapper!.get('[data-test="close-saved-report"]').text()).toContain('Отчёт сохранён');
    expect(wrapper!.get('[data-test="close-notification"]').text()).toContain('В очереди');
    expect(window.sessionStorage.getItem(PENDING_CLOSE_STORAGE_KEY)).toBeNull();
    expect(wrapper!.emitted('saved')).toHaveLength(1);
  });
  it('unlocks the form after a definite coin-reserve rejection without retrying or discarding input', async () => {
    complete = async () => { throw new StaffApiError('Все монеты должны остаться в кассе', { code: 'retained_cash_below_coins', status: 409 }); };
    await preparePreview();
    await wrapper!.get('[data-test="close-confirm"]').trigger('click'); await flushPromises();
    expect(completeCalls()).toHaveLength(1);
    expect(window.sessionStorage.getItem(PENDING_CLOSE_STORAGE_KEY)).toBeNull();
    expect(wrapper!.find('[data-test="close-recovery"]').exists()).toBe(false);
    expect(wrapper!.find('[data-test="close-preview-result"]').exists()).toBe(false);
    expect((wrapper!.get('[data-test="close-retained"]').element as HTMLInputElement).value).toBe('50');
    expect(wrapper!.emitted('saved')).toBeUndefined();
  });
  it('clears pending confirmation on a definite missing-month rejection and preserves input', async () => {
    complete = async () => { throw new StaffApiError('Сначала создайте месяц в плане пробития', { code: 'closing_cash_pacing_month_required', status: 409 }); };
    await preparePreview();
    await wrapper!.get('[data-test="close-confirm"]').trigger('click'); await flushPromises();
    expect(completeCalls()).toHaveLength(1);
    expect(window.sessionStorage.getItem(PENDING_CLOSE_STORAGE_KEY)).toBeNull();
    expect(wrapper!.find('[data-test="close-preview-result"]').exists()).toBe(false);
    expect(wrapper!.emitted('saved')).toBeUndefined();
    expect(wrapper!.text()).toContain('Сначала создайте месяц');
    expect((wrapper!.get('[data-test="close-retained"]').element as HTMLInputElement).value).toBe('50');
    expect(mocks.request.mock.calls.some(call => String(call[0]).startsWith('/history?'))).toBe(false);
  });
  it('invalidates server preview when distribution input changes', async () => {
    await preparePreview(); await wrapper!.get('[data-test="close-retained"]').setValue('60');
    expect(wrapper!.find('[data-test="close-preview-result"]').exists()).toBe(false);
    expect(wrapper!.get('[data-test="close-confirm"]').attributes('disabled')).toBeDefined();
  });
  it('prevents duplicate final requests and blocks closing while the POST is in flight', async () => {
    let resolve!: (value: unknown) => void;
    complete = () => new Promise(value => { resolve = value; });
    await preparePreview(); const button = wrapper!.get('[data-test="close-confirm"]');
    await button.trigger('click'); await button.trigger('click');
    wrapper!.findComponent(AdminModal).vm.$emit('update:isOpen', false); await flushPromises();
    expect(completeCalls()).toHaveLength(1); expect(wrapper!.emitted('close')).toBeUndefined();
    expect(window.sessionStorage.getItem(PENDING_CLOSE_STORAGE_KEY)).not.toBeNull();
    resolve({ closure: saved(), replay: false }); await flushPromises();
    expect(wrapper!.find('[data-test="close-saved-report"]').exists()).toBe(true);
  });
  it('reopens and retries a lost response with exactly the same key and payload', async () => {
    complete = async () => { throw new StaffApiError('Нет связи', { outcomeUnknown: true }); };
    await preparePreview(); await wrapper!.get('[data-test="close-confirm"]').trigger('click'); await flushPromises();
    const originalOptions = completeCalls()[0]![1] as RequestInit;
    expect(wrapper!.find('[data-test="close-recovery"]').exists()).toBe(true);
    wrapper!.findComponent(AdminModal).vm.$emit('update:isOpen', false); await flushPromises();
    expect(wrapper!.emitted('close')).toHaveLength(1);
    await wrapper!.setProps({ isOpen: false }); await wrapper!.setProps({ isOpen: true }); await flushPromises();
    complete = async () => ({ closure: saved(), replay: true });
    await wrapper!.get('[data-test="close-retry"]').trigger('click'); await flushPromises();
    const retryOptions = completeCalls()[1]![1] as RequestInit;
    expect(retryOptions.body).toBe(originalOptions.body);
    expect(retryOptions.headers).toEqual(originalOptions.headers);
    expect(completeCalls()).toHaveLength(2);
    expect(window.sessionStorage.getItem(PENDING_CLOSE_STORAGE_KEY)).toBeNull();
  });
  it('restores banknotes from the total reserve and never adds coins twice after a lost response', async () => {
    current.cash_balance_minor = 50000;
    const reservedSnapshot: FinancialCloseSnapshot = { ...snapshot(), cash_balance_before_minor: 50000,
      counted_cash_minor: 40000, actual_total_minor: 50000, corrected_cash_minor: 50000,
      coins_minor: 10000, retained_notes_minor: 3500, retained_cash_minor: 13500,
      cash_balance_after_minor: 13500, transfer_minor: 21500, revenue_balance_after_minor: 21500 };
    const original = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation(async (path: string, options: RequestInit = {}) => {
      if (path === '/preview') return { context: { ...current }, snapshot: reservedSnapshot };
      return original(path, options);
    });
    complete = async () => { throw new StaffApiError('Нет связи', { outcomeUnknown: true }); };
    await openCashCountStep();
    await wrapper!.get('#close-note-100').setValue('3');
    await wrapper!.get('[data-test="close-coins"]').setValue('100');
    await wrapper!.get('form').trigger('submit');
    await wrapper!.get('[data-test="close-retained"]').setValue('35');
    await wrapper!.get('[data-test="close-preview"]').trigger('click'); await flushPromises();
    await wrapper!.get('[data-test="close-confirm"]').trigger('click'); await flushPromises();
    const originalOptions = completeCalls()[0]![1] as RequestInit;
    await wrapper!.setProps({ isOpen: false }); await wrapper!.setProps({ isOpen: true }); await flushPromises();
    complete = async () => { throw new StaffApiError('Данные изменились', { code: 'closing_preview_stale', status: 409 }); };
    await wrapper!.get('[data-test="close-retry"]').trigger('click'); await flushPromises();
    expect((completeCalls()[1]![1] as RequestInit).body).toBe(originalOptions.body);
    expect((completeCalls()[1]![1] as RequestInit).headers).toEqual(originalOptions.headers);
    expect((wrapper!.get('[data-test="close-retained"]').element as HTMLInputElement).value).toBe('35.00');
    expect(wrapper!.get('[data-test="close-retained-total"]').text()).toContain('135,00 BYN');
    expect(window.sessionStorage.getItem(PENDING_CLOSE_STORAGE_KEY)).toBeNull();
    await wrapper!.get('[data-test="close-preview"]').trigger('click'); await flushPromises();
    const previews = mocks.request.mock.calls.filter(call => call[0] === '/preview');
    expect(JSON.parse(String(previews[previews.length - 1]![1].body))).toMatchObject({ coins: '100', retained_cash: '135.00' });
    expect(completeCalls()).toHaveLength(2);
  });
  it('recovers a saved report after a lost response without a second POST', async () => {
    complete = async () => { historyItems = [saved()]; throw new StaffApiError('Ответ потерян', { outcomeUnknown: true }); };
    await preparePreview(); await wrapper!.get('[data-test="close-confirm"]').trigger('click'); await flushPromises();
    expect(completeCalls()).toHaveLength(1);
    expect(wrapper!.find('[data-test="close-saved-report"]').exists()).toBe(true);
    expect(wrapper!.find('[data-test="close-retry"]').exists()).toBe(false);
  });
  it('retains recovery state for malformed final success responses', async () => {
    complete = async () => ({});
    await preparePreview(); await wrapper!.get('[data-test="close-confirm"]').trigger('click'); await flushPromises();
    expect(wrapper!.find('[data-test="close-recovery"]').exists()).toBe(true);
    expect(wrapper!.find('[data-test="close-saved-report"]').exists()).toBe(false);
    expect(window.sessionStorage.getItem(PENDING_CLOSE_STORAGE_KEY)).not.toBeNull();
  });
  it('requires a fresh preview after a definite stale-preview rejection and preserves input', async () => {
    complete = async () => { throw new StaffApiError('Данные изменились', { code: 'closing_preview_stale', status: 409 }); };
    await preparePreview(); await wrapper!.get('[data-test="close-confirm"]').trigger('click'); await flushPromises();
    expect(window.sessionStorage.getItem(PENDING_CLOSE_STORAGE_KEY)).toBeNull();
    expect((wrapper!.get('[data-test="close-retained"]').element as HTMLInputElement).value).toBe('50');
    expect(wrapper!.get('[data-test="close-confirm"]').attributes('disabled')).toBeDefined();
  });
  it('never submits when recovery persistence fails', async () => {
    await preparePreview();
    const storage = window.sessionStorage;
    vi.spyOn(window, 'sessionStorage', 'get').mockReturnValue(new Proxy(storage, {
      get(target, key) {
        if (key === 'setItem') return () => { throw new Error('Storage unavailable'); };
        return Reflect.get(target, key, target);
      },
    }));
    await wrapper!.get('[data-test="close-confirm"]').trigger('click'); await flushPromises();
    expect(completeCalls()).toHaveLength(0);
    expect(wrapper!.text()).toContain('Подтверждение не отправлено');
  });
  it('opens an already closed day as an immutable report', async () => {
    current.closure = saved(); setup(); await flushPromises();
    expect(wrapper!.find('[data-test="close-saved-report"]').exists()).toBe(true);
    expect(wrapper!.find('[data-test="close-confirm"]').exists()).toBe(false);
    expect(completeCalls()).toHaveLength(0);
  });
  it('shows unavailable state without fictional amounts or a confirmation form', async () => {
    mocks.request.mockRejectedValue(new StaffApiError('Модуль пока недоступен', { code: 'financial_close_disabled', status: 503 }));
    setup(); await flushPromises();
    expect(wrapper!.text()).toContain('Модуль пока недоступен');
    expect(wrapper!.find('form').exists()).toBe(false);
    expect(wrapper!.find('[data-test="close-confirm"]').exists()).toBe(false);
  });
  it('blocks new writes when recovery data is damaged', async () => {
    window.sessionStorage.setItem(PENDING_CLOSE_STORAGE_KEY, '{'); setup(); await flushPromises();
    expect(wrapper!.find('[data-test="close-recovery"]').exists()).toBe(true);
    expect(wrapper!.find('[data-test="close-confirm"]').exists()).toBe(false);
    expect(completeCalls()).toHaveLength(0);
  });
  it.each(['closing_account_selection_required', 'closing_account_not_found', 'closing_accounts_must_differ'])('offers existing active accounts for %s without writing', async code => {
    mocks.request.mockRejectedValue(new StaffApiError('Выберите счета', { code, status: 400 }));
    setup(); await flushPromises();
    expect(mocks.store.fetchCashAccounts).toHaveBeenCalledTimes(1);
    expect(wrapper!.find('[data-test="close-account-selection"]').exists()).toBe(true);
    const options = wrapper!.get('[data-test="close-cash-account"]').findAll('option');
    expect(options.map(option => option.attributes('value'))).toEqual(['', 'cash', 'revenue']);
    expect(wrapper!.find('[data-test="close-terminal-step"]').exists()).toBe(false);
    expect(completeCalls()).toHaveLength(0);
  });
  it('requires two different active accounts and carries their IDs into context and confirmation', async () => {
    const normalRequest = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation((path: string, options?: RequestInit) => {
      if (path === '/context') throw new StaffApiError('Неоднозначные счета', { code: 'closing_account_selection_required', status: 400 });
      return normalRequest(path, options);
    });
    setup(); await flushPromises();
    await wrapper!.get('form').trigger('submit');
    expect(wrapper!.text()).toContain('Выберите два активных счёта');
    await wrapper!.get('[data-test="close-cash-account"]').setValue('cash');
    await wrapper!.get('[data-test="close-revenue-account"]').setValue('cash');
    await wrapper!.get('form').trigger('submit');
    expect(wrapper!.text()).toContain('должны быть разными');
    expect(mocks.request.mock.calls.filter(call => call[0].startsWith('/context'))).toHaveLength(1);
    await wrapper!.get('[data-test="close-revenue-account"]').setValue('revenue');
    await wrapper!.get('form').trigger('submit'); await flushPromises();
    expect(mocks.request.mock.calls.some(call => call[0] === '/context?cash_account_id=cash&revenue_account_id=revenue')).toBe(true);
    expect(wrapper!.find('[data-test="close-account-selection"]').exists()).toBe(false);
    await wrapper!.get('[data-test="close-terminal-cash"]').setValue('200');
    await wrapper!.get('[data-test="close-terminal-card"]').setValue('100');
    await wrapper!.get('form').trigger('submit');
    await wrapper!.get('#close-note-100').setValue('3');
    await wrapper!.get('[data-test="close-coins"]').setValue('0');
    await wrapper!.get('form').trigger('submit');
    await wrapper!.get('[data-test="close-retained"]').setValue('50');
    await wrapper!.get('[data-test="close-preview"]').trigger('click'); await flushPromises();
    await wrapper!.get('[data-test="close-confirm"]').trigger('click'); await flushPromises();
    const payload = JSON.parse(completeCalls()[0]![1].body as string);
    expect(payload.cash_account_id).toBe('cash'); expect(payload.revenue_account_id).toBe('revenue');
    expect(completeCalls()).toHaveLength(1);
  });
  it('clears account selection when reopening into an unavailable module', async () => {
    mocks.request.mockRejectedValue(new StaffApiError('Выберите счета', { code: 'closing_account_selection_required', status: 400 }));
    setup(); await flushPromises();
    expect(wrapper!.find('[data-test="close-account-selection"]').exists()).toBe(true);
    await wrapper!.setProps({ isOpen: false });
    mocks.request.mockRejectedValue(new StaffApiError('Модуль отключён', { code: 'financial_close_disabled', status: 503 }));
    await wrapper!.setProps({ isOpen: true }); await flushPromises();
    expect(wrapper!.text()).toContain('Модуль отключён');
    expect(wrapper!.find('[data-test="close-account-selection"]').exists()).toBe(false);
    expect(wrapper!.find('form').exists()).toBe(false);
    expect(completeCalls()).toHaveLength(0);
  });
  it('ignores an old context response after closing and reopening', async () => {
    let resolve!: (value: unknown) => void;
    mocks.request.mockImplementationOnce(() => new Promise(value => { resolve = value; }));
    setup(); await flushPromises();
    await wrapper!.setProps({ isOpen: false }); await wrapper!.setProps({ isOpen: true }); await flushPromises();
    resolve({ ...current, closure: saved() }); await flushPromises();
    expect(wrapper!.find('[data-test="close-saved-report"]').exists()).toBe(false);
    expect(wrapper!.find('[data-test="close-terminal-step"]').exists()).toBe(true);
    expect(wrapper!.emitted('saved')).toBeUndefined();
  });
  it('ignores an old account-list response after reopening', async () => {
    let resolve!: () => void;
    mocks.store.fetchCashAccounts.mockImplementationOnce(() => new Promise<void>(value => { resolve = value; }));
    mocks.request.mockRejectedValueOnce(new StaffApiError('Выберите счета', { code: 'closing_account_selection_required', status: 400 }));
    setup(); await flushPromises();
    await wrapper!.setProps({ isOpen: false }); await wrapper!.setProps({ isOpen: true }); await flushPromises();
    resolve(); await flushPromises();
    expect(wrapper!.find('[data-test="close-account-selection"]').exists()).toBe(false);
    expect(wrapper!.find('[data-test="close-terminal-step"]').exists()).toBe(true);
  });
  it('ignores an old preview response after closing and reopening', async () => {
    await preparePreview();
    let resolve!: (value: unknown) => void;
    mocks.request.mockImplementationOnce(() => new Promise(value => { resolve = value; }));
    await wrapper!.get('[data-test="close-preview"]').trigger('click');
    await wrapper!.setProps({ isOpen: false }); await wrapper!.setProps({ isOpen: true }); await flushPromises();
    resolve({ context: { ...current }, snapshot: snapshot() }); await flushPromises();
    expect(wrapper!.find('[data-test="close-preview-result"]').exists()).toBe(false);
    expect(wrapper!.get('[data-test="close-confirm"]').attributes('disabled')).toBeDefined();
    expect(completeCalls()).toHaveLength(0);
  });
  it('ignores an old history response after closing and reopening', async () => {
    setup(); await flushPromises();
    let resolve!: (value: unknown) => void;
    mocks.request.mockImplementationOnce(() => new Promise(value => { resolve = value; }));
    await wrapper!.get('[data-test="close-history-toggle"]').trigger('click');
    await wrapper!.setProps({ isOpen: false }); await wrapper!.setProps({ isOpen: true }); await flushPromises();
    resolve({ items: [saved()] }); await flushPromises();
    expect(wrapper!.find('.close-history li').exists()).toBe(false);
    await wrapper!.get('[data-test="close-history-toggle"]').trigger('click'); await flushPromises();
    expect(wrapper!.text()).toContain('Сохранённых закрытий нет');
  });
  it('does not apply a report-status response to another history report', async () => {
    current.closure = saved();
    historyItems = [{ ...saved(), id: 'fclose_previous', business_date: '2026-10-11', employee_name: 'Другой сотрудник' }];
    setup(); await flushPromises();
    await wrapper!.get('[data-test="close-history-toggle"]').trigger('click'); await flushPromises();
    let resolve!: (value: unknown) => void;
    mocks.request.mockImplementationOnce(() => new Promise(value => { resolve = value; }));
    const refreshButton = wrapper!.findAll('button').find(button => button.text() === 'Обновить статус Telegram')!;
    await refreshButton.trigger('click');
    await wrapper!.get('.close-history li button').trigger('click');
    resolve({ closure: { ...saved(), notification_status: 'sent' } }); await flushPromises();
    expect(wrapper!.get('[data-test="close-saved-report"]').text()).toContain('fclose_previous');
    expect(wrapper!.get('[data-test="close-notification"]').text()).toContain('В очереди');
  });
  it('ignores a recovery response after the window is closed', async () => {
    complete = async () => { throw new StaffApiError('Нет связи', { outcomeUnknown: true }); };
    await preparePreview();
    let resolve!: (value: unknown) => void;
    const normalRequest = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation((path: string, options?: RequestInit) => path.startsWith('/history?') ? new Promise(value => { resolve = value; }) : normalRequest(path, options));
    await wrapper!.get('[data-test="close-confirm"]').trigger('click'); await flushPromises();
    await wrapper!.setProps({ isOpen: false });
    resolve({ items: [saved()] }); await flushPromises();
    expect(wrapper!.emitted('saved')).toBeUndefined();
    expect(window.sessionStorage.getItem(PENDING_CLOSE_STORAGE_KEY)).not.toBeNull();
    expect(completeCalls()).toHaveLength(1);
  });
  it('renders the explicit close footer with default modal actions disabled', async () => {
    setup(); await flushPromises();
    expect(wrapper!.find('.close-bottom button').exists()).toBe(true);
  });
});
