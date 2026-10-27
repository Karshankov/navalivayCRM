import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allocateCheckDiscount,
  computeCheckTotals,
  hasPosPriceOverride,
  resolvePosPrice,
} from '../utils/pos-pricing.js';

test('товар без публикации продаётся по рознице', () => {
  const result = resolvePosPrice({ retail: 16 });
  assert.equal(result.price, 16);
  assert.equal(result.basePrice, 16);
  assert.equal(result.reason, 'retail');
  assert.equal(result.publication, null);
});

test('пустая публикация не меняет цену — иначе опубликованная линейка без настроек обнуляла бы товар', () => {
  const empty = { fixed_price: null, markup_amount: null, markup_percent: null };
  assert.equal(hasPosPriceOverride(empty), false);
  const result = resolvePosPrice({ retail: 16, groupPublication: empty });
  assert.equal(result.price, 16);
  assert.equal(result.reason, 'retail');
});

test('наценка суммой: HUSKY 16 + 5 = 21', () => {
  const result = resolvePosPrice({ retail: 16, groupPublication: { markup_amount: 5 } });
  assert.equal(result.price, 21);
  assert.equal(result.reason, 'markup');
});

test('наценка процентом: HUSKY 16 + 100% = 32', () => {
  const result = resolvePosPrice({ retail: 16, groupPublication: { markup_percent: 100 } });
  assert.equal(result.price, 32);
});

test('сумма и процент складываются, процент считается от розницы, а не от уже нацененной цены', () => {
  // 16 + 5 + 10% от 16 = 22.6. Если бы процент шёл сверху суммы, вышло бы 23.1.
  const result = resolvePosPrice({
    retail: 16,
    groupPublication: { markup_amount: 5, markup_percent: 10 },
  });
  assert.equal(result.price, 22.6);
});

test('фиксированная цена приоритетнее наценки — «на кассе 35» значит 35', () => {
  const result = resolvePosPrice({
    retail: 16,
    groupPublication: { fixed_price: 35, markup_amount: 5, markup_percent: 10 },
  });
  assert.equal(result.price, 35);
  assert.equal(result.reason, 'fixed');
});

test('наценка линейки перекрывает наценку категории', () => {
  const result = resolvePosPrice({
    retail: 10,
    groupPublication: { markup_amount: 3 },
    categoryPublication: { markup_amount: 100 },
  });
  assert.equal(result.price, 13);
});

test('пустая настройка линейки не отменяет наценку категории', () => {
  const result = resolvePosPrice({
    retail: 10,
    groupPublication: { fixed_price: null, markup_amount: null, markup_percent: null },
    categoryPublication: { markup_amount: 100 },
  });
  assert.equal(result.price, 110);
});

test('процент наценки округляется до копеек, а не тянет хвост', () => {
  // 3.33 + 15% = 3.8295 → 3.83
  const result = resolvePosPrice({ retail: 3.33, groupPublication: { markup_percent: 15 } });
  assert.equal(result.price, 3.83);
});

test('отрицательная или нечисловая розница считается ошибкой данных', () => {
  assert.throws(() => resolvePosPrice({ retail: -1 }), /invalid_retail_price/);
  assert.throws(() => resolvePosPrice({ retail: 'abc' }), /invalid_retail_price/);
});

test('скидка чека раскладывается пропорционально суммам позиций', () => {
  const shares = allocateCheckDiscount([{ amount: 30 }, { amount: 70 }], 10);
  assert.deepEqual(shares, [3, 7]);
});

test('остаток от округления не теряется и не уводит последнюю позицию в минус', () => {
  const shares = allocateCheckDiscount([{ amount: 1 }, { amount: 1 }, { amount: 1 }], 1);
  const sum = shares.reduce((total, share) => total + share, 0);
  assert.equal(sum, 1);
  assert.ok(shares.every((share) => share >= 0 && share <= 1));
});

test('скидка больше суммы позиций ограничивается суммой', () => {
  const shares = allocateCheckDiscount([{ amount: 10 }], 50);
  assert.deepEqual(shares, [10]);
});

test('нулевая или отрицательная скидка не создаёт отрицательных частей', () => {
  assert.deepEqual(allocateCheckDiscount([{ amount: 10 }], 0), [0]);
  assert.deepEqual(allocateCheckDiscount([{ amount: 10 }], -5), [0]);
});

test('итоги чека: две позиции без скидок, прибыль по себестоимости', () => {
  const totals = computeCheckTotals([
    { unitPrice: 35, quantity: 2, costPrice: 16 },
    { unitPrice: 10, quantity: 1, costPrice: 5 },
  ]);
  assert.equal(totals.subtotal, 80);
  assert.equal(totals.checkDiscount, 0);
  assert.equal(totals.total, 80);
  assert.equal(totals.costTotal, 37);
  assert.equal(totals.profit, 43);
  assert.equal(totals.lines[0].lineProfit, 38);
});

test('скидка позиции суммой и скидка чека складываются в правильном порядке', () => {
  const totals = computeCheckTotals(
    [
      { unitPrice: 100, quantity: 1, costPrice: 40 },
      { unitPrice: 50, quantity: 1, costPrice: 20, discountAmount: 10 },
    ],
    { checkDiscountPercent: 10 },
  );
  // Позиция 1: 100. Позиция 2: 50 - 10 = 40. База скидки чека: 140.
  assert.equal(totals.subtotal, 150);
  assert.equal(totals.lineDiscountTotal, 10);
  assert.equal(totals.checkDiscount, 14);
  assert.equal(totals.total, 126);
  assert.equal(totals.costTotal, 60);
  assert.equal(totals.profit, 66);
});

test('скидка на весь чек уменьшает прибыль, а не только выручку', () => {
  const withoutDiscount = computeCheckTotals([{ unitPrice: 100, quantity: 1, costPrice: 40 }]);
  const withDiscount = computeCheckTotals(
    [{ unitPrice: 100, quantity: 1, costPrice: 40 }],
    { checkDiscountAmount: 20 },
  );
  assert.equal(withoutDiscount.profit, 60);
  assert.equal(withDiscount.profit, 40);
});

test('скидка больше чека не даёт отрицательной выручки', () => {
  const totals = computeCheckTotals(
    [{ unitPrice: 30, quantity: 1, costPrice: 10 }],
    { checkDiscountAmount: 100 },
  );
  assert.equal(totals.total, 0);
  assert.equal(totals.profit, -10);
});

test('нулевое количество не ломает подсчёт и не даёт отрицательных позиций', () => {
  const totals = computeCheckTotals([{ unitPrice: 10, quantity: 0, costPrice: 5 }]);
  assert.equal(totals.total, 0);
  assert.equal(totals.costTotal, 0);
  assert.equal(totals.lines.length, 1);
});

test('себестоимость и цена приводятся к копейкам без хвостов', () => {
  const totals = computeCheckTotals([
    { unitPrice: 11.4, quantity: 3, costPrice: 3.333333 },
  ]);
  assert.equal(totals.total, 34.2);
  assert.equal(totals.costTotal, 10);
  assert.equal(totals.profit, 24.2);
});