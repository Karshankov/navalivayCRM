<template>
  <form @submit="onSubmit" class="space-y-6">
    <!-- Название категории -->
    <div>
      <label class="block text-sm font-medium text-gray-700 mb-2">
        Название категории *
      </label>
      <input
        v-model="name"
        v-bind="nameAttrs"
        type="text"
        class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-dark focus:border-transparent"
        placeholder="Например: Пиджаки"
        :class="{ 'border-red-300 focus:ring-red-500 focus:border-red-300': errors.name }"
      />
      <p v-if="errors.name" class="mt-1 text-sm text-red-600">{{ errors.name }}</p>
    </div>

    <!-- Обложка категории -->
    <div class="space-y-3">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span class="block text-sm font-medium text-gray-700">Обложка категории</span>
        </div>
        <div class="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1 text-xs font-medium text-gray-600">
          <button
            type="button"
            class="px-3 py-1 rounded-md transition-colors"
            :class="coverMode === 'url' ? 'bg-white text-gray-900 shadow-sm' : 'hover:text-gray-800'"
            @click="setCoverMode('url')"
          >
            Ссылка
          </button>
          <button
            type="button"
            class="px-3 py-1 rounded-md transition-colors"
            :class="coverMode === 'file' ? 'bg-white text-gray-900 shadow-sm' : 'hover:text-gray-800'"
            @click="setCoverMode('file')"
          >
            Файл
          </button>
        </div>
      </div>

      <div
        v-if="hasPreview"
        class="flex flex-col gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 sm:flex-row sm:items-center"
      >
        <img
          :src="currentPreview"
          alt="Превью обложки"
          class="h-20 w-32 flex-shrink-0 rounded-lg object-cover ring-1 ring-white/80 shadow"
        />
        <div class="flex-1 space-y-1 text-xs text-gray-600">
          <p class="break-all leading-snug" v-if="coverMode === 'url'">{{ coverImage }}</p>
          <p v-else-if="uploadedFileName" class="font-medium">{{ uploadedFileName }}</p>
          <p class="text-gray-500" v-if="coverMode === 'file' && !uploadedFileName">
            Файл сохранится вместе с категорией.
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <a
            v-if="isRemotePreview"
            :href="currentPreview"
            target="_blank"
            rel="noopener"
            class="inline-flex items-center justify-center rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-gray-300 hover:text-gray-900"
          >
            Открыть
          </a>
          <button
            type="button"
            class="inline-flex items-center justify-center rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:border-red-300 hover:text-red-700"
            @click="clearCover"
          >
            Очистить
          </button>
        </div>
      </div>

      <div v-if="coverMode === 'url'" class="space-y-2">
        <input
          v-model="coverImage"
          v-bind="coverImageAttrs"
          type="text"
          class="w-full rounded-lg border border-gray-200 px-3 py-2 focus:border-brand-dark/40 focus:ring-1 focus:ring-brand-dark/40"
          placeholder="https://example.com/category-cover.jpg"
        />
        <p class="text-xs text-gray-500">
          Если обложка не указана, используем изображение первой подгруппы или стандартную заглушку.
        </p>
      </div>

      <div v-else class="space-y-2">
        <input
          ref="fileInputRef"
          type="file"
          accept="image/*"
          class="hidden"
          @change="handleFileSelected"
        />
        <div
          class="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 px-6 py-8 text-center text-xs text-gray-500 transition hover:border-brand-dark/50 hover:bg-white"
          @click="triggerFileSelect"
          @dragover.prevent
          @drop.prevent="handleFileDrop"
        >
          <svg class="h-8 w-8 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 15.75a4.5 4.5 0 013.75-4.43 5.25 5.25 0 0110.5 0 4.5 4.5 0 013.75 4.43A3.75 3.75 0 0117.25 19.5h-10.5A3.75 3.75 0 013 15.75z" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 13.5l3-3 3 3m-3-3v7.5" />
          </svg>
          <div class="space-y-1">
            <p class="font-medium text-gray-700">Перетащите изображение сюда или выберите файл</p>
          </div>
          <button
            type="button"
            class="inline-flex items-center justify-center rounded-md bg-brand-dark px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark/90"
          >
            Выбрать файл
          </button>
        </div>
      </div>
    </div>

    <div>
      <label class="block text-sm font-medium text-gray-700 mb-2">
        Фильтры на витрине
      </label>
      <select
        v-model="storefrontFiltersProfile"
        class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-brand-dark focus:border-transparent"
      >
        <option value="none">Без фильтров</option>
        <option value="liquids">Жидкости (топ + крепость)</option>
        <option value="snus_plates">Снюс и пластины (топ)</option>
      </select>
      <p class="mt-1 text-xs text-gray-500">
        Определяет, показывать ли клиенту фильтры «Чаще берут» и крепость в этой категории.
      </p>
    </div>

    <!-- Скрывать пустую -->
    <div class="flex items-center justify-between gap-3">
      <div>
        <p class="text-sm font-medium text-gray-700">Скрывать пустую категорию</p>
        <p class="text-xs text-gray-500 mt-1">
          Если в категории нет товаров, она не будет отображаться на витрине
        </p>
      </div>
      <label class="inline-flex items-center">
        <input
          v-model="hideEmpty"
          v-bind="hideEmptyAttrs"
          type="checkbox"
          class="w-5 h-5 text-brand-dark border-gray-300 rounded"
        />
      </label>
    </div>

    <!-- Действия -->
    <div class="flex justify-end space-x-3 pt-4">
      <button
        type="button"
        @click="$emit('cancel')"
        class="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
      >
        Отмена
      </button>
      <button
        type="submit"
        :disabled="isSubmitting"
        class="px-4 py-2 bg-brand-dark text-white rounded-lg hover:bg-brand-dark/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {{ isSubmitting ? 'Сохранение...' : (currentCategory ? 'Применить' : 'Создать') }}
      </button>
    </div>
  </form>
</template>
<script setup lang="ts">
import { watch, computed, ref } from 'vue'
import { useForm } from 'vee-validate'

interface Category {
  id?: string
  name: string
  order?: number
  hide_empty?: number | boolean
  cover_image?: string | null
  storefront_filters_profile?: 'none' | 'liquids' | 'snus_plates'
  storefrontFiltersProfile?: 'none' | 'liquids' | 'snus_plates'
}

interface Props {
  category?: Category | null
  editingCategory?: Category | null
  isSubmitting?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  category: null,
  editingCategory: null,
  isSubmitting: false
})

const currentCategory = computed(() => props.editingCategory ?? props.category ?? null)

const emit = defineEmits<{
  submit: [category: Pick<Category, 'name'> & { hideEmpty?: boolean; coverImage?: string | null; storefrontFiltersProfile?: 'none' | 'liquids' | 'snus_plates' }]
  cancel: []
}>()

// Схема валидации: только имя
const validationSchema = {
  name: (value: string) => {
    if (!value) return 'Название категории обязательно'
    if (value.length > 100) return 'Название не должно превышать 100 символов'
    return true
  }
}

// Форма
const { defineField, handleSubmit, errors, setValues, resetForm, setFieldValue } = useForm({
  validationSchema,
  initialValues: {
    name: currentCategory.value?.name || '',
    hideEmpty: currentCategory.value?.hide_empty === 1 || false,
    coverImage: currentCategory.value?.cover_image || '',
    storefrontFiltersProfile: currentCategory.value?.storefrontFiltersProfile
      ?? currentCategory.value?.storefront_filters_profile
      ?? 'none',
  }
})

const [name, nameAttrs] = defineField('name')
const [hideEmpty, hideEmptyAttrs] = defineField('hideEmpty')
const [coverImage, coverImageAttrs] = defineField('coverImage')
const [storefrontFiltersProfile] = defineField('storefrontFiltersProfile')

const coverMode = ref<'url' | 'file'>('url')
const uploadPreview = ref<string>('')
const fileInputRef = ref<HTMLInputElement | null>(null)
const uploadedFileName = ref('')

const currentPreview = computed(() => {
  if (coverMode.value === 'file') {
    return uploadPreview.value
  }
    return coverImage.value?.trim() || ''
})

const hasPreview = computed(() => Boolean(currentPreview.value))
const isRemotePreview = computed(() => /^https?:\/\//i.test(currentPreview.value || ''))

// Синхронизация при редактировании
watch(currentCategory, (newCategory: Category | null) => {
  if (newCategory) {
    setValues({
      name: newCategory.name,
      hideEmpty: newCategory.hide_empty === 1,
      coverImage: newCategory.cover_image || '',
      storefrontFiltersProfile: newCategory.storefrontFiltersProfile
        ?? newCategory.storefront_filters_profile
        ?? 'none',
    })
    if ((newCategory.cover_image || '').startsWith('data:')) {
      coverMode.value = 'file'
      uploadPreview.value = newCategory.cover_image || ''
    } else {
      coverMode.value = 'url'
      uploadPreview.value = ''
    }
    uploadedFileName.value = ''
  } else {
    resetForm({ values: { name: '', hideEmpty: false, coverImage: '' } })
    coverMode.value = 'url'
    uploadPreview.value = ''
    uploadedFileName.value = ''
  }
}, { immediate: true })

// Отправка
const onSubmit = handleSubmit((values) => {
  emit('submit', {
    name: values.name,
    hideEmpty: values.hideEmpty,
    coverImage: values.coverImage?.trim() ? values.coverImage.trim() : null,
    storefrontFiltersProfile: values.storefrontFiltersProfile || 'none',
  })
})

function setCoverMode(mode: 'url' | 'file') {
  coverMode.value = mode
  if (mode === 'url') {
    uploadPreview.value = ''
    uploadedFileName.value = ''
    if (coverImage.value?.startsWith('data:')) {
      setFieldValue('coverImage', '')
    }
  }
}

function triggerFileSelect() {
  fileInputRef.value?.click()
}

function handleFileSelected(event: Event) {
  const target = event.target as HTMLInputElement
  if (!target.files || !target.files.length) return
  processFile(target.files[0])
}

function handleFileDrop(event: DragEvent) {
  const file = event.dataTransfer?.files?.[0]
  if (!file) return
  processFile(file)
}

function processFile(file: File) {
  if (!file.type.startsWith('image/')) {
    return
  }
  coverMode.value = 'file'
  uploadedFileName.value = file.name
  const reader = new FileReader()
  reader.onload = () => {
    const result = typeof reader.result === 'string' ? reader.result : ''
    uploadPreview.value = result
    setFieldValue('coverImage', result)
  }
  reader.readAsDataURL(file)
}

function clearCover() {
  uploadPreview.value = ''
  uploadedFileName.value = ''
  setFieldValue('coverImage', '')
  if (fileInputRef.value) {
    fileInputRef.value.value = ''
  }
  if (coverMode.value === 'file') {
    coverMode.value = 'url'
  }
}

</script>