import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { findCrmInviter } from '../utils/crm-inviter-lookup.js';

function fixture() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE customers (id TEXT PRIMARY KEY, telegram_username TEXT, first_name TEXT, last_name TEXT, deleted_at TEXT);
    CREATE TABLE customer_referrals (invitee_customer_id TEXT PRIMARY KEY, inviter_customer_id TEXT, inviter_username_snapshot TEXT);
    CREATE TABLE customer_invite_bans (id TEXT PRIMARY KEY, customer_id TEXT, active INTEGER, banned_at TEXT);
    INSERT INTO customers VALUES ('client','client_test','Клиент',NULL,NULL), ('inviter','new_inviter','Анна','Иванова',NULL), ('partial','client_test_extra',NULL,NULL,NULL);
    INSERT INTO customer_referrals VALUES ('client','inviter','old_inviter');
  `);
  return db;
}
function check(name, run) { test(name, () => { const db = fixture(); try { run(db); } finally { db.close(); } }); }
check('normalizes @, whitespace and case and returns the current inviter username', db => {
  const data = findCrmInviter(db, '  @@CLIENT_TEST  ');
  assert.equal(data.customer.id, 'client');
  assert.equal(data.referral.inviter_customer_id, 'inviter');
  assert.equal(data.referral.inviter_username, 'new_inviter');
  assert.equal(data.referral.inviter_first_name, 'Анна');
  assert.equal(data.referral.inviter_is_invite_banned, 0);
});
check('does not match a partial username', db => { assert.deepEqual(findCrmInviter(db, 'client_t'), { customer: null, referral: null }); });
check('returns an empty referral for a known customer without a relationship', db => { assert.equal(findCrmInviter(db, 'client_test_extra').referral, null); });
check('returns the active ban, not an inactive historical ban', db => {
  db.exec("INSERT INTO customer_invite_bans VALUES ('inactive','inviter',0,'2026-10-12'),('active','inviter',1,'2026-10-11')");
  assert.equal(findCrmInviter(db, 'client_test').referral.inviter_invite_ban_id, 'active');
  assert.equal(findCrmInviter(db, 'client_test').referral.inviter_is_invite_banned, 1);
});
check('retains the historical snapshot when the inviter was removed', db => {
  db.exec("DELETE FROM customers WHERE id='inviter'");
  const referral = findCrmInviter(db, 'client_test').referral;
  assert.equal(referral.inviter_customer_id, null);
  assert.equal(referral.inviter_username, 'old_inviter');
});
check('uses the snapshot when the inviter has no current username', db => {
  db.exec("UPDATE customers SET telegram_username='' WHERE id='inviter'");
  assert.equal(findCrmInviter(db, 'client_test').referral.inviter_username, 'old_inviter');
});
check('excludes soft-deleted searched customers', db => {
  db.exec("UPDATE customers SET deleted_at='2026-10-11' WHERE id='client'");
  assert.deepEqual(findCrmInviter(db, 'client_test'), { customer: null, referral: null });
});
check('rejects ambiguous exact matches rather than choosing a person', db => {
  db.exec("INSERT INTO customers VALUES ('duplicate','CLIENT_TEST',NULL,NULL,NULL)");
  assert.throws(() => findCrmInviter(db, 'client_test'), error => error.status === 409 && error.code === 'ambiguous_username');
});
check('rejects invalid, missing, overly long and injection inputs', db => {
  for (const input of ['', null, ['client_test'], 'x'.repeat(33), "x' OR 1=1 --", 'https://t.me/client_test', '%', 'client test']) {
    assert.throws(() => findCrmInviter(db, input), error => error.status === 400);
  }
});
check('is read-only and works without any orders', db => {
  const before = db.totalChanges;
  const changes = db.prepare('SELECT total_changes() AS changes').get().changes;
  findCrmInviter(db, 'client_test');
  assert.equal(db.prepare('SELECT total_changes() AS changes').get().changes, changes);
  assert.equal(db.totalChanges, before);
});
