<template>
  <div class="crm-ref">
    <!-- Заголовок страницы (как «Заказы») -->
    <div class="crm-ref-heading">
      <h1 class="crm-ref-title">Категории</h1>
      <div class="crm-ref-search">
        <input
          v-model="searchQuery"
          type="search"
          placeholder="Поиск по названию или slug..."
          class="crm-ref-search-input"
          aria-label="Поиск по категориям"
        />
        <svg
          v-if="!searchQuery"
          class="crm-ref-search-icon"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
      </div>
    </div>

    <!-- Тулбар (как «Заказы») -->
    <div class="crm-ref-toolbar">
      <button
        type="button"
        class="crm-ref-button crm-ref-button--primary"
        @click="$emit('create')"
      >
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        <span>Добавить категорию</span>
      </button>
      <button
        type="button"
        class="crm-ref-button crm-ref-button--gray"
        @click="$emit('manage-wholesale-links')"
      >
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
        </svg>
        <span>Оптовые ссылки</span>
      </button>
      <span class="crm-ref-toolbar-spacer" aria-hidden="true" />
      <span class="crm-ref-counter">{{ localCategories.length }} всего</span>
      <span v-if="searchQuery" class="crm-ref-counter crm-ref-counter--accent">
        {{ displayedCategories.length }} найдено
      </span>
    </div>

    <!-- Загрузка -->
    <div v-if="isLoading" class="crm-ref-card crm-ref-empty">
      <span class="crm-ref-empty-symbol">
        <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      </span>
      <b>Загружаем категории…</b>
      <span>минуту</span>
    </div>

    <!-- Сетка категорий -->
    <div v-else-if="hasAnyCategories" class="grid gap-4 grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
      <article
        v-for="category in displayedCategories"
        :key="category.id"
        class="crm-ref-card p-5 flex flex-col gap-4"
      >
        <!-- Обложка -->
        <div class="relative h-28 rounded-[13px] overflow-hidden bg-[#f4f7fd]">
          <div
            v-if="category.cover_image"
            class="absolute inset-0 bg-cover bg-center"
            :style="{ backgroundImage: `url(${category.cover_image})` }"
          ></div>
          <div v-else class="absolute inset-0 grid place-items-center text-[#c3cde2]" aria-hidden="true">
            <svg class="h-9 w-9" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" />
            </svg>
          </div>
          <span
            v-if="category.hide_empty === 1 || category.hide_empty === true"
            class="absolute left-3 top-3 rounded-[30px] bg-white/95 px-3 py-1 text-[10px] font-bold text-[#8a6d3b] shadow-sm"
          >
            Скрывается без товаров
          </span>
          <span class="absolute right-3 top-3 rounded-[30px] bg-[#f0f4fa] px-3 py-1 text-[11px] font-bold text-[#253663]">
            №{{ getDisplayOrder(category.id) }}
          </span>
        </div>

        <!-- Название и slug -->
        <div class="flex items-start justify-between gap-3 min-w-0">
          <div class="min-w-0">
            <h3 class="m-0 text-[17px] font-bold leading-tight text-[#081b4b] truncate">{{ category.name }}</h3>
            <p class="m-0 mt-1 text-[11px] text-[#8898b5] font-mono truncate">{{ category.slug }}</p>
          </div>
          <button
            type="button"
            class="crm-ref-chip-button shrink-0"
            :title="`Копировать ссылку на категорию`"
            @click="copyCategoryLink(category.slug)"
          >
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m0 0H5.625" />
            </svg>
            <span>Ссылка</span>
          </button>
        </div>

        <!-- Метрики -->
        <div class="flex items-center justify-between gap-3 rounded-[13px] border border-[#eaf0f9] bg-[#f7fbff] px-4 py-3">
          <div class="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-[#66799e]">
            <span>Товаров: <b class="text-[#081b4b]">{{ category.productCount || 0 }}</b></span>
            <span>Линеек: <b class="text-[#081b4b]">{{ props.groupCounts?.[category.id] ?? 0 }}</b></span>
            <span>Вдруг пригодится: <b class="text-[#081b4b]">{{ props.crossSellCounts?.[category.id] ?? 0 }}</b></span>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <span class="text-[11px] font-bold text-[#8898b5]">Порядок</span>
            <button
              type="button"
              class="crm-ref-chip-button !px-2.5"
              :disabled="!canMoveUp(category.id)"
              title="Переместить вверх"
              @click="moveUp(category.id)"
            >
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
              </svg>
            </button>
            <button
              type="button"
              class="crm-ref-chip-button !px-2.5"
              :disabled="!canMoveDown(category.id)"
              title="Переместить вниз"
              @click="moveDown(category.id)"
            >
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            </button>
          </div>
        </div>

        <!-- Действия -->
        <div class="grid grid-cols-2 gap-2">
          <button type="button" class="crm-ref-chip-button" @click="$emit('manage-groups', category)">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
            <span>Линейки</span>
          </button>
          <button type="button" class="crm-ref-chip-button" @click="$emit('manage-cross-sell', category)">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Вдруг пригодится</span>
          </button>
          <button type="button" class="crm-ref-chip-button crm-ref-chip-button--primary" @click="$emit('edit', category)">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.656 2.656L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
            </svg>
            <span>Редактировать</span>
          </button>
          <button
            type="button"
            class="crm-ref-chip-button crm-ref-chip-button--danger"
            :class="{ 'crm-ref-chip-button--danger-gradient': (category.productCount || 0) === 0 }"
            :disabled="(category.productCount || 0) > 0"
            :title="(category.productCount || 0) > 0 ? `Нельзя удалить категорию с товарами (${category.productCount})` : 'Удалить категорию'"
            @click="$emit('delete', category.id)"
          >
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
            <span>Удалить</span>
          </button>
        </div>
      </article>
    </div>

    <!-- Пустые результаты поиска -->
    <div v-else-if="searchQuery" class="crm-ref-card crm-ref-empty">
      <span class="crm-ref-empty-symbol">⌕</span>
      <b>Ничего не нашлось</b>
      <span>По запросу «{{ searchQuery }}» категорий нет. Проверьте написание.</span>
    </div>

    <!-- Совсем нет категорий -->
    <div v-else class="crm-ref-card crm-ref-empty">
      <span class="crm-ref-empty-symbol">
        <svg class="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.567 3z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="M6 6h.008v.008H6V6z" />
        </svg>
      </span>
      <b>Категорий пока нет</b>
      <span>Создайте первую категорию — в ней появятся товары и линейки.</span>
      <button type="button" class="crm-ref-button crm-ref-button--primary mt-3" @click="$emit('create')">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        <span>Создать категорию</span>
      </button>
    </div>

    <!-- Подсказка -->
    <p v-if="hasAnyCategories" class="crm-ref-hint mt-4">
      Стрелки меняют порядок · ссылка копируется для баннеров
    </p>

    <!-- Toast -->
    <Transition
      enter-active-class="transition-all duration-300 ease-out"
      enter-from-class="opacity-0 translate-y-2"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition-all duration-200 ease-in"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 translate-y-2"
    >
      <div
        v-if="copiedToast"
        class="fixed bottom-4 right-4 z-50 rounded-xl bg-[#0f7b3f] px-4 py-2.5 text-sm font-semibold text-white shadow-lg"
        role="status"
      >
        {{ copiedToast }}
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Category } from '@/stores/admin'

const props = withDefaults(
  defineProps<{
    categories: Category[]
    isLoading?: boolean
    groupCounts?: Record<string, number>
    crossSellCounts?: Record<string, number>
  }>(),
  { isLoading: false, groupCounts: () => ({}), crossSellCounts: () => ({}) }
)

const emit = defineEmits<{
  (e: 'create'): void
  (e: 'manage-wholesale-links'): void
  (e: 'edit', category: Category): void
  (e: 'delete', id: string): void
  (e: 'reorder', list: { id: string; order: number }[]): void
  (e: 'manage-groups', category: Category): void
  (e: 'manage-cross-sell', category: Category): void
}>()

const localCategories = ref<Category[]>([])
const searchQuery = ref('')

const hasAnyCategories = computed(() => localCategories.value.length > 0)
const displayedCategories = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) {
    return localCategories.value
  }
  return localCategories.value.filter((category) => {
    const name = (category.name || '').toLowerCase()
    const slug = (category.slug || '').toLowerCase()
    return name.includes(query) || slug.includes(query)
  })
})

watch(() => props.categories, (val) => {
  localCategories.value = Array.isArray(val) ? [...val] : []
}, { immediate: true })

function commitReorder() {
  const payload = localCategories.value.map((c, i) => ({ id: c.id, order: i + 1 }))
  emit('reorder', payload)
}

function getCategoryIndex(categoryId: string) {
  return localCategories.value.findIndex((c) => c.id === categoryId)
}

function moveUp(categoryId: string) {
  const index = getCategoryIndex(categoryId)
  if (index <= 0) return
  const arr = [...localCategories.value]
  const [item] = arr.splice(index, 1)
  arr.splice(index - 1, 0, item)
  localCategories.value = arr
  commitReorder()
}

function moveDown(categoryId: string) {
  const index = getCategoryIndex(categoryId)
  if (index === -1 || index >= localCategories.value.length - 1) return
  const arr = [...localCategories.value]
  const [item] = arr.splice(index, 1)
  arr.splice(index + 1, 0, item)
  localCategories.value = arr
  commitReorder()
}

function canMoveUp(categoryId: string) {
  return getCategoryIndex(categoryId) > 0
}

function canMoveDown(categoryId: string) {
  const index = getCategoryIndex(categoryId)
  return index !== -1 && index < localCategories.value.length - 1
}

function getDisplayOrder(categoryId: string) {
  const index = getCategoryIndex(categoryId)
  return index === -1 ? '-' : index + 1
}

const copiedToast = ref('')
const toastTimer = ref<number | null>(null)
const copyInProgress = ref(false)

function copyCategoryLink(slug: string) {
  // Предотвращаем множественные клики
  if (copyInProgress.value) {
    return
  }

  copyInProgress.value = true

  // Создаём внутреннюю ссылку на категорию (для использования в баннерах)
  const categoryUrl = `/category/${slug}`

  // Копируем в буфер обмена
  if (navigator.clipboard) {
    navigator.clipboard.writeText(categoryUrl).then(() => {
      showCopiedToast('Внутренняя ссылка для вставки в баннер скопирована')
      // Сбрасываем флаг после успешного копирования
      setTimeout(() => {
        copyInProgress.value = false
      }, 500)
    }).catch(() => {
      fallbackCopy(categoryUrl)
    })
  } else {
    fallbackCopy(categoryUrl)
  }
}

function showCopiedToast(message: string) {
  copiedToast.value = message
  if (toastTimer.value) {
    clearTimeout(toastTimer.value)
  }
  toastTimer.value = window.setTimeout(() => {
    copiedToast.value = ''
    toastTimer.value = null
  }, 2000)
}

function fallbackCopy(text: string) {
  // Fallback для старых браузеров
  const textArea = document.createElement('textarea')
  textArea.value = text
  document.body.appendChild(textArea)
  textArea.select()
  try {
    document.execCommand('copy')
    showCopiedToast('Внутренняя ссылка для вставки в баннер скопирована')
  } catch {
    showCopiedToast('Ошибка копирования')
  }
  document.body.removeChild(textArea)

  // Сбрасываем флаг после fallback копирования
  setTimeout(() => {
    copyInProgress.value = false
  }, 500)
}
</script>
