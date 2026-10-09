import { db } from './db.js';

console.log('Fixing order items with group information...');

const items = db.prepare('SELECT * FROM order_items').all();
console.log('Found', items.length, 'items total');

let fixed = 0;
for (const item of items) {
  if (!item.product_id) continue;
  
  const product = db.prepare('SELECT groupId, title FROM products WHERE id = ?').get(item.product_id);
  if (!product || !product.groupId) continue;
  
  const group = db.prepare('SELECT name FROM category_groups WHERE id = ?').get(product.groupId);
  if (!group) continue;
  
  db.prepare(
    'UPDATE order_items SET base_product_title = ?, variant_name = ? WHERE id = ?'
  ).run(group.name, product.title, item.id);
  
  fixed++;
  console.log('Fixed:', group.name, '-', product.title);
}

console.log('');
console.log('Fixed', fixed, 'items');
console.log('');
console.log('Sample updated items:');
const samples = db.prepare('SELECT * FROM order_items WHERE base_product_title IS NOT NULL AND variant_name IS NOT NULL LIMIT 5').all();
samples.forEach(item => {
  console.log('-', item.base_product_title, '/', item.variant_name);
});
