<template>
  <div class="space-y-2">
    <label :for="inputId" class="block text-sm font-medium text-gray-700">Клиент или Telegram username</label>
    <div class="relative">
      <input
        :id="inputId"
        ref="inputRef"
        v-model.trim="query"
        type="search"
        autocomplete="off"
        class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus-visible:ring-2 focus-visible:ring-blue-500"
        placeholder="@username, имя или Telegram ID"
        @input="handleInput"
        @focus="scheduleSearch"
      />
      <span v-if="loading" aria-live="polite" class="absolute inset-y-0 right-3 flex items-center text-xs text-gray-400">Ищем...</span>
    </div>

    <div v-if="results.length" class="max-h-52 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-sm" aria-label="Найденные клиенты">
      <button
        v-for="item in results"
        :key="item.id"
        type="button"
        class="flex w-full items-center justify-between gap-3 border-b border-gray-100 px-3 py-2 text-left last:border-0 hover:bg-gray-50 focus-visible:bg-blue-50 focus-visible:outline-none"
        @click="selectCustomer(item)"
      >
        <span class="min-w-0">
          <span class="block truncate text-sm font-medium text-gray-900">{{ item.first_name || 'Без имени' }} {{ item.last_name || '' }}</span>
          <span class="block truncate text-xs text-gray-500">{{ item.telegram_username ? `@${item.telegram_username}` : item.telegram_id || 'Нет Telegram' }}</span>
        </span>
        <span v-if="item.blocked_count" class="shrink-0 rounded bg-red-50 px-2 py-1 text-xs text-red-700">Есть блокировка</span>
      </button>
    </div>

    <div v-if="selectedCustomer" class="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="font-medium text-gray-900">{{ selectedCustomer.first_name || 'Без имени' }} {{ selectedCustomer.last_name || '' }}</div>
          <div class="text-xs text-gray-600">{{ selectedCustomer.telegram_username ? `@${selectedCustomer.telegram_username}` : selectedCustomer.telegram_id }}</div>
        </div>
        <button type="button" class="text-xs font-medium text-blue-700 underline focus-visible:outline-2 focus-visible:outline-blue-600" @click="clearSelection">Изменить</button>
      </div>
      <p v-if="selectedCustomer.blocked_count && blockHint" class="mt-2 text-xs font-medium text-red-700">{{ blockHint }}</p>
    </div>
    <div v-else-if="customerId" class="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
      Выбран клиент {{ initialLabel ? `@${String(initialLabel).replace(/^@+/, '')}` : `ID ${customerId}` }} из базы.
    </div>
    <div v-else-if="searchError" class="flex items-center justify-between gap-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
      <span>{{ searchError }}</span>
      <button type="button" class="shrink-0 font-semibold underline focus-visible:outline-2 focus-visible:outline-red-700" @click="search">Повторить</button>
    </div>
    <p v-else-if="loading" class="text-xs text-gray-500" aria-live="polite">Ищем клиента...</p>
    <p v-else-if="showPendingUsername" class="text-xs text-amber-700">
      Клиента пока нет в базе. Решение применится при первом входе @{{ pendingUsername }}.
    </p>
    <p v-else-if="normalizedQuery && usernameLooksValid" class="text-xs text-amber-700">
      Для нового клиента укажите username со знаком @ или выберите найденного.
    </p>
    <p v-else class="text-xs text-gray-500">Выберите найденного клиента. Для ещё неизвестного клиента введите точный @username.</p>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
import type { Customer } from '@/stores/crm'

const customerId = defineModel<string | null>('customerId', { default: null })
const username = defineModel<string>('username', { default: '' })
const selectedCustomer = defineModel<Customer | null>('customer', { default: null })

const props = defineProps<{
  isOpen: boolean
  initialLabel?: string | null
  initialCustomer?: Customer | null
  blockHint?: string
}>()

const query = ref('')
const results = ref<Customer[]>([])
const loading = ref(false)
const searchError = ref('')
const inputRef = ref<HTMLInputElement | null>(null)
const uid = useId()
const inputId = `customer-target-${uid}`
let timer: ReturnType<typeof setTimeout> | null = null
let requestNumber = 0
const completedQuery = ref('')

const normalizedQuery = computed(() => query.value.trim().replace(/^@+/, ''))
const usernameLooksValid = computed(() => /^[a-zA-Z0-9_]{5,32}$/.test(normalizedQuery.value))
const pendingUsername = computed(() => {
  return !selectedCustomer.value && query.value.trim().startsWith('@') && usernameLooksValid.value
    ? normalizedQuery.value
    : ''
})
const exactResultExists = computed(() => results.value.some((item) => (
  String(item.telegram_username || '').toLowerCase() === normalizedQuery.value.toLowerCase()
)))
const showPendingUsername = computed(() => Boolean(
  pendingUsername.value
  && !loading.value
  && completedQuery.value === normalizedQuery.value.toLowerCase()
  && !exactResultExists.value
))

watch(() => props.isOpen, (open) => {
  if (timer) clearTimeout(timer)
  requestNumber += 1
  loading.value = false
  if (!open) return
  selectedCustomer.value = props.initialCustomer || null
  customerId.value = props.initialCustomer?.id || customerId.value || null
  const label = props.initialCustomer?.telegram_username || props.initialLabel || ''
  query.value = label ? `@${String(label).replace(/^@+/, '')}` : ''
  results.value = []
  completedQuery.value = ''
  searchError.value = ''
  username.value = selectedCustomer.value?.telegram_username || (customerId.value ? '' : pendingUsername.value)
  nextTick(() => inputRef.value?.focus())
})

function handleInput() {
  requestNumber += 1
  loading.value = false
  selectedCustomer.value = null
  customerId.value = null
  username.value = ''
  results.value = []
  completedQuery.value = ''
  searchError.value = ''
  scheduleSearch()
}

function scheduleSearch() {
  if (timer) clearTimeout(timer)
  if (normalizedQuery.value.length < 2 || selectedCustomer.value) {
    results.value = []
    searchError.value = ''
    return
  }
  timer = setTimeout(search, 220)
}

async function search() {
  const current = ++requestNumber
  const searchedQuery = normalizedQuery.value
  loading.value = true
  searchError.value = ''
  try {
    const response = await fetch(`/api/admin/crm/customers/search?q=${encodeURIComponent(searchedQuery)}&limit=8`, { credentials: 'include' })
    if (!response.ok) throw new Error('failed')
    const data = await response.json()
    if (current === requestNumber) {
      results.value = data.items || []
      completedQuery.value = searchedQuery.toLowerCase()
      username.value = exactResultExists.value ? '' : pendingUsername.value
    }
  } catch {
    if (current === requestNumber) {
      results.value = []
      completedQuery.value = ''
      username.value = ''
      searchError.value = 'Не удалось найти клиента'
    }
  } finally {
    if (current === requestNumber) loading.value = false
  }
}

function selectCustomer(customer: Customer) {
  selectedCustomer.value = customer
  customerId.value = customer.id
  username.value = customer.telegram_username || ''
  query.value = customer.telegram_username ? `@${customer.telegram_username}` : customer.telegram_id || customer.first_name || ''
  results.value = []
}

function clearSelection() {
  selectedCustomer.value = null
  customerId.value = null
  query.value = ''
  username.value = ''
  nextTick(() => inputRef.value?.focus())
}
</script>
