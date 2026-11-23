<template>
  <section class="crm-ref rounded-2xl border border-gray-200 bg-white p-6 shadow-sm col-span-full">
    <!-- Шапка: заголовок, тумблер, обновить -->
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="min-w-0 space-y-1">
        <h3 class="text-lg font-semibold text-gray-900">Автоответы клиентам в Telegram</h3>
        <p class="text-sm text-gray-600">
          Бот отвечает сам, когда видит в сообщении клиента слова-триггеры. Ответ уходит от вашего имени.
        </p>
      </div>
      <div class="flex flex-shrink-0 items-center gap-3">
        <ToggleSwitch
          v-model="toggleModel"
          :label="status?.auto_replies_enabled ? 'Включены' : 'Выключены'"
          :busy="toggling"
          :disabled="loading || !status"
        />
        <button
          type="button"
          class="crm-ref-button crm-ref-button--gray"
          :disabled="loading"
          @click="refreshAll"
        >
          Обновить
        </button>
      </div>
    </div>

    <div v-if="loading && !status" class="crm-ref-stat-note mt-5">Загрузка…</div>
    <p v-else-if="loadError" class="crm-ref-notice mt-5" role="alert">
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path
          d="M10 6.2v5M10 14.2v.01M10 2.6l7.2 12.6a1.2 1.2 0 0 1-1.04 1.8H3.84a1.2 1.2 0 0 1-1.04-1.8L10 2.6Z"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <span>
        <strong>Не удалось загрузить настройки</strong>
        {{ loadError }}
      </span>
    </p>

    <template v-else-if="status">
      <!-- Три плитки состояния -->
      <div class="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
        <div class="crm-ref-stat">
          <span class="crm-ref-stat-label">Канал доставки</span>
          <span class="crm-ref-stat-value" :class="channelClass">{{ channelLabel }}</span>
        </div>

        <div class="crm-ref-stat">
          <span class="crm-ref-stat-label">Правила</span>
          <span class="crm-ref-stat-value">{{ activeRulesCount }} из {{ rules.length }}</span>
        </div>

        <div class="crm-ref-stat">
          <span class="crm-ref-stat-label">Пауза между ответами</span>
          <span class="crm-ref-stat-value">{{ cooldownLabel }}</span>
          <button type="button" class="crm-ref-link-button mt-1" @click="cooldownOpen = !cooldownOpen">
            {{ cooldownOpen ? 'Скрыть' : 'Изменить' }}
          </button>
        </div>
      </div>

      <!-- Настройка паузы -->
      <div v-if="cooldownOpen" class="crm-ref-rule mt-3">
        <div class="crm-ref-field-row">
          <div class="crm-ref-rule-row">
            <label for="cooldown-input" class="crm-ref-rule-label">Пауза, минут</label>
            <input
              id="cooldown-input"
              v-model.number="cooldownDraft"
              class="crm-ref-input"
              type="number"
              min="0"
              :max="status.cooldown_max_minutes"
              step="5"
            />
          </div>
          <button
            type="button"
            class="crm-ref-button crm-ref-button--primary"
            :disabled="cooldownSaving || !cooldownValid || cooldownDraft === status.cooldown_minutes"
            @click="saveCooldown"
          >
            {{ cooldownSaving ? 'Сохраняю…' : 'Сохранить' }}
          </button>
        </div>
        <p v-if="!cooldownValid" class="crm-ref-notice">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="M10 6.2v5M10 14.2v.01M10 2.6l7.2 12.6a1.2 1.2 0 0 1-1.04 1.8H3.84a1.2 1.2 0 0 1-1.04-1.8L10 2.6Z"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <span>Введите целое число минут от 0 до {{ status.cooldown_max_minutes }}.</span>
        </p>
        <p v-else class="crm-ref-stat-note">0 — отвечать на каждое сообщение.</p>
      </div>

      <!-- Причины, по которым не работает -->
      <div v-if="blockers.length" class="mt-3 grid gap-2">
        <p v-for="blocker in blockers" :key="blocker.code" class="crm-ref-notice">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="M10 6.2v5M10 14.2v.01M10 2.6l7.2 12.6a1.2 1.2 0 0 1-1.04 1.8H3.84a1.2 1.2 0 0 1-1.04-1.8L10 2.6Z"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <span>
            <strong>{{ blocker.message }}</strong>
            {{ blocker.hint }}
          </span>
        </p>
      </div>
      <p v-else class="crm-ref-notice crm-ref-notice--ok mt-3">
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M4.5 10.4l3.6 3.6 7.4-8"
            stroke="currentColor"
            stroke-width="1.9"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span><strong>Готово к работе</strong></span>
      </p>

      <!-- Список правил -->
      <div class="mt-5 flex flex-wrap items-center justify-between gap-3">
        <h4 class="text-base font-semibold text-gray-900">Правила</h4>
        <button
          type="button"
          class="crm-ref-button crm-ref-button--primary"
          @click="openForm(null)"
        >
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M10 4.5v11M4.5 10h11" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
          Добавить правило
        </button>
      </div>

      <p v-if="!rules.length" class="crm-ref-empty mt-3">
        <span class="crm-ref-empty-symbol">≡</span>
        <b>Правил пока нет</b>
        Добавьте первое: слова, на которые бот должен отвечать, и готовый текст ответа.
      </p>

      <ul v-else class="mt-3 grid list-none gap-3 p-0">
        <li
          v-for="(rule, index) in sortedRules"
          :key="rule.id"
          class="crm-ref-rule"
          :class="{ 'crm-ref-rule--off': !rule.is_active }"
        >
          <div class="crm-ref-rule-head">
            <div class="min-w-0">
              <h5 class="crm-ref-rule-title">{{ rule.title }}</h5>
              <div class="crm-ref-rule-meta">
                <span class="crm-ref-rule-badge" :class="rule.is_active ? 'crm-ref-rule-badge--on' : 'crm-ref-rule-badge--off'">
                  {{ rule.is_active ? 'Включено' : 'Выключено' }}
                </span>
                <span v-if="hitCount(rule.id)" class="crm-ref-rule-badge crm-ref-rule-badge--hits">
                  Сработало {{ hitCount(rule.id) }} раз
                </span>
                <span v-else class="crm-ref-rule-badge">Ещё не срабатывало</span>
              </div>
            </div>

            <div class="crm-ref-rule-order">
              <button
                type="button"
                :disabled="index === 0 || movingId === rule.id"
                aria-label="Поднять правило выше"
                @click="move(rule, 'up')"
              >
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M5 12.5l5-5 5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
              <button
                type="button"
                :disabled="index === sortedRules.length - 1 || movingId === rule.id"
                aria-label="Опустить правило ниже"
                @click="move(rule, 'down')"
              >
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M5 7.5l5 5 5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
            </div>
          </div>

          <div class="crm-ref-rule-body">
            <div class="crm-ref-rule-row">
              <span class="crm-ref-rule-label">Слова-триггеры</span>
              <div v-if="rule.keywords.length" class="crm-ref-rule-meta">
                <span v-for="word in rule.keywords" :key="word" class="crm-ref-rule-badge">{{ word }}</span>
              </div>
              <p v-else class="crm-ref-rule-text">Слова не заданы — правило не сработает.</p>
            </div>

            <div class="crm-ref-rule-row">
              <span class="crm-ref-rule-label">Ответ</span>
              <p class="crm-ref-rule-text">{{ rule.response_text }}</p>
            </div>
          </div>

          <div class="crm-ref-rule-actions">
            <button type="button" class="crm-ref-chip-button" @click="openForm(rule)">Изменить</button>
            <button
              type="button"
              class="crm-ref-chip-button"
              :disabled="busyId === rule.id"
              @click="toggleRule(rule)"
            >
              {{ rule.is_active ? 'Выключить' : 'Включить' }}
            </button>
            <button
              type="button"
              class="crm-ref-chip-button crm-ref-chip-button--danger"
              :disabled="busyId === rule.id"
              @click="askDelete(rule)"
            >
              Удалить
            </button>
          </div>
        </li>
      </ul>
    </template>

    <!-- Форма правила -->
    <QuickReplyForm
      :is-open="formOpen"
      :editing="editingRule"
      @close="formOpen = false"
      @saved="onSaved"
    />

    <!-- Подтверждение удаления -->
    <AdminModal
      :is-open="deleteTarget !== null"
      title="Удалить правило"
      reference-design
      size="sm"
      :show-actions="false"
      :is-loading="deleting"
      @close="deleteTarget = null"
    >
      <form class="crm-restriction-form" @submit.prevent="confirmDelete">
        <p class="crm-restriction-danger-note">
          Правило «<strong>{{ deleteTarget?.title }}</strong>» будет удалено. Бот перестанет
          отвечать на его слова-триггеры. Действие нельзя отменить.
        </p>
        <div class="crm-restriction-actions">
          <button type="button" class="crm-restriction-secondary" :disabled="deleting" @click="deleteTarget = null">
            Отмена
          </button>
          <button type="submit" class="crm-restriction-danger" :disabled="deleting">
            {{ deleting ? 'Удаляю…' : 'Удалить' }}
          </button>
        </div>
      </form>
    </AdminModal>
  </section>
</template>

<script setup lang="ts">
/**
 * Автоответы клиентам: включает/выключает бот, ведёт правила со словами-триггерами
 * и показывает, почему автоответ не уйдёт, если что-то настроено не так.
 */
import { computed, onMounted, ref } from 'vue';
import AdminModal from '@/components/AdminModal.vue';
import QuickReplyForm, { type QuickReplyRule } from './QuickReplyForm.vue';
import ToggleSwitch from './ToggleSwitch.vue';
// Стили системы модалок — их использует окно подтверждения удаления.
import '@/styles/crm-restriction-modals.css';

interface Blocker {
  code: string;
  message: string;
  hint: string;
}

interface BotStatus {
  auto_replies_enabled: boolean;
  delivery_ready: boolean;
  userbot_connected: boolean;
  bot_process_online: boolean;
  active_connection: unknown;
  quick_reply_count: number;
  quick_reply_active_count: number;
  recent_log_count: number;
  /** Срабатываний по каждому правилу: { [ruleId]: count }. Считает сервер. */
  auto_reply_hits?: Record<string, number>;
  auto_reply_blockers: Blocker[];
  cooldown_minutes: number;
  cooldown_default_minutes: number;
  cooldown_max_minutes: number;
}

const status = ref<BotStatus | null>(null);
const rules = ref<QuickReplyRule[]>([]);
const loading = ref(false);
const loadError = ref<string | null>(null);
const toggling = ref(false);
const busyId = ref<number | null>(null);
const movingId = ref<number | null>(null);
const deleting = ref(false);
const deleteTarget = ref<QuickReplyRule | null>(null);
const formOpen = ref(false);
const editingRule = ref<QuickReplyRule | null>(null);
const cooldownOpen = ref(false);
const cooldownDraft = ref(30);
const cooldownSaving = ref(false);

const sortedRules = computed(() =>
  [...rules.value].sort((a, b) => (a.sort_order - b.sort_order) || (a.id - b.id)),
);

const activeRulesCount = computed(() => rules.value.filter((r) => r.is_active).length);
const blockers = computed(() => status.value?.auto_reply_blockers ?? []);

/**
 * Тумблер отправляет запрос сразу по клику. Значение держим отдельным ref,
 * чтобы переключатель не «отскакивал» назад, пока идёт запрос.
 */
const toggleModel = computed({
  get: () => Boolean(status.value?.auto_replies_enabled),
  set: (value: boolean) => void toggleAutoReplies(value),
});

const channelLabel = computed(() => {
  if (!status.value) return '—';
  if (status.value.delivery_ready) return 'Готов';
  return 'Недоступен';
});

const channelClass = computed(() => {
  if (!status.value) return '';
  return status.value.delivery_ready ? 'crm-ref-stat-value--ok' : 'crm-ref-stat-value--warn';
});

/**
 * Пустое поле или мусор не должны сохраняться как 0: `Number('')` даёт 0, и
 * пауза молча выключалась бы — бот начал бы отвечать на каждое сообщение.
 */
const cooldownValid = computed(() => {
  const raw: unknown = cooldownDraft.value;
  // Поле очищено — v-model.number отдаёт пустую строку; это не 0.
  if (raw === null || raw === undefined || String(raw).trim() === '') return false;
  const value = Number(raw);
  if (!Number.isFinite(value)) return false;
  if (!Number.isInteger(value)) return false;
  return value >= 0 && value <= (status.value?.cooldown_max_minutes ?? 1440);
});

const cooldownLabel = computed(() => {
  const minutes = status.value?.cooldown_minutes ?? 0;
  if (minutes <= 0) return 'Без паузы';
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
});

function hitCount(id: number): number {
  return Number(status.value?.auto_reply_hits?.[String(id)] ?? 0);
}


async function fetchStatus() {
  const response = await fetch('/api/admin/crm/bot/status', { credentials: 'include' });
  if (!response.ok) throw new Error('status_failed');
  const data = await response.json();
  status.value = data;
  cooldownDraft.value = Number(data?.cooldown_minutes ?? 0);
}

async function fetchRules() {
  const response = await fetch('/api/admin/crm/bot/quick-replies', { credentials: 'include' });
  if (!response.ok) throw new Error('rules_failed');
  const data = await response.json();
  rules.value = Array.isArray(data?.items) ? data.items : [];
}

async function refreshAll() {
  loading.value = true;
  loadError.value = null;
  try {
    await Promise.all([fetchStatus(), fetchRules()]);
  } catch {
    loadError.value = 'Сервер не ответил. Проверьте связь и нажмите «Обновить».';
  } finally {
    loading.value = false;
  }
}

async function toggleAutoReplies(value: boolean) {
  if (!status.value || toggling.value) return;
  toggling.value = true;
  const previous = status.value.auto_replies_enabled;
  status.value = { ...status.value, auto_replies_enabled: value };
  try {
    const response = await fetch('/api/admin/crm/bot/settings', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_replies_enabled: value }),
    });
    if (!response.ok) throw new Error('toggle_failed');
    const data = await response.json();
    if (status.value) {
      status.value = {
        ...status.value,
        auto_replies_enabled: Boolean(data?.auto_replies_enabled),
        auto_reply_blockers: data?.blockers ?? status.value.auto_reply_blockers,
      };
    }
  } catch {
    // Возвращаем как было: молчаливое расхождение с сервером хуже ошибки.
    if (status.value) status.value = { ...status.value, auto_replies_enabled: previous };
    loadError.value = 'Не удалось переключить автоответы. Попробуйте ещё раз.';
  } finally {
    toggling.value = false;
  }
}

async function saveCooldown() {
  if (!status.value || !cooldownValid.value) return;
  cooldownSaving.value = true;
  try {
    const response = await fetch('/api/admin/crm/bot/settings', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cooldown_minutes: cooldownDraft.value }),
    });
    if (!response.ok) throw new Error('cooldown_failed');
    await fetchStatus();
    cooldownOpen.value = false;
  } catch {
    loadError.value = 'Не удалось сохранить паузу. Попробуйте ещё раз.';
  } finally {
    cooldownSaving.value = false;
  }
}

function openForm(rule: QuickReplyRule | null) {
  editingRule.value = rule;
  formOpen.value = true;
}

async function onSaved() {
  await Promise.all([fetchRules(), fetchStatus()]);
}

async function toggleRule(rule: QuickReplyRule) {
  busyId.value = rule.id;
  try {
    const response = await fetch(`/api/admin/crm/bot/quick-replies/${rule.id}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: rule.title,
        keywords: rule.keywords,
        response_text: rule.response_text,
        is_active: rule.is_active ? 0 : 1,
        sort_order: rule.sort_order,
      }),
    });
    if (!response.ok) throw new Error('toggle_rule_failed');
    await Promise.all([fetchRules(), fetchStatus()]);
  } catch {
    loadError.value = 'Не удалось изменить правило. Попробуйте ещё раз.';
  } finally {
    busyId.value = null;
  }
}

async function move(rule: QuickReplyRule, direction: 'up' | 'down') {
  movingId.value = rule.id;
  try {
    const response = await fetch(`/api/admin/crm/bot/quick-replies/${rule.id}/move`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction }),
    });
    if (!response.ok) throw new Error('move_failed');
    const data = await response.json();
    if (Array.isArray(data?.items)) rules.value = data.items;
  } catch {
    loadError.value = 'Не удалось изменить порядок. Попробуйте ещё раз.';
  } finally {
    movingId.value = null;
  }
}

function askDelete(rule: QuickReplyRule) {
  deleteTarget.value = rule;
}

async function confirmDelete() {
  const target = deleteTarget.value;
  if (!target) return;
  deleting.value = true;
  try {
    const response = await fetch(`/api/admin/crm/bot/quick-replies/${target.id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!response.ok) throw new Error('delete_failed');
    deleteTarget.value = null;
    await Promise.all([fetchRules(), fetchStatus()]);
  } catch {
    loadError.value = 'Не удалось удалить правило. Попробуйте ещё раз.';
  } finally {
    deleting.value = false;
  }
}

onMounted(refreshAll);
</script>
