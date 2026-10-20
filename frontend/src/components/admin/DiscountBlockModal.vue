<template>
  <AdminModal
    :is-open="isOpen"
    title="Блокировка скидочной системы"
    description="Заморозка бонусов и промокодов на выбранный срок. Накопленные бонусы не сгорают."
    size="md"
    reference-design
    :is-loading="submitting"
    :show-actions="false"
    @close="handleClose"
  >
    <form class="crm-restriction-form" @submit.prevent="submit">
      <fieldset class="crm-restriction-fields" :disabled="submitting">
        <section v-if="status?.blocked" class="crm-restriction-section discount-block__status">
          <p class="crm-restriction-hint">Сейчас заморожено до</p>
          <p class="discount-block__status-date">
            <strong>{{ formattedActiveUntil }}</strong>
          </p>
          <p v-if="status?.comment" class="crm-restriction-hint">Комментарий: {{ status.comment }}</p>
        </section>

        <section class="crm-restriction-section">
          <label for="discount-block-date" class="crm-restriction-label">Заблокировать до…</label>
          <input
            id="discount-block-date"
            v-model="formDate"
            type="date"
            required
          />
          <p class="crm-restriction-hint">Блокировка действует до конца выбранного дня (23:59 по Минску).</p>
        </section>

        <section class="crm-restriction-section">
          <label for="discount-block-comment" class="crm-restriction-label">
            Комментарий <span>необязательно, виден только вам</span>
          </label>
          <textarea
            id="discount-block-comment"
            v-model.trim="formComment"
            rows="2"
            placeholder="Например: перепроверка накопления бонусов"
          />
        </section>

        <section class="crm-restriction-section">
          <div class="crm-restriction-section-heading">
            <label for="discount-block-template" class="crm-restriction-label">
              Текст уведомления <span>придёт клиенту в Telegram</span>
            </label>
          </div>
          <textarea
            id="discount-block-template"
            v-model.trim="formTemplate"
            rows="2"
            aria-describedby="discount-block-template-hint"
          />
          <p id="discount-block-template-hint" class="crm-restriction-hint">
            Переменные: <code>{date}</code> — дата окончания (ДД.ММ.ГГГГ),
            <code>{comment}</code> — ваш комментарий.
          </p>
          <button
            v-if="templateDirty"
            type="button"
            class="crm-restriction-secondary discount-block__save-template"
            :disabled="savingTemplate || !templateValid"
            @click="saveTemplate"
          >
            {{ savingTemplate ? 'Сохраняем…' : 'Сохранить шаблон' }}
          </button>
          <p v-if="templateError" class="crm-restriction-error" role="alert">{{ templateError }}</p>
          <p v-if="templateSaved" class="crm-restriction-hint" role="status">Шаблон сохранён.</p>
          <p v-else-if="templatePreview" class="crm-restriction-summary" role="status">
            Предпросмотр: {{ templatePreview }}
          </p>
        </section>
      </fieldset>

      <p v-if="errorMessage" class="crm-restriction-error" role="alert">{{ errorMessage }}</p>
      <p v-if="notifyWarning" class="crm-restriction-summary crm-restriction-summary--notice" role="status">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        </svg>
        <span><strong>Клиент не уведомлён</strong>У клиента нет привязки к Telegram — сообщение не отправлено.</span>
      </p>

      <div class="crm-restriction-actions">
        <button
          v-if="status?.blocked"
          type="button"
          class="crm-restriction-secondary"
          :disabled="submitting"
          @click="removeBlock"
        >
          {{ submitting ? 'Снимаем…' : 'Снять блокировку' }}
        </button>
        <button type="button" class="crm-restriction-secondary" :disabled="submitting" @click="handleClose">Отмена</button>
        <button type="submit" class="crm-restriction-danger" :disabled="!canSubmit || submitting">
          {{ submitting ? 'Сохраняем…' : (status?.blocked ? 'Сохранить' : 'Заблокировать') }}
        </button>
      </div>
    </form>
  </AdminModal>
</template>

<script setup lang="ts">
import '@/styles/crm-restriction-modals.css'
import { computed, ref, watch } from 'vue'
import AdminModal from '@/components/AdminModal.vue'
import { useCrmStore, type DiscountBlockStatus } from '@/stores/crm'

const props = defineProps<{
  isOpen: boolean
  customerId: string
  status?: DiscountBlockStatus | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'changed'): void
}>()

const crmStore = useCrmStore()

const formDate = ref('')
const formComment = ref('')
const formTemplate = ref('')
const initialTemplate = ref('')
const submitting = ref(false)
const savingTemplate = ref(false)
const errorMessage = ref('')
const templateError = ref('')
const templateSaved = ref(false)
const notifyWarning = ref(false)

const templateDirty = computed(() => formTemplate.value.trim() !== initialTemplate.value)
const templateValid = computed(() => formTemplate.value.trim().includes('{date}'))
const canSubmit = computed(() => Boolean(formDate.value))

const formattedActiveUntil = computed(() => {
  const until = props.status?.until
  if (!until) return ''
  const normalized = until.includes('T') ? until : until.replace(' ', 'T') + 'Z'
  const parsed = new Date(normalized)
  if (!Number.isFinite(parsed.getTime())) return until
  // Дата окончания — по Минску
  const minsk = new Date(parsed.getTime() + 3 * 60 * 60 * 1000)
  const day = String(minsk.getUTCDate()).padStart(2, '0')
  const month = String(minsk.getUTCMonth() + 1).padStart(2, '0')
  return `${day}.${month}.${minsk.getUTCFullYear()}`
})

const templatePreview = computed(() => {
  if (!templateValid.value) return null
  const comment = formComment.value || ''
  return formTemplate.value
    .replace(/\{date\}/g, formDate.value ? formattedFormDate.value : 'ДД.ММ.ГГГГ')
    .replace(/\{comment\}/g, comment)
})

const formattedFormDate = computed(() => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(formDate.value)
  if (!match) return ''
  return `${match[3]}.${match[2]}.${match[1]}`
})

watch(
  () => props.isOpen,
  async (open) => {
    if (!open) return
    errorMessage.value = ''
    templateError.value = ''
    templateSaved.value = false
    notifyWarning.value = false
    formComment.value = props.status?.comment || ''
    // Дата из активной блокировки или завтра (по Минску)
    if (props.status?.until) {
      const normalized = props.status.until.includes('T')
        ? props.status.until
        : props.status.until.replace(' ', 'T') + 'Z'
      const parsed = new Date(normalized)
      if (Number.isFinite(parsed.getTime())) {
        const minsk = new Date(parsed.getTime() + 3 * 60 * 60 * 1000)
        formDate.value = minsk.toISOString().slice(0, 10)
      } else {
        formDate.value = defaultDate()
      }
    } else {
      formDate.value = defaultDate()
    }
    // Текущий шаблон уведомления
    formTemplate.value = ''
    initialTemplate.value = ''
    try {
      const template = await crmStore.fetchDiscountBlockTemplate()
      formTemplate.value = template
      initialTemplate.value = template
    } catch {
      formTemplate.value = 'Ваша скидочная система временно заморожена до {date}.'
      initialTemplate.value = formTemplate.value
    }
  },
)

function defaultDate() {
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000)
  return now.toISOString().slice(0, 10)
}

async function submit() {
  if (submitting.value || !canSubmit.value) return
  errorMessage.value = ''
  notifyWarning.value = false
  submitting.value = true
  try {
    const result = await crmStore.blockCustomerDiscount(
      props.customerId,
      formDate.value,
      formComment.value,
    )
    if (result.notify && result.notify.ok === false) {
      notifyWarning.value = true
    }
    emit('changed')
  } catch (error: any) {
    errorMessage.value = error?.message || 'Не удалось сохранить блокировку.'
  } finally {
    submitting.value = false
  }
}

async function removeBlock() {
  if (submitting.value) return
  errorMessage.value = ''
  notifyWarning.value = false
  submitting.value = true
  try {
    await crmStore.unblockCustomerDiscount(props.customerId)
    emit('changed')
    emit('close')
  } catch (error: any) {
    errorMessage.value = error?.message || 'Не удалось снять блокировку.'
  } finally {
    submitting.value = false
  }
}

async function saveTemplate() {
  if (savingTemplate.value || !templateValid.value) return
  templateError.value = ''
  templateSaved.value = false
  savingTemplate.value = true
  try {
    const saved = await crmStore.saveDiscountBlockTemplate(formTemplate.value.trim())
    initialTemplate.value = saved
    templateSaved.value = true
  } catch (error: any) {
    templateError.value = error?.message || 'Не удалось сохранить шаблон.'
  } finally {
    savingTemplate.value = false
  }
}

function handleClose() {
  if (submitting.value) return
  emit('close')
}
</script>

<style scoped>
.discount-block__status {
  border-color: #f4e2c7;
  background: #fff8ed;
}
.discount-block__status-date {
  margin: 4px 0 0;
  color: #7d5d36;
  font-size: 15px;
  font-weight: 700;
}
.discount-block__status .crm-restriction-hint {
  color: #8a6d3b;
}
.discount-block__save-template {
  min-height: 40px;
  padding: 9px 14px;
  font-size: 12px;
}
.crm-restriction-hint code {
  padding: 1px 5px;
  border-radius: 5px;
  background: #edf3fb;
  color: #1759ed;
  font-family: inherit;
  font-size: 11px;
  font-weight: 700;
}
</style>
