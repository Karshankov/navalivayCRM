import { afterEach, describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import CardTariffSheet, { type CardTariffPlan } from '@/components/CardTariffSheet.vue';

// Компонент рендерится через Teleport в body — ищем контент в документе.
afterEach(() => {
  document.body.innerHTML = '';
  // компонент лочит скролл (html/body overflow) — возвращаем как было
  document.documentElement.style.overflow = '';
  document.body.style.overflow = '';
});

const tariffs: CardTariffPlan[] = [
  { id: 't1', title: 'Старт', limit_minor: 5500, per_order_limit_minor: 5500, cooldown_days: 8, transition_cost_text: '10 BYN' },
  { id: 't2', title: 'Комфорт', limit_minor: 7500, per_order_limit_minor: 7500, transition_cost_text: '20 BYN' },
  { id: 't3', title: 'Максимум', limit_minor: 12000, per_order_limit_minor: 12000, cooldown_days: null, transition_cost_text: '35 BYN' },
];

function mountSheet(overrides: Record<string, unknown> = {}): VueWrapper {
  return mount(CardTariffSheet, {
    props: {
      open: true,
      tariffs,
      modelValue: 't1',
      ...overrides,
    },
    attachTo: document.body,
  });
}

function root() {
  return document.body.querySelector('.tariff-sheet-preview') as HTMLElement;
}

describe('CardTariffSheet — дизайн выбора тарифа', () => {
  it('показывает заголовок, подпись и круглую кнопку закрытия', () => {
    mountSheet();
    const el = root();
    expect(el.querySelector('.tariff-sheet h1')!.textContent!.trim()).toBe('Увеличить лимиты');
    expect(el.querySelector('.tariff-sheet-top p')!.textContent).toContain('заявка поступит продавцу');
    expect(el.querySelector('button[aria-label="Закрыть"]')).toBeTruthy();
  });

  it('разделитель между днями и суммой стоит ровно в центре ряда', () => {
    mountSheet();
    const details = root()!.querySelector('.tariff-plan-details')!;
    expect(details.classList.contains('tariff-plan-details')).toBe(true);
    const divider = details.querySelector('.tariff-plan-divider')!;
    expect(divider).toBeTruthy();
    // Половины равные: разделитель 1px ровно в середине
    const rect = details.getBoundingClientRect();
    const dRect = divider.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    expect(Math.abs(dRect.left - center)).toBeLessThan(2);
  });

  it('рисует карточки тарифов с ценой за переход, паузой и лимитом заказа', () => {
    mountSheet();
    const plans = Array.from(root()!.querySelectorAll('.tariff-plan'));
    expect(plans).toHaveLength(3);
    const text = (el: Element | null | undefined, sel: string) =>
      el!.querySelector(sel)!.textContent!.trim();

    expect(text(plans[0], '.tariff-plan-name')).toBe('Старт');
    expect(text(plans[0], '.tariff-plan-price strong')).toBe('10 BYN');
    expect(text(plans[0], '.tariff-plan-price span')).toBe('за переход');
    expect(text(plans[0], '.tariff-plan-detail .tariff-plan-small')).toBe('Доступно раз в');
    expect(text(plans[0], '.tariff-plan-detail b')).toBe('8 дней');
    expect(plans[0]!.querySelectorAll('.tariff-plan-detail b')[1]!.textContent!.trim()).toBe('55 BYN');

    // Тариф без cooldown_days берёт паузу аккаунта (фолбэк 10)
    expect(text(plans[1], '.tariff-plan-detail b')).toBe('10 дней');
    // cooldown_days: null тоже фолбэк
    expect(text(plans[2], '.tariff-plan-detail b')).toBe('10 дней');
    expect(plans[2]!.querySelectorAll('.tariff-plan-detail b')[1]!.textContent!.trim()).toBe('120 BYN');
  });

  it('плашки «ПОПУЛЯРНЫЙ» и ручки сверху нет', () => {
    mountSheet();
    expect(root()!.querySelectorAll('.tariff-plan-popular')).toHaveLength(0);
    expect(root()!.querySelectorAll('.tariff-sheet-handle')).toHaveLength(0);
  });

  it('выбор тарифа эмитит модель и подсвечивает карточку', async () => {
    const wrapper = mountSheet();
    const plan = root()!.querySelectorAll('.tariff-plan')[1]! as HTMLElement;
    plan.click();
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['t2']);
    await wrapper.setProps({ modelValue: 't2' });
    const plans = Array.from(root()!.querySelectorAll('.tariff-plan'));
    expect(plans[1]!.classList.contains('tariff-plan--selected')).toBe(true);
  });

  it('кнопка «Отправить заявку» эмитит submit и блокируется при кулдауне', async () => {
    const wrapper = mountSheet();
    const submit = () => root()!.querySelector<HTMLButtonElement>('.tariff-sheet-submit')!;
    expect(submit().textContent!.trim()).toBe('Отправить заявку');
    submit().click();
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('submit')).toHaveLength(1);

    await wrapper.setProps({ requestBlocked: true });
    expect(submit().disabled).toBe(true);
    await wrapper.setProps({ sending: true });
    expect(submit().textContent!.trim()).toBe('Отправляем…');
  });

  it('успешный диалог «Заявка отправлена» с кнопкой «Понятно»', async () => {
    const wrapper = mountSheet({ success: true, successText: 'Тариф «Старт»: лимит заказа до 55 BYN.' });
    const overlay = document.body.querySelector('.tariff-sheet-overlay.show')!;
    expect(overlay).toBeTruthy();
    expect(overlay.querySelector('h2')!.textContent!.trim()).toBe('Заявка отправлена');
    expect(overlay.querySelector('p')!.textContent).toContain('лимит заказа до 55 BYN');
    overlay.querySelector<HTMLButtonElement>('button')!.click();
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('dismiss-success')).toHaveLength(1);
  });

  it('ошибка показывается строкой над кнопкой', () => {
    mountSheet({ error: 'Повторно отправить заявку можно через час.' });
    expect(root()!.querySelector('.tariff-sheet-error')!.textContent).toContain('через час');
  });
});
