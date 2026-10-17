/**
 * Пользовательские напоминания (раздел «Напоминания»).
 *
 * Получатели — фиксированная команда (@ppofic, @rk0ff, @QuaiLLLL);
 * Telegram ID разрешается из карточки клиента по юзернейму.
 *
 * Проверяет планировщик (расписание, догон после пропуска,
 * идемпотентность) и ручки управления: создание, валидация, обновление,
 * тоггл, удаление, тест-отправка, журнал.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navalivay-reminders-'));
process.env.DATABASE_FILE = path.join(tempDir, 'test.db');
process.env.BOT_TOKEN = '';

const { db, initDb } = await import('../db.js');
const { issueToken } = await import('../auth.js');
const { remindersRouter } = await import('../routes/reminders.js');
const {
  computeLastDueAt,
  getReminderDueKey,
  enqueueDueCustomReminders,
  _stopCustomReminderSchedulerForTests,
} = await import('../utils/custom-reminder-scheduler.js');

initDb();

const app = express();
app.use(express.json());
app.use(remindersRouter);
const server = await new Promise((resolve) => {
  const instance = app.listen(0, () => resolve(instance));
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const headers = {
  Authorization: `Bearer ${issueToken('test-admin')}`,
  'Content-Type': 'application/json',
};

/** Карточка клиента для юзернейма — источник Telegram ID. */
function addCustomer(username, telegramId) {
  db.prepare(`
    INSERT INTO customers (id, telegram_id, telegram_username, first_name, last_name)
    VALUES (?, ?, ?, ?, ?)
  `).run(`cust_${username}`, telegramId, username, 'Имя', 'Фам');
}

function insertReminder(id, {
  scheduleType = 'interval',
  hour = 15,
  minute = 0,
  intervalDays = null,
  onceDate = null,
  usernames = ['ppofic'],
  enabled = 1,
  createdAt = '2026-01-01 00:00:00',
} = {}) {
  db.prepare(`
    INSERT INTO custom_reminders (
      id, title, message, schedule_type, schedule_hour, schedule_minute,
      interval_days, once_date, recipient_usernames, enabled, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, `Заголовок ${id}`, `Сообщение ${id}`, scheduleType,
    hour, minute, intervalDays, onceDate, JSON.stringify(usernames), enabled, createdAt,
  );
  return db.prepare('SELECT * FROM custom_reminders WHERE id = ?').get(id);
}

function outboxCount() {
  return db.prepare(`
    SELECT COUNT(*) AS count FROM internal_notification_outbox
    WHERE event_type = 'custom.reminder'
  `).get().count;
}

async function api(path, options = {}) {
  const response = await fetch(`${baseUrl}/api/admin/reminders${path}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

try {
  // ===== Планировщик: расписание =====
  console.log('scheduler: интервальное расписание по Минску');
  addCustomer('ppofic', '5000670859');
  addCustomer('rk0ff', '2035055116');
  const daily = insertReminder('rem-daily', { intervalDays: 1, hour: 15, minute: 0 });
  // 15:00 Минск = 12:00 UTC
  assert.equal(
    computeLastDueAt(daily, new Date('2026-01-05T12:00:00Z'))?.toISOString(),
    '2026-01-05T12:00:00.000Z',
  );
  assert.equal(
    computeLastDueAt(daily, new Date('2026-01-05T11:59:59Z'))?.toISOString(),
    '2026-01-04T12:00:00.000Z',
  );

  console.log('scheduler: каждые 3 дня');
  const every3 = insertReminder('rem-3d', { intervalDays: 3, hour: 15, minute: 0 });
  assert.equal(
    computeLastDueAt(every3, new Date('2026-01-05T12:00:00Z'))?.toISOString(),
    '2026-01-04T12:00:00.000Z',
    'шаг 1 от 1 января',
  );
  assert.equal(
    computeLastDueAt(every3, new Date('2026-01-06T12:00:00Z'))?.toISOString(),
    '2026-01-04T12:00:00.000Z',
    'между шагами берём предыдущий',
  );
  assert.equal(
    computeLastDueAt(every3, new Date('2026-01-07T12:00:00Z'))?.toISOString(),
    '2026-01-07T12:00:00.000Z',
    'шаг 2',
  );

  console.log('scheduler: разовое напоминание');
  const once = insertReminder('rem-once', { scheduleType: 'once', onceDate: '2026-02-01', hour: 10, minute: 30 });
  // computeLastDueAt возвращает сам момент отправки; наступил он или нет,
  // решает enqueueDueCustomReminders (сравнение с now).
  assert.equal(
    computeLastDueAt(once, new Date('2026-01-20T10:00:00Z'))?.toISOString(),
    '2026-02-01T07:30:00.000Z',
    'момент отправки: 10:30 Минск = 07:30 UTC',
  );
  assert.equal(
    computeLastDueAt(once, new Date('2026-02-01T08:00:00Z'))?.toISOString(),
    '2026-02-01T07:30:00.000Z',
  );

  console.log('scheduler: догон и идемпотентность');
  const enqueue1 = enqueueDueCustomReminders(db, { now: new Date('2026-01-05T12:00:00Z') });
  assert.ok(enqueue1.enqueued >= 2, `должно быть поставлено минимум 2 (${JSON.stringify(enqueue1)})`);
  const enqueue2 = enqueueDueCustomReminders(db, { now: new Date('2026-01-05T12:01:00Z') });
  assert.equal(enqueue2.enqueued, 0, 'повторный тик не дублирует');
  assert.ok(outboxCount() >= 2);
  assert.equal(
    db.prepare('SELECT last_due_key FROM custom_reminders WHERE id = ?').get('rem-daily').last_due_key,
    getReminderDueKey(daily, new Date('2026-01-05T12:00:00Z')),
    'ключ последней отправки зафиксирован',
  );
  // Telegram ID взят из карточки клиента
  const outboxRow = db.prepare(`
    SELECT recipient_telegram_id FROM internal_notification_outbox
    WHERE unique_key LIKE 'custom-reminder:rem-daily:%'
  `).get();
  assert.equal(outboxRow.recipient_telegram_id, '5000670859', 'ID получателя из карточки клиента');

  console.log('scheduler: несколько получателей — по доставке каждому');
  insertReminder('rem-multi', { intervalDays: 1, hour: 15, minute: 0, usernames: ['ppofic', 'rk0ff'] });
  const multi = enqueueDueCustomReminders(db, { now: new Date('2026-01-05T12:00:00Z') });
  assert.equal(multi.enqueued, 2, `две доставки (${JSON.stringify(multi)})`);
  const multiRows = db.prepare(`
    SELECT recipient_telegram_id FROM internal_notification_outbox
    WHERE unique_key LIKE 'custom-reminder:rem-multi:%'
  `).all();
  assert.deepEqual(
    multiRows.map((row) => row.recipient_telegram_id).sort(),
    ['2035055116', '5000670859'],
    'каждому получателю своя запись',
  );
  const multiRepeat = enqueueDueCustomReminders(db, { now: new Date('2026-01-05T12:01:00Z') });
  assert.equal(multiRepeat.enqueued, 0, 'мульти-доставки не дублируются');

  console.log('scheduler: юзернейм без карточки не отправляется');
  insertReminder('rem-ghost', { intervalDays: 1, hour: 15, minute: 0, usernames: ['ghost_user'] });
  const ghost = enqueueDueCustomReminders(db, { now: new Date('2026-01-05T12:00:00Z') });
  assert.equal(ghost.enqueued, 0, 'нет карточки — нет отправки');

  console.log('scheduler: выключенное не отправляется');
  insertReminder('rem-off', { intervalDays: 1, hour: 15, minute: 0, enabled: 0 });
  const enqueue3 = enqueueDueCustomReminders(db, { now: new Date('2026-01-05T12:00:00Z') });
  assert.ok(enqueue3.enqueued === 0);

  // ===== Ручки =====
  console.log('routes: 401 без авторизации');
  const noAuth = await fetch(`${baseUrl}/api/admin/reminders`);
  assert.equal(noAuth.status, 401);

  console.log('routes: команда получателей — только трое');
  const recipients = await api('/recipients');
  assert.equal(recipients.body.recipients.length, 3);
  const usernames = recipients.body.recipients.map((r) => r.username);
  assert.deepEqual(
    usernames.sort(),
    ['ppofic', 'quaillll', 'rk0ff'].sort(),
  );
  assert.equal(recipients.body.recipients.find((r) => r.username === 'ppofic').telegram_ok, true);
  assert.equal(recipients.body.recipients.find((r) => r.username === 'quaillll').telegram_ok, false);

  console.log('routes: создание интервального');
  const created = await api('', {
    method: 'POST',
    body: {
      title: 'Проверить остатки',
      message: 'Проверить остатки на складе',
      time: '15:00',
      schedule_type: 'interval',
      interval_days: 1,
      recipient_usernames: ['@ppofic'],
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.reminder.schedule_label, 'Каждый день в 15:00');
  assert.equal(created.body.reminder.recipients.length, 1);
  assert.equal(created.body.reminder.recipients[0].username, 'ppofic');
  assert.equal(created.body.reminder.recipients[0].telegram_ok, true);
  assert.ok(created.body.reminder.next_run_at);
  const createdId = created.body.reminder.id;

  console.log('routes: создание разового');
  const onceCreated = await api('', {
    method: 'POST',
    body: {
      title: 'Отчёт',
      message: 'Сделать отчёт',
      time: '10:30',
      schedule_type: 'once',
      once_date: '2027-03-01',
      recipient_usernames: ['ppofic', 'rk0ff'],
    },
  });
  assert.equal(onceCreated.status, 201);
  assert.equal(onceCreated.body.reminder.schedule_label, 'Один раз 2027-03-01 в 10:30');

  console.log('routes: валидация');
  const badTime = await api('', {
    method: 'POST',
    body: { title: 'x', message: 'x', time: '25:00', schedule_type: 'interval', interval_days: 1, recipient_username: 'ppofic' },
  });
  assert.equal(badTime.status, 400);
  assert.equal(badTime.body.error, 'invalid_time');

  const badDays = await api('', {
    method: 'POST',
    body: { title: 'x', message: 'x', time: '15:00', schedule_type: 'interval', interval_days: 0, recipient_username: 'ppofic' },
  });
  assert.equal(badDays.status, 400);

  const badDate = await api('', {
    method: 'POST',
    body: { title: 'x', message: 'x', time: '15:00', schedule_type: 'once', once_date: '2026-02-31', recipient_username: 'ppofic' },
  });
  assert.equal(badDate.status, 400);

  console.log('routes: посторонний юзернейм не принимается');
  const stranger = await api('', {
    method: 'POST',
    body: { title: 'x', message: 'x', time: '15:00', schedule_type: 'interval', interval_days: 1, recipient_usernames: ['someone_else'] },
  });
  assert.equal(stranger.status, 400);
  assert.equal(stranger.body.error, 'recipient_not_in_team');

  console.log('routes: юзернейм без карточки клиента');
  const noCard = await api('', {
    method: 'POST',
    body: { title: 'x', message: 'x', time: '15:00', schedule_type: 'interval', interval_days: 1, recipient_usernames: ['QuaiLLLL'] },
  });
  assert.equal(noCard.status, 400);
  assert.equal(noCard.body.error, 'recipient_not_found');

  console.log('routes: обновление расписания');
  const updated = await api(`/${createdId}`, {
    method: 'PATCH',
    body: {
      title: 'Остатки 2',
      message: 'Проверить остатки и витрину',
      time: '09:15',
      schedule_type: 'interval',
      interval_days: 3,
      recipient_usernames: ['ppofic', 'rk0ff'],
    },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.reminder.schedule_label, 'Каждые 3 дн. в 09:15');
  assert.equal(updated.body.reminder.recipients.length, 2);
  assert.equal(updated.body.reminder.recipients[1].username, 'rk0ff');
  assert.equal(
    db.prepare('SELECT last_due_key FROM custom_reminders WHERE id = ?').get(createdId).last_due_key,
    null,
    'после правки расписания история отправок сброшена',
  );

  console.log('routes: тоггл выключения гасит очередь');
  // Ставим что-то в очередь для созданного напоминания
  enqueueDueCustomReminders(db, { now: new Date('2030-01-01T00:00:00Z') });
  assert.ok(outboxCount() > 0);
  const pendingBefore = db.prepare(`
    SELECT COUNT(*) AS count FROM internal_notification_outbox
    WHERE status IN ('pending', 'retry') AND unique_key LIKE ?
  `).get(`custom-reminder:${createdId}:%`).count;
  const toggled = await api(`/${createdId}`, { method: 'PATCH', body: { enabled: false } });
  assert.equal(toggled.status, 200);
  assert.equal(toggled.body.reminder.enabled, false);
  const pendingAfter = db.prepare(`
    SELECT COUNT(*) AS count FROM internal_notification_outbox
    WHERE status IN ('pending', 'retry') AND unique_key LIKE ?
  `).get(`custom-reminder:${createdId}:%`).count;
  assert.equal(pendingAfter, 0, `незавершённые доставки погашены (было ${pendingBefore})`);

  console.log('routes: тест-отправка');
  const testSend = await api(`/${createdId}/test`, { method: 'POST' });
  assert.equal(testSend.status, 200);
  assert.equal(testSend.body.ok, true);

  console.log('routes: тест-отправка юзернейму без карточки');
  insertReminder('rem-no-card', { intervalDays: 1, hour: 15, minute: 0, usernames: ['quaillll'] });
  const ghostTest = await api('/rem-no-card/test', { method: 'POST' });
  assert.equal(ghostTest.status, 400);
  assert.equal(ghostTest.body.error, 'recipient_not_found');

  console.log('routes: журнал');
  const log = await api('/log?limit=10');
  assert.ok(log.body.log.length >= 1);
  assert.ok(log.body.log[0].message);

  console.log('routes: журнал по конкретному напоминанию');
  const filtered = await api(`/log?reminder_id=${createdId}`);
  assert.ok(filtered.body.log.length >= 1);
  assert.ok(filtered.body.log.every((entry) => entry.reminder_id === createdId));

  console.log('routes: удаление');
  const deleted = await api(`/${onceCreated.body.reminder.id}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  const listAfter = await api('');
  assert.equal(listAfter.body.reminders.filter((r) => r.id === onceCreated.body.reminder.id).length, 0);

  console.log('routes: 404 на несуществующем');
  const notFound = await api('/xxx', { method: 'DELETE' });
  assert.equal(notFound.status, 404);

  console.log('custom-reminders.test.js: ok');
} finally {
  _stopCustomReminderSchedulerForTests();
  server.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
