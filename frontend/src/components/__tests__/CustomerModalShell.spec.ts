import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import CustomerModalShell from "@/components/CustomerModalShell.vue";

let wrapper: VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
});

describe("CustomerModalShell mandatory mode", () => {
  it("has no close button and ignores backdrop click and Escape", async () => {
    wrapper = mount(CustomerModalShell, {
      props: {
        open: true,
        title: "Обязательная авторизация",
        closable: false,
      },
      slots: { default: "<input aria-label='Проверка' />" },
      attachTo: document.body,
    });

    const overlay = document.querySelector<HTMLElement>(".customer-modal-overlay");
    const card = document.querySelector<HTMLElement>(".customer-modal-card");
    expect(overlay).not.toBeNull();
    expect(card).not.toBeNull();
    expect(document.querySelector(".customer-modal-close")).toBeNull();

    overlay?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    card?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("close")).toBeUndefined();
  });
});
