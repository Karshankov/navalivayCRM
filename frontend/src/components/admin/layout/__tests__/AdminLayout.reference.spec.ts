import { afterEach, describe, expect, it } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';
import AdminLayout from '../AdminLayout.vue';
import AdminSidebar from '../AdminSidebar.vue';
import { adminTabs, crmLinks } from '@/constants/adminNavigation';

let wrapper: VueWrapper | undefined;
afterEach(() => { wrapper?.unmount(); wrapper = undefined; });

async function setup(path = '/admin/crm/orders') {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/:pathMatch(.*)*', component: { template: '<div />' } },
  ] });
  await router.push(path);
  await router.isReady();
  wrapper = mount(AdminLayout, {
    props: { modelValue: 'dashboard', tabs: adminTabs, crmLinks, mainActive: false },
    slots: { default: '<div data-test="screen-content">Контент экрана</div>' },
    global: { plugins: [createPinia(), router] },
  });
  return { router, sidebar: wrapper.findComponent(AdminSidebar) };
}

describe('AdminLayout: shared reference navigation', () => {
  it('keeps the new sidebar on every destination while order-page styling stays route-scoped', async () => {
    const { router, sidebar } = await setup();
    for (const path of ['/admin/crm/orders', ...crmLinks.map(link => link.to), '/admin/crm/orders/order-1', '/admin']) {
      await router.push(path);
      await flushPromises();
      expect(wrapper!.find('.admin-reference-navigation').exists()).toBe(true);
      expect(wrapper!.find('.crm-orders-layout').exists()).toBe(path === '/admin/crm/orders');
      expect(sidebar.props('referenceDesign')).toBe(true);
      expect(sidebar.find('.crm-reference-sidebar').exists()).toBe(true);
      expect(sidebar.find('.crm-reference-brand').exists()).toBe(true);
      expect(sidebar.props('crmLinks')).toEqual(crmLinks);
      expect(sidebar.findAll('button').length).toBe(adminTabs.length + crmLinks.length + 1);
      expect(wrapper!.get('[data-test="screen-content"]').text()).toBe('Контент экрана');
    }
    await wrapper!.setProps({ mainActive: true });
    for (const tab of adminTabs) {
      await wrapper!.setProps({ modelValue: tab.id });
      expect(sidebar.findAll('.sidebar-button--main-active')).toHaveLength(1);
      expect(sidebar.get('.sidebar-button--main-active').text()).toContain(tab.name);
    }
  });

  it('preserves CRM navigation, active selection and locking', async () => {
    const { router, sidebar } = await setup();
    const destination = crmLinks.find(link => link.to !== '/admin/crm/orders')!;
    await sidebar.findAll('button').find(button => button.text().includes(destination.name))!.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe(destination.to);
    expect(sidebar.get('.sidebar-button--crm-active').text()).toContain(destination.name);
    await sidebar.get('[title="Заблокировать панель"]').trigger('click');
    expect(wrapper!.emitted('lock')).toHaveLength(1);
  });

  it('keeps the mobile navigation design outside orders and closes it on route changes', async () => {
    const { router } = await setup('/admin/crm/customers');
    const opener = document.querySelector<HTMLButtonElement>('[aria-label="Открыть меню"]');
    expect(opener).not.toBeNull();
    opener!.click();
    await flushPromises();
    const menu = document.querySelector('.crm-reference-mobile-menu');
    expect(menu).not.toBeNull();
    expect(menu!.querySelectorAll('.sidebar-button').length).toBe(adminTabs.length + crmLinks.length + 1);
    expect(document.body.style.overflow).toBe('hidden');
    await router.push('/admin/crm/orders');
    await flushPromises();
    expect(document.querySelector('.crm-reference-mobile-menu')).toBeNull();
    expect(document.body.style.overflow).not.toBe('hidden');
  });
});
