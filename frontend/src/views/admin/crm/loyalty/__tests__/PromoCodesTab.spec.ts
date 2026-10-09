import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import PromoCodesTab from "@/views/admin/crm/loyalty/PromoCodesTab.vue";

const fetchPromoCodesMock = vi.fn();
const createPromoCodeMock = vi.fn();
const updatePromoCodeMock = vi.fn();
const deletePromoCodeMock = vi.fn();
const fetchPromoUsageMock = vi.fn();
const promoStoreState = vi.hoisted(() => ({
  promoCodes: [] as any[],
  promoCodesTotal: 0,
}));

vi.mock("@/stores/crm", () => ({
  useCrmStore: () => ({
    get promoCodes() {
      return promoStoreState.promoCodes;
    },
    get promoCodesTotal() {
      return promoStoreState.promoCodesTotal;
    },
    promoCodesLoading: false,
    fetchPromoCodes: fetchPromoCodesMock,
    createPromoCode: createPromoCodeMock,
    updatePromoCode: updatePromoCodeMock,
    deletePromoCode: deletePromoCodeMock,
    fetchPromoUsage: fetchPromoUsageMock,
  }),
}));

function buildPromo(overrides: Record<string, unknown> = {}) {
  return {
    id: "promo-1",
    code: "SAVE10",
    description: null,
    customer_description: "Скидка для клиента",
    manager_description: "Проверить состав заказа",
    has_gift: 0,
    is_wheel_template: 0,
    is_wheel_generated: 0,
    wheel_owner_customer_id: null,
    discount_type: "fixed",
    discount_value: 10,
    min_order_amount: 0,
    max_uses: 1,
    current_uses: 0,
    valid_from_date: null,
    duration_days: null,
    valid_from: null,
    valid_until: null,
    active: 1,
    created_at: "2026-07-19",
    ...overrides,
  };
}

async function openFirstPromoForEditing(wrapper: ReturnType<typeof mount>) {
  const editButton = wrapper.find('button[title="Редактировать"]');
  expect(editButton.exists()).toBe(true);
  await editButton.trigger("click");
  await flushPromises();
}

describe("PromoCodesTab", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    promoStoreState.promoCodes.splice(0);
    promoStoreState.promoCodesTotal = 0;
    fetchPromoCodesMock.mockResolvedValue(undefined);
    createPromoCodeMock.mockResolvedValue({ id: "promo-gift-zero" });
    updatePromoCodeMock.mockResolvedValue(undefined);
    deletePromoCodeMock.mockResolvedValue(undefined);
    fetchPromoUsageMock.mockResolvedValue([]);
  });

  it("loads regular promo codes by default and can switch to wheel codes", async () => {
    const wrapper = mount(PromoCodesTab);
    await flushPromises();

    expect(fetchPromoCodesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "regular",
        limit: 100,
        offset: 0,
      }),
    );

    await wrapper.findAll("button").find((item) => item.text().includes("Рулетка"))!.trigger("click");
    await flushPromises();

    expect(fetchPromoCodesMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        source: "wheel",
        limit: 100,
        offset: 0,
      }),
    );
  });

  it("shows list summary and loads more promos when total exceeds loaded count", async () => {
    promoStoreState.promoCodes.push(
      {
        id: "promo-1",
        code: "SAVE1",
        description: "Promo 1",
        customer_description: "Promo 1",
        manager_description: null,
        has_gift: 0,
        is_wheel_template: 0,
        discount_type: "fixed",
        discount_value: 5,
        min_order_amount: 0,
        max_uses: 1,
        current_uses: 0,
        valid_from: null,
        valid_until: null,
        active: 1,
        created_at: "2026-06-01",
      },
    );
    promoStoreState.promoCodesTotal = 3;

    const wrapper = mount(PromoCodesTab);
    await flushPromises();

    expect(wrapper.text()).toContain("Показано 1 из 3");

    fetchPromoCodesMock.mockClear();
    await wrapper.findAll("button").find((item) => item.text() === "Показать ещё")!.trigger("click");
    await flushPromises();

    expect(fetchPromoCodesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 100,
        offset: 1,
        append: true,
      }),
    );
  });

  it("marks only wheel promo templates with a badge", async () => {
    promoStoreState.promoCodes.push(
      {
        id: "template-1",
        code: "SPIN-TEMPLATE",
        description: "Wheel template",
        customer_description: "Wheel template",
        manager_description: null,
        has_gift: 0,
        is_wheel_template: 1,
        is_wheel_generated: 0,
        wheel_owner_customer_id: null,
        discount_type: "fixed",
        discount_value: 5,
        min_order_amount: 0,
        max_uses: 10,
        current_uses: 0,
        valid_from: null,
        valid_until: null,
        active: 1,
        created_at: "2026-06-01",
      },
      {
        id: "issued-1",
        code: "WHEEL-123456",
        description: "Issued by wheel",
        customer_description: "Issued by wheel",
        manager_description: null,
        has_gift: 0,
        is_wheel_template: 0,
        is_wheel_generated: 1,
        wheel_owner_customer_id: "customer-1",
        discount_type: "fixed",
        discount_value: 5,
        min_order_amount: 0,
        max_uses: 1,
        current_uses: 0,
        valid_from: null,
        valid_until: null,
        active: 1,
        created_at: "2026-06-01",
      },
    );

    const wrapper = mount(PromoCodesTab);
    await flushPromises();

    expect(wrapper.text()).toContain("Шаблон рулетки");
    expect(wrapper.text()).not.toContain("Выдан рулеткой");
  });

  it("submits zero discount as a gift promo without a separate checkbox", async () => {
    const wrapper = mount(PromoCodesTab);
    await flushPromises();

    await wrapper.findAll("button").find((item) => item.text().includes("Создать"))!.trigger("click");
    await flushPromises();

    await wrapper.find('input[type="text"]').setValue("ZERO");
    await wrapper.find('input[type="number"]').setValue("0");
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(wrapper.text()).not.toContain("Есть подарок к заказу");
    expect(createPromoCodeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "ZERO",
        discount_value: 0,
        has_gift: 1,
      }),
    );
  });

  it("keeps the promo form inside the viewport and scrolls only its fields", async () => {
    const wrapper = mount(PromoCodesTab);
    await flushPromises();

    await wrapper.findAll("button").find((item) => item.text().includes("Создать"))!.trigger("click");
    await flushPromises();

    const modal = wrapper.get('[data-testid="promo-form-modal"]');
    const scrollArea = wrapper.get('[data-testid="promo-form-scroll"]');
    const actions = wrapper.get('button[type="submit"]').element.parentElement;

    expect(modal.classes()).toContain("max-h-[calc(100dvh-2rem)]");
    expect(modal.classes()).toContain("overflow-hidden");
    expect(modal.attributes("role")).toBe("dialog");
    expect(modal.attributes("aria-labelledby")).toBe("promo-form-title");
    expect(scrollArea.classes()).toContain("overflow-y-auto");
    expect(scrollArea.element.contains(actions)).toBe(false);
    expect(actions?.classList.contains("flex-col")).toBe(true);
    expect(actions?.classList.contains("sm:flex-row")).toBe(true);
  });

  it("submits positive discount as a regular promo", async () => {
    const wrapper = mount(PromoCodesTab);
    await flushPromises();

    await wrapper.findAll("button").find((item) => item.text().includes("Создать"))!.trigger("click");
    await flushPromises();

    await wrapper.find('input[type="text"]').setValue("SAVE10");
    await wrapper.find('input[type="number"]').setValue("10");
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(createPromoCodeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "SAVE10",
        discount_value: 10,
        has_gift: 0,
      }),
    );
  });

  it("hides the legacy prize title for a regular promo", async () => {
    promoStoreState.promoCodes.push(buildPromo({
      description: "Старый заголовок",
      customer_description: "Актуальное описание",
    }));

    const wrapper = mount(PromoCodesTab);
    await flushPromises();

    expect(wrapper.text()).toContain("Актуальное описание");
    await openFirstPromoForEditing(wrapper);

    expect(wrapper.find("#promo-prize-title").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Название приза");
  });

  it("shows a clearly named prize title only for a wheel template", async () => {
    promoStoreState.promoCodes.push(buildPromo({
      description: "Одноразка в подарок",
      customer_description: "Добавьте товар в корзину",
      is_wheel_template: 1,
    }));

    const wrapper = mount(PromoCodesTab);
    await flushPromises();
    await openFirstPromoForEditing(wrapper);

    expect(wrapper.find("#promo-prize-title").exists()).toBe(true);
    expect(wrapper.text()).toContain("Название приза");
    expect(wrapper.text()).toContain("Показывается на рулетке и в окне выигрыша.");
    expect((wrapper.find("#promo-prize-title").element as HTMLInputElement).value).toBe("Одноразка в подарок");
  });

  it("blocks bounded promo saving when days are entered without a start date", async () => {
    promoStoreState.promoCodes.push(buildPromo());

    const wrapper = mount(PromoCodesTab);
    await flushPromises();
    await openFirstPromoForEditing(wrapper);

    await wrapper.find('input[type="checkbox"]').setValue(false);
    await wrapper.find("#promo-duration-days").setValue("25");
    const startDateFocusSpy = vi.spyOn(wrapper.find("#promo-valid-from-date").element as HTMLInputElement, "focus");
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(updatePromoCodeMock).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Укажите дату начала действия промокода");
    expect(startDateFocusSpy).toHaveBeenCalledTimes(1);
  });

  it("saves the exact bounded duration when the start date is filled", async () => {
    promoStoreState.promoCodes.push(buildPromo());

    const wrapper = mount(PromoCodesTab);
    await flushPromises();
    await openFirstPromoForEditing(wrapper);

    await wrapper.find('input[type="checkbox"]').setValue(false);
    await wrapper.find("#promo-valid-from-date").setValue("2026-07-19");
    await wrapper.find("#promo-duration-days").setValue("25");
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(updatePromoCodeMock).toHaveBeenCalledWith(
      "promo-1",
      expect.objectContaining({
        valid_from_date: "2026-07-19",
        duration_days: 25,
      }),
    );
    expect(wrapper.text()).toContain("Промокод сохранён.");
  });

  it("preserves a wheel template duration without requiring a calendar date", async () => {
    promoStoreState.promoCodes.push(buildPromo({
      description: "Приз рулетки",
      is_wheel_template: 1,
      duration_days: 21,
    }));

    const wrapper = mount(PromoCodesTab);
    await flushPromises();
    await openFirstPromoForEditing(wrapper);
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(wrapper.find("#promo-valid-from-date").exists()).toBe(false);
    expect(updatePromoCodeMock).toHaveBeenCalledWith(
      "promo-1",
      expect.objectContaining({
        duration_days: 21,
        valid_from_date: null,
      }),
    );
  });

  it("requires a prize title when editing a wheel template", async () => {
    promoStoreState.promoCodes.push(buildPromo({
      description: "Приз рулетки",
      is_wheel_template: 1,
      duration_days: 21,
    }));

    const wrapper = mount(PromoCodesTab);
    await flushPromises();
    await openFirstPromoForEditing(wrapper);

    await wrapper.find("#promo-prize-title").setValue("");
    const titleFocusSpy = vi.spyOn(wrapper.find("#promo-prize-title").element as HTMLInputElement, "focus");
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(updatePromoCodeMock).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Укажите название приза");
    expect(titleFocusSpy).toHaveBeenCalledTimes(1);
  });

  it("clears stale validity errors when switching to perpetual mode", async () => {
    promoStoreState.promoCodes.push(buildPromo());

    const wrapper = mount(PromoCodesTab);
    await flushPromises();
    await openFirstPromoForEditing(wrapper);

    const perpetualCheckbox = wrapper.find('input[type="checkbox"]');
    await perpetualCheckbox.setValue(false);
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();
    expect(wrapper.text()).toContain("Укажите дату начала действия промокода");
    expect(wrapper.text()).toContain("Укажите целое число дней больше 0");

    await perpetualCheckbox.setValue(true);
    await flushPromises();
    expect(wrapper.text()).not.toContain("Укажите дату начала действия промокода");
    expect(wrapper.text()).not.toContain("Укажите целое число дней больше 0");
  });

  it("clears the hidden legacy title when a regular promo is explicitly saved", async () => {
    promoStoreState.promoCodes.push(buildPromo({
      description: "Старый скрытый заголовок",
      customer_description: "Старое описание",
      manager_description: "Старая инструкция",
    }));

    const wrapper = mount(PromoCodesTab);
    await flushPromises();
    await openFirstPromoForEditing(wrapper);

    await wrapper.find("#promo-customer-description").setValue("");
    await wrapper.find("#promo-manager-description").setValue("");
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(updatePromoCodeMock).toHaveBeenCalledWith(
      "promo-1",
      expect.objectContaining({
        description: null,
        customer_description: null,
        manager_description: null,
      }),
    );
  });
});
