#!/usr/bin/env node
/**
 * Diagnose customer avatar (photo_url) state and optionally probe Telegram Bot API.
 *
 * Usage:
 *   node scripts/diag-customer-photo.mjs rk0ff
 *   node scripts/diag-customer-photo.mjs --telegram-id 2035055116 --live
 */
import { initDb, db } from '../db.js';

const args = process.argv.slice(2);
let username = null;
let telegramId = null;
let live = false;

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--live') {
    live = true;
  } else if (arg === '--telegram-id') {
    telegramId = String(args[i + 1] || '').trim();
    i += 1;
  } else if (!arg.startsWith('--')) {
    username = arg.replace(/^@+/, '');
  }
}

initDb();

const customer = db.prepare(`
  SELECT id, telegram_id, telegram_username, first_name, last_name,
         photo_url, photo_updated_at, updated_at
  FROM customers
  WHERE (? IS NOT NULL AND telegram_id = ?)
     OR (? IS NOT NULL AND LOWER(COALESCE(telegram_username, '')) = LOWER(?))
  LIMIT 1
`).get(
  telegramId,
  telegramId,
  username,
  username,
);

if (!customer) {
  console.log('NO_CUSTOMER');
  process.exit(1);
}

const photoAgeMs = customer.photo_updated_at
  ? Date.now() - new Date(customer.photo_updated_at).getTime()
  : null;

console.log('=== customer photo cache ===');
console.log(JSON.stringify({
  id: customer.id,
  telegram_id: customer.telegram_id,
  telegram_username: customer.telegram_username,
  photo_url: customer.photo_url,
  photo_updated_at: customer.photo_updated_at,
  photo_age_hours: photoAgeMs != null ? Math.round(photoAgeMs / 3600000 * 10) / 10 : null,
  cache_fresh_24h: photoAgeMs != null ? photoAgeMs < 24 * 60 * 60 * 1000 : false,
}, null, 2));

if (!live) {
  console.log('\nTip: pass --live to probe Telegram getChat/getFile (needs TELEGRAM_BOT_TOKEN in env).');
  process.exit(0);
}

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('TELEGRAM_BOT_TOKEN missing');
  process.exit(1);
}

const chatId = customer.telegram_id;
console.log('\n=== live getChat ===');
const chatResp = await fetch(`https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(chatId)}`);
const chatPayload = await chatResp.json();
console.log(JSON.stringify({
  ok: chatPayload?.ok,
  has_photo: Boolean(chatPayload?.result?.photo),
  small_file_id: chatPayload?.result?.photo?.small_file_id || null,
  big_file_id: chatPayload?.result?.photo?.big_file_id || null,
  error: chatPayload?.ok ? null : chatPayload?.description || `HTTP ${chatResp.status}`,
}, null, 2));

const bigFileId = chatPayload?.result?.photo?.big_file_id;
if (!bigFileId) {
  process.exit(0);
}

console.log('\n=== live getFile ===');
const fileResp = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(bigFileId)}`);
const filePayload = await fileResp.json();
const filePath = filePayload?.result?.file_path || null;
const fileUrl = filePath ? `https://api.telegram.org/file/bot${token}/${filePath}` : null;
console.log(JSON.stringify({
  ok: filePayload?.ok,
  file_path: filePath,
  file_url: fileUrl,
  error: filePayload?.ok ? null : filePayload?.description || `HTTP ${fileResp.status}`,
}, null, 2));

if (fileUrl) {
  console.log('\n=== HEAD file url ===');
  try {
    const headResp = await fetch(fileUrl, { method: 'HEAD' });
    console.log(JSON.stringify({
      status: headResp.status,
      content_type: headResp.headers.get('content-type'),
      content_length: headResp.headers.get('content-length'),
    }, null, 2));
  } catch (err) {
    console.log(JSON.stringify({ head_error: err.message }, null, 2));
  }
}