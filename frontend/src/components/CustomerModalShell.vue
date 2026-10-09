<template>
  <Teleport to="body">
    <Transition name="customer-modal">
      <div
        v-if="open"
        class="customer-modal-overlay"
        :class="{ 'customer-modal-overlay--with-tab-bar': reserveTabBar }"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        @click.self="requestClose"
      >
        <section
          ref="cardRef"
          class="customer-modal-card"
          :class="{ 'customer-modal-card--compact': compact }"
          :style="{ '--customer-modal-max-width': maxWidth }"
          @keydown="onKeydown"
        >
          <div class="customer-modal-header">
            <h2 :id="titleId" class="customer-modal-title">{{ title }}</h2>
            <button
              v-if="closable"
              ref="closeButtonRef"
              type="button"
              class="customer-modal-close"
              :aria-label="closeLabel"
              :disabled="closeDisabled"
              @click="requestClose"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M4 4L12 12M12 4L4 12"
                  stroke="#191919"
                  stroke-width="1.8"
                  stroke-linecap="round"
                />
              </svg>
            </button>
          </div>

          <div class="customer-modal-body">
            <slot />
          </div>

          <div v-if="$slots.footer" class="customer-modal-footer">
            <slot name="footer" />
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";

interface Props {
  open: boolean;
  title: string;
  closeLabel?: string;
  maxWidth?: string;
  reserveTabBar?: boolean;
  compact?: boolean;
  closeDisabled?: boolean;
  closable?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  closeLabel: "Закрыть окно",
  maxWidth: "361px",
  reserveTabBar: false,
  compact: false,
  closeDisabled: false,
  closable: true,
});

const emit = defineEmits<{
  close: [];
}>();

const titleId = `customer-modal-title-${Math.random().toString(36).slice(2, 10)}`;

const cardRef = ref<HTMLElement | null>(null);
const closeButtonRef = ref<HTMLButtonElement | null>(null);

// S2-5: remember whatever element was focused at the moment the modal
// opened so we can hand focus back when it closes — keyboard users and
// screen-reader users land back where they were instead of on <body>.
let lastFocusedBeforeOpen: HTMLElement | null = null;

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
  "[contenteditable=true]",
].join(",");

function getFocusableElements(): HTMLElement[] {
  if (!cardRef.value) return [];
  const nodes = cardRef.value.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
  return Array.from(nodes).filter((node) => {
    if (node.hasAttribute("disabled")) return false;
    // Skip elements that are visually hidden (display:none / aria-hidden).
    if (node.getAttribute("aria-hidden") === "true") return false;
    return node.offsetParent !== null || node === document.activeElement;
  });
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.stopPropagation();
    if (props.closable) requestClose();
    return;
  }
  if (event.key !== "Tab") return;

  const focusable = getFocusableElements();
  if (!focusable.length) {
    event.preventDefault();
    closeButtonRef.value?.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement as HTMLElement | null;

  if (event.shiftKey) {
    if (active === first || !cardRef.value?.contains(active)) {
      event.preventDefault();
      last.focus();
    }
  } else if (active === last || !cardRef.value?.contains(active)) {
    event.preventDefault();
    first.focus();
  }
}

function requestClose() {
  if (props.closable && !props.closeDisabled) emit("close");
}

function syncScrollLock(isOpen: boolean) {
  if (typeof document === "undefined") {
    return;
  }

  const overflowValue = isOpen ? "hidden" : "";
  document.documentElement.style.overflow = overflowValue;
  document.body.style.overflow = overflowValue;
}

watch(
  () => props.open,
  async (isOpen, wasOpen) => {
    syncScrollLock(isOpen);
    if (isOpen && !wasOpen) {
      lastFocusedBeforeOpen =
        typeof document !== "undefined"
          ? (document.activeElement as HTMLElement | null)
          : null;
      // Wait for the Transition to render the modal content before
      // hunting for focusable nodes.
      await nextTick();
      const focusable = getFocusableElements();
      // Skip the close-button as the very first stop — focus the first
      // meaningful action (CTA in footer or first body control). If
      // nothing else is focusable, fall back to the close button.
      const preferred = focusable.find(
        (node) => node !== closeButtonRef.value,
      );
      (preferred || closeButtonRef.value || focusable[0])?.focus();
    } else if (!isOpen && wasOpen) {
      const target = lastFocusedBeforeOpen;
      lastFocusedBeforeOpen = null;
      if (target && typeof target.focus === "function") {
        // Defer until the modal is removed from DOM so the focus return
        // doesn't fight with autofocus that lived inside it.
        await nextTick();
        target.focus();
      }
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  syncScrollLock(false);
});
</script>

<style scoped>
.customer-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding:
    calc(24px + env(safe-area-inset-top, 0px))
    16px
    calc(24px + env(safe-area-inset-bottom, 0px));
  background: rgba(101, 109, 119, 0.72);
  backdrop-filter: blur(28px);
  -webkit-backdrop-filter: blur(28px);
  box-sizing: border-box;
}

.customer-modal-overlay--with-tab-bar {
  padding-bottom: calc(var(--app-bottom-tab-bar-height, 130px) + 24px);
}

.customer-modal-card {
  width: min(var(--customer-modal-max-width), 100%);
  max-height: 100%;
  display: flex;
  flex-direction: column;
  border-radius: 20px;
  background: #ffffff;
  box-sizing: border-box;
  padding: 16px;
  box-shadow: 0 24px 48px rgba(25, 25, 25, 0.12);
  transform-origin: center center;
  overflow: hidden;
}

.customer-modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.customer-modal-title {
  margin: 8px 0 0;
  font-family: "Montserrat", sans-serif;
  font-weight: 700;
  font-size: 20px;
  line-height: 24px;
  color: #191919;
}

.customer-modal-close {
  position: relative;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border: none;
  border-radius: 512px;
  background: #f5f7fa;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.customer-modal-close:disabled {
  cursor: wait;
  opacity: 0.4;
}

/* S2-3: visual button stays at 40×40, expand actual hit-target to 44×44
   so customers don't miss-tap it on small screens. */
.customer-modal-close::before {
  content: "";
  position: absolute;
  inset: -2px;
  border-radius: inherit;
}

.customer-modal-body {
  margin-top: 12px;
  overflow-y: auto;
}

.customer-modal-footer {
  margin-top: 28px;
}

.customer-modal-card--compact {
  padding: 12px;
}

.customer-modal-card--compact .customer-modal-title {
  margin-top: 4px;
  font-size: 18px;
  line-height: 22px;
}

.customer-modal-card--compact .customer-modal-close {
  width: 36px;
  height: 36px;
}

.customer-modal-card--compact .customer-modal-body {
  margin-top: 4px;
  overflow-y: visible;
}

.customer-modal-card--compact .customer-modal-footer {
  margin-top: 16px;
}

.customer-modal-enter-active,
.customer-modal-leave-active {
  transition: opacity 0.24s ease;
}

.customer-modal-enter-active .customer-modal-card,
.customer-modal-leave-active .customer-modal-card {
  transition:
    opacity 0.28s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}

.customer-modal-enter-from,
.customer-modal-leave-to {
  opacity: 0;
}

.customer-modal-enter-from .customer-modal-card,
.customer-modal-leave-to .customer-modal-card {
  opacity: 0;
  transform: translateY(18px) scale(0.985);
}

@media (max-width: 360px) {
  .customer-modal-overlay {
    padding:
      calc(20px + env(safe-area-inset-top, 0px))
      12px
      calc(20px + env(safe-area-inset-bottom, 0px));
  }

  .customer-modal-overlay--with-tab-bar {
    padding-bottom: calc(var(--app-bottom-tab-bar-height, 130px) + 20px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .customer-modal-enter-active,
  .customer-modal-leave-active,
  .customer-modal-enter-active .customer-modal-card,
  .customer-modal-leave-active .customer-modal-card {
    transition-duration: 0.01ms;
  }
}
</style>
