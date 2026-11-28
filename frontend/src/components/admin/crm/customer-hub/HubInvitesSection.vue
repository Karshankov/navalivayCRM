<template>
  <section class="crm-hub-subsection" data-test="customer-hub-invites-section">
    <!-- Пригласивший — одной строкой: кто и когда, рядом действия. -->
    <div class="crm-hub-inviter-line">
      <p class="crm-hub-inviter-text" data-test="customer-hub-inviter-line">
        <template v-if="hub.inviter">
          <span class="crm-hub-inviter-label">Пригласил</span>
          <strong>{{ hub.inviter.username ? `@${hub.inviter.username}` : (inviterName || 'username не указан') }}</strong>
          <span v-if="invitedAt" class="crm-hub-inviter-date">· {{ invitedAt }}</span>
          <span v-if="hub.inviter.is_invite_banned" class="crm-hub-plate crm-hub-plate--danger">Приглашения запрещены</span>
        </template>
        <span v-else class="crm-note-hint">Пригласивший не указан</span>
      </p>
      <button
        type="button"
        class="crm-hub-btn"
        :disabled="disabled"
        data-test="customer-hub-inviter"
        @click="$emit('toggle-inviter')"
      >
        {{ hub.inviter ? (inviterExpanded ? 'Скрыть' : 'Действия') : 'Найти пригласившего' }}
      </button>
    </div>

    <div
      v-if="hub.inviter && inviterExpanded"
      class="crm-hub-inviter"
      data-test="customer-hub-inviter-panel"
    >
      <div class="crm-hub-inviter-identity">
        <div>
          <strong>{{ inviterName || 'Пригласивший' }}</strong>
          <span>@{{ hub.inviter.username || 'username не указан' }}</span>
        </div>
      </div>
      <p class="crm-note-hint">Действия ниже относятся к пригласившему, не к этому клиенту.</p>
      <div class="crm-hub-inviter-actions">
        <button type="button" :disabled="disabled || !hub.inviter?.username" @click="$emit('inviter-action', 'copy')">Скопировать username</button>
        <button type="button" :disabled="disabled || !hub.inviter?.customer_id" @click="$emit('inviter-action', 'message')">Написать</button>
        <button type="button" :disabled="disabled" @click="$emit('inviter-action', 'block')">Заблокировать</button>
        <button
          v-if="!hub.inviter?.is_invite_banned"
          type="button"
          class="crm-hub-inviter-danger"
          :disabled="disabled"
          @click="$emit('inviter-action', 'invite-ban')"
        >Запретить приглашать</button>
        <button
          v-else
          type="button"
          :disabled="disabled || !hub.inviter?.invite_ban_id"
          @click="$emit('inviter-action', 'remove-ban')"
        >Разрешить приглашать</button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CustomerHubData } from '@/utils/crmCustomerHubApi'
import type { HubInviterAction } from '../CustomerHubModal.vue'
import { formatHubDate } from './hubFormat'

const props = defineProps<{
  hub: CustomerHubData
  busy: boolean
  disabled: boolean
  inviterExpanded: boolean
}>()
defineEmits<{
  (e: 'inviter-action', action: HubInviterAction): void
  (e: 'toggle-inviter'): void
}>()

const inviterName = computed(() =>
  [props.hub.inviter?.first_name, props.hub.inviter?.last_name].filter(Boolean).join(' '),
)
const invitedAt = computed(() => formatHubDate(props.hub.inviter?.invited_at, false))

</script>
