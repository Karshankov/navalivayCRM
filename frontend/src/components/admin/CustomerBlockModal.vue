<template>
  <AdminModal :is-open="isOpen" title="Заблокировать клиента" size="md" :show-actions="false" @close="handleClose">
    <form class="space-y-4" @submit.prevent="submit">
      <div class="space-y-1.5">
        <label class="block text-sm font-medium text-gray-700">Telegram username</label>
        <div class="relative">
          <span class="absolute inset-y-0 left-3 flex items-center text-gray-400">@</span>
          <input
            ref="usernameInputRef"
            v-model.trim="formUsername"
            type="text"
            placeholder="polizhzw"
            autocomplete="off"
            :disabled="Boolean(customerId)"
            class="w-full rounded-lg border border-gray-300 bg-white pl-7 pr-3 py-2 text-sm focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/30 disabled:bg-gray-50 disabled:text-gray-500"
            required
          />
        </div>
        <p class="text-xs text-gray-500">
          Если клиент уже есть в базе, блок навесится на его аккаунт по telegram_id.
          Если клиента нет, будет создан превентивный бан и активируется при первом заходе в миниапку.
        </p>
      </div>

      <div class="space-y-1.5">
        <label class="block text-sm font-medium text-gray-700">Длительность</label>
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <button
            v-for="option in DURATION_OPTIONS"
            :key="option.value"
            type="button"
            class="rounded-lg border px-3 py-2 text-xs font-semibold transition"
            :class="
              durationUnit === option.value
                ? 'border-brand-primary bg-brand-primary/10 text-brand-dark'
                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
            "
            @click="durationUnit = option.value"
          >
            {{ option.label }}
          </button>
        </div>
        <div v-if="durationUnit !== 'forever'" class="mt-2">
          <label class="block text-xs font-medium text-gray-500">
            Сколько {{ unitLabelGenitive }}
          </label>
          <input
            v-model.number="durationValue"
            type="number"
            min="1"
            step="1"
            class="mt-1 w-32 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
            required
          />
        </div>
      </div>

      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <label class="block text-sm font-medium text-gray-700">Причина (видна клиенту)</label>
          <button
            type="button"
            class="text-xs font-medium text-blue-600 transition-colors hover:text-blue-800 hover:underline focus-visible:text-blue-800 focus-visible:underline"
            @click="editTemplates = !editTemplates"
            title="Редактировать шаблоны"
          >
            {{ editTemplates ? 'Готово' : 'Изменить' }}
          </button>
        </div>

        <!-- Шаблоны причин (всегда видны, клик → подстановка в textarea) -->
        <div v-if="templates.length > 0" class="flex flex-wrap gap-1.5">
          <button
            v-for="(t, i) in templates"
            :key="i"
            type="button"
            class="group inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 shadow-sm transition hover:border-brand-primary hover:text-brand-dark"
            @click="reason = t"
          >
            <span class="max-w-[200px] truncate">{{ t }}</span>
            <svg
              v-if="editTemplates"
              class="h-3 w-3 flex-shrink-0 text-gray-300 hover:text-red-500 transition"
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
              @click.stop="removeTemplate(i)"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- Режим редактирования: добавление нового шаблона -->
        <div v-if="editTemplates" class="flex gap-2">
          <input
            v-model.trim="newTemplate"
            type="text"
            placeholder="Добавить шаблон..."
            class="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
            @keyup.enter.prevent="addTemplate"
          />
          <button
            type="button"
            class="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 transition hover:border-brand-primary hover:text-brand-dark"
            @click="addTemplate"
          >
            + Добавить
          </button>
        </div>

        <p
          v-if="templates.length === 0 && !editTemplates"
          class="text-xs text-gray-400"
        >Нет шаблонов. Нажмите «Изменить» чтобы добавить.</p>

        <textarea
          v-model.trim="reason"
          rows="2"
          placeholder="Например: флуд заказами, неадекватное поведение"
          class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
        />
      </div>

      <div v-if="previewLabel" class="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
        Доступ к заказам будет открыт <span class="font-semibold text-gray-900">{{ previewLabel }}</span>
      </div>

      <div v-if="errorMessage" class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        {{ errorMessage }}
      </div>

      <div class="flex items-center justify-end gap-2 pt-2">
        <button
          type="button"
          class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          @click="handleClose"
        >
          Отмена
        </button>
        <button
          type="submit"
          :disabled="!canSubmit || submitting"
          class="rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {{ submitting ? 'Блокируем…' : 'Заблокировать' }}
        </button>
      </div>
    </form>
  </AdminModal>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import AdminModal from '@/components/AdminModal.vue'
import { useCrmStore, type CustomerBlockDuration } from '@/stores/crm'
import { formatBlockNotifyMessage } from '@/utils/block-notify-message'

const props = defineProps<{
  isOpen: boolean
  // Опционально: предзаполнить username (например, из карточки клиента)
  prefillUsername?: string
  // Из карточки заказа блокируем именно клиента, а не совпавший старый username.
  customerId?: string | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'created', payload: { kind: 'active' | 'pending'; username: string }): void
  (e: 'notifyResult', payload: { ok: boolean; error?: string; text?: string; username?: string }): void
}>()

const crmStore = useCrmStore()

const DURATION_OPTIONS = [
  { value: 'minutes', label: 'минуты' },
  { value: 'hours', label: 'часы' },
  { value: 'days', label: 'дни' },
  { value: 'forever', label: 'навсегда' },
] as const

type DurationUnit = (typeof DURATION_OPTIONS)[number]['value']

const formUsername = ref('')
const durationUnit = ref<DurationUnit>('hours')
const durationValue = ref<number>(2)
const reason = ref('')
const errorMessage = ref('')
const submitting = ref(false)
const usernameInputRef = ref<HTMLInputElement | null>(null)

// Template block reasons
const editTemplates = ref(false)
const templates = ref<string[]>([])
const newTemplate = ref('')

async function loadTemplates() {
  try {
    const res = await fetch('/api/admin/crm/block-reason-templates', { credentials: 'include' })
    if (res.ok) {
      const data = await res.json()
      templates.value = data.templates || []
    }
  } catch {}
}

async function saveTemplates() {
  try {
    await fetch('/api/admin/crm/block-reason-templates', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ templates: templates.value }),
    })
  } catch {}
}

function addTemplate() {
  const v = newTemplate.value.trim()
  if (!v) return
  templates.value.push(v)
  newTemplate.value = ''
  saveTemplates()
}

function removeTemplate(index: number) {
  templates.value.splice(index, 1)
  saveTemplates()
}

onMounted(() => {
  loadTemplates()
})

// Сброс формы и фокус при открытии
watch(
  () => props.isOpen,
  (open) => {
    if (open) {
      formUsername.value = stripAt(props.prefillUsername)
      durationUnit.value = 'hours'
      durationValue.value = 2
      reason.value = ''
      errorMessage.value = ''
      submitting.value = false
      nextTick(() => usernameInputRef.value?.focus())
    }
  },
  { immediate: false },
)

// Если родитель сменил prefill уже в открытом состоянии — обновляем поле.
// Сценарий: открыта модалка из «Заказов», пользователь не закрыл её, а из
// другого места переоткрыли с другим username.
watch(
  () => props.prefillUsername,
  (next) => {
    if (props.isOpen && next !== undefined) {
      formUsername.value = stripAt(next)
    }
  },
)

function stripAt(raw: string | undefined): string {
  return (raw ?? '').trim().replace(/^@+/, '')
}

const unitLabelGenitive = computed(() => {
  switch (durationUnit.value) {
    case 'minutes':
      return 'минут'
    case 'hours':
      return 'часов'
    case 'days':
      return 'дней'
    default:
      return ''
  }
})

const canSubmit = computed(() => {
  if (!props.customerId && !formUsername.value.trim()) return false
  if (durationUnit.value !== 'forever' && (!Number.isFinite(durationValue.value) || durationValue.value <= 0)) {
    return false
  }
  return true
})

const previewLabel = computed(() => {
  if (durationUnit.value === 'forever') {
    return 'никогда (бессрочная блокировка)'
  }
  const v = Number(durationValue.value)
  if (!Number.isFinite(v) || v <= 0) return ''
  const ms = (() => {
    switch (durationUnit.value) {
      case 'minutes':
        return v * 60_000
      case 'hours':
        return v * 60 * 60_000
      case 'days':
        return v * 24 * 60 * 60_000
      default:
        return 0
    }
  })()
  const target = new Date(Date.now() + ms)
  return target.toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
})

async function submit() {
  if (!canSubmit.value || submitting.value) return
  submitting.value = true
  errorMessage.value = ''

  const duration: CustomerBlockDuration =
    durationUnit.value === 'forever'
      ? { unit: 'forever' }
      : { unit: durationUnit.value, value: Number(durationValue.value) }

  try {
    // formUsername уже нормализован (см. stripAt при открытии и watch),
    // дополнительный strip — на случай ручного редактирования.
    const username = stripAt(formUsername.value)
    const result = await crmStore.createCustomerBlock({
      customer_id: props.customerId || undefined,
      telegram_username: props.customerId ? undefined : username,
      reason: reason.value.trim() || null,
      duration,
    })
    emit('created', { kind: result.kind, username })

    const notifyText = formatBlockNotifyMessage(reason.value.trim() || null)

    // Try to send block notification via userbot
    try {
      const blockId = result.block.id
      const notifyRes = await fetch(`/api/admin/crm/blocks/${encodeURIComponent(blockId)}/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      })
      const notifyData = await notifyRes.json()
      if (notifyData.ok) {
        emit('notifyResult', { ok: true })
      } else {
        emit('notifyResult', { ok: false, error: notifyData.error, text: notifyText, username })
      }
    } catch {
      emit('notifyResult', { ok: false, error: 'network_error', text: notifyText, username })
    }

    emit('close')
  } catch (err: any) {
    if (err?.message === 'already_blocked') {
      errorMessage.value = 'Этот клиент уже заблокирован. Сначала снимите старый блок.'
    } else if (err?.message === 'customer_not_found') {
      errorMessage.value = 'Клиент с таким ID не найден.'
    } else {
      errorMessage.value = err?.message || 'Не удалось создать блокировку.'
    }
  } finally {
    submitting.value = false
  }
}

function handleClose() {
  if (!submitting.value) {
    emit('close')
  }
}
</script>
