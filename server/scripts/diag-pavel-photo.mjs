import { db, initDb } from '../db.js';
import {
  cacheCustomerPhotoToDisk,
  fetchCustomerPhotoBytes,
} from '../utils/customer-photo-refresh.js';
import { hasCustomerPhotoOnDisk } from '../utils/customer-photo-disk.js';

initDb();

const pavel = db.prepare(`
  SELECT id, first_name, telegram_id, telegram_username, photo_url
  FROM customers
  WHERE first_name = 'Pavel' OR telegram_username IN ('rk0ff', 'Pashka')
  LIMIT 5
`).all();

console.log('customers:', pavel);

for (const row of pavel) {
  console.log('\n---', row.id, row.first_name, '---');
  console.log('photo_url:', row.photo_url?.slice(0, 80));
  console.log('on_disk:', hasCustomerPhotoOnDisk(row.id));

  if (row.photo_url) {
    const bytes = await fetchCustomerPhotoBytes(row.photo_url);
    console.log('fetch bytes:', bytes ? bytes.body.length : 'FAIL');
    if (bytes) {
      const cached = await cacheCustomerPhotoToDisk(row.id, row.photo_url);
      console.log('cache result:', cached);
      console.log('on_disk after:', hasCustomerPhotoOnDisk(row.id));
    }
  }
}