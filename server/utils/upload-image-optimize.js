import fs from 'node:fs';
import sharp from 'sharp';

/**
 * Автосжатие изображений при загрузке в админке.
 *
 * Фото с телефона (3024x4032, ~2 МБ) раньше попадало на витрину как есть.
 * Теперь upload.js после записи файла прогоняет его через этот модуль:
 * картинка пересжимается в webp с разумным для target-каталога размером.
 *
 * Best-effort: любая ошибка обработки оставляет оригинальный файл на месте —
 * загрузка не должна падать из-за сжатия. GIF пропускается (анимация теряет
 * кадры), маленькие webp тоже (уже оптимальны).
 */

/** Каталоги с мелкими картинками: 800px достаточно. */
const SMALL_TARGETS = new Set(['wheel-prizes', 'staff', 'settings', 'pos']);

/** Баннеры: широкие, но тонкие — 1920px по большей стороне. */
const WIDE_TARGETS = new Set(['banners']);

/** Порог «уже оптимально»: не трогаем webp меньше 100 КБ. */
const ALREADY_OPTIMAL_BYTES = 100 * 1024;

/** Порог «сжатие не помогло»: если webp не меньше оригинала — оставляем оригинал. */
const MIN_SAVING_RATIO = 0.95;

function specForTarget(target) {
  if (WIDE_TARGETS.has(target)) {
    return { maxSide: 1920, quality: 85 };
  }
  if (SMALL_TARGETS.has(target)) {
    return { maxSide: 800, quality: 85 };
  }
  // products, temp, color-images и всё прочее: витринные фото.
  return { maxSide: 1600, quality: 80 };
}

/**
 * Пересжать загруженную картинку в webp.
 *
 * @returns {Promise<string|null>} новое имя файла (webp) или null, если файл
 *   оставлен как есть (gif, маленький webp, ошибка, отсутствие выгоды).
 */
export async function optimizeUploadedImage(filePath, target) {
  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return null;
  }

  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  if (ext === '.gif') {
    return null; // анимация: пересжатие в webp (один кадр) испортит
  }
  if (ext === '.webp' && stat.size < ALREADY_OPTIMAL_BYTES) {
    return null; // уже оптимально
  }
  // webp > 100 КБ — пересжимаем тоже:_resize может дать меньше.

  const spec = specForTarget(String(target || ''));

  try {
    const buffer = await fs.promises.readFile(filePath);
    const outputBuffer = await sharp(buffer)
      .resize(spec.maxSide, spec.maxSide, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: spec.quality, alphaQuality: 90 })
      .toBuffer();

    if (outputBuffer.length >= stat.size * MIN_SAVING_RATIO) {
      return null; // выгоды нет — не плодить двойные файлы
    }

    const lastDot = filePath.lastIndexOf('.');
    const baseName = lastDot > 0 ? filePath.slice(0, lastDot) : filePath;
    const newFileName = `${baseName}.webp`;

    if (newFileName === filePath) {
      // Уже webp: заменяем содержимое через tmp-файл, имя не меняется.
      // (unlink того же имени удалил бы только что записанный результат.)
      const tempOutput = `${filePath}.tmp-${process.pid}-${Date.now()}`;
      await fs.promises.writeFile(tempOutput, outputBuffer);
      await fs.promises.rename(tempOutput, filePath);
      return filePath;
    }

    // Пишем во временный файл и переименовываем: атомарная запись.
    const tempOutput = `${newFileName}.tmp-${process.pid}-${Date.now()}`;
    await fs.promises.writeFile(tempOutput, outputBuffer);
    await fs.promises.rename(tempOutput, newFileName);
    await fs.promises.unlink(filePath);

    return newFileName;
  } catch (error) {
    console.error('[upload-optimize] failed, keeping original:', {
      filePath,
      message: error?.message || error,
    });
    return null;
  }
}
