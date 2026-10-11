<template>
  <AdminModal
    :isOpen="isOpen"
    title="Создать заказ"
    reference-design
    description="Добавьте позиции и укажите username клиента — или оставьте поле пустым."
    size="2xl"
    :showActions="false"
    @close="handleClose"
    @cancel="handleClose"
  >
    <div class="order-create-form">
      <StaffCurrentActorBadge class="order-create-actor" />
      <section class="order-create-main space-y-6">
            <div class="order-create-customer grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label class="flex flex-col gap-2">
                <span class="text-sm font-medium text-gray-700">Telegram username <span class="order-create-optional">необязательно</span></span>
                <input
                  id="order-customer-username"
                  v-model="form.customerUsername"
                  type="text"
                  placeholder="@username"
                  autocomplete="off"
                  autocapitalize="none"
                  :spellcheck="false"
                  :disabled="isSubmitting || Boolean(submitSuccess)"
                  :aria-invalid="Boolean(customerUsernameError)"
                  aria-describedby="order-customer-hint order-customer-error"
                />
                <span id="order-customer-hint" class="order-create-customer-hint">Пустое поле — заказ без клиента.</span>
                <span id="order-customer-error" class="order-create-customer-error" role="status">{{ customerUsernameError }}</span>
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
                class="order-create-suggestions"
              >
                <p class="mb-2 text-xs font-semibold uppercase text-gray-500">Найдено товаров</p>
                <ul class="space-y-2">
                  <li
                    v-for="suggestion in productSuggestions"
                    :key="suggestion.id"
                    class="order-create-suggestion"
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
                        class="order-create-add"
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
                class="order-create-empty"
              >
                Добавьте товары через поиск выше - они появятся здесь для редактирования количества и цены.
              </div>

              <div v-else class="space-y-3">
                <TransitionGroup name="item-list" tag="div" class="space-y-3">
                  <article
                    v-for="item in visibleItems"
                    :key="item.variantId || item.productId"
                    class="order-create-item"
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

      <aside class="order-create-aside">
            <div class="order-create-totals space-y-4">
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
                <div class="order-create-total">
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
                class="order-create-submit"
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
                class="order-create-cancel"
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
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useCrmStore, type CrmProductSummary, type Order } from '@/stores/crm'
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
  customerUsername: '',
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

const normalizedCustomerUsername = computed(() => form.customerUsername.trim().replace(/^@/, '').toLowerCase())
const customerUsernameError = computed(() => {
  if (!form.customerUsername.trim()) return ''
  return /^[a-z0-9_]{1,32}$/.test(normalizedCustomerUsername.value)
    ? ''
    : 'Введите username: латинские буквы, цифры и подчёркивание, до 32 символов.'
})

const canSubmit = computed(() => {
  if (customerUsernameError.value) return false
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
  form.customerUsername = ''
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
      customer_username: normalizedCustomerUsername.value || undefined,
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
  const customerErrors: Record<string, string> = {
    customer_username_invalid: 'Проверьте username клиента: используйте латинские буквы, цифры и подчёркивание.',
    customer_username_not_found: 'Клиент с таким username не найден в CRM. Проверьте написание или очистите поле для заказа без клиента.',
    customer_username_ambiguous: 'В CRM несколько клиентов с таким username. Заказ не создан — сначала проверьте записи клиентов.',
    customer_username_mismatch: 'Username не соответствует указанному клиенту. Обновите форму и повторите.',
  }
  if (customerErrors[errorLower]) return customerErrors[errorLower]
  
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
.order-create-form { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); gap: 20px; color: #081b4b; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; }
.order-create-form *, .order-create-form :deep(*) { box-sizing: border-box; }
.order-create-actor { grid-column: 1 / -1; }
.order-create-main, .order-create-aside, .order-create-form label, .order-create-form dl, .order-create-form dd { min-width: 0; }
.order-create-main { padding: 20px; border: 1px solid #eaf0f9; border-radius: 16px; background: #fff; }
.order-create-optional { display: block; margin-top: 3px; color: #8999b7; font-size: 11px; font-weight: 400; }
.order-create-customer-hint { color: #66799e; font-size: 11px; line-height: 1.5; }
.order-create-customer-error { color: #d92342; font-size: 11px; line-height: 1.5; }
.order-create-customer-error:empty { display: none; }
.order-create-form input[aria-invalid="true"] { border-color: #e7a4b0; }
.order-create-aside { display: flex; flex-direction: column; gap: 18px; }
.order-create-form input:not([type="radio"]), .order-create-form select, .order-create-form textarea { max-width: 100%; min-width: 0; border: 1px solid #dce8fa; border-radius: 10px; background: #f7fbff; color: #081b4b; padding: 10px 12px; font: inherit; font-size: 13px; line-height: 1.4; box-shadow: none; }
.order-create-form textarea { resize: vertical; min-height: 80px; }
.order-create-form input::placeholder, .order-create-form textarea::placeholder { color: #8999b7; opacity: 1; }
.order-create-form input:focus-visible, .order-create-form select:focus-visible, .order-create-form textarea:focus-visible { outline: 2px solid #0958ff; outline-offset: 2px; border-color: #b8cef5; box-shadow: none; }
.order-create-form input[type="radio"] { accent-color: #1759ed; }
.order-create-form button { font-family: inherit; cursor: pointer; }
.order-create-form button:focus-visible { outline: 2px solid #0958ff; outline-offset: 3px; }
.order-create-form button:disabled { opacity: .5; cursor: not-allowed; }
.order-create-form .text-gray-700, .order-create-form .text-gray-600 { color: #425778; }
.order-create-form .text-gray-500, .order-create-form .text-gray-400 { color: #66799e; }
.order-create-form .text-gray-900 { color: #081b4b; }
.order-create-form .text-blue-600 { color: #1759ed; }
.order-create-form h3 { color: #081b4b; font-size: 14px; font-weight: 750; text-transform: none; letter-spacing: -.01em; }
.order-create-suggestions { padding: 12px; border: 1px solid #dce8fa; border-radius: 13px; background: #f7fbff; font-size: 13px; }
.order-create-suggestion { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 12px; border: 1px solid #eaf0f9; border-radius: 10px; background: #fff; }
.order-create-suggestion > div { min-width: 0; max-width: 100%; overflow-wrap: anywhere; }
.order-create-add, .order-create-submit { display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: 0; border-radius: 12px; background: linear-gradient(100deg, #05b8ff, #185dff); color: #fff; font-weight: 750; }
.order-create-add { min-height: 36px; padding: 9px 12px; font-size: 11px; }
.order-create-submit { width: 100%; min-height: 44px; padding: 13px 18px; font-size: 13px; box-shadow: 0 8px 16px #148cff30; }
.order-create-add:hover, .order-create-submit:not(:disabled):hover { filter: brightness(1.05); }
.order-create-empty { padding: 24px 16px; border: 1px dashed #dce8fa; border-radius: 13px; background: #f7fbff; color: #66799e; font-size: 12px; line-height: 1.6; }
.order-create-item { padding: 16px; border: 1px solid #dce8fa; border-radius: 13px; background: #f7fbff; overflow-wrap: anywhere; }
.order-create-item .admin-link-button--danger { color: #d92342; }
.order-create-item > div:last-child { flex-wrap: wrap; gap: 8px; }
.order-create-totals { padding: 20px; border: 1px solid #eaf0f9; border-radius: 16px; background: #fff; box-shadow: 0 12px 35px #20386908; }
.order-create-totals dl > div { gap: 12px; }
.order-create-total { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px; padding-top: 16px; border-top: 1px solid #eaf0f9; color: #081b4b; font-size: 13px; font-weight: 700; }
.order-create-total dd { font-size: 27px; line-height: 1.2; font-weight: 900; letter-spacing: -.04em; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.order-create-cancel { width: 100%; min-height: 44px; padding: 13px 18px; border: 1px solid #dce8fa; border-radius: 12px; background: linear-gradient(#f7faff, #e9f0fa); color: #233e70; font-size: 13px; font-weight: 750; }
.order-create-cancel:hover { background: #eaf1ff; }
@media (max-width: 800px) { .order-create-form { grid-template-columns: minmax(0, 1fr); gap: 16px; } }
@media (max-width: 480px) { .order-create-main, .order-create-totals { padding: 14px; } .order-create-item { padding: 12px; } .order-create-form input:not([type="radio"]), .order-create-form select, .order-create-form textarea { font-size: 16px; } .order-create-totals header { flex-wrap: wrap; gap: 6px; } }
@media (prefers-reduced-motion: reduce) { .order-create-form *, .order-create-form :deep(*) { transition: none !important; animation: none !important; } }

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
