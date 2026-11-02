/**
 * Автосжатие загружаемых картинок (utils/upload-image-optimize.js).
 *
 * Проверяем: большой jpeg пересжимается в webp и оригинал удаляется;
 * gif пропускается; маленький webp пропускается; битый файл остаётся
 * оригиналом; отсутствие выгоды оставляет оригинал.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const { optimizeUploadedImage } = await import('../utils/upload-image-optimize.js');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-optimize-test-'));

async function makeBigJpeg(name, size = 2400, fill = { r: 120, g: 40, b: 200 }) {
  const filePath = path.join(tempDir, name);
  // Шум вместо заливки: заливка сжимается в ноль и не даёт «большой» файл.
  const raw = Buffer.alloc(size * size * 3);
  for (let i = 0; i < raw.length; i += 3) {
    raw[i] = (i * 7 + (i >> 8)) & 0xff;
    raw[i + 1] = (i * 13 + (i >> 4)) & 0xff;
    raw[i + 2] = (i * 29) & 0xff;
  }
  await sharp(raw, { raw: { width: size, height: size, channels: 3 } })
    .jpeg({ quality: 95 })
    .toFile(filePath);
  return filePath;
}

async function makeGif(name) {
  const filePath = path.join(tempDir, name);
  const buffer = await sharp({
    create: { width: 64, height: 64, channels: 4, background: '#3366aa' },
  }).gif().toBuffer();
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

async function makeTinyWebp(name) {
  const filePath = path.join(tempDir, name);
  await sharp({
    create: { width: 32, height: 32, channels: 4, background: '#aa3366' },
  }).webp({ quality: 90 }).toFile(filePath);
  return filePath;
}

// 1) Большой jpeg: сжимается, оригинал удаляется, имя .webp.
{
  const src = await makeBigJpeg('big.jpg');
  const originalSize = fs.statSync(src).size;
  const result = await optimizeUploadedImage(src, 'products');
  assert.ok(result, 'big jpeg должен пересжиматься');
  assert.ok(result.endsWith('.webp'), `результат должен быть webp: ${result}`);
  assert.ok(fs.existsSync(result), 'webp-файл должен существовать');
  assert.ok(!fs.existsSync(src), 'оригинал должен удаляться после сжатия');
  const compressedSize = fs.statSync(result).size;
  assert.ok(
    compressedSize < originalSize / 2,
    `сжатый (${compressedSize}) должен быть сильно меньше оригинала (${originalSize})`,
  );
  // Размер картинки не превышает 1600px (products).
  const meta = await sharp(result).metadata();
  assert.ok(Math.max(meta.width, meta.height) <= 1600, 'сторона не больше 1600px');
}

// 2) GIF пропускается.
{
  const src = await makeGif('anim.gif');
  const result = await optimizeUploadedImage(src, 'products');
  assert.equal(result, null, 'gif должен пропускаться');
  assert.ok(fs.existsSync(src), 'gif должен остаться');
}

// 3) Маленький webp пропускается.
{
  const src = await makeTinyWebp('tiny.webp');
  const result = await optimizeUploadedImage(src, 'products');
  assert.equal(result, null, 'маленький webp должен пропускаться');
  assert.ok(fs.existsSync(src), 'маленький webp должен остаться');
}

// 4) Битый файл: остаётся оригиналом, null, без throw.
{
  const src = path.join(tempDir, 'broken.jpg');
  fs.writeFileSync(src, Buffer.from('this is not an image at all'));
  const result = await optimizeUploadedImage(src, 'products');
  assert.equal(result, null, 'битый файл должен возвращать null');
  assert.ok(fs.existsSync(src), 'битый файл должен остаться на месте');
}

// 5) Webp без выгоды от пересжатия не ломается и не плодит дубли.
{
  // Шум webp q90 >100 КБ: пересжатие либо даст выигрыш (валидный путь),
  // либо нет (ветка MIN_SAVING_RATIO). В обоих случаях файлы консистентны.
  const filePath = path.join(tempDir, 'nowin.webp');
  const raw = Buffer.alloc(600 * 600 * 3);
  for (let i = 0; i < raw.length; i += 3) {
    raw[i] = (i * 11 + (i >> 6)) & 0xff;
    raw[i + 1] = (i * 17) & 0xff;
    raw[i + 2] = (i * 23) & 0xff;
  }
  await sharp(raw, { raw: { width: 600, height: 600, channels: 3 } })
    .webp({ quality: 90, effort: 6 })
    .toFile(filePath);
  const result = await optimizeUploadedImage(filePath, 'products');
  // Три консистентных исхода: (а) null и старый файл цел; (б) заменён
  // на месте (webp->webp): путь тот же, файл существует; (в) новый путь
  // существует, старого нет. Всегда существует ровно один итоговый файл.
  if (result === null) {
    assert.ok(fs.existsSync(filePath), 'без выгоды старый файл должен остаться');
  } else if (result === filePath) {
    assert.ok(fs.existsSync(filePath), 'замена на месте должна оставлять файл');
    assert.ok(
      fs.statSync(filePath).size < 288874,
      'файл после замены на месте должен стать меньше',
    );
  } else {
    assert.ok(fs.existsSync(result), 'новый файл должен существовать');
    assert.ok(!fs.existsSync(filePath), 'старый файл должен удалиться');
  }
  // Не осталось мусорных tmp-файлов.
  const leftovers = fs.readdirSync(tempDir).filter((f) => f.includes('.tmp-'));
  assert.equal(leftovers.length, 0, 'tmp-файлы должны быть переименованы: ' + leftovers.join(','));
}

// 6) Баннеры: до 1920px, мелкие каталоги: до 800px.
{
  const banner = await makeBigJpeg('banner.jpg', 2000);
  const result = await optimizeUploadedImage(banner, 'banners');
  assert.ok(result, 'баннер должен сжиматься');
  const meta = await sharp(result).metadata();
  assert.ok(Math.max(meta.width, meta.height) <= 1920, 'баннер не больше 1920px');

  const prize = await makeBigJpeg('prize.jpg', 1000);
  const prizeResult = await optimizeUploadedImage(prize, 'wheel-prizes');
  assert.ok(prizeResult, 'приз должен сжиматься');
  const prizeMeta = await sharp(prizeResult).metadata();
  assert.ok(Math.max(prizeMeta.width, prizeMeta.height) <= 800, 'приз не больше 800px');
}

console.log('[upload-image-optimize.test] OK');
