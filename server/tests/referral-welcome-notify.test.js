import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDb = path.resolve(__dirname, `.tmp-referral-welcome-${Date.now()}.db`);
process.env.DATABASE_FILE = tmpDb;
process.env.BOT_TOKEN = '';

const { db, initDb } = await import('../db.js');
initDb();
const notify = await import('../utils/referral-welcome-notify.js');
const blocks = await import('../utils/customer-blocks.js');

function addCustomer(id, telegramId, source = 'referral') {
  db.prepare(`
    INSERT INTO customers (
      id, telegram_id, telegram_username, first_visit_at, total_orders, total_spent,
      access_authorized_at, access_authorization_source
    ) VALUES (?, ?, ?, DATETIME('now'), 0, 0, DATETIME('now'), ?)
  `).run(id, telegramId, `user_${id}`, source);
  db.prepare(`
    INSERT INTO referral_welcome_notifications (customer_id, telegram_id)
    VALUES (?, ?)
  `).run(id, telegramId);
}

try {
  addCustomer('success', '1001');
  let sends = 0;
  const sender = async (payload) => {
    sends += 1;
    assert.equal(payload.chatId, '1001');
    assert.equal(payload.shortcut, 'Прайс');
    assert.equal(payload.idempotencyKey, 'referral-welcome:success');
    return { ok: true, telegram_message_ids: [10, 11] };
  };
  const due = notify.listDueReferralWelcomeNotifications()[0];
  const success = await notify.deliverReferralWelcomeNotification(due, { sender });
  assert.equal(success.sent, true);
  assert.equal(sends, 1);
  assert.equal(
    db.prepare(`SELECT status FROM referral_welcome_notifications WHERE customer_id='success'`).get().status,
    'sent',
  );
  const duplicate = await notify.deliverReferralWelcomeNotification(due, { sender });
  assert.equal(duplicate.reason, 'not_claimed');
  assert.equal(sends, 1);

  addCustomer('race', '1002');
  const raceRow = db.prepare(`SELECT * FROM referral_welcome_notifications WHERE customer_id='race'`).get();
  let raceSends = 0;
  await Promise.all([
    notify.deliverReferralWelcomeNotification(raceRow, { sender: async () => { raceSends += 1; return { ok: true }; } }),
    notify.deliverReferralWelcomeNotification(raceRow, { sender: async () => { raceSends += 1; return { ok: true }; } }),
  ]);
  assert.equal(raceSends, 1);

  addCustomer('retry', '1003');
  const retryRow = db.prepare(`SELECT * FROM referral_welcome_notifications WHERE customer_id='retry'`).get();
  const failed = await notify.deliverReferralWelcomeNotification(retryRow, {
    now: new Date('2030-07-22T00:00:00Z'),
    sender: async () => ({
      ok: false,
      outcome: 'unreachable',
      error: 'flood_wait',
      retry_after_seconds: 120,
    }),
  });
  assert.equal(failed.pending, true);
  const retryState = db.prepare(`SELECT * FROM referral_welcome_notifications WHERE customer_id='retry'`).get();
  assert.equal(retryState.status, 'retry');
  assert.equal(retryState.attempts, 1);
  assert.equal(retryState.last_error, 'flood_wait');
  assert.equal(retryState.next_attempt_at, '2030-07-22 00:02:00');

  addCustomer('stale', '1006');
  db.prepare(`
    UPDATE referral_welcome_notifications
    SET status = 'sending', attempts = 999, updated_at = '2020-01-01 00:00:00'
    WHERE customer_id = 'stale'
  `).run();
  const staleRow = db.prepare(`SELECT * FROM referral_welcome_notifications WHERE customer_id='stale'`).get();
  const stale = await notify.deliverReferralWelcomeNotification(staleRow, {
    now: new Date('2030-07-22T00:00:00Z'),
    sender: async () => ({ ok: true, telegram_message_ids: [99] }),
  });
  assert.equal(stale.sent, true);

  addCustomer('throwing', '1007');
  const throwingRow = db.prepare(`SELECT * FROM referral_welcome_notifications WHERE customer_id='throwing'`).get();
  const throwing = await notify.deliverReferralWelcomeNotification(throwingRow, {
    now: new Date('2030-07-22T00:00:00Z'),
    sender: async () => { throw new Error('socket lost'); },
  });
  assert.equal(throwing.pending, true);
  assert.equal(
    db.prepare(`SELECT status FROM referral_welcome_notifications WHERE customer_id='throwing'`).get().status,
    'retry',
  );

  addCustomer('blocked', '1004');
  blocks.createBlock({ customer_id: 'blocked', reason: 'test', blocked_by: 'test' });
  const blockedRow = db.prepare(`SELECT * FROM referral_welcome_notifications WHERE customer_id='blocked'`).get();
  const blocked = await notify.deliverReferralWelcomeNotification(blockedRow, {
    sender: async () => { throw new Error('must not send'); },
  });
  assert.equal(blocked.reason, 'customer_blocked');
  assert.equal(db.prepare(`SELECT status FROM referral_welcome_notifications WHERE customer_id='blocked'`).get().status, 'skipped');

  addCustomer('legacy', '1005', 'legacy');
  const legacyRow = db.prepare(`SELECT * FROM referral_welcome_notifications WHERE customer_id='legacy'`).get();
  const legacy = await notify.deliverReferralWelcomeNotification(legacyRow, {
    sender: async () => { throw new Error('must not send'); },
  });
  assert.equal(legacy.reason, 'customer_not_eligible');

  assert.equal(notify.computeReferralWelcomeRetryMs(-1), 15_000);
  assert.equal(notify.computeReferralWelcomeRetryMs(100), 30 * 60_000);
  console.log('referral-welcome-notify.test.js: ok');
} finally {
  notify._stopReferralWelcomeNotificationWorkerForTests();
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(`${tmpDb}${suffix}`); } catch {}
  }
}
