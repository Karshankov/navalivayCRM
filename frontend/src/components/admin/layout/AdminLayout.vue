<template>
  <div class="flex min-h-screen bg-gray-50 md:h-full md:min-h-0 md:overflow-hidden">
    <AdminSidebar
      v-model="innerValue"
      :tabs="tabs"
      :title="title"
      :main-active="mainActive"
      :crm-links="crmLinks"
      @lock="$emit('lock')"
    />

    <div class="flex-1 flex flex-col min-w-0 md:h-full md:min-h-0 md:overflow-hidden">

      <!-- Main content -->
      <main class="flex-1 p-4 sm:p-6 lg:p-8 pb-16 md:pb-0 min-h-0 flex flex-col md:overflow-y-auto">
        <slot />
      </main>
    </div>
  </div>

  <Teleport to="body">
    <button
      class="md:hidden fixed bottom-5 right-4 z-[70] flex h-14 w-14 items-center justify-center rounded-full bg-brand-dark text-white shadow-[0_18px_35px_rgba(15,23,42,0.28)] transition active:scale-95"
      @click="openMenu"
      aria-label="Открыть меню"
    >
      <Bars3Icon class="w-7 h-7" />
    </button>

    <div v-if="menuOpen" class="md:hidden fixed inset-0 z-[80] flex flex-col justify-end">
      <div class="absolute inset-0 bg-slate-900/45 backdrop-blur-sm" @click="closeMenu"></div>

      <div class="relative w-full px-3 pb-0">
        <div class="mx-auto w-full max-w-lg rounded-t-3xl border border-gray-100 bg-white shadow-2xl">
          <div class="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <span class="text-base font-semibold text-gray-900">Навигация</span>
            <button
              class="inline-flex h-10 w-10 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
              @click="closeMenu"
              aria-label="Закрыть меню"
            >
              <XMarkIcon class="w-5 h-5" />
            </button>
          </div>

          <div class="max-h-[70vh] overflow-y-auto px-1 pb-4">
            <section class="px-3 py-4">
              <p class="px-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-gray-400">Основное</p>
              <div class="mt-3 space-y-2">
                <button
                  v-for="tab in tabs"
                  :key="tab.id"
                  @click="selectMainTab(tab.id)"
                  :class="[
                    'sidebar-button w-full touch-manipulation text-left text-base font-semibold transition-all duration-200',
                    mainActive && innerValue === tab.id
                      ? 'sidebar-button--main-active'
                      : 'sidebar-button--default'
                  ]"
                >
                  <span class="sidebar-button__icon relative">
                    <component :is="tab.icon" class="w-5 h-5" />
                    <span
                      v-if="tab.id === 'categories' && incompleteGroupsHasAny"
                      class="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[11px] font-bold text-white shadow-lg"
                      :title="`Нужно дозаполнить: ${incompleteGroupsCount}`"
                      aria-label="Есть линейки с незаполненными данными"
                    >!</span>
                  </span>
                  <div class="flex flex-col items-start gap-0.5">
                    <span class="truncate text-left leading-tight text-slate-900">{{ tab.name }}</span>
                    <span v-if="tab.description" class="text-xs text-slate-500 leading-tight">{{ tab.description }}</span>
                  </div>
                </button>
              </div>
            </section>

            <section v-if="crmLinks.length" class="px-3 pb-2">
              <p class="px-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-gray-400">CRM</p>
              <div class="mt-3 space-y-2">
                <RouterLink
                  v-for="link in crmLinks"
                  :key="link.id"
                  :to="link.to"
                  custom
                  v-slot="{ navigate, isActive }"
                >
                  <button
                    class="sidebar-button w-full touch-manipulation text-left text-base font-semibold transition-all duration-200"
                    :class="isActive
                      ? 'sidebar-button--crm-active'
                      : 'sidebar-button--default'"
                    @click="navigateToCrm(navigate)"
                  >
                    <span class="sidebar-button__icon relative">
                      <component :is="link.icon" class="w-5 h-5" />
                      <!-- Badge for new orders -->
                      <span
                        v-if="link.id === 'crm-orders' && newOrdersCount > 0"
                        class="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white shadow-lg"
                      >
                        {{ newOrdersCount > 99 ? '99+' : newOrdersCount }}
                      </span>
                      <!-- Badge for pending reviews -->
                      <span
                        v-if="link.id === 'crm-reviews' && pendingReviewCount > 0"
                        class="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white shadow-lg"
                      >
                        {{ pendingReviewCount > 99 ? '99+' : pendingReviewCount }}
                      </span>
                      <!-- Indicator for low-stock product lines (Закупки) -->
                      <span
                        v-if="link.id === 'crm-procurements' && lowStockHasAny"
                        class="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[11px] font-bold text-white shadow-lg"
                        :title="`Заканчивающихся линеек: ${lowStockCount}`"
                        aria-label="Есть заканчивающиеся линейки"
                      >!</span>
                    </span>
                    <div class="flex flex-col items-start gap-0.5">
                      <span class="text-left leading-tight text-slate-900">{{ link.name }}</span>
                      <span class="text-xs text-slate-500 leading-tight">{{ link.description }}</span>
                    </div>
                  </button>
                </RouterLink>
              </div>
            </section>
          </div>

          <div class="border-t border-gray-100 px-5 py-4">
            <button
              @click="() => { $emit('lock'); closeMenu() }"
              class="sidebar-button sidebar-button--default w-full flex items-center justify-start gap-4 text-left text-base font-semibold transition-all duration-200"
              title="Заблокировать панель"
            >
              <span class="sidebar-button__icon">
                <LockClosedIcon class="w-5 h-5" />
              </span>
              <span class="text-slate-900">Блокировка</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { Bars3Icon, XMarkIcon, LockClosedIcon } from '@heroicons/vue/24/outline'
import { storeToRefs } from 'pinia'
import AdminSidebar from './AdminSidebar.vue'
import { useCrmStore } from '@/stores/crm'
import { useAdminStore } from '@/stores/admin'

interface Tab { id: string; name: string; icon: any; description?: string }
interface SidebarLink { id: string; name: string; description: string; icon: any; to: string }

const props = withDefaults(defineProps<{
  modelValue: string
  tabs: Tab[]
  title?: string
  subtitle?: string
  mainActive?: boolean
  crmLinks?: SidebarLink[]
}>(), { title: 'НАВАЛИВАЙ Admin', subtitle: 'Админ-панель', mainActive: true, crmLinks: () => [] })

const emit = defineEmits<{ (e: 'update:modelValue', v: string): void; (e: 'lock'): void }>()

const crmStore = useCrmStore()
const adminStore = useAdminStore()
const { newOrdersCount, pendingReviewCount, lowStockHasAny, lowStockCount } = storeToRefs(crmStore)
const { incompleteGroupsHasAny, incompleteGroupsCount } = storeToRefs(adminStore)

const innerValue = ref(props.modelValue)
watch(() => props.modelValue, v => innerValue.value = v)
watch(innerValue, v => emit('update:modelValue', v))

const mainActive = computed(() => props.mainActive)
const crmLinks = computed(() => props.crmLinks || [])

const menuOpen = ref(false)
const route = useRoute()
const previousBodyOverflow = ref<string | null>(null)

const restoreBodyOverflow = () => {
  if (typeof document === 'undefined') return
  if (previousBodyOverflow.value !== null) {
    document.body.style.overflow = previousBodyOverflow.value
    previousBodyOverflow.value = null
  } else {
    document.body.style.overflow = ''
  }
}

const openMenu = () => {
  menuOpen.value = true
}

const closeMenu = () => {
  menuOpen.value = false
}

const selectMainTab = (tabId: string) => {
  innerValue.value = tabId
  closeMenu()
}

const navigateToCrm = (navigate: (e?: MouseEvent) => unknown) => {
  void navigate()
  closeMenu()
}

watch(menuOpen, (open) => {
  if (typeof document === 'undefined') return
  if (open) {
    previousBodyOverflow.value = document.body.style.overflow || null
    document.body.style.overflow = 'hidden'
  } else {
    restoreBodyOverflow()
  }
})

watch(() => route.fullPath, () => {
  if (menuOpen.value) closeMenu()
})

onBeforeUnmount(() => {
  restoreBodyOverflow()
})

</script>
