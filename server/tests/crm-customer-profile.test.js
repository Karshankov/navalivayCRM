import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { refreshCrmCustomerProfile, crmOrderItemImageSources } from '../utils/crm-customer-profile.js';

function fixture(t, values = {}) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE customers (id TEXT PRIMARY KEY, telegram_id TEXT, telegram_username TEXT,
    first_name TEXT, last_name TEXT, updated_at TEXT);`);
  const customer = { id: 'c1', telegram_id: '12345', telegram_username: 'old_user', first_name: 'Старое', last_name: 'Имя', ...values };
  db.prepare('INSERT INTO customers (id, telegram_id, telegram_username, first_name, last_name) VALUES (?, ?, ?, ?, ?)')
    .run(customer.id, customer.telegram_id, customer.telegram_username, customer.first_name, customer.last_name);
  t.after(() => db.close());
  return db;
}
const chat = { id: 12345, type: 'private', first_name: 'Новое', last_name: 'Имя', username: 'new_user' };
const response = (result = chat) => ({ ok: true, json: async () => ({ ok: true, result }) });

test('refresh persists verified Telegram names, exposes only local avatar URL and caches reads', async (t) => {
  const db = fixture(t);
  let calls = 0;
  const options = { token: 'private-test-token', fetchImpl: async (url) => {
    calls++;
    assert.match(url, /getChat\?chat_id=12345$/);
    return response();
  } };
  const profile = await refreshCrmCustomerProfile(db, 'c1', options);
  assert.equal(profile.customer_name, 'Новое Имя');
  assert.equal(profile.telegram_username, 'new_user');
  assert.equal(profile.customer_telegram_id, '12345');
  assert.equal(profile.customer_photo_url, '/api/customer-photo/c1');
  assert.ok(!JSON.stringify(profile).includes('private-test-token'));
  assert.equal(db.prepare('SELECT first_name FROM customers').get().first_name, 'Новое');
  await refreshCrmCustomerProfile(db, 'c1', options);
  assert.equal(calls, 1);
});

test('simultaneous reads share one Telegram request', async (t) => {
  const db = fixture(t);
  let calls = 0;
  const options = { token: 'test', fetchImpl: async () => { calls++; return response(); } };
  const profiles = await Promise.all(Array.from({ length: 5 }, () => refreshCrmCustomerProfile(db, 'c1', options)));
  assert.equal(calls, 1);
  assert.ok(profiles.every((profile) => profile.customer_name === 'Новое Имя'));
});

test('Telegram failure keeps stored names and applies retry backoff', async (t) => {
  const db = fixture(t);
  let time = 0;
  let calls = 0;
  const options = { token: 'test', now: () => time, fetchImpl: async () => { calls++; throw new Error('Telegram unavailable'); } };
  assert.equal((await refreshCrmCustomerProfile(db, 'c1', options)).customer_name, 'Старое Имя');
  time = 59000;
  await refreshCrmCustomerProfile(db, 'c1', options);
  assert.equal(calls, 1);
  time = 61000;
  await refreshCrmCustomerProfile(db, 'c1', options);
  assert.equal(calls, 2);
});

test('wrong chat identity or non-private chat cannot overwrite the customer', async (t) => {
  for (const result of [{ ...chat, id: 987 }, { ...chat, type: 'group' }]) {
    const db = fixture(t);
    const profile = await refreshCrmCustomerProfile(db, 'c1', { token: 'test', fetchImpl: async () => response(result) });
    assert.equal(profile.customer_name, 'Старое Имя');
    assert.equal(db.prepare('SELECT telegram_username FROM customers').get().telegram_username, 'old_user');
  }
});

test('removed Telegram username and surname are cleared after a successful response', async (t) => {
  const db = fixture(t);
  const profile = await refreshCrmCustomerProfile(db, 'c1', {
    token: 'test', fetchImpl: async () => response({ id: 12345, type: 'private', first_name: 'Анна' }),
  });
  assert.equal(profile.customer_name, 'Анна');
  assert.equal(profile.last_name, null);
  assert.equal(profile.telegram_username, null);
});

test('missing bot token performs no network request and Telegram customer is not a guest', async (t) => {
  const db = fixture(t, { first_name: null, last_name: null, telegram_username: null });
  const profile = await refreshCrmCustomerProfile(db, 'c1', { token: '', fetchImpl: async () => { throw new Error('Unexpected network call'); } });
  assert.equal(profile.customer_name, 'Пользователь Telegram');
  assert.equal(profile.customer_photo_url, '/api/customer-photo/c1');
});

test('manual order without Telegram retains guest fallback and no avatar request', async (t) => {
  const db = fixture(t, { telegram_id: null, telegram_username: null, first_name: null, last_name: null });
  const profile = await refreshCrmCustomerProfile(db, 'c1', { token: 'test', fetchImpl: async () => { throw new Error('Unexpected network call'); } });
  assert.equal(profile.customer_name, 'Гость');
  assert.equal(profile.customer_photo_url, null);
  assert.equal(await refreshCrmCustomerProfile(db, 'missing', { token: 'test' }), null);
});

test('request timeout aborts fetch and preserves stored identity', async (t) => {
  const db = fixture(t);
  let aborted = false;
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const profile = await refreshCrmCustomerProfile(db, 'c1', {
      token: 'test', timeoutMs: 5,
      fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => { aborted = true; reject(new Error('Aborted')); }, { once: true });
      }),
    });
    assert.equal(aborted, true);
    assert.equal(profile.customer_name, 'Старое Имя');
  } finally { clearTimeout(keepAlive); }
});

test('image candidates retain own image priority and use enabled group/category fallback', () => {
  const covers = { product_use_category_image: 1, group_image: '/group.webp', category_image: '/category.webp' };
  assert.deepEqual(crmOrderItemImageSources({ ...covers, product_image_url: '/variant.webp' }), ['/variant.webp', '/group.webp', '/category.webp']);
  assert.deepEqual(crmOrderItemImageSources(covers), ['/group.webp', '/category.webp']);
  assert.deepEqual(crmOrderItemImageSources({ ...covers, group_image: null }), ['/category.webp']);
  assert.deepEqual(crmOrderItemImageSources({ ...covers, product_use_category_image: 0 }), []);
  assert.deepEqual(crmOrderItemImageSources({ ...covers, product_image_url: ' /group.webp ' }), ['/group.webp', '/category.webp']);
});
