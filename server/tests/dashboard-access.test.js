import assert from 'node:assert/strict';

// Зону выставляем до первого импорта business-time.js: модуль читает
// BUSINESS_TIMEZONE один раз при загрузке. Поэтому импорт динамический —
// статический ESM поднял бы его выше этой строки, и тест зависел бы от
// зоны машины (с BUSINESS_TIMEZONE=UTC он падал).
process.env.BUSINESS_TIMEZONE = 'Europe/Minsk';

const { getTimeZoneDateParts } = await import('../utils/business-time.js');

/**
 * Окно проверок: 10:00–16:00 по Минску. Логику часа проверяем без базы, чтобы
 * тест не зависел от текущего времени запуска.
 */
const FROM = 10;
const TO = 16;
const lockedAt = (hour) => hour >= FROM && hour < TO;

console.log('обзор: границы окна по Минску');
assert.equal(lockedAt(9), false, 'в 9:00 раздел открыт');
assert.equal(lockedAt(10), true, 'ровно в 10:00 замок включается');
assert.equal(lockedAt(13), true, 'днём закрыт');
assert.equal(lockedAt(15), true, 'в 15:00 ещё закрыт');
assert.equal(lockedAt(16), false, 'ровно в 16:00 замок снимается');
assert.equal(lockedAt(23), false, 'ночью открыт');
assert.equal(lockedAt(3), false, 'под утро открыт');

console.log('обзор: час берётся по Минску, а не по машине');
// 2026-07-30 08:30 UTC это 11:30 в Минске, то есть внутри окна.
const inside = getTimeZoneDateParts(new Date('2026-07-30T08:30:00.000Z'));
assert.equal(inside.hour, 11);
assert.equal(lockedAt(inside.hour), true);

// 2026-07-30 06:30 UTC это 9:30 в Минске, окно ещё не началось.
const before = getTimeZoneDateParts(new Date('2026-07-30T06:30:00.000Z'));
assert.equal(before.hour, 9);
assert.equal(lockedAt(before.hour), false);

// 2026-07-30 13:30 UTC это 16:30 в Минске, окно уже закончилось.
const after = getTimeZoneDateParts(new Date('2026-07-30T13:30:00.000Z'));
assert.equal(after.hour, 16);
assert.equal(lockedAt(after.hour), false);

const {
  issueDashboardToken,
  isDashboardTokenValid,
  isDashboardLockActive,
  isOverviewPasswordEnabled,
  revokeAllDashboardTokens,
  verifyDashboardOwnerPassword,
} = await import('../utils/dashboard-access.js');

console.log('обзор: выключатель паролей');
// 2026-07-30 08:30 UTC = 11:30 в Минске, то есть середина окна проверок.
const middleOfWindow = new Date('2026-07-30T08:30:00.000Z');

delete process.env.OVERVIEW_PASSWORD_ENABLED;
assert.equal(
  isOverviewPasswordEnabled(),
  true,
  'переменной нет — пароль спрашиваем, иначе обновление открыло бы выручку всем',
);
assert.equal(isDashboardLockActive(middleOfWindow), true, 'по умолчанию замок работает как раньше');

process.env.OVERVIEW_PASSWORD_ENABLED = '0';
assert.equal(isOverviewPasswordEnabled(), false);
assert.equal(
  isDashboardLockActive(middleOfWindow),
  false,
  'выключенные пароли снимают замок и в середине окна проверок',
);

// Выключает только точное '0'. Опечатка в конфиге обязана закрывать выручку,
// а не открывать её.
for (const bad of ['', ' ', ' 0', '0 ', '00', 'false', 'off', 'no', 'нет', '1', 'true']) {
  process.env.OVERVIEW_PASSWORD_ENABLED = bad;
  assert.equal(
    isOverviewPasswordEnabled(),
    true,
    `значение ${JSON.stringify(bad)} не должно снимать замок`,
  );
  assert.equal(isDashboardLockActive(middleOfWindow), true);
}

delete process.env.OVERVIEW_PASSWORD_ENABLED;

console.log('обзор: пароль владельца');
assert.equal(verifyDashboardOwnerPassword('0002'), true);
assert.equal(verifyDashboardOwnerPassword('0003'), false);
assert.equal(verifyDashboardOwnerPassword('00021'), false, 'лишний символ не проходит');
assert.equal(verifyDashboardOwnerPassword(''), false);
assert.equal(verifyDashboardOwnerPassword(null), false);
assert.equal(verifyDashboardOwnerPassword(undefined), false);

console.log('обзор: пропуск и его срок');

revokeAllDashboardTokens();
const { token } = issueDashboardToken(new Date('2026-07-30T08:30:00.000Z'));
assert.ok(token && token.length > 20, 'пропуск выдан и не угадывается');

// Свой пропуск действует внутри окна.
assert.equal(
  isDashboardTokenValid(token, new Date('2026-07-30T08:40:00.000Z')),
  true,
);

// Через полчаса истекает.
assert.equal(
  isDashboardTokenValid(token, new Date('2026-07-30T09:10:00.000Z')),
  false,
  'пропуск живёт ограниченное время',
);

// Пропуск, выданный до окна, внутри окна не работает: иначе забытая с утра
// вкладка так и осталась бы открытой в проверку.
revokeAllDashboardTokens();
const early = issueDashboardToken(new Date('2026-07-30T06:30:00.000Z')).token;
assert.equal(
  isDashboardTokenValid(early, new Date('2026-07-30T06:40:00.000Z')),
  true,
  'до окна пропуск действует',
);
assert.equal(
  isDashboardTokenValid(early, new Date('2026-07-30T08:00:00.000Z')),
  false,
  'с началом окна прежний пропуск перестаёт действовать',
);

console.log('обзор: чужой пропуск не подходит');
assert.equal(isDashboardTokenValid('подобранный', new Date()), false);
assert.equal(isDashboardTokenValid('', new Date()), false);
assert.equal(isDashboardTokenValid(null, new Date()), false);

console.log('dashboard-access.test.js: ok');
