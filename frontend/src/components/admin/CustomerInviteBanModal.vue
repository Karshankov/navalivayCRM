<template>
  <AdminModal
    :is-open="isOpen"
    title="Запретить приглашать"
    description="Ограничьте приглашения, сохранив доступ к заказам."
    size="md"
    reference-design
    :is-loading="submitting"
    :show-actions="false"
    @close="close"
  >
    <form class="crm-restriction-form" @submit.prevent="submit">
      <fieldset class="crm-restriction-fields" :disabled="submitting">
        <section class="crm-restriction-section">
          <CustomerTargetPicker
            class="crm-restriction-target"
            v-model:customer-id="formCustomerId"
            v-model:username="formUsername"
            v-model:customer="formCustomer"
            :is-open="isOpen"
            :initial-label="username"
            :initial-customer="customer"
            block-hint="Запрет приглашать не изменит блокировку клиента."
          />
        </section>

        <section class="crm-restriction-section">
          <div class="crm-restriction-section-heading">
            <label for="customer-invite-ban-reason" class="crm-restriction-label">Причина запрета</label>
            <button type="button" class="crm-restriction-link" :aria-expanded="editTemplates" @click="editTemplates = !editTemplates">{{ editTemplates ? 'Готово' : 'Изменить' }}</button>
          </div>
          <p class="crm-restriction-hint">Быстрые причины</p>
          <div v-if="templates.length" class="crm-restriction-reasons">
            <button v-for="(template, index) in templates" :key="template" type="button" class="crm-restriction-chip"
              :aria-label="editTemplates ? `Удалить шаблон: ${template}` : template"
              :disabled="templatesSaving"
              @click="editTemplates ? removeTemplate(index) : reason = template">
              {{ template }}{{ editTemplates ? ' ×' : '' }}
            </button>
          </div>
          <div v-if="editTemplates" class="crm-restriction-template-editor">
            <input v-model.trim="newTemplate" maxlength="200" placeholder="Новая причина" aria-label="Новый шаблон причины запрета" @keyup.enter.prevent="addTemplate" />
            <button type="button" :disabled="templatesSaving" class="crm-restriction-secondary" @click="addTemplate">Добавить</button>
          </div>
          <p v-if="templatesError" class="crm-restriction-error" role="alert">{{ templatesError }}</p>
          <textarea id="customer-invite-ban-reason" v-model.trim="reason" rows="3" maxlength="1000" placeholder="Причина запрета" />
        </section>

        <div class="crm-restriction-summary crm-restriction-summary--notice">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" d="M12 8v4m0 4h.01M10.3 3.8 2.2 18a2 2 0 0 0 1.7 3h16.2a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z" /></svg>
          <p><strong>Заказы останутся доступны.</strong> Клиент не сможет приглашать. При попытке указать его username спишется одна попытка.</p>
        </div>
      </fieldset>
      <p v-if="error" class="crm-restriction-error" role="alert">{{ error }}</p>
      <div class="crm-restriction-actions">
        <button type="button" class="crm-restriction-secondary" :disabled="submitting" @click="close">Отмена</button>
        <button type="submit" :disabled="submitting || (!formCustomerId && !formUsername)" class="crm-restriction-danger">{{ submitting ? 'Сохраняем…' : 'Запретить приглашать' }}</button>
      </div>
    </form>
  </AdminModal>
</template>

<script setup lang="ts">
import '@/styles/crm-restriction-modals.css'
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
