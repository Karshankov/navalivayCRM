import { defineComponent, h, type PropType, withDirectives } from "vue";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import {
  vSafeBackdropClose,
  type SafeBackdropCloseHandler,
} from "@/directives/safeBackdropClose";

const Harness = defineComponent({
  props: {
    onClose: {
      type: Function as PropType<SafeBackdropCloseHandler>,
      required: true,
    },
  },
  setup(props) {
    return () => withDirectives(
      h("div", { "data-testid": "backdrop" }, [
        h("div", { "data-testid": "panel" }, "Текст окна"),
      ]),
      [[vSafeBackdropClose, props.onClose]],
    );
  },
});

function pointerEvent(type: string, pointerId = 1) {
  return new PointerEvent(type, {
    bubbles: true,
    button: 0,
    pointerId,
  });
}

describe("vSafeBackdropClose", () => {
  it("закрывает окно, когда нажатие и отпускание были на фоне", () => {
    const onClose = vi.fn();
    const wrapper = mount(Harness, { attachTo: document.body, props: { onClose } });
    const backdrop = wrapper.get('[data-testid="backdrop"]');

    backdrop.element.dispatchEvent(pointerEvent("pointerdown"));
    backdrop.element.dispatchEvent(pointerEvent("pointerup"));

    expect(onClose).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  it("не закрывает окно после выделения из панели на фон или с фона в панель", () => {
    const onClose = vi.fn();
    const wrapper = mount(Harness, { attachTo: document.body, props: { onClose } });
    const backdrop = wrapper.get('[data-testid="backdrop"]');
    const panel = wrapper.get('[data-testid="panel"]');

    panel.element.dispatchEvent(pointerEvent("pointerdown", 2));
    backdrop.element.dispatchEvent(pointerEvent("pointerup", 2));

    backdrop.element.dispatchEvent(pointerEvent("pointerdown", 3));
    panel.element.dispatchEvent(pointerEvent("pointerup", 3));

    expect(onClose).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("сбрасывает нажатие после отмены указателя и потери фокуса окна", () => {
    const onClose = vi.fn();
    const wrapper = mount(Harness, { attachTo: document.body, props: { onClose } });
    const backdrop = wrapper.get('[data-testid="backdrop"]');

    backdrop.element.dispatchEvent(pointerEvent("pointerdown", 4));
    window.dispatchEvent(pointerEvent("pointercancel", 4));
    backdrop.element.dispatchEvent(pointerEvent("pointerup", 4));

    backdrop.element.dispatchEvent(pointerEvent("pointerdown", 5));
    window.dispatchEvent(new Event("blur"));
    backdrop.element.dispatchEvent(pointerEvent("pointerup", 5));

    expect(onClose).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("использует свежий обработчик и удаляет слушатели при размонтировании", async () => {
    const firstHandler = vi.fn();
    const nextHandler = vi.fn();
    const wrapper = mount(Harness, {
      attachTo: document.body,
      props: { onClose: firstHandler },
    });
    const backdrop = wrapper.get('[data-testid="backdrop"]');

    await wrapper.setProps({ onClose: nextHandler });
    backdrop.element.dispatchEvent(pointerEvent("pointerdown", 6));
    backdrop.element.dispatchEvent(pointerEvent("pointerup", 6));

    expect(firstHandler).not.toHaveBeenCalled();
    expect(nextHandler).toHaveBeenCalledOnce();

    backdrop.element.dispatchEvent(pointerEvent("pointerdown", 7));
    const removedBackdrop = backdrop.element;
    wrapper.unmount();
    document.body.appendChild(removedBackdrop);
    removedBackdrop.dispatchEvent(pointerEvent("pointerup", 7));
    expect(nextHandler).toHaveBeenCalledOnce();
    removedBackdrop.remove();
  });
});
