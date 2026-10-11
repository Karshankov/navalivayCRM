<template>
  <TransitionRoot :show="isOpen" as="template">
    <Dialog :initialFocus="initialFocus" @close="handleDialogClose">
      <!-- Backdrop - СТАБИЛЬНЫЙ -->
      <TransitionChild
        enter="duration-300 ease-out"
        enter-from="opacity-0"
        enter-to="opacity-100"
        leave="duration-200 ease-in"
        leave-from="opacity-100"
        leave-to="opacity-0"
      >
        <div class="fixed inset-0 bg-white/40 backdrop-blur-sm z-[9998]" :class="{ 'admin-modal-reference-backdrop': referenceDesign }" aria-hidden="true" />
      </TransitionChild>

      <!-- Dialog Panel Container - СТАБИЛЬНЫЙ -->
      <div class="fixed inset-0 z-[9999] flex items-center justify-center p-4">
        <div class="flex items-center justify-center w-full h-full">
        <TransitionChild
          enter="duration-300 ease-out"
          enter-from="opacity-0 scale-95"
          enter-to="opacity-100 scale-100"
          leave="duration-200 ease-in"
          leave-from="opacity-100 scale-100"
          leave-to="opacity-0 scale-95"
        >
          <DialogPanel :class="panelClasses">
            <!-- Header - УЛУЧШЕННЫЙ -->
            <div class="admin-modal-header flex items-start justify-between mb-3 pb-2 border-b border-gray-100 flex-shrink-0">
                <DialogTitle class="text-base sm:text-lg text-brand-dark leading-tight pr-4" :style="referenceDesign ? undefined : 'font-family: var(--font-display); font-weight: normal; text-transform: uppercase; letter-spacing: 0.05em;'">
                  {{ title }}
                </DialogTitle>
                
                <button
                  v-if="showCloseButton"
                  type="button"
                  @click="handleCloseClick"
                  :disabled="isLoading"
                  class="
                    flex-shrink-0 p-2 rounded-lg text-gray-400 
                    hover:text-gray-600 hover:bg-gray-100 
                    focus:outline-none focus:ring-2 focus:ring-gray-200
                    transition-all duration-200 touch-manipulation
                    disabled:cursor-wait disabled:opacity-40
                  "
                  aria-label="Закрыть модальное окно"
                >
                  <XMarkIcon class="w-6 h-6" />
                </button>
              </div>

              <!-- Description -->
              <DialogDescription
                v-if="description"
                class="admin-modal-description mb-2 text-xs text-gray-600 flex-shrink-0"
              >
                {{ description }}
              </DialogDescription>
              
              <!-- Content Slot - МОБИЛЬНО АДАПТИВНОЕ -->
              <div ref="scrollContainerRef" class="admin-modal-content flex-1 overflow-y-auto overflow-x-hidden mb-2 w-full -mx-1 px-1">
                <slot />
              </div>

              <div v-if="$slots.footer" class="flex-shrink-0 border-t border-gray-100 bg-white pt-4 pb-[max(0.25rem,env(safe-area-inset-bottom))]">
                <slot name="footer" />
              </div>
              
              <!-- Actions - УЛУЧШЕННЫЕ -->
              <div v-if="showActions" class="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-6 border-t border-gray-100 flex-shrink-0">
                <button
                  v-if="showCancelButton"
                  @click="handleCancel"
                  :disabled="isLoading"
                  class="
                    w-full sm:w-auto px-6 py-3 text-base font-medium
                    text-gray-700 bg-gray-50 hover:bg-gray-100 hover:text-gray-900
                    border border-gray-200 rounded-lg
                    focus:outline-none focus:ring-2 focus:ring-gray-300 focus:border-transparent
                    transition-all duration-200 touch-manipulation
                    disabled:opacity-50 disabled:cursor-not-allowed
                  "
                >
                  {{ cancelText }}
                </button>
                <button
                  v-if="showConfirmButton"
                  @click="handleConfirm"
                  :disabled="isLoading || isConfirmDisabled"
                  :class="confirmButtonClasses"
                >
                  <span v-if="isLoading" class="inline-flex items-center justify-center">
                    <svg class="animate-spin -ml-1 mr-3 h-5 w-5" fill="none" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    {{ loadingText }}
                  </span>
                  <span v-else>{{ confirmText }}</span>
                </button>
              </div>
          </DialogPanel>
        </TransitionChild>
        </div>
      </div>
    </Dialog>
  </TransitionRoot>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  DialogDescription,
  TransitionRoot,
  TransitionChild,
} from '@headlessui/vue'
import { XMarkIcon } from '@heroicons/vue/24/outline'

interface Props {
  isOpen: boolean
  title: string
  description?: string
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'wide' | 'screen'
  showCloseButton?: boolean
  showActions?: boolean
  showCancelButton?: boolean
  showConfirmButton?: boolean
  cancelText?: string
  confirmText?: string
  loadingText?: string
  isLoading?: boolean
  isConfirmDisabled?: boolean
  confirmVariant?: 'primary' | 'danger' | 'success'
  persistent?: boolean
  referenceDesign?: boolean
  initialFocus?: HTMLElement | null
}

const props = withDefaults(defineProps<Props>(), {
  size: 'md',
  showCloseButton: true,
  showActions: true,
  showCancelButton: true,
  showConfirmButton: true,
  cancelText: 'Отмена',
  confirmText: 'Подтвердить',
  loadingText: 'Загрузка...',
  isLoading: false,
  isConfirmDisabled: false,
  confirmVariant: 'primary',
  persistent: false,
  referenceDesign: false,
  initialFocus: null
})

const emit = defineEmits<{
  'update:isOpen': [value: boolean]
  close: []
  cancel: []
  confirm: []
}>()

const scrollContainerRef = ref<HTMLElement | null>(null)

// Expose scroll container for parent components to save/restore scroll position
defineExpose({
  scrollContainer: scrollContainerRef
})

const panelClasses = computed(() => {
  const baseClasses = `
    w-full sm:w-auto
    max-w-[calc(100vw-2.5rem)] sm:max-w-[calc(100vw-4rem)]
    max-h-[calc(100vh-3rem)] sm:max-h-[calc(100vh-4rem)]
    overflow-hidden bg-white rounded-2xl shadow-2xl
    p-4 sm:p-6
    transform transition-all duration-300
    focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary
    box-border flex flex-col
  `.replace(/\s+/g, ' ').trim()

  const sizeClasses: Record<typeof props.size, string> = {
    sm: 'sm:max-w-md lg:max-w-lg',
    md: 'sm:max-w-lg lg:max-w-xl',
    lg: 'sm:max-w-xl lg:max-w-2xl',
    xl: 'sm:max-w-2xl lg:max-w-3xl',
    '2xl': 'sm:max-w-3xl lg:max-w-4xl',
    wide: 'sm:!w-[min(96vw,1600px)] sm:!max-w-[min(96vw,1600px)]',
    screen: '!w-[calc(100vw-2rem)] !max-w-[calc(100vw-2rem)] !h-[calc(100dvh-2rem)] !max-h-[calc(100dvh-2rem)]'
  }

  return `${baseClasses} ${sizeClasses[props.size]} ${props.referenceDesign ? `admin-modal-reference admin-modal-reference--${props.size}` : ""}`
})

const confirmButtonClasses = computed(() => {
  const baseClasses = `
    w-full sm:w-auto px-6 py-3 text-base font-medium rounded-lg
    focus:outline-none focus:ring-2 focus:ring-offset-1
    transition-all duration-200 touch-manipulation
    disabled:opacity-50 disabled:cursor-not-allowed
    min-w-[120px] justify-center inline-flex items-center
  `.replace(/\s+/g, ' ').trim()
  
  const variantClasses = {
    primary: `
      bg-brand-dark text-white shadow-lg
      hover:bg-brand-dark/90 hover:shadow-xl
      focus:ring-brand-primary focus:ring-opacity-50
      active:bg-brand-dark/95 active:shadow-md
    `.replace(/\s+/g, ' ').trim(),
    danger: `
      bg-red-600 text-white shadow-lg
      hover:bg-red-700 hover:shadow-xl
      focus:ring-red-300 focus:ring-opacity-50
      active:bg-red-800 active:shadow-md
    `.replace(/\s+/g, ' ').trim(),
    success: `
      bg-green-600 text-white shadow-lg
      hover:bg-green-700 hover:shadow-xl
      focus:ring-green-300 focus:ring-opacity-50
      active:bg-green-800 active:shadow-md
    `.replace(/\s+/g, ' ').trim()
  }
  
  return `${baseClasses} ${variantClasses[props.confirmVariant]}`
})

function requestClose(reason: 'close' | 'cancel', options: { force?: boolean } = {}) {
  const { force = false } = options

  if (!force) {
    if (props.persistent || props.isLoading) {
      return
    }
  }

  emit('update:isOpen', false)
  if (reason === 'cancel') {
    emit('cancel')
  } else {
    emit('close')
  }
}

function handleDialogClose() {
  requestClose('close')
}

function handleCloseClick() {
  if (props.isLoading) {
    return
  }
  requestClose('close', { force: true })
}

function handleCancel() {
  if (props.isLoading) {
    return
  }

  requestClose('cancel', { force: true })
}

function handleConfirm() {
  if (props.isLoading || props.isConfirmDisabled) {
    return
  }
  
  emit('confirm')
}
</script>

<style scoped>
.admin-modal-reference-backdrop { background: rgb(8 27 75 / 38%); backdrop-filter: blur(9px); }
.admin-modal-reference {
  width: min(980px, calc(100vw - 32px)); max-width: calc(100vw - 32px);
  max-height: calc(100dvh - 32px); padding: 24px;
  border: 1px solid #eaf0f9; border-radius: 20px;
  background: radial-gradient(ellipse at 75% 0%, #e7f1ff 0%, transparent 60%), #f6f9fc;
  color: #081b4b; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
  box-shadow: 0 24px 70px #03071140;
}
.admin-modal-reference--sm { width: min(520px, calc(100vw - 32px)); }
.admin-modal-reference--md { width: min(620px, calc(100vw - 32px)); }
.admin-modal-reference .admin-modal-header { align-items: center; margin-bottom: 8px; padding-bottom: 12px; border-color: #dce8fa; gap: 12px; }
.admin-modal-reference .admin-modal-header > :first-child { margin: 0; color: #081b4b; font-family: inherit; font-size: 24px; line-height: 1.2; font-weight: 800; letter-spacing: -.03em; text-transform: none; overflow-wrap: anywhere; }
.admin-modal-reference .admin-modal-header button { display: grid; place-items: center; width: 40px; height: 40px; padding: 8px; border: 1px solid #dce8fa; border-radius: 12px; background: #f7fbff; color: #233e70; }
.admin-modal-reference .admin-modal-header button:hover { background: #eaf1ff; }
.admin-modal-reference .admin-modal-description { margin-bottom: 20px; color: #66799e; font-size: 12px; line-height: 1.5; }
.admin-modal-reference .admin-modal-content { min-height: 0; margin-bottom: 0; scrollbar-color: #8999b7 #f0f4fa; scrollbar-width: thin; }
.admin-modal-reference button:focus-visible { outline: 2px solid #0958ff; outline-offset: 3px; }
@media (max-width: 640px) { .admin-modal-reference { padding: 16px; } .admin-modal-reference .admin-modal-header > :first-child { font-size: 21px; } }
/* Opt-in near-fullscreen layout; other modal sizes remain unchanged. */
.admin-modal-reference.admin-modal-reference--screen { padding: 8px 12px; border-radius: 12px; }
.admin-modal-reference--screen .admin-modal-header { margin-bottom: 4px; padding-bottom: 4px; gap: 6px; }
.admin-modal-reference--screen .admin-modal-header > :first-child { font-size: 18px; line-height: 1.25; }
.admin-modal-reference--screen .admin-modal-description { margin-bottom: 4px; font-size: 11px; }
.admin-modal-reference--screen .admin-modal-content { display: flex; flex-direction: column; overflow: hidden; }
@media (max-width: 640px) { .admin-modal-reference.admin-modal-reference--screen { padding: 8px 10px; } }
@media (prefers-reduced-motion: reduce) { .admin-modal-reference { transition: none; } }
</style>
