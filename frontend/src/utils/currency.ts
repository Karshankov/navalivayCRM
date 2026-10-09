/**
 * Единственное место, где деньги превращаются в текст.
 *
 * Раньше форматтер был скопирован в пять файлов, и в четырёх копиях стояли
 * российские рубли: отсюда «55 853 ₽» на дашборде и «361 BYN» в разделе
 * сотрудников на соседних экранах. Валюта одна, белорусский рубль.
 */
const bynFormatter = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'BYN',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
})

/** Компактный вид без копеек, для подписей и плиток. */
const bynWholeFormatter = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'BYN',
  maximumFractionDigits: 0
})

export function formatBynCurrency(amount: number): string {
  return bynFormatter.format(Number.isFinite(Number(amount)) ? Number(amount) : 0)
}

export function formatBynWhole(amount: number): string {
  return bynWholeFormatter.format(Number.isFinite(Number(amount)) ? Number(amount) : 0)
}

/** Пустое значение показываем прочерком, а не нулём. */
export function formatBynOrDash(amount?: number | null): string {
  if (amount === undefined || amount === null || !Number.isFinite(Number(amount))) {
    return '—'
  }
  return formatBynCurrency(Number(amount))
}
