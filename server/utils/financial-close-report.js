export function formatCloseMoney(minor) {
  if (!Number.isSafeInteger(minor)) throw new TypeError('invalid_report_amount');
  const absolute = Math.abs(minor);
  const whole = Math.floor(absolute / 100).toLocaleString('ru-RU');
  return `${minor < 0 ? '−' : ''}${whole},${String(absolute % 100).padStart(2, '0')} BYN`;
}

/** Build ONLY from the persisted closing snapshot, never current accounts. */
export function buildFinancialCloseReport({ businessDate, employeeName, snapshot: s }) {
  const [year, month, day] = businessDate.split('-');
  const money = formatCloseMoney;
  const discrepancy = s.discrepancy_minor;
  const reconciliation = [
    '🧾 Сверка кассы',
    discrepancy < 0 ? `⚠️ Недостача: ${money(-discrepancy)}` : 'Недостача: не имеется',
    discrepancy > 0 ? `⚠️ Излишек: ${money(discrepancy)}` : 'Излишек: не имеется',
    `По учёту: ${money(s.cash_balance_before_minor)}`,
    `Фактически: ${money(s.actual_total_minor)}`,
    `Пересчитано наличных: ${money(s.counted_cash_minor)}`,
    `Корректировка «Кассы»: ${discrepancy > 0 ? '+' : ''}${money(discrepancy)}`,
  ];
  return [
    '✅ Смена закрыта | Итоги',
    '',
    `📅 Дата: ${day}.${month}.${year}`,
    `👤 Сотрудник: ${String(employeeName).replace(/[\r\n\u0000-\u001f]/g, ' ').trim()}`,
    '',
    '💰 Финансовые итоги',
    `Выручка за день: ${money(s.revenue_minor)}`,
    `Прибыль за день: ${money(s.profit_minor)}`,
    '',
    `💳 Пробито по терминалу: ${money(s.terminal_total_minor)}`,
    `• Наличными: ${money(s.terminal_cash_minor)}`,
    `• Картой: ${money(s.terminal_card_minor)}`,
    '',
    ...reconciliation,
    '',
    '👤 Выдача Константину',
    `Наличными: ${money(s.owner_cash_minor)}`,
    `Уже получено по карте: ${money(s.owner_card_minor)}`,
    `Всего: ${money(s.owner_total_minor)}`,
    '',
    '🏦 Счёт «Выручка»',
    `Было: ${money(s.revenue_balance_before_minor)}`,
    `Занесено: +${money(s.transfer_minor)}`,
    `Итого: ${money(s.revenue_balance_after_minor)}`,
    '',
    '💵 Остаток в кассе',
    money(s.cash_balance_after_minor),
    '',
    '✅ Смена успешно закрыта.',
  ].join('\n');
}
