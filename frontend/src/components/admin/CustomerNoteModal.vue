<template>
  <AdminModal
    :is-open="isOpen"
    :title="modalTitle"
    size="md"
    :show-actions="false"
    @close="handleClose"
  >
    <form class="w-full sm:w-[32rem] max-w-full box-border space-y-4" @submit.prevent="submit">
      <div v-if="mode === 'toolbar'" class="space-y-1.5">
        <label class="block text-sm font-medium text-gray-700">Telegram username</label>
        <div class="relative">
          <span class="absolute inset-y-0 left-3 flex items-center text-gray-400">@</span>
          <input
            ref="usernameInputRef"
            v-model.trim="formUsername"
            type="text"
            placeholder="rk0ff"
            autocomplete="off"
            class="w-full rounded-lg border border-gray-300 bg-white pl-7 pr-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
            required
          />
        </div>
        <p class="text-xs text-gray-500">
          Если клиента ещё нет в базе, заметка появится на его заказе после первого оформления.
        </p>
      </div>

      <div
        v-else-if="displayUsername"
        class="min-w-0 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700"
      >
        <span class="font-medium text-gray-900">{{ customerLabel }}</span>
        <span v-if="displayUsername" class="text-gray-500"> · @{{ displayUsername }}</span>
      </div>

      <div class="space-y-1.5">
        <label class="block text-sm font-medium text-gray-700">Заметка для команды</label>
        <textarea
          v-model="noteText"
          rows="4"
          maxlength="2000"
          placeholder="Например: клиенту есть 18, обратить внимание при выдаче"
          class="box-border w-full min-w-0 resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
        />
        <p class="text-right text-xs tabular-nums text-gray-400">{{ noteText.length }} / 2000</p>
      </div>

      <div v-if="errorMessage" class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        {{ errorMessage }}
      </div>

      <div class="flex items-center gap-2 pt-2">
        <div class="w-[5.5rem] shrink-0">
          <button
            v-if="hasExistingNote"
            type="button"
            class="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            :disabled="submitting"
            @click="removeNote"
          >
            Удалить
          </button>
        </div>
        <div class="ml-auto flex items-center gap-2">
          <button
            type="button"
            class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            @click="handleClose"
          >
            Отмена
          </button>
          <button
            type="submit"
            :disabled="submitting"
            class="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {{ submitting ? 'Сохраняем…' : 'Сохранить' }}
          </button>
        </div>
      </div>
    </form>
  </AdminModal>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import AdminModal from '@/components/AdminModal.vue'
import { useCrmStore } from '@/stores/crm'

const props = defineProps<{
  isOpen: boolean
  mode?: 'toolbar' | 'card'
  prefillUsername?: string
  customerId?: string
  customerName?: string
  initialNotes?: string | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'saved', payload: {
    kind: 'active' | 'pending' | 'cleared'
    customerId?: string
    username?: string
    notes: string | null
  }): void
}>()

const crmStore = useCrmStore()

const mode = computed(() => props.mode || 'toolbar')
const formUsername = ref('')
const noteText = ref('')
const errorMessage = ref('')
const submitting = ref(false)
const usernameInputRef = ref<HTMLInputElement | null>(null)

const displayUsername = computed(() => {
  if (mode.value === 'card') {
    return stripAt(props.prefillUsername)
  }
  return ''
})

const customerLabel = computed(() => props.customerName?.trim() || 'Клиент')

const modalTitle = computed(() =>
  mode.value === 'card' ? 'Заметка о клиенте' : 'Заметка на клиента',
)

const hasExistingNote = computed(() => Boolean(noteText.value.trim()))

function stripAt(value?: string) {
  return String(value || '').trim().replace(/^@+/, '')
}

function handleClose() {
  if (submitting.value) return
  emit('close')
}

async function submit() {
  errorMessage.value = ''
  submitting.value = true
  try {
    const notes = noteText.value.trim()
    if (!notes) {
      await removeNoteInternal()
      return
    }
    const result = await crmStore.upsertCustomerNote({
      customer_id: mode.value === 'card' ? props.customerId : undefined,
      telegram_username:
        mode.value === 'toolbar' ? stripAt(formUsername.value) : stripAt(props.prefillUsername),
      notes,
    })
    emit('saved', {
      kind: result.kind === 'pending' ? 'pending' : 'active',
      customerId: result.customer?.id || props.customerId,
      username:
        result.customer?.telegram_username ||
        stripAt(formUsername.value) ||
        stripAt(props.prefillUsername),
      notes: result.notes ?? notes,
    })
    emit('close')
  } catch (err: unknown) {
    errorMessage.value = formatError(err)
  } finally {
    submitting.value = false
  }
}

async function removeNote() {
  submitting.value = true
  errorMessage.value = ''
  try {
    await removeNoteInternal()
  } catch (err: unknown) {
    errorMessage.value = formatError(err)
  } finally {
    submitting.value = false
  }
}

async function removeNoteInternal() {
  await crmStore.clearCustomerNote({
    customer_id: mode.value === 'card' ? props.customerId : undefined,
    telegram_username:
      mode.value === 'toolbar' ? stripAt(formUsername.value) : stripAt(props.prefillUsername),
  })
  emit('saved', {
    kind: 'cleared',
    customerId: props.customerId,
    username: stripAt(formUsername.value) || stripAt(props.prefillUsername),
    notes: null,
  })
  emit('close')
}

function formatError(err: unknown) {
  const code = (err as { code?: string })?.code
  if (code === 'note_too_long') return 'Заметка слишком длинная (макс. 2000 символов).'
  if (code === 'invalid_telegram_username') return 'Укажите корректный Telegram username.'
  if (code === 'customer_not_found') return 'Клиент не найден.'
  return 'Не удалось сохранить заметку.'
}

watch(
  () => props.isOpen,
  (open) => {
    if (!open) return
    formUsername.value = stripAt(props.prefillUsername)
    noteText.value = props.initialNotes || ''
    errorMessage.value = ''
    nextTick(() => {
      if (mode.value === 'toolbar') {
        usernameInputRef.value?.focus()
      }
    })
  },
)
</script>