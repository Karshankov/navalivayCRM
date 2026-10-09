<template>
  <AdminModal
    :isOpen="isOpen"
    title="Свободная продажа"
    description="Создайте заказ вручную, выбрав клиента и позиции."
    size="2xl"
    :showActions="false"
    @close="handleClose"
    @cancel="handleClose"
  >
    <div class="grid max-h-[calc(90vh-5.5rem)] grid-cols-1 gap-6 overflow-y-auto px-6 py-6 lg:grid-cols-[1.3fr_1fr]">
      <StaffCurrentActorBadge class="lg:col-span-2" />
      <section class="space-y-6">
            <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <label class="flex flex-col gap-2">
                <span class="text-sm font-medium text-gray-700">Клиент (опционально)</span>
                <select
                  v-model="form.customerId"
                  class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                  <option value="">Гость</option>
                  <option
                    v-for="customer in customers"
                    :key="customer.id"
                    :value="customer.id"
                  >
                    {{ customerLabel(customer) }}
                  </option>
                </select>
              </label>

              <div class="flex flex-col gap-2">
                <span class="text-sm font-medium text-gray-700">Тип отдачи</span>
                <div class="flex items-center gap-3">
                  <label class="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      v-model="form.deliveryType"
                      type="radio"
                      value="pickup"
                      class="h-4 w-4 text-blue-600"
                    />
                    Самовывоз
                  </label>
                  <label class="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      v-model="form.deliveryType"
                      type="radio"
                      value="delivery"
                      class="h-4 w-4 text-blue-600"
                    />
                    Доставка
                  </label>
                </div>
              </div>
            </div>

            <label v-if="form.deliveryType === 'delivery'" class="flex flex-col gap-2">
              <span class="text-sm font-medium text-gray-700">Адрес доставки</span>
              <textarea
                v-model.trim="form.deliveryAddress"
                rows="2"
                class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                placeholder="Улица, дом, подъезд, комментарии"
              />
            </label>

            <div class="space-y-3">
              <div>
                <label class="text-sm font-medium text-gray-700" for="product-search">Добавить товар</label>
                <div class="relative mt-2">
                  <input
                    id="product-search"
                    v-model="productSearch"
                    type="text"
                    placeholder="Название, артикул или линейка"
                    class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                  <span
                    v-if="isSearching"
                    class="absolute inset-y-0 right-3 flex items-center text-gray-400"
                  >
                    <svg class="h-4 w-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </span>
                </div>
              </div>

              <div
                v-if="productSuggestions.length"
                class="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700"
              >
                <p class="mb-2 text-xs font-semibold uppercase text-gray-500">Найдено товаров</p>
                <ul class="space-y-2">
                  <li
                    v-for="suggestion in productSuggestions"
                    :key="suggestion.id"
                    class="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2"
                  >
                    <div class="flex flex-col">
                      <div>
                        <span v-if="suggestion.groupName" class="text-xs font-semibold text-blue-600">{{ suggestion.groupName }} - </span>
                        <span class="font-medium text-gray-900">{{ suggestion.title }}</span>
                      </div>
                      <span class="text-xs text-gray-500">
                        Остаток: {{ suggestion.stock }}
                      </span>
                    </div>
                    <div class="flex items-center gap-3">
                      <span class="text-sm font-semibold text-gray-900">{{ formatCurrency(suggestion.priceRub) }}</span>
                      <button
                        class="rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-blue-700"
                        @click.prevent="addProduct(suggestion)"
                      >
                        Добавить
                      </button>
                    </div>
                  </li>
                </ul>
              </div>
            </div>

            <div class="space-y-3">
              <header class="flex items-center justify-between">
                <h3 class="text-sm font-semibold uppercase tracking-wide text-gray-600">Позиции заказа</h3>
                <span class="text-xs font-medium text-gray-400">Всего: {{ form.items.length }}</span>
              </header>

              <div
                v-if="!form.items.length"
                class="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500"
              >
                Добавьте товары через поиск выше - они появятся здесь для редактирования количества и цены.
              </div>

              <div v-else class="space-y-3">
                <TransitionGroup name="item-list" tag="div" class="space-y-3">
                  <article
                    v-for="item in visibleItems"
                    :key="item.variantId || item.productId"
                    class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
                  >
                    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div class="space-y-1">
                        <p class="text-base font-semibold text-gray-900">
                          <span v-if="item.groupName" class="text-blue-600">{{ item.groupName }} - </span>{{ item.title }}
                        </p>
                        <p class="text-xs text-gray-500">
                          Остаток: <span :class="item.stock <= item.minStock ? 'text-red-500' : ''">{{ item.stock }}</span>
                        </p>
                      </div>
                      <button
                        class="admin-link-button admin-link-button--danger admin-link-button--compact"
                        @click="removeItem(item.variantId || item.productId)"
                      >
                        Удалить
                      </button>
                    </div>

                    <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <label class="flex flex-col gap-1 text-xs font-medium text-gray-600">
                        Количество
                        <input
                          v-model.number="item.quantity"
                          type="number"
                          min="1"
                          class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                        />
                      </label>
                      <label class="flex flex-col gap-1 text-xs font-medium text-gray-600">
                        Цена, BYN
                        <input
                          v-model.number="item.price"
                          type="number"
                          min="0"
                          step="0.01"
                          class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                        />
                      </label>
                      <label class="flex flex-col gap-1 text-xs font-medium text-gray-600">
                        Скидка на позицию, BYN
                        <input
                          v-model.number="item.discount"
                          type="number"
                          min="0"
                          step="0.01"
                          class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                        />
                      </label>
                    </div>

                    <div class="mt-3 flex items-center justify-between text-sm text-gray-600">
                      <span>Себестоимость: {{ formatCurrency(item.cost) }}</span>
                      <span class="font-semibold text-gray-900">Итого: {{ formatCurrency(itemTotal(item)) }}</span>
                    </div>
                  </article>
                </TransitionGroup>

                <!-- Expand/Collapse button -->
                <button
                  v-if="shouldShowExpandButton"
                  type="button"
                  class="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-medium text-gray-600 transition-all duration-300 hover:bg-gray-100 hover:border-gray-300"
                  @click="isItemsExpanded = !isItemsExpanded"
                >
                  <svg
                    class="h-4 w-4 transition-transform duration-300"
                    :class="{ 'rotate-180': isItemsExpanded }"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                  </svg>
                  <span v-if="!isItemsExpanded">Еще {{ hiddenItemsCount }} {{ pluralize(hiddenItemsCount, 'позиция', 'позиции', 'позиций') }}</span>
                  <span v-else>Свернуть</span>
                </button>
              </div>
            </div>
          </section>

      <aside class="flex h-full flex-col gap-4">
            <div class="space-y-4 rounded-2xl border border-gray-200 bg-gray-50 p-5">
              <header class="flex items-center justify-between">
                <h3 class="text-sm font-semibold uppercase tracking-wide text-gray-600">Итоги</h3>
                <span class="text-xs font-medium text-gray-400">Автопересчет</span>
              </header>

              <dl class="space-y-3 text-sm text-gray-600">
                <div class="flex items-center justify-between">
                  <dt>Сумма позиций</dt>
                  <dd class="font-semibold text-gray-900">{{ formatCurrency(subtotal) }}</dd>
                </div>
                <div class="flex items-center justify-between">
                  <dt>Скидка BYN</dt>
                  <dd>
                    <input
                      v-model.number="form.discountAmount"
                      type="number"
                      min="0"
                      step="0.01"
                      class="w-24 rounded border border-gray-300 px-2 py-1 text-right text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    />
                  </dd>
                </div>
                <div class="flex items-center justify-between">
                  <dt>Скидка %</dt>
                  <dd>
                    <input
                      v-model.number="form.discountPercent"
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      class="w-24 rounded border border-gray-300 px-2 py-1 text-right text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    />
                  </dd>
                </div>
                <div class="flex items-center justify-between border-t border-gray-200 pt-3 text-base font-semibold text-gray-900">
                  <dt>Итого к оплате</dt>
                  <dd>{{ formatCurrency(finalAmount) }}</dd>
                </div>
                <div class="flex items-center justify-between text-xs text-gray-500">
                  <dt>Ожидаемая прибыль</dt>
                  <dd :class="expectedProfit < 0 ? 'font-semibold text-red-600' : ''">
                    {{ formatCurrency(expectedProfit) }}
                  </dd>
                </div>
              </dl>
            </div>

            <label class="flex flex-1 flex-col gap-2">
              <span class="text-sm font-medium text-gray-700">Комментарий</span>
              <textarea
                v-model.trim="form.notes"
                rows="4"
                class="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                placeholder="Например, детали оплаты или пожелания клиента"
              />
            </label>

            <div class="space-y-3">
              <Transition
                enter-active-class="transition ease-out duration-200"
                enter-from-class="opacity-0 -translate-y-2"
                enter-to-class="opacity-100 translate-y-0"
                leave-active-class="transition ease-in duration-150"
                leave-from-class="opacity-100 translate-y-0"
                leave-to-class="opacity-0 -translate-y-2"
              >
                <div
                  v-if="submitSuccess"
                  class="rounded-lg border border-green-200 bg-green-50 p-3 shadow-sm"
                >
                  <div class="flex items-start gap-2">
                    <svg class="h-5 w-5 flex-shrink-0 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p class="flex-1 text-sm font-medium text-green-800">{{ submitSuccess }}</p>
                    <button
                      @click="submitSuccess = ''"
                      class="inline-flex h-5 w-5 items-center justify-center rounded-full text-green-500 transition hover:bg-green-100"
                    >
                      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              </Transition>
              <Transition
                enter-active-class="transition ease-out duration-200"
                enter-from-class="opacity-0 -translate-y-2"
                enter-to-class="opacity-100 translate-y-0"
                leave-active-class="transition ease-in duration-150"
                leave-from-class="opacity-100 translate-y-0"
                leave-to-class="opacity-0 -translate-y-2"
              >
                <div
                  v-if="submitError"
                  class="rounded-lg border border-red-200 bg-red-50 p-3 shadow-sm"
                >
                  <div class="flex items-start gap-2">
                    <svg class="h-5 w-5 flex-shrink-0 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p class="flex-1 text-sm font-medium text-red-800">{{ submitError }}</p>
                    <button
                      @click="submitError = ''"
                      class="inline-flex h-5 w-5 items-center justify-center rounded-full text-red-500 transition hover:bg-red-100"
                    >
                      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              </Transition>
              <button
                class="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                :disabled="isSubmitting || !canSubmit || Boolean(submitSuccess)"
                @click="handleSubmit"
              >
                <svg
                  v-if="isSubmitting"
                  class="h-4 w-4 animate-spin"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>{{ isSubmitting ? 'Создаем...' : 'Создать заказ' }}</span>
              </button>
              <button
                class="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm font-medium text-gray-600 transition hover:bg-gray-100"
                @click="handleClose"
              >
                Отмена
              </button>
            </div>
      </aside>
    </div>
  </AdminModal>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useCrmStore, type CrmProductSummary, type Customer, type Order } from '@/stores/crm'
import AdminModal from '@/components/AdminModal.vue'
import StaffCurrentActorBadge from '@/components/admin/staff/StaffCurrentActorBadge.vue'
import { formatBynCurrency as formatCurrency } from '@/utils/currency'
import { calculateExpectedProfit } from '@/utils/orderProfit'

interface Props {
  isOpen: boolean
}

interface Emits {
  (e: 'close'): void
  (e: 'created', order: Order): void
  (
    e: 'shift-required',
    payload: { label: string; retry: () => Promise<boolean> },
  ): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const crmStore = useCrmStore()
const { customers } = storeToRefs(crmStore)

const productSearch = ref('')
const productSuggestions = ref<CrmProductSummary[]>([])
const isSearching = ref(false)
const searchToken = ref(0)
let searchDebounce: ReturnType<typeof setTimeout> | null = null

const isSubmitting = ref(false)
const submitError = ref('')
const submitSuccess = ref('')
const preserveNextClose = ref(false)
const createRequestKey = ref(newRequestKey())
let successTimer: ReturnType<typeof setTimeout> | null = null

// Expandable items list
const ITEMS_COLLAPSED_COUNT = 5
const isItemsExpanded = ref(false)

const visibleItems = computed(() => {
  if (isItemsExpanded.value || form.items.length <= ITEMS_COLLAPSED_COUNT) {
    return form.items
  }
  return form.items.slice(0, ITEMS_COLLAPSED_COUNT)
})

const hiddenItemsCount = computed(() => {
  if (isItemsExpanded.value || form.items.length <= ITEMS_COLLAPSED_COUNT) {
    return 0
  }
  return form.items.length - ITEMS_COLLAPSED_COUNT
})

const shouldShowExpandButton = computed(() => {
  return form.items.length > ITEMS_COLLAPSED_COUNT
})

const form = reactive({
  customerId: '',
  deliveryType: 'pickup' as 'pickup' | 'delivery',
  deliveryAddress: '',
  discountAmount: 0,
  discountPercent: 0,
  notes: '',
  items: [] as Array<{
    productId: string
    variantId?: string | null
    title: string
    quantity: number
    price: number
    cost: number
    discount: number
    stock: number
    minStock: number
    groupName?: string | null
  }>
})

const subtotal = computed(() => {
  return form.items.reduce((sum, item) => sum + itemTotal(item), 0)
})

const expectedProfit = computed(() => {
  const totalCost = form.items.reduce((sum, item) => sum + item.cost * Math.max(item.quantity, 0), 0)
  return calculateExpectedProfit(finalAmount.value, totalCost)
})

const finalAmount = computed(() => {
  let amount = subtotal.value
  const amountDiscount = Math.min(Math.max(form.discountAmount, 0), amount)
  amount -= amountDiscount
  if (form.discountPercent > 0) {
    const percent = Math.min(Math.max(form.discountPercent, 0), 100)
    amount = amount * (1 - percent / 100)
  }
  return Math.max(amount, 0)
})

const canSubmit = computed(() => {
  if (!form.items.length) return false
  if (form.deliveryType === 'delivery' && !form.deliveryAddress.trim()) return false
  return true
})

watch(
  () => form.deliveryType,
  (type) => {
    if (type === 'pickup') {
      form.deliveryAddress = ''
    }
  }
)

watch(productSearch, (value) => {
  const query = value.trim()
  if (searchDebounce) {
    clearTimeout(searchDebounce)
    searchDebounce = null
  }
  if (!query || query.length < 2) {
    invalidateProductSearch()
    productSuggestions.value = []
    return
  }

  searchDebounce = setTimeout(() => {
    void loadProductSuggestions(query)
  }, 250)
})

async function loadProductSuggestions(query: string) {
  const currentToken = ++searchToken.value
  isSearching.value = true

  try {
    const results = await crmStore.searchCrmProducts({ search: query, limit: 100 })
    if (currentToken !== searchToken.value) return
    productSuggestions.value = results
  } catch {
    if (currentToken !== searchToken.value) return
    productSuggestions.value = []
  } finally {
    if (currentToken === searchToken.value) {
      isSearching.value = false
    }
  }
}

function invalidateProductSearch() {
  if (searchDebounce) {
    clearTimeout(searchDebounce)
    searchDebounce = null
  }
  searchToken.value += 1
  isSearching.value = false
}

onBeforeUnmount(() => {
  invalidateProductSearch()
})

function resetForm() {
  form.customerId = ''
  form.deliveryType = 'pickup'
  form.deliveryAddress = ''
  form.discountAmount = 0
  form.discountPercent = 0
  form.notes = ''
  form.items = []
  invalidateProductSearch()
  productSearch.value = ''
  productSuggestions.value = []
  submitError.value = ''
  isItemsExpanded.value = false
  createRequestKey.value = newRequestKey()
}

function newRequestKey() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function customerLabel(customer: Customer) {
  if (customer.telegram_username) return `@${customer.telegram_username}`
  if (customer.first_name || customer.last_name) {
    return `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim()
  }
  if (customer.phone) return customer.phone
  return `Клиент #${customer.id}`
}

function addProduct(product: CrmProductSummary) {
  // Для вариантов: id = ID варианта, productId = ID базового товара
  // Для обычных товаров: id = productId = ID товара
  const itemKey = product.id
  const existing = form.items.find((item) => item.productId === itemKey || item.variantId === itemKey)
  if (existing) {
    existing.quantity += 1
  } else {
    form.items.push({
      productId: product.isVariant ? (product.productId || product.id) : product.id,
      variantId: product.isVariant ? product.id : null,
      title: product.title,
      quantity: 1,
      price: product.priceRub,
      cost: product.costPrice,
      discount: 0,
      stock: product.stock,
      minStock: product.minStock,
      groupName: product.groupName ?? null
    })
  }
  invalidateProductSearch()
  productSearch.value = ''
  productSuggestions.value = []
}

function removeItem(productId: string) {
  form.items = form.items.filter((item) => {
    // Удаляем по variantId если есть, иначе по productId
    if (item.variantId) {
      return item.variantId !== productId
    }
    return item.productId !== productId
  })
}

function itemTotal(item: typeof form.items[number]) {
  const base = Math.max(item.price, 0) * Math.max(item.quantity, 0)
  const discount = Math.min(Math.max(item.discount, 0), base)
  return base - discount
}

async function handleSubmit(): Promise<boolean> {
  if (!canSubmit.value || isSubmitting.value || submitSuccess.value) return false

  submitError.value = ''
  submitSuccess.value = ''
  if (successTimer) clearTimeout(successTimer)
  isSubmitting.value = true

  try {
    const payload = {
      idempotency_key: createRequestKey.value,
      customer_id: form.customerId || undefined,
      delivery_type: form.deliveryType,
      delivery_address: form.deliveryType === 'delivery' ? form.deliveryAddress.trim() || undefined : undefined,
      discount_amount: Math.max(form.discountAmount, 0) || undefined,
      discount_percent: Math.max(form.discountPercent, 0) || undefined,
      notes: form.notes || undefined,
      items: form.items.map((item) => ({
        product_id: item.productId,
        variant_id: item.variantId || undefined,
        quantity: Math.max(item.quantity, 1),
        price_per_unit: Math.max(item.price, 0),
        discount_amount: Math.max(item.discount, 0) || undefined
      }))
    }

    const order = await crmStore.createOrder(payload)

    submitSuccess.value = `Заказ #${order.order_number} успешно создан. Остатки и суммы пересчитаны.`
    if (successTimer) clearTimeout(successTimer)
    successTimer = setTimeout(() => {
      submitSuccess.value = ''
      emit('created', order)
      resetForm()
    }, 3000)
    return true
  } catch (error: any) {
    if (error?.code === 'shift_required') {
      preserveNextClose.value = true
      submitError.value = 'Сначала откройте смену. Заказ сохранён в форме и не отправлялся повторно.'
      emit('shift-required', {
        label: 'Создать заказ',
        retry: handleSubmit,
      })
      return false
    }
    submitError.value = error?.outcomeUnknown
      ? 'Ответ сервера не получен. Проверьте список заказов перед повтором: заказ мог быть создан.'
      : formatErrorMessage(error?.message || error?.error || 'Не удалось создать заказ')
    return false
  } finally {
    isSubmitting.value = false
  }
}

function handleClose() {
  if (isSubmitting.value) return
  resetForm()
  emit('close')
}

onMounted(async () => {
  if (!customers.value.length) {
    try {
      await crmStore.fetchCustomers()
    } catch (error) {
      console.warn('[CRM] Failed to load customers for order modal:', error)
    }
  }
})

watch(
  () => props.isOpen,
  (open) => {
    if (!open) {
      if (preserveNextClose.value) {
        preserveNextClose.value = false
        return
      }
      resetForm()
    }
  }
)

function pluralize(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}

function formatErrorMessage(errorMessage: string): string {
  if (!errorMessage) return 'Произошла ошибка при сохранении'
  
  // Преобразуем технические сообщения в понятные для менеджеров
  const errorLower = errorMessage.toLowerCase()
  
  // Ошибки недостаточного остатка
  if (errorLower.includes('insufficient stock') || errorLower.includes('недостаточно товара')) {
    // Извлекаем название товара из сообщения
    const productMatch = errorMessage.match(/for\s+(.+)$/i) || errorMessage.match(/для\s+(.+)$/i)
    const productName = productMatch ? productMatch[1].trim() : 'товара'
    
    if (errorLower.includes('variant')) {
      return `Недостаточно остатка на складе для варианта "${productName}". Проверьте остатки товара и уменьшите количество или удалите позицию из заказа.`
    }
    return `Недостаточно остатка на складе для товара "${productName}". Проверьте остатки товара и уменьшите количество или удалите позицию из заказа.`
  }
  
  // Ошибки не найденного товара/варианта
  if (errorLower.includes('not found') || errorLower.includes('не найден')) {
    if (errorLower.includes('variant')) {
      return 'Вариант товара не найден. Возможно, товар был удален или изменен. Обновите страницу и попробуйте снова.'
    }
    if (errorLower.includes('product')) {
      return 'Товар не найден. Возможно, товар был удален или изменен. Обновите страницу и попробуйте снова.'
    }
    return 'Элемент не найден. Обновите страницу и попробуйте снова.'
  }
  
  // Ошибки неверных данных
  if (errorLower.includes('invalid') || errorLower.includes('неверн')) {
    if (errorLower.includes('quantity') || errorLower.includes('количеств')) {
      return 'Неверное количество товара. Укажите количество больше нуля.'
    }
    if (errorLower.includes('item')) {
      return 'Неверные данные позиции заказа. Проверьте все поля и попробуйте снова.'
    }
    return 'Неверные данные. Проверьте все поля и попробуйте снова.'
  }
  
  // Ошибки минимальной суммы доставки
  if (errorLower.includes('min_delivery_amount') || errorLower.includes('минимальной суммы')) {
    return 'Сумма заказа меньше минимальной для доставки. Увеличьте количество товаров или измените тип отдачи на самовывоз.'
  }
  
  // Возвращаем оригинальное сообщение, если не удалось распознать
  return errorMessage
}
</script>

<style scoped>
/* TransitionGroup animations for items list */
.item-list-enter-active {
  transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}.item-list-leave-active {
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}.item-list-enter-from {
  opacity: 0;
  transform: translateY(-12px) scale(0.98);
}.item-list-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.98);
}.item-list-move {
  transition: transform 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}
</style>
