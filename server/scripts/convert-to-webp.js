/**
 * Скрипт для конвертации PNG изображений в WebP
 * WebP поддерживает прозрачность как PNG, но размер как у JPEG
 * 
 * Запуск: node scripts/convert-to-webp.js
 * Тестовый режим: node scripts/convert-to-webp.js --dry-run
 */

import Database from 'better-sqlite3';
import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '..', 'data', 'navalivay.db');
const db = new Database(dbPath);

const DRY_RUN = process.argv.includes('--dry-run');

// Настройки сжатия WebP
const WEBP_OPTIONS = {
  maxWidth: 800,
  maxHeight: 800,
  quality: 80,        // Качество (0-100)
  alphaQuality: 90,   // Качество альфа-канала (прозрачности)
};

async function convertToWebP(base64String) {
  if (!base64String || !base64String.startsWith('data:image')) {
    return null;
  }

  try {
    const matches = base64String.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) {
      return null;
    }

    const originalFormat = matches[1].toLowerCase();
    const imageBuffer = Buffer.from(matches[2], 'base64');
    const originalSize = imageBuffer.length;

    // Конвертируем в WebP с сохранением прозрачности
    const webpBuffer = await sharp(imageBuffer)
      .resize(WEBP_OPTIONS.maxWidth, WEBP_OPTIONS.maxHeight, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({ 
        quality: WEBP_OPTIONS.quality,
        alphaQuality: WEBP_OPTIONS.alphaQuality,
      })
      .toBuffer();

    const newSize = webpBuffer.length;
    const savings = ((originalSize - newSize) / originalSize * 100).toFixed(1);

    console.log(`    ${originalFormat.toUpperCase()} -> WebP: ${(originalSize / 1024).toFixed(0)}KB -> ${(newSize / 1024).toFixed(0)}KB (экономия ${savings}%)`);

    return `data:image/webp;base64,${webpBuffer.toString('base64')}`;
  } catch (err) {
    console.error('    Ошибка конвертации:', err.message);
    return null;
  }
}

async function convertCategoryImages() {
  console.log('\n=== Конвертация обложек категорий ===\n');

  const categories = db.prepare(`
    SELECT id, name, cover_image 
    FROM categories 
    WHERE cover_image IS NOT NULL AND cover_image != ''
  `).all();

  console.log(`Найдено категорий: ${categories.length}\n`);

  let converted = 0;
  let totalSaved = 0;

  for (const cat of categories) {
    console.log(`  ${cat.name} (${cat.id})`);
    
    // Пропускаем уже WebP
    if (cat.cover_image.startsWith('data:image/webp')) {
      console.log('    Уже WebP, пропускаем');
      continue;
    }
    
    const originalSize = cat.cover_image.length;
    const webpImage = await convertToWebP(cat.cover_image);
    
    if (webpImage) {
      if (!DRY_RUN) {
        db.prepare('UPDATE categories SET cover_image = ? WHERE id = ?').run(webpImage, cat.id);
      }
      totalSaved += originalSize - webpImage.length;
      converted++;
    }
  }

  console.log(`\nКонвертировано: ${converted}/${categories.length}`);
  console.log(`Экономия: ${(totalSaved / 1024 / 1024).toFixed(2)} MB`);
  
  return { converted, totalSaved };
}

async function convertGroupImages() {
  console.log('\n=== Конвертация обложек групп ===\n');

  const groups = db.prepare(`
    SELECT id, name, cover_image 
    FROM category_groups 
    WHERE cover_image IS NOT NULL AND cover_image != ''
  `).all();

  console.log(`Найдено групп: ${groups.length}\n`);

  let converted = 0;
  let totalSaved = 0;

  for (const group of groups) {
    console.log(`  ${group.name} (${group.id})`);
    
    // Пропускаем уже WebP
    if (group.cover_image.startsWith('data:image/webp')) {
      console.log('    Уже WebP, пропускаем');
      continue;
    }
    
    const originalSize = group.cover_image.length;
    const webpImage = await convertToWebP(group.cover_image);
    
    if (webpImage) {
      if (!DRY_RUN) {
        db.prepare('UPDATE category_groups SET cover_image = ? WHERE id = ?').run(webpImage, group.id);
      }
      totalSaved += originalSize - webpImage.length;
      converted++;
    }
  }

  console.log(`\nКонвертировано: ${converted}/${groups.length}`);
  console.log(`Экономия: ${(totalSaved / 1024 / 1024).toFixed(2)} MB`);
  
  return { converted, totalSaved };
}

async function main() {
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║  Конвертация изображений в WebP                    ║');
  console.log('║  (с сохранением прозрачности)                      ║');
  console.log('╚════════════════════════════════════════════════════╝');

  if (DRY_RUN) {
    console.log('\n⚠️  ТЕСТОВЫЙ РЕЖИМ (--dry-run) - изменения НЕ будут сохранены\n');
  }

  // Размер БД до
  const statsBefore = db.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()").get();
  console.log(`\nРазмер БД до: ${(statsBefore.size / 1024 / 1024).toFixed(2)} MB`);

  const catResult = await convertCategoryImages();
  const groupResult = await convertGroupImages();

  if (!DRY_RUN) {
    // VACUUM для освобождения места
    console.log('\n=== Выполняем VACUUM ===');
    db.exec('VACUUM');
  }

  // Размер БД после
  const statsAfter = db.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()").get();
  
  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║  ИТОГ                                              ║');
  console.log('╚════════════════════════════════════════════════════╝');
  console.log(`Категорий конвертировано: ${catResult.converted}`);
  console.log(`Групп конвертировано: ${groupResult.converted}`);
  console.log(`Общая экономия данных: ${((catResult.totalSaved + groupResult.totalSaved) / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Размер БД после: ${(statsAfter.size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Экономия БД: ${((statsBefore.size - statsAfter.size) / 1024 / 1024).toFixed(2)} MB`);

  if (DRY_RUN) {
    console.log('\n💡 Для применения изменений запустите без --dry-run');
  } else {
    console.log('\n✅ Конвертация завершена!');
  }

  db.close();
}

main().catch(err => {
  console.error('Ошибка:', err);
  process.exit(1);
});
