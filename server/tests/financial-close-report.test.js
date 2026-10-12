import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFinancialCloseReport } from '../utils/financial-close-report.js';

test('concise report preserves requested money lines and omits reconciliation, rounding adjustment and reserve', () => {
  const snapshot = { revenue_minor: 131000, profit_minor: 68820,
    terminal_total_minor: 30000, terminal_cash_minor: 10000, terminal_card_minor: 20000,
    owner_cash_before_rounding_minor: 48820, owner_rounding_minor: 180,
    owner_cash_minor: 49000, owner_card_minor: 20000, owner_total_minor: 69000,
    revenue_balance_before_minor: 0, transfer_minor: 42000, revenue_balance_after_minor: 42000,
    discrepancy_minor: -100, cash_balance_before_minor: 134000, actual_total_minor: 133900,
    counted_cash_minor: 113900, cash_balance_after_minor: 23000, retained_notes_minor: 13000, coins_minor: 10000 };
  const before = structuredClone(snapshot);
  const text = buildFinancialCloseReport({ businessDate: '2026-10-12', employeeName: 'Тестировка CRM', snapshot });
  for (const line of ['📅 Дата: 12.10.2026', 'Прибыль за день: 688,20 BYN',
    'Наличными до округления: 488,20 BYN', 'Наличными: 490,00 BYN',
    'Уже получено по карте: 200,00 BYN', 'Всего: 690,00 BYN',
    'Было: 0,00 BYN', 'Занесено: +420,00 BYN', 'Итого: 420,00 BYN']) assert.ok(text.includes(line), line);
  assert.doesNotMatch(text, /Сверка кассы|Недостача|Излишек|По учёту|Фактически|Пересчитано|Корректировка|Округление до ближайших|Остаток в кассе|Оставлено купюрами|Монеты и мелкие/);
  assert.deepEqual(snapshot, before);
});
