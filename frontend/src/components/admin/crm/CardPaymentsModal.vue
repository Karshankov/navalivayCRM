<template>
  <AdminModal
    :isOpen="isOpen"
    title="Оплата картой и лимиты"
    :description="tabDescription"
    size="wide"
    :showActions="false"
    @close="requestClose"
    @cancel="requestClose"
  >
    <div v-if="loadingCardPaymentAdmin" class="py-12 text-center text-sm text-gray-500">
      Загружаем лимиты…
    </div>

    <template v-else-if="snapshot">
      <!-- Общая ошибка всегда видна сверху -->
      <div
        v-if="errorText"
        role="alert"
        class="mb-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800"
      >
        <ExclamationCircleIcon class="mt-0.5 h-4 w-4 shrink-0" />
        <span class="min-w-0 flex-1">{{ errorText }}</span>
        <button
          type="button"
          class="shrink-0 rounded-md px-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
          @click="errorText = ''"
        >
          Скрыть
        </button>
      </div>

      <!-- Вкладки -->
      <nav
        class="mb-4 flex gap-1.5 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-1.5"
        aria-label="Разделы окна"
      >
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          :class="activeTab === tab.id
            ? 'bg-white text-slate-800 shadow-sm'
            : 'text-slate-500 hover:bg-white/60 hover:text-slate-700'"
          :aria-current="activeTab === tab.id ? 'page' : undefined"
          @click="activeTab = tab.id"
        >
          <component :is="tab.icon" class="h-4 w-4" aria-hidden="true" />
          {{ tab.label }}
          <span
            v-if="tab.id === 'requests' && newRequestCount"
            class="inline-flex min-w-[18px] items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-bold leading-[16px] text-white"
          >
            {{ newRequestCount }}
          </span>
        </button>
      </nav>

      <!-- ======================= ВКЛАДКА: ЛИМИТЫ ======================= -->
      <div v-if="activeTab === 'limits'" class="space-y-4">
        <!-- Прогресс-карточки -->
        <div class="grid gap-3 sm:grid-cols-2">
          <!-- Сегодня -->
          <div class="rounded-xl border border-blue-100 bg-blue-50/60 p-4">
            <div class="flex items-baseline justify-between gap-2">
              <div class="text-xs font-medium text-blue-700">Занято сегодня</div>
              <div class="text-xs font-semibold text-blue-700">{{ money(limits.remaining_today_minor) }} свободно</div>
            </div>
            <div class="mt-1.5 text-xl font-bold text-blue-950">
              {{ money(limits.committed_today_minor) }} <span class="text-sm font-medium text-blue-700">из {{ money(limits.daily_limit_minor) }}</span>
            </div>
            <div class="mt-2.5 h-2 overflow-hidden rounded-full bg-blue-100" role="progressbar"
              :aria-valuenow="percent(limits.committed_today_minor, limits.daily_limit_minor)" aria-valuemin="0" aria-valuemax="100" aria-label="Заполнение дневного лимита">
              <div class="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-300"
                :style="{ width: `${percent(limits.committed_today_minor, limits.daily_limit_minor)}%` }" />
            </div>
            <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-blue-800/80">
              <span>Выдано: {{ money(limits.spent_today_minor) }}</span>
              <span>Резервы: {{ money(limits.reserved_minor) }}</span>
              <span>Добавлено сегодня: {{ money(limits.daily_increase_minor) }}</span>
            </div>
          </div>

          <!-- Месяц -->
          <div class="rounded-xl border border-violet-100 bg-violet-50/60 p-4">
            <div class="flex items-baseline justify-between gap-2">
              <div class="text-xs font-medium text-violet-700">Месяц {{ limits.month_key }}</div>
              <div class="text-xs font-semibold text-violet-700">{{ money(limits.remaining_month_minor) }} остаток</div>
            </div>
            <div class="mt-1.5 text-xl font-bold text-violet-950">
              {{ money(limits.spent_month_minor) }} <span class="text-sm font-medium text-violet-700">из {{ money(limits.monthly_limit_minor) }}</span>
            </div>
            <div class="mt-2.5 h-2 overflow-hidden rounded-full bg-violet-100" role="progressbar"
              :aria-valuenow="percent(limits.spent_month_minor, limits.monthly_limit_minor)" aria-valuemin="0" aria-valuemax="100" aria-label="Заполнение месячного лимита">
              <div class="h-full rounded-full bg-gradient-to-r from-violet-500 to-purple-500 transition-all duration-300"
                :style="{ width: `${percent(limits.spent_month_minor, limits.monthly_limit_minor)}%` }" />
            </div>
            <div class="mt-2 text-[11px] text-violet-800/80">
              Дневной план = остаток месяца ÷ оставшиеся дни. Сегодня он равен базе {{ money(limits.base_daily_limit_minor) }}.
            </div>
          </div>
        </div>

        <!-- Действия с лимитами -->
        <div class="grid gap-3 lg:grid-cols-3">
          <form class="rounded-xl border border-gray-200 bg-white p-4" @submit.prevent="saveMonthly">
            <label class="block text-sm font-semibold text-gray-800" for="card-monthly-input">Месячный лимит · {{ limits.month_key }}</label>
            <div class="mt-2 flex gap-2">
              <input id="card-monthly-input" v-model.number="monthlyAmount" type="number" min="0" step="0.01"
                class="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                :aria-label="`Месячный лимит BYN, текущий ${money(limits.monthly_limit_minor)}`">
              <CrmButton type="submit" variant="muted" size="sm" :loading="busyForm === 'monthly'">Сохранить</CrmButton>
            </div>
            <p class="mt-2 text-xs text-gray-500">Дневной план пересчитывается из остатка месяца.</p>
          </form>

          <form class="rounded-xl border border-gray-200 bg-white p-4" @submit.prevent="increaseDaily">
            <label class="block text-sm font-semibold text-gray-800" for="card-daily-input">Увеличить лимит сегодня</label>
            <div class="mt-2 flex gap-2">
              <input id="card-daily-input" v-model.number="dailyIncrease" type="number" min="0.01" step="0.01" placeholder="Сумма"
                class="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                aria-label="Увеличение дневного лимита BYN">
              <CrmButton type="submit" variant="soft" size="sm" :loading="busyForm === 'daily'">Добавить</CrmButton>
            </div>
            <p class="mt-2 text-xs text-gray-500">Действует только {{ limits.business_date }}; месяц не меняет.</p>
          </form>

          <form class="rounded-xl border border-gray-200 bg-white p-4" @submit.prevent="addManual">
            <label class="block text-sm font-semibold text-gray-800" for="card-manual-input">Ручное пробитие · проходящий клиент</label>
            <div class="mt-2 flex gap-2">
              <input id="card-manual-input" v-model.number="manualAmount" type="number" min="0.01" step="0.01" placeholder="Сумма"
                class="w-28 min-w-0 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                aria-label="Сумма ручного пробития BYN">
              <input v-model="manualNote" type="text" placeholder="Комментарий (необязательно)"
                class="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                aria-label="Комментарий к пробитию">
              <CrmButton type="submit" variant="success" size="sm" :loading="busyForm === 'manual'">Внести</CrmButton>
            </div>
            <p class="mt-2 text-xs text-gray-500">Разрешено сверх дневного плана; уменьшает остаток месяца.</p>
          </form>
        </div>

        <!-- Операции за сегодня -->
        <section class="rounded-xl border border-gray-200 bg-white p-4">
          <div class="mb-3 flex items-center justify-between">
            <h3 class="text-sm font-bold text-gray-900">Операции за {{ limits.business_date }}</h3>
            <span class="text-xs text-gray-500">{{ todayOperationsTotal }}</span>
          </div>
          <div class="max-h-56 space-y-1.5 overflow-auto">
            <div
              v-for="op in todayOperations"
              :key="op.id"
              class="flex items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2 text-sm"
            >
              <div class="min-w-0 flex-1">
                <span class="font-medium text-gray-800">
                  <span v-if="op.operation_type === 'manual'">Ручное</span>
                  <template v-else>Заказ<span v-if="op.order_number"> №{{ op.order_number }}</span></template>
                </span>
                <span class="ml-2 text-xs text-gray-500">{{ operationTime(op.issued_at || op.created_at) }}</span>
                <span v-if="op.operation_type === 'manual' && op.note" class="block truncate text-xs text-gray-500">{{ op.note }}</span>
              </div>
              <span class="shrink-0 font-semibold text-gray-900">{{ compactMoney(op.amount_minor) }}</span>
            </div>
            <p v-if="!todayOperations.length" class="py-2 text-xs text-gray-500">Операций за сегодня нет.</p>
          </div>
        </section>
      </div>

      <!-- ======================= ВКЛАДКА: АККАУНТЫ ======================= -->
      <div v-else-if="activeTab === 'accounts'" class="space-y-4">
        <form class="rounded-xl border border-gray-200 bg-white p-4" @submit.prevent="addAccount">
          <h3 class="mb-1 text-sm font-bold text-gray-900">Разрешить оплату картой</h3>
          <p class="mb-3 text-xs text-gray-500">
            Достаточно @username — стандартные лимиты (250 BYN/мес, 45 BYN на заказ и пауза 10 дней)
            выдадутся автоматически. Клиент сможет поднять лимит заявкой на тариф.
            Пока клиент не заходил в приложение, он хранится как @username и привяжется к Telegram ID после первого входа.
          </p>
          <div class="flex gap-2">
            <input v-model="accountUsername" type="text" placeholder="@username" autocomplete="off"
              class="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              :class="{ 'border-rose-400': accountError }"
              aria-label="Telegram username без собаки">
            <CrmButton type="submit" variant="primary" size="sm" :loading="busyForm === 'account'">Разрешить</CrmButton>
          </div>
          <p v-if="accountError" class="mt-2 text-xs font-medium text-rose-700">{{ accountError }}</p>
        </form>

        <!-- Поиск -->
        <div class="relative">
          <MagnifyingGlassIcon class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input v-model="accountSearch" type="search" placeholder="Поиск по username или Telegram ID…"
            class="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            aria-label="Поиск аккаунтов">
        </div>

        <section class="rounded-xl border border-gray-200 bg-white p-4">
          <div class="mb-3 flex items-center justify-between">
            <h3 class="text-sm font-bold text-gray-900">Аккаунты с разрешением</h3>
            <span class="text-xs text-gray-500">{{ filteredAccounts.length }} из {{ snapshot.accounts.length }}</span>
          </div>
          <div class="max-h-80 space-y-2 overflow-auto">
            <div
              v-for="account in filteredAccounts"
              :key="account.telegram_id"
              class="rounded-xl border p-3"
              :class="account.enabled ? 'border-gray-200 bg-white' : 'border-gray-200 bg-gray-50 opacity-80'"
            >
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="min-w-0">
                  <div class="flex items-center gap-1.5">
                    <span class="truncate text-sm font-semibold text-gray-800">@{{ account.telegram_username || account.telegram_id }}</span>
                    <span
                      class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                      :class="account.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-200 text-gray-600'"
                    >
                      {{ account.enabled ? 'Разрешено' : 'Отключено' }}
                    </span>
                    <span
                      v-if="cooldownUntil(account)"
                      class="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800"
                      :title="`Последняя выдача ${account.last_issued_at ? dateLabel(account.last_issued_at) : '—'}; пауза 10 дней`"
                    >
                      Пауза до {{ dateShort(cooldownUntil(account)!) }}
                    </span>
                  </div>
                  <div class="mt-0.5 text-[11px] text-gray-500">
                    TG ID {{ account.telegram_id }}<span v-if="account.last_issued_at"> · последняя выдача {{ dateShort(account.last_issued_at) }}</span>
                  </div>
                </div>
                <CrmButton
                  :variant="account.enabled ? 'danger' : 'success'"
                  size="sm"
                  :loading="busyAccount === account.telegram_id"
                  @click="editAccount(account.telegram_id, { enabled: !account.enabled })"
                >
                  {{ account.enabled ? 'Отключить' : 'Включить' }}
                </CrmButton>
              </div>

              <div class="mt-3 grid grid-cols-2 gap-2">
                <label class="block">
                  <span class="text-[11px] font-medium text-gray-500">Тариф</span>
                  <select
                    :value="account.tariff_id || ''"
                    class="mt-0.5 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    :aria-label="`Тариф для ${account.telegram_username || account.telegram_id}`"
                    @change="changeAccountTariff(account, ($event.target as HTMLSelectElement).value)"
                  >
                    <option value="">Стандарт (250/45 BYN)</option>
                    <option v-for="tariff in activeTariffs" :key="tariff.id" :value="tariff.id">
                      {{ tariff.title }} · {{ minorToMoney(tariff.monthly_limit_minor ?? tariff.limit_minor) }}/{{ minorToMoney(tariff.per_order_limit_minor ?? 4500) }} BYN
                    </option>
                  </select>
                </label>
                <label class="block">
                  <span class="text-[11px] font-medium text-gray-500">Лимит заказа, BYN</span>
                  <input
                    :value="draftAccountLimits[account.telegram_id] ?? minorToMoney(account.max_order_minor)"
                    @input="setDraftLimit(account.telegram_id, ($event.target as HTMLInputElement).value)"
                    type="number" min="0.01" step="0.01"
                    class="mt-0.5 w-full rounded-lg border px-2.5 py-1.5 text-sm"
                    :class="hasDraftLimit(account.telegram_id) ? 'border-blue-400 ring-1 ring-blue-100' : 'border-gray-300'"
                    :aria-label="`Лимит заказа для ${account.telegram_username || account.telegram_id}`">
                </label>
                <div class="flex items-end">
                  <div v-if="hasDraftLimit(account.telegram_id)" class="flex w-full gap-2">
                    <CrmButton variant="success" size="sm" :loading="busyAccount === account.telegram_id" @click="saveDraftLimit(account)">
                      Сохранить
                    </CrmButton>
                    <CrmButton variant="ghost" size="sm" @click="clearDraftLimit(account.telegram_id)">Отмена</CrmButton>
                  </div>
                  <div v-else class="text-xs text-gray-400">Смена тарифа обновит лимиты автоматически</div>
                </div>
              </div>
            </div>
            <p v-if="!snapshot.accounts.length" class="py-2 text-xs text-gray-500">Пока нет аккаунтов, привязанных к Telegram ID.</p>
            <p v-if="snapshot.accounts.length && !filteredAccounts.length" class="py-2 text-xs text-gray-500">Ничего не найдено.</p>
          </div>

          <div v-if="snapshot.pending_accounts.length" class="mt-3 border-t border-gray-100 pt-3">
            <div class="mb-2 flex items-center gap-1.5 text-xs font-semibold text-gray-600">
              <ClockIcon class="h-4 w-4 text-amber-500" />
              Ожидают первого входа для привязки Telegram ID
            </div>
            <div
              v-for="pending in filteredPendingAccounts"
              :key="pending.telegram_username"
              class="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50/60 px-3 py-2 text-sm"
            >
              <span class="text-gray-800">@{{ pending.telegram_username }}</span>
              <span class="text-xs text-gray-500">
                {{ money(pending.monthly_limit_minor) }}/мес · {{ money(pending.max_order_minor) }}/заказ ·
                {{ pending.enabled ? 'разрешено' : 'отключено' }}
              </span>
            </div>
          </div>
        </section>
      </div>

      <!-- ======================= ВКЛАДКА: ЗАЯВКИ ======================= -->
      <div v-else-if="activeTab === 'requests'" class="rounded-xl border border-gray-200 bg-white p-4">
        <div class="mb-3 flex items-center justify-between">
          <h3 class="text-sm font-bold text-gray-900">Заявки на увеличение лимита</h3>
          <span v-if="newRequestCount" class="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-800">
            Новых: {{ newRequestCount }}
          </span>
        </div>
        <div class="max-h-[420px] space-y-2 overflow-auto">
          <div v-for="request in snapshot.requests" :key="request.id" class="rounded-xl border border-gray-100 p-3">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="text-sm font-semibold text-gray-800">@{{ request.telegram_username || request.telegram_id }}</div>
                <div class="mt-0.5 text-xs text-gray-600">
                  Тариф «{{ request.tariff_title || '—' }}»<span v-if="request.tariff_transition_cost_text"> · стоимость: {{ request.tariff_transition_cost_text }}</span>
                </div>
                <div class="mt-0.5 text-[11px] text-gray-500">
                  Лимиты тарифа:
                  {{ money(request.tariff_monthly_limit_minor ?? request.requested_limit_minor) }}/мес ·
                  {{ money(request.tariff_per_order_limit_minor ?? 4500) }}/заказ
                </div>
                <div class="mt-0.5 text-[11px] text-gray-400">{{ dateLabel(request.created_at) }}</div>
              </div>
              <span
                class="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                :class="request.status === 'new' ? 'bg-blue-100 text-blue-800' : request.status === 'processed' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'"
              >
                {{ requestStatusLabel(request.status) }}
              </span>
            </div>
            <div v-if="request.status === 'new'" class="mt-2.5 flex flex-wrap gap-2">
              <CrmButton variant="primary" size="sm" :loading="busyRequest === request.id" title="Применить лимиты тарифа к аккаунту автоматически" @click="approveRequest(request)">
                Одобрить
              </CrmButton>
              <CrmButton variant="danger" size="sm" :loading="busyRequest === request.id" @click="confirmRejectRequest = request">
                Отклонить
              </CrmButton>
              <a
                v-if="request.telegram_username"
                class="ml-auto inline-flex items-center rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                :href="`https://t.me/${request.telegram_username}`" target="_blank" rel="noopener noreferrer"
              >Написать</a>
            </div>
            <div v-if="request.status === 'processed' && request.resolution_note" class="mt-2 text-[11px] text-gray-400">
              {{ request.resolution_note }}
            </div>
          </div>
          <p v-if="!snapshot.requests.length" class="py-2 text-xs text-gray-500">Заявок пока нет.</p>
        </div>
      </div>

      <!-- ======================= ВКЛАДКА: ТАРИФЫ ======================= -->
      <div v-else class="rounded-xl border border-gray-200 bg-white p-4">
        <div class="mb-3 flex items-center justify-between">
          <div>
            <h3 class="text-sm font-bold text-gray-900">Тарифы для заявок</h3>
            <p class="mt-0.5 text-xs text-gray-500">Варианты, которые клиент видит при запросе увеличения лимита.</p>
          </div>
          <CrmButton variant="soft" size="sm" @click="newTariff">+ Добавить</CrmButton>
        </div>

        <form v-if="editingTariff" class="mb-3 grid grid-cols-1 gap-2 rounded-xl bg-gray-50 p-3 sm:grid-cols-2" @submit.prevent="saveTariff">
          <input v-model="editingTariff.title" required placeholder="Название тарифа" aria-label="Название тарифа"
            class="rounded-lg border border-gray-300 px-2.5 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100">
          <input v-model="editingTariff.transition_cost_text" placeholder="Стоимость перехода, например «50 BYN единоразово»"
            aria-label="Стоимость перехода, текст"
            class="rounded-lg border border-gray-300 px-2.5 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100">
          <label class="block">
            <span class="text-[11px] font-medium text-gray-500">Лимит в месяц, BYN</span>
            <input v-model.number="editingTariff.monthly_limit" required type="number" min="0.01" step="0.01"
              aria-label="Месячный лимит тарифа BYN"
              class="mt-0.5 w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100">
          </label>
          <label class="block">
            <span class="text-[11px] font-medium text-gray-500">Лимит на заказ, BYN</span>
            <input v-model.number="editingTariff.per_order_limit" required type="number" min="0.01" step="0.01"
              aria-label="Лимит заказа тарифа BYN"
              class="mt-0.5 w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100">
          </label>
          <div class="flex gap-2 sm:col-span-2">
            <CrmButton type="submit" variant="primary" size="sm" :loading="busyForm === 'tariff'">Сохранить</CrmButton>
            <CrmButton variant="ghost" size="sm" @click="editingTariff = null">Отмена</CrmButton>
          </div>
        </form>

        <div class="space-y-2">
          <div v-for="tariff in snapshot.tariffs" :key="tariff.id" class="flex flex-wrap items-center gap-2 rounded-xl bg-gray-50 p-3">
            <div class="min-w-0 flex-1">
              <div class="text-sm font-semibold text-gray-800">{{ tariff.title }} · {{ money(tariff.monthly_limit_minor ?? tariff.limit_minor) }}/мес · {{ money(tariff.per_order_limit_minor ?? 4500) }}/заказ</div>
              <div class="text-xs text-gray-500">{{ tariff.transition_cost_text || 'Без текста о стоимости' }}</div>
            </div>
            <CrmButton variant="soft" size="sm" @click="editTariff(tariff)">Изменить</CrmButton>
            <CrmButton variant="danger" size="sm" :loading="busyTariffId === tariff.id" @click="confirmTariffRemoval = tariff">
              Удалить
            </CrmButton>
          </div>
          <p v-if="!snapshot.tariffs.length" class="py-2 text-xs text-gray-500">Тарифов пока нет.</p>
        </div>
      </div>
    </template>

    <div v-else class="py-8 text-center text-sm text-gray-500">
      Не удалось загрузить данные.
      <button type="button" class="ml-2 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50" @click="load">
        Повторить
      </button>
    </div>

    <!-- Подтверждение отклонения заявки -->
    <div
      v-if="confirmRejectRequest"
      class="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4"
      role="dialog" aria-modal="true" aria-label="Подтверждение отклонения заявки"
      @click.self="confirmRejectRequest = null"
    >
      <div class="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <h4 class="text-sm font-bold text-gray-900">Отклонить заявку?</h4>
        <p class="mt-1.5 text-sm text-gray-600">
          @{{ confirmRejectRequest.telegram_username || confirmRejectRequest.telegram_id }} —
          {{ confirmRejectRequest.tariff_title || 'Тариф' }} ·
          {{ money(confirmRejectRequest.requested_limit_minor) }}
        </p>
        <div class="mt-4 flex justify-end gap-2">
          <CrmButton variant="ghost" size="sm" @click="confirmRejectRequest = null">Отмена</CrmButton>
          <CrmButton variant="danger-solid" size="sm" :loading="busyRequest === confirmRejectRequest.id"
            @click="rejectRequest(confirmRejectRequest)">Отклонить</CrmButton>
        </div>
      </div>
    </div>

    <!-- Подтверждение удаления тарифа -->
    <div
      v-if="confirmTariffRemoval"
      class="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4"
      role="dialog" aria-modal="true" aria-label="Подтверждение удаления тарифа"
      @click.self="confirmTariffRemoval = null"
    >
      <div class="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <h4 class="text-sm font-bold text-gray-900">Удалить тариф?</h4>
        <p class="mt-1.5 text-sm text-gray-600">
          «{{ confirmTariffRemoval.title }}» · {{ money(confirmTariffRemoval.limit_minor) }} — действие нельзя отменить.
        </p>
        <div class="mt-4 flex justify-end gap-2">
          <CrmButton variant="ghost" size="sm" @click="confirmTariffRemoval = null">Отмена</CrmButton>
          <CrmButton variant="danger-solid" size="sm" :loading="busyTariffId === confirmTariffRemoval.id"
            @click="removeTariff(confirmTariffRemoval.id)">Удалить</CrmButton>
        </div>
      </div>
    </div>
  </AdminModal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  ExclamationCircleIcon,
  MagnifyingGlassIcon,
  ClockIcon,
  ChartBarIcon,
  UserCircleIcon,
  InboxIcon,
  TagIcon,
} from "@heroicons/vue/24/outline";
import AdminModal from "@/components/AdminModal.vue";
import CrmButton from "@/components/admin/crm/CrmButton.vue";
import { useCrmStore } from "@/stores/crm";

type TabId = "limits" | "accounts" | "requests" | "tariffs";
type Snapshot = NonNullable<ReturnType<typeof useCrmStore>["cardPaymentAdminSnapshot"]>;

const props = defineProps<{ isOpen: boolean }>();
const emit = defineEmits<{ close: [] }>();
const crm = useCrmStore();

const snapshot = computed(() => crm.cardPaymentAdminSnapshot);
const loadingCardPaymentAdmin = computed(() => crm.loadingCardPaymentAdmin);
const limits = computed(() => snapshot.value!.limits);

const tabs = [
  { id: "limits", label: "Лимиты", icon: ChartBarIcon },
  { id: "accounts", label: "Аккаунты", icon: UserCircleIcon },
  { id: "requests", label: "Заявки", icon: InboxIcon },
  { id: "tariffs", label: "Тарифы", icon: TagIcon },
] as const;

const activeTab = ref<TabId>("limits");
const errorText = ref("");
const busyForm = ref("");
const busyAccount = ref("");
const busyRequest = ref("");
const busyTariffId = ref("");

const monthlyAmount = ref(0);
const dailyIncrease = ref<number | null>(null);
const manualAmount = ref<number | null>(null);
const manualNote = ref("");
const accountUsername = ref("");
const accountError = ref("");
const accountSearch = ref("");
const draftAccountLimits = ref<Record<string, number>>({});
const editingTariff = ref<{ id?: string; title: string; limit: number; monthly_limit: number; per_order_limit: number; transition_cost_text: string } | null>(null);
const confirmRejectRequest = ref<Snapshot["requests"][number] | null>(null);
const confirmTariffRemoval = ref<Snapshot["tariffs"][number] | null>(null);

const tabDescription = computed(() => {
  if (activeTab.value === "limits") return "Дневной и месячный контроль и операции.";
  if (activeTab.value === "accounts") return "Разрешения аккаунтов и персональные лимиты.";
  if (activeTab.value === "requests") return "Заявки клиентов на увеличение лимита.";
  return "Тарифы для заявок клиентов.";
});

const newRequestCount = computed(
  () => snapshot.value?.requests.filter((request) => request.status === "new").length || 0,
);

const todayOperations = computed(() => snapshot.value?.operations || []);

const todayOperationsTotal = computed(() => {
  const total = todayOperations.value.reduce((sum, op) => sum + Number(op.amount_minor || 0), 0);
  return `${compactMoney(total)} за день`;
});

const activeTariffs = computed(
  () => (snapshot.value?.tariffs || []).filter((tariff) => Number(tariff.active) === 1),
);

const filteredAccounts = computed(() => {
  const query = accountSearch.value.trim().toLowerCase().replace(/^@+/, "");
  const accounts = snapshot.value?.accounts || [];
  if (!query) return accounts;
  return accounts.filter(
    (account) =>
      String(account.telegram_username || "").toLowerCase().includes(query) ||
      String(account.telegram_id).includes(query),
  );
});

const filteredPendingAccounts = computed(() => {
  const query = accountSearch.value.trim().toLowerCase().replace(/^@+/, "");
  const pending = snapshot.value?.pending_accounts || [];
  if (!query) return pending;
  return pending.filter((account) => account.telegram_username.toLowerCase().includes(query));
});

watch(
  () => snapshot.value?.limits.monthly_limit_minor,
  (limit) => {
    if (limit != null) monthlyAmount.value = Number(limit) / 100;
  },
  { immediate: true },
);

watch(
  () => props.isOpen,
  (open) => {
    if (open) {
      activeTab.value = "limits";
      accountError.value = "";
      void load();
    } else {
      draftAccountLimits.value = {};
      accountSearch.value = "";
      confirmRejectRequest.value = null;
      confirmTariffRemoval.value = null;
      editingTariff.value = null;
      errorText.value = "";
    }
  },
  { immediate: true },
);

const COOLDOWN_DAYS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

function money(minor: number) {
  return `${(Number(minor || 0) / 100).toFixed(2)} BYN`;
}
function compactMoney(minor: number) {
  return `${new Intl.NumberFormat("ru-BY", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(minor || 0) / 100)} BYN`;
}
function percent(part: number, whole: number) {
  const p = Number(whole || 0) > 0 ? (Number(part || 0) / Number(whole)) * 100 : 0;
  return Math.min(100, Math.max(0, Math.round(p)));
}
function operationTime(value: string) {
  return new Intl.DateTimeFormat("ru-BY", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Minsk",
  }).format(new Date(value));
}
function minorToMoney(minor: number) {
  return Number(minor || 0) / 100;
}
function dateLabel(value: string) {
  return new Intl.DateTimeFormat("ru-BY", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Minsk" }).format(new Date(value));
}
function dateShort(value: string | number | Date) {
  return new Intl.DateTimeFormat("ru-BY", { day: "numeric", month: "short", timeZone: "Europe/Minsk" }).format(new Date(value));
}
function cooldownUntil(account: Snapshot["accounts"][number]): number | null {
  if (!account.cooldown_started_at) return null;
  const until = new Date(account.cooldown_started_at).getTime() + COOLDOWN_DAYS * DAY_MS;
  return until > Date.now() ? until : null;
}
function requestStatusLabel(status: string) {
  if (status === "new") return "Новая";
  if (status === "processed") return "Обработана";
  return "Отклонена";
}
function hasDraftLimit(telegramId: string) {
  return telegramId in draftAccountLimits.value;
}
function setDraftLimit(telegramId: string, rawValue: string) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) return;
  const current = minorToMoney(
    snapshot.value?.accounts.find((account) => account.telegram_id === telegramId)?.max_order_minor || 0,
  );
  if (Math.abs(parsed - current) < 0.005) {
    delete draftAccountLimits.value[telegramId];
    draftAccountLimits.value = { ...draftAccountLimits.value };
    return;
  }
  draftAccountLimits.value = { ...draftAccountLimits.value, [telegramId]: parsed };
}
function clearDraftLimit(telegramId: string) {
  delete draftAccountLimits.value[telegramId];
  draftAccountLimits.value = { ...draftAccountLimits.value };
}

function requestClose() {
  // Модалка закрывается напрямую в try-паттерне проекта: никаких блокирующих loading-флагов.
  emit("close");
}

async function run(action: () => Promise<unknown>, busyKey = "") {
  errorText.value = "";
  busyForm.value = busyKey;
  try {
    await action();
    return true;
  } catch (error: any) {
    errorText.value = error?.message || "Не удалось сохранить изменения";
    return false;
  } finally {
    busyForm.value = "";
  }
}

async function load() {
  await run(() => crm.fetchCardPaymentAdmin());
}

async function saveMonthly() {
  if (monthlyAmount.value == null || monthlyAmount.value < 0) return;
  await run(
    () => crm.setCardMonthlyLimit(limits.value?.month_key || "", monthlyAmount.value),
    "monthly",
  );
}

async function increaseDaily() {
  if (!dailyIncrease.value || dailyIncrease.value <= 0) return;
  const ok = await run(() => crm.increaseCardDailyLimit(dailyIncrease.value!), "daily");
  if (ok) dailyIncrease.value = null;
}

async function addManual() {
  if (!manualAmount.value || manualAmount.value <= 0) return;
  const ok = await run(() => crm.addManualCardPayment(manualAmount.value!, manualNote.value), "manual");
  if (ok) {
    manualAmount.value = null;
    manualNote.value = "";
  }
}

async function addAccount() {
  accountError.value = "";
  const username = accountUsername.value.trim().replace(/^@+/, "");
  if (!username) {
    accountError.value = "Укажите @username клиента.";
    return;
  }
  // Лимиты не передаём: сервер выдаёт стандартные 250 BYN/мес и 45 BYN на заказ
  // (setCardAccount в card-payment-service.js). Поднимаются клиентом через тариф.
  const ok = await run(
    () =>
      crm.saveCardAccount({
        telegram_username: username,
        enabled: true,
      }),
    "account",
  );
  if (ok) accountUsername.value = "";
}

async function editAccount(telegramId: string, patch: { max_order?: number; enabled?: boolean }) {
  await (async () => {
    busyAccount.value = telegramId;
    try {
      await crm.updateCardAccount(telegramId, patch);
    } catch (error: any) {
      errorText.value = error?.message || "Не удалось сохранить изменения";
    } finally {
      busyAccount.value = "";
    }
  })();
}

async function saveDraftLimit(account: Snapshot["accounts"][number]) {
  const draft = draftAccountLimits.value[account.telegram_id];
  if (draft == null) return;
  busyAccount.value = account.telegram_id;
  try {
    await crm.updateCardAccount(account.telegram_id, { max_order: draft });
    clearDraftLimit(account.telegram_id);
  } catch (error: any) {
    errorText.value = error?.message || "Не удалось сохранить изменения";
  } finally {
    busyAccount.value = "";
  }
}

async function changeRequest(id: string, status: "processed" | "rejected") {
  await (async () => {
    busyRequest.value = id;
    try {
      await crm.updateCardRequest(id, status);
    } catch (error: any) {
      errorText.value = error?.message || "Не удалось сохранить изменения";
    } finally {
      busyRequest.value = "";
    }
  })();
}

// Одобрить: лимиты тарифа заявки применяются к аккаунту автоматически.
async function approveRequest(request: Snapshot["requests"][number]) {
  busyRequest.value = request.id;
  try {
    await crm.approveCardRequest(request.id);
  } catch (error: any) {
    errorText.value = error?.message || "Не удалось одобрить заявку";
  } finally {
    busyRequest.value = "";
  }
}

// Смена тарифа аккаунта: лимиты обновятся автоматически на сервере.
async function changeAccountTariff(account: Snapshot["accounts"][number], rawValue: string) {
  const tariffId = rawValue || null;
  busyAccount.value = account.telegram_id;
  try {
    await crm.applyCardTariff(account.telegram_id, tariffId);
    clearDraftLimit(account.telegram_id);
  } catch (error: any) {
    errorText.value = error?.message || "Не удалось применить тариф";
  } finally {
    busyAccount.value = "";
  }
}

async function rejectRequest(request: Snapshot["requests"][number]) {
  await changeRequest(request.id, "rejected");
  confirmRejectRequest.value = null;
}

function newTariff() {
  editingTariff.value = { title: "", limit: 250, monthly_limit: 250, per_order_limit: 45, transition_cost_text: "" };
}
function editTariff(tariff: Snapshot["tariffs"][number]) {
  editingTariff.value = {
    id: tariff.id,
    title: tariff.title,
    limit: Number(tariff.limit_minor) / 100,
    monthly_limit: Number(tariff.monthly_limit_minor ?? tariff.limit_minor) / 100,
    per_order_limit: Number(tariff.per_order_limit_minor ?? 4500) / 100,
    transition_cost_text: tariff.transition_cost_text || "",
  };
}
async function saveTariff() {
  if (!editingTariff.value) return;
  const ok = await run(() => crm.saveCardTariff(editingTariff.value!), "tariff");
  if (ok) editingTariff.value = null;
}
async function removeTariff(id: string) {
  busyTariffId.value = id;
  try {
    await crm.deleteCardTariff(id);
    confirmTariffRemoval.value = null;
  } catch (error: any) {
    errorText.value = error?.message || "Не удалось удалить тариф";
  } finally {
    busyTariffId.value = "";
  }
}
</script>
