<template>
  <AdminModal
    :is-open="isOpen"
    title="Настройки клиента"
    description="Персональные правила клиента: оптовый минимум и другие параметры."
    size="md"
    reference-design
    :is-loading="searching || saving || resetting"
    :show-actions="false"
    @close="handleClose"
    @cancel="handleClose"
  >
    <div class="crm-note-form crm-customer-settings">
      <!-- Поиск клиента по @username -->
      <section class="crm-note-section">
        <label for="customer-settings-username" class="crm-note-label">Telegram username</label>
        <form class="crm-customer-settings-search" @submit.prevent="search">
          <div class="crm-note-username crm-customer-settings-field">
            <span aria-hidden="true">@</span>
            <input
              id="customer-settings-username"
              ref="usernameInputRef"
              v-model.trim="formUsername"
              type="text"
              placeholder="username"
              autocomplete="off"
              autocapitalize="none"
              :spellcheck="false"
              aria-describedby="customer-settings-hint"
              required
            />
          </div>
          <button
            type="submit"
            class="crm-customer-settings-find"
            :disabled="searching"
          >{{ searching ? 'Ищем…' : 'Найти' }}</button>
        </form>
        <p id="customer-settings-hint" class="crm-note-hint">
          Клиент должен быть в базе — найдём по username из его заказов.
        </p>
      </section>

      <template v-if="settings">
        <!-- Карточка клиента -->
        <section class="crm-note-section">
          <span class="crm-note-label">Клиент</span>
          <div class="crm-note-customer">
            <strong>{{ customerName || 'Клиент' }}</strong>
            <span>@{{ settings.customer.telegram_username || formUsername }}</span>
            <span v-if="settings.customer.telegram_id">TG ID {{ settings.customer.telegram_id }}</span>
          </div>
          <div
            v-if="currentOverride !== null"
            class="crm-customer-settings-badge"
            data-test="customer-settings-override-badge"
          >
            Персональный минимум: {{ currentOverride }} {{ pluralPositions(currentOverride) }}
          </div>
          <p v-else class="crm-customer-settings-default">Минимум опта — по уровню ссылки клиента.</p>
        </section>

        <!-- Оптовый минимум -->
        <section class="crm-note-section">
          <span class="crm-note-label">Оптовый минимум</span>
          <div class="crm-customer-settings-tiers" data-test="customer-settings-tiers">
            <div
              v-for="tier in sortedTiers"
              :key="tier.id"
              class="crm-customer-settings-tier"
            >
              <span class="crm-customer-settings-tier-label">{{ tier.label }}</span>
              <span class="crm-customer-settings-tier-min">
                {{ tier.min_order_quantity ?? '—' }} {{ pluralPositions(tier.min_order_quantity) }}
              </span>
            </div>
          </div>
          <p class="crm-note-hint">
            Персональный минимум заменяет минимум уровня только для этого клиента.
            Уровень ссылки и цены остаются как есть.
          </p>
          <form class="crm-customer-settings-edit" @submit.prevent="save">
            <label class="crm-customer-settings-input" for="customer-settings-min">
              <span>Персональный минимум позиций</span>
              <input
                id="customer-settings-min"
                v-model.number="minInput"
                type="number"
                min="1"
                max="10000"
                step="1"
                inputmode="numeric"
                placeholder="напр. 15"
                aria-describedby="customer-settings-min-hint"
              >
            </label>
            <p id="customer-settings-min-hint" class="crm-note-hint">
              Целое число от 1 до 10000. Клиент сможет оформить заказ, набрав столько позиций.
            </p>
            <div class="crm-customer-settings-actions">
              <button
                v-if="currentOverride !== null"
                type="button"
                class="crm-customer-settings-reset"
                :disabled="saving || resetting"
                @click="reset"
              >Сбросить к уровню</button>
              <button
                type="submit"
                class="crm-customer-settings-save"
                :disabled="saving || resetting"
              >{{ saving ? 'Сохраняем…' : 'Сохранить' }}</button>
            </div>
          </form>

          <div
            v-if="settings.active_wholesale_order"
            class="crm-customer-settings-order"
            data-test="customer-settings-active-order"
          >
            Активный оптовый заказ №{{ settings.active_wholesale_order.order_number }} ·
            «{{ settings.active_wholesale_order.wholesale_tier_label || 'уровень опта' }}» ·
            минимум при создании:
            {{ settings.active_wholesale_order.wholesale_min_quantity ?? '—' }}
            {{ pluralPositions(settings.active_wholesale_order.wholesale_min_quantity) }}
          </div>
        </section>
      </template>

      <div v-if="errorMessage" class="crm-note-error" role="alert">{{ errorMessage }}</div>

      <div class="crm-note-actions">
        <div class="crm-note-main-actions">
          <button type="button" class="crm-note-secondary" :disabled="saving || resetting" @click="handleClose">Закрыть</button>
        </div>
      </div>
    </div>
  </AdminModal>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import AdminModal from '@/components/AdminModal.vue'
import { useCrmStore, type CustomerWholesaleSettings } from '@/stores/crm'

const props = defineProps<{
  isOpen: boolean
  /** Предзаполнение (напр. из хаба клиента): сразу ищем этого клиента. */
  prefill?: { username?: string | null } | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'saved', payload: { username: string; minQuantity: number | null }): void
}>()

const crmStore = useCrmStore()

const formUsername = ref('')
const searching = ref(false)
const saving = ref(false)
const resetting = ref(false)
const errorMessage = ref('')
const settings = ref<CustomerWholesaleSettings | null>(null)
const minInput = ref<number | null>(null)
const usernameInputRef = ref<HTMLInputElement | null>(null)

const currentOverride = computed(() => settings.value?.customer.wholesale_min_override ?? null)

const customerName = computed(() => {
  const customer = settings.value?.customer
  if (!customer) return ''
  return [customer.first_name, customer.last_name].filter(Boolean).join(' ') || ''
})

const sortedTiers = computed(() => {
  const tiers = settings.value?.tiers || []
  return [...tiers].sort((left, right) => (left.sort_order || 0) - (right.sort_order || 0))
})

function stripAt(value: string) {
  return String(value || '').trim().replace(/^@+/, '')
}

function pluralPositions(value: number | null | undefined) {
  if (value === null || value === undefined) return 'позиций'
  const mod10 = value % 10
  const mod100 = value % 100
  if (mod10 === 1 && mod100 !== 11) return 'позиция'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'позиции'
  return 'позиций'
}

function handleClose() {
  if (saving.value || resetting.value) return
  emit('close')
}

function formatError(err: unknown) {
  const code = (err as { code?: string })?.code
  if (code === 'customer_not_found') return 'Клиент с таким username не найден.'
  if (code === 'invalid_min_quantity') return 'Минимум — целое число от 1 до 10000 позиций.'
  return (err as { message?: string })?.message || 'Не удалось загрузить настройки клиента.'
}

async function search() {
  errorMessage.value = ''
  settings.value = null
  const username = stripAt(formUsername.value)
  if (!username) {
    errorMessage.value = 'Введите @username клиента.'
    return
  }
  searching.value = true
  try {
    settings.value = await crmStore.fetchCustomerWholesaleSettings(username)
    minInput.value = settings.value.customer.wholesale_min_override
  } catch (err: unknown) {
    errorMessage.value = formatError(err)
  } finally {
    searching.value = false
  }
}

async function save() {
  if (!settings.value) return
  const username = settings.value.customer.telegram_username || stripAt(formUsername.value)
  const value = minInput.value
  if (value === null || !Number.isInteger(value) || value < 1 || value > 10000) {
    errorMessage.value = 'Минимум — целое число от 1 до 10000 позиций.'
    return
  }
  errorMessage.value = ''
  saving.value = true
  try {
    const result = await crmStore.saveCustomerWholesaleMinOverride(username, value)
    settings.value = { ...settings.value!, customer: result.customer }
    emit('saved', { username, minQuantity: value })
  } catch (err: unknown) {
    errorMessage.value = formatError(err)
  } finally {
    saving.value = false
  }
}

async function reset() {
  if (!settings.value) return
  const username = settings.value.customer.telegram_username || stripAt(formUsername.value)
  errorMessage.value = ''
  resetting.value = true
  try {
    const result = await crmStore.saveCustomerWholesaleMinOverride(username, null)
    settings.value = { ...settings.value!, customer: result.customer }
    minInput.value = null
    emit('saved', { username, minQuantity: null })
  } catch (err: unknown) {
    errorMessage.value = formatError(err)
  } finally {
    resetting.value = false
  }
}

watch(
  () => props.isOpen,
  (open) => {
    if (!open) return
    formUsername.value = stripAt(props.prefill?.username || '')
    settings.value = null
    minInput.value = null
    errorMessage.value = ''
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
/* Базовые стили — эталон CustomerNoteModal (crm-note-*). */
.crm-note-form { display: grid; gap: 16px; min-width: 0; color: #081b4b; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; font-size: 13px; line-height: 1.5; }
.crm-note-form *, .crm-note-form *::before { box-sizing: border-box; }
.crm-note-section { display: grid; gap: 10px; min-width: 0; padding: 18px; border: 1px solid #eaf0f9; border-radius: 16px; background: #fff; box-shadow: 0 10px 30px #20386905; }
.crm-note-form p { margin: 0; }
.crm-note-label { color: #081b4b; font-size: 13px; font-weight: 750; }
.crm-note-form input, .crm-note-form textarea { width: 100%; min-width: 0; max-width: 100%; padding: 11px 12px; border: 1px solid #dce8fa; border-radius: 10px; background: #f7fbff; color: #081b4b; font: inherit; font-size: 13px; line-height: 1.5; box-shadow: none; }
.crm-note-form input::placeholder { color: #8999b7; opacity: 1; }
.crm-note-form :is(input, textarea, button):focus-visible { outline: 2px solid #0958ff; outline-offset: 3px; }
.crm-note-username { position: relative; }
.crm-note-username > span { position: absolute; top: 50%; left: 12px; transform: translateY(-50%); color: #66799e; pointer-events: none; }
.crm-note-username > input { padding-left: 30px; }
.crm-note-hint { color: #66799e; font-size: 11px; line-height: 1.6; }
.crm-note-customer { display: grid; gap: 3px; padding: 12px 14px; border: 1px solid #dce8fa; border-radius: 12px; background: #f7fbff; overflow-wrap: anywhere; }
.crm-note-customer strong { font-size: 14px; font-weight: 750; }
.crm-note-customer > span { color: #66799e; font-size: 12px; }
.crm-note-error { padding: 12px 14px; border: 1px solid #ffd4dc; border-radius: 12px; background: #fff4f6; color: #b82648; overflow-wrap: anywhere; }
.crm-note-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.crm-note-main-actions { display: flex; justify-content: flex-end; gap: 10px; margin-left: auto; }
.crm-note-form .crm-note-secondary { min-height: 44px; padding: 11px 18px; border: 1px solid #dce8fa; border-radius: 12px; background: linear-gradient(#f7faff, #e9f0fa); color: #233e70; font-family: inherit; font-size: 13px; font-weight: 750; cursor: pointer; }
.crm-note-form .crm-note-secondary:disabled { opacity: .5; cursor: not-allowed; }
.crm-note-form .crm-note-secondary:not(:disabled):hover { filter: brightness(1.04); }

/* Стили настроек клиента. */
.crm-customer-settings { display: grid; gap: 16px; }
.crm-customer-settings-search { display: flex; gap: 10px; align-items: stretch; }
.crm-customer-settings-field { flex: 1 1 auto; }
.crm-customer-settings-find { min-height: 44px; padding: 11px 18px; border: 1px solid transparent; border-radius: 12px; background: linear-gradient(100deg, #05b8ff, #185dff); color: #fff; font-family: inherit; font-size: 13px; font-weight: 750; cursor: pointer; box-shadow: 0 6px 14px #148cff24; }
.crm-customer-settings-find:disabled { opacity: .5; cursor: not-allowed; }
.crm-customer-settings-find:not(:disabled):hover { filter: brightness(1.04); }
.crm-customer-settings-badge { display: inline-flex; align-items: center; gap: 4px; margin-top: 10px; padding: 6px 12px; border: 1px solid #dce8fa; border-radius: 999px; background: #f0f6ff; color: #081b4b; font-size: 12px; font-weight: 750; }
.crm-customer-settings-default { margin-top: 8px; color: #66799e; font-size: 12px; }
.crm-customer-settings-tiers { display: grid; gap: 8px; }
.crm-customer-settings-tier { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; padding: 10px 14px; border: 1px solid #dce8fa; border-radius: 12px; background: #f7fbff; }
.crm-customer-settings-tier-label { color: #081b4b; font-size: 13px; font-weight: 750; }
.crm-customer-settings-tier-min { color: #66799e; font-size: 12px; font-variant-numeric: tabular-nums; }
.crm-customer-settings-edit { display: grid; gap: 10px; margin-top: 4px; }
.crm-customer-settings-input { display: grid; gap: 6px; }
.crm-customer-settings-input > span { color: #081b4b; font-size: 13px; font-weight: 750; }
.crm-customer-settings-input > input { width: 100%; }
.crm-customer-settings-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; }
.crm-customer-settings-actions button { min-height: 44px; padding: 11px 18px; border: 1px solid transparent; border-radius: 12px; font-family: inherit; font-size: 13px; font-weight: 750; cursor: pointer; }
.crm-customer-settings-actions button:disabled { opacity: .5; cursor: not-allowed; }
.crm-customer-settings-save { background: linear-gradient(100deg, #05b8ff, #185dff); color: #fff; box-shadow: 0 6px 14px #148cff24; }
.crm-customer-settings-reset { border-color: #dce8fa; background: linear-gradient(#f7faff, #e9f0fa); color: #233e70; }
.crm-customer-settings-actions button:not(:disabled):hover { filter: brightness(1.04); }
.crm-customer-settings-order { margin-top: 10px; padding: 10px 14px; border: 1px solid #eaf0f9; border-radius: 12px; background: #f7fbff; color: #425778; font-size: 12px; line-height: 1.6; }
.crm-customer-settings :is(input, button):focus-visible { outline: 2px solid #0958ff; outline-offset: 3px; }
@media (max-width: 480px) {
  .crm-customer-settings-search { flex-direction: column; }
  .crm-customer-settings-actions { width: 100%; }
  .crm-customer-settings-actions button { flex: 1; }
  .crm-customer-settings-actions .crm-customer-settings-save { order: -1; }
}
@media (prefers-reduced-motion: reduce) { .crm-customer-settings * { transition: none !important; } }
</style>
