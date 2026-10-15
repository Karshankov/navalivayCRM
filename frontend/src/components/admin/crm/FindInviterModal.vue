<template>
  <TransitionRoot :show="isOpen" as="template" @after-leave="finishLeave">
    <Dialog :initial-focus="inputRef" class="find-inviter-dialog" @close="emit('close')">
      <TransitionChild as="template" enter="find-inviter-fade" enter-from="find-inviter-hidden" enter-to="find-inviter-visible" leave="find-inviter-fade" leave-from="find-inviter-visible" leave-to="find-inviter-hidden">
        <div class="find-inviter-backdrop" aria-hidden="true" />
      </TransitionChild>
      <div class="find-inviter-viewport">
        <TransitionChild as="template" enter="find-inviter-enter" enter-from="find-inviter-panel-hidden" enter-to="find-inviter-visible" leave="find-inviter-fade" leave-from="find-inviter-visible" leave-to="find-inviter-hidden">
          <DialogPanel class="find-inviter-panel">
            <header class="find-inviter-header">
              <span class="find-inviter-symbol" aria-hidden="true"><UserGroupIcon /></span>
              <DialogTitle>Найти пригласившего</DialogTitle>
              <button type="button" class="find-inviter-close" aria-label="Закрыть поиск пригласившего" @click="emit('close')"><XMarkIcon aria-hidden="true" /></button>
            </header>
            <DialogDescription class="find-inviter-description">Введите username клиента, чтобы узнать, кто его пригласил.</DialogDescription>
            <form novalidate @submit.prevent="search">
              <label :for="inputId">Username клиента</label>
              <div class="find-inviter-search">
                <input :id="inputId" ref="inputRef" v-model="query" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="@username" :aria-invalid="!!validation" :aria-describedby="`${inputId}-hint`" data-test="inviter-lookup-input" @input="invalidate" />
                <button type="submit" :disabled="loading || busy || !normalizedQuery" data-test="inviter-lookup-submit"><MagnifyingGlassIcon aria-hidden="true" />{{ loading ? 'Ищем…' : 'Найти' }}</button>
              </div>
              <p :id="`${inputId}-hint`" class="find-inviter-hint">{{ validation || 'Можно вводить с @ или без него.' }}</p>
            </form>
            <div class="find-inviter-result" aria-live="polite" :aria-busy="loading">
              <p v-if="loading" role="status" class="find-inviter-state">Ищем пригласившего…</p>
              <div v-else-if="error" class="find-inviter-error" role="alert"><p>{{ error }}</p><button type="button" @click="search" :disabled="busy">Повторить</button></div>
              <template v-else-if="result">
                <p class="find-inviter-searched" v-if="result.customer">Клиент: @{{ result.customer.telegram_username?.replace(/^@+/, '') || searchedUsername }}</p>
                <section v-if="foundReferral" aria-label="Найденный пригласивший" data-test="inviter-lookup-result">
                  <div class="find-inviter-identity"><span class="find-inviter-symbol" aria-hidden="true"><UserGroupIcon /></span><div><h3>Пригласивший</h3><p v-if="inviterName" class="find-inviter-name">{{ inviterName }}</p><p class="find-inviter-username">{{ foundReferral.inviter_username ? `@${foundReferral.inviter_username.replace(/^@+/, '')}` : 'Username не указан' }}</p></div></div>
                  <p class="find-inviter-hint">Действия ниже относятся к пригласившему.</p>
                  <div class="find-inviter-actions">
                    <button type="button" :disabled="busy || !foundReferral.inviter_username" @click="choose('copy')"><ClipboardDocumentIcon aria-hidden="true" />Скопировать username</button>
                    <button type="button" :disabled="busy || !foundReferral.inviter_customer_id" @click="choose('message')"><ChatBubbleLeftRightIcon aria-hidden="true" />Написать пригласившему</button>
                    <button type="button" class="find-inviter-danger" :disabled="busy" @click="choose('block')"><NoSymbolIcon aria-hidden="true" />Заблокировать пригласившего</button>
                    <button v-if="!foundReferral.inviter_is_invite_banned" type="button" class="find-inviter-danger" :disabled="busy" @click="choose('invite-ban')"><UserMinusIcon aria-hidden="true" />Запретить пригласившему приглашать</button>
                    <button v-else type="button" :disabled="busy || !foundReferral.inviter_invite_ban_id" @click="choose('remove-ban')"><UserGroupIcon aria-hidden="true" />Разрешить пригласившему приглашать</button>
                  </div>
                </section>
                <p v-else role="status" class="find-inviter-state" data-test="inviter-lookup-empty">Пригласивший не найден</p>
              </template>
            </div>
          </DialogPanel>
        </TransitionChild>
      </div>
    </Dialog>
  </TransitionRoot>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import { Dialog, DialogPanel, DialogTitle, DialogDescription, TransitionRoot, TransitionChild } from '@headlessui/vue';
import { UserGroupIcon, XMarkIcon, MagnifyingGlassIcon, ClipboardDocumentIcon, ChatBubbleLeftRightIcon, NoSymbolIcon, UserMinusIcon } from '@heroicons/vue/24/outline';
// Общий тип действий с пригласившим (раньше жил в CustomerActionsModal,
// теперь единственный источник — здесь, хаб клиента и CrmOrders импортируют его).
export type InviterAction = 'copy' | 'message' | 'block' | 'invite-ban' | 'remove-ban';
import { lookupCrmInviter, normalizeInviterLookupUsername, type InviterLookupResult } from '@/utils/crmInviterLookup';
const props = defineProps<{ isOpen: boolean; busy: boolean; prefill?: { username?: string | null } | null }>();
const emit = defineEmits<{ close: []; action: [action: InviterAction, result: InviterLookupResult]; 'after-leave': [] }>();
const inputId = `find-inviter-${useId()}`;
const inputRef = ref<HTMLInputElement | null>(null);
const query = ref('');
const loading = ref(false);
const validation = ref('');
const error = ref('');
const result = ref<InviterLookupResult | null>(null);
const searchedUsername = ref('');
const normalizedQuery = computed(() => normalizeInviterLookupUsername(query.value));
const foundReferral = computed(() => result.value?.referral && (result.value.referral.inviter_customer_id || result.value.referral.inviter_username) ? result.value.referral : null);
const inviterName = computed(() => [foundReferral.value?.inviter_first_name, foundReferral.value?.inviter_last_name].filter(Boolean).join(' '));
let requestNumber = 0;
let controller: AbortController | null = null;
let returnFocusTarget: HTMLElement | null = null;
function invalidate() {
  requestNumber += 1;
  controller?.abort();
  controller = null;
  loading.value = false;
  result.value = null;
  error.value = '';
  validation.value = '';
}
watch(() => props.isOpen, (open) => {
  invalidate();
  if (open) {
    // Из хаба клиента приходит предзаполнение — сразу ищем его пригласившего.
    query.value = props.prefill?.username?.replace(/^@+/, '') || '';
    searchedUsername.value = '';
    returnFocusTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (query.value) void search();
  }
}, { flush: 'sync', immediate: true });
onBeforeUnmount(invalidate);
async function search() {
  if (!props.isOpen || loading.value || props.busy) return;
  const username = normalizedQuery.value;
  invalidate();
  if (!/^[a-zA-Z0-9_]{1,32}$/.test(username)) {
    validation.value = 'Укажите username: латинские буквы, цифры и _, до 32 символов.';
    inputRef.value?.focus();
    return;
  }
  const current = ++requestNumber;
  controller = new AbortController();
  loading.value = true;
  try {
    const data = await lookupCrmInviter(username, controller.signal);
    if (current !== requestNumber || !props.isOpen) return;
    searchedUsername.value = username;
    result.value = data;
  } catch (cause) {
    if (current === requestNumber && props.isOpen) error.value = cause instanceof Error ? cause.message : 'Не удалось найти пригласившего. Повторите попытку.';
  } finally {
    if (current === requestNumber) { loading.value = false; controller = null; }
  }
}
function choose(action: InviterAction) {
  const referral = foundReferral.value;
  if (!props.isOpen || loading.value || props.busy || !result.value || !referral) return;
  if (action === 'copy' && !referral.inviter_username) return;
  if (action === 'message' && !referral.inviter_customer_id) return;
  if (action === 'remove-ban' && (!referral.inviter_is_invite_banned || !referral.inviter_invite_ban_id)) return;
  if (action === 'invite-ban' && referral.inviter_is_invite_banned) return;
  emit('action', action, result.value);
}
async function finishLeave() {
  await nextTick();
  if (props.isOpen) return;
  if (returnFocusTarget?.isConnected) returnFocusTarget.focus({ preventScroll: true });
  returnFocusTarget = null;
  emit('after-leave');
}
</script>

<style scoped>
:global(.find-inviter-dialog) { position: fixed; inset: 0; z-index: 9999; color: #081b4b; font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; }
.find-inviter-backdrop { position: fixed; inset: 0; background: rgb(0 0 0 / 62%); backdrop-filter: blur(11px); }
.find-inviter-viewport { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; padding: 16px; }
.find-inviter-panel { width: 460px; max-width: 100%; max-height: calc(100dvh - 32px); overflow-y: auto; padding: 24px; border-radius: 20px; background: white; box-shadow: 0 24px 70px #03071160; scrollbar-color: #8999b7 #f0f4fa; scrollbar-width: thin; }
.find-inviter-header { display: flex; gap: 12px; align-items: center; }
.find-inviter-header h2 { flex: 1; min-width: 0; font-size: 18px; font-weight: 750; line-height: 1.3; }
.find-inviter-symbol { width: 40px; height: 40px; display: grid; place-items: center; flex-shrink: 0; border-radius: 12px; background: #eaf1ff; color: #1759ed; }
.find-inviter-symbol svg { width: 22px; height: 22px; }
.find-inviter-close { display: grid; place-items: center; width: 44px; height: 44px; flex-shrink: 0; border: 0; border-radius: 10px; background: transparent; color: #425778; }
.find-inviter-close svg { width: 24px; height: 24px; }
.find-inviter-description { margin: 16px 0 20px; font-size: 13px; line-height: 1.6; color: #536480; }
.find-inviter-panel label { display: block; margin-bottom: 9px; font-size: 13px; font-weight: 700; }
.find-inviter-search { display: flex; gap: 10px; }
.find-inviter-search input { min-width: 0; flex: 1; width: 100%; min-height: 46px; padding: 11px 13px; border: 1px solid #b8c9e3; border-radius: 12px; font: inherit; font-size: 16px; color: #081b4b; background: #fff; }
.find-inviter-search input::placeholder { color: #60708b; }
.find-inviter-search button { display: flex; align-items: center; justify-content: center; gap: 7px; min-height: 46px; padding: 11px 16px; border: 0; border-radius: 12px; background: #1759ed; color: white; font-size: 13px; font-weight: 700; }
.find-inviter-search button svg { width: 18px; height: 18px; }
.find-inviter-hint, .find-inviter-searched { margin: 9px 0; color: #536480; font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.find-inviter-result { margin-top: 18px; }
.find-inviter-identity { display: flex; align-items: center; gap: 12px; margin: 18px 0 12px; }
.find-inviter-identity > div { min-width: 0; overflow-wrap: anywhere; }
.find-inviter-identity h3 { margin: 0 0 4px; font-size: 15px; font-weight: 750; }
.find-inviter-name { margin: 0 0 4px; font-size: 14px; }
.find-inviter-username { margin: 0; color: #1759ed; font-size: 14px; font-weight: 650; }
.find-inviter-actions { display: grid; gap: 7px; }
.find-inviter-actions button { display: flex; align-items: center; gap: 10px; min-height: 46px; padding: 12px; border: 1px solid #e1e9f6; border-radius: 12px; background: #fff; color: #233e70; font-size: 13px; font-weight: 600; text-align: left; line-height: 1.4; overflow-wrap: anywhere; }
.find-inviter-actions button svg { width: 19px; height: 19px; flex-shrink: 0; }
.find-inviter-actions .find-inviter-danger { color: #b92340; }
.find-inviter-actions button:hover, .find-inviter-close:hover { background: #f0f5ff; }
.find-inviter-search button:hover { background: #1248c2; }
.find-inviter-state { margin: 0; padding: 18px 0; color: #536480; font-size: 14px; }
.find-inviter-error { color: #b92340; font-size: 13px; line-height: 1.5; }
.find-inviter-error button { min-height: 44px; background: transparent; border: 0; color: inherit; font-weight: 700; text-decoration: underline; }
.find-inviter-panel button { cursor: pointer; font-family: inherit; transition: background-color 140ms ease-out; }
.find-inviter-panel button:disabled { opacity: .55; cursor: not-allowed; }
.find-inviter-panel button:focus-visible, .find-inviter-panel input:focus-visible { outline: 2px solid #1759ed; outline-offset: 3px; }
.find-inviter-panel ::selection { background: #d9ecff; color: #081b4b; }
.find-inviter-fade { transition: opacity 120ms ease-out; }
.find-inviter-enter { transition: opacity 180ms cubic-bezier(.16,1,.3,1), transform 180ms cubic-bezier(.16,1,.3,1); }
.find-inviter-hidden, .find-inviter-panel-hidden { opacity: 0; }
.find-inviter-panel-hidden { transform: translateY(6px) scale(.98); }
.find-inviter-visible { opacity: 1; transform: none; }
@media (max-width: 380px) { .find-inviter-panel { padding: 18px; } .find-inviter-search { flex-direction: column; } .find-inviter-header { gap: 8px; } .find-inviter-symbol { width: 34px; height: 34px; } }
@media (prefers-reduced-motion: reduce) { .find-inviter-fade, .find-inviter-enter, .find-inviter-panel button { transition: none; } }
</style>
