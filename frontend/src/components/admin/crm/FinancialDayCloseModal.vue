<template>
  <AdminModal :is-open="isOpen" title="Закрыть финансовый день" size="lg" reference-design :show-actions="false" :is-loading="sending || resetting" :persistent="sending || resetting" :initial-focus="headingRef" @update:is-open="handleOpenChange">
    <div class="financial-close" :aria-busy="loading || previewing || sending">
      <h3 ref="headingRef" tabindex="-1" class="close-heading">{{ heading }}</h3>
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
          <div><dt>Прибыль дня из «Обзора»</dt><dd>{{ money(report.snapshot.profit_minor) }}</dd></div>
          <div><dt>Владельцу всего</dt><dd>{{ money(report.snapshot.owner_total_minor) }}</dd></div>
          <div><dt>Карта уже у владельца</dt><dd>{{ money(report.snapshot.owner_card_minor) }}</dd></div>
          <div class="close-owner-card"><dt>Передать владельцу наличными</dt><dd>{{ money(report.snapshot.owner_cash_minor) }}</dd></div>
          <div v-if="report.snapshot.owner_rounding_minor !== undefined && report.snapshot.owner_rounding_minor !== 0" data-test="close-saved-rounding"><dt>Разница округления</dt><dd>{{ roundingLabel(report.snapshot.owner_rounding_minor) }}</dd></div>
          <div v-if="report.snapshot.discrepancy_minor !== 0" class="close-discrepancy-row"><dt>{{ report.snapshot.discrepancy_minor < 0 ? 'Недостача' : 'Излишек' }}</dt><dd>{{ money(Math.abs(report.snapshot.discrepancy_minor)) }}</dd></div>
          <div><dt>Перевод в «{{ report.snapshot.revenue_account_name }}»</dt><dd>{{ money(report.snapshot.transfer_minor) }}</dd></div>
          <div><dt>Остаток в «{{ report.snapshot.cash_account_name }}»</dt><dd>{{ money(report.snapshot.cash_balance_after_minor) }}</dd></div>
        </dl>
        <p v-if="report.snapshot.cash_pacing_fact" class="close-notice" data-test="close-pacing-result">«План пробития → Факт по дням» за {{ displayDate(report.snapshot.cash_pacing_fact.fact_date) }}: {{ money(report.snapshot.cash_pacing_fact.amount_minor) }}. {{ report.snapshot.cash_pacing_fact.status === 'inserted' ? 'Сумма терминала внесена автоматически.' : 'Существующий факт оставлен без изменений; сумма терминала к нему не прибавлялась.' }}</p>
        <p class="close-notification" data-test="close-notification">Telegram: {{ notificationCloseLabel(report.notification_status) }}</p>
        <p class="close-muted">Доставка уведомления не изменяет сохранённый отчёт и не повторяет движения денег.</p>
        <details><summary>Полный текст отчёта</summary><pre>{{ report.report_text }}</pre></details>
        <div class="close-button-row">
          <button type="button" @click="downloadReport">Скачать отчёт (.txt)</button>
          <button type="button" :disabled="reportBusy || resetting" @click="refreshReport">Обновить статус Telegram</button>
          <button v-if="report.notification_status === 'awaiting_recipient'" type="button" :disabled="reportBusy || resetting" @click="enqueueReport">Поставить отчёт в очередь</button>
        </div>
        <p v-if="report.notification_status === 'awaiting_recipient'" class="close-muted">Настройте получателя группы «Закрытие финансового дня» в разделе сотрудников. Постановка в очередь доступна руководителю.</p>
        <section v-if="context?.test_reset_enabled === true && !pending && !storageProblem" class="close-test-reset" data-test="close-test-reset">
          <div class="close-test-reset-heading"><div><h4>Только для локальных тестов</h4><p class="close-muted">Сброс отменяет это закрытие: возвращает балансы и убирает его проводки, отчёт из истории и неотправленные уведомления. Продажи, товары и рабочая смена не изменяются.</p></div><button v-if="!resetConfirmOpen" type="button" class="close-reset-button" :disabled="reportBusy || resetting || loading || sending" data-test="close-reset" @click="setTestResetConfirmation(true)">Сброс</button></div>
          <div v-if="resetConfirmOpen" class="close-reset-confirmation" role="group" aria-labelledby="close-reset-title" data-test="close-reset-confirmation">
            <h4 id="close-reset-title">Отменить закрытие {{ displayDate(report.business_date) }}?</h4>
            <p>После сброса этот день можно будет закрыть снова с новым расчётом. Если счета уже изменились или отчёт отправлен, сервер не выполнит небезопасный откат.</p>
            <div class="close-button-row"><button type="button" :disabled="resetting" data-test="close-reset-cancel" @click="setTestResetConfirmation(false)">Не сбрасывать</button><button type="button" class="close-reset-button" :disabled="reportBusy || resetting || loading || sending" data-test="close-reset-confirm" @click="submitTestReset">{{ resetting ? 'Отменяем закрытие…' : 'Подтвердить сброс' }}</button></div>
          </div>
        </section>
        <button v-if="report.business_date !== context?.business_date" type="button" :disabled="sending || resetting" @click="returnToCurrentDay">Вернуться к текущему дню</button>
      </section>

      <section v-else-if="context && authorized && !loading && !pending && !storageProblem" class="close-wizard">
        <ol class="close-steps" aria-label="Этапы закрытия">
          <li v-for="(label, index) in stepLabels" :key="label" :aria-current="step === index + 1 ? 'step' : undefined" :class="{ current: step === index + 1, passed: step > index + 1 }"><span>{{ index + 1 }}</span>{{ label }}</li>
        </ol>
        <form novalidate @submit.prevent="nextStep">
          <fieldset :disabled="formLocked">
            <section v-if="step === 1" data-test="close-terminal-step">
              <p class="close-muted">Введите суммы из отчёта терминала. Это не дополнительный приход в кассу.</p>
              <p v-if="context.cash_pacing?.month_id === null" class="close-warning" data-test="close-pacing-month-missing">Сначала создайте месяц {{ context.cash_pacing.month_key }} в «Финансы → План пробития». Без него закрытие не сохранится. После создания месяца повторите серверный расчёт; введённые суммы можно оставить.</p>
              <p v-else-if="context.cash_pacing && context.cash_pacing.existing_amount_minor !== null" class="close-notice" data-test="close-pacing-preserved">В «Плане пробития» за {{ displayDate(context.business_date) }} уже внесено {{ money(context.cash_pacing.existing_amount_minor) }}. Эта сумма останется без изменений; итог терминала к ней не прибавляется.</p>
              <p v-else-if="context.cash_pacing" class="close-muted" data-test="close-pacing-auto">После успешного закрытия наличные + карта по терминалу автоматически попадут в «План пробития → Факт по дням» за {{ displayDate(context.business_date) }}.</p>
              <div class="close-fields">
                <div><label for="close-terminal-cash">Наличные по терминалу, BYN</label><input id="close-terminal-cash" v-model="terminalCash" inputmode="decimal" autocomplete="off" :aria-invalid="!!fieldError('terminal_cash')" aria-describedby="close-terminal-cash-error" data-test="close-terminal-cash" /><p id="close-terminal-cash-error" class="close-field-error">{{ fieldError('terminal_cash') }}</p></div>
                <div><label for="close-terminal-card">Карта по терминалу, BYN</label><input id="close-terminal-card" v-model="terminalCard" inputmode="decimal" autocomplete="off" :aria-invalid="!!fieldError('terminal_card')" aria-describedby="close-terminal-card-error" data-test="close-terminal-card" /><p id="close-terminal-card-error" class="close-field-error">{{ fieldError('terminal_card') }}</p></div>
              </div>
              <div class="close-total-card"><span>Итого по терминалу</span><strong>{{ terminalTotal === null ? 'Введите обе суммы' : money(terminalTotal) }}</strong></div>
            </section>
            <section v-else-if="step === 2" data-test="close-count-step">
              <div class="close-notes">
                <div v-for="(denominations, columnIndex) in [CLOSE_DENOMINATIONS.slice(0, 3), CLOSE_DENOMINATIONS.slice(3)]" :key="columnIndex" class="close-note-column" :data-test="`close-note-column-${columnIndex}`">
                  <div v-for="denomination in denominations" :key="denomination" class="close-note">
                    <div class="close-note-header">
                      <label :for="`close-note-${denomination}`"><span class="close-note-value">{{ denomination }}</span><span class="close-note-currency">BYN</span></label>
                    </div>
                    <input :id="`close-note-${denomination}`" v-model="counts[String(denomination)]" inputmode="numeric" @focus="clearZeroNoteCount(denomination)" @blur="restoreEmptyNoteCount(denomination)" :aria-label="`Количество купюр ${denomination} BYN`" :aria-invalid="!!fieldError(`note_${denomination}`)" :aria-describedby="`close-note-${denomination}-error`" />
                    <p :id="`close-note-${denomination}-error`" class="close-field-error">{{ fieldError(`note_${denomination}`) }}</p>
                  </div>
                </div>
              </div>
              <div class="close-field-card">
                <label for="close-coins">Монеты и мелкие номиналы, BYN</label><input id="close-coins" v-model="coins" inputmode="decimal" :aria-invalid="!!fieldError('coins')" aria-describedby="close-coins-error" data-test="close-coins" /><p id="close-coins-error" class="close-field-error">{{ fieldError('coins') }}</p>
                <p class="close-muted">Эта сумма полностью остаётся в кассе — владельцу выдаём только купюры.</p>
              </div>
              <dl class="close-totals">
                <div><dt>Пересчитано наличных</dt><dd>{{ countedCash === null ? 'Введите корректные количества и мелочь' : money(countedCash) }}</dd></div>
                <div><dt>Карта по терминалу</dt><dd>{{ cardMinor === null ? 'Данные недоступны' : money(cardMinor) }}</dd></div>
                <div><dt>Фактический общий остаток</dt><dd>{{ actualTotal === null ? 'Данные недоступны' : money(actualTotal) }}</dd></div>
                <div><dt>Общий баланс «{{ context.cash_account_name }}»</dt><dd>{{ money(context.cash_balance_minor) }}</dd></div>
                <div v-if="difference !== null && difference !== 0" class="close-discrepancy-row" data-test="close-discrepancy" role="status"><dt>{{ difference < 0 ? 'Недостача' : 'Излишек' }}</dt><dd>{{ money(Math.abs(difference)) }}</dd></div>
              </dl>
            </section>
            <section v-else data-test="close-distribution-step">
              <dl class="close-totals">
                <div><dt>Прибыль сегодняшнего дня из «Обзора» P</dt><dd>{{ money(context.profit_minor) }}</dd></div>
                <div><dt>Карта уже у владельца C</dt><dd>{{ cardMinor === null ? 'Данные недоступны' : money(cardMinor) }}</dd></div>
                <div><dt>Наличными до округления</dt><dd>{{ ownerCashBeforeRounding === null ? 'Данные недоступны' : money(ownerCashBeforeRounding) }}</dd></div>
                <div data-test="close-owner-rounded"><dt>Передать владельцу наличными · кратно 5 BYN</dt><dd>{{ ownerCash === null ? 'Данные недоступны' : money(ownerCash) }}</dd></div>
                <div v-if="ownerRounding !== null && ownerRounding !== 0" data-test="close-owner-rounding"><dt>Разница округления</dt><dd>{{ roundingLabel(ownerRounding) }}</dd></div>
              </dl>
              <p class="close-muted">Наличная выдача округляется до ближайших 5 BYN; ровно посередине — вверх. Разница меняет перевод в «Выручку», а не прибыль в «Обзоре».</p>
              <div class="close-field-card">
                <label for="close-retained">Оставить купюрами в «{{ context.cash_account_name }}», BYN</label><input id="close-retained" v-model="retainedCash" inputmode="decimal" :aria-invalid="!!fieldError('retained_cash')" aria-describedby="close-retained-error" data-test="close-retained" /><p id="close-retained-error" class="close-field-error">{{ fieldError('retained_cash') }}</p>
                <p class="close-muted">Укажите только купюры. Монеты добавятся к остатку автоматически.</p>
              </div>
              <dl class="close-totals" data-test="close-retained-total">
                <div><dt>Монеты и мелкие номиналы · остаются полностью</dt><dd>{{ coinsMinor === null ? 'Данные недоступны' : money(coinsMinor) }}</dd></div>
                <div><dt>Всего остаётся в кассе · монеты + купюры</dt><dd>{{ totalRetainedCash === null ? 'Введите корректный остаток купюрами' : money(totalRetainedCash) }}</dd></div>
              </dl>
              <p v-if="ownerCash !== null && ownerCash < 0" class="close-error">Карта превышает прибыль дня. Проверьте отчёт терминала и прибыль. Отрицательная передача наличных не заменяется нулём.</p>
              <button type="button" class="close-secondary" :disabled="previewing" data-test="close-preview" @click="calculatePreview">{{ previewing ? 'Рассчитываем…' : 'Рассчитать распределение' }}</button>
              <section v-if="preview" class="close-confirmation" data-test="close-preview-result">
                <h4>Проверьте серверный расчёт</h4>
                <dl class="close-totals">
                  <div><dt>Владельцу всего</dt><dd>{{ money(preview.snapshot.owner_total_minor) }}</dd></div>
                  <div><dt>Из них уже картой</dt><dd>{{ money(preview.snapshot.owner_card_minor) }}</dd></div>
                  <div class="close-owner-card"><dt>Передать наличными</dt><dd>{{ money(preview.snapshot.owner_cash_minor) }}</dd></div>
                  <div v-if="preview.snapshot.owner_rounding_minor !== undefined && preview.snapshot.owner_rounding_minor !== 0" data-test="close-preview-rounding"><dt>Разница округления</dt><dd>{{ roundingLabel(preview.snapshot.owner_rounding_minor) }}</dd></div>
                  <div v-if="preview.snapshot.discrepancy_minor !== 0" class="close-discrepancy-row" data-test="close-preview-discrepancy"><dt>{{ preview.snapshot.discrepancy_minor < 0 ? 'Недостача' : 'Излишек' }}</dt><dd>{{ money(Math.abs(preview.snapshot.discrepancy_minor)) }}</dd></div>
                  <div><dt>Перевод в «{{ preview.context.revenue_account_name }}»</dt><dd>{{ money(preview.snapshot.transfer_minor) }}</dd></div>
                  <div><dt>Остаток «{{ preview.context.cash_account_name }}»</dt><dd>{{ money(preview.snapshot.cash_balance_after_minor) }}</dd></div>
                  <div v-if="preview.context.cash_pacing"><dt>Факт в «Плане пробития» за {{ displayDate(preview.context.business_date) }}</dt><dd>{{ money(preview.context.cash_pacing.existing_amount_minor ?? preview.snapshot.terminal_total_minor) }} · {{ preview.context.cash_pacing.existing_amount_minor !== null ? 'существующая сумма сохранится без изменений' : 'будет внесён автоматически' }}</dd></div>
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
        <button type="button" :disabled="loading || sending || resetting || historyBusy" :aria-expanded="showHistory" data-test="close-history-toggle" @click="toggleHistory">История закрытий</button>
        <div v-if="showHistory">
          <p v-if="historyBusy" role="status">Загружаем историю…</p>
          <p v-else-if="history.length === 0 && !historyError">Сохранённых закрытий нет.</p>
          <p v-if="historyError" role="alert" class="close-error">{{ historyError }}</p>
          <ul><li v-for="item in history" :key="item.id"><button type="button" :disabled="sending" @click="viewHistoryReport(item)">{{ displayDate(item.business_date) }} · {{ item.employee_name }} · {{ notificationCloseLabel(item.notification_status) }}</button></li></ul>
          <button v-if="historyHasMore" type="button" :disabled="historyBusy" @click="loadHistory(true)">Загрузить ещё</button>
        </div>
      </section>
    </div>
    <template #footer><div class="close-bottom"><span v-if="sending || resetting" role="status">{{ resetting ? 'Отменяем тестовое закрытие — дождитесь результата.' : 'Сохраняем отчёт — не повторяйте операцию.' }}</span><button type="button" :disabled="sending || resetting" @click="handleOpenChange(false)">{{ pending ? 'Закрыть окно — проверка сохранится' : 'Закрыть окно' }}</button></div></template>
  </AdminModal>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import AdminModal from '@/components/AdminModal.vue';
import { requestFinancialDayClose, StaffApiError, useCrmStore, type CashAccount } from '@/stores/crm';
import { CLOSE_DENOMINATIONS, PENDING_CLOSE_STORAGE_KEY, countCloseCash, formatCloseMoney, isFinancialCloseContext, isFinancialCloseSnapshot, isSavedFinancialClose, loadPendingFinancialClose, notificationCloseLabel, parseCloseMoney, parseCloseNoteCount, savePendingFinancialClose, type FinancialCloseContext, type FinancialCloseInput, type FinancialClosePreview, type PendingFinancialClose, type SavedFinancialClose } from '@/utils/financialDayClose';

const props = defineProps<{ isOpen: boolean }>();
const emit = defineEmits<{ close: []; saved: [closure: SavedFinancialClose]; reset: [closureId: string] }>();
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
const resetting = ref(false);
const resetConfirmOpen = ref(false);
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
const formLocked = computed(() => loading.value || previewing.value || sending.value || resetting.value || !!pending.value || storageProblem.value);
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
const ownerCashBeforeRounding = computed(() => context.value && cardMinor.value !== null ? safeSum(context.value.profit_minor, -cardMinor.value) : null);
const ownerCash = computed(() => {
  const value = ownerCashBeforeRounding.value;
  if (value === null || value < 0) return value;
  const rounded = Number((BigInt(value) + BigInt(250)) / BigInt(500) * BigInt(500));
  return Number.isSafeInteger(rounded) ? rounded : null;
});
const ownerRounding = computed(() => ownerCash.value !== null && ownerCashBeforeRounding.value !== null && ownerCashBeforeRounding.value >= 0
  ? safeSum(ownerCash.value, -ownerCashBeforeRounding.value) : null);
function roundingLabel(value: number): string {
  return value > 0 ? `${money(value)} из выручки` : value < 0 ? `${money(-value)} остаётся в выручке` : 'Без изменения';
}

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
async function setTestResetConfirmation(open: boolean) {
  if (resetting.value || sending.value || loading.value || reportBusy.value) return;
  resetConfirmOpen.value = open;
  const generation = loadGeneration;
  await nextTick();
  if (generation !== loadGeneration || !props.isOpen || resetConfirmOpen.value !== open) return;
  headingRef.value?.parentElement?.querySelector<HTMLButtonElement>(
    open ? '[data-test="close-reset-cancel"]' : '[data-test="close-reset"]',
  )?.focus();
}
function fieldError(field: string): string {
  if (!touched.value) return '';
  if (field.startsWith('note_')) return parseCloseNoteCount(counts[field.slice(5)] ?? '') === null ? 'Введите неотрицательное целое количество.' : '';
  const values: Record<string, string> = { terminal_cash: terminalCash.value, terminal_card: terminalCard.value, coins: coins.value, retained_cash: retainedCash.value };
  return parseCloseMoney(values[field] ?? '') === null ? 'Введите сумму: например 0 или 12,50. Не более двух знаков после запятой.' : '';
}
async function focusInvalid() { await nextTick(); headingRef.value?.parentElement?.querySelector<HTMLInputElement>('input[aria-invalid="true"]')?.focus(); }
function clearZeroNoteCount(denomination: number) {
  const key = String(denomination);
  if (!formLocked.value && counts[key] === '0') counts[key] = '';
}
function restoreEmptyNoteCount(denomination: number) {
  const key = String(denomination);
  if (!formLocked.value && counts[key]?.trim() === '') counts[key] = '0';
}
async function nextStep() {
  if (formLocked.value) return;
  touched.value = true;
  if (step.value === 1 && (parseCloseMoney(terminalCash.value) === null || cardMinor.value === null || terminalTotal.value === null)) { await focusInvalid(); return; }
  if (step.value === 2 && (countedCash.value === null || actualTotal.value === null || difference.value === null)) { await focusInvalid(); return; }
  if (step.value < 3) { step.value++; touched.value = false; await focusHeading(); }
}
async function goBack() { if (!formLocked.value && step.value > 1) { step.value--; touched.value = false; await focusHeading(); } }
const coinsMinor = computed(() => parseCloseMoney(coins.value));
const totalRetainedCash = computed(() => safeSum(coinsMinor.value, parseCloseMoney(retainedCash.value)));
function makeInput(): FinancialCloseInput {
  if (!context.value || parseCloseMoney(terminalCash.value) === null || cardMinor.value === null || countedCash.value === null || totalRetainedCash.value === null) {
    throw new Error('Заполните все суммы и количества корректно. Общий остаток монет и купюр должен быть допустимой суммой.');
  }
  const retainedTotal = totalRetainedCash.value;
  return {
    business_date: context.value.business_date,
    cash_account_id: context.value.cash_account_id,
    revenue_account_id: context.value.revenue_account_id,
    terminal_cash: terminalCash.value.trim(), terminal_card: terminalCard.value.trim(),
    coins: coins.value.trim(),
    // The API receives the total reserve; the visible field contains banknotes only.
    retained_cash: `${Math.floor(retainedTotal / 100)}.${String(retainedTotal % 100).padStart(2, '0')}`,
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
  coins.value = value.payload.coins;
  const savedTotal = parseCloseMoney(value.payload.retained_cash);
  const savedCoins = parseCloseMoney(value.payload.coins);
  const savedNotes = savedTotal !== null && savedCoins !== null ? safeSum(savedTotal, -savedCoins) : null;
  // Recovery retries the original payload unchanged; never add its coins twice.
  retainedCash.value = savedNotes !== null && savedNotes >= 0
    ? `${Math.floor(savedNotes / 100)}.${String(savedNotes % 100).padStart(2, '0')}` : '';
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
  reportBusy.value = false; recovering.value = false; resetConfirmOpen.value = false;
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
    const definiteRejections = ['closing_request_was_reset', 'closing_preview_stale', 'closing_day_changed', 'closing_cash_pacing_month_required', 'negative_owner_cash', 'insufficient_counted_cash', 'retained_cash_below_coins', 'invalid_money', 'invalid_note_count', 'invalid_denomination', 'invalid_closing_input', 'closing_accounts_must_differ', 'closing_account_not_found'];
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
function viewHistoryReport(item: SavedFinancialClose) {
  if (sending.value || resetting.value) return;
  resetConfirmOpen.value = false; report.value = item; void focusHeading();
}
async function submitTestReset() {
  if (!report.value || context.value?.test_reset_enabled !== true || !resetConfirmOpen.value
    || resetting.value || sending.value || loading.value || reportBusy.value || pending.value || storageProblem.value) return;
  const id = report.value.id;
  const generation = loadGeneration;
  resetting.value = true; error.value = ''; notice.value = '';
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 25000);
  try {
    const result = await api<{ reset: boolean; closure_id: string }>(`/history/${encodeURIComponent(id)}/test-reset`, {
      method: 'POST', body: JSON.stringify({ confirm_closure_id: id }), signal: controller.signal,
    });
    if (generation !== loadGeneration || !props.isOpen) return;
    if (result.reset !== true || result.closure_id !== id) invalidResponse();
    resetConfirmOpen.value = false; resetDraft(); draftDate = ''; report.value = null;
    clearPending(); emit('reset', id);
    await loadContext();
    notice.value = 'Закрытие отменено. Балансы восстановлены; можно пройти мастер заново.';
    await focusHeading();
  } catch (resetError) {
    if (generation !== loadGeneration || !props.isOpen) return;
    error.value = errorText(resetError);
    if (!(resetError instanceof StaffApiError) || resetError.outcomeUnknown) {
      notice.value = 'Ответ на сброс не подтверждён. Повторите сброс этого же отчёта: сервер не отменит другие операции и не выполнит его дважды.';
    }
  } finally { window.clearTimeout(timeout); resetting.value = false; }
}
async function reportRequest(enqueue = false) {
  if (!report.value || reportBusy.value || resetting.value) return;
  reportBusy.value = true; error.value = '';
  const id = report.value.id;
  const generation = loadGeneration;
  const signal = readController?.signal;
  try {
    const result = await api<{ closure: SavedFinancialClose }>(`/history/${encodeURIComponent(id)}${enqueue ? '/report' : ''}`, { method: enqueue ? 'POST' : 'GET', signal });
    if (generation !== loadGeneration || signal?.aborted || !props.isOpen) return;
    if (!isSavedFinancialClose(result.closure) || result.closure.id !== id) invalidResponse();
    if (report.value?.id === id) {
      report.value = result.closure;
      if (result.closure.notification_status === 'sent') {
        void crm.fetchStaffShift().catch(() => undefined);
      }
    }
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
  if (open || sending.value || resetting.value) return;
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
.financial-close { min-width: 0; color: #081b4b; font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; font-size: 16px; line-height: 1.55; }
.financial-close *, .financial-close *::before, .financial-close *::after { box-sizing: border-box; }
.close-heading { margin: 0 0 16px; font-size: clamp(24px, 3vw, 30px); font-weight: 850; line-height: 1.2; letter-spacing: -.035em; outline-offset: 4px; overflow-wrap: anywhere; }
.close-muted { color: #50658a; font-size: 15px; line-height: 1.6; overflow-wrap: anywhere; }
h4 { margin: 0 0 10px; font-size: 21px; line-height: 1.3; font-weight: 800; letter-spacing: -.02em; overflow-wrap: anywhere; }
.close-steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); list-style: none; padding: 0; margin: 20px 0; gap: 10px; }
.close-steps li { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 14px 12px; border: 1px solid #dce8fa; border-radius: 14px; background: #f7faff; color: #50658a; font-size: 14px; font-weight: 650; line-height: 1.35; }
.close-steps span { display: grid; place-items: center; width: 30px; height: 30px; flex-shrink: 0; border-radius: 50%; background: #e7edf8; font-weight: 800; }
.close-steps .current { border-color: #83b9ff; color: #1040aa; background: linear-gradient(140deg, #fff, #edf6ff); font-weight: 750; box-shadow: 0 6px 18px #148cff12; }
.close-steps .current span { background: linear-gradient(100deg, #05b8ff, #185dff); color: white; }
.close-steps .passed { color: #000; font-weight: 750; border-color: transparent; background: linear-gradient(#f0fff5, #f0fff5) padding-box, linear-gradient(135deg, #86efac, #16a34a) border-box; }
.close-steps .passed span { color: #000; background: linear-gradient(135deg, #86efac, #22c55e); }
fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
.close-account-selection, .close-report, .close-wizard fieldset > section, .close-history { min-width: 0; padding: 22px; border: 1px solid #e3ecf9; border-radius: 20px; background: radial-gradient(ellipse at 100% 0%, #edf6ff, transparent 65%), #fff; box-shadow: 0 10px 35px #20386908; }
.close-account-selection, .close-report { margin: 16px 0; }
.close-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.close-fields > div, .close-field-card { min-width: 0; padding: 18px; border: 1px solid #e3ecf9; border-radius: 16px; background: #fff; }
.close-field-card { margin: 16px 0; }
label { display: block; margin: 12px 0 9px; font-size: 16px; font-weight: 750; line-height: 1.45; }
.close-fields label, .close-field-card > label { margin-top: 0; }
input, select { width: 100%; min-width: 0; min-height: 50px; padding: 12px 14px; border: 1px solid #ccd9ec; border-radius: 12px; background: #f7fbff; color: #081b4b; font: inherit; font-size: 20px; font-weight: 750; font-variant-numeric: tabular-nums; }
select { font-size: 16px; }
input[aria-invalid='true'] { border-color: #b91c1c; }
button { max-width: 100%; min-height: 48px; padding: 12px 18px; border: 1px solid #d5e1f2; border-radius: 12px; background: linear-gradient(#f7faff, #e9f0fa); color: #233e70; font: inherit; font-size: 16px; font-weight: 750; line-height: 1.4; cursor: pointer; overflow-wrap: anywhere; }
button:hover:not(:disabled) { filter: brightness(1.04); }
button:disabled { opacity: .55; cursor: not-allowed; }
button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible { outline: 2px solid #0958ff; outline-offset: 3px; }
.close-primary { border-color: transparent; background: linear-gradient(100deg, #05b8ff, #185dff); color: white; box-shadow: 0 8px 16px #148cff30; }
.close-secondary { margin-top: 8px; }
.financial-close .close-notes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin: 0 0 18px; }
.close-note-column { display: grid; align-content: start; gap: 12px; min-width: 0; }
.close-note { min-width: 0; padding: 16px; border: 1px solid #dce8fa; border-radius: 17px; background: linear-gradient(140deg, #fff, #edf6ff); box-shadow: 0 6px 19px #455f7a0a; }
.close-note-header { margin-bottom: 12px; text-align: center; }
.close-note label { display: flex; flex-direction: column; align-items: center; margin: 0; white-space: nowrap; }
.close-note-value { font-size: clamp(48px, 4.2vw, 60px); font-weight: 900; line-height: 1.05; letter-spacing: -.03em; }
.close-note-currency { margin-top: 4px; color: #50658a; font-size: 14px; font-weight: 750; line-height: 1.4; }
.close-note input { text-align: center; padding: 10px 8px; background: #fff; font-size: 24px; font-weight: 800; }
.close-field-error { margin: 7px 0 0; color: #a21b1b; font-size: 14px; line-height: 1.45; overflow-wrap: anywhere; }
.close-field-error:empty { display: none; }
.close-total-card { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; margin: 18px 0 0; padding: 22px; border: 1px solid #dce8fa; border-radius: 17px; background: linear-gradient(140deg, #fff, #edf6ff); }
.close-total-card span { color: #425778; font-weight: 650; }
.close-total-card strong { font-size: clamp(26px, 4vw, 36px); font-weight: 850; letter-spacing: -.035em; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.close-totals { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin: 18px 0; }
.close-totals > div { display: flex; flex-direction: column; justify-content: space-between; gap: 10px; min-width: 0; padding: 18px; border: 1px solid #e3ecf9; border-radius: 16px; background: #fff; box-shadow: 0 6px 19px #455f7a08; }
.close-totals dt { color: #50658a; font-size: 15px; font-weight: 650; line-height: 1.45; overflow-wrap: anywhere; }
.close-totals dd { margin: 0; color: #081b4b; font-size: clamp(23px, 3vw, 28px); line-height: 1.25; font-weight: 850; letter-spacing: -.025em; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.close-totals > .close-owner-card, .close-totals > [data-test='close-owner-rounded'] { grid-column: 1 / -1; order: -1; gap: 14px; padding: 26px; border-color: #b4d9ff; background: radial-gradient(ellipse at 100% 0%, #d8f2ff, transparent 70%), linear-gradient(140deg, #fff, #e9f2ff); box-shadow: 0 10px 28px #148cff18; }
.close-totals > .close-owner-card dt, .close-totals > [data-test='close-owner-rounded'] dt { color: #143768; font-size: 19px; font-weight: 800; }
.close-totals > .close-owner-card dd, .close-totals > [data-test='close-owner-rounded'] dd { color: #081b4b; font-size: clamp(36px, 5.5vw, 56px); font-weight: 900; letter-spacing: -.04em; line-height: 1.12; }
.close-owner-hint { margin: 0 0 16px; color: #425778; font-size: 15px; line-height: 1.6; }
.close-totals > .close-discrepancy-row { grid-column: 1 / -1; border-color: #fecaca; background: #fff0f0; }
.close-totals > .close-discrepancy-row dt, .close-totals > .close-discrepancy-row dd { color: #b91c1c; font-weight: 800; }
.close-confirmation { margin: 22px 0 0; padding: 22px; border: 1px solid #bcd9f9; border-radius: 18px; background: #f5faff; }
.close-error, .close-warning, .close-notice { padding: 16px 18px; border-radius: 14px; font-size: 15px; line-height: 1.6; margin: 14px 0; overflow-wrap: anywhere; }
.close-error p { margin: 0; }
.close-error { color: #991b1b; background: #fff0f0; border: 1px solid #fecaca; }
.close-warning { color: #734c0b; background: #fff8e9; border: 1px solid #eed5a4; }
.close-notice { color: #143768; background: #edf4ff; border: 1px solid #ccdffa; }
.close-success { display: inline-flex; align-items: center; margin: 0 0 14px; padding: 8px 14px; border: 1px solid #bbebcb; border-radius: 30px; background: #f0fff5; color: #166534; font-size: 15px; font-weight: 800; }
.close-notification { padding: 16px 18px; border: 1px solid #dce8fa; border-radius: 14px; background: #f7fbff; font-size: 16px; font-weight: 750; overflow-wrap: anywhere; }
.close-test-reset { margin-top: 22px; padding: 18px; border: 1px dashed #d4a974; border-radius: 16px; background: #fffaf2; }
.close-test-reset-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.close-test-reset-heading > div { min-width: 0; }
.close-test-reset-heading p { margin: 0; }
.close-reset-button { flex-shrink: 0; border-color: #c87152; background: #fff3ed; color: #923b20; }
.close-reset-confirmation { margin-top: 16px; padding-top: 16px; border-top: 1px solid #ebd4b6; line-height: 1.55; }
.close-reset-confirmation > p { margin: 0 0 12px; }
.close-button-row, .close-footer, .close-bottom { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.close-footer { justify-content: flex-end; padding: 20px 0 10px; }
.close-bottom { justify-content: flex-end; padding: 8px 0 max(4px, env(safe-area-inset-bottom)); }
.close-bottom button { font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; }
.close-history { margin-top: 18px; }
.close-history ul { list-style: none; padding: 0; display: grid; gap: 10px; }
.close-history li button { width: 100%; padding: 16px; background: #fff; text-align: left; }
details { margin: 18px 0; padding: 4px 16px; border: 1px solid #e3ecf9; border-radius: 14px; background: #fff; }
summary { cursor: pointer; min-height: 48px; padding: 10px 0; color: #233e70; font-size: 16px; font-weight: 750; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; font-family: inherit; font-size: 15px; line-height: 1.6; background: #f5f8fd; padding: 16px; border-radius: 12px; }
@media (max-width: 640px) {
  .close-fields, .close-totals, .close-steps { grid-template-columns: minmax(0, 1fr); }
  .close-steps { gap: 6px; }
  .close-steps li { padding: 10px 12px; }
  .close-account-selection, .close-report, .close-wizard fieldset > section, .close-history { padding: 14px; border-radius: 16px; }
  .close-totals > div, .close-fields > div, .close-field-card, .close-confirmation { padding: 16px; }
  .close-totals > .close-owner-card, .close-totals > [data-test='close-owner-rounded'] { padding: 20px 16px; }
  .close-totals > .close-owner-card dt, .close-totals > [data-test='close-owner-rounded'] dt { font-size: 17px; }
  .close-footer > button, .close-bottom > button { flex: 1 1 140px; }
}
@media (max-width: 480px) {
  .financial-close .close-notes { gap: 8px; }
  .close-note-column { gap: 8px; }
  .close-note { padding: 10px 8px; border-radius: 14px; }
  .close-test-reset-heading { flex-direction: column; gap: 12px; }
  .close-test-reset-heading > button { width: 100%; }
}
</style>
