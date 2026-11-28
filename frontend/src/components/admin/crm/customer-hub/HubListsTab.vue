<template>
  <div class="crm-hub-lists" data-test="customer-hub-lists">
    <div class="crm-hub-chips" role="group" aria-label="Списки клиентов">
      <button
        v-for="chip in CHIPS"
        :key="chip.kind"
        type="button"
        class="crm-hub-chip"
        :class="{ 'is-active': active === chip.kind }"
        :aria-pressed="active === chip.kind ? 'true' : 'false'"
        :data-test="`customer-hub-chip-${chip.kind}`"
        @click="select(chip.kind)"
      >
        {{ chip.label }}
        <span v-if="counts" class="crm-hub-chip-badge" :data-test="`customer-hub-chip-count-${chip.kind}`">{{ counts[chip.kind] }}</span>
      </button>
    </div>

    <section class="crm-hub-panel">
      <div class="crm-hub-list-search">
        <input
          v-model="query"
          type="search"
          placeholder="Поиск по @username, имени или Telegram ID"
          autocomplete="off"
          autocapitalize="none"
          :spellcheck="false"
          aria-label="Поиск в списке"
          data-test="customer-hub-list-search"
          @input="onQueryInput"
        >
      </div>

      <form
        v-if="active === 'reserved'"
        class="crm-hub-reserved-form"
        data-test="customer-hub-reserved-form"
        @submit.prevent="addReserved"
      >
        <label for="customer-hub-reserved-input" class="crm-hub-section-title">Добавить «Наши аккаунты»</label>
        <textarea
          id="customer-hub-reserved-input"
          v-model="bulkText"
          rows="2"
          placeholder="@username через пробел, запятую или с новой строки"
          autocapitalize="none"
          :spellcheck="false"
        />
        <p v-if="bulkError" class="crm-note-error" role="alert">{{ bulkError }}</p>
        <button type="submit" class="crm-hub-btn crm-hub-btn--primary" :disabled="bulkBusy || !bulkText.trim()" data-test="customer-hub-reserved-add">
          {{ bulkBusy ? 'Добавляем…' : 'Добавить' }}
        </button>
      </form>

      <p v-if="current.error" class="crm-note-error" role="alert">
        {{ current.error }}
        <button type="button" class="crm-hub-link" @click="load(active, true)">Повторить</button>
      </p>
      <p v-else-if="current.loading && !current.items.length" class="crm-note-hint" aria-live="polite">Загружаем…</p>
      <p v-else-if="!current.items.length" class="crm-note-hint" data-test="customer-hub-list-empty">
        {{ query.trim() ? 'Ничего не найдено.' : 'Список пуст.' }}
      </p>

      <ul v-if="current.items.length" class="crm-hub-rows" data-test="customer-hub-list-rows">
        <li v-for="row in current.items" :key="rowKey(row)" class="crm-hub-row">
          <button
            type="button"
            class="crm-hub-row-main"
            :disabled="disabled || !rowLookupKey(row)"
            :data-test="`customer-hub-row-open`"
            @click="$emit('open-customer', rowLookupKey(row))"
          >
            <strong>{{ rowDisplayName(row) }}</strong>
            <span>{{ rowSubtitle(row) }}</span>
            <small v-if="row.date">{{ formatHubDate(row.date) }}</small>
          </button>
          <template v-if="rowAction(row)">
            <div v-if="confirmKey === rowKey(row)" class="crm-hub-row-confirm" role="group" aria-label="Подтверждение">
              <button
                type="button"
                class="crm-hub-btn crm-hub-btn--primary"
                :disabled="disabled || actingKey === rowKey(row)"
                data-test="customer-hub-row-confirm"
                @click="runRowAction(row)"
              >{{ actingKey === rowKey(row) ? '…' : 'Да' }}</button>
              <button type="button" class="crm-hub-btn" :disabled="actingKey === rowKey(row)" @click="confirmKey = ''">Нет</button>
            </div>
            <button
              v-else
              type="button"
              class="crm-hub-btn"
              :disabled="disabled || Boolean(rowAction(row)?.disabled)"
              :title="rowAction(row)?.hint"
              data-test="customer-hub-row-action"
              @click="confirmKey = rowKey(row)"
            >{{ rowAction(row)?.label }}</button>
          </template>
        </li>
      </ul>

      <button
        v-if="hasMore"
        type="button"
        class="crm-hub-btn"
        :disabled="current.loading"
        data-test="customer-hub-list-more"
        @click="load(active, false)"
      >{{ current.loading ? 'Загружаем…' : `Ещё (${current.total - current.items.length})` }}</button>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import {
  addReservedUsernames,
  fetchCustomerList,
  fetchCustomerListCounts,
  hubErrorText,
  removeBlock,
  removeInviteBan,
  removePendingStaffAccess,
  removeReservedUsername,
  revokeStaffAccess,
  type HubListCounts,
  type HubListKind,
  type HubListRow,
} from '@/utils/crmCustomerHubApi'
import {
  findInvalidDisallowedInviterUsernames,
  parseDisallowedInviterUsernames,
  validateDisallowedInviterUsernames,
} from '@/utils/referralInviterSettings'
import { authErrorText, blockTypeText, formatHubDate, rowDisplayName, rowLookupKey } from './hubFormat'

const PAGE_SIZE = 20
const CHIPS: Array<{ kind: HubListKind; label: string }> = [
  { kind: 'blocked', label: 'Заблокированные' },
  { kind: 'auth_errors', label: 'Ошибки авторизации' },
  { kind: 'staff_access', label: 'Без пригласившего' },
  { kind: 'invite_bans', label: 'Запрет приглашать' },
  { kind: 'reserved', label: 'Наши аккаунты' },
]

defineProps<{ disabled?: boolean }>()
const emit = defineEmits<{
  (e: 'open-customer', key: string): void
  (e: 'notify', payload: { ok: boolean; message: string }): void
  /** Список изменился — открытая карточка клиента могла устареть. */
  (e: 'mutated'): void
}>()

interface ListState {
  items: HubListRow[]
  total: number
  loading: boolean
  loaded: boolean
  error: string
}

const emptyState = (): ListState => ({ items: [], total: 0, loading: false, loaded: false, error: '' })
const lists = reactive<Record<HubListKind, ListState>>({
  blocked: emptyState(),
  auth_errors: emptyState(),
  staff_access: emptyState(),
  invite_bans: emptyState(),
  reserved: emptyState(),
})
const counts = ref<HubListCounts | null>(null)
const active = ref<HubListKind>('blocked')
const query = ref('')
const confirmKey = ref('')
const actingKey = ref('')
const bulkText = ref('')
const bulkError = ref('')
const bulkBusy = ref(false)

const current = computed(() => lists[active.value])
const hasMore = computed(() => current.value.items.length < current.value.total && !current.value.error)

// Ревизия на список: поздний ответ после смены поиска или чипа отбрасывается.
const revisions: Record<HubListKind, number> = { blocked: 0, auth_errors: 0, staff_access: 0, invite_bans: 0, reserved: 0 }
let debounceTimer: ReturnType<typeof setTimeout> | undefined
let countsRevision = 0
let unmounted = false

async function loadCounts() {
  const revision = ++countsRevision
  try {
    const result = await fetchCustomerListCounts()
    if (!unmounted && revision === countsRevision) counts.value = result
  } catch {
    // Бейджи — подсказка, а не критичные данные.
  }
}

async function load(kind: HubListKind, reset: boolean) {
  const state = lists[kind]
  const revision = ++revisions[kind]
  const offset = reset ? 0 : state.items.length
  state.loading = true
  state.error = ''
  try {
    const page = await fetchCustomerList(kind, { q: query.value, offset, limit: PAGE_SIZE })
    if (unmounted || revision !== revisions[kind]) return
    state.items = reset ? page.items : [...state.items, ...page.items]
    state.total = page.total
    state.loaded = true
  } catch (err) {
    if (unmounted || revision !== revisions[kind]) return
    state.error = hubErrorText(err, 'Не удалось загрузить список.')
  } finally {
    if (!unmounted && revision === revisions[kind]) state.loading = false
  }
}

function select(kind: HubListKind) {
  active.value = kind
  confirmKey.value = ''
  bulkError.value = ''
  if (!lists[kind].loaded) void load(kind, true)
}

function onQueryInput() {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    confirmKey.value = ''
    // Остальные списки загрузятся заново при выборе чипа.
    for (const chip of CHIPS) {
      if (chip.kind !== active.value) {
        revisions[chip.kind] += 1
        lists[chip.kind] = emptyState()
      }
    }
    void load(active.value, true)
  }, 300)
}

const rowKeyFor = (kind: HubListKind, row: HubListRow) =>
  `${kind}-${row.kind || ''}-${row.id ?? row.username ?? row.telegram_id ?? ''}`
const rowKey = (row: HubListRow) => rowKeyFor(active.value, row)

function rowSubtitle(row: HubListRow): string {
  switch (active.value) {
    case 'blocked': {
      const type = row.kind === 'pending' ? 'Превентивный бан' : blockTypeText(row.block_type)
      return row.reason && row.block_type !== 'authorization_failed' ? `${type} · ${row.reason}` : type
    }
    case 'auth_errors': {
      const base = row.status === 'blocked' ? 'Заблокирован' : `Попытки ${row.attempts_used ?? 0}/3`
      return row.last_error_code ? `${base} · ${authErrorText(row.last_error_code)}` : base
    }
    case 'staff_access':
      return row.kind === 'pending'
        ? 'Отложенный доступ'
        : row.has_issued_order ? 'Доступ постоянный' : 'Доступ выдан'
    case 'invite_bans':
      return `${row.kind === 'pending' ? 'Отложенный запрет' : 'Запрет приглашать'}${row.reason ? ` · ${row.reason}` : ''}`
    default:
      return row.added_by ? `Добавил ${row.added_by}` : 'Нельзя указывать пригласившим'
  }
}

function rowAction(row: HubListRow): { label: string; disabled?: boolean; hint?: string } | null {
  switch (active.value) {
    case 'blocked':
      return { label: row.kind === 'pending' ? 'Отменить' : 'Разблокировать' }
    case 'staff_access':
      return row.kind === 'active' && row.has_issued_order
        ? { label: 'Отменить', disabled: true, hint: 'Доступ постоянный — есть выданный заказ' }
        : { label: 'Отменить' }
    case 'invite_bans':
      return { label: 'Снять запрет' }
    case 'reserved':
      return { label: 'Удалить' }
    default:
      return null
  }
}

async function performRowAction(row: HubListRow) {
  switch (active.value) {
    case 'blocked': return removeBlock(row.id as string)
    case 'staff_access':
      return row.kind === 'pending'
        ? removePendingStaffAccess(row.id as string)
        : revokeStaffAccess(String(row.customer_id))
    case 'invite_bans': return removeInviteBan(row.id as string, row.kind === 'pending')
    case 'reserved': return removeReservedUsername(String(row.username))
    default: return undefined
  }
}

async function runRowAction(row: HubListRow) {
  const kind = active.value
  const key = rowKeyFor(kind, row)
  if (actingKey.value) return
  actingKey.value = key
  try {
    await performRowAction(row)
    const state = lists[kind]
    state.items = state.items.filter((item) => rowKeyFor(kind, item) !== key)
    state.total = Math.max(0, state.total - 1)
    confirmKey.value = ''
    emit('notify', { ok: true, message: 'Готово' })
    emit('mutated')
    void loadCounts()
  } catch (err) {
    confirmKey.value = ''
    emit('notify', { ok: false, message: hubErrorText(err) })
    // Запись могла уже измениться — список перечитаем.
    void load(kind, true)
    void loadCounts()
  } finally {
    actingKey.value = ''
  }
}

async function addReserved() {
  bulkError.value = ''
  const usernames = parseDisallowedInviterUsernames(bulkText.value)
  if (!validateDisallowedInviterUsernames(usernames)) {
    const invalid = findInvalidDisallowedInviterUsernames(usernames)
    bulkError.value = invalid.length
      ? `Некорректные username: ${invalid.slice(0, 5).map((item) => `@${item}`).join(', ')}. Нужно 5–32 символа: латиница, цифры, «_».`
      : 'Укажите от 1 до 100 username.'
    return
  }
  bulkBusy.value = true
  try {
    await addReservedUsernames(usernames)
    bulkText.value = ''
    emit('notify', { ok: true, message: `Добавлено: ${usernames.length}` })
    emit('mutated')
    await Promise.all([load('reserved', true), loadCounts()])
  } catch (err) {
    bulkError.value = hubErrorText(err)
  } finally {
    bulkBusy.value = false
  }
}

onMounted(() => {
  void loadCounts()
  void load(active.value, true)
})
onBeforeUnmount(() => {
  unmounted = true
  clearTimeout(debounceTimer)
})
</script>
