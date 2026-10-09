import { db } from './db.js';

console.log('Migrating existing order items...');

// Get all order items with null base_product_title
const items = db.prepare('SELECT * FROM order_items WHERE base_product_title IS NULL').all();
console.log('Found', items.length, 'items to migrate');

let migrated = 0;
for (const item of items) {
  if (item.product_title) {
    // Split title by ' - ' to get base product and variant
    const titleParts = item.product_title.split(' - ');
    const baseProductTitle = titleParts[0];
    const variantName = titleParts.length > 1 ? titleParts.slice(1).join(' - ') : null;
    
    db.prepare('UPDATE order_items SET base_product_title = ?, variant_name = ? WHERE id = ?')
      .run(baseProductTitle, variantName, item.id);
    
    migrated++;
  }
}

console.log('Migrated', migrated, 'items');
console.log('Checking result...');
const sample = db.prepare('SELECT * FROM order_items LIMIT 3').all();
sample.forEach(item => {
  console.log('Product:', item.base_product_title, item.variant_name ? '- ' + item.variant_name : '');
});
