<template>
  <AdminModal
    :is-open="isOpen"
    :title="modalTitle"
    description="Сохраните информацию о клиенте для команды."
    size="md"
    reference-design
    :is-loading="submitting"
    :show-actions="false"
    @close="handleClose"
  >
    <form class="crm-note-form" @submit.prevent="submit">
      <fieldset class="crm-note-fields" :disabled="submitting">
        <section class="crm-note-section">
          <template v-if="mode === 'toolbar'">
            <label for="customer-note-username" class="crm-note-label">Telegram username</label>
            <div class="crm-note-username">
              <span aria-hidden="true">@</span>
              <input id="customer-note-username" ref="usernameInputRef" v-model.trim="formUsername"
                type="text" placeholder="username" autocomplete="off" autocapitalize="none" :spellcheck="false"
                aria-describedby="customer-note-hint" required />
            </div>
            <p id="customer-note-hint" class="crm-note-hint">Если клиента ещё нет в базе, заметка появится на его заказе после первого оформления.</p>
          </template>
          <template v-else>
            <span class="crm-note-label">Клиент</span>
            <div class="crm-note-customer">
              <strong>{{ customerLabel }}</strong>
              <span v-if="displayUsername">@{{ displayUsername }}</span>
              <span v-else-if="customerId">ID {{ customerId }}</span>
            </div>
          </template>
        </section>
        <section class="crm-note-section">
          <label for="customer-note-text" class="crm-note-label">Заметка для команды</label>
          <textarea id="customer-note-text" v-model="noteText" rows="4" maxlength="2000"
            placeholder="Например: клиенту есть 18, обратить внимание при выдаче"
            aria-describedby="customer-note-counter" />
          <p id="customer-note-counter" class="crm-note-counter">{{ noteText.length }} / 2000</p>
        </section>
      </fieldset>
      <div v-if="errorMessage" class="crm-note-error" role="alert">{{ errorMessage }}</div>
      <div class="crm-note-actions">
        <button v-if="hasExistingNote" type="button" class="crm-note-delete" :disabled="submitting" @click="removeNote">Удалить</button>
        <div class="crm-note-main-actions">
          <button type="button" class="crm-note-secondary" :disabled="submitting" @click="handleClose">Отмена</button>
          <button type="submit" class="crm-note-primary" :disabled="submitting">{{ submitting ? 'Сохраняем…' : 'Сохранить' }}</button>
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

<style scoped>
.crm-note-form { display: grid; gap: 16px; min-width: 0; color: #081b4b; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; font-size: 13px; line-height: 1.5; }
.crm-note-form *, .crm-note-form *::before { box-sizing: border-box; }
.crm-note-fields { display: grid; gap: 14px; min-width: 0; margin: 0; padding: 0; border: 0; }
.crm-note-section { display: grid; gap: 10px; min-width: 0; padding: 18px; border: 1px solid #eaf0f9; border-radius: 16px; background: #fff; box-shadow: 0 10px 30px #20386905; }
.crm-note-form p { margin: 0; }
.crm-note-label { color: #081b4b; font-size: 13px; font-weight: 750; }
.crm-note-form input, .crm-note-form textarea { width: 100%; min-width: 0; max-width: 100%; padding: 11px 12px; border: 1px solid #dce8fa; border-radius: 10px; background: #f7fbff; color: #081b4b; font: inherit; font-size: 13px; line-height: 1.5; box-shadow: none; }
.crm-note-form textarea { min-height: 140px; resize: vertical; }
.crm-note-form input::placeholder, .crm-note-form textarea::placeholder { color: #8999b7; opacity: 1; }
.crm-note-form :is(input, textarea, button):focus-visible { outline: 2px solid #0958ff; outline-offset: 3px; }
.crm-note-username { position: relative; }
.crm-note-username > span { position: absolute; top: 50%; left: 12px; transform: translateY(-50%); color: #66799e; pointer-events: none; }
.crm-note-username > input { padding-left: 30px; }
.crm-note-hint { color: #66799e; font-size: 11px; line-height: 1.6; }
.crm-note-customer { display: grid; gap: 3px; padding: 12px 14px; border: 1px solid #dce8fa; border-radius: 12px; background: #f7fbff; overflow-wrap: anywhere; }
.crm-note-customer strong { font-size: 14px; font-weight: 750; }
.crm-note-customer > span { color: #66799e; font-size: 12px; }
.crm-note-counter { text-align: right; color: #66799e; font-size: 11px; font-variant-numeric: tabular-nums; }
.crm-note-error { padding: 12px 14px; border: 1px solid #ffd4dc; border-radius: 12px; background: #fff4f6; color: #b82648; overflow-wrap: anywhere; }
.crm-note-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.crm-note-main-actions { display: flex; justify-content: flex-end; gap: 10px; margin-left: auto; }
.crm-note-form button { min-height: 44px; padding: 11px 18px; border: 1px solid transparent; border-radius: 12px; font-family: inherit; font-size: 13px; font-weight: 750; cursor: pointer; }
.crm-note-form button:disabled { opacity: .5; cursor: not-allowed; }
.crm-note-primary { background: linear-gradient(100deg, #05b8ff, #185dff); color: #fff; box-shadow: 0 6px 14px #148cff24; }
.crm-note-form .crm-note-secondary { border-color: #dce8fa; background: linear-gradient(#f7faff, #e9f0fa); color: #233e70; }
.crm-note-form .crm-note-delete { border-color: #ffd4dc; background: #fff4f6; color: #c92b4f; }
.crm-note-form button:not(:disabled):hover { filter: brightness(1.04); }
@media (max-width: 480px) { .crm-note-section { padding: 14px; } .crm-note-form input, .crm-note-form textarea { font-size: 16px; } .crm-note-actions, .crm-note-main-actions { width: 100%; } .crm-note-main-actions > button { flex: 1; padding-inline: 12px; } .crm-note-delete { width: 100%; } }
@media (prefers-reduced-motion: reduce) { .crm-note-form * { transition: none !important; } }
</style>
