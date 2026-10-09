<template>
  <div class="flex flex-wrap gap-4">
    <div
      v-for="(url, index) in localImages"
      :key="url + '-' + index"
      class="
        relative 
        w-20 h-20 sm:w-24 sm:h-24
        rounded-lg border-2 border-gray-200 
        overflow-hidden bg-white shadow-sm
      "
    >
      <!-- Кнопки управления - ВСЕГДА ВИДИМЫЕ (МОБИЛЬНЫЙ ПРИОРИТЕТ) -->
      <div class="absolute top-1 left-1 right-1 flex justify-between gap-1">
        <!-- Перемещение -->
        <div class="flex gap-1">
          <button
            type="button"
            class="
              w-6 h-6 sm:w-7 sm:h-7 rounded-md bg-white/95 shadow-md
              flex items-center justify-center
              text-gray-700 active:text-blue-600 active:bg-blue-50
              transition-all duration-150 touch-manipulation
              disabled:opacity-40 disabled:cursor-not-allowed
              border border-gray-200
            "
            title="Вверх"
            :disabled="index === 0 || disabled"
            @click.stop.prevent="moveUp(index)"
          >
            <svg class="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 15l7-7 7 7"/>
            </svg>
          </button>
          <button
            type="button"
            class="
              w-6 h-6 sm:w-7 sm:h-7 rounded-md bg-white/95 shadow-md
              flex items-center justify-center
              text-gray-700 active:text-blue-600 active:bg-blue-50
              transition-all duration-150 touch-manipulation
              disabled:opacity-40 disabled:cursor-not-allowed
              border border-gray-200
            "
            title="Вниз"
            :disabled="index === localImages.length - 1 || disabled"
            @click.stop.prevent="moveDown(index)"
          >
            <svg class="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7"/>
            </svg>
          </button>
        </div>
        
        <!-- Удаление -->
        <button
          v-if="!disabled"
          type="button"
          class="
            w-6 h-6 sm:w-7 sm:h-7 rounded-md bg-white/95 shadow-md
            flex items-center justify-center
            text-red-600 active:text-red-700 active:bg-red-50
            transition-all duration-150 touch-manipulation
            border border-red-200
          "
          title="Удалить"
          @click.stop.prevent="$emit('remove', index)"
        >
          <svg class="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>

      <!-- Изображение - МОБИЛЬНО ОПТИМИЗИРОВАННОЕ -->
      <img 
        :src="url" 
        alt="Фото товара {{ index + 1 }}" 
        class="w-full h-full object-cover" 
        @error="onImgError" 
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: string[]
  disabled?: boolean
}>(), { disabled: false })

const emit = defineEmits<{
  (e: 'update:modelValue', v: string[]): void
  (e: 'reorder', v: string[]): void
  (e: 'remove', index: number): void
}>()

const localImages = ref<string[]>([])

watch(
  () => props.modelValue,
  (v) => { localImages.value = Array.isArray(v) ? [...v] : [] },
  { immediate: true, deep: true }
)

function commit() {
  emit('update:modelValue', [...localImages.value])
  emit('reorder', [...localImages.value])
}

function moveUp(index: number) {
  if (index <= 0 || props.disabled) return
  const arr = [...localImages.value]
  const [item] = arr.splice(index, 1)
  arr.splice(index - 1, 0, item)
  localImages.value = arr
  commit()
}

function moveDown(index: number) {
  if (index >= localImages.value.length - 1 || props.disabled) return
  const arr = [...localImages.value]
  const [item] = arr.splice(index, 1)
  arr.splice(index + 1, 0, item)
  localImages.value = arr
  commit()
}

function onImgError(e: Event) {
  (e.target as HTMLImageElement).src = 'https://placehold.co/80x80/f3f4f6/9ca3af?text=Error'
}
</script>
