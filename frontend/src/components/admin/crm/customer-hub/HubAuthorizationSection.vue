<template>
  <section class="crm-hub-subsection" data-test="customer-hub-auth-section">
    <!-- Главное действие видно сразу; технические подробности — в раскрываемом разделе. -->
    <div v-if="confirm" class="crm-hub-confirm" role="group" :aria-label="confirm.label" data-test="customer-hub-auth-confirm">
      <p>{{ confirm.text }}</p>
      <div class="crm-hub-inline-row">
        <button
          type="button"
          class="crm-hub-btn crm-hub-btn--primary"
          :disabled="disabled"
          data-test="customer-hub-auth-confirm-yes"
          @click="runConfirmed"
        >{{ busy ? 'Сохраняем…' : confirm.yes }}</button>
        <button type="button" class="crm-hub-btn" :disabled="busy" @click="confirming = null">Отмена</button>
      </div>
    </div>
    <div v-else-if="canGrant" class="crm-hub-stack">
      <button
        type="button"
        class="crm-hub-btn crm-hub-btn--primary"
        :disabled="disabled || !username && !hub.customer"
        data-test="customer-hub-grant-access"
        @click="confirming = 'grant'"
      >Разрешить без пригласившего</button>
    </div>

    <details v-if="auth" class="crm-hub-details" data-test="customer-hub-auth-details">
      <summary>Подробнее об авторизации</summary>
      <div class="crm-hub-details-body">
        <p v-if="!auth.feature_enabled" class="crm-note-hint" data-test="customer-hub-auth-disabled">
          Авторизация сейчас выключена — настройки сработают после включения.
        </p>
        <div class="crm-hub-fact-list">
          <div class="crm-hub-fact">
            <span>Статус</span>
            <strong data-test="customer-hub-auth-status">{{ status?.label }}</strong>
          </div>
          <div v-if="auth.state" class="crm-hub-fact">
            <span>Попытки</span>
            <strong data-test="customer-hub-auth-attempts">{{ auth.state.attempts_used }}/{{ auth.state.max_attempts }}</strong>
          </div>
          <div v-if="auth.state?.last_error_code" class="crm-hub-fact">
            <span>Последняя ошибка</span>
            <strong>{{ authErrorText(auth.state.last_error_code) }}</strong>
          </div>
          <div v-if="sourceText" class="crm-hub-fact">
            <span>Источник доступа</span>
            <strong data-test="customer-hub-auth-source">{{ sourceText }}</strong>
          </div>
        </div>
        <div v-if="!confirm && (auth.staff_access.pending_id || auth.staff_access.active)" class="crm-hub-stack">
          <button
            v-if="auth.staff_access.pending_id"
            type="button"
            class="crm-hub-btn"
            :disabled="disabled"
            data-test="customer-hub-revoke-pending-access"
            @click="confirming = 'revoke-pending'"
          >Отменить отложенный доступ</button>
          <template v-if="auth.staff_access.active">
            <button
              type="button"
              class="crm-hub-btn"
              :disabled="disabled || auth.staff_access.permanent"
              data-test="customer-hub-revoke-access"
              @click="confirming = 'revoke'"
            >Отменить доступ</button>
            <p v-if="auth.staff_access.permanent" class="crm-note-hint" data-test="customer-hub-access-permanent">
              Доступ постоянный — есть выданный заказ.
            </p>
          </template>
        </div>
      </div>
    </details>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CustomerHubData } from '@/utils/crmCustomerHubApi'
import { authErrorText, formatHubDate, hubAuthStatus } from './hubFormat'

type ConfirmKind = 'grant' | 'revoke' | 'revoke-pending'

const props = defineProps<{ hub: CustomerHubData; busy: boolean; disabled: boolean }>()
const emit = defineEmits<{
  (e: 'grant'): void
  (e: 'revoke'): void
  (e: 'revoke-pending'): void
}>()

const confirming = ref<ConfirmKind | null>(null)
const auth = computed(() => props.hub.authorization)
const username = computed(() => props.hub.customer?.telegram_username || props.hub.username || '')

const canGrant = computed(() => {
  if (!auth.value) return false
  if (auth.value.staff_access.pending_id) return false
  return !auth.value.is_authorized
})

const status = computed(() => hubAuthStatus(props.hub))

const sourceText = computed(() => {
  const value = auth.value
  if (!value || !value.is_authorized) {
    return value?.staff_access.pending_id ? 'Отложенный доступ ждёт первого захода' : ''
  }
  const when = value.authorized_at ? ` · ${formatHubDate(value.authorized_at)}` : ''
  if (value.source === 'referral') {
    // Кто пригласил — уже в строке «Пригласил» выше, здесь не повторяем.
    return `По приглашению${when}`
  }
  if (value.source === 'staff') return `Выдан вручную${value.authorized_by ? ` (${value.authorized_by})` : ''}${when}`
  if (value.source === 'legacy') return 'Старый клиент'
  if (value.source === 'issued_order') return 'Есть выданный заказ'
  if (value.source === 'feature_disabled') return `Пока авторизация была выключена${when}`
  return ''
})

const confirm = computed(() => {
  switch (confirming.value) {
    case 'grant':
      return {
        label: 'Подтверждение доступа без пригласившего',
        yes: 'Да, разрешить',
        text: props.hub.ghost || !props.hub.customer
          ? 'Создадим отложенный доступ: он сработает, когда клиент впервые зайдёт. Обычные блокировки он не снимает.'
          : 'Клиент получит доступ без пригласившего. Обычные блокировки это не снимает.',
      }
    case 'revoke':
      return { label: 'Подтверждение отмены доступа', yes: 'Да, отменить', text: 'Отменить доступ? Клиенту снова придётся указать пригласившего.' }
    case 'revoke-pending':
      return { label: 'Подтверждение отмены отложенного доступа', yes: 'Да, отменить', text: 'Отменить отложенный доступ без пригласившего?' }
    default:
      return null
  }
})

function runConfirmed() {
  const kind = confirming.value
  if (kind === 'grant') emit('grant')
  else if (kind === 'revoke') emit('revoke')
  else if (kind === 'revoke-pending') emit('revoke-pending')
}

// После успешного действия данные перечитаны — подтверждение закрываем.
watch(() => props.hub, () => { confirming.value = null })
</script>
