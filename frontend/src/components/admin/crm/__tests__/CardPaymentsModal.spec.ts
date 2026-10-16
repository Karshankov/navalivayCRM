import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import CardPaymentsModal from "@/components/admin/crm/CardPaymentsModal.vue";

const crmStoreMock = vi.hoisted(() => ({
  cardPaymentAdminSnapshot: null as Record<string, unknown> | null,
  loadingCardPaymentAdmin: false,
  fetchCardPaymentAdmin: vi.fn(async () => undefined),
  setCardMonthlyLimit: vi.fn(async () => undefined),
  increaseCardDailyLimit: vi.fn(async () => undefined),
  addManualCardPayment: vi.fn(async () => undefined),
  saveCardAccount: vi.fn(async () => undefined),
  updateCardAccount: vi.fn(async () => undefined),
  updateCardRequest: vi.fn(async () => undefined),
  saveCardTariff: vi.fn(async () => undefined),
  deleteCardTariff: vi.fn(async () => undefined),
  applyCardTariff: vi.fn(async () => undefined),
  approveCardRequest: vi.fn(async () => undefined),
  markCardRequestsAsSeen: vi.fn(() => undefined),
  unseenCardRequestCount: 0,
  searchCardProfile: vi.fn(async () => ({
    source: "linked",
    telegram_id: "100001",
    telegram_username: "alice",
    enabled: true,
    monthly_limit_minor: 25000,
    max_order_minor: 4500,
    tariff_id: "t1",
    tariff_title: "Максимум",
    cooldown_started_at: null,
    cooldown_until: null,
    cooldown_days_left: 0,
    last_issued_at: null,
  })),
}));

vi.mock("@/stores/crm", () => ({
  useCrmStore: () => crmStoreMock,
}));

const adminModalStubFactory = vi.hoisted(() => (vue: typeof import("vue")) =>
  vue.defineComponent({
    props: ["isOpen", "title", "description", "size", "showActions"],
    emits: ["close", "cancel"],
    setup(props: Record<string, unknown>, { slots }: { slots: Record<string, any> }) {
      return () =>
        vue.h("div", { "data-stub": "admin-modal" }, [
          vue.h("div", { class: "stub-description" }, String(props.description ?? "")),
          slots.default?.(),
        ]);
    },
  }),
);

vi.mock("@/components/AdminModal.vue", async () => {
  const vue = await import("vue");
  return { default: adminModalStubFactory(vue) };
});

const crmButtonStubFactory = vi.hoisted(() => (vue: typeof import("vue")) =>
  vue.defineComponent({
    props: ["variant", "size", "loading", "type", "block", "title", "disabled"],
    emits: ["click"],
    setup(props: Record<string, unknown>, { slots, emit }: { slots: Record<string, any>; emit: any }) {
      return () =>
        vue.h(
          "button",
          {
            type: (props.type as string) || "button",
            "data-variant": String(props.variant || ""),
            onClick: (event: MouseEvent) => emit("click", event),
          },
          slots.default?.(),
        );
    },
  }),
);

vi.mock("@/components/admin/crm/CrmButton.vue", async () => {
  const vue = await import("vue");
  return { default: crmButtonStubFactory(vue) };
});

function snapshotFixture() {
  return {
    limits: {
      business_date: "2026-10-09",
      month_key: "2026-10",
      monthly_limit_minor: 300000,
      spent_month_minor: 120000,
      remaining_month_minor: 180000,
      base_daily_limit_minor: 9000,
      daily_increase_minor: 2000,
      daily_limit_minor: 11000,
      spent_today_minor: 4000,
      reserved_minor: 1500,
      committed_today_minor: 5500,
      remaining_today_minor: 5500,
      can_start_order: true,
    },
    accounts: [
      {
        telegram_id: "100001",
        telegram_username: "alice",
        enabled: 1,
        max_order_minor: 4500,
        monthly_limit_minor: 25000,
        cooldown_started_at: "2026-10-08T13:53:51.410Z",
        last_issued_at: "2026-10-08T13:53:51.410Z",
        tariff_id: "t1",
        tariff_title: "Максимум",
        tariff_monthly_limit_minor: 35000,
        tariff_per_order_limit_minor: 6000,
        tariff_transition_cost_text: "35 BYN",
      },
      {
        telegram_id: "100002",
        telegram_username: "bob",
        enabled: 0,
        max_order_minor: 3000,
        monthly_limit_minor: 25000,
        cooldown_started_at: null,
        last_issued_at: null,
        tariff_id: null,
        tariff_title: null,
        tariff_monthly_limit_minor: null,
        tariff_per_order_limit_minor: null,
        tariff_transition_cost_text: null,
      },
    ],
    pending_accounts: [
      { telegram_username: "carol", enabled: 1, max_order_minor: 4500, monthly_limit_minor: 25000 },
    ],
    tariffs: [
      { id: "t1", title: "Максимум", limit_minor: 13000, monthly_limit_minor: 35000, per_order_limit_minor: 6000, transition_cost_text: "35 BYN", position: 0, active: 1 },
      { id: "t2", title: "Архивный", limit_minor: 5000, monthly_limit_minor: 5000, per_order_limit_minor: 4500, transition_cost_text: null, position: 1, active: 0 },
    ],
    requests: [
      {
        id: "r1",
        telegram_id: "100001",
        telegram_username: "alice",
        tariff_id: "t1",
        tariff_title: "Максимум",
        current_limit_minor: 4500,
        requested_limit_minor: 13000,
        tariff_transition_cost_text: "35 BYN",
        tariff_monthly_limit_minor: 35000,
        tariff_per_order_limit_minor: 6000,
        status: "new",
        created_at: "2026-10-08T00:03:11Z",
        resolved_by: null,
        resolution_note: null,
      },
      {
        id: "r2",
        telegram_id: "100003",
        telegram_username: "dave",
        tariff_title: null,
        current_limit_minor: 4500,
        requested_limit_minor: 9000,
        status: "processed",
        created_at: "2026-10-07T22:25:43Z",
        resolved_by: "admin",
        resolution_note: null,
      },
    ],
    operations: [
      {
        id: "op1",
        operation_type: "manual",
        operation_status: "spent",
        order_id: null,
        order_number: null,
        customer_telegram_id: null,
        amount_minor: 1500,
        business_date: "2026-10-09",
        note: "проходящий",
        actor_username: "admin",
        created_at: "2026-10-09T10:00:00Z",
        issued_at: null,
        reversed_at: null,
      },
      {
        id: "op2",
        operation_type: "order",
        operation_status: "spent",
        order_id: "order-9",
        order_number: 9116,
        customer_telegram_id: "100001",
        amount_minor: 4000,
        business_date: "2026-10-09",
        note: null,
        actor_username: null,
        created_at: "2026-10-09T09:00:00Z",
        issued_at: "2026-10-09T09:05:00Z",
        reversed_at: null,
      },
    ],
  };
}

function mountModal() {
  return mount(CardPaymentsModal, {
    props: { isOpen: true },
    global: {
      stubs: {
        teleport: true,
        transition: false,
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  crmStoreMock.cardPaymentAdminSnapshot = snapshotFixture();
  crmStoreMock.loadingCardPaymentAdmin = false;
});

const defaultSearchProfile = crmStoreMock.searchCardProfile;

describe("CardPaymentsModal — вкладки и сводка", () => {
  it("включает новый дизайн локально и сохраняет семантику индикаторов", () => {
    const wrapper = mountModal();
    expect(wrapper.find('[data-stub="admin-modal"]').attributes('reference-design')).toBeDefined();
    expect(wrapper.find('.crm-card-payments').exists()).toBe(true);
    expect(wrapper.find('.crm-card-tabs').exists()).toBe(true);
    expect(wrapper.findAll('.crm-card-stat')).toHaveLength(2);
    const bars = wrapper.findAll('[role="progressbar"]');
    expect(bars).toHaveLength(2);
    expect(bars[0].attributes('aria-valuenow')).toBe('50');
    expect(bars[1].attributes('aria-valuenow')).toBe('40');
    expect(wrapper.find('.crm-card-workspace').classes()).toContain('overflow-y-auto');
  });

  it("показывает предупреждение и значок при превышении дневного лимита", () => {
    const snapshot = snapshotFixture();
    Object.assign(snapshot.limits, { exceeded_today_minor: 1500 });
    crmStoreMock.cardPaymentAdminSnapshot = snapshot;
    const wrapper = mountModal();
    expect(wrapper.find('[role="alert"]').text()).toContain('Дневной лимит превышен на 15.00 BYN');
    expect(wrapper.find('[role="alert"] svg').exists()).toBe(true);
  });

  it("ручное пробитие сохраняет исходные сумму и комментарий", async () => {
    const wrapper = mountModal();
    await wrapper.find('#card-manual-input').setValue(12.5);
    await wrapper.find('input[aria-label="Комментарий к пробитию"]').setValue('Проходящий клиент');
    await wrapper.find('#card-manual-input').element.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await nextTick();
    expect(crmStoreMock.addManualCardPayment).toHaveBeenCalledWith(12.5, 'Проходящий клиент');
  });

  it("сохраняет фиксированную высоту области контента при переключении вкладок", async () => {
    const wrapper = mountModal();
    const content = wrapper.find(".h-\\[min\\(600px\\,calc\\(100dvh-14rem\\)\\)\\]");
    expect(content.exists()).toBe(true);
    expect(content.classes()).toContain("overflow-y-auto");
    const tabButtons = wrapper.findAll("nav button");
    expect(tabButtons.map((b) => b.text())).toEqual(["Лимиты", "Аккаунты", "Заявки 1", "Тарифы"]);
    expect(wrapper.text()).toContain("Сегодня");
    expect(wrapper.text()).toContain("55.00");
    expect(wrapper.text()).toContain("из 110.00");
    expect(wrapper.text()).toContain("55.00 BYN свободно");
    for (const tab of tabButtons.slice(1)) {
      await tab.trigger("click");
      expect(wrapper.find(".h-\\[min\\(600px\\,calc\\(100dvh-14rem\\)\\)\\]").exists()).toBe(true);
    }
  });

  it("показывает разбивку дня: выдано, резервы и добавку", () => {
    const wrapper = mountModal();
    expect(wrapper.text()).toContain("Выдано: 40.00 BYN");
    expect(wrapper.text()).toContain("Резервы: 15.00 BYN");
    expect(wrapper.text()).toContain("Корректировка: +20.00 BYN");
  });

  it("в операциях за сегодня видны и заказы, и ручные пробития", () => {
    const wrapper = mountModal();
    expect(wrapper.text()).toContain("Заказ №9116");
    expect(wrapper.text()).toContain("Ручное");
    expect(wrapper.text()).toContain("проходящий");
    expect(wrapper.text()).toContain("55 BYN за день");
  });

  it("на вкладке «Заявки» бейдж показывает только новые заявки", async () => {
    const wrapper = mountModal();
    const requestsTab = wrapper.findAll("nav button").find((b) => b.text().includes("Заявки"))!;
    await requestsTab.trigger("click");
    expect(wrapper.text()).toContain("Новых: 1");
    expect(wrapper.text()).toContain("@alice");
    expect(wrapper.text()).toContain("Тариф «Максимум»");
  });
});

describe("CardPaymentsModal — аккаунты", () => {
  async function openAccounts(wrapper: ReturnType<typeof mountModal>) {
    const tab = wrapper.findAll("nav button").find((b) => b.text().includes("Аккаунты"))!;
    await tab.trigger("click");
    await nextTick();
  }

  it("показывает недавние разрешения как быстрые ссылки, клик открывает карточку", async () => {
    const wrapper = mountModal();
    await openAccounts(wrapper);
    // Список отдаёт сервер: 3 недавних. Полного списка больше нет.
    expect(wrapper.text()).toContain("Последние разрешения");
    const recent = wrapper
      .findAll("button")
      .find((b) => b.attributes("aria-label") === "Открыть карточку @alice");
    expect(recent).toBeTruthy();
    await recent!.trigger("click");
    expect(crmStoreMock.searchCardProfile).toHaveBeenCalledWith("alice");
  });

  it("новый клиент: 404 от поиска превращается в карточку создания разрешения", async () => {
    crmStoreMock.searchCardProfile = vi.fn(async () => {
      const error = new Error("not found") as Error & { status?: number };
      error.status = 404;
      throw error;
    });
    const wrapper = mountModal();
    await openAccounts(wrapper);
    await wrapper.find('input[aria-label="Telegram username без собаки"]').setValue("@newbie");
    await wrapper.find("form").trigger("submit");
    expect(wrapper.text()).toContain("новый клиент");
    const allow = wrapper.findAll("button").find((b) => b.text() === "Разрешить оплату картой");
    expect(allow).toBeTruthy();
    await allow!.trigger("click");
    // Разрешение новому выдаётся по username
    expect(crmStoreMock.saveCardAccount).toHaveBeenCalledWith({
      telegram_username: "newbie",
      enabled: true,
    });
    wrapper.unmount();
    crmStoreMock.searchCardProfile = defaultSearchProfile;
  });

  it("поиск по @username загружает карточку клиента и разрешение в один клик", async () => {
    const wrapper = mountModal();
    await openAccounts(wrapper);
    await wrapper.find("form").trigger("submit");
    expect(crmStoreMock.searchCardProfile).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Введите @username клиента.");
    await wrapper.find('input[aria-label="Telegram username без собаки"]').setValue("@alice");
    await wrapper.find("form").trigger("submit");
    expect(crmStoreMock.searchCardProfile).toHaveBeenCalledWith("alice");

    const toggle = wrapper.findAll("button").find((b) => b.text() === "Запретить оплату картой");
    expect(toggle).toBeTruthy();
    await toggle!.trigger("click");
    expect(crmStoreMock.updateCardAccount).toHaveBeenCalledWith("100001", { enabled: false });
  });

  it("серверная ошибка поиска показывает понятное сообщение", async () => {
    crmStoreMock.searchCardProfile = vi.fn(async () => {
      throw new Error("Network failure");
    });
    const wrapper = mountModal();
    await openAccounts(wrapper);
    await wrapper.find('input[aria-label="Telegram username без собаки"]').setValue("@ghost");
    await wrapper.find("form").trigger("submit");
    expect(wrapper.text()).toContain("Network failure");
    wrapper.unmount();
    crmStoreMock.searchCardProfile = defaultSearchProfile;
  });

  it("в форме нет полей ручного ввода лимитов", async () => {
    const wrapper = mountModal();
    await openAccounts(wrapper);
    expect(wrapper.find('input[aria-label="Месячный лимит аккаунта BYN"]').exists()).toBe(false);
    expect(wrapper.find('input[aria-label="Лимит одного заказа BYN"]').exists()).toBe(false);
  });
});

describe("CardPaymentsModal — тарифы и заявки", () => {
  it("карточка аккаунта показывает тариф и селектор с активными тарифами", async () => {
    const wrapper = mountModal();
    const tab = wrapper.findAll("nav button").find((b) => b.text().includes("Аккаунты"))!;
    await tab.trigger("click");
    await wrapper.find('input[aria-label="Telegram username без собаки"]').setValue("@alice");
    await wrapper.find("form").trigger("submit");
    await new Promise((r) => setTimeout(r, 0));
    const select = wrapper.find('select[aria-label="Тариф для alice"]');
    expect(select.exists()).toBe(true);
    expect(select.element.value).toBe("t1");
    const options = select.findAll("option");
    expect(options.map((o) => o.text())).toEqual([
      "Стандарт (45 BYN на заказ)",
      "Максимум · 60 BYN на заказ",
    ]);
    // Неактивный тариф не показывается в селекторе
    expect(options.some((o) => o.text().includes("Архивный"))).toBe(false);
  });

  it("смена тарифа в селекторе вызывает applyCardTariff", async () => {
    const wrapper = mountModal();
    const tab = wrapper.findAll("nav button").find((b) => b.text().includes("Аккаунты"))!;
    await tab.trigger("click");
    await wrapper.find('input[aria-label="Telegram username без собаки"]').setValue("@alice");
    await wrapper.find("form").trigger("submit");
    await new Promise((r) => setTimeout(r, 0));
    const select = wrapper.find('select[aria-label="Тариф для alice"]');
    await select.setValue("");
    expect(crmStoreMock.applyCardTariff).toHaveBeenCalledWith("100001", null);
    await select.setValue("t1");
    expect(crmStoreMock.applyCardTariff).toHaveBeenCalledWith("100001", "t1");
  });

  it("заявка показывает тариф, стоимость и лимиты тарифа", async () => {
    const wrapper = mountModal();
    const tab = wrapper.findAll("nav button").find((b) => b.text().includes("Заявки"))!;
    await tab.trigger("click");
    expect(wrapper.text()).toContain("Тариф «Максимум»");
    expect(wrapper.text()).toContain("стоимость: 35 BYN");
    expect(wrapper.text()).toContain("Тариф: до 60.00 BYN на заказ");
    expect(wrapper.text()).not.toContain("/мес");
  });

  it("кнопка «Одобрить» вызывает approveCardRequest", async () => {
    const wrapper = mountModal();
    const tab = wrapper.findAll("nav button").find((b) => b.text().includes("Заявки"))!;
    await tab.trigger("click");
    const approveButton = wrapper
      .findAll("button")
      .find((b) => b.text() === "Одобрить");
    expect(approveButton).toBeTruthy();
    await approveButton!.trigger("click");
    expect(crmStoreMock.approveCardRequest).toHaveBeenCalledWith("r1");
    // Кнопка «Обработана» заменена на «Одобрить»
    expect(wrapper.findAll("button").some((b) => b.text() === "Обработана")).toBe(false);
  });

  it("форма тарифа содержит лимит заказа и паузу", async () => {
    const wrapper = mountModal();
    const tab = wrapper.findAll("nav button").find((b) => b.text().includes("Тарифы"))!;
    await tab.trigger("click");
    expect(wrapper.text()).toContain("Максимум · до 60.00 BYN на заказ");
    const addButton = wrapper.findAll("button").find((b) => b.text().includes("Добавить"));
    await addButton!.trigger("click");
    expect(wrapper.find('input[aria-label="Месячный лимит тарифа BYN"]').exists()).toBe(false);
    expect(wrapper.find('input[aria-label="Лимит заказа тарифа BYN"]').exists()).toBe(true);
    expect(wrapper.find('input[aria-label="Длительность паузы тарифа в днях, пусто — не менять"]').exists()).toBe(true);
  });
});

describe("CardPaymentsModal — подтверждения", () => {
  it("отклонение заявки спрашивает подтверждение вместо мгновенного действия", async () => {
    const wrapper = mountModal();
    const tab = wrapper.findAll("nav button").find((b) => b.text().includes("Заявки"))!;
    await tab.trigger("click");
    const rejectButton = wrapper.findAll("button").find((b) => b.text() === "Отклонить");
    await rejectButton!.trigger("click");
    expect(crmStoreMock.updateCardRequest).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Отклонить заявку?");
    const confirm = wrapper
      .findAll("button")
      .find((b) => b.text() === "Отклонить" && b.attributes("data-variant") === "danger-solid");
    await confirm!.trigger("click");
    expect(crmStoreMock.updateCardRequest).toHaveBeenCalledWith("r1", "rejected");
  });

  it("удаление тарифа спрашивает подтверждение", async () => {
    const wrapper = mountModal();
    const tab = wrapper.findAll("nav button").find((b) => b.text().includes("Тарифы"))!;
    await tab.trigger("click");
    const deleteButton = wrapper.findAll("button").find((b) => b.text() === "Удалить");
    await deleteButton!.trigger("click");
    expect(crmStoreMock.deleteCardTariff).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Удалить тариф?");
    const confirm = wrapper
      .findAll("button")
      .find((b) => b.text() === "Удалить" && b.attributes("data-variant") === "danger-solid");
    await confirm!.trigger("click");
    expect(crmStoreMock.deleteCardTariff).toHaveBeenCalledWith("t1");
  });
});
