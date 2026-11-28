<template>
  <AdminModal
    :is-open="isOpen"
    title="Клиент"
    size="xl"
    reference-design
    :show-actions="false"
    @close="handleClose"
    @cancel="handleClose"
  >
    <template #title>
      <HubProfileHeader v-if="hub && tab === 'client'" :hub="hub" />
      <template v-else>Клиент</template>
    </template>
    <div class="crm-customer-hub" :aria-busy="busy ? 'true' : undefined">
      <p class="crm-hub-sr-only" role="status" aria-live="polite">{{ srStatus }}</p>

      <div class="crm-hub-toolbar">
      <div class="crm-hub-segment" role="group" aria-label="Раздел">
        <button
          type="button"
          class="crm-hub-segment-btn"
          :class="{ 'is-active': tab === 'client' }"
          :aria-pressed="tab === 'client' ? 'true' : 'false'"
          data-test="customer-hub-tab-client"
          @click="tab = 'client'"
        >Клиент</button>
        <button
          type="button"
          class="crm-hub-segment-btn"
          :class="{ 'is-active': tab === 'lists' }"
          :aria-pressed="tab === 'lists' ? 'true' : 'false'"
          data-test="customer-hub-tab-lists"
          @click="tab = 'lists'"
        >Списки</button>
      </div>
      <button v-if="hub && tab === 'client'" type="button" class="crm-note-secondary" @click="resetToSearch">Другой клиент</button>
      </div>

      <div v-if="errorMessage" class="crm-note-error" role="alert">{{ errorMessage }}</div>

      <HubListsTab
        v-if="tab === 'lists'"
        :disabled="busy"
        @open-customer="openFromList"
        @notify="(payload) => emit('notify', payload)"
        @mutated="onListMutated"
      />

      <template v-else>
        <section v-if="!hub && searching" class="crm-hub-panel crm-hub-loading" aria-live="polite">
          <span class="crm-hub-section-title">Клиент</span>
          <p>Загружаем данные клиента…</p>
        </section>
        <section v-else-if="!hub" class="crm-hub-panel crm-hub-search">
          <label for="customer-hub-username" class="crm-hub-section-title">Найти клиента</label>
          <form class="crm-customer-settings-search" @submit.prevent="search">
            <div class="crm-note-username crm-customer-settings-field">
              <input
                id="customer-hub-username"
                ref="usernameInputRef"
                v-model.trim="formQuery"
                type="text"
                placeholder="@username или Telegram ID"
                autocomplete="off"
                autocapitalize="none"
                :spellcheck="false"
                aria-describedby="customer-hub-hint"
                required
              >
            </div>
            <button
              type="submit"
              class="crm-customer-settings-find"
              :disabled="searching"
              data-test="customer-hub-find"
            >{{ searching ? 'Ищем…' : 'Найти' }}</button>
          </form>
          <p id="customer-hub-hint" class="crm-note-hint">
            Подойдёт и тот, кто ещё не заказывал или не заходил в магазин.
          </p>
        </section>

        <HubNotices v-if="hub" :hub="hub" />
        <div v-if="hub" class="crm-hub-layout">
          <div class="crm-hub-col crm-hub-col--side">
          <!-- Действия: сначала повседневные, ниже отдельной группой — ограничения. -->
          <section class="crm-hub-panel" data-test="customer-hub-actions">
            <span class="crm-hub-head"><span class="crm-hub-head-icon" aria-hidden="true"><BoltIcon /></span><span class="crm-hub-section-title">Действия</span></span>
            <div class="crm-hub-actions">
              <template v-if="customer">
              <button
                type="button"
                class="crm-hub-action"
                :disabled="busy || !(customer.telegram_username || customer.telegram_id)"
                data-test="customer-hub-chat"
                @click="emitAction('chat')"
              >
                <span class="crm-hub-action-icon" aria-hidden="true"><PaperAirplaneIcon /></span>
                <span>Написать в Telegram</span>
              </button>
              <button type="button" class="crm-hub-action" :disabled="busy" data-test="customer-hub-note" @click="emitAction('note')">
                <span class="crm-hub-action-icon" aria-hidden="true"><PencilSquareIcon /></span>
                <span>{{ customer.notes ? 'Изменить заметку' : 'Добавить заметку' }}</span>
              </button>
              <button type="button" class="crm-hub-action" :disabled="busy" data-test="customer-hub-wholesale" @click="emitAction('wholesale')">
                <span class="crm-hub-action-icon" aria-hidden="true"><Cog6ToothIcon /></span>
                <span>Настройки опта</span>
              </button>
              <button
                v-if="hubOrderId"
                type="button"
                class="crm-hub-action"
                :disabled="busy || Boolean(generatingMessage)"
                data-test="customer-hub-contact"
                @click="emitAction('contact')"
              >
                <span class="crm-hub-action-icon" aria-hidden="true"><ChatBubbleLeftRightIcon /></span>
                <span>{{ generatingMessage ? 'Подготавливаем…' : 'Написать клиенту' }}</span>
              </button>
              <span class="crm-hub-actions-sep" aria-hidden="true" />
              </template>
              <HubModerationActions
                :hub="hub"
                :busy="busy"
                :disabled="busy"
                :can-block="Boolean(lookupUsername || customer?.id)"
                :can-use-username="Boolean(lookupUsername)"
                @block="emitAction('block')"
                @unblock="unblock"
                @action="emitAction"
                @remove-pending-invite-ban="removePendingInviteBan"
              />
              <button
                v-if="customer"
                type="button"
                class="crm-hub-action crm-hub-action--soft-danger"
                :disabled="busy"
                data-test="customer-hub-discount-block"
                @click="emitAction('discount-block')"
              >
                <span class="crm-hub-action-icon" aria-hidden="true"><LockClosedIcon /></span>
                <span>{{ customer.discount_block?.blocked ? `Скидки заморожены до ${discountBlockUntilLabel}` : 'Заморозить скидки' }}</span>
              </button>
            </div>
          </section>
          <!-- Виджет оплаты картой: нужен реальный клиент. -->
          <section v-if="customer" class="crm-hub-panel crm-hub-card" data-test="customer-hub-card">
            <div class="crm-hub-card-heading">
              <span class="crm-hub-head"><span class="crm-hub-head-icon" aria-hidden="true"><CreditCardIcon /></span><span class="crm-hub-section-title">Оплата картой</span></span>
              <span class="crm-hub-plate" :class="cardStatus.class" data-test="customer-hub-card-status">{{ cardStatus.label }}</span>
            </div>
            <!-- Клик по данным — к настройкам этого клиента в окне «Оплата картой и лимиты». -->
            <button
              type="button"
              class="crm-hub-card-details"
              :disabled="busy || !cardSettingsAccount"
              title="Открыть настройки оплаты картой для этого клиента"
              data-test="customer-hub-card-settings"
              @click="openCardSettings"
            >
              <template v-if="hub.card_profile">
                <span class="crm-hub-fact">
                  <span>Максимум на заказ</span>
                  <strong>{{ formatByn(hub.card_profile.max_order_minor) }}</strong>
                </span>
                <span v-if="hub.card_profile.tariff_title" class="crm-hub-fact">
                  <span>Тариф</span>
                  <strong>{{ hub.card_profile.tariff_title }}</strong>
                </span>
                <span class="crm-hub-fact">
                  <span>Пауза после заказа</span>
                  <strong data-test="customer-hub-card-cooldown">{{ cooldownText }}</strong>
                </span>
              </template>
              <span v-else class="crm-hub-card-empty">Аккаунт не настроен — при разрешении возьмутся стандартные лимиты.</span>
              <span class="crm-hub-card-more">Лимиты и настройки<ChevronRightIcon aria-hidden="true" /></span>
            </button>
            <div v-if="confirmingCooldown" class="crm-hub-confirm" role="group" aria-label="Подтверждение снятия паузы" data-test="customer-hub-card-cooldown-confirm">
              <p>Снять паузу? Клиент сможет оплатить картой сразу, после следующей выдачи пауза вернётся.</p>
              <div class="crm-hub-inline-row">
                <button
                  type="button"
                  class="crm-hub-btn crm-hub-btn--primary"
                  :disabled="busy"
                  data-test="customer-hub-card-cooldown-confirm-yes"
                  @click="clearCardCooldown"
                >{{ acting ? 'Снимаем…' : 'Да, снять' }}</button>
                <button type="button" class="crm-hub-btn" :disabled="acting" @click="confirmingCooldown = false">Нет</button>
              </div>
            </div>
            <div v-else class="crm-hub-card-buttons">
              <button
                type="button"
                class="crm-hub-btn"
                :class="{ 'crm-hub-btn--primary': !cardPaymentAllowed }"
                :disabled="busy || !customer.telegram_id"
                :title="toggleCardLabel"
                data-test="customer-hub-card-toggle"
                @click="toggleCardPayment"
              >{{ togglingCard ? 'Сохраняем…' : (cardPaymentAllowed ? 'Запретить' : 'Разрешить') }}</button>
              <button
                v-if="cooldownActive"
                type="button"
                class="crm-hub-btn"
                :disabled="busy || !cardTelegramId"
                data-test="customer-hub-card-clear-cooldown"
                @click="confirmingCooldown = true"
              >Снять паузу</button>
            </div>
            <p v-if="cardError" class="crm-note-error" role="alert">{{ cardError }}</p>
            <p v-if="!customer.telegram_id" class="crm-note-hint">
              У клиента нет Telegram ID — заведите карточный аккаунт в меню «Действия с заказами» → «Оплата картой».
            </p>
          </section>

          </div>
          <div class="crm-hub-col">
          <HubStats v-if="hub.stats" :stats="hub.stats" />
          <HubNote v-if="customer?.notes" :notes="customer.notes" :disabled="busy" @edit="emitAction('note')" />
          <HubRecentOrders
            v-if="customer"
            :orders="hub.recent_orders || []"
            :customer-id="customer.id"
            :total="hub.stats?.orders_total ?? hub.recent_orders?.length ?? 0"
            :disabled="busy"
            @open-order="openOrder"
          />
          <!-- Доступ: пригласивший одной строкой, подробности авторизации — в раскрываемом разделе. -->
          <section class="crm-hub-panel crm-hub-access-panel" data-test="customer-hub-access">
            <span class="crm-hub-head"><span class="crm-hub-head-icon" aria-hidden="true"><ShieldCheckIcon /></span><span class="crm-hub-section-title">Доступ</span></span>
            <HubInvitesSection
              v-if="customer"
              :hub="hub"
              :busy="busy"
              :disabled="busy"
              :inviter-expanded="inviterExpanded"
              @inviter-action="emitInviterAction"
              @toggle-inviter="toggleInviter"
            />
            <HubAuthorizationSection
              :hub="hub"
              :busy="busy"
              :disabled="busy"
              @grant="grant"
              @revoke="revoke"
              @revoke-pending="revokePending"
            />
          </section>
          </div>
        </div>
      </template>

    </div>
  </AdminModal>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  BoltIcon,
  ChatBubbleLeftRightIcon,
  ChevronRightIcon,
  Cog6ToothIcon,
  CreditCardIcon,
  LockClosedIcon,
  PaperAirplaneIcon,
  PencilSquareIcon,
  ShieldCheckIcon,
} from '@heroicons/vue/24/outline'
import AdminModal from '@/components/AdminModal.vue'
import { useCrmStore } from '@/stores/crm'
import {
  fetchCustomerHub,
  grantStaffAccess,
  hubErrorText,
  normalizeHubQuery,
  removeBlock,
  removeInviteBan,
  removePendingStaffAccess,
  revokeStaffAccess,
  type CustomerHubData,
} from '@/utils/crmCustomerHubApi'
import HubProfileHeader from './customer-hub/HubProfileHeader.vue'
import HubModerationActions from './customer-hub/HubModerationActions.vue'
import HubNotices from './customer-hub/HubNotices.vue'
import HubNote from './customer-hub/HubNote.vue'
import HubStats from './customer-hub/HubStats.vue'
import HubAuthorizationSection from './customer-hub/HubAuthorizationSection.vue'
import HubInvitesSection from './customer-hub/HubInvitesSection.vue'
import HubRecentOrders from './customer-hub/HubRecentOrders.vue'
import HubListsTab from './customer-hub/HubListsTab.vue'
import './customer-hub/customer-hub.css'

export type CustomerHubAction = 'block' | 'discount-block' | 'note' | 'invite-ban' | 'remove-invite-ban' | 'wholesale' | 'find-inviter' | 'contact' | 'chat'
export type HubInviterAction = 'copy' | 'message' | 'block' | 'invite-ban' | 'remove-ban'

export interface CustomerHubActionContext {
  username: string
  customerId: string | null
  customerName: string | null
  notes: string | null
  orderId: string | null
  /** ID действующего запрета приглашать — для его снятия из хаба. */
  inviteBanId: string | null
  /** Статус заморозки скидочной системы клиента (для действия discount-block). */
  discountBlock: { blocked: boolean; until: string | null; comment: string | null } | null
  /** Telegram ID клиента — для открытия диалога в TG (действие chat). */
  telegramId: string | null
}

export interface CustomerHubInviter {
  customer_id: string | null
  username: string | null
  first_name: string | null
  last_name: string | null
  invite_ban_id: string | null
  is_invite_banned: boolean
}

const props = defineProps<{
  isOpen: boolean
  /** Предзаполнение из карточки заказа: сразу ищем этого клиента. */
  prefill?: { username?: string | null; customerId?: string | null; customerName?: string | null; orderId?: string | null } | null
  /** Родитель генерирует сообщение клиенту (действие «Написать клиенту»). */
  messageGenerating?: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'action', action: CustomerHubAction, context: CustomerHubActionContext): void
  (e: 'inviter-action', action: HubInviterAction, inviter: CustomerHubInviter): void
  (e: 'customer-found', payload: { username: string; customerId: string | null; customerName: string | null }): void
  (e: 'notify', payload: { ok: boolean; message: string }): void
  (e: 'open-order', orderId: string): void
  /** @username или Telegram ID клиента — открыть его настройки оплаты картой. */
  (e: 'open-card-settings', account: string): void
}>()

const crmStore = useCrmStore()

const tab = ref<'client' | 'lists'>('client')
const formQuery = ref('')
const searching = ref(false)
const acting = ref(false)
const togglingCard = ref(false)
const errorMessage = ref('')
const cardError = ref('')
const confirmingCooldown = ref(false)
const hub = ref<CustomerHubData | null>(null)
const inviterExpanded = ref(false)
const usernameInputRef = ref<HTMLInputElement | null>(null)
/** Заказ, из карточки которого открыт хаб — включает действие «Написать клиенту». */
const hubOrderId = ref<string | null>(null)

const busy = computed(() => searching.value || acting.value || togglingCard.value)
const generatingMessage = computed(() => Boolean(props.messageGenerating))
const customer = computed(() => hub.value?.customer ?? null)

// Ревизия запроса: поздний ответ закрытого/перезапущенного поиска отбрасывается,
// чтобы клиент A не попал в хаб, открытый для клиента B.
let requestRevision = 0

const customerName = computed(() => {
  const c = customer.value
  if (!c) return ''
  return [c.first_name, c.last_name].filter(Boolean).join(' ') || ''
})

/** Username для действий: у клиента из базы или у «призрака». Пусто для призрака с одним TG ID. */
const lookupUsername = computed(() =>
  customer.value?.telegram_username || hub.value?.username || '',
)

/** Ключ перечитывания: Telegram ID однозначен, username у разных клиентов может совпасть. */
const lookupQuery = computed(() =>
  customer.value?.telegram_id || hub.value?.telegram_id || lookupUsername.value,
)

const srStatus = computed(() => {
  if (searching.value) return 'Ищем клиента…'
  if (hub.value) {
    const who = lookupUsername.value ? `@${lookupUsername.value}` : `TG ID ${hub.value.telegram_id || ''}`
    return hub.value.ghost
      ? `Клиента нет в базе: ${who}`
      : `Клиент найден: ${customerName.value || 'Клиент'} ${who}`
  }
  return ''
})

const discountBlockUntilLabel = computed(() => {
  const until = customer.value?.discount_block?.until
  if (!until) return ''
  const normalized = until.includes('T') ? until : until.replace(' ', 'T') + 'Z'
  const parsed = new Date(normalized)
  if (!Number.isFinite(parsed.getTime())) return until
  const minsk = new Date(parsed.getTime() + 3 * 60 * 60 * 1000)
  const day = String(minsk.getUTCDate()).padStart(2, '0')
  const month = String(minsk.getUTCMonth() + 1).padStart(2, '0')
  return `${day}.${month}.${minsk.getUTCFullYear()}`
})

const cardPaymentAllowed = computed(() => Boolean(hub.value?.card_profile?.enabled))

const cardStatus = computed(() => {
  if (!hub.value?.card_profile) return { label: 'Не настроена', class: '' }
  if (hub.value.card_profile.enabled) return { label: 'Разрешена', class: 'crm-hub-plate--info' }
  return { label: 'Запрещена', class: 'crm-hub-plate--danger' }
})

const toggleCardLabel = computed(() => {
  if (!hub.value?.card_profile) return 'Разрешить оплату картой'
  return hub.value.card_profile.enabled ? 'Запретить оплату картой' : 'Разрешить оплату картой'
})

/** Пауза после оплаты картой ещё идёт — её можно снять досрочно. */
const cooldownActive = computed(() => {
  const profile = hub.value?.card_profile
  if (!profile?.cooldown_until) return false
  const until = new Date(profile.cooldown_until).getTime()
  return Number.isNaN(until) ? Number(profile.cooldown_days_left) > 0 : until > Date.now()
})

/** Telegram ID карточного аккаунта: по нему сервер снимает паузу. */
const cardTelegramId = computed(() => hub.value?.card_profile?.telegram_id || customer.value?.telegram_id || null)

/** Ключ для поиска клиента в окне «Оплата картой и лимиты». */
const cardSettingsAccount = computed(() => customer.value?.telegram_username || lookupUsername.value || cardTelegramId.value || '')

const cooldownText = computed(() => {
  const profile = hub.value?.card_profile
  if (!profile?.cooldown_until || !cooldownActive.value) return 'нет'
  const until = new Date(profile.cooldown_until)
  const date = Number.isNaN(until.getTime())
    ? profile.cooldown_until
    : until.toLocaleString('ru-RU', { timeZone: 'Europe/Minsk', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return `до ${date} (осталось ${profile.cooldown_days_left} дн.)`
})

function formatByn(minor: number | null | undefined) {
  const value = Number(minor || 0) / 100
  return `${value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} BYN`
}

function handleClose() {
  emit('close')
}

function openCardSettings() {
  const account = cardSettingsAccount.value
  if (!account || busy.value) return
  emit('open-card-settings', account)
}

function clearCardCooldown() {
  const telegramId = cardTelegramId.value
  if (!telegramId) return
  const label = lookupUsername.value ? `@${lookupUsername.value}` : `TG ${telegramId}`
  void runAction(() => crmStore.clearCardAccountCooldown(String(telegramId)), `Пауза оплаты картой снята: ${label}`)
}

// Подтверждение снятия паузы живёт до перечитывания карточки или смены клиента.
watch(hub, () => { confirmingCooldown.value = false })

/** Открытие заказа из «Последних заказов» — страница заказов закроет хаб и перейдёт к заказу. */
function openOrder(orderId: string) {
  if (busy.value) return
  emit('open-order', orderId)
}

function resetToSearch() {
  requestRevision += 1
  searching.value = false
  acting.value = false
  togglingCard.value = false
  hub.value = null
  inviterExpanded.value = false
  formQuery.value = ''
  hubOrderId.value = null
  errorMessage.value = ''
  cardError.value = ''
  nextTick(() => usernameInputRef.value?.focus())
}

function buildContext(): CustomerHubActionContext | null {
  const current = hub.value
  if (!current) return null
  const c = current.customer
  return {
    username: lookupUsername.value,
    customerId: c?.id ?? null,
    customerName: customerName.value || null,
    notes: c?.notes ?? null,
    orderId: hubOrderId.value,
    inviteBanId: current.invite_ban?.id ?? null,
    discountBlock: c?.discount_block ?? null,
    telegramId: c?.telegram_id ?? current.telegram_id ?? null,
  }
}

function emitAction(action: CustomerHubAction) {
  const context = buildContext()
  if (!context) return
  emit('action', action, context)
}

function toggleInviter() {
  const current = hub.value
  if (!current) return
  if (!current.inviter) {
    emitAction('find-inviter')
    return
  }
  inviterExpanded.value = !inviterExpanded.value
}

function emitInviterAction(action: HubInviterAction) {
  const inviter = hub.value?.inviter
  if (!inviter) return
  emit('inviter-action', action, inviter)
}

function formatError(err: unknown) {
  return hubErrorText(err, 'Не удалось загрузить данные клиента.')
}

function announceFound(data: CustomerHubData, fallbackQuery: string) {
  emit('customer-found', {
    username: data.customer?.telegram_username || data.username || fallbackQuery,
    customerId: data.customer?.id ?? null,
    customerName: customerName.value || null,
  })
}

async function search() {
  errorMessage.value = ''
  hub.value = null
  inviterExpanded.value = false
  const query = normalizeHubQuery(formQuery.value)
  if (!query) {
    errorMessage.value = 'Введите @username или Telegram ID клиента.'
    return
  }
  searching.value = true
  const revision = ++requestRevision
  try {
    const data = await fetchCustomerHub(query)
    if (revision !== requestRevision) return
    hub.value = data
    announceFound(data, query)
  } catch (err: unknown) {
    if (revision !== requestRevision) return
    errorMessage.value = formatError(err)
  } finally {
    if (revision === requestRevision) searching.value = false
  }
}

/** Тихо перечитывает хаб после действия, не сбрасывая экран на поиск. */
async function reloadHub(revision: number) {
  const current = hub.value
  if (!current) return
  const query = lookupQuery.value
  if (!query) return
  const fresh = await fetchCustomerHub(query)
  if (revision !== requestRevision) return
  hub.value = fresh
  announceFound(fresh, query)
}

async function runAction(fn: () => Promise<unknown>, successMessage: string) {
  if (acting.value || !hub.value) return
  acting.value = true
  errorMessage.value = ''
  const revision = ++requestRevision
  try {
    await fn()
    if (revision !== requestRevision) return
    emit('notify', { ok: true, message: successMessage })
    // Действие уже выполнено: сбой перечитывания не должен выглядеть как провал действия.
    try {
      await reloadHub(revision)
    } catch {
      if (revision === requestRevision) errorMessage.value = 'Действие выполнено, но карточку не удалось обновить. Найдите клиента заново.'
    }
  } catch (err: unknown) {
    if (revision !== requestRevision) return
    const message = hubErrorText(err)
    errorMessage.value = message
    emit('notify', { ok: false, message })
    // Состояние на сервере могло измениться — подтягиваем актуальное.
    try { await reloadHub(revision) } catch { /* оставляем сообщение об ошибке */ }
  } finally {
    if (revision === requestRevision) acting.value = false
  }
}

const who = () => (lookupUsername.value ? `@${lookupUsername.value}` : 'клиента')

function unblock() {
  const block = hub.value?.block
  if (!block) return
  void runAction(
    () => removeBlock(block.id),
    block.kind === 'pending' ? `Превентивный бан для ${who()} отменён` : `${who()} разблокирован`,
  )
}

function grant() {
  const c = customer.value
  void runAction(
    () => grantStaffAccess({ customerId: c?.id ?? null, username: lookupUsername.value }),
    c ? `Доступ без пригласившего выдан: ${who()}` : `Отложенный доступ создан для ${who()}`,
  )
}

function revoke() {
  const id = customer.value?.id
  if (!id) return
  void runAction(() => revokeStaffAccess(id), `Доступ без пригласившего отменён: ${who()}`)
}

function revokePending() {
  const id = hub.value?.authorization?.staff_access.pending_id
  if (id == null) return
  void runAction(() => removePendingStaffAccess(id), `Отложенный доступ отменён: ${who()}`)
}

function removePendingInviteBan() {
  const pending = hub.value?.pending_invite_ban
  if (!pending) return
  void runAction(() => removeInviteBan(pending.id, true), `Отложенный запрет приглашать снят: ${who()}`)
}

function openFromList(key: string) {
  if (!key) return
  tab.value = 'client'
  formQuery.value = key
  void search()
}

function onListMutated() {
  // Открытая карточка могла устареть из-за действия в списке.
  if (!hub.value || searching.value || acting.value) return
  const revision = requestRevision
  void reloadHub(revision).catch(() => { /* карточка обновится при следующем открытии */ })
}

async function toggleCardPayment() {
  const current = hub.value
  const c = current?.customer
  if (!current || !c || togglingCard.value) return
  togglingCard.value = true
  errorMessage.value = ''
  cardError.value = ''
  const nextEnabled = !cardPaymentAllowed.value
  const username = c.telegram_username || lookupUsername.value
  const reloadKey = lookupQuery.value
  const profile = current.card_profile
  const revision = ++requestRevision
  try {
    await crmStore.setCustomerCardPaymentEnabled(
      username,
      c.telegram_id,
      nextEnabled,
      profile ? { telegram_id: profile.telegram_id ?? null, max_order_minor: profile.max_order_minor } : null,
    )
    if (revision !== requestRevision) return
    const fresh = await fetchCustomerHub(reloadKey)
    if (revision !== requestRevision) return
    hub.value = fresh
    const label = username ? `@${username}` : `TG ${c.telegram_id}`
    emit('notify', {
      ok: true,
      message: nextEnabled
        ? `Оплата картой разрешена для ${label}`
        : `Оплата картой запрещена для ${label}`,
    })
  } catch (err: unknown) {
    if (revision !== requestRevision) return
    cardError.value = formatError(err)
    emit('notify', { ok: false, message: 'Не удалось изменить разрешение на оплату картой.' })
  } finally {
    if (revision === requestRevision) togglingCard.value = false
  }
}

watch(
  () => props.isOpen,
  (open) => {
    if (!open) {
      requestRevision += 1
      searching.value = false
      acting.value = false
      togglingCard.value = false
      return
    }
    tab.value = 'client'
    formQuery.value = normalizeHubQuery(props.prefill?.username || '')
    hubOrderId.value = props.prefill?.orderId || null
    hub.value = null
    inviterExpanded.value = false
    errorMessage.value = ''
    cardError.value = ''
    if (formQuery.value) {
      void search()
    } else {
      nextTick(() => usernameInputRef.value?.focus())
    }
  },
)
</script>
