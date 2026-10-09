<template>
  <div class="min-h-screen bg-gray-50 px-4 py-6 sm:px-6 lg:px-8">
    <div class="mx-auto w-full max-w-7xl space-y-8">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 sm:text-3xl">Клиенты</h1>
        <p class="mt-2 text-sm text-gray-600 sm:text-base">Клиенты, авторизации и ограничения</p>
      </div>

      <!-- Tabs -->
      <div class="flex flex-wrap gap-2">
        <button type="button" @click="activeTab = 'inactive'" :class="tabButtonClass('inactive')" :aria-pressed="activeTab === 'inactive'">
          Не заказывали более 45 дней
        </button>
        <button type="button" @click="activeTab = 'processed'" :class="tabButtonClass('processed')" :aria-pressed="activeTab === 'processed'">
          Обработанные
        </button>
        <button type="button" @click="activeTab = 'all'" :class="tabButtonClass('all')" :aria-pressed="activeTab === 'all'">
          Все клиенты
        </button>
        <button type="button" @click="activeTab = 'authorization'" :class="tabButtonClass('authorization')" :aria-pressed="activeTab === 'authorization'">
          Авторизация
          <span
            v-if="pendingAuthorizationCount"
            class="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700"
          >{{ pendingAuthorizationCount }}</span>
        </button>
        <button type="button" @click="activeTab = 'blocked'" :class="tabButtonClass('blocked')" :aria-pressed="activeTab === 'blocked'">
          Заблокированные
          <span
            v-if="blockedTotalCount > 0"
            class="ml-1 inline-flex items-center justify-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-600"
          >
            {{ blockedTotalCount }}
          </span>
        </button>
      </div>

      <p
        v-if="actionNotice"
        class="fixed bottom-4 right-4 z-50 flex max-w-[calc(100vw-2rem)] items-start gap-3 rounded-lg px-4 py-3 text-sm shadow-lg sm:max-w-sm"
        :class="actionNoticeKind === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'"
        :role="actionNoticeKind === 'error' ? 'alert' : 'status'"
      >
        <span>{{ actionNotice }}</span>
        <button type="button" class="shrink-0 font-semibold" aria-label="Закрыть уведомление" @click="actionNotice = ''">×</button>
      </p>

      <div v-if="loading" class="text-center py-12">
        <div class="inline-block h-12 w-12 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent"></div>
        <p class="mt-4 text-gray-600">Загрузка...</p>
      </div>

      <template v-else>
        <div v-if="activeTab === 'authorization'" class="space-y-4">
          <section ref="staffAccessSection" class="rounded-lg bg-white shadow-sm" aria-labelledby="staff-access-title">
            <div class="flex flex-col gap-3 border-b bg-gray-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div class="flex flex-wrap items-center gap-2">
                  <h2 id="staff-access-title" ref="staffAccessHeading" tabindex="-1" class="text-base font-semibold text-gray-900 outline-none">
                    Доступ без пригласившего
                  </h2>
                  <span class="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                    {{ staffAccess.active.length + staffAccess.pending.length }}
                  </span>
                </div>
                <p class="mt-1 text-sm text-gray-500">Клиент сможет открыть магазин без указания пригласившего.</p>
              </div>
              <button type="button" class="min-h-11 w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-emerald-700 sm:w-auto" @click="openStaffAccessModal()">
                Добавить
              </button>
            </div>

            <div v-if="staffAccessError" class="flex items-center justify-between gap-3 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
              <span>{{ staffAccessError }}</span>
              <button type="button" class="shrink-0 font-semibold underline" @click="fetchStaffAccess">Повторить</button>
            </div>
            <div v-else-if="loadingStaffAccess" class="px-4 py-8 text-center text-sm text-gray-500">Загружаем разрешения...</div>
            <div v-else-if="!staffAccess.active.length && !staffAccess.pending.length" class="px-4 py-8 text-center">
              <p class="text-sm text-gray-500">Пока никому не разрешён вход без пригласившего</p>
              <button type="button" class="mt-3 min-h-11 px-3 py-2 text-sm font-semibold text-emerald-700 hover:text-emerald-800" @click="openStaffAccessModal()">Добавить разрешение</button>
            </div>
            <div v-else class="divide-y">
              <div v-if="staffAccess.pending.length" class="bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-800">Ожидают первого входа</div>
              <div
                v-for="grant in staffAccess.pending"
                :key="`pending-${grant.id}`"
                class="flex items-center justify-between gap-3 px-4 py-3 text-sm transition-colors"
                :class="highlightedStaffAccessKey === `pending-${grant.id}` ? 'bg-emerald-50' : ''"
              >
                <div class="min-w-0">
                  <div class="break-words font-medium text-gray-900">@{{ grant.telegram_username }}</div>
                  <div class="text-xs text-amber-700">Ожидает первого входа</div>
                </div>
                <button type="button" class="min-h-11 shrink-0 px-3 py-2 text-sm font-medium text-red-600 hover:text-red-700 disabled:opacity-50" :disabled="removingPendingStaffAccess === grant.id" @click="removePendingStaffAccess(grant.id)">{{ removingPendingStaffAccess === grant.id ? 'Отменяем...' : 'Отменить' }}</button>
              </div>
              <div v-if="staffAccess.active.length" class="bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-600">Действующие разрешения</div>
              <div
                v-for="grant in staffAccess.active"
                :key="grant.customer_id"
                class="flex items-center justify-between gap-3 px-4 py-3 text-sm transition-colors"
                :class="highlightedStaffAccessKey === `active-${grant.customer_id}` ? 'bg-emerald-50' : ''"
              >
                <div class="min-w-0">
                  <div class="break-words font-medium text-gray-900">{{ grant.telegram_username ? `@${grant.telegram_username}` : grant.first_name || grant.telegram_id }}</div>
                  <div class="text-xs text-gray-500">Добавил: {{ grant.access_authorized_by || 'admin' }}</div>
                </div>
                <button
                  type="button"
                  class="min-h-11 shrink-0 px-3 py-2 text-sm font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                  :disabled="Boolean(grant.has_issued_order) || removingStaffAccess === grant.customer_id"
                  :title="grant.has_issued_order ? 'После выданного заказа доступ постоянный' : undefined"
                  @click="removeStaffAccess(grant.customer_id)"
                >{{ grant.has_issued_order ? 'Доступ постоянный' : removingStaffAccess === grant.customer_id ? 'Отменяем...' : 'Отменить' }}</button>
              </div>
            </div>
          </section>

          <div class="pt-3">
            <h2 class="text-lg font-semibold text-gray-900">Ограничения для пригласивших</h2>
            <p class="mt-1 text-sm text-gray-500">Управление аккаунтами, которые нельзя указывать, и запретами приглашать.</p>
          </div>

          <section class="rounded-lg bg-white p-4 shadow-sm sm:p-5" aria-labelledby="disallowed-inviters-title">
            <div class="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
              <div>
                <h2 id="disallowed-inviters-title" class="text-base font-semibold text-gray-900">
                  Наши аккаунты
                </h2>
                <p class="mt-1 text-sm text-gray-500">
                  Эти username нельзя указать при входе. Попытка не списывается.
                </p>
              </div>
              <span class="mt-1 text-sm text-gray-500 sm:whitespace-nowrap">
                {{ disallowedInviterUsernames.length }} в списке
              </span>
            </div>

            <form class="mt-4 flex flex-col gap-2 sm:flex-row" @submit.prevent="addDisallowedInviters">
              <label class="sr-only" for="disallowed-inviter-input">Username, которые нельзя указывать</label>
              <textarea
                id="disallowed-inviter-input"
                v-model="disallowedInviterInput"
                rows="2"
                autocomplete="off"
                autocapitalize="none"
                spellcheck="false"
                class="min-h-11 min-w-0 flex-1 resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder="@username или несколько через запятую"
                :disabled="savingDisallowedInviters"
                :aria-invalid="Boolean(disallowedInviterError)"
                aria-describedby="disallowed-inviter-help disallowed-inviter-error"
                @input="clearDisallowedInviterFeedback"
              ></textarea>
              <button
                type="submit"
                class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60"
                :disabled="savingDisallowedInviters || !disallowedInviterInput.trim()"
              >
                {{ savingDisallowedInviters ? 'Сохраняем...' : 'Добавить' }}
              </button>
            </form>

            <p id="disallowed-inviter-help" class="mt-2 text-xs text-gray-500">
              Можно вставить список через пробел, запятую или с новой строки.
            </p>
            <p v-if="disallowedInviterError" id="disallowed-inviter-error" class="mt-2 text-sm text-red-600" role="alert">
              {{ disallowedInviterError }}
            </p>
            <p v-else-if="disallowedInviterSaved" class="mt-2 text-sm text-emerald-600" role="status">
              Список сохранён
            </p>

            <div
              v-if="disallowedInviterLoadError"
              class="mt-4 flex items-center justify-between gap-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
              role="alert"
            >
              <span>{{ disallowedInviterLoadError }}</span>
              <button type="button" class="shrink-0 font-semibold underline" @click="fetchDisallowedInviters">
                Повторить
              </button>
            </div>
            <div v-if="loadingDisallowedInviters" class="mt-4 text-sm text-gray-500">Загрузка списка...</div>
            <ul v-else-if="disallowedInviterUsernames.length" class="mt-4 divide-y divide-gray-100 border-t border-gray-100">
              <li
                v-for="item in disallowedInviterUsernames"
                :key="item.username"
                class="flex items-center justify-between gap-3 py-2.5"
              >
                <span class="min-w-0 truncate text-sm font-medium text-gray-800">@{{ item.username }}</span>
                <div class="flex shrink-0 gap-1">
                  <button
                    type="button"
                    class="min-h-11 rounded-md px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                    :disabled="Boolean(removingDisallowedInviter)"
                    @click="convertToInviteBan(item.username)"
                  >Перенести в запрет</button>
                  <button
                    type="button"
                    class="min-h-11 rounded-md px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-wait disabled:opacity-50"
                    :disabled="Boolean(removingDisallowedInviter)"
                    :aria-label="`Удалить @${item.username} из наших аккаунтов`"
                    @click="removeDisallowedInviter(item.username)"
                  >{{ removingDisallowedInviter === item.username ? 'Удаляем...' : 'Удалить' }}</button>
                </div>
              </li>
            </ul>
            <p v-else-if="!disallowedInviterLoadError" class="mt-4 border-t border-gray-100 pt-4 text-sm text-gray-500">
              Список пока пуст
            </p>
          </section>

          <section class="rounded-lg bg-white shadow-sm">
            <div class="border-b bg-gray-50 px-4 py-3 text-sm font-semibold text-gray-700">
              <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span>Запрет приглашать ({{ inviteBans.length + pendingInviteBans.length }})</span>
                <button type="button" class="min-h-11 w-full rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-red-700 sm:w-auto" @click="openInviteBanModal()">Добавить</button>
              </div>
            </div>
            <div v-if="pendingInviteBans.length" class="border-t border-gray-100">
              <div class="bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-800">Ожидают первого входа</div>
              <div v-for="ban in pendingInviteBans" :key="`pending-invite-${ban.id}`" class="flex items-center justify-between gap-3 border-t px-4 py-3 text-sm">
                <div class="min-w-0"><div class="break-words font-medium text-gray-900">@{{ ban.telegram_username }}</div><div class="break-words text-xs text-gray-500">{{ ban.reason || 'Без причины' }}</div></div>
                <button type="button" class="min-h-11 shrink-0 px-3 py-2 text-green-700 hover:text-green-800 disabled:opacity-50" :disabled="removingPendingInviteBan === ban.id" @click="removePendingInviteBan(ban.id)">{{ removingPendingInviteBan === ban.id ? 'Отменяем...' : 'Отменить' }}</button>
              </div>
            </div>
            <div v-if="!inviteBans.length && !pendingInviteBans.length && !inviteBansLoadError" class="px-4 py-8 text-center text-sm text-gray-500">{{ loadingInviteBans ? 'Загрузка списка...' : 'Нет запретов приглашать' }}</div>
            <div v-if="inviteBansLoadError" class="flex items-center justify-between gap-3 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert"><span>{{ inviteBansLoadError }}</span><button type="button" class="font-semibold underline" @click="fetchInviteBans">Повторить</button></div>
            <div v-if="inviteBans.length" class="overflow-x-auto">
              <table class="w-full min-w-[640px]">
                <thead class="border-b bg-gray-50 text-left text-xs uppercase text-gray-500"><tr><th class="px-4 py-3">Клиент</th><th class="px-4 py-3">Причина</th><th class="px-4 py-3">Создан</th><th class="px-4 py-3 text-right">Действия</th></tr></thead>
                <tbody class="divide-y"><tr v-for="ban in visibleInviteBans" :key="ban.id"><td class="px-4 py-4">{{ ban.telegram_username ? `@${ban.telegram_username}` : ban.first_name || 'Без username' }}</td><td class="px-4 py-4">{{ ban.reason || '—' }}</td><td class="px-4 py-4 text-gray-500">{{ formatDate(ban.banned_at) }}</td><td class="px-4 py-4 text-right"><button type="button" class="min-h-11 px-3 py-2 text-green-700 hover:text-green-800 disabled:opacity-50" :disabled="removingInviteBanId === ban.id" @click="removeInviteBanFromList(ban.id)">{{ removingInviteBanId === ban.id ? 'Снимаем...' : 'Снять запрет' }}</button></td></tr></tbody>
              </table>
            </div>
          </section>

          <div class="pt-5">
            <h2 class="text-lg font-semibold text-gray-900">История авторизаций</h2>
            <p class="mt-1 text-sm text-gray-500">Новые, незавершённые и заблокированные попытки входа.</p>
          </div>

          <div class="flex flex-wrap gap-2">
              <button
                v-for="filter in authorizationFilters"
                :key="filter.value"
                type="button"
                class="rounded-lg px-3 py-2 text-sm font-medium"
                :class="authorizationFilter === filter.value ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'"
                :aria-pressed="authorizationFilter === filter.value"
                @click="authorizationFilter = filter.value"
              >{{ filter.label }}</button>
          </div>
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div v-if="authorizationFilter === 'new'" class="grid w-full grid-cols-2 items-center gap-2 sm:flex sm:w-auto sm:flex-wrap" aria-label="Период новых клиентов">
              <span class="col-span-2 text-sm text-gray-500 sm:col-span-1 sm:mr-1">Период:</span>
              <button
                v-for="period in newCustomerPeriods"
                :key="period.value"
                type="button"
                class="min-h-10 w-full rounded-lg px-3 py-2 text-sm font-medium transition-colors sm:w-auto"
                :class="newCustomerPeriod === period.value ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'"
                :aria-pressed="newCustomerPeriod === period.value"
                @click="newCustomerPeriod = period.value"
              >{{ period.label }}</button>
            </div>
            <input
              v-model.trim="authorizationSearch"
              type="search"
              class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm sm:ml-auto sm:max-w-xs"
              placeholder="Поиск клиента или пригласившего"
              aria-label="Поиск по авторизациям"
            />
          </div>
          <p v-if="!loadingAuthorizations && !authorizationLoadError && filteredAuthorizations.length" class="text-sm text-gray-500">
            {{ filteredAuthorizations.length <= CUSTOMER_LIST_LIMIT ? `Найдено ${filteredAuthorizations.length}` : `Показано ${visibleAuthorizations.length} из ${filteredAuthorizations.length}` }}
          </p>
          <div v-if="authorizationLoadError" class="flex items-center justify-between gap-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            <span>{{ authorizationLoadError }}</span>
            <button class="font-semibold underline" @click="fetchReferralAuthorizations">Повторить</button>
          </div>
          <div v-if="loadingAuthorizations" class="rounded-lg bg-white p-8 text-center text-gray-500">Загрузка...</div>
          <div v-else-if="!authorizationLoadError" class="overflow-x-auto rounded-lg bg-white shadow-sm">
            <table class="w-full min-w-[760px] text-sm">
              <thead class="border-b bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th class="px-4 py-3">Клиент</th>
                  <th class="px-4 py-3">Состояние</th>
                  <th class="px-4 py-3">Попытки</th>
                  <th class="px-4 py-3">Пригласивший</th>
                  <th class="px-4 py-3">{{ authorizationFilter === 'new' ? 'Авторизован' : 'Обновлено' }}</th>
                </tr>
              </thead>
              <tbody class="divide-y">
                <tr v-for="item in visibleAuthorizations" :key="item.telegram_id">
                  <td class="px-4 py-3">
                    <div class="font-medium text-gray-900">{{ item.first_name || 'Без имени' }} {{ item.last_name || '' }}</div>
                    <div class="text-gray-500">{{ item.telegram_username ? `@${item.telegram_username}` : item.telegram_id }}</div>
                  </td>
                  <td class="px-4 py-3">{{ authorizationStateLabel(item) }}</td>
                  <td class="px-4 py-3">{{ item.attempts_used }}/3</td>
                  <td class="px-4 py-3">
                    {{ item.access_authorization_source === 'staff' ? 'Разрешено администратором' : item.inviter_username ? `@${item.inviter_username}` : '—' }}
                  </td>
                  <td class="px-4 py-3 text-gray-500">{{ formatDate(authorizationFilter === 'new' ? item.access_authorized_at : item.updated_at) }}</td>
                </tr>
                <tr v-if="!visibleAuthorizations.length">
                  <td colspan="5" class="px-4 py-10 text-center text-gray-500">
                    {{ authorizationEmptyMessage }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

        </div>

        <!-- Inactive Customers (>45 days) -->
        <div v-if="activeTab === 'inactive'" class="space-y-4">
          <p class="text-sm text-gray-500">Показано до {{ CUSTOMER_LIST_LIMIT }} клиентов</p>
          <div v-if="inactiveCustomers.length > 0" class="rounded-lg bg-white shadow-sm">
            <div class="overflow-x-auto">
              <table class="w-full min-w-[600px]">
                <thead class="bg-gray-50 border-b">
                  <tr>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Username</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Имя</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Дней назад</th>
                    <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Действия</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-200">
                  <tr v-for="customer in inactiveCustomers" :key="customer.id" class="hover:bg-gray-50">
                    <td class="px-6 py-4">
                      <a
                        v-if="customer.telegram_username"
                        :href="`https://t.me/${customer.telegram_username}`"
                        target="_blank"
                        class="text-blue-600 hover:text-blue-900 text-sm font-medium"
                      >
                        @{{ customer.telegram_username }}
                      </a>
                      <span v-else class="text-sm text-gray-400">Нет username</span>
                    </td>
                    <td class="px-6 py-4 text-sm text-gray-900">
                      {{ customer.first_name || 'Без имени' }} {{ customer.last_name || '' }}
                    </td>
                    <td class="px-6 py-4 text-sm text-gray-500">
                      {{ getDaysSinceLastOrder(customer) }} дн.
                    </td>
                    <td class="px-6 py-4 text-right">
                      <button
                        @click="openFeedbackModal(customer)"
                        class="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
                      >
                        Обработан
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div v-else class="text-center py-12 bg-white rounded-lg shadow-sm">
            <p class="text-gray-600">Нет клиентов, не заказывавших более 45 дней</p>
          </div>
        </div>

        <!-- Processed Customers -->
        <div v-if="activeTab === 'processed'" class="space-y-6">
          <p v-if="displayedFeedbackCount" class="text-sm text-gray-500">
            Показаны последние {{ displayedFeedbackCount }} записей
          </p>
          <div v-if="groupedFeedbacks.length > 0">
            <div v-for="group in groupedFeedbacks" :key="group.date" class="mb-6">
              <h3 class="text-lg font-semibold text-gray-900 mb-3">{{ group.date }}</h3>
              <div class="bg-white rounded-lg shadow-sm divide-y divide-gray-200">
                <div v-for="feedback in group.items" :key="feedback.id" class="p-6">
                  <div class="flex items-start justify-between">
                    <div class="flex-1">
                      <div class="flex items-center gap-3 mb-2">
                        <span class="text-sm font-medium text-gray-900">username клиента</span>
                        <a
                          v-if="feedback.telegram_username"
                          :href="`https://t.me/${feedback.telegram_username}`"
                          target="_blank"
                          class="text-blue-600 hover:text-blue-900 text-sm"
                        >
                          @{{ feedback.telegram_username }}
                        </a>
                      </div>
                      <div class="text-sm text-gray-500 mb-3">
                        {{ feedback.customer_name || 'Без имени' }}
                      </div>
                      <div class="text-sm text-gray-700 bg-gray-50 rounded p-3">
                        <span class="font-medium">итог:</span> {{ feedback.reason }}
                      </div>
                    </div>
                    <button
                      @click="openDeleteFeedbackModal(feedback)"
                      class="ml-4 p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                      title="Удалить запись"
                    >
                      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="text-center py-12 bg-white rounded-lg shadow-sm">
            <p class="text-gray-600">Нет обработанных клиентов</p>
          </div>
        </div>

        <!-- All Customers with Search -->
        <div v-if="activeTab === 'all'" class="space-y-4">
          <div class="bg-white rounded-lg shadow-sm p-4">
            <input
              v-model="searchQuery"
              type="search"
              placeholder="Имя, username, телефон или Telegram ID"
              aria-label="Поиск клиентов"
              class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <p class="text-sm text-gray-500">
            Показано до {{ CUSTOMER_LIST_LIMIT }} клиентов. Для уточнения списка используйте поиск.
          </p>
          <div v-if="filteredAllCustomers.length > 0" class="rounded-lg bg-white shadow-sm">
            <div class="overflow-x-auto">
              <table class="w-full min-w-[720px]">
                <thead class="bg-gray-50 border-b">
                  <tr>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Username</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Имя</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Заказов</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Последний заказ</th>
                    <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Действия</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-200">
                  <tr v-for="customer in filteredAllCustomers" :key="customer.id" class="hover:bg-gray-50">
                    <td class="px-6 py-4">
                      <a
                        v-if="customer.telegram_username"
                        :href="`https://t.me/${customer.telegram_username}`"
                        target="_blank"
                        class="text-blue-600 hover:text-blue-900 text-sm"
                      >
                        @{{ customer.telegram_username }}
                      </a>
                      <span v-else class="text-sm text-gray-400">Нет username</span>
                    </td>
                    <td class="px-6 py-4 text-sm text-gray-900">
                      {{ customer.first_name || 'Без имени' }} {{ customer.last_name || '' }}
                    </td>
                    <td class="px-6 py-4 text-sm text-gray-900">{{ customer.total_orders }}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">
                      {{ customer.last_order_at ? formatDate(customer.last_order_at) : 'Никогда' }}
                    </td>
                    <td class="px-6 py-4 text-right">
                      <div class="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          class="rounded bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
                          @click="openStaffAccessModal(customer)"
                        >Без приглашения</button>
                        <button
                          type="button"
                          class="rounded bg-amber-50 px-3 py-1 text-sm font-medium text-amber-700 hover:bg-amber-100"
                          @click="openInviteBanModal(customer)"
                        >Запрет приглашать</button>
                        <button
                          v-if="!customer.blocked_count"
                          @click="openBlockModal(customer)"
                          class="px-3 py-1 bg-red-50 text-red-600 text-sm font-medium rounded hover:bg-red-100"
                        >
                          Блокировать
                        </button>
                        <button
                          v-else
                          @click="unblockCustomer(customer)"
                          class="px-3 py-1 bg-green-50 text-green-600 text-sm font-medium rounded hover:bg-green-100"
                        >
                          Разблокировать
                        </button>
                        <button
                          @click="openDeleteCustomerModal(customer)"
                          class="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                          title="Удалить клиента"
                        >
                          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div v-else class="text-center py-12 bg-white rounded-lg shadow-sm">
            <p class="text-gray-600">{{ searchQuery.trim() ? 'По запросу ничего не найдено' : 'Клиентов пока нет' }}</p>
          </div>
        </div>

        <!-- Blocked customers (active + pending) -->
        <div v-if="activeTab === 'blocked'" class="space-y-4">
          <div v-if="loadingBlocks" class="text-center py-12 bg-white rounded-lg shadow-sm">
            <p class="text-gray-600">Загрузка списка блокировок…</p>
          </div>
          <template v-else>
            <!-- Активные блокировки -->
            <div class="rounded-lg bg-white shadow-sm overflow-hidden">
              <div class="px-6 py-3 bg-gray-50 border-b text-sm font-semibold text-gray-700">
                Активные блокировки ({{ blocksList.active.length }})
              </div>
              <div v-if="blocksList.active.length === 0" class="px-6 py-8 text-center text-sm text-gray-500">
                Нет активных блокировок
              </div>
              <div v-else class="overflow-x-auto">
              <table class="w-full min-w-[720px]">
                <thead class="bg-gray-50 border-b">
                  <tr>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Клиент</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Причина</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Истекает</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Кто заблокировал</th>
                    <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Действия</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-200">
                  <tr v-for="block in visibleActiveBlocks" :key="block.id" class="hover:bg-gray-50">
                    <td class="px-6 py-4">
                      <a
                        v-if="block.customer?.telegram_username"
                        :href="`https://t.me/${block.customer.telegram_username}`"
                        target="_blank"
                        class="text-blue-600 hover:text-blue-900 text-sm"
                      >
                        @{{ block.customer.telegram_username }}
                      </a>
                      <span v-else class="text-sm text-gray-500">
                        {{ block.customer?.first_name || 'Без username' }}
                      </span>
                    </td>
                    <td class="px-6 py-4 text-sm text-gray-700 max-w-xs truncate" :title="block.reason || ''">
                      {{ block.reason || '—' }}
                    </td>
                    <td class="px-6 py-4 text-sm text-gray-500">
                      {{ block.block_until ? formatBlockUntil(block.block_until) : 'Бессрочно' }}
                    </td>
                    <td class="px-6 py-4 text-sm text-gray-500">{{ block.blocked_by || '—' }}</td>
                    <td class="px-6 py-4 text-right">
                      <button
                        :disabled="removingBlockId === block.id"
                        @click="handleUnblock(block.id)"
                        class="px-3 py-1 bg-green-50 text-green-600 text-sm font-medium rounded hover:bg-green-100 disabled:opacity-50"
                      >
                        {{ removingBlockId === block.id ? 'Снимаем…' : 'Разблокировать' }}
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
              </div>
            </div>

            <!-- Pending (превентивные баны) -->
            <div class="rounded-lg bg-white shadow-sm overflow-hidden">
              <div class="px-6 py-3 bg-gray-50 border-b text-sm font-semibold text-gray-700">
                Превентивные баны ({{ blocksList.pending.length }})
                <span class="ml-2 text-xs font-normal text-gray-500">
                  активируются при первом заходе клиента в миниапку
                </span>
              </div>
              <div v-if="blocksList.pending.length === 0" class="px-6 py-8 text-center text-sm text-gray-500">
                Нет превентивных банов
              </div>
              <div v-else class="overflow-x-auto">
              <table class="w-full min-w-[640px]">
                <thead class="bg-gray-50 border-b">
                  <tr>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">@username</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Причина</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Истекает</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Создан</th>
                    <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Действия</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-200">
                  <tr v-for="pb in visiblePendingBlocks" :key="`p-${pb.id}`" class="hover:bg-gray-50">
                    <td class="px-6 py-4 text-sm text-gray-900">@{{ pb.telegram_username }}</td>
                    <td class="px-6 py-4 text-sm text-gray-700 max-w-xs truncate" :title="pb.reason || ''">
                      {{ pb.reason || '—' }}
                    </td>
                    <td class="px-6 py-4 text-sm text-gray-500">
                      {{ pb.block_until ? formatBlockUntil(pb.block_until) : 'Бессрочно' }}
                    </td>
                    <td class="px-6 py-4 text-sm text-gray-500">{{ formatDate(pb.blocked_at) }}</td>
                    <td class="px-6 py-4 text-right">
                      <button
                        :disabled="removingBlockId === String(pb.id)"
                        @click="handleUnblock(pb.id)"
                        class="px-3 py-1 bg-green-50 text-green-600 text-sm font-medium rounded hover:bg-green-100 disabled:opacity-50"
                      >
                        {{ removingBlockId === String(pb.id) ? 'Удаляем…' : 'Отменить' }}
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
              </div>
            </div>

          </template>
        </div>
      </template>
    </div>

    <CustomerStaffAccessModal
      :is-open="showStaffAccessModal"
      :customer-id="actionCustomerId"
      :username="actionUsername"
      :customer="actionCustomer"
      @close="showStaffAccessModal = false"
      @created="handleStaffAccessCreated"
    />
    <CustomerInviteBanModal
      :is-open="showInviteBanModal"
      :customer-id="actionCustomerId"
      :username="actionUsername"
      :customer="actionCustomer"
      @close="showInviteBanModal = false"
      @created="handleInviteBanCreated"
    />

    <!-- Feedback Modal -->
    <div
      v-if="showFeedbackModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 px-4"
      v-safe-backdrop-close="closeFeedbackModal"
    >
      <div class="w-full max-w-2xl rounded-xl bg-white p-6 shadow-xl">
        <h3 class="text-xl font-bold text-gray-900 mb-2">Какой итог?</h3>
        <p class="text-sm text-gray-600 mb-4">
          Оставьте обратную связь по поводу пропавшего клиента. Какова причина?
          Какая была обратная связь? И что было предложено чтобы он вернулся?
        </p>
        <textarea
          v-model="feedbackReason"
          rows="6"
          class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="напишите отчёт по клиенту..."
        ></textarea>
        <div class="mt-6 flex gap-3">
          <button
            @click="submitFeedback"
            :disabled="!feedbackReason.trim() || submittingFeedback"
            class="flex-1 rounded-lg bg-green-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {{ submittingFeedback ? 'Сохранение...' : 'подтвердить и закрыть' }}
          </button>
          <button
            @click="closeFeedbackModal"
            class="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Отмена
          </button>
        </div>
      </div>
    </div>

    <!-- Delete Feedback Modal -->
    <div
      v-if="showDeleteFeedbackModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 px-4"
      v-safe-backdrop-close="() => (showDeleteFeedbackModal = false)"
    >
      <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h3 class="text-xl font-semibold text-gray-900 mb-2">Удалить запись?</h3>
        <p class="text-sm text-gray-600 mb-4">
          Эта запись обратной связи будет удалена, и клиент снова появится
          в списке "Не заказывали более 45 дней".
        </p>
        <div class="mt-6 flex gap-3">
          <button
            @click="confirmDeleteFeedback"
            :disabled="deletingFeedback"
            class="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {{ deletingFeedback ? 'Удаление...' : 'Удалить' }}
          </button>
          <button
            @click="showDeleteFeedbackModal = false"
            class="flex-1 rounded-lg border border-gray-200 bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
          >
            Отмена
          </button>
        </div>
      </div>
    </div>

    <!-- Delete Customer Modal -->
    <div
      v-if="showDeleteCustomerModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 px-4"
      v-safe-backdrop-close="() => (showDeleteCustomerModal = false)"
    >
      <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h3 class="text-xl font-semibold text-gray-900 mb-2">Удалить клиента?</h3>
        <p class="text-sm text-gray-600 mb-2">
          Вы уверены, что хотите удалить клиента?
        </p>
        <div v-if="customerToDelete" class="bg-gray-50 rounded p-3 mb-4 text-sm">
          <p class="font-medium text-gray-900">{{ customerToDelete.first_name || 'Без имени' }} {{ customerToDelete.last_name || '' }}</p>
          <p class="text-gray-600">@{{ customerToDelete.telegram_username || 'без username' }}</p>
        </div>
        <p class="text-sm text-red-600 mb-4">
          Это действие необратимо!
        </p>
        <div class="flex gap-3">
          <button
            @click="confirmDeleteCustomer"
            :disabled="deletingCustomer"
            class="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {{ deletingCustomer ? 'Удаление...' : 'Удалить' }}
          </button>
          <button
            @click="showDeleteCustomerModal = false"
            class="flex-1 rounded-lg border border-gray-200 bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
          >
            Отмена
          </button>
        </div>
      </div>
    </div>

    <!-- Block Modal -->
    <div
      v-if="showBlockModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 px-4"
      v-safe-backdrop-close="() => (showBlockModal = false)"
    >
      <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h3 class="text-xl font-semibold text-gray-900 mb-2">Блокировка доставки</h3>
        <p class="text-sm text-gray-500 mb-4">Укажите причину блокировки для клиента.</p>
        <textarea
          v-model="blockReason"
          rows="3"
          class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
          placeholder="Причина блокировки..."
        ></textarea>
        <div class="mt-4 flex gap-3">
          <button
            @click="confirmBlock"
            :disabled="blockingInProgress"
            class="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {{ blockingInProgress ? 'Блокируем...' : 'Заблокировать' }}
          </button>
          <button
            @click="showBlockModal = false"
            class="flex-1 rounded-lg border border-gray-200 bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
          >
            Отмена
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { useCrmStore } from '@/stores/crm'
import { storeToRefs } from 'pinia'
import type { Customer, CustomerFeedback } from '@/stores/crm'
import CustomerInviteBanModal from '@/components/admin/CustomerInviteBanModal.vue'
import CustomerStaffAccessModal from '@/components/admin/CustomerStaffAccessModal.vue'
import { getBusinessDateParts } from '@/utils/businessTime'
import { vSafeBackdropClose } from '@/directives/safeBackdropClose'
import {
  findInvalidDisallowedInviterUsernames,
  parseDisallowedInviterUsernames,
  validateDisallowedInviterUsernames,
} from '@/utils/referralInviterSettings'

const crmStore = useCrmStore()
const {
  customers,
  loadingCustomers,
  customerFeedbacks,
  loadingCustomerFeedbacks,
  customerBlocksList,
  loadingCustomerBlocks,
} = storeToRefs(crmStore)

type AuthorizationItem = {
  telegram_id: string
  telegram_username: string | null
  first_name: string | null
  last_name: string | null
  status: 'pending' | 'authorized' | 'blocked'
  attempts_used: number
  inviter_username: string | null
  has_issued_order: number
  access_authorization_source: string | null
  access_authorized_by: string | null
  access_authorized_at: string | null
  updated_at: string
}

type DisallowedInviterUsername = {
  username: string
  added_at: string
  added_by: string | null
}

const activeTab = ref<'inactive' | 'processed' | 'all' | 'blocked' | 'authorization'>('inactive')
const referralAuthorizations = ref<AuthorizationItem[]>([])
const loadingAuthorizations = ref(false)
const authorizationLoadError = ref('')
const inviteBans = ref<Array<{ id: string; telegram_username: string | null; first_name: string | null; reason: string | null; banned_at: string }>>([])
const pendingInviteBans = ref<Array<{ id: number; telegram_username: string; reason: string | null; banned_by: string | null; created_at: string }>>([])
const inviteBansLoadError = ref('')
const loadingInviteBans = ref(false)
const removingInviteBanId = ref<string | null>(null)
const authorizationFilter = ref<'new' | 'pending' | 'blocked'>('new')
type NewCustomerPeriod = 'today' | 'month' | 'year' | 'all'
const newCustomerPeriod = ref<NewCustomerPeriod>('month')
const businessTimeTick = ref(Date.now())
let businessTimeTimer: ReturnType<typeof setInterval> | undefined
const authorizationSearch = ref('')
const disallowedInviterUsernames = ref<DisallowedInviterUsername[]>([])
const disallowedInviterInput = ref('')
const loadingDisallowedInviters = ref(false)
const savingDisallowedInviters = ref(false)
const removingDisallowedInviter = ref<string | null>(null)
const disallowedInviterError = ref('')
const disallowedInviterLoadError = ref('')
const disallowedInviterSaved = ref(false)
const authorizationFilters = [
  { value: 'new' as const, label: 'Новые' },
  { value: 'pending' as const, label: '1–2 ошибки' },
  { value: 'blocked' as const, label: 'Заблокированы' },
]
const newCustomerPeriods = [
  { value: 'today' as const, label: 'За день' },
  { value: 'month' as const, label: 'За месяц' },
  { value: 'year' as const, label: 'За год' },
  { value: 'all' as const, label: 'Всё время' },
]

function parseUtcTimestamp(value: string | null) {
  if (!value) return null
  let normalized = value.includes('T') ? value : value.replace(' ', 'T')
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)) normalized += 'Z'
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

function isInNewCustomerPeriod(value: string | null) {
  if (newCustomerPeriod.value === 'all') return true
  const date = parseUtcTimestamp(value)
  if (!date) return false
  const current = getBusinessDateParts(new Date(businessTimeTick.value))
  const candidate = getBusinessDateParts(date)
  if (candidate.year !== current.year) return false
  if (newCustomerPeriod.value === 'year') return true
  if (candidate.month !== current.month) return false
  if (newCustomerPeriod.value === 'month') return true
  return candidate.day === current.day
}

const pendingAuthorizationCount = computed(() =>
  referralAuthorizations.value.filter((item) => item.status === 'pending' && item.attempts_used > 0).length,
)
const filteredAuthorizations = computed(() => referralAuthorizations.value.filter((item) => {
  const inState = authorizationFilter.value === 'new'
    ? item.status === 'authorized'
      && !item.has_issued_order
      && item.access_authorization_source !== 'staff'
      && isInNewCustomerPeriod(item.access_authorized_at)
    : authorizationFilter.value === 'blocked'
      ? item.status === 'blocked'
      : item.status === 'pending' && item.attempts_used > 0
  if (!inState) return false
  const query = authorizationSearch.value.trim().toLowerCase().replace(/^@+/, '')
  if (!query) return true
  return [item.telegram_id, item.telegram_username, item.first_name, item.last_name, item.inviter_username]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query))
}))
const visibleAuthorizations = computed(() => filteredAuthorizations.value.slice(0, CUSTOMER_LIST_LIMIT))
const authorizationEmptyMessage = computed(() => {
  if (authorizationSearch.value) {
    return authorizationFilter.value === 'new'
      ? 'По запросу ничего не найдено за выбранный период'
      : 'По запросу ничего не найдено'
  }
  return authorizationFilter.value === 'new'
    ? 'За выбранный период новых клиентов нет'
    : 'Нет клиентов в этом состоянии'
})

function authorizationStateLabel(item: AuthorizationItem) {
  if (item.status === 'blocked') return 'Авторизация не пройдена'
  if (item.status === 'authorized' && item.access_authorization_source === 'staff') return 'Разрешено администратором'
  if (item.status === 'authorized') return item.has_issued_order ? 'Постоянный' : 'Новый клиент'
  return 'Не завершил авторизацию'
}

async function fetchReferralAuthorizations() {
  loadingAuthorizations.value = true
  authorizationLoadError.value = ''
  try {
    const response = await fetch('/api/admin/crm/referral-authorizations', { credentials: 'include' })
    if (!response.ok) throw new Error('failed')
    referralAuthorizations.value = (await response.json()).items || []
  } catch {
    authorizationLoadError.value = 'Не удалось загрузить авторизации'
  } finally {
    loadingAuthorizations.value = false
  }
}

type StaffAccessState = {
  active: Array<{ customer_id: string; telegram_id: string | null; telegram_username: string | null; first_name: string | null; access_authorized_by: string | null; has_issued_order: number }>
  pending: Array<{ id: number; telegram_username: string; granted_by: string | null; created_at: string }>
}
const staffAccess = ref<StaffAccessState>({ active: [], pending: [] })
const staffAccessError = ref('')
const loadingStaffAccess = ref(false)
const removingStaffAccess = ref<string | null>(null)
const removingPendingStaffAccess = ref<number | null>(null)
const staffAccessSection = ref<HTMLElement | null>(null)
const staffAccessHeading = ref<HTMLElement | null>(null)
const highlightedStaffAccessKey = ref<string | null>(null)
let staffAccessHighlightTimer: ReturnType<typeof setTimeout> | undefined
const removingPendingInviteBan = ref<number | null>(null)
const showStaffAccessModal = ref(false)
const showInviteBanModal = ref(false)
const actionCustomerId = ref<string | null>(null)
const actionUsername = ref('')
const actionCustomer = ref<Customer | null>(null)
const actionNotice = ref('')
const actionNoticeKind = ref<'success' | 'error'>('success')

async function fetchStaffAccess() {
  loadingStaffAccess.value = true
  staffAccessError.value = ''
  try {
    const response = await fetch('/api/admin/crm/referral-authorization/staff-access', { credentials: 'include' })
    if (!response.ok) throw new Error('failed')
    staffAccess.value = await response.json()
  } catch {
    staffAccessError.value = 'Не удалось загрузить разрешения администратора'
  } finally {
    loadingStaffAccess.value = false
  }
}

function setActionCustomer(customer?: Customer) {
  actionCustomer.value = customer || null
  actionCustomerId.value = customer?.id || null
  actionUsername.value = customer?.telegram_username || ''
}

function openStaffAccessModal(customer?: Customer) {
  setActionCustomer(customer)
  actionNotice.value = ''
  actionNoticeKind.value = 'success'
  showStaffAccessModal.value = true
}

function openInviteBanModal(customer?: Customer) {
  setActionCustomer(customer)
  actionNotice.value = ''
  actionNoticeKind.value = 'success'
  showInviteBanModal.value = true
}

async function handleStaffAccessCreated(payload: { kind: 'active' | 'pending'; alreadyAuthorized?: boolean }) {
  const previousKeys = new Set([
    ...staffAccess.value.active.map((grant) => `active-${grant.customer_id}`),
    ...staffAccess.value.pending.map((grant) => `pending-${grant.id}`),
  ])
  actionNoticeKind.value = 'success'
  actionNotice.value = payload.alreadyAuthorized
    ? 'Клиент уже имел доступ. Текущая авторизация сохранена.'
    : payload.kind === 'pending'
      ? 'Разрешение сохранено и применится при первом входе клиента.'
      : 'Доступ без приглашения разрешён.'
  await Promise.all([fetchStaffAccess(), fetchReferralAuthorizations()])
  const currentKeys = [
    ...staffAccess.value.pending.map((grant) => `pending-${grant.id}`),
    ...staffAccess.value.active.map((grant) => `active-${grant.customer_id}`),
  ]
  highlightedStaffAccessKey.value = currentKeys.find((key) => !previousKeys.has(key)) || null
  await nextTick()
  staffAccessSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  staffAccessHeading.value?.focus({ preventScroll: true })
  clearTimeout(staffAccessHighlightTimer)
  staffAccessHighlightTimer = setTimeout(() => {
    highlightedStaffAccessKey.value = null
  }, 2500)
}

async function handleInviteBanCreated() {
  actionNoticeKind.value = 'success'
  actionNotice.value = 'Запрет приглашать сохранён.'
  await fetchInviteBans()
}

async function removeStaffAccess(customerId: string) {
  if (removingStaffAccess.value || !window.confirm('Отменить разрешение без приглашения?')) return
  removingStaffAccess.value = customerId
  try {
    const response = await fetch(`/api/admin/crm/referral-authorization/staff-access/${encodeURIComponent(customerId)}`, {
      method: 'DELETE', credentials: 'include',
    })
    if (!response.ok) throw new Error('failed')
    await Promise.all([fetchStaffAccess(), fetchReferralAuthorizations()])
  } catch {
    window.alert('Не удалось отменить разрешение')
  } finally {
    removingStaffAccess.value = null
  }
}

async function removePendingStaffAccess(id: number) {
  if (removingPendingStaffAccess.value || !window.confirm('Отменить ожидающее разрешение?')) return
  removingPendingStaffAccess.value = id
  try {
    const response = await fetch(`/api/admin/crm/referral-authorization/staff-access/pending/${id}`, { method: 'DELETE', credentials: 'include' })
    if (!response.ok) throw new Error('failed')
    actionNotice.value = 'Ожидающее разрешение отменено.'
    actionNoticeKind.value = 'success'
    await fetchStaffAccess()
  } catch {
    actionNotice.value = 'Не удалось отменить ожидающее разрешение.'
    actionNoticeKind.value = 'error'
  } finally {
    removingPendingStaffAccess.value = null
  }
}

function clearDisallowedInviterFeedback() {
  disallowedInviterError.value = ''
  disallowedInviterSaved.value = false
}

async function fetchDisallowedInviters() {
  loadingDisallowedInviters.value = true
  disallowedInviterLoadError.value = ''
  try {
    const response = await fetch('/api/admin/crm/referral-authorization/disallowed-usernames', {
      credentials: 'include',
    })
    if (!response.ok) throw new Error('failed')
    disallowedInviterUsernames.value = (await response.json()).items || []
  } catch {
    disallowedInviterLoadError.value = 'Не удалось загрузить запрещённые username'
  } finally {
    loadingDisallowedInviters.value = false
  }
}

async function addDisallowedInviters() {
  if (savingDisallowedInviters.value) return
  clearDisallowedInviterFeedback()
  const usernames = parseDisallowedInviterUsernames(disallowedInviterInput.value)
  if (usernames.length > 100) {
    disallowedInviterError.value = 'За один раз можно добавить не более 100 username'
    return
  }
  const invalid = findInvalidDisallowedInviterUsernames(usernames)
  if (invalid.length) {
    disallowedInviterError.value = `Некорректные username: ${invalid.map((item) => `@${item}`).join(', ')}`
    return
  }
  if (!validateDisallowedInviterUsernames(usernames)) {
    disallowedInviterError.value = 'Username должен содержать 5–32 латинских символа, цифры или знак подчёркивания'
    return
  }

  savingDisallowedInviters.value = true
  try {
    const response = await fetch('/api/admin/crm/referral-authorization/disallowed-usernames', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ usernames }),
    })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      if (data.error === 'username_has_invite_ban') {
        throw new Error(`@${data.username} уже находится в запрете приглашать`)
      }
      throw new Error('failed')
    }
    disallowedInviterUsernames.value = (await response.json()).items || []
    disallowedInviterLoadError.value = ''
    disallowedInviterInput.value = ''
    disallowedInviterSaved.value = true
  } catch (cause: any) {
    disallowedInviterError.value = cause?.message === 'failed' || !cause?.message
      ? 'Не удалось сохранить список'
      : cause.message
  } finally {
    savingDisallowedInviters.value = false
  }
}

async function removeDisallowedInviter(username: string) {
  if (
    removingDisallowedInviter.value
    || !window.confirm(`Разрешить использовать @${username} как пригласившего?`)
  ) return
  removingDisallowedInviter.value = username
  clearDisallowedInviterFeedback()
  try {
    const response = await fetch(
      `/api/admin/crm/referral-authorization/disallowed-usernames/${encodeURIComponent(username)}`,
      { method: 'DELETE', credentials: 'include' },
    )
    if (!response.ok) throw new Error('failed')
    disallowedInviterUsernames.value = disallowedInviterUsernames.value
      .filter((item) => item.username !== username)
    disallowedInviterSaved.value = true
  } catch {
    disallowedInviterError.value = `Не удалось удалить @${username}`
  } finally {
    removingDisallowedInviter.value = null
  }
}

async function convertToInviteBan(username: string) {
  if (removingDisallowedInviter.value || !window.confirm(`Перенести @${username} в запрет приглашать? Попытка будет списываться.`)) return
  removingDisallowedInviter.value = username
  try {
    const response = await fetch(
      `/api/admin/crm/referral-authorization/disallowed-usernames/${encodeURIComponent(username)}/convert-to-invite-ban`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: '{}' },
    )
    if (!response.ok) throw new Error('failed')
    await Promise.all([fetchDisallowedInviters(), fetchInviteBans()])
    actionNotice.value = `@${username} перенесён в запрет приглашать.`
    actionNoticeKind.value = 'success'
  } catch {
    disallowedInviterError.value = `Не удалось перенести @${username}`
  } finally {
    removingDisallowedInviter.value = null
  }
}

async function fetchInviteBans() {
  loadingInviteBans.value = true
  inviteBansLoadError.value = ''
  try {
    const response = await fetch('/api/admin/crm/invite-bans', { credentials: 'include' })
    if (!response.ok) throw new Error('failed')
    const data = await response.json()
    inviteBans.value = data.items || []
    pendingInviteBans.value = data.pending || []
  } catch {
    inviteBansLoadError.value = 'Не удалось загрузить запреты приглашать'
  } finally {
    loadingInviteBans.value = false
  }
}

async function removePendingInviteBan(id: number) {
  if (removingPendingInviteBan.value || !window.confirm('Отменить ожидающий запрет?')) return
  removingPendingInviteBan.value = id
  try {
    const response = await fetch(`/api/admin/crm/invite-bans/pending/${id}`, { method: 'DELETE', credentials: 'include' })
    if (!response.ok) throw new Error('failed')
    actionNotice.value = 'Ожидающий запрет отменён.'
    actionNoticeKind.value = 'success'
    await fetchInviteBans()
  } catch {
    actionNotice.value = 'Не удалось отменить ожидающий запрет.'
    actionNoticeKind.value = 'error'
  } finally {
    removingPendingInviteBan.value = null
  }
}

async function removeInviteBanFromList(id: string) {
  if (removingInviteBanId.value || !window.confirm('Снять запрет приглашать?')) return
  removingInviteBanId.value = id
  try {
    const response = await fetch(`/api/admin/crm/invite-bans/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({}),
    })
    if (!response.ok) throw new Error('failed')
    await fetchInviteBans()
  } catch {
    inviteBansLoadError.value = 'Не удалось снять запрет'
  } finally {
    removingInviteBanId.value = null
  }
}

// Список блокировок (active + pending) — для таба «Заблокированные»
const blocksList = computed(() => customerBlocksList.value)
const loadingBlocks = computed(() => loadingCustomerBlocks.value)
const blockedTotalCount = computed(
  () => blocksList.value.active.length + blocksList.value.pending.length,
)
const visibleActiveBlocks = computed(() => blocksList.value.active.slice(0, CUSTOMER_LIST_LIMIT))
const visiblePendingBlocks = computed(() => blocksList.value.pending.slice(0, CUSTOMER_LIST_LIMIT))
const visibleInviteBans = computed(() => inviteBans.value.slice(0, CUSTOMER_LIST_LIMIT))
const removingBlockId = ref<string | null>(null)

// Реактивно подгружаем при переключении на таб
watch(activeTab, (tab) => {
  void loadActiveTab(tab)
  if (tab === 'blocked') {
    crmStore.fetchCustomerBlocksList().catch((err) => {
      console.error('[crm-customers] failed to load blocks list', err)
    })
    void fetchInviteBans()
  }
  if (tab === 'authorization') {
    void Promise.all([fetchReferralAuthorizations(), fetchDisallowedInviters(), fetchStaffAccess(), fetchInviteBans()])
  }
})

async function handleUnblock(blockId: string | number) {
  const id = String(blockId)
  if (removingBlockId.value === id) return
  removingBlockId.value = id
  try {
    await crmStore.removeCustomerBlock(blockId)
    await crmStore.fetchCustomerBlocksList()
    await fetchReferralAuthorizations()
  } catch (err: any) {
    console.error('[crm-customers] unblock failed', err)
    window.alert(err?.message || 'Не удалось снять блок')
  } finally {
    removingBlockId.value = null
  }
}

function formatBlockUntil(iso: string) {
  // Backend хранит TEXT в SQLite UTC формате 'YYYY-MM-DD HH:MM:SS'.
  // В JS new Date('YYYY-MM-DD HH:MM:SS') парсится как локальное время,
  // поэтому добавляем 'Z' чтобы интерпретировать как UTC.
  const normalized = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z'
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
const showBlockModal = ref(false)
const showFeedbackModal = ref(false)
const showDeleteFeedbackModal = ref(false)
const showDeleteCustomerModal = ref(false)
const blockReason = ref('')
const feedbackReason = ref('')
const customerToBlock = ref<Customer | null>(null)
const customerToProcess = ref<Customer | null>(null)
const customerToDelete = ref<Customer | null>(null)
const feedbackToDelete = ref<CustomerFeedback | null>(null)
const blockingInProgress = ref(false)
const submittingFeedback = ref(false)
const deletingFeedback = ref(false)
const deletingCustomer = ref(false)
const searchQuery = ref('')
const loading = computed(() => {
  if (activeTab.value === 'inactive' || activeTab.value === 'all') return loadingCustomers.value
  if (activeTab.value === 'processed') return loadingCustomerFeedbacks.value
  return false
})
const CUSTOMER_LIST_LIMIT = 50
let searchTimer: ReturnType<typeof setTimeout> | undefined

type InactiveCustomer = Customer

function getDaysSinceLastOrder(c: Customer) {
  if (!c.last_order_at) return 9999
  const lastOrder = new Date(c.last_order_at).getTime()
  return Math.floor((Date.now() - lastOrder) / (1000 * 60 * 60 * 24))
}

const inactiveCustomers = computed<InactiveCustomer[]>(() => {
  return customers.value
    .filter((c) => Boolean(c.last_order_at))
    .filter((c) => getDaysSinceLastOrder(c) >= 45)
    .sort((a, b) => getDaysSinceLastOrder(b) - getDaysSinceLastOrder(a))
})

const filteredAllCustomers = computed(() => {
  return customers.value
})

async function loadActiveTab(tab = activeTab.value) {
  if (tab === 'inactive') {
    await crmStore.fetchCustomers('inactive', { limit: CUSTOMER_LIST_LIMIT, unprocessed: true })
  } else if (tab === 'processed') {
    await crmStore.fetchCustomerFeedbacks()
  } else if (tab === 'all') {
    await crmStore.fetchCustomers(undefined, { limit: CUSTOMER_LIST_LIMIT, query: searchQuery.value.trim() })
  }
}

watch(searchQuery, () => {
  if (activeTab.value !== 'all') return
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void loadActiveTab('all'), 300)
})

const groupedFeedbacks = computed(() => {
  const groups: Record<string, CustomerFeedback[]> = {}
  for (const item of customerFeedbacks.value.slice(0, CUSTOMER_LIST_LIMIT)) {
    const d = new Date(item.processed_at || item.created_at)
    const label = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
    if (!groups[label]) groups[label] = []
    groups[label].push(item)
  }
  return Object.entries(groups).map(([date, items]) => ({ date, items }))
})
const displayedFeedbackCount = computed(() => Math.min(customerFeedbacks.value.length, CUSTOMER_LIST_LIMIT))

function tabButtonClass(tab: 'inactive' | 'processed' | 'all' | 'blocked' | 'authorization') {
  return [
    'w-full rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 sm:w-auto',
    activeTab.value === tab ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'
  ]
}

function openBlockModal(customer: Customer) {
  customerToBlock.value = customer
  blockReason.value = ''
  showBlockModal.value = true
}

async function confirmBlock() {
  if (!customerToBlock.value || blockingInProgress.value) return
  try {
    blockingInProgress.value = true
    await crmStore.blockCustomer(customerToBlock.value.id, blockReason.value)
    showBlockModal.value = false
    await loadActiveTab('all')
  } catch (e) {
    alert('Ошибка блокировки')
  } finally {
    blockingInProgress.value = false
  }
}

async function unblockCustomer(customer: Customer) {
  if (!confirm('Разблокировать доставку для этого клиента?')) return
  await crmStore.unblockCustomer(customer.id)
  await loadActiveTab('all')
}

function openFeedbackModal(customer: Customer) {
  customerToProcess.value = customer
  feedbackReason.value = ''
  showFeedbackModal.value = true
}

function closeFeedbackModal() {
  showFeedbackModal.value = false
  customerToProcess.value = null
}

async function submitFeedback() {
  if (!customerToProcess.value || !feedbackReason.value.trim()) return
  submittingFeedback.value = true
  try {
    await crmStore.createCustomerFeedback({
      customer_id: customerToProcess.value.id,
      reason: feedbackReason.value.trim()
    })
    showFeedbackModal.value = false
    await loadActiveTab('inactive')
  } catch (e) {
    alert('Не удалось сохранить итог')
  } finally {
    submittingFeedback.value = false
  }
}

function openDeleteFeedbackModal(feedback: CustomerFeedback) {
  feedbackToDelete.value = feedback
  showDeleteFeedbackModal.value = true
}

async function confirmDeleteFeedback() {
  if (!feedbackToDelete.value || deletingFeedback.value) return
  deletingFeedback.value = true
  try {
    await crmStore.deleteCustomerFeedback(feedbackToDelete.value.id)
    await crmStore.fetchCustomerFeedbacks()
    showDeleteFeedbackModal.value = false
    feedbackToDelete.value = null
  } catch (e) {
    alert('Не удалось удалить запись')
  } finally {
    deletingFeedback.value = false
  }
}

function openDeleteCustomerModal(customer: Customer) {
  customerToDelete.value = customer
  showDeleteCustomerModal.value = true
}

async function confirmDeleteCustomer() {
  if (!customerToDelete.value || deletingCustomer.value) return
  deletingCustomer.value = true
  try {
    await crmStore.deleteCustomer(customerToDelete.value.id)
    await loadActiveTab('all')
    showDeleteCustomerModal.value = false
    customerToDelete.value = null
  } catch (e) {
    alert('Не удалось удалить клиента')
  } finally {
    deletingCustomer.value = false
  }
}

function formatDate(dateString: string | null): string {
  if (!dateString) return '—'
  const normalized = dateString.includes('T') ? dateString : `${dateString.replace(' ', 'T')}Z`
  return new Date(normalized).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Minsk',
  })
}

onMounted(() => {
  businessTimeTimer = setInterval(() => {
    businessTimeTick.value = Date.now()
  }, 30_000)
  void loadActiveTab()
})

onBeforeUnmount(() => {
  clearInterval(businessTimeTimer)
  clearTimeout(staffAccessHighlightTimer)
})
</script>
