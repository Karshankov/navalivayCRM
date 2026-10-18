<template>
  <div class="crm-ref">
    <!-- Заголовок страницы (как «Заказы») -->
    <div class="crm-ref-heading">
      <h1 class="crm-ref-title">Напоминания</h1>
      <div class="crm-ref-search">
        <input
          v-model="searchQuery"
          type="search"
          placeholder="Поиск по сообщению, названию или получателю..."
          class="crm-ref-search-input"
          aria-label="Поиск по напоминаниям"
        />
        <svg
          v-if="!searchQuery"
          class="crm-ref-search-icon"
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

    <!-- Ошибка загрузки -->
    <div v-if="loadError" class="crm-ref-card crm-ref-empty" role="alert">
      <span class="crm-ref-empty-symbol">
        <ExclamationTriangleIcon class="h-6 w-6" aria-hidden="true" />
      </span>
      <b>{{ loadError }}</b>
      <button type="button" class="crm-ref-chip-button" @click="loadAll">Повторить</button>
    </div>

    <!-- Тулбар (как «Заказы») -->
    <div v-else class="crm-ref-toolbar">
      <button
        type="button"
        class="crm-ref-button reminder-button--create"
        data-test="reminders-create"
        @click="openCreateModal"
      >
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        <span>Создать напоминание</span>
      </button>
      <span class="crm-ref-toolbar-spacer" aria-hidden="true" />
      <span class="crm-ref-counter">{{ reminders.length }} всего</span>
      <span v-if="activeCount" class="crm-ref-counter crm-ref-counter--accent">{{ activeCount }} активных</span>
      <span v-if="pausedCount" class="crm-ref-counter">{{ pausedCount }} на паузе</span>
    </div>

    <!-- Загрузка -->
    <div v-if="isLoading && !loadError" class="crm-ref-card crm-ref-empty">
      <span class="crm-ref-empty-symbol">
        <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      </span>
      <b>Загружаем напоминания…</b>
    </div>

    <!-- Пустое состояние -->
    <div v-else-if="reminders.length === 0" class="crm-ref-card crm-ref-empty">
      <span class="crm-ref-empty-symbol">
        <BellIcon class="h-7 w-7" aria-hidden="true" />
      </span>
      <b>Напоминаний пока нет</b>
      <span>Создайте первое: например «Проверить остатки» — каждый день в 15:00</span>
      <button
        type="button"
        class="crm-ref-chip-button reminder-chip--create"
        @click="openCreateModal"
      >
        Создать напоминание
      </button>
    </div>

    <!-- Ничего не найдено поиском -->
    <div v-else-if="displayedReminders.length === 0" class="crm-ref-card crm-ref-empty">
      <span class="crm-ref-empty-symbol">⌕</span>
      <b>Ничего не найдено</b>
      <span>По запросу «{{ searchQuery }}» напоминаний нет</span>
    </div>

    <!-- Список напоминаний -->
    <div v-else class="flex flex-col gap-4">
      <article
        v-for="reminder in displayedReminders"
        :key="reminder.id"
        class="crm-ref-card p-5"
        :style="reminder.enabled ? undefined : 'opacity: .72'"
        data-test="reminder-card"
      >
        <div class="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div class="min-w-0 flex-1 space-y-3">
            <div class="flex flex-wrap items-center gap-2">
              <span class="reminder-badge" :class="reminder.enabled ? 'reminder-badge--on' : 'reminder-badge--off'">
                <span class="reminder-badge-dot" />
                {{ reminder.enabled ? 'Активно' : 'Пауза' }}
              </span>
              <span class="reminder-badge reminder-badge--schedule">
                <ClockIcon class="h-3.5 w-3.5" aria-hidden="true" />
                {{ reminder.schedule_label }}
              </span>
              <span
                v-if="!reminder.recipients_ok"
                class="reminder-badge reminder-badge--warn"
                title="У одного из юзернеймов нет карточки клиента с Telegram ID — напишите ему хотя бы раз, чтобы CRM запомнила"
              >
                <ExclamationTriangleIcon class="h-3.5 w-3.5" aria-hidden="true" />
                Юзернейм не найден
              </span>
            </div>

            <div class="min-w-0 space-y-1">
              <h3 class="m-0 truncate text-[17px] font-bold leading-tight text-[#081b4b]">{{ reminder.title }}</h3>
              <p class="m-0 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-[#66799e]">{{ reminder.message }}</p>
            </div>

            <div class="flex flex-wrap gap-x-5 gap-y-1.5 text-[11.5px] text-[#8898b5]">
              <span class="inline-flex items-center gap-1.5 min-w-0">
                <UserCircleIcon class="h-4 w-4 shrink-0" aria-hidden="true" />
                <span class="min-w-0">{{ recipientLabel(reminder) }}</span>
              </span>
              <span v-if="reminder.next_run_at" class="inline-flex items-center gap-1.5">
                <ArrowPathIcon class="h-4 w-4 shrink-0" aria-hidden="true" />
                Следующая: {{ formatRunDate(reminder.next_run_at) }}
              </span>
              <span v-if="reminder.last_delivery_status" class="inline-flex items-center gap-1.5">
                <CheckCircleIcon class="h-4 w-4 shrink-0" aria-hidden="true" />
                Последняя: {{ deliveryStatusLabel(reminder.last_delivery_status) }}
                <template v-if="reminder.last_delivery_sent_at">, {{ formatRunDate(reminder.last_delivery_sent_at) }}</template>
              </span>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2 xl:shrink-0">
            <button
              type="button"
              class="crm-ref-chip-button reminder-chip--green"
              :disabled="actionBusy(reminder.id) || !reminder.recipients_ok"
              :title="reminder.recipients_ok ? 'Отправить сообщение сейчас, не дожидаясь расписания' : 'У одного из юзернеймов нет карточки клиента с Telegram ID'"
              @click="sendTest(reminder)"
            >
              <PaperAirplaneIcon class="h-3.5 w-3.5" aria-hidden="true" />
              {{ testSentRecently(reminder.id) ? 'Отправлено' : 'Отправить сейчас' }}
            </button>
            <button type="button" class="crm-ref-chip-button" @click="openEditModal(reminder)">
              <PencilIcon class="h-3.5 w-3.5" aria-hidden="true" />
              Изменить
            </button>
            <button
              type="button"
              class="crm-ref-chip-button"
              :class="reminder.enabled ? 'reminder-chip--red' : 'reminder-chip--green'"
              :disabled="actionBusy(reminder.id)"
              @click="toggleReminder(reminder)"
            >
              <PauseCircleIcon v-if="reminder.enabled" class="h-3.5 w-3.5" aria-hidden="true" />
              <PlayCircleIcon v-else class="h-3.5 w-3.5" aria-hidden="true" />
              {{ reminder.enabled ? 'Пауза' : 'Включить' }}
            </button>
            <button
              type="button"
              class="crm-ref-chip-button reminder-chip--red"
              :disabled="actionBusy(reminder.id)"
              @click="confirmDelete(reminder)"
            >
              <TrashIcon class="h-3.5 w-3.5" aria-hidden="true" />
              Удалить
            </button>
          </div>
        </div>
      </article>
    </div>

    <!-- Журнал отправок -->
    <template v-if="log.length > 0">
      <div class="crm-ref-toolbar mt-2">
        <span class="crm-ref-counter crm-ref-counter--accent">
          <CheckCircleIcon class="h-3.5 w-3.5" aria-hidden="true" />
          Журнал отправок
        </span>
        <span class="crm-ref-toolbar-spacer" aria-hidden="true" />
        <button
          type="button"
          class="crm-ref-chip-button"
          :disabled="logLoading"
          @click="loadLog"
        >
          <ArrowPathIcon class="h-3.5 w-3.5" :class="{ 'animate-spin': logLoading }" aria-hidden="true" />
          Обновить
        </button>
      </div>
      <div class="crm-ref-card overflow-x-auto">
        <table class="crm-ref-table">
          <thead>
            <tr>
              <th>Дата</th>
              <th>Сообщение</th>
              <th>Статус</th>
              <th>Получатель</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in log" :key="entry.id">
              <td class="whitespace-nowrap text-[#66799e]">{{ formatRunDate(entry.created_at) }}</td>
              <td class="max-w-[340px]">
                <span class="block truncate font-bold text-[#081b4b]">{{ entry.reminder_title || 'Напоминание' }}</span>
                <span class="block truncate text-[11.5px] text-[#8898b5]">{{ entry.message }}</span>
              </td>
              <td>
                <span class="reminder-badge" :class="logStatusClass(entry.status)">
                  <span class="reminder-badge-dot" :class="logStatusDot(entry.status)" />
                  {{ deliveryStatusLabel(entry.status) }}
                </span>
              </td>
              <td class="text-[11.5px] text-[#8898b5]">
                {{ entry.recipient_username ? '@' + entry.recipient_username : 'ID ' + entry.recipient_telegram_id }}
                <span v-if="entry.last_error" class="mt-0.5 block truncate text-[#e5484d]" :title="entry.last_error">
                  {{ entry.last_error }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- Подсказка -->
    <div class="crm-ref-hint">
      Команда: @ppofic · @rk0ff · @QuaiLLLL · время — по Минску · пропущенные отправки догоняются
    </div>

    <!-- Модалка создания/редактирования -->
    <AdminModal
      :isOpen="showFormModal"
      :title="editingId ? 'Изменить напоминание' : 'Новое напоминание'"
      size="md"
      referenceDesign
      :showActions="false"
      @close="closeFormModal"
      @cancel="closeFormModal"
    >
      <form class="space-y-5" data-test="reminder-form" @submit.prevent="submitForm">
        <div class="space-y-2">
          <label class="crm-ref-form-label" for="reminder-title">Название</label>
          <input
            id="reminder-title"
            v-model="form.title"
            type="text"
            required
            maxlength="120"
            placeholder="Например: Проверка остатков"
            class="crm-ref-input"
          />
        </div>

        <div class="space-y-2">
          <label class="crm-ref-form-label" for="reminder-message">Сообщение</label>
          <textarea
            id="reminder-message"
            v-model="form.message"
            required
            rows="3"
            maxlength="4000"
            placeholder="Текст, который придёт в Telegram. Например: Проверить остатки!"
            class="crm-ref-input resize-y"
          />
          <p class="m-0 text-[10.5px] font-bold text-[#8898b5]">
            {{ form.message.length }} / 4000
          </p>
        </div>

        <div class="space-y-2">
          <label class="crm-ref-form-label">Кому отправлять</label>
          <div class="space-y-2">
            <button
              v-for="member in team"
              :key="member.username"
              type="button"
              class="reminder-member"
              :class="{
                'is-active': isRecipientSelected(member.username),
                'is-unavailable': !member.telegram_ok,
              }"
              :disabled="!member.telegram_ok"
              :title="member.telegram_ok ? undefined : 'Нет карточки клиента с этим юзернеймом — Telegram ID не найден'"
              :aria-pressed="isRecipientSelected(member.username)"
              @click="toggleRecipient(member.username)"
            >
              <span class="reminder-member-check" aria-hidden="true">
                <CheckIcon v-if="isRecipientSelected(member.username)" />
              </span>
              <span class="reminder-member-avatar">@</span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-[13px] font-bold leading-tight">{{ member.username }}</span>
                <span v-if="member.display_name" class="block truncate text-[10.5px] text-[#8898b5]">{{ member.display_name }}</span>
                <span v-else-if="!member.telegram_ok" class="block truncate text-[10.5px] text-[#c22036]">нет Telegram</span>
              </span>
            </button>
          </div>
          <p class="m-0 text-[11px] text-[#8898b5]">
            Можно выбрать несколько — сообщение придёт каждому.
          </p>
        </div>

        <div class="space-y-3">
          <p class="crm-ref-form-label m-0">Расписание</p>

          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="option in scheduleTypeOptions"
              :key="option.value"
              type="button"
              class="reminder-schedule-option"
              :class="{ 'is-active': form.schedule_type === option.value }"
              :aria-pressed="form.schedule_type === option.value"
              @click="form.schedule_type = option.value"
            >
              <span class="block text-[13px] font-bold">{{ option.label }}</span>
              <span class="mt-0.5 block text-[10.5px] text-[#8898b5]">{{ option.hint }}</span>
            </button>
          </div>

          <template v-if="form.schedule_type === 'interval'">
            <div class="space-y-2">
              <label class="crm-ref-form-label" for="reminder-interval">Повторять</label>
              <div class="flex flex-wrap items-center gap-2">
                <button
                  v-for="preset in intervalPresets"
                  :key="preset.days"
                  type="button"
                  class="crm-ref-chip-button"
                  :class="{ 'reminder-preset--active': form.interval_days === preset.days }"
                  @click="form.interval_days = preset.days"
                >
                  {{ preset.label }}
                </button>
                <label class="ml-1 inline-flex items-center gap-2 text-[12px] font-semibold text-[#66799e]">
                  каждые
                  <input
                    v-model.number="form.interval_days"
                    type="number"
                    min="1"
                    max="365"
                    required
                    class="crm-ref-input w-[74px] text-center"
                  />
                  дн.
                </label>
              </div>
            </div>

            <div class="space-y-2">
              <label class="crm-ref-form-label" for="reminder-time">Время (Минск)</label>
              <input
                id="reminder-time"
                v-model="form.time"
                type="time"
                required
                class="crm-ref-input"
              />
            </div>
          </template>

          <template v-else>
            <div class="grid grid-cols-2 gap-2">
              <div class="space-y-2">
                <label class="crm-ref-form-label" for="reminder-date">Дата (число месяца)</label>
                <input
                  id="reminder-date"
                  v-model="form.monthly_date"
                  type="date"
                  required
                  class="crm-ref-input"
                />
                <p class="m-0 text-[10.5px] text-[#8898b5]">
                  Каждый месяц в выбранное число (в коротких месяцах 29–31-е пропускается).
                </p>
              </div>
              <div class="space-y-2">
                <label class="crm-ref-form-label" for="reminder-time">Время (Минск)</label>
                <input
                  id="reminder-time"
                  v-model="form.time"
                  type="time"
                  required
                  class="crm-ref-input"
                />
              </div>
            </div>
          </template>

          <p v-if="formPreviewLabel" class="m-0 text-[11.5px] font-semibold leading-relaxed text-[#66799e]">
            {{ formPreviewLabel }}
          </p>
        </div>

        <p v-if="formError" class="m-0 text-[12.5px] leading-relaxed text-[#e5484d]">{{ formError }}</p>

        <div class="crm-ref-modal-actions">
          <button type="button" class="crm-ref-button reminder-button--cancel" @click="closeFormModal">Отмена</button>
          <button type="submit" class="crm-ref-button reminder-button--create" :disabled="isSubmitting">
            {{ isSubmitting ? 'Сохраняем…' : (editingId ? 'Сохранить' : 'Создать') }}
          </button>
        </div>
      </form>
    </AdminModal>

    <!-- Подтверждение удаления -->
    <AdminModal
      :isOpen="showDeleteModal"
      title="Удалить напоминание?"
      size="sm"
      referenceDesign
      :showActions="false"
      @close="showDeleteModal = false"
      @cancel="showDeleteModal = false"
    >
      <div class="space-y-4">
        <p class="m-0 text-[13px] leading-relaxed text-[#66799e]">
          «{{ deletingReminder?.title }}» будет удалено навсегда вместе с незавершёнными отправками.
          История доставок останется в журнале.
        </p>
        <div class="crm-ref-modal-actions">
          <button type="button" class="crm-ref-button reminder-button--cancel" @click="showDeleteModal = false">Отмена</button>
          <button
            type="button"
            class="crm-ref-button reminder-button--delete"
            :disabled="isSubmitting"
            @click="deleteReminder"
          >
            Удалить
          </button>
        </div>
      </div>
    </AdminModal>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  BellIcon,
  ClockIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  UserCircleIcon,
  ArrowPathIcon,
  PencilIcon,
  TrashIcon,
  PaperAirplaneIcon,
  PauseCircleIcon,
  PlayCircleIcon,
  CheckIcon,
} from '@heroicons/vue/24/outline'
import AdminModal from '@/components/AdminModal.vue'
import { getBusinessDateParts } from '@/utils/businessTime'

interface Reminder {
  id: string
  title: string
  message: string
  schedule_type: 'interval' | 'monthly'
  schedule_hour: number
  schedule_minute: number
  interval_days: number | null
  monthly_date: string | null
  enabled: boolean
  schedule_label: string
  recipients: Array<{
    username: string
    display_name: string | null
    telegram_ok: boolean
  }>
  recipients_ok: boolean
  next_run_at: string | null
  next_runs: string[]
  last_sent_at: string | null
  last_delivery_status: string | null
  last_delivery_sent_at: string | null
  last_delivery_error: string | null
}

/** Участник команды — получатель напоминаний. */
interface TeamMember {
  username: string
  telegram_ok: boolean
  telegram_id: string | null
  display_name: string | null
}

interface LogEntry {
  id: number
  unique_key: string
  reminder_id: string | null
  reminder_title: string | null
  message: string | null
  recipient_telegram_id: string
  recipient_username: string | null
  status: string
  attempts: number
  sent_at: string | null
  last_error: string | null
  created_at: string
}

const reminders = ref<Reminder[]>([])
const team = ref<TeamMember[]>([])
const log = ref<LogEntry[]>([])
const searchQuery = ref('')
const isLoading = ref(false)
const logLoading = ref(false)
const loadError = ref('')
const isSubmitting = ref(false)
const busyIds = ref<Set<string>>(new Set())
const testedIds = ref<Set<string>>(new Set())

const showFormModal = ref(false)
const showDeleteModal = ref(false)
const editingId = ref<string | null>(null)
const deletingReminder = ref<Reminder | null>(null)
const formError = ref('')

const intervalPresets = [
  { days: 1, label: 'Каждый день' },
  { days: 2, label: 'Каждые 2 дня' },
  { days: 3, label: 'Каждые 3 дня' },
  { days: 7, label: 'Каждую неделю' },
]

const scheduleTypeOptions = [
  { value: 'interval' as const, label: 'Повторяется', hint: 'Каждый день или каждые N дней' },
  { value: 'monthly' as const, label: 'Каждый месяц', hint: 'В выбранное число каждый месяц' },
]

const form = reactive({
  title: '',
  message: '',
  recipient_usernames: [] as string[],
  schedule_type: 'interval' as 'interval' | 'monthly',
  interval_days: 1,
  monthly_date: '',
  time: '15:00',
})

const activeCount = computed(() => reminders.value.filter((item) => item.enabled).length)
const pausedCount = computed(() => reminders.value.filter((item) => !item.enabled).length)

const displayedReminders = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return reminders.value
  return reminders.value.filter((item) => {
    const haystack = [
      item.title,
      item.message,
      ...item.recipients.flatMap((member) => [member.username, member.display_name]),
    ].filter(Boolean).join(' ').toLowerCase()
    return haystack.includes(query)
  })
})

const formPreviewLabel = computed(() => {
  const time = form.time || '--:--'
  if (form.schedule_type === 'interval') {
    const days = form.interval_days || 1
    return days === 1
      ? `Отправим ${recipientPreviewLabel()} каждый день в ${time} по Минску.`
      : `Отправим ${recipientPreviewLabel()} каждые ${days} дн. в ${time} по Минску.`
  }
  const day = form.monthly_date ? Number(form.monthly_date.split('-')[2]) : null
  return day
    ? `Отправим ${recipientPreviewLabel()} каждый месяц ${day}-го числа в ${time} по Минску.`
    : `Отправим ${recipientPreviewLabel()} каждый месяц в ${time} по Минску.`
})

function recipientPreviewLabel() {
  return form.recipient_usernames.length
    ? form.recipient_usernames.map((username) => `@${username}`).join(', ')
    : 'участнику команды'
}

function isRecipientSelected(username: string): boolean {
  return form.recipient_usernames.includes(username)
}

function toggleRecipient(username: string) {
  const index = form.recipient_usernames.indexOf(username)
  if (index === -1) {
    form.recipient_usernames.push(username)
  } else {
    form.recipient_usernames.splice(index, 1)
  }
}

function recipientLabel(reminder: Reminder): string {
  const labels = reminder.recipients.map((member) => {
    if (!member.telegram_ok) return `@${member.username} — не найден`
    return member.display_name
      ? `${member.display_name} (@${member.username})`
      : `@${member.username}`
  })
  return labels.join(', ')
}

/** Дата в Минске: метки журнала и «следующая отправка». */
function formatRunDate(iso: string): string {
  const date = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z')
  if (!Number.isFinite(date.getTime())) return iso
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Minsk',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date).replace('.', '')
}

function deliveryStatusLabel(status: string): string {
  switch (status) {
    case 'sent': return 'Отправлено'
    case 'pending': return 'В очереди'
    case 'sending': return 'Отправляется'
    case 'retry': return 'Повтор'
    case 'failed': return 'Ошибка'
    case 'unknown': return 'Неизвестно'
    case 'cancelled': return 'Отменено'
    default: return status
  }
}

function logStatusClass(status: string): string {
  switch (status) {
    case 'sent': return 'reminder-badge--sent'
    case 'pending': return 'reminder-badge--pending'
    case 'sending': return 'reminder-badge--pending'
    case 'retry': return 'reminder-badge--retry'
    case 'failed': return 'reminder-badge--failed'
    default: return 'reminder-badge--off'
  }
}

function logStatusDot(status: string): string {
  switch (status) {
    case 'sent': return 'reminder-badge-dot--ok'
    case 'pending': return 'reminder-badge-dot--info'
    case 'sending': return 'reminder-badge-dot--info'
    case 'retry': return 'reminder-badge-dot--warn'
    case 'failed': return 'reminder-badge-dot--err'
    default: return 'reminder-badge-dot--idle'
  }
}

function actionBusy(id: string): boolean {
  return busyIds.value.has(id)
}

function testSentRecently(id: string): boolean {
  return testedIds.value.has(id)
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const token = typeof window !== 'undefined' ? window.localStorage.getItem('admin_token') : null
  let response: Response
  try {
    response = await fetch(`/api/admin/reminders${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options?.headers,
      },
    })
  } catch {
    // Сетевой сбой: сервер не ответил. Для GET это просто «нет данных»,
    // для POST/PATCH неизвестно, применилось ли действие — просим проверить.
    const method = String(options?.method || 'GET').toUpperCase()
    throw new Error(
      method === 'GET'
        ? 'Нет связи с сервером. Проверьте подключение и повторите.'
        : 'Нет связи с сервером. Неизвестно, применилось ли действие — обновите список и проверьте результат.',
    )
  }
  if (response.status === 401) {
    throw new Error('Сессия истекла. Обновите страницу и войдите заново.')
  }
  const payload = await response.json().catch(() => ({} as Record<string, unknown>))
  if (!response.ok) {
    const code = String(payload.error || 'failed')
    const messages: Record<string, string> = {
      title_required: 'Введите название.',
      message_required: 'Введите текст сообщения.',
      invalid_time: 'Укажите время в формате ЧЧ:ММ.',
      invalid_schedule_type: 'Выберите тип расписания.',
      invalid_interval_days: 'Интервал: от 1 до 365 дней.',
      invalid_monthly_date: 'Укажите корректную дату.',
      recipients_required: 'Выберите хотя бы одного получателя.',
      recipient_not_in_team: 'Получатель вне команды.',
      recipient_not_found: 'У этого юзернейма нет карточки клиента с Telegram — напишите ему хотя бы раз, чтобы CRM запомнила ID.',
      not_found: 'Напоминание не найдено.',
    }
    throw new Error(messages[code] || `Не удалось выполнить действие (${code}).`)
  }
  return payload as T
}

async function loadAll() {
  loadError.value = ''
  isLoading.value = true
  try {
    const [list, teamList] = await Promise.all([
      api<{ reminders: Reminder[] }>(''),
      api<{ recipients: TeamMember[] }>('/recipients'),
    ])
    reminders.value = list.reminders
    team.value = teamList.recipients
    await loadLog()
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : 'Не удалось загрузить напоминания.'
  } finally {
    isLoading.value = false
  }
}

async function loadLog() {
  logLoading.value = true
  try {
    const payload = await api<{ log: LogEntry[] }>('/log?limit=50')
    log.value = payload.log
  } catch {
    // Журнал не критичен: показывать список без него
  } finally {
    logLoading.value = false
  }
}

function todayValue(): string {
  const parts = getBusinessDateParts(new Date(), 'Europe/Minsk')
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`
}

function openCreateModal() {
  editingId.value = null
  formError.value = ''
  form.title = ''
  form.message = ''
  form.recipient_usernames = []
  form.schedule_type = 'interval'
  form.interval_days = 1
  form.monthly_date = todayValue()
  form.time = '15:00'
  showFormModal.value = true
}

function openEditModal(reminder: Reminder) {
  editingId.value = reminder.id
  formError.value = ''
  form.title = reminder.title
  form.message = reminder.message
  form.recipient_usernames = reminder.recipients.map((member) => member.username)
  form.schedule_type = reminder.schedule_type
  form.interval_days = reminder.interval_days || 1
  form.monthly_date = reminder.monthly_date || todayValue()
  const pad = (value: number) => String(value).padStart(2, '0')
  form.time = `${pad(reminder.schedule_hour)}:${pad(reminder.schedule_minute)}`
  showFormModal.value = true
}

function closeFormModal() {
  if (isSubmitting.value) return
  showFormModal.value = false
  formError.value = ''
}

async function submitForm() {
  if (isSubmitting.value) return
  formError.value = ''
  if (!form.recipient_usernames.length) {
    formError.value = 'Выберите хотя бы одного получателя.'
    return
  }
  isSubmitting.value = true
  try {
    const body = JSON.stringify({
      title: form.title,
      message: form.message,
      recipient_usernames: form.recipient_usernames,
      schedule_type: form.schedule_type,
      interval_days: form.schedule_type === 'interval' ? form.interval_days : null,
      monthly_date: form.schedule_type === 'monthly' ? form.monthly_date : null,
      time: form.time,
    })
    if (editingId.value) {
      await api(`/${editingId.value}`, { method: 'PATCH', body })
    } else {
      await api('', { method: 'POST', body })
    }
    showFormModal.value = false
    await loadAll()
  } catch (error) {
    formError.value = error instanceof Error ? error.message : 'Не удалось сохранить напоминание.'
  } finally {
    isSubmitting.value = false
  }
}

async function toggleReminder(reminder: Reminder) {
  busyIds.value.add(reminder.id)
  try {
    await api(`/${reminder.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: !reminder.enabled }),
    })
    await loadAll()
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : 'Не удалось изменить напоминание.'
  } finally {
    busyIds.value.delete(reminder.id)
  }
}

async function sendTest(reminder: Reminder) {
  if (actionBusy(reminder.id) || testSentRecently(reminder.id)) return
  busyIds.value.add(reminder.id)
  try {
    await api(`/${reminder.id}/test`, { method: 'POST' })
    testedIds.value.add(reminder.id)
    setTimeout(() => testedIds.value.delete(reminder.id), 30_000)
    await loadLog()
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : 'Не удалось отправить сообщение.'
  } finally {
    busyIds.value.delete(reminder.id)
  }
}

function confirmDelete(reminder: Reminder) {
  deletingReminder.value = reminder
  showDeleteModal.value = true
}

async function deleteReminder() {
  const target = deletingReminder.value
  if (!target || isSubmitting.value) return
  isSubmitting.value = true
  try {
    await api(`/${target.id}`, { method: 'DELETE' })
    showDeleteModal.value = false
    deletingReminder.value = null
    await loadAll()
  } catch (error) {
    showDeleteModal.value = false
    loadError.value = error instanceof Error ? error.message : 'Не удалось удалить напоминание.'
  } finally {
    isSubmitting.value = false
  }
}

onMounted(loadAll)
</script>

<style scoped>
/* Бейджи статусов: палитра эталона (ink #081b4b, акценты «Заказов») */
.crm-ref-form-label {
  display: block;
  margin-bottom: 7px;
  color: #253663;
  font-size: 12px;
  font-weight: 700;
  line-height: normal;
}

.reminder-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 40px;
  font-size: 11px;
  font-weight: 700;
  line-height: normal;
  white-space: nowrap;
}
.reminder-badge svg { width: 14px; height: 14px; flex-shrink: 0; }
.reminder-badge-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }

.reminder-badge--on { background: #eafaf1; color: #0b7a55; }
.reminder-badge--on .reminder-badge-dot { background: #10b981; }
.reminder-badge--off { background: #f0f4fa; color: #8493b0; }
.reminder-badge--off .reminder-badge-dot { background: #9ba8c0; }
.reminder-badge--schedule { background: #f0f4fa; color: #253663; }
.reminder-badge--warn { background: #fff3f4; color: #c22036; }
.reminder-badge--sent { background: #eafaf1; color: #0b7a55; }
.reminder-badge--pending { background: #f0f4fa; color: #253663; }
.reminder-badge--retry { background: #fff7ea; color: #8a6d3b; }
.reminder-badge--failed { background: #fff3f4; color: #c22036; }

.reminder-badge-dot--ok { background: #10b981; }
.reminder-badge-dot--info { background: #9ba8c0; }
.reminder-badge-dot--warn { background: #d9a21b; }
.reminder-badge-dot--err { background: #e5484d; }
.reminder-badge-dot--idle { background: #9ba8c0; }

/* Выбор типа расписания в модалке */
.reminder-schedule-option {
  padding: 13px 16px;
  border: 1px solid #eaf0f9;
  border-radius: 13px;
  background: white;
  color: #081b4b;
  text-align: left;
  cursor: pointer;
  transition: border-color .15s, background .15s;
}
.reminder-schedule-option:hover { background: #f7fbff; }
.reminder-schedule-option.is-active {
  border-color: #b8d5ff;
  background: #e7f1ff;
  box-shadow: 0 6px 16px #148cff1f;
}

/* Карточка участника команды в форме (мультивыбор) */
.reminder-member {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  width: 100%;
  padding: 11px 13px;
  border: 1px solid #eaf0f9;
  border-radius: 13px;
  background: white;
  color: #081b4b;
  text-align: left;
  cursor: pointer;
  transition: border-color .15s, background .15s;
}
.reminder-member:hover { background: #f7fbff; }
.reminder-member.is-active {
  border-color: #a7e3c4;
  background: #eafaf1;
  box-shadow: 0 6px 16px #10b9811f;
}
.reminder-member.is-unavailable {
  cursor: not-allowed;
  opacity: .6;
}
.reminder-member-check {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border: 2px solid #d5dfeb;
  border-radius: 7px;
  background: white;
  color: white;
  transition: background .15s, border-color .15s;
}
.reminder-member-check svg { width: 13px; height: 13px; }
.reminder-member.is-active .reminder-member-check {
  border-color: #10b981;
  background: #10b981;
}
.reminder-member-avatar {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: #f0f4fa;
  color: #253663;
  font-size: 15px;
  font-weight: 800;
}
.reminder-member.is-active .reminder-member-avatar {
  background: linear-gradient(120deg, #10b981, #059669);
  color: white;
}

/* Кнопки эталона «Заказов»: подтверждение — зелёный градиент,
   отмена и удаление — красный градиент (как danger «Заказов»). */
.crm-ref-button.reminder-button--create {
  background: linear-gradient(115deg, #10b981, #059669);
  color: white;
  box-shadow: 0 8px 16px #10b98130;
}
.crm-ref-button.reminder-button--cancel {
  background: linear-gradient(115deg, #ff685a, #fa104f);
  color: white;
}
.crm-ref-button.reminder-button--delete {
  background: linear-gradient(115deg, #ff685a, #fa104f);
  color: white;
}
.crm-ref-chip-button.reminder-chip--create {
  background: linear-gradient(115deg, #10b981, #059669);
  border-color: transparent;
  color: white;
  box-shadow: 0 8px 16px #10b98130;
}
/* Малые кнопки карточек: зелёная — действие, красная — стоп/удаление */
.crm-ref-chip-button.reminder-chip--green {
  background: #eafaf1;
  border-color: #a7e3c4;
  color: #0b7a55;
}
.crm-ref-chip-button.reminder-chip--green:hover {
  background: #ddf5e7;
  border-color: #86d9b0;
}
.crm-ref-chip-button.reminder-chip--red {
  background: #fff3f4;
  border-color: #ffd7dc;
  color: #c22036;
}
.crm-ref-chip-button.reminder-chip--red:hover {
  background: #ffe9ec;
  border-color: #ffb9c2;
}
.crm-ref-chip-button.reminder-preset--active {
  background: #e7f1ff;
  border-color: #b8d5ff;
  color: #1759ed;
}

@media (max-width: 700px) {
  .reminder-schedule-option { padding: 11px 13px; }
  .reminder-member { padding: 9px 11px; }
  .reminder-member-avatar { width: 30px; height: 30px; font-size: 13px; }
}

</style>
