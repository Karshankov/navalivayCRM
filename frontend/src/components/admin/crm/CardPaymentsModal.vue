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
        class="mb-4 grid grid-cols-4 gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 sm:flex sm:gap-1.5"
        aria-label="Разделы окна"
      >
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="inline-flex min-w-0 items-center justify-center gap-1 rounded-lg px-1.5 py-2 text-xs font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:shrink-0 sm:gap-1.5 sm:px-3.5 sm:text-sm"
          :class="activeTab === tab.id
            ? 'bg-white text-slate-800 shadow-sm'
            : 'text-slate-500 hover:bg-white/60 hover:text-slate-700'"
          :aria-current="activeTab === tab.id ? 'page' : undefined"
          @click="activeTab = tab.id; tab.id === 'requests' && crm.markCardRequestsAsSeen()"
        >
          <component :is="tab.icon" class="h-4 w-4" aria-hidden="true" />
          {{ tab.label }}
          <span
            v-if="tab.id === 'requests' && (newRequestCount || unseenCardRequests)"
            class="inline-flex min-w-[18px] items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-bold leading-[16px] text-white"
          >
            {{ newRequestCount || unseenCardRequests }}
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
              <span v-if="limits.daily_increase_minor > 0">Добавлено сегодня: +{{ money(limits.daily_increase_minor) }}</span>
              <span v-else-if="limits.daily_increase_minor < 0">Уменьшено сегодня: {{ money(limits.daily_increase_minor) }}</span>
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

        <!-- Превышение дневного лимита -->
        <div
          v-if="limits.exceeded_today_minor > 0"
          role="alert"
          class="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3"
        >
          <ExclamationTriangleIcon class="h-5 w-5 shrink-0 text-rose-600" aria-hidden="true" />
          <div class="min-w-0 flex-1 text-sm font-semibold text-rose-800">
            Лимит на сегодня превышен на {{ money(limits.exceeded_today_minor) }}.
            Новые карточные заказы отклоняются до конца дня; новые карточные лимиты клиенту не выдаются.
          </div>
        </div>

        <!-- Действия с лимитами -->
        <div class="grid gap-3 lg:grid-cols-3">
          <!-- Месяцы списком -->
          <section class="rounded-xl border border-gray-200 bg-white p-4">
            <label class="block text-sm font-semibold text-gray-800">Месячные лимиты</label>
            <p class="mt-0.5 text-xs text-gray-500">Текущий и следующий месяц; план дня пересчитывается сразу.</p>
            <div class="mt-3 space-y-2">
              <div
                v-for="month in snapshot.months || []"
                :key="month.month_key"
                class="rounded-lg border p-3"
                :class="month.is_current ? 'border-violet-300 bg-violet-50/60' : 'border-gray-200 bg-white'"
              >
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="min-w-0">
                    <div class="text-sm font-semibold text-gray-800">
                      {{ monthName(month.month_key) }}
                      <span
                        v-if="month.is_current"
                        class="ml-1 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700"
                      >текущий</span>
                    </div>
                    <div class="text-xs text-gray-500">Лимит: {{ money(month.limit_minor) }}</div>
                  </div>
                  <CrmButton
                    variant="soft" size="sm" class="w-full sm:!w-auto"
                    @click="startEditMonth(month)"
                  >Изменить</CrmButton>
                </div>
                <form v-if="editingMonthKey === month.month_key" class="mt-2 flex flex-wrap gap-2" @submit.prevent="saveMonth">
                  <input v-model.number="editingMonthLimit" type="number" min="0" step="0.01" inputmode="decimal"
                    class="w-full rounded-lg border border-violet-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100 sm:min-w-0 sm:flex-1 sm:py-1.5"
                    :aria-label="`Лимит месяца ${monthName(month.month_key)} BYN`">
                  <CrmButton type="submit" variant="muted" size="sm" class="w-full sm:!w-auto" :loading="busyForm === 'monthly'">Сохранить</CrmButton>
                  <CrmButton variant="ghost" size="sm" class="w-full sm:!w-auto" @click="editingMonthKey = ''">Отмена</CrmButton>
                </form>
              </div>
            </div>
          </section>

          <!-- День: ± -->
          <form class="rounded-xl border border-gray-200 bg-white p-4" @submit.prevent="adjustDaily">
            <label class="block text-sm font-semibold text-gray-800" for="card-daily-input">Лимит на сегодня · {{ money(limits.daily_limit_minor) }}</label>
            <div class="mt-2 flex gap-2">
              <input id="card-daily-input" v-model.number="dailyDelta" type="number" step="0.01" inputmode="decimal" placeholder="± Сумма"
                class="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                aria-label="Изменение дневного лимита BYN, минус для уменьшения">
              <CrmButton type="submit" variant="soft" size="sm" :loading="busyForm === 'daily'">Применить</CrmButton>
            </div>
            <p class="mt-2 text-xs text-gray-500">
              Увеличьте или уменьшите (минус) лимит сегодняшнего дня. Месяц не меняется: план будущих дней
              пересчитается из остатка месяца — пробили больше, завтра план ниже; не выбили — выше.
            </p>
          </form>

          <form class="rounded-xl border border-gray-200 bg-white p-4" @submit.prevent="addManual">
            <label class="block text-sm font-semibold text-gray-800" for="card-manual-input">Ручное пробитие · проходящий клиент</label>
            <div class="mt-2 flex flex-wrap gap-2">
              <input id="card-manual-input" v-model.number="manualAmount" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="Сумма"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 sm:w-28 sm:min-w-0"
                aria-label="Сумма ручного пробития BYN">
              <input v-model="manualNote" type="text" placeholder="Комментарий (необязательно)"
                class="w-full min-w-0 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 sm:flex-1"
                aria-label="Комментарий к пробитию">
              <CrmButton type="submit" variant="success" size="sm" class="w-full sm:!w-auto" :loading="busyForm === 'manual'">Внести</CrmButton>
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
        <form class="rounded-xl border border-gray-200 bg-white p-4" @submit.prevent="searchProfile">
          <h3 class="mb-1 text-sm font-bold text-gray-900">Проверить и настроить клиента</h3>
          <p class="mb-3 text-xs text-gray-500">
            Введите @username — увидите статус оплаты картой, лимиты, тариф и паузу.
            Разрешение и запрет — в одно нажатие. Новому клиенту выйдут стандартные
            лимиты (250 BYN/мес, 45 BYN/заказ, пауза 10 дней).
          </p>
          <div class="flex gap-2">
            <input v-model="accountUsername" type="text" placeholder="@username, например @ppofic" autocomplete="off"
              class="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              :class="{ 'border-rose-400': accountError }"
              aria-label="Telegram username без собаки">
            <CrmButton type="submit" variant="primary" size="sm" :loading="profileSearching">Найти</CrmButton>
          </div>
          <p v-if="accountError" class="mt-2 text-xs font-medium text-rose-700">{{ accountError }}</p>
        </form>

        <!-- Карточка найденного клиента -->
        <section
          v-if="foundProfile"
          class="rounded-xl border p-4"
          :class="foundProfile.enabled ? 'border-emerald-200 bg-emerald-50/50' : 'border-gray-200 bg-gray-50'"
          aria-live="polite"
        >
          <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="truncate text-base font-bold text-gray-900">@{{ foundProfile.telegram_username }}</span>
                <span
                  class="rounded-full px-2.5 py-0.5 text-[11px] font-bold"
                  :class="foundProfile.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-200 text-gray-600'"
                >
                  {{ foundProfile.enabled ? 'карта разрешена' : foundProfile.source === 'new' ? 'новый клиент' : 'карта запрещена' }}
                </span>
              </div>
              <div class="mt-0.5 text-[11px] text-gray-500">
                <template v-if="foundProfile.source === 'new'">
                  Новый клиент: карта ещё не разрешена — выдадутся стандартные лимиты
                </template>
                <template v-else-if="foundProfile.source === 'pending'">
                  Ждёт первого входа: привяжется к Telegram ID при визите
                </template>
                <template v-else>
                  TG ID {{ foundProfile.telegram_id }}<span v-if="foundProfile.last_issued_at"> · выдача {{ dateShort(foundProfile.last_issued_at) }}</span>
                </template>
              </div>
            </div>
            <!-- Разрешение/запрет в одно нажатие: на телефоне на всю ширину -->
            <CrmButton
              :variant="foundProfile.enabled ? 'danger' : 'success'"
              size="sm"
              block
              class="sm:!w-auto sm:!block"
              :loading="profileToggling"
              @click="toggleProfileEnabled"
            >
              {{ foundProfile.enabled ? 'Запретить оплату картой' : 'Разрешить оплату картой' }}
            </CrmButton>
          </div>

          <!-- Показатели клиента -->
          <div class="mt-3 grid gap-2 sm:grid-cols-3">
            <div class="flex items-baseline justify-between gap-2 rounded-lg bg-white px-3 py-2 sm:flex-col sm:items-center sm:justify-start sm:p-2.5 sm:text-center">
              <span class="text-[11px] font-medium text-gray-500 sm:mt-0">Лимит / месяц</span>
              <span class="text-sm font-bold text-gray-900">{{ money(foundProfile.monthly_limit_minor) }}</span>
            </div>
            <div class="flex items-baseline justify-between gap-2 rounded-lg bg-white px-3 py-2 sm:flex-col sm:items-center sm:justify-start sm:p-2.5 sm:text-center">
              <span class="text-[11px] font-medium text-gray-500">Лимит / заказ</span>
              <span class="text-sm font-bold text-gray-900">{{ money(foundProfile.max_order_minor) }}</span>
            </div>
            <div class="flex items-baseline justify-between gap-2 rounded-lg bg-white px-3 py-2 sm:flex-col sm:items-center sm:justify-start sm:p-2.5 sm:text-center">
              <span class="text-[11px] font-medium text-gray-500">Тариф</span>
              <span class="text-sm font-bold text-gray-900">{{ foundProfile.tariff_title || 'Стандарт' }}</span>
            </div>
          </div>

          <!-- Пауза: активная с принудительным снятием -->
          <div
            v-if="foundProfile.cooldown_until"
            class="mt-3 flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 sm:flex-row sm:items-center"
          >
            <div class="flex min-w-0 flex-1 items-center gap-2 text-sm">
              <ClockIcon class="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
              <span class="text-amber-900">
                Пауза после выдачи — <strong>{{ pluralDays(foundProfile.cooldown_days_left) }}</strong> до {{ dateShort(foundProfile.cooldown_until) }}
              </span>
            </div>
            <CrmButton
              variant="soft" size="sm"
              class="w-full sm:!w-auto"
              :loading="profileToggling"
              title="Снять паузу, как будто срок уже прошёл. После следующей выдачи пауза вернётся."
              @click="confirmCooldownClear = true"
            >Снять паузу принудительно</CrmButton>
          </div>

          <!-- Длительность паузы для будущих выдач -->
          <div class="mt-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5">
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label class="flex min-w-0 flex-1 items-center gap-2">
                <span class="shrink-0 text-xs font-medium text-gray-600">Пауза после выдачи</span>
                <input
                  v-model.number="profileCooldownDays"
                  type="number" min="0" max="365" step="1" inputmode="numeric"
                  class="w-16 min-w-0 rounded-lg border border-gray-300 px-2 py-1.5 text-center text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  :class="{ 'border-blue-400 ring-1 ring-blue-100': cooldownDaysChanged }"
                  :aria-label="`Длительность паузы в днях для ${foundProfile.telegram_username}, 0 — без паузы`">
                <span class="shrink-0 text-xs text-gray-500">дней · 0 = без паузы</span>
              </label>
              <div v-if="cooldownDaysChanged" class="flex gap-2 sm:shrink-0">
                <CrmButton variant="success" size="sm" class="flex-1 sm:!w-auto" :loading="profileToggling" @click="saveCooldownDays">
                  Сохранить
                </CrmButton>
                <CrmButton variant="ghost" size="sm" class="flex-1 sm:!w-auto" @click="resetCooldownDays">Отмена</CrmButton>
              </div>
              <div v-else class="text-[11px] text-gray-400">
                {{ foundProfile.cooldown_days === 0 ? 'Пауза отключена' : `Сейчас ${pluralDays(foundProfile.cooldown_days)} после каждой выдачи` }}
              </div>
            </div>
            <p class="mt-1.5 text-[11px] text-gray-400">
              Начнёт действовать со следующей выдачи заказа по карте.
            </p>
          </div>

          <!-- Быстрое редактирование -->
          <div class="mt-3 grid gap-2 sm:grid-cols-2">
            <label class="block">
              <span class="text-[11px] font-medium text-gray-500">Лимит заказа, BYN</span>
              <input v-model.number="profileOrderLimit" type="number" min="0.01" step="0.01" inputmode="decimal"
                class="mt-0.5 w-full rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                :aria-label="`Лимит заказа для ${foundProfile.telegram_username}`">
            </label>
            <label class="block">
              <span class="text-[11px] font-medium text-gray-500">Тариф</span>
              <select
                v-model="profileTariffId"
                class="mt-0.5 w-full rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                :aria-label="`Тариф для ${foundProfile.telegram_username}`"
                @change="applyProfileTariff"
              >
                <option value="">Стандарт (250/45 BYN)</option>
                <option v-for="tariff in activeTariffs" :key="tariff.id" :value="tariff.id">
                  {{ tariff.title }} · {{ minorToMoney(tariff.monthly_limit_minor ?? tariff.limit_minor) }}/{{ minorToMoney(tariff.per_order_limit_minor ?? 4500) }} BYN
                </option>
              </select>
            </label>
          </div>
          <div class="mt-2 flex sm:justify-end">
            <CrmButton variant="muted" size="sm" class="w-full sm:!w-auto" :loading="profileToggling" @click="saveProfileOrderLimit">Сохранить лимит заказа</CrmButton>
          </div>
        </section>

        <!-- Последние разрешения: клик открывает карточку в поиске выше.
             Список отдаёт сервер: 3 последних по updated_at (включая отключённых). -->
        <section class="rounded-xl border border-gray-200 bg-white p-4">
          <div class="mb-2.5 flex items-center justify-between">
            <h3 class="text-sm font-bold text-gray-900">Последние разрешения</h3>
            <span class="text-[11px] text-gray-400">{{ snapshot.accounts.length }}</span>
          </div>
          <div class="space-y-1.5">
            <button
              v-for="account in snapshot.accounts"
              :key="account.telegram_id"
              type="button"
              class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-gray-50 focus-visible:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              :aria-label="`Открыть карточку @${account.telegram_username || account.telegram_id}`"
              @click="openRecentAccount(account)"
            >
              <span
                class="h-2 w-2 shrink-0 rounded-full"
                :class="account.enabled ? 'bg-emerald-500' : 'bg-gray-300'"
                aria-hidden="true"
              />
              <span class="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">
                @{{ account.telegram_username || account.telegram_id }}
              </span>
              <span
                v-if="cooldownUntil(account)"
                class="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800"
              >пауза</span>
              <span
                class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold"
                :class="account.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-200 text-gray-600'"
              >
                {{ account.enabled ? 'разрешено' : 'откл.' }}
              </span>
            </button>
            <p v-if="!snapshot.accounts.length" class="py-1.5 text-xs text-gray-500">
              Пока никого. Разрешите оплату картой через поиск выше.
            </p>
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
            <div class="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
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
                class="self-start rounded-full px-2.5 py-1 text-[11px] font-semibold sm:shrink-0"
                :class="request.status === 'new' ? 'bg-blue-100 text-blue-800' : request.status === 'processed' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'"
              >
                {{ requestStatusLabel(request.status) }}
              </span>
            </div>
            <div v-if="request.status === 'new'" class="mt-2.5 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <CrmButton variant="primary" size="sm" class="w-full sm:!w-auto" :loading="busyRequest === request.id" title="Применить лимиты тарифа к аккаунту автоматически" @click="approveRequest(request)">
                Одобрить
              </CrmButton>
              <CrmButton variant="danger" size="sm" class="w-full sm:!w-auto" :loading="busyRequest === request.id" @click="confirmRejectRequest = request">
                Отклонить
              </CrmButton>
              <a
                v-if="request.telegram_username"
                class="col-span-2 inline-flex min-h-[40px] items-center justify-center rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50 sm:ml-auto sm:w-auto"
                :href="`https://t.me/${request.telegram_username}`" target="_blank" rel="noopener noreferrer"
              >Написать в Telegram</a>
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
            <div class="flex w-full gap-2 sm:w-auto">
              <CrmButton variant="soft" size="sm" class="flex-1 sm:!w-auto" @click="editTariff(tariff)">Изменить</CrmButton>
              <CrmButton variant="danger" size="sm" class="flex-1 sm:!w-auto" :loading="busyTariffId === tariff.id" @click="confirmTariffRemoval = tariff">
                Удалить
              </CrmButton>
            </div>
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

    <!-- Подтверждение принудительного снятия паузы -->
    <div
      v-if="confirmCooldownClear && foundProfile"
      class="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4"
      role="dialog" aria-modal="true" aria-label="Подтверждение снятия паузы"
      @click.self="confirmCooldownClear = false"
    >
      <div class="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <h4 class="text-sm font-bold text-gray-900">Снять паузу принудительно?</h4>
        <p class="mt-1.5 text-sm text-gray-600">
          @{{ foundProfile.telegram_username }} сможет платить картой сразу, как будто
          {{ pluralDays(foundProfile.cooldown_days_left || 0) }} уже прошли.
          После следующей выдачи пауза вернётся на установленное время.
        </p>
        <div class="mt-4 flex justify-end gap-2">
          <CrmButton variant="ghost" size="sm" @click="confirmCooldownClear = false">Отмена</CrmButton>
          <CrmButton variant="primary" size="sm" :loading="profileToggling" @click="clearCooldown">Снять паузу</CrmButton>
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
const busyRequest = ref("");
const busyTariffId = ref("");

const editingMonthKey = ref("");
const editingMonthLimit = ref(0);
const dailyDelta = ref<number | null>(null);
const foundProfile = ref<import("@/stores/crm").CardAccountProfile | null>(null);
const profileSearching = ref(false);
const profileToggling = ref(false);
const profileOrderLimit = ref(0);
const profileTariffId = ref("");
const profileCooldownDays = ref(10);
const confirmCooldownClear = ref(false);
const manualAmount = ref<number | null>(null);
const manualNote = ref("");
const accountUsername = ref("");
const accountError = ref("");
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
// Непросмотренные заявки от глобального поллинга: подсветим вкладку, пока
// менеджер не откроет окно заявок.
const unseenCardRequests = computed(() => crm.unseenCardRequestCount || 0);

const todayOperations = computed(() => snapshot.value?.operations || []);

const todayOperationsTotal = computed(() => {
  const total = todayOperations.value.reduce((sum, op) => sum + Number(op.amount_minor || 0), 0);
  return `${compactMoney(total)} за день`;
});

const activeTariffs = computed(
  () => (snapshot.value?.tariffs || []).filter((tariff) => Number(tariff.active) === 1),
);





watch(
  () => props.isOpen,
  (open) => {
    if (open) {
      activeTab.value = "limits";
      accountError.value = "";
      void load();
    } else {
      foundProfile.value = null;
      profileSearching.value = false;
      profileToggling.value = false;
      confirmCooldownClear.value = false;
      editingMonthKey.value = "";
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

function monthName(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const label = new Intl.DateTimeFormat("ru-BY", { month: "long", year: "numeric" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function startEditMonth(month: { month_key: string; limit_minor: number }) {
  editingMonthKey.value = month.month_key;
  editingMonthLimit.value = Number(month.limit_minor) / 100;
}

async function saveMonth() {
  if (editingMonthLimit.value == null || editingMonthLimit.value < 0) return;
  const ok = await run(
    () => crm.setCardMonthlyLimit(editingMonthKey.value, editingMonthLimit.value),
    "monthly",
  );
  if (ok) editingMonthKey.value = "";
}

async function adjustDaily() {
  if (dailyDelta.value == null || dailyDelta.value === 0) return;
  const ok = await run(() => crm.adjustCardDailyLimit(dailyDelta.value!), "daily");
  if (ok) dailyDelta.value = null;
}

function pluralDays(days: number) {
  const mod10 = days % 10;
  const mod100 = days % 100;
  if (mod10 === 1 && mod100 !== 11) return `${days} день`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${days} дня`;
  return `${days} дней`;
}

async function searchProfile() {
  accountError.value = "";
  foundProfile.value = null;
  const username = accountUsername.value.trim().replace(/^@+/, "");
  if (!username) {
    accountError.value = "Введите @username клиента.";
    return;
  }
  profileSearching.value = true;
  try {
    const profile = await crm.searchCardProfile(username);
    foundProfile.value = profile;
    profileOrderLimit.value = Number(profile.max_order_minor) / 100;
    profileTariffId.value = profile.tariff_id || "";
    profileCooldownDays.value = Number(profile.cooldown_days ?? 10);
  } catch (error: any) {
    if (error?.status === 404 || String(error?.message || "").includes("не найден")) {
      // Новый клиент: сразу показываем карточку создания разрешения —
      // выдаём стандарт (250/45/10) в одно нажатие.
      foundProfile.value = {
        source: "new",
        telegram_id: null,
        telegram_username: username,
        enabled: false,
        monthly_limit_minor: 25000,
        max_order_minor: 4500,
        tariff_id: null,
        tariff_title: null,
        cooldown_started_at: null,
        cooldown_until: null,
        cooldown_days_left: 0,
        cooldown_days: 10,
        last_issued_at: null,
      };
      profileOrderLimit.value = 45;
      profileTariffId.value = "";
      profileCooldownDays.value = 10;
    } else {
      accountError.value = error?.message || "Не удалось загрузить профиль";
    }
  } finally {
    profileSearching.value = false;
  }
}

function openRecentAccount(account: { telegram_id: string; telegram_username: string | null }) {
  accountUsername.value = account.telegram_username || account.telegram_id;
  void searchProfile();
}

async function toggleProfileEnabled() {
  if (!foundProfile.value) return;
  profileToggling.value = true;
  errorText.value = "";
  try {
    if (foundProfile.value.source === "linked" && foundProfile.value.telegram_id) {
      await crm.updateCardAccount(foundProfile.value.telegram_id, {
        enabled: !foundProfile.value.enabled,
      });
    } else {
      // Новый или pending-клиент: разрешение выдаётся по @username.
      await crm.saveCardAccount({
        telegram_username: foundProfile.value.telegram_username || "",
        enabled: !foundProfile.value.enabled,
      });
    }
    await refreshProfile();
    // Появится в «Последних разрешениях» сразу.
    void load();
  } catch (error: any) {
    errorText.value = error?.message || "Не удалось изменить разрешение";
  } finally {
    profileToggling.value = false;
  }
}

async function applyProfileTariff() {
  if (!foundProfile.value || !foundProfile.value.telegram_id) {
    errorText.value = "Тариф применяется после первого входа клиента в приложение";
    return;
  }
  profileToggling.value = true;
  try {
    await crm.applyCardTariff(foundProfile.value.telegram_id, profileTariffId.value || null);
    await refreshProfile();
  } catch (error: any) {
    errorText.value = error?.message || "Не удалось применить тариф";
  } finally {
    profileToggling.value = false;
  }
}

async function saveProfileOrderLimit() {
  if (!foundProfile.value || !foundProfile.value.telegram_id) {
    errorText.value = "Лимит сохранится после первого входа клиента в приложение";
    return;
  }
  if (profileOrderLimit.value == null || profileOrderLimit.value <= 0) {
    errorText.value = "Лимит заказа должен быть больше нуля";
    return;
  }
  profileToggling.value = true;
  try {
    await crm.updateCardAccount(foundProfile.value.telegram_id, {
      max_order: profileOrderLimit.value,
    });
    await refreshProfile();
  } catch (error: any) {
    errorText.value = error?.message || "Не удалось сохранить лимит";
  } finally {
    profileToggling.value = false;
  }
}

const cooldownDaysChanged = computed(
  () => foundProfile.value != null
    && Number.isFinite(Number(profileCooldownDays.value))
    && Number(profileCooldownDays.value) !== Number(foundProfile.value.cooldown_days ?? 10),
);

function resetCooldownDays() {
  profileCooldownDays.value = Number(foundProfile.value?.cooldown_days ?? 10);
}

async function saveCooldownDays() {
  if (!foundProfile.value || !foundProfile.value.telegram_id) {
    errorText.value = "Длительность паузы сохранится после первого входа клиента в приложение";
    return;
  }
  const days = Number(profileCooldownDays.value);
  if (!Number.isInteger(days) || days < 0 || days > 365) {
    errorText.value = "Дни паузы: целое число от 0 до 365";
    return;
  }
  profileToggling.value = true;
  try {
    await crm.setCardAccountCooldownDays(foundProfile.value.telegram_id, days);
    await refreshProfile();
  } catch (error: any) {
    errorText.value = error?.message || "Не удалось сохранить длительность паузы";
  } finally {
    profileToggling.value = false;
  }
}

async function clearCooldown() {
  if (!foundProfile.value?.telegram_id) return;
  profileToggling.value = true;
  try {
    await crm.clearCardAccountCooldown(foundProfile.value.telegram_id);
    confirmCooldownClear.value = false;
    await refreshProfile();
  } catch (error: any) {
    errorText.value = error?.message || "Не удалось снять паузу";
    confirmCooldownClear.value = false;
  } finally {
    profileToggling.value = false;
  }
}

async function refreshProfile() {
  const username = foundProfile.value?.telegram_username;
  if (!username) return;
  try {
    const profile = await crm.searchCardProfile(username);
    foundProfile.value = profile;
    profileOrderLimit.value = Number(profile.max_order_minor) / 100;
    profileTariffId.value = profile.tariff_id || "";
    profileCooldownDays.value = Number(profile.cooldown_days ?? 10);
  } catch {
    // профиль мог стать недоступным — оставляем как есть
  }
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
