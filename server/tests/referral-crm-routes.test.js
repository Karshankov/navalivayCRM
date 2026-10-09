import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navalivay-referral-crm-'));
process.env.DATABASE_FILE = path.join(tempDir, 'test.db');
process.env.BOT_TOKEN = '';

const { initDb, db } = await import('../db.js');
const { issueToken } = await import('../auth.js');
const { crmRouter } = await import('../routes/crm.js');
initDb();

const app = express();
app.use(express.json());
app.use(crmRouter);
const server = await new Promise((resolve) => {
  const instance = app.listen(0, () => resolve(instance));
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const token = issueToken('referral-admin');
const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function json(url, options = {}) {
  const response = await fetch(`${baseUrl}${url}`, options);
  return { response, data: await response.json().catch(() => null) };
}

try {
  assert.equal((await json('/api/admin/crm/invite-bans')).response.status, 401);
  db.prepare(`
    INSERT INTO customers (id, telegram_id, telegram_username, first_visit_at, total_orders, total_spent)
    VALUES ('c1', '1', 'invite_user', DATETIME('now'), 0, 0)
  `).run();

  const created = await json('/api/admin/crm/invite-bans', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ customer_id: 'c1', reason: '<script>alert(1)</script>' }),
  });
  assert.equal(created.response.status, 200);
  assert.equal(created.data.ban.reason, '<script>alert(1)</script>');
  assert.equal((await json('/api/admin/crm/invite-bans', {
    method: 'POST', headers: auth, body: JSON.stringify({ customer_id: 'c1' }),
  })).response.status, 409);

  const listed = await json('/api/admin/crm/invite-bans', { headers: auth });
  assert.equal(listed.data.items.length, 1);
  assert.equal(listed.data.items[0].telegram_username, 'invite_user');

  const pendingInvite = await json('/api/admin/crm/invite-bans', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ telegram_username: 'future_inviter', reason: 'заранее' }),
  });
  assert.equal(pendingInvite.data.kind, 'pending');
  assert.equal((await json('/api/admin/crm/invite-bans', { headers: auth })).data.pending.length, 1);
  assert.equal((await json(`/api/admin/crm/invite-bans/pending/${pendingInvite.data.ban.id}`, {
    method: 'DELETE', headers: auth,
  })).response.status, 200);

  const templates = await json('/api/admin/crm/invite-ban-reason-templates', {
    method: 'PUT', headers: auth,
    body: JSON.stringify({ templates: ['Спам', '  ', 'Нарушение'] }),
  });
  assert.deepEqual(templates.data.templates, ['Спам', 'Нарушение']);

  const removed = await json(`/api/admin/crm/invite-bans/${created.data.ban.id}`, {
    method: 'DELETE', headers: auth, body: '{}',
  });
  assert.equal(removed.response.status, 200);
  assert.equal((await json('/api/admin/crm/invite-bans', { headers: auth })).data.items.length, 0);

  const staffAccess = await json('/api/admin/crm/referral-authorization/staff-access', {
    method: 'POST', headers: auth, body: JSON.stringify({ customer_id: 'c1' }),
  });
  assert.equal(staffAccess.data.kind, 'active');
  assert.equal((await json('/api/admin/crm/referral-authorization/staff-access', { headers: auth })).data.active.length, 1);
  assert.equal((await json('/api/admin/crm/referral-authorization/staff-access/c1', {
    method: 'DELETE', headers: auth,
  })).response.status, 200);

  const pendingStaff = await json('/api/admin/crm/referral-authorization/staff-access', {
    method: 'POST', headers: auth, body: JSON.stringify({ telegram_username: 'future_friend' }),
  });
  assert.equal(pendingStaff.data.kind, 'pending');
  assert.equal((await json(`/api/admin/crm/referral-authorization/staff-access/pending/${pendingStaff.data.grant.id}`, {
    method: 'DELETE', headers: auth,
  })).response.status, 200);

  const enabled = await json('/api/admin/crm/referral-authorization/settings', {
    method: 'PUT', headers: auth, body: JSON.stringify({ enabled: true }),
  });
  assert.equal(enabled.data.enabled, true);
  assert.equal((await json('/api/admin/crm/referral-authorization/settings', { headers: auth })).data.enabled, true);

  assert.equal((await json('/api/admin/crm/referral-authorization/disallowed-usernames')).response.status, 401);
  assert.equal((await json('/api/admin/crm/referral-authorization/disallowed-usernames', {
    method: 'POST', headers: auth, body: JSON.stringify({ usernames: ['корень'] }),
  })).response.status, 400);
  const disallowed = await json('/api/admin/crm/referral-authorization/disallowed-usernames', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ usernames: ['@Admin_One', 'admin_one', 'Admin_Two'] }),
  });
  assert.equal(disallowed.response.status, 200);
  assert.deepEqual(disallowed.data.items.map((item) => item.username), ['admin_one', 'admin_two']);
  assert.equal(disallowed.data.items.every((item) => item.added_by === 'referral-admin'), true);
  assert.deepEqual(
    (await json('/api/admin/crm/referral-authorization/disallowed-usernames', { headers: auth }))
      .data.items.map((item) => item.username),
    ['admin_one', 'admin_two'],
  );
  assert.equal((await json('/api/admin/crm/referral-authorization/disallowed-usernames/admin_one', {
    method: 'DELETE', headers: auth,
  })).response.status, 200);
  assert.deepEqual(
    (await json('/api/admin/crm/referral-authorization/disallowed-usernames', { headers: auth }))
      .data.items.map((item) => item.username),
    ['admin_two'],
  );
  await json('/api/admin/crm/referral-authorization/disallowed-usernames', {
    method: 'POST', headers: auth, body: JSON.stringify({ usernames: ['convert_me'] }),
  });
  const converted = await json('/api/admin/crm/referral-authorization/disallowed-usernames/convert_me/convert-to-invite-ban', {
    method: 'POST', headers: auth, body: '{}',
  });
  assert.equal(converted.data.kind, 'pending');
  assert.equal(
    (await json('/api/admin/crm/referral-authorization/disallowed-usernames', { headers: auth }))
      .data.items.some((item) => item.username === 'convert_me'),
    false,
  );
  await json(`/api/admin/crm/invite-bans/pending/${converted.data.ban.id}`, { method: 'DELETE', headers: auth });

  db.prepare(`
    INSERT INTO referral_auth_states (telegram_id, attempts_used, status, last_error_code)
    VALUES ('99', 2, 'pending', 'referral_inviter_not_eligible')
  `).run();
  const states = await json('/api/admin/crm/referral-authorizations', { headers: auth });
  assert.equal(states.data.items.some((item) => item.telegram_id === '99' && item.attempts_used === 2), true);

  db.prepare(`
    INSERT INTO customers (id, telegram_id, telegram_username, first_visit_at, total_orders, total_spent)
    VALUES ('blocked-new', '100', 'blocked_new', DATETIME('now'), 0, 0)
  `).run();
  db.prepare(`
    INSERT INTO customer_blocks (id, customer_id, block_type, reason, active)
    VALUES ('authorization-block', 'blocked-new', 'authorization_failed', 'Авторизация не пройдена', 1)
  `).run();
  db.prepare(`
    INSERT INTO referral_auth_states (telegram_id, customer_id, attempts_used, status)
    VALUES ('100', 'blocked-new', 3, 'blocked')
  `).run();
  const blockedDelete = await json('/api/admin/crm/customers/blocked-new', {
    method: 'DELETE', headers: auth,
  });
  assert.equal(blockedDelete.response.status, 400);
  assert.equal(blockedDelete.data.error, 'must_unblock_first');
  assert.ok(db.prepare("SELECT 1 FROM customers WHERE id = 'blocked-new'").get());

  db.prepare("UPDATE customer_blocks SET active = 0, unblocked_at = DATETIME('now') WHERE id = 'authorization-block'").run();
  db.prepare("UPDATE referral_auth_states SET attempts_used = 0, status = 'pending' WHERE telegram_id = '100'").run();
  assert.equal((await json('/api/admin/crm/customers/blocked-new', {
    method: 'DELETE', headers: auth,
  })).response.status, 200);
  console.log('referral-crm-routes.test.js: ok');
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
