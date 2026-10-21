<template>
  <div class="crm-orders-page">
    <div class="crm-orders-content">
      <!-- Back Button -->
      <div class="crm-orders-heading">
        <h1 class="crm-orders-title">Финансы</h1>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="crm-reference-button"
            :class="activePanel === 'money' ? 'crm-reference-button--primary' : 'crm-reference-button--gray'"
            @click="activePanel = 'money'"
          >
            Счета и транзакции
          </button>
          <button
            type="button"
            class="crm-reference-button"
            :class="activePanel === 'pacing' ? 'crm-reference-button--primary' : 'crm-reference-button--gray'"
            @click="activePanel = 'pacing'"
          >
            План пробития
          </button>
          <button
            type="button"
            class="crm-reference-button crm-reference-button--gray"
            data-test="revenue-trigger-button"
            @click="openRevenueTriggerModal"
          >
            Триггер выручки
          </button>
        </div>
      </div>

      <template v-if="profitUnlocked">
        <template v-if="activePanel === 'money'">
        <!-- Cash Accounts -->
        <div class="mb-8">
          <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 class="text-xl font-bold text-gray-900">Счета и кассы</h2>
            <button @click="showAccountModal = true" class="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 sm:w-auto">Добавить счёт</button>
          </div>
          <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div v-for="account in cashAccounts" :key="account.id" class="bg-white rounded-lg shadow-sm p-6">
              <div class="flex items-center justify-between mb-2">
                <h3 class="font-medium text-gray-900">{{ account.name }}</h3>
                <div class="flex items-center gap-2">
                  <span v-if="account.is_default" class="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs font-medium">По умолчанию</span>
                  <button 
                    @click="confirmDeleteAccount(account)" 
                    class="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                    title="Удалить счёт"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
              <div class="text-2xl font-bold text-gray-900">{{ formatCurrency(account.balance) }}</div>
            </div>
          </div>
        </div>

        <!-- Transactions -->
        <div class="rounded-lg bg-white p-6 shadow-sm">
          <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 class="text-xl font-bold text-gray-900">Транзакции</h2>
            <div class="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
              <button @click="transactionFilter = null" :class="filterBtnClass(null)">Все</button>
              <button @click="transactionFilter = 'income'" :class="filterBtnClass('income')">Приход</button>
              <button @click="transactionFilter = 'expense'" :class="filterBtnClass('expense')">Расход</button>
              <button @click="showTransactionModal = true" class="w-full rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-700 sm:w-auto sm:ml-2">Добавить</button>
            </div>
          </div>

          <div v-if="cashTransactions.length > 0" class="overflow-x-auto">
            <table class="w-full">
              <thead class="border-b">
                <tr>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Дата</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Счёт</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Тип</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Описание</th>
                  <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Сумма</th>
                  <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Действия</th>
                </tr>
              </thead>
              <tbody class="divide-y">
                <tr v-for="transaction in cashTransactions" :key="transaction.id" class="hover:bg-gray-50">
                  <td class="px-4 py-3 text-sm text-gray-500">{{ formatDate(transaction.created_at) }}</td>
                  <td class="px-4 py-3 text-sm text-gray-900">{{ transaction.account_name }}</td>
                  <td class="px-4 py-3">
                    <span :class="transaction.type === 'income' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'" class="px-2 py-1 rounded-full text-xs font-medium">
                      {{ transaction.type === 'income' ? 'Приход' : 'Расход' }}
                    </span>
                  </td>
                  <td class="px-4 py-3 text-sm text-gray-900">{{ transaction.description || '—' }}</td>
                  <td class="px-4 py-3 text-sm text-right font-medium" :class="transaction.type === 'income' ? 'text-green-600' : 'text-red-600'">
                    {{ transaction.type === 'income' ? '+' : '-' }}{{ formatCurrency(transaction.amount) }}
                  </td>
                  <td class="px-4 py-3">
                    <div class="flex justify-end gap-2">
                      <button
                        @click="openEditTransaction(transaction)"
                        :disabled="isAutoTransaction(transaction)"
                        class="admin-link-button admin-link-button--edit disabled:cursor-not-allowed disabled:opacity-40"
                        :title="getEditTransactionTitle(transaction)"
                      >
                        Редактировать
                      </button>
                      <button
                        @click="deleteTransaction(transaction)"
                        :disabled="isAutoTransaction(transaction)"
                        class="admin-link-button admin-link-button--danger disabled:cursor-not-allowed disabled:opacity-40"
                        :title="getDeleteTransactionTitle(transaction)"
                      >
                        Удалить
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="text-center py-8 text-gray-500">Транзакций нет</div>
        </div>
        </template>

        <CrmCashPacingPanel v-else />
      </template>

      <div v-else class="relative overflow-hidden rounded-3xl border border-dashed border-blue-200 bg-white/80 p-10 text-center shadow-inner">
        <div class="mx-auto flex max-w-xl flex-col items-center gap-5">
          <span class="inline-flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 text-blue-600">
            <LockClosedIcon class="h-8 w-8" />
          </span>
          <button
            type="button"
            class="inline-flex items-center gap-2 rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
            @click="openPasswordModal"
            :disabled="verifyingPassword"
          >
            <LockClosedIcon class="h-5 w-5" />
            <span>{{ verifyingPassword ? 'Проверяем…' : 'Ввести лицензионный ключ' }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Profit Password Modal -->
    <AdminModal
      :isOpen="showPasswordModal"
      title="Подтверждение доступа"
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
          input-class="w-full rounded-xl border border-[#eaf0f9] px-4 py-3 text-sm text-[#081b4b] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0958ff]"
        />
        <div class="flex gap-3 pt-2">
          <button
            type="submit"
            class="flex-1 rounded-xl bg-[linear-gradient(100deg,#05b8ff,#185dff)] px-4 py-3 text-[13px] font-bold text-white shadow-[0_8px_16px_#148cff30] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="verifyingPassword"
          >
            {{ verifyingPassword ? 'Проверяем…' : 'Показать' }}
          </button>
          <button
            type="button"
            class="flex-1 rounded-xl bg-[linear-gradient(#f7faff,#e9f0fa)] px-4 py-3 text-[13px] font-bold text-[#233e70] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
            @click="closePasswordModal"
            :disabled="verifyingPassword"
          >
            Отмена
          </button>
        </div>
      </form>
    </AdminModal>

    <!-- Add Transaction Modal -->
    <AdminModal
      :isOpen="showTransactionModal"
      title="Добавить транзакцию"
      description="Заполните данные для новой операции."
      size="sm"
      :showActions="false"
      @close="showTransactionModal = false"
      @cancel="showTransactionModal = false"
    >
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Счёт</label>
          <select v-model="newTransaction.account_id" class="w-full px-3 py-2 border border-gray-300 rounded-md">
            <option v-for="acc in cashAccounts" :key="acc.id" :value="acc.id">{{ acc.name }}</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Тип</label>
          <select v-model="newTransaction.type" class="w-full px-3 py-2 border border-gray-300 rounded-md">
            <option value="income">Приход</option>
            <option value="expense">Расход</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Сумма</label>
          <input v-model.number="newTransaction.amount" type="number" class="w-full px-3 py-2 border border-gray-300 rounded-md" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Описание</label>
          <input v-model="newTransaction.description" type="text" class="w-full px-3 py-2 border border-gray-300 rounded-md" />
        </div>
        <div class="flex gap-3 pt-2">
          <button @click="addTransaction" class="flex-1 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700">Добавить</button>
          <button @click="showTransactionModal = false" class="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300">Отмена</button>
        </div>
      </div>
    </AdminModal>

    <!-- Revenue Trigger Modal -->
    <AdminModal
      :isOpen="showRevenueTriggerModal"
      title="Триггер выручки"
      description="Когда счёт «Выручка» достигнет суммы — юзербот уведомит выбранных."
      size="sm"
      :showActions="false"
      @close="showRevenueTriggerModal = false"
      @cancel="showRevenueTriggerModal = false"
    >
      <div class="space-y-4">
        <!-- Текущий баланс -->
        <div v-if="revenueAccount" class="rounded-xl border border-[#eaf0f9] bg-[#f7fbff] px-4 py-3">
          <span class="text-[11px] font-bold uppercase tracking-[.14em] text-[#8898b5]">Сейчас на «{{ revenueAccount.name }}»</span>
          <p class="m-0 mt-1 text-[18px] font-bold text-[#081b4b]">{{ formatCurrency(revenueAccount.balance) }}</p>
        </div>

        <!-- Форма: сумма + получатели -->
        <form class="space-y-3" data-test="revenue-trigger-form" @submit.prevent="submitRevenueTrigger">
          <div>
            <label for="revenue-trigger-threshold" class="mb-1 block text-[12px] font-bold text-[#081b4b]">
              Сумма триггера (BYN)
            </label>
            <input
              id="revenue-trigger-threshold"
              v-model.number="revenueTriggerForm.threshold"
              type="number"
              min="0.01"
              step="0.01"
              required
              placeholder="напр. 2500"
              class="w-full rounded-xl border border-[#eaf0f9] bg-white px-4 py-3 text-sm text-[#081b4b] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0958ff]"
            />
          </div>

          <div>
            <span class="mb-2 block text-[12px] font-bold text-[#081b4b]">Уведомить</span>
            <div class="space-y-2">
              <label
                v-for="username in revenueTeam"
                :key="username"
                class="flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors"
                :class="isTriggerRecipientSelected(username) ? 'border-[#a7e3c4] bg-[#eafaf1]' : 'border-[#eaf0f9] bg-white hover:bg-[#f7fbff]'"
              >
                <input
                  type="checkbox"
                  class="h-4 w-4 accent-[#10b981]"
                  :checked="isTriggerRecipientSelected(username)"
                  @change="toggleTriggerRecipient(username)"
                />
                <span class="text-sm font-semibold text-[#081b4b]">@{{ username }}</span>
              </label>
            </div>
          </div>

          <p v-if="revenueTriggerError" class="m-0 rounded-xl border border-[#f5c9d3] bg-[#fff1f3] px-4 py-3 text-[12px] text-[#b92444]" role="alert">
            {{ revenueTriggerError }}
          </p>

          <div class="flex gap-3 pt-1">
            <button
              type="submit"
              class="flex-1 rounded-xl bg-[linear-gradient(115deg,#10b981,#059669)] px-4 py-3 text-[13px] font-bold text-white shadow-[0_8px_16px_#10b98130] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="revenueTriggerSaving"
            >
              {{ revenueTriggerSaving ? 'Сохраняем…' : (editingRevenueTriggerId ? 'Сохранить' : 'Создать триггер') }}
            </button>
            <button
              type="button"
              class="flex-1 rounded-xl bg-[linear-gradient(#f7faff,#e9f0fa)] px-4 py-3 text-[13px] font-bold text-[#233e70] transition hover:brightness-105"
              @click="resetRevenueTriggerForm"
            >
              Отмена
            </button>
          </div>
        </form>

        <!-- Список триггеров -->
        <div v-if="revenueTriggers.length" class="space-y-2 border-t border-[#eaf0f9] pt-4">
          <span class="block text-[11px] font-bold uppercase tracking-[.14em] text-[#8898b5]">Триггеры</span>
          <div
            v-for="trigger in revenueTriggers"
            :key="trigger.id"
            class="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-3"
            :class="trigger.enabled ? 'border-[#eaf0f9] bg-white' : 'border-[#f4e2c7] bg-[#fff8ed]'"
            data-test="revenue-trigger-item"
          >
            <div class="min-w-0">
              <p class="m-0 text-sm font-bold text-[#081b4b]">
                {{ formatCurrency(trigger.threshold_amount) }}
                <span v-if="trigger.is_system" class="ml-1 text-[11px] font-semibold text-[#1759ed]">ежедневно</span>
                <span v-if="!trigger.enabled" class="ml-1 text-[11px] font-semibold text-[#8a6d3b]">сработал</span>
              </p>
              <p class="m-0 truncate text-[11px] text-[#8898b5]">
                @{{ trigger.recipient_usernames.join(', @') }}
                <template v-if="trigger.is_system"> · уведомляет каждый день в ~11:20, пока баланс ≥ порога</template>
              </p>
            </div>
            <div class="flex items-center gap-1.5">
              <button
                type="button"
                class="admin-link-button admin-link-button--edit"
                @click="startEditRevenueTrigger(trigger)"
              >
                Изменить
              </button>
              <button
                type="button"
                class="admin-link-button admin-link-button--danger"
                @click="removeRevenueTrigger(trigger)"
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      </div>
    </AdminModal>

    <!-- Edit Transaction Modal -->
    <AdminModal
      :isOpen="showEditTransactionModal"
      title="Редактировать транзакцию"
      :description="editTransaction ? `${formatDate(editTransaction.created_at)} · ${editTransaction.account_name}` : 'Обновите данные операции.'"
      size="sm"
      :showActions="false"
      @close="closeEditTransactionModal"
      @cancel="closeEditTransactionModal"
    >
      <div v-if="editTransaction" class="space-y-4">
        <div>
          <label class="mb-1 block text-sm font-medium text-gray-700">Счёт</label>
          <select v-model="editTransactionForm.account_id" class="w-full rounded-md border border-gray-300 px-3 py-2">
            <option v-for="acc in cashAccounts" :key="acc.id" :value="acc.id">{{ acc.name }}</option>
          </select>
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium text-gray-700">Тип</label>
          <select v-model="editTransactionForm.type" class="w-full rounded-md border border-gray-300 px-3 py-2">
            <option value="income">Приход</option>
            <option value="expense">Расход</option>
          </select>
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium text-gray-700">Сумма</label>
          <input v-model.number="editTransactionForm.amount" type="number" class="w-full rounded-md border border-gray-300 px-3 py-2" />
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium text-gray-700">Описание</label>
          <input v-model="editTransactionForm.description" type="text" class="w-full rounded-md border border-gray-300 px-3 py-2" />
        </div>
        <p v-if="editTransactionError" class="text-sm text-red-600">{{ editTransactionError }}</p>
        <div class="flex gap-3 pt-2">
          <button
            @click="submitEditTransaction"
            class="flex-1 rounded-md bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="savingTransaction"
          >
            {{ savingTransaction ? 'Сохраняем…' : 'Сохранить' }}
          </button>
          <button
            @click="closeEditTransactionModal"
            class="flex-1 rounded-md bg-gray-200 px-4 py-2 text-gray-700 transition hover:bg-gray-300"
            :disabled="savingTransaction"
          >
            Отмена
          </button>
        </div>
      </div>
      <div v-else class="py-6 text-center text-sm text-gray-500">Выберите транзакцию для редактирования.</div>
    </AdminModal>

    <!-- Add Account Modal -->
    <AdminModal
      :isOpen="showAccountModal"
      title="Новый счёт"
      description="Создайте дополнительную кассу и настройте начальный баланс."
      size="sm"
      :showActions="false"
      @close="closeAccountModal"
      @cancel="closeAccountModal"
    >
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Название счёта</label>
          <input v-model.trim="newAccount.name" type="text" class="w-full px-3 py-2 border border-gray-300 rounded-md" placeholder="Например, Касса в магазине" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Начальный баланс</label>
          <input v-model.number="newAccount.balance" type="number" class="w-full px-3 py-2 border border-gray-300 rounded-md" />
        </div>
        <label class="inline-flex items-center text-sm text-gray-700">
          <input v-model="newAccount.is_default" type="checkbox" class="mr-2 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
          Сделать счётом по умолчанию
        </label>
        <div class="flex gap-3 pt-2">
          <button @click="addAccount" class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">Создать</button>
          <button @click="closeAccountModal" class="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300">Отмена</button>
        </div>
      </div>
    </AdminModal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, reactive, computed } from 'vue'
import { useCrmStore } from '@/stores/crm'
import { storeToRefs } from 'pinia'
import AdminModal from '@/components/AdminModal.vue'
import CrmCashPacingPanel from '@/components/admin/CrmCashPacingPanel.vue'
import type { CashTransaction } from '@/stores/crm'
import { LockClosedIcon } from '@heroicons/vue/24/outline'
import CrmProfitPasswordField from '@/components/crm/CrmProfitPasswordField.vue'

const crmStore = useCrmStore()
const { cashAccounts, cashTransactions, profitUnlocked, verifyingProfitAccess } = storeToRefs(crmStore)
const activePanel = ref<'money' | 'pacing'>('money')
const showAccountModal = ref(false)
const showTransactionModal = ref(false)
const transactionFilter = ref<'income' | 'expense' | null>(null)
const newTransaction = ref({ account_id: '', type: 'income' as 'income' | 'expense', amount: 0, description: '' })
const newAccount = ref({ name: '', balance: 0, is_default: false })
const showEditTransactionModal = ref(false)
const editTransaction = ref<CashTransaction | null>(null)
const editTransactionForm = reactive({
  account_id: '',
  type: 'income' as 'income' | 'expense',
  amount: 0,
  description: ''
})
const editTransactionError = ref('')
const savingTransaction = ref(false)
const showPasswordModal = ref(false)
const passwordInput = ref('')
const passwordError = ref('')
const showRevenueTriggerModal = ref(false)
const revenueTriggerForm = reactive({ threshold: null as number | null, recipients: [] as string[] })
const editingRevenueTriggerId = ref<string | null>(null)
const revenueTriggerError = ref('')
const revenueTriggerSaving = ref(false)

const { revenueTriggers, revenueAccount, revenueTeam } = storeToRefs(crmStore)

async function openRevenueTriggerModal() {
  // Как панели Финансов: доступ только после ввода лицензионного ключа.
  if (!profitUnlocked.value) {
    openPasswordModal()
    return
  }
  showRevenueTriggerModal.value = true
  resetRevenueTriggerForm()
  await crmStore.fetchRevenueTriggers()
}

function resetRevenueTriggerForm() {
  editingRevenueTriggerId.value = null
  revenueTriggerForm.threshold = null
  revenueTriggerForm.recipients = []
  revenueTriggerError.value = ''
}

function isTriggerRecipientSelected(username: string): boolean {
  return revenueTriggerForm.recipients.includes(username)
}

function toggleTriggerRecipient(username: string) {
  const index = revenueTriggerForm.recipients.indexOf(username)
  if (index === -1) {
    revenueTriggerForm.recipients.push(username)
  } else {
    revenueTriggerForm.recipients.splice(index, 1)
  }
}

function startEditRevenueTrigger(trigger: { id: string; threshold_amount: number; recipient_usernames: string[] }) {
  editingRevenueTriggerId.value = trigger.id
  revenueTriggerForm.threshold = trigger.threshold_amount
  revenueTriggerForm.recipients = [...trigger.recipient_usernames]
  revenueTriggerError.value = ''
}

async function submitRevenueTrigger() {
  if (revenueTriggerSaving.value) return
  revenueTriggerError.value = ''
  if (!revenueTriggerForm.threshold || revenueTriggerForm.threshold <= 0) {
    revenueTriggerError.value = 'Укажите сумму больше нуля.'
    return
  }
  if (!revenueTriggerForm.recipients.length) {
    revenueTriggerError.value = 'Выберите хотя бы одного получателя.'
    return
  }
  revenueTriggerSaving.value = true
  try {
    const payload = {
      threshold_amount: revenueTriggerForm.threshold,
      recipient_usernames: revenueTriggerForm.recipients,
    }
    if (editingRevenueTriggerId.value) {
      await crmStore.updateRevenueTrigger(editingRevenueTriggerId.value, payload)
    } else {
      await crmStore.createRevenueTrigger(payload)
    }
    resetRevenueTriggerForm()
  } catch (error: any) {
    const code = error?.code
    revenueTriggerError.value = code === 'invalid_threshold'
      ? 'Сумма должна быть больше нуля.'
      : code === 'recipients_required'
        ? 'Выберите хотя бы одного получателя.'
        : code === 'recipient_not_in_team'
          ? 'Получатель вне команды.'
          : (error?.message || 'Не удалось сохранить триггер.')
  } finally {
    revenueTriggerSaving.value = false
  }
}

async function removeRevenueTrigger(trigger: { id: string; threshold_amount: number }) {
  if (!confirm(`Удалить триггер на ${formatCurrency(trigger.threshold_amount)}?`)) return
  try {
    await crmStore.deleteRevenueTrigger(trigger.id)
    if (editingRevenueTriggerId.value === trigger.id) {
      resetRevenueTriggerForm()
    }
  } catch {
    alert('Не удалось удалить триггер.')
  }
}
const verifyingPassword = computed(() => verifyingProfitAccess.value)
watch(profitUnlocked, (unlocked) => {
  if (!unlocked) {
    showAccountModal.value = false
    showTransactionModal.value = false
    showEditTransactionModal.value = false
    showPasswordModal.value = false
    showRevenueTriggerModal.value = false
  }
})

watch(transactionFilter, () => {
  crmStore.fetchCashTransactions({ type: transactionFilter.value || undefined })
})

watch(cashAccounts, (accounts) => {
  if (!accounts.length) {
    newTransaction.value.account_id = ''
    if (showEditTransactionModal.value) {
      editTransactionForm.account_id = ''
    }
    return
  }

  const currentId = newTransaction.value.account_id
  if (!currentId || !accounts.some((acc) => acc.id === currentId)) {
    newTransaction.value.account_id = accounts[0].id
  }

  if (showEditTransactionModal.value) {
    if (!editTransactionForm.account_id || !accounts.some((acc) => acc.id === editTransactionForm.account_id)) {
      editTransactionForm.account_id = accounts[0].id
    }
  }
})

onMounted(async () => {
  // Ключ спрашивается при каждом входе в раздел: допуск живёт один визит.
  crmStore.resetProfitAccess()
  await crmStore.fetchCashAccounts()
  await crmStore.fetchCashTransactions()
  if (cashAccounts.value.length > 0) {
    newTransaction.value.account_id = cashAccounts.value[0].id
  }
})

function filterBtnClass(filter: 'income' | 'expense' | null) {
  return ['w-full rounded-md px-3 py-1 text-sm font-medium transition-colors sm:w-auto', transactionFilter.value === filter ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200']
}

async function addTransaction() {
  try {
    if (!newTransaction.value.account_id) {
      alert('Выберите счёт для транзакции')
      return
    }

    await crmStore.createCashTransaction(newTransaction.value)
    showTransactionModal.value = false
    await crmStore.fetchCashAccounts()
    await crmStore.fetchCashTransactions()
  } catch (error) {
    alert('Не получилось добавить транзакцию.')
  }
}

async function addAccount() {
  if (!newAccount.value.name.trim()) {
    alert('Укажите название счёта.')
    return
  }

  try {
    await crmStore.createCashAccount({
      name: newAccount.value.name.trim(),
      balance: Number(newAccount.value.balance) || 0,
      is_default: newAccount.value.is_default
    })
    await crmStore.fetchCashAccounts()
    closeAccountModal()
  } catch (error) {
    alert('Не получилось создать счёт.')
  }
}

function resetNewAccount() {
  newAccount.value = { name: '', balance: 0, is_default: false }
}

function closeAccountModal() {
  showAccountModal.value = false
  resetNewAccount()
}

async function confirmDeleteAccount(account: { id: string; name: string; balance: number }) {
  const balanceNote = Number(account.balance)
    ? `\nОстаток ${formatCurrency(account.balance)} пропадёт из списка счетов.`
    : ''

  if (!confirm(`Удалить счёт «${account.name}»?${balanceNote}\nТранзакции по нему останутся на месте.`)) {
    return
  }

  try {
    await crmStore.deleteCashAccount(account.id)
    await crmStore.fetchCashAccounts()
  } catch (error: any) {
    // Слаг ошибки fetchAPI кладёт в code, а не в error (stores/crm.ts). В message
    // на 500 приезжает текст серверного исключения вроде FOREIGN KEY constraint
    // failed — такое пользователю не показываем.
    let message = 'Не получилось удалить счёт. Обновите страницу и попробуйте ещё раз.'

    if (error?.code === 'last_account') {
      message = 'Это последний счёт, без него некуда проводить оплаты. Сначала добавьте новый кнопкой «Добавить счёт».'
    } else if (error?.code === 'not_found') {
      message = 'Счёта уже нет.'
      await crmStore.fetchCashAccounts().catch(() => undefined)
    } else if (error?.name === 'StaffApiError') {
      // Обрыв связи: там текст уже человеческий, свой был бы хуже.
      message = error.message
    }

    alert(message)
  }
}

function openPasswordModal() {
  passwordInput.value = ''
  passwordError.value = ''
  showPasswordModal.value = true
}

function closePasswordModal() {
  showPasswordModal.value = false
  passwordInput.value = ''
  passwordError.value = ''
}

async function submitPassword() {
  if (!passwordInput.value.trim()) {
    passwordError.value = 'Введите ключ'
    return
  }

  passwordError.value = ''
  try {
    await crmStore.verifyProfitPassword(passwordInput.value.trim())
    closePasswordModal()
  } catch (error) {
    passwordError.value = 'Неверный ключ'
  }
}

function openEditTransaction(transaction: CashTransaction) {
  if (isAutoTransaction(transaction)) {
    return
  }
  editTransaction.value = transaction
  editTransactionForm.account_id = transaction.account_id
  editTransactionForm.type = transaction.type
  editTransactionForm.amount = transaction.amount
  editTransactionForm.description = transaction.description || ''
  editTransactionError.value = ''
  showEditTransactionModal.value = true
}

function closeEditTransactionModal() {
  showEditTransactionModal.value = false
  editTransaction.value = null
  editTransactionForm.account_id = ''
  editTransactionForm.type = 'income'
  editTransactionForm.amount = 0
  editTransactionForm.description = ''
  editTransactionError.value = ''
  savingTransaction.value = false
}

async function submitEditTransaction() {
  if (!editTransaction.value || savingTransaction.value) return
  if (!editTransactionForm.account_id) {
    editTransactionError.value = 'Выберите счёт'
    return
  }
  if (Number(editTransactionForm.amount) <= 0) {
    editTransactionError.value = 'Сумма должна быть больше нуля'
    return
  }

  savingTransaction.value = true
  editTransactionError.value = ''
  try {
    await crmStore.updateCashTransaction(editTransaction.value.id, {
      account_id: editTransactionForm.account_id,
      type: editTransactionForm.type,
      amount: Number(editTransactionForm.amount),
      description: editTransactionForm.description.trim() ? editTransactionForm.description.trim() : undefined
    })
    await crmStore.fetchCashTransactions({ type: transactionFilter.value || undefined })
    closeEditTransactionModal()
  } catch (error: any) {
    console.error('[CRM] update transaction error', error)
    editTransactionError.value = error?.message || 'Не удалось обновить транзакцию'
  } finally {
    savingTransaction.value = false
  }
}

async function deleteTransaction(transaction: CashTransaction) {
  if (isAutoTransaction(transaction)) {
    return
  }
  if (!confirm('Удалить эту транзакцию?')) {
    return
  }

  try {
    await crmStore.deleteCashTransaction(transaction.id)
    await crmStore.fetchCashAccounts()
    await crmStore.fetchCashTransactions({ type: transactionFilter.value || undefined })
  } catch (error) {
    alert('Не получилось удалить транзакцию.')
  }
}

function isAutoTransaction(transaction: CashTransaction) {
  return Boolean(transaction.order_id || transaction.pos_sale_id)
}

function getEditTransactionTitle(transaction: CashTransaction) {
  if (transaction.order_id) {
    return 'Транзакция создана автоматически и редактируется из заказа'
  }
  if (transaction.pos_sale_id) {
    return transaction.pos_sale_number
      ? `Транзакция создана автоматически из продажи кассы #${transaction.pos_sale_number}`
      : 'Транзакция создана автоматически из продажи кассы'
  }
  return 'Редактировать транзакцию'
}

function getDeleteTransactionTitle(transaction: CashTransaction) {
  if (transaction.order_id) {
    return 'Операция создана автоматически. Удалите оплату в заказе.'
  }
  if (transaction.pos_sale_id) {
    return transaction.pos_sale_number
      ? `Операция создана автоматически. Удалите продажу кассы #${transaction.pos_sale_number}.`
      : 'Операция создана автоматически. Удалите продажу в кассе.'
  }
  return 'Удалить транзакцию'
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'BYN', minimumFractionDigits: 0 }).format(value)
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
</script>
