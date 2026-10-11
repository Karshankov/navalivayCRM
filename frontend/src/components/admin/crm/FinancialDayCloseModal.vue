<template>
  <AdminModal :is-open="isOpen" title="Закрыть финансовый день" description="Закрытие финансового дня не завершает рабочую смену сотрудника." size="lg" reference-design :show-actions="false" :is-loading="sending" :persistent="sending" :initial-focus="headingRef" @update:is-open="handleOpenChange">
    <div class="financial-close" :aria-busy="loading || previewing || sending">
      <h3 ref="headingRef" tabindex="-1" class="close-heading">{{ heading }}</h3>
      <p v-if="context" class="close-muted">{{ displayDate(context.business_date) }} · {{ context.time_zone }}</p>
      <p v-if="loading" role="status">Загружаем данные финансового дня…</p>
      <p v-if="notice" role="status" class="close-notice">{{ notice }}</p>
      <div v-if="error" role="alert" class="close-error"><p>{{ error }}</p></div>
      <section v-if="pending || storageProblem" class="close-warning" data-test="close-recovery">
        <h4>Подтверждение требует проверки</h4>
        <p>Результат предыдущего запроса пока не подтверждён. Новое закрытие недоступно. Повтор отправляет исходные данные с тем же ключом.</p>
        <div class="close-button-row">
          <button type="button" :disabled="loading || sending || recovering" @click="recoverPending">Проверить сохранённый отчёт</button>
          <button v-if="pending && authorized" type="button" :disabled="loading || sending || recovering" data-test="close-retry" @click="submitPending">Повторить тот же запрос</button>
        </div>
      </section>

      <section v-if="accountSelectionRequired && !loading && !pending && !storageProblem" class="close-account-selection" data-test="close-account-selection">
        <p class="close-muted">Автоматически определить счета нельзя. Выберите два разных активных счёта из CRM. Новые счета и движения денег не создаются.</p>
        <form novalidate @submit.prevent="applyAccountSelection">
          <div class="close-fields">
            <div><label for="close-cash-account">Счёт кассы: наличные и карта</label><select id="close-cash-account" v-model="cashAccountId" data-test="close-cash-account"><option value="">Выберите счёт</option><option v-for="account in accountOptions" :key="account.id" :value="account.id">{{ account.name }} · {{ account.id }}</option></select></div>
            <div><label for="close-revenue-account">Счёт для перевода выручки</label><select id="close-revenue-account" v-model="revenueAccountId" data-test="close-revenue-account"><option value="">Выберите счёт</option><option v-for="account in accountOptions" :key="account.id" :value="account.id">{{ account.name }} · {{ account.id }}</option></select></div>
          </div>
          <p v-if="accountOptions.length < 2" class="close-warning">Для закрытия нужны два разных активных счёта. Проверьте существующие счета в разделе финансов.</p>
          <div class="close-footer"><button type="submit" class="close-primary" :disabled="loading || sending || accountOptions.length < 2" data-test="close-accounts-apply">Загрузить день с выбранными счетами</button></div>
        </form>
      </section>

      <section v-if="report && authorized && !loading" class="close-report" data-test="close-saved-report">
        <p class="close-success">Отчёт сохранён</p>
        <h4>Финансовый день {{ displayDate(report.business_date) }}</h4>
        <p class="close-muted">{{ report.id }} · {{ report.employee_name }}</p>
        <dl class="close-totals">
          <div><dt>Выручка CRM</dt><dd>{{ money(report.snapshot.revenue_minor) }}</dd></div>
          <div><dt>Прибыль дня / владельцу всего</dt><dd>{{ money(report.snapshot.owner_total_minor) }}</dd></div>
          <div><dt>Карта уже у владельца</dt><dd>{{ money(report.snapshot.owner_card_minor) }}</dd></div>
          <div><dt>Передать владельцу наличными</dt><dd>{{ money(report.snapshot.owner_cash_minor) }}</dd></div>
          <div><dt>Расхождение кассы</dt><dd>{{ discrepancyLabel(report.snapshot.discrepancy_minor) }}</dd></div>
          <div><dt>Перевод в «{{ report.snapshot.revenue_account_name }}»</dt><dd>{{ money(report.snapshot.transfer_minor) }}</dd></div>
          <div><dt>Остаток в «{{ report.snapshot.cash_account_name }}»</dt><dd>{{ money(report.snapshot.cash_balance_after_minor) }}</dd></div>
        </dl>
        <p class="close-notification" data-test="close-notification">Telegram: {{ notificationCloseLabel(report.notification_status) }}</p>
        <p class="close-muted">Доставка уведомления не изменяет сохранённый отчёт и не повторяет движения денег.</p>
        <details><summary>Полный текст отчёта</summary><pre>{{ report.report_text }}</pre></details>
        <div class="close-button-row">
          <button type="button" @click="downloadReport">Скачать отчёт (.txt)</button>
          <button type="button" :disabled="reportBusy" @click="refreshReport">Обновить статус Telegram</button>
          <button v-if="report.notification_status === 'awaiting_recipient'" type="button" :disabled="reportBusy" @click="enqueueReport">Поставить отчёт в очередь</button>
        </div>
        <p v-if="report.notification_status === 'awaiting_recipient'" class="close-muted">Настройте получателя группы «Закрытие финансового дня» в разделе сотрудников. Постановка в очередь доступна руководителю.</p>
        <button v-if="report.business_date !== context?.business_date" type="button" :disabled="sending" @click="returnToCurrentDay">Вернуться к текущему дню</button>
      </section>

      <section v-else-if="context && authorized && !loading && !pending && !storageProblem" class="close-wizard">
        <ol class="close-steps" aria-label="Этапы закрытия">
          <li v-for="(label, index) in stepLabels" :key="label" :aria-current="step === index + 1 ? 'step' : undefined" :class="{ current: step === index + 1, passed: step > index + 1 }"><span>{{ index + 1 }}</span>{{ label }}</li>
        </ol>
        <form novalidate @submit.prevent="nextStep">
          <fieldset :disabled="formLocked">
            <section v-if="step === 1" data-test="close-terminal-step">
              <p class="close-muted">Введите суммы из отчёта терминала. Это не дополнительный приход в кассу.</p>
              <div class="close-fields">
                <div><label for="close-terminal-cash">Наличные по терминалу, BYN</label><input id="close-terminal-cash" v-model="terminalCash" inputmode="decimal" autocomplete="off" :aria-invalid="!!fieldError('terminal_cash')" aria-describedby="close-terminal-cash-error" data-test="close-terminal-cash" /><p id="close-terminal-cash-error" class="close-field-error">{{ fieldError('terminal_cash') }}</p></div>
                <div><label for="close-terminal-card">Карта по терминалу, BYN</label><input id="close-terminal-card" v-model="terminalCard" inputmode="decimal" autocomplete="off" :aria-invalid="!!fieldError('terminal_card')" aria-describedby="close-terminal-card-error" data-test="close-terminal-card" /><p id="close-terminal-card-error" class="close-field-error">{{ fieldError('terminal_card') }}</p></div>
              </div>
              <div class="close-total-card"><span>Итого по терминалу</span><strong>{{ terminalTotal === null ? 'Введите обе суммы' : money(terminalTotal) }}</strong></div>
            </section>
            <section v-else-if="step === 2" data-test="close-count-step">
              <p class="close-muted">Пересчитайте фактические наличные. Наличные по терминалу повторно к ним не прибавляются.</p>
              <div class="close-notes">
                <div v-for="denomination in CLOSE_DENOMINATIONS" :key="denomination" class="close-note">
                  <label :for="`close-note-${denomination}`">{{ denomination }} BYN</label>
                  <button type="button" :aria-label="`Убрать купюру ${denomination} BYN`" @click="adjustNotes(denomination, -1)">−</button>
                  <input :id="`close-note-${denomination}`" v-model="counts[String(denomination)]" inputmode="numeric" :aria-label="`Количество купюр ${denomination} BYN`" :aria-invalid="!!fieldError(`note_${denomination}`)" :aria-describedby="`close-note-${denomination}-error`" />
                  <button type="button" :aria-label="`Добавить купюру ${denomination} BYN`" @click="adjustNotes(denomination, 1)">+</button>
                  <p :id="`close-note-${denomination}-error`" class="close-field-error">{{ fieldError(`note_${denomination}`) }}</p>
                </div>
              </div>
              <label for="close-coins">Монеты и мелкие номиналы, BYN</label><input id="close-coins" v-model="coins" inputmode="decimal" :aria-invalid="!!fieldError('coins')" aria-describedby="close-coins-error" data-test="close-coins" /><p id="close-coins-error" class="close-field-error">{{ fieldError('coins') }}</p>
              <dl class="close-totals">
                <div><dt>Пересчитано наличных N</dt><dd>{{ countedCash === null ? 'Введите корректные количества и мелочь' : money(countedCash) }}</dd></div>
                <div><dt>Карта по терминалу C</dt><dd>{{ cardMinor === null ? 'Данные недоступны' : money(cardMinor) }}</dd></div>
                <div><dt>Фактический общий остаток N + C</dt><dd>{{ actualTotal === null ? 'Данные недоступны' : money(actualTotal) }}</dd></div>
                <div><dt>Общий баланс «{{ context.cash_account_name }}» K</dt><dd>{{ money(context.cash_balance_minor) }}</dd></div>
              </dl>
              <p class="close-warning" data-test="close-discrepancy">{{ difference === null ? 'Для сверки заполните пересчёт' : discrepancyLabel(difference) }}<br />D = N + C − K. Баланс CRM включает наличные и карту. Расхождение будет отражено при закрытии и само по себе не запрещает продолжение.</p>
            </section>
            <section v-else data-test="close-distribution-step">
              <dl class="close-totals">
                <div><dt>Прибыль сегодняшнего дня из «Обзора» P</dt><dd>{{ money(context.profit_minor) }}</dd></div>
                <div><dt>Карта уже у владельца C</dt><dd>{{ cardMinor === null ? 'Данные недоступны' : money(cardMinor) }}</dd></div>
                <div><dt>Передать владельцу наличными P − C</dt><dd>{{ ownerCash === null ? 'Данные недоступны' : money(ownerCash) }}</dd></div>
              </dl>
              <label for="close-retained">Оставить наличными в «{{ context.cash_account_name }}», BYN</label><input id="close-retained" v-model="retainedCash" inputmode="decimal" :aria-invalid="!!fieldError('retained_cash')" aria-describedby="close-retained-error" data-test="close-retained" /><p id="close-retained-error" class="close-field-error">{{ fieldError('retained_cash') }}</p>
              <p v-if="ownerCash !== null && ownerCash < 0" class="close-error">Карта превышает прибыль дня. Проверьте отчёт терминала и прибыль. Отрицательная передача наличных не заменяется нулём.</p>
              <button type="button" class="close-secondary" :disabled="previewing" data-test="close-preview" @click="calculatePreview">{{ previewing ? 'Рассчитываем…' : 'Рассчитать распределение' }}</button>
              <section v-if="preview" class="close-confirmation" data-test="close-preview-result">
                <h4>Проверьте серверный расчёт</h4>
                <dl class="close-totals">
                  <div><dt>Владельцу всего</dt><dd>{{ money(preview.snapshot.owner_total_minor) }}</dd></div>
                  <div><dt>Из них уже картой</dt><dd>{{ money(preview.snapshot.owner_card_minor) }}</dd></div>
                  <div><dt>Передать наличными</dt><dd>{{ money(preview.snapshot.owner_cash_minor) }}</dd></div>
                  <div><dt>Расхождение</dt><dd>{{ discrepancyLabel(preview.snapshot.discrepancy_minor) }}</dd></div>
                  <div><dt>Перевод в «{{ preview.context.revenue_account_name }}»</dt><dd>{{ money(preview.snapshot.transfer_minor) }}</dd></div>
                  <div><dt>Остаток «{{ preview.context.cash_account_name }}»</dt><dd>{{ money(preview.snapshot.cash_balance_after_minor) }}</dd></div>
                </dl>
                <p class="close-warning">После подтверждения будут сохранены отчёт и движения денег. Карта уже у владельца: отдельное повторное списание карты не создаётся.</p>
                <p class="close-muted">{{ preview.context.notification_ready ? 'Уведомление будет поставлено в очередь Telegram.' : 'Получатель Telegram не настроен. Отчёт сохранится в истории без потери данных.' }}</p>
              </section>
            </section>
          </fieldset>
          <div class="close-footer">
            <button v-if="step > 1" type="button" :disabled="formLocked" @click="goBack">Назад</button>
            <button v-if="step < 3" type="submit" class="close-primary" :disabled="formLocked" data-test="close-next">Продолжить</button>
            <button v-else type="button" class="close-primary" :disabled="!preview || formLocked" data-test="close-confirm" @click="confirmClose">{{ sending ? 'Сохраняем…' : 'Подтвердить закрытие дня' }}</button>
          </div>
        </form>
      </section>
      <button v-if="!context && !loading" type="button" :disabled="sending" @click="loadContext">Повторить загрузку</button>
      <section class="close-history">
        <button type="button" :disabled="loading || sending || historyBusy" :aria-expanded="showHistory" data-test="close-history-toggle" @click="toggleHistory">История закрытий</button>
        <div v-if="showHistory">
          <p v-if="historyBusy" role="status">Загружаем историю…</p>
          <p v-else-if="history.length === 0 && !historyError">Сохранённых закрытий нет.</p>
          <p v-if="historyError" role="alert" class="close-error">{{ historyError }}</p>
          <ul><li v-for="item in history" :key="item.id"><button type="button" :disabled="sending" @click="viewHistoryReport(item)">{{ displayDate(item.business_date) }} · {{ item.employee_name }} · {{ notificationCloseLabel(item.notification_status) }}</button></li></ul>
          <button v-if="historyHasMore" type="button" :disabled="historyBusy" @click="loadHistory(true)">Загрузить ещё</button>
        </div>
      </section>
    </div>
    <template #footer><div class="close-bottom"><span v-if="sending" role="status">Сохраняем отчёт — не повторяйте операцию.</span><button type="button" :disabled="sending" @click="handleOpenChange(false)">{{ pending ? 'Закрыть окно — проверка сохранится' : 'Закрыть окно' }}</button></div></template>
  </AdminModal>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import AdminModal from '@/components/AdminModal.vue';
import { requestFinancialDayClose, StaffApiError, useCrmStore, type CashAccount } from '@/stores/crm';
import { CLOSE_DENOMINATIONS, PENDING_CLOSE_STORAGE_KEY, countCloseCash, formatCloseMoney, isFinancialCloseContext, isFinancialCloseSnapshot, isSavedFinancialClose, loadPendingFinancialClose, notificationCloseLabel, parseCloseMoney, parseCloseNoteCount, savePendingFinancialClose, type FinancialCloseContext, type FinancialCloseInput, type FinancialClosePreview, type PendingFinancialClose, type SavedFinancialClose } from '@/utils/financialDayClose';

const props = defineProps<{ isOpen: boolean }>();
const emit = defineEmits<{ close: []; saved: [closure: SavedFinancialClose] }>();
const crm = useCrmStore();
const headingRef = ref<HTMLElement | null>(null);
const step = ref(1);
let draftDate = '';
const stepLabels = ['Данные терминала', 'Пересчёт наличных', 'Распределение'];
const context = ref<FinancialCloseContext | null>(null);
const preview = ref<FinancialClosePreview | null>(null);
const report = ref<SavedFinancialClose | null>(null);
const pending = ref<PendingFinancialClose | null>(null);
const terminalCash = ref('');
const terminalCard = ref('');
const coins = ref('');
const retainedCash = ref('');
const counts = reactive<Record<string, string>>(Object.fromEntries(CLOSE_DENOMINATIONS.map(value => [String(value), '0'])));
const loading = ref(false);
const previewing = ref(false);
const sending = ref(false);
const recovering = ref(false);
const reportBusy = ref(false);
const authorized = ref(false);
const storageProblem = ref(false);
const error = ref('');
const notice = ref('');
const touched = ref(false);
const showHistory = ref(false);
const history = ref<SavedFinancialClose[]>([]);
const historyBusy = ref(false);
const historyError = ref('');
const historyHasMore = ref(false);
const accountSelectionRequired = ref(false);
const accountOptions = ref<CashAccount[]>([]);
const cashAccountId = ref('');
const revenueAccountId = ref('');
let readController: AbortController | null = null;
let loadGeneration = 0;
let previewGeneration = 0;
const money = formatCloseMoney;
const formLocked = computed(() => loading.value || previewing.value || sending.value || !!pending.value || storageProblem.value);
const heading = computed(() => report.value ? 'Сохранённый отчёт' : pending.value || storageProblem.value ? 'Проверка результата' : accountSelectionRequired.value ? 'Выберите существующие счета' : `Шаг ${step.value} из 3 — ${stepLabels[step.value - 1]}`);
const cardMinor = computed(() => parseCloseMoney(terminalCard.value));
const countedCash = computed(() => countCloseCash(counts, coins.value));
function safeSum(left: number | null, right: number | null): number | null {
  if (left === null || right === null) return null;
  const value = left + right;
  return Number.isSafeInteger(value) ? value : null;
}
const terminalTotal = computed(() => safeSum(parseCloseMoney(terminalCash.value), cardMinor.value));
const actualTotal = computed(() => safeSum(countedCash.value, cardMinor.value));
const difference = computed(() => context.value && actualTotal.value !== null ? safeSum(actualTotal.value, -context.value.cash_balance_minor) : null);
const ownerCash = computed(() => context.value && cardMinor.value !== null ? safeSum(context.value.profit_minor, -cardMinor.value) : null);

function displayDate(value: string): string { return value.split('-').reverse().join('.'); }
function discrepancyLabel(value: number): string {
  return value === 0 ? 'Совпадает' : `${value < 0 ? 'Недостача' : 'Излишек'} ${money(Math.abs(value))}`;
}
function errorText(value: unknown): string { return value instanceof Error ? value.message : 'Не удалось выполнить запрос. Повторите проверку.'; }
function invalidResponse(): never { throw new StaffApiError('Не удалось подтвердить ответ сервера', { code: 'financial_close_invalid_response', outcomeUnknown: true }); }
function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  return requestFinancialDayClose<T>(path, options, crm.dashboardToken);
}
function invalidatePreview() { previewGeneration++; preview.value = null; }
watch([terminalCash, terminalCard, coins, retainedCash], invalidatePreview, { flush: 'sync' });
watch(counts, invalidatePreview, { deep: true, flush: 'sync' });
async function focusHeading() { await nextTick(); headingRef.value?.focus({ preventScroll: true }); }
function fieldError(field: string): string {
  if (!touched.value) return '';
  if (field.startsWith('note_')) return parseCloseNoteCount(counts[field.slice(5)] ?? '') === null ? 'Введите неотрицательное целое количество.' : '';
  const values: Record<string, string> = { terminal_cash: terminalCash.value, terminal_card: terminalCard.value, coins: coins.value, retained_cash: retainedCash.value };
  return parseCloseMoney(values[field] ?? '') === null ? 'Введите сумму: например 0 или 12,50. Не более двух знаков после запятой.' : '';
}
async function focusInvalid() { await nextTick(); headingRef.value?.parentElement?.querySelector<HTMLInputElement>('input[aria-invalid="true"]')?.focus(); }
function adjustNotes(denomination: number, direction: number) {
  const value = parseCloseNoteCount(counts[String(denomination)] ?? '');
  if (value === null) { touched.value = true; return; }
  const next = value + direction;
  if (Number.isSafeInteger(next) && next >= 0) counts[String(denomination)] = String(next);
}
async function nextStep() {
  if (formLocked.value) return;
  touched.value = true;
  if (step.value === 1 && (parseCloseMoney(terminalCash.value) === null || cardMinor.value === null || terminalTotal.value === null)) { await focusInvalid(); return; }
  if (step.value === 2 && (countedCash.value === null || actualTotal.value === null || difference.value === null)) { await focusInvalid(); return; }
  if (step.value < 3) { step.value++; touched.value = false; await focusHeading(); }
}
async function goBack() { if (!formLocked.value && step.value > 1) { step.value--; touched.value = false; await focusHeading(); } }
function makeInput(): FinancialCloseInput {
  if (!context.value || parseCloseMoney(terminalCash.value) === null || cardMinor.value === null || countedCash.value === null || parseCloseMoney(retainedCash.value) === null) {
    throw new Error('Заполните все суммы и количества корректно.');
  }
  return {
    business_date: context.value.business_date,
    cash_account_id: context.value.cash_account_id,
    revenue_account_id: context.value.revenue_account_id,
    terminal_cash: terminalCash.value.trim(), terminal_card: terminalCard.value.trim(),
    coins: coins.value.trim(), retained_cash: retainedCash.value.trim(),
    counts: Object.fromEntries(CLOSE_DENOMINATIONS.map(value => [String(value), parseCloseNoteCount(counts[String(value)]!)!])),
  };
}
function resetDraft() {
  terminalCash.value = ''; terminalCard.value = ''; coins.value = ''; retainedCash.value = '';
  for (const denomination of CLOSE_DENOMINATIONS) counts[String(denomination)] = '0';
  step.value = 1; touched.value = false; preview.value = null;
}
function returnToCurrentDay() {
  if (!context.value) return;
  if (draftDate !== context.value.business_date) resetDraft();
  draftDate = context.value.business_date;
  report.value = context.value.closure; void focusHeading();
}
function restoreInput(value: PendingFinancialClose) {
  draftDate = value.payload.business_date;
  terminalCash.value = value.payload.terminal_cash; terminalCard.value = value.payload.terminal_card;
  coins.value = value.payload.coins; retainedCash.value = value.payload.retained_cash;
  for (const denomination of CLOSE_DENOMINATIONS) counts[String(denomination)] = String(value.payload.counts[String(denomination)]);
  step.value = 3;
}
async function applyAccountSelection() {
  if (loading.value || sending.value || pending.value || storageProblem.value || !accountSelectionRequired.value) return;
  const activeIds = new Set(accountOptions.value.map(account => account.id));
  if (!activeIds.has(cashAccountId.value) || !activeIds.has(revenueAccountId.value)) { error.value = 'Выберите два активных счёта.'; return; }
  if (cashAccountId.value === revenueAccountId.value) { error.value = 'Касса и счёт выручки должны быть разными.'; return; }
  await loadContext();
}
async function loadContext() {
  if (sending.value) return;
  readController?.abort(); readController = new AbortController();
  const generation = ++loadGeneration;
  const signal = readController.signal;
  loading.value = true; authorized.value = false; error.value = ''; invalidatePreview();
  previewing.value = false; report.value = null; history.value = []; showHistory.value = false;
  historyBusy.value = false; historyError.value = ''; historyHasMore.value = false;
  reportBusy.value = false; recovering.value = false;
  accountSelectionRequired.value = false; accountOptions.value = [];
  pending.value = null;
  try {
    try {
      pending.value = loadPendingFinancialClose(window.sessionStorage);
      storageProblem.value = false;
      if (pending.value) restoreInput(pending.value);
    } catch (storageError) { storageProblem.value = true; error.value = errorText(storageError); }
    const selected = pending.value?.payload ?? (cashAccountId.value && revenueAccountId.value ? { cash_account_id: cashAccountId.value, revenue_account_id: revenueAccountId.value } : null);
    const query = selected ? `?${new URLSearchParams({ cash_account_id: selected.cash_account_id, revenue_account_id: selected.revenue_account_id })}` : '';
    const current = await api<unknown>(`/context${query}`, { signal });
    if (generation !== loadGeneration) return;
    if (!isFinancialCloseContext(current)) invalidResponse();
    authorized.value = true; context.value = current;
    cashAccountId.value = current.cash_account_id; revenueAccountId.value = current.revenue_account_id;
    accountSelectionRequired.value = false;
    if (pending.value) {
      if (current.closure && current.closure.business_date === pending.value.payload.business_date) finishSaved(current.closure);
      else await recoverPending();
    } else if (!storageProblem.value) {
      if (draftDate && draftDate !== current.business_date) resetDraft();
      draftDate = current.business_date; report.value = current.closure;
    }
  } catch (loadError) {
    if (generation !== loadGeneration || signal.aborted || !props.isOpen) return;
    context.value = null; error.value = errorText(loadError);
    if (!pending.value && !storageProblem.value && loadError instanceof StaffApiError && ['closing_account_selection_required', 'closing_account_not_found', 'closing_accounts_must_differ'].includes(loadError.code ?? '')) {
      accountSelectionRequired.value = true; accountOptions.value = [];
      try {
        await crm.fetchCashAccounts();
        if (generation !== loadGeneration || signal.aborted || !props.isOpen) return;
        accountOptions.value = crm.cashAccounts.filter(account => account.active === 1);
        error.value = '';
        await focusHeading();
      } catch (accountsError) {
        if (generation === loadGeneration && !signal.aborted && props.isOpen) error.value = errorText(accountsError);
      }
    }
  } finally { if (generation === loadGeneration) loading.value = false; }
}
async function calculatePreview() {
  if (formLocked.value) return;
  touched.value = true; error.value = ''; notice.value = '';
  let input: FinancialCloseInput;
  try { input = makeInput(); } catch (inputError) { error.value = errorText(inputError); await focusInvalid(); return; }
  const generation = ++previewGeneration;
  previewing.value = true;
  try {
    const result = await api<FinancialClosePreview>('/preview', { method: 'POST', body: JSON.stringify(input), signal: readController?.signal });
    if (generation !== previewGeneration || !props.isOpen) return;
    if (!isFinancialCloseContext(result.context) || !isFinancialCloseSnapshot(result.snapshot)) invalidResponse();
    context.value = result.context; preview.value = result;
  } catch (previewError) {
    if (generation !== previewGeneration || !props.isOpen) return;
    preview.value = null; error.value = errorText(previewError);
    if (previewError instanceof StaffApiError && previewError.code === 'financial_day_already_closed') await loadContext();
  } finally { if (generation === previewGeneration) previewing.value = false; }
}
function clearPending(): boolean {
  try { window.sessionStorage.removeItem(PENDING_CLOSE_STORAGE_KEY); pending.value = null; storageProblem.value = false; return true; }
  catch { storageProblem.value = true; notice.value = 'Отчёт проверен, но отметку восстановления удалить не удалось. Новое подтверждение заблокировано.'; return false; }
}
function finishSaved(saved: SavedFinancialClose) {
  report.value = saved; preview.value = null; error.value = '';
  clearPending(); emit('saved', saved); void focusHeading();
}
async function confirmClose() {
  if (!preview.value || formLocked.value) return;
  try {
    const operation: PendingFinancialClose = {
      version: 1, key: `fclose_${crypto.randomUUID()}`,
      payload: { ...makeInput(), expected_revision: preview.value.context.revision },
    };
    savePendingFinancialClose(window.sessionStorage, operation);
    pending.value = operation;
  } catch (storageError) { error.value = `Подтверждение не отправлено: ${errorText(storageError)}`; return; }
  await submitPending();
}
async function submitPending() {
  if (!pending.value || sending.value || !authorized.value || storageProblem.value) return;
  const operation = JSON.parse(JSON.stringify(pending.value)) as PendingFinancialClose;
  sending.value = true; error.value = ''; notice.value = '';
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 25000);
  try {
    const result = await api<{ closure: SavedFinancialClose; replay: boolean }>('/complete', {
      method: 'POST', headers: { 'Idempotency-Key': operation.key },
      body: JSON.stringify(operation.payload), signal: controller.signal,
    });
    if (!isSavedFinancialClose(result.closure) || result.closure.business_date !== operation.payload.business_date) invalidResponse();
    finishSaved(result.closure);
  } catch (closeError) {
    const code = closeError instanceof StaffApiError ? closeError.code : '';
    const definiteRejections = ['closing_preview_stale', 'closing_day_changed', 'negative_owner_cash', 'insufficient_counted_cash', 'invalid_money', 'invalid_note_count', 'invalid_denomination', 'invalid_closing_input', 'closing_accounts_must_differ', 'closing_account_not_found'];
    if (closeError instanceof StaffApiError && !closeError.outcomeUnknown && code && definiteRejections.includes(code)) {
      clearPending(); preview.value = null; error.value = errorText(closeError);
      notice.value = 'Подтверждение отклонено сервером. Ввод сохранён; обновите расчёт перед следующей проверкой.';
    } else {
      error.value = errorText(closeError);
      notice.value = 'Не удалось подтвердить результат. Проверяем, сохранён ли отчёт. Новую операцию не создаём.';
      await recoverPending();
    }
  } finally { window.clearTimeout(timeout); sending.value = false; }
}
async function recoverPending() {
  if (recovering.value || (!pending.value && !storageProblem.value)) return;
  recovering.value = true;
  const generation = loadGeneration;
  const signal = readController?.signal;
  try {
    const result = await api<{ items: unknown[] }>('/history?limit=200', { signal });
    if (generation !== loadGeneration || signal?.aborted || !props.isOpen) return;
    if (!Array.isArray(result.items) || !result.items.every(isSavedFinancialClose)) invalidResponse();
    authorized.value = true;
    const saved = pending.value ? result.items.find(item => item.business_date === pending.value!.payload.business_date) : null;
    if (saved) { notice.value = 'Финансовый день уже закрыт. Показан сохранённый серверный отчёт.'; finishSaved(saved); }
    else notice.value = pending.value ? 'В проверенной части истории отчёт пока не найден. Результат остаётся неопределённым; повторите только исходный запрос.' : 'Отметка восстановления повреждена. Историю можно просмотреть, но новое подтверждение требует отдельной проверки администратором.';
  } catch (recoveryError) { if (generation === loadGeneration && !signal?.aborted && props.isOpen) error.value = errorText(recoveryError); }
  finally { if (generation === loadGeneration) recovering.value = false; }
}
async function loadHistory(append = false) {
  if (historyBusy.value) return;
  historyBusy.value = true; historyError.value = '';
  const generation = loadGeneration;
  const signal = readController?.signal;
  try {
    const offset = append ? history.value.length : 0;
    const result = await api<{ items: unknown[] }>(`/history?limit=50&offset=${offset}`, { signal });
    if (generation !== loadGeneration || signal?.aborted || !props.isOpen) return;
    if (!Array.isArray(result.items) || !result.items.every(isSavedFinancialClose)) invalidResponse();
    history.value = append ? [...history.value, ...result.items] : result.items;
    historyHasMore.value = result.items.length === 50;
  } catch (historyLoadError) { if (generation === loadGeneration && !signal?.aborted && props.isOpen) historyError.value = errorText(historyLoadError); }
  finally { if (generation === loadGeneration) historyBusy.value = false; }
}
async function toggleHistory() { showHistory.value = !showHistory.value; if (showHistory.value) await loadHistory(); }
function viewHistoryReport(item: SavedFinancialClose) { report.value = item; void focusHeading(); }
async function reportRequest(enqueue = false) {
  if (!report.value || reportBusy.value) return;
  reportBusy.value = true; error.value = '';
  const id = report.value.id;
  const generation = loadGeneration;
  const signal = readController?.signal;
  try {
    const result = await api<{ closure: SavedFinancialClose }>(`/history/${encodeURIComponent(id)}${enqueue ? '/report' : ''}`, { method: enqueue ? 'POST' : 'GET', signal });
    if (generation !== loadGeneration || signal?.aborted || !props.isOpen) return;
    if (!isSavedFinancialClose(result.closure) || result.closure.id !== id) invalidResponse();
    if (report.value?.id === id) report.value = result.closure;
  } catch (reportError) { if (generation === loadGeneration && !signal?.aborted && props.isOpen) error.value = errorText(reportError); }
  finally { if (generation === loadGeneration) reportBusy.value = false; }
}
function refreshReport() { return reportRequest(); }
function enqueueReport() { return reportRequest(true); }
function downloadReport() {
  if (!report.value) return;
  const url = URL.createObjectURL(new Blob([report.value.report_text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `financial-close-${report.value.business_date}.txt`;
  document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}
function handleOpenChange(open: boolean) {
  if (open || sending.value) return;
  loadGeneration++; previewGeneration++; previewing.value = false; loading.value = false;
  readController?.abort(); emit('close');
}
watch(() => props.isOpen, open => {
  if (open) { notice.value = ''; void loadContext(); }
  else { loadGeneration++; previewGeneration++; readController?.abort(); }
}, { immediate: true });
onBeforeUnmount(() => { loadGeneration++; previewGeneration++; readController?.abort(); });
</script>

<style scoped>
.financial-close { color: #081b4b; font-size: 14px; }
.close-heading { margin: 0 0 8px; font-size: 19px; font-weight: 800; outline-offset: 4px; }
.close-muted { color: #50658a; font-size: 12px; line-height: 1.6; }
.close-steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); list-style: none; padding: 0; margin: 20px 0; gap: 8px; }
.close-steps li { display: flex; align-items: center; gap: 8px; padding: 10px; border: 1px solid #dce8fa; border-radius: 12px; color: #50658a; font-size: 12px; }
.close-steps span { display: grid; place-items: center; width: 24px; height: 24px; flex-shrink: 0; border-radius: 50%; background: #e7edf8; }
.close-steps .current { border-color: #1759ed; color: #1040aa; background: #edf4ff; font-weight: 700; }
.close-steps .current span { background: #1759ed; color: white; }
.close-steps .passed { color: #166534; }
fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
.close-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
label { display: block; margin: 12px 0 6px; font-weight: 650; }
input, select { width: 100%; min-width: 0; min-height: 44px; box-sizing: border-box; padding: 10px 12px; border: 1px solid #ccd9ec; border-radius: 10px; background: white; color: #081b4b; font-size: 16px; }
input[aria-invalid='true'] { border-color: #b91c1c; }
button { min-height: 44px; padding: 10px 14px; border: 1px solid #d5e1f2; border-radius: 10px; background: #fff; color: #143768; font-size: 13px; font-weight: 650; cursor: pointer; overflow-wrap: anywhere; }
button:hover:not(:disabled) { background: #edf4ff; }
button:disabled { opacity: .55; cursor: not-allowed; }
button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible { outline: 2px solid #1759ed; outline-offset: 3px; }
.close-primary { background: #1759ed; color: white; border-color: #1759ed; }
.close-primary:hover:not(:disabled) { background: #1045c8; }
.close-secondary { margin-top: 8px; }
.close-notes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 16px; }
.close-note { display: grid; grid-template-columns: 1fr 44px minmax(44px, 72px) 44px; align-items: center; gap: 6px; }
.close-note label { margin: 0; }
.close-note button { padding: 6px; font-size: 20px; }
.close-note input { text-align: center; padding: 8px 2px; }
.close-note p { grid-column: 1 / -1; }
.close-field-error { min-height: 18px; margin: 4px 0; color: #a21b1b; font-size: 12px; }
.close-total-card, .close-confirmation, .close-report { margin: 16px 0; padding: 18px; border: 1px solid #dce8fa; border-radius: 14px; background: white; }
.close-total-card { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.close-total-card strong { font-size: 22px; }
.close-totals { margin: 12px 0; }
.close-totals > div { display: flex; justify-content: space-between; gap: 20px; padding: 10px 0; border-bottom: 1px solid #e9eff8; }
.close-totals dt { color: #50658a; }
.close-totals dd { margin: 0; text-align: right; font-weight: 750; overflow-wrap: anywhere; }
.close-error, .close-warning, .close-notice { padding: 12px 14px; border-radius: 10px; line-height: 1.6; margin: 12px 0; }
.close-error { color: #991b1b; background: #fff0f0; border: 1px solid #fecaca; }
.close-warning { color: #734c0b; background: #fff8e9; border: 1px solid #eed5a4; }
.close-notice { color: #143768; background: #edf4ff; border: 1px solid #ccdffa; }
.close-success { color: #166534; font-weight: 750; }
.close-notification { font-weight: 700; }
h4 { font-size: 15px; font-weight: 750; margin: 0 0 8px; }
.close-button-row, .close-footer, .close-bottom { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.close-footer { justify-content: flex-end; padding: 16px 0 10px; }
.close-bottom { justify-content: flex-end; padding: 8px 0 max(4px, env(safe-area-inset-bottom)); }
.close-history { margin-top: 16px; padding-top: 16px; border-top: 1px solid #dce8fa; }
.close-history ul { list-style: none; padding: 0; display: grid; gap: 6px; }
.close-history li button { width: 100%; text-align: left; }
summary { cursor: pointer; min-height: 44px; display: flex; align-items: center; font-weight: 650; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; font-family: inherit; font-size: 12px; line-height: 1.6; background: #f5f8fd; padding: 12px; border-radius: 10px; }
@media (max-width: 640px) {
  .close-fields, .close-notes { grid-template-columns: 1fr; }
  .close-steps { grid-template-columns: 1fr; gap: 4px; }
  .close-steps li { padding: 6px 10px; }
  .close-totals > div { flex-direction: column; gap: 4px; }
  .close-totals dd { text-align: left; }
  .close-footer > button, .close-bottom > button { flex: 1 1 140px; }
  .close-report, .close-confirmation { padding: 14px; }
}
</style>
