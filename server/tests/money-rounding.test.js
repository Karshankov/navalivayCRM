import assert from 'node:assert/strict';

import { roundMoney, roundQuantity } from '../utils/money.js';

console.log('деньги: округление до копеек');

// Ровно те значения, которые оседали в базе и утекали на дашборд.
assert.equal(roundMoney(11.399999999999999), 11.4);
assert.equal(roundMoney(1275.5360149761204), 1275.54);
assert.equal(roundMoney(0.1 + 0.2), 0.3);

// Наивный Math.round(value * 100) / 100 здесь даёт 1, потому что 1.005 * 100
// в double это 100.49999999999999. Проверяем, что не наступаем на это.
assert.equal(roundMoney(1.005), 1.01);
assert.equal(roundMoney(2.675), 2.68);

assert.equal(roundMoney(10), 10, 'целое остаётся целым');
assert.equal(roundMoney(-3.456), -3.46, 'отрицательные тоже округляются');

console.log('деньги: мусор не роняет расчёт');
assert.equal(roundMoney(null), 0);
assert.equal(roundMoney(undefined), 0);
assert.equal(roundMoney('не число'), 0);
assert.equal(roundMoney(Number.NaN), 0);
assert.equal(roundMoney(Number.POSITIVE_INFINITY), 0);

console.log('количества: только целые');
assert.equal(roundQuantity(3.4), 3);
assert.equal(roundQuantity('5'), 5);
assert.equal(roundQuantity(null), 0);

console.log('деньги: повторное округление ничего не меняет');
// Себестоимость пересчитывается при каждой приёмке и откате. Если округление
// не идемпотентно, значение «дрожит» после запятой при каждом пересчёте.
for (const value of [11.4, 1275.54, 0.3, 1.01, 2.68]) {
  assert.equal(roundMoney(roundMoney(value)), roundMoney(value));
}

console.log('money-rounding.test.js: ok');
