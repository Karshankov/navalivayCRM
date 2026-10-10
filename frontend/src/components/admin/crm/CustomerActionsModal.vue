<template>
  <TransitionRoot :show="isOpen" as="template" @after-leave="finishLeave">
    <Dialog :initial-focus="closeButton" class="customer-actions-dialog" @close="emit('close')">
      <TransitionChild as="template" enter="customer-actions-fade" enter-from="customer-actions-hidden" enter-to="customer-actions-visible" leave="customer-actions-fade" leave-from="customer-actions-visible" leave-to="customer-actions-hidden">
        <div class="customer-actions-backdrop" aria-hidden="true" />
      </TransitionChild>
      <div class="customer-actions-viewport">
        <TransitionChild as="template" enter="customer-actions-enter" enter-from="customer-actions-panel-hidden" enter-to="customer-actions-panel-visible" leave="customer-actions-fade" leave-from="customer-actions-visible" leave-to="customer-actions-hidden">
          <DialogPanel class="customer-actions-panel">
            <header class="customer-actions-header">
              <div class="customer-actions-avatar" aria-hidden="true">{{ initial }}</div>
              <div class="customer-actions-identity">
                <DialogTitle class="customer-actions-title">Действия с клиентом</DialogTitle>
                <div class="customer-actions-name-row">
                  <p class="customer-actions-name">{{ order?.customer_name || 'Без имени' }}</p>
                  <span v-if="order?.is_returning_customer && !order?.is_blocked" class="customer-actions-returning" data-test="customer-returning">Постоянный</span>
                </div>
                <p class="customer-actions-username">{{ username ? `@${username}` : 'Telegram username не указан' }}</p>
                <p v-if="order?.customer_telegram_id" class="customer-actions-id" data-test="customer-telegram-id">Telegram ID: {{ order.customer_telegram_id }}</p>
              </div>
              <button ref="closeButton" type="button" class="customer-actions-close" aria-label="Закрыть действия с клиентом" @click="emit('close')">
                <XMarkIcon aria-hidden="true" />
              </button>
            </header>
            <DialogDescription class="customer-actions-description">Все действия выполняются с этим клиентом</DialogDescription>
            <div class="customer-actions-list">
              <button type="button" class="customer-actions-item customer-actions-item--danger" :disabled="!canTarget || Boolean(order?.is_blocked) || busy" @click="emit('action', 'block')">
                <NoSymbolIcon aria-hidden="true" />
                <span>{{ order?.is_blocked ? 'Клиент уже заблокирован' : 'Заблокировать клиента' }}</span>
                <ChevronRightIcon aria-hidden="true" class="customer-actions-arrow" />
              </button>
              <button type="button" class="customer-actions-item" :disabled="!order?.customer_id || busy" @click="emit('action', 'note')">
                <PencilSquareIcon aria-hidden="true" />
                <span>Сделать заметку</span>
                <ChevronRightIcon aria-hidden="true" class="customer-actions-arrow" />
              </button>
              <button type="button" class="customer-actions-item" :disabled="!canTarget || busy" @click="emit('action', 'invite-ban')">
                <UserMinusIcon aria-hidden="true" />
                <span>Запретить приглашать</span>
                <ChevronRightIcon aria-hidden="true" class="customer-actions-arrow" />
              </button>
              <button type="button" class="customer-actions-item customer-actions-item--primary" :disabled="!canContact || busy" @click="emit('action', 'contact')">
                <ChatBubbleLeftRightIcon aria-hidden="true" />
                <span>{{ busy ? 'Подготавливаем сообщение…' : 'Написать клиенту' }}</span>
                <ChevronRightIcon aria-hidden="true" class="customer-actions-arrow" />
              </button>
            </div>
            <section v-if="inviterUsername" class="customer-actions-referral" data-test="customer-inviter" aria-label="Пригласивший клиента">
              <div class="customer-actions-referral-heading">
                <span class="customer-actions-referral-icon" aria-hidden="true"><UserGroupIcon /></span>
                <div class="customer-actions-referral-identity">
                  <p class="customer-actions-referral-label">Пригласивший</p>
                  <p v-if="inviterName" class="customer-actions-referral-name">{{ inviterName }}</p>
                  <p class="customer-actions-referral-username">@{{ inviterUsername }}</p>
                </div>
                <button type="button" class="customer-actions-referral-toggle" :aria-expanded="inviterExpanded" :aria-controls="`customer-inviter-actions-${order?.id}`" :disabled="busy" @click="inviterExpanded = !inviterExpanded" aria-label="Действия с пригласившим">
                  <ChevronDownIcon aria-hidden="true" :class="{ 'is-expanded': inviterExpanded }" />
                </button>
              </div>
              <div v-if="inviterExpanded" :id="`customer-inviter-actions-${order?.id}`" class="customer-actions-referral-options">
                <p class="customer-actions-referral-hint">Эти действия относятся к пригласившему, не к клиенту заказа.</p>
                <button type="button" :disabled="busy" @click="emit('inviter-action', 'copy')">Скопировать username</button>
                <button type="button" :disabled="busy || !order?.referral?.inviter_customer_id" @click="emit('inviter-action', 'message')">Написать пригласившему</button>
                <button type="button" class="customer-actions-referral-danger" :disabled="busy" @click="emit('inviter-action', 'block')">Заблокировать пригласившего</button>
                <button v-if="!order?.referral?.inviter_is_invite_banned" type="button" class="customer-actions-referral-danger" :disabled="busy" @click="emit('inviter-action', 'invite-ban')">Запретить пригласившему приглашать</button>
                <button v-else type="button" :disabled="busy || !order?.referral?.inviter_invite_ban_id" @click="emit('inviter-action', 'remove-ban')">Разрешить пригласившему приглашать</button>
              </div>
            </section>
            <p v-if="!order" class="customer-actions-unavailable" role="status">Заказ больше не отображается на доске. Закройте окно и обновите список.</p>
            <p v-else-if="!canTarget && !canContact" class="customer-actions-unavailable">У этого заказа нет данных клиента для выполнения действий.</p>
          </DialogPanel>
        </TransitionChild>
      </div>
    </Dialog>
  </TransitionRoot>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { Dialog, DialogPanel, DialogTitle, DialogDescription, TransitionRoot, TransitionChild } from '@headlessui/vue';
import { XMarkIcon, NoSymbolIcon, UserMinusIcon, PencilSquareIcon, ChatBubbleLeftRightIcon, ChevronRightIcon, ChevronDownIcon, UserGroupIcon } from '@heroicons/vue/24/outline';
import type { Order } from '@/stores/crm';

export type CustomerAction = 'block' | 'invite-ban' | 'note' | 'contact';
export type InviterAction = 'copy' | 'message' | 'block' | 'invite-ban' | 'remove-ban';
const props = defineProps<{ isOpen: boolean; order: Order | null; busy: boolean }>();
const emit = defineEmits<{ close: []; action: [action: CustomerAction]; 'inviter-action': [action: InviterAction]; 'after-leave': [] }>();
const closeButton = ref<HTMLButtonElement | null>(null);
const inviterExpanded = ref(false);
watch(() => [props.isOpen, props.order?.id, props.order?.referral?.inviter_customer_id, props.order?.referral?.inviter_username], () => { inviterExpanded.value = false; });
const inviterUsername = computed(() => (props.order?.referral?.inviter_username || '').replace(/^@+/, ''));
const inviterName = computed(() => [props.order?.referral?.inviter_first_name, props.order?.referral?.inviter_last_name].filter(Boolean).join(' '));
let returnFocusTarget: HTMLElement | null = null;
watch(() => props.isOpen, (open) => {
  if (open && typeof document !== 'undefined') {
    returnFocusTarget = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  }
}, { flush: 'sync' });

async function finishLeave() {
  await nextTick();
  if (props.isOpen) return;
  const target = returnFocusTarget;
  returnFocusTarget = null;
  if (target?.isConnected) target.focus({ preventScroll: true });
  emit('after-leave');
}
const username = computed(() => (props.order?.telegram_username || '').replace(/^@+/, ''));
const initial = computed(() => Array.from(props.order?.customer_name || username.value || '?')[0]?.toUpperCase() || '?');
const canTarget = computed(() => Boolean(props.order?.customer_id || username.value));
const canContact = computed(() => Boolean(username.value || props.order?.customer_telegram_id));
</script>

<style scoped>
:global(.customer-actions-dialog) { position: fixed; inset: 0; z-index: 9999; color: #081b4b; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; }
.customer-actions-backdrop { position: fixed; inset: 0; background: rgb(0 0 0 / 62%); backdrop-filter: blur(11px); -webkit-backdrop-filter: blur(11px); }
.customer-actions-viewport { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; padding: 16px; }
.customer-actions-panel { width: 405px; max-width: 100%; max-height: calc(100dvh - 32px); overflow-y: auto; border-radius: 20px; background: #fff; padding: 23px; box-shadow: 0 24px 70px #03071160; }
.customer-actions-header { display: flex; align-items: flex-start; gap: 13px; }
.customer-actions-avatar { display: grid; place-items: center; width: 46px; height: 46px; flex-shrink: 0; border-radius: 50%; background: #eaf1ff; color: #1146d1; font-size: 19px; font-weight: 800; }
.customer-actions-identity { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.customer-actions-title { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.customer-actions-name { margin: 0; font-size: 17px; font-weight: 700; line-height: 1.3; text-transform: uppercase; }
.customer-actions-username { margin: 4px 0 0; color: #8b9fca; font-size: 13.333333px; }
.customer-actions-name-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; }
.customer-actions-returning { display: inline-flex; align-items: center; padding: 4px 8px; border-radius: 999px; background: #eaf8f0; color: #20704a; font-size: 10px; font-weight: 700; line-height: 1.2; }
.customer-actions-id { margin: 5px 0 0; color: #7f8cab; font-size: 10px; line-height: 1.4; font-variant-numeric: tabular-nums; }
.customer-actions-referral { margin-top: 18px; padding: 12px; border: 1px solid #e5edf9; border-radius: 13px; background: #f7faff; }
.customer-actions-referral-heading { display: flex; align-items: center; gap: 10px; }
.customer-actions-referral-icon { display: grid; place-items: center; width: 34px; height: 34px; flex-shrink: 0; border-radius: 10px; background: #eaf1ff; color: #1759ed; }
.customer-actions-referral-icon svg { width: 18px; height: 18px; }
.customer-actions-referral-identity { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.customer-actions-referral-label { margin: 0 0 3px; color: #7f8cab; font-size: 10px; font-weight: 600; }
.customer-actions-referral-name { margin: 0 0 2px; font-size: 12px; font-weight: 700; }
.customer-actions-referral-username { margin: 0; color: #1759ed; font-size: 12px; font-weight: 600; }
.customer-actions-referral-toggle { display: grid; place-items: center; width: 36px; height: 36px; flex-shrink: 0; border: 1px solid #dce8fa; border-radius: 10px; background: white; color: #425778; cursor: pointer; }
.customer-actions-referral-toggle svg { width: 16px; height: 16px; }
.customer-actions-referral-toggle .is-expanded { transform: rotate(180deg); }
.customer-actions-referral-options { display: grid; gap: 4px; margin-top: 12px; padding-top: 10px; border-top: 1px solid #e5edf9; }
.customer-actions-referral-hint { margin: 0 0 6px; color: #60708e; font-size: 10px; line-height: 1.5; }
.customer-actions-referral-options button { min-height: 36px; padding: 8px; border: 0; border-radius: 8px; background: transparent; color: #233e70; font-size: 11px; font-weight: 600; line-height: 1.4; text-align: left; overflow-wrap: anywhere; cursor: pointer; }
.customer-actions-referral-options button:hover { background: #eaf1ff; }
.customer-actions-referral-options .customer-actions-referral-danger { color: #d92342; }
.customer-actions-referral button:focus-visible { outline: 2px solid #1759ed; outline-offset: 2px; }
.customer-actions-referral button:disabled { opacity: .55; cursor: not-allowed; }
.customer-actions-close { display: grid; place-items: center; flex-shrink: 0; width: 36px; height: 36px; border: 0; border-radius: 8px; background: transparent; color: #1b2b55; cursor: pointer; }
.customer-actions-close svg { width: 26px; height: 26px; }
.customer-actions-close:hover { background: #f0f4fa; }
.customer-actions-description { margin: 19px 0; color: #7f8cab; font-size: 12px; line-height: normal; }
.customer-actions-list { display: grid; gap: 9px; }
.customer-actions-item { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 50px; padding: 15px; border: 1px solid #eaf0f9; border-radius: 12px; background: #fff; color: #102456; font-size: 13px; font-weight: 700; line-height: normal; text-align: left; cursor: pointer; transition: background-color 140ms ease-out, border-color 140ms ease-out; }
.customer-actions-item svg { width: 19px; height: 19px; flex-shrink: 0; }
.customer-actions-item span { min-width: 0; overflow-wrap: anywhere; }
.customer-actions-item .customer-actions-arrow { width: 16px; height: 16px; margin-left: auto; }
.customer-actions-item:hover { background: #f7faff; border-color: #b8cef5; }
.customer-actions-item--danger { background: #fff1f3; border-color: #ffebef; color: #d92342; }
.customer-actions-item--danger:hover { background: #ffe7ec; border-color: #f6c4ce; }
.customer-actions-item--primary { background: #edf5ff; border-color: #e5efff; color: #1555e8; }
.customer-actions-item--primary:hover { background: #e0edff; border-color: #b8cef5; }
.customer-actions-item:disabled { opacity: .55; cursor: not-allowed; }
.customer-actions-close:focus-visible, .customer-actions-item:focus-visible { outline: 2px solid #1759ed; outline-offset: 3px; }
.customer-actions-unavailable { margin: 14px 0 0; color: #60708e; font-size: 12px; line-height: 1.5; }
.customer-actions-panel ::selection { background: #d9ecff; color: #081b4b; }
.customer-actions-panel { scrollbar-color: #8999b7 #f0f4fa; scrollbar-width: thin; }
.customer-actions-fade { transition: opacity 120ms ease-out; }
.customer-actions-enter { transition: opacity 180ms cubic-bezier(.16,1,.3,1), transform 180ms cubic-bezier(.16,1,.3,1); }
.customer-actions-hidden, .customer-actions-panel-hidden { opacity: 0; }
.customer-actions-panel-hidden { transform: translateY(6px) scale(.98); }
.customer-actions-visible, .customer-actions-panel-visible { opacity: 1; transform: none; }
@media (max-width: 360px) { .customer-actions-panel { padding: 18px; } .customer-actions-avatar { width: 38px; height: 38px; } }
@media (prefers-reduced-motion: reduce) { .customer-actions-fade, .customer-actions-enter, .customer-actions-item { transition: none; } }
</style>
