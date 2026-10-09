<template>
  <div class="min-h-screen bg-gray-50 px-4 py-6 sm:px-6 lg:px-8">
    <div class="mx-auto w-full max-w-7xl space-y-6">
      <!-- Верхняя панель -->
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div class="flex w-full flex-wrap items-center justify-start gap-2 sm:w-auto sm:justify-end">
          <button
            @click="$router.push('/admin/crm/orders')"
            class="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
            </svg>
            Назад к заказам
          </button>
          <button
            @click="refreshOrders()"
            :disabled="isRefreshing"
            class="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span v-if="!isRefreshing">Обновить</span>
            <span v-else>Обновляем...</span>
          </button>
          <button
            @click="toggleView()"
            class="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors"
            :class="viewMode === 'archived' ? 'border-blue-500 bg-blue-50 text-blue-600' : 'border-red-500 bg-red-50 text-red-600'"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" v-if="viewMode === 'cancelled'" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" v-else />
            </svg>
            {{ viewMode === 'archived' ? 'Завершенные' : 'Отмененные' }}
          </button>
        </div>
      </div>

      <!-- Заголовок -->
      <header class="flex flex-col gap-2">
        <div class="flex items-center gap-3">
          <h1 class="text-2xl font-bold text-gray-900 sm:text-3xl">{{ viewMode === 'archived' ? 'Архив заказов' : 'Отмененные заказы' }}</h1>
          <button
            v-if="!profitUnlocked"
            type="button"
            class="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-500 transition hover:bg-gray-200"
            @click="openPasswordModal()"
          >
            <LockClosedIcon class="h-4 w-4" />
            <span>Открыть доступ</span>
          </button>
        </div>
        <p class="text-sm text-gray-600 sm:text-base">{{ viewMode === 'archived' ? 'Завершённые заказы, автоматически перенесённые в архив в полночь' : 'Отмененные заказы' }}</p>
      </header>

      <!-- Плейсхолдер до ввода пароля -->
      <div
        v-if="!profitUnlocked"
        class="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50/50 px-4 py-16 text-center"
      >
        <div class="mb-4 rounded-full bg-gray-100 p-4">
          <LockClosedIcon class="h-8 w-8 text-gray-400" />
        </div>
        <h3 class="mb-2 text-lg font-semibold text-gray-700">Доступ ограничен</h3>
        <p class="mb-6 max-w-md text-sm text-gray-500">
          Архив заказов содержит финансовую информацию. Введите пароль для просмотра.
        </p>
        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
          @click="openPasswordModal()"
        >
          <LockClosedIcon class="h-4 w-4" />
          <span>Открыть доступ</span>
        </button>
      </div>

      <!-- Поиск -->
      <div v-if="profitUnlocked" class="flex flex-col sm:flex-row gap-3">
        <div class="relative flex-1">
          <input
            v-model="searchQuery"
            type="search"
            placeholder="Поиск по номеру заказа..."
            class="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            @input="handleSearch"
          />
          <svg v-if="!searchQuery" class="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>

      <!-- Загрузка -->
      <div v-if="profitUnlocked && loadingOrders" class="flex min-h-[420px] items-center justify-center rounded-xl border border-dashed border-gray-200 bg-white">
        <div class="flex flex-col items-center gap-4">
          <div class="h-12 w-12 animate-spin rounded-full border-4 border-blue-600 border-r-transparent"></div>
          <p class="text-sm text-gray-500">Загружаем архив...</p>
        </div>
      </div>

      <!-- Компактный список архивных заказов -->
      <div v-else-if="profitUnlocked && orders.length > 0" class="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div class="border-b border-gray-100 px-5 py-4">
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold text-gray-900">Всего в архиве: {{ orders.length }}</h2>
          </div>
        </div>
        
        <div class="divide-y divide-gray-100">
          <button
            v-for="order in orders"
            :key="order.id"
            @click="viewOrder(order.id)"
            class="w-full border-0 bg-white px-5 py-2.5 text-left outline-none transition-all hover:bg-blue-50 focus:outline-none"
          >
            <div class="flex items-center justify-between gap-3">
              <div class="flex items-center gap-3">
                <svg class="h-5 w-5 flex-shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                </svg>
                <span class="text-sm font-semibold text-gray-900">#{{ order.order_number }}</span>
                <span class="text-xs text-gray-500">{{ formatDate(order.completed_at || order.created_at) }}</span>
              </div>
              <div class="flex items-center gap-3">
                <span v-if="order.customer_name" class="hidden text-sm text-gray-600 sm:block">{{ order.customer_name }}</span>
                <span class="text-sm font-semibold text-gray-900">{{ formatCurrency(order.final_amount) }}</span>
                <svg class="h-4 w-4 flex-shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </button>
        </div>
      </div>

      <!-- Пустое состояние -->
      <div v-else-if="profitUnlocked" class="rounded-xl border border-dashed border-gray-200 bg-white px-4 py-16 text-center">
        <svg class="mx-auto h-12 w-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
        </svg>
        <h3 class="mt-4 text-lg font-medium text-gray-900">Архив пуст</h3>
        <p class="mt-2 text-sm text-gray-500">Завершённые заказы будут автоматически перенесены сюда каждую полночь</p>
      </div>
    </div>

    <!-- Модалка ввода пароля -->
    <AdminModal
      :isOpen="showPasswordModal"
      title="Подтверждение доступа"
      description="Введите лицензионный ключ"
      size="sm"
      :showActions="false"
      @close="closePasswordModal"
      @cancel="closePasswordModal"
    >
      <form class="space-y-4" autocomplete="on" @submit.prevent="verifyPassword">
        <CrmProfitPasswordField
          v-model="passwordInput"
          :password-error="passwordError"
          :verifying-password="verifyingPassword"
        />
        <div class="flex gap-3 pt-2">
          <button
            type="submit"
            class="flex-1 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-400"
            :disabled="verifyingPassword"
          >
            {{ verifyingPassword ? "Проверяем…" : "Подтвердить" }}
          </button>
          <button
            type="button"
            class="flex-1 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            @click="closePasswordModal"
            :disabled="verifyingPassword"
          >
            Отмена
          </button>
        </div>
      </form>
    </AdminModal>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useCrmStore } from '@/stores/crm'
import { storeToRefs } from 'pinia'
import { LockClosedIcon } from '@heroicons/vue/24/outline'
import AdminModal from '@/components/AdminModal.vue'
import CrmProfitPasswordField from '@/components/crm/CrmProfitPasswordField.vue'

const router = useRouter()
const crmStore = useCrmStore()
const { profitUnlocked } = storeToRefs(crmStore)

const orders = ref<any[]>([])
const loadingOrders = ref(false)
const isRefreshing = ref(false)
const searchQuery = ref('')
const viewMode = ref<'archived' | 'cancelled'>('archived')
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null

// Password modal
const showPasswordModal = ref(false)
const passwordInput = ref('')
const passwordError = ref('')
const verifyingPassword = ref(false)

function openPasswordModal() {
  showPasswordModal.value = true
  passwordInput.value = ''
  passwordError.value = ''
}

function closePasswordModal() {
  showPasswordModal.value = false
  passwordInput.value = ''
  passwordError.value = ''
}

async function verifyPassword() {
  if (!passwordInput.value.trim()) {
    passwordError.value = 'Введите пароль'
    return
  }
  verifyingPassword.value = true
  passwordError.value = ''
  try {
    const success = await crmStore.verifyProfitPassword(passwordInput.value)
    if (success) {
      closePasswordModal()
      fetchArchivedOrders()
    } else {
      passwordError.value = 'Неверный пароль'
    }
  } catch (e) {
    passwordError.value = 'Ошибка проверки'
  } finally {
    verifyingPassword.value = false
  }
}

async function fetchArchivedOrders() {
  loadingOrders.value = true
  try {
    const searchParam = searchQuery.value.trim() || undefined
    const response = await fetch(`/api/admin/crm/orders/archived?limit=1000${searchParam ? `&search=${encodeURIComponent(searchParam)}` : ''}`, {
      credentials: 'include'
    })
    
    if (!response.ok) {
      throw new Error('Failed to fetch archived orders')
    }
    
    const data = await response.json()
    orders.value = data.orders || []
  } catch (error) {
    console.error('[Archive] Failed to fetch orders:', error)
    orders.value = []
  } finally {
    loadingOrders.value = false
  }
}

async function refreshOrders() {
  if (isRefreshing.value) return
  isRefreshing.value = true
  try {
    await fetchArchivedOrders()
  } finally {
    isRefreshing.value = false
  }
}

function handleSearch() {
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer)
  }
  searchDebounceTimer = setTimeout(() => {
    void fetchArchivedOrders()
  }, 400)
}

function viewOrder(id: string) {
  router.push(`/admin/crm/orders/${id}`)
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'BYN',
    minimumFractionDigits: 0
  }).format(value)
}

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function toggleView() {
  viewMode.value = viewMode.value === 'archived' ? 'cancelled' : 'archived'
  if (profitUnlocked.value) {
    fetchArchivedOrders()
  }
}

onMounted(() => {
  if (profitUnlocked.value) {
    fetchArchivedOrders()
  }
})
</script>
