<template>
  <section class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm col-span-full">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="space-y-1">
        <h3 class="text-lg font-semibold text-gray-900">
          Telegram-уведомления клиентам
        </h3>
        <p class="text-sm text-gray-600">
          Сообщения о заказе уходят клиенту от вашего имени. Здесь можно настроить сообщения и автоответы.
        </p>
      </div>
      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        :disabled="loading"
        @click="refreshAll"
      >
        Обновить
      </button>
    </div>

    <div v-if="loading && !status" class="mt-6 text-sm text-gray-500">Загрузка…</div>
    <div v-else-if="loadError" class="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
      {{ loadError }}
    </div>
    <template v-else-if="status">
      <!-- Status overview ---------------------------------------------------->
      <div class="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        <div class="rounded-xl border border-gray-200 bg-gray-50/70 p-4">
          <p class="text-xs uppercase tracking-wide text-gray-500">Связь с Telegram</p>
          <p class="mt-1 text-sm font-semibold" :class="connectionLabelClass">
            {{ connectionLabel }}
          </p>
          <p class="mt-0.5 text-xs text-gray-600">{{ deliveryHint }}</p>
        </div>

        <div class="rounded-xl border border-gray-200 bg-gray-50/70 p-4">
          <p class="text-xs uppercase tracking-wide text-gray-500">Автоответы клиентам</p>
          <label class="mt-1 inline-flex items-center gap-2 text-sm font-medium text-gray-700">
            <input
              type="checkbox"
              :checked="status.auto_replies_enabled"
              :disabled="autoToggleBusy"
              class="h-4 w-4 rounded"
              @change="onToggleAutoReplies(($event.target as HTMLInputElement).checked)"
            />
            {{ status.auto_replies_enabled ? 'Включены' : 'Выключены' }}
          </label>
          <p class="mt-1 text-xs text-gray-500">
            <template v-if="status.quick_reply_count === 0">
              Ответов ещё нет. Добавьте их во вкладке «Быстрые ответы».
            </template>
            <template v-else>
              Включено {{ status.quick_reply_active_count }} из {{ status.quick_reply_count }}. Автоответ срабатывает по ключевым словам клиента.
            </template>
          </p>
        </div>

        <div class="rounded-xl border border-gray-200 bg-gray-50/70 p-4">
          <p class="text-xs uppercase tracking-wide text-gray-500">Сообщения за 24 часа</p>
          <p class="mt-1 text-2xl font-bold text-gray-900">{{ status.recent_log_count }}</p>
          <p class="mt-1 text-xs text-gray-500">записей в истории</p>
        </div>
      </div>

      <!-- Tabs ---------------------------------------------------------------->
      <nav class="mt-6 flex flex-wrap gap-2 border-b border-gray-200 pb-2 text-sm">
        <button
          v-for="tab in TABS"
          :key="tab.id"
          type="button"
          class="rounded-md px-3 py-1.5 font-medium transition"
          :class="
            activeTab === tab.id
              ? 'bg-slate-900 text-white'
              : 'bg-white text-gray-700 hover:bg-gray-100'
          "
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </nav>

      <!-- Tab: Quick replies ---------------------------------------------->
      <div v-if="activeTab === 'quick'" class="mt-4 space-y-3">
        <div class="flex items-start justify-between gap-3">
          <p class="text-sm text-gray-600">
            Автоответ ищет ключевые слова в сообщении клиента. Заглавные и строчные буквы, а также е/ё не различаются. Если подходит несколько ответов, система выберет наиболее точный.
          </p>
          <button
            type="button"
            class="flex-shrink-0 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
            @click="openQuickReplyForm(null)"
          >
            + Добавить
          </button>
        </div>

        <div
          v-if="!quickReplies.length"
          class="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-6 py-8 text-center text-sm text-gray-500"
        >
          Быстрых ответов пока нет. Добавьте первый и включите авто-ответы в карточке выше.
        </div>
        <ul v-else class="space-y-2">
          <li
            v-for="reply in sortedQuickReplies"
            :key="reply.id"
            class="rounded-xl border border-gray-200 bg-gray-50/70 p-3"
          >
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <p class="text-sm font-semibold text-gray-900">{{ reply.title }}</p>
                  <span
                    :class="
                      reply.is_active
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-gray-200 text-gray-600'
                    "
                    class="rounded-full px-2 py-0.5 text-[11px] font-medium"
                  >{{ reply.is_active ? 'Активен' : 'Скрыт' }}</span>
                  <span class="text-[11px] text-gray-500">место в списке: {{ reply.sort_order }}</span>
                </div>
                <p class="mt-1 text-xs text-gray-500">
                  Ключевые слова:
                  <span v-if="reply.keywords.length">
                    <code
                      v-for="(kw, idx) in reply.keywords"
                      :key="idx"
                      class="mx-0.5 rounded bg-white px-1.5 py-0.5 text-[11px] text-gray-700 ring-1 ring-gray-200"
                    >{{ kw }}</code>
                  </span>
                  <span v-else class="italic text-gray-400">не заданы (никогда не сработает)</span>
                </p>
                <p class="mt-1 line-clamp-2 text-xs text-gray-700">{{ reply.response_text }}</p>
              </div>
              <div class="flex flex-shrink-0 gap-2">
                <button
                  type="button"
                  class="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-100"
                  @click="openQuickReplyForm(reply)"
                >Редактировать</button>
                <button
                  type="button"
                  class="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
                  :disabled="busyId === reply.id"
                  @click="deleteQuickReply(reply)"
                >Удалить</button>
              </div>
            </div>
          </li>
        </ul>
      </div>

      <!-- Tab: Status templates ---------------------------------------------->
      <div v-if="activeTab === 'status'" class="mt-4 space-y-3">
        <p class="text-sm text-gray-600">
          Тексты, которые отправляются клиенту. Вставка
          <code class="rounded bg-gray-100 px-1 py-0.5">{order_number}</code>
          покажет клиенту короткий номер заказа.
          <code class="rounded bg-gray-100 px-1 py-0.5">{pickup_cell_number}</code>
          покажет тот же номер. Другие вставки:
          <code class="rounded bg-gray-100 px-1 py-0.5">{final_amount}</code> покажет сумму заказа,
          <code class="rounded bg-gray-100 px-1 py-0.5">{customer_name}</code> имя клиента,
          <code class="rounded bg-gray-100 px-1 py-0.5">{customer_username}</code> имя клиента в Telegram,
          <code class="rounded bg-gray-100 px-1 py-0.5">{verification_code}</code> код доступа,
          <code class="rounded bg-gray-100 px-1 py-0.5">{store_name}</code> название магазина.
          <span class="mt-1 block">
            Полный номер заказа клиенту не отправляется.
          </span>
        </p>
        <p class="text-sm text-gray-600">
          В сообщениях о заказе и прайсе можно сделать текст жирным, курсивным или добавить ссылку:
          <span class="mt-1 flex flex-wrap gap-1.5 pr-12 sm:pr-0">
            <code class="rounded bg-gray-100 px-1 py-0.5">&lt;b&gt;жирный&lt;/b&gt;</code>
            <code class="rounded bg-gray-100 px-1 py-0.5">&lt;i&gt;курсив&lt;/i&gt;</code>
            <code class="min-w-0 max-w-full break-all whitespace-normal rounded bg-gray-100 px-1 py-0.5">&lt;a href=&quot;https://site.by&quot;&gt;название ссылки&lt;/a&gt;</code>
          </span>
        </p>
        <div class="space-y-3">
          <div
            v-for="event in statusEvents"
            :key="event"
            class="rounded-xl border border-gray-200 bg-gray-50/70 p-4"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p class="text-sm font-semibold text-gray-900">
                  {{ statusEventLabel(event, getTemplateForEvent(event)?.title) }}
                </p>
              </div>
              <label class="inline-flex items-center gap-2 text-xs text-gray-600">
                <input
                  type="checkbox"
                  :checked="getTemplateForEvent(event)?.is_active === 1"
                  :disabled="busyEvent === event"
                  class="h-4 w-4 rounded"
                  @change="onToggleStatusActive(event, ($event.target as HTMLInputElement).checked)"
                />
                Активен
              </label>
            </div>
            <textarea
              :value="statusBodyDraft[event] ?? getTemplateForEvent(event)?.body ?? ''"
              rows="4"
              maxlength="4000"
              class="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-xs text-gray-800 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
              @input="onInputStatusBody(event, ($event.target as HTMLTextAreaElement).value)"
              @blur="onBlurStatusBody(event, ($event.target as HTMLTextAreaElement).value)"
            ></textarea>
            <p class="mt-1 text-[11px] text-gray-500">
              <template v-if="statusBodyDirty[event]">
                <span class="font-semibold text-amber-700">Не сохранено.</span>
                Кликните вне поля, чтобы применить.
              </template>
              <template v-else>
                Сохраняется автоматически, когда уйдёте из поля.
              </template>
            </p>
          </div>
        </div>
      </div>

      <!-- Tab: Log ----------------------------------------------------------->
      <div v-if="activeTab === 'log'" class="mt-4 space-y-3">
        <p class="text-sm text-gray-600">
          Последние 50 сообщений. Зелёная метка означает, что сообщение ушло клиенту, красная, что оно не дошло.
        </p>
        <div v-if="!logItems.length" class="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-6 py-8 text-center text-sm text-gray-500">
          Пока пусто. Записи появятся после первого сообщения.
        </div>
        <ul v-else class="space-y-2">
          <li
            v-for="entry in logItems"
            :key="entry.id"
            class="rounded-lg border px-3 py-2"
            :class="logEntryClass(entry)"
          >
            <div class="flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-500">
              <span class="flex flex-wrap items-center gap-1.5">
                {{ entry.direction === 'out' ? 'бот → клиенту' : 'клиент → менеджеру' }}
                · {{ messageTypeLabel(entry.message_type) }}
                <template v-if="entry.template_event">· {{ statusEventLabel(entry.template_event) }}</template>
                <span
                  v-if="logBadge(entry)"
                  class="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                  :class="logBadge(entry)?.cls"
                >{{ logBadge(entry)?.text }}</span>
              </span>
              <span>{{ entry.created_at }} · чат №{{ entry.chat_id }}</span>
            </div>
            <p class="mt-1 whitespace-pre-wrap text-xs text-gray-800">{{ entry.text || 'Нет текста' }}</p>
            <p
              v-if="entry.meta?.outcome === 'failed' && entry.meta?.error"
              class="mt-1 text-[11px] font-medium text-red-700"
            >{{ describeBotError(entry.meta.error) }}</p>
          </li>
        </ul>
      </div>
    </template>

    <!-- Quick reply form modal -->
    <AdminModal
      :isOpen="quickReplyFormOpen"
      :title="editingQuickReplyId ? 'Редактировать быстрый ответ' : 'Новый быстрый ответ'"
      size="lg"
      :showActions="false"
      @cancel="closeQuickReplyForm"
      @close="closeQuickReplyForm"
    >
      <form @submit.prevent="submitQuickReply" class="space-y-4">
        <div class="space-y-2">
          <label class="text-sm font-medium text-gray-700">Название</label>
          <input
            v-model="qrForm.title"
            type="text"
            required
            maxlength="200"
            class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
            placeholder="Например: Часы работы"
          />
        </div>
        <div class="space-y-2">
          <label class="text-sm font-medium text-gray-700">
            Ключевые слова через запятую
          </label>
          <input
            v-model="qrForm.keywordsInput"
            type="text"
            class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
            placeholder="работаете, часы, до скольки"
          />
          <p class="text-[11px] text-gray-500">
            Заглавные и строчные буквы, а также е/ё не различаются. Ответ сработает, если ключевое слово встретится отдельно или внутри другого слова.
          </p>
        </div>
        <div class="space-y-2">
          <label class="text-sm font-medium text-gray-700">Текст ответа</label>
          <textarea
            v-model="qrForm.response_text"
            rows="6"
            required
            maxlength="4000"
            class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
            placeholder="Работаем с 12:00 до 23:00, без выходных. Адрес выдачи..."
          ></textarea>
        </div>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label class="flex items-center gap-2 text-sm text-gray-700">
            <input v-model="qrForm.is_active" type="checkbox" class="h-4 w-4 rounded" />
            Активен
          </label>
          <div class="space-y-1">
            <label class="text-xs font-medium text-gray-600">Место в списке (меньшее число ставит ответ выше)</label>
            <input
              v-model.number="qrForm.sort_order"
              type="number"
              min="0"
              step="1"
              class="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
            />
          </div>
        </div>

        <div v-if="formError" class="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
          {{ formError }}
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <button
            type="button"
            class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
            @click="closeQuickReplyForm"
          >Отмена</button>
          <button
            type="submit"
            :disabled="formSubmitting || !qrForm.title.trim() || !qrForm.response_text.trim()"
            class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {{ formSubmitting ? 'Сохранение…' : editingQuickReplyId ? 'Сохранить' : 'Создать' }}
          </button>
        </div>
      </form>
    </AdminModal>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import AdminModal from "@/components/AdminModal.vue";

interface QuickReply {
  id: number;
  title: string;
  keywords: string[];
  response_text: string;
  is_active: 0 | 1;
  sort_order: number;
}

interface StatusTemplate {
  id: number;
  event: string;
  title: string;
  body: string;
  is_active: 0 | 1;
}

interface BotConnection {
  id: string;
  user_id: string | null;
  username: string | null;
  is_enabled: 0 | 1;
  can_reply: 0 | 1;
  disconnected_at: string | null;
}

interface BotStatus {
  auto_replies_enabled: boolean;
  bot_token_configured: boolean;
  bot_token_live: boolean;
  bot_token_error: string | null;
  bot_process_online: boolean;
  active_connection: BotConnection | null;
  connections: BotConnection[];
  userbot_connected: boolean;
  delivery_ready: boolean;
  quick_reply_count: number;
  quick_reply_active_count: number;
  status_templates: StatusTemplate[];
  recent_log_count: number;
}

interface BotLogEntry {
  id: number;
  business_connection_id: string | null;
  chat_id: string;
  direction: "in" | "out";
  message_type: string;
  template_event: string | null;
  text: string | null;
  created_at: string | null;
  meta: {
    outcome?: "sent" | "failed";
    auto?: boolean;
    error?: string;
    order_id?: string;
    [key: string]: unknown;
  } | null;
}

const TABS = [
  { id: "quick", label: "Быстрые ответы" },
  { id: "status", label: "Сообщения клиентам" },
  { id: "log", label: "История" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const STATUS_EVENT_LABELS: Record<string, string> = {
  order_accepted: "Заказ принят",
  order_assembled: "Заказ собран",
  order_issued: "Заказ выдан",
  order_cancelled: "Заказ отменён",
  price_list: "Выдача прайса (с кодом)",
  welcome: "Приветствие новому клиенту",
};

const MESSAGE_TYPE_LABELS: Record<string, string> = {
  incoming: "Входящее",
  manual: "Отправлено вручную",
  status: "Сообщение о заказе",
  quick_reply: "Автоответ",
  price: "Прайс",
  unmatched: "Без автоответа",
};

function statusEventLabel(event: string, fallbackTitle?: string) {
  return STATUS_EVENT_LABELS[event] || fallbackTitle || "Другое сообщение";
}

function messageTypeLabel(messageType: string) {
  return MESSAGE_TYPE_LABELS[messageType] || "Другое сообщение";
}

/**
 * Подсветка фона строки в журнале по итогу отправки. Костя 9.05.2026
 * жаловался, что в журнале не видно, дошло сообщение до клиента или
 * нет (`outcome=sent` или `failed` отображались одинаково).
 */
function logEntryClass(entry: BotLogEntry): string {
  if (entry.direction === 'out' && entry.meta?.outcome === 'failed') {
    return 'border-red-200 bg-red-50/60';
  }
  if (entry.direction === 'out') {
    return 'border-blue-100 bg-blue-50/40';
  }
  return 'border-gray-200 bg-white';
}

function logBadge(entry: BotLogEntry): { text: string; cls: string } | null {
  if (entry.direction !== 'out') return null;
  const outcome = entry.meta?.outcome;
  if (outcome === 'sent') return { text: 'ушло', cls: 'bg-emerald-100 text-emerald-700' };
  if (outcome === 'failed') return { text: 'не дошло', cls: 'bg-red-100 text-red-700' };
  return null;
}

/**
 * Короткая расшифровка кодов Telegram для журнала. Менеджер видит
 * причину одной фразой без длинных объяснений.
 */
function describeBotError(raw: string): string {
  if (!raw) return 'Не дошло.';
  if (raw.includes('BUSINESS_PEER_USAGE_MISSING')) return 'Клиент отключил бота в своём чате.';
  if (raw.includes('PEER_ID_INVALID')) return 'Клиент ни разу не писал в чат.';
  if (raw.includes('USER_IS_BLOCKED') || raw.toLowerCase().includes('user is blocked')) {
    return 'Клиент заблокировал бота.';
  }
  if (raw.toLowerCase().includes('timeout') || raw.toLowerCase().includes('fetch failed')) {
    return 'Сеть подвела, Telegram не ответил вовремя.';
  }
  return raw;
}

const status = ref<BotStatus | null>(null);
const quickReplies = ref<QuickReply[]>([]);
const logItems = ref<BotLogEntry[]>([]);
const loading = ref(false);
const loadError = ref<string | null>(null);
const activeTab = ref<TabId>("quick");
const autoToggleBusy = ref(false);
const busyId = ref<number | null>(null);
const busyEvent = ref<string | null>(null);

// Локальный draft статусных шаблонов: пока пользователь печатает в textarea,
// мы НЕ перезаписываем его ввод свежим значением из бэка (защита от
// race-condition'а между набором текста и фоновым refresh status).
const statusBodyDraft = reactive<Record<string, string>>({});
const statusBodyDirty = reactive<Record<string, boolean>>({});

const quickReplyFormOpen = ref(false);
const editingQuickReplyId = ref<number | null>(null);
const formSubmitting = ref(false);
const formError = ref<string | null>(null);
const qrForm = reactive({
  title: "",
  keywordsInput: "",
  response_text: "",
  is_active: true,
  sort_order: 0,
});

const sortedQuickReplies = computed(() =>
  [...quickReplies.value].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.id - b.id;
  }),
);

const statusEvents = computed(() => {
  // Рендерим события в порядке как пришли с бэка (он их кладёт по UNIQUE event,
  // вместе с дефолтным сидом в миграции, поэтому порядок стабилен).
  // Устаревшее welcome не отправляется из этого шаблона: настоящее приветствие
  // настраивается в Telegram как быстрый ответ «Прайс».
  return (status.value?.status_templates || [])
    .map((t) => t.event)
    .filter((event) => event !== "welcome");
});

// Главный индикатор показывает, может ли вообще что-то уйти клиенту.
// Userbot служит основным каналом без 24ч окна, Business-mode запасным.
// Если работает хоть один, показываем «Готова», иначе «Не готова».
const connectionLabel = computed(() => {
  if (!status.value) return "Загрузка";
  if (status.value.userbot_connected) return "Работает";
  if (status.value.bot_token_live && status.value.active_connection) return "Работает с ограничением";
  if (!status.value.bot_token_configured) return "Не настроен";
  if (!status.value.bot_token_live) return "Не подключён";
  return "Не работает";
});

const connectionLabelClass = computed(() => {
  if (!status.value) return "text-gray-700";
  if (status.value.delivery_ready) return "text-emerald-700";
  return "text-red-700";
});

const deliveryHint = computed(() => {
  if (!status.value) return "";
  if (status.value.userbot_connected) {
    return "Сообщения идут от вашего имени без ограничений по времени.";
  }
  if (status.value.bot_token_live && status.value.active_connection) {
    return "Сообщения получат только клиенты, которые писали в чат за последние сутки.";
  }
  return "Сообщения клиентам сейчас не уходят.";
});

function getTemplateForEvent(event: string): StatusTemplate | null {
  return status.value?.status_templates.find((t) => t.event === event) || null;
}

async function fetchStatus() {
  const response = await fetch("/api/admin/crm/bot/status", { credentials: "include" });
  if (!response.ok) throw new Error("Не удалось проверить связь с Telegram");
  status.value = (await response.json()) as BotStatus;
}

async function fetchQuickReplies() {
  const response = await fetch("/api/admin/crm/bot/quick-replies", { credentials: "include" });
  if (!response.ok) throw new Error("Не удалось загрузить быстрые ответы");
  const data = (await response.json()) as { items: QuickReply[] };
  quickReplies.value = Array.isArray(data?.items) ? data.items : [];
}

async function fetchLog() {
  const response = await fetch("/api/admin/crm/bot/log?limit=50", { credentials: "include" });
  if (!response.ok) throw new Error("Не удалось загрузить историю");
  const data = (await response.json()) as { items: BotLogEntry[] };
  logItems.value = Array.isArray(data?.items) ? data.items : [];
}

async function refreshAll() {
  loading.value = true;
  loadError.value = null;
  try {
    await Promise.all([fetchStatus(), fetchQuickReplies(), fetchLog()]);
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function onToggleAutoReplies(next: boolean) {
  autoToggleBusy.value = true;
  try {
    const response = await fetch("/api/admin/crm/bot/settings", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auto_replies_enabled: next }),
    });
    if (!response.ok) throw new Error("Не удалось сохранить настройку");
    if (status.value) status.value.auto_replies_enabled = next;
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err));
    if (status.value) {
      // откатим UI на фактическое состояние
      await fetchStatus();
    }
  } finally {
    autoToggleBusy.value = false;
  }
}

async function onToggleStatusActive(event: string, next: boolean) {
  const template = getTemplateForEvent(event);
  if (!template) return;
  busyEvent.value = event;
  try {
    const response = await fetch(
      `/api/admin/crm/bot/status-templates/${encodeURIComponent(event)}`,
      {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: template.title,
          body: template.body,
          is_active: next ? 1 : 0,
        }),
      },
    );
    if (!response.ok) throw new Error("Не удалось обновить сообщение");
    await fetchStatus();
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err));
  } finally {
    busyEvent.value = null;
  }
}

function onInputStatusBody(event: string, value: string) {
  statusBodyDraft[event] = value;
  const original = getTemplateForEvent(event)?.body ?? "";
  statusBodyDirty[event] = value !== original;
}

async function onBlurStatusBody(event: string, body: string) {
  const template = getTemplateForEvent(event);
  if (!template) return;
  if (template.body === body) {
    delete statusBodyDraft[event];
    delete statusBodyDirty[event];
    return;
  }
  busyEvent.value = event;
  try {
    const response = await fetch(
      `/api/admin/crm/bot/status-templates/${encodeURIComponent(event)}`,
      {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: template.title,
          body,
          is_active: template.is_active,
        }),
      },
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(
        (data as { error?: string }).error === "body_too_long"
          ? "Текст слишком длинный (максимум 4000 символов)"
          : (data as { message?: string }).message || "Не удалось сохранить сообщение",
      );
    }
    delete statusBodyDraft[event];
    delete statusBodyDirty[event];
    await fetchStatus();
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err));
    // На ошибке оставляем draft в reactive, чтобы пользователь не терял ввод.
  } finally {
    busyEvent.value = null;
  }
}

function resetQrForm() {
  qrForm.title = "";
  qrForm.keywordsInput = "";
  qrForm.response_text = "";
  qrForm.is_active = true;
  qrForm.sort_order = quickReplies.value.length
    ? Math.max(...quickReplies.value.map((r) => r.sort_order)) + 10
    : 0;
}

function openQuickReplyForm(reply: QuickReply | null) {
  formError.value = null;
  if (reply) {
    editingQuickReplyId.value = reply.id;
    qrForm.title = reply.title;
    qrForm.keywordsInput = reply.keywords.join(", ");
    qrForm.response_text = reply.response_text;
    qrForm.is_active = Boolean(reply.is_active);
    qrForm.sort_order = reply.sort_order;
  } else {
    editingQuickReplyId.value = null;
    resetQrForm();
  }
  quickReplyFormOpen.value = true;
}

function closeQuickReplyForm() {
  quickReplyFormOpen.value = false;
  editingQuickReplyId.value = null;
  formError.value = null;
}

function parseKeywords(input: string): string[] {
  return input
    .split(/[,\n]/)
    .map((k) => k.trim())
    .filter(Boolean);
}

async function submitQuickReply() {
  if (!qrForm.title.trim() || !qrForm.response_text.trim()) return;
  formSubmitting.value = true;
  formError.value = null;
  try {
    const payload = {
      title: qrForm.title.trim(),
      keywords: parseKeywords(qrForm.keywordsInput),
      response_text: qrForm.response_text,
      is_active: qrForm.is_active ? 1 : 0,
      sort_order: qrForm.sort_order,
    };
    const url = editingQuickReplyId.value
      ? `/api/admin/crm/bot/quick-replies/${editingQuickReplyId.value}`
      : "/api/admin/crm/bot/quick-replies";
    const method = editingQuickReplyId.value ? "PUT" : "POST";
    const response = await fetch(url, {
      method,
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const code = data?.error;
      const map: Record<string, string> = {
        title_required: "Название обязательно",
        title_too_long: "Название слишком длинное (максимум 200)",
        response_required: "Текст ответа обязателен",
        response_too_long: "Текст ответа слишком длинный (максимум 4000)",
        keywords_too_long: "Слишком много ключевых слов (не более 1000 символов)",
        quick_reply_not_found: "Запись не найдена. Обновите список",
      };
      formError.value = map[code] || data?.message || "Не удалось сохранить";
      return;
    }
    closeQuickReplyForm();
    await Promise.all([fetchQuickReplies(), fetchStatus()]);
  } catch (err) {
    formError.value = err instanceof Error ? err.message : String(err);
  } finally {
    formSubmitting.value = false;
  }
}

async function deleteQuickReply(reply: QuickReply) {
  if (!confirm(`Удалить быстрый ответ «${reply.title}»?`)) return;
  busyId.value = reply.id;
  try {
    const response = await fetch(`/api/admin/crm/bot/quick-replies/${reply.id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!response.ok) {
      await fetchQuickReplies();
      const data = await response.json().catch(() => ({}));
      throw new Error(
        data?.error === "quick_reply_not_found"
          ? "Уже удалено"
          : data?.message || "Не удалось удалить",
      );
    }
    quickReplies.value = quickReplies.value.filter((r) => r.id !== reply.id);
    await fetchStatus();
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err));
  } finally {
    busyId.value = null;
  }
}

onMounted(() => {
  refreshAll();
});
</script>
