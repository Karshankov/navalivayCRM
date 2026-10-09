<template>
  <div class="space-y-6">
    <section class="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
      <div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.2em] text-rose-500">Правила категорий</p>
          <h2 class="text-xl font-semibold text-slate-900">Пороги и суммы скидок</h2>
        </div>
        <p class="text-sm text-slate-500">Изменения применяются сразу для новых и измененных заказов.</p>
      </div>

      <div class="mt-5 grid gap-4 lg:grid-cols-3">
        <article
          v-for="category in categories"
          :key="category.id"
          class="rounded-2xl border border-slate-200 bg-slate-50/70 p-4"
        >
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 class="text-lg font-semibold text-slate-900">{{ category.title }}</h3>
              <p class="mt-1 text-sm text-slate-500">{{ category.description || 'Описание можно отредактировать ниже.' }}</p>
            </div>
            <label class="inline-flex items-center gap-2 text-sm text-slate-600">
              <input v-model="forms[category.id].active" type="checkbox" class="rounded border-slate-300 text-rose-600 focus:ring-rose-500" />
              Активно
            </label>
          </div>

          <div class="mt-4 grid gap-3 sm:grid-cols-2">
            <label class="flex flex-col gap-1 text-sm text-slate-600">
              <span>Порог покупок</span>
              <input v-model.number="forms[category.id].threshold" type="number" min="1" class="rounded-xl border border-slate-200 bg-white px-3 py-2" />
            </label>
            <label class="flex flex-col gap-1 text-sm text-slate-600">
              <span>Скидка, BYN</span>
              <input v-model.number="forms[category.id].discount_amount" type="number" min="0" class="rounded-xl border border-slate-200 bg-white px-3 py-2" />
            </label>
          </div>

          <label class="mt-3 flex flex-col gap-1 text-sm text-slate-600">
            <span>Название</span>
            <input v-model="forms[category.id].title" type="text" class="rounded-xl border border-slate-200 bg-white px-3 py-2" />
          </label>

          <label class="mt-3 flex flex-col gap-1 text-sm text-slate-600">
            <span>Описание</span>
            <textarea v-model="forms[category.id].description" rows="3" class="rounded-xl border border-slate-200 bg-white px-3 py-2"></textarea>
          </label>

          <button
            class="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800"
            @click="saveCategory(category.id)"
          >
            Сохранить категорию
          </button>
        </article>
      </div>
    </section>

    <section class="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
      <div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.2em] text-amber-500">Маппинг каталога</p>
          <h2 class="text-xl font-semibold text-slate-900">Какие товары попадают в бонусы</h2>
        </div>
        <p class="text-sm text-slate-500">Можно привязать целые категории и отдельные линейки.</p>
      </div>

      <div class="mt-5 grid gap-4 xl:grid-cols-3">
        <article
          v-for="category in categories"
          :key="`${category.id}-mapping`"
          class="rounded-2xl border border-slate-200 bg-slate-50/70 p-4"
        >
          <h3 class="text-lg font-semibold text-slate-900">{{ category.title }}</h3>

          <div class="mt-4 space-y-4">
            <div>
              <p class="mb-2 text-sm font-medium text-slate-700">Категории</p>
              <div class="space-y-2">
                <label
                  v-for="catalogCategory in catalogStore.categories"
                  :key="`${category.id}-${catalogCategory.id}`"
                  class="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm text-slate-700"
                >
                  <input
                    :checked="mappingForms[category.id].categoryIds.includes(catalogCategory.id)"
                    type="checkbox"
                    class="rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                    @change="toggleCategoryMapping(category.id, catalogCategory.id)"
                  />
                  <span>{{ catalogCategory.name }}</span>
                </label>
              </div>
            </div>

            <div>
              <p class="mb-2 text-sm font-medium text-slate-700">Линейки</p>
              <div class="max-h-64 space-y-2 overflow-auto pr-1">
                <label
                  v-for="group in allGroups"
                  :key="`${category.id}-${group.id}`"
                  class="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm text-slate-700"
                >
                  <input
                    :checked="mappingForms[category.id].groupIds.includes(group.id)"
                    type="checkbox"
                    class="rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                    @change="toggleGroupMapping(category.id, group.id)"
                  />
                  <span>{{ group.name }}</span>
                </label>
              </div>
            </div>
          </div>

          <button
            class="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-amber-500 px-4 text-sm font-semibold text-white transition hover:bg-amber-600"
            @click="saveMappings(category.id)"
          >
            Сохранить маппинг
          </button>
        </article>
      </div>
    </section>

    <section class="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.2em] text-sky-500">Клиенты</p>
          <h2 class="text-xl font-semibold text-slate-900">Баланс покупок по пользователям</h2>
        </div>
        <input
          v-model="search"
          type="text"
          placeholder="Поиск по username или имени"
          class="min-h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700"
        />
      </div>

      <div class="mt-5 overflow-x-auto">
        <table class="min-w-full text-left text-sm">
          <thead>
            <tr class="border-b border-slate-200 text-slate-500">
              <th class="pb-3 pr-4 font-medium">Клиент</th>
              <th class="pb-3 pr-4 font-medium">Жидкости</th>
              <th class="pb-3 pr-4 font-medium">Одноразки</th>
              <th class="pb-3 pr-4 font-medium">Устройства</th>
              <th class="pb-3 pr-4 font-medium">Последняя активность</th>
              <th class="pb-3 font-medium">История</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="customer in loyaltyCustomers"
              :key="customer.id"
              class="border-b border-slate-100 align-top"
            >
              <td class="py-3 pr-4">
                <div class="font-medium text-slate-900">{{ customerLabel(customer) }}</div>
                <div class="text-xs text-slate-500">@{{ customer.telegram_username || 'без username' }}</div>
              </td>
              <td class="py-3 pr-4">{{ formatCustomerCategory(customer, 'liquids') }}</td>
              <td class="py-3 pr-4">{{ formatCustomerCategory(customer, 'disposables') }}</td>
              <td class="py-3 pr-4">{{ formatCustomerCategory(customer, 'devices') }}</td>
              <td class="py-3 pr-4 text-slate-500">{{ formatDateTime(customer.last_activity_at) }}</td>
              <td class="py-3">
                <button
                  class="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200"
                  @click="openLedgerModal(customer)"
                >
                  Показать
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <AdminModal
        :isOpen="Boolean(activeLedgerCustomerId)"
        :title="ledgerModalTitle"
        :description="ledgerModalDescription"
        size="xl"
        :showActions="false"
        @close="closeLedgerModal"
        @cancel="closeLedgerModal"
      >
        <div v-if="ledgerLoading" class="text-sm text-slate-500">{{ ledgerLoadingText }}</div>
        <div v-else-if="!ledgerEntries.length" class="text-sm text-slate-500">{{ ledgerEmptyText }}</div>
        <div v-else class="space-y-2">
          <div
            v-for="entry in ledgerEntries"
            :key="entry.id"
            class="flex flex-col gap-1 rounded-xl bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <div class="font-medium text-slate-900">{{ entry.category_title }}</div>
              <div class="text-xs text-slate-500">{{ formatLedgerReason(entry.reason) }}</div>
            </div>
            <div class="text-sm text-slate-700">
              <span :class="entry.delta >= 0 ? 'text-emerald-600' : 'text-rose-600'">
                {{ entry.delta > 0 ? '+' : '' }}{{ entry.delta }}
              </span>
              <span class="ml-2 text-slate-500">{{ ledgerBalanceLabel }}: {{ entry.balance_after }}</span>
              <span class="ml-2 text-slate-400">{{ formatDateTime(entry.created_at) }}</span>
            </div>
          </div>
        </div>
      </AdminModal>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import AdminModal from '@/components/AdminModal.vue'
import { useCatalogStore } from '@/stores/catalog'
import {
  useCrmStore,
  type CrmLoyaltyCategory,
  type CrmLoyaltyCustomer,
  type CrmLoyaltyLedgerEntry,
} from '@/stores/crm'

type LoyaltyCategoryForm = {
  threshold: number
  discount_amount: number
  title: string
  description: string
  active: boolean
}

type LoyaltyMappingForm = {
  categoryIds: string[]
  groupIds: string[]
}

const crmStore = useCrmStore()
const catalogStore = useCatalogStore()
const search = ref('')
const activeLedgerCustomerId = ref<string | null>(null)
const ledgerLoading = ref(false)
const ledgerEntries = ref<CrmLoyaltyLedgerEntry[]>([])
let ledgerRequestId = 0
const ledgerModalTitle = '\u0418\u0441\u0442\u043e\u0440\u0438\u044f \u043d\u0430\u0447\u0438\u0441\u043b\u0435\u043d\u0438\u0439 \u0438 \u0441\u043f\u0438\u0441\u0430\u043d\u0438\u0439'
const ledgerRecentEntriesLabel = '\u043f\u043e\u0441\u043b\u0435\u0434\u043d\u0438\u0435 200 \u0437\u0430\u043f\u0438\u0441\u0435\u0439'
const ledgerLoadingText = '\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u0438\u0441\u0442\u043e\u0440\u0438\u0438...'
const ledgerEmptyText = '\u0417\u0430\u043f\u0438\u0441\u0435\u0439 \u043f\u043e\u043a\u0430 \u043d\u0435\u0442.'
const ledgerBalanceLabel = '\u0411\u0430\u043b\u0430\u043d\u0441'
const noUsernameLabel = '\u0431\u0435\u0437 username'

const forms = reactive<Record<string, LoyaltyCategoryForm>>({})

const mappingForms = reactive<Record<string, LoyaltyMappingForm>>({})

const categories = computed(() => crmStore.loyaltyCategories)
const loyaltyCustomers = computed(() => crmStore.loyaltyCustomers)
const selectedLedgerCustomer = computed(
  () => loyaltyCustomers.value.find((customer) => customer.id === activeLedgerCustomerId.value) ?? null,
)
const ledgerModalDescription = computed(() => {
  if (!selectedLedgerCustomer.value) {
    return ledgerRecentEntriesLabel
  }

  const username = selectedLedgerCustomer.value.telegram_username
    ? `@${selectedLedgerCustomer.value.telegram_username}`
    : noUsernameLabel

  return `${customerLabel(selectedLedgerCustomer.value)} | ${username} | ${ledgerRecentEntriesLabel}`
})
const allGroups = computed(() =>
  catalogStore.categories.flatMap((category) => category.groups),
)

function createCategoryForm(category: CrmLoyaltyCategory): LoyaltyCategoryForm {
  return {
    threshold: Number(category.threshold || 1),
    discount_amount: Number(category.discount_amount || 0),
    title: category.title,
    description: category.description || '',
    active: Boolean(category.active),
  }
}

function createMappingForm(category: CrmLoyaltyCategory): LoyaltyMappingForm {
  return {
    categoryIds: category.mappings
      .filter((mapping) => !!mapping.category_id)
      .map((mapping) => String(mapping.category_id)),
    groupIds: category.mappings
      .filter((mapping) => !!mapping.group_id)
      .map((mapping) => String(mapping.group_id)),
  }
}

function syncForms() {
  const activeIds = new Set<string>()

  for (const category of crmStore.loyaltyCategories) {
    activeIds.add(category.id)
    forms[category.id] = createCategoryForm(category)
    mappingForms[category.id] = createMappingForm(category)
  }

  for (const categoryId of Object.keys(forms)) {
    if (!activeIds.has(categoryId)) {
      delete forms[categoryId]
    }
  }

  for (const categoryId of Object.keys(mappingForms)) {
    if (!activeIds.has(categoryId)) {
      delete mappingForms[categoryId]
    }
  }
}

async function bootstrap() {
  await Promise.all([
    catalogStore.initialize(),
    crmStore.fetchLoyaltyCategories(),
  ])
  syncForms()
  await crmStore.fetchLoyaltyCustomers(search.value)
}

async function saveCategory(categoryId: string) {
  const form = forms[categoryId]
  if (!form) return
  await crmStore.updateLoyaltyCategory(categoryId, {
    threshold: Math.max(1, Math.floor(Number(form.threshold || 1))),
    discount_amount: Math.max(0, Number(form.discount_amount || 0)),
    title: form.title.trim(),
    description: form.description.trim() || null,
    active: form.active,
  })
}

async function saveMappings(categoryId: string) {
  const form = mappingForms[categoryId]
  if (!form) return
  await crmStore.updateLoyaltyMappings(categoryId, {
    category_ids: form.categoryIds,
    group_ids: form.groupIds,
  })
}

function toggleCategoryMapping(categoryId: string, targetId: string) {
  const form = mappingForms[categoryId]
  if (!form) return
  if (form.categoryIds.includes(targetId)) {
    form.categoryIds = form.categoryIds.filter((id) => id !== targetId)
  } else {
    form.categoryIds = [...form.categoryIds, targetId]
  }
}

function toggleGroupMapping(categoryId: string, targetId: string) {
  const form = mappingForms[categoryId]
  if (!form) return
  if (form.groupIds.includes(targetId)) {
    form.groupIds = form.groupIds.filter((id) => id !== targetId)
  } else {
    form.groupIds = [...form.groupIds, targetId]
  }
}

async function openLedgerModal(customer: CrmLoyaltyCustomer) {
  activeLedgerCustomerId.value = customer.id
  ledgerEntries.value = []
  const requestId = ++ledgerRequestId
  ledgerLoading.value = true
  try {
    const entries = await crmStore.fetchLoyaltyLedger(customer.id)
    if (requestId === ledgerRequestId) {
      ledgerEntries.value = entries
    }
  } finally {
    if (requestId === ledgerRequestId) {
      ledgerLoading.value = false
    }
  }
}

function closeLedgerModal() {
  ledgerRequestId += 1
  activeLedgerCustomerId.value = null
  ledgerEntries.value = []
  ledgerLoading.value = false
}

function customerLabel(customer: CrmLoyaltyCustomer) {
  const fullName = [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim()
  return fullName || customer.telegram_username || 'Без имени'
}

function formatCustomerCategory(customer: CrmLoyaltyCustomer, key: string) {
  const category = customer.categories.find((item) => item.key === key)
  if (!category) return '—'
  return `${category.balance} / скидок ${category.available_bonus_count}`
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleString('ru-RU')
}

function formatLedgerReason(reason: string) {
  if (reason === 'earned_from_order') return 'Начисление после выдачи заказа'
  if (reason === 'reserved_for_order') return 'Списание под оформленный заказ'
  if (reason === 'released_from_order') return 'Возврат после отмены или изменения'
  if (reason === 'username_reset') return 'Сброс из-за смены username'
  return reason
}

watch(
  () => crmStore.loyaltyCategories,
  () => syncForms(),
  { deep: true, immediate: true },
)

watch(search, async (value) => {
  await crmStore.fetchLoyaltyCustomers(value)
})

onMounted(async () => {
  await bootstrap()
})
</script>
