<template>
  <AdminModal
    :is-open="isOpen"
    title="Клиент"
    description="Карточка клиента и все действия с ним в одном месте."
    size="md"
    reference-design
    :show-actions="false"
    @close="handleClose"
    @cancel="handleClose"
  >
    <div class="crm-customer-hub" :aria-busy="busy ? 'true' : undefined">
      <!-- Статус для скринридеров: найден клиент / идёт поиск. -->
      <p class="crm-hub-sr-only" role="status" aria-live="polite">{{ srStatus }}</p>
      <!-- Поиск по @username: скрываем, пока грузится предзаполненный клиент. -->
      <section v-if="!hub && searching" class="crm-hub-panel crm-hub-loading" aria-live="polite">
        <span class="crm-hub-section-title">Клиент</span>
        <p>Загружаем данные клиента…</p>
      </section>
      <section v-else-if="!hub" class="crm-hub-panel crm-hub-search">
        <label for="customer-hub-username" class="crm-hub-section-title">Telegram username</label>
        <form class="crm-customer-settings-search" @submit.prevent="search">
          <div class="crm-note-username crm-customer-settings-field">
            <span aria-hidden="true">@</span>
            <input
              id="customer-hub-username"
              ref="usernameInputRef"
              v-model.trim="formUsername"
              type="text"
              placeholder="username"
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
          Клиент должен быть в базе — найдём по username из его заказов.
        </p>
      </section>

      <template v-if="hub">
        <!-- Обзор: карточка клиента и оплата картой в одну строку. -->
        <div class="crm-hub-overview">
          <!-- Карточка клиента -->
          <section class="crm-hub-panel crm-hub-customer-card" data-test="customer-hub-customer">
            <div class="crm-hub-customer-head">
              <span class="crm-hub-avatar" aria-hidden="true">{{ customerInitials }}</span>
              <div class="crm-hub-customer-main">
                <strong data-test="customer-hub-name">{{ customerName || 'Клиент' }}</strong>
                <span>@{{ hub.customer.telegram_username || formUsername }}</span>
                <span v-if="hub.customer.telegram_id">TG ID {{ hub.customer.telegram_id }}</span>
                <span v-if="hub.customer.total_orders > 0">{{ hub.customer.total_orders }} {{ pluralOrders(hub.customer.total_orders) }}</span>
              </div>
            </div>
            <div class="crm-hub-customer">
              <div class="crm-hub-badges">
                <span
                  class="crm-hub-plate"
                  :class="hub.invite_ban ? 'crm-hub-plate--danger' : 'crm-hub-plate--success'"
                  data-test="customer-hub-invite-ban-badge"
                >{{ hub.invite_ban ? 'Приглашения запрещены' : 'Приглашения разрешены' }}</span>
                <span v-if="hub.block" class="crm-hub-plate crm-hub-plate--danger" data-test="customer-hub-block-badge">
                  {{ hub.block.kind === 'pending' ? 'Блокировка ожидает' : 'Заблокирован' }}
                </span>
                <span v-if="hub.customer.wholesale_min_override !== null" class="crm-hub-plate crm-hub-plate--info">
                  Опт-минимум: {{ hub.customer.wholesale_min_override }}
                </span>
              </div>
              <p v-if="hub.invite_ban?.reason" class="crm-note-hint">Причина запрета приглашать: {{ hub.invite_ban.reason }}</p>
            </div>
            <p v-if="hub.block?.reason" class="crm-note-hint">Причина блокировки: {{ hub.block.reason }}</p>
          </section>

          <!-- Виджет оплаты картой -->
          <section class="crm-hub-panel crm-hub-card" data-test="customer-hub-card">
            <div class="crm-hub-card-heading">
              <span class="crm-hub-section-title">Оплата картой</span>
              <span
                class="crm-hub-plate"
                :class="cardStatus.class"
                data-test="customer-hub-card-status"
              >{{ cardStatus.label }}</span>
            </div>

            <div v-if="hub.card_profile" class="crm-hub-card-details">
              <div class="crm-hub-card-row">
                <span>Максимум на заказ</span>
                <strong>{{ formatByn(hub.card_profile.max_order_minor) }}</strong>
              </div>
              <div v-if="hub.card_profile.tariff_title" class="crm-hub-card-row">
                <span>Тариф</span>
                <strong>{{ hub.card_profile.tariff_title }}</strong>
              </div>
              <div class="crm-hub-card-row">
                <span>Пауза после заказа</span>
                <strong data-test="customer-hub-card-cooldown">{{ cooldownText }}</strong>
              </div>
            </div>
            <p v-else class="crm-note-hint">Аккаунт не настроен. Разрешите оплату — лимиты возьмутся стандартные.</p>

            <button
              type="button"
              class="crm-hub-card-toggle"
              :class="cardPaymentAllowed ? 'crm-hub-card-toggle--danger' : 'crm-hub-card-toggle--primary'"
              :disabled="togglingCard || !hub.customer.telegram_id"
              data-test="customer-hub-card-toggle"
              @click="toggleCardPayment"
            >
              {{ togglingCard ? 'Сохраняем…' : toggleCardLabel }}
            </button>
            <!-- Ошибка виджета — рядом с его кнопкой, а не в подвале модалки. -->
            <p v-if="cardError" class="crm-note-error" role="alert">{{ cardError }}</p>
            <p v-if="!hub.customer.telegram_id" class="crm-note-hint">
              У клиента нет Telegram ID — заведите карточный аккаунт в меню «Действия с заказами» → «Оплата картой».
            </p>
          </section>
        </div>

        <!-- Действия -->
        <section class="crm-hub-panel">
          <span class="crm-hub-section-title">Действия</span>
          <div class="crm-hub-actions">
            <button
              type="button"
              class="crm-hub-action crm-hub-action--danger"
              :disabled="Boolean(hub.block) || busy"
              data-test="customer-hub-block"
              @click="emitAction('block')"
            >
              <span class="crm-hub-action-icon" aria-hidden="true"><NoSymbolIcon /></span>
              <span>{{ hub.block ? 'Клиент уже заблокирован' : 'Заблокировать' }}</span>
              <ChevronRightIcon aria-hidden="true" class="crm-hub-action-arrow" />
            </button>
            <button
              type="button"
              class="crm-hub-action crm-hub-action--danger"
              :disabled="busy"
              data-test="customer-hub-discount-block"
              @click="emitAction('discount-block')"
            >
              <span class="crm-hub-action-icon" aria-hidden="true"><LockClosedIcon /></span>
              <span>{{ hub.customer.discount_block?.blocked ? `Скидки заморожены до ${discountBlockUntilLabel}` : 'Заморозить скидки' }}</span>
              <ChevronRightIcon aria-hidden="true" class="crm-hub-action-arrow" />
            </button>
            <button
              type="button"
              class="crm-hub-action"
              :disabled="busy"
              data-test="customer-hub-note"
              @click="emitAction('note')"
            >
              <span class="crm-hub-action-icon" aria-hidden="true"><PencilSquareIcon /></span>
              <span>Сделать заметку</span>
              <ChevronRightIcon aria-hidden="true" class="crm-hub-action-arrow" />
            </button>
            <button
              v-if="!hub.invite_ban"
              type="button"
              class="crm-hub-action crm-hub-action--danger"
              :disabled="busy"
              data-test="customer-hub-invite-ban"
              @click="emitAction('invite-ban')"
            >
              <span class="crm-hub-action-icon" aria-hidden="true"><UserMinusIcon /></span>
              <span>Запретить приглашать</span>
              <ChevronRightIcon aria-hidden="true" class="crm-hub-action-arrow" />
            </button>
            <button
              v-else
              type="button"
              class="crm-hub-action crm-hub-action--info"
              :disabled="busy"
              data-test="customer-hub-invite-unban"
              @click="emitAction('remove-invite-ban')"
            >
              <span class="crm-hub-action-icon" aria-hidden="true"><CheckCircleIcon /></span>
              <span>Разрешить приглашать</span>
              <ChevronRightIcon aria-hidden="true" class="crm-hub-action-arrow" />
            </button>
            <button
              type="button"
              class="crm-hub-action"
              :disabled="busy"
              data-test="customer-hub-inviter"
              @click="toggleInviter"
            >
              <span class="crm-hub-action-icon" aria-hidden="true"><UserGroupIcon /></span>
              <span>{{ hub.inviter ? 'Пригласивший' : 'Найти пригласившего' }}</span>
              <component
                :is="hub.inviter ? ChevronDownIcon : ChevronRightIcon"
                aria-hidden="true"
                class="crm-hub-action-arrow"
                :class="{ 'is-expanded': inviterExpanded }"
              />
            </button>
            <button
              type="button"
              class="crm-hub-action crm-hub-action--info"
              :disabled="busy"
              data-test="customer-hub-wholesale"
              @click="emitAction('wholesale')"
            >
              <span class="crm-hub-action-icon" aria-hidden="true"><Cog6ToothIcon /></span>
              <span>Настройки опта</span>
              <ChevronRightIcon aria-hidden="true" class="crm-hub-action-arrow" />
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
              <ChevronRightIcon aria-hidden="true" class="crm-hub-action-arrow" />
            </button>
          </div>
        </section>

        <!-- Пригласивший -->
        <section
          v-if="hub.inviter && inviterExpanded"
          class="crm-hub-panel crm-hub-inviter"
          data-test="customer-hub-inviter-panel"
        >
          <span class="crm-hub-section-title">Пригласивший</span>
          <div class="crm-hub-inviter-identity">
            <div>
              <strong>{{ inviterName || 'Пригласивший' }}</strong>
              <span>@{{ hub.inviter.username || 'username не указан' }}</span>
            </div>
            <span v-if="hub.inviter.is_invite_banned" class="crm-hub-plate crm-hub-plate--danger">
              Приглашения запрещены
            </span>
          </div>
          <p class="crm-note-hint">Действия ниже относятся к пригласившему, не к этому клиенту.</p>
          <div class="crm-hub-inviter-actions">
            <button type="button" :disabled="busy || !hub.inviter?.username" @click="emitInviterAction('copy')">Скопировать username</button>
            <button type="button" :disabled="busy || !hub.inviter?.customer_id" @click="emitInviterAction('message')">Написать</button>
            <button type="button" :disabled="busy" @click="emitInviterAction('block')">Заблокировать</button>
            <button
              v-if="!hub.inviter?.is_invite_banned"
              type="button"
              class="crm-hub-inviter-danger"
              :disabled="busy"
              @click="emitInviterAction('invite-ban')"
            >Запретить приглашать</button>
            <button
              v-else
              type="button"
              :disabled="busy || !hub.inviter?.invite_ban_id"
              @click="emitInviterAction('remove-ban')"
            >Разрешить приглашать</button>
          </div>
        </section>
      </template>

      <div v-if="errorMessage" class="crm-note-error" role="alert">{{ errorMessage }}</div>

      <div class="crm-note-actions">
        <div class="crm-note-main-actions">
          <button
            v-if="hub"
            type="button"
            class="crm-note-secondary"
            @click="resetToSearch"
          >Другой клиент</button>
          <button
            type="button"
            class="crm-note-secondary"
            @click="handleClose"
          >Закрыть</button>
        </div>
      </div>
    </div>
  </AdminModal>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  ChatBubbleLeftRightIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  Cog6ToothIcon,
  LockClosedIcon,
  NoSymbolIcon,
  PencilSquareIcon,
  UserGroupIcon,
  UserMinusIcon,
} from '@heroicons/vue/24/outline'
import AdminModal from '@/components/AdminModal.vue'
import { useCrmStore, type CustomerHubData } from '@/stores/crm'

export type CustomerHubAction = 'block' | 'discount-block' | 'note' | 'invite-ban' | 'remove-invite-ban' | 'wholesale' | 'find-inviter' | 'contact'
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
}>()

const crmStore = useCrmStore()

const formUsername = ref('')
const searching = ref(false)
const togglingCard = ref(false)
const errorMessage = ref('')
// Ошибка виджета оплаты картой — показывается рядом с ним, а не в подвале.
const cardError = ref('')
const hub = ref<CustomerHubData | null>(null)
const inviterExpanded = ref(false)
const usernameInputRef = ref<HTMLInputElement | null>(null)

const busy = computed(() => searching.value || togglingCard.value)
const generatingMessage = computed(() => Boolean(props.messageGenerating))

/** Заказ, из карточки которого открыт хаб — включает действие «Написать клиенту». */
const hubOrderId = ref<string | null>(null)

// Ревизия запроса: поздний ответ закрытого/перезапущенного поиска отбрасывается,
// чтобы клиент A не попал в хаб, открытый для клиента B.
let requestRevision = 0

const srStatus = computed(() => {
  if (searching.value) return 'Ищем клиента…'
  if (hub.value) {
    const username = hub.value.customer.telegram_username || formUsername.value
    return `Клиент найден: ${customerName.value || 'Клиент'} @${username}`
  }
  return ''
})

const customerName = computed(() => {
  const customer = hub.value?.customer
  if (!customer) return ''
  return [customer.first_name, customer.last_name].filter(Boolean).join(' ') || ''
})

/** Дата окончания заморозки скидочной системы (Минск, ДД.ММ.ГГГГ). */
const discountBlockUntilLabel = computed(() => {
  const until = hub.value?.customer.discount_block?.until
  if (!until) return ''
  const normalized = until.includes('T') ? until : until.replace(' ', 'T') + 'Z'
  const parsed = new Date(normalized)
  if (!Number.isFinite(parsed.getTime())) return until
  const minsk = new Date(parsed.getTime() + 3 * 60 * 60 * 1000)
  const day = String(minsk.getUTCDate()).padStart(2, '0')
  const month = String(minsk.getUTCMonth() + 1).padStart(2, '0')
  return `${day}.${month}.${minsk.getUTCFullYear()}`
})

/** Инициалы для плашки-аватара в шапке карточки клиента. */
const customerInitials = computed(() => {
  const name = customerName.value || hub.value?.customer.telegram_username || ''
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase()
})

const inviterName = computed(() => {
  const inviter = hub.value?.inviter
  if (!inviter) return ''
  return [inviter.first_name, inviter.last_name].filter(Boolean).join(' ') || ''
})

const cardPaymentAllowed = computed(() => Boolean(hub.value?.card_profile?.enabled))

const cardStatus = computed(() => {
  if (!hub.value?.card_profile) {
    return { label: 'Не настроена', class: 'crm-hub-plate--neutral' }
  }
  if (hub.value.card_profile.enabled) {
    return { label: 'Разрешена', class: 'crm-hub-plate--success' }
  }
  return { label: 'Запрещена', class: 'crm-hub-plate--danger' }
})

const toggleCardLabel = computed(() => {
  if (!hub.value?.card_profile) return 'Разрешить оплату картой'
  return hub.value.card_profile.enabled ? 'Запретить оплату картой' : 'Разрешить оплату картой'
})

const cooldownText = computed(() => {
  const profile = hub.value?.card_profile
  if (!profile?.cooldown_until) return 'нет'
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

function pluralOrders(value: number) {
  const mod10 = value % 10
  const mod100 = value % 100
  if (mod10 === 1 && mod100 !== 11) return 'заказ'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'заказа'
  return 'заказов'
}

function stripAt(value: string) {
  return String(value || '').trim().replace(/^@+/, '')
}

function handleClose() {
  // Модалка закрывается и во время запроса: поздний ответ отбрасывается ревизией.
  emit('close')
}

function resetToSearch() {
  requestRevision += 1
  searching.value = false
  // Летящий переключатель оплаты отменяется ревизией — снимаем занятость сразу.
  togglingCard.value = false
  hub.value = null
  inviterExpanded.value = false
  formUsername.value = ''
  hubOrderId.value = null
  errorMessage.value = ''
  cardError.value = ''
  nextTick(() => {
    usernameInputRef.value?.focus()
  })
}

function emitAction(action: CustomerHubAction) {
  const customer = hub.value?.customer
  if (!customer) return
  emit('action', action, {
    username: customer.telegram_username || formUsername.value,
    customerId: customer.id,
    customerName: customerName.value || null,
    notes: customer.notes ?? null,
    orderId: hubOrderId.value,
    inviteBanId: hub.value?.invite_ban?.id ?? null,
    discountBlock: customer.discount_block ?? null,
  })
}

function toggleInviter() {
  const current = hub.value
  if (!current) return
  if (!current.inviter) {
    // Пригласившего нет в базе — ищем через отдельную модалку.
    emit('action', 'find-inviter', {
      username: current.customer.telegram_username || formUsername.value,
      customerId: current.customer.id,
      customerName: customerName.value || null,
      notes: current.customer.notes ?? null,
      orderId: hubOrderId.value,
      inviteBanId: current.invite_ban?.id ?? null,
      discountBlock: current.customer.discount_block ?? null,
    })
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
  const code = (err as { code?: string })?.code
  if (code === 'customer_not_found') return 'Клиент с таким username не найден.'
  return (err as { message?: string })?.message || 'Не удалось загрузить данные клиента.'
}

async function search() {
  errorMessage.value = ''
  hub.value = null
  inviterExpanded.value = false
  const username = stripAt(formUsername.value)
  if (!username) {
    errorMessage.value = 'Введите @username клиента.'
    return
  }
  searching.value = true
  const revision = ++requestRevision
  try {
    const data = await crmStore.fetchCustomerHub(username)
    if (revision !== requestRevision) return
    hub.value = data
    // Помечаем найденного клиента, чтобы родитель запомнил его для возврата в хаб.
    emit('customer-found', {
      username: data.customer.telegram_username || username,
      customerId: data.customer.id,
      customerName: customerName.value || null,
    })
  } catch (err: unknown) {
    if (revision !== requestRevision) return
    errorMessage.value = formatError(err)
  } finally {
    if (revision === requestRevision) searching.value = false
  }
}

async function toggleCardPayment() {
  const current = hub.value
  const customer = current?.customer
  if (!current || !customer || togglingCard.value) return
  togglingCard.value = true
  errorMessage.value = ''
  cardError.value = ''
  const nextEnabled = !cardPaymentAllowed.value
  const username = customer.telegram_username || formUsername.value
  const profile = current.card_profile
  const revision = ++requestRevision
  try {
    await crmStore.setCustomerCardPaymentEnabled(
      username,
      customer.telegram_id,
      nextEnabled,
      profile
        ? {
            telegram_id: profile.telegram_id ?? null,
            max_order_minor: profile.max_order_minor,
          }
        : null,
    )
    if (revision !== requestRevision) return
    // Перезагружаем карточку, чтобы виджет показал свежие лимиты и паузу.
    // Сначала проверяем ревизию, потом пишем в hub — поздний ответ не должен
    // возвращать в хаб клиента, от которого уже ушли («Другой клиент»).
    const fresh = await crmStore.fetchCustomerHub(username)
    if (revision !== requestRevision) return
    hub.value = fresh
    emit('notify', {
      ok: true,
      message: nextEnabled
        ? `Оплата картой разрешена для @${username}`
        : `Оплата картой запрещена для @${username}`,
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
      // Закрытие хаба отменяет летящие запросы и снимает занятость.
      requestRevision += 1
      searching.value = false
      togglingCard.value = false
      return
    }
    formUsername.value = stripAt(props.prefill?.username || '')
    hubOrderId.value = props.prefill?.orderId || null
    hub.value = null
    inviterExpanded.value = false
    errorMessage.value = ''
    cardError.value = ''
    if (formUsername.value) {
      void search()
    } else {
      nextTick(() => {
        usernameInputRef.value?.focus()
      })
    }
  },
)
</script>

<style scoped>
/* Палитра страницы «Заказы»: чернильный текст, синий и красный градиенты,
   белые карточки с мягкими тенями. */
.crm-customer-hub {
  --hub-ink: #081b4b;
  --hub-muted: #66799e;
  --hub-primary: linear-gradient(100deg, #05b8ff, #185dff);
  --hub-danger: linear-gradient(115deg, #ff685a, #fa104f);
  display: grid;
  gap: 12px;
  min-width: 0;
  color: var(--hub-ink);
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
  font-size: 13px;
  line-height: 1.5;
}
.crm-customer-hub *, .crm-customer-hub *::before { box-sizing: border-box; }
.crm-customer-hub p { margin: 0; }

/* Панели-блоки: одна карточка — одна зона внимания. */
.crm-hub-panel {
  display: grid;
  gap: 10px;
  min-width: 0;
  padding: 16px;
  border: 1px solid #eaf0f9;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 10px 30px #20386905;
}
/* Предзаполненный клиент грузится — показываем статус вместо пустого поиска. */
.crm-hub-loading p { color: var(--hub-muted); }
.crm-hub-section-title {
  color: #7584a7;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: .17em;
  line-height: 1.3;
  text-transform: uppercase;
}

/* Поиск клиента. */
.crm-customer-hub label { display: block; }
.crm-customer-settings-search { display: flex; gap: 10px; align-items: stretch; }
.crm-customer-settings-field { flex: 1 1 auto; }
.crm-note-username { position: relative; }
.crm-note-username > span { position: absolute; top: 50%; left: 12px; transform: translateY(-50%); color: var(--hub-muted); pointer-events: none; }
.crm-note-username > input { padding-left: 30px; }
.crm-customer-hub input, .crm-customer-hub textarea { width: 100%; min-width: 0; max-width: 100%; padding: 11px 12px; border: 1px solid #dce8fa; border-radius: 10px; background: #f7fbff; color: var(--hub-ink); font: inherit; font-size: 13px; line-height: 1.5; box-shadow: none; }
.crm-customer-hub input::placeholder { color: #8999b7; opacity: 1; }
.crm-customer-hub :is(input, textarea, button):focus-visible { outline: 2px solid #0958ff; outline-offset: 3px; }
.crm-customer-settings-find { min-height: 44px; padding: 11px 18px; border: 1px solid transparent; border-radius: 12px; background: var(--hub-primary); color: #fff; font-family: inherit; font-size: 13px; font-weight: 750; cursor: pointer; box-shadow: 0 6px 14px #148cff24; }
.crm-customer-settings-find:disabled { opacity: .5; cursor: not-allowed; }
.crm-customer-settings-find:not(:disabled):hover { filter: brightness(1.04); }
.crm-note-hint { color: var(--hub-muted); font-size: 11px; line-height: 1.6; }
.crm-note-error { padding: 12px 14px; border: 1px solid #ffd4dc; border-radius: 12px; background: #fff4f6; color: #b82648; overflow-wrap: anywhere; }

/* Обзор: клиент и оплата картой рядом, узкими колонками. */
.crm-hub-overview { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; align-items: stretch; }

/* Карточка клиента: тёмная шапка как ячейка заказа + светлые плашки статусов. */
.crm-hub-customer-card { gap: 12px; }
.crm-hub-customer-head {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 14px;
  border-radius: 12px;
  background: linear-gradient(145deg, #09265c, #06143b);
  box-shadow: 0 6px 13px #0a1e4033;
}
.crm-hub-avatar {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: var(--hub-primary);
  box-shadow: 0 8px 17px #328aff40;
  color: #fff;
  font-size: 15px;
  font-weight: 800;
}
.crm-hub-customer-main { display: grid; gap: 2px; min-width: 0; overflow-wrap: anywhere; }
.crm-hub-customer-main strong { color: #fff; font-size: 16px; font-weight: 800; letter-spacing: -.02em; line-height: 1.2; }
.crm-hub-customer-main > span { color: #ffffffb8; font-size: 12px; line-height: 1.35; }
.crm-hub-customer { display: grid; gap: 10px; min-width: 0; }
.crm-hub-badges { display: flex; flex-wrap: wrap; gap: 6px; }

/* Плашки статусов: маленькие, цвет говорит сам за себя. */
.crm-hub-plate {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 750;
  line-height: 1.3;
}
.crm-hub-plate--danger { background: #fff1f3; color: #d92342; }
.crm-hub-plate--warning { background: #fff8e8; color: #a06414; }
.crm-hub-plate--info { background: #eef4ff; color: #1555e8; }
.crm-hub-plate--success { background: #eaf8f0; color: #20704a; }
.crm-hub-plate--neutral { background: #f0f4fa; color: #425778; }

/* Виджет оплаты картой. */
.crm-hub-card-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.crm-hub-card-details { display: grid; gap: 6px; padding: 12px 14px; border: 1px solid #dce8fa; border-radius: 12px; background: #f7fbff; }
.crm-hub-card-row { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 6px; }
.crm-hub-card-row > span { color: var(--hub-muted); font-size: 12px; }
.crm-hub-card-row > strong { font-size: 12px; font-weight: 750; font-variant-numeric: tabular-nums; }
.crm-hub-card-toggle { min-height: 44px; padding: 11px 18px; border: 1px solid transparent; border-radius: 12px; font-family: inherit; font-size: 13px; font-weight: 750; cursor: pointer; }
.crm-hub-card-toggle:disabled { opacity: .5; cursor: not-allowed; }
.crm-hub-card-toggle:not(:disabled):hover { filter: brightness(1.04); }
.crm-hub-card-toggle--primary { background: var(--hub-primary); color: #fff; box-shadow: 0 6px 14px #148cff24; }
.crm-hub-card-toggle--danger { background: var(--hub-danger); color: #fff; box-shadow: 0 6px 14px #fa104f24; }

/* Кнопки действий — крупные и раздельные, чтобы легко ориентироваться. */
.crm-hub-actions { display: grid; gap: 9px; }
.crm-hub-action {
  display: flex;
  align-items: center;
  gap: 11px;
  width: 100%;
  min-height: 50px;
  padding: 9px 12px;
  border: 1px solid #eaf0f9;
  border-radius: 12px;
  background: #fff;
  color: #102456;
  font-family: inherit;
  font-size: 13px;
  font-weight: 750;
  line-height: normal;
  text-align: left;
  cursor: pointer;
  transition: background-color 140ms ease-out, border-color 140ms ease-out;
}
.crm-hub-action-icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: #f2f6fd;
  color: #1759ed;
}
.crm-hub-action-icon svg { width: 18px; height: 18px; }
.crm-hub-action > span:not(.crm-hub-action-icon) { min-width: 0; overflow-wrap: anywhere; }
.crm-hub-action .crm-hub-action-arrow { width: 16px; height: 16px; margin-left: auto; flex-shrink: 0; color: #8999b7; }
.crm-hub-action .is-expanded { transform: rotate(180deg); }
.crm-hub-action:hover:not(:disabled) { background: #f7faff; border-color: #b8cef5; }
.crm-hub-action:disabled { opacity: .55; cursor: not-allowed; }
/* Отключённая строка не обещает переход — стрелку убираем. */
.crm-hub-action:disabled .crm-hub-action-arrow { display: none; }
.crm-hub-action--danger { color: #d92342; }
.crm-hub-action--danger .crm-hub-action-icon { background: #fff1f3; color: #d92342; }
.crm-hub-action--danger:hover:not(:disabled) { background: #fff6f8; border-color: #f6c4ce; }
.crm-hub-action--info { color: #1555e8; }
.crm-hub-action--info .crm-hub-action-icon { background: #edf5ff; color: #1555e8; }
.crm-hub-action--info:hover:not(:disabled) { background: #f5f9ff; border-color: #b8cef5; }
.crm-hub-action:focus-visible { outline: 2px solid #0958ff; outline-offset: 3px; }

/* Пригласивший. */
.crm-hub-inviter-identity { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 14px; border: 1px solid #dce8fa; border-radius: 12px; background: #f7fbff; }
.crm-hub-inviter-identity > div { display: grid; gap: 3px; overflow-wrap: anywhere; }
.crm-hub-inviter-identity strong { font-size: 13px; font-weight: 750; }
.crm-hub-inviter-identity span { color: var(--hub-muted); font-size: 12px; }
.crm-hub-inviter-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
.crm-hub-inviter-actions button { min-height: 44px; padding: 11px 12px; border: 1px solid #eaf0f9; border-radius: 10px; background: #fff; color: #233e70; font-family: inherit; font-size: 13px; font-weight: 650; line-height: 1.4; text-align: left; overflow-wrap: anywhere; cursor: pointer; transition: background-color 140ms ease-out, border-color 140ms ease-out; }
.crm-hub-inviter-actions button:hover:not(:disabled) { background: #f0f5ff; border-color: #b8cef5; }
.crm-hub-inviter-actions button:disabled { opacity: .55; cursor: not-allowed; }
.crm-hub-inviter-actions .crm-hub-inviter-danger { color: #d92342; }
.crm-hub-inviter-actions button:focus-visible { outline: 2px solid #1759ed; outline-offset: 2px; }

/* Футер. */
.crm-note-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.crm-note-main-actions { display: flex; justify-content: flex-end; gap: 10px; margin-left: auto; }
.crm-customer-hub .crm-note-secondary { min-height: 44px; padding: 11px 18px; border: 1px solid #dce8fa; border-radius: 12px; background: linear-gradient(#f7faff, #e9f0fa); color: #233e70; font-family: inherit; font-size: 13px; font-weight: 750; cursor: pointer; }
.crm-customer-hub .crm-note-secondary:disabled { opacity: .5; cursor: not-allowed; }
.crm-customer-hub .crm-note-secondary:not(:disabled):hover { filter: brightness(1.04); }

/* Скринридер-статус. */
.crm-hub-sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0; clip: rect(0 0 0 0); clip-path: inset(50%); overflow: hidden; white-space: nowrap; }

@media (max-width: 640px) {
  .crm-hub-overview { grid-template-columns: minmax(0, 1fr); }
  .crm-customer-settings-search { flex-direction: column; }
  .crm-hub-inviter-actions { grid-template-columns: minmax(0, 1fr); }
  .crm-note-main-actions { width: 100%; }
  .crm-note-main-actions .crm-note-secondary { flex: 1; }
}
@media (prefers-reduced-motion: reduce) { .crm-customer-hub * { transition: none !important; } }
</style>
