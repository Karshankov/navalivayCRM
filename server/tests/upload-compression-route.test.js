/**
 * Интеграция автосжатия в POST /api/admin/upload.
 *
 * Загружаем сгенерированный «тяжёлый» jpeg → ответ содержит .webp URL,
 * файл на диске — webp и он меньше оригинала. Использует изолированный
 * target-каталог `test-optimize` в реальном uploads (мултер пишет только
 * туда), каталог удаляется после теста.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Тесты лежат в server/tests, uploads — в app/ (два уровня выше тестов).
const baseUploads = path.resolve(__dirname, '../../uploads');

process.env.DATABASE_FILE = '/tmp/navalivay-upload-route-test.db';
process.env.BOT_TOKEN = '';

const { initDb, db } = await import('../db.js');
const { uploadRouter } = await import('../upload.js');
const { issueToken } = await import('../auth.js');

initDb();

const app = express();
app.use(uploadRouter);

const server = await new Promise((resolve) => {
  const instance = app.listen(0, () => resolve(instance));
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;

const testTarget = 'test-optimize';
const testDir = path.join(baseUploads, testTarget);

async function makeHeavyJpegBuffer() {
  const size = 1800;
  const raw = Buffer.alloc(size * size * 3);
  for (let i = 0; i < raw.length; i += 3) {
    raw[i] = (i * 7 + (i >> 8)) & 0xff;
    raw[i + 1] = (i * 13 + (i >> 4)) & 0xff;
    raw[i + 2] = (i * 29) & 0xff;
  }
  return sharp(raw, { raw: { width: size, height: size, channels: 3 } })
    .jpeg({ quality: 95 })
    .toBuffer();
}

async function main() {
  const token = issueToken('test-admin');
  const heavyBuffer = await makeHeavyJpegBuffer();
  assert.ok(heavyBuffer.length > 150 * 1024, 'тестовый jpeg должен быть большим');

  const form = new FormData();
  form.append('files', new Blob([heavyBuffer], { type: 'image/jpeg' }), 'photo.jpg');

  const response = await fetch(`${baseUrl}/api/admin/upload?target=${testTarget}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  assert.equal(response.status, 200, 'загрузка должна проходить');
  const data = await response.json();
  assert.ok(Array.isArray(data.urls) && data.urls.length === 1, 'один URL в ответе');

  const url = data.urls[0];
  assert.ok(url.startsWith(`/uploads/${testTarget}/`), `URL в тестовом каталоге: ${url}`);
  assert.ok(url.endsWith('.webp'), `автосжатие должно отдавать webp: ${url}`);

  const filePath = path.join(baseUploads, url.slice('/uploads/'.length));
  assert.ok(fs.existsSync(filePath), 'файл должен лежать на диске');

  const stat = fs.statSync(filePath);
  assert.ok(stat.size < heavyBuffer.length / 2, `сжатый файл должен быть меньше: ${stat.size}`);
  assert.ok(stat.size > 0, 'файл не пустой');

  const meta = await sharp(filePath).metadata();
  assert.equal(meta.format, 'webp', 'формат файла — webp');
  assert.ok(Math.max(meta.width, meta.height) <= 1600, 'прочий target: max 1600px');

  console.log('[upload-compression-route.test] OK');
}

try {
  await main();
} finally {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  // Чистим тестовый каталог: файлы создавал только этот тест.
  if (fs.existsSync(testDir)) {
    for (const f of fs.readdirSync(testDir)) {
      fs.unlinkSync(path.join(testDir, f));
    }
    fs.rmdirSync(testDir);
  }
  try { fs.unlinkSync(process.env.DATABASE_FILE); } catch {}
  try { fs.unlinkSync(process.env.DATABASE_FILE + '-wal'); } catch {}
  try { fs.unlinkSync(process.env.DATABASE_FILE + '-shm'); } catch {}
}
