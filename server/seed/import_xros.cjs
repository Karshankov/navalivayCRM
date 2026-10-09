const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Определяем корневую папку проекта
const serverDir = path.resolve(__dirname, '..');
const dbPath = path.join(serverDir, 'database.sqlite');

console.log('Путь к базе данных:', dbPath);

const db = new Database(dbPath);

// Загружаем данные
const vaporesso_group = JSON.parse(fs.readFileSync(path.join(__dirname, 'category_groups_vaporesso.json'), 'utf8'));
const xros_products = JSON.parse(fs.readFileSync(path.join(__dirname, 'products_xros.json'), 'utf8'));

console.log('=== Импорт данных XROS ===\n');

// Импортируем группу Vaporesso
console.log('1. Импорт группы Vaporesso...');
const stmtGroup = db.prepare(`
  INSERT OR REPLACE INTO category_groups (id, categoryId, slug, name, cover_image, [order], hide_empty, parent_group_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const txGroup = db.transaction((groups) => {
  for (const g of groups) {
    stmtGroup.run(
      g.id,
      g.categoryId,
      g.slug,
      g.name,
      g.coverImage || null,
      g.order ?? 0,
      g.hideEmpty ? 1 : 0,
      g.parentGroupId || null
    );
  }
});

try {
  txGroup(vaporesso_group);
  console.log(`✓ Группа Vaporesso добавлена (${vaporesso_group.length})\n`);
} catch (error) {
  console.error('✗ Ошибка при добавлении группы:', error.message);
}

// Импортируем товары XROS
console.log('2. Импорт товаров XROS...');
const stmtProd = db.prepare(`
  INSERT OR REPLACE INTO products (id, categoryId, groupId, title, priceRub, description, variant, strength, cost_price, stock, min_stock, use_category_image, has_variants, createdAt)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const stmtVariant = db.prepare(`
  INSERT OR REPLACE INTO product_variants (id, product_id, name, color_code, price_rub, stock, position)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const stmtVariantImage = db.prepare(`
  INSERT OR REPLACE INTO product_variant_images (variant_id, url, position)
  VALUES (?, ?, ?)
`);

const stmtLink = db.prepare(`
  INSERT OR REPLACE INTO product_links (productId, label, url, position)
  VALUES (?, ?, ?, ?)
`);

// Удаляем старые изображения вариантов для этих продуктов
const stmtDeleteVariantImages = db.prepare(`
  DELETE FROM product_variant_images 
  WHERE variant_id IN (
    SELECT id FROM product_variants WHERE product_id = ?
  )
`);

const stmtDeleteVariants = db.prepare(`DELETE FROM product_variants WHERE product_id = ?`);
const stmtDeleteLinks = db.prepare(`DELETE FROM product_links WHERE productId = ?`);

const txProd = db.transaction((products) => {
  for (const p of products) {
    const createdAt = new Date().toISOString();
    const hasVariants = p.hasVariants ? 1 : 0;
    const useCategoryImage = p.useCategoryImage !== undefined ? (p.useCategoryImage ? 1 : 0) : 1;

    // Удаляем старые данные
    stmtDeleteVariantImages.run(p.id);
    stmtDeleteVariants.run(p.id);
    stmtDeleteLinks.run(p.id);

    // Вставляем товар
    stmtProd.run(
      p.id,
      p.categoryId,
      p.groupId || null,
      p.title || null,
      p.priceRub,
      p.description || null,
      p.variant || null,
      p.strength || null,
      typeof p.costPrice === 'number' ? p.costPrice : 0,
      typeof p.stock === 'number' ? p.stock : 0,
      typeof p.minStock === 'number' ? p.minStock : 0,
      useCategoryImage,
      hasVariants,
      createdAt
    );

    // Вставляем варианты
    if (Array.isArray(p.variants)) {
      for (const v of p.variants) {
        const variantId = `${p.id}_variant_${v.position || 0}`;
        stmtVariant.run(
          variantId,
          p.id,
          v.name,
          v.colorCode || null,
          v.priceRub || null,
          typeof v.stock === 'number' ? v.stock : null,
          v.position || 0
        );

        // Вставляем изображения варианта
        if (Array.isArray(v.images)) {
          v.images.forEach((url, idx) => {
            stmtVariantImage.run(variantId, url, idx);
          });
        }
      }
    }

    // Вставляем ссылки
    if (Array.isArray(p.links)) {
      p.links.forEach((link, idx) => {
        if (link && link.url) {
          stmtLink.run(p.id, link.label || null, link.url, idx);
        }
      });
    }
  }
});

try {
  txProd(xros_products);
  console.log(`✓ Товары XROS добавлены (${xros_products.length})`);
  
  // Показываем добавленные товары
  xros_products.forEach(p => {
    const variantCount = p.variants?.length || 0;
    console.log(`  - ${p.title} (${variantCount} вариантов)`);
  });
  
  console.log('\n=== Импорт завершён успешно! ===');
} catch (error) {
  console.error('\n✗ Ошибка при добавлении товаров:', error.message);
  console.error(error.stack);
}

db.close();
