import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import { migrateInternalNotifications } from '../migrations/add_internal_notifications.js';
import {
  buildInternalNotificationText,
  enqueueInternalNotification,
  enqueueInternalNotificationForGroup,
  listInternalNotificationTemplates,
  resumeUnknownInternalNotification,
  saveInternalNotificationTemplate,
} from '../utils/internal-notifications.js';
import {
  deliverInternalNotification,
  listDueInternalNotifications,
  pauseStaleInternalNotifications,
  processInternalNotifications,
} from '../utils/internal-notification-worker.js';
import {
  enqueueDueSalaryReminders,
  getSalaryReminderPeriod,
  isSalaryReminderDue,
} from '../utils/salary-reminder-scheduler.js';
import { sendViaUserbot } from '../utils/userbot-client.js';

const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
migrateInternalNotifications(db);
migrateInternalNotifications(db);

function row(uniqueKey) {
  return db.prepare(`
    SELECT *
    FROM internal_notification_outbox
    WHERE unique_key = ?
  `).get(uniqueKey);
}

function count(table) {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
}

function addNotification({
  uniqueKey,
  eventType = 'procurement.created',
  telegramId = '123456789',
  username = 'rez0nsky',
  payload = {
    document_number: 854,
    employee_name: 'Павел Сергеевич',
  },
  now = new Date('2026-07-20T07:00:00.000Z'),
} = {}) {
  return enqueueInternalNotification(db, {
    uniqueKey,
    eventType,
    recipientTelegramId: telegramId,
    recipientUsername: username,
    payload,
    now,
  });
}

try {
  console.log('internal notifications: task deadline is shown in Minsk');
  assert.match(
    buildInternalNotificationText('task_created', {
      document_number: 5,
      title: 'Проверить остатки',
      deadline: '2026-07-24T07:00:00.000Z',
    }),
    /Срок: 24\.07\.2026 10:00/,
  );

  console.log('internal notifications: schema and defaults');
  assert.equal(count('internal_notification_settings'), 3);
  assert.equal(
    db.prepare(`
      SELECT enabled
      FROM internal_notification_settings
      WHERE event_group = 'salary'
    `).get().enabled,
    0,
  );

  console.log('internal notifications: enqueue and idempotency');
  const inserted = addNotification({ uniqueKey: 'procurement:854:created' });
  assert.equal(inserted.enqueued, true);
  assert.equal(inserted.notification.status, 'pending');
  assert.match(
    JSON.parse(inserted.notification.payload_json).text,
    /Создан документ закупки #854/,
  );

  const duplicate = addNotification({ uniqueKey: 'procurement:854:created' });
  assert.equal(duplicate.duplicate, true);
  assert.equal(count('internal_notification_outbox'), 1);

  assert.throws(
    () => addNotification({
      uniqueKey: 'procurement:854:created',
      payload: {
        document_number: 999,
        employee_name: 'Другой сотрудник',
      },
    }),
    (error) => error?.code === 'notification_idempotency_conflict',
  );

  assert.throws(
    () => addNotification({
      uniqueKey: 'bad-recipient',
      telegramId: '@rez0nsky',
    }),
    /invalid_recipient_telegram_id/,
  );

  console.log('internal notifications: enqueue follows the outer transaction');
  const rolledBack = db.transaction(() => {
    addNotification({ uniqueKey: 'procurement:rollback:created' });
    throw new Error('business_action_failed');
  });
  assert.throws(() => rolledBack(), /business_action_failed/);
  assert.equal(row('procurement:rollback:created'), undefined);

  console.log('internal notifications: disabled groups do not enqueue');
  const disabledGroup = enqueueInternalNotificationForGroup(db, {
    eventGroup: 'documents',
    uniqueKey: 'procurement:group-disabled',
    eventType: 'procurement.created',
    payload: {
      document_number: 860,
      employee_name: 'Павел',
    },
  });
  assert.equal(disabledGroup.recipients, 0);

  db.prepare(`
    UPDATE internal_notification_settings
    SET enabled = 1
    WHERE event_group = 'documents'
  `).run();
  db.prepare(`
    INSERT INTO internal_notification_recipients (
      event_group, telegram_id, telegram_username, confirmed_at
    )
    VALUES ('documents', '10001', 'manager_one', DATETIME('now')),
           ('documents', '10002', 'manager_two', DATETIME('now'))
  `).run();
  const enabledGroup = enqueueInternalNotificationForGroup(db, {
    eventGroup: 'documents',
    uniqueKey: 'procurement:group-enabled',
    eventType: 'procurement.created',
    payload: {
      document_number: 861,
      employee_name: 'Павел',
    },
  });
  assert.equal(enabledGroup.enqueued, 2);
  assert.equal(
    enabledGroup.notifications.every((item) => (
      item.unique_key.includes(`recipient:${item.recipient_telegram_id}`)
    )),
    true,
  );
  db.prepare(`
    UPDATE internal_notification_outbox
    SET status = 'sent'
    WHERE unique_key LIKE 'procurement:group-enabled:recipient:%'
  `).run();

  console.log('internal notifications: successful delivery by numeric ID');
  let sentPayload = null;
  const sent = await deliverInternalNotification(
    db,
    row('procurement:854:created'),
    {
      sender: async (payload) => {
        sentPayload = payload;
        return { ok: true, telegram_message_id: 77 };
      },
      now: new Date('2026-07-20T07:00:01.000Z'),
    },
  );
  assert.equal(sent.outcome, 'sent');
  assert.deepEqual(
    {
      chatId: sentPayload.chatId,
      username: sentPayload.username,
      verified: sentPayload.verified,
    },
    {
      chatId: '123456789',
      username: 'rez0nsky',
      verified: true,
    },
  );
  assert.match(sentPayload.text, /Павел Сергеевич/);
  assert.equal(row('procurement:854:created').telegram_message_id, '77');
  assert.equal(row('procurement:854:created').attempts, 1);

  const duplicateDelivery = await deliverInternalNotification(
    db,
    inserted.notification,
    {
      sender: async () => {
        throw new Error('must not send twice');
      },
      now: new Date('2026-07-20T07:00:02.000Z'),
    },
  );
  assert.equal(duplicateDelivery.outcome, 'skipped');

  console.log('internal notifications: retry with server delay');
  addNotification({
    uniqueKey: 'transfer:42:created',
    eventType: 'transfer.created',
    payload: {
      document_number: 42,
      from_location: 'Склад',
      to_location: 'Розница',
      employee_name: 'Павел Денисыч',
    },
  });
  const retry = await deliverInternalNotification(db, row('transfer:42:created'), {
    now: new Date('2026-07-20T07:00:00.000Z'),
    rng: () => 0.5,
    sender: async () => ({
      ok: false,
      outcome: 'unreachable',
      error: 'flood_wait',
      retry_after_seconds: 120,
    }),
  });
  assert.equal(retry.outcome, 'retry');
  assert.equal(row('transfer:42:created').next_attempt_at, '2026-07-20 07:02:00');
  assert.equal(
    listDueInternalNotifications(db, {
      now: new Date('2026-07-20T07:01:59.000Z'),
    }).some((item) => item.unique_key === 'transfer:42:created'),
    false,
  );

  let retrySends = 0;
  const retryResult = await processInternalNotifications(db, {
    now: new Date('2026-07-20T07:02:00.000Z'),
    sender: async () => {
      retrySends += 1;
      return { ok: true, telegram_message_id: 78 };
    },
  });
  assert.equal(retryResult.sent, 1);
  assert.equal(retrySends, 1);
  assert.equal(row('transfer:42:created').attempts, 2);

  console.log('internal notifications: rejected is retried with a limit');
  addNotification({ uniqueKey: 'procurement:856:created' });
  const rejected = await deliverInternalNotification(
    db,
    row('procurement:856:created'),
    {
      now: new Date('2026-07-20T07:00:00.000Z'),
      maxAttempts: 1,
      sender: async () => ({
        ok: false,
        outcome: 'rejected',
        error: 'telegram_rejected',
      }),
    },
  );
  assert.equal(rejected.outcome, 'failed');
  assert.equal(row('procurement:856:created').status, 'failed');

  console.log('internal notifications: concurrent claim sends once');
  addNotification({ uniqueKey: 'procurement:855:created' });
  const raceRow = row('procurement:855:created');
  let raceSends = 0;
  const raceSender = async () => {
    raceSends += 1;
    await Promise.resolve();
    return { ok: true, telegram_message_id: 79 };
  };
  const race = await Promise.all([
    deliverInternalNotification(db, raceRow, { sender: raceSender }),
    deliverInternalNotification(db, raceRow, { sender: raceSender }),
  ]);
  assert.equal(raceSends, 1);
  assert.deepEqual(
    race.map((result) => result.outcome).sort(),
    ['sent', 'skipped'],
  );

  console.log('internal notifications: ambiguous result is paused');
  addNotification({ uniqueKey: 'task:5:submitted' });
  const ambiguous = await deliverInternalNotification(
    db,
    row('task:5:submitted'),
    {
      sender: async () => ({
        ok: false,
        outcome: 'ambiguous',
        error: 'response_lost',
      }),
    },
  );
  assert.equal(ambiguous.outcome, 'unknown');
  assert.equal(row('task:5:submitted').status, 'unknown');

  let ambiguousRetrySends = 0;
  await processInternalNotifications(db, {
    now: new Date('2030-01-01T00:00:00.000Z'),
    sender: async () => {
      ambiguousRetrySends += 1;
      return { ok: true };
    },
  });
  assert.equal(ambiguousRetrySends, 0);
  assert.equal(
    resumeUnknownInternalNotification(db, row('task:5:submitted').id),
    true,
  );
  assert.equal(row('task:5:submitted').status, 'retry');

  console.log('internal notifications: a thrown sender is also ambiguous');
  addNotification({ uniqueKey: 'task:6:submitted' });
  const thrown = await deliverInternalNotification(db, row('task:6:submitted'), {
    sender: async () => {
      throw new Error('socket closed after write');
    },
  });
  assert.equal(thrown.outcome, 'unknown');

  console.log('internal notifications: real userbot ECONNRESET is paused without retry');
  {
    const isolatedDb = new Database(':memory:');
    isolatedDb.pragma('foreign_keys = ON');
    migrateInternalNotifications(isolatedDb);
    enqueueInternalNotification(isolatedDb, {
      uniqueKey: 'task:real-userbot:econnreset',
      eventType: 'task.submitted',
      recipientTelegramId: '987654321',
      payload: {
        document_number: 11,
        title: 'Проверить выкладку',
        employee_name: 'Павел',
      },
      now: new Date('2026-07-20T07:00:00.000Z'),
    });
    const originalFetch = globalThis.fetch;
    let sendCalls = 0;
    try {
      globalThis.fetch = async () => {
        sendCalls += 1;
        const error = new Error('fetch failed');
        error.cause = {
          code: 'ECONNRESET',
          message: 'socket closed after request write',
        };
        throw error;
      };
      const notification = isolatedDb.prepare(`
        SELECT * FROM internal_notification_outbox
        WHERE unique_key = 'task:real-userbot:econnreset'
      `).get();
      const first = await deliverInternalNotification(isolatedDb, notification, {
        sender: sendViaUserbot,
        now: new Date('2026-07-20T07:00:01.000Z'),
      });
      assert.equal(first.outcome, 'unknown');
      assert.equal(
        isolatedDb.prepare(`
          SELECT status FROM internal_notification_outbox
          WHERE unique_key = 'task:real-userbot:econnreset'
        `).get().status,
        'unknown',
      );
      const after = await processInternalNotifications(isolatedDb, {
        sender: sendViaUserbot,
        now: new Date('2030-01-01T00:00:00.000Z'),
      });
      assert.equal(after.processed, 0);
      assert.equal(sendCalls, 1);
    } finally {
      globalThis.fetch = originalFetch;
      isolatedDb.close();
    }
  }

  console.log('internal notifications: real userbot broken HTTP 200 is paused without retry');
  {
    const isolatedDb = new Database(':memory:');
    isolatedDb.pragma('foreign_keys = ON');
    migrateInternalNotifications(isolatedDb);
    enqueueInternalNotification(isolatedDb, {
      uniqueKey: 'task:real-userbot:bad-json',
      eventType: 'task.submitted',
      recipientTelegramId: '987654322',
      payload: {
        document_number: 12,
        title: 'Проверить поставку',
        employee_name: 'Константин',
      },
      now: new Date('2026-07-20T07:00:00.000Z'),
    });
    const originalFetch = globalThis.fetch;
    let sendCalls = 0;
    try {
      globalThis.fetch = async () => {
        sendCalls += 1;
        return {
          ok: true,
          status: 200,
          async json() {
            throw new SyntaxError('response body was truncated');
          },
        };
      };
      const notification = isolatedDb.prepare(`
        SELECT * FROM internal_notification_outbox
        WHERE unique_key = 'task:real-userbot:bad-json'
      `).get();
      const first = await deliverInternalNotification(isolatedDb, notification, {
        sender: sendViaUserbot,
        now: new Date('2026-07-20T07:00:01.000Z'),
      });
      assert.equal(first.outcome, 'unknown');
      assert.equal(
        isolatedDb.prepare(`
          SELECT status FROM internal_notification_outbox
          WHERE unique_key = 'task:real-userbot:bad-json'
        `).get().status,
        'unknown',
      );
      const after = await processInternalNotifications(isolatedDb, {
        sender: sendViaUserbot,
        now: new Date('2030-01-01T00:00:00.000Z'),
      });
      assert.equal(after.processed, 0);
      assert.equal(sendCalls, 1);
    } finally {
      globalThis.fetch = originalFetch;
      isolatedDb.close();
    }
  }

  console.log('internal notifications: stale sending is never retried');
  addNotification({ uniqueKey: 'task:7:submitted' });
  db.prepare(`
    UPDATE internal_notification_outbox
    SET status = 'sending', locked_at = '2026-07-20 06:00:00'
    WHERE unique_key = 'task:7:submitted'
  `).run();
  assert.equal(
    pauseStaleInternalNotifications(db, {
      now: new Date('2026-07-20T07:00:00.000Z'),
    }),
    1,
  );
  assert.equal(row('task:7:submitted').status, 'unknown');

  console.log('salary reminders: Minsk boundary and restart idempotency');
  const withoutRecipient = enqueueDueSalaryReminders(db, {
    now: new Date('2026-07-20T07:00:00.000Z'),
  });
  assert.equal(withoutRecipient.reason, 'confirmed_recipient_missing');
  assert.equal(count('salary_reminders'), 0);

  db.prepare(`
    UPDATE internal_notification_settings
    SET enabled = 1
    WHERE event_group = 'salary'
  `).run();
  db.prepare(`
    INSERT INTO internal_notification_recipients (
      event_group, telegram_id, telegram_username, display_name, confirmed_at
    )
    VALUES ('salary', '555000111', 'rez0nsky', 'Константин', DATETIME('now'))
  `).run();

  assert.equal(isSalaryReminderDue(new Date('2026-07-20T06:59:59.000Z')), false);
  assert.equal(isSalaryReminderDue(new Date('2026-07-20T07:00:00.000Z')), true);
  assert.equal(
    getSalaryReminderPeriod(new Date('2026-12-31T22:00:00.000Z')).periodKey,
    '2027-01',
  );

  const firstReminder = enqueueDueSalaryReminders(db, {
    now: new Date('2026-07-20T07:00:00.000Z'),
  });
  assert.deepEqual(
    {
      due: firstReminder.due,
      period: firstReminder.period_key,
      enqueued: firstReminder.enqueued,
    },
    {
      due: true,
      period: '2026-07',
      enqueued: 1,
    },
  );

  // Имитирует новый процесс: модульного флага нет, защита живёт в БД.
  const afterRestart = enqueueDueSalaryReminders(db, {
    now: new Date('2026-07-20T07:01:00.000Z'),
  });
  assert.equal(afterRestart.enqueued, 0);
  assert.equal(afterRestart.duplicates, 1);
  assert.equal(count('salary_reminders'), 1);
  assert.equal(
    db.prepare(`
      SELECT COUNT(*) AS count
      FROM internal_notification_outbox
      WHERE event_type = 'salary.reminder'
    `).get().count,
    1,
  );

  const beforeNextReminder = enqueueDueSalaryReminders(db, {
    now: new Date('2026-08-20T06:59:59.000Z'),
  });
  assert.equal(beforeNextReminder.due, false);
  const nextReminder = enqueueDueSalaryReminders(db, {
    now: new Date('2026-08-20T07:00:00.000Z'),
  });
  assert.equal(nextReminder.enqueued, 1);
  assert.equal(count('salary_reminders'), 2);

  console.log('internal notifications: editable templates');
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'order_contact',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
      updated_at TEXT NOT NULL DEFAULT (DATETIME('now'))
    )
  `);

  // Без правок отдаются заготовки и ничего не помечено как изменённое.
  const defaults = listInternalNotificationTemplates(db);
  assert.equal(defaults.length, 7);
  assert.equal(defaults.every((item) => item.customized === false), true);

  // Оба написания одного события ведут к одному шаблону.
  saveInternalNotificationTemplate(db, 'task_created', 'Задача {номер}: {название}. До {срок}.');
  assert.match(
    buildInternalNotificationText('task.created', {
      document_number: 7,
      title: 'Пересчитать витрину',
      deadline: '2026-07-24T07:00:00.000Z',
    }, 'Задача {номер}: {название}. До {срок}.'),
    /^Задача 7: Пересчитать витрину\. До 24\.07\.2026 10:00\.$/,
  );

  // Правка одного события не трогает остальные.
  const afterEdit = listInternalNotificationTemplates(db);
  assert.equal(afterEdit.filter((item) => item.customized).length, 1);
  assert.equal(
    afterEdit.find((item) => item.event_type === 'task.created').customized,
    true,
  );

  // Правленый текст доезжает до очереди.
  const templated = enqueueInternalNotification(db, {
    uniqueKey: 'task:7:created',
    eventType: 'task_created',
    recipientTelegramId: '77',
    payload: { document_number: 7, title: 'Пересчитать витрину', deadline: '2026-07-24T07:00:00.000Z' },
  });
  assert.match(JSON.parse(templated.notification.payload_json).text, /^Задача 7: Пересчитать витрину/);

  // Пустой текст возвращает заготовку.
  const restored = saveInternalNotificationTemplate(db, 'task.created', '   ');
  assert.equal(restored.customized, false);
  assert.match(restored.text, /^Новая задача #\{номер\}/);
  assert.equal(
    listInternalNotificationTemplates(db).every((item) => item.customized === false),
    true,
  );

  // Опечатка в подстановке остаётся видимой, а не превращается в пустоту.
  assert.match(
    buildInternalNotificationText('task.created', { document_number: 9 }, 'Задача {номерр}'),
    /\{номерр\}/,
  );

  // Неизвестное событие по-прежнему не пропускается молча.
  assert.throws(
    () => buildInternalNotificationText('нет_такого_события', {}),
    /notification_text_required/,
  );

  console.log('internal-notifications.test.js: ok');
} finally {
  db.close();
}
