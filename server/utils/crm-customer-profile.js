import { applyTelegramHttpProxy } from './telegram-http-proxy.js';

const profileCache = new WeakMap();
const SUCCESS_TTL_MS = 5 * 60 * 1000;
const FAILURE_TTL_MS = 60 * 1000;
const MAX_CACHE_ENTRIES = 256;

function readCustomer(db, customerId) {
  return db.prepare('SELECT id, telegram_id, telegram_username, first_name, last_name FROM customers WHERE id = ?').get(customerId);
}

function toProfile(customer) {
  if (!customer) return null;
  const name = [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim();
  const username = String(customer.telegram_username || '').trim().replace(/^@+/, '');
  return {
    first_name: customer.first_name || null,
    last_name: customer.last_name || null,
    customer_telegram_id: customer.telegram_id || null,
    telegram_username: username || null,
    customer_name: name || username || (customer.telegram_id ? 'Пользователь Telegram' : 'Гость'),
    customer_photo_url: customer.telegram_id ? `/api/customer-photo/${encodeURIComponent(customer.id)}` : null,
  };
}

/** Only read the known customer's chat. Never resolve usernames or send messages. */
export async function refreshCrmCustomerProfile(db, customerId, {
  token = process.env.BOT_TOKEN || '',
  fetchImpl = globalThis.fetch,
  now = Date.now,
  timeoutMs = 5000,
} = {}) {
  if (!customerId) return null;
  const customer = readCustomer(db, customerId);
  if (!customer || !token || !/^\d+$/.test(String(customer.telegram_id || ''))) return toProfile(customer);

  let cache = profileCache.get(db);
  if (!cache) { cache = new Map(); profileCache.set(db, cache); }
  const key = `${customer.id}:${customer.telegram_id}`;
  const cached = cache.get(key);
  if (cached?.pending) {
    await cached.pending;
    return toProfile(readCustomer(db, customerId));
  }
  if (cached && cached.expiresAt > now()) return toProfile(customer);
  if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
  const entry = { expiresAt: 0, pending: null };
  cache.set(key, entry);
  entry.pending = Promise.resolve().then(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    let success = false;
    try {
      const response = await fetchImpl(
        `https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(customer.telegram_id)}`,
        { ...applyTelegramHttpProxy(), signal: controller.signal },
      );
      const payload = await response.json();
      const chat = payload?.result;
      if (!response.ok || !payload?.ok || !chat || chat.type !== 'private'
        || String(chat.id) !== String(customer.telegram_id)
        || typeof chat.first_name !== 'string' || !chat.first_name.trim()) return;
      const firstName = chat.first_name.trim();
      const lastName = typeof chat.last_name === 'string' ? chat.last_name.trim() : null;
      const username = typeof chat.username === 'string' ? chat.username.trim().replace(/^@+/, '') : null;
      db.prepare(`UPDATE customers SET first_name = ?, last_name = ?, telegram_username = ?,
        updated_at = DATETIME('now') WHERE id = ? AND telegram_id = ?`).run(
        firstName, lastName || null, username || null, customer.id, customer.telegram_id,
      );
      success = true;
    } catch {
      // Keep stored identity on timeout, blocked bot or Telegram failure. Never log token URLs.
    } finally {
      clearTimeout(timer);
      entry.expiresAt = now() + (success ? SUCCESS_TTL_MS : FAILURE_TTL_MS);
      entry.pending = null;
    }
  });
  await entry.pending;
  return toProfile(readCustomer(db, customerId));
}

/** Same priority as the mini-app cart: variant, product, then enabled group/category cover. */
export function crmOrderItemImageSources(item) {
  const sources = [item.product_image_url];
  if (Number(item.product_use_category_image) === 1) sources.push(item.group_image, item.category_image);
  return [...new Set(sources.filter((source) => typeof source === 'string' && source.trim()).map((source) => source.trim()))];
}
