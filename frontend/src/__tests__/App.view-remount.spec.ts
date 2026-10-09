/**
 * Пересборка верхнего экрана при навигации.
 *
 * Тест держит настоящий роутер, а не заглушку: проверяется именно связка
 * App.vue + vue-router, из-за которой админка пересобиралась целиком на каждый
 * клик по разделу. Побочный эффект той пересборки был виден глазом — старый
 * экземпляр во время ухода успевал перерисоваться под новый маршрут, и
 * содержимое подменялось до начала анимации.
 *
 * Считаем монтирования компонентов: это то, что происходит на самом деле, а не
 * пересказ разметки. Если ключ верхнего <RouterView> снова начнёт зависеть от
 * строки запроса или от вложенного маршрута, счётчик вырастет и тест упадёт.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { defineComponent, ref } from "vue";
import App from "@/App.vue";

vi.mock("@/composables/useCustomerBlock", () => ({
  useCustomerBlock: () => ({
    currentBlock: ref(null),
    isBlocked: ref(false),
    refreshBlock: vi.fn(),
  }),
}));

vi.mock("@/stores/user", () => ({
  useUserStore: () => ({ fetchProfile: vi.fn().mockResolvedValue(undefined) }),
}));

const mounted = { shell: 0, product: 0 };

/** Двойник AdminView: тот же приём — вложенный <RouterView> внутри экрана. */
const AdminShell = defineComponent({
  name: "AdminShell",
  mounted() {
    mounted.shell += 1;
  },
  template: `<div class="admin-shell"><RouterView /></div>`,
});

const ProductScreen = defineComponent({
  name: "ProductScreen",
  mounted() {
    mounted.product += 1;
  },
  template: `<div class="product-screen">{{ $route.params.id }}</div>`,
});

const section = (name: string) =>
  defineComponent({ template: `<div class="crm-section">${name}</div>` });

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div class='home' />" } },
      { path: "/p/:id", component: ProductScreen },
      {
        path: "/admin",
        component: AdminShell,
        children: [
          { path: "crm/orders", component: section("orders") },
          { path: "crm/customers", component: section("customers") },
        ],
      },
    ],
  });
}

async function mountApp(router: Router, startAt: string) {
  await router.push(startAt);
  await router.isReady();
  const wrapper = mount(App, {
    global: {
      plugins: [router],
      stubs: {
        VapeSmoke: true,
        BottomTabBar: true,
        ReviewPromptModal: true,
        WheelHomeWidget: true,
        BlockedScreen: true,
        // Гейт авторизации закрывает витрину до ответа сервера. Открываем его,
        // иначе экраны покупателя вообще не смонтируются.
        ReferralAuthorizationGate: {
          emits: ["gate-active"],
          template: "<div class='referral-gate-stub' />",
          mounted() {
            this.$emit("gate-active", false);
          },
        },
      },
    },
  });
  await flushPromises();
  return wrapper;
}

describe("App: пересборка верхнего экрана", () => {
  beforeEach(() => {
    mounted.shell = 0;
    mounted.product = 0;
  });

  it("не пересобирает админку при переключении вкладок", async () => {
    const router = makeRouter();
    const wrapper = await mountApp(router, "/admin?tab=products");
    expect(mounted.shell).toBe(1);

    await router.push("/admin?tab=settings");
    await flushPromises();

    expect(mounted.shell).toBe(1);
    wrapper.unmount();
  });

  it("не пересобирает админку при переходе между разделами CRM", async () => {
    const router = makeRouter();
    const wrapper = await mountApp(router, "/admin/crm/orders");
    expect(mounted.shell).toBe(1);
    expect(wrapper.text()).toContain("orders");

    await router.push("/admin/crm/customers");
    await flushPromises();

    expect(mounted.shell).toBe(1);
    // Раздел при этом обязан смениться: экран не пересобрали, но содержимое новое.
    expect(wrapper.text()).toContain("customers");
    wrapper.unmount();
  });

  it("по-прежнему пересобирает экран при переходе на другой товар", async () => {
    // Обратная сторона правки: параметры самой записи верхнего уровня в ключе
    // остались, иначе карточка товара показывала бы данные предыдущего.
    const router = makeRouter();
    const wrapper = await mountApp(router, "/p/1");
    expect(mounted.product).toBe(1);

    await router.push("/p/2");
    await flushPromises();

    expect(mounted.product).toBe(2);
    wrapper.unmount();
  });
});
