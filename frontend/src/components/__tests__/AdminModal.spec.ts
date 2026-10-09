import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, nextTick, ref } from "vue";
import AdminModal from "@/components/AdminModal.vue";

describe("AdminModal", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("не закрывается крестиком во время выполняющегося запроса", async () => {
    const wrapper = mount(AdminModal, {
      attachTo: document.body,
      props: {
        isOpen: true,
        title: "Проверка",
        showActions: false,
        isLoading: true,
      },
      slots: { default: '<button type="button">Действие</button>' },
    });
    await flushPromises();

    const close = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Закрыть модальное окно"]',
    );
    expect(close).not.toBeNull();
    expect(close?.disabled).toBe(true);
    close?.click();
    await flushPromises();
    expect(wrapper.emitted("close")).toBeUndefined();
    expect(wrapper.emitted("update:isOpen")).toBeUndefined();

    await wrapper.setProps({ isLoading: false });
    expect(close?.disabled).toBe(false);
    close?.click();
    await flushPromises();
    expect(wrapper.emitted("close")).toHaveLength(1);
    expect(wrapper.emitted("update:isOpen")?.[0]).toEqual([false]);

    wrapper.unmount();
  });

  it("ставит фокус в явно указанное поле", async () => {
    const Host = defineComponent({
      components: { AdminModal },
      setup() {
        const input = ref<HTMLInputElement | null>(null);
        return { input };
      },
      template: `
        <AdminModal
          :is-open="true"
          title="Проверка фокуса"
          :show-actions="false"
          :initial-focus="input"
        >
          <input ref="input" data-test="target" />
          <button type="button">Другая кнопка</button>
        </AdminModal>
      `,
    });

    const wrapper = mount(Host, { attachTo: document.body });
    await nextTick();
    await flushPromises();

    expect(document.activeElement).toBe(
      document.body.querySelector('[data-test="target"]'),
    );

    wrapper.unmount();
  });
});
