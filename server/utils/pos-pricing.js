import { roundMoney } from './money.js';

/**
 * Цена товара на кассе.
 *
 * Менеджер публикует категорию или линейку на заблокированный экран и может
 * задать там свою цену. Возможны два способа, и они не взаимоисключающие:
 *
 *   - `fixed_price` — готовая цена для кассы. Она приоритетнее наценки:
 *     если менеджер написал «на кассе 35», спорить с этим нечем.
 *   - `markup_amount` / `markup_percent` — наценка к рознице. Сначала
 *     прибавляется сумма, потом процент от розницы. Так «+5₽ и +10%»
 *     означает 16 + 5 + 10% от 16, а не 10% от 21.
 *
 * Наценка линейки перекрывает наценку категории: линейка — более точная
 * настройка и задаётся позже. Смешивать их нельзя, иначе кассир видит цену,
 * которую никто не настраивал.
 */

const RETURN_REASONS = {
  fixed: 'fixed',
  markup: 'markup',
  retail: 'retail',
};

function toFiniteNumber(value) {
  // Number(null) — это 0, а Number('') — тоже 0. Для настроек это опасная
  // ловушка: незаполненная наценка читалась бы как «наценка 0 ₽» и перебивала
  // настройку категории. Поэтому пустые значения честно считаем отсутствующими.
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Есть ли у публикации хоть какая-то настройка цены.
 * @param {object|null|undefined} publication запись pos_publications
 */
export function hasPosPriceOverride(publication) {
  if (!publication) return false;
  if (toFiniteNumber(publication.fixed_price) !== null) return true;
  if (toFiniteNumber(publication.markup_amount) !== null) return true;
  if (toFiniteNumber(publication.markup_percent) !== null) return true;
  return false;
}

/**
 * Рассчитать кассовую цену.
 *
 * @param {object} params
 * @param {number} params.retail розничная цена товара (или варианта)
 * @param {object|null} [params.groupPublication] настройка на линейке
 * @param {object|null} [params.categoryPublication] настройка на категории
 * @returns {{ price: number, basePrice: number, reason: 'fixed'|'markup'|'retail', publication: object|null }}
 * @throws {Error} invalid_retail_price — розница не число или отрицательна
 */
export function resolvePosPrice({ retail, groupPublication = null, categoryPublication = null }) {
  const basePrice = toFiniteNumber(retail);
  if (basePrice === null || basePrice < 0) {
    throw new Error('invalid_retail_price');
  }

  const publication = hasPosPriceOverride(groupPublication)
    ? groupPublication
    : hasPosPriceOverride(categoryPublication)
      ? categoryPublication
      : null;

  if (!publication) {
    return {
      price: roundMoney(basePrice),
      basePrice: roundMoney(basePrice),
      reason: RETURN_REASONS.retail,
      publication: null,
    };
  }

  const fixedPrice = toFiniteNumber(publication.fixed_price);
  if (fixedPrice !== null) {
    // Отрицательная или нулевая фикс-цена почти наверняка опечатка в настройке,
    // но обнулять товар молча хуже: сервер уже валидирует сохранение, здесь
    // просто не даём цене уехать ниже нуля.
    return {
      price: roundMoney(Math.max(0, fixedPrice)),
      basePrice: roundMoney(basePrice),
      reason: RETURN_REASONS.fixed,
      publication,
    };
  }

  const markupAmount = toFiniteNumber(publication.markup_amount) ?? 0;
  const markupPercent = toFiniteNumber(publication.markup_percent) ?? 0;
  const percentPart = (basePrice * markupPercent) / 100;

  return {
    price: roundMoney(Math.max(0, basePrice + markupAmount + percentPart)),
    basePrice: roundMoney(basePrice),
    reason: RETURN_REASONS.markup,
    publication,
  };
}

/**
 * Разложить скидку чека по позициям пропорционально их суммам.
 *
 * Скидка нужна не только ради «итого»: прибыль чека считается как сумма по
 * позициям, поэтому скидка должна уменьшить и выручку, и маржу каждой
 * позиции. Иначе на отчёте «Обзор» одна позиция с прибылью 100% перевесит
 * скидку, которую дали на весь чек.
 *
 * Остаток от округления отдаём последней позиции, чтобы сумма частей
 * совпала с суммой скидки до копейки.
 *
 * @param {Array<{ amount: number }>} lines суммы позиций до скидки чека
 * @param {number} discountAmount скидка на чек
 * @returns {number[]} скидка по каждой позиции
 */
export function allocateCheckDiscount(lines, discountAmount) {
  const amounts = (Array.isArray(lines) ? lines : []).map((line) => {
    const value = toFiniteNumber(line?.amount);
    return value !== null && value > 0 ? value : 0;
  });
  const total = amounts.reduce((sum, amount) => sum + amount, 0);
  const discount = Math.max(0, toFiniteNumber(discountAmount) ?? 0);

  if (total <= 0 || discount <= 0) {
    return amounts.map(() => 0);
  }

  const capped = Math.min(discount, total);
  const shares = amounts.map((amount) => roundMoney((capped * amount) / total));

  const allocated = shares.reduce((sum, share) => sum + share, 0);
  const remainder = roundMoney(capped - allocated);
  if (remainder !== 0 && shares.length > 0) {
    // Последней позиции — добавить или снять остаток, но не увести в минус.
    let index = shares.length - 1;
    while (index >= 0 && shares[index] + remainder < 0) index -= 1;
    if (index >= 0) {
      shares[index] = roundMoney(shares[index] + remainder);
    }
  }

  return shares;
}

/**
 * Посчитать итоги чека.
 *
 * Скидка позиции задаётся либо суммой, либо процентом — не одновременно.
 * Порядок: скидка позиции, затем скидка чека на остаток. Так «-10% на чек»
 * не пересчитывается от цены, которую уже скинули руками на позиции.
 *
 * @param {Array<{
 *   unitPrice: number, quantity: number, costPrice: number,
 *   discountAmount?: number, discountPercent?: number
 * }>} items
 * @param {{ checkDiscountAmount?: number, checkDiscountPercent?: number }} [check]
 * @returns {{
 *   lines: Array<object>,
 *   subtotal: number,
 *   lineDiscountTotal: number,
 *   checkDiscount: number,
 *   total: number,
 *   costTotal: number,
 *   profit: number,
 * }}
 */
export function computeCheckTotals(items, check = {}) {
  const lines = (Array.isArray(items) ? items : []).map((item) => {
    const unitPrice = Math.max(0, toFiniteNumber(item?.unitPrice) ?? 0);
    const quantity = Math.max(0, Math.trunc(toFiniteNumber(item?.quantity) ?? 0));
    const costPrice = Math.max(0, toFiniteNumber(item?.costPrice) ?? 0);
    const gross = roundMoney(unitPrice * quantity);

    const explicitAmount = toFiniteNumber(item?.discountAmount) ?? 0;
    const explicitPercent = toFiniteNumber(item?.discountPercent) ?? 0;
    const lineDiscount = roundMoney(
      Math.min(gross, Math.max(0, explicitAmount) + (gross * Math.max(0, explicitPercent)) / 100),
    );

    const net = roundMoney(gross - lineDiscount);
    return {
      unitPrice,
      quantity,
      costPrice,
      gross,
      discountAmount: lineDiscount,
      lineTotal: net,
      lineCost: roundMoney(costPrice * quantity),
    };
  });

  const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.gross, 0));
  const afterLineDiscounts = roundMoney(lines.reduce((sum, line) => sum + line.lineTotal, 0));

  const checkAmountInput = Math.max(0, toFiniteNumber(check?.checkDiscountAmount) ?? 0);
  const checkPercentInput = Math.max(0, toFiniteNumber(check?.checkDiscountPercent) ?? 0);
  const checkDiscount = roundMoney(
    Math.min(
      afterLineDiscounts,
      checkAmountInput + (afterLineDiscounts * checkPercentInput) / 100,
    ),
  );

  const shares = allocateCheckDiscount(
    lines.map((line) => ({ amount: line.lineTotal })),
    checkDiscount,
  );

  const detailedLines = lines.map((line, index) => {
    const share = roundMoney(shares[index] ?? 0);
    const lineTotal = roundMoney(Math.max(0, line.lineTotal - share));
    return {
      ...line,
      checkDiscountShare: share,
      finalTotal: lineTotal,
      lineProfit: roundMoney(lineTotal - line.lineCost),
    };
  });

  const total = roundMoney(detailedLines.reduce((sum, line) => sum + line.finalTotal, 0));
  const costTotal = roundMoney(detailedLines.reduce((sum, line) => sum + line.lineCost, 0));

  return {
    lines: detailedLines,
    subtotal,
    lineDiscountTotal: roundMoney(subtotal - afterLineDiscounts),
    checkDiscount,
    total,
    costTotal,
    profit: roundMoney(total - costTotal),
  };
}