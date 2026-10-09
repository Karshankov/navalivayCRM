import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { db } from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const baseUploads = path.resolve(process.env.UPLOADS_DIR || path.resolve(__dirname, '../../uploads'));
const failedThumbnailSources = new Set();

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function sourceHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function parseBase64Image(value) {
  const match = String(value).match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  return match ? Buffer.from(match[1], 'base64') : null;
}

function uploadsPathFromUrl(value) {
  const source = String(value || '');
  if (!source.startsWith('/uploads/')) return null;
  const rel = source.slice('/uploads/'.length).replace(/\\/g, '/');
  const resolved = path.resolve(baseUploads, rel);
  return resolved.startsWith(baseUploads) ? resolved : null;
}

async function sourceToBuffer(source) {
  if (!source) return null;
  if (String(source).startsWith('data:image/')) {
    return parseBase64Image(source);
  }
  const uploadPath = uploadsPathFromUrl(source);
  if (uploadPath && fs.existsSync(uploadPath)) {
    return await fs.promises.readFile(uploadPath);
  }
  return null;
}

/**
 * Готовые размеры картинок.
 *
 * `search` трогать нельзя: по её хэшу уже лежат сотни файлов на проде, и смена
 * правила заставила бы пересчитать их все. Поэтому только у новых размеров имя
 * файла считается с примесью названия размера — иначе одна и та же картинка в
 * двух размерах писалась бы в один файл.
 *
 * Обложка режется в 240px по большей стороне: на витрине она занимает 88x104
 * логических пикселя, этого с запасом хватает на экраны с двойной плотностью.
 * `fit: inside` не кадрирует и не подкладывает фон, поэтому прозрачность
 * доезжает как есть: webp хранит альфу, а `flatten` мы не зовём.
 */
const VARIANTS = {
  search: { dir: 'search', size: 96, fit: 'cover', quality: 70, alphaQuality: 80, legacyHash: true },
  cover: { dir: 'covers', size: 240, fit: 'inside', quality: 78, alphaQuality: 90 },
};

function variantHash(variant, value) {
  return VARIANTS[variant].legacyHash ? sourceHash(value) : sourceHash(`${variant}|${value}`);
}

async function resolveVariant(variant, source, meta = {}) {
  if (!source) return null;
  const value = String(source);
  if (!value.startsWith('data:image/') && !value.startsWith('/uploads/')) {
    return value;
  }

  const spec = VARIANTS[variant];
  const hash = variantHash(variant, value);
  if (failedThumbnailSources.has(hash)) {
    return value.startsWith('/uploads/') ? value : null;
  }
  const cached = db
    .prepare('SELECT thumbnail_url AS thumbnailUrl FROM image_thumbnail_cache WHERE source_hash = ?')
    .get(hash);
  // Запись в кэше — ещё не гарантия, что файл на месте: папку uploads чистят,
  // переносят и восстанавливают из копии отдельно от базы. Без этой проверки
  // расхождение чинилось бы только руками, а витрина всё это время отдавала бы
  // битые картинки.
  if (cached?.thumbnailUrl && fs.existsSync(uploadsPathFromUrl(cached.thumbnailUrl) || '')) {
    return cached.thumbnailUrl;
  }

  try {
    const buffer = await sourceToBuffer(value);
    if (!buffer?.length) {
      return value.startsWith('/uploads/') ? value : null;
    }

    const outputDir = path.resolve(baseUploads, 'thumbnails', spec.dir);
    ensureDir(outputDir);
    const outputPath = path.join(outputDir, `${hash}.webp`);
    const info = await sharp(buffer)
      .resize(spec.size, spec.size, { fit: spec.fit, withoutEnlargement: spec.fit === 'inside' })
      .webp({ quality: spec.quality, alphaQuality: spec.alphaQuality })
      .toFile(outputPath);
    const thumbnailUrl = `/uploads/thumbnails/${spec.dir}/${hash}.webp`;

    db.prepare(`
      INSERT INTO image_thumbnail_cache (
        source_hash, source_type, source_id, source_field, thumbnail_url, width, height, bytes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_hash) DO UPDATE SET
        thumbnail_url = excluded.thumbnail_url,
        width = excluded.width,
        height = excluded.height,
        bytes = excluded.bytes
    `).run(
      hash,
      meta.sourceType || (value.startsWith('/uploads/') ? 'upload' : 'base64'),
      meta.sourceId || null,
      meta.sourceField || null,
      thumbnailUrl,
      info.width || spec.size,
      info.height || spec.size,
      info.size || 0,
    );

    return thumbnailUrl;
  } catch (error) {
    failedThumbnailSources.add(hash);
    console.error(`[thumbnail] failed to generate ${variant} image:`, {
      sourceType: meta.sourceType,
      sourceId: meta.sourceId,
      sourceField: meta.sourceField,
      message: error.message,
    });
    return value.startsWith('/uploads/') ? value : null;
  }
}

/** Миниатюра 96x96 для строк поиска в админке. */
export async function resolveImageThumbnail(source, meta = {}) {
  return resolveVariant('search', source, meta);
}

/** Обложка линейки или категории для витрины. */
export async function resolveCoverImage(source, meta = {}) {
  return resolveVariant('cover', source, meta);
}

export async function resolveFirstImageThumbnail(sources) {
  for (const item of sources) {
    const thumbnail = await resolveImageThumbnail(item?.source, item?.meta || {});
    if (thumbnail) return thumbnail;
  }
  return null;
}
