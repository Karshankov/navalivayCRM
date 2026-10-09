/**
 * Утилита для обработки изображений
 * Конвертирует загружаемые изображения в WebP с сохранением прозрачности
 */

import sharp from 'sharp';

// Настройки обработки изображений
const IMAGE_OPTIONS = {
  maxWidth: 800,
  maxHeight: 800,
  webpQuality: 80,
  webpAlphaQuality: 90,
};

/**
 * Конвертирует base64 изображение в WebP
 * @param {string} base64String - исходное изображение в формате data:image/...;base64,...
 * @returns {Promise<string|null>} - WebP изображение в формате data:image/webp;base64,... или null при ошибке
 */
export async function convertImageToWebP(base64String) {
  if (!base64String || !base64String.startsWith('data:image')) {
    return base64String; // Возвращаем как есть если не изображение
  }

  try {
    const matches = base64String.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) {
      console.warn('[imageUtils] Invalid base64 format');
      return base64String;
    }

    const originalFormat = matches[1].toLowerCase();
    
    // Если уже WebP - возвращаем как есть

    const imageBuffer = Buffer.from(matches[2], 'base64');

    // Конвертируем в WebP с сохранением прозрачности
    const webpBuffer = await sharp(imageBuffer)
      .resize(IMAGE_OPTIONS.maxWidth, IMAGE_OPTIONS.maxHeight, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({ 
        quality: IMAGE_OPTIONS.webpQuality,
        alphaQuality: IMAGE_OPTIONS.webpAlphaQuality,
      })
      .toBuffer();

    const result = `data:image/webp;base64,${webpBuffer.toString('base64')}`;
    
    // Логируем экономию
    const originalSize = imageBuffer.length;
    const newSize = webpBuffer.length;
    const savings = ((originalSize - newSize) / originalSize * 100).toFixed(1);
    console.log(`[imageUtils] Converted ${originalFormat.toUpperCase()} -> WebP: ${(originalSize / 1024).toFixed(0)}KB -> ${(newSize / 1024).toFixed(0)}KB (${savings}% saved)`);

    return result;
  } catch (err) {
    console.error('[imageUtils] Conversion error:', err.message);
    return base64String; // Возвращаем оригинал при ошибке
  }
}

/**
 * Проверяет, является ли строка base64 изображением
 * @param {string} str 
 * @returns {boolean}
 */
export function isBase64Image(str) {
  return typeof str === 'string' && str.startsWith('data:image');
}

/**
 * Получает формат изображения из base64 строки
 * @param {string} base64String 
 * @returns {string|null} - 'png', 'jpeg', 'webp', etc. или null
 */
export function getImageFormat(base64String) {
  if (!base64String || !base64String.startsWith('data:image')) {
    return null;
  }
  const matches = base64String.match(/^data:image\/(\w+);base64/);
  return matches ? matches[1].toLowerCase() : null;
}
