import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_FILE = path.resolve(__dirname, './data/tolsovka.db');
const db = new Database(DB_FILE);

// Clear existing banners
console.log('Clearing existing banners...');
db.prepare('DELETE FROM banners').run();

// Insert new banners
console.log('Inserting new banners...');
const stmt = db.prepare('INSERT INTO banners (id, image, href, active, [order]) VALUES (?, ?, ?, ?, ?)');

const banners = [
  {
    id: 'b_main_01',
    image: '/banners/BHJ-Blog-2022.jpg',
    href: null,
    active: 1,
    order: 1
  },
  {
    id: 'b_main_02',
    image: '/banners/housbt_bd1d16be-47cf-46af-b94b-c0221eccb02c-1800x750-1.webp',
    href: null,
    active: 1,
    order: 2
  },
  {
    id: 'b_main_03',
    image: '/banners/a06f21_2d1490f512e3485fb82f65c8d1eee93a~mv2.jpg',
    href: null,
    active: 1,
    order: 3
  }
];

const tx = db.transaction((rows) => {
  for (const b of rows) {
    stmt.run(b.id, b.image, b.href, b.active, b.order);
  }
});

tx(banners);

console.log(`✓ Updated ${banners.length} banners successfully!`);

// Verify
const result = db.prepare('SELECT * FROM banners ORDER BY [order]').all();
console.log('\nCurrent banners in database:');
console.table(result);

db.close();