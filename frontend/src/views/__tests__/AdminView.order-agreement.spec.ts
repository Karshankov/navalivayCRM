import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, ref } from 'vue'
import AdminView from '@/views/AdminView.vue'
import { useAdminStore } from '@/stores/admin'

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(() => Promise.resolve()) }),
  useRoute: () => ({ path: '/admin', query: {} }),
}))

const AdminModalStub = defineComponent({
  props: ['isOpen', 'title'],
  emits: ['close', 'cancel'],
  setup(_props, { expose }) {
    const scrollContainer = ref<HTMLElement | null>(null)
    expose({ scrollContainer })
    return { scrollContainer }
  },
  template: '<section v-if="isOpen"><div ref="scrollContainer"><slot /></div></section>',
})

const wrappers: VueWrapper[] = []

async function mountSettings() {
  const store = useAdminStore()
  vi.spyOn(store, 'checkAuth').mockResolvedValue(false)
  store.isAuthenticated = true
  const wrapper = shallowMount(AdminView, {
    global: {
      stubs: {
        AdminModal: AdminModalStub,
        RouterView: true,
        // Сердечник шаблона AdminView живёт в слоте AdminLayout —
        // пробрасываем слот, чтобы проверять разметку вкладки «Настройки».
        AdminLayout: defineComponent({ template: '<div><slot /></div>' }),
      },
    },
  })
  wrappers.push(wrapper)
  await flushPromises()
  const vm = wrapper.vm as any
  vm.activeTab = 'settings'
  await flushPromises()
  return { store, wrapper, vm }
}

describe('AdminView: соглашение перед оформлением заказа', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
    vi.restoreAllMocks()
  })

  it('подставляет сохранённые тексты из настроек CRM', async () => {
    const { store, vm } = await mountSettings()
    store.settings = {
      ...store.settings,
      order_agreement_main_text: 'Основной текст из базы',
      order_agreement_small_text: 'Мелкий текст из базы',
    }
    await flushPromises()

    expect(vm.orderAgreementForm.mainText).toBe('Основной текст из базы')
    expect(vm.orderAgreementForm.smallText).toBe('Мелкий текст из базы')
  })

  it('сохраняет оба текста через updateSettings без лишних полей доставки', async () => {
    const { store, vm } = await mountSettings()
    const update = vi.spyOn(store, 'updateSettings').mockResolvedValue({} as never)

    vm.orderAgreementForm.mainText = '  Нажав кнопку, вы соглашаетесь  '
    vm.orderAgreementForm.smallText = '  Проверьте состав  '
    await vm.handleOrderAgreementSettingsUpdate()

    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0][0]).toEqual({
      order_agreement_main_text: 'Нажав кнопку, вы соглашаетесь',
      order_agreement_small_text: 'Проверьте состав',
    })
    expect(vm.orderAgreementSaving).toBe(false)
  })

  it('не оставляет в CRM прежнего раздела настроек доставки', async () => {
    const { wrapper } = await mountSettings()
    const html = wrapper.html()
    expect(html).toContain('Соглашение перед оформлением заказа')
    expect(html).not.toContain('Настройки доставки')
    expect(html).not.toContain('Баннер минимальной суммы')
  })
})