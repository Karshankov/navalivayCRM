<template>
  <Transition name="toast-slide">
    <div v-if="visible" class="toast-container" :style="toastStyle">
      <p class="toast-message">{{ displayMessage }}</p>
      <button class="toast-close" @click="close" aria-label="Закрыть">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path
            d="M1 1L13 13M13 1L1 13"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          />
        </svg>
      </button>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from "vue";

const props = withDefaults(
  defineProps<{
    message: string;
    type?: "error" | "success" | "info";
    duration?: number;
    bottomOffset?: string;
  }>(),
  {
    type: "info",
    duration: 3500,
    bottomOffset: "calc(var(--app-bottom-tab-bar-height, 130px) + 20px)",
  },
);

const emit = defineEmits<{
  close: [];
}>();

const visible = ref(false);
let showTimeout: ReturnType<typeof setTimeout> | null = null;
let hideTimeout: ReturnType<typeof setTimeout> | null = null;
let emitCloseTimeout: ReturnType<typeof setTimeout> | null = null;

// Преобразуем сообщение - добавляем "Опс, " к error сообщениям
const displayMessage = computed(() => {
  if (props.type === "error") {
    const msg = props.message.toLowerCase();
    // Если сообщение уже начинается с "опс", не добавляем
    if (msg.startsWith("опс")) {
      return props.message;
    }
    // Заменяем стандартные сообщения
    if (msg.includes("в наличии больше нет") || msg.includes("нет в наличии")) {
      return `Опс, ${props.message.toLowerCase()}`;
    }
    return `Опс, ${props.message.toLowerCase()}`;
  }
  return props.message;
});

const effectiveDuration = computed(() => {
  const msg = (props.message || "").toLowerCase();
  const isOutOfStock =
    msg.includes("\u0432 \u043d\u0430\u043b\u0438\u0447\u0438\u0438 \u0431\u043e\u043b\u044c\u0448\u0435 \u043d\u0435\u0442") ||
    msg.includes("\u043d\u0435\u0442 \u0432 \u043d\u0430\u043b\u0438\u0447\u0438\u0438");

  const base = Number.isFinite(props.duration) ? props.duration : 3500;
  return isOutOfStock ? Math.max(base, 3000) : base;
});

const toastStyle = computed(() => ({
  "--toast-bottom-offset": props.bottomOffset,
}));


function clearTimers() {
  if (showTimeout) {
    clearTimeout(showTimeout);
    showTimeout = null;
  }
  if (hideTimeout) {
    clearTimeout(hideTimeout);
    hideTimeout = null;
  }
  if (emitCloseTimeout) {
    clearTimeout(emitCloseTimeout);
    emitCloseTimeout = null;
  }
}

function close() {
  clearTimers();
  visible.value = false;
  // Let the leave transition play, then unmount?
  emitCloseTimeout = setTimeout(() => emit('close'), 220);
}

onMounted(() => {
  if (props.message) {
    showTimeout = setTimeout(() => {
      visible.value = true;

      hideTimeout = setTimeout(() => {
        close();
      }, effectiveDuration.value);
    }, 50);
  }
});

onBeforeUnmount(() => {
  clearTimers();
});
</script>

<style scoped>
.toast-container {
  position: fixed;
  bottom: var(
    --toast-bottom-offset,
    calc(var(--app-bottom-tab-bar-height, 130px) + 20px)
  );
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;

  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;

  width: calc(100% - 32px);
  max-width: 377px;
  padding: 22px 20px;

  background: rgba(101, 109, 119, 0.72);
  backdrop-filter: blur(28px);
  -webkit-backdrop-filter: blur(28px);
  border-radius: 20px;
}

.toast-message {
  margin: 0;
  font-family: "Montserrat", sans-serif;
  font-weight: 700;
  font-size: 16px;
  line-height: 20px;
  color: #ffffff;
  flex: 1;
}

.toast-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  flex-shrink: 0;

  background: rgba(245, 247, 250, 0.08);
  border: none;
  border-radius: 512px;

  color: #ffffff;
  cursor: pointer;
  transition: background 0.2s ease;
}

.toast-close:hover {
  background: rgba(245, 247, 250, 0.16);
}

.toast-close:active {
  background: rgba(245, 247, 250, 0.24);
}

.toast-close svg {
  width: 14px;
  height: 14px;
}

/* Анимация появления */
.toast-slide-enter-active {
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.toast-slide-leave-active {
  transition: all 0.2s ease-out;
}

.toast-slide-enter-from {
  transform: translate(-50%, 30px);
  opacity: 0;
}

.toast-slide-leave-to {
  transform: translate(-50%, 30px);
  opacity: 0;
}

/* Mobile adjustments */
@media (max-width: 480px) {
  .toast-container {
    padding: 18px 16px;
    gap: 12px;
    border-radius: 18px;
  }

  .toast-message {
    font-size: 15px;
    line-height: 19px;
  }

  .toast-close {
    width: 36px;
    height: 36px;
  }

  .toast-close svg {
    width: 12px;
    height: 12px;
  }
}

@media (max-width: 360px) {
  .toast-container {
    padding: 16px 14px;
    border-radius: 16px;
  }

  .toast-message {
    font-size: 14px;
    line-height: 18px;
  }

  .toast-close {
    width: 34px;
    height: 34px;
  }
}
</style>
