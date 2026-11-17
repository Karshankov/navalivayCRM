import { beforeEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import AdminCategoryGroupForm from "@/components/admin/AdminCategoryGroupForm.vue";

/**
 * Цена всей линейки.
 *
 * Вкусы — это отдельные товары, и со временем цены у них разъезжаются
 * (у CATSWILL встречались 9, 15 и 17). Поле задаёт одну цену на всю линейку.
 *
 * Главное, что здесь проверяется, — безопасность: пустое поле не должно
 * означать ноль (ноль стёр бы цены всей линейки), а предупреждение о скидках
 * должно появляться до сохранения, пока продавец ещё набирает число.
 */
function mountForm(editingGroup: Record<string, unknown> | null = null) {
  return mount(AdminCategoryGroupForm, {
    props: { editingGroup: editingGroup as any },
    global: { stubs: { Teleport: true } },
  });
}

function groupWithPrices(overrides: Record<string, unknown> = {}) {
  return {
    id: "g-1",
    categoryId: "c-1",
    name: "CATSWILL",
    slug: "catswill",
    order: 1,
    productCount: 44,
    pricedProductCount: 44,
    distinctPrices: [9, 15, 17],
    productDiscounts: [],
    ...overrides,
  };
}

describe("AdminCategoryGroupForm: цена линейки", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("подставляет сохранённую цену линейки", () => {
    const wrapper = mountForm(groupWithPrices({ linePrice: 20 }));

    expect((wrapper.vm as any).form.linePrice).toBe("20");
  });

  it("оставляет поле пустым, если цену линейкой не правили", () => {
    const wrapper = mountForm(groupWithPrices({ linePrice: null }));

    expect((wrapper.vm as any).form.linePrice).toBe("");
  });

  it("показывает, сколько разных цен сейчас в линейке", () => {
    const wrapper = mountForm(groupWithPrices());

    const text = wrapper.text();
    expect(text).toContain("9");
    expect(text).toContain("15");
    expect(text).toContain("17");
    expect(text).toContain("3 разные цены");
  });

  it("без заданных цен прямо говорит, что цены нет", () => {
    const wrapper = mountForm(groupWithPrices({ distinctPrices: [], productCount: 5, pricedProductCount: 5 }));

    expect(wrapper.text()).toContain("цена не задана");
  });

  it("объясняет, что пустое поле не меняет цены товаров", () => {
    const wrapper = mountForm(groupWithPrices());

    // Это ключевая защита: пустое поле не должно читаться как «поставить 0».
    expect(wrapper.text()).toContain("цены товаров не меняются");
  });

  it("показывает, скольким товарам встанет новая цена", async () => {
    const wrapper = mountForm(groupWithPrices());
    const vm = wrapper.vm as any;
    vm.form.linePrice = "20";
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("44");
    expect(wrapper.text()).toContain("20");
  });

  it("понимает запятую как разделитель", async () => {
    const wrapper = mountForm(groupWithPrices());
    const vm = wrapper.vm as any;
    vm.form.linePrice = "17,5";
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("17.50");
  });

  it("на мусор подсказывает, что нужно число", async () => {
    const wrapper = mountForm(groupWithPrices());
    const vm = wrapper.vm as any;
    vm.form.linePrice = "abc";
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("числом больше нуля");
  });

  it("отправляет пустую строку, когда поле не заполнено", () => {
    const wrapper = mountForm(groupWithPrices());
    const vm = wrapper.vm as any;
    vm.form.name = "CATSWILL";

    vm.onSubmit();

    const payload = wrapper.emitted("submit")?.[0]?.[0] as any;
    expect(payload.linePrice).toBe("");
  });

  it("отправляет число, когда цену задали", () => {
    const wrapper = mountForm(groupWithPrices());
    const vm = wrapper.vm as any;
    vm.form.name = "CATSWILL";
    vm.form.linePrice = "20";

    vm.onSubmit();

    const payload = wrapper.emitted("submit")?.[0]?.[0] as any;
    expect(payload.linePrice).toBe(20);
  });

  it("не отправляет цену вместо мусора", () => {
    const wrapper = mountForm(groupWithPrices());
    const vm = wrapper.vm as any;
    vm.form.name = "CATSWILL";
    vm.form.linePrice = "abc";

    vm.onSubmit();

    // Мусор уходит как «не менять»: сервер не должен получить ни число, ни
    // строку, которую он не сможет разобрать.
    const payload = wrapper.emitted("submit")?.[0]?.[0] as any;
    expect(payload.linePrice).toBe("");
  });

  it("не отправляет ноль — он обнулил бы цены линейки", () => {
    const wrapper = mountForm(groupWithPrices());
    const vm = wrapper.vm as any;
    vm.form.name = "CATSWILL";
    vm.form.linePrice = "0";

    vm.onSubmit();

    const payload = wrapper.emitted("submit")?.[0]?.[0] as any;
    expect(payload.linePrice).toBe("");
  });

  describe("линейка-родитель без своих товаров", () => {
    it("предупреждает, что товары лежат в дочерних линейках", async () => {
      // Реальный случай: «Снюс GLITCH» — родитель без товаров, все товары
      // в дочерних линейках. Цена такой линейки ничего не выровняет.
      const wrapper = mount(AdminCategoryGroupForm, {
        props: {
          editingGroup: groupWithPrices({
            id: "cg_29ra0c",
            name: "Снюс GLITCH",
            productCount: 0,
            pricedProductCount: 0,
            distinctPrices: [],
          }) as any,
          availableGroups: [
            { id: "cg_29ra0c", name: "Снюс GLITCH", parentId: null },
            { id: "child-1", name: "Снюс GLITCH 75MG", parentId: "cg_29ra0c" },
          ] as any,
        },
        global: { stubs: { Teleport: true } },
      });
      const vm = wrapper.vm as any;
      vm.form.linePrice = "33";
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain("они в дочерних линейках");
      expect(wrapper.text()).toContain("когда товары появятся");
    });

    it("без дочерних линеек говорит о будущих товарах", async () => {
      const wrapper = mount(AdminCategoryGroupForm, {
        props: {
          editingGroup: groupWithPrices({
            productCount: 0,
            pricedProductCount: 0,
            distinctPrices: [],
          }) as any,
          availableGroups: [],
        },
        global: { stubs: { Teleport: true } },
      });
      const vm = wrapper.vm as any;
      vm.form.linePrice = "33";
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain("пока нет товаров");
      expect(wrapper.text()).toContain("когда товары появятся");
    });
  });

  describe("предупреждение о скидках", () => {
    it("молчит, когда скидок нет", async () => {
      const wrapper = mountForm(groupWithPrices());
      const vm = wrapper.vm as any;
      vm.form.linePrice = "20";
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).not.toContain("станет невыгодной");
    });

    it("предупреждает, когда цена падает ниже скидки товара", async () => {
      const wrapper = mountForm(groupWithPrices({ productDiscounts: [14, 16] }));
      const vm = wrapper.vm as any;
      vm.form.linePrice = "10";
      await wrapper.vm.$nextTick();

      // При цене 10 обе скидки (14 и 16) окажутся выше неё и перестанут работать.
      expect(wrapper.text()).toContain("станет невыгодной");
      expect(wrapper.text()).toContain("2");
    });

    it("молчит, когда цена выше скидки — скидка остаётся выгодной", async () => {
      const wrapper = mountForm(groupWithPrices({ productDiscounts: [14, 16] }));
      const vm = wrapper.vm as any;
      vm.form.linePrice = "20";
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).not.toContain("станет невыгодной");
    });

    it("учитывает скидку всей линейки", async () => {
      const wrapper = mountForm(
        groupWithPrices({
          productCount: 44,
          discount: { price: 12, untilDate: null, active: true },
        }),
      );
      const vm = wrapper.vm as any;
      vm.form.linePrice = "10";
      await wrapper.vm.$nextTick();

      // Скидка 12 выше новой цены 10 — пострадают все 44 товара линейки.
      expect(wrapper.text()).toContain("станет невыгодной");
      expect(wrapper.text()).toContain("44");
    });
  });
});
