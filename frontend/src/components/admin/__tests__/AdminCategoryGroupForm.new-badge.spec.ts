import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import AdminCategoryGroupForm from "@/components/admin/AdminCategoryGroupForm.vue";

/**
 * Дата окончания показа новинки считается так же, как её пишет сервер: у
 * линейки, уже отмеченной новинкой, срок идёт от даты отметки, а не от сегодня.
 * Иначе каждое сохранение карточки продлевало бы показ, и менеджер видел бы в
 * подсказке одну дату, а получал другую.
 */
function mountForm(editingGroup: Record<string, unknown> | null = null) {
  return mount(AdminCategoryGroupForm, {
    props: { editingGroup: editingGroup as any },
    global: { stubs: { Teleport: true } },
  });
}

describe("AdminCategoryGroupForm: срок показа новинки", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("у новой линейки отсчитывает срок от сегодня", async () => {
    const wrapper = mountForm();
    const vm = wrapper.vm as any;
    vm.form.isNew = true;
    vm.form.newDays = 30;
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("03.09.2026");
  });

  it("у отмеченной линейки отсчитывает от даты отметки, а не от сегодня", async () => {
    const wrapper = mountForm({
      id: "g-1",
      name: "PODONKI",
      isNew: true,
      newSince: "2026-07-20T10:00:00.000Z",
      newDaysLeft: 15,
    });
    const vm = wrapper.vm as any;
    vm.form.isNew = true;
    vm.form.newDays = 30;
    await wrapper.vm.$nextTick();

    // 20 июля плюс 30 дней. От сегодняшнего числа вышло бы 3 сентября.
    expect(wrapper.text()).toContain("19.08.2026");
    expect(wrapper.text()).not.toContain("03.09.2026");
  });

  it("разбирает дату из базы, записанную через пробел", async () => {
    // Так её отдаёт SQLite. Chrome такую строку понимает, Safari — нет, и
    // подсказка молча исчезала бы на маке или айпаде.
    const wrapper = mountForm({
      id: "g-1",
      name: "PODONKI",
      isNew: true,
      newSince: "2026-07-20 10:00:00",
      newDaysLeft: 15,
    });
    const vm = wrapper.vm as any;
    vm.form.isNew = true;
    vm.form.newDays = 30;
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("19.08.2026");
  });

  it("без отметки новинки подсказки нет", async () => {
    const wrapper = mountForm();
    const vm = wrapper.vm as any;
    vm.form.isNew = false;
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).not.toContain("плашка будет гореть до");
  });

  it("на сроке вне допустимого диапазона дату не показывает", async () => {
    const wrapper = mountForm();
    const vm = wrapper.vm as any;
    vm.form.isNew = true;
    vm.form.newDays = 900;
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).not.toContain("плашка будет гореть до");
  });
});
