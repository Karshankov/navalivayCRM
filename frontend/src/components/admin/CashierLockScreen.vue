<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[100] flex bg-gray-100" data-no-smoke>
      <!-- Main content area -->
      <div class="flex-1 flex flex-col p-6 overflow-auto">
        <!-- Header with age verification -->
        <div class="mb-6">
          <div class="inline-flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
            <ExclamationTriangleIcon class="h-5 w-5 text-amber-600" />
            <div>
              <p class="text-sm font-semibold text-amber-800">Проверяйте документы</p>
              <p class="text-sm text-amber-700">дата в документах совершеннолетнего до {{ ageVerificationDate }}</p>
            </div>
          </div>
        </div>

        <!-- Sale form -->
        <div class="flex-1 flex items-start justify-center">
          <div class="w-full max-w-lg">
            <div class="rounded-2xl bg-white shadow-lg border border-gray-200 overflow-hidden">
              <!-- Form header -->
              <div class="flex items-center justify-between px-6 py-4 bg-gray-50 border-b border-gray-200">
                <h2 class="text-lg font-bold text-gray-900 uppercase tracking-wide">Создание чека продажи</h2>
                <button
                  @click="clearForm"
                  class="rounded-full bg-red-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-600 transition-colors"
                >
                  отмена
                </button>
              </div>

              <!-- Form body -->
              <div class="p-6 space-y-4">
                <!-- Product name -->
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Напишите что продали</label>
                  <input
                    ref="productNameInput"
                    v-model="form.productName"
                    type="text"
                    class="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200"
                    placeholder="Например: Одноразка PPWJ 2000"
                    @keydown.enter="focusPrice"
                  />
                </div>

                <!-- Price and comment row -->
                <div class="grid grid-cols-2 gap-4">
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">
                      Цена с учетом скидки
                      <span class="text-xs text-gray-500">(смотрим ценники)</span>
                    </label>
                    <input
                      ref="priceInput"
                      v-model="form.price"
                      type="number"
                      step="0.01"
                      min="0"
                      class="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200"
                      placeholder="0"
                      @keydown.enter="focusComment"
                    />
                  </div>
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">комментарий</label>
                    <input
                      ref="commentInput"
                      v-model="form.costPrice"
                      type="number"
                      step="0.01"
                      min="0"
                      class="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200"
                      placeholder="необязательно"
                      @keydown.enter.exact="submitSale"
                      @keydown.ctrl.enter.exact="submitSale"
                    />
                  </div>
                </div>

                <!-- Action buttons -->
                <div class="flex gap-3 pt-2">
                  <button
                    @click="submitSale"
                    :disabled="!canSubmit || isSubmitting"
                    class="flex-1 rounded-lg bg-green-500 px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-green-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {{ isSubmitting ? 'Проводим...' : 'Провести чек' }}
                  </button>
                  <button
                    @click="submitPending"
                    :disabled="!canSubmitPending || isSubmitting"
                    class="flex-1 rounded-lg bg-amber-400 px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Отложить чек
                  </button>
                </div>

                <!-- Success message -->
                <Transition name="fade">
                  <div v-if="successMessage" class="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700 flex items-center gap-2">
                    <CheckCircleIcon class="h-5 w-5 text-green-500" />
                    {{ successMessage }}
                  </div>
                </Transition>

                <!-- Error message -->
                <Transition name="fade">
                  <div v-if="errorMessage" class="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                    {{ errorMessage }}
                  </div>
                </Transition>
              </div>
            </div>

            <!-- Pending sales list -->
            <div v-if="pendingSales.length > 0" class="mt-6 rounded-2xl bg-white shadow-lg border border-gray-200 overflow-hidden">
              <div class="px-6 py-4 bg-gray-50 border-b border-gray-200">
                <h3 class="text-sm font-bold text-gray-900">Отложенные чеки ({{ pendingSales.length }})</h3>
              </div>
              <div class="divide-y divide-gray-100">
                <div
                  v-for="sale in pendingSales"
                  :key="sale.id"
                  class="flex items-center justify-between px-6 py-3 hover:bg-gray-50"
                >
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-gray-900 truncate">{{ sale.product_name }}</p>
                    <p class="text-xs text-gray-500">{{ formatPrice(sale.price) }} BYN</p>
                    <!-- Привязанный клиент чека (если был выбран при откладывании) -->
                    <p
                      v-if="sale.customer_id"
                      class="mt-0.5 text-xs text-blue-600 truncate"
                      :title="sale.customer_phone || ''"
                    >
                      👤 {{ formatPendingSaleCustomer(sale) }}
                    </p>
                  </div>
                  <button
                    @click="openCompletePendingModal(sale)"
                    class="ml-4 rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-600 transition-colors"
                  >
                    дозаполнить
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!--
        ВАЖНО: это намеренная маскировка по требованию заказчика.
        Блок ниже визуально выглядит как поиск товаров, но используется
        как скрытый ввод пароля и не должен переименовываться в явный auth UI.
      -->
      <!-- Right sidebar - Search (hidden password input) + клиент чека -->
      <div class="w-80 bg-white border-l border-gray-200 flex flex-col">
        <div class="p-4 border-b border-gray-200">
          <label class="block text-sm font-medium text-gray-700 mb-2">Поиск по товарам</label>
          <!--
            Форма, а не просто div: без неё с телефона в админку не войти.
            Проверено на живом телефоне: клавиатура показывала «Далее», и по
            нажатию фокус уезжал в поле клиента ниже, а keydown с Enter в
            страницу не приходил вовсе, поэтому handleSearch не вызывался и
            пароль не проверялся. В форме с единственным полем то же нажатие
            отправляет форму, а enterkeyhint="search" убирает «Далее» и
            сохраняет маскировку блока под поиск. На компьютере поведение
            прежнее: Enter отправляет форму, обработчик тот же.
          -->
          <form class="relative" @submit.prevent="handleSearch">
            <MagnifyingGlassIcon class="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              ref="searchInput"
              v-model="searchQuery"
              type="text"
              enterkeyhint="search"
              class="w-full rounded-lg border border-gray-300 pl-10 pr-4 py-2.5 text-sm focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200"
              placeholder="Введите название..."
            />
          </form>
          <!-- Fake search result -->
          <p v-if="lastSearchQuery && !isVerifying" class="mt-2 text-xs text-gray-500">
            По запросу "{{ lastSearchQuery }}" товаров не найдено
          </p>
          <p v-if="isVerifying" class="mt-2 text-xs text-gray-500">Поиск...</p>
        </div>

        <!-- Блок «Клиент чека» — поиск + создание + история. -->
        <div class="flex-1 p-4 overflow-y-auto">
          <PosCustomerPanel v-model="selectedCustomer" />
        </div>
      </div>

      <!-- Complete pending modal -->
      <Transition name="fade">
        <div
          v-if="showCompletePendingModal && selectedPendingSale"
          class="fixed inset-0 z-[110] flex items-center justify-center bg-black/50"
          v-safe-backdrop-close="closeCompletePendingModal"
        >
          <div class="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 class="text-lg font-semibold text-gray-900 mb-4">Дозаполнить чек</h3>
            <p class="text-sm text-gray-600 mb-4">
              <span class="font-medium">{{ selectedPendingSale.product_name }}</span>
              <br />
              Цена: {{ formatPrice(selectedPendingSale.price) }} BYN
            </p>
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-1">Комментарий</label>
              <input
                ref="pendingCostInput"
                v-model="pendingCostPrice"
                type="number"
                step="0.01"
                min="0"
                class="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200"
                placeholder="необязательно"
                @keydown.enter="completePendingSale"
              />
            </div>
            <div class="flex gap-3">
              <button
                @click="completePendingSale"
                :disabled="pendingCostPrice === '' || isSubmitting"
                class="flex-1 rounded-lg bg-green-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {{ isSubmitting ? 'Сохраняем...' : 'Провести' }}
              </button>
              <button
                @click="closeCompletePendingModal"
                class="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { MagnifyingGlassIcon, ExclamationTriangleIcon, CheckCircleIcon } from '@heroicons/vue/24/outline'
import { useAdminStore } from '@/stores/admin'
import { useCrmStore, type PosSale, type Customer } from '@/stores/crm'
import PosCustomerPanel from '@/components/admin/PosCustomerPanel.vue'
import { vSafeBackdropClose } from '@/directives/safeBackdropClose'

const emit = defineEmits<{
  (e: 'unlocked'): void
}>()

const adminStore = useAdminStore()
const crmStore = useCrmStore()

// Refs
const searchInput = ref<HTMLInputElement>()
const productNameInput = ref<HTMLInputElement>()
const priceInput = ref<HTMLInputElement>()
const commentInput = ref<HTMLInputElement>()
const pendingCostInput = ref<HTMLInputElement>()

// State
const searchQuery = ref('')
const lastSearchQuery = ref('')
const isVerifying = ref(false)
const isSubmitting = ref(false)
const successMessage = ref('')
const errorMessage = ref('')

// Клиент чека (опционально). Сбрасывается после успешного проведения,
// но сохраняется при «отложить чек» — продавец может вернуться к этому
// клиенту позже через дозаполнение.
const selectedCustomer = ref<Customer | null>(null)

const form = ref({
  productName: '',
  price: '',
  costPrice: ''
})

const pendingSales = ref<PosSale[]>([])
const showCompletePendingModal = ref(false)
const selectedPendingSale = ref<PosSale | null>(null)
const pendingCostPrice = ref('')

// Computed
const ageVerificationDate = computed(() => {
  const today = new Date()
  const date18YearsAgo = new Date(
    today.getFullYear() - 18,
    today.getMonth(),
    today.getDate()
  )
  return formatDate(date18YearsAgo)
})

const canSubmit = computed(() => {
  return form.value.productName.trim() && 
         form.value.price && 
         Number(form.value.price) > 0
})

const canSubmitPending = computed(() => {
  return form.value.productName.trim() && 
         form.value.price && 
         Number(form.value.price) > 0
})

// Methods
function formatDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  return `${day}.${month}.${year}`
}

function formatPrice(price: number): string {
  return price.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

/**
 * Краткое отображение клиента чека: ФИО или @username, либо телефон
 * как fallback. Используется в списке отложенных чеков.
 */
function formatPendingSaleCustomer(sale: PosSale): string {
  const name = [sale.customer_first_name, sale.customer_last_name]
    .filter(Boolean)
    .join(' ')
    .trim()
  if (name) return name
  if (sale.customer_telegram_username) return `@${sale.customer_telegram_username}`
  if (sale.customer_phone) return sale.customer_phone
  return 'Без имени'
}

function focusPrice() {
  priceInput.value?.focus()
}

function focusComment() {
  commentInput.value?.focus()
}

function clearForm() {
  form.value = {
    productName: '',
    price: '',
    costPrice: ''
  }
  errorMessage.value = ''
  successMessage.value = ''
  nextTick(() => {
    productNameInput.value?.focus()
  })
}

async function handleSearch() {
  if (!searchQuery.value.trim()) return
  
  isVerifying.value = true
  errorMessage.value = ''
  const query = searchQuery.value.trim()
  
  try {
    // Намеренная обманка: query здесь не товарный поиск, а скрытый пароль
    // для разблокировки экрана кассы. Тексты UI специально не меняем.
    await adminStore.login({
      username: 'admin',
      password: query
    })
    
    if (adminStore.isAuthenticated) {
      emit('unlocked')
    }
  } catch (error) {
    // Silent fail - just show "not found"
    lastSearchQuery.value = query
  } finally {
    isVerifying.value = false
    searchQuery.value = ''
  }
}

async function submitSale() {
  if (!canSubmit.value || isSubmitting.value) return
  
  isSubmitting.value = true
  errorMessage.value = ''
  successMessage.value = ''
  
  try {
    const costPrice = form.value.costPrice ? Number(form.value.costPrice) : null
    
    await crmStore.createPosSale({
      product_name: form.value.productName.trim(),
      price: Number(form.value.price),
      cost_price: costPrice,
      customer_id: selectedCustomer.value?.id ?? null,
    })

    successMessage.value = 'Чек проведен!'
    clearForm()
    // Открепляем клиента после успешного проведения чека —
    // следующий чек начинается «с чистого листа» (как новая покупка).
    selectedCustomer.value = null
    
    // Hide success message after 3 seconds
    setTimeout(() => {
      successMessage.value = ''
    }, 3000)
  } catch (error: any) {
    errorMessage.value = error?.message || 'Ошибка при проведении чека'
  } finally {
    isSubmitting.value = false
  }
}

async function submitPending() {
  if (!canSubmitPending.value || isSubmitting.value) return
  
  isSubmitting.value = true
  errorMessage.value = ''
  successMessage.value = ''
  
  try {
    await crmStore.createPosSale({
      product_name: form.value.productName.trim(),
      price: Number(form.value.price),
      cost_price: null, // No cost price - pending
      customer_id: selectedCustomer.value?.id ?? null,
    })

    // Перезагружаем список отложенных чеков
    await loadPendingSales()

    successMessage.value = 'Чек отложен!'
    clearForm()
    // При откладывании чека клиента НЕ сбрасываем — продавец может
    // продолжать работу с тем же клиентом (например, ещё одна позиция).
    
    setTimeout(() => {
      successMessage.value = ''
    }, 3000)
  } catch (error: any) {
    errorMessage.value = error?.message || 'Ошибка при создании чека'
  } finally {
    isSubmitting.value = false
  }
}

function openCompletePendingModal(sale: PosSale | null) {
  if (sale) {
    selectedPendingSale.value = sale
  } else if (pendingSales.value.length > 0) {
    selectedPendingSale.value = pendingSales.value[0]
  } else {
    return
  }
  
  pendingCostPrice.value = ''
  showCompletePendingModal.value = true
  
  nextTick(() => {
    pendingCostInput.value?.focus()
  })
}

function closeCompletePendingModal() {
  showCompletePendingModal.value = false
  selectedPendingSale.value = null
  pendingCostPrice.value = ''
}

async function completePendingSale() {
  if (!selectedPendingSale.value || !pendingCostPrice.value || isSubmitting.value) return
  
  isSubmitting.value = true
  
  try {
    await crmStore.updatePosSale(selectedPendingSale.value.id, {
      cost_price: Number(pendingCostPrice.value)
    })
    
    // Remove from pending list
    pendingSales.value = pendingSales.value.filter(s => s.id !== selectedPendingSale.value?.id)
    
    closeCompletePendingModal()
    successMessage.value = 'Чек проведен!'
    
    setTimeout(() => {
      successMessage.value = ''
    }, 3000)
  } catch (error: any) {
    errorMessage.value = error?.message || 'Ошибка при обновлении чека'
  } finally {
    isSubmitting.value = false
  }
}

async function loadPendingSales() {
  try {
    const sales = await crmStore.fetchPendingPosSales()
    pendingSales.value = sales
  } catch (error) {
    console.error('Failed to load pending sales:', error)
  }
}

onMounted(() => {
  loadPendingSales()
  
  // Auto-focus product name input
  nextTick(() => {
    productNameInput.value?.focus()
  })
})
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
