/**
 * Замок раздела «Обзор» на уровне ручек.
 *
 * Юнит-тест dashboard-access.test.js проверяет саму функцию, но не места, где
 * её спрашивают. А данные лежат именно за ними: routes/crm.js
 * (requireDashboardAccess) и две ручки dashboard-access в routes/admin.js.
 * Если там вернуть чистую isDashboardLocked, юнит-тест останется зелёным, а
 * выключатель перестанет работать. Этот тест ловит такой откат.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

// Проверять замок имеет смысл только внутри окна 10:00–16:00, иначе он снят и
// так. Часы машины подвинуть нельзя, поэтому подбираем часовой пояс, в котором
// прямо сейчас полдень. Строка обязана стоять до импорта business-time.js:
// зона читается один раз при загрузке модуля.
const utcHour = new Date().getUTCHours();
let offset = (12 - utcHour + 24) % 24;
if (offset > 14) offset -= 24;
process.env.BUSINESS_TIMEZONE =
  offset === 0 ? 'Etc/GMT' : `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`;

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navalivay-overview-password-'));
process.env.DATABASE_FILE = path.join(tempDir, 'test.db');
process.env.BOT_TOKEN = '';
delete process.env.OVERVIEW_PASSWORD_ENABLED;

const { initDb, db } = await import('../db.js');
const { issueToken } = await import('../auth.js');
const { adminRouter } = await import('../routes/admin.js');
const { crmRouter } = await import('../routes/crm.js');
const { getTimeZoneDateParts } = await import('../utils/business-time.js');
const bcrypt = (await import('bcryptjs')).default;

initDb();

assert.equal(
  getTimeZoneDateParts(new Date()).hour,
  12,
  'подбор часового пояса не сработал — тест ничего бы не проверил',
);

const PROFIT_PASSWORD = 'profit-pass';
db.prepare(`
  INSERT INTO settings (key, value) VALUES ('profit_password_hash', ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`).run(bcrypt.hashSync(PROFIT_PASSWORD, 10));

const app = express();
app.use(express.json());
app.use(adminRouter);
app.use(crmRouter);

const server = await new Promise((resolve) => {
  const instance = app.listen(0, () => resolve(instance));
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const headers = {
  Authorization: `Bearer ${issueToken('test-admin')}`,
  'Content-Type': 'application/json',
};

async function state() {
  const res = await fetch(`${baseUrl}/api/admin/dashboard-access/state`, { headers });
  return res.json();
}

async function dashboardStatus() {
  const res = await fetch(`${baseUrl}/api/admin/crm/dashboard?period=today`, { headers });
  return res.status;
}

async function verifyStatus(password) {
  const res = await fetch(`${baseUrl}/api/admin/dashboard-access/verify`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ password }),
  });
  return res.status;
}

try {
  console.log('ручки: переменной нет — замок работает как раньше');
  delete process.env.OVERVIEW_PASSWORD_ENABLED;
  const closed = await state();
  assert.equal(closed.locked, true, 'внутри окна раздел закрыт');
  assert.equal(closed.profit_required, true, 'пароль спрашиваем');
  assert.equal(await dashboardStatus(), 403, 'сводка без пропуска закрыта');
  assert.equal(await verifyStatus(PROFIT_PASSWORD), 401, 'внутри окна пароля прибыли не хватает');
  assert.equal(await verifyStatus('0002'), 200, 'код владельца пускает');

  console.log('ручки: выключатель снимает оба замка');
  process.env.OVERVIEW_PASSWORD_ENABLED = '0';
  const open = await state();
  assert.equal(open.locked, false, 'замок снят даже внутри окна');
  assert.equal(open.profit_required, false, 'интерфейсу сказано пароль не спрашивать');
  assert.equal(await dashboardStatus(), 200, 'сводка отдаётся без пропуска');
  assert.equal(await verifyStatus(PROFIT_PASSWORD), 200, 'обычного пароля достаточно');

  console.log('ручки: мусор в переменной замок не снимает');
  process.env.OVERVIEW_PASSWORD_ENABLED = 'false';
  assert.equal((await state()).locked, true);
  assert.equal(await dashboardStatus(), 403);

  console.log('overview-password-routes.test.js: ok');
} finally {
  server.close();
  delete process.env.OVERVIEW_PASSWORD_ENABLED;
}
