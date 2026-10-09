<template>
  <AdminModal
    :is-open="isOpen"
    title="Разрешить без приглашения"
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
        block-hint="Разрешение снимет только блок «Авторизация не пройдена». Остальные блокировки останутся."
      />
      <div class="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        Клиент сможет открыть каталог и заказать без указания пригласившего.
      </div>
      <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{{ error }}</p>
      <div class="flex justify-end gap-2">
        <button type="button" class="rounded-lg border px-4 py-2 text-sm focus-visible:outline-2 focus-visible:outline-blue-600" @click="close">Отмена</button>
        <button
          type="submit"
          :disabled="submitting || (!formCustomerId && !formUsername)"
          class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-emerald-700 disabled:opacity-50"
        >{{ submitting ? 'Сохраняем...' : 'Разрешить' }}</button>
      </div>
    </form>
  </AdminModal>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import AdminModal from '@/components/AdminModal.vue'
import CustomerTargetPicker from '@/components/admin/CustomerTargetPicker.vue'
import type { Customer } from '@/stores/crm'

const props = defineProps<{
  isOpen: boolean
  customerId?: string | null
  username?: string | null
  customer?: Customer | null
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'created', payload: { kind: 'active' | 'pending'; alreadyAuthorized?: boolean }): void
}>()

const formCustomerId = ref<string | null>(null)
const formUsername = ref('')
const formCustomer = ref<Customer | null>(null)
const submitting = ref(false)
const error = ref('')

watch(() => props.isOpen, (open) => {
  if (!open) return
  formCustomerId.value = props.customerId || null
  formCustomer.value = props.customer || null
  formUsername.value = String(props.username || '').replace(/^@+/, '')
  error.value = ''
})

async function submit() {
  if ((!formCustomerId.value && !formUsername.value) || submitting.value) return
  submitting.value = true
  error.value = ''
  try {
    const response = await fetch('/api/admin/crm/referral-authorization/staff-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        customer_id: formCustomerId.value || undefined,
        telegram_username: formCustomerId.value ? undefined : formUsername.value,
      }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      const messages: Record<string, string> = {
        username_invalid: 'Проверьте Telegram username',
        username_ambiguous: 'Найдено несколько клиентов. Выберите нужного из списка',
        customer_not_found: 'Клиент не найден',
      }
      throw new Error(messages[data.error] || 'Не удалось выдать разрешение')
    }
    emit('created', { kind: data.kind, alreadyAuthorized: Boolean(data.already_authorized) })
    emit('close')
  } catch (cause: any) {
    error.value = cause?.message || 'Не удалось выдать разрешение'
  } finally {
    submitting.value = false
  }
}

function close() {
  if (!submitting.value) emit('close')
}
</script>
