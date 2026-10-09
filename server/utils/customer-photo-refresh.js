import fs from 'node:fs';
import {
  customerAvatarDir,
  getCustomerAvatarDiskPath,
  readCustomerPhotoFromDisk,
} from './customer-photo-disk.js';
import {
  isPublicTelegramUserpicUrl,
  resolveCustomerPhotoRefresh,
  shouldRefreshCustomerPhoto,
} from './customer-photo.js';
import { applyTelegramHttpProxy, hasTelegramHttpProxy } from './telegram-http-proxy.js';

export { readCustomerPhotoFromDisk } from './customer-photo-disk.js';

export async function warmCustomerPhotoFromInitData(customerId, initPhotoUrl, db) {
  if (!customerId || !String(initPhotoUrl || '').trim().startsWith('https://')) {
    return null;
  }

  const photoUrl = String(initPhotoUrl).trim();
  let persistedUrl = null;

  if (isPublicTelegramUserpicUrl(photoUrl) && db) {
    db.prepare(`
      UPDATE customers
      SET photo_url = ?,
          photo_updated_at = DATETIME('now'),
          updated_at = DATETIME('now')
      WHERE id = ?
    `).run(photoUrl, customerId);
    persistedUrl = photoUrl;
  }

  try {
    await cacheCustomerPhotoToDisk(customerId, photoUrl);
  } catch {
    // Disk cache is best-effort; t.me URL in DB still works in the webview.
  }

  return persistedUrl;
}

export async function cacheCustomerPhotoToDisk(customerId, photoUrl) {
  if (!customerId || !photoUrl) {
    return false;
  }

  const payload = await fetchCustomerPhotoBytes(photoUrl);
  if (!payload) {
    return false;
  }

  fs.mkdirSync(customerAvatarDir, { recursive: true });
  fs.writeFileSync(getCustomerAvatarDiskPath(customerId), payload.body);
  return true;
}

export async function refreshCustomerPhotoIfStale(
  customer,
  { token, fetchTelegramChat, db, forceRefresh = false },
) {
  if (!customer?.id) {
    return null;
  }

  let photoUrl = customer.photo_url || null;
  if (
    !customer.telegram_id
    || !token
    || !fetchTelegramChat
    || (
      !forceRefresh
      && !shouldRefreshCustomerPhoto({
        photoUrl,
        photoUpdatedAt: customer.photo_updated_at,
      })
    )
  ) {
    return photoUrl;
  }

  try {
    const chat = await fetchTelegramChat(customer.telegram_id);
    let fileData = null;

    if (chat?.photo?.big_file_id) {
      const fileResp = await fetch(
        `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(chat.photo.big_file_id)}`,
        applyTelegramHttpProxy(),
      );
      fileData = await fileResp.json();
    }

    const refresh = resolveCustomerPhotoRefresh({
      cachedPhotoUrl: photoUrl,
      chat,
      fileData,
      token,
    });
    photoUrl = refresh.photoUrl;

    const refreshedBotUrl = refresh.photoUrl;
    const cachedPublicUrl = db.prepare(
      'SELECT photo_url FROM customers WHERE id = ?',
    ).get(customer.id)?.photo_url || photoUrl;

    if (refresh.shouldPersist && refreshedBotUrl && !isPublicTelegramUserpicUrl(cachedPublicUrl)) {
      db.prepare(`
        UPDATE customers
        SET photo_url = ?,
            photo_updated_at = DATETIME('now'),
            updated_at = DATETIME('now')
        WHERE id = ?
      `).run(refreshedBotUrl, customer.id);
      photoUrl = refreshedBotUrl;
    } else if (isPublicTelegramUserpicUrl(cachedPublicUrl)) {
      photoUrl = cachedPublicUrl;
    } else {
      photoUrl = refreshedBotUrl || photoUrl;
    }

    const diskCacheUrl = refreshedBotUrl || photoUrl;
    if (diskCacheUrl) {
      await cacheCustomerPhotoToDisk(customer.id, diskCacheUrl);
    }
  } catch (error) {
    console.warn('[customer-photo] Failed to refresh Telegram photo:', error.message);
  }

  return photoUrl;
}

export async function fetchCustomerPhotoBytes(photoUrl, { timeoutMs = 8000 } = {}) {
  if (!photoUrl) {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const attempts = hasTelegramHttpProxy()
    ? [
        applyTelegramHttpProxy({ signal: controller.signal }),
        { signal: controller.signal },
      ]
    : [{ signal: controller.signal }];

  try {
    for (const fetchOptions of attempts) {
      try {
        const response = await fetch(photoUrl, fetchOptions);
        if (!response.ok) {
          continue;
        }

        return {
          body: Buffer.from(await response.arrayBuffer()),
          contentType: response.headers.get('content-type') || 'image/jpeg',
        };
      } catch {
        // Try direct fetch when proxy is down or misconfigured.
      }
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}