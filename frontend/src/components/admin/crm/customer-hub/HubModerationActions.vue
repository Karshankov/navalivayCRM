<template>
  <!-- Модерация этого клиента: блокировка и запрет приглашать — в группе ограничений «Действий». -->
  <div v-if="confirming" class="crm-hub-confirm" role="group" :aria-label="confirming === 'unblock' ? 'Подтверждение снятия блокировки' : 'Отмена отложенного запрета'" :data-test="confirming === 'unblock' ? 'customer-hub-unblock-confirm' : 'customer-hub-pending-invite-ban-confirm-box'">
    <p>{{ confirming === 'unblock' ? unblockConfirmText : 'Отменить отложенный запрет приглашать?' }}</p>
    <div class="crm-hub-inline-row">
      <button
        v-if="confirming === 'unblock'"
        type="button"
        class="crm-hub-btn crm-hub-btn--primary"
        :disabled="disabled"
        data-test="customer-hub-unblock-confirm-yes"
        @click="$emit('unblock')"
      >{{ busy ? 'Снимаем…' : 'Да, снять' }}</button>
      <button
        v-else
        type="button"
        class="crm-hub-btn crm-hub-btn--primary"
        :disabled="disabled"
        data-test="customer-hub-pending-invite-ban-confirm"
        @click="$emit('remove-pending-invite-ban')"
      >{{ busy ? 'Отменяем…' : 'Да, отменить' }}</button>
      <button type="button" class="crm-hub-btn" :disabled="busy" @click="confirming = null">Нет</button>
    </div>
  </div>

  <template v-else>
    <button
      v-if="!hub.block"
      type="button"
      class="crm-hub-action crm-hub-action--danger"
      :disabled="disabled || !canBlock"
      :title="canBlock ? undefined : 'Блокировка доступна по @username'"
      data-test="customer-hub-block"
      @click="$emit('block')"
    >
      <span class="crm-hub-action-icon" aria-hidden="true"><NoSymbolIcon /></span>
      <span>Заблокировать</span>
    </button>
    <button
      v-else
      type="button"
      class="crm-hub-action"
      :disabled="disabled"
      data-test="customer-hub-unblock"
      @click="confirming = 'unblock'"
    >
      <span class="crm-hub-action-icon" aria-hidden="true"><LockOpenIcon /></span>
      <span>{{ hub.block.kind === 'pending' ? 'Отменить превентивный бан' : 'Разблокировать' }}</span>
    </button>
    <button
      v-if="hub.block?.kind === 'active'"
      type="button"
      class="crm-hub-action crm-hub-action--danger"
      :disabled="disabled"
      data-test="customer-hub-block"
      @click="$emit('block')"
    >
      <span class="crm-hub-action-icon" aria-hidden="true"><NoSymbolIcon /></span>
      <span>Изменить блокировку</span>
    </button>

    <button
      v-if="hub.pending_invite_ban"
      type="button"
      class="crm-hub-action"
      :disabled="disabled"
      data-test="customer-hub-pending-invite-ban"
      @click="confirming = 'pending-invite'"
    >
      <span class="crm-hub-action-icon" aria-hidden="true"><UserPlusIcon /></span>
      <span>Отменить отложенный запрет</span>
    </button>
    <button
      v-else-if="!hub.invite_ban"
      type="button"
      class="crm-hub-action crm-hub-action--soft-danger"
      :disabled="disabled || !canUseUsername"
      :title="canUseUsername ? undefined : 'Запрет доступен по @username'"
      data-test="customer-hub-invite-ban"
      @click="$emit('action', 'invite-ban')"
    >
      <span class="crm-hub-action-icon" aria-hidden="true"><UserMinusIcon /></span>
      <span>Запретить приглашать</span>
    </button>
    <button
      v-else
      type="button"
      class="crm-hub-action"
      :disabled="disabled"
      data-test="customer-hub-invite-unban"
      @click="$emit('action', 'remove-invite-ban')"
    >
      <span class="crm-hub-action-icon" aria-hidden="true"><UserPlusIcon /></span>
      <span>Разрешить приглашать</span>
    </button>
  </template>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { LockOpenIcon, NoSymbolIcon, UserMinusIcon, UserPlusIcon } from '@heroicons/vue/24/outline'
import type { CustomerHubData } from '@/utils/crmCustomerHubApi'
import type { CustomerHubAction } from '../CustomerHubModal.vue'
import { pluralRu } from './hubFormat'

const props = defineProps<{
  hub: CustomerHubData
  busy: boolean
  disabled: boolean
  canBlock: boolean
  canUseUsername: boolean
}>()
defineEmits<{
  (e: 'block'): void
  (e: 'unblock'): void
  (e: 'action', action: CustomerHubAction): void
  (e: 'remove-pending-invite-ban'): void
}>()

const confirming = ref<'unblock' | 'pending-invite' | null>(null)

const unblockConfirmText = computed(() => {
  const block = props.hub.block
  if (block?.kind === 'pending') return 'Отменить превентивный бан? Клиент не будет заблокирован при первом заходе.'
  if (block?.block_type === 'authorization_failed') {
    const attempts = props.hub.authorization?.state?.max_attempts || 3
    return `Снять блокировку? Клиент получит ${attempts} ${pluralRu(attempts, 'новую попытку', 'новые попытки', 'новых попыток')} авторизации.`
  }
  return 'Снять блокировку с клиента?'
})

// После успеха или смены клиента подтверждение сбрасывается.
watch(
  () => [props.hub.block?.id, props.hub.block?.kind, props.hub.pending_invite_ban?.id, props.hub.customer?.id],
  () => { confirming.value = null },
)
</script>
