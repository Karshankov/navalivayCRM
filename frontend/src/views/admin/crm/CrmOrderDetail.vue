<template>
  <div class="crm-order-detail">
    <div class="mx-auto max-w-6xl space-y-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <button @click="$router.back()" class="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100">
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Назад к заказам
        </button>
        <div class="flex flex-wrap items-center gap-2">
          <button
            v-if="currentOrder && !loading"
            @click="refreshOrder"
            class="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-100"
            :disabled="isSaving"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Обновить
          </button>
          <button
            v-if="currentOrder && currentOrder.telegram_username"
            @click="contactClient"
            class="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-100"
            :disabled="isGeneratingMessage"
          >
            <svg v-if="isGeneratingMessage" class="h-4 w-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <svg v-else class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <span>{{ isGeneratingMessage ? 'Генерируем…' : 'Связаться с клиентом' }}</span>
          </button>
          <button
            v-if="canRemovePayment"
            @click="removePayment()"
            class="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50"
            :disabled="isSaving || deletingPayment"
          >
            <svg v-if="deletingPayment" class="h-4 w-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span v-else>Отменить оплату</span>
            <span v-if="deletingPayment">Удаляем…</span>
          </button>
          <button
            v-if="canReactivate"
            @click="reactivateOrder()"
            class="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100"
            :disabled="isSaving || reactivating"
          >
            <svg v-if="reactivating" class="h-4 w-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span v-else>Возобновить заказ</span>
          </button>
          <button
            v-if="currentOrder"
            @click="resetForm"
            class="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-100"
            :disabled="isSaving"
          >
            Сбросить изменения
          </button>
          <button
            data-test="order-save"
            @click="saveChanges"
            class="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            :disabled="!canSave"
          >
            <svg v-if="isSaving" class="h-4 w-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>{{ isSaving ? 'Сохраняем…' : 'Сохранить изменения' }}</span>
          </button>
        </div>
      </div>

      <p
        class="order-detail-save-hint text-sm text-gray-500"
        role="status"
      >
        {{ saveBlockReason }}
      </p>

      <StaffShiftBar ref="shiftBarRef" />

      <!-- Error/Success banners at the top -->
      <Transition
        enter-active-class="transition ease-out duration-200"
        enter-from-class="opacity-0 -translate-y-2"
        enter-to-class="opacity-100 translate-y-0"
        leave-active-class="transition ease-in duration-150"
        leave-from-class="opacity-100 translate-y-0"
        leave-to-class="opacity-0 -translate-y-2"
      >
        <div
          v-if="saveError"
          class="rounded-lg border border-red-200 bg-red-50 p-4 shadow-sm"
        >
          <div class="flex items-start gap-3">
            <svg class="h-5 w-5 flex-shrink-0 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div class="flex-1">
              <p class="text-sm font-medium text-red-800">{{ saveError }}</p>
            </div>
            <button
              @click="saveError = ''"
              class="inline-flex h-6 w-6 items-center justify-center rounded-full text-red-500 transition hover:bg-red-100"
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
          v-if="saveSuccess"
          class="rounded-lg border border-green-200 bg-green-50 p-4 shadow-sm"
        >
          <div class="flex items-start gap-3">
            <svg class="h-5 w-5 flex-shrink-0 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div class="flex-1">
              <p class="text-sm font-medium text-green-800">{{ saveSuccess }}</p>
            </div>
            <button
              @click="saveSuccess = ''"
              class="inline-flex h-6 w-6 items-center justify-center rounded-full text-green-500 transition hover:bg-green-100"
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </Transition>

      <!-- Баннер: заказ требует действий менеджера -->
      <div
        v-if="currentOrder?.needs_manager_action"
        class="rounded-lg border-2 p-4 shadow-sm"
        :class="currentOrder.manager_action_type === 'cancelled_by_customer'
          ? 'border-red-300 bg-red-50'
          : 'border-orange-300 bg-orange-50'"
      >
        <div class="flex items-start gap-3">
          <svg class="h-6 w-6 flex-shrink-0" :class="currentOrder.manager_action_type === 'cancelled_by_customer' ? 'text-red-500' : 'text-orange-500'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <div class="min-w-0 flex-1">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div class="min-w-0 flex-1">
                <p class="text-sm font-semibold" :class="currentOrder.manager_action_type === 'cancelled_by_customer' ? 'text-red-800' : 'text-orange-800'">
                  {{ currentOrder.manager_action_type === 'cancelled_by_customer' ? 'Заказ отменен покупателем' : 'Заказ изменен покупателем' }}
                </p>
                <div
                  v-if="currentOrder.manager_action_note"
                  class="mt-2"
                >
                  <ManagerActionSummary
                    :note="currentOrder.manager_action_note"
                    :show-heading="false"
                    :items="currentOrder.items"
                    size="xs"
                  />
                </div>
              </div>
              <button
                @click="resolveAction"
                :disabled="isResolvingAction"
                class="inline-flex shrink-0 self-start items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition disabled:opacity-60"
                :class="currentOrder.manager_action_type === 'cancelled_by_customer'
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-orange-600 hover:bg-orange-700'"
              >
                <svg v-if="isResolvingAction" class="h-4 w-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>{{ isResolvingAction ? 'Обработка...' : (currentOrder.manager_action_type === 'cancelled_by_customer' ? 'Разобрать' : 'Принять изменения') }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div v-if="loading || !currentOrder" class="rounded-2xl bg-white p-12 text-center shadow-sm">
        <div class="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-blue-600 border-r-transparent"></div>
        <p class="mt-4 text-sm text-gray-600">Загружаем заказ…</p>
      </div>

      <div v-else class="space-y-6">
        <section class="rounded-2xl bg-white p-6 shadow-sm">
          <div class="order-detail-hero-grid">
            <div class="order-detail-hero">
              <svg aria-hidden="true" class="order-detail-hero-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="m12 3 9 5v8l-9 5-9-5V8l9-5Zm0 9v9M3 8l9 4 9-4M7.5 5.5l9 5" /></svg>
              <div>
                <h1>Заказ #{{ currentOrder.order_number }}</h1>
                <p>Создан {{ formatFullDate(currentOrder.created_at) }}</p>
                <span class="order-detail-cell" data-test="order-detail-cell">{{ currentOrder.pickup_cell_number ? `Ячейка ${currentOrder.pickup_cell_number}` : 'Ячейка не назначена' }}</span>
              </div>
            </div>
            <div class="order-detail-customer">
              <div class="order-detail-customer-main">
                <div class="order-detail-customer-avatar" data-test="customer-avatar">
                  <img v-if="customerAvatarUrl && !customerAvatarFailed" :key="customerAvatarUrl" :src="customerAvatarUrl" alt="Фото клиента" referrerpolicy="no-referrer" @error="customerAvatarFailed = true" />
                  <svg v-else data-test="customer-avatar-fallback" role="img" aria-label="Стандартный аватар клиента" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
                    <circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" />
                  </svg>
                </div>
                <div class="order-detail-customer-info">
                  <h2 data-test="customer-display-name">{{ customerDisplayName }}</h2>
                  <p v-if="currentOrder.telegram_username" class="order-detail-telegram">
                    <a :href="`https://t.me/${currentOrder.telegram_username}`" target="_blank" rel="noopener noreferrer">@{{ currentOrder.telegram_username }}</a>
                  </p>
                  <p v-if="currentOrder.phone" class="order-detail-customer-phone">{{ currentOrder.phone }}</p>
                </div>
              </div>
              <div v-if="currentOrder.promo_code_text" class="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-blue-50 border border-blue-200 px-3 py-1.5">
                <svg class="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                </svg>
                <span class="text-sm font-medium text-blue-700">Промокод: {{ currentOrder.promo_code_text }}</span>
                <span v-if="currentOrder.discount_amount > 0" class="text-sm text-blue-500">(-{{ formatCurrency(currentOrder.discount_amount) }})</span>
              </div>
              <div
                v-if="currentOrder.promo_has_gift"
                class="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5"
              >
                <p class="text-sm font-semibold text-amber-800">Подарок по промокоду</p>
                <p v-if="currentOrder.promo_manager_description" class="mt-1 text-sm text-amber-700">
                  {{ currentOrder.promo_manager_description }}
                </p>
                <p v-else class="mt-1 text-sm text-amber-700">
                  Проверьте условия акции и положите подарок в заказ.
                </p>
              </div>
              <div
                v-else-if="currentOrder.promo_code_text && currentOrder.promo_manager_description"
                class="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5"
              >
                <p class="text-sm font-semibold text-amber-800">Инструкция по промокоду (для сборки)</p>
                <p class="mt-1 text-sm text-amber-700">
                  {{ currentOrder.promo_manager_description }}
                </p>
              </div>
              <div
                v-if="currentOrder.is_wholesale"
                class="mt-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2.5"
              >
                <p class="text-sm font-semibold text-violet-800">Оптовый заказ</p>
                <p class="mt-1 text-sm text-violet-700">
                  {{ currentOrder.wholesale_tier_label || 'Оптовый прайс' }}
                </p>
                <p v-if="currentOrder.wholesale_min_amount" class="mt-1 text-sm text-violet-700">
                  Минимальная сумма: {{ formatCurrency(currentOrder.wholesale_min_amount) }}
                </p>
              </div>
              <div
                v-if="currentOrder.items?.some((item) => Number(item.loyalty_discount_amount || 0) > 0)"
                class="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5"
              >
                <span class="text-sm font-medium text-violet-700">
                  Скидка за покупки:
                  -{{ formatCurrency(currentOrder.items?.reduce((sum, item) => sum + Number(item.loyalty_discount_amount || 0), 0) || 0) }}
                </span>
              </div>
            </div>
            <div class="order-detail-status-picker">
              <span class="order-detail-round-icon"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-3M8 2h8v4H8V2ZM7 11h10M7 15h7" /></svg></span>
            <label class="flex flex-col gap-2 text-sm font-medium text-gray-700">
              <span class="order-detail-status-label">Статус заказа</span>
              <select
                v-model="editableStatus"
                :disabled="isSaving"
                class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              >
                <option
                  v-for="option in statusOptions"
                  :key="option.value"
                  :value="option.value"
                  :disabled="option.disabled"
                >
                  {{ option.label }}
                </option>
              </select>
            </label>
            </div>
            <div class="order-detail-current-status" :class="statusBadgeClass(editableStatus)" :data-status="editableStatus" aria-live="polite" aria-atomic="true">
              <span class="order-detail-status-tick" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                  <path v-if="editableStatus === 'in_progress' || editableStatus === 'completed' || editableStatus === 'delivered'" d="m5 12 4 4L19 6" />
                  <path v-else-if="editableStatus === 'cancelled'" d="m6 6 12 12M18 6 6 18" />
                  <g v-else><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></g>
                </svg>
              </span>
              <span class="order-detail-status-caption">Статус заказа</span>
              <strong data-test="order-detail-status">{{ statusLabel(editableStatus, deliveryType) }}</strong>
              <span class="order-detail-status-draft" :class="{ 'order-detail-status-draft-hidden': editableStatus === originalOrder?.status }" :aria-hidden="editableStatus === originalOrder?.status">Не сохранён</span>
              <div v-if="hasPayment" class="order-detail-status-payment mt-2 text-sm">
                Оплачено: {{ formatCurrency(currentOrder.paid_amount || 0) }}
                <div class="order-detail-status-payment-description text-xs">{{ paymentDescription }}</div>
              </div>
            </div>
          </div>

          <OrderAuditTimeline
            class="order-detail-top-timeline"
            :events="orderAudit" :history="orderHistory"
            :loading="historyLoading" :error="historyError" @retry="loadHistory"
          />

          <div v-show="showOrderServiceFields || deliveryType === 'delivery'" class="mt-6 grid gap-4 md:grid-cols-2">

            <div v-show="showOrderServiceFields" data-test="order-delivery-type" class="flex flex-col gap-2 text-sm text-gray-600">
              <span class="font-medium text-gray-700">Тип отдачи</span>
              <div class="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                {{ deliveryLabel }}
              </div>
            </div>
            <label v-if="deliveryType === 'delivery'" class="md:col-span-2 flex flex-col gap-2 text-sm font-medium text-gray-700">
              Адрес доставки
              <textarea
                v-model="form.deliveryAddress"
                rows="2"
                class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                placeholder="Улица, дом, подъезд, комментарии"
              />
            </label>
            <label v-show="showOrderServiceFields" data-test="order-manager-comment" class="md:col-span-2 flex flex-col gap-2 text-sm font-medium text-gray-700">
              Комментарий менеджера
              <textarea
                v-model="form.notes"
                rows="3"
                class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                placeholder="Примечания по заказу, способу оплаты и т.д."
              />
            </label>
          </div>
        </section>

        <section class="rounded-2xl bg-white p-6 shadow-sm">
          <div class="order-detail-section-heading order-detail-products-heading">
            <div class="order-detail-heading-main">
              <span class="order-detail-heading-icon"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="m12 3 9 5v8l-9 5-9-5V8l9-5Zm0 9v9M3 8l9 4 9-4M7.5 5.5l9 5" /></svg></span>
              <div><h2>Позиции заказа</h2><p>Редактируйте количество, цены и добавляйте новые товары.</p></div>
            </div>
            <div class="order-detail-add-product">
              <span class="order-detail-plus-badge"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg></span>
              <div class="order-detail-search-field">
              <label class="block text-sm font-medium text-gray-700">Добавить товар</label>
              <input
                v-model="productSearch"
                type="search"
                placeholder="Название, артикул или линейка"
                class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
              <p v-if="showSearchHint" class="mt-1 text-xs text-gray-500">Для поиска введите минимум 2 символа.</p>
              </div>
            </div>
          </div>

          <div v-if="isSearchingProducts" class="mt-4 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-500">
            Ищем товары…
          </div>
          <div v-else-if="searchError" class="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{{ searchError }}</div>
          <div v-else-if="productResults.length" class="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
            <p class="mb-2 text-xs font-semibold uppercase text-gray-500">Найдено товаров</p>
            <ul class="space-y-2">
              <li v-for="product in productResults" :key="product.id" class="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2">
                <div class="flex-1 min-w-0">
                  <p class="font-medium text-gray-900">{{ product.title }}</p>
                  <p v-if="product.description" class="text-[11px] text-gray-400 leading-tight truncate">{{ product.description }}</p>
                  <p class="text-xs text-gray-500">
                    Остаток: {{ product.stock }}
                    <span v-if="product.groupName">· {{ product.groupName }}</span>
                  </p>
                </div>
                <div class="flex items-center gap-3 flex-shrink-0 ml-2">
                  <span class="text-sm font-semibold text-gray-900">{{ formatCurrency(product.priceRub) }}</span>
                  <button
                    class="rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-blue-700"
                    @click.prevent="addProduct(product)"
                  >
                    Добавить
                  </button>
                </div>
              </li>
            </ul>
          </div>

          <div id="order-detail-product-list" class="order-detail-product-list">
            <div
              v-if="!form.items.length"
              class="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500"
            >
              Позиции заказа пока не добавлены. Найдите товар выше и добавьте его в список.
            </div>

            <article
              v-for="item in visibleItems"
              :key="item.productId"
              class="order-detail-product"
              :class="{ 'order-detail-product-invalid': item.quantity <= 0 || item.manualDiscount + item.loyaltyDiscount > item.price * item.quantity }"
            >
              <div class="order-detail-product-thumb">
                <img v-if="item.imageUrl" :src="item.imageUrl" :alt="item.title" width="64" height="64" loading="lazy" @error="item.imageUrl = null" />
                <svg v-else aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="m12 3 9 5v8l-9 5-9-5V8l9-5Zm0 9v9M3 8l9 4 9-4" /></svg>
              </div>
              <div class="order-detail-product-info">
                <p class="order-detail-product-name"><span v-if="item.groupName">{{ item.groupName }} - </span>{{ item.baseProductTitle || item.title }}<span v-if="item.variantName"> - {{ item.variantName }}</span></p>
                <p class="order-detail-product-meta">Себестоимость: {{ formatCurrency(item.cost) }}<span v-if="item.stock !== null && item.stock !== undefined"> · Остаток: {{ item.stock }}</span></p>
                <p v-if="item.description" class="order-detail-product-description">{{ item.description }}</p>
                <p v-if="catalogDiscountOf(item)" class="order-detail-product-note">Обычная цена: {{ formatCurrency(item.basePrice!) }} · Скидка каталога: −{{ formatCurrency(catalogDiscountOf(item)) }}<span v-if="catalogDiscountPercentOf(item)"> ({{ catalogDiscountPercentOf(item) }}%)</span></p>
                <p v-if="managerPriceChangeOf(item)" class="order-detail-product-note">Цену менял менеджер: {{ managerPriceChangeOf(item)! > 0 ? '−' : '+' }}{{ formatCurrency(Math.abs(managerPriceChangeOf(item)!)) }}</p>
                <p v-if="item.loyaltyDiscount > 0" class="order-detail-product-loyalty">Скидка за покупки: -{{ formatCurrency(item.loyaltyDiscount) }} · Списано бонусов: {{ item.loyaltyUnitsApplied }}</p>
              </div>
              <label class="order-detail-product-field">
                <span>Количество</span>
                <div class="order-detail-quantity">
                  <button type="button" :aria-label="`Уменьшить количество: ${item.title}`" :disabled="isSaving || item.quantity <= 1" @click="adjustQuantity(item, -1)">−</button>
                  <input v-model.number="item.quantity" type="number" min="1" step="1" :aria-label="`Количество: ${item.title}`" :disabled="isSaving" @blur="normalizeItem(item)" />
                  <button type="button" :aria-label="`Увеличить количество: ${item.title}`" :disabled="isSaving" @click="adjustQuantity(item, 1)">+</button>
                </div>
              </label>
              <label class="order-detail-product-field">
                <span>Цена, BYN</span>
                <input v-model.number="item.price" type="number" min="0" step="0.01" :aria-label="`Цена, BYN: ${item.title}`" :disabled="isSaving" @blur="normalizeItem(item)" />
              </label>
              <label class="order-detail-product-field">
                <span>Ручная скидка, BYN</span>
                <input v-model.number="item.manualDiscount" type="number" min="0" step="0.01" :aria-label="`Ручная скидка на позицию, BYN: ${item.title}`" :disabled="isSaving" @blur="normalizeItem(item)" />
              </label>
              <div class="order-detail-product-sum" :title="`Максимальная ручная скидка: ${formatCurrency(Math.max(item.price * Math.max(item.quantity, 0) - item.loyaltyDiscount, 0))}`">
                <span>Сумма</span><strong>{{ formatCurrency(itemSubtotal(item)) }}</strong>
              </div>
              <button type="button" class="order-detail-trash" :aria-label="`Удалить позицию: ${item.title}`" :disabled="isSaving" @click="removeItem(item.productId)">
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" /></svg><span class="sr-only">Удалить</span>
              </button>
            </article>
          </div>
          <div class="order-detail-product-summary">
            <span>Общее количество товаров: <strong>{{ totalItemUnits }}</strong></span>
            <button v-if="form.items.length > 3" type="button" class="order-detail-show-more" :aria-expanded="itemsExpanded" aria-controls="order-detail-product-list" @click="itemsExpanded = !itemsExpanded">
              {{ itemsExpanded ? 'Скрыть дополнительные позиции' : `Показать ещё ${form.items.length - 3} позиций` }}
            </button>
            <span>Сумма позиций: <strong>{{ formatCurrency(itemsDiscountedSubtotal) }}</strong></span>
          </div>
        </section>

        <section class="order-detail-finance rounded-2xl bg-white shadow-sm" aria-labelledby="order-detail-finance-heading">
          <header class="order-detail-section-heading">
            <div class="order-detail-heading-main">
              <span class="order-detail-heading-icon"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V4M4 20h16M8 16v-5M13 16V7M18 16v-9" /></svg></span>
              <div>
                <h2 id="order-detail-finance-heading">Финансовые итоги</h2>
                <p>Предварительный расчёт по текущим изменениям</p>
              </div>
            </div>
            <div class="order-detail-discounts">
              <label><span class="order-detail-discount-icon" aria-hidden="true">ⓑ</span>Скидка BYN<input v-model.number="form.discountAmount" type="number" min="0" step="0.01" :disabled="isSaving" @blur="normalizeDiscounts" /></label>
              <label><span class="order-detail-discount-icon" aria-hidden="true">%</span>Скидка %<input v-model.number="form.discountPercent" type="number" min="0" max="100" step="0.1" :disabled="isSaving" @blur="normalizeDiscounts" /></label>
            </div>
          </header>
          <div class="order-detail-financial-grid">
            <div class="order-detail-pay">
              <span class="order-detail-pay-icon"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h2l3 12h10l3-8H6M9 20h.01M18 20h.01" /></svg></span>
              <span>Итого к оплате</span>
              <strong data-test="order-final-amount">{{ formatCurrency(finalAmount) }}</strong>
              <div class="order-detail-profit">
                <span>Ожидаемая прибыль</span>
                <strong data-test="order-expected-profit" :class="{ 'order-detail-profit-negative': expectedProfit < 0 }">{{ formatCurrency(expectedProfit) }}</strong>
              </div>
            </div>
            <dl class="order-detail-stat-grid">
              <div><dt><span class="order-detail-stat-icon order-detail-icon-blue"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 9 5v8l-9 5-9-5V8l9-5Zm0 9v9M3 8l9 4 9-4" /></svg></span>Сумма позиций (по цене продажи)</dt><dd>{{ formatCurrency(itemsSubtotal) }}</dd></div>
              <div><dt><span class="order-detail-stat-icon order-detail-icon-green"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h7l11 11-7 7L3 10V3ZM7 7h.01" /></svg></span>Сумма позиций (со скидками)</dt><dd>{{ formatCurrency(itemsDiscountedSubtotal) }}</dd></div>
              <div><dt><span class="order-detail-stat-icon order-detail-icon-purple"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5H5v4M15 5h4v4M19 15v4h-4M9 19H5v-4M8 12h8" /></svg></span>Ручные скидки по позициям</dt><dd>{{ formatCurrency(manualItemDiscountTotal) }}</dd></div>
              <div><dt><span class="order-detail-stat-icon order-detail-icon-red"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m6 18 12-12M7 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM17 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" /></svg></span>Скидка за покупки</dt><dd>{{ formatCurrency(loyaltyDiscountTotal) }}</dd></div>
              <div><dt><span class="order-detail-stat-icon order-detail-icon-orange"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h18v12H3V7ZM7 7V5h10v2M3 11h18M8 15h3" /></svg></span>Скидка на заказ BYN / %</dt><dd>{{ formatCurrency(form.discountAmount) }} / {{ form.discountPercent }}%</dd></div>
              <div><dt><span class="order-detail-stat-icon order-detail-icon-gray"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h2l3 12h10l3-8H6M9 20h.01M18 20h.01" /></svg></span>Количество товаров</dt><dd>{{ totalItemUnits }} шт.</dd></div>
              <div><dt><span class="order-detail-stat-icon order-detail-icon-blue"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18v14H3V6ZM3 10h18M7 15h3M16 3v3M8 3v3" /></svg></span>Себестоимость заказа</dt><dd>{{ formatCurrency(itemsCost) }}</dd></div>
              <div v-if="currentOrder.additional_cost"><dt><span class="order-detail-stat-icon order-detail-icon-orange"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v16M4 12h16" /></svg></span>Добавочная стоимость</dt><dd>+{{ formatCurrency(currentOrder.additional_cost) }}</dd></div>
              <div v-if="catalogDiscountTotal > 0"><dt><span class="order-detail-stat-icon order-detail-icon-gray"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h14v18l-3-2-4 2-4-2-3 2V3ZM8 7h8M8 11h8M8 15h4" /></svg></span>Сумма по обычной цене</dt><dd>{{ formatCurrency(itemsBaseSubtotal) }}</dd></div>
              <div v-if="catalogDiscountTotal > 0"><dt><span class="order-detail-stat-icon order-detail-icon-green"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h7l11 11-7 7L3 10V3ZM7 7h.01" /></svg></span>Скидка каталога · справочно, включена в цену</dt><dd>{{ formatCurrency(catalogDiscountTotal) }}</dd></div>
            </dl>
          </div>
          <div class="order-detail-payment-meta">
            <span :class="hasPayment ? 'text-emerald-700' : 'text-gray-600'">Статус оплаты: {{ hasPayment ? 'Оплачен' : 'Не оплачен' }}</span>
            <span v-if="hasPayment">{{ paymentDescription }}</span>
            <span v-if="currentOrder.completed_at">Выдан: {{ formatFullDate(currentOrder.completed_at) }}</span>
          </div>
        </section>


      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useCrmStore, type CrmProductSummary, type Order, type AutoNotificationResult, type OrderAuditEvent } from '@/stores/crm'
import ManagerActionSummary from '@/components/crm/ManagerActionSummary.vue'
import OrderAuditTimeline from '@/components/crm/OrderAuditTimeline.vue'
import StaffShiftBar from '@/components/admin/staff/StaffShiftBar.vue'
import { formatBynCurrency as formatCurrency } from '@/utils/currency'
import { calculateExpectedProfit } from '@/utils/orderProfit'

const props = defineProps<{ id: string }>()

type FormItem = {
  // Внутренний ключ строки (для v-for, удаления и т.п.)
  // Для обычных товаров: ID товара
  // Для вариантов: `${baseProductId}:${variantId}`
  productId: string
  // Базовый ID товара из таблицы products (всегда существует)
  baseProductId: string
  // ID варианта товара (цвет и т.п.), если есть
  variantId?: string | null

  title: string
  groupName?: string | null
  baseProductTitle?: string | null
  variantName?: string | null
  description?: string | null
  imageUrl?: string | null
  quantity: number
  price: number
  manualDiscount: number
  loyaltyDiscount: number
  loyaltyUnitsApplied: number
  cost: number
  stock?: number | null
  // Снимок каталожной цены на момент оформления. null у заказов старше
  // миграции: про них мы просто не знаем, была скидка или нет.
  basePrice?: number | null
  catalogDiscount?: number | null
}

const crmStore = useCrmStore()
const {
  currentOrder,
  staffTrackingEnabled,
} = storeToRefs(crmStore)

const customerDisplayName = computed(() => {
  const order = currentOrder.value
  if (!order) return ''
  const name = [order.first_name, order.last_name].filter(Boolean).join(' ').trim()
  if (name) return name
  if (order.customer_name?.trim() && order.customer_name.trim() !== 'Гость') return order.customer_name.trim()
  if (order.telegram_username?.trim()) return `@${order.telegram_username.replace(/^@+/, '')}`
  return order.customer_telegram_id ? 'Пользователь Telegram' : 'Гость'
})
const customerAvatarFailed = ref(false)
const customerAvatarUrl = computed(() => {
  const order = currentOrder.value
  return order?.customer_id && order.customer_telegram_id
    ? `/api/customer-photo/${encodeURIComponent(order.customer_id)}` : ''
})
watch(customerAvatarUrl, () => { customerAvatarFailed.value = false })

// Service fields are retained for future use; existing order data stays intact.
const showOrderServiceFields = false
const loading = ref(false)
const originalOrder = ref<Order | null>(null)
const itemsExpanded = ref(false)
const visibleItems = computed(() => itemsExpanded.value ? form.items : form.items.slice(0, 3))
const totalItemUnits = computed(() => form.items.reduce((sum, item) => sum + Math.max(Number(item.quantity) || 0, 0), 0))
const editableStatus = ref<Order['status']>('new')
const form = reactive({
  deliveryAddress: '',
  notes: '',
  discountAmount: 0,
  discountPercent: 0,
  items: [] as FormItem[]
})

const productSearch = ref('')
const productResults = ref<CrmProductSummary[]>([])
const isSearchingProducts = ref(false)
const searchError = ref('')
const productSearchRequestId = ref(0)

const isSaving = ref(false)
const saveError = ref('')
const saveSuccess = ref('')
const shiftBarRef = ref<{
  requestShiftRequired: (
    label: string,
    retry: () => unknown | Promise<unknown>,
  ) => Promise<void>
} | null>(null)
const deletingPayment = ref(false)
const reactivating = ref(false)
const isGeneratingMessage = ref(false)
const isResolvingAction = ref(false)
const orderAudit = ref<OrderAuditEvent[]>([])
const historyLoading = ref(false)
const historyError = ref('')
let historyRequestId = 0
const orderHistory = ref<Array<{
  id: string;
  order_id: string;
  previous_status: string | null;
  new_status: string;
  changed_at: string;
  note: string | null;
}>>([])

async function handleShiftRequired(
  error: any,
  label: string,
  retry: () => unknown | Promise<unknown>,
) {
  if (error?.code !== 'shift_required') return false
  saveError.value =
    'Сначала откройте смену. Данные на странице сохранены, действие не повторялось.'
  await shiftBarRef.value?.requestShiftRequired(label, retry)
  return true
}

async function resolveAction() {
  if (!currentOrder.value) return
  const actionType = currentOrder.value.manager_action_type
  isResolvingAction.value = true
  try {
    await crmStore.resolveManagerAction(currentOrder.value.id)
    await refreshOrder()
    await loadHistory()
    saveSuccess.value = actionType === 'cancelled_by_customer'
      ? 'Отмена подтверждена, заказ разобран'
      : 'Изменения приняты, заказ отправлен на пересборку'
  } catch (error: any) {
    if (await handleShiftRequired(
      error,
      `Обработать действие по заказу #${currentOrder.value?.order_number || ''}`,
      resolveAction,
    )) return false
    saveError.value = error?.message || 'Не удалось обработать действие'
    return false
  } finally {
    isResolvingAction.value = false
  }
  return true
}

const allStatusOptions: Array<{ value: Order['status']; label: string }> = [
  { value: 'new', label: 'Новый' },
  { value: 'in_progress', label: 'Собран' },
  { value: 'completed', label: 'Завершён' },
  { value: 'delivered', label: 'Выдан' },
  { value: 'cancelled', label: 'Отменён' }
]
const statusOptions = computed(() =>
  allStatusOptions
    .filter((option) =>
      !staffTrackingEnabled.value ||
      !['completed', 'delivered'].includes(option.value) ||
      option.value === currentOrder.value?.status,
    )
    .map((option) => ({
      ...option,
      disabled:
        Boolean(staffTrackingEnabled.value) &&
        ['completed', 'delivered'].includes(option.value),
    })),
)

const deliveryType = computed(() => currentOrder.value?.delivery_type ?? 'pickup')
const deliveryLabel = computed(() => (deliveryType.value === 'delivery' ? 'Доставка' : 'Самовывоз'))
const hasPayment = computed(() => {
  const paid = Number(currentOrder.value?.paid_amount ?? 0)
  return paid > 0
})
const paymentDescription = computed(() => {
  if (!currentOrder.value) return ''
  const account = currentOrder.value.payment_account_id ? `счёт ${currentOrder.value.payment_account_id}` : 'неизвестный счёт'
  return `${formatCurrency(currentOrder.value.paid_amount || 0)} · ${account}`
})

const itemsSubtotal = computed(() => {
  return form.items.reduce((sum, item) => sum + Math.max(item.price, 0) * Math.max(item.quantity, 0), 0)
})

/** Сколько срезала акция магазина с единицы. Ноль и пусто ведут себя одинаково. */
function catalogDiscountOf(item: FormItem): number {
  const discount = Number(item.catalogDiscount || 0)
  return discount > 0 ? discount : 0
}

function catalogDiscountPercentOf(item: FormItem): number {
  const base = Number(item.basePrice || 0)
  if (base <= 0) return 0
  return Math.round((catalogDiscountOf(item) / base) * 100)
}

/**
 * Насколько менеджер отступил от каталожной цены со скидкой. Положительное
 * число означает уценку, отрицательное — продали дороже каталога.
 */
function managerPriceChangeOf(item: FormItem): number | null {
  if (item.basePrice == null) return null
  const expected = Number(item.basePrice) - catalogDiscountOf(item)
  const change = expected - Number(item.price || 0)
  return Math.abs(change) > 0.001 ? change : null
}

/** Сумма позиций по обычной цене: сколько заказ стоил бы без акций магазина. */
const itemsBaseSubtotal = computed(() => {
  return form.items.reduce((sum, item) => {
    const base = item.basePrice != null ? Number(item.basePrice) : Number(item.price || 0)
    return sum + Math.max(base, 0) * Math.max(item.quantity, 0)
  }, 0)
})

const catalogDiscountTotal = computed(() => {
  return form.items.reduce(
    (sum, item) => sum + catalogDiscountOf(item) * Math.max(item.quantity, 0),
    0,
  )
})

const loyaltyDiscountTotal = computed(() => {
  return form.items.reduce((sum, item) => sum + Math.max(item.loyaltyDiscount || 0, 0), 0)
})

const manualItemDiscountTotal = computed(() => {
  return form.items.reduce((sum, item) => sum + Math.max(item.manualDiscount || 0, 0), 0)
})

const itemsDiscountedSubtotal = computed(() => {
  return form.items.reduce((sum, item) => sum + itemSubtotal(item), 0)
})

const itemsCost = computed(() => {
  return form.items.reduce((sum, item) => sum + Math.max(item.cost, 0) * Math.max(item.quantity, 0), 0)
})

const finalAmount = computed(() => Math.round((applyDiscounts(itemsDiscountedSubtotal.value, form.discountAmount, form.discountPercent) + Number(currentOrder.value?.additional_cost || 0)) * 100) / 100)
const expectedProfit = computed(() => calculateExpectedProfit(finalAmount.value, itemsCost.value))

function originalItemFor(formItem: FormItem) {
  return (originalOrder.value?.items || []).find((item) => {
    const itemKey = item.variant_id
      ? `${item.product_id}:${item.variant_id}`
      : item.product_id
    return itemKey === formItem.productId
  })
}

function itemChanged(formItem: FormItem) {
  const originalItem = originalItemFor(formItem)
  if (!originalItem) return true
  return (
    formItem.quantity !== Number(originalItem.quantity || 0) ||
    formItem.price !== Number(originalItem.price_per_unit || 0) ||
    formItem.manualDiscount !== Number(originalItem.manual_discount_amount || 0)
  )
}

const changedItems = computed(() => form.items.filter(itemChanged))
const itemsHaveChanges = computed(() =>
  form.items.length !== (originalOrder.value?.items || []).length || changedItems.value.length > 0,
)

const hasChanges = computed(() => {
  if (!originalOrder.value) return false

  if (editableStatus.value !== originalOrder.value.status) return true
  if (form.deliveryAddress !== (originalOrder.value.delivery_address || '')) return true
  if (form.notes !== (originalOrder.value.notes || '')) return true
  if (form.discountAmount !== Number(originalOrder.value.discount_amount || 0)) return true
  if (form.discountPercent !== Number(originalOrder.value.discount_percent || 0)) return true

  if (form.items.length !== (originalOrder.value.items || []).length) return true
  return changedItems.value.length > 0
})

/**
 * Проверяем только те позиции, которые правил менеджер. Старые заказы могут
 * содержать строку, где скидка больше суммы строки: раньше такая строка
 * навсегда гасила кнопку сохранения, и в заказе нельзя было поправить даже
 * комментарий.
 */
const invalidChangedItems = computed(() =>
  changedItems.value.filter((item) => !isItemValid(item)),
)

const saveBlockReason = computed(() => {
  if (isSaving.value) return ''
  if (!hasChanges.value) return 'Изменений нет'
  if (invalidChangedItems.value.length > 0) {
    return 'Проверьте изменённые позиции: количество, цена и скидка не сходятся'
  }
  return ''
})

const canSave = computed(() => {
  if (isSaving.value) return false
  if (!hasChanges.value) return false
  return invalidChangedItems.value.length === 0
})

const canReactivate = computed(() => currentOrder.value?.status === 'cancelled')
const canRemovePayment = computed(() => hasPayment.value && !isSaving.value)

let searchTimer: ReturnType<typeof setTimeout> | null = null
let successTimer: ReturnType<typeof setTimeout> | null = null

function invalidateProductSearch() {
  productSearchRequestId.value += 1
  isSearchingProducts.value = false
}

function clearProductSearchState() {
  if (searchTimer) {
    clearTimeout(searchTimer)
    searchTimer = null
  }
  invalidateProductSearch()
  searchError.value = ''
  productResults.value = []
}

watch(productSearch, (value) => {
  const query = value.trim()
  if (searchTimer) clearTimeout(searchTimer)
  
  if (!query) {
    clearProductSearchState()
    return
  }
  
  if (query.length < 2) {
    clearProductSearchState()
    return
  }
  
  searchTimer = setTimeout(() => loadProducts(query), 250)
})

watch(currentOrder, (order) => {
  // Пока в форме есть несохранённые правки, не перетираем их обновлением
  // заказа: иначе набранный комментарий пропадал на очередном обновлении.
  if (order && !hasChanges.value) {
    initializeForm(order)
  }
})

onMounted(() => {
  void crmStore.fetchStaffSettings().catch(() => undefined)
  void refreshOrder()
  void loadHistory()
})

async function loadHistory() {
  const requestId = ++historyRequestId
  historyLoading.value = true
  historyError.value = ''
  const results = await Promise.allSettled([
    crmStore.fetchOrderHistory(props.id), crmStore.fetchOrderAudit(props.id),
  ])
  if (requestId !== historyRequestId) return
  const [legacy, audit] = results
  if (legacy.status === 'fulfilled' && Array.isArray(legacy.value)) orderHistory.value = legacy.value
  if (audit.status === 'fulfilled' && Array.isArray(audit.value)) orderAudit.value = audit.value
  if (legacy.status === 'rejected' || audit.status === 'rejected'
    || (legacy.status === 'fulfilled' && !Array.isArray(legacy.value))
    || (audit.status === 'fulfilled' && !Array.isArray(audit.value))) {
    historyError.value = 'Не удалось загрузить полную историю. Показаны ранее загруженные события; попробуйте обновить историю.'
  }
  historyLoading.value = false
}

onBeforeUnmount(() => {
  historyRequestId += 1
  if (searchTimer) clearTimeout(searchTimer)
  if (successTimer) clearTimeout(successTimer)
  clearProductSearchState()
})

async function refreshOrder() {
  if (isSaving.value) return
  if (hasChanges.value && !confirm('Обновить заказ и сбросить несохранённые изменения?')) return
  loading.value = true
  try {
    const order = await crmStore.fetchOrder(props.id)
    customerAvatarFailed.value = false
    if (order) {
      initializeForm(order)
    }
  } catch (error: any) {
    saveError.value = error?.message || 'Не удалось загрузить заказ. Попробуйте обновить страницу.'
  } finally {
    loading.value = false
  }
}

function initializeForm(order: Order) {
  originalOrder.value = JSON.parse(JSON.stringify(order)) as Order
  editableStatus.value = order.status
  form.deliveryAddress = order.delivery_address || ''
  form.notes = order.notes || ''
  form.discountAmount = Number(order.discount_amount || 0)
  form.discountPercent = Number(order.discount_percent || 0)
  form.items = (order.items || [])
    .filter((item) => !!item.product_id)
    .map((item) => ({
      // Для существующих заказов используем variant_id как часть ключа,
      // чтобы разные варианты одного товара были отдельными строками
      productId: item.variant_id
        ? `${item.product_id}:${item.variant_id}`
        : (item.product_id as string),
      baseProductId: item.product_id as string,
      variantId: (item.variant_id as string | null) || null,
      title: item.product_title,
      groupName: item.group_name || null,
      baseProductTitle: item.base_product_title || null,
      variantName: item.variant_name || null,
      description: item.product_description || null,
      imageUrl: item.product_image_url || null,
      quantity: Number(item.quantity || 0),
      price: Number(item.price_per_unit || 0),
      manualDiscount: Number(item.manual_discount_amount || 0),
      loyaltyDiscount: Number(item.loyalty_discount_amount || 0),
      loyaltyUnitsApplied: Number(item.loyalty_units_applied || 0),
      cost: Number(item.cost_per_unit || 0),
      stock: null,
      basePrice: item.base_price_per_unit != null ? Number(item.base_price_per_unit) : null,
      catalogDiscount: item.catalog_discount_per_unit != null
        ? Number(item.catalog_discount_per_unit)
        : null
    }))
  productSearch.value = ''
  clearProductSearchState()
  saveError.value = ''
  saveSuccess.value = ''
}

async function loadProducts(query: string) {
  const requestId = ++productSearchRequestId.value
  isSearchingProducts.value = true
  searchError.value = ''
  try {
    const results = await crmStore.searchCrmProducts({ search: query, limit: 100 })
    if (requestId !== productSearchRequestId.value) return
    productResults.value = results
  } catch (error) {
    if (requestId !== productSearchRequestId.value) return
    console.error('[CRM] product search error', error)
    searchError.value = 'Не удалось загрузить товары'
    productResults.value = []
  } finally {
    if (requestId === productSearchRequestId.value) {
      isSearchingProducts.value = false
    }
  }
}

function addProduct(product: CrmProductSummary) {
  if (isSaving.value) return
  // Для вариантов базовый товар и вариант должны отличаться
  const baseProductId = product.productId || product.id
  const variantId = product.isVariant ? product.id : null
  const rowKey = variantId ? `${baseProductId}:${variantId}` : baseProductId

  const existing = form.items.find((item) => item.productId === rowKey)
  if (existing) {
    existing.quantity = Math.max(existing.quantity + 1, 1)
    existing.price = Number.isFinite(existing.price) ? existing.price : product.priceRub
    existing.cost = Number.isFinite(existing.cost) ? existing.cost : product.costPrice
    existing.stock = product.stock
    normalizeItem(existing)
    return
  }
  form.items.push({
    productId: rowKey,
    baseProductId,
    variantId,
    title: product.title,
    groupName: product.groupName || null,
    baseProductTitle: product.isVariant ? undefined : product.title,
    variantName: product.variantName || (product.isVariant ? product.title : null),
    description: product.description || null,
    imageUrl: product.image || product.imageUrl || null,
    quantity: 1,
    price: product.priceRub,
    manualDiscount: 0,
    loyaltyDiscount: 0,
    loyaltyUnitsApplied: 0,
    cost: product.costPrice,
    stock: product.stock
  })
  productSearch.value = ''
  clearProductSearchState()
}

function removeItem(productId: string) {
  if (isSaving.value) return
  form.items = form.items.filter((item) => item.productId !== productId)
}

function adjustQuantity(item: FormItem, delta: number) {
  if (isSaving.value) return
  item.quantity = Math.max(1, Math.round(Number(item.quantity) || 1) + delta)
  normalizeItem(item)
}

function normalizeItem(item: FormItem) {
  if (!Number.isFinite(item.quantity) || item.quantity <= 0) item.quantity = 1
  if (!Number.isFinite(item.price) || item.price < 0) item.price = 0
  if (!Number.isFinite(item.manualDiscount) || item.manualDiscount < 0) item.manualDiscount = 0
  item.loyaltyDiscount = Math.max(0, Number(item.loyaltyDiscount || 0))
  item.loyaltyUnitsApplied = Math.max(0, Math.round(Number(item.loyaltyUnitsApplied || 0)))
  const maxManualDiscount = Math.max(item.price * item.quantity - item.loyaltyDiscount, 0)
  if (item.manualDiscount > maxManualDiscount) item.manualDiscount = maxManualDiscount
}

function isItemValid(item: FormItem) {
  return (
    item.quantity > 0 &&
    item.price >= 0 &&
    item.manualDiscount >= 0 &&
    item.manualDiscount + item.loyaltyDiscount <= item.price * item.quantity
  )
}

function itemSubtotal(item: FormItem) {
  const total =
    Math.max(item.price, 0) * Math.max(item.quantity, 0) -
    Math.max(item.manualDiscount, 0) -
    Math.max(item.loyaltyDiscount, 0)
  return total < 0 ? 0 : total
}

function normalizeDiscounts() {
  if (!Number.isFinite(form.discountAmount) || form.discountAmount < 0) form.discountAmount = 0
  if (!Number.isFinite(form.discountPercent) || form.discountPercent < 0) form.discountPercent = 0
  if (form.discountPercent > 100) form.discountPercent = 100
  const maxDiscount = itemsDiscountedSubtotal.value
  if (form.discountAmount > maxDiscount) form.discountAmount = maxDiscount
}

async function saveChanges() {
  if (!currentOrder.value || !canSave.value) return false
  saveError.value = ''
  saveSuccess.value = ''
  isSaving.value = true

  const sanitizedItems = form.items.map((item) => {
    const quantity = Math.max(1, Math.round(Number(item.quantity) || 0))
    const price = Math.max(0, Number(item.price) || 0)
    let manualDiscount = Math.max(0, Number(item.manualDiscount) || 0)
    const loyaltyDiscount = Math.max(0, Number(item.loyaltyDiscount) || 0)
    const maxDiscount = Math.max(price * quantity - loyaltyDiscount, 0)
    if (manualDiscount > maxDiscount) manualDiscount = maxDiscount
    const result: any = {
      product_id: item.baseProductId || item.productId,
      quantity,
      price_per_unit: price,
      manual_discount_amount: manualDiscount,
      loyalty_discount_amount: loyaltyDiscount,
      loyalty_units_applied: Math.max(0, Math.round(Number(item.loyaltyUnitsApplied || 0))),
    }
    // variant_id и variant_name нужны только для товаров с вариантами
    if (item.variantId) {
      result.variant_id = item.variantId
      result.variant_name = item.variantName || null
    }
    return result
  })

  const discountAmount = Math.max(0, Number(form.discountAmount) || 0)
  const discountPercent = Math.min(100, Math.max(0, Number(form.discountPercent) || 0))
  const trimmedDeliveryAddress = form.deliveryAddress.trim()
  const trimmedNotes = form.notes.trim()

  const baseline = originalOrder.value
  if (!baseline) {
    isSaving.value = false
    saveError.value = 'Исходные данные заказа не загружены. Обновите страницу.'
    return false
  }
  const payload = {
    ...(baseline.audit_revision !== undefined ? { expected_audit_revision: baseline.audit_revision } : {}),
    ...(editableStatus.value !== baseline.status ? { status: editableStatus.value } : {}),
    ...(form.deliveryAddress !== (baseline.delivery_address || '')
      ? { delivery_address: trimmedDeliveryAddress || null } : {}),
    ...(form.notes !== (baseline.notes || '') ? { notes: trimmedNotes || null } : {}),
    ...(form.discountAmount !== Number(baseline.discount_amount || 0)
      ? { discount_amount: Math.min(discountAmount, itemsDiscountedSubtotal.value) } : {}),
    ...(form.discountPercent !== Number(baseline.discount_percent || 0)
      ? { discount_percent: discountPercent } : {}),
    ...(itemsHaveChanges.value ? { items: sanitizedItems } : {}),
  }

  try {
    const updated = await crmStore.updateOrder(currentOrder.value.id, payload)
    currentOrder.value = updated
    initializeForm(updated)
    await loadHistory()
    saveSuccess.value = buildSaveSuccessMessage(updated.auto_notification)
    if (successTimer) clearTimeout(successTimer)
    successTimer = setTimeout(() => {
      saveSuccess.value = ''
    }, 6000)
    return true
  } catch (error: any) {
    if (await handleShiftRequired(
      error,
      `Сохранить заказ #${currentOrder.value?.order_number || ''}`,
      saveChanges,
    )) return false
    console.error('[CRM] update order error', error)
    saveError.value = error?.code === 'order_conflict' || error?.error === 'order_conflict'
      ? 'Заказ изменён другим сотрудником или покупателем. Ваш черновик сохранён. Обновите заказ и сверьте изменения перед повторным сохранением.'
      : formatErrorMessage(error?.message || error?.error || 'Не удалось сохранить изменения')
    return false
  } finally {
    isSaving.value = false
  }
}

function buildSaveSuccessMessage(notify: AutoNotificationResult | null | undefined): string {
  const base = 'Изменения сохранены. Остатки и суммы пересчитаны.'
  if (!notify) return base
  if (notify.sent) {
    return `${base} Клиенту ушло сообщение в Telegram.`
  }
  if (notify.skipped) {
    // Часть skip-причин (status_unchanged, no_event_for_status) не нуждаются
    // в пояснении менеджеру — они означают «нечего слать», и тогда возвращаем
    // только базу без хвоста, иначе будет лишний пробел в конце.
    const skipText = describeSkipReason(notify.reason)
    return skipText ? `${base} ${skipText}` : base
  }
  return `${base} Сообщение клиенту не ушло: ${describeSendError(notify.reason)}.`
}

function describeSkipReason(reason: string | undefined): string {
  switch (reason) {
    case 'reactivation_skipped':
    case 'status_unchanged':
    case 'no_event_for_status':
      return ''
    case 'customer_not_verified':
      return 'Клиенту не отправили: он ещё не получил прайс с кодом.'
    case 'customer_has_no_telegram_id':
      return 'Клиенту не отправили: у него не привязан Telegram.'
    case 'order_has_no_customer':
      return 'Клиенту не отправили: к заказу не привязан клиент.'
    case 'template_inactive_or_missing':
      return 'Клиенту не отправили: шаблон для этого статуса выключен.'
    case 'template_empty':
      return 'Клиенту не отправили: шаблон пустой. Заполните его в настройках бота.'
    case 'no_active_connection':
      return 'Клиенту не отправили: бот не подключён.'
    case 'userbot_ambiguous':
      return 'Клиенту не отправили: не получилось определить, в какой чат писать. Напишите ему вручную.'
    case 'client_inactive_over_24h':
      return 'Клиенту не отправили: клиент молчал больше суток, резервный канал не сработал. Напишите ему вручную.'
    default:
      return reason ? `Клиенту не отправили: ${reason}.` : ''
  }
}

function describeSendError(reason: string | undefined): string {
  if (!reason) return 'Telegram отклонил сообщение'
  if (reason === 'send_failed') return 'Telegram отклонил сообщение'
  if (reason === 'notify_internal_error') return 'внутренняя ошибка'
  if (reason === 'bot_token_missing') return 'бот не настроен'
  if (reason === 'invalid_payload') return 'внутренняя ошибка'
  if (reason.includes('BUSINESS_PEER_USAGE_MISSING')) return 'клиент отключил бота в своём чате'
  if (reason.includes('PEER_ID_INVALID')) return 'клиент ни разу не писал в чат'
  if (reason.includes('USER_IS_BLOCKED') || reason.includes('user is blocked')) return 'клиент заблокировал бота'
  if (reason === 'entity_not_found_no_dialog') return 'чат с клиентом пустой. Пока клиент не напишет сам, Telegram не даст отправить сообщение'
  if (reason === 'customer_blocked') return 'клиент заблокирован в CRM. Разблокируйте чтобы отправить сообщение'
  if (reason === 'flood_wait') return 'Telegram временно ограничил отправку (слишком много сообщений). Попробуйте позже'
  if (reason === 'disconnected') return 'менеджер не в сети Telegram. Проверьте подключение'
  return reason
}

async function removePayment(confirmed = false) {
  if (!currentOrder.value || deletingPayment.value) return false
  if (!confirmed && !confirm('Удалить оплату и вернуть заказ в работу?')) return false
  deletingPayment.value = true
  saveError.value = ''
  try {
    const updated = await crmStore.deleteOrderPayment(currentOrder.value.id)
    currentOrder.value = updated
    initializeForm(updated)
    saveSuccess.value = 'Оплата удалена'
    if (successTimer) clearTimeout(successTimer)
    successTimer = setTimeout(() => {
      saveSuccess.value = ''
    }, 4000)
    return true
  } catch (error: any) {
    if (await handleShiftRequired(
      error,
      `Отменить оплату заказа #${currentOrder.value?.order_number || ''}`,
      () => removePayment(true),
    )) return false
    console.error('[CRM] delete payment error', error)
    saveError.value = formatErrorMessage(error?.message || error?.error || 'Не удалось удалить оплату')
    return false
  } finally {
    deletingPayment.value = false
  }
}

async function reactivateOrder(confirmed = false) {
  if (!currentOrder.value || reactivating.value) return false
  if (!confirmed && !confirm('Возобновить отменённый заказ?')) return false
  reactivating.value = true
  saveError.value = ''
  try {
    const updated = await crmStore.updateOrder(currentOrder.value.id, { reactivate: true })
    currentOrder.value = updated
    initializeForm(updated)
    saveSuccess.value = 'Заказ возобновлён'
    if (successTimer) clearTimeout(successTimer)
    successTimer = setTimeout(() => {
      saveSuccess.value = ''
    }, 4000)
    return true
  } catch (error: any) {
    if (await handleShiftRequired(
      error,
      `Возобновить заказ #${currentOrder.value?.order_number || ''}`,
      () => reactivateOrder(true),
    )) return false
    console.error('[CRM] reactivate order error', error)
    saveError.value = formatErrorMessage(error?.message || error?.error || 'Не удалось возобновить заказ')
    return false
  } finally {
    reactivating.value = false
  }
}

function resetForm() {
  if (currentOrder.value) {
    initializeForm(currentOrder.value)
  }
}

function applyDiscounts(total: number, discountAmount: number, discountPercent: number) {
  let result = Math.max(total - Math.max(discountAmount, 0), 0)
  const percent = Math.min(100, Math.max(discountPercent, 0))
  if (percent > 0) {
    result = result * (1 - percent / 100)
  }
  return result < 0 ? 0 : result
}

function statusBadgeClass(status: Order['status']) {
  switch (status) {
    case 'new':
      return 'bg-amber-100 text-amber-700'
    case 'in_progress':
    case 'completed':
    case 'delivered':
      return 'bg-emerald-100 text-emerald-700'
    case 'cancelled':
      return 'bg-red-100 text-red-700'
    default:
      return 'bg-gray-100 text-gray-600'
  }
}

function statusLabel(status: Order['status'], deliveryType?: 'pickup' | 'delivery') {
  if ((status === 'delivered' || status === 'completed') && deliveryType) {
    // Условные статусы: доставка → доставлена, самовывоз → выдан
    return deliveryType === 'delivery' ? 'Доставлена' : 'Выдан'
  }
  return allStatusOptions.find((option) => option.value === status)?.label ?? status
}

function formatFullDate(dateString?: string | null) {
  if (!dateString) return '—'
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(dateString)
    ? dateString.replace(' ', 'T') + 'Z' : dateString
  return new Date(normalized).toLocaleString('ru-RU', {
    timeZone: 'Europe/Minsk',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
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

async function contactClient() {
  if (!currentOrder.value || isGeneratingMessage.value) return
  
  isGeneratingMessage.value = true
  saveError.value = ''
  
  try {
    const data = await crmStore.generateOrderMessage(currentOrder.value.id)
    const { message, telegramUsername, telegramId } = data
    
    const encoded = encodeURIComponent(message)
    if (telegramUsername) {
      window.open(`https://t.me/${telegramUsername}?text=${encoded}`, '_blank')
    } else if (telegramId) {
      window.open(`tg://openmessage?user_id=${telegramId}&text=${encoded}`, '_blank')
    } else {
      saveError.value = 'У клиента нет Telegram'
    }
  } catch (error: any) {
    console.error('[CRM] Generate message error', error)
    saveError.value = error?.message || 'Не удалось сгенерировать сообщение'
  } finally {
    isGeneratingMessage.value = false
  }
}

const showSearchHint = computed(() => {
  const length = productSearch.value.trim().length
  return length > 0 && length < 2
})
</script>

<style scoped>
.order-detail-product-image { float: left; width: 64px; height: 64px; margin: 0 12px 8px 0; object-fit: contain; border: 1px solid #e3ebf6; border-radius: 12px; background: #f7faff; }

.order-detail-hero-grid { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 1.15fr) minmax(0, .9fr); gap: 12px; align-items: stretch; }
.order-detail-hero, .order-detail-customer, .order-detail-status-picker, .order-detail-current-status { min-width: 0; border-radius: 16px; padding: 16px; overflow-wrap: anywhere; }
.order-detail-hero { display: flex; gap: 14px; align-items: center; background: linear-gradient(110deg, #05b8ff, #538eed); color: white; }
.order-detail-hero h1 { font-size: 22px; font-weight: 800; line-height: 1.25; }
.order-detail-hero p { font-size: 12px; margin-top: 6px; }
.order-detail-hero-icon { width: 44px; height: 44px; flex-shrink: 0; padding: 8px; border-radius: 12px; background: rgb(255 255 255 / 16%); }
.order-detail-cell { display: inline-flex; margin-top: 10px; padding: 6px 10px; border: 1px solid rgb(255 255 255 / 25%); background: rgb(255 255 255 / 15%); border-radius: 999px; font-size: 12px; font-weight: 650; }
.order-detail-customer, .order-detail-status-picker { border: 1px solid #e3ebf6; background: #fbfdff; }
.order-detail-customer h2 { font-size: 12px; font-weight: 700; color: #718198; }
.order-detail-customer-name { font-size: 15px; font-weight: 700; margin-top: 6px; }
.order-detail-telegram { margin-top: 6px; font-size: 14px; font-weight: 650; color: #2066c8; }
.order-detail-telegram a { text-decoration: none; text-underline-offset: 3px; text-decoration-thickness: 1px; }
.order-detail-telegram a:hover, .order-detail-telegram a:focus-visible { text-decoration: underline; }
.order-detail-status-picker select { width: 100%; min-width: 0; }
.order-detail-current-status { display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 8px; text-align: center; }
.order-detail-current-status strong { font-size: 20px; font-weight: 800; }
.order-detail-status-caption, .order-detail-status-draft { font-size: 11px; }
@media (max-width: 1200px) { .order-detail-hero-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 640px) { .order-detail-hero-grid { grid-template-columns: 1fr; } .order-detail-current-status { min-height: 90px; } }

.crm-order-detail { flex-shrink: 0; padding: 18px 20px 26px; background: #f4f8fd; color: #26334b; }
.crm-order-detail > div { max-width: 1440px; }
.crm-order-detail :deep(button), .crm-order-detail :deep(input), .crm-order-detail :deep(select), .crm-order-detail :deep(textarea) { font: inherit; }
.crm-order-detail button:focus-visible, .crm-order-detail input:focus-visible, .crm-order-detail select:focus-visible, .crm-order-detail textarea:focus-visible { outline: 3px solid #05b8ff; outline-offset: 3px; }
.crm-order-detail button:disabled { cursor: not-allowed; opacity: .55; }
.crm-order-detail section { border: 1px solid #e3ebf6; border-radius: 18px; padding: 18px; box-shadow: 0 8px 24px rgb(51 82 135 / 5%); }
.order-detail-product-list { display: grid; gap: 10px; margin-top: 16px; }
.order-detail-product { min-width: 0; padding: 12px; }
.order-detail-product p { overflow-wrap: anywhere; }
.order-detail-product input { min-width: 0; width: 100%; }
.order-detail-quantity { display: grid; grid-template-columns: 30px minmax(36px, 1fr) 30px; border: 1px solid #d8e4f7; border-radius: 10px; min-height: 38px; overflow: hidden; background: white; }
.order-detail-quantity button { background: #f7faff; border: 0; font-size: 20px; color: #3268ba; }
.order-detail-quantity input { text-align: center; border: 0; background: white; appearance: textfield; padding: 6px 2px; }
.order-detail-quantity input::-webkit-inner-spin-button, .order-detail-quantity input::-webkit-outer-spin-button { appearance: none; margin: 0; }
.order-detail-trash { display: grid; place-items: center; flex-shrink: 0; width: 34px; height: 34px; border-radius: 10px; border: 1px solid #ffd8df; background: #fff1f3; color: #e84463; }
.order-detail-trash svg { width: 18px; height: 18px; }
.order-detail-product-summary { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-top: 12px; padding: 12px; border: 1px solid #e0eafb; border-radius: 12px; background: #f5f9ff; font-size: 13px; }
.order-detail-show-more { border: 1px solid #cfe0ff; border-radius: 10px; padding: 7px 12px; color: #2066c8; background: white; }
.order-detail-section-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
.order-detail-section-heading h2 { font-size: 18px; font-weight: 750; }
.order-detail-section-heading p { margin-top: 3px; font-size: 12px; color: #718198; }
.order-detail-discounts { display: flex; gap: 10px; flex-wrap: wrap; }
.order-detail-discounts label { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border: 1px solid #e3ebf6; border-radius: 12px; background: #f8fbff; font-size: 13px; font-weight: 600; }
.order-detail-discounts input { width: 88px; min-width: 0; border: 1px solid #d8e4f7; border-radius: 8px; padding: 7px 8px; background: white; text-align: right; }
.order-detail-financial-grid { display: grid; grid-template-columns: minmax(260px, .95fr) minmax(0, 1.5fr); gap: 14px; align-items: start; }
.order-detail-pay { display: flex; flex-direction: column; padding: 22px; border-radius: 16px; background: linear-gradient(110deg, #05b8ff, #538eed); color: white; box-shadow: 0 10px 22px rgb(47 132 255 / 15%); }
.order-detail-pay > span { font-size: 14px; font-weight: 600; }
.order-detail-pay > strong { font-size: clamp(28px, 3vw, 38px); line-height: 1.2; margin: 10px 0 20px; overflow-wrap: anywhere; }
.order-detail-profit { display: flex; flex-direction: column; gap: 6px; padding-top: 14px; border-top: 1px solid rgb(255 255 255 / 30%); }
.order-detail-profit span { font-size: 13px; }
.order-detail-profit strong { font-size: 23px; }
.order-detail-profit-negative { color: #fff0cd; }
.order-detail-stat-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.order-detail-stat-grid > div { min-width: 0; padding: 12px; border: 1px solid #e3ebf6; border-radius: 12px; background: #fbfdff; }
.order-detail-stat-grid dt { font-size: 11px; line-height: 1.4; color: #718198; }
.order-detail-stat-grid dd { margin-top: 7px; font-size: 15px; font-weight: 700; overflow-wrap: anywhere; }
.order-detail-payment-meta { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 14px; font-size: 12px; }
@media (min-width: 1100px) {
  .order-detail-product { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1.4fr); gap: 10px 16px; align-items: start; }
  .order-detail-product > .mt-3 { margin-top: 0; }
  .order-detail-product > div:last-child { grid-column: 1 / -1; padding-top: 8px; border-top: 1px solid #eef2f8; font-size: 12px; }
}
@media (max-width: 1000px) { .order-detail-financial-grid { grid-template-columns: 1fr; } }
@media (max-width: 640px) {
  .crm-order-detail { padding: 12px; }
  .crm-order-detail section { padding: 14px; }
  .order-detail-stat-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .order-detail-discounts { width: 100%; }
  .order-detail-discounts label { flex: 1; justify-content: space-between; }
}
@media (prefers-reduced-motion: reduce) { .crm-order-detail * { transition: none !important; } }

/* Visual values from the order-detail HTML reference. */
    .order-detail-hero-grid{display:grid; grid-template-columns:minmax(0,2.1fr) minmax(0,1fr) minmax(0,1.15fr) minmax(0,.85fr); gap:12px; margin-bottom:16px}
    .order-detail-hero,.order-detail-customer,.order-detail-status-picker{border-radius:20px; padding:18px; position:relative; overflow:hidden}
    .order-detail-hero{background:linear-gradient(135deg, #16c9ff 0%, #1574ff 55%, #3f54ff 100%); color:#fff; min-height:120px; display:flex; align-items:center; gap:16px; box-shadow:0 18px 36px rgba(35,116,255,.2)}
    .order-detail-hero-icon{width:66px;height:66px;border-radius:22px; background:rgba(255,255,255,.18); border:1px solid rgba(255,255,255,.18); display:grid; place-items:center; font-size:26px; font-weight:900; flex:0 0 auto}
    .order-detail-hero h1{font-size:22px; font-weight:900; margin-bottom:5px}
    .order-detail-hero p{font-size:15px; opacity:.95}
    .order-detail-cell{display:inline-flex; align-items:center; gap:9px; margin-top:11px; background:rgba(255,255,255,.18); color:#fff; padding:8px 12px; border-radius:999px; border:1px solid rgba(255,255,255,.22); font-weight:800; font-size:13px}
    .order-detail-customer{background:#fbfdff; border:1px solid #dde7f5; display:flex; align-items:center; gap:14px; min-height:120px}
    .order-detail-customer-avatar,.order-detail-round-icon{width:58px;height:58px;border-radius:19px; background:#eff4ff; display:grid; place-items:center; flex:0 0 auto; color:#2d58d6; font-size:24px; font-weight:800}
    .order-detail-customer h2{font-size:15px; font-weight:900; text-transform:uppercase; margin-bottom:6px}
    .order-detail-telegram{font-size:15px; font-weight:900; color:#144ef5}
    .order-detail-customer-name{margin-top:6px; color:#7a88ab; font-weight:700; font-size:13px}
    .order-detail-status-picker{background:#fbfdff; border:1px solid #dde7f5; min-height:120px; display:flex; align-items:center; gap:14px}
    .order-detail-status-picker > label{display:flex; flex-direction:column; gap:16px; font-size:15px; font-weight:900; margin-bottom:10px}
    .order-detail-status-picker select{min-width:150px; border:1px solid #dbe7fb; border-radius:14px; padding:11px 14px; font-size:15px; background:#fff; box-shadow:inset 0 1px 0 rgba(255,255,255,.6)}
    .order-detail-current-status{background:var(--order-status-surface,#f4f7fc); border:1px solid var(--order-status-border,#dce4ef); min-height:120px; border-radius:20px; display:grid; place-items:center; text-align:center; color:var(--order-status-text,#475569); box-shadow:0 14px 38px rgba(51,82,135,.08)}
    .order-detail-status-tick{width:60px;height:60px;border-radius:999px; background:var(--order-status-icon,#64748b); color:#fff; display:grid; place-items:center; font-size:28px; font-weight:900; margin-bottom:10px}
    .order-detail-current-status strong{font-size:21px; font-weight:900; letter-spacing:.02em}

    .order-detail-financial-grid{display:grid; grid-template-columns:1.15fr 1fr; gap:16px; align-items:start; margin-top:14px}
    .order-detail-pay{background:linear-gradient(135deg,#2f84ff 0%, #3674ff 55%, #4d9dff 100%); color:#fff; border-radius:24px; padding:22px 24px; box-shadow:0 18px 36px rgba(47,132,255,.22); min-height:176px; display:flex; flex-direction:column; justify-content:space-between}
    .order-detail-pay > span:not(.order-detail-pay-icon){font-weight:800; opacity:.92; font-size:16px}
    .order-detail-pay > strong{font-size:48px; font-weight:900; line-height:1; margin:8px 0 18px}
    .order-detail-profit{display:flex; justify-content:space-between; align-items:flex-end; gap:12px; padding-top:14px; border-top:1px solid rgba(255,255,255,.28)}
    .order-detail-profit span{font-size:15px; opacity:.92}
    .order-detail-profit strong{font-size:28px; font-weight:900}
    .order-detail-pay-icon{width:62px;height:62px;border-radius:20px; background:rgba(255,255,255,.16); display:grid; place-items:center; font-size:28px}

    .fin-right{display:grid; gap:12px}
    .order-detail-discounts{display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px}
    .order-detail-discounts label,.order-detail-stat-grid > div{background:#fff; border:1px solid #e7eef9; border-radius:18px; padding:12px 14px; box-shadow:0 8px 20px rgba(53,82,130,.05)}
    .order-detail-discounts label{display:grid; grid-template-columns:auto 1fr auto; gap:10px; align-items:center}
    .order-detail-discount-icon,.order-detail-stat-icon{width:38px;height:38px;border-radius:12px; background:#eef4ff; display:grid; place-items:center; color:#1d67ff; font-size:18px}
    .order-detail-discounts label{font-size:14px; font-weight:800}
    .order-detail-discounts input{width:110px; border:1px solid #d8e4f7; border-radius:12px; padding:10px 12px; font-size:14px}
    .order-detail-stat-grid{display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px}
    .order-detail-stat-grid > div{display:grid; grid-template-columns:auto 1fr; gap:10px; align-items:start; min-height:86px}
    .order-detail-stat-grid dt{font-size:13px; color:#67779f; font-weight:800; line-height:1.25}
    .order-detail-stat-grid dd{font-size:16px; font-weight:900; margin-top:6px}


.crm-order-detail { container-name: order-detail; container-type: inline-size; min-width: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; font-size: 14px; color: #0b164a; background: linear-gradient(180deg,#f7fbff 0%,#f2f6fb 100%); }
.crm-order-detail section { border-color: #e8eef8; border-radius: 26px; padding: 16px; box-shadow: 0 14px 38px rgb(51 82 135 / 8%); }
.order-detail-hero-icon { padding: 17px; }
.order-detail-customer { flex-direction: column; align-items: stretch; justify-content: center; gap: 10px; }
.order-detail-customer-main { display: flex; align-items: center; gap: 14px; min-width: 0; }
.order-detail-customer-info { min-width: 0; }
.order-detail-customer-avatar { overflow: hidden; }
.order-detail-customer-avatar img { display: block; width: 100%; height: 100%; object-fit: cover; }
.order-detail-customer-avatar svg { width: 32px; height: 32px; }
.order-detail-customer h2 { color: #0b164a; }
.order-detail-telegram { margin-top: 0; }
.order-detail-customer-phone { margin-top: 6px; color: #7a88ab; font-size: 13px; font-weight: 700; }
.order-detail-status-picker > label { flex: 1; min-width: 0; }
.order-detail-status-picker select { min-width: 0; width: 100%; }
.order-detail-round-icon svg { width: 28px; height: 28px; }
.order-detail-current-status { display: flex; flex-direction: column; gap: 5px; }
.order-detail-current-status strong { text-transform: uppercase; }
.order-detail-status-tick { flex: 0 0 60px; }
.order-detail-status-tick svg { width: 30px; height: 30px; color: white; }
.crm-order-detail .order-detail-top-timeline { margin-top: 16px; padding: 20px 20px 14px; background: #fcfdff; border-radius: 22px; box-shadow: none; }
.order-detail-heading-main { display: flex; align-items: flex-start; gap: 14px; }
.order-detail-heading-icon { width: 56px; height: 56px; flex: 0 0 56px; border-radius: 18px; background: #eef4ff; display: grid; place-items: center; color: #2772ff; }
.order-detail-heading-icon svg { width: 28px; height: 28px; }
.order-detail-section-heading h2 { font-size: 22px; font-weight: 900; }
.order-detail-section-heading p { font-size: 15px; color: #6d7ea7; }
.order-detail-discounts label { display: grid; grid-template-columns: 38px minmax(0,1fr) 110px; min-width: 0; font-weight: 800; }
.order-detail-discount-icon { flex: 0 0 38px; }
.order-detail-discounts input { min-width: 0; }
.order-detail-pay { position: relative; }
.order-detail-pay > strong { padding-right: 78px; overflow-wrap: anywhere; }
.order-detail-pay-icon { position: absolute; right: 24px; top: 48px; }
.order-detail-pay-icon svg { width: 30px; height: 30px; }
.order-detail-profit { align-items: stretch; }
.order-detail-profit span { font-size: 15px; }
.order-detail-profit strong { font-size: 28px; font-weight: 900; }
.order-detail-stat-grid > div { display: block; position: relative; padding-left: 62px; }
.order-detail-stat-grid dt { margin: 0; }
.order-detail-stat-grid dd { margin: 6px 0 0; }
.order-detail-stat-icon { position: absolute; left: 14px; top: 12px; }
.order-detail-stat-icon svg { width: 21px; height: 21px; }
.order-detail-icon-blue { color: #1d67ff; background: #eef4ff; }
.order-detail-icon-green { color: #21a95a; background: #edf9f1; }
.order-detail-icon-red { color: #ef4762; background: #fff1f4; }
.order-detail-icon-purple { color: #8a48ef; background: #f6edff; }
.order-detail-icon-orange { color: #ff9f1a; background: #fff5e8; }
.order-detail-icon-gray { color: #6f7b94; background: #f4f7fc; }
@media (max-width:1500px) {
  .order-detail-hero-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }
  .order-detail-financial-grid { grid-template-columns: 1fr; }
  .order-detail-stat-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }
}
@media (max-width:1200px) {
  .order-detail-stat-grid, .order-detail-discounts { grid-template-columns: 1fr; }
}
@media (max-width:640px) {
  .order-detail-hero-grid { grid-template-columns: 1fr; }
  .order-detail-discounts { width: 100%; }
  .order-detail-discounts label { justify-content: flex-start; }
  .order-detail-discounts input { margin-left: auto; }
  .order-detail-pay > strong { font-size: 36px; }
  .crm-order-detail .order-detail-top-timeline { padding: 16px 12px 12px; }
}
/* Product layout and controls match the supplied HTML reference. */
.crm-order-detail .order-detail-status-picker > label { margin-bottom: 0; }
.crm-order-detail .order-detail-customer h2 { text-transform: none; overflow-wrap: anywhere; }
.order-detail-products-heading { align-items: flex-start; margin-bottom: 10px; }
.order-detail-add-product { display: flex; align-items: center; gap: 12px; background: #f3f8ff; border: 1px solid #dce8ff; border-radius: 18px; padding: 12px 14px; min-width: 440px; }
.order-detail-plus-badge { width: 48px; height: 48px; border-radius: 16px; background: #e7f0ff; color: #2772ff; display: grid; place-items: center; flex: 0 0 auto; }
.order-detail-plus-badge svg { width: 28px; height: 28px; }
.order-detail-search-field { flex: 1; min-width: 0; }
.order-detail-search-field label { display: block; font-weight: 800; margin-bottom: 6px; font-size: 14px; }
.order-detail-search-field input { width: 100%; border: 1px solid #d8e4f7; border-radius: 12px; padding: 12px 14px; font-size: 14px; background: white; margin-top: 0; }
.crm-order-detail .order-detail-product-list { gap: 14px; margin-top: 10px; }
.crm-order-detail .order-detail-product { display: grid; grid-template-columns: 82px minmax(0,1.55fr) 136px 140px 152px 140px 46px; gap: 14px; align-items: center; background: white; border: 1px solid #e8eef8; border-radius: 20px; padding: 14px; box-shadow: 0 8px 20px rgb(53 82 130 / 5%); }
.crm-order-detail .order-detail-product > div:last-child { grid-column: auto; padding-top: 0; border-top: 0; }
.crm-order-detail .order-detail-product-invalid { border-color: #fca5a5; background: #fff7f7; }
.order-detail-product-thumb { width: 64px; height: 64px; border-radius: 18px; background: linear-gradient(180deg,#fff,#f3f7fd); border: 1px solid #e3ebf8; display: grid; place-items: center; box-shadow: inset 0 1px 0 white; overflow: hidden; }
.order-detail-product-thumb img { display: block; width: 100%; height: 100%; object-fit: contain; }
.order-detail-product-thumb svg { width: 30px; height: 30px; color: #7e8bab; }
.order-detail-product-info { min-width: 0; }
.order-detail-product-name { font-size: 16px; font-weight: 900; margin-bottom: 4px; }
.order-detail-product-meta { font-size: 13px; color: #6d7ea7; font-weight: 700; }
.order-detail-product-description { display: inline-block; margin-top: 8px; padding: 6px 10px; border-radius: 999px; background: #f3f7ff; color: #7e8bab; font-size: 12px; font-weight: 700; }
.order-detail-product-note, .order-detail-product-loyalty { margin-top: 5px; font-size: 12px; color: #7a55b6; }
.order-detail-product-field { display: block; min-width: 0; font-size: 13px; color: #5d6e98; font-weight: 800; }
.order-detail-product-field > span { display: block; margin-bottom: 7px; }
.order-detail-product-field > input { border: 1px solid #d8e4f7; background: white; border-radius: 12px; padding: 10px 12px; font-size: 15px; min-height: 44px; }
.crm-order-detail .order-detail-quantity { grid-template-columns: 36px minmax(0,1fr) 36px; align-items: stretch; border-radius: 12px; min-height: 44px; }
.crm-order-detail .order-detail-quantity button { background: white; color: #6376a2; font-size: 20px; }
.crm-order-detail .order-detail-quantity input { font-size: 16px; font-weight: 800; }
.order-detail-product-sum { background: #f7faff; border-radius: 16px; border: 1px solid #edf3fc; padding: 14px; min-width: 0; }
.order-detail-product-sum > span { display: block; font-size: 12px; color: #62739f; font-weight: 800; margin-bottom: 4px; }
.order-detail-product-sum strong { font-size: 19px; font-weight: 900; overflow-wrap: anywhere; }
.crm-order-detail .order-detail-trash { width: 40px; height: 40px; border-radius: 12px; color: #ff4369; }
.crm-order-detail .order-detail-product-summary { border-radius: 18px; padding: 12px 16px; gap: 16px; font-size: 15px; font-weight: 800; }
.crm-order-detail .order-detail-show-more { background: #fbfdff; color: #2066ff; padding: 9px 14px; border-radius: 14px; font-weight: 800; }
@media (max-width: 1500px) { .crm-order-detail .order-detail-product { grid-template-columns: 82px minmax(0,1.3fr) 120px 130px 140px 130px 46px; } }
@media (max-width: 1200px) { .crm-order-detail .order-detail-product { grid-template-columns: 1fr; } .order-detail-add-product { min-width: 0; width: 100%; } .order-detail-products-heading { flex-direction: column; } }

/* Keep draft-only state changes in the same layout slots. */
.order-detail-save-hint { min-height: 1.5rem; overflow-wrap: anywhere; }
.order-detail-status-draft { min-height: 1rem; line-height: 1rem; }
.order-detail-status-draft-hidden { visibility: hidden; }
.order-detail-current-status strong { display: flex; align-items: center; justify-content: center; min-height: 2.5em; line-height: 1.25; }
.order-detail-current-status[data-status="new"] { --order-status-surface: #fff7db; --order-status-border: #eed28a; --order-status-text: #785000; --order-status-icon: #946000; }
.order-detail-current-status[data-status="in_progress"],
.order-detail-current-status[data-status="completed"],
.order-detail-current-status[data-status="delivered"] { --order-status-surface: #eaf8ee; --order-status-border: #b9dfc4; --order-status-text: #166534; --order-status-icon: #15803d; }
.order-detail-current-status[data-status="cancelled"] { --order-status-surface: #fff0f1; --order-status-border: #f2bdc4; --order-status-text: #a51d35; --order-status-icon: #be123c; }
.order-detail-status-payment-description { color: inherit; }
.order-detail-telegram a:focus-visible { outline: 3px solid #05b8ff; outline-offset: 3px; border-radius: 3px; }
.order-detail-hero > div, .order-detail-heading-main > div, .order-detail-stat-grid dt, .order-detail-stat-grid dd { min-width: 0; overflow-wrap: anywhere; }
.crm-order-detail input, .crm-order-detail select, .crm-order-detail textarea { max-width: 100%; }
.crm-order-detail > div > .flex button { min-height: 44px; }
.crm-order-detail .order-detail-trash { width: 44px; height: 44px; }
.order-detail-quantity button { min-width: 0; }
.order-detail-pay > strong, .order-detail-profit strong, .order-detail-stat-grid dd, .order-detail-product-sum strong { font-variant-numeric: tabular-nums; }

/* Use available content width, including when an admin sidebar is open. */
@container order-detail (max-width: 1140px) {
  .order-detail-hero-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }
  .order-detail-financial-grid { grid-template-columns: minmax(0,1fr); }
  .order-detail-stat-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }
  .order-detail-discounts { grid-template-columns: minmax(0,1fr); }
  .order-detail-products-heading { flex-direction: column; }
  .order-detail-add-product { min-width: 0; width: 100%; }
  .crm-order-detail .order-detail-product { grid-template-columns: repeat(3,minmax(0,1fr)); align-items: start; }
  .order-detail-product-thumb { grid-column: 1; }
  .order-detail-product-info { grid-column: 2 / -1; }
  .order-detail-product-field { grid-column: auto; }
  .crm-order-detail .order-detail-product-sum { grid-column: 1 / 3; }
  .crm-order-detail .order-detail-trash { grid-column: 3; justify-self: end; align-self: center; }
}
@container order-detail (max-width: 600px) {
  .order-detail-hero-grid { grid-template-columns: minmax(0,1fr); }
  .order-detail-hero { gap: 12px; }
  .order-detail-hero-icon { width: 48px; height: 48px; padding: 11px; border-radius: 16px; }
  .order-detail-hero h1 { font-size: 20px; }
  .order-detail-hero p { font-size: 13px; }
  .order-detail-heading-main { gap: 10px; }
  .order-detail-heading-icon { width: 44px; height: 44px; flex-basis: 44px; border-radius: 14px; }
  .order-detail-section-heading h2 { font-size: 20px; }
  .order-detail-section-heading p { font-size: 13px; }
  .order-detail-discounts label { grid-template-columns: 38px minmax(0,1fr) 88px; gap: 8px; padding: 12px; }
  .order-detail-discounts input { width: 88px; margin-left: 0; padding: 10px 8px; }
  .order-detail-pay { padding: 18px; }
  .order-detail-pay > span:not(.order-detail-pay-icon) { padding-right: 56px; }
  .order-detail-pay > strong { padding-right: 0; font-size: clamp(24px,8cqi,36px); line-height: 1.15; }
  .order-detail-pay-icon { width: 44px; height: 44px; top: 18px; right: 18px; border-radius: 14px; }
  .order-detail-pay-icon svg { width: 24px; height: 24px; }
  .order-detail-add-product { gap: 10px; padding: 12px; }
  .order-detail-plus-badge { width: 40px; height: 40px; border-radius: 12px; }
  .crm-order-detail .order-detail-product { grid-template-columns: minmax(0,1fr); gap: 12px; }
  .order-detail-product-thumb, .order-detail-product-info, .order-detail-product-field,
  .crm-order-detail .order-detail-product-sum, .crm-order-detail .order-detail-trash { grid-column: 1; }
  .crm-order-detail .order-detail-product-summary { align-items: flex-start; gap: 12px; font-size: 14px; }
}
@container order-detail (max-width: 360px) {
  .order-detail-stat-grid { grid-template-columns: minmax(0,1fr); }
}
</style>
