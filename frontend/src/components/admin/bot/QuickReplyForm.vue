<template>
  <AdminModal
    :is-open="isOpen"
    :title="editing ? 'Изменить правило' : 'Новое правило'"
    description="Бот отвечает сам, когда видит слова-триггеры в сообщении клиента."
    size="md"
    reference-design
    :is-loading="submitting"
    :show-actions="false"
    @close="handleClose"
  >
    <form class="crm-restriction-form" @submit.prevent="submit">
      <fieldset class="crm-restriction-fields" :disabled="submitting">
        <div class="crm-restriction-row">
          <label for="rule-title" class="crm-restriction-label">Название правила</label>
          <input
            id="rule-title"
            v-model.trim="form.title"
            type="text"
            maxlength="200"
            required
            placeholder="Например: График работы"
          />
        </div>

        <div class="crm-restriction-row">
          <div class="crm-restriction-section-heading">
            <label for="rule-trigger-input" class="crm-restriction-label">
              Слова-триггеры <span>по одному, Enter добавляет</span>
            </label>
            <span v-if="form.triggers.length" class="crm-restriction-counter">
              {{ form.triggers.length }} шт.
            </span>
          </div>

          <div class="crm-restriction-trigger-box">
            <span v-for="(trigger, index) in form.triggers" :key="trigger" class="crm-restriction-trigger">
              {{ trigger }}
              <button
                type="button"
                :aria-label="`Убрать слово ${trigger}`"
                @click="removeTrigger(index)"
              >
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
                </svg>
              </button>
            </span>
            <input
              id="rule-trigger-input"
              v-model="triggerDraft"
              type="text"
              :placeholder="form.triggers.length ? 'ещё слово…' : 'график, до скольки, режим работы…'"
              @keydown.enter.prevent="commitTrigger"
              @keydown.,.prevent="commitTrigger"
              @blur="commitTrigger"
            />
          </div>

        </div>

        <div class="crm-restriction-row">
          <div class="crm-restriction-section-heading">
            <label for="rule-response" class="crm-restriction-label">
              Текст ответа <span>{{ form.response_text.length }} / 4000</span>
            </label>
            <button
              type="button"
              class="crm-restriction-secondary crm-restriction-check-button"
              data-testid="from-telegram"
              :disabled="telegramLoading"
              @click="toggleTelegramList"
            >
              {{ telegramLoading ? 'Загружаю…' : 'Из Telegram' }}
            </button>
          </div>
          <textarea
            id="rule-response"
            v-model="form.response_text"
            rows="4"
            maxlength="4000"
            required
            placeholder="Работаем ежедневно с 10:00 до 20:00"
          />
          <div v-if="telegramOpen" class="crm-restriction-trigger-box">
            <button
              v-for="item in telegramReplies"
              :key="item.id"
              type="button"
              class="crm-restriction-template"
              :disabled="!item.text"
              @click="applyTelegramReply(item)"
            >
              /{{ item.name }}
            </button>
            <p v-if="!telegramReplies.length" class="crm-restriction-hint">
              {{ telegramError || 'В Telegram нет сохранённых быстрых ответов.' }}
            </p>
          </div>
        </div>

        <div class="crm-restriction-row crm-restriction-row--check">
          <div class="crm-restriction-section-heading">
            <label for="rule-check-input" class="crm-restriction-label">
              Проверить фразу <span>необязательно</span>
            </label>
          </div>
          <div class="crm-restriction-check">
            <input
              id="rule-check-input"
              v-model.trim="checkText"
              type="text"
              placeholder="До скольки работаете?"
              @keydown.enter.prevent="runCheck"
            />
            <button
              type="button"
              class="crm-restriction-secondary crm-restriction-check-button"
              :disabled="!checkText || checking"
              @click="runCheck"
            >
              {{ checking ? 'Проверяю…' : 'Проверить' }}
            </button>
          </div>

          <p v-if="checkError" class="crm-restriction-check-result crm-restriction-check-result--miss" role="alert">
            {{ checkError }}
          </p>
          <p v-else-if="checkResult" class="crm-restriction-check-result" :class="checkResultClass" role="status">
            <template v-if="checkResult.matched">
              Сработает правило <strong>{{ checkResult.matched.title }}</strong> — клиент получит:
              <br />«{{ checkResult.matched.response_text }}»
            </template>
            <template v-else>
              Ни одно <strong>сохранённое</strong> правило не сработает на эту фразу.
              <template v-if="!editing">
                Проверка видит только сохранённые правила — сохраните и проверьте снова.
              </template>
              <template v-else>
                Попробуйте добавить в слова-триггеры другое слово.
              </template>
            </template>
          </p>
        </div>
      </fieldset>

      <div class="crm-restriction-actions">
        <button type="button" class="crm-restriction-secondary" :disabled="submitting" @click="handleClose">
          Отмена
        </button>
        <button type="submit" class="crm-restriction-primary" :disabled="!canSubmit || submitting">
          {{ submitting ? 'Сохраняю…' : 'Сохранить правило' }}
        </button>
      </div>

      <p v-if="errorText" class="crm-restriction-error" role="alert">
        {{ errorText }}
      </p>
    </form>
  </AdminModal>
</template>

<script setup lang="ts">
/**
 * Форма правила автоответа. Слова-триггеры вводятся чипами (а не строкой через
 * запятую, как в старом экране — там ошибиться в вводе было легче всего),
 * и есть проверка фразы тем же матчером, что работает в бою.
 */
import { computed, reactive, ref, watch } from 'vue';
import AdminModal from '@/components/AdminModal.vue';
// Стили системы модалок. Файл подключают и другие модалки, но полагаться на
// это нельзя: при ленивой загрузке в dev-режиме он подтягивается только после
// открытия чужого окна, и форма осталась бы без стилей.
import '@/styles/crm-restriction-modals.css';

export interface QuickReplyRule {
  id: number;
  title: string;
  keywords: string[];
  response_text: string;
  is_active: number;
  sort_order: number;
}

const props = defineProps<{
  isOpen: boolean;
  /** null — создание нового правила. */
  editing: QuickReplyRule | null;
}>();

const emit = defineEmits<{
  close: [];
  saved: [];
}>();

const form = reactive({
  title: '',
  triggers: [] as string[],
  response_text: '',
});

const triggerDraft = ref('');
const submitting = ref(false);
const errorText = ref<string | null>(null);

const checkText = ref('');
const checking = ref(false);
const checkError = ref<string | null>(null);
const checkResult = ref<{ matched: { title: string; response_text: string } | null } | null>(null);

// Заготовки из Telegram («Избранное» → Быстрые ответы). Живут в аккаунте
// менеджера, поэтому приходят с сервера отдельным запросом — и только когда
// менеджер открыл список: у части пользователей userbot недоступен, и грузить
// это при каждом открытии формы незачем.
interface TelegramReply {
  id: number;
  name: string;
  text: string;
}
const telegramReplies = ref<TelegramReply[]>([]);
const telegramOpen = ref(false);
const telegramLoading = ref(false);
const telegramError = ref<string | null>(null);

async function loadTelegramReplies() {
  telegramLoading.value = true;
  telegramError.value = null;
  try {
    const response = await fetch('/api/admin/crm/bot/telegram-quick-replies', {
      credentials: 'include',
    });
    if (response.status === 503) {
      telegramError.value = 'Userbot недоступен — заготовки Telegram прочитать нельзя.';
      telegramReplies.value = [];
      return;
    }
    if (!response.ok) throw new Error('telegram_quick_replies_failed');
    const data = await response.json();
    telegramReplies.value = Array.isArray(data?.items) ? data.items : [];
  } catch {
    telegramError.value = 'Не удалось получить заготовки из Telegram.';
    telegramReplies.value = [];
  } finally {
    telegramLoading.value = false;
  }
}

async function toggleTelegramList() {
  telegramOpen.value = !telegramOpen.value;
  if (telegramOpen.value && telegramReplies.value.length === 0) {
    await loadTelegramReplies();
  }
}

function applyTelegramReply(item: TelegramReply) {
  form.response_text = item.text;
  telegramOpen.value = false;
}

const canSubmit = computed(
  () => Boolean(form.title.trim()) && form.response_text.trim().length > 0 && form.triggers.length > 0,
);

const checkResultClass = computed(() =>
  checkResult.value?.matched ? 'crm-restriction-check-result--hit' : 'crm-restriction-check-result--miss',
);

/** Слово из поля ввода превращается в чип. Дубликаты и пустое — отбрасываем. */
function commitTrigger() {
  const raw = triggerDraft.value.trim();
  triggerDraft.value = '';
  if (!raw) return;
  // Пользователь мог вставить «график, до скольки» строкой — разбираем на части.
  for (const piece of raw.split(/[,;]+/)) {
    const value = piece.trim();
    if (!value) continue;
    const duplicate = form.triggers.some(
      (existing) => existing.toLowerCase().replace(/ё/g, 'е') === value.toLowerCase().replace(/ё/g, 'е'),
    );
    if (!duplicate) form.triggers.push(value);
  }
  checkResult.value = null;
}

function removeTrigger(index: number) {
  form.triggers.splice(index, 1);
  checkResult.value = null;
}

function resetForm() {
  const rule = props.editing;
  form.title = rule?.title ?? '';
  form.triggers = Array.isArray(rule?.keywords) ? [...rule.keywords] : [];
  form.response_text = rule?.response_text ?? '';
  triggerDraft.value = '';
  checkText.value = '';
  checkResult.value = null;
  checkError.value = null;
  errorText.value = null;
  // Список заготовок Telegram закрываем, но не чистим: при повторном открытии
  // он покажется сразу, без повторного запроса к userbot.
  telegramOpen.value = false;
  telegramError.value = null;
}

watch(
  () => [props.isOpen, props.editing?.id],
  ([open]) => {
    if (open) resetForm();
  },
  { immediate: true },
);

async function runCheck() {
  const text = checkText.value.trim();
  if (!text) return;
  checking.value = true;
  checkError.value = null;
  try {
    const response = await fetch('/api/admin/crm/bot/quick-replies/test', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      checkError.value = 'Не удалось проверить фразу. Попробуйте ещё раз.';
      return;
    }
    checkResult.value = { matched: data?.matched ?? null };
  } catch {
    checkError.value = 'Сервер не ответил. Проверьте связь и попробуйте снова.';
  } finally {
    checking.value = false;
  }
}

async function submit() {
  commitTrigger(); // слово, набранное но не подтверждённое, не теряем
  if (!canSubmit.value) return;
  submitting.value = true;
  errorText.value = null;
  try {
    const payload = {
      title: form.title.trim(),
      keywords: form.triggers,
      response_text: form.response_text.trim(),
      is_active: props.editing ? props.editing.is_active : 1,
      sort_order: props.editing ? props.editing.sort_order : 0,
    };
    const url = props.editing
      ? `/api/admin/crm/bot/quick-replies/${props.editing.id}`
      : '/api/admin/crm/bot/quick-replies';
    const response = await fetch(url, {
      method: props.editing ? 'PUT' : 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      errorText.value = mapError(data?.error);
      return;
    }
    emit('saved');
    emit('close');
  } catch {
    errorText.value = 'Сервер не ответил. Изменения не сохранены.';
  } finally {
    submitting.value = false;
  }
}

function mapError(code: unknown): string {
  switch (code) {
    case 'title_required':
      return 'Укажите название правила.';
    case 'title_too_long':
      return 'Название слишком длинное.';
    case 'response_required':
      return 'Напишите текст ответа.';
    case 'response_too_long':
      return 'Текст ответа слишком длинный.';
    case 'keywords_too_long':
      return 'Слишком много слов-триггеров — сократите список.';
    default:
      return 'Не удалось сохранить правило. Попробуйте ещё раз.';
  }
}

function handleClose() {
  if (submitting.value) return;
  emit('close');
}
</script>
