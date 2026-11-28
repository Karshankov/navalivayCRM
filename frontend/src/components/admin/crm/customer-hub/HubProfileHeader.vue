<template>
  <!-- Заголовок окна: кто это и какой у него доступ. Встаёт в слот title у AdminModal. -->
  <div class="crm-hub-title" data-test="customer-hub-customer">
    <span class="crm-hub-avatar" aria-hidden="true">{{ initials }}</span>
    <div class="crm-hub-title-main">
      <div class="crm-hub-title-row">
        <span class="crm-hub-title-name" data-test="customer-hub-name">{{ name || (hub.ghost ? 'Нет в базе' : 'Клиент') }}</span>
        <span
          v-if="status"
          class="crm-hub-plate"
          :class="status.tone === 'neutral' ? '' : `crm-hub-plate--${status.tone}`"
          data-test="customer-hub-access-status"
        >{{ status.label }}</span>
      </div>
      <div class="crm-hub-customer-meta">
        <span v-if="username" data-test="customer-hub-username">@{{ username }}</span>
        <button
          v-if="telegramId"
          type="button"
          class="crm-hub-copy"
          :aria-label="`Скопировать Telegram ID ${telegramId}`"
          data-test="customer-hub-copy-tg-id"
          @click="copyTelegramId"
        >{{ copyState === 'done' ? 'Скопировано' : copyState === 'failed' ? 'Не удалось скопировать' : `TG ID ${telegramId}` }}</button>
        <!-- Бейджи только для отклонений от нормы: обычное состояние не подсвечиваем. -->
        <span
          v-if="hub.invite_ban || hub.pending_invite_ban"
          class="crm-hub-plate crm-hub-plate--danger"
          data-test="customer-hub-invite-ban-badge"
        >{{ hub.pending_invite_ban && !hub.invite_ban ? 'Запрет приглашать ожидает' : 'Приглашения запрещены' }}</span>
        <span v-if="hub.authorization?.is_reserved_inviter" class="crm-hub-plate">Наш аккаунт</span>
        <span v-if="hub.customer && hub.customer.wholesale_min_override !== null" class="crm-hub-plate">
          Опт-минимум: {{ hub.customer.wholesale_min_override }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { CustomerHubData } from '@/utils/crmCustomerHubApi'
import { copyText } from '@/utils/copyText'
import { hubHeaderStatus } from './hubFormat'

const props = defineProps<{ hub: CustomerHubData }>()

const name = computed(() =>
  [props.hub.customer?.first_name, props.hub.customer?.last_name].filter(Boolean).join(' '),
)
const username = computed(() => props.hub.customer?.telegram_username || props.hub.username || '')
const telegramId = computed(() => props.hub.customer?.telegram_id || props.hub.telegram_id || '')
const status = computed(() => hubHeaderStatus(props.hub))
const initials = computed(() => {
  const source = name.value || username.value
  const parts = source.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase()
})

/** Короткое подтверждение копирования прямо на месте TG ID. */
const copyState = ref<'idle' | 'done' | 'failed'>('idle')
let copyTimer: ReturnType<typeof setTimeout> | undefined
async function copyTelegramId() {
  if (!telegramId.value) return
  copyState.value = (await copyText(String(telegramId.value))) ? 'done' : 'failed'
  clearTimeout(copyTimer)
  copyTimer = setTimeout(() => { copyState.value = 'idle' }, 1500)
}
watch(telegramId, () => { copyState.value = 'idle' })
onBeforeUnmount(() => clearTimeout(copyTimer))
</script>
