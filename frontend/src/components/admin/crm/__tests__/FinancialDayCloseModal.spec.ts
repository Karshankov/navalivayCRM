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
