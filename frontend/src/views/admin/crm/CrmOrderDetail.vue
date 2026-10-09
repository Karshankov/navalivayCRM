<template>
  <div class="min-h-screen bg-gray-50 p-6">
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
        v-if="saveBlockReason"
        class="text-sm text-gray-500"
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
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 class="text-2xl font-bold text-gray-900">Заказ #{{ currentOrder.order_number }}</h1>
              <p class="mt-1 text-sm text-gray-500">Создан {{ formatFullDate(currentOrder.created_at) }}</p>
              <p class="mt-2 text-sm text-gray-700">
                Клиент: <span class="font-semibold text-gray-900">{{ currentOrder.customer_name || 'Гость' }}</span>
              </p>
              <p v-if="currentOrder.phone" class="text-sm text-gray-600">Телефон: {{ currentOrder.phone }}</p>
              <p v-if="currentOrder.telegram_username" class="text-sm text-blue-600">
                <a :href="`https://t.me/${currentOrder.telegram_username}`" target="_blank" class="hover:underline">@{{ currentOrder.telegram_username }}</a>
              </p>
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
            <div class="text-right">
              <span :class="statusBadgeClass(editableStatus)" class="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide">{{ statusLabel(editableStatus, deliveryType) }}</span>
              <div v-if="hasPayment" class="mt-2 text-sm text-emerald-600">
                Оплачено: {{ formatCurrency(currentOrder.paid_amount || 0) }}
                <div class="text-xs text-gray-500">{{ paymentDescription }}</div>
              </div>
            </div>
          </div>

          <div class="mt-6 grid gap-4 md:grid-cols-2">
            <label class="flex flex-col gap-2 text-sm font-medium text-gray-700">
              Статус заказа
              <select
                v-model="editableStatus"
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
              <span v-if="staffTrackingEnabled" class="text-xs font-normal leading-5 text-gray-500">
                Сборка и выдача выполняются с доски заказов: система отдельно запишет сборщика и выдавшего.
              </span>
            </label>
            <div class="flex flex-col gap-2 text-sm text-gray-600">
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
            <label class="md:col-span-2 flex flex-col gap-2 text-sm font-medium text-gray-700">
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
          <div class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 class="text-xl font-semibold text-gray-900">Позиции заказа</h2>
              <p class="text-sm text-gray-500">Редактируйте количество, цены и добавляйте новые товары.</p>
            </div>
            <div class="w-full max-w-md">
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

          <div class="mt-6 space-y-4">
            <div
              v-if="!form.items.length"
              class="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500"
            >
              Позиции заказа пока не добавлены. Найдите товар выше и добавьте его в список.
            </div>

            <article
              v-for="item in form.items"
              :key="item.productId"
              class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
              :class="{
                'border-red-300 bg-red-50/40': item.quantity <= 0 || item.manualDiscount + item.loyaltyDiscount > item.price * item.quantity
              }"
            >
                <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p class="text-base font-semibold text-gray-900">
                      <span v-if="item.groupName" class="text-blue-600">{{ item.groupName }} - </span>{{ item.baseProductTitle || item.title }}
                      <span v-if="item.variantName" class="text-sm text-gray-600"> - {{ item.variantName }}</span>
                    </p>
                    <p v-if="item.description" class="text-[11px] text-gray-400 leading-tight mt-0.5">
                      {{ item.description }}
                    </p>
                  <p class="text-xs text-gray-500">
                    Себестоимость: {{ formatCurrency(item.cost) }}
                    <span v-if="item.stock !== null && item.stock !== undefined" class="ml-2">Остаток: {{ item.stock }}</span>
                  </p>
                  <p v-if="catalogDiscountOf(item)" class="text-xs text-red-600 mt-0.5">
                    Обычная цена: {{ formatCurrency(item.basePrice!) }} · Скидка каталога:
                    −{{ formatCurrency(catalogDiscountOf(item)) }}
                    <span v-if="catalogDiscountPercentOf(item)">({{ catalogDiscountPercentOf(item) }}%)</span>
                  </p>
                  <p v-if="managerPriceChangeOf(item)" class="text-xs text-amber-600 mt-0.5">
                    Цену менял менеджер:
                    {{ managerPriceChangeOf(item)! > 0 ? '−' : '+' }}{{ formatCurrency(Math.abs(managerPriceChangeOf(item)!)) }}
                  </p>
                </div>
                <button
                  class="admin-link-button admin-link-button--danger"
                  @click="removeItem(item.productId)"
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
                    @blur="normalizeItem(item)"
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
                    @blur="normalizeItem(item)"
                  />
                </label>
                <label class="flex flex-col gap-1 text-xs font-medium text-gray-600">
                  Ручная скидка на позицию, BYN
                  <input
                    v-model.number="item.manualDiscount"
                    type="number"
                    min="0"
                    step="0.01"
                    class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    @blur="normalizeItem(item)"
                  />
                </label>
              </div>

              <div
                v-if="item.loyaltyDiscount > 0"
                class="mt-3 flex flex-wrap items-center gap-2 text-xs text-violet-700"
              >
                <span class="rounded-full bg-violet-50 px-2.5 py-1 font-semibold">
                  Скидка за покупки: -{{ formatCurrency(item.loyaltyDiscount) }}
                </span>
                <span>Списано бонусов: {{ item.loyaltyUnitsApplied }}</span>
              </div>

              <div class="mt-3 flex flex-wrap items-center justify-between text-sm text-gray-600">
                <span>Всего: <span class="font-semibold text-gray-900">{{ formatCurrency(itemSubtotal(item)) }}</span></span>
                <span>Максимальная ручная скидка: {{ formatCurrency(Math.max(item.price * Math.max(item.quantity, 0) - item.loyaltyDiscount, 0)) }}</span>
              </div>
            </article>
          </div>
        </section>

        <section class="rounded-2xl bg-white p-6 shadow-sm">
          <div class="grid gap-6 lg:grid-cols-[1.2fr,1fr]">
            <div class="space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-5">
              <header class="flex items-center justify-between">
                <h3 class="text-sm font-semibold uppercase tracking-wide text-gray-600">Финансовые итоги</h3>
                <span class="text-xs font-medium text-gray-400">Автоматический пересчет</span>
              </header>
              <dl class="space-y-3 text-sm text-gray-600">
                <div v-if="catalogDiscountTotal > 0" class="flex items-center justify-between">
                  <dt>Сумма по обычной цене</dt>
                  <dd class="font-semibold text-gray-900">{{ formatCurrency(itemsBaseSubtotal) }}</dd>
                </div>
                <div v-if="catalogDiscountTotal > 0" class="flex items-center justify-between">
                  <!-- Скидка каталога уже сидит внутри цены продажи. Не пометь
                       её справочной, и менеджер вычтет её второй раз глазами. -->
                  <dt>Скидка каталога <span class="text-xs text-gray-400">справочно</span></dt>
                  <dd class="font-semibold text-red-600">−{{ formatCurrency(catalogDiscountTotal) }}</dd>
                </div>
                <div class="flex items-center justify-between">
                  <dt>Сумма позиций (по цене продажи)</dt>
                  <dd class="font-semibold text-gray-900">{{ formatCurrency(itemsSubtotal) }}</dd>
                </div>
                <div class="flex items-center justify-between">
                  <dt>Сумма позиций (со скидками)</dt>
                  <dd class="font-semibold text-gray-900">{{ formatCurrency(itemsDiscountedSubtotal) }}</dd>
                </div>
                <div class="flex items-center justify-between">
                  <dt>Скидка за покупки</dt>
                  <dd class="font-semibold text-violet-700">{{ formatCurrency(loyaltyDiscountTotal) }}</dd>
                </div>
                <div class="flex items-center justify-between">
                  <dt>Ручные скидки по позициям</dt>
                  <dd class="font-semibold text-gray-900">{{ formatCurrency(manualItemDiscountTotal) }}</dd>
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
                      @blur="normalizeDiscounts"
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
                      @blur="normalizeDiscounts"
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
            <div class="space-y-3 text-sm text-gray-600">
              <div class="rounded-xl border border-gray-200 bg-white p-4">
                <p>
                  Номер заказа: <span class="font-medium text-gray-900">#{{ currentOrder.order_number }}</span>
                </p>
                <p>
                  Статус оплаты: <span class="font-medium" :class="hasPayment ? 'text-emerald-600' : 'text-gray-700'">
                    {{ hasPayment ? 'Оплачен' : 'Не оплачен' }}
                  </span>
                </p>
                <p v-if="currentOrder.completed_at">Выдан: {{ formatFullDate(currentOrder.completed_at) }}</p>
              </div>
            </div>
          </div>
        </section>

        <!-- История изменений статуса -->
        <section v-if="orderHistory.length" class="rounded-2xl bg-white p-6 shadow-sm">
          <h2 class="mb-4 text-lg font-semibold text-gray-900">История изменений</h2>
          <div class="relative space-y-0">
            <div
              v-for="(entry, idx) in orderHistory"
              :key="entry.id"
              class="relative flex gap-4 pb-4"
            >
              <!-- Timeline line -->
              <div class="flex flex-col items-center">
                <div class="h-3 w-3 rounded-full border-2 border-blue-400 bg-white" :class="idx === 0 ? 'bg-blue-400' : ''"></div>
                <div v-if="idx < orderHistory.length - 1" class="w-0.5 flex-1 bg-gray-200"></div>
              </div>
              <div class="flex-1 -mt-0.5">
                <div class="flex items-center gap-2">
                  <span v-if="entry.previous_status" class="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600">{{ statusLabel(entry.previous_status as Order['status']) }}</span>
                  <svg v-if="entry.previous_status" class="h-3 w-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                  </svg>
                  <span class="rounded bg-blue-100 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">{{ statusLabel(entry.new_status as Order['status']) }}</span>
                </div>
                <p v-if="entry.note" class="mt-1 text-xs text-gray-500">{{ entry.note }}</p>
                <p class="mt-0.5 text-[11px] text-gray-400">{{ formatFullDate(entry.changed_at) }}</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useCrmStore, type CrmProductSummary, type Order, type AutoNotificationResult } from '@/stores/crm'
import ManagerActionSummary from '@/components/crm/ManagerActionSummary.vue'
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

const loading = ref(false)
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
  { value: 'in_progress', label: 'В работе' },
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

const finalAmount = computed(() => applyDiscounts(itemsDiscountedSubtotal.value, form.discountAmount, form.discountPercent))
const expectedProfit = computed(() => calculateExpectedProfit(finalAmount.value, itemsCost.value))

function originalItemFor(formItem: FormItem) {
  return (currentOrder.value?.items || []).find((item) => {
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

const hasChanges = computed(() => {
  if (!currentOrder.value) return false

  if (editableStatus.value !== currentOrder.value.status) return true
  if (form.deliveryAddress !== (currentOrder.value.delivery_address || '')) return true
  if (form.notes !== (currentOrder.value.notes || '')) return true
  if (form.discountAmount !== Number(currentOrder.value.discount_amount || 0)) return true
  if (form.discountPercent !== Number(currentOrder.value.discount_percent || 0)) return true

  if (form.items.length !== (currentOrder.value.items || []).length) return true
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
  try {
    orderHistory.value = await crmStore.fetchOrderHistory(props.id)
  } catch (error) {
    console.error('[CRM] Failed to load order history:', error)
  }
}

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
  if (successTimer) clearTimeout(successTimer)
  clearProductSearchState()
})

async function refreshOrder() {
  loading.value = true
  try {
    const order = await crmStore.fetchOrder(props.id)
    if (order) {
      initializeForm(order)
    }
  } finally {
    loading.value = false
  }
}

function initializeForm(order: Order) {
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
  form.items = form.items.filter((item) => item.productId !== productId)
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

  const payload = {
    status: editableStatus.value,
    delivery_address: trimmedDeliveryAddress ? trimmedDeliveryAddress : null,
    notes: trimmedNotes ? trimmedNotes : null,
    discount_amount: Math.min(discountAmount, itemsDiscountedSubtotal.value),
    discount_percent: discountPercent,
    items: sanitizedItems
  }

  try {
    const updated = await crmStore.updateOrder(currentOrder.value.id, payload)
    currentOrder.value = updated
    initializeForm(updated)
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
    saveError.value = formatErrorMessage(error?.message || error?.error || 'Не удалось сохранить изменения')
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
      return 'bg-blue-100 text-blue-700'
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
  return new Date(dateString).toLocaleString('ru-RU', {
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
