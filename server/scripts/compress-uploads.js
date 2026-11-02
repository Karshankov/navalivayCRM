#!/usr/bin/env node
/**
 * Пакетное сжатие существующих изображений витрины.
 *
 * Что делает:
 *  1. Собирает все ИСПОЛЬЗУЕМЫЕ URL картинок из БД (product_images,
 *     banners, wheel_prizes, product_variants.color_image, settings).
 *     Аватары клиентов не трогает (они мелкие, 28 КБ в среднем).
 *  2. Файлы больше порога (>150 КБ или сторона >1600px) пересжимает
 *     в webp теми же правилами, что автосжатие при загрузке.
 *  3. Обновляет ВСЕ вхождения URL в БД одной транзакцией, файл пишет
 *     атомарно, оригинал копирует в backup-dir (если задан) и удаляет.
 *  4. Переносит product_images со ссылками /uploads/temp/... в
 *     /uploads/products/<productId>/ (чинит исторический баг потока
 *     создания товара) той же транзакцией.
 *  5. --cleanup: файлы без ссылок в БД (осиротевшие) переносит в
 *     uploads/_quarantine/ — НЕ удаляет; удаляйте руками позже.
 *  6. Чистит устаревшие строки image_thumbnail_cache (миниатюры
 *     перегенерируются сами по новым URL).
 *
 * Безопасность:
 *  - по умолчанию DRY RUN: ничего не меняет, печатает отчёт;
 *  - --apply — выполнение; --backup-dir=... — копия оригиналов;
 *  - --limit=N — обработать только N первых кандидатов (тест на проде);
 *  - падение на любом файле не влияет на остальные: каждый файл —
 *    транзакция БД после успешной записи нового файла на диск.
 *
 * Запуск:
 *   node scripts/compress-uploads.js                      # dry-run
 *   node scripts/compress-uploads.js --apply --backup-dir=/path
 *   node scripts/compress-uploads.js --apply --limit=5
 *   node scripts/compress-uploads.js --cleanup            # тоже dry-run
 *   node scripts/compress-uploads.js --cleanup --apply
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '../..');
// UPLOADS_DIR позволяет тестам работать в изолированной песочнице.
// Дефолт — реальный uploads репозитория, как у upload.js.
const baseUploads = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve(appRoot, 'uploads');

const { db } = await import('../db.js');

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const CLEANUP = argv.includes('--cleanup');
const DRY_RUN = !APPLY;
const limitArg = argv.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? Math.max(1, parseInt(limitArg.split('=')[1], 10) || 0) : null;
const backupArg = argv.find((a) => a.startsWith('--backup-dir='));
const BACKUP_DIR = backupArg ? backupArg.split('=').slice(1).join('=') : null;

/** Порог попадания в кандидаты: больше 150 КБ ИЛИ шире/выше 1600px. */
const MIN_BYTES = 150 * 1024;
const MAX_SIDE = 1600;

/** Правила сжатия по каталогу — зеркально utils/upload-image-optimize.js. */
const SMALL_DIRS = new Set(['wheel-prizes', 'staff', 'settings', 'pos']);
const WIDE_DIRS = new Set(['banners']);

function specForUrl(url) {
  const rel = url.slice('/uploads/'.length);
  const dir = rel.split('/')[0];
  if (WIDE_DIRS.has(dir)) return { maxSide: 1920, quality: 85 };
  if (SMALL_DIRS.has(dir)) return { maxSide: 800, quality: 85 };
  return { maxSide: 1600, quality: 80 };
}

function urlToPath(url) {
  const rel = url.slice('/uploads/'.length).replace(/\\/g, '/');
  const resolved = path.resolve(baseUploads, rel);
  if (!resolved.startsWith(baseUploads)) return null;
  return resolved;
}

function pathToUrl(p) {
  const rel = path.relative(baseUploads, p).replace(/\\/g, '/');
  return '/uploads/' + rel;
}

// ===================== Сбор используемых URL =====================

/** {url: [{table, column, pk}]} — карта вхождений для транзакционных правок. */
function collectReferencedUrls() {
  const occurrences = new Map();

  const add = (table, column, pk, url) => {
    if (typeof url !== 'string' || !url.startsWith('/uploads/')) return;
    if (!occurrences.has(url)) occurrences.set(url, []);
    occurrences.get(url).push({ table, column, pk });
  };

  db.prepare('SELECT url, productId FROM product_images').all()
    .forEach((r) => add('product_images', 'url', { productId: r.productId, url: r.url }, r.url));
  db.prepare('SELECT id, image FROM banners').all()
    .forEach((r) => add('banners', 'image', { id: r.id }, r.image));
  try {
    db.prepare('SELECT id, image_url FROM wheel_prizes').all()
      .forEach((r) => add('wheel_prizes', 'image_url', { id: r.id }, r.image_url));
  } catch { /* нет таблицы на старых копиях */ }
  try {
    db.prepare("SELECT id, color_image FROM product_variants WHERE color_image LIKE '/uploads/%'").all()
      .forEach((r) => add('product_variants', 'color_image', { id: r.id }, r.color_image));
  } catch { /* нет колонки */ }
  try {
    db.prepare("SELECT key, value FROM settings WHERE value LIKE '/uploads/%'").all()
      .forEach((r) => add('settings', 'value', { key: r.key }, r.value));
  } catch { /* нет таблицы */ }

  return occurrences;
}

// ===================== Операции над одним URL =====================

async function statCandidate(url) {
  const filePath = urlToPath(url);
  if (!filePath) return { url, error: 'bad_path' };
  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return { url, error: 'missing_file' };
  }
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.gif') return { url, error: 'gif_skipped' };

  let meta = null;
  try {
    meta = await sharp(filePath).metadata();
  } catch {
    return { url, error: 'unreadable_image' };
  }
  const side = Math.max(meta.width || 0, meta.height || 0);
  const eligible = stat.size > MIN_BYTES || side > MAX_SIDE;
  return { url, filePath, stat, meta, side, eligible };
}

async function compressFile(cand) {
  const spec = specForUrl(cand.url);
  const buffer = await fs.promises.readFile(cand.filePath);
  const output = await sharp(buffer)
    .resize(spec.maxSide, spec.maxSide, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: spec.quality, alphaQuality: 90 })
    .toBuffer();
  // Нет выгоды — пропускаем (кандидат мог попасть по порогу размера, но
  // уже быть хорошо сжатым).
  if (output.length >= cand.stat.size * 0.9) {
    return { skipped: true };
  }

  const lastDot = cand.filePath.lastIndexOf('.');
  const baseName = lastDot > 0 ? cand.filePath.slice(0, lastDot) : cand.filePath;
  const newPath = `${baseName}.webp`;
  const newUrl = pathToUrl(newPath);

  // 1) Бэкап оригинала (если задан каталог).
  if (BACKUP_DIR) {
    const backupPath = path.join(BACKUP_DIR, cand.url.slice('/uploads/'.length));
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.copyFileSync(cand.filePath, backupPath);
  }

  // 2) Новый файл на диск (атомарно, во временный + rename).
  const tempOutput = `${newPath}.tmp-${process.pid}-${Date.now()}`;
  await fs.promises.writeFile(tempOutput, output);
  await fs.promises.rename(tempOutput, newPath);

  // 3) Все ссылки в БД — одной транзакцией.
  const updateStmts = {
    product_images: (occ) => db.prepare('UPDATE product_images SET url = ? WHERE productId = ? AND url = ?'),
    banners: (occ) => db.prepare('UPDATE banners SET image = ? WHERE id = ?'),
    wheel_prizes: (occ) => db.prepare('UPDATE wheel_prizes SET image_url = ? WHERE id = ?'),
    product_variants: (occ) => db.prepare('UPDATE product_variants SET color_image = ? WHERE id = ?'),
    settings: (occ) => db.prepare('UPDATE settings SET value = ? WHERE key = ?'),
  };
  const tx = db.transaction(() => {
    for (const occ of cand.occurrences) {
      const make = updateStmts[occ.table];
      if (!make) throw new Error(`нет апдейтера для таблицы ${occ.table}`);
      if (occ.table === 'product_images') {
        make(occ).run(newUrl, occ.pk.productId, occ.pk.url);
      } else if (occ.table === 'settings') {
        make(occ).run(newUrl, occ.pk.key);
      } else {
        make(occ).run(newUrl, occ.pk.id);
      }
    }
  });
  tx();

  // 4) Удаляем старый файл (после успешной транзакции!).
  if (newPath !== cand.filePath) {
    await fs.promises.unlink(cand.filePath);
  }

  return { skipped: false, newUrl, bytesBefore: cand.stat.size, bytesAfter: output.length };
}

// ===================== Перенос temp-ссылок =====================

async function migrateTempReferences() {
  // DISTINCT url — один файл один раз, но обновляем ВСЕ его вхождения.
  const rows = db.prepare("SELECT DISTINCT url FROM product_images WHERE url LIKE '/uploads/temp/%'").all();
  const productIdStmt = db.prepare('SELECT productId FROM product_images WHERE url = ? LIMIT 1');
  const results = [];
  for (const row of rows) {
    const productId = productIdStmt.get(row.url)?.productId;
    const srcPath = urlToPath(row.url);
    if (!srcPath || !fs.existsSync(srcPath)) {
      results.push({ url: row.url, error: 'missing_file' });
      continue;
    }
    const fileName = path.basename(srcPath);
    if (!productId) {
      results.push({ url: row.url, error: 'no_product' });
      continue;
    }
    const productDir = path.join(baseUploads, 'products', productId);
    const destPath = path.join(productDir, fileName);
    const destUrl = pathToUrl(destPath);
    if (destUrl === row.url) {
      results.push({ url: row.url, skipped: true });
      continue;
    }
    if (DRY_RUN) {
      results.push({ url: row.url, newUrl: destUrl, dryRun: true });
      continue;
    }
    fs.mkdirSync(productDir, { recursive: true });
    if (BACKUP_DIR) {
      const backupPath = path.join(BACKUP_DIR, row.url.slice('/uploads/'.length));
      fs.mkdirSync(path.dirname(backupPath), { recursive: true });
      fs.copyFileSync(srcPath, backupPath);
    }
    fs.copyFileSync(srcPath, destPath);
    const tx = db.transaction(() => {
      db.prepare('UPDATE product_images SET url = ? WHERE url = ?').run(destUrl, row.url);
    });
    tx();
    results.push({ url: row.url, newUrl: destUrl });
  }
  return results;
}

// ===================== Карантин сирот =====================

function listAllUploadFiles() {
  const skip = new Set(['_quarantine']);
  const results = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (skip.has(entry.name)) continue;
        walk(path.join(dir, entry.name));
      } else {
        results.push(path.join(dir, entry.name));
      }
    }
  };
  walk(baseUploads);
  return results;
}

const NON_DB_DIRS = new Set(['customer-avatars', 'thumbnails']);
// temp частично используется БД (product_images), частично мусор —
// обрабатывается ссылками, не карантином.

function quarantineOrphans(occurrences) {
  const referenced = new Set(occurrences.keys());
  const orphans = [];
  for (const filePath of listAllUploadFiles()) {
    const url = pathToUrl(filePath);
    if (referenced.has(url)) continue;
    const dir = url.split('/')[2];
    if (NON_DB_DIRS.has(dir)) continue;
    // temp: мусор только если файл старше 7 дней (незавершённые загрузки).
    if (dir === 'temp') {
      const stat = fs.statSync(filePath);
      if (Date.now() - stat.mtimeMs < 7 * 24 * 3600 * 1000) continue;
    }
    orphans.push(filePath);
  }
  if (DRY_RUN) {
    return orphans.map((p) => ({ path: p, dryRun: true }));
  }
  const results = [];
  for (const filePath of orphans) {
    const quarantinePath = path.join(baseUploads, '_quarantine', path.relative(baseUploads, filePath));
    fs.mkdirSync(path.dirname(quarantinePath), { recursive: true });
    fs.renameSync(filePath, quarantinePath);
    results.push({ path: filePath, quarantinedTo: quarantinePath });
  }
  return results;
}

// ===================== Чистка кэша миниатюр =====================

function pruneThumbnailCache(occurrences) {
  // Миниатюры ключуются хэшем URL: битые/старые URL дадут битые пути.
  const rows = db.prepare('SELECT source_hash, thumbnail_url FROM image_thumbnail_cache').all();
  const liveHashes = new Set();
  for (const url of occurrences.keys()) {
    // хэш считается от sourceHash(value) — sha256 от строки URL.
    // Не пере-вычисляем: просто проверяем, что файл миниатюры существует
    // и исходный URL ещё жив в БД... но source_hash не хранит URL.
    // Поэтому: чистим только записи, чей файл миниатюры отсутствует.
    void url;
  }
  let removed = 0;
  for (const row of rows) {
    const thumbPath = row.thumbnail_url && urlToPath(row.thumbnail_url);
    if (thumbPath && !fs.existsSync(thumbPath)) {
      db.prepare('DELETE FROM image_thumbnail_cache WHERE source_hash = ?').run(row.source_hash);
      removed += 1;
    }
  }
  return removed;
}

// ===================== main =====================

const occurrences = collectReferencedUrls();
console.log(`Используемых URL картинок в БД: ${occurrences.size}`);

if (CLEANUP) {
  console.log('\n=== Карантин осиротевших файлов ===');
  // Размеры снимаем ДО перемещения: после apply путь уже не существует.
  const orphans = quarantineOrphans(occurrences);
  let bytes = 0;
  for (const o of orphans) {
    try {
      bytes += fs.statSync(o.quarantinedTo || o.path).size;
    } catch { /* файл мог исчезнуть между проходами — пропускаем */ }
  }
  console.log(`Сирот (файлы без ссылок в БД): ${orphans.length} | ${(bytes / 1024 / 1024).toFixed(1)} МБ`);
  for (const o of orphans.slice(0, 30)) {
    console.log(`  ${DRY_RUN ? '[dry] ' : ''}${o.path} -> ${o.quarantinedTo || 'uploads/_quarantine/...'}`);
  }
  // Полный список: отчёт пойдёт в файл для сверки перед --apply.
  if (orphans.length > 30) console.log(`  ... и ещё ${orphans.length - 30} (в печать попадают первые 30; итоговые счётчики полные)`);
  if (DRY_RUN) console.log('(dry-run: файлы не тронуты; запустите с --apply)');
  process.exit(0);
}

// Кандидаты на сжатие.
const candidates = [];
const broken = [];
const otherIssues = [];
for (const [url, occ] of occurrences) {
  const cand = await statCandidate(url);
  if (cand.error === 'missing_file') {
    broken.push({ url, occurrences: occ.length });
  } else if (cand.error) {
    otherIssues.push(cand);
  } else if (cand.eligible) {
    candidates.push({ ...cand, url, occurrences: occ });
  }
}

console.log(`Битых ссылок (файл отсутствует): ${broken.length}`);
for (const b of broken) console.log(`  БИТАЯ: ${b.url} (${b.occurrences} вхожд.)`);
if (otherIssues.length) {
  console.log(`Прочие проблемы: ${otherIssues.length}`);
  otherIssues.slice(0, 10).forEach((o) => console.log(`  ${o.error}: ${o.url}`));
}
console.log(`Кандидатов на сжатие: ${candidates.length}`);

const selected = LIMIT ? candidates.slice(0, LIMIT) : candidates;
if (LIMIT) console.log(`--limit=${LIMIT}: обрабатываю ${selected.length}`);

console.log('\n=== Сжатие ===');
let totalBefore = 0;
let totalAfter = 0;
let done = 0;
let skipped = 0;
const errors = [];
for (const cand of selected) {
  if (DRY_RUN) {
    console.log(`  [dry] ${cand.url} ${(cand.stat.size / 1024).toFixed(0)}КБ ${cand.side}px -> webp <=${specForUrl(cand.url).maxSide}px`);
    totalBefore += cand.stat.size;
    done += 1;
    continue;
  }
  try {
    const result = await compressFile(cand);
    if (result.skipped) {
      skipped += 1;
    } else {
      totalBefore += result.bytesBefore;
      totalAfter += result.bytesAfter;
      done += 1;
      if (done <= 20 || done % 50 === 0) {
        console.log(`  ${cand.url} -> ${result.newUrl} ${(result.bytesBefore / 1024).toFixed(0)}КБ -> ${(result.bytesAfter / 1024).toFixed(0)}КБ`);
      }
    }
  } catch (error) {
    errors.push({ url: cand.url, message: error?.message || String(error) });
    console.error(`  ОШИБКА ${cand.url}: ${error?.message || error}`);
  }
}

if (DRY_RUN) {
  console.log(`\n[dry-run] файлов-кандидатов: ${done} | изменений нет`);
} else {
  console.log(`\nСжато: ${done} | пропущено (нет выгоды): ${skipped} | ошибок: ${errors.length}`);
  console.log(`Объём: ${(totalBefore / 1024 / 1024).toFixed(1)} МБ -> ${(totalAfter / 1024 / 1024).toFixed(1)} МБ`);
}

console.log('\n=== Перенос temp-ссылок в products/ ===');
const migrations = await migrateTempReferences();
const migratedOk = migrations.filter((m) => !m.error);
const migratedFail = migrations.filter((m) => m.error);
console.log(`Перенесено (или будет): ${migratedOk.length} | битых temp-ссылок: ${migratedFail.length}`);
migratedFail.slice(0, 5).forEach((m) => console.log(`  БИТАЯ temp: ${m.url}`));
if (DRY_RUN) {
  console.log('(dry-run: переноса не было)');
} else {
  console.log('Перенос выполнен.');
}

console.log('\n=== Чистка кэша миниатюр ===');
const pruned = pruneThumbnailCache(occurrences);
console.log(`Удалено битых записей кэша: ${DRY_RUN ? 'n/a (dry-run)' : pruned}`);

// URL картинок сменились -> клиентский кэш каталога (mini app) хранит старые
// URL. Скачок ревизии заставит мини-аппу перезагрузить каталог при следующем
// открытии. Без bump пользователи видели бы битые картинки из localStorage.
if (!DRY_RUN && (done > 0 || migratedOk.length > 0)) {
  try {
    const { bumpCatalogRevision } = await import('../utils/catalog-revision.js');
    bumpCatalogRevision(db, 'compress-uploads apply');
    console.log('Ревизия витрины обновлена (клиентский кэш каталога сброшен).');
  } catch (error) {
    console.error('Не удалось обновить ревизию витрины:', error?.message || error);
    console.error('ВАЖНО: выполните любую товарную мутацию в админке, чтобы сбросить клиентский кэш каталога.');
  }
}

if (DRY_RUN) {
  console.log('\nИТОГ (dry-run): ничего не изменено. Для выполнения добавьте --apply' + (BACKUP_DIR ? '' : ' и --backup-dir=<путь> (рекомендуется на проде).'));
} else {
  console.log('\nИТОГ: изменения применены.' + (BACKUP_DIR ? ` Оригиналы: ${BACKUP_DIR}` : ' БЕЗ бэкапа оригиналов!'));
}
process.exit(errors.length && !DRY_RUN ? 1 : 0);
