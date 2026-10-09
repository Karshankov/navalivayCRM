/**
 * Подпись над столбиком графика.
 *
 * Раньше здесь стоял `value.toString()` с комментарием «точное значение без
 * округления», и над столбиками печаталось 1275.5360149761204. Подписи налезали
 * друг на друга и читать их было невозможно.
 *
 * Над столбиком нужен ориентир, а не точная сумма: точную показывает подсказка
 * при наведении. Поэтому копейки отбрасываем, а тысячи разделяем пробелом.
 */
export function formatChartValueCompact(value: number): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "0";
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 0,
  }).format(amount);
}
