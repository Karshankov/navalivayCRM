<template>
  <div class="flex min-h-0 flex-1 flex-col gap-5">
    <Transition
      enter-active-class="transition ease-out duration-200"
      enter-from-class="opacity-0 translate-y-2"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition ease-in duration-150"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 translate-y-2"
    >
      <div
        v-if="successMessage"
        class="fixed right-5 top-5 z-[70] rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 shadow-lg"
        role="status"
        aria-live="polite"
      >
        {{ successMessage }}
      </div>
    </Transition>

    <!-- Toolbar -->
    <div class="flex shrink-0 flex-wrap items-center gap-3">
      <div class="inline-flex items-center gap-0.5 rounded-[10px] border border-slate-200 bg-slate-50 p-[3px]">
        <button
          v-for="option in sourceOptions"
          :key="option.value"
          type="button"
          class="h-[34px] rounded-lg border px-3.5 text-sm font-medium leading-5 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/20"
          :class="sourceFilter === option.value
            ? 'border-blue-200 bg-white text-blue-600 shadow-sm'
            : 'border-transparent bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900'"
          @click="setSourceFilter(option.value)"
        >
          {{ option.label }}
        </button>
      </div>

      <select
        v-model="filter"
        class="rounded-xl border border-slate-200/40 bg-gradient-to-br from-slate-50/90 to-gray-50/60 px-3 py-2 text-sm font-medium text-slate-600 shadow-sm transition-all duration-200 hover:border-slate-300/50 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
        @change="loadPromoCodes"
      >
        <option value="">Все статусы</option>
        <option value="active">Активные</option>
        <option value="inactive">Неактивные</option>
        <option value="expired">Истекшие</option>
        <option value="exhausted">Исчерпанные</option>
      </select>

      <div class="relative flex-1 sm:flex-none">
        <input
          v-model="search"
          type="search"
          placeholder="Поиск по коду..."
          class="w-full rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 sm:w-64"
          @input="debouncedSearch"
        />
        <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>

      <div class="flex-1"></div>

      <button
        @click="openCreateModal"
        class="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-md transition-all duration-200 hover:from-blue-700 hover:to-indigo-700 hover:shadow-lg"
      >
        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        <span class="hidden sm:inline">Создать промокод</span>
        <span class="sm:hidden">Создать</span>
      </button>
    </div>

    <!-- Table -->
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200/60 bg-white shadow-sm">
      <div
        class="min-h-0 flex-1 overflow-auto"
        role="region"
        aria-label="Список промокодов"
      >
        <div class="overflow-x-auto">
        <table class="w-full">
          <thead class="sticky top-0 z-10 border-b border-slate-200/60 bg-slate-50/95 backdrop-blur-sm">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Код</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Описание</th>
              <th class="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Скидка</th>
              <th class="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">Использований</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Срок</th>
              <th class="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">Статус</th>
              <th class="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Действия</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-if="crmStore.promoCodesLoading && !promoCodes.length">
              <td colspan="7" class="px-4 py-12 text-center text-slate-400">
                <svg class="mx-auto mb-2 h-6 w-6 animate-spin text-slate-300" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Загрузка...
              </td>
            </tr>
            <tr v-else-if="!promoCodes.length">
              <td colspan="7" class="px-4 py-12 text-center text-slate-400">
                {{ emptyStateText }}
              </td>
            </tr>
            <tr
              v-for="promo in promoCodes"
              :key="promo.id"
              class="hover:bg-slate-50/60 transition-colors duration-150"
            >
              <td class="px-4 py-3.5">
                <span class="inline-flex items-center rounded-lg bg-slate-100 px-2.5 py-1 font-mono text-sm font-semibold text-slate-800">
                  {{ promo.code }}
                </span>
                <span
                  v-if="promo.has_gift"
                  class="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700"
                >
                  Подарок
                </span>
                <span
                  v-if="isWheelTemplatePromo(promo)"
                  class="ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
                  :class="getSourceBadgeClass()"
                >
                  Шаблон рулетки
                </span>
              </td>
              <td class="px-4 py-3.5 text-sm text-slate-600 max-w-[240px]">
                <p class="truncate font-medium text-slate-800">{{ getPromoPrimaryText(promo) }}</p>
                <p
                  v-if="getPromoSecondaryText(promo)"
                  class="truncate text-xs text-slate-500"
                >
                  {{ getPromoSecondaryText(promo) }}
                </p>
              </td>
              <td class="px-4 py-3.5 text-sm text-right font-semibold text-slate-800">
                <template v-if="promo.has_gift && Number(promo.discount_value) <= 0">Подарок</template>
                <template v-else-if="promo.discount_type === 'fixed'">{{ promo.discount_value }} BYN</template>
                <template v-else>{{ promo.discount_value }}%</template>
              </td>
              <td class="px-4 py-3.5 text-center">
                <button
                  @click="openUsageModal(promo)"
                  class="group inline-flex flex-col items-center gap-1 rounded-lg px-2 py-1 transition-colors hover:bg-slate-50"
                  :title="promo.max_uses > 0 ? `${promo.current_uses} из ${promo.max_uses} использований` : `${promo.current_uses} использований`"
                >
                  <span class="text-sm font-medium text-slate-700">
                    {{ promo.current_uses }}<span class="text-slate-400 font-normal" v-if="promo.max_uses > 0"> / {{ promo.max_uses }}</span><span class="text-slate-400 font-normal" v-else> / ∞</span>
                  </span>
                  <div v-if="promo.max_uses > 0" class="w-12 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                    <div 
                      class="h-full rounded-full transition-all"
                      :class="getUsageBarClass(promo)"
                      :style="{ width: Math.min(100, (promo.current_uses / promo.max_uses) * 100) + '%' }"
                    />
                  </div>
                </button>
              </td>
              <td class="px-4 py-3.5 text-sm text-slate-500">
                <template v-if="promo.valid_from_date || promo.valid_from || promo.valid_until">
                  <template v-if="promo.valid_from_date">
                    <span>{{ formatDate(promo.valid_from_date) }}</span>
                    <span class="text-slate-300"> - </span>
                    <span>
                      {{
                        promo.effective_valid_until_date
                          ? formatDate(promo.effective_valid_until_date)
                          : 'Бессрочно'
                      }}
                    </span>
                  </template>
                  <template v-else>
                    <span v-if="promo.valid_from">{{ formatDate(promo.valid_from) }}</span>
                    <span v-if="promo.valid_from && promo.valid_until" class="text-slate-300"> - </span>
                    <span v-if="promo.valid_until">{{ formatDate(promo.valid_until) }}</span>
                  </template>
                </template>
                <span v-else class="text-slate-300">Бессрочный</span>
              </td>
              <td class="px-4 py-3.5 text-center">
                <span
                  class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
                  :class="getStatusClass(promo)"
                >
                  {{ getStatusText(promo) }}
                </span>
              </td>
              <td class="px-4 py-3.5 text-right">
                <div class="flex items-center justify-end gap-1">
                  <button
                    @click="openEditModal(promo)"
                    class="rounded-lg p-2 text-slate-400 transition-all hover:bg-blue-50 hover:text-blue-600"
                    title="Редактировать"
                  >
                    <PencilIcon class="h-4 w-4" />
                  </button>
                  <button
                    @click="handleDelete(promo)"
                    class="rounded-lg p-2 text-slate-400 transition-all hover:bg-red-50 hover:text-red-600"
                    title="Удалить"
                  >
                    <TrashIcon class="h-4 w-4" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        </div>
      </div>

      <div
        v-if="promoCodesTotal > 0"
        class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200/60 bg-slate-50/60 px-4 py-2.5"
      >
        <p class="text-xs text-slate-500">
          Показано {{ promoCodes.length }} из {{ promoCodesTotal }}
        </p>
        <button
          v-if="hasMorePromos"
          type="button"
          class="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="loadingMore"
          @click="loadMore"
        >
          {{ loadingMore ? 'Загрузка...' : 'Показать ещё' }}
        </button>
      </div>
    </div>

    <!-- Create/Edit Modal -->
    <Transition
      enter-active-class="transition ease-out duration-200"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition ease-in duration-150"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="formModalOpen"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm sm:p-6"
        v-safe-backdrop-close="closeFormModal"
      >
        <Transition
          enter-active-class="transition ease-out duration-200"
          enter-from-class="opacity-0 scale-95 translate-y-2"
          enter-to-class="opacity-100 scale-100 translate-y-0"
          leave-active-class="transition ease-in duration-150"
          leave-from-class="opacity-100 scale-100 translate-y-0"
          leave-to-class="opacity-0 scale-95 translate-y-2"
        >
          <div
            v-if="formModalOpen"
            data-testid="promo-form-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="promo-form-title"
            class="flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200/40 bg-white shadow-2xl sm:max-h-[calc(100dvh-3rem)]"
          >
            <h3 id="promo-form-title" class="shrink-0 border-b border-slate-100 px-6 py-4 text-lg font-bold text-slate-900">
              {{ editingPromo ? 'Редактировать промокод' : 'Создать промокод' }}
            </h3>

            <form @submit.prevent="handleSubmit" class="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div data-testid="promo-form-scroll" class="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
              <div>
                <label class="block text-sm font-medium text-slate-700 mb-1.5">Код промокода</label>
                <div class="flex gap-2">
                  <input
                    v-model="form.code"
                    type="text"
                    class="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm uppercase focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    placeholder="SALE2026"
                    required
                  />
                  <button
                    type="button"
                    @click="generateCode"
                    class="rounded-xl border border-slate-200/40 bg-gradient-to-br from-slate-50/90 to-gray-50/60 px-3 py-2.5 text-sm font-medium text-slate-600 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300/50 hover:shadow-md whitespace-nowrap"
                  >
                    Сгенерировать
                  </button>
                </div>
              </div>

              <div v-if="isEditingWheelTemplate">
                <div class="mb-1.5 flex items-center gap-2">
                  <label for="promo-prize-title" class="block text-sm font-medium text-slate-700">Название приза</label>
                  <span class="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">Для рулетки</span>
                  <span class="text-xs text-slate-500">обязательно</span>
                </div>
                <input
                  id="promo-prize-title"
                  ref="prizeTitleInput"
                  v-model="form.description"
                  type="text"
                  class="w-full rounded-lg border px-4 py-2.5 text-sm focus:outline-none focus:ring-2"
                  :class="prizeTitleError
                    ? 'border-red-300 focus:border-red-500 focus:ring-red-100'
                    : 'border-gray-300 focus:border-blue-500 focus:ring-blue-200'"
                  :aria-invalid="Boolean(prizeTitleError)"
                  aria-required="true"
                  :aria-describedby="prizeTitleError ? 'promo-prize-title-error' : 'promo-prize-title-hint'"
                  placeholder="Например: Одноразка в подарок"
                  @input="prizeTitleError = ''"
                />
                <p v-if="prizeTitleError" id="promo-prize-title-error" class="mt-1 text-xs font-medium text-red-600">
                  {{ prizeTitleError }}
                </p>
                <p v-else id="promo-prize-title-hint" class="mt-1 text-xs text-slate-500">Показывается на рулетке и в окне выигрыша.</p>
              </div>

              <div>
                <label for="promo-customer-description" class="block text-sm font-medium text-slate-700 mb-1.5">Описание для клиента</label>
                <textarea
                  id="promo-customer-description"
                  v-model="form.customer_description"
                  rows="2"
                  class="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="Этот текст клиент увидит после применения промокода"
                ></textarea>
              </div>

              <div>
                <label for="promo-manager-description" class="block text-sm font-medium text-slate-700 mb-1.5">Описание для менеджера</label>
                <textarea
                  id="promo-manager-description"
                  v-model="form.manager_description"
                  rows="3"
                  class="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="Что нужно проверить и какой подарок положить"
                ></textarea>
              </div>

              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-medium text-slate-700 mb-1.5">Тип скидки</label>
                  <select
                    v-model="form.discount_type"
                    class="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  >
                    <option value="fixed">Фиксированная (BYN)</option>
                    <option value="percent">Процент (%)</option>
                  </select>
                </div>
                <div>
                  <label class="block text-sm font-medium text-slate-700 mb-1.5">Значение скидки</label>
                  <input
                    v-model.number="form.discount_value"
                    type="number"
                    min="0"
                    step="0.01"
                    :max="form.discount_type === 'percent' ? 100 : undefined"
                    class="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    required
                  />
                  <p class="mt-1 text-xs text-slate-500">0 = подарочный промокод</p>
                </div>
              </div>

              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-medium text-slate-700 mb-1.5">Мин. сумма заказа</label>
                  <input
                    v-model.number="form.min_order_amount"
                    type="number"
                    min="0"
                    step="0.01"
                    class="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    placeholder="0 = без ограничения"
                  />
                </div>
                <div>
                  <label class="block text-sm font-medium text-slate-700 mb-1.5">Макс. использований</label>
                  <input
                    v-model.number="form.max_uses"
                    type="number"
                    min="0"
                    class="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    placeholder="0 = безлимит"
                  />
                </div>
              </div>

              <div class="grid gap-4" :class="isEditingWheelTemplate ? 'grid-cols-1' : 'grid-cols-2'">
                <div v-if="!isEditingWheelTemplate">
                  <label for="promo-valid-from-date" class="block text-sm font-medium text-slate-700 mb-1.5">Действует с</label>
                  <input
                    id="promo-valid-from-date"
                    ref="validFromDateInput"
                    v-model="form.valid_from_date"
                    type="date"
                    class="w-full rounded-lg border px-4 py-2.5 text-sm focus:outline-none focus:ring-2"
                    :class="validFromDateError
                      ? 'border-red-300 focus:border-red-500 focus:ring-red-100'
                      : 'border-gray-300 focus:border-blue-500 focus:ring-blue-200'"
                    :aria-invalid="Boolean(validFromDateError)"
                    :aria-describedby="validFromDateError ? 'promo-valid-from-date-error' : undefined"
                    @input="validFromDateError = ''"
                  />
                  <p v-if="validFromDateError" id="promo-valid-from-date-error" class="mt-1 text-xs font-medium text-red-600">
                    {{ validFromDateError }}
                  </p>
                </div>
                <div>
                  <label for="promo-duration-days" class="block text-sm font-medium text-slate-700 mb-1.5">
                    {{ isEditingWheelTemplate ? 'Срок после выигрыша, дней' : 'На сколько дней' }}
                  </label>
                  <input
                    id="promo-duration-days"
                    ref="durationDaysInput"
                    v-model.number="form.duration_days"
                    type="number"
                    min="1"
                    :disabled="!isEditingWheelTemplate && form.is_perpetual"
                    class="w-full rounded-lg border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                    :class="durationDaysError
                      ? 'border-red-300 focus:border-red-500 focus:ring-red-100'
                      : 'border-gray-300 focus:border-blue-500 focus:ring-blue-200'"
                    :aria-invalid="Boolean(durationDaysError)"
                    :aria-describedby="durationDaysError ? 'promo-duration-days-error' : undefined"
                    placeholder="Например, 13"
                    @input="durationDaysError = ''"
                  />
                  <p v-if="durationDaysError" id="promo-duration-days-error" class="mt-1 text-xs font-medium text-red-600">
                    {{ durationDaysError }}
                  </p>
                  <p v-else-if="isEditingWheelTemplate" class="mt-1 text-xs text-slate-500">Отсчитывается со дня выигрыша.</p>
                </div>
              </div>

              <div v-if="!isEditingWheelTemplate" class="flex flex-wrap items-center gap-5">
                <label class="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    v-model="form.is_perpetual"
                    type="checkbox"
                    class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    @change="clearValidityErrorsForPerpetual"
                  />
                  Бессрочно
                </label>
              </div>
              <p v-if="effectiveUntilHint" class="text-sm text-emerald-600">
                {{ effectiveUntilHint }}
              </p>

              <div class="flex items-center gap-2.5">
                <div
                  @click="form.active = !form.active"
                  class="relative h-6 w-11 cursor-pointer rounded-full transition-colors duration-200"
                  :class="form.active ? 'bg-blue-500' : 'bg-slate-300'"
                >
                  <div
                    class="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all duration-200"
                    :class="form.active ? 'left-[22px]' : 'left-0.5'"
                  />
                </div>
                <label class="text-sm font-medium text-slate-700 cursor-pointer" @click="form.active = !form.active">Активен</label>
              </div>

              <p v-if="formError" class="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-600">{{ formError }}</p>

              </div>

              <div class="flex shrink-0 flex-col gap-3 border-t border-slate-100 bg-white px-6 py-4 sm:flex-row">
                <button
                  type="submit"
                  :disabled="formSubmitting"
                  class="flex-1 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md transition-all duration-200 hover:from-blue-700 hover:to-indigo-700 hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {{ formSubmitting ? 'Сохранение...' : (editingPromo ? 'Сохранить промокод' : 'Создать промокод') }}
                </button>
                <button
                  type="button"
                  @click="closeFormModal"
                  class="flex-1 rounded-xl border border-slate-200/40 bg-gradient-to-br from-slate-50/90 to-gray-50/60 px-4 py-2.5 text-sm font-medium text-slate-600 shadow-sm transition-all duration-200 hover:border-slate-300/50 hover:shadow-md"
                >
                  Отмена
                </button>
              </div>
            </form>
          </div>
        </Transition>
      </div>
    </Transition>

    <!-- Usage History Modal -->
    <Transition
      enter-active-class="transition ease-out duration-200"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition ease-in duration-150"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="usageModalOpen"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
        v-safe-backdrop-close="() => (usageModalOpen = false)"
      >
        <div class="w-full max-w-lg rounded-2xl border border-slate-200/40 bg-white p-6 shadow-2xl">
          <h3 class="text-lg font-bold text-slate-900 mb-4">
            История использований: <span class="font-mono">{{ usagePromo?.code }}</span>
          </h3>

          <div v-if="usageLoading" class="py-10 text-center text-slate-400">
            <svg class="mx-auto mb-2 h-6 w-6 animate-spin text-slate-300" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Загрузка...
          </div>
          <div v-else-if="!usageList.length" class="py-10 text-center text-slate-400">
            Промокод ещё не использовался
          </div>
          <div v-else class="rounded-xl border border-slate-200/60 overflow-hidden">
            <table class="w-full">
              <thead class="bg-slate-50/80 border-b border-slate-200/60">
                <tr>
                  <th class="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase">Заказ</th>
                  <th class="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase">Клиент</th>
                  <th class="px-4 py-2.5 text-right text-xs font-semibold text-slate-500 uppercase">Скидка</th>
                  <th class="px-4 py-2.5 text-right text-xs font-semibold text-slate-500 uppercase">Дата</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                <tr v-for="u in usageList" :key="u.id" class="hover:bg-slate-50/60 transition-colors">
                  <td class="px-4 py-2.5 text-sm font-semibold text-slate-800">#{{ u.order_number }}</td>
                  <td class="px-4 py-2.5 text-sm text-slate-600">{{ u.customer_name?.trim() || u.telegram_username || '-' }}</td>
                  <td class="px-4 py-2.5 text-sm text-right font-semibold text-slate-800">{{ u.discount_applied }} BYN</td>
                  <td class="px-4 py-2.5 text-sm text-right text-slate-400">{{ formatDateTime(u.used_at) }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="flex justify-end mt-5">
            <button
              @click="usageModalOpen = false"
              class="rounded-xl border border-slate-200/40 bg-gradient-to-br from-slate-50/90 to-gray-50/60 px-5 py-2 text-sm font-medium text-slate-600 shadow-sm transition-all duration-200 hover:border-slate-300/50 hover:shadow-md"
            >
              Закрыть
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onBeforeUnmount, onMounted } from 'vue'
import { PencilIcon, TrashIcon } from '@heroicons/vue/24/outline'
import { useCrmStore, type PromoCode, type PromoUsage } from '@/stores/crm'
import { vSafeBackdropClose } from '@/directives/safeBackdropClose'

const crmStore = useCrmStore()
const promoCodes = computed(() => crmStore.promoCodes)
const promoCodesTotal = computed(() => crmStore.promoCodesTotal)
const PROMO_PAGE_SIZE = 100
const loadingMore = ref(false)
const hasMorePromos = computed(() => promoCodes.value.length < promoCodesTotal.value)

type PromoSourceFilter = 'regular' | 'wheel' | 'all'
const sourceOptions: Array<{ value: PromoSourceFilter; label: string }> = [
  { value: 'regular', label: 'Обычные' },
  { value: 'wheel', label: 'Рулетка' },
  { value: 'all', label: 'Все' },
]
const sourceFilter = ref<PromoSourceFilter>('regular')
const filter = ref('')
const search = ref('')
let searchTimeout: ReturnType<typeof setTimeout> | null = null

// Form modal
const formModalOpen = ref(false)
const editingPromo = ref<PromoCode | null>(null)
const formSubmitting = ref(false)
const formError = ref('')
const prizeTitleError = ref('')
const validFromDateError = ref('')
const durationDaysError = ref('')
const prizeTitleInput = ref<HTMLInputElement | null>(null)
const validFromDateInput = ref<HTMLInputElement | null>(null)
const durationDaysInput = ref<HTMLInputElement | null>(null)
const successMessage = ref('')
let successTimer: ReturnType<typeof setTimeout> | null = null
const form = ref(getEmptyForm())
const isEditingWheelTemplate = computed(() => Boolean(
  editingPromo.value && isWheelTemplatePromo(editingPromo.value),
))

function getEmptyForm() {
  return {
    code: '',
    description: '',
    customer_description: '',
    manager_description: '',
    has_gift: false,
    discount_type: 'fixed' as 'fixed' | 'percent',
    discount_value: 0,
    min_order_amount: 0,
    max_uses: 1,
    valid_from_date: '',
    duration_days: null as number | null,
    is_perpetual: true,
    valid_from: '',
    valid_until: '',
    active: true,
  }
}

// Usage modal
const usageModalOpen = ref(false)
const usagePromo = ref<PromoCode | null>(null)
const usageList = ref<PromoUsage[]>([])
const usageLoading = ref(false)

onMounted(() => {
  loadPromoCodes()
})

onBeforeUnmount(() => {
  if (successTimer) clearTimeout(successTimer)
})

async function loadPromoCodes() {
  await crmStore.fetchPromoCodes({
    search: search.value || undefined,
    filter: filter.value || undefined,
    source: sourceFilter.value,
    limit: PROMO_PAGE_SIZE,
    offset: 0,
  })
}

async function loadMore() {
  if (!hasMorePromos.value || loadingMore.value) return
  loadingMore.value = true
  try {
    await crmStore.fetchPromoCodes({
      search: search.value || undefined,
      filter: filter.value || undefined,
      source: sourceFilter.value,
      limit: PROMO_PAGE_SIZE,
      offset: promoCodes.value.length,
      append: true,
    })
  } finally {
    loadingMore.value = false
  }
}

function setSourceFilter(source: PromoSourceFilter) {
  if (sourceFilter.value === source) return
  sourceFilter.value = source
  loadPromoCodes()
}

function debouncedSearch() {
  if (searchTimeout) clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => loadPromoCodes(), 400)
}

function openCreateModal() {
  editingPromo.value = null
  form.value = getEmptyForm()
  formError.value = ''
  prizeTitleError.value = ''
  validFromDateError.value = ''
  durationDaysError.value = ''
  formModalOpen.value = true
}

function openEditModal(promo: PromoCode) {
  editingPromo.value = promo
  form.value = {
    code: promo.code,
    description: promo.description || '',
    customer_description: promo.customer_description || '',
    manager_description: promo.manager_description || '',
    has_gift: Boolean(promo.has_gift),
    discount_type: promo.discount_type,
    discount_value: promo.discount_value,
    min_order_amount: promo.min_order_amount,
    max_uses: promo.max_uses,
    valid_from_date: promo.valid_from_date || '',
    duration_days: promo.duration_days && promo.duration_days > 0 ? promo.duration_days : null,
    is_perpetual: !(promo.duration_days && promo.duration_days > 0),
    valid_from: promo.valid_from ? promo.valid_from.slice(0, 16) : '',
    valid_until: promo.valid_until ? promo.valid_until.slice(0, 16) : '',
    active: Boolean(promo.active),
  }
  formError.value = ''
  prizeTitleError.value = ''
  validFromDateError.value = ''
  durationDaysError.value = ''
  formModalOpen.value = true
}

function closeFormModal() {
  if (formSubmitting.value) return
  formModalOpen.value = false
  editingPromo.value = null
}

async function handleSubmit() {
  formError.value = ''
  prizeTitleError.value = ''
  validFromDateError.value = ''
  durationDaysError.value = ''
  formSubmitting.value = true

  try {
    const wheelTemplateEdit = isEditingWheelTemplate.value
    const days = Number(form.value.duration_days || 0)

    if (wheelTemplateEdit) {
      if (!form.value.description.trim()) {
        prizeTitleError.value = 'Укажите название приза'
        await nextTick()
        prizeTitleInput.value?.focus()
        return
      }
      if (!Number.isInteger(days) || days <= 0) {
        durationDaysError.value = 'Укажите целое число дней больше 0'
        await nextTick()
        durationDaysInput.value?.focus()
        return
      }
    } else if (!form.value.is_perpetual) {
      if (!Number.isInteger(days) || days <= 0) {
        durationDaysError.value = 'Укажите целое число дней больше 0'
      }
      if (!form.value.valid_from_date) {
        validFromDateError.value = 'Укажите дату начала действия промокода'
      }
      if (validFromDateError.value || durationDaysError.value) {
        await nextTick()
        if (validFromDateError.value) validFromDateInput.value?.focus()
        else durationDaysInput.value?.focus()
        return
      }
    }

    const useNewValidity = !wheelTemplateEdit && Boolean(form.value.valid_from_date)

    const discountValue = Number(form.value.discount_value)
    if (!Number.isFinite(discountValue) || discountValue < 0) {
      formError.value = 'Значение скидки не может быть отрицательным'
      return
    }

    const data = {
      ...form.value,
      description: editingPromo.value && isWheelRelatedPromo(editingPromo.value)
        ? (form.value.description?.trim() || null)
        : null,
      customer_description: form.value.customer_description?.trim() || null,
      manager_description: form.value.manager_description?.trim() || null,
      duration_days: wheelTemplateEdit ? days : (useNewValidity ? (form.value.is_perpetual ? null : days) : null),
      valid_from_date: wheelTemplateEdit ? (form.value.valid_from_date || null) : (useNewValidity ? form.value.valid_from_date : null),
      valid_from: wheelTemplateEdit ? (form.value.valid_from || null) : (useNewValidity ? null : (form.value.valid_from || null)),
      valid_until: wheelTemplateEdit ? (form.value.valid_until || null) : (useNewValidity ? null : (form.value.valid_until || null)),
      active: form.value.active ? 1 : 0,
      has_gift: discountValue <= 0 ? 1 : 0,
    }

    const wasEditing = Boolean(editingPromo.value)
    if (editingPromo.value) {
      await crmStore.updatePromoCode(editingPromo.value.id, data)
    } else {
      await crmStore.createPromoCode(data)
    }

    formModalOpen.value = false
    editingPromo.value = null
    showSuccess(wasEditing ? 'Промокод сохранён.' : 'Промокод создан.')
  } catch (error: any) {
    const msg = error?.message || ''
    if (msg.includes('code_exists') || msg.includes('уже существует')) {
      formError.value = 'Промокод с таким кодом уже существует'
    } else {
      formError.value = msg || 'Не удалось сохранить промокод'
    }
  } finally {
    formSubmitting.value = false
  }
}

function clearValidityErrorsForPerpetual() {
  if (!form.value.is_perpetual) return
  validFromDateError.value = ''
  durationDaysError.value = ''
}

function showSuccess(message: string) {
  successMessage.value = message
  if (successTimer) clearTimeout(successTimer)
  successTimer = setTimeout(() => {
    successMessage.value = ''
    successTimer = null
  }, 3000)
}

async function handleDelete(promo: PromoCode) {
  const action = promo.current_uses > 0 ? 'деактивирован' : 'удален'
  if (!confirm(`Промокод ${promo.code} будет ${action}. Продолжить?`)) return

  try {
    await crmStore.deletePromoCode(promo.id)
  } catch (error: unknown) {
    // C1-BL: backend returns 409 in_use_by_wheel when the promo is
    // referenced from wheel_prizes or wheel_spins. Translate it to a
    // clear instruction so the manager doesn't keep retrying.
    const code = (error as { code?: string })?.code
    if (code === 'in_use_by_wheel') {
      alert(
        `Промокод ${promo.code} используется в рулетке призов. ` +
          'Удалить нельзя. Используй кнопку «Скрыть» — промокод останется ' +
          'в истории, но новые применения будут запрещены.',
      )
      return
    }
    const message =
      (error as { message?: string })?.message || 'Не удалось удалить промокод'
    alert(message)
  }
}

async function openUsageModal(promo: PromoCode) {
  usagePromo.value = promo
  usageList.value = []
  usageModalOpen.value = true
  usageLoading.value = true

  try {
    usageList.value = await crmStore.fetchPromoUsage(promo.id)
  } catch {
    usageList.value = []
  } finally {
    usageLoading.value = false
  }
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  form.value.code = code
}

function getStatusText(promo: PromoCode): string {
  if (!promo.active) return 'Неактивен'
  const nowBusinessDate = getCurrentBusinessDateString()
  if (promo.valid_from_date && nowBusinessDate < promo.valid_from_date) return 'Ожидает'
  if (promo.effective_valid_until_date && nowBusinessDate > promo.effective_valid_until_date) return 'Истек'
  const nowTs = Date.now()
  const validUntilTs = promo.valid_until ? safeDateTs(promo.valid_until) : null
  if (validUntilTs !== null && nowTs > validUntilTs) return 'Истек'
  if (promo.max_uses > 0 && promo.current_uses >= promo.max_uses) return 'Исчерпан'
  const validFromTs = promo.valid_from ? safeDateTs(promo.valid_from) : null
  if (validFromTs !== null && nowTs < validFromTs) return 'Ожидает'
  return 'Активен'
}

function getStatusClass(promo: PromoCode): string {
  const status = getStatusText(promo)
  switch (status) {
    case 'Активен': return 'bg-green-100 text-green-700'
    case 'Неактивен': return 'bg-slate-100 text-slate-500'
    case 'Истек': return 'bg-red-100 text-red-700'
    case 'Исчерпан': return 'bg-amber-100 text-amber-700'
    case 'Ожидает': return 'bg-blue-100 text-blue-700'
    default: return 'bg-slate-100 text-slate-500'
  }
}

function getUsageBarClass(promo: PromoCode): string {
  if (promo.max_uses <= 0) return 'bg-slate-300'
  const ratio = promo.current_uses / promo.max_uses
  if (ratio >= 1) return 'bg-red-400'
  if (ratio >= 0.75) return 'bg-amber-400'
  if (ratio >= 0.5) return 'bg-blue-400'
  return 'bg-green-400'
}

function isWheelTemplatePromo(promo: PromoCode): boolean {
  return Number(promo.is_wheel_template || 0) === 1
}

function isWheelRelatedPromo(promo: PromoCode): boolean {
  return isWheelTemplatePromo(promo)
    || Number(promo.is_wheel_generated || 0) === 1
    || Boolean(promo.wheel_owner_customer_id)
}

function getPromoPrimaryText(promo: PromoCode): string {
  if (isWheelTemplatePromo(promo)) {
    return promo.description || promo.customer_description || '-'
  }
  return promo.customer_description || promo.description || '-'
}

function getPromoSecondaryText(promo: PromoCode): string {
  if (!isWheelTemplatePromo(promo)) return ''
  const title = String(promo.description || '').trim()
  const customerText = String(promo.customer_description || '').trim()
  if (!title || !customerText || title === customerText) return ''
  return customerText
}

function getSourceBadgeClass(): string {
  return 'bg-indigo-100 text-indigo-700'
}

const emptyStateText = computed(() => {
  if (sourceFilter.value === 'regular') return 'Нет обычных промокодов'
  if (sourceFilter.value === 'wheel') return 'Нет промокодов рулетки'
  return 'Нет промокодов'
})

function formatDate(dateStr: string): string {
  try {
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
      ? `${dateStr}T00:00:00`
      : dateStr
    return new Date(normalized).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
  } catch {
    return dateStr
  }
}

const effectiveUntilHint = computed(() => {
  if (isEditingWheelTemplate.value) {
    const duration = Number(form.value.duration_days || 0)
    if (!Number.isInteger(duration) || duration <= 0) return ''
    return `Выданный промокод будет действовать ${duration} дн. со дня выигрыша.`
  }
  const startDate = form.value.valid_from_date
  if (!startDate) return ''
  if (form.value.is_perpetual) return 'Промокод будет действовать бессрочно.'
  const duration = Number(form.value.duration_days || 0)
  if (!Number.isFinite(duration) || duration <= 0) return ''
  const end = new Date(`${startDate}T00:00:00`)
  end.setDate(end.getDate() + duration - 1)
  const formatted = end.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
  return `Будет действовать до ${formatted} включительно.`
})

function getCurrentBusinessDateString(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Minsk',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const year = parts.find((p) => p.type === 'year')?.value || '1970'
  const month = parts.find((p) => p.type === 'month')?.value || '01'
  const day = parts.find((p) => p.type === 'day')?.value || '01'
  return `${year}-${month}-${day}`
}

function safeDateTs(value: string): number | null {
  const ts = Date.parse(value)
  return Number.isFinite(ts) ? ts : null
}

function formatDateTime(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return dateStr
  }
}
</script>
