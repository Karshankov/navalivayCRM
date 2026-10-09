<template>
  <div class="space-y-6">
    <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div class="space-y-1">
          <h2 class="text-xl font-bold text-slate-900">План пробития кассы</h2>
          <p class="text-sm text-slate-500">
            План месяца, факт по дням и автоматический перерасчёт на остаток дней.
          </p>
        </div>
        <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label class="flex min-w-[220px] flex-col gap-1 text-sm font-medium text-slate-700">
            <span>Месяц</span>
            <select
              v-model="selectedMonthId"
              class="rounded-xl border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
              @change="handleMonthChange"
            >
              <option value="">Выберите месяц</option>
              <option
                v-for="monthOption in cashPacingMonths"
                :key="monthOption.month.id"
                :value="monthOption.month.id"
              >
                {{ formatMonthOption(monthOption) }}
              </option>
            </select>
          </label>
          <button
            type="button"
            class="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
            @click="openCreateMonthModal()"
          >
            Создать месяц
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="!currentCashPacingMonth && !loadingCashPacing"
      class="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center text-slate-500"
    >
      <p class="text-base font-medium text-slate-700">Пока нет ни одного расчётного месяца</p>
      <p class="mt-2 text-sm">Создайте текущий или следующий месяц и начните вести план.</p>
      <button
        type="button"
        class="mt-5 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
        @click="openCreateMonthModal()"
      >
        Создать первый месяц
      </button>
    </div>

    <template v-else-if="currentCashPacingMonth">
      <div class="grid gap-4 xl:grid-cols-[1.4fr,1fr]">
        <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div class="mb-4 flex items-start justify-between gap-4">
            <div>
              <p class="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Период</p>
              <h3 class="mt-1 text-2xl font-bold text-slate-900">
                {{ formatMonthTitle(currentCashPacingMonth.month.month_key) }}
              </h3>
            </div>
            <span
              class="rounded-full px-3 py-1 text-xs font-semibold"
              :class="statusBadgeClass(currentCashPacingMonth.summary.month_status)"
            >
              {{ statusLabel(currentCashPacingMonth.summary.month_status) }}
            </span>
          </div>

          <div class="grid gap-4 md:grid-cols-2">
            <label class="flex flex-col gap-1 text-sm font-medium text-slate-700">
              <span>Название месяца</span>
              <input
                v-model.trim="monthMetaForm.title"
                type="text"
                class="rounded-xl border border-slate-200 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none"
                placeholder="Например, Апрель 2026"
              />
            </label>
            <div class="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <p class="font-medium text-slate-800">Месяц по учёту</p>
              <p class="mt-1">{{ currentCashPacingMonth.month.month_key }}</p>
            </div>
          </div>

          <label class="mt-4 flex flex-col gap-1 text-sm font-medium text-slate-700">
            <span>Заметка</span>
            <textarea
              v-model.trim="monthMetaForm.notes"
              rows="3"
              class="rounded-xl border border-slate-200 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none"
              placeholder="Любая пометка по месяцу, поставке или лимиту"
            />
          </label>

          <div class="mt-4 flex justify-end">
            <button
              type="button"
              class="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="savingMonthMeta"
              @click="saveMonthMeta"
            >
              {{ savingMonthMeta ? "Сохраняем..." : "Сохранить месяц" }}
            </button>
          </div>
        </section>

        <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
          <article class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p class="text-sm text-slate-500">Лимит месяца</p>
            <p class="mt-2 text-3xl font-bold text-slate-900">{{ formatCurrency(currentCashPacingMonth.summary.total_limit) }}</p>
          </article>
          <article class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p class="text-sm text-slate-500">Пробито</p>
            <p class="mt-2 text-3xl font-bold text-slate-900">{{ formatCurrency(currentCashPacingMonth.summary.actual_total) }}</p>
          </article>
          <article class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p class="text-sm text-slate-500">Осталось</p>
            <p class="mt-2 text-3xl font-bold" :class="currentCashPacingMonth.summary.remaining_total < 0 ? 'text-red-600' : 'text-slate-900'">
              {{ formatCurrency(currentCashPacingMonth.summary.remaining_total) }}
            </p>
          </article>
          <article class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p class="text-sm text-slate-500">
              {{ currentCashPacingMonth.summary.recommendation_date ? 'Рекомендация на день' : 'Рекомендация' }}
            </p>
            <p class="mt-2 text-3xl font-bold text-slate-900">
              {{
                currentCashPacingMonth.summary.recommendation_amount === null
                  ? "—"
                  : formatCurrency(currentCashPacingMonth.summary.recommendation_amount)
              }}
            </p>
            <p v-if="currentCashPacingMonth.summary.recommendation_date" class="mt-2 text-xs text-slate-500">
              На {{ formatDateLabel(currentCashPacingMonth.summary.recommendation_date) }} · осталось дней:
              {{ currentCashPacingMonth.summary.remaining_days }}
            </p>
          </article>
        </section>
      </div>

      <div class="grid gap-6 2xl:grid-cols-[1.2fr,1fr]">
        <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div class="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 class="text-lg font-bold text-slate-900">Товарный остаток месяца</h3>
              <p class="mt-1 text-sm text-slate-500">
                Базовый остаток обычно ставится на 1 число. Дозагрузка текущего месяца начинает влиять со следующего дня.
              </p>
            </div>
            <button
              type="button"
              class="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
              @click="openCreateItemModal"
            >
              Добавить позицию
            </button>
          </div>

          <div v-if="currentCashPacingMonth.items.length" class="overflow-x-auto">
            <table class="min-w-full divide-y divide-slate-200 text-sm">
              <thead class="bg-slate-50">
                <tr>
                  <th class="px-3 py-3 text-left font-semibold text-slate-500">Позиция</th>
                  <th class="px-3 py-3 text-left font-semibold text-slate-500">Тип</th>
                  <th class="px-3 py-3 text-left font-semibold text-slate-500">Дата</th>
                  <th class="px-3 py-3 text-right font-semibold text-slate-500">Кол-во</th>
                  <th class="px-3 py-3 text-right font-semibold text-slate-500">Себест.</th>
                  <th class="px-3 py-3 text-right font-semibold text-slate-500">Наценка</th>
                  <th class="px-3 py-3 text-right font-semibold text-slate-500">Розница / шт</th>
                  <th class="px-3 py-3 text-right font-semibold text-slate-500">Итого</th>
                  <th class="px-3 py-3 text-right font-semibold text-slate-500">Действия</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                <tr v-for="item in currentCashPacingMonth.items" :key="item.id" class="align-top">
                  <td class="px-3 py-3">
                    <p class="font-semibold text-slate-900">{{ item.title }}</p>
                    <p v-if="item.note" class="mt-1 text-xs text-slate-500">{{ item.note }}</p>
                  </td>
                  <td class="px-3 py-3 text-slate-600">
                    <span
                      class="rounded-full px-2.5 py-1 text-xs font-semibold"
                      :class="item.entry_type === 'addition' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'"
                    >
                      {{ item.entry_type === "addition" ? "Дозагрузка" : "База" }}
                    </span>
                  </td>
                  <td class="px-3 py-3 text-slate-600">{{ formatDateLabel(item.effective_from) }}</td>
                  <td class="px-3 py-3 text-right text-slate-900">{{ formatNumber(item.quantity) }}</td>
                  <td class="px-3 py-3 text-right text-slate-600">{{ formatCurrencyPrecise(item.cost_with_vat) }}</td>
                  <td class="px-3 py-3 text-right text-slate-600">{{ formatPercent(item.markup_percent) }}</td>
                  <td class="px-3 py-3 text-right text-slate-600">{{ formatCurrencyPrecise(item.retail_unit) }}</td>
                  <td class="px-3 py-3 text-right font-semibold text-slate-900">{{ formatCurrencyPrecise(item.retail_total_precise) }}</td>
                  <td class="px-3 py-3">
                    <div class="flex justify-end gap-2">
                      <button
                        type="button"
                        class="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                        @click="openEditItemModal(item)"
                      >
                        Изменить
                      </button>
                      <button
                        type="button"
                        class="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50"
                        @click="removeItem(item.id)"
                      >
                        Удалить
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
            Пока нет ни одной позиции месяца.
          </div>
        </section>

        <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div class="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 class="text-lg font-bold text-slate-900">Факт по дням</h3>
              <p class="mt-1 text-sm text-slate-500">
                В конце дня заносите сумму по Z-отчёту. После этого система сразу считает следующий день.
              </p>
            </div>
            <button
              type="button"
              class="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="!factsEditable"
              @click="openFactModal()"
            >
              Внести день
            </button>
          </div>

          <div class="max-h-[780px] overflow-y-auto rounded-2xl border border-slate-100">
            <table class="min-w-full divide-y divide-slate-200 text-sm">
              <thead class="sticky top-0 bg-slate-50">
                <tr>
                  <th class="px-3 py-3 text-left font-semibold text-slate-500">Дата</th>
                  <th class="px-3 py-3 text-right font-semibold text-slate-500">План</th>
                  <th class="px-3 py-3 text-right font-semibold text-slate-500">Факт</th>
                  <th class="px-3 py-3 text-right font-semibold text-slate-500">Отклонение</th>
                  <th class="px-3 py-3 text-right font-semibold text-slate-500">Остаток</th>
                  <th class="px-3 py-3 text-right font-semibold text-slate-500">Действия</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                <tr v-for="day in currentCashPacingMonth.daily_plan" :key="day.date">
                  <td class="px-3 py-3 text-slate-700">{{ formatDateLabel(day.date) }}</td>
                  <td class="px-3 py-3 text-right text-slate-700">{{ formatCurrency(day.recommended_amount) }}</td>
                  <td class="px-3 py-3 text-right font-semibold text-slate-900">
                    {{ day.actual_amount === null ? "—" : formatCurrency(day.actual_amount) }}
                  </td>
                  <td
                    class="px-3 py-3 text-right font-semibold"
                    :class="
                      day.deviation_amount === null
                        ? 'text-slate-400'
                        : day.deviation_amount > 0
                          ? 'text-red-600'
                          : day.deviation_amount < 0
                            ? 'text-emerald-600'
                            : 'text-slate-600'
                    "
                  >
                    {{
                      day.deviation_amount === null
                        ? "—"
                        : formatSignedCurrency(day.deviation_amount)
                    }}
                  </td>
                  <td class="px-3 py-3 text-right text-slate-600">{{ formatCurrency(day.remaining_after_day) }}</td>
                  <td class="px-3 py-3">
                    <div class="flex justify-end gap-2">
                      <button
                        type="button"
                        class="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        :disabled="!factsEditable"
                        @click="openFactModal(day)"
                      >
                        {{ day.has_fact ? "Изменить" : "Внести" }}
                      </button>
                      <button
                        v-if="day.has_fact"
                        type="button"
                        class="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                        :disabled="!factsEditable"
                        @click="removeFact(day.date)"
                      >
                        Удалить
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </template>

    <AdminModal
      :isOpen="showMonthModal"
      title="Создать расчётный месяц"
      description="Укажите месяц, который будете вести по кассовому лимиту."
      size="sm"
      :showActions="false"
      @close="closeMonthModal"
      @cancel="closeMonthModal"
    >
      <div class="space-y-4">
        <label class="flex flex-col gap-1 text-sm font-medium text-slate-700">
          <span>Месяц</span>
          <input
            v-model="monthCreateForm.month_key"
            type="month"
            class="rounded-xl border border-slate-200 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none"
          />
        </label>
        <label class="flex flex-col gap-1 text-sm font-medium text-slate-700">
          <span>Название</span>
          <input
            v-model.trim="monthCreateForm.title"
            type="text"
            class="rounded-xl border border-slate-200 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none"
            placeholder="Можно оставить пустым"
          />
        </label>
        <label class="flex flex-col gap-1 text-sm font-medium text-slate-700">
          <span>Заметка</span>
          <textarea
            v-model.trim="monthCreateForm.notes"
            rows="3"
            class="rounded-xl border border-slate-200 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none"
          />
        </label>
        <div class="flex gap-3 pt-2">
          <button
            type="button"
            class="flex-1 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="creatingMonth"
            @click="submitCreateMonth"
          >
            {{ creatingMonth ? "Создаём..." : "Создать" }}
          </button>
          <button
            type="button"
            class="flex-1 rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
            @click="closeMonthModal"
          >
            Отмена
          </button>
        </div>
      </div>
    </AdminModal>

    <AdminModal
      :isOpen="showItemModal"
      :title="editingItemId ? 'Изменить позицию месяца' : 'Добавить позицию месяца'"
      description="Позиция считает розничную сумму по себестоимости с НДС и наценке."
      size="sm"
      :showActions="false"
      @close="closeItemModal"
      @cancel="closeItemModal"
    >
      <div class="space-y-4">
        <label class="flex flex-col gap-1 text-sm font-medium text-slate-700">
          <span>Название позиции</span>
          <input
            v-model.trim="itemForm.title"
            type="text"
            class="rounded-xl border border-slate-200 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none"
          />
        </label>
        <div class="grid grid-cols-2 gap-4">
          <label class="flex flex-col gap-1 text-sm font-medium text-slate-700">
            <span>Кол-во</span>
            <input
              v-model.number="itemForm.quantity"
              type="number"
              min="0"
              step="1"
              class="rounded-xl border border-slate-200 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label class="flex flex-col gap-1 text-sm font-medium text-slate-700">
            <span>Себестоимость с НДС</span>
            <input
              v-model.number="itemForm.cost_with_vat"
              type="number"
              min="0"
              step="0.01"
              class="rounded-xl border border-slate-200 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none"
            />
          </label>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <label class="flex flex-col gap-1 text-sm font-medium text-slate-700">
            <span>Наценка %</span>
            <input
              v-model.number="itemForm.markup_percent"
              type="number"
              min="0"
              step="0.01"
              class="rounded-xl border border-slate-200 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label class="flex flex-col gap-1 text-sm font-medium text-slate-700">
            <span>Тип записи</span>
            <select
              v-model="itemForm.entry_type"
              class="rounded-xl border border-slate-200 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="base">Базовый остаток</option>
              <option value="addition">Дозагрузка</option>
            </select>
          </label>
        </div>
        <label class="flex flex-col gap-1 text-sm font-medium text-slate-700">
          <span>Влияет с даты</span>
          <input
            v-model="itemForm.effective_from"
            type="date"
            :min="itemEffectiveDateMin || undefined"
            class="rounded-xl border border-slate-200 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none"
          />
        </label>
        <p
          v-if="additionNeedsNextMonth"
          class="text-xs font-medium text-amber-600"
        >
          Для текущего месяца дозагрузка уже не успеет начать действовать завтра. Создайте следующий месяц.
        </p>
        <p
          v-else-if="itemForm.entry_type === 'addition' && itemEffectiveDateMin"
          class="text-xs text-slate-500"
        >
          Для текущего месяца дозагрузка начинает влиять минимум со следующего дня.
        </p>
        <label class="flex flex-col gap-1 text-sm font-medium text-slate-700">
          <span>Заметка</span>
          <textarea
            v-model.trim="itemForm.note"
            rows="2"
            class="rounded-xl border border-slate-200 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none"
          />
        </label>
        <div class="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <p>Розница / шт: <span class="font-semibold text-slate-900">{{ formatCurrencyPrecise(itemPreview.unit) }}</span></p>
          <p class="mt-1">Розница итого: <span class="font-semibold text-slate-900">{{ formatCurrencyPrecise(itemPreview.total) }}</span></p>
          <p class="mt-1">В лимит месяца войдёт: <span class="font-semibold text-slate-900">{{ formatCurrency(Math.round(itemPreview.total)) }}</span></p>
        </div>
        <div class="flex gap-3 pt-2">
          <button
            type="button"
            class="flex-1 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="savingItem"
            @click="submitItem"
          >
            {{ savingItem ? "Сохраняем..." : editingItemId ? "Сохранить" : "Добавить" }}
          </button>
          <button
            type="button"
            class="flex-1 rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
            @click="closeItemModal"
          >
            Отмена
          </button>
        </div>
      </div>
    </AdminModal>

    <AdminModal
      :isOpen="showFactModal"
      title="Факт по кассе за день"
      description="Введите общую сумму по Z-отчёту за выбранный день."
      size="sm"
      :showActions="false"
      @close="closeFactModal"
      @cancel="closeFactModal"
    >
      <div class="space-y-4">
        <label class="flex flex-col gap-1 text-sm font-medium text-slate-700">
          <span>Дата</span>
          <input
            v-model="factForm.fact_date"
            type="date"
            :max="factDateMax || undefined"
            class="rounded-xl border border-slate-200 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none"
          />
        </label>
        <p
          v-if="!factsEditable"
          class="text-xs font-medium text-amber-600"
        >
          Для будущего месяца факт по дням пока вносить нельзя.
        </p>
        <label class="flex flex-col gap-1 text-sm font-medium text-slate-700">
          <span>Пробито за день</span>
          <input
            v-model.number="factForm.actual_amount"
            type="number"
            min="0"
            step="0.01"
            class="rounded-xl border border-slate-200 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none"
          />
        </label>
        <label class="flex flex-col gap-1 text-sm font-medium text-slate-700">
          <span>Заметка</span>
          <textarea
            v-model.trim="factForm.note"
            rows="2"
            class="rounded-xl border border-slate-200 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none"
          />
        </label>
        <div class="flex gap-3 pt-2">
          <button
            type="button"
            class="flex-1 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="savingFact"
            @click="submitFact"
          >
            {{ savingFact ? "Сохраняем..." : "Сохранить день" }}
          </button>
          <button
            type="button"
            class="flex-1 rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
            @click="closeFactModal"
          >
            Отмена
          </button>
        </div>
      </div>
    </AdminModal>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import AdminModal from "@/components/AdminModal.vue";
import {
  useCrmStore,
  type CashPacingDayPlan,
  type CashPacingItem,
  type CashPacingMonthListItem,
} from "@/stores/crm";
import {
  formatBusinessDate,
  getBusinessDateParts,
  shiftBusinessDate,
} from "@/utils/businessTime";

const crmStore = useCrmStore();
const {
  cashPacingMonths,
  currentCashPacingMonth,
  loadingCashPacing,
  suggestedCashPacingMonthKey,
} = storeToRefs(crmStore);

const selectedMonthId = ref("");
const showMonthModal = ref(false);
const creatingMonth = ref(false);
const savingMonthMeta = ref(false);
const showItemModal = ref(false);
const savingItem = ref(false);
const editingItemId = ref<string | null>(null);
const showFactModal = ref(false);
const savingFact = ref(false);

const monthCreateForm = reactive({
  month_key: "",
  title: "",
  notes: "",
});

const monthMetaForm = reactive({
  title: "",
  notes: "",
});

const itemForm = reactive({
  title: "",
  quantity: 1,
  cost_with_vat: 0,
  markup_percent: 0,
  effective_from: "",
  entry_type: "base" as "base" | "addition",
  note: "",
});

const factForm = reactive({
  fact_date: "",
  actual_amount: 0,
  note: "",
});

const itemPreview = computed(() => {
  const quantity = Number(itemForm.quantity || 0);
  const costWithVat = Number(itemForm.cost_with_vat || 0);
  const markupPercent = Number(itemForm.markup_percent || 0);
  const unit = costWithVat * (1 + markupPercent / 100);
  return {
    unit,
    total: unit * quantity,
  };
});

const todayBusinessParts = computed(() => getBusinessDateParts());

const currentBusinessDateKey = computed(() =>
  formatDateKeyFromParts(todayBusinessParts.value),
);

const nextBusinessDateKey = computed(() =>
  formatDateKeyFromParts(shiftBusinessDate(todayBusinessParts.value, 1)),
);

const itemEffectiveDateMin = computed(() => {
  if (!currentCashPacingMonth.value) return "";

  const monthKey = currentCashPacingMonth.value.month.month_key;
  if (itemForm.entry_type !== "addition") {
    return getMonthFirstDate(monthKey);
  }

  if (monthKey !== getCurrentMonthKey()) {
    return getMonthFirstDate(monthKey);
  }

  if (!nextBusinessDateKey.value.startsWith(`${monthKey}-`)) {
    return "";
  }

  return nextBusinessDateKey.value;
});

const additionNeedsNextMonth = computed(() => {
  if (!currentCashPacingMonth.value) return false;
  if (itemForm.entry_type !== "addition") return false;

  const monthKey = currentCashPacingMonth.value.month.month_key;
  return (
    monthKey === getCurrentMonthKey() &&
    !nextBusinessDateKey.value.startsWith(`${monthKey}-`)
  );
});

const factsEditable = computed(
  () => currentCashPacingMonth.value?.summary.month_status !== "future",
);

const factDateMax = computed(() => {
  if (!currentCashPacingMonth.value) return "";

  const monthKey = currentCashPacingMonth.value.month.month_key;
  if (monthKey === getCurrentMonthKey()) {
    return currentBusinessDateKey.value;
  }

  if (monthKey < getCurrentMonthKey()) {
    return getMonthLastDate(monthKey);
  }

  return "";
});

watch(
  () => currentCashPacingMonth.value,
  (detail) => {
    if (!detail) return;
    selectedMonthId.value = detail.month.id;
    monthMetaForm.title = detail.month.title || "";
    monthMetaForm.notes = detail.month.notes || "";
    factForm.fact_date =
      detail.summary.recommendation_date || detail.daily_plan[0]?.date || "";
  },
  { immediate: true },
);

onMounted(async () => {
  await crmStore.fetchCashPacingMonths();

  if (!cashPacingMonths.value.length) {
    monthCreateForm.month_key =
      suggestedCashPacingMonthKey.value || getCurrentMonthKey();
    return;
  }

  const preferredMonth =
    cashPacingMonths.value.find(
      (entry) => entry.month.month_key === getCurrentMonthKey(),
    ) || cashPacingMonths.value[0];

  if (preferredMonth) {
    selectedMonthId.value = preferredMonth.month.id;
    await crmStore.fetchCashPacingMonth(preferredMonth.month.id);
  }
});

function getCurrentMonthKey() {
  const parts = getBusinessDateParts();
  return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
}

function handleMonthChange() {
  if (!selectedMonthId.value) return;
  crmStore.fetchCashPacingMonth(selectedMonthId.value);
}

function openCreateMonthModal(monthKey = "") {
  monthCreateForm.month_key =
    monthKey || suggestedCashPacingMonthKey.value || getCurrentMonthKey();
  monthCreateForm.title = "";
  monthCreateForm.notes = "";
  showMonthModal.value = true;
}

function closeMonthModal() {
  showMonthModal.value = false;
}

async function submitCreateMonth() {
  if (!monthCreateForm.month_key) {
    alert("Выберите месяц");
    return;
  }

  creatingMonth.value = true;
  try {
    const detail = await crmStore.createCashPacingMonth({
      month_key: monthCreateForm.month_key,
      title: monthCreateForm.title || undefined,
      notes: monthCreateForm.notes || undefined,
    });
    selectedMonthId.value = detail.month.id;
    closeMonthModal();
  } catch (error: any) {
    if (error?.message === "month_exists") {
      alert("Этот месяц уже создан");
    } else {
      alert("Не удалось создать месяц");
    }
  } finally {
    creatingMonth.value = false;
  }
}

async function saveMonthMeta() {
  if (!currentCashPacingMonth.value) return;
  savingMonthMeta.value = true;
  try {
    await crmStore.updateCashPacingMonth(currentCashPacingMonth.value.month.id, {
      title: monthMetaForm.title || undefined,
      notes: monthMetaForm.notes || undefined,
    });
  } catch (error) {
    alert("Не удалось сохранить месяц");
  } finally {
    savingMonthMeta.value = false;
  }
}

function getMonthFirstDate(monthKey: string) {
  return `${monthKey}-01`;
}

function getMonthLastDate(monthKey: string) {
  const { year, month } = parseMonthKey(monthKey);
  const lastDay = new Date(Date.UTC(year, month, 0, 12, 0, 0)).getUTCDate();
  return formatDateKeyFromParts({ year, month, day: lastDay });
}

function formatDateKeyFromParts(parts: { year: number; month: number; day: number }) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function getDefaultAdditionDate(monthKey: string) {
  const today = getBusinessDateParts();
  const todayMonthKey = `${today.year}-${String(today.month).padStart(2, "0")}`;
  if (todayMonthKey !== monthKey) {
    return getMonthFirstDate(monthKey);
  }

  const nextDay = shiftBusinessDate(today, 1);
  const nextMonthKey = `${nextDay.year}-${String(nextDay.month).padStart(2, "0")}`;
  if (nextMonthKey !== monthKey) {
    return "";
  }

  return formatDateKeyFromParts(nextDay);
}

function resetItemForm() {
  const monthKey =
    currentCashPacingMonth.value?.month.month_key || getCurrentMonthKey();
  itemForm.title = "";
  itemForm.quantity = 1;
  itemForm.cost_with_vat = 0;
  itemForm.markup_percent = 0;
  itemForm.entry_type = "base";
  itemForm.effective_from = getMonthFirstDate(monthKey);
  itemForm.note = "";
}

function openCreateItemModal() {
  if (!currentCashPacingMonth.value) return;
  resetItemForm();
  if (currentCashPacingMonth.value.items.length > 0) {
    itemForm.entry_type = "addition";
    itemForm.effective_from = getDefaultAdditionDate(
      currentCashPacingMonth.value.month.month_key,
    );
  }
  editingItemId.value = null;
  showItemModal.value = true;
}

function openEditItemModal(item: CashPacingItem) {
  editingItemId.value = item.id;
  itemForm.title = item.title;
  itemForm.quantity = item.quantity;
  itemForm.cost_with_vat = item.cost_with_vat;
  itemForm.markup_percent = item.markup_percent;
  itemForm.effective_from = item.effective_from;
  itemForm.entry_type = item.entry_type;
  itemForm.note = item.note || "";
  showItemModal.value = true;
}

function closeItemModal() {
  showItemModal.value = false;
  editingItemId.value = null;
  resetItemForm();
}

async function submitItem() {
  if (!currentCashPacingMonth.value) return;
  if (!itemForm.title.trim()) {
    alert("Введите название позиции");
    return;
  }
  if (!itemForm.effective_from) {
    alert("Выберите дату, с которой позиция начинает влиять на лимит");
    return;
  }
  if (additionNeedsNextMonth.value) {
    alert("Для текущего месяца дозагрузка уже не успеет начать действовать завтра. Создайте следующий месяц.");
    return;
  }
  if (
    itemForm.entry_type === "addition" &&
    itemEffectiveDateMin.value &&
    itemForm.effective_from < itemEffectiveDateMin.value
  ) {
    alert("Дозагрузка текущего месяца должна начинать влиять минимум со следующего дня.");
    return;
  }

  savingItem.value = true;
  try {
    if (editingItemId.value) {
      await crmStore.updateCashPacingItem(editingItemId.value, {
        title: itemForm.title.trim(),
        quantity: Number(itemForm.quantity),
        cost_with_vat: Number(itemForm.cost_with_vat),
        markup_percent: Number(itemForm.markup_percent),
        effective_from: itemForm.effective_from,
        entry_type: itemForm.entry_type,
        note: itemForm.note || undefined,
      });
    } else {
      await crmStore.createCashPacingItem(currentCashPacingMonth.value.month.id, {
        title: itemForm.title.trim(),
        quantity: Number(itemForm.quantity),
        cost_with_vat: Number(itemForm.cost_with_vat),
        markup_percent: Number(itemForm.markup_percent),
        effective_from: itemForm.effective_from,
        entry_type: itemForm.entry_type,
        note: itemForm.note || undefined,
      });
    }
    closeItemModal();
  } catch (error: any) {
    if (error?.message === "addition_starts_next_day") {
      alert("Дозагрузка текущего месяца должна начинать влиять минимум со следующего дня.");
    } else {
      alert("Не удалось сохранить позицию");
    }
  } finally {
    savingItem.value = false;
  }
}

async function removeItem(itemId: string) {
  if (!confirm("Удалить эту позицию из расчётного месяца?")) return;
  try {
    await crmStore.deleteCashPacingItem(itemId);
  } catch (error) {
    alert("Не удалось удалить позицию");
  }
}

function openFactModal(day?: CashPacingDayPlan) {
  if (!currentCashPacingMonth.value) return;
  if (!factsEditable.value) {
    alert("Для будущего месяца факт по дням пока вносить нельзя.");
    return;
  }
  const existingFact = day
    ? currentCashPacingMonth.value.daily_facts.find(
        (entry) => entry.fact_date === day.date,
      )
    : null;
  factForm.fact_date =
    existingFact?.fact_date ||
    day?.date ||
    currentCashPacingMonth.value.summary.recommendation_date ||
    currentCashPacingMonth.value.daily_plan[0]?.date ||
    "";
  factForm.actual_amount = existingFact?.actual_amount || 0;
  factForm.note = existingFact?.note || "";
  showFactModal.value = true;
}

function closeFactModal() {
  showFactModal.value = false;
  factForm.fact_date =
    currentCashPacingMonth.value?.summary.recommendation_date || "";
  factForm.actual_amount = 0;
  factForm.note = "";
}

async function submitFact() {
  if (!currentCashPacingMonth.value) return;
  if (!factForm.fact_date) {
    alert("Выберите дату");
    return;
  }
  if (!factsEditable.value) {
    alert("Для будущего месяца факт по дням пока вносить нельзя.");
    return;
  }
  if (factDateMax.value && factForm.fact_date > factDateMax.value) {
    alert("Факт можно вносить только по уже прошедшему дню.");
    return;
  }

  savingFact.value = true;
  try {
    await crmStore.upsertCashPacingDailyFact(currentCashPacingMonth.value.month.id, {
      fact_date: factForm.fact_date,
      actual_amount: Number(factForm.actual_amount),
      note: factForm.note || undefined,
    });
    closeFactModal();
  } catch (error: any) {
    if (error?.message === "future_fact_date") {
      alert("Факт можно вносить только по уже прошедшему дню.");
    } else {
      alert("Не удалось сохранить факт дня");
    }
  } finally {
    savingFact.value = false;
  }
}

async function removeFact(date: string) {
  if (!currentCashPacingMonth.value) return;
  if (!confirm("Удалить факт по этому дню?")) return;
  try {
    await crmStore.deleteCashPacingDailyFact(
      currentCashPacingMonth.value.month.id,
      date,
    );
  } catch (error) {
    alert("Не удалось удалить факт дня");
  }
}

function parseMonthKey(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return { year, month };
}

function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return { year, month, day };
}

function formatMonthTitle(monthKey: string) {
  const { year, month } = parseMonthKey(monthKey);
  return formatBusinessDate(
    { year, month, day: 1 },
    { month: "long", year: "numeric" },
  );
}

function formatMonthOption(option: CashPacingMonthListItem) {
  return `${option.month.title || formatMonthTitle(option.month.month_key)} · ${option.month.month_key}`;
}

function formatDateLabel(dateKey: string) {
  const { year, month, day } = parseDateKey(dateKey);
  return formatBusinessDate(
    { year, month, day },
    { day: "2-digit", month: "2-digit" },
  );
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "BYN",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatCurrencyPrecise(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "BYN",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function formatSignedCurrency(value: number) {
  const numericValue = Number(value || 0);
  return `${numericValue > 0 ? "+" : ""}${formatCurrency(numericValue)}`;
}

function formatPercent(value: number) {
  return `${Number(value || 0)}%`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function statusLabel(status: "past" | "current" | "future") {
  if (status === "current") return "Текущий месяц";
  if (status === "future") return "Будущий месяц";
  return "Прошедший месяц";
}

function statusBadgeClass(status: "past" | "current" | "future") {
  if (status === "current") return "bg-blue-100 text-blue-700";
  if (status === "future") return "bg-emerald-100 text-emerald-700";
  return "bg-slate-100 text-slate-700";
}
</script>
