import assert from 'node:assert/strict';
import {
  PHOTO_CACHE_MS,
  PHOTO_RETRY_WHEN_NULL_MS,
  shouldRefreshCustomerPhoto,
  resolveCustomerPhotoRefresh,
  buildTelegramPhotoUrl,
  buildCustomerPhotoProxyUrl,
  isPublicTelegramUserpicUrl,
  isTelegramBotFileUrl,
  resolvePublicCustomerPhotoUrl,
} from '../utils/customer-photo.js';

const NOW = Date.parse('2026-06-22T12:00:00.000Z');

console.log('=== customer photo: shouldRefreshCustomerPhoto ===');
{
  assert.equal(
    shouldRefreshCustomerPhoto({
      photoUrl: 'https://example.com/a.jpg',
      photoUpdatedAt: '2026-06-22T00:00:00.000Z',
      now: NOW,
    }),
    false,
    'fresh cached photo is not refreshed',
  );

  assert.equal(
    shouldRefreshCustomerPhoto({
      photoUrl: 'https://example.com/a.jpg',
      photoUpdatedAt: '2026-06-20T00:00:00.000Z',
      now: NOW,
    }),
    true,
    'stale cached photo is refreshed after 24h',
  );

  assert.equal(
    shouldRefreshCustomerPhoto({
      photoUrl: null,
      photoUpdatedAt: '2026-06-22T11:30:00.000Z',
      now: NOW,
    }),
    false,
    'null photo retries only after 1h',
  );

  assert.equal(
    shouldRefreshCustomerPhoto({
      photoUrl: null,
      photoUpdatedAt: '2026-06-22T10:00:00.000Z',
      now: NOW,
    }),
    true,
    'null photo retries hourly',
  );
}

console.log('=== customer photo: resolveCustomerPhotoRefresh ===');
{
  const cached = 'https://api.telegram.org/file/botTOKEN/photos/old.jpg';

  assert.deepEqual(
    resolveCustomerPhotoRefresh({
      cachedPhotoUrl: cached,
      chat: { photo: { big_file_id: 'abc' } },
      fileData: { ok: true, result: { file_path: 'photos/new.jpg' } },
      token: 'TOKEN',
    }),
    {
      photoUrl: 'https://api.telegram.org/file/botTOKEN/photos/new.jpg',
      shouldPersist: true,
    },
    'successful getFile updates photo',
  );

  assert.deepEqual(
    resolveCustomerPhotoRefresh({
      cachedPhotoUrl: cached,
      chat: { photo: { big_file_id: 'abc' } },
      fileData: { ok: false },
      token: 'TOKEN',
    }),
    {
      photoUrl: cached,
      shouldPersist: false,
    },
    'failed getFile keeps cached photo',
  );

  assert.deepEqual(
    resolveCustomerPhotoRefresh({
      cachedPhotoUrl: cached,
      chat: { id: 1, first_name: 'K' },
      fileData: null,
      token: 'TOKEN',
    }),
    {
      photoUrl: cached,
      shouldPersist: false,
    },
    'missing chat.photo keeps cached photo',
  );

  assert.deepEqual(
    resolveCustomerPhotoRefresh({
      cachedPhotoUrl: null,
      chat: { id: 1, first_name: 'K' },
      fileData: null,
      token: 'TOKEN',
    }),
    {
      photoUrl: null,
      shouldPersist: true,
    },
    'confirmed no avatar clears empty cache',
  );

  assert.deepEqual(
    resolveCustomerPhotoRefresh({
      cachedPhotoUrl: cached,
      chat: { id: 1, first_name: 'K' },
      fileData: null,
      token: 'TOKEN',
    }),
    {
      photoUrl: cached,
      shouldPersist: false,
    },
    'missing chat.photo keeps existing cache',
  );
}

console.log('=== customer photo: buildTelegramPhotoUrl ===');
assert.equal(
  buildTelegramPhotoUrl('TOKEN', 'photos/file.jpg'),
  'https://api.telegram.org/file/botTOKEN/photos/file.jpg',
);

console.log('=== customer photo: public proxy url ===');
assert.equal(
  buildCustomerPhotoProxyUrl('cust_123'),
  '/api/customer-photo/cust_123',
);
assert.equal(
  resolvePublicCustomerPhotoUrl({
    id: 'cust_123',
    photo_url: 'https://api.telegram.org/file/botTOKEN/photos/file.jpg',
  }),
  null,
  'proxy url is hidden until avatar is cached on disk',
);
assert.equal(
  resolvePublicCustomerPhotoUrl(
    {
      id: 'cust_123',
      photo_url: 'https://api.telegram.org/file/botTOKEN/photos/file.jpg',
    },
    { hasDiskCache: true },
  ),
  '/api/customer-photo/cust_123',
);
assert.equal(
  resolvePublicCustomerPhotoUrl({ id: 'cust_123', photo_url: null }),
  null,
);
assert.equal(
  isPublicTelegramUserpicUrl('https://t.me/i/userpic/320/QuaiLLLL.jpg'),
  true,
  'detects public t.me userpic',
);
assert.equal(
  isTelegramBotFileUrl('https://api.telegram.org/file/botSECRET/photos/file.jpg'),
  true,
  'detects bot file url',
);
assert.equal(
  resolvePublicCustomerPhotoUrl({
    id: 'cust_123',
    photo_url: 'https://t.me/i/userpic/320/QuaiLLLL.jpg',
  }),
  'https://t.me/i/userpic/320/QuaiLLLL.jpg',
  't.me userpic is returned without disk cache',
);
assert.equal(
  JSON.stringify(
    resolvePublicCustomerPhotoUrl({
      id: 'cust_123',
      photo_url: 'https://api.telegram.org/file/botSECRET/photos/file.jpg',
    }),
  ).includes('SECRET'),
  false,
  'public photo url must not expose telegram bot token',
);

console.log(`PHOTO_CACHE_MS=${PHOTO_CACHE_MS}, PHOTO_RETRY_WHEN_NULL_MS=${PHOTO_RETRY_WHEN_NULL_MS}`);
console.log('customer-photo tests passed');