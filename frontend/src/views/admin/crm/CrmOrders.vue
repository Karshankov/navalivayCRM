<template>
  <div class="crm-orders-page">
    <div class="crm-orders-content">
      <div
        v-if="userbotDisconnected"
        class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        role="status"
      >
        <span class="font-semibold">Автоуведомления отложены:</span>
        нет связи с Telegram. Отправим клиентам, когда канал восстановится.
      </div>
      <StaffShiftBar ref="staffShiftBarRef" />
      <div class="crm-orders-heading">
        <h1 class="crm-orders-title">Заказы</h1>
        <div class="crm-orders-search">
          <input
            v-model="searchQuery"
            type="search"
            placeholder="Ячейка 7, заказ #10456 или клиент..."
            class="crm-orders-search-input"
            aria-label="Поиск по ячейке, заказу или клиенту"
            @input="handleSearch"
          />
          <svg
            v-if="!searchQuery"
            class="crm-orders-search-icon"
            aria-hidden="true"
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

      </div>

      <div class="crm-orders-toolbar">
          <!-- Создать заказ -->
          <button
            @click="showCreateModal = true"
            class="crm-reference-button crm-reference-button--primary"
            data-test="orders-create"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            <span>Создать заказ</span>
          </button>

          <!-- Заблокировать клиента -->
          <button
            @click="openBlockModal()"
            class="crm-reference-button crm-reference-button--danger"
            data-test="orders-block"
            title="Заблокировать клиента по @username"
          >
            <NoSymbolIcon class="h-4 w-4" />
            <span>Заблокировать клиента</span>
          </button>
          <div class="crm-orders-disclosure" ref="moreDropdownRef" @keydown.esc.stop="moreDropdownOpen = false; moreDropdownRef?.querySelector('button')?.focus()">
            <button type="button" class="crm-reference-button crm-reference-button--gray" data-test="orders-actions-toggle" aria-controls="crm-orders-actions" :aria-expanded="moreDropdownOpen" @click.stop="moreDropdownOpen = !moreDropdownOpen">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M4 7h16M4 12h16M4 17h16" /></svg>
              <span>Действия с заказами</span>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" /></svg>
            </button>
            <div v-if="moreDropdownOpen" id="crm-orders-actions" class="crm-orders-menu crm-orders-actions-menu" @click.stop>
          <CrmButton
            variant="secondary"
            size="sm"
            @click="openCardPaymentsModal(); moreDropdownOpen = false"
          >
            <span>Оплата картой и лимиты</span>
          </CrmButton>

        <button
          type="button"
          class="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100"
          :aria-label="pickupCellsLoaded
            ? `Ячейки: занято ${pickupCells.occupied} из ${pickupCells.capacity}`
            : loadingPickupCells ? 'Ячейки: загружаются' : 'Ячейки: данные недоступны'"
          @click="openPickupCellsModal(); moreDropdownOpen = false"
        >
          <span>Ячейки</span>
          <span v-if="pickupCellsLoaded">{{ pickupCells.occupied }}/{{ pickupCells.capacity }}</span>
          <span v-else-if="loadingPickupCells">…/…</span>
          <span v-else>—/—</span>
        </button>
          <!-- Заметка на клиента -->
          <button
            @click="openNoteModal(); moreDropdownOpen = false"
            class="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-700 shadow-sm transition-all duration-200 hover:bg-sky-100"
            title="Заметка на клиента по @username"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 8h10M7 12h6m-6 8l-2 4 4-2h8a2 2 0 002-2V6a2 2 0 00-2-2H7a2 2 0 00-2 2v12z" />
            </svg>
            <span>Заметка на клиента</span>
          </button>

          <!-- Отмененные -->
          <button
            v-if="cancelledOrders.length"
            @click="cancelledModalOpen = true; moreDropdownOpen = false"
            class="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-red-200 bg-gradient-to-r from-red-50 to-rose-50 px-3 py-2 text-sm font-medium text-red-600 shadow-sm transition-all duration-200 hover:from-red-100 hover:to-rose-100"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
            <span>Отмененные</span>
          </button>

          <!-- Выданные (запаролено) -->
          <button
            @click="profitUnlocked ? openDeliveredModal('today') : openPasswordModal(); moreDropdownOpen = false"
            class="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-green-50 px-3 py-2 text-sm font-medium text-emerald-600 shadow-sm transition-all duration-200 hover:from-emerald-100 hover:to-green-100"
          >
            <LockClosedIcon v-if="!profitUnlocked" class="h-4 w-4" />
            <svg v-else class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
            <span>Выданные</span>
          </button>

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
          </div>
          <button
            type="button"
            class="crm-card-limit"
            :class="{
              'crm-card-limit--exhausted': toolbarCardLimitState === 'ready' && toolbarCardLimits?.remaining_today_minor === 0,
              'crm-card-limit--unavailable': toolbarCardLimitState === 'error' || toolbarCardLimitState === 'unavailable',
              'crm-card-limit--has-requests': toolbarCardNewRequestCount > 0,
            }"
            data-test="orders-card-limit"
            :aria-busy="refreshingCardLimit || crmStore.loadingCardPaymentAdmin"
            :aria-label="(toolbarCardLimitState === 'ready'
              ? `По карте сегодня осталось ${toolbarCardRemaining}. Открыть оплату картой и лимиты`
              : `${toolbarCardLimitMessage}. Открыть оплату картой и лимиты`)
              + (toolbarCardNewRequestCount > 0 ? `. Новых заявок на увеличение лимита: ${toolbarCardNewRequestCount}` : '')"
            title="Оплата картой и лимиты · остаток учитывает выданные оплаты и резервы"
            @click="openCardPaymentsModal()"
          >
            <span
              v-if="toolbarCardNewRequestCount > 0"
              class="crm-card-limit-request-badge"
              data-test="orders-card-limit-request-count"
              aria-hidden="true"
            >{{ toolbarCardNewRequestCount }}</span>
            <svg class="crm-card-limit-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
              <rect x="3" y="5" width="18" height="14" rx="3" />
              <path d="M3 10h18M7 15h3" stroke-linecap="round" />
            </svg>
            <span class="crm-card-limit-content">
              <span class="crm-card-limit-caption">Карта · сегодня</span>
              <span class="crm-card-limit-summary">
                <strong v-if="toolbarCardLimitState === 'ready'" data-test="orders-card-limit-remaining">{{ toolbarCardRemaining }}</strong>
                <span>{{ toolbarCardLimitMessage }}</span>
              </span>
              <span
                v-if="toolbarCardLimitState === 'ready'"
                class="crm-card-limit-track"
                role="progressbar"
                aria-label="Свободная доля дневного лимита оплаты картой"
                aria-valuemin="0"
                aria-valuemax="100"
                :aria-valuenow="Math.round(toolbarCardRemainingPercent)"
                :aria-valuetext="`${toolbarCardRemaining} осталось на сегодня`"
              ><span :style="{ width: `${toolbarCardRemainingPercent}%` }" /></span>
              <span v-else class="crm-card-limit-track crm-card-limit-track--unknown" aria-hidden="true" />
            </span>
          </button>
        <span class="crm-orders-toolbar-spacer" aria-hidden="true" />
          <!-- Обновить -->
          <CrmButton
            class="crm-reference-button crm-reference-button--gray"
            variant="secondary"
            size="sm"
            refresh-icon
            :loading="isRefreshing"
            loading-label="Обновляем..."
            @click="deferClick(() => refreshOrders())"
          >
            <span>Обновить</span>
          </CrmButton>

          <!-- Dropdown: Настройки -->
          <div class="crm-orders-disclosure crm-orders-other" ref="settingsDropdownRef" @keydown.esc.stop="settingsDropdownOpen = false; settingsDropdownRef?.querySelector('button')?.focus()">
            <button
              type="button"
              @click.stop="settingsDropdownOpen = !settingsDropdownOpen"
              title="Остальное"
              aria-controls="crm-orders-settings"
              :aria-expanded="settingsDropdownOpen"
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
              <span>Остальное</span>
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
                id="crm-orders-settings"
                class="crm-orders-menu"
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
          class="crm-orders-draw"
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
        <div class="crm-orders-board">
          <section
            v-for="column in kanbanColumns"
            :key="column.key"
            class="crm-orders-column"
            :data-column="column.key"
          >
            <header class="crm-orders-column-header">
              <div class="flex items-center justify-between">
                <div>
                  <div class="flex items-center gap-2">
                    <h2 class="crm-orders-column-title">
                      <span aria-hidden="true">{{ column.key === 'action_required' ? '◷' : column.key === 'new' ? '⬡' : '◎' }}</span>
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
              class="crm-orders-column-body"
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
              <div v-if="column.orders.length === 0" class="crm-orders-empty">
                <span class="crm-orders-empty-symbol" aria-hidden="true">{{ column.key === 'in_progress' ? '⬡' : '▤' }}</span>
                <b>Нет заказов в этом статусе</b>
                <span>{{ column.key === 'action_required' ? 'Здесь появятся заказы, требующие вашего внимания' : column.key === 'in_progress' ? 'Здесь появятся собранные заказы, готовые к выдаче клиенту' : 'Здесь появятся новые заказы, которые необходимо собрать' }}</span>
              </div>

              <article
                v-for="order in column.orders"
                :key="order.id"
                class="order-card cursor-grab border border-gray-200 bg-white transition active:cursor-grabbing"
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
                <div class="order-card-crown">
                  <span class="order-card-cell" :aria-label="order.pickup_cell_number ? `Ячейка ${order.pickup_cell_number}` : `Заказ ${order.order_number}`" :title="order.pickup_cell_number ? `Ячейка ${order.pickup_cell_number}` : 'Ячейка пока не назначена'" data-test="order-cell">{{ order.pickup_cell_number || `#${order.order_number}` }}</span>
                  <span
                    v-if="!order.is_blocked && order.is_returning_customer !== undefined && !order.is_returning_customer"
                    class="order-card-first"
                    title="Первый заказ клиента — обратить внимание"
                  >Первый заказ</span>
                  <button
                    v-if="!order.needs_manager_action"
                    type="button"
                    class="order-card-cancel"
                    data-test="order-cancel"
                    title="Отменить заказ"
                    :aria-label="`Отменить заказ #${order.order_number}`"
                    @click.stop="openCancelModal(order)"
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
                <div class="order-card-status">
                  <span v-if="!order.pickup_cell_number && order.status === 'in_progress'" class="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">Без ячейки · старый заказ</span>
                  <span v-if="order.needs_manager_action && order.manager_action_type === 'modified'" class="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700">Изменен покупателем</span>
                  <span v-else-if="order.needs_manager_action && order.manager_action_type === 'cancelled_by_customer'" class="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">Отменен покупателем</span>
                  <span v-else-if="order.auto_notification?.status === 'pending_retry'" class="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800" :title="order.auto_notification?.error || 'Нет связи с Telegram, уведомление в очереди'">Отложено</span>
                  <span v-else-if="order.auto_notification?.status === 'failed'" class="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700" :title="order.auto_notification?.error || 'Уведомление клиенту не доставлено'">Не дошло клиенту</span>
                  <span v-else-if="order.auto_notification?.warn" class="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700" :title="order.auto_notification?.warn">Могло не дойти</span>
                </div>

                <div class="order-card-customer space-y-2 text-sm text-gray-700">
                  <div class="order-card-client-row">
                    <span class="order-card-client-name" data-test="order-customer-name">{{ order.customer_name || 'Без имени' }}</span>
                    <button
                      type="button"
                      class="order-card-client-actions"
                      data-test="order-customer-actions"
                      aria-haspopup="dialog"
                      :aria-expanded="showCustomerActionsModal && customerActionsOrderId === order.id"
                      :disabled="Boolean(generatingMessageForOrder)"
                      @click.stop="openCustomerActions(order)"
                    >{{ generatingMessageForOrder === order.id ? 'Подготавливаем…' : 'Действия с клиентом' }}</button>
                  </div>
                  <div v-if="order.customer_card_payment_enabled || order.is_blocked" class="order-card-client-flags">
                    <span v-if="order.customer_card_payment_enabled" class="order-card-card-access" data-test="order-card-card-access" title="Клиенту разрешена оплата картой">
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
                        <rect x="3" y="5" width="18" height="14" rx="3" />
                        <path stroke-linecap="round" d="M3 10h18M7 15h3" />
                      </svg>
                      <span>Карта разрешена</span>
                    </span>
                    <span v-if="order.is_blocked" class="rounded-full bg-red-200 px-2 py-0.5 text-[10px] font-semibold text-red-800" title="Клиент заблокирован. Сообщения не отправляются.">Заблокирован</span>
                  </div>
                  <div
                    v-if="!order.referral?.inviter_username && order.access_authorization?.access_authorization_source === 'staff'"
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
                  class="order-card-products text-xs text-gray-600"
                >
                  <li v-for="(item, index) in previewItems(order)" :key="item.id" class="flex min-w-0 gap-2">
                    <span class="flex-shrink-0 font-medium text-gray-400">{{ index + 1 }}.</span>
                    <div class="flex-1">
                      <div>
                        <span
                          v-if="item.group_name"
                          class="font-semibold text-blue-600"
                        >{{ item.group_name }}</span
                        >{{ item.group_name ? " - " : "" }}<span :class="!item.group_name ? 'font-semibold text-blue-600' : ''">{{ item.base_product_title || item.product_title }}</span>{{ item.variant_name ? " - " + item.variant_name : "" }}
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

                <div class="order-card-bottom space-y-3">
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
                  <!-- Сумма, способ оплаты и существующие действия заказа -->
                  <div class="order-card-finance">
                    <div class="order-card-footer">
                      <div class="order-card-price">
                        <button
                          type="button"
                          data-test="order-total"
                          class="order-card-total"
                          title="Изменить стоимость заказа"
                          :aria-label="'Изменить стоимость заказа. Итого ' + formatCurrency(order.final_amount)"
                          @click.stop="openDiscountModal(order)"
                        >
                          <span v-if="getOrderTotalDiscount(order) > 0" class="order-card-original-total">{{ formatCurrency(order.total_amount) }}</span>
                          <span>{{ formatCurrency(order.final_amount) }}</span>
                        </button>
                        <span v-if="order.payment_type === 'card'" class="order-card-payment order-card-payment--card">Оплата картой</span>
                        <span v-else-if="order.payment_type === 'cash'" class="order-card-payment order-card-payment--cash">Оплата наличными</span>
                      </div>
                  <!-- Кнопки resolve для action_required -->
                  <div v-if="order.needs_manager_action" class="order-card-controls">
                    <button
                      @click.stop="viewOrder(order.id)"
                      type="button" class="order-card-button order-card-button--details"
                    >
                      Подробнее
                    </button>
                    <button
                      v-if="order.manager_action_type === 'modified'"
                      @click.stop="deferClick(() => { void handleResolveAction(order) })"
                      :disabled="resolvingOrderId === order.id"
                      type="button" class="order-card-button bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-60"
                    >
                      {{ resolvingOrderId === order.id ? 'Обработка...' : 'Принять изменения' }}
                    </button>
                    <button
                      v-else-if="order.manager_action_type === 'cancelled_by_customer'"
                      @click.stop="deferClick(() => { void handleResolveAction(order) })"
                      :disabled="resolvingOrderId === order.id"
                      type="button" class="order-card-button order-card-button--danger bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
                    >
                      {{ resolvingOrderId === order.id ? 'Обработка...' : 'Разобрать' }}
                    </button>
                  </div>
                  <!-- Обычные кнопки -->
                  <div v-else class="order-card-controls">
                    <button
                      @click.stop="viewOrder(order.id)"
                      type="button" class="order-card-button order-card-button--details"
                    >
                      Подробнее
                    </button>
                    <button
                      v-if="canAdvance(order)"
                      @click.stop="deferClick(() => { void advanceOrder(order) })"
                      :disabled="updatingOrderId === order.id"
                      type="button" class="order-card-button admin-link-button admin-link-button--compact"
                      :class="advanceButtonClass(order)"
                    >
                      {{ updatingOrderId === order.id ? 'Назначаем ячейку...' : nextStatusLabel(order.status) }}
                    </button>
                  </div>
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
                    <div class="order-card-metadata" data-test="order-card-metadata">
                      <span data-test="order-number">#{{ order.order_number }}</span>
                      <span data-test="order-created-at">{{ formatDate(order.created_at) }}</span>
                    </div>
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

    <CustomerActionsModal
      :is-open="showCustomerActionsModal"
      :order="customerActionsOrder"
      :busy="Boolean(generatingMessageForOrder || removingInviterBanId || sendingInviterMessage)"
      @close="closeCustomerActions"
      @action="queueCustomerAction"
      @inviter-action="queueInviterAction"
      @after-leave="runQueuedCustomerAction"
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

    <!-- Стоимость заказа: скидка и отдельная надбавка -->
    <AdminModal
      :isOpen="discountModalOpen && !!discountOrder"
      :title="discountOrder ? `Стоимость заказа #${discountOrder.order_number}` : 'Стоимость заказа'"
      description="Скидка уменьшает сумму, добавочная стоимость увеличивает её."
      size="md"
      reference-design
      :is-loading="isApplyingDiscount"
      :showActions="false"
      @close="closeDiscountModal"
      @cancel="closeDiscountModal"
    >
      <form class="crm-order-price" data-test="order-price-form" novalidate @submit.prevent="applyDiscount">
        <div class="crm-order-price-base">
          <span>Стоимость товаров со скидками по позициям</span>
          <strong>{{ formatCurrency(orderPriceSubtotal) }}</strong>
        </div>
        <fieldset class="crm-order-price-fields" :disabled="isApplyingDiscount">
          <div class="crm-order-price-field">
            <label for="order-price-discount">Скидка на заказ <span>BYN</span></label>
            <input id="order-price-discount" v-model.number="discountAmount" type="number" min="0"
              :max="orderPriceSubtotal" step="0.01" inputmode="decimal" placeholder="0"
              :aria-invalid="!!orderPriceValidation" aria-describedby="order-price-discount-hint order-price-validation" />
            <p id="order-price-discount-hint">Вычитается из стоимости товаров.</p>
          </div>
          <div class="crm-order-price-field">
            <label for="order-price-additional">Добавочная стоимость <span>BYN</span></label>
            <input id="order-price-additional" v-model.number="additionalCost" type="number" min="0"
              max="999999999.99" step="0.01" inputmode="decimal" placeholder="0" :disabled="orderPriceAdditionalLocked"
              :aria-invalid="!!orderPriceValidation" aria-describedby="order-price-additional-hint order-price-validation" />
            <p id="order-price-additional-hint">{{ orderPriceAdditionalLocked
              ? 'Для изменения надбавки сначала отмените оплату заказа.'
              : 'Добавляется после скидок и целиком увеличивает прибыль.' }}</p>
          </div>
        </fieldset>
        <p v-if="discountPercent > 0" class="crm-order-price-hint">Сохранена скидка {{ discountPercent }}% на товары после скидки в BYN.</p>
        <div class="crm-order-price-result" aria-live="polite" aria-atomic="true">
          <div><span>Итого к оплате</span><strong data-test="order-price-preview">{{ orderPriceValidation ? '—' : formatCurrency(orderPriceFinal) }}</strong></div>
          <p v-if="!orderPriceValidation && Number(additionalCost) > 0">Включая добавочную стоимость +{{ formatCurrency(Number(additionalCost)) }}</p>
        </div>
        <p v-if="orderPriceValidation" id="order-price-validation" class="crm-order-price-error" role="alert">{{ orderPriceValidation }}</p>
        <p v-else id="order-price-validation" class="crm-order-price-hint">Чтобы убрать добавочную стоимость, укажите 0.</p>
        <p v-if="orderPriceError" class="crm-order-price-error" role="alert">{{ orderPriceError }}</p>
        <div class="crm-order-price-actions">
          <button v-if="Number(discountOrder?.discount_amount) > 0 || Number(discountOrder?.discount_percent) > 0"
            type="button" class="crm-order-price-reset" :disabled="isApplyingDiscount || !!orderPriceValidation" @click="removeDiscount">Убрать скидку</button>
          <div class="crm-order-price-main-actions">
            <button type="button" class="crm-order-price-secondary" :disabled="isApplyingDiscount" @click="closeDiscountModal">Отмена</button>
            <button type="submit" class="crm-order-price-primary" data-test="order-price-save" :disabled="isApplyingDiscount || !!orderPriceValidation">{{ isApplyingDiscount ? 'Сохраняем…' : 'Сохранить' }}</button>
          </div>
        </div>
      </form>
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
import CustomerActionsModal, { type CustomerAction, type InviterAction } from "@/components/admin/crm/CustomerActionsModal.vue";
import { LockClosedIcon, NoSymbolIcon } from "@heroicons/vue/24/outline";
import { buildAutoNotifyToast } from "@/utils/auto-notify-message";
import CrmProfitPasswordField from "@/components/crm/CrmProfitPasswordField.vue";
import StaffCurrentActorBadge from "@/components/admin/staff/StaffCurrentActorBadge.vue";
import StaffShiftBar from "@/components/admin/staff/StaffShiftBar.vue";
import CardPaymentsModal from "@/components/admin/crm/CardPaymentsModal.vue";
import { getBusinessDateParts } from "@/utils/businessTime";

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
const showCustomerActionsModal = ref(false);
const customerActionsOrderId = ref<string | null>(null);
const customerActionsOrder = computed(() =>
  orders.value.find((order) => order.id === customerActionsOrderId.value) || null,
);
const pendingCustomerAction = ref<{
  action: CustomerAction | InviterAction;
  target?: 'inviter';
  inviterCustomerId?: string | null;
  inviterUsername?: string;
  inviterBanId?: string | null;
  orderId: string;
  customerId: string | null;
  username: string;
} | null>(null);

function openCustomerActions(order: Order) {
  if (generatingMessageForOrder.value || showCustomerActionsModal.value || pendingCustomerAction.value) return;
  customerActionsOrderId.value = order.id;
  showCustomerActionsModal.value = true;
}

function closeCustomerActions() {
  pendingCustomerAction.value = null;
  showCustomerActionsModal.value = false;
}

function queueCustomerAction(action: CustomerAction) {
  const order = customerActionsOrder.value;
  if (!showCustomerActionsModal.value || !order || generatingMessageForOrder.value || pendingCustomerAction.value) return;
  if ((action === 'block' || action === 'invite-ban') && !order.customer_id && !order.telegram_username) return;
  if (action === 'block' && order.is_blocked) return;
  if (action === 'note' && !order.customer_id) return;
  if (action === 'contact' && !order.telegram_username && !order.customer_telegram_id) return;
  pendingCustomerAction.value = {
    action,
    orderId: order.id,
    customerId: order.customer_id,
    username: order.telegram_username || '',
  };
  showCustomerActionsModal.value = false;
}

function queueInviterAction(action: InviterAction) {
  const order = customerActionsOrder.value;
  const referral = order?.referral;
  if (!showCustomerActionsModal.value || !order || !referral?.inviter_username || pendingCustomerAction.value || generatingMessageForOrder.value || removingInviterBanId.value || sendingInviterMessage.value) return;
  if (action === 'message' && !referral.inviter_customer_id) return;
  if (action === 'remove-ban' && (!referral.inviter_is_invite_banned || !referral.inviter_invite_ban_id)) return;
  if (action === 'invite-ban' && referral.inviter_is_invite_banned) return;
  pendingCustomerAction.value = { action, target: 'inviter', orderId: order.id, customerId: order.customer_id, username: order.telegram_username || '', inviterCustomerId: referral.inviter_customer_id || null, inviterUsername: referral.inviter_username, inviterBanId: referral.inviter_invite_ban_id || null };
  showCustomerActionsModal.value = false;
}

async function runQueuedCustomerAction() {
  const pending = pendingCustomerAction.value;
  pendingCustomerAction.value = null;
  customerActionsOrderId.value = null;
  if (!pending) return;
  // The first dialog must finish restoring focus before the existing dialog opens.
  await nextTick();
  const order = orders.value.find((item) => item.id === pending.orderId);
  if (!order || order.customer_id !== pending.customerId ||
      (!pending.customerId && (order.telegram_username || '') !== pending.username)) {
    showOrderToast({ kind: 'error', message: 'Данные заказа изменились. Откройте действия клиента заново.' });
    return;
  }
  if (pending.target === 'inviter') {
    const referral = order.referral;
    if (!referral?.inviter_username || (referral.inviter_customer_id || null) !== pending.inviterCustomerId || (!pending.inviterCustomerId && referral.inviter_username !== pending.inviterUsername)) {
      showOrderToast({ kind: 'error', message: 'Пригласивший изменился. Откройте действия клиента заново.' });
      return;
    }
    if (pending.action === 'copy') await copyInviter(order);
    else if (pending.action === 'message' && referral.inviter_customer_id) openInviterMessage(order);
    else if (pending.action === 'block') openInviterBlockModal(order);
    else if (pending.action === 'invite-ban' && !referral.inviter_is_invite_banned) openInviteBanModal(order);
    else if (pending.action === 'remove-ban' && referral.inviter_is_invite_banned && (referral.inviter_invite_ban_id || null) === pending.inviterBanId) await removeInviterBan(order);
    return;
  }
  if (pending.action === 'block') {
    if (!order.is_blocked) openBlockModal(order.telegram_username, order.customer_id);
  } else if (pending.action === 'invite-ban') {
    inviteBanCustomerId.value = order.customer_id;
    inviteBanUsername.value = order.telegram_username || '';
    showInviteBanModal.value = true;
  } else if (pending.action === 'note') {
    openNoteModalForOrder(order);
  } else if (pending.action === 'contact') {
    await contactClient(order.id);
  }
}

// Модалка блокировки клиента
const showBlockModal = ref(false);
const blockPrefillUsername = ref<string>('');
const blockCustomerId = ref<string | null>(null);
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

async function copyInviter(order: Order) {
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
}

function openInviterBlockModal(order: Order) {
  openBlockModal(
    order.referral?.inviter_username || '',
    order.referral?.inviter_customer_id || null,
  );
}

function openInviteBanModal(order: Order) {
  inviteBanCustomerId.value = order.referral?.inviter_customer_id || null;
  inviteBanUsername.value = order.referral?.inviter_username || '';
  showInviteBanModal.value = true;
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
  await refreshOrders({ skipNotify: true });
}

function openInviterMessage(order: Order) {
  inviterMessageCustomerId.value = order.referral?.inviter_customer_id || null;
  inviterMessageUsername.value = order.referral?.inviter_username || '';
  inviterMessageText.value = '';
  showInviterMessageModal.value = true;
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
const cardLimitRefreshError = ref(false);
const refreshingCardLimit = ref(false);
let cardLimitTimer: ReturnType<typeof setInterval> | null = null;
let cardLimitDisposed = false;

function currentCardBusinessDate() {
  const { year, month, day } = getBusinessDateParts();
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
const cardLimitBusinessDate = ref(currentCardBusinessDate());
// Считаем необработанные заявки, а не непросмотренные уведомления.
const toolbarCardNewRequestCount = computed(() =>
  crmStore.cardPaymentAdminSnapshot?.requests?.filter((request) => request.status === "new").length || 0,
);
const toolbarCardLimits = computed(() => {
  const limits = crmStore.cardPaymentAdminSnapshot?.limits;
  if (!limits || limits.business_date !== cardLimitBusinessDate.value) return null;
  if (![limits.daily_limit_minor, limits.remaining_today_minor].every(
    (amount) => Number.isSafeInteger(amount) && amount >= 0,
  )) return null;
  return limits;
});
const toolbarCardLimitState = computed(() => {
  if (cardLimitRefreshError.value) return "error";
  if (toolbarCardLimits.value) return "ready";
  if (refreshingCardLimit.value || crmStore.loadingCardPaymentAdmin) return "loading";
  return "unavailable";
});
const toolbarCardRemaining = computed(() => {
  const minor = toolbarCardLimits.value?.remaining_today_minor;
  if (minor == null) return "";
  return `${new Intl.NumberFormat("ru-BY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100)} BYN`;
});
// Только визуальная доля свободного лимита; сумму и финансовые правила отдаёт сервер.
const toolbarCardRemainingPercent = computed(() => {
  const limits = toolbarCardLimits.value;
  if (!limits || limits.daily_limit_minor <= 0) return 0;
  return Math.min(100, Math.max(0,
    limits.remaining_today_minor / limits.daily_limit_minor * 100,
  ));
});
const toolbarCardLimitMessage = computed(() => {
  if (toolbarCardLimitState.value === "loading") return "Загружаем лимит…";
  if (toolbarCardLimitState.value !== "ready") return "Лимит недоступен";
  return toolbarCardLimits.value?.remaining_today_minor === 0
    ? "Лимит исчерпан" : "осталось";
});

async function refreshToolbarCardLimit() {
  if (cardLimitDisposed) return;
  cardLimitBusinessDate.value = currentCardBusinessDate();
  // Не мешаем загрузке и сохранению в существующем окне лимитов.
  if (cardPaymentsModalOpen.value || refreshingCardLimit.value || crmStore.loadingCardPaymentAdmin) return;
  if (document.visibilityState !== "visible") return;
  refreshingCardLimit.value = true;
  try {
    const previousSnapshot = crmStore.cardPaymentAdminSnapshot;
    await crmStore.fetchCardPaymentAdmin({
      background: true,
      shouldApply: () => !cardLimitDisposed && !cardPaymentsModalOpen.value
        && crmStore.cardPaymentAdminSnapshot === previousSnapshot,
    });
    if (!cardLimitDisposed) {
      cardLimitBusinessDate.value = currentCardBusinessDate();
      cardLimitRefreshError.value = false;
    }
  } catch {
    if (!cardLimitDisposed) cardLimitRefreshError.value = true;
  } finally {
    if (!cardLimitDisposed) refreshingCardLimit.value = false;
  }
}

watch(() => crmStore.cardPaymentAdminSnapshot, (snapshot) => {
  if (!snapshot) return;
  cardLimitBusinessDate.value = currentCardBusinessDate();
  cardLimitRefreshError.value = false;
});
watch(cardPaymentsModalOpen, (open) => {
  if (!open) void refreshToolbarCardLimit();
});

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
    Number(order.total_amount || 0) + Number(order.additional_cost || 0) - Number(order.final_amount || 0),
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
const discountAmount = ref<number | string>(0);
const discountPercent = ref(0);
const additionalCost = ref<number | string>(0);
const orderPriceError = ref("");
const isApplyingDiscount = ref(false);
let orderPriceGeneration = 0;
const orderPriceAdditionalLocked = computed(() => {
  const order = crmStore.orders.find(item => item.id === discountOrder.value?.id) || discountOrder.value;
  return Number(order?.paid_amount || 0) > 0 || order?.status === "delivered";
});
const orderPriceSubtotal = computed(() => {
  const order = discountOrder.value;
  if (!order) return 0;
  return order.items?.length
    ? Math.round(order.items.reduce((sum, item) => sum + Number(item.total_price || 0), 0) * 100) / 100
    : Number(order.total_amount || 0);
});
const orderPriceValidation = computed(() => {
  const discount = Number(discountAmount.value);
  const extra = Number(additionalCost.value);
  const validMoney = (value: number | string, amount: number) => String(value).trim() !== ""
    && Number.isFinite(amount) && amount >= 0 && amount <= 999999999.99
    && Math.abs(amount * 100 - Math.round(amount * 100)) < 0.00001;
  if (!validMoney(discountAmount.value, discount) || discount > orderPriceSubtotal.value)
    return "Скидка: сумма от 0 до стоимости товаров, с точностью до копеек.";
  if (!validMoney(additionalCost.value, extra))
    return "Добавочная стоимость: неотрицательная сумма с точностью до копеек.";
  return "";
});
const orderPriceFinal = computed(() => Math.round((
  Math.max(0, orderPriceSubtotal.value - Number(discountAmount.value))
  * (1 - discountPercent.value / 100) + Number(additionalCost.value)
) * 100) / 100);

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
  void refreshToolbarCardLimit();
  cardLimitTimer = setInterval(() => { void refreshToolbarCardLimit(); }, 30_000);
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
});

onUnmounted(() => {
  cardLimitDisposed = true;
  if (cardLimitTimer) {
    clearInterval(cardLimitTimer);
    cardLimitTimer = null;
  }
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
});

function handleClickOutside(event: MouseEvent) {
  const target = event.target as Node;
  if (settingsDropdownRef.value && !settingsDropdownRef.value.contains(target)) {
    settingsDropdownOpen.value = false;
  }
  if (moreDropdownRef.value && !moreDropdownRef.value.contains(target)) {
    moreDropdownOpen.value = false;
  }
}

function handleVisibilityChange() {
  if (document.visibilityState !== 'visible') return;
  void refreshToolbarCardLimit();
  if (!autoRefreshEnabled.value) return;
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

// Стоимость заказа: сохраняем абсолютные значения, безопасные при повторе.
function openDiscountModal(order: Order) {
  if (isApplyingDiscount.value) return;
  orderPriceGeneration++;
  discountOrder.value = order;
  discountAmount.value = Number(order.discount_amount || 0);
  discountPercent.value = Number(order.discount_percent || 0);
  additionalCost.value = Number(order.additional_cost || 0);
  orderPriceError.value = "";
  discountModalOpen.value = true;
}

function closeDiscountModal() {
  if (isApplyingDiscount.value) return;
  orderPriceGeneration++;
  resetOrderPriceModal();
}

function resetOrderPriceModal() {
  discountModalOpen.value = false;
  discountOrder.value = null;
  discountAmount.value = 0;
  discountPercent.value = 0;
  additionalCost.value = 0;
  orderPriceError.value = "";
}

async function applyDiscount() {
  if (!discountOrder.value || isApplyingDiscount.value || orderPriceValidation.value) return false;
  const activeOrder = discountOrder.value;
  const generation = orderPriceGeneration;
  const values = {
    discount_amount: Number(discountAmount.value),
    discount_percent: discountPercent.value,
    additional_cost: Number(additionalCost.value),
  };
  orderPriceError.value = "";
  isApplyingDiscount.value = true;
  try {
    await crmStore.updateOrder(activeOrder.id, values);
    resetOrderPriceModal();
    return true;
  } catch (error: any) {
    if (error?.code === "shift_required") {
      discountModalOpen.value = false;
      void staffShiftBarRef.value?.requestShiftRequired(
        `Изменить стоимость заказа #${activeOrder.order_number}`,
        async () => {
          if (generation !== orderPriceGeneration) return false;
          discountOrder.value = activeOrder;
          discountAmount.value = values.discount_amount;
          discountPercent.value = values.discount_percent;
          additionalCost.value = values.additional_cost;
          discountModalOpen.value = true;
          await nextTick();
          return applyDiscount();
        },
      );
      return false;
    }
    if (error?.outcomeUnknown) {
      resetOrderPriceModal();
      showOrderToast({ kind: "error", message: `Заказ #${activeOrder.order_number}: ответ не получен. Обновите доску перед повтором.` });
      void refreshOrders({ skipNotify: true });
      return false;
    }
    orderPriceError.value = error?.code === "order_price_locked" || error?.message === "order_price_locked"
      ? "Для изменения надбавки сначала отмените оплату заказа."
      : error?.message || "Не удалось сохранить стоимость. Попробуйте ещё раз.";
    return false;
  } finally {
    isApplyingDiscount.value = false;
  }
}

async function removeDiscount() {
  if (!discountOrder.value || isApplyingDiscount.value || orderPriceValidation.value) return false;
  discountAmount.value = 0;
  discountPercent.value = 0;
  return applyDiscount();
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

<style src="@/styles/crm-orders-reference.css"></style>

<style scoped>
.order-card {
  --order-primary: linear-gradient(100deg, #05b8ff, #185dff);
  --order-danger: linear-gradient(115deg, #ff685a, #fa104f);
  position: relative;
  min-width: 0;
  margin-top: 38px;
  padding: 36px 18px 17px;
  border-style: solid;
  border-width: 1.5px;
  border-color: #ffc72e;
  border-radius: 13px;
  box-shadow: 0 6px 19px #455f7a0a;
  color: #081b4b;
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
  container-type: inline-size;
}
/* Preserve the existing semantic borders and rings for exceptional orders. */
.order-card.border-rose-200 { border-color: #fecdd3; }
.order-card.border-amber-300 { border-color: #fcd34d; }
.order-card.border-amber-200 { border-color: #fde68a; }
.order-card.border-red-300 { border-color: #fca5a5; }
.order-card.border-orange-300 { border-color: #fdba74; }
.order-card + .order-card { margin-top: 38px; }
.order-card-crown { position: absolute; top: -17px; left: 14px; right: 11px; display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: start; gap: 6px; }
.order-card-cell { grid-column: 1; justify-self: start; max-width: 100%; margin-top: 2px; padding: 8px 15px; border-radius: 12px; background: linear-gradient(145deg, #09265c, #06143b); box-shadow: 0 6px 13px #0a1e4033; color: #fff; font-size: 20px; line-height: 1.2; font-weight: 850; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.order-card-first { grid-column: 2; align-self: start; margin-top: 2px; padding: 7px 14px; border-radius: 30px; background: var(--order-danger); box-shadow: 0 8px 13px #fb456038; color: #fff; font-size: 11px; line-height: 1.2; font-weight: 750; white-space: nowrap; transform: translateX(-1.5px); }
.order-card-cancel { grid-column: 3; justify-self: end; display: grid; place-items: center; width: 35px; height: 35px; border: 0; border-radius: 10px; background: var(--order-danger); color: #fff; cursor: pointer; }
.order-card-cancel svg { width: 19px; height: 19px; }
.order-card-cancel:hover { filter: brightness(1.08); }
.order-card-status { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 8px; }
.order-card-status:empty { display: none; }
.order-card-metadata { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; min-width: 0; margin-top: 6px; color: #66799e; font-size: 9px; line-height: 1.2; font-weight: 400; overflow-wrap: anywhere; }
.order-card-client-row { display: flex; flex-wrap: wrap; align-items: center; gap: 11px; margin: 1px 0 13px; }
.order-card-client-name { min-width: 0; color: #081b4b; font-size: 23px; font-weight: 800; letter-spacing: -.03em; line-height: 1.2; overflow-wrap: anywhere; }
.order-card-client-actions { max-width: 100%; min-height: 34px; padding: 9px 10px; border: 1px solid #dce8fa; border-radius: 9px; background: #f7fbff; color: #152d69; font-size: 11px; line-height: normal; font-weight: 700; cursor: pointer; }
.order-card-client-actions:hover { background: #edf5ff; border-color: #b8cef5; }
.order-card-customer, .order-card-finance { min-width: 0; overflow-wrap: anywhere; }
.order-card-customer { color: #081b4b; }
.order-card-client-flags { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
.order-card-card-access { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 5px 8px; border: 1px solid #dce8fa; border-radius: 8px; background: #f7fbff; color: #233e70; font-size: 11px; font-weight: 600; line-height: 1.35; }
.order-card-card-access svg { width: 14px; height: 14px; flex-shrink: 0; color: #1759ed; }
.order-card-card-access > span { min-width: 0; overflow-wrap: anywhere; }
.order-card-customer [data-inviter-menu] { min-height: 0; font-size: 12px; line-height: normal; }
.order-card-customer [data-inviter-menu] > span { color: #8999b7; font-weight: 400; }
.order-card .inviter-trigger { color: #1759ed; font-weight: 700; line-height: normal; text-decoration: none; }
.order-card .inviter-trigger:hover { text-decoration: underline; }
.order-card-products { display: grid; gap: 10px; margin: 20px 0 10px; color: #081b4b; font-size: 12px; line-height: 1.35; overflow-wrap: anywhere; }
.order-card-products li > div { min-width: 0; }
.order-card-products li > div .text-blue-600 { color: #1055e9; }
.order-card-products .text-gray-800 { color: #081b4b; }
.order-card-products button { min-height: 28px; padding: 0; border: 0; background: none; color: #819bd0; font-size: 11px; }
.order-card-bottom { margin-top: 24px; }
.order-card-footer { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 8px; margin-bottom: 0; }
.order-card-price { display: flex; min-width: 0; flex-direction: column; align-items: flex-start; gap: 9px; }
.order-card-total { display: flex; flex-direction: column; align-items: flex-start; max-width: 100%; padding: 0; border: 0; border-radius: 4px; background: none; color: #081b4b; font-size: 30px; font-weight: 900; letter-spacing: -.04em; line-height: 1; text-align: left; font-variant-numeric: tabular-nums; cursor: pointer; overflow-wrap: anywhere; }
.order-card-total:hover { color: #1759ed; }
.order-card-original-total { color: #66799e; font-size: 12px; font-weight: 500; letter-spacing: 0; text-decoration: line-through; margin-bottom: 4px; }
.order-card-payment { display: inline-block; max-width: 100%; padding: 7px 9px; border-radius: 30px; font-size: 10px; font-weight: 800; line-height: 1.2; text-transform: uppercase; }
.order-card-payment--card { background: var(--order-danger); color: #fff; }
.order-card-payment--cash { background: #edf2fa; color: #425778; }
.order-card-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; max-width: 100%; min-width: 0; }
.order-card-button { display: inline-flex; align-items: center; justify-content: center; min-height: 41px; max-width: 100%; padding: 13px 12px; border: 0; border-radius: 12px; font-size: 11px; line-height: 1.35; font-weight: 750; cursor: pointer; white-space: normal; text-align: center; }
.order-card-button--details { background: linear-gradient(#f7faff, #e9f0fa); color: #233e70; }
.order-card-button.admin-link-button--primary { background: var(--order-primary); color: #fff; box-shadow: 0 8px 16px #148cff30; }
.order-card-button--danger { background: var(--order-danger); color: #fff; }
.order-card-button:hover { filter: brightness(1.05); }
.order-card button:disabled { opacity: .6; cursor: not-allowed; }
.order-card button:focus-visible { outline: 2px solid #1759ed; outline-offset: 3px; }
.order-card .text-gray-400 { color: #66799e; }
.order-card ::selection { background: #d9ecff; color: #081b4b; }
@container (max-width: 300px) {
  .order-card-cell { padding: 7px 8px; font-size: 18px; }
  .order-card-first { padding: 7px; font-size: 10px; }
  .order-card-total { font-size: 26px; }
  .order-card-footer { grid-template-columns: minmax(0, 1fr); gap: 14px; }
  .order-card-controls { width: 100%; }
  .order-card-controls .order-card-button { flex: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .order-card, .order-card svg { transition: none; }
  .order-card.animate-pulse { animation: none; }
}

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

<style scoped>
.crm-order-price { min-width: 0; color: #081b4b; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; font-size: 13px; line-height: 1.5; }
.crm-order-price *, .crm-order-price *::before, .crm-order-price *::after { box-sizing: border-box; }
.crm-order-price-base { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 16px 18px; margin-bottom: 16px; border: 1px solid #e3ecf9; border-radius: 14px; background: #fff; }
.crm-order-price-base span { color: #66799e; font-size: 12px; }
.crm-order-price-base strong { flex-shrink: 0; font-size: 17px; font-weight: 750; font-variant-numeric: tabular-nums; }
.crm-order-price-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin: 0; padding: 0; border: 0; min-width: 0; }
.crm-order-price-field { min-width: 0; padding: 16px; border: 1px solid #e3ecf9; border-radius: 14px; background: #fff; }
.crm-order-price-field label { display: block; margin-bottom: 9px; font-size: 12px; font-weight: 750; }
.crm-order-price-field label span { margin-left: 4px; color: #8999b7; font-size: 10px; }
.crm-order-price-field input { width: 100%; min-width: 0; border: 1px solid #dce8fa; border-radius: 10px; background: #f7fbff; padding: 11px 12px; color: #081b4b; font: inherit; font-size: 17px; font-weight: 700; font-variant-numeric: tabular-nums; }
.crm-order-price-field p, .crm-order-price-hint { margin: 9px 0 0; color: #66799e; font-size: 11px; line-height: 1.5; }
.crm-order-price-result { margin-top: 16px; padding: 20px; border: 1px solid #dce8fa; border-radius: 16px; background: linear-gradient(140deg, #fff, #edf6ff); }
.crm-order-price-result > div { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 20px; }
.crm-order-price-result span { color: #425778; font-size: 12px; font-weight: 600; }
.crm-order-price-result strong { font-size: 28px; font-weight: 850; letter-spacing: -.035em; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.crm-order-price-result p { margin: 5px 0 0; color: #66799e; font-size: 11px; }
.crm-order-price-error { padding: 10px 12px; border: 1px solid #ffd4dc; border-radius: 10px; background: #fff4f6; color: #c92b4f; font-size: 12px; }
.crm-order-price-actions, .crm-order-price-main-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.crm-order-price-actions { margin-top: 20px; justify-content: space-between; }
.crm-order-price-main-actions { margin-left: auto; }
.crm-order-price-actions button { min-height: 42px; padding: 10px 16px; border-radius: 11px; font: inherit; font-size: 12px; font-weight: 750; cursor: pointer; }
.crm-order-price-primary { border: 1px solid transparent; background: linear-gradient(100deg, #05b8ff, #185dff); color: #fff; box-shadow: 0 6px 14px #148cff24; }
.crm-order-price-secondary { border: 1px solid #dce8fa; background: linear-gradient(#f7faff, #e9f0fa); color: #233e70; }
.crm-order-price-reset { border: 1px solid #ffd4dc; background: #fff4f6; color: #c92b4f; }
.crm-order-price :is(input, button):focus-visible { outline: 2px solid #0958ff; outline-offset: 3px; }
.crm-order-price button:not(:disabled):hover { filter: brightness(1.04); }
.crm-order-price :disabled { opacity: .6; cursor: not-allowed; }
@media (max-width: 480px) { .crm-order-price-fields { grid-template-columns: minmax(0, 1fr); } .crm-order-price-base { flex-wrap: wrap; gap: 6px; } .crm-order-price-main-actions { width: 100%; } .crm-order-price-main-actions button { flex: 1; } }
</style>
