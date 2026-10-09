<template>
  <div class="min-h-screen bg-gray-50 px-4 py-6 sm:px-6 lg:px-8">
    <div class="mx-auto w-full max-w-7xl space-y-6">
      <div
        v-if="userbotDisconnected"
        class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        role="status"
      >
        <span class="font-semibold">Автоуведомления отложены:</span>
        нет связи с Telegram. Отправим клиентам, когда канал восстановится.
      </div>
      <StaffShiftBar ref="staffShiftBarRef" />
      <div class="flex items-center justify-between gap-4">
        <div
          class="flex w-full flex-nowrap items-center justify-start gap-1.5 sm:gap-2 sm:w-auto sm:justify-end"
        >
          <!-- Обновить -->
          <CrmButton
            variant="secondary"
            size="sm"
            refresh-icon
            :loading="isRefreshing"
            loading-label="Обновляем..."
            @click="deferClick(() => refreshOrders())"
          >
            <span class="hidden sm:inline">Обновить</span>
          </CrmButton>

          <CrmButton
            variant="secondary"
            size="sm"
            @click="openCardPaymentsModal"
          >
            <span class="hidden sm:inline">Оплата картой и лимиты</span>
            <span class="sm:hidden">Карта</span>
          </CrmButton>

          <!-- Dropdown: Настройки -->
          <div class="relative" ref="settingsDropdownRef">
            <button
              type="button"
              @click.stop="settingsDropdownOpen = !settingsDropdownOpen"
              title="Настройки"
              class="inline-flex shrink-0 items-center gap-1 rounded-xl border px-2.5 py-2 text-sm font-medium transition-all duration-200"
              :class="
                hasActiveSettings
                  ? 'border-emerald-200 bg-gradient-to-r from-emerald-50 to-green-50 text-emerald-700 shadow-sm'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:border-gray-300'
              "
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <svg
                class="h-3 w-3 transition-transform duration-200"
                :class="{ 'rotate-180': settingsDropdownOpen }"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <Transition
              enter-active-class="transition ease-out duration-150"
              enter-from-class="transform opacity-0 scale-95 -translate-y-1"
              enter-to-class="transform opacity-100 scale-100 translate-y-0"
              leave-active-class="transition ease-in duration-100"
              leave-from-class="transform opacity-100 scale-100 translate-y-0"
              leave-to-class="transform opacity-0 scale-95 -translate-y-1"
            >
              <div
                v-if="settingsDropdownOpen"
                class="absolute left-0 z-[60] mt-2 w-80 origin-top-left rounded-2xl border border-slate-200/40 bg-white/95 p-3 shadow-2xl backdrop-blur-sm"
                @click.stop
              >
                <!-- Заголовок -->
                <div class="px-2 py-1.5 mb-2">
                  <h3 class="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">Уведомления</h3>
                </div>

                <!-- Автообновление -->
                <button
                  @click="crmStore.setAutoRefreshEnabled(!autoRefreshEnabled)"
                  class="flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-all duration-200 hover:-translate-y-0.5 focus:outline-none"
                  :class="autoRefreshEnabled
                    ? 'border-emerald-200/60 bg-gradient-to-br from-emerald-50/90 to-green-50/60 shadow-lg shadow-emerald-100/50'
                    : 'border-slate-200/40 bg-gradient-to-br from-slate-50/90 to-gray-50/60 hover:border-slate-300/50 hover:shadow-md'"
                >
                  <div class="flex items-center gap-3">
                    <span
                      class="flex h-9 w-9 items-center justify-center rounded-xl transition-all"
                      :class="autoRefreshEnabled ? 'bg-emerald-100/80 text-emerald-600 shadow-sm shadow-emerald-200/50' : 'bg-slate-100/80 text-slate-500'"
                    >
                      <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </span>
                    <div>
                      <div class="text-sm font-semibold text-slate-800">Автообновление</div>
                      <div class="text-xs text-slate-400">Каждые 15 секунд</div>
                    </div>
                  </div>
                  <div
                    class="relative h-6 w-11 rounded-full transition-colors duration-200"
                    :class="autoRefreshEnabled ? 'bg-emerald-500' : 'bg-slate-300'"
                  >
                    <div
                      class="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all duration-200"
                      :class="autoRefreshEnabled ? 'left-[22px]' : 'left-0.5'"
                    />
                  </div>
                </button>

                <!-- Уведомления -->
                <button
                  @click="crmStore.setNotificationsEnabled(!notificationsEnabled)"
                  :disabled="!notificationsSupported || notificationPermissionDenied"
                  class="mt-2 flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-all duration-200 hover:-translate-y-0.5 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
                  :class="notificationsEnabled
                    ? 'border-sky-200/60 bg-gradient-to-br from-sky-50/90 to-blue-50/60 shadow-lg shadow-sky-100/50'
                    : 'border-slate-200/40 bg-gradient-to-br from-slate-50/90 to-gray-50/60 hover:border-slate-300/50 hover:shadow-md'"
                >
                  <div class="flex items-center gap-3">
                    <span
                      class="flex h-9 w-9 items-center justify-center rounded-xl transition-all"
                      :class="notificationsEnabled ? 'bg-sky-100/80 text-sky-600 shadow-sm shadow-sky-200/50' : 'bg-slate-100/80 text-slate-500'"
                    >
                      <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                      </svg>
                    </span>
                    <div>
                      <div class="text-sm font-semibold text-slate-800">Push-уведомления</div>
                      <div class="text-xs text-slate-400">Браузерные оповещения</div>
                    </div>
                  </div>
                  <div
                    class="relative h-6 w-11 rounded-full transition-colors duration-200"
                    :class="notificationsEnabled ? 'bg-sky-500' : 'bg-slate-300'"
                  >
                    <div
                      class="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all duration-200"
                      :class="notificationsEnabled ? 'left-[22px]' : 'left-0.5'"
                    />
                  </div>
                </button>

                <!-- Звук -->
                <button
                  @click="crmStore.setSoundEnabled(!soundEnabled)"
                  class="mt-2 flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-all duration-200 hover:-translate-y-0.5 focus:outline-none"
                  :class="soundEnabled
                    ? 'border-purple-200/60 bg-gradient-to-br from-purple-50/90 to-violet-50/60 shadow-lg shadow-purple-100/50'
                    : 'border-slate-200/40 bg-gradient-to-br from-slate-50/90 to-gray-50/60 hover:border-slate-300/50 hover:shadow-md'"
                >
                  <div class="flex items-center gap-3">
                    <span
                      class="flex h-9 w-9 items-center justify-center rounded-xl transition-all"
                      :class="soundEnabled ? 'bg-purple-100/80 text-purple-600 shadow-sm shadow-purple-200/50' : 'bg-slate-100/80 text-slate-500'"
                    >
                      <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                      </svg>
                    </span>
                    <div>
                      <div class="text-sm font-semibold text-slate-800">Звук</div>
                      <div class="text-xs text-slate-400">При новом заказе</div>
                    </div>
                  </div>
                  <div
                    class="relative h-6 w-11 rounded-full transition-colors duration-200"
                    :class="soundEnabled ? 'bg-purple-500' : 'bg-slate-300'"
                  >
                    <div
                      class="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all duration-200"
                      :class="soundEnabled ? 'left-[22px]' : 'left-0.5'"
                    />
                  </div>
                </button>

                <!-- Разрешить уведомления (если нужно) -->
                <template v-if="notificationPermissionStatus === 'default'">
                  <div class="my-3 border-t border-slate-100"></div>
                  <button
                    @click="requestNotificationPermission"
                    class="flex w-full items-center gap-3 rounded-xl border border-orange-200/60 bg-gradient-to-br from-orange-50/90 to-amber-50/60 px-3 py-2.5 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus:outline-none"
                  >
                    <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-100/80 text-orange-500 shadow-sm shadow-orange-200/50">
                      <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                      </svg>
                    </span>
                    <div>
                      <div class="text-sm font-semibold text-orange-700">Разрешить уведомления</div>
                      <div class="text-xs text-orange-500/80">Требуется разрешение браузера</div>
                    </div>
                  </button>
                </template>

                <!-- Статус уведомлений если заблокированы -->
                <template v-if="notificationPermissionStatus === 'denied'">
                  <div class="my-3 border-t border-slate-100"></div>
                  <div class="flex items-center gap-3 rounded-xl border border-red-200/60 bg-gradient-to-br from-red-50/90 to-rose-50/60 px-3 py-2.5">
                    <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-red-100/80 text-red-500">
                      <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                      </svg>
                    </span>
                    <div class="text-xs font-medium text-red-600">
                      Уведомления заблокированы в браузере
                    </div>
                  </div>
                </template>
              </div>
            </Transition>
          </div>

          <!-- Dropdown: Ещё -->
          <div class="relative" ref="moreDropdownRef">
            <button
              type="button"
              @click.stop="moreDropdownOpen = !moreDropdownOpen"
              class="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-slate-200/40 bg-gradient-to-br from-slate-50/90 to-gray-50/60 px-3 py-2 text-sm font-medium text-slate-600 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300/50 hover:shadow-md"
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" />
              </svg>
              <span class="hidden sm:inline">Ещё</span>
            </button>
            <Transition
              enter-active-class="transition ease-out duration-150"
              enter-from-class="transform opacity-0 scale-95 -translate-y-1"
              enter-to-class="transform opacity-100 scale-100 translate-y-0"
              leave-active-class="transition ease-in duration-100"
              leave-from-class="transform opacity-100 scale-100 translate-y-0"
              leave-to-class="transform opacity-0 scale-95 -translate-y-1"
            >
              <div
                v-if="moreDropdownOpen"
                class="absolute left-0 z-[60] mt-2 w-72 origin-top-left rounded-2xl border border-slate-200/40 bg-white/95 p-3 shadow-2xl backdrop-blur-sm"
                @click.stop
              >
                <!-- Заголовок -->
                <div class="px-2 py-1.5 mb-2">
                  <h3 class="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">Дополнительно</h3>
                </div>

                <button
                  @click="$router.push('/admin/crm/message-templates'); moreDropdownOpen = false"
                  class="flex w-full items-center gap-3 rounded-xl border border-slate-200/40 bg-gradient-to-br from-slate-50/90 to-gray-50/60 px-3 py-2.5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300/50 hover:shadow-md focus:outline-none"
                >
                  <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-100/80 text-blue-500 shadow-sm shadow-blue-200/50">
                    <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </span>
                  <div>
                    <div class="text-sm font-semibold text-slate-800">Шаблоны сообщений</div>
                    <div class="text-xs text-slate-400">Готовые ответы клиентам</div>
                  </div>
                </button>

                <button
                  @click="$router.push('/admin/crm/orders/archive'); moreDropdownOpen = false"
                  class="mt-2 flex w-full items-center gap-3 rounded-xl border border-slate-200/40 bg-gradient-to-br from-slate-50/90 to-gray-50/60 px-3 py-2.5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300/50 hover:shadow-md focus:outline-none"
                >
                  <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100/80 text-amber-500 shadow-sm shadow-amber-200/50">
                    <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                    </svg>
                  </span>
                  <div>
                    <div class="text-sm font-semibold text-slate-800">Архив заказов</div>
                    <div class="text-xs text-slate-400">Старые и завершенные</div>
                  </div>
                </button>
              </div>
            </Transition>
          </div>

          <!-- Отмененные -->
          <button
            v-if="cancelledOrders.length"
            @click="cancelledModalOpen = true"
            class="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-red-200 bg-gradient-to-r from-red-50 to-rose-50 px-3 py-2 text-sm font-medium text-red-600 shadow-sm transition-all duration-200 hover:from-red-100 hover:to-rose-100"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
            <span class="hidden sm:inline">Отмененные</span>
          </button>

          <!-- Выданные (запаролено) -->
          <button
            @click="profitUnlocked ? openDeliveredModal('today') : openPasswordModal()"
            class="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-green-50 px-3 py-2 text-sm font-medium text-emerald-600 shadow-sm transition-all duration-200 hover:from-emerald-100 hover:to-green-100"
          >
            <LockClosedIcon v-if="!profitUnlocked" class="h-4 w-4" />
            <svg v-else class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
            <span class="hidden sm:inline">Выданные</span>
          </button>

          <!-- Создать заказ -->
          <button
            @click="showCreateModal = true"
            class="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-md transition-all duration-200 hover:from-blue-700 hover:to-indigo-700 hover:shadow-lg sm:px-4"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            <span class="hidden sm:inline">Создать заказ</span>
            <span class="sm:hidden">Заказ</span>
          </button>

          <!-- Заметка на клиента -->
          <button
            @click="openNoteModal()"
            class="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-700 shadow-sm transition-all duration-200 hover:bg-sky-100"
            title="Заметка на клиента по @username"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 8h10M7 12h6m-6 8l-2 4 4-2h8a2 2 0 002-2V6a2 2 0 00-2-2H7a2 2 0 00-2 2v12z" />
            </svg>
            <span class="hidden sm:inline">Заметка на клиента</span>
          </button>

          <!-- Заблокировать клиента -->
          <button
            @click="openBlockModal()"
            class="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-600 shadow-sm transition-all duration-200 hover:bg-red-100"
            title="Заблокировать клиента по @username"
          >
            <NoSymbolIcon class="h-4 w-4" />
            <span class="hidden sm:inline">Заблокировать</span>
          </button>
        </div>
      </div>

      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <h1 class="text-2xl font-bold text-gray-900 sm:text-3xl shrink-0">Заказы</h1>
        <div class="relative min-w-0 flex-1">
          <input
            v-model="searchQuery"
            type="search"
            placeholder="Ячейка 7, заказ #10456 или клиент..."
            class="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            @input="handleSearch"
          />
          <svg
            v-if="!searchQuery"
            class="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
        <button
          type="button"
          class="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100"
          :aria-label="pickupCellsLoaded
            ? `Ячейки: занято ${pickupCells.occupied} из ${pickupCells.capacity}`
            : loadingPickupCells ? 'Ячейки: загружаются' : 'Ячейки: данные недоступны'"
          @click="openPickupCellsModal"
        >
          <span>Ячейки</span>
          <span v-if="pickupCellsLoaded">{{ pickupCells.occupied }}/{{ pickupCells.capacity }}</span>
          <span v-else-if="loadingPickupCells">…/…</span>
          <span v-else>—/—</span>
        </button>
      </div>

      <!-- Розыгрыш отзывов: плашка для менеджеров на доске заказов -->
      <Transition
        enter-active-class="transition ease-out duration-200"
        enter-from-class="opacity-0 -translate-y-2"
        enter-to-class="opacity-100 translate-y-0"
        leave-active-class="transition ease-in duration-150"
        leave-from-class="opacity-100 translate-y-0"
        leave-to-class="opacity-0 -translate-y-2"
      >
        <div
          v-if="crmStore.hasUnseenDraw && crmStore.latestMonthlyDraw"
          class="rounded-xl border border-violet-200 bg-gradient-to-r from-violet-50 to-fuchsia-50 p-4 shadow-sm"
        >
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex items-start gap-3">
              <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-600">
                <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.802 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.802-2.034a1 1 0 00-1.175 0l-2.802 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.88 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
              </span>
              <div>
                <p class="font-semibold text-violet-900">
                  Розыгрыш за {{ drawPeriodLabel }}
                </p>
                <p class="mt-1 text-sm text-violet-800/90">
                  {{ drawWinnerCountLabel }}
                </p>
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <button
                type="button"
                class="rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700"
                @click="openReviews"
              >
                Список победителей
              </button>
              <button
                type="button"
                class="rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm font-medium text-violet-700 transition-colors hover:bg-violet-50"
                @click="crmStore.markDrawAsSeen()"
              >
                Понятно
              </button>
            </div>
          </div>
        </div>
      </Transition>

      <!-- Error banner -->
      <Transition
        enter-active-class="transition ease-out duration-200"
        enter-from-class="opacity-0 -translate-y-2"
        enter-to-class="opacity-100 translate-y-0"
        leave-active-class="transition ease-in duration-150"
        leave-from-class="opacity-100 translate-y-0"
        leave-to-class="opacity-0 -translate-y-2"
      >
        <div
          v-if="orderToast"
          :class="[
            'rounded-lg border p-4 shadow-sm',
            orderToast.kind === 'success'
              ? 'border-emerald-200 bg-emerald-50'
              : orderToast.kind === 'info'
                ? 'border-blue-200 bg-blue-50'
                : 'border-red-200 bg-red-50',
          ]"
        >
          <div class="flex items-start gap-3">
            <!-- Иконка под цвет: чек для success, info-точка для info, восклицательный для error -->
            <svg
              v-if="orderToast.kind === 'success'"
              class="h-5 w-5 flex-shrink-0 text-emerald-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
            <svg
              v-else-if="orderToast.kind === 'info'"
              class="h-5 w-5 flex-shrink-0 text-blue-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <svg
              v-else
              class="h-5 w-5 flex-shrink-0 text-red-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <div class="flex-1 space-y-2">
              <p
                :class="[
                  'text-sm font-medium',
                  orderToast.kind === 'success'
                    ? 'text-emerald-800'
                    : orderToast.kind === 'info'
                      ? 'text-blue-800'
                      : 'text-red-800',
                ]"
              >{{ orderToast.message }}</p>
              <a
                v-if="orderToast.action"
                :href="orderToast.action.url"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-1 text-sm font-semibold underline transition"
                :class="orderToast.kind === 'error' ? 'text-red-700 hover:text-red-800' : 'text-blue-700 hover:text-blue-800'"
              >{{ orderToast.action.label }}</a>
              <button
                v-if="orderToast.copyable"
                @click="copyToastValue(orderToast.copyable.value)"
                class="inline-flex items-center gap-1 text-sm font-semibold underline transition"
                :class="orderToast.kind === 'error' ? 'text-red-700 hover:text-red-800' : 'text-blue-700 hover:text-blue-800'"
              >{{ orderToast.copyable.label }}</button>
            </div>
            <button
              @click="dismissOrderToast"
              :class="[
                'inline-flex h-6 w-6 items-center justify-center rounded-full transition',
                orderToast.kind === 'success'
                  ? 'text-emerald-500 hover:bg-emerald-100'
                  : orderToast.kind === 'info'
                    ? 'text-blue-500 hover:bg-blue-100'
                    : 'text-red-500 hover:bg-red-100',
              ]"
            >
              <svg
                class="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
      </Transition>

      <div
        v-if="loadingOrders"
        class="flex min-h-[420px] items-center justify-center rounded-xl border border-dashed border-blue-200 bg-white"
      >
        <div class="flex flex-col items-center gap-4">
          <div
            class="h-12 w-12 animate-spin rounded-full border-4 border-blue-600 border-r-transparent"
          ></div>
          <p class="text-sm text-gray-500">Загружаем заказы...</p>
        </div>
      </div>

      <div v-else class="space-y-6">
        <div class="grid gap-4 lg:grid-cols-3">
          <section
            v-for="column in kanbanColumns"
            :key="column.key"
            class="flex h-full flex-col rounded-xl border border-gray-200 bg-white shadow-sm"
          >
            <header class="border-b border-gray-100 px-5 py-4">
              <div class="flex items-center justify-between">
                <div>
                  <div class="flex items-center gap-2">
                    <h2 class="text-lg font-semibold text-gray-900">
                      {{ column.label }}
                    </h2>
                  </div>
                  <p class="text-xs text-gray-500">{{ column.description }}</p>
                </div>
                <div class="flex items-center gap-2">
                  <span
                    :class="[
                      'rounded-full px-2 py-1 text-xs font-semibold',
                      column.badgeClass,
                    ]"
                  >
                    {{ column.orders.length }}
                  </span>
                  <span
                    v-if="column.key === 'new' && unseenOrdersCount > 0"
                    class="inline-flex items-center rounded-full bg-red-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-red-700"
                  >
                    +{{ unseenOrdersCount }}
                  </span>
                  <span
                    v-if="column.key === 'action_required' && crmStore.actionRequiredCount > 0"
                    class="inline-flex items-center rounded-full bg-orange-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-orange-700"
                  >
                    +{{ crmStore.actionRequiredCount }}
                  </span>
                </div>
              </div>
            </header>
            <div
              class="flex-1 space-y-3 overflow-y-auto px-4 py-4 transition"
              :class="[
                activeDropColumn === column.key
                  ? 'bg-blue-50/60 ring-2 ring-blue-300 ring-offset-2'
                  : '',
              ]"
              @dragover.prevent="onDragOver(column.key)"
              @dragenter.prevent="onDragOver(column.key)"
              @dragleave.prevent="onDragLeave(column.key)"
              @drop.prevent="onDrop(column.key)"
            >
              <p
                v-if="column.orders.length === 0"
                class="rounded-lg border border-dashed border-gray-200 px-3 py-8 text-center text-sm text-gray-400"
              >
                Нет заказов в этом статусе
              </p>

              <article
                v-for="order in column.orders"
                :key="order.id"
                class="cursor-grab rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:shadow-md active:cursor-grabbing"
                :class="[
                  order.delivery_type === 'delivery'
                    ? 'border-rose-200 ring-1 ring-rose-100'
                    : '',
                  unseenOrderIds.has(order.id)
                    ? 'ring-2 ring-amber-400 border-amber-300 bg-amber-50/50'
                    : '',
                  unseenOrderIds.has(order.id) && newOrderHighlight
                    ? 'animate-pulse'
                    : '',
                  order.needs_manager_action && order.manager_action_type === 'cancelled_by_customer'
                    ? 'ring-2 ring-red-400 border-red-300 bg-red-50/30'
                    : '',
                  order.needs_manager_action && order.manager_action_type === 'modified'
                    ? 'ring-2 ring-orange-400 border-orange-300 bg-orange-50/30'
                    : '',
                  order.auto_notification?.status === 'pending_retry' && !order.needs_manager_action
                    ? 'ring-2 ring-amber-300 border-amber-200 bg-amber-50/40'
                    : '',
                  order.auto_notification?.status === 'failed' && !order.needs_manager_action
                    ? 'ring-2 ring-red-400 border-red-300 bg-red-50/30'
                    : '',
                ]"
                :draggable="!order.needs_manager_action && updatingOrderId !== order.id"
                @dragstart="onDragStart(order)"
                @dragend="onDragEnd"
              >
                <!-- Заголовок с номером и бейджами -->
                <div class="flex items-center justify-between">
                  <div class="flex min-w-0 flex-wrap items-center gap-2 text-sm font-semibold text-gray-900">
                    <div v-if="order.pickup_cell_number" class="flex items-baseline gap-2">
                      <span class="text-lg font-black text-gray-950">
                        {{ order.pickup_cell_number }} ЯЧЕЙКА
                      </span>
                      <span class="font-medium text-gray-400">#{{ order.order_number }}</span>
                    </div>
                    <div v-else class="flex items-center gap-2">
                      <span>#{{ order.order_number }}</span>
                      <span
                        v-if="order.status === 'in_progress'"
                        class="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800"
                      >Без ячейки · старый заказ</span>
                    </div>
                    <span
                      v-if="order.needs_manager_action && order.manager_action_type === 'modified'"
                      class="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700"
                    >Изменен покупателем</span>
                    <span
                      v-else-if="order.needs_manager_action && order.manager_action_type === 'cancelled_by_customer'"
                      class="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700"
                    >Отменен покупателем</span>
                    <span
                      v-else-if="order.auto_notification?.status === 'pending_retry'"
                      class="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800"
                      :title="order.auto_notification?.error || 'Нет связи с Telegram, уведомление в очереди'"
                    >Отложено</span>
                    <span
                      v-else-if="order.auto_notification?.status === 'failed'"
                      class="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700"
                      :title="order.auto_notification?.error || 'Уведомление клиенту не доставлено'"
                    >Не дошло клиенту</span>
                    <span
                      v-else-if="order.auto_notification?.warn"
                      class="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700"
                      :title="order.auto_notification?.warn"
                    >Могло не дойти</span>
                    <span
                      v-if="order.payment_type === 'card'"
                      class="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-violet-800 ring-1 ring-violet-200"
                      title="Заказ оформлен с оплатой картой"
                    >💳 Оплата картой</span>
                  </div>
                  <!-- Кнопка отмены (не показываем для action_required) -->
                  <button
                    v-if="!order.needs_manager_action"
                    @click.stop="openCancelModal(order)"
                    class="group flex h-7 w-7 items-center justify-center rounded-lg border border-transparent text-gray-400 transition-all hover:border-red-200 hover:bg-red-50 hover:text-red-500"
                    title="Отменить заказ"
                  >
                    <svg class="h-4 w-4 transition-transform group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>

                <div class="mt-2 space-y-1 text-sm text-gray-700">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2 font-medium">
                      <span
                        v-if="order.telegram_username"
                        class="cursor-pointer hover:text-red-500 transition-colors"
                        @click.stop="openBlockModal(order.telegram_username)"
                        :title="'Заблокировать ' + order.telegram_username"
                      >{{ order.customer_name || "Без имени" }}</span>
                      <span v-else>{{ order.customer_name || "Без имени" }}</span>
                      <span
                        v-if="order.customer_card_payment_enabled"
                        class="text-[10px] font-medium text-emerald-600"
                      >разрешена карта</span>
                      <span v-if="order.is_blocked"
                        class="rounded-full bg-red-200 px-2 py-0.5 text-[10px] font-semibold text-red-800"
                        title="Клиент заблокирован. Сообщения не отправляются."
                      >Заблокирован</span>
                      <span v-else-if="order.is_returning_customer !== undefined"
                        :class="[
                          'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                          order.is_returning_customer
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-red-100 text-red-700'
                        ]"
                        :title="order.is_returning_customer ? 'У клиента уже были завершённые заказы' : 'Первый заказ клиента - обратить внимание'"
                      >{{ order.is_returning_customer ? 'Постоянный' : 'Первый заказ' }}</span>
                      <button
                        v-if="order.customer_id"
                        type="button"
                        class="inline-flex items-center justify-center rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-blue-700 transition hover:bg-blue-100"
                        title="Заметка о клиенте"
                        @click.stop="openNoteModalForOrder(order)"
                      >
                        <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                    </div>
                    <button
                      v-if="order.telegram_username"
                      @click.stop="contactClient(order.id)"
                      :disabled="generatingMessageForOrder === order.id"
                      class="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <svg
                        v-if="generatingMessageForOrder === order.id"
                        class="h-3 w-3 animate-spin"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                        />
                      </svg>
                      <svg
                        v-else
                        class="h-3 w-3"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                        />
                      </svg>
                      <span>{{
                        generatingMessageForOrder === order.id
                          ? "Генерируем…"
                          : "Написать"
                      }}</span>
                    </button>
                  </div>
                  <div
                    v-if="order.referral?.inviter_username"
                    class="relative flex min-h-5 min-w-0 items-center gap-1 text-[11px] leading-5"
                    data-inviter-menu
                  >
                    <span class="shrink-0 font-medium text-slate-500">Пригласивший:</span>
                    <button
                      :id="`inviter-trigger-${order.id}`"
                      type="button"
                      class="inviter-trigger group inline-flex min-w-0 items-center gap-0.5 font-semibold text-blue-600 underline decoration-blue-200 decoration-1 underline-offset-2 outline-none transition-colors hover:text-blue-800 hover:decoration-blue-500 focus-visible:text-blue-800 focus-visible:decoration-blue-600"
                      :aria-expanded="activeInviterMenuOrderId === order.id"
                      aria-haspopup="menu"
                      :aria-controls="`inviter-menu-${order.id}`"
                      :aria-label="`Действия с пригласившим @${order.referral.inviter_username}`"
                      :title="`@${order.referral.inviter_username}`"
                      @click.stop="toggleInviterMenu(order.id, $event)"
                    >
                      <span class="truncate">@{{ order.referral.inviter_username }}</span>
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        class="h-3 w-3 text-blue-400 transition-transform duration-150 group-hover:text-blue-600"
                        :class="activeInviterMenuOrderId === order.id ? 'rotate-180' : ''"
                      >
                        <path fill-rule="evenodd" d="M5.22 7.22a.75.75 0 0 1 1.06 0L10 10.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 8.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
                      </svg>
                    </button>
                    <Teleport to="body">
                      <Transition
                        enter-active-class="transition duration-150 ease-out"
                        enter-from-class="translate-y-1 scale-[0.98] opacity-0"
                        enter-to-class="translate-y-0 scale-100 opacity-100"
                        leave-active-class="transition duration-100 ease-in"
                        leave-from-class="translate-y-0 scale-100 opacity-100"
                        leave-to-class="translate-y-1 scale-[0.98] opacity-0"
                      >
                        <div
                          v-if="activeInviterMenuOrderId === order.id"
                          :id="`inviter-menu-${order.id}`"
                          role="menu"
                          data-inviter-menu
                          :aria-label="`Действия с пригласившим @${order.referral.inviter_username}`"
                          :style="{ top: `${inviterMenuPosition.top}px`, left: `${inviterMenuPosition.left}px` }"
                          class="fixed z-[100] flex w-60 origin-top-left flex-col rounded-xl border border-slate-200/80 bg-white p-1.5 text-xs shadow-xl shadow-slate-900/10"
                          @click.stop
                          @focusout="handleInviterMenuFocusOut(order.id, $event)"
                          @keydown="handleInviterMenuKeydown(order.id, $event)"
                        >
                          <button role="menuitem" class="min-h-9 cursor-pointer rounded-lg border-0 bg-transparent px-2.5 py-2 text-left font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline-none" @click="copyInviter(order, $event)">Скопировать</button>
                          <button role="menuitem" class="min-h-9 cursor-pointer rounded-lg border-0 bg-transparent px-2.5 py-2 text-left font-medium text-slate-700 transition-colors hover:bg-blue-50 hover:text-blue-700 focus-visible:bg-blue-50 focus-visible:text-blue-700 focus-visible:outline-none" @click="openInviterMessage(order)">Написать пригласившему</button>
                          <div class="my-1 h-px bg-slate-100" aria-hidden="true"></div>
                          <button role="menuitem" class="min-h-9 cursor-pointer rounded-lg border-0 bg-transparent px-2.5 py-2 text-left font-medium text-slate-600 transition-colors hover:bg-red-50 hover:text-red-700 focus-visible:bg-red-50 focus-visible:text-red-700 focus-visible:outline-none" @click="openInviterBlockModal(order)">Заблокировать пригласившего</button>
                          <button
                            v-if="!order.referral.inviter_is_invite_banned"
                            role="menuitem"
                            class="min-h-9 cursor-pointer rounded-lg border-0 bg-transparent px-2.5 py-2 text-left font-medium text-slate-600 transition-colors hover:bg-red-50 hover:text-red-700 focus-visible:bg-red-50 focus-visible:text-red-700 focus-visible:outline-none"
                            @click="openInviteBanModal(order)"
                          >Запретить приглашать</button>
                          <button
                            v-else
                            role="menuitem"
                            class="min-h-9 cursor-pointer rounded-lg border-0 bg-transparent px-2.5 py-2 text-left font-medium text-slate-600 transition-colors hover:bg-emerald-50 hover:text-emerald-700 focus-visible:bg-emerald-50 focus-visible:text-emerald-700 focus-visible:outline-none disabled:cursor-default disabled:opacity-50"
                            :disabled="removingInviterBanId === order.referral.inviter_invite_ban_id"
                            @click="removeInviterBan(order)"
                          >{{ removingInviterBanId === order.referral.inviter_invite_ban_id ? 'Снимаем…' : 'Разрешить приглашать' }}</button>
                        </div>
                      </Transition>
                    </Teleport>
                  </div>
                  <div
                    v-else-if="order.access_authorization?.access_authorization_source === 'staff'"
                    class="flex min-h-5 items-center gap-1 text-[11px] leading-5"
                  >
                    <span class="font-medium text-slate-500">Доступ:</span>
                    <span class="font-semibold text-emerald-700">разрешён администратором</span>
                  </div>
                  <div
                    v-if="order.auto_notification?.status === 'pending_retry'"
                    class="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] font-medium text-amber-800"
                    :title="order.auto_notification?.error || ''"
                  >
                    Отправим клиенту, когда восстановится связь с Telegram
                  </div>
                  <!-- Авто-уведомление клиенту не дошло. Менеджер должен
                       написать вручную через кнопку «Написать» выше. -->
                  <div
                    v-else-if="order.auto_notification?.status === 'failed'"
                    class="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] font-medium text-red-700"
                    :title="order.auto_notification?.error || ''"
                  >
                    Не удалось отправить сообщение клиенту
                  </div>
                  <div
                    v-if="order.customer_notes"
                    class="flex items-start gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-2 py-1.5 text-[11px] font-medium text-sky-900"
                  >
                    <svg class="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-sky-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 8h10M7 12h6m-6 8l-2 4 4-2h8a2 2 0 002-2V6a2 2 0 00-2-2H7a2 2 0 00-2 2v12z" />
                    </svg>
                    <span class="leading-snug">{{ order.customer_notes }}</span>
                  </div>
                  <div
                    v-if="
                      order.delivery_type === 'delivery' &&
                      order.delivery_address
                    "
                    class="flex items-start gap-1 text-xs font-medium text-rose-600"
                  >
                    <svg
                      class="mt-0.5 h-4 w-4 flex-shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M12 11c1.66 0 3-1.34 3-3S13.66 5 12 5s-3 1.34-3 3 1.34 3 3 3z"
                      />
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M12 22s8-4.438 8-11a8 8 0 10-16 0c0 6.562 8 11 8 11z"
                      />
                    </svg>
                    <span class="leading-snug">{{
                      order.delivery_address
                    }}</span>
                  </div>
                  <p v-if="order.notes" class="text-xs text-gray-500">
                    {{ order.notes }}
                  </p>
                </div>

                <ol
                  v-if="order.items?.length"
                  class="mt-3 space-y-1 text-xs text-gray-600"
                >
                  <li v-for="(item, index) in previewItems(order)" :key="item.id" class="flex gap-1.5">
                    <span class="flex-shrink-0 font-medium text-gray-400">{{ index + 1 }}.</span>
                    <div class="flex-1">
                      <div>
                        <span
                          v-if="item.group_name"
                          class="font-semibold text-blue-600"
                        >{{ item.group_name }}</span
                        >{{ item.group_name ? " - " : ""
                        }}{{ item.base_product_title || item.product_title
                        }}{{ item.variant_name ? " - " + item.variant_name : "" }}
                        <span
                          v-if="catalogDiscountPerUnit(item) > 0"
                          class="ml-1 inline-flex items-center rounded px-1 py-px align-middle text-[10px] font-bold uppercase tracking-wide text-white"
                          style="background: linear-gradient(106.76deg, #f50302 -2.64%, #a90f0e 85.78%)"
                          :title="discountHint(item)"
                          data-test="order-item-discount"
                        >Скидка</span>
                        <span class="font-medium text-gray-800">× {{ item.quantity }}</span>
                      </div>
                      <div v-if="item.product_description" class="text-[11px] text-gray-400 leading-tight">
                        {{ item.product_description }}
                      </div>
                    </div>
                  </li>
                  <li
                    v-if="
                      hiddenItemsCount(order) > 0 && !isOrderExpanded(order.id)
                    "
                  >
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 hover:underline transition-colors"
                      @click.stop="toggleOrderExpanded(order.id)"
                    >
                      <svg
                        class="h-3 w-3"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M19 9l-7 7-7-7"
                        />
                      </svg>
                      и ещё {{ hiddenItemsCount(order) }}
                      {{ pluralizePositions(hiddenItemsCount(order)) }}
                    </button>
                  </li>
                  <li
                    v-if="
                      isOrderExpanded(order.id) &&
                      order.items.length > previewLimit
                    "
                  >
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-700 hover:underline transition-colors"
                      @click.stop="toggleOrderExpanded(order.id)"
                    >
                      <svg
                        class="h-3 w-3 rotate-180"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M19 9l-7 7-7-7"
                        />
                      </svg>
                      свернуть
                    </button>
                  </li>
                </ol>

                <div class="mt-4 space-y-3">
                  <!-- Примечание об изменениях (для action_required) -->
                  <div
                    v-if="order.needs_manager_action && order.manager_action_note"
                    class="rounded-xl bg-slate-50/90 px-3 py-2.5 ring-1 ring-inset ring-slate-100"
                  >
                    <ManagerActionSummary
                      :note="order.manager_action_note"
                      :items="order.items"
                      size="xs"
                    />
                  </div>
                  <!-- Сумма и скидка -->
                  <div>
                    <div
                      @click.stop="openDiscountModal(order)"
                      class="group inline-flex cursor-pointer items-center gap-1.5 text-base font-semibold text-gray-900 transition-colors hover:text-emerald-600"
                      title="Нажмите для скидки"
                    >
                      <span
                        v-if="getOrderTotalDiscount(order) > 0"
                        class="text-sm text-gray-400 line-through"
                      >{{ formatCurrency(order.total_amount) }}</span>
                      <span>{{ formatCurrency(order.final_amount) }}</span>
                      <svg class="h-3.5 w-3.5 flex-shrink-0 text-gray-400 group-hover:text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </div>
                    <div
                      v-if="getOrderTotalDiscount(order) > 0"
                      class="mt-1 space-y-0.5 text-xs"
                    >
                      <div
                        v-if="getOrderOrderLevelDiscount(order) > 0"
                        class="flex items-center gap-1 text-emerald-600"
                      >
                        <span class="text-gray-500">На заказ:</span>
                        <span class="font-medium">-{{ formatCurrency(getOrderOrderLevelDiscount(order)) }}</span>
                      </div>
                      <div
                        v-if="getOrderLoyaltyDiscount(order) > 0"
                        class="flex items-center gap-1 text-emerald-600"
                      >
                        <span class="text-gray-500">За покупки:</span>
                        <span class="font-medium">-{{ formatCurrency(getOrderLoyaltyDiscount(order)) }}</span>
                      </div>
                    </div>
                    <span
                      v-if="order.promo_code_text"
                      class="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700"
                    >ПРОМО: {{ order.promo_code_text }}</span>
                    <span
                      v-if="order.promo_has_gift"
                      class="ml-1 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700"
                    >
                      Подарок по промокоду
                    </span>
                    <span
                      v-if="order.is_wholesale"
                      class="ml-1 inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700"
                    >
                      ОПТ{{ order.wholesale_tier_label ? `: ${order.wholesale_tier_label}` : '' }}
                    </span>
                    <div
                      v-if="order.promo_manager_description"
                      :title="order.promo_manager_description"
                      class="mt-1.5 flex gap-1.5 rounded-md border border-amber-200/85 bg-amber-50/90 px-2 py-1.5"
                    >
                      <svg
                        class="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                        />
                      </svg>
                      <div class="min-w-0 flex-1">
                        <p class="text-[10px] font-semibold leading-none text-amber-900/80">
                          К заказу (промо)
                        </p>
                        <p class="mt-1 text-[11px] leading-snug text-amber-900/90">
                          {{ order.promo_manager_description }}
                        </p>
                      </div>
                    </div>
                    <p
                      v-if="order.is_wholesale && order.wholesale_min_amount"
                      class="mt-1 text-[11px] text-violet-700"
                    >
                      Минимальный заказ: {{ formatCurrency(order.wholesale_min_amount) }}
                    </p>
                    <div class="text-[11px] text-gray-400">
                      {{ formatDate(order.created_at) }}
                    </div>
                  </div>
                  <!-- Кнопки resolve для action_required -->
                  <div v-if="order.needs_manager_action" class="flex items-center justify-end gap-2">
                    <button
                      @click.stop="viewOrder(order.id)"
                      class="admin-link-button admin-link-button--compact admin-link-button--muted"
                    >
                      Подробнее
                    </button>
                    <button
                      v-if="order.manager_action_type === 'modified'"
                      @click.stop="deferClick(() => { void handleResolveAction(order) })"
                      :disabled="resolvingOrderId === order.id"
                      class="admin-link-button admin-link-button--compact bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-60"
                    >
                      {{ resolvingOrderId === order.id ? 'Обработка...' : 'Принять изменения' }}
                    </button>
                    <button
                      v-else-if="order.manager_action_type === 'cancelled_by_customer'"
                      @click.stop="deferClick(() => { void handleResolveAction(order) })"
                      :disabled="resolvingOrderId === order.id"
                      class="admin-link-button admin-link-button--compact bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
                    >
                      {{ resolvingOrderId === order.id ? 'Обработка...' : 'Разобрать' }}
                    </button>
                  </div>
                  <!-- Обычные кнопки -->
                  <div v-else class="flex items-center justify-end gap-2">
                    <button
                      @click.stop="viewOrder(order.id)"
                      class="admin-link-button admin-link-button--compact admin-link-button--muted"
                    >
                      Подробнее
                    </button>
                    <button
                      v-if="canAdvance(order)"
                      @click.stop="deferClick(() => { void advanceOrder(order) })"
                      :disabled="updatingOrderId === order.id"
                      class="admin-link-button admin-link-button--compact"
                      :class="advanceButtonClass(order)"
                    >
                      {{ updatingOrderId === order.id ? 'Назначаем ячейку...' : nextStatusLabel(order.status) }}
                    </button>
                  </div>
                </div>
              </article>
            </div>
          </section>
        </div>
      </div>
    </div>

    <!-- Оплата и выдача -->
    <AdminModal
      :isOpen="paymentModalOpen && !!paymentOrder"
      :title="
        paymentOrder
          ? `Выдача заказа #${paymentOrder.order_number}`
          : 'Выдача заказа'
      "
      description="Выберите тип оплаты и кассу"
      size="md"
      :showActions="false"
      @close="closePaymentModal"
      @cancel="closePaymentModal"
    >
      <div class="grid gap-4">
        <StaffCurrentActorBadge />

        <div>
          <label class="text-sm font-medium text-gray-700"
            >Сумма к оплате</label
          >
          <input
            v-model.number="paymentAmount"
            type="number"
            min="0"
            step="0.01"
            class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
        </div>

        <div>
          <label class="text-sm font-medium text-gray-700">Тип оплаты</label>
          <div class="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              class="rounded-lg border px-3 py-2 text-sm font-semibold transition"
              :class="paymentMethod === 'cash' ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'"
              @click="paymentMethod = 'cash'"
            >
              Наличными
            </button>
            <button
              type="button"
              class="rounded-lg border px-3 py-2 text-sm font-semibold transition"
              :class="paymentMethod === 'card' ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'"
              @click="paymentMethod = 'card'"
            >
              По карте
            </button>
          </div>
        </div>

        <div v-if="paymentMethod === 'cash' || paymentOrder?.cash_due_minor">
          <label class="text-sm font-medium text-gray-700">Касса</label>
          <select
            v-model="selectedAccountId"
            class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          >
            <option value="" disabled>Выберите счёт</option>
            <option
              v-for="account in cashAccounts"
              :key="account.id"
              :value="account.id"
            >
              {{ account.name }} · {{ formatCurrency(account.balance) }}
            </option>
          </select>
        </div>

        <div
          v-if="paymentMethod === 'card' && paymentOrder?.card_amount_minor"
          class="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-900"
        >
          По карте: {{ formatCurrency(paymentOrder.card_amount_minor / 100) }}
          <span v-if="paymentOrder.cash_due_minor">
            · наличными: {{ formatCurrency(paymentOrder.cash_due_minor / 100) }}
          </span>
        </div>

        <div>
          <label class="text-sm font-medium text-gray-700">Комментарий</label>
          <textarea
            v-model="paymentNotes"
            rows="3"
            class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            placeholder="Например, имя кассира или примечания к оплате"
          ></textarea>
        </div>
      </div>

      <footer class="mt-6 flex justify-end gap-3">
        <button
          @click="closePaymentModal"
          class="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-100"
          :disabled="isIssuing"
        >
          Отмена
        </button>
        <button
          @click="deferClick(() => { void submitPayment() })"
          class="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-400"
          :disabled="isIssuing || paymentAmount <= 0 || (paymentMethod === 'cash' && !selectedAccountId) || (paymentMethod === 'card' && Number(paymentOrder?.cash_due_minor || 0) > 0 && !selectedAccountId)"
        >
          <svg
            v-if="isIssuing"
            class="h-4 w-4 animate-spin"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          Подтвердить и выдать
        </button>
      </footer>
    </AdminModal>

    <CardPaymentsModal
      :isOpen="cardPaymentsModalOpen"
      @close="cardPaymentsModalOpen = false"
    />

    <AdminModal
      :isOpen="showPasswordModal"
      title="Подтверждение доступа"
      description="Введите лицензионный ключ"
      size="sm"
      :showActions="false"
      @close="closePasswordModal"
      @cancel="closePasswordModal"
    >
      <form class="space-y-4" autocomplete="on" @submit.prevent="submitPassword">
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
            class="flex-1 rounded-md bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-300"
            @click="closePasswordModal"
            :disabled="verifyingPassword"
          >
            Отмена
          </button>
        </div>
      </form>
    </AdminModal>

    <AdminModal
      :isOpen="deliveredModalOpen"
      title="Статистика заказов"
      description="Статистика выполненных заказов и доставок."
      size="xl"
      :showActions="false"
      @close="closeDeliveredModal"
      @cancel="closeDeliveredModal"
    >
      <div class="space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex flex-wrap gap-2">
            <button
              v-for="option in deliveredFilterOptions"
              :key="option.value"
              type="button"
              class="rounded-full px-3 py-1 text-xs font-semibold transition"
              :class="
                deliveredFilter === option.value
                  ? 'bg-emerald-600 text-white shadow'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              "
              @click="deliveredFilter = option.value"
            >
              {{ option.label }}
            </button>
          </div>
          <div class="relative">
            <input
              v-model.trim="deliveredSearch"
              type="search"
              class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100 sm:w-64"
              placeholder="Поиск по номеру или клиенту"
            />
          </div>
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
          <div class="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div class="text-xs uppercase text-gray-500">Всего заказов</div>
            <div class="mt-2 text-2xl font-semibold text-gray-900">
              {{ deliveredSummary.totalCount }}
            </div>
            <p class="text-xs text-gray-500">{{ deliveredSummaryLabel }}</p>
          </div>
          <div class="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div class="text-xs uppercase text-gray-500">Выручка</div>
            <div class="mt-2 text-2xl font-semibold text-emerald-700">
              {{ formatCurrency(deliveredSummary.totalAmount) }}
            </div>
            <p class="text-xs text-gray-500">{{ deliveredSummaryLabel }}</p>
          </div>
        </div>

        <div
          v-if="filteredDeliveredOrders.length"
          class="overflow-hidden rounded-lg border border-gray-200"
        >
          <table class="w-full text-sm">
            <thead
              class="bg-gray-50 text-xs font-semibold uppercase text-gray-500"
            >
              <tr>
                <th class="px-4 py-3 text-left">№</th>
                <th class="px-4 py-3 text-left">Клиент</th>
                <th class="px-4 py-3 text-left">Сумма</th>
                <th class="px-4 py-3 text-left">Завершён</th>
                <th class="px-4 py-3 text-right">Действия</th>
              </tr>
            </thead>
            <tbody class="divide-y">
              <tr
                v-for="order in filteredDeliveredOrders"
                :key="order.id"
                class="hover:bg-gray-50"
              >
                <td class="px-4 py-3 font-semibold text-gray-900">
                  #{{ order.order_number }}
                </td>
                <td class="px-4 py-3 text-gray-700">
                  {{ order.customer_name || "Без имени" }}
                </td>
                <td class="px-4 py-3 font-medium text-gray-900">
                  {{ formatCurrency(order.final_amount) }}
                </td>
                <td class="px-4 py-3 text-gray-500">
                  {{ formatDate(orderCompletedAt(order) || order.created_at) }}
                </td>
                <td class="px-4 py-3 text-right">
                  <button
                    class="text-sm font-medium text-blue-600 transition hover:text-blue-800"
                    @click="viewOrder(order.id)"
                  >
                    Открыть
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <!-- Загрузить ещё -->
        <div
          v-if="filteredDeliveredOrders.length && deliveredPagination && deliveredPagination.page < deliveredPagination.totalPages"
          class="flex justify-center pt-2"
        >
          <button
            :disabled="crmStore.loadingDelivered"
            class="rounded-lg border border-gray-200 bg-white px-6 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:opacity-50"
            @click="loadMoreDelivered"
          >
            <span v-if="crmStore.loadingDelivered">Загрузка...</span>
            <span v-else>Загрузить ещё ({{ filteredDeliveredOrders.length }} из {{ deliveredPagination.total }})</span>
          </button>
        </div>
        <div
          v-else-if="!filteredDeliveredOrders.length"
          class="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500"
        >
          За выбранный период заказов не найдено.
        </div>
      </div>
    </AdminModal>

    <!-- Создание заказа -->
    <OrderCreateModal
      :is-open="showCreateModal"
      @close="showCreateModal = false"
      @created="handleOrderCreated"
      @shift-required="handleOrderCreateShiftRequired"
    />

    <!-- Блокировка клиента -->
    <CustomerBlockModal
      :is-open="showBlockModal"
      :prefill-username="blockPrefillUsername"
      :customer-id="blockCustomerId"
      @close="showBlockModal = false"
      @created="handleBlockCreated"
      @notify-result="handleBlockNotifyResult"
    />

    <CustomerInviteBanModal
      :is-open="showInviteBanModal"
      :customer-id="inviteBanCustomerId"
      :username="inviteBanUsername"
      @close="showInviteBanModal = false"
      @created="handleInviteBanChanged"
    />

    <AdminModal
      :is-open="showInviterMessageModal"
      title="Написать пригласившему"
      :description="inviterMessageUsername ? `@${inviterMessageUsername}` : undefined"
      size="sm"
      :show-actions="false"
      @close="closeInviterMessage"
    >
      <form class="space-y-3" @submit.prevent="sendInviterMessage">
        <textarea
          v-model.trim="inviterMessageText"
          rows="5"
          class="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
          placeholder="Текст сообщения"
        />
        <div class="flex justify-end gap-2">
          <button type="button" class="rounded-lg border px-4 py-2 text-sm" @click="closeInviterMessage">Отмена</button>
          <button
            type="submit"
            :disabled="sendingInviterMessage || !inviterMessageText.trim()"
            class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >{{ sendingInviterMessage ? 'Отправляем...' : 'Отправить' }}</button>
        </div>
      </form>
    </AdminModal>

    <CustomerNoteModal
      :is-open="showNoteModal"
      :mode="noteModalMode"
      :prefill-username="notePrefillUsername"
      :customer-id="noteCustomerId"
      :customer-name="noteCustomerName"
      :initial-notes="noteInitialText"
      @close="showNoteModal = false"
      @saved="handleNoteSaved"
    />

    <!-- Модалка скидки -->
    <AdminModal
      :isOpen="discountModalOpen && !!discountOrder"
      :title="discountOrder ? `Скидка на заказ #${discountOrder.order_number}` : 'Скидка'"
      description="Введите сумму скидки в рублях"
      size="sm"
      :showActions="false"
      @close="closeDiscountModal"
      @cancel="closeDiscountModal"
    >
      <div class="grid gap-4">
        <div>
          <label class="text-sm font-medium text-gray-700">Сумма заказа</label>
          <div class="mt-1 text-lg font-semibold text-gray-900">
            {{ discountOrder ? formatCurrency(discountOrder.total_amount) : '' }}
          </div>
        </div>
        <div>
          <label class="text-sm font-medium text-gray-700">Скидка (BYN)</label>
          <input
            v-model.number="discountAmount"
            type="number"
            min="0"
            :max="discountOrder?.total_amount || 0"
            step="1"
            class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
            placeholder="0"
          />
        </div>
        <div v-if="discountAmount > 0" class="rounded-lg bg-emerald-50 p-3">
          <div class="text-sm text-gray-600">Итого со скидкой:</div>
          <div class="text-xl font-bold text-emerald-700">
            {{ discountOrder ? formatCurrency(discountOrder.total_amount - discountAmount) : '' }}
          </div>
        </div>
      </div>
      <footer class="mt-6 flex justify-between gap-3">
        <button
          v-if="discountOrder?.discount_amount && discountOrder.discount_amount > 0"
          @click="removeDiscount"
          class="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
          :disabled="isApplyingDiscount"
        >
          Убрать скидку
        </button>
        <div class="flex-1"></div>
        <button
          @click="closeDiscountModal"
          class="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-100"
          :disabled="isApplyingDiscount"
        >
          Отмена
        </button>
        <button
          @click="deferClick(() => { void applyDiscount() })"
          class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
          :disabled="isApplyingDiscount || discountAmount < 0"
        >
          {{ isApplyingDiscount ? 'Сохранение...' : 'Применить' }}
        </button>
      </footer>
    </AdminModal>

    <!-- Модалка отмены заказа -->
    <AdminModal
      :isOpen="cancelModalOpen && !!cancelOrder"
      :title="cancelOrder ? `Отмена заказа #${cancelOrder.order_number}` : 'Отмена заказа'"
      description="Вы уверены, что хотите отменить этот заказ?"
      size="sm"
      :showActions="false"
      @close="closeCancelModal"
      @cancel="closeCancelModal"
    >
      <div class="rounded-lg bg-red-50 p-4 text-center">
        <div class="text-sm text-gray-600">Заказ на сумму</div>
        <div class="text-2xl font-bold text-gray-900">
          {{ cancelOrder ? formatCurrency(cancelOrder.final_amount) : '' }}
        </div>
        <div class="mt-2 text-sm text-red-600">
          Товары вернутся на склад
        </div>
      </div>
      <footer class="mt-6 flex justify-end gap-3">
        <button
          @click="closeCancelModal"
          class="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-100"
          :disabled="isCancelling"
        >
          Нет, оставить
        </button>
        <button
          @click="deferClick(() => { void confirmCancelOrder() })"
          class="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
          :disabled="isCancelling"
        >
          {{ isCancelling ? 'Отмена...' : 'Да, отменить' }}
        </button>
      </footer>
    </AdminModal>

    <!-- Модалка списка отмененных заказов -->
    <AdminModal
      :isOpen="cancelledModalOpen"
      title="Отмененные заказы"
      :description="`Всего отменено: ${cancelledOrders.length}`"
      size="lg"
      :showActions="false"
      @close="cancelledModalOpen = false"
      @cancel="cancelledModalOpen = false"
    >
      <div v-if="cancelledOrders.length" class="space-y-3 max-h-96 overflow-y-auto">
        <article
          v-for="order in cancelledOrders"
          :key="order.id"
          class="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3 transition hover:bg-gray-50"
        >
          <div class="flex-1">
            <div class="flex items-center gap-2">
              <span class="font-semibold text-red-600">#{{ order.order_number }}</span>
              <span class="text-xs text-gray-400">{{ formatDate(order.created_at) }}</span>
            </div>
            <div class="mt-1 text-sm font-medium text-gray-800">
              {{ order.customer_name || "Без имени" }}
            </div>
            <div class="mt-0.5 text-xs text-gray-500">
              {{ order.notes || "Причина не указана" }}
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-semibold text-gray-600">{{ formatCurrency(order.final_amount) }}</span>
            <button
              @click="viewOrder(order.id); cancelledModalOpen = false"
              class="admin-link-button admin-link-button--compact admin-link-button--muted"
            >
              Открыть
            </button>
          </div>
        </article>
      </div>
      <div v-else class="py-8 text-center text-gray-500">
        Нет отмененных заказов
      </div>
    </AdminModal>

    <AdminModal
      :isOpen="pickupCellsModalOpen"
      title="Ячейки хранения"
      :description="pickupCellsLoaded
        ? `Занято ${pickupCells.occupied} из ${pickupCells.capacity}`
        : loadingPickupCells ? 'Загрузка данных…' : 'Данные недоступны'"
      size="lg"
      :showActions="false"
      @close="closePickupCellsModal"
      @cancel="closePickupCellsModal"
    >
      <div class="space-y-5">
        <div class="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <label class="block text-sm font-semibold text-slate-800" for="pickup-cell-capacity">
            Количество ячеек
          </label>
          <div class="mt-2 flex items-start gap-2">
            <input
              id="pickup-cell-capacity"
              v-model.number="pickupCellCapacityInput"
              type="number"
              inputmode="numeric"
              min="1"
              max="100"
              class="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              :disabled="savingPickupCellCapacity || !pickupCellsLoaded"
            />
            <button
              type="button"
              class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="savingPickupCellCapacity || !pickupCellsLoaded"
              @click="savePickupCellCapacity"
            >
              {{ savingPickupCellCapacity ? 'Сохраняем...' : 'Сохранить' }}
            </button>
          </div>
          <p v-if="pickupCellsError" class="mt-2 text-sm text-red-600" role="alert">
            {{ pickupCellsError }}
          </p>
        </div>

        <div v-if="loadingPickupCells" class="py-10 text-center text-sm text-slate-500">
          Загружаем ячейки...
        </div>
        <div v-else-if="pickupCellsLoadError" class="py-8 text-center">
          <p class="text-sm text-red-600">{{ pickupCellsLoadError }}</p>
          <button
            type="button"
            class="mt-3 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
            @click="loadPickupCells"
          >Повторить</button>
        </div>
        <div v-else class="grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-8">
          <button
            v-for="cell in pickupCells.cells"
            :key="cell.number"
            type="button"
            class="min-h-24 rounded-xl border p-2 text-left transition"
            :class="cell.occupied
              ? 'border-indigo-300 bg-indigo-50 hover:bg-indigo-100'
              : 'cursor-default border-slate-200 bg-white text-slate-400'"
            :disabled="!cell.occupied"
            :aria-label="cell.occupied
              ? `Ячейка ${cell.number}, занята заказом ${cell.order_number}, клиент ${cell.customer_name || 'без имени'}`
              : `Ячейка ${cell.number}, свободна`"
            @click="cell.order_id && openOrderFromPickupCell(cell.order_id)"
          >
            <span class="block text-lg font-black" :class="cell.occupied ? 'text-indigo-900' : 'text-slate-500'">
              {{ cell.number }}
            </span>
            <template v-if="cell.occupied">
              <span class="mt-1 block text-[11px] font-semibold text-indigo-800">#{{ cell.order_number }}</span>
              <span
                class="mt-0.5 block truncate text-[10px] text-indigo-700"
                :title="cell.customer_name"
              >{{ cell.customer_name }}</span>
              <span class="mt-1 block text-[9px] uppercase tracking-wide text-indigo-500">Занята</span>
            </template>
            <span v-else class="mt-1 block text-[10px]">Свободна</span>
          </button>
        </div>
      </div>
    </AdminModal>

    <!-- In-app Toast Notification (Safari fallback) -->
    <Teleport to="body">
      <Transition name="toast-slide">
        <div
          v-if="crmStore.inAppToast.show"
          class="fixed top-4 right-4 z-[9999] flex items-center gap-3 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 px-5 py-4 text-white shadow-2xl"
          style="min-width: 280px;"
        >
          <div class="flex h-10 w-10 items-center justify-center rounded-full bg-white/20">
            <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
          </div>
          <div class="flex-1">
            <div class="font-bold text-lg">{{ crmStore.inAppToast.message }}</div>
            <div class="text-sm text-white/80">{{ crmStore.inAppToast.hint || "Проверьте колонку «Новые»" }}</div>
          </div>
          <button
            @click="crmStore.hideInAppToast()"
            class="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 hover:bg-white/30 transition-colors"
          >
            <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { storeToRefs } from "pinia";
import type { Order, OrderItem } from "@/stores/crm";
import { useCrmStore } from "@/stores/crm";
import CrmButton from "@/components/admin/crm/CrmButton.vue";
import OrderCreateModal from "@/components/crm/OrderCreateModal.vue";
import ManagerActionSummary from "@/components/crm/ManagerActionSummary.vue";
import AdminModal from "@/components/AdminModal.vue";
import CustomerBlockModal from "@/components/admin/CustomerBlockModal.vue";
import CustomerNoteModal from "@/components/admin/CustomerNoteModal.vue";
import CustomerInviteBanModal from "@/components/admin/CustomerInviteBanModal.vue";
import { LockClosedIcon, NoSymbolIcon } from "@heroicons/vue/24/outline";
import { buildAutoNotifyToast } from "@/utils/auto-notify-message";
import CrmProfitPasswordField from "@/components/crm/CrmProfitPasswordField.vue";
import StaffCurrentActorBadge from "@/components/admin/staff/StaffCurrentActorBadge.vue";
import StaffShiftBar from "@/components/admin/staff/StaffShiftBar.vue";
import CardPaymentsModal from "@/components/admin/crm/CardPaymentsModal.vue";

/** Отдаёт клик браузеру сразу — меньше [Violation] 'click' handler took Nms */
function deferClick(fn: () => void | Promise<void>) {
  queueMicrotask(() => {
    void fn();
  });
}

const crmStore = useCrmStore();
const {
  orders,
  loadingOrders,
  cashAccounts,
  profitUnlocked,
  verifyingProfitAccess,
  deliveredOrders: storeDeliveredOrders,
  deliveredStats,
  deliveredPagination,
  pickupCells,
  loadingPickupCells,
} = storeToRefs(crmStore);

const router = useRouter();
type StaffShiftBarExpose = {
  requestShiftRequired: (
    label: string,
    retry: () => unknown | Promise<unknown>,
  ) => Promise<void>;
};
const staffShiftBarRef = ref<StaffShiftBarExpose | null>(null);

const DRAW_MONTH_LABELS = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

const drawPeriodLabel = computed(() => {
  const periodKey = crmStore.latestMonthlyDraw?.period_key || "";
  const match = /^(\d{4})-(\d{2})$/.exec(periodKey);
  if (!match) return periodKey;
  const month = DRAW_MONTH_LABELS[Number(match[2]) - 1];
  return month ? `${month} ${match[1]}` : periodKey;
});

function formatDrawWinnerCount(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} победитель`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return `${count} победителя`;
  }
  return `${count} победителей`;
}

const drawWinnerCountLabel = computed(() => {
  const count = crmStore.latestMonthlyDraw?.winner_count || 0;
  return count > 0 ? formatDrawWinnerCount(count) : "Победители не выбраны";
});

function openReviews() {
  crmStore.markReviewsAsSeen();
  crmStore.markDrawAsSeen();
  moreDropdownOpen.value = false;
  router.push("/admin/crm/reviews");
}

const showCreateModal = ref(false);

// Модалка блокировки клиента
const showBlockModal = ref(false);
const blockPrefillUsername = ref<string>('');
const blockCustomerId = ref<string | null>(null);
const activeInviterMenuOrderId = ref<string | null>(null);
const inviterMenuPosition = ref({ top: 0, left: 0 });
const showInviteBanModal = ref(false);
const inviteBanCustomerId = ref<string | null>(null);
const inviteBanUsername = ref('');
const showInviterMessageModal = ref(false);
const inviterMessageCustomerId = ref<string | null>(null);
const inviterMessageUsername = ref('');
const inviterMessageText = ref('');
const sendingInviterMessage = ref(false);
const removingInviterBanId = ref<string | null>(null);

function openBlockModal(prefill?: string, customerId: string | null = null) {
  blockPrefillUsername.value = prefill ?? '';
  blockCustomerId.value = customerId;
  showBlockModal.value = true;
}

async function toggleInviterMenu(orderId: string, event: Event) {
  if (activeInviterMenuOrderId.value === orderId) {
    activeInviterMenuOrderId.value = null;
    return;
  }
  const trigger = event.currentTarget as HTMLElement | null;
  if (!trigger) return;
  const triggerRect = trigger.getBoundingClientRect();
  const viewportMargin = 8;
  inviterMenuPosition.value = {
    top: triggerRect.bottom + 4,
    left: Math.max(viewportMargin, Math.min(triggerRect.left, window.innerWidth - 248)),
  };
  activeInviterMenuOrderId.value = orderId;
  await nextTick();
  const menu = document.getElementById(`inviter-menu-${orderId}`);
  if (!menu) return;
  const menuRect = menu.getBoundingClientRect();
  const below = triggerRect.bottom + 4;
  const above = triggerRect.top - menuRect.height - 4;
  inviterMenuPosition.value = {
    top: below + menuRect.height <= window.innerHeight - viewportMargin
      ? below
      : Math.max(viewportMargin, above),
    left: Math.max(
      viewportMargin,
      Math.min(triggerRect.left, window.innerWidth - menuRect.width - viewportMargin),
    ),
  };
  await nextTick();
  menu.querySelector<HTMLElement>('button')?.focus();
}

async function closeInviterMenu(orderId: string, restoreFocus = false) {
  activeInviterMenuOrderId.value = null;
  if (!restoreFocus) return;
  await nextTick();
  document.getElementById(`inviter-trigger-${orderId}`)?.focus({ preventScroll: true });
}

function handleInviterMenuFocusOut(orderId: string, event: FocusEvent) {
  const menu = event.currentTarget as HTMLElement | null;
  const nextTarget = event.relatedTarget as Node | null;
  const trigger = document.getElementById(`inviter-trigger-${orderId}`);
  if (nextTarget && (menu?.contains(nextTarget) || trigger?.contains(nextTarget))) return;
  activeInviterMenuOrderId.value = null;
}

function handleInviterMenuKeydown(orderId: string, event: KeyboardEvent) {
  const menu = event.currentTarget as HTMLElement | null;
  if (!menu) return;
  const items = Array.from(
    menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'),
  );
  if (!items.length) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    void closeInviterMenu(orderId, true);
    return;
  }

  const currentIndex = items.indexOf(document.activeElement as HTMLElement);
  let nextIndex: number | null = null;
  if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % items.length;
  if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + items.length) % items.length;
  if (event.key === 'Home') nextIndex = 0;
  if (event.key === 'End') nextIndex = items.length - 1;
  if (nextIndex === null) return;

  event.preventDefault();
  event.stopPropagation();
  items[nextIndex]?.focus();
}

async function copyInviter(order: Order, event: MouseEvent) {
  const username = order.referral?.inviter_username;
  if (!username) return;
  const text = `@${username}`;
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    const input = document.createElement('textarea');
    input.value = text;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    try {
      input.select();
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    } finally {
      input.remove();
    }
  }
  if (!copied) {
    window.prompt('Скопируйте username', text);
  } else {
    showOrderToast({ kind: 'success', message: `${text} скопирован` });
  }
  // После обычного клика не возвращаем программный фокус на ссылку — именно
  // он создавал тяжёлую синюю рамку на карточке. Для клавиатуры фокус сохраняем.
  await closeInviterMenu(order.id, event.detail === 0);
}

function openInviterBlockModal(order: Order) {
  activeInviterMenuOrderId.value = null;
  openBlockModal(
    order.referral?.inviter_username || '',
    order.referral?.inviter_customer_id || null,
  );
}

function openInviteBanModal(order: Order) {
  inviteBanCustomerId.value = order.referral?.inviter_customer_id || null;
  inviteBanUsername.value = order.referral?.inviter_username || '';
  showInviteBanModal.value = true;
  activeInviterMenuOrderId.value = null;
}

async function removeInviterBan(order: Order) {
  const id = order.referral?.inviter_invite_ban_id;
  if (!id || removingInviterBanId.value || !window.confirm('Снять запрет приглашать?')) return;
  removingInviterBanId.value = id;
  try {
    const response = await fetch(`/api/admin/crm/invite-bans/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({}),
    });
    if (!response.ok) throw new Error('failed');
    await handleInviteBanChanged();
    showOrderToast({ kind: 'success', message: 'Запрет приглашать снят' });
  } catch {
    showOrderToast({ kind: 'error', message: 'Не удалось снять запрет' });
  } finally {
    removingInviterBanId.value = null;
  }
}

async function handleInviteBanChanged() {
  showInviteBanModal.value = false;
  activeInviterMenuOrderId.value = null;
  await refreshOrders({ skipNotify: true });
}

function openInviterMessage(order: Order) {
  inviterMessageCustomerId.value = order.referral?.inviter_customer_id || null;
  inviterMessageUsername.value = order.referral?.inviter_username || '';
  inviterMessageText.value = '';
  showInviterMessageModal.value = true;
  activeInviterMenuOrderId.value = null;
}

function closeInviterMessage() {
  if (sendingInviterMessage.value) return;
  showInviterMessageModal.value = false;
}

async function sendInviterMessage() {
  if (!inviterMessageCustomerId.value || !inviterMessageText.value.trim() || sendingInviterMessage.value) return;
  sendingInviterMessage.value = true;
  try {
    const response = await fetch('/api/admin/crm/bot/send-custom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        customer_id: inviterMessageCustomerId.value,
        text: inviterMessageText.value.trim(),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) throw new Error(data?.message || data?.error || 'send_failed');
    showInviterMessageModal.value = false;
    showOrderToast({ kind: 'success', message: 'Сообщение отправлено' });
  } catch (error: any) {
    showOrderToast({ kind: 'error', message: error?.message || 'Не удалось отправить сообщение' });
  } finally {
    sendingInviterMessage.value = false;
  }
}

const showNoteModal = ref(false);
const noteModalMode = ref<'toolbar' | 'card'>('toolbar');
const notePrefillUsername = ref('');
const noteCustomerId = ref<string | undefined>(undefined);
const noteCustomerName = ref('');
const noteInitialText = ref<string | null>(null);

function openNoteModal() {
  noteModalMode.value = 'toolbar';
  notePrefillUsername.value = '';
  noteCustomerId.value = undefined;
  noteCustomerName.value = '';
  noteInitialText.value = null;
  showNoteModal.value = true;
}

function openNoteModalForOrder(order: Order) {
  noteModalMode.value = 'card';
  notePrefillUsername.value = order.telegram_username || '';
  noteCustomerId.value = order.customer_id || undefined;
  noteCustomerName.value = order.customer_name || '';
  noteInitialText.value = order.customer_notes || null;
  showNoteModal.value = true;
}

function handleNoteSaved(payload: {
  kind: 'active' | 'pending' | 'cleared';
  customerId?: string;
  username?: string;
  notes: string | null;
}) {
  if (payload.customerId) {
    crmStore.patchCustomerNotesOnOrders(payload.customerId, payload.notes);
  }
  if (payload.kind === 'pending') {
    showOrderToast({
      kind: 'success',
      message: `Заметка сохранена. Появится, когда @${payload.username || 'клиент'} сделает заказ.`,
    });
    return;
  }
  if (payload.kind === 'cleared') {
    showOrderToast({ kind: 'success', message: 'Заметка удалена.' });
    return;
  }
  showOrderToast({ kind: 'success', message: 'Заметка сохранена.' });
}
function handleBlockCreated(payload: { kind: 'active' | 'pending'; username: string }) {
  const verb = payload.kind === 'pending'
    ? 'превентивный бан создан (активируется при первом заходе)'
    : 'клиент заблокирован';
  // В CrmOrders нет глобального toast-стека — пока используем нативное уведомление
  // браузера. Когда будет общая toast-инфраструктура (см. фоновую задачу про
  // унификацию уведомлений) — мигрируем сюда.
  window.alert(`@${payload.username}: ${verb}`);
}
function handleBlockNotifyResult(payload: { ok: boolean; error?: string; text?: string; username?: string }) {
  if (payload.ok) {
    showOrderToast({ kind: 'success', message: 'Сообщение о блокировке отправлено клиенту.' })
  } else if (payload.username && payload.text) {
    // Failed - show toast with Telegram link button
    const encodedText = encodeURIComponent(payload.text)
    const tgUrl = `https://t.me/${payload.username}?text=${encodedText}`
    showOrderToast({
      kind: 'error',
      message: 'Не удалось отправить сообщение о блокировке. Напишите клиенту вручную.',
      action: { label: 'Написать в Telegram', url: tgUrl },
    })
  }
}

const paymentModalOpen = ref(false);
const paymentOrder = ref<Order | null>(null);
const paymentMethod = ref<"cash" | "card">("cash");
const selectedAccountId = ref("");
const paymentAmount = ref(0);
const paymentNotes = ref("");
const isIssuing = ref(false);
const dragOrder = ref<Order | null>(null);
const activeDropColumn = ref<string | null>(null);
const updatingOrderId = ref<string | null>(null);
const pickupCellsModalOpen = ref(false);
const pickupCellCapacityInput = ref(50);
const pickupCellsError = ref("");
const pickupCellsLoadError = ref("");
const savingPickupCellCapacity = ref(false);
const pickupCellsLoaded = ref(false);
const cardPaymentsModalOpen = ref(false);

function openCardPaymentsModal() {
  cardPaymentsModalOpen.value = true;
}

async function loadPickupCells() {
  pickupCellsLoadError.value = "";
  pickupCellsLoaded.value = false;
  try {
    await crmStore.fetchPickupCells();
    pickupCellCapacityInput.value = pickupCells.value.capacity;
    pickupCellsLoaded.value = true;
  } catch (error: any) {
    pickupCellsLoadError.value = error?.message || "Не удалось загрузить ячейки";
  }
}

function openPickupCellsModal() {
  pickupCellsModalOpen.value = true;
  pickupCellsError.value = "";
}

function closePickupCellsModal() {
  if (savingPickupCellCapacity.value) return;
  pickupCellsModalOpen.value = false;
}

async function savePickupCellCapacity() {
  pickupCellsError.value = "";
  if (!pickupCellsLoaded.value) {
    pickupCellsError.value = "Сначала загрузите данные о ячейках";
    return;
  }
  const capacity = Number(pickupCellCapacityInput.value);
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100) {
    pickupCellsError.value = "Введите целое число от 1 до 100";
    return;
  }
  savingPickupCellCapacity.value = true;
  try {
    await crmStore.updatePickupCellCapacity(capacity);
    pickupCellCapacityInput.value = pickupCells.value.capacity;
    showOrderToast({ kind: "success", message: `Количество ячеек: ${capacity}` });
  } catch (error: any) {
    pickupCellsError.value = error?.message || "Не удалось сохранить количество ячеек";
  } finally {
    savingPickupCellCapacity.value = false;
  }
}

function openOrderFromPickupCell(orderId: string) {
  pickupCellsModalOpen.value = false;
  viewOrder(orderId);
}

// Dropdown states
const settingsDropdownOpen = ref(false);
const moreDropdownOpen = ref(false);
const settingsDropdownRef = ref<HTMLElement | null>(null);
const moreDropdownRef = ref<HTMLElement | null>(null);

// Computed for settings indicator
const hasActiveSettings = computed(() =>
  autoRefreshEnabled.value || notificationsEnabled.value || soundEnabled.value
);

const searchQuery = ref("");
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

// Use store for notification settings (global)
const {
  notificationsEnabled,
  soundEnabled,
  autoRefreshEnabled,
  unseenOrderIds: storeUnseenOrderIds,
  newOrdersCount
} = storeToRefs(crmStore);

const lastUpdateAt = ref<Date | null>(null);
const isRefreshing = ref(false);
const newOrderHighlight = ref(false);
// Local unseenOrderIds synced with store
const unseenOrderIds = computed(() => storeUnseenOrderIds.value);

const notificationsSupported =
  typeof window !== "undefined" && "Notification" in window;

let unsubscribeOrderActivity: (() => void) | null = null;
let pollActivityRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let highlightTimer: ReturnType<typeof setTimeout> | null = null;

const previewLimit = 4;
const expandedOrders = ref<Set<string>>(new Set());

// Тост по операциям с заказами: success / error / info. Костя 10.05.2026:
// «нажимаешь "Собрано" или "Выдать" — пусть тост вылазит, что отправилось
// успешно или не отправилось». Раньше был только error-тост (orderError);
// теперь — единая плашка с тремя видами.
type OrderToastKind = "success" | "error" | "info";
interface OrderToastAction {
  label: string;
  url: string;
}
interface OrderToastCopyable {
  label: string;
  value: string;
}
interface OrderToast {
  kind: OrderToastKind;
  message: string;
  action?: OrderToastAction;
  copyable?: OrderToastCopyable;
}
const orderToast = ref<OrderToast | null>(null);
const orderToastTimeout = ref<ReturnType<typeof setTimeout> | null>(null);

function showOrderToast(toast: OrderToast) {
  orderToast.value = toast;
  if (orderToastTimeout.value) {
    clearTimeout(orderToastTimeout.value);
  }
  // Ошибки не пропадают автоматически — менеджер сам нажмёт крестик.
  // Костя 15.05.2026: «сообщения с ошибками сделай так чтобы они
  // автоматически НЕ пропадали, а только когда менеджер сам нажмёт».
  if (toast.kind !== 'error') {
    orderToastTimeout.value = setTimeout(() => {
      orderToast.value = null;
    }, 4000);
  }
}

function dismissOrderToast() {
  orderToast.value = null;
  if (orderToastTimeout.value) {
    clearTimeout(orderToastTimeout.value);
    orderToastTimeout.value = null;
  }
}

function copyToastValue(value: string) {
  navigator.clipboard.writeText(value).catch(() => {
    // Fallback: textarea trick for older browsers
    const el = document.createElement('textarea');
    el.value = value;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  });
}

function getOrderLoyaltyDiscount(order: Order) {
  return (order.items || []).reduce(
    (sum, item) => sum + Number(item.loyalty_discount_amount || 0),
    0,
  );
}

function getOrderOrderLevelDiscount(order: Order) {
  return Math.max(0, getOrderTotalDiscount(order) - getOrderLoyaltyDiscount(order));
}

function getOrderTotalDiscount(order: Order) {
  return Math.max(
    0,
    Number(order.total_amount || 0) - Number(order.final_amount || 0),
  );
}

function handleNewOrders(newOrders: Order[]) {
  if (!newOrders.length) return;
  newOrderHighlight.value = true;
  if (highlightTimer) {
    clearTimeout(highlightTimer);
  }
  highlightTimer = setTimeout(() => {
    newOrderHighlight.value = false;
  }, 2600);
}

const deliveredModalOpen = ref(false);
const deliveredFilter = ref<DeliveredFilter>("today");
const deliveredSearch = ref("");
const deliveredFilterOptions: Array<{ value: DeliveredFilter; label: string }> =
  [
    { value: "today", label: "Сегодня" },
    { value: "week", label: "7 дней" },
    { value: "month", label: "30 дней" },
    { value: "all", label: "За всё время" },
  ];
const pendingDeliveredPreset = ref<DeliveredFilter | null>(null);
const showPasswordModal = ref(false);
const passwordInput = ref("");
const passwordError = ref("");
const verifyingPassword = computed(() => verifyingProfitAccess.value);
const generatingMessageForOrder = ref<string | null>(null);
const userbotDisconnected = ref(false);
let userbotStatusTimer: ReturnType<typeof setInterval> | null = null;

async function refreshUserbotStatus() {
  try {
    const response = await fetch('/api/admin/crm/bot/status', { credentials: 'include' });
    if (!response.ok) return;
    const data = await response.json();
    userbotDisconnected.value = data?.userbot_connected === false;
  } catch {
    // Не блокируем доску, если статус бота временно недоступен.
  }
}

// Discount modal state
const discountModalOpen = ref(false);
const discountOrder = ref<Order | null>(null);
const discountAmount = ref(0);
const isApplyingDiscount = ref(false);

// Cancel order modal state
const cancelModalOpen = ref(false);
const cancelOrder = ref<Order | null>(null);
const isCancelling = ref(false);

// Resolve manager action
const resolvingOrderId = ref<string | null>(null);

async function handleResolveAction(order: Order) {
  resolvingOrderId.value = order.id;
  try {
    await crmStore.resolveManagerAction(order.id);
    void loadPickupCells();
    return true;
  } catch (error: any) {
    if (error?.code === "shift_required") {
      void staffShiftBarRef.value?.requestShiftRequired(
        `Обработать заказ #${order.order_number}`,
        () => handleResolveAction(order),
      );
      return false;
    }
    if (error?.outcomeUnknown) {
      showOrderToast({
        kind: "error",
        message: `Заказ #${order.order_number}: ответ не получен. Обновите доску перед повтором.`,
      });
      void refreshOrders({ skipNotify: true });
      return false;
    }
    console.error("[CRM] Resolve action failed:", error);
    showOrderToast({
      kind: "error",
      message: error?.message || "Не удалось обработать заказ",
    });
    return false;
  } finally {
    resolvingOrderId.value = null;
  }
}

// Cancelled orders modal
const cancelledModalOpen = ref(false);

type KanbanColumnConfig = {
  key: "action_required" | "new" | "in_progress";
  label: string;
  description: string;
  filter: (order: Order) => boolean;
  badgeClass: string;
};

type DeliveredFilter = "today" | "week" | "month" | "all";

const deliveredStatuses: Array<Order["status"]> = ["delivered", "completed"];

const kanbanConfig: KanbanColumnConfig[] = [
  {
    key: "action_required",
    label: "Требует действий",
    description: "Измененные или отмененные покупателем",
    filter: (order) => order.needs_manager_action === 1,
    badgeClass: "bg-orange-100 text-orange-700",
  },
  {
    key: "new",
    label: "Новые",
    description: "Необходимо собрать заказ",
    filter: (order) => order.status === "new" && !order.needs_manager_action,
    badgeClass: "bg-amber-100 text-amber-700",
  },
  {
    key: "in_progress",
    label: "Собран",
    description: "Ожидает выдачи клиенту",
    filter: (order) => order.status === "in_progress" && !order.needs_manager_action,
    badgeClass: "bg-blue-100 text-blue-700",
  },
];

const kanbanColumns = computed(() =>
  kanbanConfig.map((column) => ({
    ...column,
    orders: orders.value.filter(column.filter),
  })),
);

function orderCompletedAt(order: Order): string | null {
  return (
    order.completed_at ||
    order.paid_at ||
    order.updated_at ||
    order.created_at ||
    null
  );
}

function isDeliveredInRange(order: Order, filter: DeliveredFilter) {
  if (filter === "all") return true;
  const source = orderCompletedAt(order);
  if (!source) return false;
  const date = new Date(source);
  const now = new Date();
  if (filter === "today") {
    return date.toDateString() === now.toDateString();
  }
  const diff = now.getTime() - date.getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  if (filter === "week") {
    return diff <= 7 * dayMs;
  }
  if (filter === "month") {
    return diff <= 30 * dayMs;
  }
  return true;
}

const filteredDeliveredOrders = computed(() => {
  return storeDeliveredOrders.value
    .sort((a, b) => {
      const dateB = orderCompletedAt(b);
      const dateA = orderCompletedAt(a);
      return (
        (dateB ? new Date(dateB).getTime() : 0) -
        (dateA ? new Date(dateA).getTime() : 0)
      );
    });
});

const deliveredSummary = computed(() => {
  const s = deliveredStats.value;
  if (s) return s;
  return {
    totalCount: 0,
    totalAmount: 0,
    deliveryCount: 0,
    deliveryAmount: 0,
    pickupCount: 0,
    pickupAmount: 0,
  };
});

const deliveredSummaryLabel = computed(() => {
  switch (deliveredFilter.value) {
    case "today":
      return "сегодня";
    case "week":
      return "за 7 дней";
    case "month":
      return "за 30 дней";
    default:
      return "за всё время";
  }
});

const cancelledOrders = computed(() =>
  orders.value.filter((order) => order.status === "cancelled"),
);

const unseenOrdersCount = computed(() => unseenOrderIds.value.size);

const lastUpdateLabel = computed(() => {
  if (!lastUpdateAt.value) return "—";
  return lastUpdateAt.value.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
});

const notificationPermissionDenied = computed(() => {
  if (!notificationsSupported || typeof Notification === "undefined")
    return false;
  return Notification.permission === "denied";
});

const notificationPermissionStatus = computed(() => {
  if (!notificationsSupported || typeof Notification === "undefined")
    return "not supported";
  return Notification.permission;
});

// Request notification permission (used in settings dropdown)
async function requestNotificationPermission() {
  if (typeof Notification !== "undefined" && Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch (e) {
      console.error("Failed to request notification permission:", e);
    }
  }
}

const nextStatusMap: Record<
  Order["status"],
  "in_progress" | "delivered" | null
> = {
  new: "in_progress",
  in_progress: "delivered",
  completed: null,
  delivered: null,
  cancelled: null,
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "BYN",
    minimumFractionDigits: 0,
  }).format(value);
}

function formatDate(dateString: string) {
  // SQLite хранит время в UTC, добавляем 'Z' для корректной интерпретации
  const isoString =
    dateString.includes("Z") || dateString.includes("+")
      ? dateString
      : dateString.replace(" ", "T") + "Z";
  return new Date(isoString).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Скидка каталога, срезанная с единицы товара на момент оформления.
 *
 * Берём снимок из позиции, а не текущую скидку из каталога: акция могла
 * закончиться или появиться уже после заказа, и тогда пометка врала бы про то,
 * как человек покупал на самом деле. У заказов старше этого снимка поле пустое,
 * и пометки просто нет — это честнее, чем гадать.
 */
function catalogDiscountPerUnit(item: OrderItem): number {
  return Number(item.catalog_discount_per_unit ?? 0);
}

function discountHint(item: OrderItem): string {
  const base = Number(item.base_price_per_unit ?? 0);
  const perUnit = catalogDiscountPerUnit(item);
  if (base > 0) {
    return `Продано со скидкой: было ${base} BYN, скидка ${perUnit} BYN за штуку`;
  }
  return `Продано со скидкой ${perUnit} BYN за штуку`;
}

function previewItems(order: Order) {
  if (!order.items) return [];
  if (expandedOrders.value.has(order.id)) {
    return order.items;
  }
  return order.items.slice(0, previewLimit);
}

function toggleOrderExpanded(orderId: string) {
  const next = new Set(expandedOrders.value);
  if (next.has(orderId)) {
    next.delete(orderId);
  } else {
    next.add(orderId);
  }
  expandedOrders.value = next;
}

function isOrderExpanded(orderId: string) {
  return expandedOrders.value.has(orderId);
}

function hiddenItemsCount(order: Order) {
  if (!order.items) return 0;
  return Math.max(0, order.items.length - previewLimit);
}

function pluralizePositions(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "позиция";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20))
    return "позиции";
  return "позиций";
}

function deliveryBadgeClass(order: Order) {
  return order.delivery_type === "delivery"
    ? "bg-rose-100 text-rose-700"
    : "bg-gray-100 text-gray-600";
}

// Плашка «сколько сообщений с клиентом» — подсказка менеджеру по
// степени знакомства перед отправкой авто-уведомления. Костя 11.05.2026:
// «вижу 0 — насторожусь, вижу 20 — спокойно жму». Считается на бэке
function nextStatusLabel(status: Order["status"]) {
  if (status === "new") return "Собрано";
  if (status === "in_progress") return "Выдать";
  return "";
}

function advanceButtonClass(order: Order) {
  if (order.status === "new") return "admin-link-button--primary";
  if (order.status === "in_progress") return "admin-link-button--success";
  return "admin-link-button--muted";
}

function canAdvance(order: Order) {
  return nextStatusMap[order.status] !== null;
}

async function advanceOrder(order: Order) {
  const nextStatus = nextStatusMap[order.status];
  if (!nextStatus || updatingOrderId.value) return false;

  if (nextStatus === "delivered") {
    await openPaymentModal(order);
    return true;
  }

  updatingOrderId.value = order.id;
  try {
    const updated = await crmStore.updateOrder(order.id, { status: nextStatus });
    markOrderSeen(order.id);
    // Тост по итогу авто-уведомления клиенту. Кость 10.05.2026 просил
    // подтверждение «дошло / не дошло» прямо после клика, чтобы менеджер
    // не шёл в карточку заказа проверять плашку.
    const toast = buildAutoNotifyToast(updated.auto_notification, {
      actionDescription: updated.pickup_cell_number
        ? `Заказ #${order.order_number} собран · ячейка ${updated.pickup_cell_number}`
        : `Заказ #${order.order_number}: ${orderStatusLabel(nextStatus, order.delivery_type).toLowerCase()}`,
    });
    showOrderToast(toast);
    void loadPickupCells();
    return true;
  } catch (error: any) {
    if (error?.code === "shift_required") {
      await staffShiftBarRef.value?.requestShiftRequired(
        `Собрать заказ #${order.order_number}`,
        () => advanceOrder(order),
      );
      return false;
    }
    if (error?.outcomeUnknown) {
      showOrderToast({
        kind: "error",
        message: `Заказ #${order.order_number}: ответ не получен. Обновите доску перед повтором.`,
      });
      void refreshOrders({ skipNotify: true });
      return false;
    }
    const errorMessage = error?.code === "pickup_cells_full"
      ? "Свободных ячеек нет. Выдайте или разберите заказ и повторите."
      : error?.message || "Не удалось изменить статус заказа";
    showOrderToast({ kind: "error", message: `Заказ #${order.order_number}: ${errorMessage}` });
    return false;
  } finally {
    updatingOrderId.value = null;
  }
}

function viewOrder(id: string) {
  markOrderSeen(id);
  router.push(`/admin/crm/orders/${id}`);
}

function canDropTo(columnKey: string, order: Order) {
  // Нельзя перетаскивать заказы, требующие действий менеджера
  if (order.needs_manager_action) return false;
  // Из "Новые" в "Собран"
  if (columnKey === "in_progress") return order.status === "new";
  return false;
}

function onDragStart(order: Order) {
  dragOrder.value = order;
}

function onDragEnd() {
  dragOrder.value = null;
  activeDropColumn.value = null;
}

function onDragOver(columnKey: string) {
  if (!dragOrder.value) return;
  if (canDropTo(columnKey, dragOrder.value)) {
    activeDropColumn.value = columnKey;
  }
}

function onDragLeave(columnKey: string) {
  if (activeDropColumn.value === columnKey) {
    activeDropColumn.value = null;
  }
}

function onDrop(columnKey: string) {
  if (!dragOrder.value) return;
  if (!canDropTo(columnKey, dragOrder.value)) {
    onDragEnd();
    return;
  }

  const order = dragOrder.value;
  onDragEnd();
  deferClick(() => {
    void advanceOrder(order);
  });
}

async function openPaymentModal(order: Order) {
  paymentOrder.value = order;
  paymentAmount.value = order.final_amount;
  paymentMethod.value = order.payment_type === "card" ? "card" : "cash";
  paymentNotes.value = order.payment_notes || "";

  if (cashAccounts.value.length === 0) {
    await crmStore.fetchCashAccounts();
  }

  const defaultAccount =
    cashAccounts.value.find((account) => account.is_default === 1) ||
    cashAccounts.value[0] ||
    null;
  selectedAccountId.value = defaultAccount ? defaultAccount.id : "";

  paymentModalOpen.value = true;
}

function closePaymentModal() {
  if (isIssuing.value) return;
  paymentModalOpen.value = false;
  paymentOrder.value = null;
  paymentNotes.value = "";
}

async function submitPayment() {
  if (
    !paymentOrder.value ||
    ((paymentMethod.value === "cash" ||
      (paymentOrder.value.cash_due_minor || 0) > 0) &&
      !selectedAccountId.value) ||
    paymentAmount.value <= 0
  )
    return false;
  isIssuing.value = true;
  // Сохраняем номер и тип доставки заранее: после issueOrder чистим
  // paymentOrder, а тост строим уже после.
  const orderNumber = paymentOrder.value.order_number;
  const deliveryType = paymentOrder.value.delivery_type;
  try {
    const result = await crmStore.issueOrder(paymentOrder.value.id, {
      payment_type: paymentMethod.value,
      payment_account_id: selectedAccountId.value || undefined,
      amount: paymentAmount.value,
      payment_notes: paymentNotes.value || undefined,
    });
    paymentModalOpen.value = false;
    paymentOrder.value = null;
    paymentNotes.value = "";
    // Тост по итогу авто-уведомления клиенту (Костя 10.05.2026).
    const toast = buildAutoNotifyToast(result.auto_notification, {
      actionDescription: `Заказ #${orderNumber}: ${orderStatusLabel("delivered", deliveryType).toLowerCase()}`,
    });
    showOrderToast(toast);
    void loadPickupCells();
    return true;
  } catch (error: any) {
    if (error?.code === "shift_required" && paymentOrder.value) {
      const retryState = {
        order: paymentOrder.value,
        amount: paymentAmount.value,
        accountId: selectedAccountId.value,
        notes: paymentNotes.value,
      };
      paymentModalOpen.value = false;
      await staffShiftBarRef.value?.requestShiftRequired(
        `Выдать заказ #${orderNumber}`,
        async () => {
          paymentOrder.value = retryState.order;
          paymentAmount.value = retryState.amount;
          selectedAccountId.value = retryState.accountId;
          paymentNotes.value = retryState.notes;
          return submitPayment();
        },
      );
      return false;
    }
    console.error("[CRM] Failed to issue order:", error);
    if (error?.outcomeUnknown) {
      paymentModalOpen.value = false;
      paymentOrder.value = null;
      showOrderToast({
        kind: "error",
        message: `Заказ #${orderNumber}: ответ не получен. Проверьте доску и оплату перед повтором.`,
      });
      void refreshOrders({ skipNotify: true });
      return false;
    }
    const errorMessage = error?.message || "Не удалось выдать заказ";
    showOrderToast({ kind: "error", message: `Заказ #${orderNumber}: ${errorMessage}` });
    return false;
  } finally {
    isIssuing.value = false;
  }
}

function openPasswordModal() {
  if (verifyingPassword.value) return;
  passwordInput.value = "";
  passwordError.value = "";
  showPasswordModal.value = true;
}

function closePasswordModal() {
  if (verifyingPassword.value) return;
  showPasswordModal.value = false;
  passwordInput.value = "";
  passwordError.value = "";
}

async function submitPassword() {
  if (!passwordInput.value.trim()) {
    passwordError.value = "Введите ключ";
    return;
  }

  passwordError.value = "";
  try {
    await crmStore.verifyProfitPassword(passwordInput.value.trim());
    showPasswordModal.value = false;
    passwordInput.value = "";
    passwordError.value = "";
  } catch (error) {
    passwordError.value = "Неверный ключ";
  }
}

function handleSearch() {
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
  }
  searchDebounceTimer = setTimeout(() => {
    void refreshOrders({ skipNotify: true });
  }, 400);
}

async function refreshOrders(
  options: { skipNotify?: boolean; trigger?: string; showBoardLoader?: boolean } = {},
) {
  if (isRefreshing.value) return;
  isRefreshing.value = true;

  const previousIds = new Set<string>(orders.value.map((order) => order.id));

  try {
    const searchParam = searchQuery.value.trim() || undefined;
    const background = options.showBoardLoader !== true;
    if (searchParam) {
      await crmStore.fetchOrders({
        limit: 200,
        search: searchParam,
        background,
      });
    } else {
      await crmStore.fetchKanbanBoard({ limit: 200, background });
    }
    lastUpdateAt.value = new Date();

    if (options.skipNotify) {
      return;
    }

    const newOrders = orders.value.filter(
      (order) => !previousIds.has(order.id) && order.status === "new",
    );
    if (newOrders.length > 0) {
      handleNewOrders(newOrders);
    }
  } catch (error) {
    console.error("[CRM] Failed to refresh orders:", error);
  } finally {
    isRefreshing.value = false;
  }
}

function handleOrderCreated(order: Order) {
  showCreateModal.value = false;
  handleNewOrders([order]);
  void refreshOrders({ skipNotify: true });
}

async function handleOrderCreateShiftRequired(payload: {
  label: string;
  retry: () => Promise<boolean>;
}) {
  showCreateModal.value = false;
  await nextTick();
  await staffShiftBarRef.value?.requestShiftRequired(
    payload.label,
    async () => {
      showCreateModal.value = true;
      await nextTick();
      return payload.retry();
    },
  );
}

async function contactClient(orderId: string) {
  if (generatingMessageForOrder.value) return;

  generatingMessageForOrder.value = orderId;

  try {
    const data = await crmStore.generateOrderMessage(orderId);
    const { message, telegramUsername, telegramId } = data;

    const encoded = encodeURIComponent(message);
    if (telegramUsername) {
      window.open(`https://t.me/${telegramUsername}?text=${encoded}`, '_blank');
    } else if (telegramId) {
      window.open(`tg://openmessage?user_id=${telegramId}&text=${encoded}`, '_blank');
    } else {
      showOrderToast({ kind: 'error', message: 'У клиента нет Telegram.' });
    }
  } catch (error: any) {
    console.error('[CRM] Contact client error:', error);
    showOrderToast({ kind: 'error', message: 'Не удалось подготовить сообщение.' });
  } finally {
    generatingMessageForOrder.value = null;
  }
}

onMounted(async () => {
  void refreshUserbotStatus();
  userbotStatusTimer = setInterval(() => {
    void refreshUserbotStatus();
  }, 30_000);
  await refreshOrders({ skipNotify: true, trigger: 'initial', showBoardLoader: true });
  void loadPickupCells();
  if (cashAccounts.value.length === 0) {
    await crmStore.fetchCashAccounts();
  }
  unsubscribeOrderActivity = crmStore.subscribeOrderActivity((activitySince) => {
    if (!autoRefreshEnabled.value) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    if (pollActivityRefreshTimer) clearTimeout(pollActivityRefreshTimer);
    pollActivityRefreshTimer = setTimeout(() => {
      pollActivityRefreshTimer = null;
      void crmStore.syncKanbanBoardSince(activitySince);
    }, 800);
  });
  document.addEventListener('visibilitychange', handleVisibilityChange);
  // Don't auto-mark as seen - user should interact with orders to mark them seen

  // Unlock AudioContext on first user interaction (required for Safari)
  const unlockOnInteraction = () => {
    crmStore.unlockAudioContext();
    document.removeEventListener('click', unlockOnInteraction);
    document.removeEventListener('touchstart', unlockOnInteraction);
  };
  document.addEventListener('click', unlockOnInteraction, { once: true });
  document.addEventListener('touchstart', unlockOnInteraction, { once: true });

  // Close dropdowns on click outside
  document.addEventListener('click', handleClickOutside);
  window.addEventListener('scroll', handleInviterViewportChange, true);
  window.addEventListener('resize', handleInviterViewportChange);
});

onUnmounted(() => {
  if (userbotStatusTimer) {
    clearInterval(userbotStatusTimer);
    userbotStatusTimer = null;
  }
  if (unsubscribeOrderActivity) {
    unsubscribeOrderActivity();
    unsubscribeOrderActivity = null;
  }
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  if (highlightTimer) {
    clearTimeout(highlightTimer);
    highlightTimer = null;
  }
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }
  if (pollActivityRefreshTimer) {
    clearTimeout(pollActivityRefreshTimer);
    pollActivityRefreshTimer = null;
  }
  document.removeEventListener('click', handleClickOutside);
  window.removeEventListener('scroll', handleInviterViewportChange, true);
  window.removeEventListener('resize', handleInviterViewportChange);
});

function handleInviterViewportChange() {
  const orderId = activeInviterMenuOrderId.value;
  if (orderId) void closeInviterMenu(orderId, true);
}

function handleClickOutside(event: MouseEvent) {
  const target = event.target as Node;
  if (!(event.target as HTMLElement | null)?.closest('[data-inviter-menu]')) {
    activeInviterMenuOrderId.value = null;
  }
  if (settingsDropdownRef.value && !settingsDropdownRef.value.contains(target)) {
    settingsDropdownOpen.value = false;
  }
  if (moreDropdownRef.value && !moreDropdownRef.value.contains(target)) {
    moreDropdownOpen.value = false;
  }
}

function handleVisibilityChange() {
  if (!autoRefreshEnabled.value) return;
  if (document.visibilityState !== 'visible') return;
  void refreshOrders({ skipNotify: true });
}

function markOrderSeen(orderId: string) {
  crmStore.markOrderAsSeen(orderId);
}

// handleNewOrders, triggerBrowserNotification, playNotificationSound, ensureNotificationPermission
// moved to crm.ts store for global notifications

watch(profitUnlocked, (unlocked) => {
  if (!unlocked) {
    deliveredModalOpen.value = false;
    showPasswordModal.value = false;
    passwordInput.value = "";
    passwordError.value = "";
  }
});

// Серверная фильтрация доставленных заказов
let deliveredSearchTimer: ReturnType<typeof setTimeout> | null = null;

watch(() => deliveredFilter.value, (newFilter) => {
  if (deliveredModalOpen.value) {
    void crmStore.fetchDeliveredOrders({ limit: 30, period: newFilter, search: deliveredSearch.value.trim() || undefined });
  }
});

watch(() => deliveredSearch.value, () => {
  if (deliveredSearchTimer) clearTimeout(deliveredSearchTimer);
  deliveredSearchTimer = setTimeout(() => {
    if (deliveredModalOpen.value) {
      void crmStore.fetchDeliveredOrders({ limit: 30, period: deliveredFilter.value, search: deliveredSearch.value.trim() || undefined });
    }
  }, 400);
});

watch(autoRefreshEnabled, (enabled) => {
  if (!enabled) return;
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
  void refreshOrders({ skipNotify: true });
});

function openDeliveredModal(preset: DeliveredFilter = "all") {
  if (!profitUnlocked.value) {
    openPasswordModal();
    return;
  }
  deliveredFilter.value = preset;
  deliveredSearch.value = "";
  deliveredModalOpen.value = true;
  void crmStore.fetchDeliveredOrders({ limit: 30, period: preset });
}

function closeDeliveredModal() {
  deliveredModalOpen.value = false;
}

function loadMoreDelivered() {
  const p = deliveredPagination.value;
  if (!p || p.page >= p.totalPages) return;
  void crmStore.fetchDeliveredOrders({
    page: p.page + 1,
    limit: p.limit,
    period: deliveredFilter.value,
    search: deliveredSearch.value.trim() || undefined,
  });
}

function orderStatusLabel(
  status: Order["status"],
  deliveryType?: "pickup" | "delivery",
) {
  switch (status) {
    case "new":
      return "Новый";
    case "in_progress":
      return "Собран";
    case "delivered":
    case "completed":
      // Условные статусы: доставка → доставлена, самовывоз → выдан
      return deliveryType === "delivery" ? "Доставлена" : "Выдан";
    case "cancelled":
      return "Отменён";
    default:
      return status;
  }
}

// Discount modal functions
function openDiscountModal(order: Order) {
  discountOrder.value = order;
  discountAmount.value = order.discount_amount || 0;
  discountModalOpen.value = true;
}

function closeDiscountModal() {
  if (isApplyingDiscount.value) return;
  discountModalOpen.value = false;
  discountOrder.value = null;
  discountAmount.value = 0;
}

async function applyDiscount() {
  if (!discountOrder.value) return false;
  const activeOrder = discountOrder.value;
  isApplyingDiscount.value = true;
  try {
    await crmStore.updateOrder(activeOrder.id, {
      discount_amount: discountAmount.value,
      discount_percent: 0,
    });
    // Закрываем модалку напрямую
    discountModalOpen.value = false;
    discountOrder.value = null;
    discountAmount.value = 0;
    return true;
  } catch (error: any) {
    if (error?.code === "shift_required") {
      discountModalOpen.value = false;
      void staffShiftBarRef.value?.requestShiftRequired(
        `Изменить скидку заказа #${activeOrder.order_number}`,
        async () => {
          discountOrder.value = activeOrder;
          discountModalOpen.value = true;
          await nextTick();
          return applyDiscount();
        },
      );
      return false;
    }
    if (error?.outcomeUnknown) {
      discountModalOpen.value = false;
      showOrderToast({
        kind: "error",
        message: `Заказ #${activeOrder.order_number}: ответ не получен. Обновите доску перед повтором.`,
      });
      void refreshOrders({ skipNotify: true });
      return false;
    }
    const errorMessage = error?.message || "Не удалось применить скидку";
    showOrderToast({ kind: "error", message: `Заказ #${activeOrder.order_number}: ${errorMessage}` });
    return false;
  } finally {
    isApplyingDiscount.value = false;
  }
}

async function removeDiscount() {
  if (!discountOrder.value) return false;
  const activeOrder = discountOrder.value;
  isApplyingDiscount.value = true;
  try {
    await crmStore.updateOrder(activeOrder.id, {
      discount_amount: 0,
      discount_percent: 0,
    });
    // Закрываем модалку напрямую
    discountModalOpen.value = false;
    discountOrder.value = null;
    discountAmount.value = 0;
    return true;
  } catch (error: any) {
    if (error?.code === "shift_required") {
      discountModalOpen.value = false;
      void staffShiftBarRef.value?.requestShiftRequired(
        `Убрать скидку заказа #${activeOrder.order_number}`,
        async () => {
          discountOrder.value = activeOrder;
          discountModalOpen.value = true;
          await nextTick();
          return removeDiscount();
        },
      );
      return false;
    }
    if (error?.outcomeUnknown) {
      discountModalOpen.value = false;
      showOrderToast({
        kind: "error",
        message: `Заказ #${activeOrder.order_number}: ответ не получен. Обновите доску перед повтором.`,
      });
      void refreshOrders({ skipNotify: true });
      return false;
    }
    const errorMessage = error?.message || "Не удалось убрать скидку";
    showOrderToast({ kind: "error", message: `Заказ #${activeOrder.order_number}: ${errorMessage}` });
    return false;
  } finally {
    isApplyingDiscount.value = false;
  }
}

// Cancel order modal functions
function openCancelModal(order: Order) {
  cancelOrder.value = order;
  cancelModalOpen.value = true;
}

function closeCancelModal() {
  if (isCancelling.value) return;
  cancelModalOpen.value = false;
  cancelOrder.value = null;
}

async function confirmCancelOrder() {
  if (!cancelOrder.value) return false;
  const activeOrder = cancelOrder.value;
  isCancelling.value = true;
  try {
    await crmStore.updateOrder(activeOrder.id, { status: "cancelled" });
    void loadPickupCells();
    // Закрываем модалку напрямую
    cancelModalOpen.value = false;
    cancelOrder.value = null;
    return true;
  } catch (error: any) {
    if (error?.code === "shift_required") {
      cancelModalOpen.value = false;
      void staffShiftBarRef.value?.requestShiftRequired(
        `Отменить заказ #${activeOrder.order_number}`,
        async () => {
          cancelOrder.value = activeOrder;
          cancelModalOpen.value = true;
          await nextTick();
          return confirmCancelOrder();
        },
      );
      return false;
    }
    if (error?.outcomeUnknown) {
      cancelModalOpen.value = false;
      showOrderToast({
        kind: "error",
        message: `Заказ #${activeOrder.order_number}: ответ не получен. Обновите доску перед повтором.`,
      });
      void refreshOrders({ skipNotify: true });
      return false;
    }
    const errorMessage = error?.message || "Не удалось отменить заказ";
    showOrderToast({ kind: "error", message: `Заказ #${activeOrder.order_number}: ${errorMessage}` });
    return false;
  } finally {
    isCancelling.value = false;
  }
}
</script>

<style scoped>
.inviter-trigger,
.inviter-trigger:hover,
.inviter-trigger:focus,
.inviter-trigger:active {
  appearance: none !important;
  -webkit-appearance: none !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  outline: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
  -webkit-tap-highlight-color: transparent;
}

/* Toast notification animation */
.toast-slide-enter-active {
  animation: toast-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.toast-slide-leave-active {
  animation: toast-out 0.3s cubic-bezier(0.4, 0, 1, 1);
}

@keyframes toast-in {
  0% {
    opacity: 0;
    transform: translateX(100%) scale(0.8);
  }
  100% {
    opacity: 1;
    transform: translateX(0) scale(1);
  }
}

@keyframes toast-out {
  0% {
    opacity: 1;
    transform: translateX(0) scale(1);
  }
  100% {
    opacity: 0;
    transform: translateX(100%) scale(0.8);
  }
}
</style>
