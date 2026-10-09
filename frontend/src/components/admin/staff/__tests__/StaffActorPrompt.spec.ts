import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import StaffActorPrompt from "@/components/admin/staff/StaffActorPrompt.vue";
import { useCrmStore } from "@/stores/crm";

function mountPrompt(props: Record<string, unknown> = {}) {
  return mount(StaffActorPrompt, {
    attachTo: document.body,
    props: {
      open: true,
      title: "Подтвердить действие",
      ...props,
    },
    global: {
      stubs: {
        AdminModal: {
          props: ["isOpen"],
          template: '<section v-if="isOpen"><slot /></section>',
        },
      },
    },
  });
}

describe("StaffActorPrompt", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    const store = useCrmStore();
    store.$patch({
      staffShiftCandidates: [
        {
          id: "employee-1",
          first_name: "Анна",
          last_name: "Иванова",
        },
      ],
    });
    vi.spyOn(store, "fetchStaffShiftCandidates").mockResolvedValue(
      store.staffShiftCandidates,
    );
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("не раскрывает, неверен ПИН или сотрудник уже деактивирован", async () => {
    const wrapper = mountPrompt({
      error: "staff_employee_inactive",
      errorCode: "staff_employee_inactive",
    });
    expect(wrapper.text()).toContain("Не удалось подтвердить сотрудника или ПИН");
    expect(wrapper.text()).not.toContain("staff_employee_inactive");

    await wrapper.setProps({
      error: "invalid_staff_credentials",
      errorCode: "invalid_staff_credentials",
    });
    expect(wrapper.text()).toContain("Не удалось подтвердить сотрудника или ПИН");

    await wrapper.setProps({
      error: "staff_auth_locked",
      errorCode: "staff_auth_locked",
    });
    expect(wrapper.text()).toContain("Слишком много попыток");
  });

  it("валидирует ПИН и блокирует повтор во время проверки", async () => {
    const wrapper = mountPrompt();
    await flushPromises();
    await wrapper.get("select").setValue("employee-1");
    await wrapper.get('input[type="password"]').setValue("12");
    await wrapper.get("form").trigger("submit");
    expect(wrapper.text()).toContain("Введите четыре цифры");

    await wrapper.setProps({ loading: true });
    expect(wrapper.get("select").attributes("disabled")).toBeDefined();
    expect(wrapper.get('input[type="password"]').attributes("disabled")).toBeDefined();
    const submit = wrapper.get('button[type="submit"]');
    expect(submit.attributes("disabled")).toBeDefined();
  });

  it("показывает контекст действия и возвращает фокус после неверного ПИНа", async () => {
    const wrapper = mountPrompt({
      context: "Перемещение №17\nСклад → Розница · 12 шт",
    });
    await flushPromises();

    const input = wrapper.get<HTMLInputElement>('input[type="password"]');
    expect(wrapper.get('[data-testid="staff-actor-context"]').text()).toContain(
      "Перемещение №17",
    );
    await wrapper.get("select").setValue("employee-1");
    await input.setValue("1234");
    await wrapper.get("form").trigger("submit");
    expect(wrapper.emitted("confirm")).toBeTruthy();

    input.element.blur();
    await wrapper.setProps({
      error: "invalid_staff_credentials",
      errorCode: "invalid_staff_credentials",
    });
    await flushPromises();

    expect(input.element.value).toBe("");
    expect(document.activeElement).toBe(input.element);
  });
});
