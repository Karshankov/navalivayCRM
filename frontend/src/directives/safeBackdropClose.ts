import type { Directive } from "vue";

export type SafeBackdropCloseHandler = (event: PointerEvent) => void;

type BackdropState = {
  handler: SafeBackdropCloseHandler;
  pointerId: number | null;
  onPointerDown: (event: PointerEvent) => void;
  onPointerUp: (event: PointerEvent) => void;
  onPointerCancel: (event: PointerEvent) => void;
  onWindowBlur: () => void;
};

const states = new WeakMap<HTMLElement, BackdropState>();

function resetPointer(state: BackdropState) {
  state.pointerId = null;
}

export const vSafeBackdropClose: Directive<HTMLElement, SafeBackdropCloseHandler> = {
  mounted(element, binding) {
    const state: BackdropState = {
      handler: binding.value,
      pointerId: null,
      onPointerDown: () => undefined,
      onPointerUp: () => undefined,
      onPointerCancel: () => undefined,
      onWindowBlur: () => undefined,
    };

    state.onPointerDown = (event) => {
      if (event.button !== 0 || state.pointerId !== null) return;
      state.pointerId = event.target === element ? event.pointerId : null;
    };

    state.onPointerUp = (event) => {
      if (state.pointerId !== event.pointerId) return;

      const shouldClose = event.target === element;
      resetPointer(state);
      if (shouldClose) state.handler(event);
    };

    state.onPointerCancel = (event) => {
      if (state.pointerId === event.pointerId) resetPointer(state);
    };

    state.onWindowBlur = () => resetPointer(state);

    element.addEventListener("pointerdown", state.onPointerDown, true);
    window.addEventListener("pointerup", state.onPointerUp, true);
    window.addEventListener("pointercancel", state.onPointerCancel, true);
    window.addEventListener("blur", state.onWindowBlur);
    states.set(element, state);
  },

  updated(element, binding) {
    const state = states.get(element);
    if (state) state.handler = binding.value;
  },

  beforeUnmount(element) {
    const state = states.get(element);
    if (!state) return;

    element.removeEventListener("pointerdown", state.onPointerDown, true);
    window.removeEventListener("pointerup", state.onPointerUp, true);
    window.removeEventListener("pointercancel", state.onPointerCancel, true);
    window.removeEventListener("blur", state.onWindowBlur);
    states.delete(element);
  },
};
