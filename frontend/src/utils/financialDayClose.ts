export const CLOSE_DENOMINATIONS = [200, 100, 50, 20, 10, 5] as const;
export const PENDING_CLOSE_STORAGE_KEY = 'crm.financial-close.pending.v1';

export interface FinancialCloseSnapshot {
  cash_pacing_fact?: {
    status: 'inserted' | 'preserved';
    fact_date: string;
    amount_minor: number;
  };
  cash_balance_before_minor: number;
  counted_cash_minor: number;
  terminal_cash_minor: number;
  terminal_card_minor: number;
  terminal_total_minor: number;
  actual_total_minor: number;
  revenue_minor: number;
  profit_minor: number;
  discrepancy_minor: number;
  discrepancy_type: 'shortage' | 'surplus' | 'none';
  correction_minor: number;
  corrected_cash_minor: number;
  owner_cash_before_rounding_minor?: number;
  owner_rounding_minor?: number;
  owner_cash_minor: number;
  owner_card_minor: number;
  owner_total_minor: number;
  transfer_minor: number;
  revenue_balance_before_minor: number;
  revenue_balance_after_minor: number;
  retained_cash_minor: number;
  retained_notes_minor?: number;
  cash_balance_after_minor: number;
  coins_minor?: number;
  cash_account_name?: string;
  revenue_account_name?: string;
}

export interface SavedFinancialClose {
  id: string;
  business_date: string;
  time_zone: string;
  closed_at: string;
  employee_name: string;
  cash_account_id: string;
  revenue_account_id: string;
  report_text: string;
  notification_status: string;
  snapshot: FinancialCloseSnapshot;
  counts: Record<string, number>;
}

export interface FinancialCloseContext {
  cash_pacing?: {
    month_key: string;
    month_id: string | null;
    existing_amount_minor: number | null;
    revision: string;
  };
  business_date: string;
  time_zone: string;
  cash_account_id: string;
  revenue_account_id: string;
  cash_account_name: string;
  revenue_account_name: string;
  cash_balance_minor: number;
  revenue_balance_minor: number;
  revenue_minor: number;
  profit_minor: number;
  revision: string;
  notification_ready: boolean;
  test_reset_enabled?: boolean;
  closure: SavedFinancialClose | null;
}

export interface FinancialCloseInput {
  business_date: string;
  cash_account_id: string;
  revenue_account_id: string;
  terminal_cash: string;
  terminal_card: string;
  retained_cash: string;
  coins: string;
  counts: Record<string, number>;
}

export interface FinancialClosePreview {
  context: FinancialCloseContext;
  snapshot: FinancialCloseSnapshot;
}

export interface PendingFinancialClose {
  version: 1;
  key: string;
  payload: FinancialCloseInput & { expected_revision: string };
}

/** Decimal text is converted exactly; blanks and invalid values are not zero. */
export function parseCloseMoney(value: string): number | null {
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const minor = BigInt(match[1]!) * BigInt(100)
    + BigInt((match[2] || '').padEnd(2, '0'));
  return minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
}

export function parseCloseNoteCount(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const quantity = Number(value.trim());
  return Number.isSafeInteger(quantity) ? quantity : null;
}

export function countCloseCash(counts: Record<string, string>, coins: string): number | null {
  let total = parseCloseMoney(coins);
  if (total === null) return null;
  for (const denomination of CLOSE_DENOMINATIONS) {
    const quantity = parseCloseNoteCount(counts[String(denomination)] ?? '');
    if (quantity === null) return null;
    total += denomination * 100 * quantity;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

export function formatCloseMoney(minor: number): string {
  if (!Number.isSafeInteger(minor)) return 'Данные недоступны';
  const absolute = Math.abs(minor);
  return `${minor < 0 ? '−' : ''}${Math.floor(absolute / 100).toLocaleString('ru-RU')},${String(absolute % 100).padStart(2, '0')} BYN`;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

const SNAPSHOT_AMOUNTS = [
  'cash_balance_before_minor', 'counted_cash_minor', 'terminal_cash_minor',
  'terminal_card_minor', 'terminal_total_minor', 'actual_total_minor',
  'revenue_minor', 'profit_minor', 'discrepancy_minor', 'correction_minor',
  'corrected_cash_minor', 'owner_cash_minor', 'owner_card_minor',
  'owner_total_minor', 'transfer_minor', 'revenue_balance_before_minor',
  'revenue_balance_after_minor', 'retained_cash_minor', 'cash_balance_after_minor',
] as const;

function isCashPacingFact(value: unknown): boolean {
  return value === undefined || (record(value)
    && ['inserted', 'preserved'].includes(String(value.status))
    && typeof value.fact_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.fact_date)
    && Number.isSafeInteger(value.amount_minor) && Number(value.amount_minor) >= 0);
}

function isCashPacingContext(value: unknown): boolean {
  return value === undefined || (record(value)
    && typeof value.month_key === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value.month_key)
    && (value.month_id === null || (typeof value.month_id === 'string' && value.month_id !== ''))
    && (value.existing_amount_minor === null || (Number.isSafeInteger(value.existing_amount_minor) && Number(value.existing_amount_minor) >= 0))
    && typeof value.revision === 'string' && value.revision !== '');
}

export function isFinancialCloseSnapshot(value: unknown): value is FinancialCloseSnapshot {
  return record(value) && SNAPSHOT_AMOUNTS.every(key => Number.isSafeInteger(value[key]))
    && ['none', 'shortage', 'surplus'].includes(String(value.discrepancy_type))
    && isCashPacingFact(value.cash_pacing_fact)
    && (value.retained_notes_minor === undefined
      || (Number.isSafeInteger(value.retained_notes_minor) && Number(value.retained_notes_minor) >= 0
        && Number.isSafeInteger(value.coins_minor) && Number(value.coins_minor) >= 0
        && Number(value.owner_cash_minor) >= 0 && Number(value.transfer_minor) >= 0
        && Number(value.retained_cash_minor) >= 0 && Number(value.counted_cash_minor) >= 0
        && BigInt(Number(value.retained_notes_minor)) + BigInt(Number(value.coins_minor)) === BigInt(Number(value.retained_cash_minor))
        && value.cash_balance_after_minor === value.retained_cash_minor
        && BigInt(Number(value.owner_cash_minor)) + BigInt(Number(value.transfer_minor)) + BigInt(Number(value.retained_cash_minor)) === BigInt(Number(value.counted_cash_minor))))
    && ((value.owner_cash_before_rounding_minor === undefined && value.owner_rounding_minor === undefined)
      || (Number.isSafeInteger(value.owner_cash_before_rounding_minor)
        && Number(value.owner_cash_before_rounding_minor) >= 0
        && Number.isSafeInteger(value.owner_rounding_minor)
        && Number(value.owner_rounding_minor) >= -249 && Number(value.owner_rounding_minor) <= 250
        && Number(value.owner_cash_minor) >= 0 && Number(value.owner_cash_minor) % 500 === 0
        && BigInt(Number(value.owner_cash_before_rounding_minor)) + BigInt(Number(value.owner_rounding_minor)) === BigInt(Number(value.owner_cash_minor))
        && BigInt(Number(value.owner_cash_before_rounding_minor)) + BigInt(Number(value.owner_card_minor)) === BigInt(Number(value.profit_minor))
        && BigInt(Number(value.owner_cash_minor)) + BigInt(Number(value.owner_card_minor)) === BigInt(Number(value.owner_total_minor))));
}

export function isSavedFinancialClose(value: unknown): value is SavedFinancialClose {
  if (!record(value) || !isFinancialCloseSnapshot(value.snapshot) || !record(value.counts)) return false;
  return ['id', 'business_date', 'time_zone', 'closed_at', 'employee_name',
    'cash_account_id', 'revenue_account_id', 'report_text', 'notification_status']
    .every(key => typeof value[key] === 'string' && value[key] !== '')
    && /^\d{4}-\d{2}-\d{2}$/.test(String(value.business_date))
    && CLOSE_DENOMINATIONS.every(denomination => {
      const count = (value.counts as Record<string, unknown>)[String(denomination)];
      return Number.isSafeInteger(count) && Number(count) >= 0;
    });
}

export function isFinancialCloseContext(value: unknown): value is FinancialCloseContext {
  return record(value)
    && ['business_date', 'time_zone', 'cash_account_id', 'revenue_account_id',
      'cash_account_name', 'revenue_account_name', 'revision']
      .every(key => typeof value[key] === 'string' && value[key] !== '')
    && ['cash_balance_minor', 'revenue_balance_minor', 'revenue_minor', 'profit_minor']
      .every(key => Number.isSafeInteger(value[key]))
    && typeof value.notification_ready === 'boolean'
    && (value.test_reset_enabled === undefined || typeof value.test_reset_enabled === 'boolean')
    && isCashPacingContext(value.cash_pacing)
    && (value.closure === null || isSavedFinancialClose(value.closure));
}

/** No access tokens are persisted. Storage must succeed BEFORE any final POST. */
export function savePendingFinancialClose(storage: Pick<Storage, 'setItem'>, pending: PendingFinancialClose): void {
  storage.setItem(PENDING_CLOSE_STORAGE_KEY, JSON.stringify(pending));
}

export function loadPendingFinancialClose(storage: Pick<Storage, 'getItem'>): PendingFinancialClose | null {
  const text = storage.getItem(PENDING_CLOSE_STORAGE_KEY);
  if (text === null) return null;
  const value: unknown = JSON.parse(text);
  if (!record(value) || value.version !== 1 || typeof value.key !== 'string'
    || !/^[A-Za-z0-9:_-]{16,128}$/.test(value.key) || !record(value.payload)) {
    throw new Error('Не удалось прочитать незавершённое подтверждение. Проверьте историю закрытий перед новой операцией.');
  }
  const payload = value.payload;
  if (!['business_date', 'cash_account_id', 'revenue_account_id', 'expected_revision']
      .every(key => typeof payload[key] === 'string' && payload[key] !== '')
    || !/^\d{4}-\d{2}-\d{2}$/.test(String(payload.business_date))
    || !['terminal_cash', 'terminal_card', 'retained_cash', 'coins']
      .every(key => typeof payload[key] === 'string' && parseCloseMoney(payload[key] as string) !== null)
    || !record(payload.counts)
    || Object.keys(payload.counts).length !== CLOSE_DENOMINATIONS.length
    || !CLOSE_DENOMINATIONS.every(denomination => {
      const count = (payload.counts as Record<string, unknown>)[String(denomination)];
      return Number.isSafeInteger(count) && Number(count) >= 0;
    })) {
    throw new Error('Данные незавершённого подтверждения повреждены. Не создавайте новый запрос до проверки истории.');
  }
  return value as unknown as PendingFinancialClose;
}

export function notificationCloseLabel(status: string): string {
  const labels: Record<string, string> = {
    awaiting_recipient: 'Получатель не настроен',
    pending: 'В очереди', sending: 'Отправляется', sent: 'Отправлено',
    retry: 'Отправка отложена', failed: 'Ошибка доставки',
    unknown: 'Результат доставки неизвестен — требуется проверка',
  };
  return labels[status] || 'Статус доставки неизвестен';
}
