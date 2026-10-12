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
  return [
    '✅ Финансовый день закрыт | Итоги',
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
    '👤 Выдача Константину',
    ...(Number.isSafeInteger(s.owner_cash_before_rounding_minor) ? [
      `Наличными до округления: ${money(s.owner_cash_before_rounding_minor)}`,
    ] : []),
    `Наличными: ${money(s.owner_cash_minor)}`,
    `Уже получено по карте: ${money(s.owner_card_minor)}`,
    `Всего: ${money(s.owner_total_minor)}`,
    '',
    '🏦 Счёт «Выручка»',
    `Было: ${money(s.revenue_balance_before_minor)}`,
    `Занесено: +${money(s.transfer_minor)}`,
    `Итого: ${money(s.revenue_balance_after_minor)}`,
    '',
    '✅ Финансовый день успешно закрыт.',
  ].join('\n');
}
