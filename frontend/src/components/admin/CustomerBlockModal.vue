<template>
  <AdminModal
    :is-open="isOpen"
    title="Заблокировать клиента"
    description="Ограничьте доступ к заказам на выбранный срок."
    size="md"
    reference-design
    :is-loading="submitting"
    :show-actions="false"
    @close="handleClose"
  >
    <form class="crm-restriction-form" @submit.prevent="submit">
      <fieldset class="crm-restriction-fields" :disabled="submitting">
        <section class="crm-restriction-section">
          <label for="customer-block-username" class="crm-restriction-label">Telegram username</label>
          <div class="crm-restriction-username">
            <span aria-hidden="true">@</span>
            <input
              id="customer-block-username"
              ref="usernameInputRef"
              v-model.trim="formUsername"
              type="text"
              placeholder="username"
              autocomplete="off"
              autocapitalize="none"
              :spellcheck="false"
              :disabled="Boolean(customerId)"
              aria-describedby="customer-block-hint"
              required
            />
          </div>
          <p v-if="customerId" id="customer-block-hint" class="crm-restriction-hint">Блокировка применяется к выбранному клиенту из карточки, а не к совпавшему username.</p>
          <p v-else id="customer-block-hint" class="crm-restriction-hint">Клиент из базы будет заблокирован по Telegram ID. Если его ещё нет, запрет активируется при первом входе в миниапку.</p>
        </section>

        <section class="crm-restriction-section">
          <h3 class="crm-restriction-label">Длительность блокировки</h3>
          <div class="crm-restriction-durations" role="group" aria-label="Единица длительности">
            <button v-for="option in DURATION_OPTIONS" :key="option.value" type="button"
              class="crm-restriction-duration" :class="{ 'is-selected': durationUnit === option.value }"
              :aria-pressed="durationUnit === option.value" @click="durationUnit = option.value">
              {{ option.label }}
            </button>
          </div>
          <div v-if="durationUnit !== 'forever'" class="crm-restriction-quantity">
            <label for="customer-block-duration" class="crm-restriction-hint">Сколько {{ unitLabelGenitive }}</label>
            <input id="customer-block-duration" v-model.number="durationValue" type="number" min="1" step="1" required />
          </div>
          <p v-if="previewLabel" class="crm-restriction-summary" role="status">
            Доступ к заказам будет открыт <strong>{{ previewLabel }}</strong>
          </p>
        </section>

        <section class="crm-restriction-section">
          <div class="crm-restriction-section-heading">
            <label for="customer-block-reason" class="crm-restriction-label">Причина <span>видна клиенту</span></label>
            <button type="button" class="crm-restriction-link" :aria-expanded="editTemplates" @click="editTemplates = !editTemplates" title="Редактировать шаблоны">{{ editTemplates ? 'Готово' : 'Изменить' }}</button>
          </div>
          <div v-if="templates.length > 0" class="crm-restriction-reasons">
            <div v-for="(t, i) in templates" :key="i" class="crm-restriction-reason-group">
              <button type="button" class="crm-restriction-chip" @click="reason = t">{{ t }}</button>
              <button v-if="editTemplates" type="button" class="crm-restriction-remove" :aria-label="`Удалить шаблон: ${t}`" @click="removeTemplate(i)">
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          </div>
          <div v-if="editTemplates" class="crm-restriction-template-editor">
            <input v-model.trim="newTemplate" type="text" placeholder="Добавить шаблон…" aria-label="Новый шаблон причины блокировки" @keyup.enter.prevent="addTemplate" />
            <button type="button" class="crm-restriction-secondary" @click="addTemplate">Добавить</button>
          </div>
          <p v-if="templates.length === 0 && !editTemplates" class="crm-restriction-hint">Нет шаблонов. Нажмите «Изменить», чтобы добавить.</p>
          <textarea id="customer-block-reason" v-model.trim="reason" rows="3" placeholder="Например: флуд заказами, неадекватное поведение" />
        </section>
      </fieldset>

      <p v-if="errorMessage" class="crm-restriction-error" role="alert">{{ errorMessage }}</p>
      <div class="crm-restriction-actions">
        <button type="button" class="crm-restriction-secondary" :disabled="submitting" @click="handleClose">Отмена</button>
        <button type="submit" class="crm-restriction-danger" :disabled="!canSubmit || submitting">{{ submitting ? 'Блокируем…' : 'Заблокировать' }}</button>
      </div>
    </form>
  </AdminModal>
</template>

<script setup lang="ts">
import '@/styles/crm-restriction-modals.css'
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
