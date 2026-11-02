/**
 * Пакетное сжатие uploads (scripts/compress-uploads.js) на fixture-данных.
 *
 * Полная изоляция: собственный UPLOADS_DIR в песочнице + собственная БД.
 * Реальные uploads/ и БД репозитория не затрагиваются вовсе.
 *
 * Проверяем: dry-run ничего не меняет; --apply сжимает и обновляет ссылки
 * во всех таблицах; URL в двух таблицах обновляется одной операцией;
 * temp-ссылка переносится в products/; битые ссылки только в отчёте;
 * --cleanup карантинит сирот, а не удаляет; --limit режет выборку.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);

const testsDir = path.dirname(new URL(import.meta.url).pathname);
const scriptPath = path.resolve(testsDir, '../scripts/compress-uploads.js');

// ===== Песочница: uploads + БД + бэкап =====
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-uploads-test-'));
const uploadsRoot = fs.mkdirSync(path.join(sandbox, 'uploads'), { recursive: true });
const testDbPath = path.join(sandbox, 'test.db');
const backupDir = path.join(sandbox, 'backup');

process.env.DATABASE_FILE = testDbPath;
process.env.UPLOADS_DIR = uploadsRoot;
process.env.BOT_TOKEN = '';

// initDb в этом процессе создаёт таблицы в песочнице.
const { initDb, db } = await import('../db.js');
initDb();

async function runScript(args) {
  const env = {
    ...process.env,
    DATABASE_FILE: testDbPath,
    UPLOADS_DIR: uploadsRoot,
    BOT_TOKEN: '',
  };
  try {
    const { stdout, stderr } = await execFileAsync('node', [scriptPath, ...args], {
      env,
      cwd: path.dirname(scriptPath),
    });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    return { stdout: error.stdout || '', stderr: error.stderr || '', code: error.code || 1 };
  }
}

async function makeHeavyJpeg(dir) {
  fs.mkdirSync(path.join(uploadsRoot, dir), { recursive: true });
  const size = 1400;
  const raw = Buffer.alloc(size * size * 3);
  for (let i = 0; i < raw.length; i += 3) {
    raw[i] = (i * 7 + (i >> 8)) & 0xff;
    raw[i + 1] = (i * 13 + (i >> 4)) & 0xff;
    raw[i + 2] = (i * 29) & 0xff;
  }
  const name = `photo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`;
  const filePath = path.join(uploadsRoot, dir, name);
  await sharp(raw, { raw: { width: size, height: size, channels: 3 } })
    .jpeg({ quality: 95 })
    .toFile(filePath);
  return { filePath, url: `/uploads/${dir}/${name}` };
}

const productId = 'p_comprtest_' + Date.now();

async function main() {
  const categoryId = db.prepare('SELECT id FROM categories LIMIT 1').get().id;
  db.prepare("INSERT INTO products (id, categoryId, title, priceRub, description, createdAt) VALUES (?, ?, ?, 10, '', datetime('now'))")
    .run(productId, categoryId, 'Compress Test');

  // ===== Fixture: тяжёлый jpeg, на который ссылаются ДВЕ таблицы =====
  const heavy = await makeHeavyJpeg('products/' + productId);
  db.prepare('INSERT INTO product_images (productId, url, position) VALUES (?, ?, 0)').run(productId, heavy.url);
  const bannerId = 'b_comprtest_' + Date.now();
  db.prepare("INSERT INTO banners (id, title, image, href, active, [order], openInNewTab) VALUES (?, 'T', ?, NULL, 1, 1, 0)")
    .run(bannerId, heavy.url);

  // ===== Fixture: temp-ссылка product_images =====
  const tempImg = await makeHeavyJpeg('temp');
  db.prepare('INSERT INTO product_images (productId, url, position) VALUES (?, ?, 1)').run(productId, tempImg.url);

  // ===== Fixture: битая ссылка =====
  db.prepare('INSERT INTO product_images (productId, url, position) VALUES (?, ?, 2)')
    .run(productId, '/uploads/products/' + productId + '/definitely_missing.jpg');

  // ===== Fixture: сирота в products =====
  const orphan = await makeHeavyJpeg('products/' + productId + '_orphan');

  // ===== 1) Dry-run: ничего не меняет =====
  const dry = await runScript([]);
  assert.equal(dry.code, 0, 'dry-run должен завершаться 0');
  assert.ok(dry.stdout.includes('[dry-run]'), 'dry-run должен помечаться');
  assert.ok(fs.existsSync(heavy.filePath), 'dry-run не трогает файлы');
  assert.equal(
    db.prepare('SELECT url FROM product_images WHERE productId = ? AND position = 0').get(productId).url,
    heavy.url,
    'dry-run не трогает БД',
  );

  // ===== 2) --apply --backup-dir: сжатие + обновление двух таблиц =====
  const apply = await runScript(['--apply', `--backup-dir=${backupDir}`]);
  assert.equal(apply.code, 0, 'apply должен проходить: ' + apply.stderr.slice(0, 500));

  const newProductImage = db.prepare('SELECT url FROM product_images WHERE productId = ? AND position = 0').get(productId).url;
  assert.notEqual(newProductImage, heavy.url, 'ссылка product_images должна обновиться');
  assert.ok(newProductImage.endsWith('.webp'), 'новая ссылка webp: ' + newProductImage);
  const newBanner = db.prepare('SELECT image FROM banners WHERE id = ?').get(bannerId).image;
  assert.equal(newBanner, newProductImage, 'обе таблицы указывают на один новый URL');
  assert.ok(!fs.existsSync(heavy.filePath), 'старый файл удалён');
  const newFilePath = path.join(uploadsRoot, newProductImage.slice('/uploads/'.length));
  assert.ok(fs.existsSync(newFilePath), 'новый webp на диске');
  assert.ok(
    fs.statSync(newFilePath).size < fs.statSync(path.join(backupDir, heavy.url.slice('/uploads/'.length))).size,
    'сжатый меньше бэкапа оригинала',
  );

  // ===== 3) temp-ссылка переехала в products/ =====
  const migrated = db.prepare('SELECT url FROM product_images WHERE productId = ? AND position = 1').get(productId).url;
  assert.ok(migrated.startsWith('/uploads/products/' + productId + '/'), 'temp-ссылка перенесена: ' + migrated);
  assert.ok(fs.existsSync(path.join(uploadsRoot, migrated.slice('/uploads/'.length))), 'перенесённый файл на диске');

  // ===== 4) Битая ссылка: осталась в БД, упомянута в отчёте =====
  const stillBroken = db.prepare('SELECT url FROM product_images WHERE productId = ? AND position = 2').get(productId).url;
  assert.equal(stillBroken, '/uploads/products/' + productId + '/definitely_missing.jpg', 'битая ссылка не «чинится»');
  assert.ok(apply.stdout.includes('definitely_missing'), 'битая ссылка упомянута в отчёте');

  // ===== 5) --cleanup: карантин, не удаление =====
  const cleanupDry = await runScript(['--cleanup']);
  assert.ok(fs.existsSync(orphan.filePath), 'dry-run cleanup не трогает файлы');

  const cleanup = await runScript(['--cleanup', '--apply']);
  assert.ok(!fs.existsSync(orphan.filePath), 'сирота убран из products');
  // Карантин сохраняет структуру каталогов: _quarantine/products/<dir>/...
  const quarantinePath = path.join(
    uploadsRoot,
    '_quarantine',
    orphan.url.slice('/uploads/'.length),
  );
  assert.ok(fs.existsSync(quarantinePath), 'сирота лежит в карантине: ' + quarantinePath);

  // ===== 6) --limit: режет выборку =====
  const oneMore = await makeHeavyJpeg('products/' + productId);
  db.prepare('INSERT INTO product_images (productId, url, position) VALUES (?, ?, 3)').run(productId, oneMore.url);
  const limited = await runScript(['--limit=1']);
  assert.ok(limited.stdout.includes('--limit=1'), 'limit отражается в отчёте');
  assert.equal(
    db.prepare('SELECT url FROM product_images WHERE productId = ? AND position = 3').get(productId).url,
    oneMore.url,
    'dry-run c limit не меняет БД',
  );

  console.log('[compress-uploads.test] OK');
}

try {
  await main();
} finally {
  try { db.close(); } catch { /* уже закрыт */ }
  fs.rmSync(sandbox, { recursive: true, force: true });
}
