<template>
  <AdminModal
    :is-open="isOpen"
    title="Запретить приглашать"
    size="sm"
    :show-actions="false"
    @close="close"
  >
    <form class="space-y-4" @submit.prevent="submit">
      <CustomerTargetPicker
        v-model:customer-id="formCustomerId"
        v-model:username="formUsername"
        v-model:customer="formCustomer"
        :is-open="isOpen"
        :initial-label="username"
        :initial-customer="customer"
        block-hint="Запрет приглашать не изменит блокировку клиента."
      />
      <div class="flex items-center justify-between">
        <span class="text-sm font-medium text-gray-700">Быстрые причины</span>
        <button
          type="button"
          class="text-xs font-medium text-blue-600 transition-colors hover:text-blue-800 hover:underline focus-visible:text-blue-800 focus-visible:underline"
          @click="editTemplates = !editTemplates"
        >
          {{ editTemplates ? 'Готово' : 'Изменить' }}
        </button>
      </div>
      <div v-if="templates.length" class="flex flex-wrap gap-2">
        <button
          v-for="(template, index) in templates"
          :key="template"
          type="button"
          class="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 hover:border-red-300"
          @click="editTemplates ? removeTemplate(index) : reason = template"
        >
          {{ template }}{{ editTemplates ? ' ×' : '' }}
        </button>
      </div>
      <div v-if="editTemplates" class="flex gap-2">
        <input v-model.trim="newTemplate" maxlength="200" class="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm" placeholder="Новая причина" @keyup.enter.prevent="addTemplate" />
        <button type="button" :disabled="templatesSaving" class="rounded-lg border px-3 py-2 text-sm disabled:opacity-50" @click="addTemplate">Добавить</button>
      </div>
      <p v-if="templatesError" class="text-xs text-red-600" role="alert">{{ templatesError }}</p>
      <textarea
        v-model.trim="reason"
        rows="3"
        maxlength="1000"
        class="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-100"
        placeholder="Причина запрета"
      />
      <p class="text-xs text-gray-500">
        Клиент сможет делать заказы, но не сможет приглашать. При попытке указать его username спишется одна попытка.
      </p>
      <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{{ error }}</p>
      <div class="flex justify-end gap-2">
        <button type="button" class="rounded-lg border px-4 py-2 text-sm focus-visible:outline-2 focus-visible:outline-blue-600" @click="close">Отмена</button>
        <button
          type="submit"
          :disabled="submitting || (!formCustomerId && !formUsername)"
          class="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-red-700 disabled:opacity-50"
        >
          {{ submitting ? 'Сохраняем...' : 'Запретить приглашать' }}
        </button>
      </div>
    </form>
  </AdminModal>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import AdminModal from '@/components/AdminModal.vue'
import CustomerTargetPicker from '@/components/admin/CustomerTargetPicker.vue'
import type { Customer } from '@/stores/crm'

const props = defineProps<{
  isOpen: boolean
  customerId: string | null
  username?: string | null
  customer?: Customer | null
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'created'): void
}>()

const reason = ref('')
const error = ref('')
const submitting = ref(false)
const templates = ref<string[]>([])
const editTemplates = ref(false)
const newTemplate = ref('')
const templatesSaving = ref(false)
const templatesError = ref('')
const formCustomerId = ref<string | null>(null)
const formUsername = ref('')
const formCustomer = ref<Customer | null>(null)

function stripAt(value?: string | null) {
  return String(value || '').replace(/^@+/, '')
}

async function loadTemplates() {
  try {
    const response = await fetch('/api/admin/crm/invite-ban-reason-templates', { credentials: 'include' })
    if (response.ok) templates.value = (await response.json()).templates || []
  } catch {}
}

async function saveTemplates() {
  templatesSaving.value = true
  templatesError.value = ''
  try {
    const response = await fetch('/api/admin/crm/invite-ban-reason-templates', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ templates: templates.value }),
    })
    if (!response.ok) throw new Error('failed')
    return true
  } catch {
    templatesError.value = 'Не удалось сохранить быстрые причины'
    return false
  } finally {
    templatesSaving.value = false
  }
}

async function addTemplate() {
  const value = newTemplate.value.trim()
  if (!value || templates.value.includes(value) || templates.value.length >= 20 || templatesSaving.value) return
  templates.value.push(value)
  newTemplate.value = ''
  if (!(await saveTemplates())) templates.value.pop()
}

async function removeTemplate(index: number) {
  if (templatesSaving.value) return
  const removed = templates.value[index]
  templates.value.splice(index, 1)
  if (!(await saveTemplates())) templates.value.splice(index, 0, removed)
}

onMounted(loadTemplates)
watch(() => props.isOpen, (open) => {
  if (open) {
    formCustomerId.value = props.customerId || null
    formCustomer.value = props.customer || null
    formUsername.value = stripAt(props.username)
    reason.value = ''
    error.value = ''
    editTemplates.value = false
    templatesError.value = ''
  }
})

async function submit() {
  if ((!formCustomerId.value && !formUsername.value) || submitting.value) return
  submitting.value = true
  error.value = ''
  try {
    const response = await fetch('/api/admin/crm/invite-bans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        customer_id: formCustomerId.value || undefined,
        telegram_username: formCustomerId.value ? undefined : formUsername.value,
        reason: reason.value || null,
      }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      const messages: Record<string, string> = {
        already_invite_banned: 'Запрет уже действует',
        username_reserved: 'Этот username находится в списке наших аккаунтов',
        username_ambiguous: 'Найдено несколько клиентов. Выберите нужного из списка',
        username_invalid: 'Проверьте Telegram username',
      }
      throw new Error(messages[data.error] || 'Не удалось сохранить запрет')
    }
    emit('created')
    emit('close')
  } catch (cause: any) {
    error.value = cause?.message || 'Не удалось сохранить запрет'
  } finally {
    submitting.value = false
  }
}

function close() {
  if (!submitting.value) emit('close')
}
</script>
