import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import FindInviterModal from '../FindInviterModal.vue';

vi.mock('@headlessui/vue', () => ({
  TransitionRoot: { props: ['show'], emits: ['after-leave'], template: '<div v-if="show"><slot /></div>' },
  TransitionChild: { template: '<div><slot /></div>' },
  Dialog: { template: '<div><slot /></div>' },
  DialogPanel: { template: '<div><slot /></div>' },
  DialogTitle: { template: '<h2><slot /></h2>' },
  DialogDescription: { template: '<p><slot /></p>' },
}));
const found = () => ({
  customer: { id: 'invitee', telegram_username: 'client_test', first_name: 'Клиент', last_name: null },
  referral: { invitee_customer_id: 'invitee', inviter_customer_id: 'inviter', inviter_username: 'actual_inviter', inviter_first_name: 'Анна', inviter_last_name: 'Иванова', inviter_invite_ban_id: null, inviter_is_invite_banned: 0 },
});
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
let wrapper: VueWrapper;
function setup() { wrapper = mount(FindInviterModal, { props: { isOpen: true, busy: false } }); return wrapper; }
async function submit(username = '@client_test') {
  await wrapper.get('[data-test="inviter-lookup-input"]').setValue(username);
  await wrapper.get('form').trigger('submit');
  await flushPromises();
}
beforeEach(() => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(found()))); });
afterEach(() => { wrapper?.unmount(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('FindInviterModal', () => {
  it('looks up the normalized exact username on submit and displays the inviter', async () => {
    setup(); await submit('  @@client_test  ');
    expect(fetch).toHaveBeenCalledWith('/api/admin/crm/customers/inviter?username=client_test', expect.objectContaining({ credentials: 'include' }));
    expect(wrapper.get('[data-test="inviter-lookup-result"]').text()).toContain('@actual_inviter');
    expect(wrapper.text()).toContain('Анна Иванова');
  });
  it('sends the saved CRM bearer token when cookie authentication is unavailable', async () => {
    const previous = window.localStorage.getItem('admin_token');
    window.localStorage.setItem('admin_token', 'lookup-test-token');
    try {
      setup(); await submit();
      expect(fetch).toHaveBeenCalledWith('/api/admin/crm/customers/inviter?username=client_test', expect.objectContaining({
        credentials: 'include', headers: expect.objectContaining({ Authorization: 'Bearer lookup-test-token' }),
      }));
    } finally {
      if (previous === null) window.localStorage.removeItem('admin_token');
      else window.localStorage.setItem('admin_token', previous);
    }
  });
  it('shows an authentication error separately from an absent inviter', async () => {
    vi.mocked(fetch).mockResolvedValue(response({ error: 'unauthorized' }, 401));
    setup(); await submit();
    expect(wrapper.get('[role="alert"]').text()).toContain('Войдите в CRM');
    expect(wrapper.find('[data-test="inviter-lookup-empty"]').exists()).toBe(false);
  });
  it.each([null, { ...found().referral, inviter_customer_id: null, inviter_username: null }])('shows the requested empty message without actions', async referral => {
    vi.mocked(fetch).mockResolvedValue(response({ ...found(), referral }));
    setup(); await submit();
    expect(wrapper.get('[data-test="inviter-lookup-empty"]').text()).toBe('Пригласивший не найден');
    expect(wrapper.find('.find-inviter-actions').exists()).toBe(false);
  });
  it('also handles a customer absent from the database', async () => {
    vi.mocked(fetch).mockResolvedValue(response({ customer: null, referral: null }));
    setup(); await submit();
    expect(wrapper.text()).toContain('Пригласивший не найден');
  });
  it('does not confuse an HTTP failure with a missing inviter and allows retry', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ message: 'Временная ошибка' }, 500)).mockResolvedValue(response(found()));
    setup(); await submit();
    expect(wrapper.get('[role="alert"]').text()).toContain('Временная ошибка');
    expect(wrapper.find('[data-test="inviter-lookup-empty"]').exists()).toBe(false);
    await wrapper.get('[role="alert"] button').trigger('click'); await flushPromises();
    expect(wrapper.find('[data-test="inviter-lookup-result"]').exists()).toBe(true);
  });
  it('rejects invalid input before making a request', async () => {
    setup(); await submit('https://t.me/client_test');
    expect(fetch).not.toHaveBeenCalled();
    expect(wrapper.get('input').attributes('aria-invalid')).toBe('true');
  });
  it('emits every action with the inviter result, not a board order', async () => {
    setup(); await submit();
    const buttons = wrapper.findAll('.find-inviter-actions button');
    for (const [index, action] of ['copy', 'message', 'block', 'invite-ban'].entries()) {
      await buttons[index].trigger('click');
      expect(wrapper.emitted('action')?.at(-1)).toEqual([action, found()]);
    }
  });
  it('offers removing the existing ban rather than adding another one', async () => {
    const result = found(); result.referral.inviter_is_invite_banned = 1;
    Object.assign(result.referral, { inviter_invite_ban_id: 'ban-1' });
    vi.mocked(fetch).mockResolvedValue(response(result));
    setup(); await submit();
    const button = wrapper.findAll('button').find(b => b.text() === 'Разрешить пригласившему приглашать')!;
    await button.trigger('click');
    expect(wrapper.emitted('action')?.at(-1)).toEqual(['remove-ban', result]);
  });
  it('cannot message a historical username without a linked customer', async () => {
    vi.mocked(fetch).mockResolvedValue(response({ ...found(), referral: { ...found().referral, inviter_customer_id: null } }));
    setup(); await submit();
    const button = wrapper.findAll('button').find(b => b.text() === 'Написать пригласившему')!;
    expect(button.attributes('disabled')).toBeDefined();
  });
  it('discards an old response when the input changes', async () => {
    let resolve!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    setup(); await wrapper.get('input').setValue('client_test'); await wrapper.get('form').trigger('submit');
    await wrapper.get('input').setValue('another_client');
    resolve(response(found())); await flushPromises();
    expect(wrapper.find('[data-test="inviter-lookup-result"]').exists()).toBe(false);
  });
  it('allows closing during a request and ignores its late response after reopening', async () => {
    let resolve!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    setup(); await wrapper.get('input').setValue('client_test'); await wrapper.get('form').trigger('submit');
    await wrapper.get('[aria-label="Закрыть поиск пригласившего"]').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
    await wrapper.setProps({ isOpen: false }); await wrapper.setProps({ isOpen: true });
    resolve(response(found())); await flushPromises();
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('');
    expect(wrapper.find('[data-test="inviter-lookup-result"]').exists()).toBe(false);
  });
  it('prevents duplicate requests while loading', async () => {
    let resolve!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    setup(); await wrapper.get('input').setValue('client_test');
    await wrapper.get('form').trigger('submit'); await wrapper.get('form').trigger('submit');
    expect(fetch).toHaveBeenCalledTimes(1);
    resolve(response(found())); await flushPromises();
  });
  it('auto-searches the prefilled username from the customer hub', async () => {
    wrapper = mount(FindInviterModal, { props: { isOpen: false, busy: false, prefill: { username: 'real_customer' } } });
    await wrapper.setProps({ isOpen: true });
    await flushPromises();
    expect(fetch).toHaveBeenCalledWith('/api/admin/crm/customers/inviter?username=real_customer', expect.objectContaining({ credentials: 'include' }));
    expect((wrapper.get('[data-test="inviter-lookup-input"]').element as HTMLInputElement).value).toBe('real_customer');
    expect(wrapper.get('[data-test="inviter-lookup-result"]').exists()).toBe(true);
  });
});
