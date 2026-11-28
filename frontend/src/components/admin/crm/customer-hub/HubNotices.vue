<template>
  <!-- Важные отметки о клиенте — над колонками, на всю ширину. -->
  <div v-if="hub.block || hub.invite_ban?.reason || hub.ghost" class="crm-hub-notices">
    <div v-if="hub.block" class="crm-hub-block-notice" data-test="customer-hub-block-notice">
      <strong>{{ blockStatusText(hub.block) }}</strong>
      <span v-if="hub.block.reason && hub.block.block_type !== 'authorization_failed'" data-test="customer-hub-block-reason">{{ hub.block.reason }}</span>
      <small>
        {{ hub.block.block_until ? `до ${formatHubDate(hub.block.block_until)}` : 'бессрочно' }}<template v-if="hub.block.blocked_by"> · поставил {{ hub.block.blocked_by }}</template>
      </small>
    </div>
    <p v-if="hub.invite_ban?.reason" class="crm-note-hint" data-test="customer-hub-invite-ban-reason">Причина запрета приглашать: {{ hub.invite_ban.reason }}</p>
    <p v-if="hub.ghost" class="crm-note-hint">Бан и доступ сработают, когда он появится в магазине.</p>
  </div>
</template>

<script setup lang="ts">
import type { CustomerHubData } from '@/utils/crmCustomerHubApi'
import { blockStatusText, formatHubDate } from './hubFormat'

defineProps<{ hub: CustomerHubData }>()
</script>
