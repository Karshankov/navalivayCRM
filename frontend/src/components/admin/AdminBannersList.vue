<template>
  <div class="space-y-6">
    <AdminSectionHero
      title="Баннеры"
      description="Управление баннерами витрины"
      :icon="PhotoIcon"
      tone="amber"
    >
      <template #meta>
        <span
          v-if="filteredBanners.length"
          class="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/12 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white/85"
        >
          {{ filteredBanners.length }} из {{ props.banners?.length || 0 }}
        </span>
      </template>
      <template #actions>
        <button
          @click="$emit('create')"
          class="flex items-center justify-center gap-2 rounded-xl bg-white/15 px-5 py-3 text-sm font-semibold text-white shadow-lg transition-all duration-200 hover:bg-white/25 focus:outline-none focus:ring-2 focus:ring-white/60 focus:ring-offset-2 focus:ring-offset-transparent"
        >
          Добавить баннер
        </button>
      </template>
    </AdminSectionHero>

    <!-- Search and filters -->
    <div class="relative overflow-hidden rounded-3xl border border-white/60 bg-white/80 p-4 sm:p-6 shadow-xl backdrop-blur space-y-4">
      <div class="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div class="relative flex-1 min-w-0">
          <div class="relative">
            <span class="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-amber-400">
              <MagnifyingGlassIcon class="h-5 w-5" />
            </span>
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Поиск по ID, названию или ссылке"
              class="w-full rounded-2xl border border-white/60 bg-white/85 px-4 py-3 pl-12 text-sm font-medium text-gray-900 shadow-inner transition focus:border-amber-200 focus:outline-none focus:ring-2 focus:ring-amber-200/70"
            >
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <div class="flex items-center gap-2 rounded-2xl border border-white/60 bg-white/85 px-3 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-gray-500">
            <span>Статус</span>
            <select
              v-model="statusFilter"
              class="rounded-xl border border-white/60 bg-white/90 px-3 py-1 text-sm font-medium text-gray-900 shadow-inner transition focus:border-amber-200 focus:outline-none focus:ring-2 focus:ring-amber-200/70"
            >
              <option value="all">Все</option>
              <option value="active">Активные</option>
              <option value="inactive">Неактивные</option>
            </select>
          </div>
          <span class="text-xs font-semibold uppercase tracking-[0.28em] text-gray-500">Найдено: {{ filteredBanners.length }}</span>
        </div>
      </div>
      
      <!-- Batch operations - мобильная адаптация -->
      <div v-if="selectedIds.length" class="relative overflow-hidden rounded-3xl border border-amber-200/60 bg-white/90 p-4 shadow-lg backdrop-blur space-y-3">
        <div class="pointer-events-none absolute -top-12 right-4 h-24 w-24 rounded-full bg-amber-200/30 blur-2xl"></div>
        <div class="pointer-events-none absolute bottom-0 left-4 h-20 w-20 rounded-full bg-brand-dark/10 blur-xl"></div>
        <div class="relative flex items-center justify-between">
          <span class="text-sm font-semibold text-amber-900">Выбрано: {{ selectedIds.length }}</span>
          <button
            @click="clearSelection"
            class="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-white/80 px-3 py-1 text-xs font-semibold text-amber-800 shadow-sm transition hover:border-amber-500/60 hover:bg-white"
          >
            ✕ Отменить
          </button>
        </div>
        <div class="relative grid grid-cols-1 gap-2 sm:grid-cols-3">
          <button
            @click="batchToggleStatus(true)"
            class="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500/15 via-emerald-400/10 to-emerald-500/25 px-3 py-2 text-sm font-semibold text-emerald-700 shadow-sm transition hover:shadow-md"
          >
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
            </svg>
            Активировать
          </button>
          <button
            @click="batchToggleStatus(false)"
            class="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-amber-500/15 via-yellow-400/10 to-amber-500/25 px-3 py-2 text-sm font-semibold text-amber-700 shadow-sm transition hover:shadow-md"
          >
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M13.477 14.89A6 6 0 015.11 6.524l8.367 8.368zm1.414-1.414L6.524 5.11a6 6 0 008.367 8.367zM18 10a8 8 0 11-16 0 8 8 0 0116 0z" clip-rule="evenodd" />
            </svg>
            Деактивировать
          </button>
          <button
            @click="batchDelete"
            class="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-rose-500/15 via-red-500/10 to-rose-500/25 px-3 py-2 text-sm font-semibold text-rose-700 shadow-sm transition hover:shadow-md"
          >
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
            </svg>
            Удалить
          </button>
        </div>
      </div>
    </div>

    <!-- Loading state -->
    <div v-if="isLoading" class="relative overflow-hidden rounded-3xl border border-white/60 bg-white/85 p-8 text-center shadow-xl backdrop-blur">
      <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(251,191,36,0.18),transparent_60%)]"></div>
      <div class="relative">
      <div class="animate-spin w-8 h-8 border-4 border-brand-dark border-t-transparent rounded-full mx-auto"></div>
      <p class="mt-2 text-gray-600">Загрузка баннеров...</p>
      </div>
    </div>

    <!-- Main content -->
    <div v-else-if="props.banners && props.banners.length" class="relative overflow-hidden rounded-3xl border border-white/70 bg-white shadow-xl backdrop-blur">
      <div class="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-amber-50/60 to-transparent"></div>
      <!-- Table view -->
      <div class="pointer-events-none absolute -top-16 left-0 h-32 w-32 rounded-full bg-amber-200/30 blur-3xl"></div>
      <div class="pointer-events-none absolute bottom-0 right-6 h-28 w-28 rounded-full bg-brand-dark/10 blur-2xl"></div>
      <div class="relative overflow-x-auto">
        <table class="w-full">
          <thead class="bg-white border-b border-amber-100/60">
            <tr class="text-xs uppercase tracking-[0.25em] text-gray-500">
              <th class="w-12 px-5 py-4">
                <input
                  type="checkbox"
                  :checked="isAllSelected"
                  @change="toggleSelectAll"
                  class="rounded border-gray-300 text-brand-dark focus:ring-brand-dark"
                >
              </th>
              <th class="px-5 py-4 text-left text-[0.7rem] font-semibold tracking-[0.25em] text-gray-500">Превью</th>
              <th class="px-5 py-4 text-left text-[0.7rem] font-semibold tracking-[0.25em] text-gray-500">Название</th>
              <th class="px-5 py-4 text-left text-[0.7rem] font-semibold tracking-[0.25em] text-gray-500">Статус</th>
              <th class="px-5 py-4 text-left text-[0.7rem] font-semibold tracking-[0.25em] text-gray-500">Порядок</th>
              <th class="px-5 py-4 text-right text-[0.7rem] font-semibold tracking-[0.25em] text-gray-500">Действия</th>
            </tr>
          </thead>
          <tbody 
            ref="sortableContainer" 
            class="divide-y divide-white/60"
          >
            <tr
              v-for="(banner, index) in filteredBanners"
              :key="banner.id"
              :data-id="banner.id"
              class="transition-colors hover:bg-white sortable-item"
              :class="{ 'bg-white': selectedIds.includes(banner.id) }"
            >
              <td class="px-5 py-4">
                <input
                  type="checkbox"
                  :checked="selectedIds.includes(banner.id)"
                  @change="toggleSelect(banner.id)"
                  class="rounded border-gray-300 text-brand-dark focus:ring-brand-dark"
                >
              </td>
              <td class="px-5 py-4">
                <div class="group relative">
                  <img 
                    :src="imageOf(banner)" 
                    :alt="banner.id" 
                    @error="onImgError" 
                    class="h-12 w-20 cursor-pointer rounded-xl border border-white/60 object-cover shadow-sm" 
                    @click="showPreview(banner.image)"
                  >
                  <div class="absolute inset-0 rounded"></div>
                </div>
              </td>
              <td class="px-5 py-4">
                <div class="min-w-0">
                  <p class="text-sm font-medium text-gray-900 truncate">{{ banner.title || banner.id }}</p>
                  <p v-if="linkOf(banner)" class="text-xs text-gray-500 truncate mt-1">{{ linkOf(banner) }}</p>
                </div>
              </td>
              <td class="px-5 py-4">
                <button
                  @click="handleToggleStatus(banner.id)"
                  class="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition-all duration-150 cursor-pointer shadow-sm"
                  :class="isActive(banner)
                    ? 'border border-emerald-200/60 bg-white/85 text-emerald-700 hover:-translate-y-0.5 hover:bg-white hover:shadow'
                    : 'border border-gray-300/60 bg-white/85 text-gray-600 hover:-translate-y-0.5 hover:bg-white hover:shadow'"
                >
                  <span
                    class="h-2 w-2 rounded-full"
                    :class="isActive(banner) ? 'bg-emerald-500' : 'bg-gray-400'"
                  ></span>
                  {{ isActive(banner) ? 'Активен' : 'Неактивен' }}
                </button>
              </td>
              <td class="px-5 py-4">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-mono text-gray-600 min-w-[2rem] text-center">{{ banner.order || (index + 1) }}</span>
                  <div class="flex flex-col gap-1">
                    <button
                      @click="moveItemUp(banner.id)"
                      :disabled="index === 0"
                      class="inline-flex items-center justify-center rounded-full border border-white/60 bg-white/85 p-1 text-amber-500 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:bg-white hover:text-amber-600 hover:shadow disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:translate-y-0 disabled:hover:shadow-none"
                      title="Переместить выше"
                    >
                      <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clip-rule="evenodd" />
                      </svg>
                    </button>
                    <button
                      @click="moveItemDown(banner.id)"
                      :disabled="index === filteredBanners.length - 1"
                      class="inline-flex items-center justify-center rounded-full border border-white/60 bg-white/85 p-1 text-amber-500 shadow-sm transition-all duration-150 hover:translate-y-0.5 hover:bg-white hover:text-amber-600 hover:shadow disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:translate-y-0 disabled:hover:shadow-none"
                      title="Переместить ниже"
                    >
                      <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" />
                      </svg>
                    </button>
                  </div>
                </div>
              </td>
              <td class="px-4 py-4">
                <div class="flex items-center justify-end gap-2">
                  <button 
                    @click="$emit('edit', banner)" 
                    class="rounded-full bg-blue-500/10 p-2 text-blue-600 transition hover:bg-blue-500/20 hover:text-blue-800"
                    title="Редактировать"
                  >
                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                    </svg>
                  </button>
                  <button 
                    @click="$emit('delete', banner.id)" 
                    class="rounded-full bg-rose-500/10 p-2 text-rose-600 transition hover:bg-rose-500/20 hover:text-rose-800"
                    title="Удалить"
                  >
                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                    </svg>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>


      <!-- Help text -->
      <div class="relative rounded-2xl border border-white/60 bg-white px-6 py-4 text-center text-[0.65rem] font-semibold uppercase tracking-[0.32em] text-gray-500 shadow-sm">
        <span>Используйте стрелки для порядка и чекбоксы для массовых действий</span>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else class="relative overflow-hidden rounded-3xl border border-white/60 bg-white/85 p-8 text-center shadow-xl backdrop-blur">
      <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(251,191,36,0.15),transparent_60%)]"></div>
      <svg class="relative w-12 h-12 text-amber-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 48 48">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M8 14v20c0 4.418 7.163 8 16 8 1.381 0 2.721-.087 4-.252M8 14c0 4.418 7.163 8 16 8s16-3.582 16-8M8 14c0-4.418 7.163-8 16-8s16 3.582 16 8m0 0v14m-16-5c0 4.418 7.163 8 16 8 1.381 0 2.721-.087 4-.252" />
      </svg>
      <h3 class="relative text-lg font-semibold text-gray-900 mb-2">Баннеров пока нет</h3>
      <p class="relative text-sm text-gray-600 mb-4">Создайте первый баннер для отображения на главной странице</p>
      <button
        @click="$emit('create')"
        class="relative rounded-2xl bg-gradient-to-r from-brand-dark via-rose-500 to-brand-primary px-6 py-3 text-sm font-semibold text-white shadow-md transition hover:shadow-lg"
      >
        Создать первый баннер
      </button>
    </div>

    <!-- Preview Modal -->
    <div v-if="previewImage" class="fixed inset-0 bg-white/60 backdrop-blur-sm flex items-center justify-center z-50" @click="closePreview">
      <div class="max-w-4xl max-h-full p-4">
        <img :src="previewImage" alt="Preview" class="max-w-full max-h-full object-contain rounded-lg" />
        <button 
          @click="closePreview"
          class="absolute top-4 right-4 text-white hover:text-gray-300 text-2xl font-bold"
        >
          ×
        </button>
      </div>
    </div>

    <!-- Toast notification -->
    <Transition
      enter-active-class="transition-all duration-300 ease-out"
      enter-from-class="opacity-0 translate-y-2"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition-all duration-200 ease-in"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 translate-y-2"
    >
      <div
        v-if="toastMessage"
        class="fixed bottom-4 right-4 bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg z-50 text-sm font-medium"
      >
        {{ toastMessage }}
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { PhotoIcon, MagnifyingGlassIcon } from '@heroicons/vue/24/outline'
import type { Banner } from '@/stores/admin'
import AdminSectionHero from '@/components/admin/layout/AdminSectionHero.vue'

// Sortable library for drag&drop (будем подключать позже если нужно)
// import Sortable from 'sortablejs'

const props = withDefaults(defineProps<{ banners: Banner[]; isLoading?: boolean }>(), { isLoading: false })
const emit = defineEmits<{
  (e: 'create'): void
  (e: 'edit', banner: Banner): void
  (e: 'delete', id: string): void
  (e: 'batchDelete', ids: string[]): void
  (e: 'batchToggle', ids: string[], active: boolean): void
  (e: 'reorder', list: { id: string; order: number }[]): void
  (e: 'toggleStatus', id: string): void
}>()

// State
const searchQuery = ref('')
const statusFilter = ref<'all' | 'active' | 'inactive'>('all')
const selectedIds = ref<string[]>([])
const previewImage = ref<string | null>(null)
const sortableContainer = ref<HTMLElement | null>(null)
// let sortableInstance: Sortable | null = null

// Computed - используем props.banners напрямую!
const filteredBanners = computed(() => {
  let filtered = props.banners ? [...props.banners] : []
  
  // Search filter
  if (searchQuery.value.trim()) {
    const query = searchQuery.value.toLowerCase().trim()
    filtered = filtered.filter(banner => 
      banner.id.toLowerCase().includes(query) ||
      banner.title?.toLowerCase().includes(query) ||
      (banner.href && banner.href.toLowerCase().includes(query))
    )
  }
  
  // Status filter
  if (statusFilter.value !== 'all') {
    const isActiveFilter = statusFilter.value === 'active'
    filtered = filtered.filter(banner => isActive(banner) === isActiveFilter)
  }
  
  return filtered
})

const isAllSelected = computed(() => {
  return filteredBanners.value.length > 0 && 
         filteredBanners.value.every(banner => selectedIds.value.includes(banner.id))
})

// Watch props - очищаем выбор при изменении баннеров
watch(() => props.banners, () => {
  selectedIds.value = []
}, { deep: true })

// Selection methods
function toggleSelect(id: string) {
  const index = selectedIds.value.indexOf(id)
  if (index === -1) {
    selectedIds.value.push(id)
  } else {
    selectedIds.value.splice(index, 1)
  }
}

function toggleSelectAll() {
  if (isAllSelected.value) {
    selectedIds.value = []
  } else {
    selectedIds.value = [...filteredBanners.value.map(b => b.id)]
  }
}

function clearSelection() {
  selectedIds.value = []
}

// Batch operations
function batchToggleStatus(active: boolean) {
  if (selectedIds.value.length === 0) return
  emit('batchToggle', [...selectedIds.value], active)
  clearSelection()
}

function batchDelete() {
  if (selectedIds.value.length === 0) return
  if (confirm(`Удалить ${selectedIds.value.length} баннеров?`)) {
    emit('batchDelete', [...selectedIds.value])
    clearSelection()
  }
}

// Reorder methods
function commitReorder() {
  const payload = filteredBanners.value.map((b, i) => ({ id: b.id, order: i + 1 }))
  emit('reorder', payload)
}

function moveUp(index: number) {
  if (index <= 0) return
  const arr = [...filteredBanners.value]
  const [item] = arr.splice(index, 1)
  arr.splice(index - 1, 0, item)
  
  // Просто отправляем reorder - store сам обновит порядок
  const reorderedPayload = arr.map((b, i) => ({ id: b.id, order: i + 1 }))
  emit('reorder', reorderedPayload)
}

function moveDown(index: number) {
  if (index >= filteredBanners.value.length - 1) return
  const arr = [...filteredBanners.value]
  const [item] = arr.splice(index, 1)
  arr.splice(index + 1, 0, item)
  
  // Просто отправляем reorder - store сам обновит порядок
  const reorderedPayload = arr.map((b, i) => ({ id: b.id, order: i + 1 }))
  emit('reorder', reorderedPayload)
}

// Новые методы для работы по ID баннера
function moveItemUp(bannerId: string) {
  const index = filteredBanners.value.findIndex(b => b.id === bannerId)
  if (index !== -1) {
    moveUp(index)
  }
}

function moveItemDown(bannerId: string) {
  const index = filteredBanners.value.findIndex(b => b.id === bannerId)
  if (index !== -1) {
    moveDown(index)
  }
}

// Preview methods
function showPreview(imageSrc: string | null) {
  if (imageSrc) {
    previewImage.value = imageSrc
  }
}

function closePreview() {
  previewImage.value = null
}

// Toast notification variables
const toastMessage = ref('')
const toastTimer = ref<number | null>(null)

// Helper functions
function isActive(b: Banner) { return b.active === 1 }
function imageOf(b: Banner) { return b.image || 'https://placehold.co/80x32/f3f4f6/9ca3af?text=No+Image' }
function linkOf(b: Banner) { return b.href || '' }
function onImgError(e: Event) { (e.target as HTMLImageElement).src = 'https://placehold.co/80x32/f3f4f6/9ca3af?text=Error' }

// Toast functions
function showToast(message: string) {
  toastMessage.value = message
  if (toastTimer.value) {
    clearTimeout(toastTimer.value)
  }
  toastTimer.value = window.setTimeout(() => {
    toastMessage.value = ''
    toastTimer.value = null
  }, 2000)
}

// Status toggle with toast
function handleToggleStatus(bannerId: string) {
  const banner = props.banners.find(b => b.id === bannerId)
  if (banner) {
    const newStatus = banner.active === 1 ? 'деактивирован' : 'активирован'
    showToast(`Баннер ${newStatus}`)
  }
  emit('toggleStatus', bannerId)
}


// Lifecycle hooks для drag&drop (можно будет доделать позже)
onMounted(async () => {
  // Инициализация drag&drop для таблицы
  // await initSortable()
})

onUnmounted(() => {
  // if (sortableInstance) {
  //   sortableInstance.destroy()
  // }
})

// async function initSortable() {
//   if (!sortableContainer.value) return
//   
//   const { default: Sortable } = await import('sortablejs')
//   sortableInstance = new Sortable(sortableContainer.value, {
//     handle: '.cursor-move',
//     animation: 150,
//     onEnd: (evt) => {
//       const { oldIndex, newIndex } = evt
//       if (oldIndex !== undefined && newIndex !== undefined && oldIndex !== newIndex) {
//         const arr = [...filteredBanners.value]
//         const [item] = arr.splice(oldIndex, 1)
//         arr.splice(newIndex, 0, item)
//         
//         // Пересортировать основной массив
//         const reorderedIds = arr.map(b => b.id)
//         localBanners.value.sort((a, b) => {
//           const aIndex = reorderedIds.indexOf(a.id)
//           const bIndex = reorderedIds.indexOf(b.id)
//           if (aIndex === -1) return 1
//           if (bIndex === -1) return -1
//           return aIndex - bIndex
//         })
//         
//         commitReorder()
//       }
//     }
//   })
// }
</script>
