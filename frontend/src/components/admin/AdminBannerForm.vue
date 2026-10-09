<template>
  <form @submit.prevent="onSubmit" class="space-y-4 sm:space-y-6 w-full max-w-full">
    <!-- Заголовок - МОБИЛЬНО АДАПТИВНОЕ -->
    <div class="w-full">
      <label class="block text-sm font-medium text-gray-700 mb-2">
        Заголовок баннера
      </label>
      <input
        v-model="formData.title"
        type="text"
        required
        class="
          w-full max-w-full box-border
          px-3 sm:px-4 py-2 sm:py-3 
          text-sm sm:text-base
          border border-gray-300 rounded-lg 
          focus:ring-2 focus:ring-brand-dark focus:border-transparent
          min-w-0
        "
        placeholder="Введите заголовок баннера"
      />
    </div>


    <!-- Загрузка изображения - МОБИЛЬНО АДАПТИВНОЕ -->
    <div class="w-full">
      <label class="block text-sm font-medium text-gray-700 mb-2">
        Изображение баннера
      </label>
      
      <!-- Превью изображения -->
      <div v-if="previewUrl" class="mb-3 relative inline-block">
        <img 
          :src="previewUrl" 
          alt="Превью баннера" 
          class="max-w-full max-h-48 rounded-lg border border-gray-300 shadow-sm"
        />
        <button 
          type="button"
          @click="clearImage"
          class="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center text-sm hover:bg-red-600 transition-colors"
          title="Удалить изображение"
        >
          ×
        </button>
      </div>
      
      <!-- Загрузка файла -->
      <div class="relative">
        <input
          ref="fileInput"
          type="file"
          accept="image/*"
          @change="handleFileSelect"
          class="hidden"
          id="banner-image-input"
        />
        <label 
          for="banner-image-input"
          class="
            w-full inline-flex items-center justify-center
            px-3 sm:px-4 py-2 sm:py-3 
            text-sm sm:text-base font-medium
            border-2 border-dashed border-gray-300 rounded-lg 
            hover:border-brand-dark hover:bg-gray-50
            focus:ring-2 focus:ring-brand-dark focus:border-transparent
            cursor-pointer transition-all duration-200
            min-w-0 max-w-full box-border
          "
          :class="{ 'border-brand-dark bg-brand-primary/5': selectedFile }"
        >
          <svg class="w-5 h-5 mr-2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>
          </svg>
          {{ selectedFile ? selectedFile.name : 'Выбрать изображение' }}
        </label>
      </div>
      
      <!-- Индикатор загрузки -->
      <div v-if="isUploading" class="mt-2 flex items-center text-sm text-gray-600">
        <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-brand-dark" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        Загрузка изображения...
      </div>
      
      <!-- Ошибка загрузки -->
      <div v-if="uploadError" class="mt-2 text-sm text-red-600">
        {{ uploadError }}
      </div>
      
      <!-- Рекомендации по размеру -->
      <div class="mt-2 text-xs text-gray-600">
        🖼️ Баннеры: <strong>12:5</strong> | Рекомендуется: <strong>1800×750px</strong>
      </div>
    </div>

    <!-- Ссылка - МОБИЛЬНО АДАПТИВНОЕ -->
    <div class="w-full">
      <label class="block text-sm font-medium text-gray-700 mb-2">
        Ссылка при клике
      </label>
      <input
        v-model="formData.linkUrl"
        type="text"
        class="
          w-full max-w-full box-border
          px-3 sm:px-4 py-2 sm:py-3 
          text-sm sm:text-base
          border border-gray-300 rounded-lg 
          focus:ring-2 focus:ring-brand-dark focus:border-transparent
          min-w-0
        "
        placeholder="https://example.com или /category/shoes"
      />
      
      <!-- Опция для открытия в новой вкладке (только для внешних ссылок) -->
      <div v-if="formData.linkUrl && isExternalLink" class="flex items-center mt-2">
        <input
          v-model="formData.openInNewTab"
          @change="handleOpenInNewTabChange"
          type="checkbox"
          id="openInNewTab"
          class="w-4 h-4 text-brand-dark border-gray-300 rounded focus:ring-brand-dark focus:ring-2 flex-shrink-0"
        />
        <label for="openInNewTab" class="ml-2 text-sm text-gray-700">
          Открывать ссылку в новой вкладке
        </label>
      </div>
      
      <p class="mt-2 text-xs text-gray-500">
        <strong>Примеры ссылок:</strong><br>
        • На товар: <code>/p/x9chmh</code><br>
        • На категорию: <code>/category/shoes</code><br>
        • На главную: <code>/</code><br>
        • Внешняя ссылка: <code>https://example.com</code>
      </p>
    </div>

    <!-- Checkbox - МОБИЛЬНО АДАПТИВНОЕ -->
    <div class="flex items-center w-full">
      <input
        v-model="formData.isActive"
        type="checkbox"
        id="isActive"
        class="w-5 h-5 text-brand-dark border-gray-300 rounded focus:ring-brand-dark focus:ring-2 flex-shrink-0"
      />
      <label for="isActive" class="ml-3 text-sm sm:text-base font-medium text-gray-700 break-words">
        Активный баннер
      </label>
    </div>

    <!-- Кнопки - МОБИЛЬНО ОПТИМИЗИРОВАННЫЕ -->
    <div class="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-4 pt-4 sm:pt-6 border-t border-gray-100 w-full max-w-full">
      <button
        type="button"
        @click="$emit('cancel')"
        class="
          w-full sm:w-auto px-4 sm:px-6 py-2 sm:py-3 
          text-sm sm:text-base font-medium
          bg-gray-50 text-gray-700 rounded-lg 
          hover:bg-gray-100 hover:text-gray-900
          border border-gray-200
          focus:outline-none focus:ring-2 focus:ring-gray-300 focus:border-transparent
          transition-all duration-200 touch-manipulation
          min-w-0 max-w-full box-border
        "
      >
        Отмена
      </button>
      <button
        type="submit"
        :disabled="isUploading"
        class="
          w-full sm:w-auto px-4 sm:px-6 py-2 sm:py-3 
          text-sm sm:text-base font-medium rounded-lg
          bg-brand-dark text-white shadow-lg
          hover:bg-brand-dark/90 hover:shadow-xl
          focus:outline-none focus:ring-2 focus:ring-brand-primary focus:ring-opacity-50
          active:bg-brand-dark/95 active:shadow-md
          transition-all duration-200 touch-manipulation
          min-w-0 max-w-full justify-center inline-flex items-center box-border
          disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-brand-dark
        "
      >
        <svg v-if="isUploading" class="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        {{ isUploading ? 'Загрузка...' : (isEditing ? 'Применить' : 'Создать') }}
      </button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useAdminStore } from '@/stores/admin'

const props = defineProps({
  banner: {
    type: Object,
    default: null
  }
})

const isEditing = computed(() => props.banner && props.banner.id)

const emit = defineEmits(['submit', 'cancel'])
const adminStore = useAdminStore()

// Отслеживание пользовательских изменений чекбокса
const userModifiedOpenInNewTab = ref(false)
const userOpenInNewTabChoice = ref(false)

const formData = ref({
  title: '',
  imageUrl: '',
  linkUrl: '',
  openInNewTab: false,
  isActive: true
})

// Computed для определения типа ссылки
const isExternalLink = computed(() => {
  const url = formData.value.linkUrl?.trim() || ''
  return url.startsWith('http://') || url.startsWith('https://')
})

// Состояния для загрузки файлов
const selectedFile = ref<File | null>(null)
const previewUrl = ref<string>('')
const isUploading = ref(false)
const uploadError = ref<string>('')

// Обработка выбора файла
function handleFileSelect(event: any) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  
  if (!file) return
  
  selectedFile.value = file
  uploadError.value = ''
  
  // Создаем URL для предпросмотра
  if (previewUrl.value && previewUrl.value.startsWith('blob:')) {
    URL.revokeObjectURL(previewUrl.value)
  }
  previewUrl.value = URL.createObjectURL(file)
}

// Очистить изображение
function clearImage() {
  selectedFile.value = null
  formData.value.imageUrl = ''
  
  if (previewUrl.value && previewUrl.value.startsWith('blob:')) {
    URL.revokeObjectURL(previewUrl.value)
  }
  previewUrl.value = ''
  
  // Очищаем input
  const fileInput = document.getElementById('banner-image-input') as HTMLInputElement
  if (fileInput) fileInput.value = ''
}

// Обработчик изменений чекбокса openInNewTab
function handleOpenInNewTabChange() {
  userModifiedOpenInNewTab.value = true
  userOpenInNewTabChoice.value = formData.value.openInNewTab
  
  // Сохраняем в sessionStorage для этой сессии редактирования
  const storageKey = `openInNewTab_${props.banner?.id || 'new'}`
  sessionStorage.setItem(storageKey, JSON.stringify({
    modified: true,
    value: formData.value.openInNewTab
  }))
}

// Функция для конвертации полных URL во внутренние ссылки
function normalizeUrl(url: string): string {
  if (!url) return url
  
  // Если URL содержит localhost или текущий домен, извлекаем только путь
  if (url.includes('localhost:') || url.includes(window.location.origin)) {
    try {
      const urlObj = new URL(url)
      return urlObj.pathname + urlObj.search + urlObj.hash
    } catch (e) {
      console.warn('Не удалось распарсить URL:', url)
      return url
    }
  }
  
  return url
}

// Отправка формы
async function onSubmit() {
  try {
    uploadError.value = ''
    let imageUrl = formData.value.imageUrl
    
    // Если выбран новый файл, загружаем его
    if (selectedFile.value) {
      isUploading.value = true
      
      const uploadedUrls = await adminStore.uploadFiles([selectedFile.value], 'banners')
      if (uploadedUrls && uploadedUrls.length > 0) {
        imageUrl = uploadedUrls[0]
      } else {
        throw new Error('Не удалось загрузить изображение')
      }
    }
    
    // Проверяем, что есть изображение
    if (!imageUrl) {
      uploadError.value = 'Необходимо выбрать изображение'
      return
    }
    
    // Отправляем данные формы в формате API
    const bannerData = {
      title: formData.value.title,
      image: imageUrl, // API ожидает image, не imageUrl
      href: normalizeUrl(formData.value.linkUrl), // Нормализуем URL
      openInNewTab: formData.value.openInNewTab,
      active: formData.value.isActive ? 1 : 0 // API ожидает number
    }
    
    console.log('Submitting banner data:', bannerData)
    
    // Очищаем сохранённое состояние чекбокса после успешной отправки
    const storageKey = `openInNewTab_${props.banner?.id || 'new'}`
    sessionStorage.removeItem(storageKey)
    userModifiedOpenInNewTab.value = false
    userOpenInNewTabChoice.value = false
    
    emit('submit', bannerData)
  } catch (error: any) {
    console.error('Upload error:', error)
    uploadError.value = error.message || 'Ошибка при загрузке изображения'
  } finally {
    isUploading.value = false
  }
}

// Watcher для сброса чекбокса при смене типа ссылки
watch(isExternalLink, (newIsExternal, oldIsExternal) => {
  // Если ссылка стала внутренней - сбрасываем чекбокс
  if (oldIsExternal && !newIsExternal) {
    formData.value.openInNewTab = false
  }
})

// Заполняем форму данными баннера при редактировании
watch(
  () => props.banner,
  (newBanner) => {
    // Очищаем предыдущие blob URLs
    if (previewUrl.value && previewUrl.value.startsWith('blob:')) {
      URL.revokeObjectURL(previewUrl.value)
    }
    
    selectedFile.value = null
    uploadError.value = ''
    
    if (newBanner) {
      // Проверяем, есть ли сохранённый пользовательский выбор
      const storageKey = `openInNewTab_${newBanner.id || 'new'}`
      const savedChoice = sessionStorage.getItem(storageKey)
      // API возвращает 0/1, преобразуем в boolean
      let openInNewTabValue = ((newBanner as any).openInNewTab === 1) || false
      
      // Если пользователь менял значение, используем его выбор
      if (savedChoice) {
        try {
          const parsed = JSON.parse(savedChoice)
          if (parsed.modified) {
            openInNewTabValue = parsed.value
            userModifiedOpenInNewTab.value = true
            userOpenInNewTabChoice.value = parsed.value
          }
        } catch (e) {
          console.warn('Ошибка при парсинге сохранённого состояния чекбокса:', e)
        }
      } else {
        // Сбрасываем пользовательские изменения при смене баннера
        userModifiedOpenInNewTab.value = false
        userOpenInNewTabChoice.value = false
      }
      
      formData.value = {
        title: newBanner.title || '',
        imageUrl: newBanner.imageUrl || newBanner.image || '',
        linkUrl: newBanner.linkUrl || newBanner.href || '',
        openInNewTab: openInNewTabValue,
        isActive: newBanner.isActive ?? (newBanner.active === 1)
      }
      
      // Устанавливаем URL для предпросмотра существующего изображения
      previewUrl.value = formData.value.imageUrl
    } else {
      // Для нового баннера очищаем всё
      const storageKey = 'openInNewTab_new'
      const savedChoice = sessionStorage.getItem(storageKey)
      let openInNewTabValue = false
      
      if (savedChoice) {
        try {
          const parsed = JSON.parse(savedChoice)
          if (parsed.modified) {
            openInNewTabValue = parsed.value
            userModifiedOpenInNewTab.value = true
            userOpenInNewTabChoice.value = parsed.value
          }
        } catch (e) {
          console.warn('Ошибка при парсинге сохранённого состояния чекбокса:', e)
        }
      } else {
        userModifiedOpenInNewTab.value = false
        userOpenInNewTabChoice.value = false
      }
      
      formData.value = {
        title: '',
        imageUrl: '',
        linkUrl: '',
        openInNewTab: openInNewTabValue,
        isActive: true
      }
      previewUrl.value = ''
    }
  },
  { immediate: true }
)
</script>