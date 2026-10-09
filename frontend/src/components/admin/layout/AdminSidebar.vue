<template>
  <aside class="hidden md:flex w-64 xl:w-72 bg-transparent md:h-full md:overflow-hidden">
    <div class="sticky top-0 flex h-full w-full flex-col border-r border-gray-200 bg-white">
      <nav class="flex-1 overflow-y-auto px-3 py-2 sm:py-3 min-h-0">
        <div class="flex h-full flex-col gap-[clamp(0.5rem,1.2vh,0.9rem)]">
          <div class="sidebar-stack">
            <p class="px-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-gray-500">Основное</p>
            <div class="sidebar-stack">
              <button
                v-for="tab in tabs"
                :key="tab.id"
                @click="handleMainTabClick(tab.id)"
                :class="[
                  'sidebar-button sidebar-button--compact w-full flex items-center text-left text-sm font-medium transition-all duration-200',
                  modelValue === tab.id && !isOnCrmPage
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
                  <span class="text-sm font-semibold leading-tight text-slate-900">{{ tab.name }}</span>
                  <span v-if="tab.description" class="text-xs text-slate-500 leading-tight">{{ tab.description }}</span>
                </div>
              </button>
            </div>
          </div>
          <div v-if="crmLinks.length" class="sidebar-stack">
            <p class="px-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-gray-500">CRM</p>
            <div class="sidebar-stack mt-1">
              <RouterLink
                v-for="link in crmLinks"
                :key="link.id"
                :to="link.to"
                custom
                v-slot="{ navigate, isActive }"
              >
                <button
                  class="sidebar-button sidebar-button--compact w-full flex items-center text-left text-sm font-medium transition-all duration-200"
                  :class="isActive
                    ? 'sidebar-button--crm-active'
                    : 'sidebar-button--default'"
                  @click="handleCrmLinkClick(navigate)"
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
                    <span class="text-sm font-semibold leading-tight text-slate-900">{{ link.name }}</span>
                    <span class="text-xs text-slate-500 leading-tight">{{ link.description }}</span>
                  </div>
                </button>
              </RouterLink>
            </div>
          </div>
          <div class="mt-auto pt-2">
            <button
              @click="$emit('lock')"
              class="sidebar-button sidebar-button--default sidebar-button--compact w-full flex items-center text-left text-sm font-semibold transition-all duration-200"
              title="Заблокировать панель"
            >
              <span class="sidebar-button__icon">
                <LockClosedIcon class="w-5 h-5" />
              </span>
              <span class="leading-none text-slate-900">Блокировка</span>
            </button>
          </div>
        </div>
      </nav>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { LockClosedIcon } from '@heroicons/vue/24/outline'
import { useCrmStore } from '@/stores/crm'
import { useAdminStore } from '@/stores/admin'
import { storeToRefs } from 'pinia'

interface Tab { id: string; name: string; icon: any; description?: string }
interface SidebarLink { id: string; name: string; description: string; icon: any; to: string }

const props = defineProps<{
  modelValue: string
  tabs: Tab[]
  title?: string
  crmLinks?: SidebarLink[]
}>()

const emit = defineEmits<{ (e: 'update:modelValue', v: string): void; (e: 'lock'): void }>()

const crmStore = useCrmStore()
const adminStore = useAdminStore()
const { newOrdersCount, pendingReviewCount, lowStockHasAny, lowStockCount } = storeToRefs(crmStore)
const { incompleteGroupsHasAny, incompleteGroupsCount } = storeToRefs(adminStore)

const crmLinks = computed(() => props.crmLinks ?? [])
const route = useRoute()
const router = useRouter()
const isOnCrmPage = computed(() => route.path.includes('/crm'))

function handleMainTabClick(tabId: string) {
  // Если мы на CRM странице, нужно сначала навигировать на /admin, потом обновить таб
  if (isOnCrmPage.value) {
    const query = tabId === 'dashboard' ? {} : { tab: tabId }
    router.push({ path: '/admin', query }).then(() => {
      emit('update:modelValue', tabId)
    }).catch(() => {})
  } else {
    emit('update:modelValue', tabId)
  }
}

function handleCrmLinkClick(navigate: () => void) {
  navigate()
}
</script>

<style scoped>
.sidebar-stack {
  display: flex;
  flex-direction: column;
  gap: clamp(0.25rem, 0.9vh, 0.6rem);
}

:global(.sidebar-button) {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: clamp(0.9rem, 1.85vw, 1.2rem);
  padding-block: clamp(0.605rem, 1.595vh, 0.902rem);
  padding-inline: clamp(1.05rem, 2.8vw, 1.4rem);
  min-height: clamp(3.3rem, 5.72vh, 3.795rem);
  border-radius: 1.25rem;
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: linear-gradient(145deg, rgba(248, 250, 252, 0.92), rgba(241, 245, 249, 0.6));
  color: rgba(51, 65, 85, 0.92);
  position: relative;
  overflow: hidden;
  backdrop-filter: blur(14px);
  transition: transform 0.25s ease, box-shadow 0.25s ease, border-color 0.25s ease, background-color 0.25s ease, color 0.25s ease;
  isolation: isolate;
}

:global(.sidebar-button--compact) {
  gap: clamp(0.65rem, 1.45vw, 1rem);
  padding-block: clamp(0.462rem, 1.21vh, 0.715rem);
  padding-inline: clamp(0.85rem, 2.3vw, 1.2rem);
  min-height: clamp(2.805rem, 4.73vh, 3.19rem);
}

:global(.sidebar-button::after) {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(118deg, rgba(255, 255, 255, 0.62) 0%, rgba(255, 255, 255, 0) 68%);
  opacity: 0.45;
  pointer-events: none;
  transition: opacity 0.3s ease;
}

:global(.sidebar-button--default) {
  border-color: rgba(148, 163, 184, 0.28);
  box-shadow: 0 14px 26px rgba(15, 23, 42, 0.06);
}

:global(.sidebar-button--default:hover),
:global(.sidebar-button--default:focus-visible) {
  transform: translateY(-1.5px);
  border-color: rgba(148, 163, 184, 0.48);
  box-shadow: 0 20px 36px rgba(15, 23, 42, 0.12);
  color: rgba(30, 41, 59, 0.98);
}

:global(.sidebar-button--default:hover::after),
:global(.sidebar-button--default:focus-visible::after) {
  opacity: 0.72;
}

:global(.sidebar-button:focus-visible) {
  outline: none;
  border-color: rgba(99, 102, 241, 0.5);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
}

:global(.sidebar-button--main-active) {
  background: linear-gradient(135deg, rgba(254, 226, 226, 0.92), rgba(251, 182, 206, 0.55));
  border-color: rgba(244, 63, 94, 0.55);
  box-shadow: 0 24px 44px rgba(244, 63, 94, 0.24);
  color: rgb(190 18 60);
}

:global(.sidebar-button--main-active::after) {
  opacity: 0.7;
}

:global(.sidebar-button--crm-active) {
  background: linear-gradient(135deg, rgba(222, 247, 236, 0.88), rgba(167, 243, 208, 0.48));
  border-color: rgba(16, 185, 129, 0.5);
  box-shadow: 0 24px 44px rgba(16, 185, 129, 0.2);
  color: rgba(4, 120, 87, 1);
}

:global(.sidebar-button--crm-active::after) {
  opacity: 0.74;
}

:global(.sidebar-button:active) {
  transform: translateY(0);
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.12);
}

:global(.sidebar-button__icon) {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: clamp(2.35rem, 3vw, 2.75rem);
  height: clamp(2.35rem, 3vw, 2.75rem);
  border-radius: 1.05rem;
  background: rgba(148, 163, 184, 0.12);
  color: rgba(51, 65, 85, 0.92);
  transition: background-color 0.3s ease, box-shadow 0.3s ease, color 0.3s ease, transform 0.3s ease;
  flex-shrink: 0;
}

:global(.sidebar-button--default:hover .sidebar-button__icon),
:global(.sidebar-button--default:focus-visible .sidebar-button__icon) {
  background: rgba(148, 163, 184, 0.2);
  color: rgba(30, 41, 59, 0.95);
  transform: translateY(-1px);
}

:global(.sidebar-button--compact .sidebar-button__icon) {
  width: clamp(2.05rem, 2.6vw, 2.35rem);
  height: clamp(2.05rem, 2.6vw, 2.35rem);
  border-radius: 0.95rem;
}

:global(.sidebar-button--main-active .sidebar-button__icon) {
  background: rgba(244, 63, 94, 0.18);
  box-shadow: 0 12px 24px rgba(244, 63, 94, 0.28);
  color: rgb(190 18 60);
}

:global(.sidebar-button--crm-active .sidebar-button__icon) {
  background: rgba(16, 185, 129, 0.18);
  box-shadow: 0 12px 24px rgba(16, 185, 129, 0.22);
  color: rgba(4, 120, 87, 1);
}

@media (max-width: 480px) {
  :global(.sidebar-button) {
    gap: 0.9rem;
    padding-block: 0.6rem;
    padding-inline: 1rem;
    min-height: 3.05rem;
    border-radius: 1.1rem;
  }

  :global(.sidebar-button__icon) {
    width: 2.2rem;
    height: 2.2rem;
    border-radius: 0.9rem;
  }
}
</style>
