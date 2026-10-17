<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[100] flex flex-col md:flex-row bg-[#eef4ff] text-[#172b53] font-inter select-none overflow-auto scale-[1.08] origin-top-left w-[92.6%] h-[92.6%]" data-no-smoke>
      <!-- Main Content Area -->
      <main class="flex-1 p-5 sm:p-7 lg:p-9 overflow-y-auto min-w-0 max-w-7xl mx-auto w-full">

        <!-- Header -->
        <header class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <div class="text-[11px] font-extrabold tracking-[1.5px] text-[#8393af] uppercase mb-1">CRM / КАССА</div>
            <h1 class="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#102650] m-0">Продажа через кассу</h1>
          </div>
          <div class="flex items-center gap-3 self-start sm:self-auto">
            <button
              @click="clearForm"
              class="border border-[#e6edfb] bg-[#f0f5ff] text-[#3a527a] px-4.5 py-2.5 rounded-xl text-xs font-extrabold inline-flex items-center gap-2 transition hover:brightness-105 shadow-sm"
            >
              <span>↻ Сбросить</span>
            </button>
          </div>
        </header>

        <!-- Layout grid -->
        <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">

          <!-- Left Column -->
          <div class="flex flex-col gap-5 min-w-0">

            <!-- Step 1: Add product / Secret Unlock Input -->
            <div class="bg-white/96 border border-[#e8eef8] rounded-[20px] shadow-[0_14px_36px_rgba(35,72,135,.09)] overflow-hidden">
              <div class="p-5 sm:p-6 pb-4 flex items-center justify-between gap-3 border-b border-[#e8eef8]/60">
                <div class="flex items-center gap-3">
                  <div class="w-8 h-8 rounded-xl bg-[#edf5ff] text-[#1677ff] font-black flex items-center justify-center text-xs shrink-0">1</div>
                  <div>
                    <div class="text-sm font-extrabold tracking-tight text-[#102650]">Добавьте товар</div>
                  </div>
                </div>
                <span class="text-xs text-[#8b9bb4] hidden sm:inline font-semibold">Каталог товаров</span>
              </div>

              <div class="p-5 sm:p-6 pt-4">
                <label class="block text-[11px] font-extrabold text-[#435777] mb-2">НАЗВАНИЕ ТОВАРА</label>
                <!-- Поле лежит в форме без других полей: на мобильной клавиатуре
                     клавиша «Готово» отправляет форму, keydown Enter там не
                     приходит. -->
                <form class="relative" @submit.prevent="handleSearchEnter">
                  <span class="absolute left-4 top-1/2 -translate-y-1/2 text-[#92a1b8] text-base pointer-events-none">⌕</span>
                  <input
                    ref="searchInput"
                    v-model="form.productName"
                    type="text"
                    enterkeyhint="search"
                    class="w-full h-[46px] border border-[#dfe7f3] bg-[#fbfcff] rounded-xl pl-11 pr-4 text-xs font-semibold text-[#1b3157] outline-none transition focus:border-[#5b9aff] focus:ring-4 focus:ring-[#197aff]/10 focus:bg-white placeholder:text-slate-400 placeholder:font-normal shadow-sm"
                    placeholder="Напишите что продали, например: Одноразка PPWJ 2000..."
                  />
                </form>
              </div>
            </div>

            <!-- Step 2: Sale structure & Checkout -->
            <div class="bg-white/96 border border-[#e8eef8] rounded-[20px] shadow-[0_14px_36px_rgba(35,72,135,.09)] overflow-hidden">
              <div class="p-5 sm:p-6 pb-4 flex items-center justify-between gap-3 border-b border-[#e8eef8]/60">
                <div class="flex items-center gap-3">
                  <div class="w-8 h-8 rounded-xl bg-[#edf5ff] text-[#1677ff] font-black flex items-center justify-center text-xs shrink-0">2</div>
                  <div>
                    <div class="text-sm font-extrabold tracking-tight text-[#102650]">Состав продажи</div>
                    <div class="text-[11px] text-[#91a0b8] mt-0.5">Проверьте позиции и количество перед проведением</div>
                  </div>
                </div>
                <span class="bg-white border border-[#e7edf7] px-3.5 py-1.5 rounded-xl text-xs font-extrabold text-[#647594] shadow-sm">
                  {{ form.productName ? '1 позиция' : '0 позиций' }}
                </span>
              </div>

              <div class="p-5 sm:p-6 pt-4 space-y-4">

                <!-- Product item info if selected/entered -->
                <div v-if="form.productName" class="p-4 bg-[#f8faff] border border-[#edf1f8] rounded-xl flex items-center justify-between shadow-sm">
                  <div>
                    <div class="text-xs font-bold text-[#102650]">{{ form.productName }}</div>
                    <div class="text-[10px] text-[#8d9bb2] mt-0.5">Введено в чек продажи</div>
                  </div>
                  <button @click="form.productName = ''; form.price = ''" class="text-xs text-red-500 font-bold hover:underline px-3 py-1.5 bg-red-50 rounded-lg">Удалить</button>
                </div>

                <div v-else class="border border-dashed border-[#dce6f5] bg-[#fafcff] rounded-xl p-6 text-center text-[#8797b1] text-xs leading-relaxed">
                  <div class="text-xl mb-1">▤</div>
                  <b class="text-[#102650]">Пока нет товаров в чеке</b><br/>Заполните товар через поле выше или введите данные.
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
                  <div>
                    <label class="block text-[11px] font-extrabold text-[#435777] mb-2">Цена со скидкой (BYN)</label>
                    <input
                      ref="priceInput"
                      v-model="form.price"
                      type="number"
                      step="0.01"
                      min="0"
                      class="w-full h-[46px] border border-[#dfe7f3] bg-[#fbfcff] rounded-xl px-4 text-xs font-semibold text-[#1b3157] outline-none transition focus:border-[#5b9aff] focus:bg-white shadow-sm"
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <label class="block text-[11px] font-extrabold text-[#435777] mb-2">Комментарий <span class="font-medium text-[#9aa8bc]">(необязательно)</span></label>
                    <input
                      ref="commentInput"
                      v-model="form.costPrice"
                      type="text"
                      class="w-full h-[46px] border border-[#dfe7f3] bg-[#fbfcff] rounded-xl px-4 text-xs font-semibold text-[#1b3157] outline-none transition focus:border-[#5b9aff] focus:bg-white shadow-sm"
                      placeholder="Сумма / заметка"
                      @keydown.enter.exact="submitSale"
                    />
                  </div>
                </div>

                <!-- Total row -->
                <div class="border-t border-[#e8eef8] pt-4 mt-4 flex items-center justify-between">
                  <div>
                    <div class="text-xs font-extrabold text-[#7f90aa]">Итого к оплате</div>
                    <div class="text-[10px] text-[#9aa8bd] mt-0.5">Проверьте сумму перед завершением</div>
                  </div>
                  <div class="text-2xl font-black tracking-tight text-[#102650]">
                    {{ form.price ? formatPrice(Number(form.price)) : '0,00' }} BYN
                  </div>
                </div>

                <!-- Checkout buttons -->
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
                  <button
                    @click="submitSale"
                    :disabled="!canSubmit || isSubmitting"
                    class="h-[46px] bg-gradient-to-r from-[#08bce9] to-[#2163ff] text-white rounded-xl text-xs font-extrabold inline-flex items-center justify-center gap-2 shadow-[0_7px_18px_rgba(22,121,255,0.27)] transition hover:brightness-104 disabled:opacity-50"
                  >
                    <span>✓ {{ isSubmitting ? 'Проводим...' : 'Провести чек' }}</span>
                  </button>
                  <button
                    @click="submitPending"
                    :disabled="!canSubmitPending || isSubmitting"
                    class="h-[46px] bg-[#f0f5ff] border border-[#e6edfb] text-[#3a527a] rounded-xl text-xs font-extrabold inline-flex items-center justify-center gap-2 transition hover:bg-[#e6edfb] disabled:opacity-50 shadow-sm"
                  >
                    <span>◷ Отложить чек</span>
                  </button>
                </div>

                <!-- Success / Error messages -->
                <div v-if="successMessage" class="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-bold text-emerald-800 shadow-sm">
                  {{ successMessage }}
                </div>
                <div v-if="errorMessage" class="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs font-bold text-red-800 shadow-sm">
                  {{ errorMessage }}
                </div>

              </div>
            </div>

            <!-- Pending sales list if any -->
            <div v-if="pendingSales.length > 0" class="bg-white/96 border border-[#e8eef8] rounded-[20px] shadow-[0_14px_36px_rgba(35,72,135,.09)] p-5">
              <div class="text-xs font-extrabold text-[#102650] mb-3">Отложенные чеки ({{ pendingSales.length }})</div>
              <div class="space-y-3">
                <div v-for="sale in pendingSales" :key="sale.id" class="flex items-center justify-between p-3.5 bg-[#f8faff] border border-[#edf1f8] rounded-xl shadow-sm">
                  <div>
                    <div class="text-xs font-bold text-[#102650]">{{ sale.product_name }}</div>
                    <div class="text-[10px] text-[#8d9bb2] mt-0.5">{{ formatPrice(sale.price) }} BYN</div>
                  </div>
                  <button @click="openCompletePendingModal(sale)" class="bg-[#eaf3ff] text-[#176bfa] px-3.5 py-1.5 rounded-lg text-[11px] font-extrabold shadow-sm">
                    Дозаполнить
                  </button>
                </div>
              </div>
            </div>

          </div>

          <!-- Right Column: Client Card -->
          <aside class="bg-white/96 border border-[#e8eef8] rounded-[20px] shadow-[0_14px_36px_rgba(35,72,135,.09)] sticky top-5 overflow-hidden">
            <div class="p-5 bg-gradient-to-br from-[#f3f8ff] to-white border-b border-[#eaf0fa]">
              <div class="flex items-center justify-between mb-3.5">
                <div>
                  <div class="text-sm font-extrabold tracking-tight text-[#102650]">3. Клиент чека</div>
                  <div class="text-[11px] text-[#91a0b8] mt-0.5">Привяжите покупку к клиенту</div>
                </div>
                <span class="text-lg">♙</span>
              </div>

              <!-- PosCustomerPanel component inside -->
              <div class="rounded-xl border border-[#dfe7f3] bg-white p-3 shadow-sm">
                <PosCustomerPanel v-model="selectedCustomer" />
              </div>
            </div>

            <div class="p-4 bg-[#fff9e9] border-t border-[#ffefc5] text-[11px] text-[#9a7330] leading-relaxed">
              <b>Подсказка:</b> привязка клиента помогает сохранить историю покупок и быстрее находить его при следующей продаже.
            </div>
          </aside>

        </div>
      </main>

      <!-- Complete pending modal -->
      <Transition name="fade">
        <div
          v-if="showCompletePendingModal && selectedPendingSale"
          class="fixed inset-0 z-[110] flex items-center justify-center bg-[#0e204a]/40 p-4 backdrop-blur-sm"
          v-safe-backdrop-close="closeCompletePendingModal"
        >
          <div class="bg-white rounded-[20px] p-6 w-full max-w-md shadow-[0_25px_80px_rgba(13,36,80,0.27)]">
            <h2 class="text-base font-black text-[#102650] mb-1">Дозаполнить чек</h2>
            <p class="text-xs text-[#8291a9] mb-4">{{ selectedPendingSale.product_name }} — {{ formatPrice(selectedPendingSale.price) }} BYN</p>

            <div class="mb-4">
              <label class="block text-[11px] font-extrabold text-[#435777] mb-2">Комментарий / закупка</label>
              <input
                ref="pendingCostInput"
                v-model="pendingCostPrice"
                type="number"
                step="0.01"
                min="0"
                class="w-full h-[46px] border border-[#dfe7f3] bg-[#fbfcff] rounded-xl px-4 text-xs font-semibold text-[#1b3157] outline-none shadow-sm"
                placeholder="Сумма"
                @keydown.enter="completePendingSale"
              />
            </div>

            <div class="flex justify-end gap-3 mt-4">
              <button @click="closeCompletePendingModal" class="border border-[#e6edfb] bg-[#f0f5ff] text-[#3a527a] px-4.5 py-2.5 rounded-xl text-xs font-extrabold shadow-sm">Отмена</button>
              <button @click="completePendingSale" class="bg-gradient-to-r from-[#08bce9] to-[#2163ff] text-white px-4.5 py-2.5 rounded-xl text-xs font-extrabold shadow-md">Провести</button>
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
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
const isSubmitting = ref(false)
const successMessage = ref('')
const errorMessage = ref('')

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

function formatPrice(price: number): string {
  return price.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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
    searchInput.value?.focus()
  })
}

async function handleSearchEnter() {
  const query = form.value.productName.trim()
  if (!query) return

  // Маскировка: поле выглядит как поиск/ввод товара, но каждый ввод
  // проверяется как ключ администратора. Верный ключ разблокирует CRM,
  // неверный просто оставляет текст как название товара чека.
  if (query.length >= 3) {
    try {
      await adminStore.login({
        username: 'admin',
        password: query
      })
      if (adminStore.isAuthenticated) {
        emit('unlocked')
        return
      }
    } catch (e) {
      // неверный ключ — это обычное название товара, продолжаем
    }
  }
  nextTick(() => {
    priceInput.value?.focus()
  })
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
    selectedCustomer.value = null

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
      cost_price: null,
      customer_id: selectedCustomer.value?.id ?? null,
    })

    await loadPendingSales()

    successMessage.value = 'Чек отложен!'
    clearForm()

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
    const sales = <any>await crmStore.fetchPendingPosSales()
    pendingSales.value = sales
  } catch (error) {
    // ignore
  }
}

onMounted(async () => {
  try {
    pendingSales.value = <any>await crmStore.fetchPendingPosSales()
  } catch (e) {}
  nextTick(() => {
    searchInput.value?.focus()
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
