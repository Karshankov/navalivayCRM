<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="isOpen" class="color-preview-overlay" @click="close">
        <div class="color-preview-container" @click.stop>
          <button
            type="button"
            class="color-preview-close"
            @click="close"
            aria-label="Закрыть"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M1 1L13 13M1 13L13 1"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
              />
            </svg>
          </button>
          <div class="color-preview-image-wrapper">
            <img
              v-if="imageUrl"
              :src="imageUrl"
              :alt="title"
              class="color-preview-image"
            />
            <div v-else class="color-preview-placeholder">
              <svg
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#E6E9ED"
                stroke-width="1.5"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { watch, onMounted, onUnmounted } from "vue";

const props = defineProps<{
  isOpen: boolean;
  imageUrl: string | null;
  title: string;
}>();

const emit = defineEmits<{
  (e: "close"): void;
}>();

function close() {
  emit("close");
}

// Закрытие по Escape
function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && props.isOpen) {
    close();
  }
}

// Блокировка прокрутки body когда модалка открыта
watch(
  () => props.isOpen,
  (isOpen) => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
  },
);

onMounted(() => {
  document.addEventListener("keydown", handleKeydown);
});

onUnmounted(() => {
  document.removeEventListener("keydown", handleKeydown);
  document.body.style.overflow = "";
});
</script>

<style scoped>
.color-preview-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(101, 109, 119, 0.72);
  backdrop-filter: blur(28px);
  padding: 16px;
}

.color-preview-container {
  position: relative;
  width: 100%;
  max-width: 361px;
  background: #ffffff;
  border-radius: 20px;
  padding: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.color-preview-close {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  background: #f5f7fa;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  z-index: 10;
  color: #191919;
}

.color-preview-close:hover {
  background: #e6e9ed;
}

.color-preview-image-wrapper {
  width: 100%;
  aspect-ratio: 289 / 408;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.color-preview-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.color-preview-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background: #fafafa;
  border-radius: 12px;
}

/* Анимация */
.modal-fade-enter-active {
  transition: opacity 0.3s ease;
}

.modal-fade-leave-active {
  transition: opacity 0.2s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.modal-fade-enter-active .color-preview-container {
  animation: modal-scale-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.modal-fade-leave-active .color-preview-container {
  animation: modal-scale-out 0.2s ease forwards;
}

@keyframes modal-scale-in {
  from {
    opacity: 0;
    transform: scale(0.9);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes modal-scale-out {
  from {
    opacity: 1;
    transform: scale(1);
  }
  to {
    opacity: 0;
    transform: scale(0.9);
  }
}

/* Адаптивные стили */
@media (max-width: 480px) {
  .color-preview-overlay {
    padding: 12px;
  }

  .color-preview-container {
    padding: 12px;
    border-radius: 16px;
  }

  .color-preview-close {
    top: 12px;
    right: 12px;
    width: 36px;
    height: 36px;
  }
}

@media (max-width: 360px) {
  .color-preview-overlay {
    padding: 8px;
  }

  .color-preview-container {
    padding: 10px;
    border-radius: 14px;
  }

  .color-preview-close {
    top: 10px;
    right: 10px;
    width: 32px;
    height: 32px;
  }
}
</style>
