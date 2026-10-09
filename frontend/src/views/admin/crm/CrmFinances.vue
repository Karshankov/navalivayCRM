<template>
  <div class="min-h-screen bg-gray-50 px-4 py-6 sm:px-6 lg:px-8">
    <div class="mx-auto w-full max-w-7xl space-y-8">
      <!-- Back Button -->
      <div>
        <h1 class="text-2xl font-bold text-gray-900 sm:text-3xl">Финансы</h1>
        <p class="mt-2 text-sm text-gray-600 sm:text-base">Управление счетами и транзакциями</p>
      </div>

      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="rounded-full px-4 py-2 text-sm font-semibold transition"
          :class="activePanel === 'money' ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-700 shadow-sm hover:bg-gray-100'"
          @click="activePanel = 'money'"
        >
          Счета и транзакции
        </button>
        <button
          type="button"
          class="rounded-full px-4 py-2 text-sm font-semibold transition"
          :class="activePanel === 'pacing' ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-700 shadow-sm hover:bg-gray-100'"
          @click="activePanel = 'pacing'"
        >
          План пробития
        </button>
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
          <div class="space-y-2">
            <p class="text-sm text-gray-600">
              Оплатите подписку на сервис
            </p>
          </div>
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
          input-class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
        />
        <div class="flex gap-3 pt-2">
          <button
            type="submit"
            class="flex-1 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
            :disabled="verifyingPassword"
          >
            {{ verifyingPassword ? 'Проверяем…' : 'Показать' }}
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
const verifyingPassword = computed(() => verifyingProfitAccess.value)
watch(profitUnlocked, (unlocked) => {
  if (!unlocked) {
    showAccountModal.value = false
    showTransactionModal.value = false
    showEditTransactionModal.value = false
    showPasswordModal.value = false
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
