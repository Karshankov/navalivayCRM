import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import CustomerActionsModal from '../CustomerActionsModal.vue';
import type { Order } from '@/stores/crm';

// Mock the module explicitly: its transition exports have no component name.
// Real dialog accessibility and transitions are checked separately in the browser.
vi.mock('@headlessui/vue', async () => {
  const { defineComponent } = await import('vue');
  const container = (name: string) => defineComponent({
    name,
    template: '<div><slot /></div>',
  });
  return {
    TransitionRoot: defineComponent({
      name: 'TransitionRoot',
      props: ['show'],
      emits: ['after-leave'],
      template: '<div v-if="show !== false"><slot /></div>',
    }),
    TransitionChild: container('TransitionChild'),
    Dialog: container('Dialog'),
    DialogPanel: container('DialogPanel'),
    DialogTitle: container('DialogTitle'),
    DialogDescription: container('DialogDescription'),
  };
});
const wrappers: VueWrapper[] = [];
function setup(order: Partial<Order> | null, busy = false) {
  const wrapper = mount(CustomerActionsModal, {
    props: { isOpen: true, order: order as Order | null, busy },
  });
  wrappers.push(wrapper);
  return wrapper;
}
afterEach(() => { wrappers.splice(0).forEach((wrapper) => wrapper.unmount()); });

describe('CustomerActionsModal: identity and available actions', () => {
  it('uses the actual customer identity and emits only an action intent', async () => {
    const wrapper = setup({ customer_id: 'customer-1', customer_name: 'Дима', telegram_username: '@real_customer' });
    expect(wrapper.text()).toContain('Дима');
    expect(wrapper.text()).toContain('@real_customer');
    expect(wrapper.text()).toContain('Все действия выполняются с этим клиентом');
    for (const [label, action] of [
      ['Заблокировать клиента', 'block'], ['Запретить приглашать', 'invite-ban'],
      ['Сделать заметку', 'note'], ['Написать клиенту', 'contact'],
    ]) {
      await wrapper.findAll('button').find((button) => button.text() === label)!.trigger('click');
      expect(wrapper.emitted('action')?.at(-1)).toEqual([action]);
    }
  });

  it('allows ID-based actions without inventing a username', () => {
    const wrapper = setup({ customer_id: 'customer-1', customer_telegram_id: '12345', customer_name: 'Без username' });
    expect(wrapper.text()).toContain('Telegram username не указан');
    expect(wrapper.findAll('button').filter((button) => button.attributes('disabled') !== undefined)).toHaveLength(0);
  });

  it('disables unsupported actions when the order has no target', async () => {
    const wrapper = setup({ customer_name: 'Старый заказ' });
    const actions = wrapper.findAll('.customer-actions-item');
    expect(actions).toHaveLength(4);
    for (const button of actions) {
      expect(button.attributes('disabled')).toBeDefined();
      await button.trigger('click');
    }
    expect(wrapper.emitted('action')).toBeUndefined();
    expect(wrapper.text()).toContain('нет данных клиента');
  });

  it('disables repeat blocking, preserves note editing and permits closing while busy', async () => {
    const wrapper = setup({ customer_id: 'customer-1', telegram_username: 'client', is_blocked: true });
    expect(wrapper.findAll('button').find((button) => button.text() === 'Клиент уже заблокирован')!.attributes('disabled')).toBeDefined();
    await wrapper.setProps({ busy: true });
    expect(wrapper.findAll('.customer-actions-item').every((button) => button.attributes('disabled') !== undefined)).toBe(true);
    await wrapper.get('[aria-label="Закрыть действия с клиентом"]').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('restores the opening button before notifying the parent after leave', async () => {
    const wrapper = setup({ customer_id: 'customer-1', customer_name: 'Дима' });
    document.body.appendChild(wrapper.element);
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    try {
      await wrapper.setProps({ isOpen: false });
      trigger.focus();
      await wrapper.setProps({ isOpen: true });
      (wrapper.get('.customer-actions-close').element as HTMLButtonElement).focus();
      await wrapper.setProps({ isOpen: false });
      wrapper.getComponent({ name: 'TransitionRoot' }).vm.$emit('after-leave');
      await flushPromises();
      expect(document.activeElement).toBe(trigger);
      expect(wrapper.emitted('after-leave')).toHaveLength(1);
    } finally {
      trigger.remove();
    }
  });

  it.each([true, false, undefined])('shows returning badge only for returning customers (%s)', status => {
    const wrapper = setup({ customer_name: 'Дима', is_returning_customer: status, customer_telegram_id: '12345' });
    expect(wrapper.find('[data-test="customer-returning"]').exists()).toBe(status === true);
    expect(wrapper.get('[data-test="customer-telegram-id"]').text()).toBe('Telegram ID: 12345');
    expect(wrapper.text()).not.toContain('Первый заказ');
  });

  it('does not invent a Telegram ID or display a referral when absent', () => {
    const wrapper = setup({ customer_name: 'Дима' });
    expect(wrapper.find('[data-test="customer-telegram-id"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="customer-inviter"]').exists()).toBe(false);
  });

  it('separates inviter identity and action events from customer actions', async () => {
    const wrapper = setup({ customer_id: 'customer-1', telegram_username: 'real_customer', referral: {
      invitee_customer_id: 'customer-1', inviter_customer_id: 'inviter-9', inviter_username: 'different_inviter', inviter_first_name: 'Иван', inviter_last_name: null, inviter_is_invite_banned: 0, inviter_invite_ban_id: null,
    } });
    const section = wrapper.get('[data-test="customer-inviter"]');
    expect(section.text()).toContain('Иван');
    expect(section.text()).toContain('@different_inviter');
    expect(section.find('.customer-actions-referral-options').exists()).toBe(false);
    await section.get('[aria-label="Действия с пригласившим"]').trigger('click');
    for (const [label, action] of [['Скопировать username', 'copy'], ['Написать пригласившему', 'message'], ['Заблокировать пригласившего', 'block'], ['Запретить пригласившему приглашать', 'invite-ban']]) {
      await section.findAll('button').find(button => button.text() === label)!.trigger('click');
      expect(wrapper.emitted('inviter-action')?.at(-1)).toEqual([action]);
    }
    expect(wrapper.emitted('action')).toBeUndefined();
    await wrapper.setProps({ busy: true });
    expect(section.findAll('button').every(button => button.attributes('disabled') !== undefined)).toBe(true);
  });

  it('shows the allow-invites action for a banned inviter and resets disclosure when identity changes', async () => {
    const referral = { invitee_customer_id: 'customer-1', inviter_customer_id: 'inviter-9', inviter_username: 'different_inviter', inviter_first_name: null, inviter_last_name: null, inviter_is_invite_banned: 1, inviter_invite_ban_id: 'ban-1' };
    const wrapper = setup({ id: 'order-1', referral });
    await wrapper.get('[aria-label="Действия с пригласившим"]').trigger('click');
    const allow = wrapper.findAll('button').find(button => button.text() === 'Разрешить пригласившему приглашать')!;
    expect(allow).toBeDefined();
    await allow.trigger('click');
    expect(wrapper.emitted('inviter-action')).toEqual([['remove-ban']]);
    await wrapper.setProps({ order: { id: 'order-1', referral: { ...referral, inviter_customer_id: 'other', inviter_username: 'other' } } as Order });
    expect(wrapper.find('.customer-actions-referral-options').exists()).toBe(false);
  });

  it('shows a recoverable unavailable state instead of a fabricated identity', () => {
    const wrapper = setup(null);
    expect(wrapper.text()).toContain('Заказ больше не отображается на доске');
    expect(wrapper.findAll('.customer-actions-item').every((button) => button.attributes('disabled') !== undefined)).toBe(true);
  });
});
